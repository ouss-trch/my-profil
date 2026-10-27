import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import * as landing from '../server/services/landing.js';

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
  if (query.includes('theme(id:')) return json({ data: { theme: { files: { nodes: variables.f.filter((f) => f in files).map((filename) => ({ filename, body: { content: files[filename] } })) } } } });
  if (query.includes('themeFilesUpsert')) {
    for (const f of variables.files) files[f.filename] = f.body.value;
    return json({ data: { themeFilesUpsert: { upsertedThemeFiles: variables.files.map((f) => ({ filename: f.filename })), userErrors: [] } } });
  }
  if (query.includes('themeFilesDelete')) {
    for (const f of variables.f) delete files[f];
    return json({ data: { themeFilesDelete: { deletedThemeFiles: variables.f.map((filename) => ({ filename })), userErrors: [] } } });
  }
  if (query.includes('urlRedirects(')) return json({ data: { urlRedirects: { nodes: redirects.filter((r) => variables.q === `path:${r.path}`) } } });
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
  const sent = aiCalls.at(-1);
  assert.match(sent.system, /الصدق التام/);
  assert.match(sent.system, /الدارجة الجزائرية/);
  assert.doesNotMatch(sent.system, /\{tone\}/);
  assert.ok(sent.output_config.format.schema.required.includes('hero'));
  const facts = JSON.parse(sent.messages[0].content.at(-1).text.match(/\{[\s\S]*\}/)[0]);
  assert.deepEqual(facts.store_offers.map((o) => o.title), ['قطعة واحدة', 'قطعتان'], 'disabled offers are not sold');
  assert.ok(facts.store_policies.includes('حق المعاينة مكفول: افحص الطلبية قبل الدفع.'));
  assert.equal(facts.product.real_low_stock, null, '40 in stock is not scarcity');
  assert.match(facts.framework.story_plan, /المشكلة/);
  // نفس الزاوية مرة ثانية: رابط مختلف
  const again = await landing.generateLanding(project.id, { product_id: product.id, angle: 'هدية', framework: 'aida' });
  assert.equal(again.slug, 'thermos-mickey-cadeau-2');
  assert.throws(() => landing.deleteLanding(999999), /landing_not_found/);
  landing.deleteLanding(again.id);
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
  assert.equal(top.blocks[top.block_order[0]].type, 'hero');
  assert.match(top.blocks.text_2.settings.body, /^<p>ماذا يأخذ معه اليوم؟<\/p><p>/);
  assert.equal(Object.values(top.blocks).find((b) => b.type === 'benefits').settings.items, 'دافئ / حتى الاستراحة | المشروب يبقى ساخناً', 'a | inside a title cannot break the title | text split');
  assert.equal(Object.values(tpl.sections.lp_bottom.blocks).filter((b) => b.type === 'faq').length, 6);

  // الطلبيات تُنسب بالرابط النهائي: الصفحة مثبتة في «صفحات المتجر»
  const page = db.prepare('SELECT * FROM store_pages WHERE project_id = ? AND url LIKE ?').get(project.id, '%view=lp-thermos-mickey-cadeau%');
  assert.ok(page?.pinned);

  // إعادة النشر تحدّث التحويل نفسه (لا تكرار)
  await landing.publishLanding(l.id);
  assert.equal(redirects.length, 1);

  // السحب: حذف التحويل والقالب، والنص يبقى
  const off = await landing.unpublishLanding(l.id);
  assert.equal(off.status, 'unpublished');
  assert.equal(redirects.length, 0);
  assert.equal(files['templates/product.lp-thermos-mickey-cadeau.json'], undefined);
  assert.equal(off.copy.hero.headline, copy.hero.headline);
});

test('landing: a missing Shopify permission is named (redirects need write_online_store_navigation)', async () => {
  granted = ['write_themes'];
  const [l] = landing.listLandings([project.id]);
  await assert.rejects(landing.publishLanding(l.id), (e) => e.code === 'landing_scopes_missing:write_online_store_navigation');
  granted = ['write_themes', 'write_online_store_navigation'];
  assert.throws(() => landing.buildTemplate(l.copy, { sections: { main: { type: 'other' } } }), /landing_theme_unsupported/);
});
