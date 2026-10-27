import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../server/config.js';
import { createProject } from '../server/services/projects.js';
import { setSetting } from '../server/lib/settings.js';
import * as splits from '../server/services/splits.js';

// Shopify وهمي: الصلاحيات الممنوحة قابلة للتغيير، و refuseWrite = رفض من Shopify نفسها رغم write_themes
let granted = [];
let refuseWrite = false;
const upserts = [];
const denied = () => ({ errors: [{ message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }] });
globalThis.fetch = async (_url, init) => {
  const { query, variables } = JSON.parse(init.body);
  const can = (s) => granted.includes(s) || (s.startsWith('read_') && granted.includes(`write_${s.slice(5)}`));
  let body;
  if (query.includes('currentAppInstallation')) body = { data: { currentAppInstallation: { accessScopes: granted.map((handle) => ({ handle })) } } };
  else if (query.includes('themes(first: 1')) body = can('read_themes') ? { data: { themes: { nodes: [{ id: 'gid://shopify/OnlineStoreTheme/1', name: 'Dawn' }] } } } : denied();
  else if (query.includes('theme(id:'))
    body = can('read_themes')
      ? { data: { theme: { files: { nodes: variables.f.map((filename) => ({ filename, body: { content: filename.startsWith('layout/') ? '<!doctype html><html><head>\n<title>x</title></head></html>' : '' } })).filter((n) => n.filename.startsWith('layout/') || upserts.length) } } } }
      : denied();
  else if (query.includes('themeFilesUpsert')) {
    if (!can('write_themes') || refuseWrite) body = denied();
    else {
      upserts.push(...variables.files);
      body = { data: { themeFilesUpsert: { upsertedThemeFiles: variables.files.map((f) => ({ filename: f.filename })), userErrors: [] } } };
    }
  } else if (query.includes('shop { id }')) body = { data: { shop: { id: 'gid://shopify/Shop/1' } } };
  else if (query.includes('metafieldsSet')) body = { data: { metafieldsSet: { metafields: [{ id: 'gid://shopify/Metafield/1' }], userErrors: [] } } };
  else throw new Error(`unexpected query ${query.slice(0, 60)}`);
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

test('split theme: names the missing Shopify permission, tells a Shopify refusal apart, then installs', async () => {
  config.backupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-bak-'));
  const p = createProject({ name: 'Theme scopes', domain: 'souqnna.example' });
  setSetting('shopify_shop', 'sou9na-test.myshopify.com', p.id);
  setSetting('shopify_access_token', 'shpat_test', p.id);

  // التطبيق دون أذونات القالب: الحالة تسمّي الإذن الناقص، والتثبيت يقول نفس الشيء بدل «access_denied»
  granted = ['read_orders', 'write_products'];
  const s = await splits.shopifyStatus(p.id);
  assert.match(s.theme_error, /access_denied/);
  assert.deepEqual(s.missing_scopes, ['read_themes', 'write_themes']);
  await assert.rejects(splits.installShopify(p.id), (e) => e.code === 'theme_scopes_missing' && e.details.missing_scopes.join() === 'read_themes,write_themes');

  // write_themes يشمل القراءة: الحالة تُقرأ، لكن Shopify ترفض الكتابة رغم الإذن ← «ألصق يدوياً»، لا «إذن ناقص»
  granted = ['write_themes'];
  refuseWrite = true;
  const s2 = await splits.shopifyStatus(p.id);
  assert.equal(s2.theme_error, undefined);
  assert.equal(s2.installed, false);
  await assert.rejects(splits.installShopify(p.id), (e) => e.code === 'theme_write_refused');
  assert.equal(upserts.length, 0);

  // الإذن موافَق عليه والكتابة مسموحة: السنيبت + سطر render بعد <head> مباشرة، ونسخة احتياطية من theme.liquid
  refuseWrite = false;
  const out = await splits.installShopify(p.id);
  assert.deepEqual(out, { installed: true, theme: 'Dawn' });
  assert.deepEqual(upserts.map((f) => f.filename), ['snippets/erp-split.liquid', 'layout/theme.liquid']);
  assert.match(upserts[1].body.value, /<head>\n {4}\{% render 'erp-split' %\}\n<title>/);
  // نسخة قبل كل محاولة كتابة (المرفوضة أيضاً)، وكلها القالب الأصلي
  const baks = fs.readdirSync(config.backupsDir).filter((f) => f.startsWith(`theme-${p.id}-`));
  assert.equal(baks.length, 2);
  assert.ok(baks.every((f) => !fs.readFileSync(path.join(config.backupsDir, f), 'utf8').includes('erp-split')));
});
