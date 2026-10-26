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
| `themeFilesUpsert` refused | Shopify requires an exemption for theme file writes from apps | Manual-install modal: the snippet plus the one render line, both copyable |
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
| `install-vps.sh` exits silently | `set -o pipefail` plus `ip route` or `getent` returning nothing | Add `\|\| true` to probe commands and print what was found |
| Restore fails: "attempt to write a readonly database" | Opening a WAL-mode backup from a `:ro` mount | Copy it next to the target first, check it (integrity, schema_version), then rename it into place; always restart the ERP |

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
