import { request, IntegrationError } from '../lib/http.js';
import { num } from '../lib/util.js';

/**
 * Meta Marketing API + Pixel + Conversions API + نشر على الصفحة/إنستغرام.
 * الرمز: System User token من Business Manager بصلاحيات ads_management, ads_read, business_management,
 * pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish.
 */
const base = (cfg) => `https://graph.facebook.com/${cfg.meta_graph_version || 'v25.0'}`;
export const actId = (id) => `act_${String(id).replace(/^act_/, '')}`;

export const isConfigured = (cfg) => Boolean(cfg.meta_access_token && (cfg.meta_ad_account_ids || []).length);

export async function graph(cfg, path, { method = 'GET', params = {}, body, token } = {}) {
  const accessToken = token || cfg.meta_access_token;
  if (!accessToken) throw new IntegrationError('meta', 'config', 'meta_token_missing');
  const url = new URL(`${base(cfg)}/${path.replace(/^\//, '')}`);
  for (const [k, val] of Object.entries(params)) if (val !== undefined && val !== null) url.searchParams.set(k, typeof val === 'object' ? JSON.stringify(val) : String(val));
  let payload = body;
  if (method === 'GET') url.searchParams.set('access_token', accessToken);
  else {
    const form = new URLSearchParams();
    for (const [k, val] of Object.entries(body || {})) if (val !== undefined && val !== null) form.set(k, typeof val === 'object' ? JSON.stringify(val) : String(val));
    form.set('access_token', accessToken);
    payload = form.toString();
  }
  try {
    const { data } = await request('meta', url.toString(), {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: method === 'GET' ? undefined : payload,
      timeoutMs: 60000,
    });
    return data;
  } catch (e) {
    const err = e.details?.data?.error;
    if (err) {
      const kind = err.code === 190 || err.code === 102 ? 'auth' : err.code === 17 || err.code === 4 || err.code === 80004 ? 'rate_limit' : e.kind;
      // خطآن يقعان عند تغيير التطبيق أو مستخدم النظام، ورسالة Meta لهما بالإنجليزية لا تقول ما العمل: رمز يُترجم في الواجهة
      //  - 190: الرمز ميت (انتهى، أُلغي، أو حُذف التطبيق أو مستخدم النظام الذي أُنشئ به)
      //  - 1885183: التطبيق في وضع التطوير، فترفض Meta تصميم الإعلان حتى يُنشر (Live)
      //  - appsecret_proof: التطبيق يشترط «Require App Secret» والـ ERP لا يرسل البرهان
      const known = err.error_subcode === 1885183 ? 'meta_app_dev_mode' : err.code === 190 ? 'meta_token_invalid' : /appsecret_proof/i.test(err.message || '') ? 'meta_app_secret_required' : null;
      throw new IntegrationError('meta', kind, known || err.error_user_msg || err.message || e.message, { code: err.code, subcode: err.error_subcode });
    }
    throw e;
  }
}

async function paged(cfg, path, params, max = 20) {
  const out = [];
  let after;
  for (let i = 0; i < max; i++) {
    const d = await graph(cfg, path, { params: { ...params, after } });
    out.push(...(d?.data || []));
    after = d?.paging?.cursors?.after;
    if (!d?.paging?.next || !after) break;
  }
  return out;
}

export const accountInfo = (cfg, accountId) =>
  graph(cfg, actId(accountId), { params: { fields: 'id,name,currency,account_status,amount_spent,balance,spend_cap,timezone_name,disable_reason' } });

const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'ARCHIVED'];

/** includeArchived: Meta لا يُرجع الحملات المؤرشفة إلا إذا طُلبت صراحة */
export const campaigns = (cfg, accountId, { includeArchived = false } = {}) =>
  paged(cfg, `${actId(accountId)}/campaigns`, {
    fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,bid_strategy,created_time,start_time,stop_time,updated_time',
    limit: 100,
    ...(includeArchived ? { effective_status: CAMPAIGN_STATUSES } : {}),
  });

// ——— Business Manager: كل الحسابات الإعلانية التي يصل إليها الرمز، مجمعة حسب الـ BM ———
const ACCOUNT_FIELDS = 'id,account_id,name,currency,account_status,disable_reason,amount_spent,timezone_name';
const normAccount = (a) => ({
  id: String(a.account_id || a.id).replace(/^act_/, ''),
  name: a.name,
  currency: a.currency,
  status: a.account_status,
  disable_reason: a.disable_reason || 0,
  amount_spent: num(a.amount_spent) / 100,
  timezone: a.timezone_name,
});

export async function businessesWithAccounts(cfg) {
  const groups = new Map();
  const group = (id, name, extra = {}) => {
    const key = id || 'none';
    if (!groups.has(key)) groups.set(key, { id: id || null, name: name || null, ...extra, accounts: new Map() });
    return groups.get(key);
  };
  let bms = [];
  try {
    bms = await paged(cfg, 'me/businesses', { fields: 'id,name,verification_status', limit: 50 }, 5);
  } catch (e) {
    if (e.kind === 'auth' || e.kind === 'network') throw e; // رمز System User قد لا يملك me/businesses — نكمل بالحسابات المباشرة
  }
  for (const bm of bms) {
    const g = group(bm.id, bm.name, { verification_status: bm.verification_status || null });
    const [owned, client] = await Promise.all([
      paged(cfg, `${bm.id}/owned_ad_accounts`, { fields: ACCOUNT_FIELDS, limit: 100 }, 5).catch(() => []),
      paged(cfg, `${bm.id}/client_ad_accounts`, { fields: ACCOUNT_FIELDS, limit: 100 }, 5).catch(() => []),
    ]);
    for (const a of owned) g.accounts.set(normAccount(a).id, { ...normAccount(a), relation: 'owned' });
    for (const a of client) g.accounts.set(normAccount(a).id, { ...normAccount(a), relation: 'client' });
  }
  const direct = await paged(cfg, 'me/adaccounts', { fields: `${ACCOUNT_FIELDS},business{id,name}`, limit: 100 }, 5).catch((e) => {
    if (!bms.length) throw e;
    return [];
  });
  const seen = new Set([...groups.values()].flatMap((g) => [...g.accounts.keys()]));
  for (const a of direct) {
    const n = normAccount(a);
    if (seen.has(n.id)) continue;
    group(a.business?.id, a.business?.name).accounts.set(n.id, { ...n, relation: a.business ? 'owned' : 'personal' });
  }
  return [...groups.values()].map((g) => ({ ...g, accounts: [...g.accounts.values()].sort((x, y) => String(x.name).localeCompare(String(y.name))) }));
}

/** الصفحات والبيكسلات المتاحة لحساب إعلاني — لاختيارها عند إطلاق حملة من BM آخر */
export async function accountAssets(cfg, accountId) {
  const [pages, pixels] = await Promise.all([
    paged(cfg, `${actId(accountId)}/promote_pages`, { fields: 'id,name,picture{url}', limit: 50 }, 3).catch(() => []),
    paged(cfg, `${actId(accountId)}/adspixels`, { fields: 'id,name,last_fired_time', limit: 50 }, 3).catch(() => []),
  ]);
  return {
    pages: pages.map((p) => ({ id: p.id, name: p.name, picture: p.picture?.data?.url || null })),
    pixels: pixels.map((p) => ({ id: p.id, name: p.name, last_fired_time: p.last_fired_time || null })),
  };
}

/** رمز الصفحة وحساب إنستغرام المرتبط بها (يُرجعهما Meta إن كانت الصفحة مُسندة لمستخدم النظام) */
export async function pageLink(cfg, pageId) {
  const p = await graph(cfg, pageId, { params: { fields: 'id,name,access_token,instagram_business_account{id,username}' } });
  return { id: p.id, name: p.name, access_token: p.access_token || null, ig: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username || null } : null };
}

export const pixelBasic = (cfg, pixelId) => graph(cfg, pixelId, { params: { fields: 'id,name,last_fired_time' } });

export const adsets = (cfg, campaignId) =>
  paged(cfg, `${campaignId}/adsets`, { fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,targeting', limit: 100 });

const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
const LEAD_TYPES = ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'];
const pick = (arr, types) => {
  for (const t of types) {
    const hit = (arr || []).find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
};

/** إحصاءات الإنفاق والنتائج — level: account|campaign|adset|ad */
export async function insights(cfg, accountId, { level = 'campaign', since, until, datePreset, timeIncrement } = {}) {
  const params = {
    level,
    fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,ctr,cpm,cpc,frequency,actions,action_values,account_currency,date_start,date_stop',
    limit: 500,
  };
  if (since && until) params.time_range = { since, until };
  else params.date_preset = datePreset || 'last_7d';
  if (timeIncrement) params.time_increment = timeIncrement;
  const rows = await paged(cfg, `${actId(accountId)}/insights`, params, 30);
  return rows.map((r) => ({
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    adset_id: r.adset_id,
    adset_name: r.adset_name,
    ad_id: r.ad_id,
    ad_name: r.ad_name,
    date: r.date_start,
    spend: num(r.spend),
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks: num(r.inline_link_clicks || r.clicks),
    ctr: num(r.ctr),
    cpm: num(r.cpm),
    frequency: num(r.frequency),
    video_views: pick(r.actions, ['video_view']),
    link_clicks: num(r.inline_link_clicks),
    purchases: pick(r.actions, PURCHASE_TYPES),
    leads: pick(r.actions, LEAD_TYPES),
    purchase_value: pick(r.action_values, PURCHASE_TYPES),
    currency: r.account_currency,
  }));
}

export const setStatus = (cfg, objectId, status) => graph(cfg, objectId, { method: 'POST', body: { status } });

/** الميزانية بأصغر وحدة لعملة الحساب (سنت) */
export const setDailyBudget = (cfg, objectId, minorUnits) => graph(cfg, objectId, { method: 'POST', body: { daily_budget: Math.round(minorUnits) } });

export async function uploadImage(cfg, accountId, buffer) {
  const d = await graph(cfg, `${actId(accountId)}/adimages`, { method: 'POST', body: { bytes: buffer.toString('base64') } });
  const first = Object.values(d?.images || {})[0];
  if (!first?.hash) throw new IntegrationError('meta', 'invalid', 'image_upload_failed');
  return first.hash;
}

/**
 * إنشاء حملة كاملة متوقفة (PAUSED) للمراجعة قبل التشغيل:
 * حملة مبيعات CBO → مجموعة إعلانية (Advantage+ audience، الجزائر) → تصميم → إعلان.
 */
export async function createPausedCampaign(cfg, o) {
  const account = actId(o.accountId);
  const hasPixel = Boolean(o.pixelId);
  const campaign = await graph(cfg, `${account}/campaigns`, {
    method: 'POST',
    body: {
      name: o.name,
      objective: hasPixel ? 'OUTCOME_SALES' : 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      buying_type: 'AUCTION',
      special_ad_categories: [],
      daily_budget: Math.round(o.dailyBudgetMinor),
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    },
  });
  const targeting = {
    geo_locations: { countries: o.countries?.length ? o.countries : ['DZ'] },
    age_min: o.ageMin || 18,
    ...(o.ageMax ? { age_max: o.ageMax } : {}),
    ...(o.genders?.length ? { genders: o.genders } : {}),
    targeting_automation: { advantage_audience: 1 },
    ...(o.platforms?.length === 1
      ? o.platforms[0] === 'instagram'
        ? { publisher_platforms: ['instagram'], instagram_positions: ['stream', 'story', 'reels', 'explore'] }
        : { publisher_platforms: ['facebook'], facebook_positions: ['feed', 'story', 'facebook_reels', 'video_feeds', 'marketplace'] }
      : {}),
  };
  const adset = await graph(cfg, `${account}/adsets`, {
    method: 'POST',
    body: {
      name: `${o.name} · AdSet`,
      campaign_id: campaign.id,
      billing_event: 'IMPRESSIONS',
      optimization_goal: hasPixel ? 'OFFSITE_CONVERSIONS' : 'LANDING_PAGE_VIEWS',
      ...(hasPixel ? { promoted_object: { pixel_id: o.pixelId, custom_event_type: o.conversionEvent || 'PURCHASE' } } : {}),
      targeting,
      status: 'PAUSED',
    },
  });
  const creative = await createCreative(cfg, o.accountId, o);
  const ad = await graph(cfg, `${account}/ads`, {
    method: 'POST',
    body: { name: `${o.name} · Ad`, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED' },
  });
  return { campaign_id: campaign.id, adset_id: adset.id, creative_id: creative.id, ad_id: ad.id };
}

// ——— Pixel ———
export async function pixelInfo(cfg) {
  if (!cfg.meta_pixel_id) return null;
  const info = await graph(cfg, cfg.meta_pixel_id, { params: { fields: 'id,name,last_fired_time,is_unavailable,data_use_setting' } });
  let events = [];
  try {
    const since = Math.floor(Date.now() / 1000) - 86400;
    const stats = await graph(cfg, `${cfg.meta_pixel_id}/stats`, { params: { aggregation: 'event', start_time: since } });
    const totals = {};
    for (const bucket of stats?.data || []) for (const e of bucket.data || []) totals[e.value] = (totals[e.value] || 0) + num(e.count);
    events = Object.entries(totals)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    /* الإحصاءات تتطلب صلاحية إضافية — تُتجاهل */
  }
  return { ...info, events_24h: events };
}

/** صلاحيات الرمز التي يحتاجها الـ ERP: الأساسية لكل شيء، والإضافية لميزة بعينها */
export const TOKEN_SCOPES = {
  required: ['ads_read', 'ads_management', 'business_management', 'pages_show_list', 'pages_read_engagement'],
  optional: ['pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'catalog_management'],
};

/**
 * فحص الربط بعد إنشاء التطبيق والرمز: الرمز (صالح، لا ينتهي، صلاحياته)، الحسابات الإعلانية، البيكسل، الصفحة،
 * وتجربة Conversions API إن وُضع رمز «اختبار الأحداث». كل سطر يقول ما ينقص بالضبط.
 */
export async function connectionCheck(cfg, { capiTest } = {}) {
  const out = { app: null, token: null, scopes: null, accounts: [], pixel: null, page: null, capi: null };
  let info = null;
  try {
    info = (await graph(cfg, 'debug_token', { params: { input_token: cfg.meta_access_token } }))?.data || null;
  } catch {
    /* بعض الرموز لا ترى نفسها: نكتفي بالصلاحيات */
  }
  let granted = info?.scopes || null;
  if (!granted) {
    try {
      granted = ((await graph(cfg, 'me/permissions'))?.data || []).filter((p) => p.status === 'granted').map((p) => p.permission);
    } catch (e) {
      out.token = { valid: false, error: e.message };
      return out;
    }
  }
  out.app = info?.app_id ? { id: info.app_id, name: info.application || null } : null;
  // رمز المستخدم (type USER) ينتهي بعد نحو 60 يوماً، ورمز System User بمدة «Never» لا ينتهي: الواجهة تعرض التاريخ الفعلي
  out.token = {
    valid: info ? Boolean(info.is_valid) : true,
    expires_at: info?.expires_at ?? null,
    never_expires: info ? info.expires_at === 0 : null,
    data_access_expires_at: info?.data_access_expires_at ?? null,
    type: info?.type || null,
  };
  out.scopes = { granted, missing: TOKEN_SCOPES.required.filter((s) => !granted.includes(s)), optional_missing: TOKEN_SCOPES.optional.filter((s) => !granted.includes(s)) };
  for (const id of cfg.meta_ad_account_ids || []) {
    try {
      const a = await graph(cfg, actId(id), { params: { fields: 'id,name,account_status,currency' } });
      out.accounts.push({ id: String(id).replace(/^act_/, ''), name: a.name, status: a.account_status, ok: a.account_status === 1 });
    } catch (e) {
      out.accounts.push({ id: String(id).replace(/^act_/, ''), ok: false, error: e.message });
    }
  }
  if (cfg.meta_pixel_id) {
    try {
      const p = await pixelInfo(cfg);
      out.pixel = { id: p.id, name: p.name, last_fired_time: p.last_fired_time || null, events_24h: p.events_24h || [], ok: true };
    } catch (e) {
      out.pixel = { id: cfg.meta_pixel_id, ok: false, error: e.message };
    }
  }
  if (cfg.meta_page_id) {
    try {
      const pg = await graph(cfg, cfg.meta_page_id, { params: { fields: 'id,name' } });
      out.page = { id: pg.id, name: pg.name, ok: true, token: Boolean(cfg.meta_page_token) };
    } catch (e) {
      out.page = { id: cfg.meta_page_id, ok: false, error: e.message };
    }
  }
  if (capiTest) {
    try {
      const r = await capiTest();
      out.capi = { ok: r?.events_received === 1, events_received: r?.events_received ?? 0, fbtrace_id: r?.fbtrace_id || null };
    } catch (e) {
      out.capi = { ok: false, error: e.message };
    }
  }
  return out;
}

/**
 * إرسال أحداث إلى Conversions API (بيكسل المشروع). testCode: رمز «اختبار الأحداث» من Events Manager —
 * الحدث يظهر هناك فقط ولا يُستعمل في الإعلانات. يُرجع { events_received, messages, fbtrace_id }.
 */
export function sendEvents(cfg, events, { testCode } = {}) {
  if (!cfg.meta_pixel_id) throw new IntegrationError('meta', 'config', 'pixel_missing');
  return graph(cfg, `${cfg.meta_pixel_id}/events`, { method: 'POST', body: { data: events, ...(testCode ? { test_event_code: testCode } : {}) } });
}

// ——— النشر على الصفحة وإنستغرام ———
export async function postToPage(cfg, { imageUrl, message }) {
  if (!cfg.meta_page_id || !cfg.meta_page_token) throw new IntegrationError('meta', 'config', 'page_not_configured');
  const d = await graph(cfg, `${cfg.meta_page_id}/photos`, { method: 'POST', token: cfg.meta_page_token, body: { url: imageUrl, caption: message } });
  return { id: d.post_id || d.id, url: d.post_id ? `https://www.facebook.com/${d.post_id}` : null };
}

export async function postToInstagram(cfg, { imageUrl, caption }) {
  if (!cfg.meta_ig_user_id || !cfg.meta_page_token) throw new IntegrationError('meta', 'config', 'instagram_not_configured');
  const media = await graph(cfg, `${cfg.meta_ig_user_id}/media`, { method: 'POST', token: cfg.meta_page_token, body: { image_url: imageUrl, caption } });
  const pub = await graph(cfg, `${cfg.meta_ig_user_id}/media_publish`, { method: 'POST', token: cfg.meta_page_token, body: { creation_id: media.id } });
  let url = null;
  try {
    url = (await graph(cfg, pub.id, { token: cfg.meta_page_token, params: { fields: 'permalink' } })).permalink;
  } catch {
    /* اختياري */
  }
  return { id: pub.id, url };
}

/** إعلانات الحساب مع حالة المراجعة ورابط الوجهة — لاكتشاف الإعلانات المرفوضة والروابط القديمة */
export const adsWithStatus = (cfg, accountId) =>
  paged(cfg, `${actId(accountId)}/ads`, {
    fields: 'id,name,campaign_id,adset_id,status,effective_status,ad_review_feedback,issues_info,creative{object_story_spec,asset_feed_spec,link_url,thumbnail_url,image_url}',
    limit: 200,
  });

export const adsetsOfAccount = (cfg, accountId) =>
  paged(cfg, `${actId(accountId)}/adsets`, { fields: 'id,campaign_id,status,effective_status,daily_budget,lifetime_budget,learning_stage_info', limit: 200 });

/** صحة الحساب الإعلاني وأفضل الممارسات (مثل لوحة «أمان الحساب» في النسخة السابقة) */
export async function accountHealth(cfg, accountId) {
  const info = await graph(cfg, actId(accountId), {
    params: { fields: 'id,name,currency,account_status,disable_reason,amount_spent,spend_cap,balance,timezone_name,funding_source_details,business{id,name,verification_status}' },
  });
  let tokenInfo = null;
  try {
    tokenInfo = (await graph(cfg, 'debug_token', { params: { input_token: cfg.meta_access_token } }))?.data || null;
  } catch {
    /* يتطلب صلاحية تطبيق — يُترك غير معروف */
  }
  let pixel = null;
  try {
    pixel = await pixelInfo(cfg);
  } catch {
    /* اختياري */
  }
  const spent = num(info.amount_spent) / 100;
  const cap = num(info.spend_cap) / 100;
  const pixelFresh = pixel?.last_fired_time ? Date.now() - Date.parse(pixel.last_fired_time) < 48 * 3600e3 : null;
  const checks = [
    { key: 'account_active', ok: info.account_status === 1, value: info.account_status },
    { key: 'payment_method', ok: Boolean(info.funding_source_details), value: info.funding_source_details?.display_string || null },
    { key: 'token_never_expires', ok: tokenInfo ? tokenInfo.expires_at === 0 : null, value: tokenInfo?.expires_at > 0 ? new Date(tokenInfo.expires_at * 1000).toISOString().slice(0, 10) : null },
    { key: 'token_valid', ok: tokenInfo ? Boolean(tokenInfo.is_valid) : null },
    { key: 'pixel_set', ok: Boolean(cfg.meta_pixel_id) },
    { key: 'pixel_events_48h', ok: pixelFresh, value: pixel?.last_fired_time || null },
    { key: 'page_set', ok: Boolean(cfg.meta_page_id) },
    { key: 'spend_cap_ok', ok: !cap || spent / cap < 0.9, value: cap ? Math.round((spent / cap) * 100) : null },
    { key: 'business_verified', ok: info.business ? info.business.verification_status === 'verified' : null, value: info.business?.verification_status || null },
  ];
  return { info: { ...info, amount_spent: spent, spend_cap: cap || null, balance: num(info.balance) / 100 }, pixel, checks };
}

/**
 * تصميم إعلان: إما منشور إعلاني جديد (صورة + نص + رابط + زر)، أو منشور موجود:
 *  - postId (منشور صفحة فيسبوك): يُستعمل كما هو مع إعجاباته وتعليقاته
 *  - igMediaId (منشور إنستغرام): يُستعمل كما هو + زر «تسوّق الآن» برابط المنتج
 */
export async function createCreative(cfg, accountId, o) {
  let body;
  if (o.igMediaId) {
    body = {
      name: `${o.name} · IG post`,
      object_id: o.pageId,
      instagram_user_id: o.igUserId,
      source_instagram_media_id: o.igMediaId,
      call_to_action: { type: o.cta || 'SHOP_NOW', value: { link: o.link } },
    };
  } else if (o.postId) {
    body = { name: `${o.name} · Page post`, object_story_id: o.postId.includes('_') ? o.postId : `${o.pageId}_${o.postId}` };
  } else {
    body = {
      name: `${o.name} · Creative`,
      object_story_spec: {
        page_id: o.pageId,
        ...(o.igUserId ? { instagram_user_id: o.igUserId } : {}),
        link_data: {
          link: o.link,
          message: o.message,
          name: o.headline,
          description: o.description || undefined,
          image_hash: o.imageHash,
          call_to_action: { type: o.cta || 'SHOP_NOW', value: { link: o.link } },
        },
      },
    };
  }
  // معاملات التتبّع في «معاملات URL» لا داخل الرابط: الرابط يبقى الصفحة الأساسية (canonical) التي تقيسها Meta
  if (o.urlTags) body.url_tags = o.urlTags;
  return graph(cfg, `${actId(accountId)}/adcreatives`, { method: 'POST', body });
}

/** الحملة كاملة للتعديل: الحملة + المجموعات + الإعلانات مع نص التصميم */
export async function campaignTree(cfg, campaignId) {
  const campaign = await graph(cfg, campaignId, { params: { fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,objective,account_id' } });
  const adsetsList = await paged(cfg, `${campaignId}/adsets`, { fields: 'id,name,status,effective_status,end_time,targeting,daily_budget,learning_stage_info', limit: 50 });
  const ads = await paged(cfg, `${campaignId}/ads`, {
    fields: 'id,name,adset_id,status,effective_status,ad_review_feedback,creative{id,name,object_story_spec,object_story_id,source_instagram_media_id,thumbnail_url,image_url}',
    limit: 50,
  });
  return {
    campaign: { ...campaign, daily_budget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null },
    adsets: adsetsList.map((a) => {
      const t = a.targeting || {};
      const pp = t.publisher_platforms || [];
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        effective_status: a.effective_status,
        end_time: a.end_time || null,
        age_min: t.age_min || null,
        age_max: t.age_max || null,
        genders: t.genders || [],
        countries: t.geo_locations?.countries || [],
        platform: pp.length === 1 ? pp[0] : 'both',
        daily_budget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
        learning: a.learning_stage_info ? { status: a.learning_stage_info.status, conversions: a.learning_stage_info.conversions ?? null, last_sig_edit_ts: a.learning_stage_info.last_sig_edit_ts ?? null } : null,
        advantage_audience: t.targeting_automation?.advantage_audience ?? null,
      };
    }),
    ads: ads.map((a) => {
      const ld = a.creative?.object_story_spec?.link_data || {};
      return {
        id: a.id,
        name: a.name,
        adset_id: a.adset_id,
        status: a.status,
        effective_status: a.effective_status,
        review: a.ad_review_feedback || null,
        creative_id: a.creative?.id,
        kind: a.creative?.source_instagram_media_id ? 'ig_post' : a.creative?.object_story_id && !a.creative?.object_story_spec ? 'page_post' : 'link_ad',
        thumbnail: a.creative?.thumbnail_url || a.creative?.image_url || null,
        message: ld.message || '',
        headline: ld.name || '',
        description: ld.description || '',
        link: ld.link || ld.call_to_action?.value?.link || '',
        cta: ld.call_to_action?.type || 'SHOP_NOW',
        image_hash: ld.image_hash || null,
        page_id: a.creative?.object_story_spec?.page_id || (a.creative?.object_story_id ? String(a.creative.object_story_id).split('_')[0] : null),
        ig_user_id: a.creative?.object_story_spec?.instagram_user_id || null,
      };
    }),
  };
}

export const updateCampaign = (cfg, id, { name, dailyBudget }) =>
  graph(cfg, id, { method: 'POST', body: { ...(name ? { name } : {}), ...(dailyBudget ? { daily_budget: Math.round(dailyBudget * 100) } : {}) } });

export async function updateAdset(cfg, id, { name, endTime, ageMin, ageMax, genders, platform, countries, dailyBudget }) {
  const current = await graph(cfg, id, { params: { fields: 'targeting' } });
  const t = { ...(current.targeting || {}) };
  if (ageMin) t.age_min = ageMin;
  if (ageMax) t.age_max = ageMax;
  if (genders) t.genders = genders;
  if (countries?.length) t.geo_locations = { countries };
  delete t.publisher_platforms;
  delete t.facebook_positions;
  delete t.instagram_positions;
  if (platform === 'facebook') Object.assign(t, { publisher_platforms: ['facebook'], facebook_positions: ['feed', 'story', 'facebook_reels', 'video_feeds', 'marketplace'] });
  if (platform === 'instagram') Object.assign(t, { publisher_platforms: ['instagram'], instagram_positions: ['stream', 'story', 'reels', 'explore'] });
  return graph(cfg, id, { method: 'POST', body: { ...(name ? { name } : {}), ...(dailyBudget ? { daily_budget: Math.round(dailyBudget * 100) } : {}), end_time: endTime || 0, targeting: t } });
}

/** تغيير نص/رابط الإعلان = تصميم جديد يُراجعه Meta ثم يُربط بالإعلان */
export async function updateAdCreative(cfg, accountId, adId, o) {
  const creative = await createCreative(cfg, accountId, o);
  await graph(cfg, adId, { method: 'POST', body: { creative: { creative_id: creative.id }, ...(o.adName ? { name: o.adName } : {}) } });
  return creative.id;
}

/** تفعيل الحملة مع مجموعاتها وإعلاناتها المتوقفة معاً */
export async function activateCascade(cfg, campaignId) {
  const tree = await campaignTree(cfg, campaignId);
  for (const ad of tree.ads) if (ad.status === 'PAUSED') await setStatus(cfg, ad.id, 'ACTIVE');
  for (const as of tree.adsets) if (as.status === 'PAUSED') await setStatus(cfg, as.id, 'ACTIVE');
  await setStatus(cfg, campaignId, 'ACTIVE');
}

/** منشورات الصفحة وإنستغرام لاستعمالها كإعلانات (مع الإعجابات والتعليقات) */
export async function pagePosts(cfg, limit = 24) {
  if (!cfg.meta_page_id || !cfg.meta_page_token) return [];
  const d = await graph(cfg, `${cfg.meta_page_id}/posts`, {
    token: cfg.meta_page_token,
    params: { fields: 'id,message,full_picture,created_time,permalink_url,likes.summary(true).limit(0),comments.summary(true).limit(0)', limit },
  });
  return (d?.data || []).map((p) => ({ id: p.id, text: p.message || '', image: p.full_picture, at: p.created_time, url: p.permalink_url, likes: p.likes?.summary?.total_count || 0, comments: p.comments?.summary?.total_count || 0 }));
}

export async function igMedia(cfg, limit = 24) {
  if (!cfg.meta_ig_user_id || !cfg.meta_page_token) return [];
  const d = await graph(cfg, `${cfg.meta_ig_user_id}/media`, {
    token: cfg.meta_page_token,
    params: { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count', limit },
  });
  return (d?.data || []).map((m) => ({ id: m.id, text: m.caption || '', image: m.thumbnail_url || m.media_url, at: m.timestamp, url: m.permalink, likes: m.like_count || 0, comments: m.comments_count || 0, type: m.media_type }));
}
