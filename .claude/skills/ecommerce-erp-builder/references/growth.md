# Growth layer: KPIs, Advisor, ad decisions, A/B pages, niche notes

What makes this ERP better than a plain order list is that it tells the owner what to do next, with evidence.

## KPIs (definitions must be consistent everywhere)

| KPI | Formula | Notes |
|---|---|---|
| Confirmation rate | confirmed-or-later ÷ (all orders − still pending) | Exclude `fake` duplicates from the base |
| Delivery rate | delivered ÷ (delivered + returned) over closed shipments | Calculate per carrier, per wilaya and per product |
| Expected deliveries | delivered + in-flight × delivery rate | Lets you judge before the shipments close |
| Cost per delivered (CPD) | ad spend in DA ÷ expected deliveries | **The** ad metric for COD |
| Break-even CPD | price − unit cost − packaging − seller-paid delivery − (return fee × returns share) | Per product |
| Delivered profit | delivered revenue − COGS − shipping − return fees − ad spend − expenses | Finance page |

Convert ad spend to DA with the editable `fx_usd_dza` and `fx_eur_dza` rates, and show the rate next to every converted figure.

## Product and ad verdicts (`services/ads.js`)

| Verdict | Condition |
|---|---|
| `no_ads` | No campaigns and zero spend. Sales are organic, so there is no ad verdict. This avoids the bug where zero spend counted as "winning". |
| `winning` | Expected deliveries ≥ 3 and CPD ≤ 60% of break-even |
| `thin` | CPD ≤ 105% of break-even |
| `losing` | CPD above break-even, or spend ≥ the kill threshold (`test_kill_spend_da`, default 3000 DA) with fewer than 1 expected delivery |
| `pending` / `insufficient` | Too little data. Say so; never call it early. |

When a product is winning **and** has running campaigns, suggest scaling: next budget = current × 1.2, shown in the account currency and in DA. Add the reminder: one change, then wait 3–4 days, then check learning status. Never suggest scaling without running campaigns.

Campaign diagnosis, in order:

1. Fewer than 1000 impressions: `not_enough_data`.
2. CTR below 0.8%: `weak_hook`. Change the creative's first 3 seconds or the image.
3. Conversion from link click below 1%: `weak_page_or_offer`. Fix the landing page or offer; this is where A/B pages help.
4. CPM above 4: `expensive_audience`.
5. Frequency rising while CTR falls: `audience_fatigue`.

- **Break-even carries the real cost of returns:** each delivered order also pays for its share of returns, `(1 − delivery rate) / delivery rate × return cost`.
  - Return cost = return fee + packaging + loss rate × unit cost.
  - The loss rate is the share of returned units marked damaged or missing over 90 days, used once there are at least 10 units.
- The per-product test shows returned orders, the return rate and the real return cost, so a product with a high return rate is judged on what it really costs.

## Advisor (`services/advisor.js`)

**Rule areas:** confirmation, delivery, carriers, wilayas, products, stock, catalog, ads, customers, finance, timing, split tests, setup.

**Every insight carries:**

- `severity` (critical, high, medium, low);
- `title`;
- `evidence`: the real numbers, using bidi-safe DA formatting;
- `advice`: one concrete step;
- `action`: a button that deep-links to the page that fixes it;
- `impact_da`: the estimated money at stake, used for sorting;
- `area`.

**Insight states** are stored in `insight_states`: done, dismissed, or snoozed until a date. Marking one "done" with a note writes a **journal** decision, so the owner builds a record of what was tried and what worked.

**Failures:** each rule group runs in try/catch, and its error is added to an `errors[]` array in the output. A test asserts `errors` is empty, so rules never fail silently.

**Scores:** 0–100 per area, shown on the Advisor page and in Today's "priorities now".

**AI report:** weekly, or on demand.

- Claude receives the rule output plus aggregates and returns JSON per `ADVISOR_SCHEMA`: summary, wins, risks, three priorities, experiments to run.
- Reports are stored in `advisor_reports`.
- The model must cite the numbers it was given and never invent them.

**Example rules worth keeping:**

- Orders waiting more than 24 hours for confirmation, with the value at risk.
- A no-answer rate above normal, by hour of day. Suggest calling windows.
- A wilaya where the chosen carrier delivers clearly worse than another carrier (only with a large enough sample).
- A product with a high return rate. Check the description against reality, the price and the photos.
- Stock running out within N days at the current sales speed.
- An ad set stuck in learning, or "learning limited". Consolidate ad sets or broaden the audience; don't keep editing.
- Repeat customers or phones with several returns. Flag them before confirming.
- Setup gaps: missing costs (so no break-even), missing carrier keys, missing FX rate.

## A/B landing pages on the same store domain

**Goal:** the ad keeps pointing to the normal product URL, and each new visitor sees one variant (a different marketing angle), sticky across visits. The winner is judged by **delivered** orders.

**Mechanism (Shopify):**

1. The variants are alternate templates (`/products/x?view=angle-gift`) or pages (`/pages/x-lp`), made in the theme editor.
2. The ERP stores running tests, and ended tests with a winner, in the shop metafield `erp_toureche.splits` (JSON).
3. A tiny snippet `snippets/erp-split.liquid`, rendered right after `<head>`, does the following:
   - reads the config;
   - matches the entry path, keeping any locale prefix such as `/fr/`;
   - picks a variant by weight;
   - stores it in the cookie `erp_sv_<slug>`;
   - redirects, keeping all query parameters (fbclid, utm) and adding `utm_content=<slug>-<label>` and the marker `erp_v=<slug>.<label>`.
4. The `erp_v` marker prevents redirect loops and leaves other pages untouched. The snippet never leaves the page hidden: it restores opacity on every path.
5. **Optional visitor counting:** the snippet calls `navigator.sendBeacon` to `POST /api/hooks/split/<slug>/hit` on the public ERP URL.
   - The response sets `Cross-Origin-Resource-Policy: cross-origin` and `Access-Control-Allow-Origin: *`.
   - Bots are redirected the same way (no cloaking) but not counted.
6. **Attribution:** the order's `utm_content` or `landing_url` carries the variant label.
7. **Statistics:**
   - With visitor counts: Beta posterior per variant and P(best) by Monte Carlo.
   - Without visitor counts: orders compared with traffic weights, using a Poisson-Gamma model.
   - Show the estimation mode and the sample size.
   - **Success goal:** each test chooses what counts as a success: orders, confirmed orders, or delivered orders (the default, and the truth).
   - **Winner:**
     - P(best) ≥ 95% and the leader has ≥ 10 successes;
     - with tracked visitors, also ≥ 150 visitors on every variant;
     - without tracked visitors, also ≥ 20 successes in total.
   - **No difference:** P(best) < 80% after a large sample (≥ 1500 visitors and ≥ 20 successes per variant, or ≥ 25 successes per variant without visitor tracking).
8. Installing the snippet means editing `theme.liquid` (back it up first). If Shopify refuses `themeFilesUpsert`, the ERP shows the snippet and the render line to paste by hand.

**Alternative mode (`redirect`):** a `/go/<slug>` link on the ERP domain. Use it only when the store is not on Shopify.

**Meta policy:** every variant must sell the same product with the same offer and price, and bots must see what humans see.

**Verified behaviour** (in a real browser against a simulated store):

- a visitor lands on a variant with the ad parameters kept and `utm_content` tagged;
- the variant is sticky over 5 visits;
- the split was roughly even (24/16 over 40 visitors);
- the `/fr` prefix is kept;
- other pages are untouched;
- there is no redirect loop;
- there is no stuck opacity.

## Suppliers and delivery contacts (what makes the "contacts" page useful)

- **Supplier ↔ products** (`products.supplier_id`, `contacts.lead_time_days`):
  - Reorder when stock ≤ `low_stock`, or when days left ≤ lead time + 3.
  - Suggested quantity = sales per day (last 14 days) × (lead time + 14) − stock.
  - The supplier card shows a ready WhatsApp order message.
  - The Advisor's stock alert names the supplier, the lead time and the quantity, and becomes critical when lead time ≥ days left.
- **Carrier desk or driver ↔ wilaya:**
  - Each entry counts the stuck parcels (`at_office`, `attempt_failed`) for its carrier and wilaya.
  - Inside a stuck order the drawer shows that desk's call and WhatsApp buttons with a prefilled message.
  - 2026 wilayas match their parent wilaya.

## Niche notes: "مكتبة ألواني" (children's coloring and activity books, puzzles, mazes, notebooks, Algeria)

Treat these as hypotheses to confirm with the owner and the data, not facts.

- **Catalog:**
  - Variants by age band (3–5, 6–8, 9–12) and theme.
  - **Packs and bundles** raise the order value, which matters because a low-price item can't absorb COD delivery and return costs.
  - Track the cost per page or per book: printing, binding, paper.
- **Pricing:** set a minimum order value, or push packs, so that delivery fee + return risk < margin. Compute break-even per pack, not per single book.
- **Seasonality:**
  - school start (September);
  - summer holidays (activity books);
  - school holidays (winter, spring);
  - Ramadan and Eid gifting.
  - Plan stock and creatives ahead of each season.
- **Audience:** parents (mostly mothers, 25–45), teachers and schools. B2B (schools, bookstores, nurseries) needs wholesale prices and a separate pipeline in the CRM: contacts, quotes, tasks.
- **Creatives:** flip-through videos of the inside pages, a child using the book, before and after a colored page. A free printable sample can work as a lead magnet; collect phone and WhatsApp and send it through n8n.
- **Extra ERP fields:** age band, page count, format (A4/A5), weight (affects delivery cost), print batch and printer, reprint threshold.
- **Advisor rules to add:**
  - The pack-versus-single mix and its effect on CPD.
  - Reprint alerts based on sales speed and print lead time.
  - The season calendar, with tasks created 6 weeks ahead.
