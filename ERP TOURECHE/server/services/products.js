import fs from 'node:fs';
import path from 'node:path';
import { db, parseJson } from '../db/index.js';
import { projectConfig } from '../lib/settings.js';
import { HttpError, nowIso, slugify, badRequest, dzDay } from '../lib/util.js';
import * as shopify from '../integrations/shopify.js';
import * as ai from '../integrations/ai.js';
import * as meta from '../integrations/meta.js';
import * as n8n from '../integrations/n8n.js';
import { analyzeSeo } from './seo.js';
import { assertSupplier } from './contacts.js';
import { uploadPath } from '../integrations/images.js';
import { getProject, inList } from './projects.js';

const JSON_FIELDS = ['tags', 'collections', 'options', 'variants', 'images', 'specs', 'angles'];

export function hydrateProduct(row) {
  if (!row) return null;
  const p = { ...row };
  for (const f of JSON_FIELDS) p[f] = parseJson(row[f], []);
  return p;
}

export function listProducts(projectIds, { stage, q, lowStock } = {}) {
  const where = [`project_id IN (${inList(projectIds)})`];
  const args = [...projectIds];
  if (stage) {
    where.push('stage = ?');
    args.push(stage);
  } else where.push("stage != 'archived'");
  if (q) {
    where.push('(title LIKE ? OR handle LIKE ? OR sku LIKE ? OR tags LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (lowStock) where.push('stock IS NOT NULL AND stock <= low_stock');
  return db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`).all(...args).map(hydrateProduct);
}

export function getProduct(id) {
  const p = hydrateProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  if (!p) throw new HttpError(404, 'product_not_found');
  return p;
}

function seoContext(p) {
  const others = db.prepare('SELECT seo_title, handle FROM products WHERE project_id = ? AND id != ?').all(p.project_id, p.id || 0);
  return { otherSeoTitles: others.map((o) => o.seo_title).filter(Boolean), otherHandles: others.map((o) => o.handle).filter(Boolean) };
}

export function seoReport(id) {
  const p = getProject(getProduct(id).project_id) && getProduct(id);
  return analyzeSeo(p, seoContext(p));
}

const FIELDS = {
  title: 'str',
  handle: 'str',
  stage: 'str',
  product_type: 'str',
  vendor: 'str',
  description_html: 'html',
  seo_title: 'str',
  seo_description: 'str',
  focus_keyword: 'str',
  price: 'num',
  compare_at_price: 'num',
  cost_price: 'num',
  stock: 'int',
  low_stock: 'int',
  sku: 'str',
  notes: 'text',
  audience: 'text',
  tags: 'json',
  collections: 'json',
  options: 'json',
  variants: 'json',
  images: 'json',
  specs: 'json',
  angles: 'json',
  test_stage: 'str',
  test_budget_da: 'num',
  decision_note: 'text',
  supplier: 'str',
  supplier_url: 'str',
  supplier_id: 'int',
  packaging_cost: 'num',
  category_id: 'str',
  category_name: 'str',
};
export const TEST_STAGES = ['none', 'idea', 'preparing', 'testing', 'winner', 'loser', 'paused'];

function clean(input) {
  const out = {};
  for (const [k, type] of Object.entries(FIELDS)) {
    if (input[k] === undefined) continue;
    const val = input[k];
    if (type === 'json') out[k] = JSON.stringify(Array.isArray(val) ? val : []);
    else if (type === 'num') out[k] = val === null || val === '' ? null : Number(val);
    else if (type === 'int') out[k] = val === null || val === '' ? null : Math.round(Number(val));
    else if (type === 'html') out[k] = String(val ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, 60000);
    else out[k] = val === null ? null : String(val).slice(0, type === 'text' ? 5000 : 500);
  }
  if (out.handle) out.handle = slugify(out.handle, 70);
  if (out.stage && !['idea', 'draft', 'ready', 'published', 'archived'].includes(out.stage)) throw badRequest('stage_invalid');
  if (out.test_stage && !TEST_STAGES.includes(out.test_stage)) throw badRequest('test_stage_invalid');
  if (out.supplier_url && !/^https?:\/\//i.test(out.supplier_url)) throw badRequest('supplier_url_invalid');
  if (out.supplier_id) out.supplier = assertSupplier(out.supplier_id).name;
  else if (out.supplier_id === null && input.supplier === undefined) out.supplier = null;
  for (const k of ['price', 'compare_at_price', 'cost_price']) if (out[k] !== undefined && out[k] !== null && !(out[k] >= 0)) throw badRequest(`${k}_invalid`);
  return out;
}

export function createProduct(projectId, input) {
  if (!input.title) throw badRequest('title_required');
  const data = clean({ stage: 'draft', ...input });
  data.handle ||= slugify(input.title);
  data.low_stock ??= projectConfig(projectId).low_stock_default ?? 5;
  const cols = Object.keys(data);
  const info = db.prepare(`INSERT INTO products (project_id, ${cols.join(', ')}) VALUES (?, ${cols.map((c) => `@${c}`).join(', ')})`).run(projectId, data);
  return refreshScore(info.lastInsertRowid);
}

export function updateProduct(id, input) {
  getProduct(id);
  const data = clean(input);
  if (!Object.keys(data).length) return getProduct(id);
  data.updated_at = nowIso();
  db.prepare(`UPDATE products SET ${Object.keys(data).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...data, id });
  return refreshScore(id);
}

function refreshScore(id) {
  const p = getProduct(id);
  const { score } = analyzeSeo(p, seoContext(p));
  db.prepare('UPDATE products SET seo_score = ? WHERE id = ?').run(score, id);
  return { ...p, seo_score: score };
}

export function deleteProduct(id) {
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (!info.changes) throw new HttpError(404, 'product_not_found');
}

/** تحريك المخزون محلياً (للمشاريع دون Shopify أو للتعديل اليدوي) */
export function adjustStock(id, delta, { reason, orderId, userId } = {}) {
  const p = getProduct(id);
  db.prepare('UPDATE products SET stock = COALESCE(stock, 0) + ?, updated_at = ? WHERE id = ?').run(delta, nowIso(), id);
  db.prepare('INSERT INTO stock_movements (project_id, product_id, delta, reason, order_id, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.project_id, id, delta, reason || null, orderId || null, userId || null, nowIso());
  return getProduct(id);
}

// ——— Shopify ———
export async function syncFromShopify(projectId) {
  const cfg = projectConfig(projectId);
  if (!shopify.isConfigured(cfg)) return { skipped: true };
  const nodes = await shopify.allProducts(cfg);
  let created = 0;
  let updated = 0;
  const findByGid = db.prepare('SELECT id FROM products WHERE project_id = ? AND shopify_id = ?');
  for (const node of nodes) {
    const m = shopify.mapProduct(node);
    const existing = findByGid.get(projectId, m.shopify_id);
    const data = {
      ...m,
      stage: node.status === 'ARCHIVED' ? 'archived' : 'published',
      synced_at: nowIso(),
    };
    for (const f of JSON_FIELDS) if (data[f] !== undefined) data[f] = JSON.stringify(data[f]);
    if (existing) {
      const keys = Object.keys(data);
      db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @now WHERE id = @id`).run({ ...data, now: nowIso(), id: existing.id });
      refreshScore(existing.id);
      updated++;
    } else {
      createProduct(projectId, { ...m, stage: data.stage, test_stage: 'none' });
      db.prepare('UPDATE products SET shopify_id = ?, shopify_status = ?, online_url = ?, synced_at = ? WHERE project_id = ? AND id = (SELECT MAX(id) FROM products WHERE project_id = ?)').run(
        m.shopify_id,
        m.shopify_status,
        m.online_url,
        nowIso(),
        projectId,
        projectId,
      );
      created++;
    }
  }
  return { total: nodes.length, created, updated };
}

/** الصور المحلية (المولّدة في الـ ERP) تُرفع إلى Shopify أولاً لأن جهازك غير متاح من الإنترنت */
async function resolveImageSources(cfg, images) {
  const out = [];
  for (const img of images) {
    if (/^https:\/\//.test(img.url || '')) {
      out.push(img);
      continue;
    }
    if (img.url?.startsWith('/uploads/')) {
      const file = uploadPath(img.url);
      if (!file || !fs.existsSync(file)) continue;
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
      const url = await shopify.stagedUpload(cfg, { buffer: fs.readFileSync(file), filename: path.basename(file), mimeType: mime });
      out.push({ ...img, url, uploaded_from: img.url });
    }
  }
  return out;
}

/** نشر المنتج على Shopify (إنشاء أو تحديث) — status: ACTIVE أو DRAFT */
export async function publishProduct(id, { status = 'ACTIVE' } = {}) {
  const p = getProduct(id);
  const cfg = projectConfig(p.project_id);
  if (!shopify.isConfigured(cfg)) throw new HttpError(400, 'shopify_not_configured');
  if (!p.price && !(p.variants || []).some((v) => v.price)) throw badRequest('price_required');
  let node;
  if (!p.shopify_id) {
    const images = await resolveImageSources(cfg, p.images);
    node = await shopify.createProduct(cfg, { ...p, images }, { status });
  } else {
    const current = shopify.mapProduct(await shopify.getProduct(cfg, p.shopify_id));
    const currentIds = new Set(current.collections.map((c) => c.id));
    const wanted = new Set((p.collections || []).map((c) => c.id).filter(Boolean));
    const fresh = await resolveImageSources(cfg, (p.images || []).filter((i) => !i.id));
    node = await shopify.updateProduct(
      cfg,
      p.shopify_id,
      {
        title: p.title,
        handle: p.handle && p.handle !== current.handle ? p.handle : undefined,
        description_html: p.description_html,
        product_type: p.product_type,
        vendor: p.vendor,
        tags: p.tags,
        seo_title: p.seo_title,
        seo_description: p.seo_description,
        category: p.category_id || undefined,
        status,
      },
      { joinCollections: [...wanted].filter((c) => !currentIds.has(c)), leaveCollections: [...currentIds].filter((c) => !wanted.has(c)), newImages: fresh },
    );
    const altChanges = (p.images || []).filter((i) => i.id && current.images.find((c) => c.id === i.id && c.alt !== i.alt));
    await shopify.updateImageAlt(cfg, altChanges);
    const priceChanges = (p.variants || []).filter((v) => {
      const cur = current.variants.find((c) => c.id === v.id);
      return cur && (Number(cur.price) !== Number(v.price) || Number(cur.compare_at_price || 0) !== Number(v.compare_at_price || 0));
    });
    if (priceChanges.length) await shopify.updateVariantPrices(cfg, p.shopify_id, priceChanges);
    node = await shopify.getProduct(cfg, p.shopify_id);
  }
  const m = shopify.mapProduct(node);
  db.prepare(
    `UPDATE products SET shopify_id = ?, shopify_status = ?, handle = ?, images = ?, variants = ?, online_url = ?, stage = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
  ).run(m.shopify_id, m.shopify_status, m.handle, JSON.stringify(m.images), JSON.stringify(m.variants), m.online_url, status === 'ACTIVE' ? 'published' : 'ready', nowIso(), nowIso(), id);
  const saved = refreshScore(id);
  if (status === 'ACTIVE') {
    const opt = m.options[0];
    const url = m.online_url || (cfg.store_domain ? `https://${cfg.store_domain}/products/${m.handle}` : null);
    n8n
      .emitProduct('product.published', {
        title: m.title,
        price: m.price,
        compare_price: m.compare_at_price,
        option: opt?.name || null,
        values: opt?.values || [],
        collections: m.collections.map((c) => c.title),
        url,
        facebook_post: saved.angles?.[0]?.post || null,
      }, p.project_id)
      .catch((e) => console.warn('[n8n] product.published', e.message));
  }
  return saved;
}

/** نشر منشور على صفحة فيسبوك و/أو إنستغرام بصورة المنتج */
export async function postToSocial(id, { platforms = ['facebook'], message }) {
  const p = getProduct(id);
  const cfg = projectConfig(p.project_id);
  const image = (p.images || []).find((i) => /^https:\/\//.test(i.url || ''));
  if (!image) throw badRequest('public_image_required');
  if (!message) throw badRequest('message_required');
  const results = {};
  for (const platform of platforms) {
    try {
      results[platform] = platform === 'instagram' ? await meta.postToInstagram(cfg, { imageUrl: image.url, caption: message }) : await meta.postToPage(cfg, { imageUrl: image.url, message });
    } catch (e) {
      results[platform] = { error: e.message };
    }
  }
  n8n.emitProduct('social.posted', { title: p.title, results }, p.project_id).catch(() => {});
  return results;
}

// ——— الذكاء الاصطناعي ———
async function imageBlocks(images, max = 6) {
  const out = [];
  for (const img of (images || []).slice(0, max)) {
    if (/^https:\/\//.test(img.url || '')) out.push({ url: img.url });
    else if (img.url?.startsWith('/uploads/')) {
      const file = uploadPath(img.url);
      if (!file || !fs.existsSync(file)) continue;
      const ext = path.extname(file).slice(1).toLowerCase();
      out.push({ data: fs.readFileSync(file).toString('base64'), mediaType: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png' });
    }
  }
  return out;
}

async function collectionsFor(cfg) {
  if (!shopify.isConfigured(cfg)) return [];
  try {
    return await shopify.collections(cfg);
  } catch {
    return [];
  }
}

function seoSystem(brand, domain) {
  return `أنت خبير SEO وكاتب محتوى للتجارة الإلكترونية لمتجر «${brand}» الجزائري${domain ? ` (${domain})` : ''}.
المتجر يبيع منتجات للنساء والرجال والأطفال، ألعاب الأطفال الصغار، الديكور وإكسسوارات المنزل، مع الدفع عند الاستلام والتوصيل إلى كل الولايات.
اكتب بالعربية الفصحى البسيطة التي يفهمها الزبون الجزائري؛ استعمل الكلمات الفرنسية فقط للعلامات والمصطلحات التقنية الشائعة.
هدفك: صفحة منتج تتصدر نتائج بحث Google في الجزائر على المدى الطويل وتقنع بالشراء.

قواعد إلزامية:
- focus_keyword: العبارة التي يكتبها الجزائري في Google (2–4 كلمات).
- title: عنوان المنتج (يظهر كـ H1) بين 40 و75 حرفاً، يبدأ بالكلمة المفتاحية ويذكر أهم خاصية (السعة/المقاس/المادة)، دون رموز أو مبالغة.
- seo_title: بين 45 و60 حرفاً، الكلمة المفتاحية في البداية، وينتهي بـ « | ${brand}» إن سمح الطول. مختلف عن عناوين المنتجات الأخرى.
- seo_description: بين 140 و160 حرفاً، فيه الكلمة المفتاحية وفائدة ملموسة وذكر الدفع عند الاستلام والتوصيل ودعوة لطيفة للطلب.
- handle: حروف لاتينية صغيرة وشرطات فقط، كلمات فرنسية/لاتينية دالة، 60 حرفاً كحد أقصى (مثال: thermos-enfant-mickey-minnie-320ml).
- description_html: بين 300 و500 كلمة، بدون <h1>. ابدأ بـ <h2> فيه الكلمة المفتاحية بصياغة طبيعية، ثم فقرتان تذكر الكلمة المفتاحية في أول 100 كلمة،
  ثم <h3>المواصفات</h3> كجدول <table><tr><th>…</th><td>…</td></tr></table>، ثم <h3>المميزات</h3> كقائمة <ul>، ثم <h3>أسئلة شائعة</h3> (3–5 أسئلة بصيغة <p><strong>السؤال؟</strong> الجواب</p>)، ثم <h3>الطلب والتوصيل</h3>.
- لا تخترع معلومات غير موجودة في المعطيات (مواد، شهادات، أرقام، ضمانات). إن لم تُعطَ معلومة فلا تذكرها، واذكر نقصها في notes.
- تجنّب الحشو وعلامات الكتابة الآلية: لا شرطات طويلة (—)، ولا عبارات مثل «في عالم اليوم» أو «لا تفوّت الفرصة» أو «تجربة لا مثيل لها». كثافة الكلمة المفتاحية طبيعية (أقل من 3%).
- image_alts: نص بديل لكل صورة مرفقة بنفس الترتيب، يصف ما يظهر فعلاً في الصورة مع اسم المنتج، 8–16 كلمة، دون «صورة لـ».
- tags: من 5 إلى 12 وسماً مفيداً للبحث الداخلي والمجموعات. product_type: فئة عربية قصيرة.
- collections_hint: اختر من المجموعات الموجودة فقط (بالعنوان) ما يناسب المنتج.
- notes: نصائح قصيرة للتاجر لتحسين الصفحة (صور ناقصة، معلومات ناقصة…).`;
}

/** يولّد اقتراح SEO كاملاً (لا يُحفظ إلا إذا طلب المستخدم ذلك) */
export async function generateSeo(id, { instructions = '' } = {}) {
  const p = getProduct(id);
  const project = getProject(p.project_id);
  const cfg = projectConfig(p.project_id);
  const brand = cfg.brand_name || project.name;
  const cols = await collectionsFor(cfg);
  const images = await imageBlocks(p.images);
  const facts = {
    current_title: p.title,
    price_da: p.price,
    compare_at_price_da: p.compare_at_price,
    options: p.options,
    variants: (p.variants || []).map((v) => v.title),
    technical_notes: p.notes,
    specs: p.specs,
    audience: p.audience,
    existing_description_text: (p.description_html || '').replace(/<[^>]+>/g, ' ').slice(0, 3000),
    existing_tags: p.tags,
    delivery_promise: 'الدفع عند الاستلام، التوصيل إلى المنزل أو المكتب في كل الولايات',
    available_collections: cols.map((c) => c.title),
    images_count: images.length,
  };
  const result = await ai.structured({
    system: seoSystem(brand, cfg.store_domain),
    prompt: `معطيات المنتج (JSON):\n${JSON.stringify(facts, null, 2)}\n\n${instructions ? `تعليمات إضافية من التاجر: ${instructions}\n\n` : ''}اكتب صفحة المنتج كاملة حسب القواعد.`,
    schema: ai.SEO_SCHEMA,
    effort: 'medium',
    images,
  });
  result.handle = slugify(result.handle || result.title, 60);
  result.collections = cols.filter((c) => (result.collections_hint || []).includes(c.title)).map((c) => ({ id: c.id, title: c.title, handle: c.handle }));
  result.images = (p.images || []).map((img, i) => ({ ...img, alt: result.image_alts?.[i] || img.alt || '' }));
  const preview = { ...p, ...result, tags: result.tags };
  result.preview_score = analyzeSeo(preview, seoContext(p)).score;
  return result;
}

export function applySeo(id, s) {
  return updateProduct(id, {
    title: s.title,
    handle: s.handle,
    seo_title: s.seo_title,
    seo_description: s.seo_description,
    focus_keyword: s.focus_keyword,
    description_html: s.description_html,
    product_type: s.product_type,
    tags: s.tags,
    specs: s.specs,
    ...(s.collections?.length ? { collections: s.collections } : {}),
    ...(s.images ? { images: s.images } : {}),
  });
}

/** نصوص إعلانية بعدة زوايا ولغات + أوصاف صور للمصمم/المولّد */
export async function generateAdCopy(id, { languages = ['darija', 'ar', 'fr'], count = 4, instructions = '' } = {}) {
  const p = getProduct(id);
  const cfg = projectConfig(p.project_id);
  const brand = cfg.brand_name || getProject(p.project_id).name;
  const images = await imageBlocks(p.images, 4);
  const res = await ai.structured({
    system: `أنت كاتب إعلانات Facebook/Instagram محترف للسوق الجزائري (الدفع عند الاستلام) لمتجر «${brand}».
اكتب نصوصاً قصيرة مقنعة وصادقة دون وعود كاذبة أو ادعاءات صحية أو كلمات محظورة في سياسات Meta (لا «أنت» المستهدِفة لصفات شخصية، لا قبل/بعد مبالغ فيه).
الدارجة الجزائرية مكتوبة بالحروف العربية بشكل طبيعي. كل نص يحتوي: خطّاف في السطر الأول، الفائدة، السعر إن وُجد، الدفع عند الاستلام والتوصيل لكل الولايات، ودعوة للطلب.
primary_text حتى 400 حرف، headline حتى 40 حرفاً، description حتى 30 حرفاً.
image_prompts: أوصاف بالإنجليزية لمولّد صور (صور منتج إعلانية مربعة 1:1 بخلفيات وأجواء جزائرية/منزلية، المنتج نفسه دون تغيير شكله، بدون نصوص داخل الصورة).`,
    prompt: `المنتج: ${JSON.stringify({ title: p.title, price_da: p.price, compare_at_price_da: p.compare_at_price, options: p.options, notes: p.notes, specs: p.specs, audience: p.audience, angles_known: p.angles })}
اللغات المطلوبة: ${languages.join(', ')} — عدد النسخ: ${count} على الأقل موزعة على زوايا مختلفة (المشكلة/الحل، الهدية، الجودة/السعر، الاستعمال اليومي…).
${instructions ? `تعليمات إضافية: ${instructions}` : ''}`,
    schema: ai.AD_SCHEMA,
    effort: 'medium',
    images,
  });
  db.prepare('INSERT INTO creatives (project_id, product_id, kind, content, provider) VALUES (?, ?, ?, ?, ?)').run(p.project_id, id, 'copy', JSON.stringify(res), ai.model());
  return res;
}

// ——— تنبيه المخزون المنخفض (مرة واحدة يومياً لكل منتج) ———
export function lowStockAlerts(projectId) {
  const rows = db.prepare("SELECT * FROM products WHERE project_id = ? AND stage != 'archived' AND stock IS NOT NULL AND stock <= low_stock").all(projectId);
  const day = dzDay();
  for (const p of rows) {
    const key = `stock.low:${p.id}`;
    const st = db.prepare('SELECT cursor FROM job_state WHERE job = ? AND project_id = ?').get(key, projectId);
    if (st?.cursor === day) continue;
    n8n.emit('stock.low', { name: p.title, sku: p.sku, stock: p.stock, low_stock: p.low_stock }, projectId);
    db.prepare(
      `INSERT INTO job_state (job, project_id, cursor, last_run_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(job, project_id) DO UPDATE SET cursor = excluded.cursor, last_run_at = excluded.last_run_at`,
    ).run(key, projectId, day, nowIso());
  }
  return rows.length;
}
