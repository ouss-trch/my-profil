import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../server/config.js';
import { createProject } from '../server/services/projects.js';
import { createOrder } from '../server/services/orders.js';
import { backup, backupStatus } from '../server/services/backup.js';
import { restore } from '../server/cli.js';
import * as advisor from '../server/services/advisor.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-backup-'));
const project = createProject({ name: 'Backup Shop', domain: 'backup.example' });
createOrder(project.id, { customer_name: 'B', phone: '0550123456', wilaya_code: 16, items: [{ title: 'x', qty: 1, price: 1000 }] });
const offsite = () => advisor.analyze([project.id]).insights.find((i) => i.key === 'setup.backup_offsite');

test('backup: advisor warns while backups stay on this computer', () => {
  config.backupMirrorDir = '';
  assert.equal(backupStatus().mirror.configured, false);
  assert.equal(offsite()?.severity, 'medium');
});

test('backup: nightly copy lands in the cloud-synced folder and the warning clears', async () => {
  fs.mkdirSync(path.join(tmp, 'Google Drive'));
  config.backupMirrorDir = path.join(tmp, 'Google Drive', 'ERP');
  const out = await backup({ force: true });
  assert.equal(out.mirrorError, null);
  assert.ok(fs.existsSync(out.mirrored));
  assert.ok(!fs.readdirSync(config.backupMirrorDir).some((f) => f.endsWith('.part')));
  const st = backupStatus();
  assert.equal(st.mirror.count, 1);
  assert.equal(st.mirror.behind, false);
  assert.equal(offsite(), undefined);
  // مجلد السحابة غير موجود (Drive غير مثبت) ← لا يُنشأ محلياً، وتنبيه عالي الأهمية بدل الصمت
  config.backupMirrorDir = path.join(tmp, 'Drive-not-mounted', 'ERP');
  const bad = await backup();
  assert.equal(bad.mirrorError, 'mirror_unreachable');
  assert.ok(!fs.existsSync(config.backupMirrorDir));
  assert.equal(offsite()?.severity, 'high');
  config.backupMirrorDir = '';
});

test('restore: validates the file, keeps the previous database, then restores', async () => {
  const { file } = await backup({ force: true });
  const target = path.join(tmp, 'restored.db');
  fs.writeFileSync(target, 'old');
  const out = restore(file, target);
  assert.ok(out.orders >= 1);
  assert.ok(fs.existsSync(out.saved));
  assert.equal(fs.readFileSync(out.saved, 'utf8'), 'old');
  const junk = path.join(tmp, 'junk.db');
  fs.writeFileSync(junk, 'not a database');
  assert.throws(() => restore(junk, target));
  assert.throws(() => restore(path.join(tmp, 'missing.db'), target), /backup_not_found/);
});

test('backup: on the VPS the nightly copy goes compressed to n8n → Google Drive, and only a confirmed upload counts', async () => {
  const { setSetting } = await import('../server/lib/settings.js');
  config.backupMirrorDir = '';
  const sent = [];
  let reply = { ok: true, id: 'drive-file-1' };
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), type: init.headers['Content-Type'], body: Buffer.from(init.body) });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    setSetting('n8n_backup_url', 'https://n8n.example/webhook/toureche-erp-backup-x');
    const out = await backup({ force: true });
    assert.equal(out.driveError, null);
    assert.match(sent[0].url, /\/toureche-erp-backup-x\?name=toureche-\d{4}-\d{2}-\d{2}\.db\.gz$/);
    assert.equal(sent[0].type, 'application/gzip');
    assert.equal(zlib.gunzipSync(sent[0].body).subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal(backupStatus().drive.ok, true);
    assert.equal(backupStatus().offsite_ok, true);
    assert.equal(offsite(), undefined);
    // n8n ردّ بلا تأكيد (حساب Google Drive غير متصل مثلاً) ← خطأ ظاهر وتنبيه عالي الأهمية، لا أمان وهمي
    reply = { message: 'Workflow was started' };
    const bad = await backup();
    assert.match(bad.driveError, /drive_upload_unconfirmed/);
    assert.equal(backupStatus().offsite_ok, false);
    assert.equal(offsite()?.severity, 'high');
    // ملف Google Drive يُسترجع كما هو، حتى باسم آخر (erp.sh يمرّره باسم /import.db)
    const gz = path.join(tmp, 'import.db');
    fs.writeFileSync(gz, sent[0].body);
    assert.ok(restore(gz, path.join(tmp, 'from-drive.db')).orders >= 1);
  } finally {
    globalThis.fetch = prev;
    setSetting('n8n_backup_url', '');
  }
});
