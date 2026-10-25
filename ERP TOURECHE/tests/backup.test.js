import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
