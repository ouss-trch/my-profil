import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { createProject } from '../server/services/projects.js';
import { getSetting, setSetting, projectConfig } from '../server/lib/settings.js';
import { sheetsRead } from '../server/integrations/n8n.js';

const p = createProject({ name: 'Sheet shop', domain: 'sheet.example' });
const ID = '1zDft9IvMFh9p4eCUcfTRKj5jiDg-tQedfmAaeVaH_wQ';

test('settings: a pasted sheet ID loses its spaces and invisible marks, and a full link gives the ID', () => {
  setSetting('sheet_id', ` ${ID} `, p.id);
  assert.equal(getSetting('sheet_id', p.id), ID);
  setSetting('sheet_id', `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`, p.id);
  assert.equal(getSetting('sheet_id', p.id), ID);
  setSetting('sheet_id', `‏${ID}‎\n`, p.id);
  assert.equal(getSetting('sheet_id', p.id), ID);
  // اسم الورقة يحتفظ بمسافاته الداخلية
  setSetting('sheet_tab', ' SOU9NA Orders ', p.id);
  assert.equal(getSetting('sheet_tab', p.id), 'SOU9NA Orders');
  setSetting('store_domain', 'souqnna.com‏ ', p.id);
  assert.equal(getSetting('store_domain', p.id), 'souqnna.com');
  // رابط بمسافة في آخره كان يُرفض (invalid_url)
  setSetting('n8n_sheets_url', 'https://n8n.example/webhook/toureche-erp-sheets ');
  assert.equal(getSetting('n8n_sheets_url'), 'https://n8n.example/webhook/toureche-erp-sheets');
});

test('settings: a sheet ID saved before the fix (trailing space) is read clean, and the n8n bridge receives the right sheet', async () => {
  db.prepare("UPDATE settings SET value = ? WHERE scope = ? AND key = 'sheet_id'").run(JSON.stringify(`${ID} `), `project:${p.id}`);
  assert.equal(projectConfig(p.id).sheet_id, ID);
  setSetting('n8n_sheets_key', 'k-test');
  let sent = null;
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ values: [['ref', 'status']] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const rows = await sheetsRead(projectConfig(p.id).sheet_id, 'customer');
    assert.deepEqual(rows, [['ref', 'status']]);
  } finally {
    globalThis.fetch = real;
  }
  // الجسر يقرأ المعرّف حتى أول «/» أو «?»: لا مسافة قبلها
  assert.equal(sent.path.split(/[/?]/)[0], ID);
});
