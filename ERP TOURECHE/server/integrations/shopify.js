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
const tokenKey = (cfg) => `${cfg.projectId}:${cfg.shopify_client_id}`;
async function accessToken(cfg) {
  if (!cfg.shopify_client_id || !cfg.shopify_client_secret) {
    if (cfg.shopify_access_token) return cfg.shopify_access_token;
    throw new IntegrationError('shopify', 'config', 'credentials_missing');
  }
  const key = tokenKey(cfg);
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
  let refreshed = false;
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
      if (errors.some((x) => x.extensions?.code === 'ACCESS_DENIED')) {
        // صلاحية أُضيفت للتو (نسخة جديدة من التطبيق) لا تظهر في الرمز المحفوظ: رمز جديد ومحاولة واحدة قبل الرفض
        if (!refreshed && cfg.shopify_client_id && cfg.shopify_client_secret) {
          refreshed = true;
          tokenCache.delete(tokenKey(cfg));
          continue;
        }
        throw new IntegrationError('shopify', 'auth', 'access_denied', errors.map((x) => x.message).join('; '));
      }
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
  customer { firstName lastName defaultPhoneNumber { phoneNumber } }
  lineItems(first: 30) { nodes { title quantity variantTitle sku originalUnitPriceSet { shopMoney { amount } } variant { id } product { id } } }`;
// مصدر الزيارة (UTM + صفحة الهبوط) — لربط كل طلبية بالصفحة/النسخة التي جلبتها في اختبارات A/B
const JOURNEY_FIELDS = `customerJourneySummary { firstVisit { landingPage utmParameters { source campaign content } } lastVisit { landingPage utmParameters { source campaign content } } }`;
let journeyAllowed = true;

/** الطلبيات المعدلة منذ تاريخ معين (الأقدم أولاً، حتى maxPages صفحة) */
export async function ordersUpdatedSince(cfg, sinceIso, maxPages = 10) {
  const out = [];
  let after = null;
  // تاريخ مطلق: Shopify يرفض الصيغة النسبية «created_at:>-60d» (Invalid timestamp)، فكانت أول مزامنة تفشل
  const q = sinceIso ? `updated_at:>'${sinceIso}'` : `created_at:>'${new Date(Date.now() - 60 * 86400e3).toISOString()}'`;
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
  // معاملات رابط الصفحة نفسها (السنيبت يضع فيها utm_content و erp_v): احتياط إن لم تصل كخصائص منفصلة
  const fromLanding = (k) => {
    try {
      return landing ? new URL(landing, 'https://store.invalid').searchParams.get(k) || '' : '';
    } catch {
      return '';
    }
  };
  return {
    ref,
    external_id: node.id,
    shopify_name: node.name,
    customer_name: name || null,
    phone: normalizePhone(a.phone) || normalizePhone(node.phone) || normalizePhone(c.defaultPhoneNumber?.phoneNumber),
    wilaya_code: wilaya?.code || null,
    commune: attr(node, 'commune') || a.city || null,
    address: [a.address1, a.address2].filter(Boolean).join(' — ') || null,
    delivery_type: desk ? 'desk' : 'home',
    items,
    subtotal: num(node.subtotalPriceSet?.shopMoney?.amount),
    discount: num(node.totalDiscountsSet?.shopMoney?.amount),
    shipping_fee: num(node.totalShippingPriceSet?.shopMoney?.amount),
    total: num(node.totalPriceSet?.shopMoney?.amount),
    utm_source: attr(node, 'utm_source') || utm.source || fromLanding('utm_source') || null,
    utm_campaign: attr(node, 'utm_campaign') || utm.campaign || fromLanding('utm_campaign') || null,
    utm_content: attr(node, 'utm_content') || utm.content || fromLanding('utm_content') || null,
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

// ——— قائمة المتجر الرئيسية (الشريط العلوي): مجموعة لا تظهر فيها لا يجدها الزبون ———
const MENU_ITEM = 'id title type resourceId url tags';
const MENU_ITEMS = `items { ${MENU_ITEM} items { ${MENU_ITEM} items { ${MENU_ITEM} } } }`;

export async function mainMenu(cfg) {
  const d = await gql(cfg, `{ menus(first: 25) { nodes { id title handle isDefault ${MENU_ITEMS} } } }`);
  const menus = d.menus.nodes;
  return menus.find((m) => m.handle === 'main-menu') || menus.find((m) => m.isDefault && m.handle !== 'footer') || null;
}

export const menuResourceIds = (items = []) => items.flatMap((i) => [i.resourceId, ...menuResourceIds(i.items)]).filter(Boolean);

// menuUpdate يستبدل القائمة كلها: نعيد كل عنصر كما هو (بمعرّفه) ونضيف الجديد في آخرها
const menuInput = (items = []) =>
  items.map((i) => ({ id: i.id, title: i.title, type: i.type, tags: i.tags, ...(i.resourceId ? { resourceId: i.resourceId } : { url: i.url }), items: menuInput(i.items) }));

export async function addCollectionToMenu(cfg, { id, title }) {
  const menu = await mainMenu(cfg);
  if (!menu) throw new IntegrationError('shopify', 'invalid', 'main_menu_not_found');
  if (menuResourceIds(menu.items).includes(id)) return { menu: menu.title, added: false };
  const d = await gql(cfg, 'mutation($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $title, items: $items) { menu { id } userErrors { field message } } }', {
    id: menu.id,
    title: menu.title,
    items: [...menuInput(menu.items), { title, type: 'COLLECTION', resourceId: id }],
  });
  userErrors(d.menuUpdate);
  return { menu: menu.title, added: true };
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

const qty = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Math.max(0, Math.round(Number(x))));

/** إنشاء منتج كامل (نص، SEO، خيارات، صور بنص بديل، مجموعات، ومخزون كل متغير إن وُجد موقع) في طلب واحد */
export async function createProduct(cfg, p, { status = 'DRAFT', locationId = null } = {}) {
  const { productOptions, variants: base } = optionsAndVariants(p);
  const hasOptions = (p.options || []).some((o) => o.name && o.values?.length);
  const stocks = hasOptions ? (p.variants?.length ? p.variants.map((v) => qty(v.stock)) : []) : [qty(p.stock)];
  // المخزون المكتوب في الـ ERP يصل مع الإنشاء، والمتغير يُتتبَّع (ملصق «باقي N» ومنع البيع عند النفاد)
  const variants = base.map((v, i) => (locationId && stocks[i] !== null && stocks[i] !== undefined ? { ...v, inventoryItem: { tracked: true }, inventoryQuantities: [{ locationId, name: 'available', quantity: stocks[i] }] } : v));
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

/**
 * مزامنة الخيارات والمتغيرات (اللون، المقاس…) كما في الـ ERP: productSet يستبدل قائمة المتغيرات كلها،
 * فالموجود يُرسل بمعرّفه (يحتفظ بمخزونه وطلبياته)، والجديد يُنشأ مُتتبَّع المخزون، وما حُذف في الـ ERP يُحذف.
 * الصور والنصوص لا تُلمس (لا تُرسل).
 */
export async function setOptionsAndVariants(cfg, productGid, p, { locationId = null } = {}) {
  const { productOptions, variants } = optionsAndVariants(p);
  const stockOf = new Map((p.variants || []).map((v) => [JSON.stringify(Object.entries(v.options || {}).sort(([a], [b]) => a.localeCompare(b))), qty(v.stock)]));
  const keyOf = (obj) => JSON.stringify(Object.entries(obj || {}).sort(([a], [b]) => a.localeCompare(b)));
  const byKey = new Map((p.variants || []).filter((v) => v.id).map((v) => [keyOf(v.options), v.id]));
  const input = {
    id: productGid,
    productOptions,
    variants: variants.map((v) => {
      const key = keyOf(Object.fromEntries(v.optionValues.map((o) => [o.optionName, o.name])));
      const id = byKey.get(key);
      if (id) return { ...v, id };
      // متغير جديد (لون أُضيف): يُنشأ مُتتبَّعاً، وبمخزونه إن كُتب في الـ ERP
      const q = stockOf.get(key);
      return { ...v, inventoryItem: { tracked: true }, ...(locationId && q !== null && q !== undefined ? { inventoryQuantities: [{ locationId, name: 'available', quantity: q }] } : {}) };
    }),
  };
  const d = await gql(cfg, `mutation($input: ProductSetInput!) { productSet(input: $input, synchronous: true) { product { ${PRODUCT_FIELDS} } userErrors { field message code } } }`, { input });
  userErrors(d.productSet);
  return d.productSet.product;
}

/** صور حذفها التاجر في الـ ERP: تُفصل عن المنتج (تبقى في «Fichiers» فلا يضيع ملف مستعمل في مكان آخر) */
export async function detachProductMedia(cfg, productGid, mediaIds) {
  if (!mediaIds.length) return;
  const d = await gql(cfg, 'mutation($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { userErrors { field message } } }', {
    files: mediaIds.map((id) => ({ id, referencesToRemove: [productGid] })),
  });
  userErrors(d.fileUpdate);
}

/** ترتيب صور المنتج كما في الـ ERP (الأولى = الرئيسية في المتجر والمجموعات وجوجل) */
export async function reorderProductMedia(cfg, productGid, orderedIds, currentIds) {
  const moves = orderedIds.map((id, i) => ({ id, newPosition: String(i) })).filter((m, i) => currentIds[i] !== m.id);
  if (!moves.length) return false;
  const d = await gql(cfg, 'mutation($id: ID!, $moves: [MoveInput!]!) { productReorderMedia(id: $id, moves: $moves) { job { id } mediaUserErrors { field message } } }', { id: productGid, moves });
  const errs = d.productReorderMedia.mediaUserErrors || [];
  if (errs.length) throw new IntegrationError('shopify', 'invalid', errs.map((e) => e.message).join('; '));
  return true;
}

// ——— الظهور في «المتجر الإلكتروني»: منتج نشط غير منشور على قناة البيع لا يراه أحد في الموقع ———
export async function onlineStorePublication(cfg) {
  const d = await gql(cfg, '{ publications(first: 20) { nodes { id supportsFuturePublishing catalog { title } } } }');
  const nodes = d.publications.nodes || [];
  return (nodes.find((x) => /online store|boutique en ligne/i.test(x.catalog?.title || '')) || nodes.find((x) => x.supportsFuturePublishing) || null)?.id || null;
}

/** يتأكد أن المنتج منشور على قناة المتجر الإلكتروني (write_publications)؛ لا يفعل شيئاً إن كان منشوراً */
export async function publishToOnlineStore(cfg, productGid) {
  const pub = await onlineStorePublication(cfg);
  if (!pub) return { published: false, reason: 'online_store_not_found' };
  const s = await gql(cfg, 'query($id: ID!, $pub: ID!) { product(id: $id) { publishedOnPublication(publicationId: $pub) } }', { id: productGid, pub });
  if (s.product?.publishedOnPublication) return { published: true, changed: false };
  const d = await gql(cfg, 'mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }', { id: productGid, input: [{ publicationId: pub }] });
  userErrors(d.publishablePublish);
  return { published: true, changed: true };
}

// ——— المخزون من الـ ERP: يصل إلى المتجر فوراً (ملصق «متوفر / باقي N» في صفحة المنتج) ———
export async function primaryLocation(cfg) {
  return (await gql(cfg, '{ location { id } }')).location?.id || null;
}

export async function variantInventory(cfg, variantIds) {
  const d = await gql(cfg, 'query($ids: [ID!]!) { location { id } nodes(ids: $ids) { ... on ProductVariant { id inventoryQuantity inventoryItem { id tracked } } } }', { ids: variantIds });
  return {
    locationId: d.location?.id || null,
    variants: (d.nodes || []).filter(Boolean).map((n) => ({ id: n.id, quantity: n.inventoryQuantity, inventoryItemId: n.inventoryItem?.id || null, tracked: Boolean(n.inventoryItem?.tracked) })),
  };
}

/** كميات مطلقة (الـ ERP مرجع المخزون). المفتاح @idempotent إلزامي منذ 2026-04 */
export async function setAvailable(cfg, { locationId, quantities, reason = 'correction', key }) {
  const d = await gql(
    cfg,
    'mutation($input: InventorySetQuantitiesInput!, $key: String!) { inventorySetQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { id } userErrors { field message } } }',
    { input: { name: 'available', reason, quantities: quantities.map((q) => ({ inventoryItemId: q.inventoryItemId, locationId, quantity: q.quantity, changeFromQuantity: null })) }, key },
  );
  userErrors(d.inventorySetQuantities);
}

export async function trackInventory(cfg, inventoryItemIds) {
  for (const id of inventoryItemIds) {
    const d = await gql(cfg, 'mutation($id: ID!, $input: InventoryItemInput!) { inventoryItemUpdate(id: $id, input: $input) { userErrors { field message } } }', { id, input: { tracked: true } });
    userErrors(d.inventoryItemUpdate);
  }
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

/**
 * رفع صورة إلى «Fichiers» في Shopify (write_files) وانتظار رابطها على CDN.
 * للصور الوصفية في صفحات الهبوط: لا تدخل معرض المنتج، والقالب يعرضها برابطها.
 */
export async function uploadFile(cfg, { buffer, filename, mimeType, alt = '' }) {
  const resourceUrl = await stagedUpload(cfg, { buffer, filename, mimeType });
  const d = await gql(
    cfg,
    'mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id fileStatus ... on MediaImage { image { url width height } } } userErrors { field message } } }',
    { files: [{ originalSource: resourceUrl, contentType: 'IMAGE', alt: String(alt).slice(0, 500), filename }] },
  );
  userErrors(d.fileCreate);
  let file = d.fileCreate.files?.[0];
  // Shopify يعالج الصورة بعد الرفع: الرابط يظهر حين تصير READY (ثوانٍ عادة)
  for (let i = 0; i < 20 && file && !file.image?.url; i++) {
    if (file.fileStatus === 'FAILED') break;
    await sleep(1500);
    file = (await gql(cfg, 'query($id: ID!) { node(id: $id) { ... on MediaImage { id fileStatus image { url width height } } } }', { id: file.id })).node;
  }
  if (!file?.image?.url) throw new IntegrationError('shopify', 'invalid', file?.fileStatus === 'FAILED' ? 'file_processing_failed' : 'file_not_ready');
  return { id: file.id, url: file.image.url, width: file.image.width, height: file.image.height };
}

/** ملفات JSON في القالب (config/settings_data.json، templates/*.json) تبدأ بتعليق /* … *\/ يضيفه Shopify */
export const parseThemeJson = (content) => JSON.parse(String(content || '').replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ''));

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

/** الصلاحيات الممنوحة فعلاً على المتجر (لا تحتاج صلاحية). صلاحية أُضيفت في Dev Dashboard لا تُحسب قبل الموافقة عليها في المتجر */
export async function grantedScopes(cfg) {
  const d = await gql(cfg, '{ currentAppInstallation { accessScopes { handle } } }');
  return (d.currentAppInstallation?.accessScopes || []).map((s) => s.handle);
}
// صلاحية الكتابة تشمل القراءة
export const hasScope = (granted, scope) => granted.includes(scope) || (scope.startsWith('read_') && granted.includes(`write_${scope.slice(5)}`));

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

/** كتابة ملفات القالب (write_themes). Shopify تشترط استثناءً إضافياً على تطبيقات التوزيع العام فقط؛ إن رُفضت: التثبيت يدوي بنسخ/لصق */
export async function upsertThemeFiles(cfg, themeId, files) {
  const d = await gql(
    cfg,
    `mutation($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $id, files: $files) { upsertedThemeFiles { filename } userErrors { field message } } }`,
    { id: themeId, files: files.map((f) => ({ filename: f.filename, body: { type: 'TEXT', value: f.content } })) },
  );
  userErrors(d.themeFilesUpsert);
  return d.themeFilesUpsert.upsertedThemeFiles.map((f) => f.filename);
}

/** حذف ملفات من القالب (قالب صفحة هبوط لم تعد مستعملة) */
export async function deleteThemeFiles(cfg, themeId, filenames) {
  const d = await gql(cfg, `mutation($id: ID!, $f: [String!]!) { themeFilesDelete(themeId: $id, files: $f) { deletedThemeFiles { filename } userErrors { field message } } }`, { id: themeId, f: filenames });
  userErrors(d.themeFilesDelete);
  return (d.themeFilesDelete.deletedThemeFiles || []).map((f) => f.filename);
}

// ——— تحويلات الروابط (write_online_store_navigation): ‎/pages/<slug>‎ → قالب صفحة الهبوط. Shopify يمرّر معاملات الرابط (fbclid، utm…) ———
export async function findUrlRedirect(cfg, path) {
  const d = await gql(cfg, 'query($q: String!) { urlRedirects(first: 5, query: $q) { nodes { id path target } } }', { q: `path:${path}` });
  return d.urlRedirects.nodes.find((r) => decodeURIComponent(r.path).toLowerCase() === decodeURIComponent(path).toLowerCase()) || null;
}

export async function createUrlRedirect(cfg, path, target) {
  const d = await gql(cfg, 'mutation($r: UrlRedirectInput!) { urlRedirectCreate(urlRedirect: $r) { urlRedirect { id path target } userErrors { field message } } }', { r: { path, target } });
  userErrors(d.urlRedirectCreate);
  return d.urlRedirectCreate.urlRedirect;
}

export async function updateUrlRedirect(cfg, id, path, target) {
  const d = await gql(cfg, 'mutation($id: ID!, $r: UrlRedirectInput!) { urlRedirectUpdate(id: $id, urlRedirect: $r) { urlRedirect { id path target } userErrors { field message } } }', { id, r: { path, target } });
  userErrors(d.urlRedirectUpdate);
  return d.urlRedirectUpdate.urlRedirect;
}

export async function deleteUrlRedirect(cfg, id) {
  const d = await gql(cfg, 'mutation($id: ID!) { urlRedirectDelete(id: $id) { deletedUrlRedirectId userErrors { field message } } }', { id });
  userErrors(d.urlRedirectDelete);
  return d.urlRedirectDelete.deletedUrlRedirectId;
}

/** كل التحويلات (حتى 250) — لإيجاد بقايا صفحات هبوط حُذفت من الـ ERP */
export async function listUrlRedirects(cfg) {
  const d = await gql(cfg, '{ urlRedirects(first: 250) { nodes { id path target } } }');
  return d.urlRedirects.nodes;
}

/** أسماء ملفات القالب بنمط (مثل ‎templates/product.lp-*‎) */
export async function themeFileNames(cfg, themeId, pattern) {
  const d = await gql(cfg, 'query($id: ID!, $f: [String!]) { theme(id: $id) { files(first: 250, filenames: $f) { nodes { filename } } } }', { id: themeId, f: [pattern] });
  return (d.theme?.files?.nodes || []).map((n) => n.filename);
}

/** ملفات «Fichiers» بأسمائها الدقيقة (اسم الملف من آخر رابطه على CDN) */
export async function findFilesByName(cfg, names) {
  const list = [...new Set(names.filter(Boolean))];
  if (!list.length) return [];
  const q = list.map((n) => `filename:"${String(n).replace(/["\\]/g, '')}"`).join(' OR ');
  const d = await gql(cfg, 'query($q: String!) { files(first: 50, query: $q) { nodes { id ... on MediaImage { image { url } } } } }', { q });
  return d.files.nodes.filter((f) => f?.id);
}

export async function deleteFiles(cfg, ids) {
  if (!ids.length) return [];
  const d = await gql(cfg, 'mutation($ids: [ID!]!) { fileDelete(fileIds: $ids) { deletedFileIds userErrors { field message } } }', { ids });
  userErrors(d.fileDelete);
  return d.fileDelete.deletedFileIds || [];
}
