# The ERP TOURECHE journey: where we are, how we got here, how to do it again

Read this first when you continue ERP TOURECHE in a new conversation, or when you start a similar ERP for another store. The other references hold the details; this file holds the story and the decisions.

## 1. What the owner wants (the brief that never changes)

- **One system for a COD store in Algeria:** orders from Shopify and Sheets → phone confirmation → carriers (Yalidine, NOEST, ZR) → delivery → money back, with Meta ads judged against it.
- **Truth = delivered orders.** Every product and ad verdict uses cost per delivered order against break-even. Pixel purchases are a signal, never the verdict.
- **Meta by Meta's rules:** campaigns created PAUSED; budgets +20% at most per step, then wait 3–4 days; never guess a budget; never spend without an explicit yes.
- **Safety:** a second, **sensitive** password for deletes, prices, budgets, activations and settings; no secret ever in git.
- **Reachable from the phone, always:** a PWA. It runs first on the owner's computer through Tailscale, then 24/7 on a Hostinger VPS next to n8n.
- **Never lose the ERP:** code on GitHub after every change; data backed up off the machine; a documented restore.
- **Communication:** Arabic, short, confident; a numbered plan, not options; never "it works" without having run it.

## 2. Where we are (October 2026)

| Area | State |
|---|---|
| Modules | Today, Dashboard, Advisor, AI assistant, Orders (confirmation + shipping + returns to stock), Abandoned carts, Customers, Carriers, Products + editor (SEO, AI copy, images), Store pages, Suppliers & partners, Ads (BM explorer, PAUSED launch), A/B pages, Finance, **Collections**, Tasks, Activity, Settings |
| Integrations | Shopify (Dev Dashboard client credentials), Meta Marketing API, Yalidine / NOEST / ZR, n8n (in and out hooks), Anthropic, image providers |
| Quality bar | 45 `node:test` tests; UI audit on 24 routes × 3 modes with 0 contrast, 0 unnamed buttons, 0 unlabelled fields, 0 overflow |
| Hosting | **Live 24/7 at https://erp.leadsauto.cloud** (since 26 Oct 2026): Hostinger VPS KVM 2, container `erp-toureche` next to the n8n stack (Traefik + Postgres + Redis + n8n), DNS `erp` A → `72.61.84.209`, clone in `/opt/erp`, managed with `erp update` / `erp status` / `erp backup`. Admin account created through the setup token |
| Data safety | Nightly backup (14 kept); off-site copy to Google Drive via n8n on the VPS (30 kept) or a cloud-folder mirror on a computer; `npm run restore` and `erp restore` (accepts `.db.gz`) |
| Schema | `MIGRATIONS` 0 → 11 (8 page visits, 9 deleted orders + read-only users, 10 API usage, 11 the store's Meta `event_id` on orders). Never edit 0; append. Every migration is tested on a DB built by the previous code |
| Branch | `claude/erp-toureche-system-fdir8x`; not merged into `main` yet (only on the owner's request) |

**Open items for the owner:**

1. Connect Shopify on the VPS install (myshopify domain + Client ID + a **rotated** Client secret, with `write_inventory`), then carriers and Meta.
2. Point n8n's order webhook at `http://erp-toureche:3600/api/hooks/<slug>/orders`.
3. Start Collections with an opening balance.
4. Process the returns that predate the returns ledger once (Orders → Returned tab): "restock now" or "already restocked".

## 3. Phases: what we did, why, and the lesson of each

| # | Phase (commit) | What was decided | Lesson |
|---|---|---|---|
| 1 | Core build (`840257c`) | Node + Express + SQLite + React, one process, zero ops; projects, two passwords, encrypted settings, order pipeline, carriers, Advisor, A/B, UI | Build the whole loop end to end first; refine later |
| 2 | Meta alignment (`83ae3e0`) | Scaling advice changed from "+20–30%" to Meta's rules (≤20%, wait, significant edits); editable FX; A/B on the same Shopify domain | Never improvise ad rules; cite the source |
| 3 | PWA, demo, docs, this skill (`475aa05`) | Phone app via Tailscale; recorded demo published as an Artifact | A link the owner can open on the phone beats any description |
| 4 | Contacts rebuilt (`48d8caa`) | "Address book" replaced by suppliers ↔ reorder and carrier desks ↔ stuck parcels | A page with no workflow is noise: tie it to a job or delete it |
| 5 | UI audit (`a478993`) | Impeccable method plus our own Playwright audit: contrast 47→0, unnamed buttons 4→0, unlabelled fields 26→0 | Measure; never judge contrast by eye |
| 6 | Survive a lost computer (`88fef14`) | CLAUDE.md rules, push after every change, off-site backups, restore command | Code on GitHub is not data; back up the DB off the machine |
| 7 | One order number (`09d81f0`) | The ERP number = the Shopify number, also on carrier labels and in n8n | Never alter identifiers on a guess (the NOEST padEnd incident) |
| 8 | Store pages (`b92f862`) | Shopify pages + product pages synced, pinning, per-page orders; first appended migration | From the first push, the schema is "installed": append migrations |
| 9 | VPS 24/7 (`046294d`) | Its own container behind the existing Traefik, settings read from the n8n container, subdomain, Let's Encrypt; `erp.sh` for update, backup, restore | Don't touch what already works (n8n); detect, don't ask |
| 10 | Improvement skills (`6bae7fc`) | Vendored review skills (Sentry, Trail of Bits, Vercel, Anthropic, Superpowers, marketing) with licenses, after scanning them | Read a third-party skill before trusting it |
| 11 | Security review (`2862dee`) | Setup token, client IP behind Traefik, upload path checks, safer sanitizer, HSTS, dependency upgrades | Review before going public, not after |
| 12 | Collections (`605946a`) | Carrier payouts reconciled by pasting the statement's tracking numbers; opening balance; Advisor alert after 14 days | The biggest COD leak is money that was delivered but never paid back |
| 13 | Returns back to stock | A returned parcel goes back to Shopify's available stock (idempotent) and to the ERP copy; damaged or missing units are written off at cost; the real return cost flows into Finance, break-even and per-product ad results | Stock goes back where it was deducted, and never twice
| 14 | Manual full sync | On the owner's request, background pulls (Shopify, Sheets, tracking, Meta, tariffs) run only when `auto_sync` is on (off by default). The top-bar button runs one ordered full sync on the server with live per-step progress. Backups and pending returns to Shopify stay automatic | Let the owner decide when data moves; keep only data-protecting jobs automatic
| 15 | Off-site backup on the VPS | Each night the ERP gzips its backup and POSTs it to a private n8n webhook; n8n uploads it to Google Drive (`TOURECHE-ERP-backups`, last 30 kept) and confirms. Only a confirmed upload counts; failures show in Settings → System and the Advisor. `restore` accepts the `.gz` as is | On a server, "a folder synced to the cloud" does not exist: reuse what is already there (n8n + its Google account) instead of installing rclone
| 16 | Update from inside the ERP | Settings → System shows the running version (baked into the image at build), the last update and its result, and the new commits on GitHub. «تحديث الآن» writes a request file; a systemd path unit on the host runs `erp.sh agent`: backup → `git pull` → build → up → health check, with an automatic rollback to the previous image. Results come back as read-only state files | A container must never control Docker: give it a one-way request folder and keep every privileged step on the host
| 17 | Pages that credit orders + AI landing pages | Root cause of "the pages logic doesn't work": the COD form posted `source_url` and UTMs to n8n, but n8n dropped them before `orderCreate`, so no order carried its page. Fixed in n8n (landing_page, utm_*, erp_v as order attributes) and the ERP shows an attribution-health notice. A/B verdict follows Tassyir's rules (7/14 days, 30 orders and 1000 visitors per version, 95%, chi-square split check). Landing pages: product + angle + framework (AIDA/PAS/BAB/FAB/4P/honest FOMO) → Claude copy under strict truth/Meta rules → product alternate template with a no-header layout reusing the theme's own COD form, reached through a `/pages/<product>-<angle>` redirect | Check the data path end to end (form → n8n → Shopify → ERP) before tuning statistics; reuse the theme's form instead of copying it
| 18 | Delivery facts + descriptive visuals | The landing writer kept asking the owner for delivery time, price, inspection and returns although the store already published them. The ERP now reads the theme setting `shipping_table` (the same source as the COD form) or the public `/pages/delivery` table, and `/policies/*` texts; the owner only confirms the delivery time (the ERP suggests the measured median/p80). Landing pages get 4–6 descriptive visuals drawn from the real product photos (Gemini `gemini-nano-banana-2.1`, 4:5, no text inside the image) with live Arabic text on top, reviewed by the owner, uploaded once to Shopify Files | Take facts from where the customer sees them; never let an image model write Arabic or redesign the product |
| 19 | Tracking that counts, ERP as master (`c3c92e4`…`23d6680`) | A store-wide hidden beacon (one row per page, visitor and day) gives visitors and conversion per page; the A/B version comes only from the form's page link, never from a stale UTM. Deleting a landing page in the ERP deletes it in Shopify; publishing a product makes Shopify follow the ERP (images, variants, live stock, Online Store channel) | If the owner says "the number is wrong", trace one real order end to end before touching the formula |
| 20 | Customers, permissions, money (`53a9abe`…`e8cd6bf`) | Customer risk = expected delivery from the store's own joint table (no-answer calls × failed deliveries) plus the customer's history, with reasons and advice for the confirmer. Bulk delete with two warnings and the sensitive password, deleted orders remembered so no sync brings them back; roles enforced on the server, plus a read-only viewer. `sheet_not_allowed` was a trailing space. Dashboard sources by page and channel; every paid API call recorded at official prices as an expense. Speed checked with Shopify's real-user data (good); the real issue was 404s on old product links, now fixable in one click | Read the failing request itself (n8n execution input, Shopify sessions) before blaming the allowlist or the theme; one invisible space can stop a sync for days |
| 21 | Meta signals and the main ad link (`7a0a79e`, `12abbf3`) | The Google Sheet was reduced to its two working tabs (`customer` for machines, `Orders` for people) after checking no workflow used the others. The main ad must point at the canonical product page: the ERP now checks every ad link before launch and moves tracking to `url_tags`. A withdrawn landing page no longer stays in a running A/B test. After the order, the ERP tells Meta which orders were confirmed and delivered, linked to the store's Purchase. A readable Meta check (token, permissions, assets, CAPI test) plus a step-by-step guide for a new app with a system user | Measure Meta's own view (dataset stats, EMQ, event sources) before building; send downstream events linked to the original one instead of a second Purchase |

## 4. The mistakes that cost the most, and the rule that prevents each

All of them are in `pitfalls.md` with the exact fix. The rules:

1. **Verdicts from zero data are lies.** A product with 0 spend is `no_ads`, not "winning".
2. **One failing rule must not hide the others.** Wrap each Advisor group and expose `errors[]`.
3. **Identifiers are sacred.** Send order numbers and tracking numbers exactly as they are.
4. **The schema is frozen once pushed.** Append migrations and test them on a DB built by the previous commit.
5. **Anything public gets a security pass first.** On a public URL, the first-run setup page, proxy IPs and file paths all become attack surface.
6. **Fresh packages are a risk.** Never install a release younger than two weeks; pin exact versions; `npm audit --omit=dev`.
7. **Measure the UI.** The audit script finds what eyes miss (contrast in dark mode, unlabelled fields, RTL overflow).
8. **Don't trust "unknown" as zero.** A missing delivery fee or FX rate is shown as missing, never silently 0.
9. **Verify in the real topology.** Behind Traefik, test with two different IPs (client vs proxy), not only with headers.

## 5. How to do it again for another store (reuse guide)

1. **Discover** with the connectors (Shopify, Meta, n8n) and read this repo; ask only the ≤8 questions in SKILL.md.
2. **Copy, don't rewrite:** start from `ERP TOURECHE/` and rename the project, domain and colors. Keep the migrations as they are (a new install runs them all).
3. **Configure, don't code:** stores become projects, carriers and keys go in Settings, FX rates go in Finance.
4. **First-week checklist with the owner:**
   - connect Shopify (Dev Dashboard app with the scopes in `integrations.md`) and sync products and orders;
   - connect at least one carrier and refresh tariffs, so fees are known;
   - set the sensitive password;
   - add the n8n hook for Sheets or landing orders;
   - set the off-site backup;
   - record the Collections opening balance.
5. **Hosting:** on the owner's computer with Tailscale for a trial; on a VPS with Docker for 24/7 (`deploy/install-vps.sh <subdomain>`, then the setup token).
6. **Verify and deliver** with the checklist in `pitfalls.md`; publish the demo link; push.
7. **Niche specifics:** add them to `growth.md → Niche notes` (example: مكتبة ألواني).

## 6. Keeping this record alive

After each finished phase, add one row to section 3 and update section 2. Add a pitfall row whenever something broke. Keep each row to one line, and say *why*, not just *what*.
