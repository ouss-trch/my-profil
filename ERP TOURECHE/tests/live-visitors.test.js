import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { createProject } from '../server/services/projects.js';
import { busyHours, liveVisitors, recordVisit } from '../server/services/tracking.js';
import { dzDay } from '../server/lib/util.js';

const p = createProject({ name: 'Live shop', domain: 'live.example' });
const UA = 'Mozilla/5.0 (Linux; Android 13) Chrome/130 Mobile Safari/537.36';
let shop = p;
const hit = (vid, url, e = 'v', extra = {}) => recordVisit(shop.slug, { e, u: url, vid, r: '', t: 'product', ...extra }, UA);
const vid = (n) => String(n).padStart(16, '0').replace(/0/g, 'a').slice(0, 16);
const at = (id, iso) => db.prepare('UPDATE page_visits SET first_at = ?, last_at = ? WHERE visitor = ? AND project_id = ?').run(iso, iso, id, shop.id);

test('live visitors: unique people active in the last minutes, those in the order form, those from ads, and the pages they are on', () => {
  const now = Date.now();
  hit(vid(1), '/products/mug');
  hit(vid(1), '/products/mug', 'f'); // يلمس النموذج
  hit(vid(2), '/products/mug?utm_source=fb&utm_medium=paid&utm_campaign=1');
  hit(vid(3), '/products/mug');
  hit(vid(3), '/'); // صفحتان لزائر واحد: يُعدّ مرة
  hit(vid(4), '/products/bag');
  // الرابع غادر قبل 20 دقيقة: ليس «الآن» لكنه في آخر 30 دقيقة
  at(vid(4), new Date(now - 20 * 60e3).toISOString());
  // الخامس منذ ساعتين: لا الآن ولا آخر 30 دقيقة، لكنه من زوار اليوم
  hit(vid(5), '/products/bag');
  at(vid(5), new Date(now - 2 * 3600e3).toISOString());
  const l = liveVisitors([p.id], { now });
  assert.equal(l.now, 3, 'three different people in the last 5 minutes');
  assert.equal(l.in_form, 1);
  assert.equal(l.from_ad, 1);
  assert.equal(l.last_30, 4);
  assert.equal(l.today >= 5, true);
  assert.equal(l.pages[0].visitors, 3, 'the busiest page now');
  assert.equal(liveVisitors([p.id], { now, minutes: 60 }).now, 4);
  assert.equal(liveVisitors([createProject({ name: 'Empty', domain: 'empty.example' }).id], { now }).now, 0);
});

test('busy hours: arrival hour in Algeria time (UTC+1), once per person per day, with orders on the same clock', () => {
  shop = createProject({ name: 'Hours shop', domain: 'hours.example' });
  const day = dzDay();
  // 20:30 UTC = 21:30 بتوقيت الجزائر
  for (const n of [11, 12, 13]) {
    hit(vid(n), '/products/mug');
    at(vid(n), `${day}T20:30:00.000Z`);
  }
  // زائر يدخل صفحتين في ساعتين مختلفتين: يُعدّ مرة في ساعة أول زيارة
  hit(vid(14), '/products/mug');
  hit(vid(14), '/products/bag');
  db.prepare("UPDATE page_visits SET first_at = ?, last_at = ? WHERE visitor = ? AND page = '/products/mug'").run(`${day}T09:00:00.000Z`, `${day}T09:00:00.000Z`, vid(14));
  db.prepare("UPDATE page_visits SET first_at = ?, last_at = ? WHERE visitor = ? AND page = '/products/bag'").run(`${day}T15:00:00.000Z`, `${day}T15:00:00.000Z`, vid(14));
  // 23:30 UTC = 00:30 اليوم التالي بتوقيت الجزائر (التفاف منتصف الليل)
  hit(vid(15), '/products/mug');
  at(vid(15), `${day}T23:30:00.000Z`);
  const iso = `${day}T20:45:00.000Z`;
  for (const status of ['new', 'confirmed', 'abandoned'])
    db.prepare("INSERT INTO orders (project_id, ref, customer_name, phone, status, total, created_at, updated_at, items) VALUES (?, ?, 'x', '0550000000', ?, 1000, ?, ?, '[]')").run(shop.id, `BH-${status}`, status, iso, iso);
  const h = busyHours([shop.id], { days: 7 });
  assert.equal(h.hours.length, 24);
  assert.equal(h.hours[21].visitors >= 3, true, '20:30 UTC is 21:xx in Algiers');
  assert.equal(h.hours[10].visitors, 1, 'first visit of the person that day (09:00 UTC = 10h)');
  assert.equal(h.hours[16].visitors, 0, 'their later page does not count again');
  assert.equal(h.hours[0].visitors, 1, '23:30 UTC wraps to 00h');
  assert.equal(h.hours[21].orders, 2, 'abandoned forms are not orders');
  assert.equal(h.peak_visitors[0], 21);
  assert.equal(h.peak_orders[0], 21);
  assert.ok(h.best_window.from <= 21 && 21 < h.best_window.from + 3, 'the best 3-hour window contains the peak');
  assert.equal(h.enough, false, 'too few visitors: no verdict yet');
});
