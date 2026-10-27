import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { uploadPath } from '../server/integrations/images.js';
import { createProject } from '../server/services/projects.js';
import { createProduct } from '../server/services/products.js';
import * as delivery from '../server/services/delivery.js';
import * as landing from '../server/services/landing.js';

// ——— المتجر كما هو: جدول التوصيل في إعدادات القالب، صفحة الأسعار العامة، وصفحتا السياسات ———
const SHIPPING_TABLE = '01|أدرار|1200|700|\n04|أم البواقي|500|400|\n11|تمنراست|||\n16|الجزائر|700|450|\n19|سطيف|600|400|\n59|أفلو|900|500|';
const DELIVERY_PAGE = `<html><body><main><h1>أسعار التوصيل</h1><p class="rw-dtable__note">شركات التوصيل: Yalidine · Noest</p>
<table class="rw-table"><thead><tr><th scope="col">الرمز</th><th scope="col">الولاية</th><th scope="col">مكتب التوصيل</th><th scope="col">إلى المنزل</th></tr></thead>
<tbody><tr><td>01</td><th scope="row">أدرار</th><td>DA 700</td><td>DA 1,200</td></tr>
<tr><td>11</td><th scope="row">تمنراست</th><td><span>غير متوفر</span></td><td><span>غير متوفر</span></td></tr>
<tr><td>16</td><th scope="row">الجزائر</th><td>DA 450</td><td>DA 700</td></tr></tbody></table></main></body></html>`;
const REFUND_PAGE = `<html><body><main><div class="shopify-policy__container"><div class="shopify-policy__title"><h1>سياسة الاسترداد</h1></div>
<div class="shopify-policy__body"><div class="rte"><p><strong>سياسة الاسترجاع والاستبدال</strong></p><ol><li><p>المعاينة قبل الدفع</p><p>افتح الطرد أمام عامل التوصيل وتأكد من المنتج قبل أن تدفع.</p></li>
<li><p>يمكنك إرجاع المنتج غير المطابق خلال 4 أيام عمل. مصاريف الإرجاع على حسابنا &amp; نعيد المبلغ خلال 15 يوماً.</p></li></ol></div></div></div></main>
<a class="wa">واتساب</a></body></html>`;
const SHIPPING_POLICY = `<main><div class="shopify-policy__body"><div class="rte"><p>نوصل عبر Yalidine وNoest. مدة الوصول تختلف حسب الولاية، ونخبرك بالمدة المتوقعة عند التأكيد.</p></div></div></main>`;

// ——— Claude وهمي: نص الصفحة + خطة صور (7 لقطات، إحداها بنوع غير معروف) ———
const aiCalls = [];
const visuals = [
  {
    kind: 'hero',
    headline: 'رفيق طفلك كل صباح',
    points: ['ميكي وميني', 'حزام كتف'],
    scene: 'The thermos standing on a school desk next to a notebook, morning light.',
  },
  {
    kind: 'detail',
    headline: 'غطاء محكم لا يسرّب',
    points: ['إغلاق محكم'],
    scene: 'Macro close-up of the lid.',
  },
  {
    kind: 'in_use',
    headline: 'خفيف في اليد',
    points: [],
    scene: 'A child hand holding the thermos, no face.',
  },
  {
    kind: 'size',
    headline: '320 مل',
    points: ['يدخل في الحقيبة'],
    scene: 'Next to a school bag for scale.',
  },
  {
    kind: 'robot',
    headline: 'نوع غير معروف',
    points: [],
    scene: 'Studio shot.',
  },
  {
    kind: 'variants',
    headline: 'ميكي أو ميني',
    points: ['لونان'],
    scene: 'Both colors side by side.',
  },
  { kind: 'design', headline: 'زائدة تُحذف', points: [], scene: 'Seventh.' },
];
const copy = {
  product_short: 'thermos',
  angle_slug: 'cadeau',
  hero: {
    eyebrow: 'هدية',
    headline: 'هدية يستعملها طفلك كل يوم',
    subheadline: 'ترمس بتصميم ميكي وميني.',
    bullets: ['يحفظ الحرارة', 'حزام كتف', 'سهل الغسل'],
    cta: 'اطلب الآن',
    note: '',
  },
  story: [
    { stage: 'attention', heading: 'كل صباح', body: 'ماذا يأخذ معه اليوم؟' },
    { stage: 'interest', heading: 'لماذا هو', body: 'ستانلس ستيل 320 مل.' },
  ],
  benefits: {
    heading: 'الفوائد',
    items: [{ title: 'دافئ', text: 'حتى الاستراحة' }],
  },
  steps: {
    heading: 'كيف تطلب',
    items: ['املأ النموذج', 'نتصل بك', 'تدفع عند الاستلام'],
  },
  guarantee: { heading: 'مطمئن', items: ['المعاينة قبل الدفع'] },
  faq: [{ q: 'كم تستغرق مدة التوصيل؟', a: 'من 24 إلى 72 ساعة حسب الولاية.' }],
  final_cta: { headline: 'اطلبه اليوم', cta: 'اطلب الآن', note: '' },
  seo: { title: 'ترمس', description: 'ترمس' },
  owner_todo: [],
  visuals,
};

// ——— Shopify وهمي: القالب، الملفات (Staged upload + fileCreate)، التحويلات ———
let granted = ['write_themes', 'write_online_store_navigation', 'write_files'];
let themeReadable = true;
const files = {
  'config/settings_data.json': `/*\n * auto-generated\n */\n${JSON.stringify({ current: { shipping_table: SHIPPING_TABLE, free_shipping_threshold: 0 } })}`,
  'templates/product.json': JSON.stringify({
    sections: { main: { type: 'product-main', blocks: {}, settings: {} } },
    order: ['main'],
  }),
  'layout/theme.liquid': "<html><head>{{ content_for_header }}</head><body>{% sections 'header-group' %}{{ content_for_layout }}</body></html>",
};
const redirects = [];
const shopFiles = [];
const geminiCalls = [];
const geminiFailures = [];
// أجسام أخطاء Gemini كما يرسلها Google (429 RESOURCE_EXHAUSTED مع QuotaFailure وRetryInfo)
const quota = (metric, quotaId, limit, retry) => ({
  status: 429,
  body: {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: `You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/${metric}, limit: ${limit}, model: gemini-nano-banana-2.1`,
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: `generativelanguage.googleapis.com/${metric}`, quotaId }] },
        ...(retry ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] : []),
      ],
    },
  },
});
const denied = () => ({
  errors: [{ message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }],
});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (b) =>
    new Response(JSON.stringify(b), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const html = (b) => new Response(b, { status: 200, headers: { 'content-type': 'text/html' } });
  if (u.startsWith('http://anthropic.test')) {
    const body = JSON.parse(init.body);
    aiCalls.push(body);
    const isPlan = !body.output_config.format.schema.required.includes('hero');
    return json({
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [
        {
          type: 'text',
          text: JSON.stringify(isPlan ? { visuals: visuals.slice(0, 2) } : copy),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  }
  if (u === 'https://souqnna.example/pages/delivery') return html(DELIVERY_PAGE);
  if (u === 'https://souqnna.example/policies/refund-policy') return html(REFUND_PAGE);
  if (u === 'https://souqnna.example/policies/shipping-policy') return html(SHIPPING_POLICY);
  if (u.startsWith('https://cdn.example/'))
    return new Response(PNG, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  if (u.startsWith('https://generativelanguage.googleapis.com/')) {
    geminiCalls.push({ url: u, body: JSON.parse(init.body) });
    const fail = geminiFailures.shift();
    if (fail) return new Response(JSON.stringify(fail.body), { status: fail.status, headers: { 'content-type': 'application/json' } });
    return json({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: PNG.toString('base64'),
                },
              },
            ],
          },
        },
      ],
    });
  }
  if (u === 'https://staged.example/upload') return new Response(null, { status: 201 });
  const { query, variables } = JSON.parse(init.body);
  if (query.includes('currentAppInstallation'))
    return json({
      data: {
        currentAppInstallation: {
          accessScopes: granted.map((handle) => ({ handle })),
        },
      },
    });
  if (query.includes('themes(first: 1'))
    return json({
      data: {
        themes: {
          nodes: [{ id: 'gid://shopify/OnlineStoreTheme/1', name: 'sou9na' }],
        },
      },
    });
  if (query.includes('theme(id:')) {
    if (!themeReadable) return json(denied());
    return json({
      data: {
        theme: {
          files: {
            nodes: variables.f
              .filter((f) => f in files)
              .map((filename) => ({
                filename,
                body: { content: files[filename] },
              })),
          },
        },
      },
    });
  }
  if (query.includes('themeFilesUpsert')) {
    for (const f of variables.files) files[f.filename] = f.body.value;
    return json({
      data: {
        themeFilesUpsert: {
          upsertedThemeFiles: variables.files.map((f) => ({
            filename: f.filename,
          })),
          userErrors: [],
        },
      },
    });
  }
  if (query.includes('stagedUploadsCreate')) {
    if (!granted.includes('write_files')) return json(denied());
    return json({
      data: {
        stagedUploadsCreate: {
          stagedTargets: [
            {
              url: 'https://staged.example/upload',
              resourceUrl: `https://staged.example/r/${variables.input[0].filename}`,
              parameters: [{ name: 'key', value: 'k' }],
            },
          ],
          userErrors: [],
        },
      },
    });
  }
  if (query.includes('fileCreate')) {
    const f = variables.files[0];
    const id = `gid://shopify/MediaImage/${shopFiles.length + 1}`;
    shopFiles.push({ id, ...f });
    // أول مرة: الصورة ما زالت تُعالج (الرابط يأتي من استعلام node)
    return json({
      data: {
        fileCreate: {
          files: [{ id, fileStatus: 'UPLOADED', image: null }],
          userErrors: [],
        },
      },
    });
  }
  if (query.includes('node(id:')) {
    const f = shopFiles.find((x) => x.id === variables.id);
    return json({
      data: {
        node: {
          id: f.id,
          fileStatus: 'READY',
          image: {
            url: `https://cdn.shopify.com/s/files/1/files/${f.filename}?v=1`,
            width: 928,
            height: 1152,
          },
        },
      },
    });
  }
  if (query.includes('urlRedirects('))
    return json({
      data: {
        urlRedirects: {
          nodes: redirects.filter((r) => variables.q === `path:${r.path}`),
        },
      },
    });
  if (query.includes('urlRedirectCreate')) {
    const r = {
      id: `gid://shopify/UrlRedirect/${redirects.length + 1}`,
      ...variables.r,
    };
    redirects.push(r);
    return json({
      data: { urlRedirectCreate: { urlRedirect: r, userErrors: [] } },
    });
  }
  if (query.includes('urlRedirectUpdate')) {
    const r = redirects.find((x) => x.id === variables.id);
    Object.assign(r, variables.r);
    return json({
      data: { urlRedirectUpdate: { urlRedirect: r, userErrors: [] } },
    });
  }
  throw new Error(`unexpected ${u} ${query?.slice(0, 60)}`);
};

process.env.ANTHROPIC_BASE_URL = 'http://anthropic.test';
setSetting('anthropic_api_key', 'sk-test-visuals');
setSetting('image_provider', 'gemini');
setSetting('gemini_api_key', 'gm-test');
const project = createProject({
  name: 'Delivery shop',
  domain: 'souqnna.example',
});
setSetting('shopify_shop', 'delivery-test.myshopify.com', project.id);
setSetting('shopify_access_token', 'shpat_test', project.id);
const product = createProduct(project.id, {
  title: 'ترمس أطفال ميكي وميني 320 مل',
  handle: 'thermos-mickey-320',
  price: 2900,
  images: [
    { url: 'https://cdn.example/p1.jpg', alt: '' },
    { url: 'https://cdn.example/p2.jpg', alt: '' },
  ],
});

const created = [];
after(() => {
  for (const url of created) {
    const f = uploadPath(url);
    if (f && fs.existsSync(f)) fs.unlinkSync(f);
  }
});

test('delivery: prices come from the theme’s own shipping table, policies from the store’s public pages', async () => {
  const d = await delivery.importDelivery(project.id);
  assert.equal(d.source, 'theme');
  assert.equal(d.rates.length, 6);
  assert.deepEqual(
    d.rates.find((r) => r.code === 11),
    { code: 11, name: 'تمنراست', home: null, desk: null, eta: '' },
    'empty price = not served, never free',
  );
  assert.equal(d.summary.served, 4, 'counted on 58 wilayas like the theme (59 is shipped as its parent)');
  assert.deepEqual(d.summary.not_served, ['تمنراست']);
  assert.deepEqual(d.summary.desk, { min: 400, max: 700 });
  assert.deepEqual(d.summary.home, { min: 500, max: 1200 });
  assert.equal(d.carriers, 'Yalidine · Noest', 'carriers read from the public delivery page');
  assert.match(d.policies.refund, /افتح الطرد أمام عامل التوصيل/);
  assert.match(d.policies.refund, /على حسابنا & نعيد/, 'entities decoded');
  assert.doesNotMatch(d.policies.refund, /واتساب/, 'only the policy body');
  assert.match(d.policies.shipping, /نخبرك بالمدة المتوقعة/);
  assert.equal(d.measured.enough, false);

  // دون read_themes: جدول الصفحة العامة
  themeReadable = false;
  const fromPage = await delivery.importDelivery(project.id);
  themeReadable = true;
  assert.equal(fromPage.source, 'page');
  assert.deepEqual(
    fromPage.rates.map((r) => [r.code, r.desk, r.home]),
    [
      [1, 700, 1200],
      [11, null, null],
      [16, 450, 700],
    ],
  );
  await delivery.importDelivery(project.id);

  const set = delivery.updateDelivery(project.id, {
    delivery_time: '  من 24 إلى 72 ساعة   حسب الولاية ',
  });
  assert.equal(set.delivery_time, 'من 24 إلى 72 ساعة حسب الولاية');
});

test('landing: the writer gets the real delivery facts and plans descriptive visuals (trimmed to 6, unknown kinds fixed)', async () => {
  const l = await landing.generateLanding(project.id, {
    product_id: product.id,
    angle: 'هدية',
    framework: 'aida',
  });
  const sent = aiCalls.at(-1);
  assert.match(sent.system, /wilayas_served/);
  assert.match(sent.system, /12\. visuals/);
  const facts = JSON.parse(sent.messages[0].content.at(-1).text.match(/\{[\s\S]*\}/)[0]);
  assert.equal(facts.delivery.wilayas_served, 4);
  assert.equal(facts.delivery.desk_price_from_da, 400);
  assert.equal(facts.delivery.delivery_time, 'من 24 إلى 72 ساعة حسب الولاية');
  assert.match(facts.delivery.returns_policy, /4 أيام عمل/);
  assert.ok(sent.output_config.format.schema.required.includes('visuals'));
  assert.equal(l.visuals.length, 6);
  assert.deepEqual(
    l.visuals.map((v) => v.id),
    ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
  );
  assert.equal(l.visuals[4].kind, 'feature');
  assert.ok(l.visuals.every((v) => v.approved && !v.image));
});

test('visuals: drawn from the real product photos, portrait, no text; reviewed; uploaded once to Shopify Files on publish', async () => {
  const [l] = landing.listLandings([project.id]);
  const one = await landing.generateVisual(l.id, 'v1');
  const call = geminiCalls.at(-1);
  assert.match(call.url, /models\/gemini-nano-banana-2\.1:generateContent/);
  const parts = call.body.contents[0].parts;
  assert.equal(parts.filter((p) => p.inline_data).length, 2, 'both product photos as references');
  assert.ok(parts.at(-1).text, 'photos first, then the instructions');
  assert.match(parts.at(-1).text, /Do not write any text/);
  assert.match(parts.at(-1).text, /same shape, proportions, colors/);
  assert.match(parts.at(-1).text, /school desk/);
  assert.deepEqual(call.body.generationConfig.imageConfig, {
    aspectRatio: '4:5',
    imageSize: '1K',
  });
  const v1 = one.visuals.find((v) => v.id === 'v1');
  assert.match(v1.image, /^\/uploads\//);
  created.push(v1.image);
  assert.ok(fs.existsSync(uploadPath(v1.image)));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM creatives WHERE product_id = ?').get(product.id).n, 1, 'kept in the product creatives too');

  const two = await landing.generateVisual(l.id, 'v2');
  created.push(two.visuals.find((v) => v.id === 'v2').image);
  // التاجر يخفي لقطة ويعدّل عنوان أخرى
  landing.updateVisual(l.id, 'v2', { approved: false });
  const edited = landing.updateVisual(l.id, 'v1', {
    headline: 'رفيقه في المدرسة',
    points: 'ميكي وميني\nحزام كتف\nخفيف\nرابعة تُحذف',
  });
  assert.deepEqual(edited.visuals[0].points, ['ميكي وميني', 'حزام كتف', 'خفيف']);
  assert.throws(() => landing.updateVisual(l.id, 'v9', { approved: true }), /visual_not_found/);

  // دون write_files: الصلاحية الناقصة تُسمّى
  granted = ['write_themes', 'write_online_store_navigation'];
  await assert.rejects(landing.publishLanding(l.id), (e) => e.code === 'landing_scopes_missing:write_files');
  granted = ['write_themes', 'write_online_store_navigation', 'write_files'];

  const out = await landing.publishLanding(l.id);
  assert.equal(out.status, 'published');
  assert.equal(shopFiles.length, 1, 'only the approved, drawn visual is uploaded');
  assert.equal(shopFiles[0].filename, `lp-${l.slug}-v1.png`);
  assert.equal(shopFiles[0].contentType, 'IMAGE');
  assert.equal(out.visuals[0].shopify_url, `https://cdn.shopify.com/s/files/1/files/lp-${l.slug}-v1.png?v=1`);

  const tpl = JSON.parse(files[`templates/product.lp-${l.slug}.json`]);
  const top = Object.values(tpl.sections.lp_top.blocks);
  assert.equal(top[0].type, 'hero');
  assert.equal(top[0].settings.image_url, out.visuals[0].shopify_url, 'the hero shows the descriptive visual, not the plain photo');
  assert.ok(!top.some((b) => b.type === 'images'), 'drawn visuals replace the original photos above the form');
  const bottom = Object.values(tpl.sections.lp_bottom.blocks);
  const ship = bottom.find((b) => b.type === 'delivery');
  assert.deepEqual(ship.settings, {
    heading: 'التوصيل والدفع',
    carriers: 'Yalidine · Noest',
    time: 'من 24 إلى 72 ساعة حسب الولاية',
    served: 4,
    desk_from: 400,
    home_from: 500,
  });
  const section = files['sections/erp-lp.liquid'];
  assert.match(section, /when 'visual'/);
  assert.match(section, /settings\.shipping_table/, 'prices computed from the theme table at render time');
  assert.match(section, /"type": "delivery"/);

  // إعادة النشر لا تعيد رفع الصورة
  await landing.publishLanding(l.id);
  assert.equal(shopFiles.length, 1);

  // صورة بلقطة ثانية بعد الرسم والموافقة: تُرفع وحدها وتظهر بين الفقرات
  landing.updateVisual(l.id, 'v2', { approved: true });
  await landing.publishLanding(l.id);
  assert.equal(shopFiles.length, 2);
  const tpl2 = JSON.parse(files[`templates/product.lp-${l.slug}.json`]);
  const order = tpl2.sections.lp_top.block_order.map((k) => tpl2.sections.lp_top.blocks[k].type);
  assert.deepEqual(order.slice(0, 3), ['hero', 'text', 'visual']);
});

test('visuals: a draft from before visuals gets a plan on demand; no product photo = clear error', async () => {
  const bare = createProduct(project.id, {
    title: 'منتج بلا صور',
    handle: 'no-photos',
    price: 1000,
  });
  const l = await landing.generateLanding(project.id, {
    product_id: bare.id,
    angle: 'التوفير',
  });
  db.prepare("UPDATE landing_pages SET visuals = '[]' WHERE id = ?").run(l.id);
  const planned = await landing.planVisuals(l.id);
  assert.equal(planned.visuals.length, 2);
  await assert.rejects(landing.generateVisual(l.id, 'v1'), /visual_needs_product_photos/);
});

test('gemini errors say what to do: free tier (limit 0) is a billing problem, a per-minute limit is retried once', async () => {
  const l = landing.listLandings([project.id]).find((x) => x.product_id === product.id);
  geminiFailures.push(quota('generate_content_free_tier_requests', 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', 0, '30s'));
  const calls = geminiCalls.length;
  await assert.rejects(landing.generateVisual(l.id, 'v3'), (e) => e.message === 'gemini: gemini_free_tier' && e.kind === 'config');
  assert.equal(geminiCalls.length, calls + 1, 'a free-tier zero limit is never retried');

  geminiFailures.push(quota('generate_content_paid_tier_requests', 'GenerateRequestsPerMinutePerProjectPerModel', 10, '1s'));
  const ok = await landing.generateVisual(l.id, 'v3');
  assert.equal(geminiCalls.length, calls + 3, 'per-minute limit: waits retryDelay, then one retry');
  created.push(ok.visuals.find((v) => v.id === 'v3').image);

  geminiFailures.push(quota('generate_content_paid_tier_requests', 'GenerateRequestsPerDayPerProjectPerModel', 250, null));
  await assert.rejects(landing.generateVisual(l.id, 'v4'), (e) => e.message === 'gemini: gemini_daily_quota');
  geminiFailures.push({ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } } });
  await assert.rejects(landing.generateVisual(l.id, 'v4'), (e) => e.message === 'gemini: gemini_key_invalid');
});
