# Problems met and their fixes, plus verification and delivery

## Problems → causes → fixes

| Problem | Cause | Fix |
|---|---|---|
| `node --test tests/` fails | node:test doesn't accept a directory there | `node --test "tests/*.test.js"`. Detect tests with `NODE_TEST_CONTEXT` so scheduler and network code stay off |
| Theme flash, or a blank page in production | Inline `<script>` blocked by the strict CSP | Move the pre-paint script to `public/theme-init.js`; never inline |
| Amounts render reversed in Arabic ("DA 500 14") | Bidi algorithm on mixed RTL and number runs | Wrap in `⁦…⁩` (LRI…PDI) and use U+202F as the thousands separator, on client **and** server text |
| Sidebar hidden in RTL on mobile | `rtl:translate-x-full` outranked `lg:` reset (specificity) | Use `max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full` |
| Product with zero spend shown as "winning, scale it" | Verdict computed from CPD = 0 | Verdict `no_ads` when there are no campaigns and spend is 0; only suggest scaling with running campaigns; regression test |
| Scaling advice "increase 20–30%" | Not aligned with Meta (big jumps can reset learning) | ≤ +20% per step, wait 3–4 days, acknowledgment above 20%, cite Meta's help article |
| Advisor rules silently missing | One rule threw an exception, and the whole group vanished | try/catch per group, `errors[]` in the output, a test asserting it is empty |
| Store pages / A/B show 0 orders | COD orders created via API (n8n `orderCreate`) have no customer journey; the form's `source_url` and UTMs were dropped in n8n | Pass `landing_page`, `utm_campaign`, `utm_content`, `utm_medium`, `erp_v` as order custom attributes; the ERP also reads them from the landing URL; show an attribution-health notice |
| Manual snippet paste left `%}` on every page | Owner pasted `{% render 'erp-split' %} %}` | Detect `render 'erp-split' %}` followed by `%}` and repair it on install; never trust a manual paste without checking the live HTML |
| Landing page URL `/pages/product/angle` | Shopify handles cannot contain `/`; a real page cannot host the product form (theme blocks read the global `product`) | Product alternate template (`?view=lp-…`, `layout: erp-landing`) + URL redirect `/pages/<product>-<angle>` (redirects keep the query string) |
| `themeFilesUpsert` / `themes` refused (`access_denied`) | Usually `read_themes`/`write_themes` added in the Dev Dashboard but not yet approved on the store (a scope only counts after approval). Shopify's extra exemption applies to public-distribution apps only | On `access_denied`, query `currentAppInstallation.accessScopes` and name the missing scope (write implies read); if both are granted, it is Shopify's refusal → manual-install modal with the snippet and the render line, both copyable |
| Scope still "missing" after adding it in the Dev Dashboard (version Active) | Releasing a version only declares scopes; the store must approve them | Open the app from Shopify → Applications and approve the new permissions; the ERP names the missing scope and retries with a fresh token |
| AI image with wrong Arabic letters or a changed product | Image models still misspell Arabic and drift from the reference | Generate without any text (live HTML text on top), product photos first in the request, a strict "same product" instruction, and owner review before publish |
| Gemini image 429 "quota exceeded … free_tier … limit: 0" even with a new key on a billed account | Limits belong to the key's project, image models have no free tier, and paid tier needs billing linked **plus** Prepay credit (≥ $5; the Google Cloud $300 trial does not count) | Check aistudio.google.com/projects (Billing Tier column) for the key's own project; map the 429 to a plain message; retry only per-minute limits (retryDelay), never limit 0 |
| Landing says "58 wilayas" while some have no delivery | Copy from habit, not data | Count served wilayas from the shipping table (codes 1–58) and render "from X DA" in Liquid from the live table |
| Prettier without the repo config rewrote whole files | Default printWidth 80 and double quotes | Never run a formatter the repo does not configure; if it happens, restore from git and re-apply only the intended edits |
| Beacon hits not counted | (a) the server wasn't restarted after the change; (b) headless Chrome's user agent counts as a bot (correct); (c) a CORP same-origin block | Restart the server; test with a mobile user agent; send `Cross-Origin-Resource-Policy: cross-origin` and `ACAO *` on the hit route |
| A/B "public link" empty | `store_domain` setting empty | Fall back to `project.domain` |
| `pkill -f pattern` kills your own shell (exit 144) | The pattern matches the bash command line itself | Find the PID with `ps -eo pid,comm,args \| awk '$2=="node" && /pattern/ {print $1}' \| xargs -r kill` |
| Port already in use after restarts | A stale server process | Kill it by PID as above, then start again |
| Screenshot script races the login | The page wasn't ready yet | Wait for `'input[autocomplete="username"], main'` before deciding |
| Meta budgets 100× off | Meta uses the currency's minor units | Multiply or divide by 100, and test it |
| Duplicate orders from n8n retries | No idempotency | Unique index on source plus external id; upsert |
| `git push` returns 403 | No GitHub access for this session or repo | Commit locally. Send the user to https://claude.ai/connect-github and the Claude GitHub App install, then push |
| Vercel or sandbox hosting for the demo not workable | Large uploads through tool calls; no team or project | Publish the demo build as an Artifact instead |
| Every form field read as unlabelled | `Field` generated an id but never passed it to the child control | `Field` clones its single child with `id`; wrappers such as `SettingInput` forward `id`; search inputs get `aria-label` from the placeholder |
| White text on brand or danger buttons fails contrast (2.5:1 in dark mode) | One `--brand` token used for both accents and button fills | Separate tokens: `--brand-fill` + `--on-brand`, and `--on-bad` (dark text on bright fills in dark mode). Check every pair with the WCAG formula, never by eye |
| Grey or status text below 4.5:1 in light mode | Slate-400-ish muted, and status colours on 15% tints | Light muted `94 108 132`; status colours one step darker (warn `161 72 8`, info `29 78 216`, good `21 115 55`, bad `185 28 28`) |
| Phone top bar wider than the screen after a "fix" | `shrink-0` on icon buttons with a fixed-width select beside them | Let the project select shrink (`min-w-0 shrink`), use smaller gaps on mobile, then re-run the overflow check |
| A test hangs forever, with no output | Node's recursive `mkdirSync` loops on some paths (e.g. under `/proc`) | Don't create cloud paths recursively: if the parent folder doesn't exist, report `mirror_unreachable`. This also avoids a fake local "backup" while Google Drive isn't installed |
| A later test run hangs or behaves oddly | A stuck background `node --test` process from an earlier run still holds the DB | List with `ps` and kill by PID before rerunning |
| A third-party skill's engine blocked from running | Session policy blocks executing downloaded binaries | Vendor only the skill files (with LICENSE) and apply its checklists with your own Playwright audit (`scripts/ui-audit.cjs`) |
| Users who already installed get "no such table/column" | `MIGRATIONS[0]` was edited after the code was on GitHub | From the first push on, add a new migration. Use a JS migration for conditional changes: rebuild a table to change a CHECK, `ADD COLUMN` only if missing, `CREATE ... IF NOT EXISTS`. Test it on a DB built from the old schema (`git show <first-push>:server/db/index.js`) |
| NOEST reference changed (1037 → 10370) | `padEnd(5,'0')` added without any documented requirement | Send the number exactly as it is; never alter identifiers on a guess |
| A synced row was deleted, or manual rows were flagged "gone" | Sync stale-detection with an empty `NOT IN (NULL)` list, and manual rows not told apart from synced ones | Mark synced rows (`synced_at`) and only those can go stale; handle the empty list |
| React shows a stray "0" | `{count && <X/>}` with a numeric 0 | Use `Boolean(x) &&` or a ternary |
| "Contacts" page nobody uses | A generic address book with no link to any workflow | Tie each kind to a job: suppliers ↔ products and reorder; carrier desks ↔ stuck parcels in the order drawer. Otherwise remove the page |
| Anyone could create the admin on a fresh public install | `/api/auth/setup` was open while no user existed (a new subdomain shows up in certificate logs within minutes) | A setup token in `data/.setup-token` (0600), printed by the installer; localhost is exempt; deleted after setup; re-check the user count right before the insert |
| One wrong-password streak locked out every user on the VPS | `trust proxy 'loopback'` behind Traefik in Docker made `req.ip` Traefik's private IP for everyone | `ERP_TRUST_PROXY="loopback, uniquelocal"` in the image; test with two different IPs (client 172.18.0.1 vs Traefik 172.18.0.2) |
| `/uploads/../.secret-key` readable through a product image URL | Image URLs stored in the DB were joined to the uploads path without a containment check | One `uploadPath()` helper: `path.resolve` plus a check against `uploadsDir + sep`; remote fetches https only |
| `npm audit` shows high advisories, and the fix is a 4-day-old release | A brand-new release is a supply-chain risk of its own | Pick the newest patched version at least two weeks old; pin transitive ones with `overrides`; note which advisory remains and why it doesn't apply |
| A pasted carrier statement reports words ("RELEVE", "VERSEMENT") as unknown parcels | The token regex accepted any long word | Tracking tokens must contain a digit |
| Expected payout higher than reality | Orders with no `shipping_cost` and no tariff counted a fee of 0 | Return `fee_known`; show "fees unknown for N orders" and fix the tariffs |
| Arabic hint containing a shell command renders scrambled | Bidi reordering of Latin and punctuation runs inside RTL text | Put the command in `<code dir="ltr">`, or wrap it in `⁦…⁩` in strings |
| The Docker build fails in the sandbox (apt mirror, node-gyp download) | The network policy blocks them; on the VPS they work | Test a runtime-only image built from prebuilt `node_modules` and `client/dist`; keep the real Dockerfile unchanged |
| `install-vps.sh` exits silently | `set -o pipefail` plus a probe that finds nothing: `ip route` or `getent`, or `grep` for a second router on Hostinger's n8n template (one router on `web,websecure`) | Add `\|\| true` to every probe pipeline. Test on the real topology (one router, no `traefik.docker.network` label), not only on a tidy one |
| Restore fails: "attempt to write a readonly database" | Opening a WAL-mode backup from a `:ro` mount | Copy it next to the target first, check it (integrity, schema_version), then rename it into place; always restart the ERP |
| Shopify test fails with `shopify_auth_failed` although Client ID + secret are right | An old `shpat_` token left in the form took precedence, so the Dev Dashboard app was never tried | Client credentials first, legacy token only as fallback; a "Clear" button on secret fields; refused exchanges say why (`shopify_client_invalid`, `shop_not_permitted`) |
| Stock in Shopify drifts lower after every returned parcel; cost of sales looks wrong | Returns were counted only as a return fee; goods never went back to stock | Returns ledger: restock on `returned` (the carrier's "back with the seller"), per-line damaged/missing, and reconciliation toward a target with an idempotency key |
| Restocking would double-count | Returns that existed before the ledger may already have been restocked by hand | Never backfill automatically: list them once and let the owner pick "restock now" or "already restocked" (the latter records the movement without changing stock) |
| A return restocked a product that was never deducted | A non-Shopify order (Sheets) never reduced Shopify stock | Restock only where the sale was deducted; mark the other lines `not_deducted` and still count the return cost |
| First order sync fails with `Invalid timestamp for query filter created_at` | Shopify's search rejects relative dates such as `created_at:>-60d` | Send an absolute ISO date; tested against the live store |
| Store pages still say "missing permission" after a new app version adds `read_online_store_pages` | Releasing a version is not enough: each store must approve the new scope (Shopify asks when the app is opened from the store admin); the cached token also carries the old scopes | Tell the owner to open the app from Shopify admin → Apps and approve. On `ACCESS_DENIED` drop the cached token and retry once. The secondary info pages never block product pages: without the scope they are skipped and kept, not deleted |
| AI test shows a raw `404 not_found_error … model: claude-sonnet 5.5` | The model was a free-text field and the owner typed the marketing name with a space | Make the model a dropdown of exact API ids. Read old saved values through a normalizer (`Claude Sonnet 5.5` → `claude-sonnet-5-5`) or fall back to the default. Map the SDK's `NotFoundError` to a readable "model not found" message |
| A test order from a landing page reached n8n, the sheet and Telegram, but not Shopify, the Shopify phone app or the ERP | The app's client secret was changed and only the ERP got the new one. n8n's token call returned `invalid_request: Missing or invalid client secret`, then every Admin call returned 401 | One app secret lives in two places (ERP settings and the n8n credential). After a rotation update both, then place a test order. The COD workflow must never lose the order: sheet row `NOT CREATED` and a Telegram warning |
| Writing a new column to a Google Sheet fails with `Range (customer!W1) exceeds grid limits` | The tab has exactly as many columns as its header | Send `appendDimension` (COLUMNS) in a `batchUpdate` before writing the cell. n8n's autoMap append then fills the new header by name |
| The owner wants a readable orders sheet, but the ERP and the morning report parse the English `customer` tab | Renaming or translating its headers would break both readers | Add a separate RTL `Orders` tab with Arabic headers, written by its own append node (autoMap by header name, RAW, continue on error). Keep `customer` as the machine tab |
| A collection has products but never shows on the site | Shopify does not add a new collection to the store's main menu; the theme's top bar only lists menu items | Read `menus` (handle `main-menu`), compare its `resourceId`s with the collections, warn in the product editor and offer "show in menu". `menuUpdate` replaces the whole list: send every existing item back with its `id` (collections by `resourceId`, other items by `url`) and append the new one |
| The owner "cannot delete" a product, or a deleted product comes back | No delete button; and a Shopify product deleted only in the ERP is re-created by the next product sync | ERP-only product: delete (sensitive password). Shopify product: archive (`productUpdate status: ARCHIVED` + stage `archived`); the sync keeps it archived |
| A wrong click on "confirmed" cannot be undone | The manual transition table only allowed confirmed → new/shipped/cancelled, and the correction buttons sat at the bottom of the drawer | Allow confirmed/cancelled/fake → no_answer and callback (Shopify `erp-<status>` tags are swapped, so it is reversible). Put "correct the status" at the top of the order for non-pending orders |
| The owner does not understand the A/B "50" field and has to paste landing-page URLs | Raw weight input and free-text URLs | Explain it as "share of visitors out of 100". Variant URL = a dropdown: original product page, published ERP landing pages by angle (final `?view=lp-…` URL), other store pages, or a custom link |
| An n8n Code node returns an empty value with no error (e.g. the landing page column stays blank) | `URL` is not defined in the n8n Code sandbox, and the `try/catch` around `new URL()` swallowed the ReferenceError | Parse URLs with a regex in n8n Code nodes. Test node code with `URL` set to `undefined`, and check the first live execution's output, not just its status |
| The live product page shows a landing page to shoppers coming from the collections | The A/B snippet split every visitor of the product URL (the test entry path), with a 30-day sticky cookie | Split only the ad link (`?erp_t=<slug>`); the plain product URL is never rerouted. Bump the shop-metafield config version so an old installed snippet finds no `p` and does nothing. To stop it on a live store at once: write `{"v":1,"tests":[]}` to the shop metafield |
| An order from one landing page is attributed to another one, and its visitors stay at 0 | Opening the landing link (`?view=lp-…`) hit the same entry path, so the snippet reassigned the visitor (sticky cookie) to another variant; visits were only counted when a public ERP URL was set by hand | Never reroute a URL that already names its page (`view`); count it as a direct visit apart from the verdict. Default the beacon base to the ERP's public URL on the VPS |
| Every landing page looks the same, whatever the angle, with the same generated images | One fixed section order and one shot list for all angles; the image model got several product photos and drifted | One layout per angle (`LAYOUTS`: order of blocks, accent color, angle-only blocks such as occasions, without/with comparison, moments of the day, specs) chosen by the angle or framework, stored in the copy and applied again on republish. Images from the main photo only plus the product page description, with the layout's shot brief. Arabic text inside generated images is a per-shot trial switch; the live text is hidden only when the image carries it |
| Visitors stay at 0 after an ERP update although the new code counts them | The theme still had the old snippet; it read a field the new config no longer has, threw, and the `try/catch` hid it. The new snippet was only written when the owner clicked «install» | Version the config and the snippet together. On startup and every few hours, compare the installed snippet with the current one and rewrite it when the theme already renders it. Show «last visit received N minutes ago», not just «installed» |
| Orders from the gift landing page counted for another page | The COD form keeps the last UTM set in localStorage (`rw_utm`), so `utm_content` from an earlier A/B visit stuck to later orders | Attribute pages and A/B versions from the page the form was submitted from (`landing_page` = `location.href`), the A/B version only from `erp_v` in that URL. Never overwrite the ad's own `utm_content` |
| Per-page conversion rate needs visitors per page | Shopify does not give page-level visitors to the ERP | One hidden beacon per page view from the theme snippet (`sendBeacon`, text/plain, no preflight), a row per (page, visitor, Algeria day), form-start event on first focus. Its own rate limit: Algerian mobile users share CGNAT IPs. Skip bots (but «Cubot» is a phone), the theme editor, prerendered pages, and the owner's devices (`?erp_me=1`) |
| The owner wants to update the ERP from the phone without SSH | The container cannot rebuild itself, and mounting `docker.sock` would give it root on the host | Two bind mounts: `inbox` (container writes a request), `state` (host writes results, mounted read-only). A systemd `.path` unit runs the update script; the script `exec`s the freshly pulled copy for the build steps, tags the old image `:previous`, and rolls back if the new container is not healthy. Bake the commit into the image with build args so the UI shows the running version |
| The Google Sheet test fails with `sheet_not_allowed` right after the owner re-pasted the sheet ID | The ID was saved with a trailing space; the n8n bridge takes the ID up to the first `/` or `?`, so `…H_wQ ` is not in its allowlist (seen in the bridge executions every 5 min) | Trim every text setting on save and on read (fixes values already saved), strip invisible bidi/zero-width marks, accept the full Google Sheets link and extract the ID. Read the n8n execution input before suspecting the allowlist |
| Deleted orders come back after a sync | The Sheet sync reads every row each run and imports any ref the ERP does not have; Shopify re-sends orders updated later | Keep a `deleted_orders` tombstone (project, ref, external id) and skip it in every non-manual import path (Shopify, Sheet, n8n) |
| A confirmer could edit products, spend on AI or touch ads | Roles were described in the UI but only some routes checked them | Enforce roles on the server for every write route; add a read-only viewer (a separate column, so the first migration's role CHECK stays untouched); keep bulk delete admin-only with the sensitive password every time |
| Old product links still bring visitors (shares, posts, search) but open a 404 | The handle was changed outside the ERP without a redirect, and an older redirect points to an intermediate handle that no longer exists (Shopify does not repoint chains) | Count 404 pages from the theme beacon (`request.page_type` is `404`, so the type validator must accept digits) and flag redirects whose target product is gone; one root 301 covers every language folder (Shopify Help Center). The ERP's own handle changes already send `redirectNewHandle: true` |
| An A/B test kept sending two thirds of the ad visitors to «landing pages» that had been withdrawn; they silently showed the plain product page, so the test compared the page with itself | Withdrawing (unpublishing) a landing page removed its `product.lp-…` template but, unlike delete, did not detach its A/B version; a theme switch has the same effect | Detach the version on unpublish too, and build the live config defensively: skip any version whose landing is not published in the ERP or whose `lp-` template is missing from the published theme (one `templates/product.lp-*` lookup per sync), and list the skipped versions to the owner |
| A paid ad sends clicks to a 404, an old handle that redirects, a sold-out product or a page without the campaign pixel | Nothing checked the destination before launch; UTMs were glued into the link | Fetch the link like a mobile visitor (manual redirects, public https only), block on 404 / errors / loops / unsafe redirects / sold out, warn on redirect, other domain, canonical, pixel and form. Keep the clean product URL and put tracking in the creative's `url_tags` with Meta dynamic parameters (`{{site_source_name}}`, `{{campaign.id}}`, `{{adset.id}}`, `{{ad.id}}`), set at creation (changing them later restarts learning) |
| Meta optimizes on submitted COD forms, including fakes and the owner's tests | Purchase fires at submit; the ERP knew confirmations and deliveries but sent nothing (delivered was opt-in, unlinked, without the store's identity format) | Send `OrderConfirmed` (`phone_call`) and `OrderDelivered` (`other`) from the ERP with `original_event_data` (Purchase + the store's `event_id` + `order_id`), hashing identity exactly like the store form (phone `213…`, first/last name, Latin commune) plus wilaya; once per order; a test code routes them to Test events. Keep the store `event_id` on the order (Shopify attribute, sheet column, hook) |
| A new Meta app + system user: the owner could assign the Page, Instagram and the dataset but not the ad account or the app; deleting the old app killed every token generated through it (its system user remained); two empty data sources appeared («Souqnna», «Erp.system») and were mistaken for the app, which is listed only under Applications | The guide said "Assign assets" on the system user, a button the owner's (French, mobile) Business settings did not show; it also said publishing the app was unnecessary, but an app in development mode cannot create ad creatives (subcode 1885183) | Talk in the labels the owner sees on their own screenshots (their French UI says «Affecter des personnes»), never in inferred objects. Assign from each asset's own page: Affecter/Attribuer des personnes → the system user → Contrôle total (ad account, dataset, app, Page, Instagram). Publish the app (privacy policy URL + category). Before deleting an app or a system user, test every token that might depend on it with a read-only `GET /me` (n8n: a temporary workflow on the same credential, then archive it). Name the one dataset to pick by ID. Map Meta code 190 and subcode 1885183 to messages that say what to do |
| The dataset shows a server copy of every browser event, and two server Purchases per order | Not from the store (no app, Shopify's own custom pixel only logs), n8n sends one; the second copy's source could not be identified from the store side | Check Events Manager → Purchase → deduplication before changing anything; all copies must share the event_id. Never add a second CAPI sender for Purchase |
| No lab speed score: PageSpeed Insights answers 429 even on the first call | Google closed keyless PSI calls (quota 0 per day) | Use Shopify's real-user `web_performance` (ShopifyQL: LCP/INP/CLS per page and device), or add a free PSI API key |

## Verification checklist (run before every delivery)

1. `npm test` passes. Cover at least:
   - the status transitions;
   - split weighting, stickiness and routing (no cloaking, bots handled);
   - the Bayesian winner;
   - Advisor states and the empty `errors[]`;
   - the journal;
   - the `no_ads` verdict;
   - Shopify-mode config;
   - snippet JavaScript that parses;
   - beacons counting humans and not bots.
2. Run `node scripts/ui-audit.cjs <url> out.json` (the Impeccable audit method). It checks 20 routes in dark, light and mobile for contrast below 4.5, buttons without names, fields without labels, horizontal overflow, h1 count and touch targets. Target: 0 contrast, 0 names, 0 labels, 0 overflow.
3. Start a seeded server (`scripts/seed-demo.mjs`) and screenshot **every page** with Playwright:
   - AR dark at 1440px, AR at 390px (mobile), FR light;
   - zero `pageerror` or console errors;
   - look at the images: RTL numbers, the sidebar, empty states, modals.
4. For theme snippets: serve a fake store (a tiny HTTP server with `/products/x`, `/pages/x-lp`, `/fr/...`) that injects the snippet with a test config. Assert in a real browser:
   - the redirect;
   - parameters kept;
   - the `utm_content` tag;
   - stickiness;
   - the distribution;
   - the locale prefix;
   - other pages untouched;
   - no loop;
   - no stuck opacity.
5. For integrations without live credentials: unit-test the mapping functions (statuses, money units, payload shape) against recorded or sample responses. Say plainly which integrations were not tested live.
6. Re-read the diff for:
   - secrets;
   - hardcoded URLs;
   - missing sensitive-password guards;
   - missing AR or FR keys.

## Delivery recipe

**Demo link the user can open on the phone:**

1. Start a seeded server with `scripts/demo.sh`, then record real GET responses with `DEMO_PASSWORD=… node scripts/record-demo.cjs http://localhost:3600 <out>/demo-data.json`.
2. Build with `VITE_DEMO=1 npm --prefix client run build` (output in `client/dist-demo`). Remove `sw.js` from the output.
3. Copy everything to a scratch folder. Write an `index.html` that holds **only** the title, the stylesheet link, `theme-init.js`, the module script and `<div id="root">`. The Artifact publisher wraps it in its own skeleton.
4. Publish with `Artifact` (`file_path` = that index, `root` = that folder, `files` = every other file, `icon`).
5. Load the folder locally once in a 390px viewport. Expect no errors, then give the link.
6. Tell the user:
   - browsing works;
   - saving is disabled;
   - Meta figures are illustrative until their token is connected.

**VPS installation (24/7, next to n8n):**

1. Add a DNS `A` record for the subdomain (e.g. `erp`) pointing to the VPS IP. With Cloudflare, use "DNS only" until the certificate is issued.
2. `git clone -b <branch> <repo> /opt/erp`, then `cd "/opt/erp/ERP TOURECHE"` and run `bash deploy/install-vps.sh erp.<domain>`.
3. Open `https://erp.<domain>`. Enter the setup token the script printed, then create the admin, the sensitive password and the first project.
4. Move data from the computer: `deploy/erp.sh restore <file.db>` and `deploy/erp.sh import-key <.secret-key>`.
5. From n8n on the same server, call `http://erp-toureche:3600/api/hooks/<slug>/orders`.

**Real installation (computer):**

1. Install Node 22.
2. Copy the folder to the computer.
3. Run `npm run setup`, then `npm start`.
4. On first open, create the admin account, the sensitive password and the first project.
5. Run `tailscale serve --bg 3600` and set `ERP_TRUST_PROXY=1`.
6. Open the Tailscale URL on the phone, then "Add to Home Screen".
7. Keep the computer awake: macOS `caffeinate -dimsu &`; Windows power settings plus the startup folder; or pm2.

**Final message** (in the user's language, about 10 lines):

- the link;
- what was built;
- how to run it;
- what was verified, with numbers;
- what was not verified and why;
- the next actions for the user: tokens, approvals, budgets.
