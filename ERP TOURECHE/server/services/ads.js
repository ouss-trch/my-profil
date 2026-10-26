import fs from 'node:fs';
import { db, parseJson } from '../db/index.js';
import { getSetting, setSetting, projectConfig } from '../lib/settings.js';
import { HttpError, addDays, badRequest, dzDay, dzDayStartIso, nowIso, round } from '../lib/util.js';
import * as meta from '../integrations/meta.js';
import { request } from '../lib/http.js';
import { uploadPath } from '../integrations/images.js';
import { toDa } from './analytics.js';
import { getProduct } from './products.js';
import { inList } from './projects.js';
import { tariff } from './shipments.js';

/**
 * «الإعلانات والاختبارات»: من المنتج إلى الحملة إلى القرار — بأرقام الطلبيات الحقيقية (المؤكدة والمسلّمة) لا بأرقام البيكسل.
 */
const fxSet = () => Boolean(db.prepare("SELECT 1 FROM settings WHERE scope = 'global' AND key IN ('fx_usd_dza','fx_eur_dza')").get());

// ——— مزامنة الحملات والإنفاق ———
export async function syncCampaigns(projectId) {
  const cfg = projectConfig(projectId);
  if (!meta.isConfigured(cfg)) return { skipped: true };
  let total = 0;
  for (const accountId of cfg.meta_ad_account_ids) {
    const acct = await meta.accountInfo(cfg, accountId);
    const list = await meta.campaigns(cfg, accountId);
    let ads = [];
    try {
      ads = await meta.adsWithStatus(cfg, accountId);
    } catch {
      /* صلاحية القراءة على مستوى الإعلانات اختيارية */
    }
    const adsByCampaign = {};
    for (const a of ads) (adsByCampaign[a.campaign_id] ||= []).push(a);
    const seen = new Set();
    const stmt = db.prepare(
      `INSERT INTO ad_campaigns (campaign_id, project_id, account_id, name, status, effective_status, objective, daily_budget, lifetime_budget, currency, created_time, issues, link_url, deleted, updated_at)
       VALUES (@campaign_id, @project_id, @account_id, @name, @status, @effective_status, @objective, @daily_budget, @lifetime_budget, @currency, @created_time, @issues, @link_url, 0, @updated_at)
       ON CONFLICT(campaign_id) DO UPDATE SET name = excluded.name, status = excluded.status, effective_status = excluded.effective_status, objective = excluded.objective,
         daily_budget = excluded.daily_budget, lifetime_budget = excluded.lifetime_budget, currency = excluded.currency, issues = excluded.issues, link_url = excluded.link_url, deleted = 0, updated_at = excluded.updated_at`,
    );
    db.transaction(() => {
      for (const c of list) {
        seen.add(c.id);
        const cAds = adsByCampaign[c.id] || [];
        const issues = cAds
          .filter((a) => ['DISAPPROVED', 'WITH_ISSUES'].includes(a.effective_status))
          .map((a) => ({ ad_id: a.id, name: a.name, status: a.effective_status, feedback: a.ad_review_feedback?.global ? Object.values(a.ad_review_feedback.global).join(' ') : a.issues_info?.[0]?.error_message || '' }));
        const link = cAds.map((a) => a.creative?.object_story_spec?.link_data?.link || a.creative?.link_url || a.creative?.object_story_spec?.video_data?.call_to_action?.value?.link).find(Boolean) || null;
        stmt.run({
          campaign_id: c.id,
          project_id: projectId,
          account_id: String(accountId),
          name: c.name,
          status: c.status,
          effective_status: c.effective_status,
          objective: c.objective,
          daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
          lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
          currency: acct.currency,
          created_time: c.created_time,
          issues: JSON.stringify(issues),
          link_url: link,
          updated_at: nowIso(),
        });
        total++;
      }
      // الحملات المحذوفة من Ads Manager تختفي من الـ ERP
      const known = db.prepare('SELECT campaign_id FROM ad_campaigns WHERE project_id = ? AND account_id = ? AND deleted = 0').all(projectId, String(accountId));
      for (const k of known) if (!seen.has(k.campaign_id)) db.prepare('UPDATE ad_campaigns SET deleted = 1, updated_at = ? WHERE campaign_id = ?').run(nowIso(), k.campaign_id);
    })();
  }
  return { campaigns: total };
}

/** إنفاق يومي لكل حملة — لا يُقبل أي يوم في المستقبل (خطأ النسخة السابقة) */
export async function syncSpend(projectId, days = 3) {
  const cfg = projectConfig(projectId);
  if (!meta.isConfigured(cfg)) return { skipped: true };
  const until = dzDay();
  const since = addDays(until, -(days - 1));
  let rows = 0;
  for (const accountId of cfg.meta_ad_account_ids) {
    const data = await meta.insights(cfg, accountId, { level: 'campaign', since, until, timeIncrement: 1 });
    const stmt = db.prepare(
      `INSERT INTO ad_spend (project_id, account_id, campaign_id, date, campaign_name, spend, currency, impressions, clicks, purchases, purchase_value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, campaign_id, date) DO UPDATE SET campaign_name = excluded.campaign_name, spend = excluded.spend, impressions = excluded.impressions,
         clicks = excluded.clicks, purchases = excluded.purchases, purchase_value = excluded.purchase_value, updated_at = excluded.updated_at`,
    );
    db.transaction(() => {
      db.prepare('DELETE FROM ad_spend WHERE project_id = ? AND date > ?').run(projectId, until);
      for (const r of data) {
        if (!r.date || r.date > until) continue;
        stmt.run(projectId, String(accountId), r.campaign_id, r.date, r.campaign_name, r.spend, r.currency, r.impressions, r.clicks, r.purchases, r.purchase_value, nowIso());
        rows++;
      }
    })();
  }
  return { rows };
}

// ——— ربط الحملات بالمنتجات ———
export function linkCampaign(projectId, campaignId, productId) {
  if (productId) getProduct(productId);
  db.prepare(
    `INSERT INTO campaign_products (campaign_id, project_id, product_id) VALUES (?, ?, ?)
     ON CONFLICT(campaign_id) DO UPDATE SET product_id = excluded.product_id, project_id = excluded.project_id`,
  ).run(String(campaignId), projectId, productId || null);
}

export const unlinkCampaign = (campaignId) => db.prepare('DELETE FROM campaign_products WHERE campaign_id = ?').run(String(campaignId));

/** ربط تلقائي بالاسم: حملة يحتوي اسمها على عنوان/رابط المنتج */
export function autoLink(projectId) {
  const products = db.prepare("SELECT id, title, handle FROM products WHERE project_id = ? AND stage != 'archived'").all(projectId);
  const campaigns = db
    .prepare('SELECT c.campaign_id, c.name, c.link_url FROM ad_campaigns c LEFT JOIN campaign_products cp ON cp.campaign_id = c.campaign_id WHERE c.project_id = ? AND cp.campaign_id IS NULL AND c.deleted = 0')
    .all(projectId);
  let linked = 0;
  for (const c of campaigns) {
    const name = String(c.name || '').toLowerCase();
    const hit = products.find(
      (p) => (p.handle && (name.includes(p.handle) || String(c.link_url || '').includes(`/products/${p.handle}`))) || (p.title && name.includes(p.title.toLowerCase().slice(0, 24))),
    );
    if (hit) {
      linkCampaign(projectId, c.campaign_id, hit.id);
      linked++;
    }
  }
  return linked;
}

// ——— حد التعادل وحكم الاختبار ———
function deliveryRate(projectId) {
  const r = db
    .prepare("SELECT SUM(status='delivered') AS d, SUM(status='returned') AS r FROM orders WHERE project_id = ? AND closed_at >= ? AND status IN ('delivered','returned')")
    .get(projectId, new Date(Date.now() - 60 * 86400e3).toISOString());
  return r.d + r.r >= 10 ? r.d / (r.d + r.r) : 0.75;
}

function avgReturnFee(projectId) {
  const r = db.prepare('SELECT AVG(return_fee) AS f FROM carrier_tariffs WHERE project_id IN (0, ?) AND return_fee > 0').get(projectId);
  return r.f || 200;
}

/** أقصى تكلفة إعلان لكل طلبية مسلّمة قبل الخسارة */
export function breakEven(p, projectId) {
  if (!p.price) return null;
  const dr = deliveryRate(projectId);
  const margin = p.price - (p.cost_price || 0) - (p.packaging_cost || 0);
  const returnsPerDelivered = (1 - dr) / dr;
  const value = margin - returnsPerDelivered * avgReturnFee(projectId);
  return { da: round(Math.max(0, value)), usd: round(Math.max(0, value) / (getSetting('fx_usd_dza') || 250), 2), margin: round(margin), delivery_rate: round(dr * 100) };
}

function productOrders(projectId, productId, sinceIso) {
  const rows = db.prepare("SELECT * FROM orders WHERE project_id = ? AND created_at >= ? AND status != 'abandoned' AND items LIKE ?").all(projectId, sinceIso, `%"product_id":${productId}%`);
  return rows.filter((o) => parseJson(o.items, []).some((i) => i.product_id === productId));
}

export function productTest(projectId, product, days = 7) {
  const since = addDays(dzDay(), -(days - 1));
  const campaignIds = db.prepare('SELECT campaign_id FROM campaign_products WHERE product_id = ?').all(product.id).map((r) => r.campaign_id);
  const campaigns = campaignIds.length
    ? db.prepare(`SELECT * FROM ad_campaigns WHERE campaign_id IN (${inList(campaignIds)}) AND deleted = 0`).all(...campaignIds).map((c) => ({ ...c, issues: parseJson(c.issues, []) }))
    : [];
  const spendRows = campaignIds.length
    ? db.prepare(`SELECT currency, SUM(spend) AS s, SUM(purchases) AS p FROM ad_spend WHERE campaign_id IN (${inList(campaignIds)}) AND date >= ? AND date <= ? GROUP BY currency`).all(...campaignIds, since, dzDay())
    : [];
  const spend = spendRows.reduce((s, r) => s + r.s, 0);
  const spendDa = round(spendRows.reduce((s, r) => s + toDa(r.s, r.currency), 0));
  const orders = productOrders(projectId, product.id, dzDayStartIso(since));
  const confirmed = orders.filter((o) => !['new', 'no_answer', 'callback', 'cancelled', 'fake'].includes(o.status)).length;
  const delivered = orders.filter((o) => o.status === 'delivered');
  const returned = orders.filter((o) => o.status === 'returned');
  const inFlight = orders.filter((o) => ['confirmed', 'shipped', 'in_transit', 'at_office', 'out_for_delivery', 'attempt_failed'].includes(o.status)).length;
  const dr = deliveryRate(projectId);
  const expected = round(delivered.length + inFlight * dr, 1);
  const revenue = delivered.reduce((s, o) => s + o.total, 0);
  const cogs = delivered.reduce((s, o) => s + (o.cogs || 0), 0) + delivered.length * (product.packaging_cost || 0);
  const shipCost = delivered.reduce((s, o) => s + (o.shipping_cost || 0), 0);
  const returnCost = returned.reduce((s, o) => s + (tariff(projectId, o.carrier, o.wilaya_code, o.delivery_type)?.return_fee || avgReturnFee(projectId)), 0);
  const be = breakEven(product, projectId);
  const cpd = expected >= 1 && spendDa > 0 ? round(spendDa / expected) : null;
  const killSpend = projectConfig(projectId).test_kill_spend_da || 3000;
  let verdict = 'insufficient';
  // دون إنفاق إعلاني لا يوجد حكم إعلاني: المبيعات عضوية (لا «رابح» بتكلفة صفر)
  if (!campaigns.length && spendDa === 0) verdict = 'no_ads';
  else if (be && cpd !== null && expected >= 3) verdict = cpd <= be.da * 0.6 ? 'winning' : cpd <= be.da * 1.05 ? 'thin' : 'losing';
  else if (spendDa >= killSpend && expected < 1) verdict = 'losing';
  else if (orders.length && expected < 3) verdict = 'pending';
  const pixel = spendRows.reduce((s, r) => s + r.p, 0);
  return {
    product_id: product.id,
    title: product.title,
    image: product.images?.[0]?.url || null,
    test_stage: product.test_stage,
    seo_score: product.seo_score,
    price: product.price,
    days,
    spend: round(spend, 2),
    spend_currency: spendRows[0]?.currency || null,
    spend_da: spendDa,
    orders: orders.length,
    confirmed,
    delivered: delivered.length,
    returned: returned.length,
    in_flight: inFlight,
    expected_delivered: expected,
    cost_per_delivered_da: cpd,
    break_even: be,
    profit_da: round(revenue - cogs - shipCost - returnCost - spendDa),
    pixel_purchases: pixel,
    verdict,
    campaigns,
  };
}

export function productTests(projectId, days = 7) {
  const products = db
    .prepare("SELECT * FROM products WHERE project_id = ? AND (test_stage IN ('idea','preparing','testing','winner','loser','paused') OR id IN (SELECT product_id FROM campaign_products)) AND stage != 'archived' ORDER BY updated_at DESC")
    .all(projectId)
    .map((r) => getProduct(r.id));
  return products.map((p) => productTest(projectId, p, days));
}

/** قرارات اليوم مرتبة حسب الاستعجال، ولكل قرار زر تنفيذ */
export function decisions(projectId, days = 7) {
  const cfg = projectConfig(projectId);
  const out = [];
  const push = (d) => out.push({ id: `${d.kind}:${d.product_id || d.campaign_id || d.account_id || ''}`, ...d });
  if (meta.isConfigured(cfg) && !fxSet()) push({ kind: 'fx_not_set', severity: 'high', action: 'open_settings' });
  for (const t of productTests(projectId, days)) {
    const running = t.campaigns.filter((c) => c.effective_status === 'ACTIVE');
    if (t.verdict === 'losing' && running.length)
      push({ kind: 'stop_test', severity: 'critical', product_id: t.product_id, title: t.title, params: { spend_da: t.spend_da, cpd: t.cost_per_delivered_da, be: t.break_even?.da }, action: 'stop_test' });
    if (t.verdict === 'winning' && running.length) {
      // اقتراح الزيادة التالية: +20% فقط (قاعدة آمنة حتى لا تعود المجموعة لمرحلة التعلم)
      const c = running.find((x) => x.daily_budget) || running[0];
      push({
        kind: 'scale_budget',
        severity: 'high',
        product_id: t.product_id,
        title: t.title,
        campaign_ids: running.map((x) => x.campaign_id),
        params: { cpd: t.cost_per_delivered_da, be: t.break_even?.da, ...(c?.daily_budget ? { budget_now: c.daily_budget, budget_next: round(c.daily_budget * 1.2, 2), currency: c.currency } : {}) },
        action: 'scale_budget',
      });
    }
    if (t.verdict === 'thin') push({ kind: 'thin_margin', severity: 'medium', product_id: t.product_id, title: t.title, params: { cpd: t.cost_per_delivered_da, be: t.break_even?.da }, action: 'analyze' });
    for (const c of t.campaigns)
      if (c.issues.length) push({ kind: 'ad_rejected', severity: 'high', product_id: t.product_id, campaign_id: c.campaign_id, title: c.name, params: { feedback: c.issues[0]?.feedback }, action: 'edit_in_ads_manager' });
    const store = cfg.store_domain;
    for (const c of t.campaigns)
      if (store && c.link_url && !c.link_url.includes(store)) push({ kind: 'wrong_link', severity: 'high', product_id: t.product_id, campaign_id: c.campaign_id, title: c.name, params: { link: c.link_url }, action: 'edit_in_ads_manager' });
    if (t.test_stage === 'testing' && !running.length)
      push({ kind: t.campaigns.length ? 'campaign_not_running' : 'no_campaign', severity: 'medium', product_id: t.product_id, title: t.title, action: t.campaigns.length ? 'activate' : 'launch' });
    if (['testing', 'winner'].includes(t.test_stage) && t.test_stage !== 'none' && (t.seo_score ?? 0) < 70)
      push({ kind: 'weak_page', severity: 'low', product_id: t.product_id, title: t.title, params: { score: t.seo_score }, action: 'improve_page' });
    const budget = getProduct(t.product_id).test_budget_da;
    if (t.test_stage === 'testing' && budget && t.spend_da >= budget && t.verdict === 'insufficient')
      push({ kind: 'budget_spent_no_verdict', severity: 'medium', product_id: t.product_id, title: t.title, params: { spend_da: t.spend_da, budget }, action: 'review' });
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** إيقاف وإغلاق اختبار خاسر: إيقاف كل حملاته + تحويل المنتج إلى «خاسر» */
export async function stopTest(projectId, productId, note) {
  const cfg = projectConfig(projectId);
  const ids = db.prepare('SELECT campaign_id FROM campaign_products WHERE product_id = ?').all(productId).map((r) => r.campaign_id);
  const results = {};
  for (const id of ids) {
    try {
      await meta.setStatus(cfg, id, 'PAUSED');
      db.prepare("UPDATE ad_campaigns SET status = 'PAUSED', effective_status = 'PAUSED', updated_at = ? WHERE campaign_id = ?").run(nowIso(), id);
      results[id] = 'paused';
    } catch (e) {
      results[id] = e.message;
    }
  }
  db.prepare("UPDATE products SET test_stage = 'loser', decision_note = COALESCE(?, decision_note), updated_at = ? WHERE id = ?").run(note || null, nowIso(), productId);
  return results;
}

export async function setCampaignStatus(projectId, campaignId, status) {
  if (!['ACTIVE', 'PAUSED'].includes(status)) throw badRequest('status_invalid');
  const cfg = projectConfig(projectId);
  await meta.setStatus(cfg, campaignId, status);
  db.prepare('UPDATE ad_campaigns SET status = ?, effective_status = ?, updated_at = ? WHERE campaign_id = ?').run(status, status, nowIso(), campaignId);
  cache.clear();
}

/** الميزانية اليومية بعملة الحساب (وحدة كاملة، مثلاً 12.5 دولار) — على الحملة (CBO) أو على مجموعة إعلانية (ABO) */
export async function setCampaignBudget(projectId, campaignId, dailyBudget, adsetId) {
  if (!(dailyBudget > 0)) throw badRequest('budget_invalid');
  const cfg = projectConfig(projectId);
  await meta.setDailyBudget(cfg, adsetId || campaignId, Math.round(dailyBudget * 100));
  if (!adsetId) db.prepare('UPDATE ad_campaigns SET daily_budget = ?, updated_at = ? WHERE campaign_id = ?').run(dailyBudget, nowIso(), campaignId);
  cache.clear();
}

/** نظرة الحملات مع المؤشرات والتشخيص */
export async function campaignsOverview(projectId, days = 7) {
  const cfg = projectConfig(projectId);
  if (!meta.isConfigured(cfg)) return { configured: false, campaigns: [] };
  const until = dzDay();
  const since = addDays(until, -(days - 1));
  const metrics = {};
  for (const accountId of cfg.meta_ad_account_ids) {
    try {
      for (const r of await meta.insights(cfg, accountId, { level: 'campaign', since, until })) metrics[r.campaign_id] = r;
    } catch (e) {
      if (e.kind === 'auth' || e.kind === 'network') throw e;
    }
  }
  const links = Object.fromEntries(db.prepare('SELECT cp.campaign_id, p.id, p.title FROM campaign_products cp JOIN products p ON p.id = cp.product_id WHERE cp.project_id = ?').all(projectId).map((r) => [r.campaign_id, { id: r.id, title: r.title }]));
  const campaigns = db
    .prepare('SELECT * FROM ad_campaigns WHERE project_id = ? AND deleted = 0 ORDER BY created_time DESC')
    .all(projectId)
    .map((c) => {
      const m = metrics[c.campaign_id] || {};
      const ctr = m.impressions ? (100 * (m.link_clicks || m.clicks || 0)) / m.impressions : null;
      const hook = m.impressions && m.video_views ? (100 * m.video_views) / m.impressions : null;
      const conv = m.link_clicks ? (100 * (m.purchases || 0)) / m.link_clicks : null;
      let diagnosis = 'ok';
      if (!m.impressions || m.impressions < 1000) diagnosis = 'not_enough_data';
      else if (ctr !== null && ctr < 0.8) diagnosis = 'weak_hook';
      else if (conv !== null && conv < 1) diagnosis = 'weak_page_or_offer';
      else if (m.cpm > 4) diagnosis = 'expensive_audience';
      return {
        ...c,
        issues: parseJson(c.issues, []),
        product: links[c.campaign_id] || null,
        spend: round(m.spend || 0, 2),
        spend_da: round(toDa(m.spend || 0, c.currency)),
        impressions: m.impressions || 0,
        ctr: ctr === null ? null : round(ctr, 2),
        hook_rate: hook === null ? null : round(hook, 1),
        conversion: conv === null ? null : round(conv, 2),
        cpm: m.cpm ? round(m.cpm, 2) : null,
        purchases: m.purchases || 0,
        cost_per_purchase: m.purchases ? round(m.spend / m.purchases, 2) : null,
        frequency: m.frequency ? round(m.frequency, 2) : null,
        diagnosis,
      };
    });
  return { configured: true, campaigns };
}

export async function accountsHealth(projectId) {
  const cfg = projectConfig(projectId);
  if (!meta.isConfigured(cfg)) return { configured: false, accounts: [] };
  const today = dzDay();
  const monthStart = `${today.slice(0, 8)}01`;
  const accounts = [];
  for (const id of cfg.meta_ad_account_ids) {
    try {
      const h = await meta.accountHealth(cfg, id);
      const spend = (from) => db.prepare('SELECT COALESCE(SUM(spend),0) AS s FROM ad_spend WHERE account_id = ? AND date >= ? AND date <= ?').get(String(id), from, today).s;
      accounts.push({ id, ...h, spend_today: round(spend(today), 2), spend_month: round(spend(monthStart), 2) });
    } catch (e) {
      accounts.push({ id, error: e.message, kind: e.kind });
    }
  }
  return { configured: true, accounts, fx: { usd: getSetting('fx_usd_dza'), eur: getSetting('fx_eur_dza'), set: fxSet() } };
}

/** آخر 90 يوماً: أداء كل منصة (لتوجيه اختيار فيسبوك/إنستغرام عند إطلاق اختبار) */
export function platformHistory(projectId) {
  const rows = db
    .prepare("SELECT COUNT(*) AS n, utm_source FROM orders WHERE project_id = ? AND created_at >= ? AND status != 'abandoned' GROUP BY utm_source")
    .all(projectId, new Date(Date.now() - 90 * 86400e3).toISOString());
  const count = (re) => rows.filter((r) => re.test(String(r.utm_source || ''))).reduce((s, r) => s + r.n, 0);
  return { facebook_orders: count(/fb|facebook/i), instagram_orders: count(/ig|insta/i) };
}

export const productLink = (cfg, p) => p.online_url || (cfg.store_domain && p.handle && p.shopify_id ? `https://${cfg.store_domain}/products/${p.handle}` : null);

const DEFAULT_KEYS = ['account_id', 'page_id', 'pixel_id', 'platforms', 'age_min', 'age_max', 'genders', 'countries', 'daily_budget', 'cta'];

/**
 * إطلاق حملة لأي منتج (منشأ في الـ ERP أو مُزامن من Shopify): رفع التصميم + حملة كاملة متوقفة مرتبطة بالمنتج.
 * الميزانية يحددها المستخدم دائماً — لا قيمة افتراضية مخمّنة.
 */
export async function launchTest(projectId, productId, o) {
  const cfg = projectConfig(projectId);
  if (!cfg.meta_access_token) throw new HttpError(400, 'meta_not_configured');
  const p = getProduct(productId);
  const accountId = String(o.accountId || cfg.meta_ad_account_ids[0] || '').replace(/^act_/, '');
  if (!accountId) throw badRequest('ad_account_required');
  const pageId = o.pageId || cfg.meta_page_id;
  if (!pageId) throw new HttpError(400, 'page_not_configured');
  const acct = await meta.accountInfo(cfg, accountId);
  const link = o.link || productLink(cfg, p);
  if (!link) throw badRequest('product_link_missing');
  if (!o.imageUrl && !o.postId && !o.igMediaId) throw badRequest('image_required');
  // الميزانية اليومية بعملة الحساب (مثلاً 5 يورو) أو بالدينار وتُحوَّل
  const fx = acct.currency === 'DZD' ? 1 : acct.currency === 'EUR' ? getSetting('fx_eur_dza') || 270 : getSetting('fx_usd_dza') || 250;
  const daily = o.dailyBudget ? Number(o.dailyBudget) : o.dailyBudgetDa ? Number(o.dailyBudgetDa) / fx : 0;
  if (!(daily >= 1)) throw badRequest('budget_required');
  let imageHash = null;
  if (o.imageUrl) {
    let buffer;
    if (o.imageUrl.startsWith('/uploads/')) {
      const file = uploadPath(o.imageUrl);
      if (!file) throw badRequest('bad_path');
      buffer = fs.readFileSync(file);
    } else {
      if (!/^https:\/\//i.test(o.imageUrl)) throw badRequest('bad_path');
      const res = await request('images', o.imageUrl, { raw: true, timeoutMs: 60000 });
      buffer = Buffer.from(await res.arrayBuffer());
    }
    imageHash = await meta.uploadImage(cfg, accountId, buffer);
  }
  const short = o.platforms?.length === 1 ? (o.platforms[0] === 'instagram' ? 'IG' : 'FB') : 'FB+IG';
  const name = o.name || `${p.title.slice(0, 40)} · ${short} · ${dzDay()}`;
  const pixelId = o.pixelId === 'none' ? null : o.pixelId || cfg.meta_pixel_id || null;
  const ids = await meta.createPausedCampaign(cfg, {
    accountId,
    name,
    dailyBudgetMinor: daily * 100,
    pixelId,
    pageId,
    igUserId: o.igUserId || (pageId === cfg.meta_page_id ? cfg.meta_ig_user_id : null) || undefined,
    link: `${link}${link.includes('?') ? '&' : '?'}utm_source=${short === 'IG' ? 'ig' : short === 'FB' ? 'fb' : 'meta'}&utm_medium=paid&utm_campaign=p${p.id}`,
    message: o.primaryText,
    headline: o.headline,
    description: o.description,
    imageHash,
    postId: o.postId,
    igMediaId: o.igMediaId,
    cta: o.cta || 'SHOP_NOW',
    ageMin: o.ageMin,
    ageMax: o.ageMax,
    genders: o.genders,
    platforms: o.platforms,
    countries: o.countries,
  });
  // الحساب المختار يصبح من حسابات المشروع حتى يُتابَع إنفاقه ونتائجه تلقائياً
  if (!cfg.meta_ad_account_ids.map(String).includes(accountId)) setSetting('meta_ad_account_ids', [...cfg.meta_ad_account_ids.map(String), accountId], projectId);
  linkCampaign(projectId, ids.campaign_id, productId);
  db.prepare("UPDATE products SET test_stage = CASE WHEN test_stage IN ('none','idea','preparing') THEN 'testing' ELSE test_stage END, test_started_at = COALESCE(test_started_at, ?), test_budget_da = COALESCE(?, test_budget_da), updated_at = ? WHERE id = ?").run(
    nowIso(),
    o.testBudgetDa || null,
    nowIso(),
    productId,
  );
  const payload = JSON.stringify({ ...o, accountId, pageId, pixelId });
  if (o.draftId) db.prepare("UPDATE ad_drafts SET status = 'published', payload = ?, meta_ids = ?, error = NULL, updated_at = ? WHERE id = ? AND project_id = ?").run(payload, JSON.stringify(ids), nowIso(), o.draftId, projectId);
  else db.prepare("INSERT INTO ad_drafts (project_id, product_id, name, payload, status, meta_ids, updated_at) VALUES (?, ?, ?, ?, 'published', ?, ?)").run(projectId, productId, name, payload, JSON.stringify(ids), nowIso());
  saveLaunchDefaults(projectId, { account_id: accountId, page_id: pageId, pixel_id: pixelId, platforms: o.platforms, age_min: o.ageMin, age_max: o.ageMax, genders: o.genders, countries: o.countries, daily_budget: daily, cta: o.cta });
  await syncCampaigns(projectId).catch(() => {});
  if (o.activate) await meta.activateCascade(cfg, ids.campaign_id);
  cache.clear();
  return { ...ids, name, currency: acct.currency, daily_budget: round(daily, 2), activated: Boolean(o.activate), ads_manager_url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId}&selected_campaign_ids=${ids.campaign_id}` };
}

/** إعدادات الإطلاق الدائمة لكل مشروع: آخر حساب/صفحة/بيكسل/استهداف/ميزانية اختارها المستخدم */
export function saveLaunchDefaults(projectId, d) {
  const clean = Object.fromEntries(Object.entries(d || {}).filter(([k, val]) => DEFAULT_KEYS.includes(k) && val !== undefined && val !== null && val !== ''));
  setSetting('ads_launch_defaults', { ...projectConfig(projectId).ads_launch_defaults, ...clean }, projectId);
  return projectConfig(projectId).ads_launch_defaults;
}

/** كل ما يحتاجه نموذج إطلاق حملة لمنتج: الرابط، الصور، النصوص المقترحة، الإعدادات المحفوظة، المسودات */
export function launchContext(projectId, productId) {
  const cfg = projectConfig(projectId);
  const p = getProduct(productId);
  return {
    product: { id: p.id, title: p.title, price: p.price, images: p.images || [], handle: p.handle, shopify_id: p.shopify_id, shopify_status: p.shopify_status, stage: p.stage, test_stage: p.test_stage },
    ad_copy: parseJson(db.prepare("SELECT content FROM creatives WHERE product_id = ? AND kind = 'copy' ORDER BY id DESC LIMIT 1").get(productId)?.content, null),
    generated_images: db.prepare("SELECT id, url, created_at FROM creatives WHERE product_id = ? AND kind = 'image' AND url IS NOT NULL ORDER BY id DESC LIMIT 24").all(productId),
    link: productLink(cfg, p),
    published: Boolean(p.shopify_id),
    break_even: breakEven(p, projectId),
    defaults: { account_id: cfg.meta_ad_account_ids[0] || null, page_id: cfg.meta_page_id || null, pixel_id: cfg.meta_pixel_id || null, platforms: ['facebook', 'instagram'], countries: ['DZ'], age_min: 18, cta: 'SHOP_NOW', ...cfg.ads_launch_defaults },
    drafts: listDrafts(projectId, productId),
    campaigns: db.prepare('SELECT c.* FROM campaign_products cp JOIN ad_campaigns c ON c.campaign_id = cp.campaign_id WHERE cp.product_id = ? AND c.deleted = 0 ORDER BY c.created_time DESC').all(productId).map((c) => ({ ...c, issues: parseJson(c.issues, []) })),
    fx: { usd: getSetting('fx_usd_dza'), eur: getSetting('fx_eur_dza') },
  };
}

// ——— مسودات الحملات: تُحفظ في الـ ERP دون أي اتصال بـ Meta، وتُنشر لاحقاً ———
const draftRow = (r) => ({ ...r, payload: parseJson(r.payload, {}), meta_ids: parseJson(r.meta_ids, null) });

export function listDrafts(projectId, productId) {
  const rows = productId
    ? db.prepare('SELECT d.*, p.title AS product_title FROM ad_drafts d LEFT JOIN products p ON p.id = d.product_id WHERE d.project_id = ? AND d.product_id = ? ORDER BY d.id DESC LIMIT 50').all(projectId, productId)
    : db.prepare('SELECT d.*, p.title AS product_title FROM ad_drafts d LEFT JOIN products p ON p.id = d.product_id WHERE d.project_id = ? ORDER BY d.id DESC LIMIT 200').all(projectId);
  return rows.map(draftRow);
}

export function saveDraft(projectId, { id, productId, name, payload }) {
  if (productId) getProduct(productId);
  if (id) {
    const cur = db.prepare('SELECT * FROM ad_drafts WHERE id = ? AND project_id = ?').get(id, projectId);
    if (!cur) throw new HttpError(404, 'draft_not_found');
    db.prepare('UPDATE ad_drafts SET name = ?, payload = ?, product_id = COALESCE(?, product_id), updated_at = ? WHERE id = ?').run(name || cur.name, JSON.stringify(payload || {}), productId || null, nowIso(), id);
    return draftRow(db.prepare('SELECT * FROM ad_drafts WHERE id = ?').get(id));
  }
  const info = db.prepare("INSERT INTO ad_drafts (project_id, product_id, name, payload, status, updated_at) VALUES (?, ?, ?, ?, 'draft', ?)").run(projectId, productId || null, name || 'Draft', JSON.stringify(payload || {}), nowIso());
  return draftRow(db.prepare('SELECT * FROM ad_drafts WHERE id = ?').get(info.lastInsertRowid));
}

export function deleteDraft(projectId, id) {
  const info = db.prepare("DELETE FROM ad_drafts WHERE id = ? AND project_id = ? AND status != 'published'").run(id, projectId);
  if (!info.changes) throw new HttpError(404, 'draft_not_found');
}

// ——— مستكشف Business Manager: كل الحملات (منشأة، قيد التشغيل، متوقفة، مرفوضة، مؤرشفة) لأي حساب ———
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function explorer(projectId, { refresh = false } = {}) {
  const cfg = projectConfig(projectId);
  if (!cfg.meta_access_token) return { configured: false, businesses: [] };
  if (refresh) cache.delete(`bm:${projectId}`);
  const businesses = await cached(`bm:${projectId}`, 10 * 60e3, () => meta.businessesWithAccounts(cfg));
  const linked = new Set(cfg.meta_ad_account_ids.map(String));
  return {
    configured: true,
    selected_business: cfg.meta_business_id || null,
    project_accounts: [...linked],
    businesses: businesses.map((b) => ({ ...b, accounts: b.accounts.map((a) => ({ ...a, in_project: linked.has(a.id) })) })),
  };
}

export function selectBusiness(projectId, businessId) {
  setSetting('meta_business_id', businessId || '', projectId);
}

/** ربط/فك ربط حساب إعلاني بالمشروع (لمتابعة إنفاقه في القرارات والمالية) */
export function setProjectAccount(projectId, accountId, linked) {
  const cfg = projectConfig(projectId);
  const id = String(accountId).replace(/^act_/, '');
  const list = cfg.meta_ad_account_ids.map(String).filter((x) => x !== id);
  setSetting('meta_ad_account_ids', linked ? [...list, id] : list, projectId);
  cache.delete(`bm:${projectId}`);
  return linked ? list.length + 1 : list.length;
}

const STATUS_GROUP = {
  ACTIVE: 'active',
  IN_PROCESS: 'review',
  PENDING_REVIEW: 'review',
  PAUSED: 'paused',
  CAMPAIGN_PAUSED: 'paused',
  ADSET_PAUSED: 'paused',
  WITH_ISSUES: 'issues',
  DISAPPROVED: 'issues',
  PENDING_BILLING_INFO: 'issues',
  ARCHIVED: 'archived',
  DELETED: 'archived',
};

/** حملات أي حساب إعلاني مباشرة من Meta مع الأداء والتشخيص والمنتج المرتبط ومصدرها (من الـ ERP أم لا) */
export async function accountCampaigns(projectId, accountId, { days = 7, includeArchived = false } = {}) {
  const cfg = projectConfig(projectId);
  if (!cfg.meta_access_token) throw new HttpError(400, 'meta_not_configured');
  const id = String(accountId).replace(/^act_/, '');
  const until = dzDay();
  const since = addDays(until, -(days - 1));
  return cached(`camps:${projectId}:${id}:${days}:${includeArchived}`, 60e3, async () => {
    const [acct, list, metricsRows, adsetRows, ads] = await Promise.all([
      meta.accountInfo(cfg, id),
      meta.campaigns(cfg, id, { includeArchived }),
      meta.insights(cfg, id, { level: 'campaign', since, until }).catch(() => []),
      meta.adsetsOfAccount(cfg, id).catch(() => []),
      meta.adsWithStatus(cfg, id).catch(() => []),
    ]);
    const metrics = Object.fromEntries(metricsRows.map((r) => [r.campaign_id, r]));
    const adsetsBy = {};
    for (const a of adsetRows) (adsetsBy[a.campaign_id] ||= []).push(a);
    const adsBy = {};
    for (const a of ads) (adsBy[a.campaign_id] ||= []).push(a);
    const fromErp = new Set(
      db
        .prepare("SELECT meta_ids FROM ad_drafts WHERE status = 'published' AND meta_ids IS NOT NULL")
        .all()
        .map((r) => parseJson(r.meta_ids, {})?.campaign_id)
        .filter(Boolean),
    );
    const links = Object.fromEntries(db.prepare('SELECT cp.campaign_id, p.id, p.title FROM campaign_products cp JOIN products p ON p.id = cp.product_id').all().map((r) => [r.campaign_id, { id: r.id, title: r.title }]));
    const campaigns = list.map((c) => {
      const m = metrics[c.id] || {};
      const sets = adsetsBy[c.id] || [];
      const cAds = adsBy[c.id] || [];
      const abo = !c.daily_budget && !c.lifetime_budget;
      const daily = c.daily_budget ? Number(c.daily_budget) / 100 : abo ? sets.filter((a) => a.status === 'ACTIVE' || sets.length === 1).reduce((s, a) => s + Number(a.daily_budget || 0) / 100, 0) || null : null;
      const ctr = m.impressions ? (100 * (m.link_clicks || m.clicks || 0)) / m.impressions : null;
      const conv = m.link_clicks ? (100 * (m.purchases || 0)) / m.link_clicks : null;
      let diagnosis = 'ok';
      if (!m.impressions || m.impressions < 1000) diagnosis = 'not_enough_data';
      else if (ctr !== null && ctr < 0.8) diagnosis = 'weak_hook';
      else if (conv !== null && conv < 1) diagnosis = 'weak_page_or_offer';
      else if (m.frequency > 3) diagnosis = 'audience_fatigue';
      else if (toDa(m.cpm || 0, acct.currency) > 1000) diagnosis = 'expensive_audience';
      const issues = cAds
        .filter((a) => ['DISAPPROVED', 'WITH_ISSUES'].includes(a.effective_status))
        .map((a) => ({ ad_id: a.id, name: a.name, status: a.effective_status, feedback: a.ad_review_feedback?.global ? Object.values(a.ad_review_feedback.global).join(' ') : a.issues_info?.[0]?.error_message || '' }));
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        effective_status: c.effective_status,
        group: STATUS_GROUP[c.effective_status] || 'paused',
        objective: c.objective,
        created_time: c.created_time,
        start_time: c.start_time || null,
        stop_time: c.stop_time || null,
        budget_level: abo ? 'adset' : 'campaign',
        daily_budget: daily ? round(daily, 2) : null,
        lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        adsets: sets.map((a) => ({ id: a.id, status: a.status, effective_status: a.effective_status, daily_budget: a.daily_budget ? Number(a.daily_budget) / 100 : null, learning: a.learning_stage_info?.status || null })),
        // مرحلة التعلم في Meta: LEARNING (يتعلم) · SUCCESS (خرج من التعلم) · FAIL (تعلم محدود)
        learning: (() => {
          const st = sets.filter((a) => a.effective_status === 'ACTIVE').map((a) => a.learning_stage_info?.status).filter(Boolean);
          return st.includes('FAIL') ? 'FAIL' : st.includes('LEARNING') ? 'LEARNING' : st.includes('SUCCESS') ? 'SUCCESS' : null;
        })(),
        ads_count: cAds.length,
        thumbnail: cAds.map((a) => a.creative?.thumbnail_url || a.creative?.image_url).find(Boolean) || null,
        link: cAds.map((a) => a.creative?.object_story_spec?.link_data?.link || a.creative?.link_url).find(Boolean) || null,
        issues,
        from_erp: fromErp.has(c.id),
        product: links[c.id] || null,
        spend: round(m.spend || 0, 2),
        spend_da: round(toDa(m.spend || 0, acct.currency)),
        impressions: m.impressions || 0,
        reach: m.reach || 0,
        clicks: m.link_clicks || m.clicks || 0,
        ctr: ctr === null ? null : round(ctr, 2),
        cpm: m.cpm ? round(m.cpm, 2) : null,
        frequency: m.frequency ? round(m.frequency, 2) : null,
        purchases: m.purchases || 0,
        cost_per_purchase: m.purchases ? round(m.spend / m.purchases, 2) : null,
        conversion: conv === null ? null : round(conv, 2),
        diagnosis,
      };
    });
    const groups = campaigns.reduce((g, c) => ((g[c.group] = (g[c.group] || 0) + 1), g), {});
    const totals = { spend: round(campaigns.reduce((s, c) => s + c.spend, 0), 2), purchases: campaigns.reduce((s, c) => s + c.purchases, 0), impressions: campaigns.reduce((s, c) => s + c.impressions, 0) };
    return {
      account: { id, name: acct.name, currency: acct.currency, status: acct.account_status, disable_reason: acct.disable_reason || 0, amount_spent: Number(acct.amount_spent || 0) / 100, in_project: cfg.meta_ad_account_ids.map(String).includes(id) },
      since,
      until,
      groups,
      totals: { ...totals, spend_da: round(toDa(totals.spend, acct.currency)) },
      campaigns: campaigns.sort((a, b) => (a.group === 'active' ? 0 : 1) - (b.group === 'active' ? 0 : 1) || b.spend - a.spend || String(b.created_time).localeCompare(String(a.created_time))),
    };
  });
}

export const accountAssets = (projectId, accountId) => cached(`assets:${projectId}:${accountId}`, 10 * 60e3, () => meta.accountAssets(projectConfig(projectId), accountId));

/** ملخص الأسبوع للتقرير الصباحي في n8n (ads_hub) */
export function weekHub(projectId) {
  const tests = productTests(projectId, 7);
  const sum = (k) => tests.reduce((s, t) => s + (t[k] || 0), 0);
  const spendDa = sum('spend_da');
  const delivered = sum('delivered');
  return {
    decisions: decisions(projectId, 7),
    week: { spend_da: round(spendDa), orders: sum('orders'), delivered, cpd_da: delivered ? round(spendDa / delivered) : null, profit_da: round(sum('profit_da')) },
  };
}

// ——— تعديل حملة من داخل الـ ERP (كل قسم يُحفظ وحده ويُرسل مباشرة إلى Meta) ———
export async function campaignTree(projectId, campaignId) {
  const cfg = projectConfig(projectId);
  const tree = await meta.campaignTree(cfg, campaignId);
  const acct = db.prepare('SELECT currency FROM ad_campaigns WHERE campaign_id = ?').get(campaignId) || (tree.campaign.account_id ? await meta.accountInfo(cfg, tree.campaign.account_id).catch(() => null) : null);
  return { ...tree, currency: acct?.currency || null, product: db.prepare('SELECT p.id, p.title FROM campaign_products cp JOIN products p ON p.id = cp.product_id WHERE cp.campaign_id = ?').get(campaignId) || null };
}

export async function editCampaign(projectId, campaignId, { section, data }) {
  const cfg = projectConfig(projectId);
  if (section === 'campaign') await meta.updateCampaign(cfg, campaignId, { name: data.name, dailyBudget: data.daily_budget });
  else if (section === 'adset')
    await meta.updateAdset(cfg, data.id, { name: data.name, endTime: data.end_time, ageMin: data.age_min, ageMax: data.age_max, genders: data.genders, platform: data.platform, countries: data.countries, dailyBudget: data.daily_budget });
  else if (section === 'ad') {
    const row = db.prepare('SELECT account_id FROM ad_campaigns WHERE campaign_id = ?').get(campaignId);
    const accountId = row?.account_id || (await meta.graph(cfg, campaignId, { params: { fields: 'account_id' } })).account_id;
    await meta.updateAdCreative(cfg, accountId, data.id, {
      name: data.name || 'Ad',
      adName: data.name,
      pageId: data.page_id || cfg.meta_page_id,
      igUserId: data.ig_user_id || cfg.meta_ig_user_id || undefined,
      link: data.link,
      message: data.message,
      headline: data.headline,
      description: data.description,
      imageHash: data.image_hash,
      cta: data.cta,
    });
  } else if (section === 'activate') await meta.activateCascade(cfg, campaignId);
  else if (section === 'pause') await meta.setStatus(cfg, data?.id || campaignId, 'PAUSED');
  else throw badRequest('section_invalid');
  await syncCampaigns(projectId).catch(() => {});
  cache.clear();
  return campaignTree(projectId, campaignId);
}

export async function socialPosts(projectId) {
  const cfg = projectConfig(projectId);
  const [facebook, instagram] = await Promise.all([meta.pagePosts(cfg).catch(() => []), meta.igMedia(cfg).catch(() => [])]);
  return { facebook, instagram };
}
