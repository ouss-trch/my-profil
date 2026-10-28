import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import * as landing from '../server/services/landing.js';
import * as splits from '../server/services/splits.js';

// ——— Claude وهمي: يسجّل الطلب ويعيد نصاً منظماً (فيه زيادات يجب أن تُقصّ) ———
const aiCalls = [];
const copy = {
  product_short: 'Thermos',
  angle_slug: 'cadeau',
  hero: { eyebrow: 'هدية عملية', headline: 'هدية يستعملها طفلك كل يوم في المدرسة', subheadline: 'ترمس يحفظ المشروب، بتصميم ميكي وميني.', bullets: ['يحفظ الحرارة', 'حزام كتف', 'سهل الغسل', 'خفيف', 'زائدة تُحذف'], cta: 'اطلب الآن وادفع عند الاستلام', note: 'نتصل بك لتأكيد الطلب' },
  story: [
    { stage: 'attention', heading: 'كل صباح نفس السؤال', body: 'ماذا يأخذ معه اليوم؟\nمشروب يبقى ساخناً حتى الاستراحة.' },
    { stage: 'interest', heading: 'لماذا هذا الترمس', body: 'ستانلس ستيل 320 مل.' },
    { stage: 'desire', heading: 'هدية تُفرح', body: 'تصميم يحبه الأطفال.' },
  ],
  benefits: { heading: 'ما الذي يربحه', items: [{ title: 'دافئ | حتى الاستراحة', text: 'المشروب يبقى ساخناً' }] },
  steps: { heading: 'كيف تطلب', items: ['املأ النموذج', 'نتصل بك للتأكيد', 'تدفع عند الاستلام'] },
  guarantee: { heading: 'مطمئن', items: ['حق المعاينة قبل الدفع', 'الاستبدال خلال 4 أيام عمل'] },
  faq: Array.from({ length: 8 }, (_, i) => ({ q: `سؤال ${i + 1}؟`, a: `جواب ${i + 1}` })),
  final_cta: { headline: 'اطلبه اليوم', cta: 'اطلب الآن', note: 'الدفع عند الاستلام' },
  seo: { title: 'ترمس أطفال هدية', description: 'ترمس أطفال ميكي وميني' },
  owner_todo: ['أضف آراء زبائن حقيقية'],
};

// ——— Shopify وهمي: قالب المنتج الحقيقي (عروض + سياسات)، theme.liquid بالرأس والتذييل، والتحويلات ———
let granted = ['write_themes', 'write_online_store_navigation'];
const files = {
  'templates/product.json': `/*\n * IMPORTANT: auto-generated\n */\n${JSON.stringify({
    sections: {
      main: {
        type: 'product-main',
        blocks: {
          media: { type: '_pdp-media', static: true, blocks: { gallery: { type: '_pdp-gallery', settings: {} }, description: { type: '_pdp-description', settings: {} } } },
          info: {
            type: '_pdp-info',
            static: true,
            blocks: {
              form: {
                type: '_pdp-form',
                blocks: {
                  offer_1: { type: '_offer', settings: { title: 'قطعة واحدة', quantity: 1, discount_type: 'none', value: 0 } },
                  offer_2: { type: '_offer', settings: { title: 'قطعتان', subtitle: 'وفّر 10%', quantity: 2, discount_type: 'percent', value: 10 } },
                  offer_3: { type: '_offer', disabled: true, settings: { title: '3 قطع', quantity: 3 } },
                  trust_1: { type: '_trust-line', settings: { text: 'حق المعاينة مكفول: افحص الطلبية قبل الدفع.' } },
                },
              },
            },
          },
        },
        settings: { layout: 'split', show_sticky: true },
      },
      related: { type: 'product-recommendations', settings: {} },
    },
    order: ['main', 'related'],
  })}`,
  'layout/theme.liquid': "<!doctype html><html><head>\n  {% render 'erp-split' %} %}\n  {{ content_for_header }}\n</head><body>\n  {% sections 'header-group' %}\n  <main>{{ content_for_layout }}</main>\n  {% sections 'footer-group' %}\n  {% render 'whatsapp-button' %}\n</body></html>",
};
const redirects = [];
const shopFiles = [];
const denied = () => ({ errors: [{ message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }] });
globalThis.fetch = async (url, init) => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (String(url).startsWith('http://anthropic.test')) {
    const body = JSON.parse(init.body);
    aiCalls.push(body);
    return json({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(copy) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
  }
  const { query, variables } = JSON.parse(init.body);
  if (query.includes('currentAppInstallation')) return json({ data: { currentAppInstallation: { accessScopes: granted.map((handle) => ({ handle })) } } });
  if (query.includes('themes(first: 1')) return json({ data: { themes: { nodes: [{ id: 'gid://shopify/OnlineStoreTheme/1', name: 'sou9na' }] } } });
  if (query.includes('theme(id:')) {
    const match = (pat) => (pat.includes('*') ? new RegExp(`^${pat.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`) : { test: (f) => f === pat });
    const names = Object.keys(files).filter((f) => variables.f.some((pat) => match(pat).test(f)));
    return json({ data: { theme: { files: { nodes: names.map((filename) => ({ filename, body: { content: files[filename] } })) } } } });
  }
  if (query.includes('themeFilesUpsert')) {
    for (const f of variables.files) files[f.filename] = f.body.value;
    return json({ data: { themeFilesUpsert: { upsertedThemeFiles: variables.files.map((f) => ({ filename: f.filename })), userErrors: [] } } });
  }
  if (query.includes('themeFilesDelete')) {
    for (const f of variables.f) delete files[f];
    return json({ data: { themeFilesDelete: { deletedThemeFiles: variables.f.map((filename) => ({ filename })), userErrors: [] } } });
  }
  if (query.includes('urlRedirects(')) return json({ data: { urlRedirects: { nodes: redirects.filter((r) => !variables?.q || variables.q === `path:${r.path}`) } } });
  // صور صفحات الهبوط كلها (فحص البقايا)، أو بالاسم (حذف صفحة)
  if (query.includes('filename:lp-*')) return json({ data: { files: { nodes: shopFiles.filter((f) => f.filename.startsWith('lp-')).map((f) => ({ id: f.id, image: { url: `https://cdn.shopify.com/s/files/1/files/${f.filename}?v=1` } })), pageInfo: { hasNextPage: false, endCursor: null } } } });
  if (query.includes('files(first')) return json({ data: { files: { nodes: shopFiles.filter((f) => variables.q.includes(`"${f.filename}"`)) } } });
  if (query.includes('fileDelete')) {
    for (const id of variables.ids) shopFiles.splice(shopFiles.findIndex((f) => f.id === id), 1);
    return json({ data: { fileDelete: { deletedFileIds: variables.ids, userErrors: [] } } });
  }
  if (query.includes('urlRedirectCreate')) {
    if (!granted.includes('write_online_store_navigation')) return json(denied());
    const r = { id: `gid://shopify/UrlRedirect/${redirects.length + 1}`, ...variables.r };
    redirects.push(r);
    return json({ data: { urlRedirectCreate: { urlRedirect: r, userErrors: [] } } });
  }
  if (query.includes('urlRedirectUpdate')) {
    const r = redirects.find((x) => x.id === variables.id);
    Object.assign(r, variables.r);
    return json({ data: { urlRedirectUpdate: { urlRedirect: r, userErrors: [] } } });
  }
  if (query.includes('urlRedirectDelete')) {
    redirects.splice(redirects.findIndex((r) => r.id === variables.id), 1);
    return json({ data: { urlRedirectDelete: { deletedUrlRedirectId: variables.id, userErrors: [] } } });
  }
  throw new Error(`unexpected ${String(url)} ${query?.slice(0, 50)}`);
};

process.env.ANTHROPIC_BASE_URL = 'http://anthropic.test';
setSetting('anthropic_api_key', 'sk-test-landing');
const project = createProject({ name: 'Landing shop', domain: 'souqnna.example' });
setSetting('shopify_shop', 'landing-test.myshopify.com', project.id);
setSetting('shopify_access_token', 'shpat_test', project.id);
const product = createProduct(project.id, { title: 'ترمس أطفال ميكي وميني 320 مل', handle: 'thermos-mickey-320', price: 2900, compare_at_price: 3500, stock: 40, description_html: '<p>ستانلس ستيل، 320 مل، حزام كتف.</p>' });

test('landing: Claude writes by the rules, with the store’s real offers and policies, and the copy is trimmed', async () => {
  const l = await landing.generateLanding(project.id, { product_id: product.id, angle: 'هدية', framework: 'pas', tone: 'darija' });
  assert.equal(l.status, 'draft');
  assert.equal(l.slug, 'thermos-mickey-cadeau');
  assert.equal(l.copy.hero.bullets.length, 4);
  assert.equal(l.copy.faq.length, 6);
  // طلبان: النصوص، ثم أقسام الزاوية + خطة الصور (مخطط واحد كبير تجاوز حدّ Claude: «compiled grammar is too large»)
  const pair = aiCalls.slice(-2);
  const sent = pair.find((c) => c.output_config.format.schema.required.includes('hero'));
  const plan = pair.find((c) => c !== sent);
  assert.ok(sent && plan, 'copy and plan are two requests');
  assert.match(sent.system, /الصدق التام/);
  assert.match(sent.system, /الدارجة الجزائرية/);
  assert.doesNotMatch(sent.system, /\{tone\}/);
  assert.ok(sent.output_config.format.schema.required.includes('hero'));
  const facts = JSON.parse(sent.messages[0].content.at(-1).text.match(/\{[\s\S]*\}/)[0]);
  assert.deepEqual(facts.store_offers.map((o) => o.title), ['قطعة واحدة', 'قطعتان'], 'disabled offers are not sold');
  assert.ok(facts.store_policies.includes('حق المعاينة مكفول: افحص الطلبية قبل الدفع.'));
  assert.equal(facts.product.real_low_stock, null, '40 in stock is not scarcity');
  assert.match(facts.framework.story_plan, /المشكلة/);
  // زاوية «هدية» ← تصميم الهدية: أقسامه وأجواء صوره تُرسل مع المعطيات، ويُحفظ مع النص
  assert.equal(facts.layout.id, 'gift');
  assert.match(facts.layout.brief, /occasions/);
  assert.match(facts.layout.shots, /gift/i);
  assert.equal(l.copy.layout, 'gift');
  assert.ok(sent.output_config.format.schema.required.includes('trust'));
  for (const k of ['occasions', 'compare', 'moments', 'specs', 'visuals']) assert.ok(!sent.output_config.format.schema.required.includes(k), `${k} is not in the copy request`);
  // تصميم الهدية يستعمل «المناسبات» وحدها: الطلب الثاني لا يحمل إلا ما يعرضه التصميم
  assert.deepEqual(plan.output_config.format.schema.required, ['occasions', 'visuals']);
  assert.deepEqual(landing.layoutExtras('value'), ['compare', 'specs']);
  assert.deepEqual(landing.layoutExtras('classic'), []);
  // كل طلب أصغر من المخطط الذي كان يعمل قبل أقسام الزوايا
  const leaves = (x) => (x.type === 'object' ? Object.values(x.properties).reduce((n, y) => n + leaves(y), 0) : x.type === 'array' ? leaves(x.items) : 1);
  assert.ok(leaves(sent.output_config.format.schema) <= 27, `copy schema leaves ${leaves(sent.output_config.format.schema)}`);
  assert.ok(leaves(landing.planSchema(landing.layoutExtras('value'))) <= 16);
  // نفس الزاوية مرة ثانية: رابط مختلف
  const again = await landing.generateLanding(project.id, { product_id: product.id, angle: 'هدية', framework: 'aida' });
  assert.equal(again.slug, 'thermos-mickey-cadeau-2');
  await assert.rejects(landing.deleteLanding(999999), /landing_not_found/);
  await landing.deleteLanding(again.id);
});

test('landing: publish = layout without header/footer + section + product template with the same form and offers + /pages redirect', async () => {
  const [l] = landing.listLandings([project.id]);
  const out = await landing.publishLanding(l.id);
  assert.equal(out.status, 'published');
  assert.equal(out.public_url, 'https://souqnna.example/pages/thermos-mickey-cadeau');
  assert.equal(out.target_url, '/products/thermos-mickey-320?view=lp-thermos-mickey-cadeau');
  assert.deepEqual(redirects.map((r) => [r.path, r.target]), [['/pages/thermos-mickey-cadeau', '/products/thermos-mickey-320?view=lp-thermos-mickey-cadeau']]);

  const layout = files['layout/erp-landing.liquid'];
  assert.doesNotMatch(layout, /header-group|footer-group|whatsapp-button/);
  assert.match(layout, /content_for_layout/);
  assert.match(layout, /\{% render 'erp-split' %\}\n/, 'A/B snippet kept, stray %} removed');
  assert.match(files['sections/erp-lp.liquid'], /\{% schema %\}/);
  assert.match(files['sections/erp-lp.liquid'], /data-lead-form/, 'CTA buttons scroll to the theme’s own form');

  const tpl = JSON.parse(files['templates/product.lp-thermos-mickey-cadeau.json']);
  assert.equal(tpl.layout, 'erp-landing');
  assert.deepEqual(tpl.order, ['lp_top', 'main', 'lp_bottom']);
  assert.equal(tpl.sections.main.settings.layout, 'stack');
  assert.equal(tpl.sections.main.blocks.media.blocks.description.disabled, true);
  assert.equal(tpl.sections.main.blocks.info.blocks.form.blocks.offer_2.settings.title, 'قطعتان', 'same offers as the product page');
  const top = tpl.sections.lp_top;
  assert.equal(top.settings.style, 'gift', 'the gift design');
  assert.equal(tpl.sections.lp_bottom.settings.style, 'gift');
  const types = top.block_order.map((k) => top.blocks[k].type);
  assert.deepEqual(types.slice(0, 3), ['hero', 'trust', 'images'], 'hero, trust strip right under it, then the photos (no drawn visuals yet)');
  assert.match(top.blocks.trust_2.settings.items, /الدفع عند الاستلام/);
  // القصة بعد النموذج في تصميم الهدية: الشاشات الأولى للعنوان والثقة والمناسبات والفوائد
  assert.match(Object.values(tpl.sections.lp_bottom.blocks).find((b) => b.type === 'text').settings.body, /^<p>ماذا يأخذ معه اليوم؟<\/p><p>/);
  assert.equal(Object.values(top.blocks).find((b) => b.type === 'benefits').settings.items, 'دافئ / حتى الاستراحة | المشروب يبقى ساخناً', 'a | inside a title cannot break the title | text split');
  assert.equal(Object.values(tpl.sections.lp_bottom.blocks).filter((b) => b.type === 'faq').length, 6);

  // الطلبيات تُنسب بالرابط النهائي: الصفحة مثبتة في «صفحات المتجر»
  const page = db.prepare('SELECT * FROM store_pages WHERE project_id = ? AND url LIKE ?').get(project.id, '%view=lp-thermos-mickey-cadeau%');
  assert.ok(page?.pinned);

  // إعادة النشر تحدّث التحويل نفسه (لا تكرار)
  await landing.publishLanding(l.id);
  assert.equal(redirects.length, 1);

  // اختبار A/B جارٍ: صفحة المنتج + هذه الصفحة + صفحة أخرى
  const ab = splits.createTest(project.id, {
    name: 'Thermos angles',
    entry_path: 'https://souqnna.example/products/thermos-mickey-320',
    variants: [
      { url: 'https://souqnna.example/products/thermos-mickey-320', weight: 1 },
      { url: 'https://souqnna.example/products/thermos-mickey-320?view=lp-thermos-mickey-cadeau', weight: 1 },
      { url: 'https://souqnna.example/pages/thermos-promo', weight: 1 },
    ],
  });
  splits.updateTest(ab.id, { status: 'running' });
  const live = () => splits.shopifyConfig(project.id).tests.find((x) => x.s === ab.slug).v.map((x) => x.l);
  assert.deepEqual(live(), ['A', 'B', 'C']);
  // تغيّر القالب المنشور (القالب الجديد بلا ‎product.lp-…‎): النسخة B لا يُوجَّه إليها أحد
  assert.deepEqual(splits.shopifyConfig(project.id, new Set()).tests.find((x) => x.s === ab.slug).v.map((x) => x.l), ['A', 'C']);

  // السحب: حذف التحويل والقالب، والنص يبقى
  const off = await landing.unpublishLanding(l.id);
  assert.equal(off.status, 'unpublished');
  assert.equal(redirects.length, 0);
  assert.equal(files['templates/product.lp-thermos-mickey-cadeau.json'], undefined);
  assert.equal(off.copy.hero.headline, copy.hero.headline);
  // …ونسختها في الاختبار تتوقف (كان زوارها يرون صفحة المنتج العادية والاختبار يقارن الصفحة بنفسها)
  assert.equal(off.tests.tests, 1);
  assert.deepEqual(live(), ['A', 'C']);
  assert.equal(db.prepare("SELECT active FROM split_variants WHERE test_id = ? AND label = 'B'").get(ab.id).active, 0);
  // حتى لو بقيت النسخة مفعّلة في قاعدة قديمة: الصفحة غير منشورة فلا تُرسل إلى المتجر
  db.prepare("UPDATE split_variants SET active = 1 WHERE test_id = ? AND label = 'B'").run(ab.id);
  assert.deepEqual(live(), ['A', 'C']);
  splits.deleteTest(ab.id);
});

test('landing: a missing Shopify permission is named (redirects need write_online_store_navigation)', async () => {
  granted = ['write_themes'];
  const [l] = landing.listLandings([project.id]);
  await assert.rejects(landing.publishLanding(l.id), (e) => e.code === 'landing_scopes_missing:write_online_store_navigation');
  granted = ['write_themes', 'write_online_store_navigation'];
  assert.throws(() => landing.buildTemplate(l.copy, { sections: { main: { type: 'other' } } }), /landing_theme_unsupported/);
});

test('landing: deleting in the ERP deletes it from the store too (template, link, uploaded visuals, pinned page, A/B version)', async () => {
  const { createTest, getTest } = await import('../server/services/splits.js');
  const l = await landing.generateLanding(project.id, { product_id: product.id, angle: 'المشكلة والحل', framework: 'pas' });
  await landing.publishLanding(l.id);
  const target = `/products/thermos-mickey-320?view=lp-${l.slug}`;
  assert.ok(files[`templates/product.lp-${l.slug}.json`]);
  assert.ok(redirects.some((r) => r.target === target));
  // صورة وصفية رُفعت سابقاً (قبل حفظ معرّف الملف): تُعرف من اسمها في رابطها
  shopFiles.push({ id: 'gid://shopify/MediaImage/77', filename: `lp-${l.slug}-v1.png` });
  db.prepare('UPDATE landing_pages SET visuals = ? WHERE id = ?').run(JSON.stringify([{ id: 'v1', kind: 'hero', headline: 'x', points: [], scene: 'y', approved: true, image: null, shopify_url: `https://cdn.shopify.com/s/files/1/files/lp-${l.slug}-v1.png?v=1` }]), l.id);
  const t = createTest(project.id, {
    name: 'two pages',
    variants: [
      { url: 'https://souqnna.example/products/thermos-mickey-320', weight: 1 },
      { url: `https://souqnna.example${target}`, weight: 1 },
    ],
  });
  db.prepare("UPDATE split_tests SET status = 'running' WHERE id = ?").run(t.id);

  const out = await landing.deleteLanding(l.id);
  assert.deepEqual(out.removed, ['redirect', 'template', 'files']);
  assert.equal(files[`templates/product.lp-${l.slug}.json`], undefined);
  assert.ok(!redirects.some((r) => r.target === target));
  assert.equal(shopFiles.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM landing_pages WHERE id = ?').get(l.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM store_pages WHERE url LIKE ?').get(`%view=lp-${l.slug}%`).n, 0);
  // الاختبار لم يبقَ فيه إلا صفحة المنتج: النسخة معطّلة والاختبار متوقف
  const after = getTest(t.id);
  assert.equal(after.variants.find((v) => v.label === 'B').active, false);
  assert.equal(after.status, 'paused');
  assert.deepEqual(out.tests, { tests: 1, paused: ['two pages'] });
});

test('landing: the store check lists leftovers the ERP no longer knows and removes them on demand', async () => {
  // بقايا من صفحة حُذفت قبل هذا الإصلاح: قالب وتحويل في المتجر، لا صفحة في الـ ERP
  files['templates/product.lp-old-quotidien.json'] = '{}';
  redirects.push({ id: 'gid://shopify/UrlRedirect/90', path: '/pages/old-quotidien', target: '/products/thermos-mickey-320?view=lp-old-quotidien' });
  // وصور صفحة حُذفت بعد «سحب من المتجر» (الحذف القديم لم يكن يحذفها)؛ صور صفحة ما زالت في الـ ERP ليست بقايا
  shopFiles.push({ id: 'gid://shopify/MediaImage/91', filename: 'lp-old-quotidien-v1.jpg' }, { id: 'gid://shopify/MediaImage/92', filename: 'lp-gone-cadeau-v2.jpg' }, { id: 'gid://shopify/MediaImage/93', filename: 'lp-thermos-mickey-cadeau-v1.png' }, { id: 'gid://shopify/MediaImage/94', filename: 'logo.png' });
  const check = await landing.storeCheck(project.id);
  const left = check.leftovers.find((x) => x.suffix === 'lp-old-quotidien');
  assert.deepEqual(left, { suffix: 'lp-old-quotidien', template: 'templates/product.lp-old-quotidien.json', redirects: [{ id: 'gid://shopify/UrlRedirect/90', path: '/pages/old-quotidien' }], erp: null, files: [{ id: 'gid://shopify/MediaImage/91', name: 'lp-old-quotidien-v1.jpg' }] });
  assert.deepEqual(check.leftovers.find((x) => x.suffix === 'lp-gone-cadeau'), { suffix: 'lp-gone-cadeau', template: null, redirects: [], erp: null, files: [{ id: 'gid://shopify/MediaImage/92', name: 'lp-gone-cadeau-v2.jpg' }] }, 'images alone are leftovers too');
  assert.ok(!check.leftovers.some((x) => x.suffix === 'lp-thermos-mickey-cadeau'), 'images of a page still in the ERP are kept');
  await landing.removeLeftover(project.id, 'lp-gone-cadeau');
  assert.deepEqual(shopFiles.map((f) => f.id).sort(), ['gid://shopify/MediaImage/91', 'gid://shopify/MediaImage/93', 'gid://shopify/MediaImage/94']);
  // الصفحة المسحوبة (unpublished) ليست في المتجر ولا تُعدّ بقايا
  assert.ok(!check.leftovers.some((x) => x.suffix === 'lp-thermos-mickey-cadeau'));
  await landing.removeLeftover(project.id, 'lp-old-quotidien');
  assert.equal(files['templates/product.lp-old-quotidien.json'], undefined);
  assert.ok(!shopFiles.some((f) => f.id === 'gid://shopify/MediaImage/91'), 'its images go with it');
  shopFiles.splice(0, shopFiles.length);
  assert.ok(!redirects.some((r) => r.path === '/pages/old-quotidien'));
  await assert.rejects(landing.removeLeftover(project.id, 'lp-old-quotidien'), /leftover_not_found/);
  // صفحة منشورة اختفى قالبها من المتجر: تظهر «ناقصة» لإعادة نشرها
  const [l] = landing.listLandings([project.id]).filter((x) => x.slug === 'thermos-mickey-cadeau');
  await landing.publishLanding(l.id);
  delete files['templates/product.lp-thermos-mickey-cadeau.json'];
  assert.deepEqual((await landing.storeCheck(project.id)).missing.map((x) => x.slug), ['thermos-mickey-cadeau']);
});
