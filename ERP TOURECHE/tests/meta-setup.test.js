import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../server/services/projects.js';
import { getSetting, setSetting } from '../server/lib/settings.js';
import * as ads from '../server/services/ads.js';

// Meta وهمي بالمعرّفات الحقيقية لـ SOU9NA (BM 1 · ADCompte 3 · بيكسل SOU9NA · صفحة Sou9na · @sou9nna_)
const seen = [];
let pageToken = 'EAAPAGE_TOKEN';
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  seen.push(u.pathname + '?' + u.searchParams.get('fields'));
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const path = u.pathname.replace(/^\/v[\d.]+\//, '');
  if (path === 'act_1021341893008834') return json({ id: 'act_1021341893008834', account_id: '1021341893008834', name: 'ADCompte 3', currency: 'EUR', account_status: 1 });
  if (path === 'act_99999999') return json({ error: { message: 'Unsupported get request', code: 100 } }, 400);
  if (path === '2111277745999858') return json({ id: '2111277745999858', name: 'SOU9NA', last_fired_time: '2026-10-26T04:40:52+0000' });
  if (path === '1371887736004379')
    return json({ id: '1371887736004379', name: 'Sou9na', ...(pageToken ? { access_token: pageToken } : {}), instagram_business_account: { id: '17841415167681254', username: 'sou9nna_' } });
  return json({ error: { message: `unexpected ${path}`, code: 100 } }, 400);
};

test('meta setup: one click saves accounts, pixel, page, and fetches the page token and Instagram', async () => {
  const p = createProject({ name: 'SOU9NA meta', domain: 'souqnna.example' });
  await assert.rejects(ads.applyMetaSetup(p.id, { ad_account_ids: ['1021341893008834'] }), /meta_token_missing/);
  setSetting('meta_access_token', 'EAASYSTEMUSER', p.id);
  await assert.rejects(ads.applyMetaSetup(p.id, { ad_account_ids: ['abc'] }), /meta_account_required/);

  const out = await ads.applyMetaSetup(p.id, { business_id: '142572800037749', ad_account_ids: ['act_1021341893008834', '1021341893008834'], pixel_id: '2111277745999858', page_id: '1371887736004379' });
  assert.deepEqual(out.accounts, [{ id: '1021341893008834', name: 'ADCompte 3', currency: 'EUR' }]);
  assert.equal(out.pixel.name, 'SOU9NA');
  assert.deepEqual(out.page, { id: '1371887736004379', name: 'Sou9na', token: true });
  assert.deepEqual(out.instagram, { id: '17841415167681254', username: 'sou9nna_' });
  assert.equal(getSetting('meta_business_id', p.id), '142572800037749');
  assert.deepEqual(getSetting('meta_ad_account_ids', p.id), ['1021341893008834']);
  assert.equal(getSetting('meta_pixel_id', p.id), '2111277745999858');
  assert.equal(getSetting('meta_page_id', p.id), '1371887736004379');
  assert.equal(getSetting('meta_page_token', p.id), 'EAAPAGE_TOKEN');
  assert.equal(getSetting('meta_ig_user_id', p.id), '17841415167681254');
  // الرمز لا يُطلب إلا من الصفحة المختارة، ولا يُرجع إلى الواجهة
  assert.ok(seen.some((s) => s.startsWith('/v25.0/1371887736004379?') && s.includes('access_token')));
  assert.equal(JSON.stringify(out).includes('EAAPAGE_TOKEN'), false);

  // صفحة غير مُسندة لمستخدم النظام: يُحفظ الباقي، ويبقى رمز الصفحة القديم
  pageToken = null;
  const again = await ads.applyMetaSetup(p.id, { ad_account_ids: ['1021341893008834'], page_id: '1371887736004379' });
  assert.equal(again.page.token, false);
  assert.equal(getSetting('meta_page_token', p.id), 'EAAPAGE_TOKEN');

  // حساب لا يراه الرمز: لا يُحفظ شيء
  await assert.rejects(ads.applyMetaSetup(p.id, { ad_account_ids: ['99999999'] }), /Unsupported get request/);
  assert.deepEqual(getSetting('meta_ad_account_ids', p.id), ['1021341893008834']);
});
