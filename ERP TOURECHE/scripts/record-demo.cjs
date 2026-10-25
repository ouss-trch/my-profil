// تسجيل ردود الخادم الحقيقية أثناء تصفح كل الصفحات → demo-data.json لنسخة العرض
// الاستعمال: DEMO_PASSWORD=… node scripts/record-demo.cjs http://localhost:3600 client/dist-demo/demo-data.json (خادم ببيانات تجريبية: scripts/demo.sh)
const { chromium } = require('playwright');
const fs = require('fs');
const [, , base, out] = process.argv;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const data = {};
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/') || r.status() !== 200) return;
    const m = r.request().method();
    const key = u.pathname.slice(4) + u.search;
    try {
      const body = await r.json();
      if (m === 'GET') data[key] = body;
      else if (key.endsWith('/seo/check')) data[`POST ${key}`] = body;
    } catch {
      /* ليست JSON */
    }
  });
  const go = async (p, wait = 1200) => {
    await page.goto(base + p);
    await page.waitForTimeout(wait);
  };
  const clickAll = async (selector, max = 8, wait = 700) => {
    const n = Math.min(await page.locator(selector).count(), max);
    for (let i = 0; i < n; i++) {
      await page.locator(selector).nth(i).click().catch(() => {});
      await page.waitForTimeout(wait);
    }
  };
  await go('/');
  if (await page.locator('input[autocomplete="username"]').count()) {
    await page.fill('input[autocomplete="username"]', process.env.DEMO_USER || 'demo');
    await page.fill('input[type="password"]', process.env.DEMO_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector('main');
  }
  for (const lang of ['ar']) {
    await go('/');
    await go('/dashboard');
    for (const r of ['7 أيام', '90 يوماً', 'هذا الشهر']) {
      await page.getByText(r, { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(600);
    }
    await go('/advisor');
    await clickAll('[role="tab"]', 3);
    for (const t of ['confirm', 'to_ship', 'shipping', 'delivered', 'returned', 'closed', 'all']) {
      await go(`/orders?tab=${t}`, 900);
      const links = page.locator('tbody button.link');
      const n = Math.min(await links.count(), 3);
      for (let i = 0; i < n; i++) {
        await links.nth(i).click().catch(() => {});
        await page.waitForTimeout(700);
        if (t === 'to_ship') {
          await page.getByRole('button', { name: /إرسال لشركة التوصيل/ }).last().click().catch(() => {});
          await page.waitForTimeout(800);
          await page.keyboard.press('Escape');
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }
    for (const s of ['new', 'no_answer', 'callback', 'confirmed', 'at_office', 'out_for_delivery', 'attempt_failed', 'returning', 'in_transit']) await go(`/orders?status=${s}`, 600);
    await go('/leads');
    await go('/customers');
    await clickAll('tbody button.link', 3, 800);
    for (const t of ['performance', 'best', 'tariffs']) await go(`/carriers?tab=${t}`, 1500);
    await go('/products');
    const ids = await page.locator('a[href^="/products/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    for (const href of ids.slice(0, 6)) {
      await go(href, 1500);
      await clickAll('[role="tab"]', 5, 1200);
      await page.getByRole('button', { name: /إطلاق حملة/ }).first().click().catch(() => {});
      await page.waitForTimeout(1500);
      await page.keyboard.press('Escape');
    }
    for (const t of ['campaigns', 'decisions', 'tests', 'launch', 'drafts', 'health']) await go(`/ads?tab=${t}`, 1200);
    await go('/splits');
    await go('/splits/1');
    for (const p of ['/finance', '/tasks', '/contacts', '/contacts?kind=delivery', '/contacts?kind=service', '/contacts?kind=wholesale', '/contacts?kind=other', '/store-pages', '/activity', '/assistant']) await go(p);
    for (const t of ['integrations', 'general', 'projects', 'users', 'security', 'system']) await go(`/settings?tab=${t}`, 1000);
  }
  await b.close();
  fs.writeFileSync(out, JSON.stringify(data));
  console.log('recorded', Object.keys(data).length, 'responses,', Math.round(fs.statSync(out).size / 1024), 'KB');
})();
