# Architecture: what to build and in which order

Reference implementation: `ERP TOURECHE/`. Copy its modules, then adapt them.

## Stack (chosen so it runs on the owner's computer with zero ops)

| Layer | Choice | Why |
|---|---|---|
| Server | Node 22 ESM, Express 5, one process | Serves the API and the built SPA; nothing else to install |
| DB | SQLite via `better-sqlite3` (WAL) | One file, synchronous, fast; easy to back up |
| Auth | `bcryptjs`, httpOnly sessions in the DB | No external identity provider |
| Security | `helmet` with a strict CSP (`script-src 'self'`), `express-rate-limit`, Origin check | |
| AI | `@anthropic-ai/sdk` with a default model from the claude-api skill | Keys are stored encrypted in settings |
| Client | React 19, Vite, Tailwind 3, react-router 7, recharts, lucide-react | Lazy routes and manual chunks |
| Font | IBM Plex Sans Arabic (bundled with `@fontsource`) | Works offline and on Tailscale |
| Access | `tailscale serve --bg 3600` gives HTTPS on the tailnet; the client is a PWA | Opens as a phone app; no port forwarding |

Scripts:

- `npm run setup` installs and builds.
- `npm start` runs the server.
- `npm test` runs `node --test "tests/*.test.js"`. Use the glob: `node --test tests/` fails on a directory.
- Double-click starters: `start.command`, `start.bat`, `start.sh`.
- `npm run reset-password` resets a password from the command line.

## Layout

```
server/
  app.js            # middleware order: helmet → origin check → json → routes → SPA fallback
  config.js         # env: ERP_PORT, ERP_DATA_DIR, ERP_TRUST_PROXY, ERP_ALLOWED_ORIGINS, ERP_SENSITIVE_WINDOW_MIN
  db/index.js       # MIGRATIONS array, schema_version
  lib/              # auth, crypto (AES-256-GCM), settings registry, statuses, wilayas, http (retry), audit, util
  integrations/     # shopify, meta, carriers/{yalidine,noest,zr}, n8n, ai, images
  services/         # orders, shipments, analytics, ads, advisor, splits, products, seo, sync, scheduler, assistant
  routes/           # auth, core (meta, hooks), orders, products, ads, insights (advisor + splits), misc
client/src/
  lib/              # api.js (project header, sensitive retry), format.js (bidi-safe numbers), hooks.js, demo.js
  i18n/             # dict.js {key: {ar, fr}}, t(), err()
  components/       # Layout, ui, charts, status, Sensitive, LaunchCampaign, FxEditor, ProjectContext
  pages/            # Today, Dashboard, Advisor, Assistant, Orders, Leads, Customers, Carriers, Products,
                    # ProductEditor, Ads, Splits, Finance, Tasks, Contacts, Activity, Settings, Login
tests/              # node:test files
```

## Data model (the tables that matter)

The schema has these tables:

- users, sessions, login_attempts
- projects, settings
- products, stock_movements
- orders, order_events, customer_flags
- carrier_tariffs
- ad_spend, ad_campaigns, campaign_products, creatives, ad_drafts
- expenses, tasks, contacts
- audit_log, ai_conversations, ai_actions, job_state
- split_tests, split_variants, split_clicks
- insight_states, journal, advisor_reports

Rules that prevent the classic bugs:

- **Every business row has a `project_id`.** The client sends `X-Project: <id|all>`; "all" aggregates across projects.
- **Orders:**
  - Store the source plus its external id, with a unique index, so re-syncs and n8n retries never duplicate an order.
  - Keep `utm_source`, `utm_campaign`, `utm_content` and `landing_url` on the order. Ads and A/B attribution depend on them.
  - Store money as integer DA.
- **Phones:** normalize Algerian mobiles to `0[567]XXXXXXXX`, mapping `+213` and `00213` to `0`. Reject anything else. The normalized phone is the customer key, used for duplicate and fake detection and for return history.
- **Wilayas:** keep a local table of 69 wilayas (the 2026 division), each with a `shipAs` parent. Carriers still work with 58, so wilayas 59–69 ship under their parent wilaya. Store the code and the names (ar/fr/ascii), and map them to each carrier's own IDs.
- **Status machine** (`lib/statuses.js`):
  - Confirmation group: `abandoned, new, no_answer, callback, confirmed`.
  - Closed group: `cancelled, fake`.
  - Shipping group: `shipped, in_transit, at_office, out_for_delivery, attempt_failed, returning`.
  - Final group: `delivered, returned`.
  - `MANUAL` lists the transitions a person may make. Carrier updates may override it, but `SHIPPING_RANK` keeps them from moving an order backwards.
- **Migrations:** edit `MIGRATIONS[0]` only until the first real install. Code pushed to GitHub counts as installed. After that, append new migrations (JS functions are allowed, for conditional changes); never edit old ones.

## Settings registry

All settings live in one typed registry (`lib/settings.js`): key, scope (global/project), type (string, number, bool, url, json, secret), default and validation.

- Secrets are encrypted with AES-256-GCM. The key is in `data/.secret-key` or `ERP_SECRET_KEY`. Saved secrets are never sent back to the client; the client only sees "set / not set".
- Project settings override global ones.
- Examples: `store_domain`, `meta_business_id`, `ads_launch_defaults` (json), `split_base_url`, `fx_usd_dza`, `fx_eur_dza`, `carrier_weights`.
- Webhook URLs and n8n keys are settings, never constants in code.

## Security model

- **Two passwords:** a login password and a separate **sensitive password**.
  - Sensitive routes respond `428 sensitive_password_required`. The client opens a modal and retries with the header `X-Confirm-Password`.
  - A wrong password returns 403 and counts toward the lockout.
  - An optional grace window comes from `ERP_SENSITIVE_WINDOW_MIN` (default 0).
- **Sessions:** httpOnly, `SameSite=Strict`, and `Secure` behind HTTPS (`ERP_TRUST_PROXY=1` with Tailscale).
- **CSRF:**
  - The Origin host must equal the Host header, or appear in `ERP_ALLOWED_ORIGINS`.
  - Inbound hooks are exempt. They authenticate with `x-erp-key`, compared with `safeEqual`.
- **CSP:** no inline scripts. Pre-paint code such as the theme script lives in `public/theme-init.js`.
- **Logging and backups:**
  - An audit log records every write.
  - A nightly SQLite backup goes to `data/backups` and keeps 14 days.
  - With `ERP_BACKUP_MIRROR` set, the backup is also copied (copy, then rename) to a Google Drive, OneDrive or iCloud folder, keeping 30.
  - `npm run restore -- <file>` checks integrity, saves the current DB first, then restores.
  - The Advisor warns while backups exist only on the computer. Code on GitHub plus data in the cloud folder means a lost computer is not a lost ERP.

## Scheduler (`services/scheduler.js`)

- Shopify order sync: every few minutes.
- Carrier tracking poll: batched, within each carrier's quota.
- Meta spend and campaign snapshot: hourly or daily.
- Morning report: through an n8n webhook.
- Weekly AI Advisor report: Saturdays.

Every job:

- records its last run in `job_state`;
- catches its own errors, so one failing integration never stops the others;
- never runs in tests (detect `NODE_TEST_CONTEXT`).

## UI conventions

- **Language and direction:**
  - Arabic is the default and uses RTL; French uses LTR.
  - Use Tailwind `rtl:` and `ltr:` variants.
  - On mobile, use `max-lg:` variants so `lg:` rules never fight `rtl:` rules on specificity (the sidebar bug).
- **Theme:**
  - Colors are CSS variables with a `.dark` class on `<html>`.
  - Validated chart palette:
    - light: `#2a78d6 #eb6834 #1baf7a #eda100`
    - dark: `#3987e5 #d95926 #199e70 #c98500`
- **Numbers:** `format.js` `da()` wraps amounts as `⁦N DA⁩`. Use the same helper server-side for Advisor text.
- **Page layout:**
  - Every page has a header with a title and actions, a loading state, an empty state with the next step, and an error message that says how to fix it.
  - A command palette, a "new task" button, and a project switcher sit in the top bar.
- **PWA:**
  - Ship a manifest, 192, 512 and maskable icons, and an apple-touch-icon.
  - `sw.js` must never cache `/api`.
  - Register the service worker only in production builds, and not in the demo.
- **Demo mode** (`VITE_DEMO=1`):
  - Build settings: `base './'`, HashRouter, a banner.
  - GET requests are answered from `demo-data.json`, recorded by browsing a seeded real server with Playwright.
  - Writes throw `demo_mode`.

## Build order (each step usable on its own)

1. **Core:** DB, auth with two passwords, projects, settings, crypto, audit, backups.
2. **Orders:** create, import, dedupe, the confirmation workflow with call attempts and reasons, and the Today view.
3. **Carriers:**
   - adapters with one interface: `isConfigured`, `wilayas`, `communes`, `desks`, `create`, `label`, `track`, `fees`;
   - bulk shipping;
   - tracking sync;
   - carrier scoring.
4. **Shopify:** product and order sync, inventory, publishing, SEO.
5. **Meta:**
   - read first: Business Managers, ad accounts, campaigns, insights and learning status;
   - then launch campaigns as PAUSED;
   - budgets and edits behind the guards.
6. **Finance:** delivered revenue − costs − ad spend at the editable FX rate, plus expenses.
7. **Advisor** with rules, then the AI report, then the journal.
8. **A/B landing pages** on the same domain.
9. **n8n:** inbound order hook, outbound events, Sheets bridge, morning report.
10. **Assistant:** a chat that uses tools over real data. Every write needs the user's approval and the sensitive password.
11. **Delivery:** README in AR/FR, `.env.example`, start scripts, demo build.
