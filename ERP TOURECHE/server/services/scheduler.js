import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { getSetting, projectConfig } from '../lib/settings.js';
import { dzDay } from '../lib/util.js';
import * as shopify from '../integrations/shopify.js';
import * as meta from '../integrations/meta.js';
import { CARRIERS } from '../integrations/carriers/index.js';
import { listProjects } from './projects.js';
import { runJob, syncShopifyOrders, syncSheet } from './sync.js';
import { syncTracking, refreshTariffs } from './shipments.js';
import { syncFromShopify, lowStockAlerts } from './products.js';
import { syncCampaigns, syncSpend, autoLink } from './ads.js';
import { sendSnapshot } from './snapshot.js';
import { aiReport } from './advisor.js';
import { aiConfigured } from '../integrations/ai.js';

/**
 * المهام الدورية (تعمل ما دام الجهاز مشغلاً):
 *  كل 5 دقائق  : طلبيات Shopify + جدول Google
 *  كل 30 دقيقة : تتبع الطرود عند شركات التوصيل + إنفاق الإعلانات اليوم
 *  كل ساعة     : المنتجات، الحملات، تنبيهات المخزون، لقطة التقرير الصباحي لـ n8n
 *  يومياً 03:00 : نسخة احتياطية، أسعار شركات التوصيل، إنفاق 30 يوماً (+ تقرير المستشار الذكي كل سبت)
 */
const quiet = (p) => p.catch(() => {});

export function backup() {
  const day = dzDay();
  const file = path.join(config.backupsDir, `toureche-${day}.db`);
  if (fs.existsSync(file)) return file;
  return db.backup(file).then(() => {
    const files = fs.readdirSync(config.backupsDir).filter((f) => f.endsWith('.db')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(config.backupsDir, old));
    return file;
  });
}

export async function every5min() {
  for (const p of listProjects()) {
    await quiet(syncShopifyOrders(p.id));
    await quiet(syncSheet(p.id));
  }
}

export async function every30min() {
  for (const p of listProjects()) {
    const cfg = projectConfig(p.id);
    if (Object.values(CARRIERS).some((c) => c.isConfigured(cfg))) await quiet(runJob('tracking', p.id, 'تتبع الطرود', () => syncTracking(p.id)));
    if (meta.isConfigured(cfg)) await quiet(runJob('ads_spend', p.id, 'Meta Ads', () => syncSpend(p.id, 2)));
  }
}

export async function hourly() {
  for (const p of listProjects()) {
    const cfg = projectConfig(p.id);
    if (shopify.isConfigured(cfg)) await quiet(runJob('products', p.id, 'منتجات Shopify', () => syncFromShopify(p.id)));
    if (meta.isConfigured(cfg))
      await quiet(
        runJob('ads_campaigns', p.id, 'حملات Meta', async () => {
          const r = await syncCampaigns(p.id);
          autoLink(p.id);
          return r;
        }),
      );
    lowStockAlerts(p.id);
  }
  if (getSetting('n8n_report_url')) await quiet(runJob('snapshot', 0, 'تقرير n8n', () => sendSnapshot()));
}

export async function daily() {
  await quiet(Promise.resolve(backup()));
  for (const p of listProjects()) {
    const cfg = projectConfig(p.id);
    if (Object.values(CARRIERS).some((c) => c.isConfigured(cfg))) await quiet(runJob('tariffs', p.id, 'أسعار التوصيل', () => refreshTariffs(p.id)));
    if (meta.isConfigured(cfg)) await quiet(runJob('ads_backfill', p.id, 'Meta Ads (30 يوماً)', () => syncSpend(p.id, 30)));
  }
  // تقرير المستشار الذكي الأسبوعي (كل سبت) لكل المشاريع معاً
  if (aiConfigured() && new Date(Date.now() + 3600e3).getUTCDay() === 6) await quiet(runJob('advisor_weekly', 0, 'تقرير المستشار', () => aiReport(listProjects().map((p) => p.id))));
}

let timer = null;
const last = { m5: 0, m30: 0, h1: 0, day: '' };
let busy = false;

export function startScheduler() {
  if (timer || config.disableScheduler) return;
  const tick = async () => {
    if (busy) return; // دورة سابقة ما زالت تعمل (مزامنة طويلة)
    busy = true;
    const now = Date.now();
    try {
      if (now - last.m5 >= 5 * 60e3) {
        last.m5 = now;
        await every5min();
      }
      if (now - last.m30 >= 30 * 60e3) {
        last.m30 = now;
        await every30min();
      }
      if (now - last.h1 >= 60 * 60e3) {
        last.h1 = now;
        await hourly();
      }
      const dzHour = new Date(now + 3600e3).getUTCHours();
      if (dzHour >= 3 && last.day !== dzDay()) {
        last.day = dzDay();
        await daily();
      }
    } catch (e) {
      console.error('[scheduler]', e);
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 15e3);
  timer = setInterval(tick, 60e3);
}

export function stopScheduler() {
  clearInterval(timer);
  timer = null;
}
