import { db } from '../db/index.js';
import { dzDayStartIso, addDays, round } from '../lib/util.js';
import { SHIPPING_ACTIVE, CONFIRM_PENDING } from '../lib/statuses.js';
import * as n8n from '../integrations/n8n.js';
import { adSpendDa, today as todayStats } from './analytics.js';
import { listProjects } from './projects.js';
import { weekHub, decisions } from './ads.js';
import { buildSnapshot } from './sync.js';

const DECISION_TEXT = {
  stop_test: (d) => `أوقف اختبار «${d.title}»: تكلفة المسلّمة ${d.params?.cpd ?? '—'} دج تتجاوز حد التعادل ${d.params?.be ?? '—'} دج`,
  scale_budget: (d) => `«${d.title}» رابح (تكلفة المسلّمة ${d.params?.cpd} دج) — زِد الميزانية 20%`,
  thin_margin: (d) => `هامش «${d.title}» ضيق — راجع الخطّاف والصفحة`,
  ad_rejected: (d) => `إعلان مرفوض في حملة «${d.title}»`,
  wrong_link: (d) => `رابط حملة «${d.title}» لا يقود لمتجرك`,
  no_campaign: (d) => `«${d.title}» في الاختبار بلا حملة — أطلقها`,
  campaign_not_running: (d) => `حملة «${d.title}» جاهزة لكنها متوقفة`,
  weak_page: (d) => `صفحة «${d.title}» ضعيفة (${d.params?.score}/100) — حسّنها`,
  budget_spent_no_verdict: (d) => `ميزانية اختبار «${d.title}» انتهت بلا حكم`,
  fx_not_set: () => 'اضبط سعر الدولار/اليورو بالدينار في الإعدادات',
};

function businessFor(projectId, day) {
  const p = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
  const start = dzDayStartIso(day);
  const end = dzDayStartIso(addDays(day, 1));
  const c = (col, extra = '') => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS v FROM orders WHERE project_id = ? AND ${col} >= ? AND ${col} < ? ${extra}`).get(projectId, start, end);
  const t = todayStats([projectId]);
  const delivered = c('delivered_at', "AND status = 'delivered'");
  return {
    name: p?.name,
    orders: c('created_at', "AND status != 'abandoned'").n,
    confirmed: c('confirmed_at').n,
    shipped: c('shipped_at').n,
    delivered: delivered.n,
    delivered_value: round(delivered.v),
    returned: c('returned_at', "AND status = 'returned'").n,
    pending_confirmation: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE project_id = ? AND status IN (${CONFIRM_PENDING.map(() => '?').join(',')})`).get(projectId, ...CONFIRM_PENDING).n,
    in_transit: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE project_id = ? AND status IN (${SHIPPING_ACTIVE.map(() => '?').join(',')})`).get(projectId, ...SHIPPING_ACTIVE).n,
    confirmation_rate_14d: t.confirmation_rate_14d,
    delivery_rate_30d: t.delivery_rate_30d,
  };
}

function adsFor(projectIds, day) {
  const rows = db.prepare(`SELECT currency, SUM(spend) AS s, SUM(purchases) AS p FROM ad_spend WHERE project_id IN (${projectIds.map(() => '?').join(',')}) AND date = ? GROUP BY currency`).all(...projectIds, day);
  if (!rows.length) return { spend: 0, currency: '', spend_da: 0, purchases: 0, cpa: null };
  const main = rows.sort((a, b) => b.s - a.s)[0];
  const purchases = rows.reduce((s, r) => s + r.p, 0);
  return {
    spend: round(main.s, 2),
    currency: main.currency,
    spend_da: adSpendDa(projectIds, day, day).spend_da,
    purchases,
    cpa: purchases ? round(main.s / purchases, 2) : null,
  };
}

function hubFor(projectIds) {
  const all = [];
  const week = { spend_da: 0, orders: 0, delivered: 0, profit_da: 0 };
  for (const id of projectIds) {
    try {
      const h = weekHub(id);
      all.push(...h.decisions);
      for (const k of Object.keys(week)) week[k] += h.week[k] || 0;
    } catch {
      /* مشروع بلا إعلانات */
    }
  }
  week.cpd_da = week.delivered ? round(week.spend_da / week.delivered) : null;
  const texts = all.map((d) => (DECISION_TEXT[d.kind] ? DECISION_TEXT[d.kind](d) : d.kind));
  return { decisions: texts.slice(0, 5), more: Math.max(0, texts.length - 5), week };
}

export async function makeSnapshot() {
  const ids = listProjects().map((p) => p.id);
  return buildSnapshot(ids, { businessesFor: businessFor, adsFor, hubFor });
}

export async function sendSnapshot() {
  const data = await makeSnapshot();
  return n8n.send('report', 'report.snapshot', data, null);
}

export { decisions };
