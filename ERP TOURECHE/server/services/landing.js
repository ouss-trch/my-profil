import { db, parseJson } from '../db/index.js';
import * as ai from '../integrations/ai.js';
import * as shopify from '../integrations/shopify.js';
import { projectConfig } from '../lib/settings.js';
import { HttpError, badRequest, escapeHtml, nowIso, slugify } from '../lib/util.js';
import { getProduct, imageBlocks } from './products.js';
import { getProject, inList } from './projects.js';
import { addPages, storeBase } from './pages.js';

/**
 * صفحات الهبوط: منتج واحد + زاوية تسويقية + إطار كتابة (AIDA، PAS…) → صفحة بيع دون قائمة ولا تذييل،
 * بنفس نموذج الطلب والعروض التي في صفحة المنتج (شرط Meta: نفس المنتج ونفس العرض).
 *
 * التنفيذ على Shopify (دون لمس كود النموذج):
 *  - قالب منتج مستقل templates/product.lp-<slug>.json بتخطيط layout/erp-landing.liquid (theme.liquid دون الرأس والتذييل)
 *    وقسم sections/erp-lp.liquid للنصوص، يمكن تعديلها لاحقاً من محرر القالب في Shopify؛
 *  - رابط الإعلان ‎/pages/<slug>‎ تحويلة Shopify إلى ‎/products/<handle>?view=lp-<slug>‎ (Shopify لا يقبل «/» داخل اسم الصفحة).
 */

export const FRAMEWORKS = {
  aida: {
    label: ['AIDA: انتباه ← اهتمام ← رغبة ← طلب', 'AIDA : attention → intérêt → désir → action'],
    when: ['جمهور بارد لا يعرف المنتج (أغلب إعلانات Facebook)', 'Audience froide (la plupart des pubs Facebook)'],
    story: 'ثلاث فقرات: (1) انتباه: موقف يومي يعرفه الزبون يربطه بالزاوية؛ (2) اهتمام: كيف يعمل المنتج وما الذي يميّزه بمعلومات محددة؛ (3) رغبة: الصورة بعد الشراء، كيف يتغير اليوم أو الموقف.',
  },
  pas: {
    label: ['PAS: المشكلة ← تضخيمها ← الحل', 'PAS : problème → agitation → solution'],
    when: ['جمهور يعرف المشكلة ويبحث عن حل', 'Audience consciente du problème'],
    story: 'ثلاث فقرات: (1) المشكلة: سمّها كما يعيشها الزبون بموقف ملموس؛ (2) تضخيمها: ما الذي تكلّفه من وقت أو مال أو راحة إن بقيت، دون تخويف أو مبالغة؛ (3) الحل: المنتج وكيف يحلها تحديداً.',
  },
  bab: {
    label: ['BAB: قبل ← بعد ← الجسر', 'BAB : avant → après → pont'],
    when: ['منتج يغيّر روتيناً أو موقفاً يومياً', 'Produit qui change une routine'],
    story: 'ثلاث فقرات: (1) قبل: الوضع الحالي كما هو؛ (2) بعد: نفس الموقف والمنتج معك (واقعي، دون وعود بنتائج مضمونة)؛ (3) الجسر: المنتج وما يجعله ممكناً.',
  },
  fab: {
    label: ['FAB: خاصية ← ميزة ← فائدة', 'FAB : caractéristique → avantage → bénéfice'],
    when: ['منتج تقني أو بمواصفات تحتاج شرحاً', 'Produit technique, à expliquer'],
    story: 'فقرتان أو ثلاث: كل فقرة تأخذ خاصية حقيقية من المعطيات ← ماذا تعني ← ما الذي يربحه الزبون منها في حياته.',
  },
  fourp: {
    label: ['4P: وعد ← صورة ← دليل ← دفعة', '4P : promesse → image → preuve → poussée'],
    when: ['جمهور متردد يحتاج ثقة قبل الشراء', 'Audience hésitante, besoin de confiance'],
    story: 'ثلاث فقرات: (1) الوعد: الفائدة الأساسية بجملة واضحة؛ (2) الصورة: الزبون يستعمل المنتج في موقف محدد؛ (3) الدليل: حقائق من المعطيات فقط (المادة، المقاس، سياسة المعاينة والاستبدال) — لا آراء ولا أرقام مختلقة.',
  },
  fomo: {
    label: ['FOMO الصادق: عرض حقيقي لا يُفوَّت', 'FOMO honnête : offre réelle'],
    when: ['منتج عليه عرض كمية حقيقي أو مخزون قليل فعلاً', 'Offre quantité réelle ou stock vraiment bas'],
    story: 'ثلاث فقرات: (1) لماذا الآن: العرض الحقيقي الموجود في المعطيات (عرض الكمية) وما يوفّره بالدينار؛ (2) الفائدة اليومية من المنتج؛ (3) إن كان المخزون قليلاً في المعطيات اذكر العدد الحقيقي، وإلا ركّز على سهولة الطلب والدفع عند الاستلام. ممنوع العدّاد التنازلي و«العرض ينتهي الليلة» وأي ندرة غير موجودة في المعطيات.',
  },
};

export const ANGLE_PRESETS = [
  ['هدية', 'cadeau'],
  ['المشكلة والحل', 'solution'],
  ['الاستعمال اليومي', 'quotidien'],
  ['الجودة مقابل السعر', 'qualite-prix'],
  ['للأطفال والعائلة', 'famille'],
  ['التوفير', 'economie'],
];

const TONES = {
  ar: 'العربية الفصحى المبسّطة القريبة من الزبون الجزائري (جمل قصيرة، كلمات يومية).',
  darija: 'الدارجة الجزائرية مكتوبة بالحروف العربية بشكل طبيعي ومحترم، مع كلمات فرنسية شائعة عند الحاجة.',
};

/** القواعد: من أُطر الكتابة المجرّبة (AIDA، PAS، BAB، FAB، 4P) + معايير Meta للإعلانات + خصوصية الدفع عند الاستلام في الجزائر */
export function landingSystem(brand) {
  return `أنت كاتب صفحات هبوط (Landing pages) محترف لمتجر «${brand}» الجزائري الذي يبيع بالدفع عند الاستلام.
تكتب صفحة بيع لمنتج واحد، هدفها الوحيد: أن يملأ الزائر نموذج الطلب. الزائر يأتي من إعلان Facebook/Instagram بزاوية تسويقية محددة.

قواعد إلزامية (أي مخالفة تُرفض):
1. هدف واحد: كل جملة تخدم الطلب. لا روابط لصفحات أخرى ولا منتجات أخرى.
2. تطابق الرسالة: العنوان الرئيسي يعبّر عن الزاوية المطلوبة حرفياً تقريباً، لأن الإعلان مبني عليها.
3. الصدق التام: استعمل فقط الحقائق الموجودة في المعطيات. ممنوع اختلاق: أرقام، نسب، عدد زبائن، تقييمات، آراء زبائن، جوائز، شهادات، مواد أو مقاسات غير مذكورة، أو مدة توصيل غير مذكورة. إن نقصت معلومة يحتاجها الزبون فاكتب أنها تُؤكَّد عند اتصال التأكيد، وأضفها في owner_todo.
4. سياسة Meta: لا ادعاءات صحية أو علاجية، لا «قبل/بعد» بنتائج مضمونة، لا مخاطبة صفات شخصية للزائر (مثل: «هل أنت سمين؟»، «هل تعاني من…؟» عن جسده)، لا عدّاد تنازلي، لا «آخر قطع» أو «ينتهي اليوم» إلا إن كان المخزون الحقيقي في المعطيات قليلاً فتذكر رقمه كما هو. العرض في الصفحة هو نفس العروض المذكورة في المعطيات بالضبط.
5. الدفع عند الاستلام يطمئن: اذكر الدفع عند الاستلام، والتوصيل إلى الولايات، واتصال التأكيد قبل الشحن، وسياسات المتجر المذكورة في المعطيات (المعاينة، الاستبدال) بصياغتها دون زيادة.
6. الفائدة قبل الخاصية: كل خاصية تُترجم إلى ما يربحه الزبون في يومه.
7. الأسلوب: ${'{tone}'} جمل قصيرة، فقرة لا تتجاوز سطرين على الهاتف، بلا مبالغة ولا علامات تعجب متتالية ولا رموز تعبيرية.
8. الطول: العنوان الرئيسي 6–12 كلمة. العنوان الفرعي جملة أو جملتان. 3 نقاط في الأعلى. 3 إلى 5 فوائد. 3 خطوات طلب. 2 إلى 4 ضمانات. 4 إلى 6 أسئلة شائعة عن اعتراضات حقيقية (التوصيل، الدفع، المعاينة، الاستبدال، المقاس/اللون، الاستعمال) بأجوبة من المعطيات فقط.
9. زر الطلب فعل واضح (مثال: «اطلب الآن وادفع عند الاستلام»).
10. product_short و angle_slug: كلمة أو كلمتان بالحروف اللاتينية الصغيرة فقط (a-z و0-9 و-)، لرابط مثل ‎/pages/thermos-cadeau‎.
11. seo: عنوان حتى 60 حرفاً ووصف حتى 155 حرفاً.

الإطار المطلوب للفقرات (story) يُعطى مع المعطيات؛ اتبعه بالترتيب، وstage لكل فقرة هو اسم مرحلتها.`;
}

const s = { type: 'string' };
const sArr = { type: 'array', items: s };
export const LANDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['product_short', 'angle_slug', 'hero', 'story', 'benefits', 'steps', 'guarantee', 'faq', 'final_cta', 'seo', 'owner_todo'],
  properties: {
    product_short: s,
    angle_slug: s,
    hero: { type: 'object', additionalProperties: false, required: ['eyebrow', 'headline', 'subheadline', 'bullets', 'cta', 'note'], properties: { eyebrow: s, headline: s, subheadline: s, bullets: sArr, cta: s, note: s } },
    story: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['stage', 'heading', 'body'], properties: { stage: s, heading: s, body: s } } },
    benefits: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: { heading: s, items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: { title: s, text: s } } } } },
    steps: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: { heading: s, items: sArr } },
    guarantee: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: { heading: s, items: sArr } },
    faq: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { q: s, a: s } } },
    final_cta: { type: 'object', additionalProperties: false, required: ['headline', 'cta', 'note'], properties: { headline: s, cta: s, note: s } },
    seo: { type: 'object', additionalProperties: false, required: ['title', 'description'], properties: { title: s, description: s } },
    owner_todo: sArr,
  },
};

// ——— المعطيات الحقيقية من القالب: العروض وسياسات المتجر كما تظهر في صفحة المنتج ———
export const parseTemplate = (content) => JSON.parse(String(content || '').replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ''));

function walkBlocks(node, fn) {
  for (const b of Object.values(node?.blocks || {})) {
    fn(b);
    walkBlocks(b, fn);
  }
}

export function templateFacts(tpl) {
  const offers = [];
  const policies = [];
  for (const sec of Object.values(tpl?.sections || {})) {
    if (sec.disabled) continue;
    walkBlocks(sec, (b) => {
      if (b.disabled) return;
      const st = b.settings || {};
      if (b.type === '_offer') offers.push({ title: st.title || '', subtitle: st.subtitle || '', quantity: st.quantity || 1, discount_type: st.discount_type || 'none', value: st.value || 0, free_shipping: Boolean(st.free_shipping) });
      if (b.type === '_trust-line' && st.text) policies.push(st.text);
      if (b.type === '_trust-item' && st.title) policies.push(st.text ? `${st.title}: ${st.text}` : st.title);
    });
  }
  return { offers, policies: [...new Set(policies)] };
}

async function mainTemplate(cfg) {
  const theme = await shopify.mainTheme(cfg);
  if (!theme) throw new HttpError(404, 'theme_not_found');
  const [file] = await shopify.themeFiles(cfg, theme.id, ['templates/product.json']);
  if (!file?.content) throw new HttpError(409, 'landing_theme_unsupported');
  return { theme, tpl: parseTemplate(file.content) };
}

/** بعد رفض Shopify: أي الصلاحيات تنقص لصفحات الهبوط؟ */
async function scopesError(cfg, e) {
  if (!/access_denied/.test(e.message)) return e;
  const granted = await shopify.grantedScopes(cfg).catch(() => null);
  const missing = granted ? ['read_themes', 'write_themes', 'write_online_store_navigation'].filter((x) => !shopify.hasScope(granted, x)) : null;
  return new HttpError(403, missing?.length ? `landing_scopes_missing:${missing.join(' + ')}` : 'theme_write_refused', null, { missing_scopes: missing });
}

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const latin = (v, n) => slugify(v, n);

function cleanCopy(c) {
  const list = (a, n, max) => (Array.isArray(a) ? a : []).map((x) => clip(x, max)).filter(Boolean).slice(0, n);
  return {
    hero: { eyebrow: clip(c.hero?.eyebrow, 80), headline: clip(c.hero?.headline, 140), subheadline: clip(c.hero?.subheadline, 300), bullets: list(c.hero?.bullets, 4, 140), cta: clip(c.hero?.cta, 60) || 'اطلب الآن', note: clip(c.hero?.note, 140) },
    story: (c.story || []).slice(0, 4).map((x) => ({ stage: clip(x.stage, 40), heading: clip(x.heading, 120), body: String(x.body || '').trim().slice(0, 900) })).filter((x) => x.body),
    benefits: { heading: clip(c.benefits?.heading, 120), items: (c.benefits?.items || []).slice(0, 5).map((x) => ({ title: clip(x.title, 80).replace(/\|/g, '/'), text: clip(x.text, 220) })).filter((x) => x.title) },
    steps: { heading: clip(c.steps?.heading, 120), items: list(c.steps?.items, 4, 160) },
    guarantee: { heading: clip(c.guarantee?.heading, 120), items: list(c.guarantee?.items, 4, 180) },
    faq: (c.faq || []).slice(0, 6).map((x) => ({ q: clip(x.q, 160), a: clip(x.a, 400) })).filter((x) => x.q && x.a),
    final_cta: { headline: clip(c.final_cta?.headline, 140), cta: clip(c.final_cta?.cta, 60) || 'اطلب الآن', note: clip(c.final_cta?.note, 160) },
    seo: { title: clip(c.seo?.title, 70), description: clip(c.seo?.description, 160) },
    owner_todo: list(c.owner_todo, 8, 200),
  };
}

function uniqueSlug(projectId, base, ignoreId = 0) {
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM landing_pages WHERE project_id = ? AND slug = ? AND id != ?').get(projectId, slug, ignoreId); i++) slug = `${base}-${i}`;
  return slug;
}

const hydrate = (r) => (r ? { ...r, copy: parseJson(r.copy, {}) } : null);

export function getLanding(id) {
  const r = hydrate(db.prepare('SELECT l.*, p.title AS product_title, p.handle AS product_handle FROM landing_pages l JOIN products p ON p.id = l.product_id WHERE l.id = ?').get(id));
  if (!r) throw new HttpError(404, 'landing_not_found');
  const base = storeBase(r.project_id);
  return { ...r, public_url: r.public_path && base ? `${base}${r.public_path}` : null };
}

export function listLandings(projectIds) {
  return db
    .prepare(`SELECT l.id FROM landing_pages l WHERE l.project_id IN (${inList(projectIds)}) ORDER BY l.id DESC`)
    .all(...projectIds)
    .map((r) => getLanding(r.id));
}

/** توليد النصوص (مسودة، لا شيء يُكتب في Shopify بعد) */
export async function generateLanding(projectId, input, userId = null) {
  const p = getProduct(Number(input.product_id));
  if (p.project_id !== projectId) throw new HttpError(404, 'product_not_found');
  if (!p.handle) throw badRequest('landing_product_not_on_shopify');
  const angle = clip(input.angle, 80);
  if (!angle) throw badRequest('landing_angle_required');
  const framework = FRAMEWORKS[input.framework] ? input.framework : 'aida';
  const tone = TONES[input.tone] ? input.tone : 'ar';
  const cfg = projectConfig(projectId);
  const brand = cfg.brand_name || getProject(projectId).name;
  let facts = { offers: [], policies: [] };
  if (shopify.isConfigured(cfg)) facts = await mainTemplate(cfg).then(({ tpl }) => templateFacts(tpl)).catch(() => facts);
  const managed = p.stock !== null && p.stock !== undefined;
  const data = {
    product: {
      title: p.title,
      price_da: p.price,
      compare_at_price_da: p.compare_at_price && p.compare_at_price > p.price ? p.compare_at_price : null,
      description_text: String(p.description_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000),
      specs: p.specs,
      notes: p.notes,
      options: p.options,
      variants: (p.variants || []).map((v) => v.title).filter((t) => t && t !== 'Default Title'),
      // مخزون قليل فعلاً = ندرة حقيقية يجوز ذكرها برقمها؛ غير ذلك لا ندرة
      real_low_stock: managed && p.stock > 0 && p.stock <= Math.max(5, p.low_stock || 0) ? p.stock : null,
    },
    store_offers: facts.offers,
    store_policies: [...facts.policies, 'الدفع عند الاستلام', 'التوصيل إلى المنزل أو مكتب شركة التوصيل في الولايات', 'فريقنا يتصل لتأكيد الطلب قبل الشحن'],
    angle,
    audience: clip(input.audience || p.audience, 200) || null,
    framework: { id: framework, story_plan: FRAMEWORKS[framework].story },
  };
  const images = await imageBlocks(p.images, 4).catch(() => []);
  const raw = await ai.structured({
    system: landingSystem(brand).replace('{tone}', TONES[tone]),
    prompt: `المعطيات (JSON):\n${JSON.stringify(data, null, 2)}\n\n${input.instructions ? `تعليمات إضافية من التاجر: ${clip(input.instructions, 500)}\n\n` : ''}اكتب صفحة الهبوط كاملة حسب القواعد والإطار.`,
    schema: LANDING_SCHEMA,
    effort: 'medium',
    images,
  });
  const copy = cleanCopy(raw);
  // الرابط: ما كتبه التاجر، وإلا «المنتج-الزاوية» كما تقترحه الواجهة (مقبض لاتيني + زاوية جاهزة)، وإلا اقتراح Claude
  const handlePart = /^[a-z0-9-]+$/.test(p.handle) ? p.handle.split('-').slice(0, 2).join('-') : '';
  const anglePart = ANGLE_PRESETS.find(([ar]) => ar === angle)?.[1] || '';
  const base = latin(input.slug, 40) || latin(`${handlePart || latin(raw.product_short, 20) || 'produit'}-${anglePart || latin(raw.angle_slug, 18) || latin(angle, 18) || framework}`, 40);
  const slug = uniqueSlug(projectId, base);
  const now = nowIso();
  const info = db
    .prepare('INSERT INTO landing_pages (project_id, product_id, slug, angle, framework, tone, audience, copy, status, model, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(projectId, p.id, slug, angle, framework, tone, data.audience, JSON.stringify(copy), 'draft', ai.model(), userId, now, now);
  return getLanding(info.lastInsertRowid);
}

/** تعديل النص أو الرابط قبل النشر (أو بعده ثم إعادة النشر) */
export function updateLanding(id, input) {
  const cur = getLanding(id);
  const copy = input.copy ? cleanCopy({ ...cur.copy, ...input.copy }) : cur.copy;
  const slug = input.slug !== undefined ? uniqueSlug(cur.project_id, latin(input.slug, 40) || cur.slug, id) : cur.slug;
  db.prepare('UPDATE landing_pages SET copy = ?, slug = ?, angle = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(copy), slug, clip(input.angle, 80) || cur.angle, nowIso(), id);
  return getLanding(id);
}

// ——— ملفات القالب ———
const paragraphs = (t) =>
  String(t || '')
    .split(/\r?\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => `<p>${escapeHtml(x)}</p>`)
    .join('');

/** قالب صفحة الهبوط: قسم النصوص في الأعلى ← قسم المنتج نفسه (المعرض، السعر، العروض، النموذج) ← الضمانات والأسئلة */
export function buildTemplate(copy, productTpl) {
  const main = structuredClone(productTpl?.sections?.main);
  if (!main || main.type !== 'product-main') throw new HttpError(409, 'landing_theme_unsupported');
  main.settings = { ...(main.settings || {}), layout: 'stack', show_breadcrumb: false, show_sticky: true };
  // الوصف الطويل يحلّ محله نص الصفحة: صفحة مركّزة على الطلب
  walkBlocks(main, (b) => {
    if (b.type === '_pdp-description') b.disabled = true;
  });
  let n = 0;
  const block = (type, settings) => [`${type}_${++n}`, { type, settings }];
  const top = [
    block('hero', { eyebrow: copy.hero.eyebrow, headline: copy.hero.headline, subheadline: copy.hero.subheadline, bullets: copy.hero.bullets.join('\n'), cta: copy.hero.cta, note: copy.hero.note, show_image: true }),
    ...copy.story.map((x, i) => block('text', { heading: x.heading, body: paragraphs(x.body) || `<p>${escapeHtml(x.body)}</p>`, tone: i % 2 ? 'soft' : 'plain' })),
    block('images', { offset: 1, count: 3 }),
    ...(copy.benefits.items.length ? [block('benefits', { heading: copy.benefits.heading, items: copy.benefits.items.map((x) => `${x.title} | ${x.text}`).join('\n') })] : []),
    ...(copy.steps.items.length ? [block('steps', { heading: copy.steps.heading, items: copy.steps.items.join('\n') })] : []),
  ];
  const bottom = [
    ...(copy.guarantee.items.length ? [block('guarantee', { heading: copy.guarantee.heading, items: copy.guarantee.items.join('\n') })] : []),
    ...copy.faq.map((x) => block('faq', { q: x.q, a: x.a })),
    block('cta', { headline: copy.final_cta.headline, cta: copy.final_cta.cta, note: copy.final_cta.note }),
  ];
  const section = (list) => ({ type: 'erp-lp', blocks: Object.fromEntries(list), block_order: list.map(([id]) => id), settings: {} });
  return { layout: 'erp-landing', sections: { lp_top: section(top), main, lp_bottom: section(bottom) }, order: ['lp_top', 'main', 'lp_bottom'] };
}

/** تخطيط صفحات الهبوط: theme.liquid نفسه دون الرأس والتذييل وزر واتساب (لا مخارج من الصفحة) */
export function landingLayout(themeLayout) {
  const src = String(themeLayout || '');
  if (!src.includes('content_for_header') || !src.includes('content_for_layout')) throw new HttpError(409, 'landing_theme_unsupported');
  const out = src
    .replace(/\{%-?\s*render\s+'erp-split'\s*-?%\}(?:[ \t]*%\})+/g, "{% render 'erp-split' %}")
    .replace(/^[ \t]*\{%-?\s*sections?\s+'(?:header-group|footer-group|header|footer|announcement-bar)'\s*-?%\}[ \t]*\r?\n?/gm, '')
    .replace(/^[ \t]*\{%-?\s*render\s+'whatsapp-button'\s*-?%\}[ \t]*\r?\n?/gm, '');
  return `{%- comment -%} ERP TOURECHE · تخطيط صفحات الهبوط: theme.liquid دون الرأس والتذييل. يُعاد توليده عند النشر من الـ ERP. {%- endcomment -%}\n${out}`;
}

export function sectionLiquid() {
  return `{%- comment -%}
  ERP TOURECHE · نصوص صفحة الهبوط (كتبها الـ ERP، ويمكن تعديلها هنا). في قوالب المنتج فقط: الصورة والسعر من منتج الصفحة نفسه.
{%- endcomment -%}
{%- assign lp_v = product.selected_or_first_available_variant -%}
<div class="erp-lp" data-erp-lp>
  {%- for block in section.blocks -%}
    {%- case block.type -%}
      {%- when 'hero' -%}
        <header class="erp-lp__hero" {{ block.shopify_attributes }}>
          {%- if block.settings.eyebrow != blank -%}<p class="erp-lp__eyebrow">{{ block.settings.eyebrow | escape }}</p>{%- endif -%}
          <h1 class="erp-lp__h1">{{ block.settings.headline | escape }}</h1>
          {%- if block.settings.subheadline != blank -%}<p class="erp-lp__lead">{{ block.settings.subheadline | escape }}</p>{%- endif -%}
          {%- if block.settings.show_image and product.featured_media -%}
            <div class="erp-lp__media">{{ product.featured_media | image_url: width: 1100 | image_tag: widths: '400, 700, 1100', sizes: '(min-width: 760px) 720px, 100vw', loading: 'eager', fetchpriority: 'high', alt: product.title }}</div>
          {%- endif -%}
          {%- assign lines = block.settings.bullets | newline_to_br | split: '<br />' -%}
          <ul class="erp-lp__ticks">{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ul>
          <p class="erp-lp__price"><b>{{ lp_v.price | money_without_trailing_zeros }}</b>{%- if lp_v.compare_at_price > lp_v.price -%} <s>{{ lp_v.compare_at_price | money_without_trailing_zeros }}</s>{%- endif -%}</p>
          <button type="button" class="rw-b rw-o erp-lp__cta" data-erp-to-form>{{ block.settings.cta | default: 'اطلب الآن' | escape }}</button>
          {%- if block.settings.note != blank -%}<p class="erp-lp__note">{{ block.settings.note | escape }}</p>{%- endif -%}
        </header>
      {%- when 'text' -%}
        <section class="erp-lp__block{% if block.settings.tone == 'soft' %} erp-lp__block--soft{% endif %}" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          <div class="erp-lp__rte">{{ block.settings.body }}</div>
        </section>
      {%- when 'images' -%}
        <div class="erp-lp__images" {{ block.shopify_attributes }}>
          {%- for m in product.media offset: block.settings.offset limit: block.settings.count -%}
            {%- if m.media_type == 'image' -%}{{ m | image_url: width: 1100 | image_tag: widths: '400, 700, 1100', sizes: '(min-width: 760px) 720px, 100vw', loading: 'lazy', alt: product.title }}{%- endif -%}
          {%- endfor -%}
        </div>
      {%- when 'benefits' -%}
        <section class="erp-lp__block" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
          <ul class="erp-lp__grid">
            {%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}
              {%- assign parts = t | split: '|' -%}{%- assign rest = t | remove_first: parts.first | remove_first: '|' | strip -%}
              <li><b>{{ parts.first | strip | escape }}</b>{%- if rest != blank -%}<span>{{ rest | escape }}</span>{%- endif -%}</li>
            {%- endif -%}{%- endfor -%}
          </ul>
        </section>
      {%- when 'steps' -%}
        <section class="erp-lp__block" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
          <ol class="erp-lp__steps">{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ol>
        </section>
      {%- when 'guarantee' -%}
        <section class="erp-lp__block erp-lp__block--soft" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
          <ul class="erp-lp__ticks">{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ul>
        </section>
      {%- when 'faq' -%}
        <details class="erp-lp__faq" {{ block.shopify_attributes }}>
          <summary>{{ block.settings.q | escape }}</summary>
          <p>{{ block.settings.a | escape }}</p>
        </details>
      {%- when 'cta' -%}
        <section class="erp-lp__final" {{ block.shopify_attributes }}>
          {%- if block.settings.headline != blank -%}<h2 class="erp-lp__h2">{{ block.settings.headline | escape }}</h2>{%- endif -%}
          <button type="button" class="rw-b rw-o erp-lp__cta" data-erp-to-form>{{ block.settings.cta | default: 'اطلب الآن' | escape }}</button>
          {%- if block.settings.note != blank -%}<p class="erp-lp__note">{{ block.settings.note | escape }}</p>{%- endif -%}
        </section>
    {%- endcase -%}
  {%- endfor -%}
</div>
<style>
  .erp-lp{max-width:720px;margin-inline:auto;padding:24px 16px 8px;display:grid;gap:20px;color:var(--text)}
  .erp-lp__hero{display:grid;gap:12px;text-align:center}
  .erp-lp__eyebrow{margin:0;font-size:.85em;font-weight:600;color:var(--ochre,currentColor)}
  .erp-lp__h1{margin:0;font-family:var(--font-h,inherit);font-size:clamp(1.5rem,6vw,2.2rem);line-height:1.3}
  .erp-lp__lead{margin:0;font-size:1.05em;opacity:.85;line-height:1.7}
  .erp-lp__media img,.erp-lp__images img{display:block;width:100%;height:auto;border-radius:var(--radius,12px)}
  .erp-lp__images{display:grid;gap:12px}
  .erp-lp__price{margin:0;font-size:1.4em}.erp-lp__price s{opacity:.55;font-size:.7em;margin-inline-start:8px}
  .erp-lp__cta{width:100%;min-height:52px;font-size:1.05em}
  .erp-lp__note{margin:0;font-size:.85em;opacity:.75}
  .erp-lp__block{display:grid;gap:10px;line-height:1.8}
  .erp-lp__block--soft{background:var(--card,#fff);border-radius:var(--radius-lg,16px);padding:18px}
  .erp-lp__h2{margin:0;font-family:var(--font-h,inherit);font-size:1.3em;line-height:1.4}
  .erp-lp__rte p{margin:0 0 .6em}
  .erp-lp__ticks,.erp-lp__grid,.erp-lp__steps{margin:0;padding:0;list-style:none;display:grid;gap:10px;text-align:start}
  .erp-lp__ticks li{position:relative;padding-inline-start:28px;line-height:1.7}
  .erp-lp__ticks li::before{content:"✓";position:absolute;inset-inline-start:0;top:0;color:var(--ok,#0f766e);font-weight:700}
  .erp-lp__grid li{display:grid;gap:4px;background:var(--card,#fff);border-radius:var(--radius,12px);padding:14px}
  .erp-lp__grid span{opacity:.8;font-size:.95em}
  .erp-lp__steps{counter-reset:s}
  .erp-lp__steps li{counter-increment:s;display:flex;gap:12px;align-items:flex-start;line-height:1.7}
  .erp-lp__steps li::before{content:counter(s);flex:0 0 30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--btn,#141821);color:var(--btntx,#fff);font-weight:700}
  .erp-lp__faq{background:var(--card,#fff);border-radius:var(--radius,12px);padding:14px 16px}
  .erp-lp__faq summary{cursor:pointer;font-weight:600;line-height:1.6}
  .erp-lp__faq p{margin:10px 0 0;line-height:1.8;opacity:.85}
  .erp-lp__final{display:grid;gap:12px;text-align:center;padding:8px 0 24px}
</style>
<script>
  (function(){
    if (window.erpLpScroll) return; window.erpLpScroll = true;
    document.addEventListener('click', function(e){
      var b = e.target.closest('[data-erp-to-form]'); if (!b) return;
      var f = document.querySelector('[data-lead-form]'); if (!f) return;
      e.preventDefault();
      var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: f.getBoundingClientRect().top + window.scrollY - 80, behavior: calm ? 'auto' : 'smooth' });
      var i = f.querySelector('input:not([type=hidden]):not([data-hp])'); if (i) setTimeout(function(){ i.focus({ preventScroll: true }); }, 450);
    });
  })();
</script>

{% schema %}
{
  "name": "ERP · صفحة هبوط",
  "tag": "section",
  "class": "erp-lp-s",
  "enabled_on": { "templates": ["product"] },
  "blocks": [
    { "type": "hero", "name": "العنوان الرئيسي", "limit": 1, "settings": [
      { "type": "text", "id": "eyebrow", "label": "سطر صغير فوق العنوان" },
      { "type": "textarea", "id": "headline", "label": "العنوان الرئيسي" },
      { "type": "textarea", "id": "subheadline", "label": "العنوان الفرعي" },
      { "type": "textarea", "id": "bullets", "label": "نقاط (سطر لكل نقطة)" },
      { "type": "text", "id": "cta", "label": "زر الطلب", "default": "اطلب الآن" },
      { "type": "text", "id": "note", "label": "سطر تحت الزر" },
      { "type": "checkbox", "id": "show_image", "label": "صورة المنتج", "default": true }
    ] },
    { "type": "text", "name": "فقرة", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "richtext", "id": "body", "label": "النص" },
      { "type": "select", "id": "tone", "label": "الخلفية", "options": [{ "value": "plain", "label": "بدون" }, { "value": "soft", "label": "بطاقة" }], "default": "plain" }
    ] },
    { "type": "images", "name": "صور وصفية", "settings": [
      { "type": "range", "id": "offset", "label": "ابدأ بعد الصورة رقم", "min": 0, "max": 20, "step": 1, "default": 1 },
      { "type": "range", "id": "count", "label": "عدد الصور", "min": 1, "max": 10, "step": 1, "default": 3 }
    ] },
    { "type": "benefits", "name": "الفوائد", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "textarea", "id": "items", "label": "سطر لكل فائدة: العنوان | الشرح" }
    ] },
    { "type": "steps", "name": "خطوات الطلب", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "textarea", "id": "items", "label": "سطر لكل خطوة" }
    ] },
    { "type": "guarantee", "name": "الضمانات", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "textarea", "id": "items", "label": "سطر لكل ضمان" }
    ] },
    { "type": "faq", "name": "سؤال شائع", "settings": [
      { "type": "text", "id": "q", "label": "السؤال" },
      { "type": "textarea", "id": "a", "label": "الجواب" }
    ] },
    { "type": "cta", "name": "دعوة للطلب", "settings": [
      { "type": "textarea", "id": "headline", "label": "العنوان" },
      { "type": "text", "id": "cta", "label": "زر الطلب", "default": "اطلب الآن" },
      { "type": "text", "id": "note", "label": "سطر تحت الزر" }
    ] }
  ],
  "presets": [{ "name": "ERP · صفحة هبوط" }]
}
{% endschema %}
`;
}

/** النشر: ملفات القالب + التحويل ‎/pages/<slug>‎ + تثبيت الصفحة في «صفحات المتجر» */
export async function publishLanding(id) {
  const l = getLanding(id);
  const cfg = projectConfig(l.project_id);
  if (!shopify.isConfigured(cfg)) throw badRequest('shopify_not_configured');
  const p = getProduct(l.product_id);
  if (!p.handle) throw badRequest('landing_product_not_on_shopify');
  const suffix = `lp-${l.slug}`;
  const publicPath = `/pages/${l.slug}`;
  const target = `/products/${p.handle}?view=${suffix}`;
  let redirect;
  try {
    const { theme, tpl } = await mainTemplate(cfg);
    const [layoutFile] = await shopify.themeFiles(cfg, theme.id, ['layout/theme.liquid']);
    await shopify.upsertThemeFiles(cfg, theme.id, [
      { filename: 'layout/erp-landing.liquid', content: landingLayout(layoutFile?.content) },
      { filename: 'sections/erp-lp.liquid', content: sectionLiquid() },
      { filename: `templates/product.${suffix}.json`, content: JSON.stringify(buildTemplate(l.copy, tpl), null, 2) },
    ]);
    // صفحة Shopify حقيقية بنفس الاسم تمنع التحويل: Shopify لا يحوّل رابطاً موجوداً
    const existing = await shopify.findUrlRedirect(cfg, publicPath);
    redirect = existing ? await shopify.updateUrlRedirect(cfg, existing.id, publicPath, target) : await shopify.createUrlRedirect(cfg, publicPath, target);
  } catch (e) {
    throw await scopesError(cfg, e);
  }
  db.prepare("UPDATE landing_pages SET status = 'published', template_suffix = ?, redirect_id = ?, public_path = ?, target_url = ?, published_at = ?, updated_at = ? WHERE id = ?").run(
    suffix,
    redirect?.id || null,
    publicPath,
    target,
    nowIso(),
    nowIso(),
    id,
  );
  const base = storeBase(l.project_id);
  // الطلبيات تُنسب بالرابط النهائي (قالب ?view=) — صفحات المتجر تحسب طلبيات كل صفحة هبوط وحدها
  if (base) addPages(l.project_id, { urls: [`${base}${target}`], title: `${p.title} · ${l.angle}`, product_id: p.id });
  return getLanding(id);
}

/** سحب الصفحة: حذف التحويل وملف القالب (النصوص تبقى في الـ ERP لإعادة النشر) */
export async function unpublishLanding(id) {
  const l = getLanding(id);
  const cfg = projectConfig(l.project_id);
  try {
    if (l.redirect_id) await shopify.deleteUrlRedirect(cfg, l.redirect_id).catch((e) => (/not.?found|does not exist/i.test(e.message) ? null : Promise.reject(e)));
    if (l.template_suffix) {
      const theme = await shopify.mainTheme(cfg);
      if (theme) await shopify.deleteThemeFiles(cfg, theme.id, [`templates/product.${l.template_suffix}.json`]).catch(() => null);
    }
  } catch (e) {
    throw await scopesError(cfg, e);
  }
  db.prepare("UPDATE landing_pages SET status = 'unpublished', redirect_id = NULL, updated_at = ? WHERE id = ?").run(nowIso(), id);
  return getLanding(id);
}

export function deleteLanding(id) {
  const l = getLanding(id);
  if (l.status === 'published') throw badRequest('landing_unpublish_first');
  db.prepare('DELETE FROM landing_pages WHERE id = ?').run(id);
  return l;
}
