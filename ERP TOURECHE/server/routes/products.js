import { Router } from 'express';
import multer from 'multer';
import { db } from '../db/index.js';
import { requireRole, requireSensitive } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, v } from '../lib/util.js';
import { projectConfig } from '../lib/settings.js';
import * as shopify from '../integrations/shopify.js';
import * as n8n from '../integrations/n8n.js';
import { generateImages, saveUpload } from '../integrations/images.js';
import { projectScope } from '../services/projects.js';
import * as products from '../services/products.js';
import { productTest, breakEven } from '../services/ads.js';
import { analyzeSeo } from '../services/seo.js';
import { runJob } from '../services/sync.js';

export const productsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(file.mimetype)),
});

const PRICE_FIELDS = ['price', 'compare_at_price', 'cost_price', 'variants'];

productsRouter.get('/', (req, res) => {
  const scope = projectScope(req);
  res.json(products.listProducts(scope.ids, { stage: req.query.stage, q: req.query.q, lowStock: req.query.low_stock === '1' }));
});

productsRouter.get('/collections', async (req, res) => {
  const cfg = projectConfig(projectScope(req, { allowAll: false }).id);
  if (!shopify.isConfigured(cfg)) return res.json([]);
  const list = await shopify.collections(cfg);
  // هل تظهر في قائمة المتجر؟ دون إذن القوائم تبقى غير معروفة (null) ولا تتوقف القائمة
  const menu = await shopify.mainMenu(cfg).catch(() => null);
  const ids = menu ? new Set(shopify.menuResourceIds(menu.items)) : null;
  res.json(list.map((c) => ({ ...c, in_menu: ids ? ids.has(c.id) : null })));
});

// إظهار مجموعة في القائمة الرئيسية للمتجر (تغيير في واجهة المتجر = كلمة المرور الحساسة)
productsRouter.post('/collections/menu', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const scope = projectScope(req, { allowAll: false });
  const cfg = projectConfig(scope.id);
  const id = v.str(req.body.id, { required: true, max: 120, name: 'id' });
  const c = (await shopify.collections(cfg)).find((x) => x.id === id);
  if (!c) throw badRequest('collection_not_found');
  const out = await shopify.addCollectionToMenu(cfg, c);
  audit(req, 'collection_added_to_menu', { projectId: scope.id, details: { title: c.title, menu: out.menu } });
  res.json(out);
});

productsRouter.post('/collections', requireRole('admin', 'manager'), async (req, res) => {
  const cfg = projectConfig(projectScope(req, { allowAll: false }).id);
  const title = v.str(req.body.title, { required: true, max: 120, name: 'title' });
  const c = await shopify.createCollection(cfg, {
    title,
    handle: v.str(req.body.handle, { max: 80 }) || undefined,
    descriptionHtml: v.str(req.body.description_html, { max: 5000 }) || '',
    seoTitle: v.str(req.body.seo_title, { max: 70 }) || title,
    seoDescription: v.str(req.body.seo_description, { max: 320 }) || '',
  });
  audit(req, 'collection_created', { details: { title } });
  res.json(c);
});

productsRouter.get('/categories', async (req, res) => {
  const cfg = projectConfig(projectScope(req, { allowAll: false }).id);
  if (!shopify.isConfigured(cfg) || String(req.query.q || '').length < 2) return res.json([]);
  res.json(await shopify.searchCategories(cfg, String(req.query.q)));
});

productsRouter.post('/sync', async (req, res) => {
  const scope = projectScope(req);
  const out = {};
  for (const id of scope.ids) {
    try {
      out[id] = await runJob('products', id, 'منتجات Shopify', () => products.syncFromShopify(id));
    } catch (e) {
      out[id] = { error: e.message };
    }
  }
  res.json(out);
});

productsRouter.get('/:id', (req, res) => {
  const p = products.getProduct(Number(req.params.id));
  res.json({ ...p, break_even: breakEven(p, p.project_id) });
});

productsRouter.post('/', requireRole('admin', 'manager'), (req, res) => {
  const scope = projectScope(req, { allowAll: false });
  res.json(products.createProduct(scope.id, req.body));
});

productsRouter.patch('/:id', requireRole('admin', 'manager'), (req, res, next) => {
  const id = Number(req.params.id);
  const p = products.getProduct(id);
  const touchesPrice = PRICE_FIELDS.some((k) => req.body[k] !== undefined && JSON.stringify(req.body[k]) !== JSON.stringify(p[k]));
  // مخزون متغيرات منتج في Shopify عُدّل في الجدول: يصل إلى المتجر فوراً (لا ينتظر «إعادة النشر»)
  const stockChanges = p.shopify_id && Array.isArray(req.body.variants)
    ? req.body.variants
        .filter((x) => x?.id && x.stock !== undefined && x.stock !== null && x.stock !== '')
        .map((x) => ({ variant_id: x.id, quantity: Math.max(0, Math.round(Number(x.stock))) }))
        .filter((c) => Number.isFinite(c.quantity) && Number(p.variants.find((v) => v.id === c.variant_id)?.stock) !== c.quantity)
    : [];
  const run = async () => {
    let out = products.updateProduct(id, req.body);
    if (stockChanges.length) out = await products.setVariantStock(id, stockChanges);
    if (touchesPrice) audit(req, 'product_price_changed', { entity: 'product', entityId: id, projectId: p.project_id, details: { price: out.price, compare_at_price: out.compare_at_price, cost: out.cost_price } });
    if (stockChanges.length) audit(req, 'stock_set', { entity: 'product', entityId: id, projectId: p.project_id, details: { variants: stockChanges } });
    res.json(out);
  };
  // تعديل أسعار أو مخزون منتج منشور = عملية حساسة
  if (touchesPrice && p.shopify_id) return requireSensitive(req, res, (err) => (err ? next(err) : run().catch(next)));
  run().catch(next);
});

productsRouter.delete('/:id', requireRole('admin', 'manager'), requireSensitive, (req, res) => {
  const p = products.getProduct(Number(req.params.id));
  products.deleteProduct(p.id);
  audit(req, 'product_deleted', { entity: 'product', entityId: p.id, projectId: p.project_id, details: { title: p.title, shopify_id: p.shopify_id } });
  res.json({ ok: true });
});

productsRouter.post('/:id/archive', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const p = await products.archiveProduct(Number(req.params.id));
  audit(req, 'product_archived', { entity: 'product', entityId: p.id, projectId: p.project_id, details: { title: p.title, shopify_id: p.shopify_id } });
  res.json(p);
});

productsRouter.get('/:id/seo', (req, res) => {
  const p = products.getProduct(Number(req.params.id));
  const others = db.prepare('SELECT seo_title, handle FROM products WHERE project_id = ? AND id != ?').all(p.project_id, p.id);
  res.json(analyzeSeo({ ...p, ...(req.query.preview ? JSON.parse(String(req.query.preview)) : {}) }, { otherSeoTitles: others.map((o) => o.seo_title).filter(Boolean), otherHandles: others.map((o) => o.handle).filter(Boolean) }));
});

/** فحص SEO لمسودة غير محفوظة (أثناء الكتابة في المحرر) */
productsRouter.post('/:id/seo/check', (req, res) => {
  const p = products.getProduct(Number(req.params.id));
  const others = db.prepare('SELECT seo_title, handle FROM products WHERE project_id = ? AND id != ?').all(p.project_id, p.id);
  res.json(analyzeSeo({ ...p, ...req.body }, { otherSeoTitles: others.map((o) => o.seo_title).filter(Boolean), otherHandles: others.map((o) => o.handle).filter(Boolean) }));
});

productsRouter.post('/:id/seo/generate', requireRole('admin', 'manager'), async (req, res) => res.json(await products.generateSeo(Number(req.params.id), { instructions: v.str(req.body.instructions, { max: 1500 }) || '' })));

productsRouter.post('/:id/seo/apply', requireRole('admin', 'manager'), (req, res) => res.json(products.applySeo(Number(req.params.id), req.body)));

productsRouter.post('/:id/publish', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const status = req.body.status === 'DRAFT' ? 'DRAFT' : 'ACTIVE';
  const p = await products.publishProduct(Number(req.params.id), { status });
  audit(req, 'product_published', { entity: 'product', entityId: p.id, projectId: p.project_id, details: { status, shopify_id: p.shopify_id } });
  res.json(p);
});

productsRouter.post('/:id/social', requireRole('admin', 'manager'), async (req, res) => {
  const platforms = (req.body.platforms || ['facebook']).filter((x) => ['facebook', 'instagram'].includes(x));
  res.json(await products.postToSocial(Number(req.params.id), { platforms, message: v.str(req.body.message, { required: true, max: 2200, name: 'message' }) }));
});

/** «إرسال إلى تيليغرام» عبر سير «Toureche ERP · نشر المنتجات» في n8n */
productsRouter.post('/:id/telegram', requireRole('admin', 'manager'), async (req, res) => {
  const p = products.getProduct(Number(req.params.id));
  const cfg = projectConfig(p.project_id);
  const opt = p.options?.[0];
  const url = p.online_url || (cfg.store_domain && p.handle ? `https://${cfg.store_domain}/products/${p.handle}` : null);
  if (!url) throw badRequest('product_link_missing');
  res.json(
    await n8n.emitProduct(
      'product.published',
      { title: p.title, price: p.price, compare_price: p.compare_at_price, option: opt?.name || null, values: opt?.values || [], collections: (p.collections || []).map((c) => c.title), url, facebook_post: v.str(req.body.post, { max: 2500 }) },
      p.project_id,
    ),
  );
});

productsRouter.post('/:id/stock', requireRole('admin', 'manager'), requireSensitive, async (req, res) => {
  const delta = v.int(req.body.delta, { required: true, min: -100000, max: 100000, name: 'delta' });
  const p = await products.adjustStock(Number(req.params.id), delta, { reason: v.str(req.body.reason, { max: 200 }), userId: req.user.id, variantId: v.str(req.body.variant_id, { max: 120 }) || null });
  audit(req, 'stock_adjusted', { entity: 'product', entityId: p.id, projectId: p.project_id, details: { delta, stock: p.stock, variant: req.body.variant_id || null, shopify: p.stock_synced } });
  res.json(p);
});

productsRouter.post('/:id/images', requireRole('admin', 'manager'), upload.array('images', 10), (req, res) => {
  const p = products.getProduct(Number(req.params.id));
  if (!req.files?.length) throw badRequest('images_required');
  const added = req.files.map((f) => ({ ...saveUpload(p.project_id, f.buffer, f.mimetype.includes('png') ? 'png' : f.mimetype.includes('webp') ? 'webp' : 'jpg'), alt: '' }));
  res.json(products.updateProduct(p.id, { images: [...(p.images || []), ...added.map((a) => ({ url: a.url, alt: a.alt }))] }));
});

productsRouter.post('/:id/images/generate', requireRole('admin', 'manager'), async (req, res) => {
  const p = products.getProduct(Number(req.params.id));
  const prompt = v.str(req.body.prompt, { required: true, max: 4000, name: 'prompt' });
  const sources = (req.body.source_urls || p.images.slice(0, 2).map((i) => i.url)).slice(0, 4);
  const images = await generateImages(p.project_id, { prompt, sourceUrls: sources, count: Math.min(Number(req.body.count) || 1, 4), size: req.body.size || '1024x1024', product: { id: p.id, title: p.title }, kind: 'image' });
  for (const img of images) db.prepare('INSERT INTO creatives (project_id, product_id, kind, file, url, prompt, provider) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.project_id, p.id, 'image', img.file, img.url, prompt, req.body.provider || null);
  res.json({ images });
});

productsRouter.post('/:id/ad-copy', requireRole('admin', 'manager'), async (req, res) =>
  res.json(await products.generateAdCopy(Number(req.params.id), { languages: req.body.languages, count: req.body.count, instructions: v.str(req.body.instructions, { max: 1500 }) || '' })),
);

productsRouter.get('/:id/creatives', (req, res) => {
  const rows = db.prepare('SELECT * FROM creatives WHERE product_id = ? ORDER BY id DESC LIMIT 100').all(Number(req.params.id));
  res.json(rows.map((r) => ({ ...r, content: r.content ? JSON.parse(r.content) : null })));
});

productsRouter.get('/:id/test', (req, res) => {
  const p = products.getProduct(Number(req.params.id));
  res.json(productTest(p.project_id, p, Number(req.query.days) || 7));
});

export { HttpError };
