import Database from 'better-sqlite3';
import { config } from '../config.js';

// جداول تُعرَّف مرة وتُستعمل في الإنشاء الأول وفي ترقية القواعد القديمة
const CONTACTS_SQL = `
  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'supplier' CHECK (kind IN ('supplier','delivery','service','wholesale','other')),
    company TEXT,
    phone TEXT,
    email TEXT,
    notes TEXT,
    carrier TEXT,
    wilaya_code INTEGER,
    role TEXT,
    lead_time_days INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`;

const STORE_PAGES_SQL = `
  CREATE TABLE IF NOT EXISTS store_pages (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('page','product','url')),
    url TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    shopify_id TEXT,
    template_suffix TEXT,
    published INTEGER NOT NULL DEFAULT 1,
    gone INTEGER NOT NULL DEFAULT 0,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (project_id, url)
  );`;

// كل تعديل على البنية يُضاف كهجرة جديدة في آخر القائمة (لا تُعدَّل الهجرات القديمة)
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','manager','agent')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    sensitive_until TEXT,
    ip TEXT,
    user_agent TEXT
  );

  CREATE TABLE login_attempts (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    domain TEXT,
    color TEXT DEFAULT '#0E6B63',
    currency TEXT NOT NULL DEFAULT 'DZD',
    active INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE settings (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    is_secret INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (scope, key)
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    shopify_id TEXT,
    handle TEXT,
    title TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'draft' CHECK (stage IN ('idea','draft','ready','published','archived')),
    shopify_status TEXT,
    product_type TEXT,
    vendor TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    collections TEXT NOT NULL DEFAULT '[]',
    description_html TEXT,
    seo_title TEXT,
    seo_description TEXT,
    focus_keyword TEXT,
    price REAL,
    compare_at_price REAL,
    cost_price REAL,
    options TEXT NOT NULL DEFAULT '[]',
    variants TEXT NOT NULL DEFAULT '[]',
    images TEXT NOT NULL DEFAULT '[]',
    stock INTEGER,
    low_stock INTEGER NOT NULL DEFAULT 5,
    sku TEXT,
    specs TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    audience TEXT,
    angles TEXT NOT NULL DEFAULT '[]',
    seo_score INTEGER,
    online_url TEXT,
    test_stage TEXT NOT NULL DEFAULT 'idea' CHECK (test_stage IN ('none','idea','preparing','testing','winner','loser','paused')),
    test_budget_da REAL,
    test_started_at TEXT,
    decision_note TEXT,
    supplier TEXT,
    supplier_url TEXT,
    supplier_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    packaging_cost REAL,
    category_id TEXT,
    category_name TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (project_id, shopify_id)
  );
  CREATE INDEX idx_products_project ON products(project_id, stage);

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ref TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    shopify_name TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    customer_name TEXT,
    phone TEXT,
    phone2 TEXT,
    wilaya_code INTEGER,
    commune TEXT,
    commune_fr TEXT,
    address TEXT,
    delivery_type TEXT NOT NULL DEFAULT 'home' CHECK (delivery_type IN ('home','desk')),
    stopdesk_id TEXT,
    items TEXT NOT NULL DEFAULT '[]',
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    shipping_fee REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    shipping_cost REAL,
    cogs REAL,
    carrier TEXT,
    tracking TEXT,
    label_url TEXT,
    carrier_status TEXT,
    carrier_status_raw TEXT,
    carrier_synced_at TEXT,
    call_attempts INTEGER NOT NULL DEFAULT 0,
    delivery_attempts INTEGER NOT NULL DEFAULT 0,
    callback_at TEXT,
    cancel_reason TEXT,
    notes TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    utm_source TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    landing_url TEXT,
    livreur_rating INTEGER,
    livreur_called INTEGER,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sheet_row INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    confirmed_at TEXT,
    shipped_at TEXT,
    delivered_at TEXT,
    returned_at TEXT,
    cancelled_at TEXT,
    closed_at TEXT
  );
  CREATE INDEX idx_orders_project_status ON orders(project_id, status);
  CREATE INDEX idx_orders_created ON orders(project_id, created_at);
  CREATE INDEX idx_orders_phone ON orders(phone);
  CREATE UNIQUE INDEX idx_orders_ref ON orders(project_id, ref) WHERE ref IS NOT NULL;
  CREATE UNIQUE INDEX idx_orders_external ON orders(project_id, external_id) WHERE external_id IS NOT NULL;
  CREATE INDEX idx_orders_tracking ON orders(carrier, tracking);
  CREATE INDEX idx_orders_carrier_wilaya ON orders(carrier, wilaya_code, status);

  CREATE TABLE order_events (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    carrier_status TEXT,
    raw TEXT,
    location TEXT,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    user_id INTEGER,
    at TEXT NOT NULL
  );
  CREATE INDEX idx_events_order ON order_events(order_id, at);
  CREATE UNIQUE INDEX idx_events_carrier_dedupe ON order_events(order_id, type, raw, at) WHERE type = 'carrier';

  CREATE TABLE carrier_tariffs (
    project_id INTEGER NOT NULL DEFAULT 0,
    carrier TEXT NOT NULL,
    wilaya_code INTEGER NOT NULL,
    home_fee REAL,
    desk_fee REAL,
    return_fee REAL,
    updated_at TEXT,
    PRIMARY KEY (project_id, carrier, wilaya_code)
  );

  CREATE TABLE customer_flags (
    phone TEXT PRIMARY KEY,
    blacklisted INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    note TEXT,
    updated_at TEXT
  );

  CREATE TABLE ad_spend (
    project_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    date TEXT NOT NULL,
    campaign_name TEXT,
    spend REAL NOT NULL DEFAULT 0,
    currency TEXT,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    purchases INTEGER NOT NULL DEFAULT 0,
    purchase_value REAL NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (account_id, campaign_id, date)
  );
  CREATE INDEX idx_ad_spend_project ON ad_spend(project_id, date);

  CREATE TABLE ad_campaigns (
    campaign_id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    name TEXT,
    status TEXT,
    effective_status TEXT,
    objective TEXT,
    daily_budget REAL,
    lifetime_budget REAL,
    currency TEXT,
    created_time TEXT,
    issues TEXT,
    link_url TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  );

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
    due_at TEXT,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    entity_type TEXT,
    entity_id INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    done_at TEXT
  );
  CREATE INDEX idx_tasks_status ON tasks(status, due_at);

${CONTACTS_SQL}

  CREATE TABLE campaign_products (
    campaign_id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE creatives (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image','copy')),
    file TEXT,
    url TEXT,
    prompt TEXT,
    content TEXT,
    provider TEXT,
    meta_image_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE ad_drafts (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','failed')),
    meta_ids TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT
  );

  CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    reason TEXT,
    order_id INTEGER,
    user_id INTEGER,
    at TEXT NOT NULL
  );

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    project_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    details TEXT,
    ip TEXT,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_audit_at ON audit_log(at);

  CREATE TABLE ai_conversations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id INTEGER,
    title TEXT,
    messages TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE ai_actions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id INTEGER,
    conversation_id TEXT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','rejected','failed')),
    result TEXT,
    created_at TEXT NOT NULL,
    executed_at TEXT
  );

  CREATE TABLE job_state (
    job TEXT NOT NULL,
    project_id INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    last_ok_at TEXT,
    last_error TEXT,
    fail_count INTEGER NOT NULL DEFAULT 0,
    alerted INTEGER NOT NULL DEFAULT 0,
    cursor TEXT,
    PRIMARY KEY (job, project_id)
  );

  -- صفحات المتجر: صفحات Shopify وصفحات المنتجات (مزامنة) + روابط هبوط تُضاف يدوياً؛ المثبّتة تظهر أولاً وفي اختيارات الإعلانات واختبارات A/B
${STORE_PAGES_SQL}

  -- اختبار صفحات الهبوط A/B: رابط واحد في الإعلان يوزّع الزوار على عدة صفحات حسب الوزن
  CREATE TABLE split_tests (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','ended')),
    mode TEXT NOT NULL DEFAULT 'shopify' CHECK (mode IN ('shopify','redirect')),
    entry_path TEXT,
    sticky INTEGER NOT NULL DEFAULT 1,
    goal TEXT NOT NULL DEFAULT 'delivered' CHECK (goal IN ('orders','confirmed','delivered')),
    fallback_url TEXT,
    winner_variant_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    started_at TEXT,
    ended_at TEXT
  );

  CREATE TABLE split_variants (
    id INTEGER PRIMARY KEY,
    test_id INTEGER NOT NULL REFERENCES split_tests(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    name TEXT,
    url TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (test_id, label)
  );

  CREATE TABLE split_clicks (
    id INTEGER PRIMARY KEY,
    test_id INTEGER NOT NULL REFERENCES split_tests(id) ON DELETE CASCADE,
    variant_id INTEGER NOT NULL REFERENCES split_variants(id) ON DELETE CASCADE,
    visitor TEXT NOT NULL,
    first_visit INTEGER NOT NULL DEFAULT 1,
    is_bot INTEGER NOT NULL DEFAULT 0,
    from_ad INTEGER NOT NULL DEFAULT 0,
    utm_campaign TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX idx_split_clicks ON split_clicks(test_id, variant_id, at);

  -- «المستشار»: حالة كل ملاحظة/توصية (تم التنفيذ، تجاهل، تأجيل) حتى لا تتكرر بلا فائدة
  CREATE TABLE insight_states (
    project_id INTEGER NOT NULL DEFAULT 0,
    key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('done','dismissed','snoozed')),
    until TEXT,
    note TEXT,
    user_id INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, key)
  );

  -- دفتر الملاحظات والدروس والأفكار والقرارات (يستعمله المستشار الذكي كسياق)
  CREATE TABLE journal (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','lesson','idea','decision','experiment')),
    text TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_journal_project ON journal(project_id, created_at);

  -- تقارير المستشار الذكي (أسبوعية أو عند الطلب)
  CREATE TABLE advisor_reports (
    id INTEGER PRIMARY KEY,
    project_key TEXT NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,

  // 1 — ترقية قاعدة أُنشئت بنسخة سابقة (قبل الموردين وصفحات المتجر). لا يغيّر شيئاً في قاعدة جديدة.
  (db) => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contacts'").get()?.sql || '';
    if (sql.includes("'livreur'")) {
      // تغيير قيود الأنواع يتطلب إعادة بناء الجدول (لا جدول يشير إليه في النسخة القديمة)
      db.exec('ALTER TABLE contacts RENAME TO contacts_old');
      db.exec(CONTACTS_SQL);
      db.exec(`INSERT INTO contacts (id, project_id, name, kind, company, phone, email, notes, created_at)
        SELECT id, project_id, name, CASE kind WHEN 'supplier' THEN 'supplier' WHEN 'partner' THEN 'service' ELSE 'other' END, company, phone, email, notes, created_at FROM contacts_old`);
      db.exec('DROP TABLE contacts_old');
    }
    if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'supplier_id')) db.exec('ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_carrier_wilaya ON orders(carrier, wilaya_code, status)');
    db.exec(STORE_PAGES_SQL);
  },

  // 2 — التحصيل: دفعات شركات التوصيل، وكل طلبية مسلّمة أو مرتجعة تُربط بالدفعة التي سوّتها
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS carrier_payouts (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      carrier TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'payout' CHECK (kind IN ('payout','opening')),
      received_on TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      expected REAL NOT NULL DEFAULT 0,
      orders_count INTEGER NOT NULL DEFAULT 0,
      reference TEXT,
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_payouts_project ON carrier_payouts(project_id, received_on)');
    if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'payout_id')) db.exec('ALTER TABLE orders ADD COLUMN payout_id INTEGER REFERENCES carrier_payouts(id) ON DELETE SET NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_payout ON orders(project_id, carrier, payout_id)');
  },

  // 3 — المرتجعات: كل طلبية مرتجعة وما عاد منها إلى المخزون (Shopify والـ ERP) وما تلف أو ضاع
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS order_returns (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','reversed')),
      items TEXT NOT NULL DEFAULT '[]',
      goods_lost REAL NOT NULL DEFAULT 0,
      packaging_lost REAL NOT NULL DEFAULT 0,
      return_fee REAL,
      shopify_state TEXT CHECK (shopify_state IN ('pending','done','failed','skipped')),
      shopify_applied TEXT NOT NULL DEFAULT '{}',
      shopify_error TEXT,
      shopify_attempts INTEGER NOT NULL DEFAULT 0,
      shopify_synced_at TEXT,
      note TEXT,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_returns_project ON order_returns(project_id, shopify_state)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_stock_order ON stock_movements(order_id, product_id)');
  },

  // 4 — صفحات الهبوط المولّدة: منتج + زاوية تسويقية + إطار (AIDA، PAS…) → قالب منتج دون قائمة/تذييل + رابط ‎/pages/<slug>‎
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS landing_pages (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      angle TEXT NOT NULL,
      framework TEXT NOT NULL,
      tone TEXT NOT NULL DEFAULT 'ar',
      audience TEXT,
      copy TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','unpublished')),
      template_suffix TEXT,
      redirect_id TEXT,
      public_path TEXT,
      target_url TEXT,
      model TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      UNIQUE (project_id, slug)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_landing_product ON landing_pages(project_id, product_id)');
  },
  // 6) أسعار التوصيل وسياسات المتجر (من قالب Shopify وصفحاته) + الصور الوصفية لصفحات الهبوط
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS store_delivery (
      project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      rates TEXT NOT NULL DEFAULT '[]',
      policies TEXT NOT NULL DEFAULT '{}',
      carriers TEXT,
      free_from INTEGER,
      delivery_time TEXT,
      source TEXT,
      imported_at TEXT,
      updated_at TEXT
    )`);
    db.exec("ALTER TABLE landing_pages ADD COLUMN visuals TEXT NOT NULL DEFAULT '[]'");
  },
  // زيارة مباشرة لصفحة نسخة (رابطها الخاص، لا رابط الاختبار): تُعدّ للصفحة ولا تدخل حكم A/B
  (db) => {
    db.exec('ALTER TABLE split_clicks ADD COLUMN direct INTEGER NOT NULL DEFAULT 0');
  },
  // عدّاد الزوار المخفي على كل صفحات المتجر: صف لكل (صفحة، زائر، يوم) — الزوار والتحويل لكل صفحة
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS page_visits (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      page TEXT NOT NULL,
      visitor TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 1,
      form INTEGER NOT NULL DEFAULT 0,
      from_ad INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      campaign TEXT,
      ab TEXT,
      page_type TEXT,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL,
      PRIMARY KEY (project_id, day, page, visitor)
    ) WITHOUT ROWID`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_page_visits_page ON page_visits(project_id, page, day)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_page_visits_ab ON page_visits(project_id, ab, day) WHERE ab IS NOT NULL');
  },
  // الحذف لا تلغيه المزامنة: مرجع كل طلبية حُذفت (مزامنة Shopify والجدول لا تعيدانها)
  // + مستخدم «مشاهد» للقراءة فقط (عمود منفصل: تغيير قيد role يتطلب إعادة بناء جدول المستخدمين)
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS deleted_orders (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      ref TEXT NOT NULL,
      external_id TEXT,
      deleted_at TEXT NOT NULL,
      deleted_by INTEGER,
      PRIMARY KEY (project_id, ref)
    ) WITHOUT ROWID`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_deleted_orders_ext ON deleted_orders(project_id, external_id) WHERE external_id IS NOT NULL');
    if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'read_only')) db.exec('ALTER TABLE users ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0');
  },
  // كلفة الواجهات المدفوعة (Claude، صور Gemini/OpenAI): سطر لكل طلب بالاستهلاك الفعلي، يدخل في المالية كمصروف
  // project_id فارغ = طلب على كل المشاريع (المساعد، تقرير عدة مشاريع)
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      day TEXT NOT NULL,
      at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      kind TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      images INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_api_usage_day ON api_usage(day, project_id)');
  },
  // معرّف حدث الطلبية عند Meta (event_id المشترك بين بيكسل المتجر و n8n): تُربط به أحداث ما بعد الطلبية (أُكّدت، سُلّمت)
  // بالطلبية الأصلية فتنسبها Meta إلى الإعلان نفسه
  (db) => {
    if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'meta_event_id')) db.exec('ALTER TABLE orders ADD COLUMN meta_event_id TEXT');
  },
  // تحليل المنتج لصفحات الهبوط (ما في صفحته + زوايا خاصة به): يُحفظ ويُعاد فقط إن تغيّرت صفحة المنتج (source_hash)
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS product_insights (
      product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL,
      data TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL
    )`);
  },
];

export function openDb(file = config.dbFile) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      const m = MIGRATIONS[version];
      if (typeof m === 'function') m(db);
      else db.exec(m);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
    })();
  }
}

export const db = openDb(config.isTest ? ':memory:' : config.dbFile);

/** JSON آمن من أعمدة النص */
export const parseJson = (s, fallback = null) => {
  if (s === null || s === undefined || s === '') return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};
