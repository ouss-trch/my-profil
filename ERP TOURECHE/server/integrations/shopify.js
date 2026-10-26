import { request, IntegrationError } from '../lib/http.js';
import { normalizePhone, num, sleep } from '../lib/util.js';
import { parseWilaya } from '../lib/wilayas.js';

/**
 * Shopify Admin GraphQL. المصادقة بإحدى طريقتين:
 *  1) Admin API access token (shpat_…) من تطبيق مخصص
 *  2) client_id + client_secret لتطبيق Dev Dashboard (Client credentials grant، الرمز صالح 24 ساعة ويُجدَّد تلقائياً)
 * الصلاحيات المطلوبة: read_orders, write_orders, read_products, write_products, read_inventory, write_inventory
 * (+ Protected customer data: الاسم، الهاتف، العنوان لقراءة بيانات الزبائن في الطلبيات)
 */
const tokenCache = new Map();

function shopDomain(cfg) {
  const s = String(cfg.shopify_shop || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!s) throw new IntegrationError('shopify', 'config', 'shop_not_configured');
  // رمز الدخول لا يُطلب إلا من نطاق myshopify (الدومين العام مثل souqnna.com لا يصلح هنا)
  if (s.includes('.') && !s.endsWith('.myshopify.com')) throw new IntegrationError('shopify', 'config', 'shop_must_be_myshopify');
  return s.includes('.') ? s : `${s}.myshopify.com`;
}

/**
 * تطبيق Dev Dashboard (Client ID + Client secret) هو الطريقة المعتمدة، فيُستعمل أولاً إن وُجد؛
 * رمز shpat_ القديم احتياطي فقط. (كان العكس: رمز قديم منتهٍ في الحقل يُفشل كل شيء ولا يُجرَّب التطبيق أبداً)
 */
async function accessToken(cfg) {
  if (!cfg.shopify_client_id || !cfg.shopify_client_secret) {
    if (cfg.shopify_access_token) return cfg.shopify_access_token;
    throw new IntegrationError('shopify', 'config', 'credentials_missing');
  }
  const key = `${cfg.projectId}:${cfg.shopify_client_id}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expires > Date.now() + 60e3) return cached.token;
  let data;
  try {
    ({ data } = await request('shopify', `https://${shopDomain(cfg)}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.shopify_client_id, client_secret: cfg.shopify_client_secret }).toString(),
    }));
  } catch (e) {
    // سبب الرفض بكلمات يفهمها صاحب المتجر: التطبيق والمتجر في مؤسستين مختلفتين، أو Client ID/secret خاطئ
    const raw = JSON.stringify(e.details?.data ?? e.message ?? '');
    if (/shop_not_permitted/i.test(raw)) throw new IntegrationError('shopify', 'auth', 'shop_not_permitted', e.details);
    if (['auth', 'invalid', 'not_found'].includes(e.kind)) throw new IntegrationError('shopify', 'auth', 'shopify_client_invalid', e.details);
    throw e;
  }
  if (!data?.access_token) throw new IntegrationError('shopify', 'auth', 'shopify_client_invalid');
  tokenCache.set(key, { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 86399) * 1000 });
  return data.access_token;
}

/** رابط الطلبية في لوحة Shopify (من معرّفها gid://shopify/Order/123) */
export function adminOrderUrl(cfg, externalId) {
  const id = /\/Order\/(\d+)$/.exec(String(externalId || ''))?.[1];
  if (!id || !cfg.shopify_shop) return null;
  try {
    return `https://${shopDomain(cfg)}/admin/orders/${id}`;
  } catch {
    return null;
  }
}

export const isConfigured = (cfg) => Boolean(cfg.shopify_shop && (cfg.shopify_access_token || (cfg.shopify_client_id && cfg.shopify_client_secret)));

export async function gql(cfg, query, variables = {}) {
  const url = `https://${shopDomain(cfg)}/admin/api/${cfg.shopify_api_version || '2026-07'}/graphql.json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await accessToken(cfg);
    let res;
    try {
      res = await request('shopify', url, { method: 'POST', headers: { 'X-Shopify-Access-Token': token }, body: { query, variables } });
    } catch (e) {
      if (e.kind === 'auth') {
        tokenCache.clear();
        throw new IntegrationError('shopify', 'auth', 'shopify_auth_failed', e.details);
      }
      throw e;
    }
    const { data, errors } = res.data || {};
    if (errors?.length) {
      if (errors.some((x) => x.extensions?.code === 'THROTTLED')) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (errors.some((x) => x.extensions?.code === 'ACCESS_DENIED'))
        throw new IntegrationError('shopify', 'auth', 'access_denied', errors.map((x) => x.message).join('; '));
      throw new IntegrationError('shopify', 'invalid', errors.map((x) => x.message).join('; ').slice(0, 400));
    }
    return data;
  }
  throw new IntegrationError('shopify', 'rate_limit', 'throttled');
}

const userErrors = (payload) => {
  const errs = payload?.userErrors || [];
  if (errs.length) throw new IntegrationError('shopify', 'invalid', errs.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; '));
};

export async function shopInfo(cfg) {
  const d = await gql(cfg, '{ shop { name myshopifyDomain currencyCode primaryDomain { url host } } }');
  return d.shop;
}

// ——— الطلبيات ———
const ORDER_FIELDS = `id name createdAt updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus tags note phone
  customAttributes { key value }
  totalPriceSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } }
  shippingAddress { name firstName lastName phone address1 address2 city province zip }
  customer { firstName lastName phone }
  lineItems(first: 30) { nodes { title quantity variantTitle sku originalUnitPriceSet { shopMoney { amount } } variant { id } product { id } } }`;
// مصدر الزيارة (UTM + صفحة الهبوط) — لربط كل طلبية بالصفحة/النسخة التي جلبتها في اختبارات A/B
const JOURNEY_FIELDS = `customerJourneySummary { firstVisit { landingPage utmParameters { source campaign content } } lastVisit { landingPage utmParameters { source campaign content } } }`;
let journeyAllowed = true;

/** الطلبيات المعدلة منذ تاريخ معين (الأقدم أولاً، حتى maxPages صفحة) */
export async function ordersUpdatedSince(cfg, sinceIso, maxPages = 10) {
  const out = [];
  let after = null;
  const q = sinceIso ? `updated_at:>'${sinceIso}'` : 'created_at:>-60d';
  const query = () => `query($q: String!, $after: String) { orders(first: 50, after: $after, query: $q, sortKey: UPDATED_AT) { nodes { ${ORDER_FIELDS} ${journeyAllowed ? JOURNEY_FIELDS : ''} } pageInfo { hasNextPage endCursor } } }`;
  for (let page = 0; page < maxPages; page++) {
    let d;
    try {
      d = await gql(cfg, query(), { q, after });
    } catch (e) {
      // بعض الرموز لا تملك صلاحية رحلة الزبون — نكمل بدونها
      if (!journeyAllowed || !['invalid', 'auth'].includes(e.kind)) throw e;
      journeyAllowed = false;
      d = await gql(cfg, query(), { q, after });
    }
    out.push(...d.orders.nodes);
    if (!d.orders.pageInfo.hasNextPage) break;
    after = d.orders.pageInfo.endCursor;
  }
  return out;
}

const attr = (node, key) => (node.customAttributes || []).find((a) => a.key === key)?.value || '';

/** تحويل طلبية Shopify (بما فيها طلبيات سير COD في n8n) إلى صيغة الـ ERP */
export function parseOrder(node) {
  const a = node.shippingAddress || {};
  const c = node.customer || {};
  const ref = attr(node, 'ref') || /Ref\s+([\w-]+)/.exec(node.note || '')?.[1] || null;
  const wilaya = parseWilaya(attr(node, 'wilaya')) || parseWilaya(a.province) || parseWilaya(a.city);
  const deliveryAttr = attr(node, 'delivery') || '';
  const tags = node.tags || [];
  const desk = /office|desk|bureau/i.test(deliveryAttr) || tags.includes('stopdesk');
  const items = (node.lineItems?.nodes || []).map((li) => ({
    shopify_product_id: li.product?.id || null,
    variant_id: li.variant?.id || null,
    title: li.title,
    variant: li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : '',
    sku: li.sku || '',
    qty: li.quantity,
    price: num(li.originalUnitPriceSet?.shopMoney?.amount),
  }));
  const name = a.name || [a.firstName, a.lastName].filter(Boolean).join(' ') || [c.firstName, c.lastName].filter(Boolean).join(' ');
  const visit = node.customerJourneySummary?.lastVisit || node.customerJourneySummary?.firstVisit || {};
  const utm = visit.utmParameters || {};
  const landing = attr(node, 'landing_page') || attr(node, 'landing_url') || visit.landingPage || null;
  return {
    ref,
    external_id: node.id,
    shopify_name: node.name,
    customer_name: name || null,
    phone: normalizePhone(a.phone) || normalizePhone(node.phone) || normalizePhone(c.phone),
    wilaya_code: wilaya?.code || null,
    commune: attr(node, 'commune') || a.city || null,
    address: [a.address1, a.address2].filter(Boolean).join(' — ') || null,
    delivery_type: desk ? 'desk' : 'home',
    items,
    subtotal: num(node.subtotalPriceSet?.shopMoney?.amount),
    discount: num(node.totalDiscountsSet?.shopMoney?.amount),
    shipping_fee: num(node.totalShippingPriceSet?.shopMoney?.amount),
    total: num(node.totalPriceSet?.shopMoney?.amount),
    utm_source: attr(node, 'utm_source') || utm.source || null,
    utm_campaign: attr(node, 'utm_campaign') || utm.campaign || null,
    utm_content: attr(node, 'utm_content') || utm.content || null,
    landing_url: landing ? String(landing).slice(0, 1000) : null,
    tags,
    created_at: node.createdAt,
    cancelled: Boolean(node.cancelledAt),
    offer: attr(node, 'offer') || null,
  };
}

export async function addOrderTags(cfg, orderGid, tags) {
  const d = await gql(cfg, 'mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }', { id: orderGid, tags });
  userErrors(d.tagsAdd);
}

export async function removeOrderTags(cfg, orderGid, tags) {
  const d = await gql(cfg, 'mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }', { id: orderGid, tags });
  userErrors(d.tagsRemove);
}

export async function markOrderPaid(cfg, orderGid) {
  const d = await gql(cfg, 'mutation($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { userErrors { field message } } }', { input: { id: orderGid } });
  userErrors(d.orderMarkAsPaid);
}

// ——— المخزون: الطرود المرتجعة ———
/** أين يعود المخزون: موقع الطلبية (إن سمحت صلاحيات fulfillment) وإلا الموقع الرئيسي؛ ولكل variant عنصر مخزونه وهل يُتتبَّع */
export async function restockTargets(cfg, orderGid, variantIds) {
  const d = await gql(cfg, 'query($ids: [ID!]!) { location { id } nodes(ids: $ids) { ... on ProductVariant { id inventoryItem { id tracked } } } }', { ids: variantIds });
  let locationId = d.location?.id || null;
  try {
    const o = await gql(cfg, 'query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 5) { nodes { assignedLocation { location { id } } } } } }', { id: orderGid });
    locationId = o.order?.fulfillmentOrders?.nodes?.find((n) => n.assignedLocation?.location?.id)?.assignedLocation.location.id || locationId;
  } catch {
    /* صلاحيات fulfillment غير ممنوحة: الموقع الرئيسي */
  }
  const items = Object.fromEntries((d.nodes || []).filter(Boolean).map((n) => [n.id, { inventoryItemId: n.inventoryItem?.id || null, tracked: Boolean(n.inventoryItem?.tracked) }]));
  return { locationId, items };
}

/**
 * تعديل الكمية «المتاحة» بفارق (+ إرجاع، − تالف/مفقود/تصحيح). مفتاح @idempotent إلزامي منذ 2026-04:
 * نفس المفتاح عند إعادة المحاولة لا يطبّق التعديل مرتين.
 */
export async function adjustAvailable(cfg, { locationId, changes, reason, reference, key }) {
  const d = await gql(
    cfg,
    'mutation($input: InventoryAdjustQuantitiesInput!, $key: String!) { inventoryAdjustQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { id } userErrors { field message } } }',
    {
      input: { name: 'available', reason, referenceDocumentUri: reference, changes: changes.map((c) => ({ inventoryItemId: c.inventoryItemId, locationId, delta: c.delta, changeFromQuantity: null })) },
      key,
    },
  );
  userErrors(d.inventoryAdjustQuantities);
  return d.inventoryAdjustQuantities.inventoryAdjustmentGroup?.id || null;
}

// ——— المنتجات ———
const PRODUCT_FIELDS = `id title handle status productType vendor tags descriptionHtml onlineStoreUrl updatedAt totalInventory
  seo { title description }
  options { name values }
  collections(first: 20) { nodes { id title handle } }
  media(first: 20) { nodes { ... on MediaImage { id alt image { url } } } }
  variants(first: 100) { nodes { id title sku price compareAtPrice inventoryQuantity selectedOptions { name value } } }`;

export async function allProducts(cfg) {
  const out = [];
  let after = null;
  for (let page = 0; page < 40; page++) {
    const d = await gql(cfg, `query($after: String) { products(first: 50, after: $after) { nodes { ${PRODUCT_FIELDS} } pageInfo { hasNextPage endCursor } } }`, { after });
    out.push(...d.products.nodes);
    if (!d.products.pageInfo.hasNextPage) break;
    after = d.products.pageInfo.endCursor;
  }
  return out;
}

/** صفحات المتجر (من نحن، الأسئلة الشائعة، صفحات الهبوط…) — الصلاحية: read_online_store_pages */
export async function listPages(cfg) {
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const d = await gql(cfg, `query($after: String) { pages(first: 100, after: $after) { nodes { id title handle isPublished templateSuffix } pageInfo { hasNextPage endCursor } } }`, { after });
    out.push(...d.pages.nodes);
    if (!d.pages.pageInfo.hasNextPage) break;
    after = d.pages.pageInfo.endCursor;
  }
  return out;
}

export async function getProduct(cfg, gid) {
  const d = await gql(cfg, `query($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`, { id: gid });
  return d.product;
}

export function mapProduct(node) {
  const variants = (node.variants?.nodes || []).map((v) => ({
    id: v.id,
    title: v.title,
    sku: v.sku || '',
    price: num(v.price),
    compare_at_price: v.compareAtPrice ? num(v.compareAtPrice) : null,
    stock: v.inventoryQuantity,
    options: Object.fromEntries((v.selectedOptions || []).map((o) => [o.name, o.value])),
  }));
  const prices = variants.map((v) => v.price).filter((p) => p > 0);
  return {
    shopify_id: node.id,
    title: node.title,
    handle: node.handle,
    shopify_status: node.status,
    product_type: node.productType || '',
    vendor: node.vendor || '',
    tags: node.tags || [],
    collections: (node.collections?.nodes || []).map((c) => ({ id: c.id, title: c.title, handle: c.handle })),
    description_html: node.descriptionHtml || '',
    seo_title: node.seo?.title || '',
    seo_description: node.seo?.description || '',
    price: prices.length ? Math.min(...prices) : null,
    compare_at_price: variants.find((v) => v.compare_at_price)?.compare_at_price ?? null,
    options: (node.options || []).filter((o) => !(o.name === 'Title' && o.values?.[0] === 'Default Title')),
    variants,
    images: (node.media?.nodes || []).filter((m) => m.image).map((m) => ({ id: m.id, url: m.image.url, alt: m.alt || '' })),
    stock: node.totalInventory,
    online_url: node.onlineStoreUrl || null,
  };
}

export async function collections(cfg) {
  const d = await gql(cfg, '{ collections(first: 100, sortKey: TITLE) { nodes { id title handle productsCount { count } } } }');
  return d.collections.nodes.map((c) => ({ id: c.id, title: c.title, handle: c.handle, count: c.productsCount?.count ?? 0 }));
}

export async function createCollection(cfg, { title, handle, descriptionHtml, seoTitle, seoDescription }) {
  const d = await gql(
    cfg,
    'mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id title handle } userErrors { field message } } }',
    { input: { title, handle, descriptionHtml, seo: { title: seoTitle, description: seoDescription } } },
  );
  userErrors(d.collectionCreate);
  return d.collectionCreate.collection;
}

/** خيارات المنتج والمتغيرات بالشكل الذي يقبله productSet */
function optionsAndVariants(p) {
  const opts = (p.options || []).filter((o) => o.name && o.values?.length);
  if (!opts.length) {
    return {
      productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
      variants: [
        {
          optionValues: [{ optionName: 'Title', name: 'Default Title' }],
          price: String(p.price ?? 0),
          ...(p.compare_at_price ? { compareAtPrice: String(p.compare_at_price) } : {}),
          ...(p.sku ? { sku: p.sku } : {}),
        },
      ],
    };
  }
  const variants = (p.variants?.length ? p.variants : cartesian(opts)).map((v) => ({
    optionValues: opts.map((o) => ({ optionName: o.name, name: v.options?.[o.name] })),
    price: String(v.price ?? p.price ?? 0),
    ...((v.compare_at_price ?? p.compare_at_price) ? { compareAtPrice: String(v.compare_at_price ?? p.compare_at_price) } : {}),
    ...(v.sku ? { sku: v.sku } : {}),
  }));
  return { productOptions: opts.map((o) => ({ name: o.name, values: o.values.map((name) => ({ name })) })), variants };
}

function cartesian(opts) {
  let combos = [{}];
  for (const o of opts) combos = combos.flatMap((c) => o.values.map((val) => ({ ...c, [o.name]: val })));
  return combos.map((options) => ({ options }));
}

/** إنشاء منتج كامل (نص، SEO، خيارات، صور بنص بديل، مجموعات) في طلب واحد */
export async function createProduct(cfg, p, { status = 'DRAFT' } = {}) {
  const { productOptions, variants } = optionsAndVariants(p);
  const input = {
    title: p.title,
    handle: p.handle || undefined,
    descriptionHtml: p.description_html || '',
    productType: p.product_type || undefined,
    vendor: p.vendor || undefined,
    tags: p.tags || [],
    status,
    ...(p.category_id ? { category: p.category_id } : {}),
    seo: { title: p.seo_title || p.title, description: p.seo_description || '' },
    productOptions,
    variants,
    collections: (p.collections || []).map((c) => c.id).filter(Boolean),
    files: (p.images || [])
      .filter((img) => /^https:\/\//.test(img.url || ''))
      .map((img) => ({ originalSource: img.url, alt: img.alt || p.title, contentType: 'IMAGE' })),
  };
  const d = await gql(
    cfg,
    `mutation($input: ProductSetInput!) { productSet(input: $input, synchronous: true) { product { ${PRODUCT_FIELDS} } userErrors { field message code } } }`,
    { input },
  );
  userErrors(d.productSet);
  return d.productSet.product;
}

/** تعديل منتج قائم دون المساس بمتغيراته (العنوان، الوصف، SEO، الوسوم، المجموعات، الحالة) */
export async function updateProduct(cfg, gid, changes, { joinCollections = [], leaveCollections = [], newImages = [] } = {}) {
  const product = { id: gid };
  for (const [k, field] of [
    ['title', 'title'],
    ['handle', 'handle'],
    ['description_html', 'descriptionHtml'],
    ['product_type', 'productType'],
    ['vendor', 'vendor'],
    ['tags', 'tags'],
    ['status', 'status'],
    ['category', 'category'],
  ])
    if (changes[k] !== undefined) product[field] = changes[k];
  if (changes.seo_title !== undefined || changes.seo_description !== undefined) product.seo = { title: changes.seo_title, description: changes.seo_description };
  if (changes.handle !== undefined) product.redirectNewHandle = true; // تحويل 301 من الرابط القديم للحفاظ على ترتيب البحث
  if (joinCollections.length) product.collectionsToJoin = joinCollections;
  if (leaveCollections.length) product.collectionsToLeave = leaveCollections;
  const media = newImages.map((img) => ({ originalSource: img.url, alt: img.alt || '', mediaContentType: 'IMAGE' }));
  const d = await gql(
    cfg,
    `mutation($product: ProductUpdateInput!, $media: [CreateMediaInput!]) { productUpdate(product: $product, media: $media) { product { ${PRODUCT_FIELDS} } userErrors { field message } } }`,
    { product, media: media.length ? media : null },
  );
  userErrors(d.productUpdate);
  return d.productUpdate.product;
}

export async function updateVariantPrices(cfg, productGid, variants) {
  const d = await gql(
    cfg,
    'mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }',
    {
      productId: productGid,
      variants: variants.map((v) => ({ id: v.id, price: String(v.price), compareAtPrice: v.compare_at_price ? String(v.compare_at_price) : null })),
    },
  );
  userErrors(d.productVariantsBulkUpdate);
}

/**
 * رفع صورة محلية (مولّدة داخل الـ ERP) إلى Shopify عبر Staged Upload — لأن الجهاز المحلي غير متاح من الإنترنت.
 * يعيد resourceUrl الذي يُستعمل كـ originalSource في productSet/productUpdate.
 */
export async function stagedUpload(cfg, { buffer, filename, mimeType }) {
  const d = await gql(
    cfg,
    'mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }',
    { input: [{ filename, mimeType, httpMethod: 'POST', resource: 'IMAGE', fileSize: String(buffer.length) }] },
  );
  userErrors(d.stagedUploadsCreate);
  const target = d.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.set(p.name, p.value);
  form.set('file', new Blob([buffer], { type: mimeType }), filename);
  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!res.ok && res.status !== 201 && res.status !== 204) throw new IntegrationError('shopify', 'invalid', `staged_upload_${res.status}`);
  return target.resourceUrl;
}

/** تحديث النص البديل (alt) لصور منتج قائم — MediaImage هو ملف في Shopify ويُعدَّل عبر fileUpdate */
export async function updateImageAlt(cfg, images) {
  if (!images.length) return;
  const d = await gql(cfg, 'mutation($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { userErrors { field message } } }', {
    files: images.map((i) => ({ id: i.id, alt: i.alt })),
  });
  userErrors(d.fileUpdate);
}

/** فئات Shopify القياسية (Standard Product Taxonomy) لتحسين الظهور في Google Shopping والبحث */
export async function searchCategories(cfg, search) {
  const d = await gql(cfg, 'query($q: String!) { taxonomy { categories(first: 10, search: $q) { nodes { id name fullName } } } }', { q: search });
  return d.taxonomy?.categories?.nodes || [];
}

// ——— اختبار الصفحات داخل المتجر نفسه (نفس الدومين) ———
// الإعدادات في metafield على مستوى المتجر (لا تحتاج استثناءً من Shopify)، والكود سنيبت واحد في القالب.
export const SPLIT_NAMESPACE = 'erp_toureche';
export const SPLIT_KEY = 'splits';

export async function shopGid(cfg) {
  return (await gql(cfg, '{ shop { id } }')).shop.id;
}

export async function setShopJsonMetafield(cfg, namespace, key, value) {
  const ownerId = await shopGid(cfg);
  const d = await gql(
    cfg,
    `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
    { m: [{ ownerId, namespace, key, type: 'json', value: JSON.stringify(value) }] },
  );
  userErrors(d.metafieldsSet);
  return d.metafieldsSet.metafields?.[0]?.id || null;
}

export async function mainTheme(cfg) {
  const d = await gql(cfg, '{ themes(first: 1, roles: [MAIN]) { nodes { id name } } }');
  return d.themes.nodes[0] || null;
}

/** قراءة ملفات القالب (layout/theme.liquid، قوالب المنتج البديلة…) */
export async function themeFiles(cfg, themeId, filenames) {
  const q = `query($id: ID!, $f: [String!]) { theme(id: $id) { files(first: 100, filenames: $f) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`;
  const d = await gql(cfg, q, { id: themeId, f: filenames });
  return (d.theme?.files?.nodes || []).map((n) => ({ filename: n.filename, content: n.body?.content ?? null }));
}

/** كتابة ملفات القالب — قد ترفضها Shopify إن لم يكن للتطبيق استثناء (عندها التثبيت يدوي بنسخ/لصق) */
export async function upsertThemeFiles(cfg, themeId, files) {
  const d = await gql(
    cfg,
    `mutation($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $id, files: $files) { upsertedThemeFiles { filename } userErrors { field message } } }`,
    { id: themeId, files: files.map((f) => ({ filename: f.filename, body: { type: 'TEXT', value: f.content } })) },
  );
  userErrors(d.themeFilesUpsert);
  return d.themeFilesUpsert.upsertedThemeFiles.map((f) => f.filename);
}
