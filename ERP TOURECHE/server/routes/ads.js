import { Router } from 'express';
import { requireRole, requireSensitive } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { v } from '../lib/util.js';
import { projectScope } from '../services/projects.js';
import * as ads from '../services/ads.js';
import { runJob } from '../services/sync.js';
import { checkAdLink } from '../services/links.js';

export const adsRouter = Router();
const pid = (req) => projectScope(req, { allowAll: false }).id;
const days = (req) => Math.min(Math.max(Number(req.query.days) || 7, 1), 90);

adsRouter.get('/decisions', (req, res) => res.json(ads.decisions(pid(req), days(req))));
adsRouter.get('/tests', (req, res) => res.json(ads.productTests(pid(req), days(req))));
adsRouter.get('/campaigns', async (req, res) => res.json(await ads.campaignsOverview(pid(req), days(req))));
adsRouter.get('/health', async (req, res) => res.json(await ads.accountsHealth(pid(req))));
adsRouter.get('/posts', async (req, res) => res.json(await ads.socialPosts(pid(req), String(req.query.link || '') || undefined)));
adsRouter.get('/platform-history', (req, res) => res.json(ads.platformHistory(pid(req))));

// ——— مستكشف Business Manager ———
adsRouter.get('/businesses', async (req, res) => res.json(await ads.explorer(pid(req), { refresh: req.query.refresh === '1' })));

adsRouter.put('/businesses/selected', requireRole('admin', 'manager'), (req, res) => {
  ads.selectBusiness(pid(req), v.str(req.body.business_id, { max: 40 }));
  res.json({ ok: true });
});

adsRouter.get('/accounts/:accountId/campaigns', async (req, res) =>
  res.json(await ads.accountCampaigns(pid(req), req.params.accountId, { days: days(req), includeArchived: req.query.archived === '1' })),
);

adsRouter.get('/accounts/:accountId/assets', async (req, res) => res.json(await ads.accountAssets(pid(req), req.params.accountId)));

/** ربط حساب إعلاني بالمشروع لمتابعة إنفاقه في القرارات والمالية */
adsRouter.put('/accounts/:accountId/project', requireRole('admin', 'manager'), requireSensitive, (req, res) => {
  const count = ads.setProjectAccount(pid(req), req.params.accountId, Boolean(req.body.linked));
  audit(req, req.body.linked ? 'ad_account_linked' : 'ad_account_unlinked', { entity: 'ad_account', entityId: req.params.accountId, projectId: pid(req) });
  res.json({ ok: true, accounts: count });
});

/** إعداد Meta بنقرة من الإعدادات: الحسابات + البيكسل + الصفحة (ورمزها وإنستغرام يُجلبان تلقائياً) */
adsRouter.post('/meta-setup', requireRole('admin'), requireSensitive, async (req, res) => {
  const b = req.body || {};
  const out = await ads.applyMetaSetup(pid(req), {
    business_id: b.business_id ? v.str(b.business_id, { max: 40 }) : '',
    ad_account_ids: Array.isArray(b.ad_account_ids) ? b.ad_account_ids.slice(0, 20) : [],
    pixel_id: b.pixel_id ? v.str(b.pixel_id, { max: 40 }) : null,
    page_id: b.page_id ? v.str(b.page_id, { max: 40 }) : null,
  });
  audit(req, 'meta_setup_applied', { projectId: pid(req), details: { accounts: out.accounts.map((a) => a.id), pixel: out.pixel?.id || null, page: out.page?.id || null, page_token: Boolean(out.page?.token), instagram: out.instagram?.id || null } });
  res.json(out);
});

// ——— إطلاق حملة لأي منتج + المسودات + الإعدادات الدائمة ———
adsRouter.get('/launch/:productId', (req, res) => res.json(ads.launchContext(pid(req), Number(req.params.productId))));

// فحص رابط الإعلان قبل الإطلاق (الوجهة، التحويلات، البيكسل، نموذج الطلب، التوفر)
adsRouter.get('/link-check', requireRole('admin', 'manager'), async (req, res) => res.json(await checkAdLink(pid(req), req.query.url, { pixelId: req.query.pixel_id })));

adsRouter.put('/launch-defaults', requireRole('admin', 'manager'), (req, res) => res.json(ads.saveLaunchDefaults(pid(req), req.body || {})));

adsRouter.get('/drafts', (req, res) => res.json(ads.listDrafts(pid(req), req.query.product_id ? Number(req.query.product_id) : null)));

adsRouter.post('/drafts', requireRole('admin', 'manager'), (req, res) =>
  res.json(ads.saveDraft(pid(req), { id: req.body.id ? Number(req.body.id) : null, productId: req.body.product_id ? Number(req.body.product_id) : null, name: v.str(req.body.name, { max: 200 }), payload: req.body.payload || {} })),
);

adsRouter.delete('/drafts/:id', requireRole('admin', 'manager'), (req, res) => {
  ads.deleteDraft(pid(req), Number(req.params.id));
  res.json({ ok: true });
});

adsRouter.post('/sync', async (req, res) => {
  const id = pid(req);
  const campaigns = await runJob('ads_campaigns', id, 'حملات Meta', () => ads.syncCampaigns(id));
  const spend = await runJob('ads_spend', id, 'Meta Ads', () => ads.syncSpend(id, Number(req.body.days) || 7));
  res.json({ campaigns, spend, linked: ads.autoLink(id) });
});

adsRouter.get('/campaigns/:id', async (req, res) => res.json(await ads.campaignTree(pid(req), req.params.id)));

/** تعديل قسم واحد من الحملة ويُرسل مباشرة إلى Meta (الحملة/المجموعة/الإعلان/تفعيل/إيقاف) */
adsRouter.put('/campaigns/:id', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const section = v.oneOf(req.body.section, ['campaign', 'adset', 'ad', 'activate', 'pause'], { required: true, name: 'section' });
  const out = await ads.editCampaign(pid(req), req.params.id, { section, data: req.body.data || {} });
  audit(req, `campaign_${section}`, { entity: 'campaign', entityId: req.params.id, details: req.body.data || null });
  res.json(out);
});

adsRouter.post('/campaigns/:id/status', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const status = v.oneOf(req.body.status, ['ACTIVE', 'PAUSED'], { required: true, name: 'status' });
  if (status === 'ACTIVE') await ads.editCampaign(pid(req), req.params.id, { section: 'activate' });
  else await ads.setCampaignStatus(pid(req), req.params.id, 'PAUSED');
  audit(req, `campaign_${status.toLowerCase()}`, { entity: 'campaign', entityId: req.params.id });
  res.json({ ok: true });
});

adsRouter.post('/campaigns/:id/budget', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const budget = v.num(req.body.daily_budget, { required: true, min: 0.5, max: 100000, name: 'daily_budget' });
  const adsetId = v.str(req.body.adset_id, { max: 40 });
  await ads.setCampaignBudget(pid(req), req.params.id, budget, adsetId);
  audit(req, 'campaign_budget', { entity: adsetId ? 'adset' : 'campaign', entityId: adsetId || req.params.id, details: { daily_budget: budget, campaign_id: req.params.id } });
  res.json({ ok: true });
});

adsRouter.post('/campaigns/:id/link', requireRole('admin', 'manager'), (req, res) => {
  ads.linkCampaign(pid(req), req.params.id, v.int(req.body.product_id, { required: true, name: 'product_id' }));
  res.json({ ok: true });
});

adsRouter.delete('/campaigns/:id/link', requireRole('admin', 'manager'), (req, res) => {
  ads.unlinkCampaign(req.params.id);
  res.json({ ok: true });
});

adsRouter.post('/tests/:productId/stop', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const out = await ads.stopTest(pid(req), Number(req.params.productId), v.str(req.body.note, { max: 500 }));
  audit(req, 'test_stopped', { entity: 'product', entityId: req.params.productId, details: out });
  res.json(out);
});

/** إطلاق اختبار: الحملة تُنشأ متوقفة (لا يُصرف شيء)؛ التفعيل الفوري يتطلب كلمة المرور الحساسة */
adsRouter.post('/tests/:productId/launch', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const b = req.body || {};
  const out = await ads.launchTest(pid(req), Number(req.params.productId), {
    accountId: v.str(b.account_id, { max: 40 }),
    pageId: v.str(b.page_id, { max: 40 }),
    pixelId: v.str(b.pixel_id, { max: 40 }),
    igUserId: v.str(b.ig_user_id, { max: 40 }),
    countries: Array.isArray(b.countries) ? b.countries.filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 25) : undefined,
    draftId: b.draft_id ? Number(b.draft_id) : null,
    platforms: Array.isArray(b.platforms) ? b.platforms.filter((x) => ['facebook', 'instagram'].includes(x)) : [],
    ageMin: v.int(b.age_min, { min: 18, max: 65 }),
    ageMax: v.int(b.age_max, { min: 18, max: 65 }),
    genders: Array.isArray(b.genders) ? b.genders.filter((g) => [1, 2].includes(g)) : undefined,
    dailyBudget: v.num(b.daily_budget, { min: 0.5, max: 100000 }),
    dailyBudgetDa: v.num(b.daily_budget_da, { min: 100, max: 10000000 }),
    testBudgetDa: v.num(b.test_budget_da, { min: 0 }),
    imageUrl: v.str(b.image_url, { max: 2000 }),
    postId: v.str(b.post_id, { max: 80 }),
    igMediaId: v.str(b.ig_media_id, { max: 80 }),
    primaryText: v.str(b.primary_text, { max: 2200 }),
    headline: v.str(b.headline, { max: 120 }),
    description: v.str(b.description, { max: 120 }),
    cta: v.str(b.cta, { max: 40 }),
    link: v.str(b.link, { max: 1000 }),
    name: v.str(b.name, { max: 200 }),
    activate: Boolean(b.activate),
  });
  audit(req, 'test_launched', { entity: 'product', entityId: req.params.productId, details: out });
  res.json(out);
});
