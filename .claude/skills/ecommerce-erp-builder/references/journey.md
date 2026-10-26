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
| Quality bar | 42 `node:test` tests; UI audit on 24 routes × 3 modes with 0 contrast, 0 unnamed buttons, 0 unlabelled fields, 0 overflow |
| Hosting | Runs locally (Tailscale). VPS package ready and verified in a simulation (Docker + Traefik + n8n); waiting for the owner to add DNS `erp` → VPS IP and run `deploy/install-vps.sh erp.leadsauto.cloud` |
| Data safety | Nightly backup (14 kept), optional cloud-folder mirror (30 kept), `npm run restore` and `deploy/erp.sh restore` |
| Schema | `MIGRATIONS` 0 → 3. Never edit 0; append. Every migration is tested on a DB built by the previous code |
| Branch | `claude/erp-toureche-system-fdir8x`; not merged into `main` yet (only on the owner's request) |

**Open items for the owner:**

1. Add the DNS record and run the VPS install.
2. Rotate the Shopify client secret that was pasted in chat.
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
