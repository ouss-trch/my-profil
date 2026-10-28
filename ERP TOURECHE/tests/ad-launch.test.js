import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import { AD_URL_TAGS, launchTest, socialPosts } from '../server/services/ads.js';

const p = createProject({ name: 'Launch shop', domain: 'launch.example' });
for (const [k, v] of [
  ['meta_access_token', 'EAAtest'],
  ['meta_page_token', 'EAApage'],
  ['meta_page_id', '777'],
  ['meta_pixel_id', '2111277745999858'],
  ['meta_ad_account_ids', ['1021341893008834']],
  ['store_domain', 'launch.example'],
])
  setSetting(k, v, p.id);
const product = createProduct(p.id, { title: 'Thermos Mickey', handle: 'thermos' });
const LINK = 'https://launch.example/products/thermos';

// منشورات الصفحة كما يعرضها فيسبوك
const POSTS = {
  '777_100': { id: '777_100', message: 'خايف تطلب أونلاين؟', full_picture: 'https://scontent.example/p100.jpg', attachments: { data: [{ media_type: 'photo', url: 'https://www.facebook.com/photo/?fbid=1' }] } },
  '777_101': { id: '777_101', message: 'ترمس ميكي', full_picture: 'https://scontent.example/p101.jpg', attachments: { data: [{ media_type: 'link', url: 'https://l.facebook.com/l.php?u=x', unshimmed_url: `${LINK}?utm_source=page` }] } },
  '777_102': { id: '777_102', message: 'فيديو', full_picture: 'https://scontent.example/p102.jpg', attachments: { data: [{ media_type: 'video', url: 'https://www.facebook.com/watch/?v=2' }] } },
};

const calls = [];
let rejectAds = false;
let seq = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (u.hostname === 'launch.example') return new Response(`<html><head><link rel="canonical" href="${LINK}"><script>fbq('init', '2111277745999858')</script></head><body><form data-lead-form></form></body></html>`, { status: 200 });
  if (u.hostname === 'scontent.example') return new Response(Buffer.from('fake-image'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  assert.equal(u.hostname, 'graph.facebook.com');
  const path = u.pathname.replace(/^\/v[\d.]+\//, '');
  const body = Object.fromEntries(new URLSearchParams(init.body || ''));
  const method = init.method || 'GET';
  calls.push({ method, path, body });
  if (method === 'GET' && path === 'act_1021341893008834') return json({ id: 'act_1021341893008834', name: 'ADCompte 3', currency: 'EUR', account_status: 1 });
  if (method === 'GET' && POSTS[path]) return json(POSTS[path]);
  if (method === 'GET' && path === '777/posts') return json({ data: Object.values(POSTS) });
  if (method === 'GET') return json({ data: [] });
  if (path.endsWith('/adimages')) return json({ images: { 'f.jpg': { hash: 'HASH1' } } });
  if (path.endsWith('/ads') && rejectAds) return json({ error: { message: 'Invalid parameter', type: 'OAuthException', code: 100, error_user_msg: 'L’objectif de votre campagne doit contenir une URL de site web externe.' } }, 400);
  if (/\/(campaigns|adsets|adcreatives|ads)$/.test(path)) return json({ id: `${path.split('/').pop()}_${++seq}` });
  return json({ success: true });
};

const launch = (extra) => launchTest(p.id, product.id, { accountId: '1021341893008834', pageId: '777', link: LINK, dailyBudget: 5, cta: 'SHOP_NOW', pixelId: '2111277745999858', platforms: ['facebook', 'instagram'], ...extra });
const creativeOf = () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/adcreatives')).at(-1).body;

test('launch: a plain page post (image and text, no product link) becomes a link ad with the button and the product link', async () => {
  calls.length = 0;
  const r = await launch({ postId: '777_100' });
  assert.equal(r.rebuilt_from_post, true);
  const body = creativeOf();
  assert.equal(body.object_story_id, undefined, 'Meta refuses a website campaign whose ad has no website URL');
  const link = JSON.parse(body.object_story_spec).link_data;
  assert.deepEqual([link.message, link.name, link.link, link.image_hash], ['خايف تطلب أونلاين؟', 'Thermos Mickey', LINK, 'HASH1']);
  assert.deepEqual(link.call_to_action, { type: 'SHOP_NOW', value: { link: LINK } });
  assert.equal(body.url_tags, AD_URL_TAGS);
  // الصورة نُزّلت من المنشور ورُفعت إلى الحساب قبل إنشاء الحملة
  const order = calls.filter((c) => c.method === 'POST').map((c) => c.path.split('/').pop());
  assert.deepEqual(order.slice(0, 5), ['adimages', 'campaigns', 'adsets', 'adcreatives', 'ads']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM campaign_products WHERE project_id = ?').get(p.id).n, 1);
});

test('launch: a post that already links to the store is used as it is, with its reactions', async () => {
  calls.length = 0;
  const r = await launch({ postId: '777_101' });
  assert.equal(r.rebuilt_from_post, false);
  const body = creativeOf();
  assert.equal(body.object_story_id, '777_101');
  assert.equal(body.object_story_spec, undefined);
  assert.equal(calls.some((c) => c.path.endsWith('/adimages')), false);
});

test('launch: a video post without the product link stops before anything is created at Meta', async () => {
  calls.length = 0;
  await assert.rejects(launch({ postId: '777_102' }), (e) => e.code === 'ad_post_video_no_link');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('launch: when Meta refuses the ad, the half-made campaign and ad set are deleted and nothing is recorded', async () => {
  calls.length = 0;
  rejectAds = true;
  const before = db.prepare('SELECT COUNT(*) AS n FROM campaign_products WHERE project_id = ?').get(p.id).n;
  await assert.rejects(launch({ postId: '777_100' }), (e) => /objectif de votre campagne/.test(e.message));
  rejectAds = false;
  const made = calls.filter((c) => c.method === 'POST' && /\/(campaigns|adsets)$/.test(c.path)).length;
  const deleted = calls.filter((c) => c.method === 'POST' && c.body.status === 'DELETED').map((c) => c.path);
  assert.equal(made, 2);
  // الحملة فالمجموعة فالتصميم أُنشئت بالترتيب (معرّفات متتالية)، ثم رُفض الإعلان
  assert.deepEqual(deleted.sort(), ['adsets_' + (seq - 1), 'campaigns_' + (seq - 2)].sort());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM campaign_products WHERE project_id = ?').get(p.id).n, before, 'the ERP did not link a campaign that no longer exists');
});

test('launch: the post picker says which posts carry the store link', async () => {
  calls.length = 0;
  const posts = await socialPosts(p.id);
  assert.deepEqual(posts.facebook.map((x) => [x.id, x.kind, x.store_link]), [['777_100', 'photo', false], ['777_101', 'link', true], ['777_102', 'video', false]]);
  assert.equal('links' in posts.facebook[0], false, 'the browser does not need the raw links');
});

test('button: the type comes from Meta’s list (no free text), is checked before anything is created, and “no button” sends none', async () => {
  const image = { imageUrl: 'https://scontent.example/p100.jpg', primaryText: 'نص', headline: 'اطلب الآن والدفع عند الاستلام' };
  // نص حر ليس نوعاً عند Meta: يُرفض قبل أي طلب إلى Meta
  calls.length = 0;
  await assert.rejects(launch({ ...image, cta: 'اطلب الآن' }), (e) => e.code === 'cta_invalid');
  assert.equal(calls.length, 0);
  // نوع صالح من قائمة Meta خارج القائمة المختصرة: يمرّ كما هو
  calls.length = 0;
  await launch({ ...image, cta: 'VIEW_PRODUCT' });
  const spec = JSON.parse(creativeOf().object_story_spec).link_data;
  assert.deepEqual(spec.call_to_action, { type: 'VIEW_PRODUCT', value: { link: LINK } });
  // العبارة الحرة هي «العنوان»: تصل إلى Meta كما كُتبت
  assert.equal(spec.name, 'اطلب الآن والدفع عند الاستلام');
  // بلا زر: لا call_to_action في التصميم
  calls.length = 0;
  await launch({ ...image, cta: 'NO_BUTTON' });
  assert.equal(JSON.parse(creativeOf().object_story_spec).link_data.call_to_action, undefined);
});

test('button: an ad that is already live can change its button, and an invalid type is refused before Meta is called', async () => {
  const { editCampaign } = await import('../server/services/ads.js');
  calls.length = 0;
  await assert.rejects(editCampaign(p.id, '1', { section: 'ad', data: { id: '2', cta: 'MY_OWN_TEXT' } }), (e) => e.code === 'cta_invalid');
  assert.equal(calls.length, 0);
});
