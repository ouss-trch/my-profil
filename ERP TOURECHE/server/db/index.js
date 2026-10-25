import Database from 'better-sqlite3';
import { config } from '../config.js';

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

  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('supplier','livreur','carrier','partner','customer','other')),
    company TEXT,
    phone TEXT,
    email TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

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

  -- اختبار صفحات الهبوط A/B: رابط واحد في الإعلان يوزّع الزوار على عدة صفحات حسب الوزن
  CREATE TABLE split_tests (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','ended')),
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
      db.exec(MIGRATIONS[version]);
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
