// تدقيق الواجهة (منهج Impeccable audit): التباين، أهداف اللمس، أسماء الأزرار، الحقول بلا عنوان، التمرير الأفقي، عناوين h1
// الاستعمال: DEMO_PASSWORD=… node scripts/ui-audit.cjs http://localhost:3600 ui-audit.json (خادم ببيانات: scripts/demo.sh)
const { chromium } = require('playwright');
const fs = require('fs');
const [, , base, out] = process.argv;
const ROUTES = ['/', '/dashboard', '/advisor', '/assistant', '/orders', '/orders?tab=shipping', '/leads', '/customers', '/carriers', '/products', '/products/1', '/ads', '/splits', '/splits/1', '/finance', '/tasks', '/contacts', '/contacts?kind=delivery', '/activity', '/settings'];
const probe = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
    return bg;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const sel = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : ''}`;
  const out = { contrast: [], target: [], name: [], label: [], overflow: false, h1: document.querySelectorAll('h1').length };
  for (const el of document.querySelectorAll('main *, header *, aside *, [role=dialog] *')) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (own) {
      const s = getComputedStyle(el);
      const fg = parse(s.color);
      if (!fg) continue;
      const bg = bgOf(el);
      let eff = Number(s.opacity);
      for (let e = el.parentElement; e; e = e.parentElement) eff *= Number(getComputedStyle(e).opacity);
      const r = ratio(blend({ ...fg, a: fg.a * eff }, bg), bg);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      const disabled = el.closest('button:disabled, [aria-disabled=true], input:disabled');
      if (!disabled && r < (large ? 3 : 4.5)) out.contrast.push({ sel: sel(el), text: el.textContent.trim().slice(0, 40), ratio: Math.round(r * 100) / 100, color: s.color, size });
    }
  }
  for (const el of document.querySelectorAll('input, textarea')) {
    if (!visible(el) || !el.placeholder) continue;
    const pc = parse(getComputedStyle(el, '::placeholder').color);
    if (pc) {
      const bg = bgOf(el);
      const r = ratio(blend(pc, bg), bg);
      if (r < 4.5) out.contrast.push({ sel: sel(el) + '::placeholder', text: el.placeholder.slice(0, 30), ratio: Math.round(r * 100) / 100, color: getComputedStyle(el, '::placeholder').color });
    }
  }
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=button]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (!inline && (r.width < 24 || r.height < 24)) out.target.push({ sel: sel(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) });
    if (['BUTTON', 'A'].includes(el.tagName) || el.getAttribute('role') === 'button') {
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      if (!name) out.name.push({ sel: sel(el), html: el.outerHTML.slice(0, 160) });
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file') {
      const lab = el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label');
      if (!lab) out.label.push({ sel: sel(el), placeholder: el.placeholder || el.querySelector?.('option')?.textContent || '' });
    }
  }
  out.overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  return out;
};
(async () => {
  const b = await chromium.launch();
  const report = {};
  for (const [name, vp, theme] of [['desk-dark', { width: 1440, height: 900 }, 'dark'], ['desk-light', { width: 1440, height: 900 }, 'light'], ['mob-dark', { width: 390, height: 844 }, 'dark']]) {
    const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
    await ctx.addInitScript((th) => { try { localStorage.setItem('erp.theme', th); } catch {} }, theme);
    const p = await ctx.newPage();
    await p.goto(base + '/');
    await p.waitForSelector('input[autocomplete="username"], main');
    if (await p.locator('input[autocomplete="username"]').count()) {
      await p.fill('input[autocomplete="username"]', process.env.DEMO_USER || 'demo');
      await p.fill('input[type="password"]', process.env.DEMO_PASSWORD);
      await p.click('button[type="submit"]');
      await p.waitForSelector('main');
    }
    for (const r of ROUTES) {
      await p.goto(base + r);
      await p.waitForSelector('main');
      await p.waitForTimeout(900);
      report[`${name} ${r}`] = await p.evaluate(probe);
    }
    await ctx.close();
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  // ملخص مجمّع
  const agg = (k, key) => {
    const m = new Map();
    for (const [page, v] of Object.entries(report)) for (const x of v[k]) { const id = key(x); const e = m.get(id) || { ...x, pages: new Set() }; e.pages.add(page.split(' ')[0] + ' ' + page.split(' ')[1]); m.set(id, e); }
    return [...m.values()].map((e) => ({ ...e, pages: [...e.pages].slice(0, 4).join(' | ') + (e.pages.size > 4 ? ` (+${e.pages.size - 4})` : '') }));
  };
  const c = agg('contrast', (x) => `${x.sel}|${x.color}`).sort((a, b) => a.ratio - b.ratio);
  console.log('CONTRAST', c.length); for (const x of c.slice(0, 40)) console.log(` ${x.ratio}  ${x.color}  ${x.sel}  «${x.text}»  ${x.pages}`);
  const t = agg('target', (x) => `${x.sel}|${x.w}x${x.h}`); console.log('TARGET<24', t.length); for (const x of t.slice(0, 25)) console.log(` ${x.w}x${x.h} ${x.sel} «${x.text}» ${x.pages}`);
  const n = agg('name', (x) => x.sel); console.log('NO-NAME', n.length); for (const x of n.slice(0, 20)) console.log(` ${x.sel} ${x.html.slice(0, 120)} ${x.pages}`);
  const l = agg('label', (x) => `${x.sel}|${x.placeholder}`); console.log('NO-LABEL', l.length); for (const x of l.slice(0, 30)) console.log(` ${x.sel} «${x.placeholder}» ${x.pages}`);
  console.log('OVERFLOW', Object.entries(report).filter(([, v]) => v.overflow).map(([k]) => k));
  console.log('H1!=1', Object.entries(report).filter(([, v]) => v.h1 !== 1).map(([k, v]) => `${k}:${v.h1}`));
  await b.close();
})();
