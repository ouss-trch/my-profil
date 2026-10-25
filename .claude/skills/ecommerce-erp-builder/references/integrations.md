# Integrations: Shopify, Meta, carriers, n8n, AI

General rules for every adapter:

- One module per service, sharing the HTTP helper in `lib/http.js` (timeout, retries with backoff on 429 and 5xx, a typed `IntegrationError(service, kind, code)`).
- Read credentials from settings, never from code.
- Cache reference data: wilayas, communes and desks for 1–7 days.
- Pin API versions in a setting, so a deprecation is a settings change, not a code change.

## Shopify (Admin GraphQL)

- **Endpoint:** `https://{shop}.myshopify.com/admin/api/{version}/graphql.json` with the header `X-Shopify-Access-Token`. The version is a setting (`shopify_api_version`).
- **Getting a token:** historically from admin → Settings → Apps → Develop apps (a custom app and a `shpat_…` token). Shopify has been moving custom-app creation to the Dev Dashboard, so check the current path in Shopify's docs before writing instructions for the user.
- **Scopes:** `read/write_products`, `read/write_orders`, `read/write_inventory`, `read/write_themes`, `read/write_metafields`. Optionally add `read_customer_events` for `customerJourneySummary`, which gives the visit's landing page and UTMs.
- **Rate limits:** the GraphQL API uses a cost-based leaky bucket. Read `extensions.cost.throttleStatus` and slow down before you hit the limit. Use bulk operations for full historical syncs.
- **COD orders:** the financial status is usually pending, and the gateway is the manual "Cash on Delivery". Import them into the ERP's `new` status. Upsert by Shopify id and backfill UTM and landing data.
- **Attribution:** `customerJourneySummary` can fail when the scope is missing. Keep a `journeyAllowed` fallback that stops asking for it, so the order sync never breaks.
- **Storing config for theme code:**
  - Use a shop metafield (`metafieldsSet` on the shop GID, type `json`), for example `erp_toureche.splits`.
  - Liquid reads it with `shop.metafields.erp_toureche.splits.value`.
  - The storefront keeps working while the ERP computer is off.
- **Writing theme files:**
  - `themeFilesUpsert` may be refused for apps without a Shopify exemption.
  - Always ship a manual fallback: show the snippet and the one render line to paste after `<head>` in `layout/theme.liquid`.
  - Back up `theme.liquid` before every automatic edit.
- **Alternate product templates:** `product.<suffix>.json` is served with `?view=<suffix>`. This is the safe way to show different marketing angles on the same product URL.

## Meta Marketing API

- **Token:** a **System User** token from Business Manager. It does not expire.
- **Scopes:**
  - `ads_management`, `ads_read`, `business_management`;
  - `pages_read_engagement`, `pages_manage_posts`;
  - `instagram_basic`, `instagram_content_publish` (only if posting).
- **Graph version:** a setting (`meta_graph_version`). Old versions are retired on a schedule, so expect to bump it about once a year.
- **Reading data:**
  - `me/businesses` → `{business}/owned_ad_accounts` and `client_ad_accounts`.
  - Per account: `promote_pages` and `adspixels`.
  - Campaigns: `effective_status`, `daily_budget`/`lifetime_budget` (the budget sits on the campaign for CBO, on ad sets for ABO), `bid_strategy`, `issues_info`.
  - Ad sets: `learning_stage_info`, with status LEARNING / SUCCESS / FAIL. FAIL means "Learning limited".
  - Ad creative fields: `thumbnail_url`, `image_url`, `object_story_spec`. Reuse the ad copy when relaunching.
- **Money:** budgets are in the currency's **minor units** (cents for USD/EUR). Divide by 100 when reading and multiply by 100 when writing. Ad accounts are usually in USD or EUR while the business thinks in DA, so convert with the **editable** parallel-market rate (`fx_usd_dza`, `fx_eur_dza`). Never hardcode the rate.
- **Creating a campaign** (always `status: PAUSED`):
  - Send `special_ad_categories: []`; it is required even when empty.
  - CBO: `daily_budget` on the campaign, `bid_strategy: LOWEST_COST_WITHOUT_CAP`.
  - ABO: recent API versions also ask for `is_adset_budget_sharing_enabled` on the campaign. Read the error message and pass the field.
  - Ad set: `optimization_goal: OFFSITE_CONVERSIONS` with `promoted_object {pixel_id, custom_event_type: PURCHASE}` when a pixel exists, otherwise `LANDING_PAGE_VIEWS`. Use `billing_event: IMPRESSIONS`.
  - Link URL tags for attribution: `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}`. Meta fills in these dynamic parameters.
  - Return the Ads Manager URL so the user can review before activating.
- **Activation:** only after an explicit yes from the user and the sensitive password. Activate ads, then ad sets, then the campaign.
- **Learning phase** (Meta Business Help, *About the learning phase* and *About significant edits*):
  - An ad set needs about **50 optimization events within 7 days** after its last significant edit to exit learning. Meta has changed thresholds before, so re-check the help page when in doubt.
  - **Significant edits:**
    - any change to targeting, creative or optimization event;
    - adding a new ad;
    - pausing for 7 days or more;
    - changing the bid strategy;
    - budget or bid changes, depending on their size. Meta publishes no exact percentage.
  - **ERP policy:**
    - suggest +20% at most per change, then wait 3–4 days;
    - require an explicit acknowledgment above 20%;
    - show a warning banner before any significant edit;
    - show learning status with conversions out of 50.
- **CAPI:** server events deduplicate against pixel events through the same `event_id`. For COD it helps to send what happens after the purchase as a custom event or custom conversion (for example "OrderConfirmed" or "Delivered"). Keep `Purchase` at order time unless the user deliberately switches optimization, because a delivery-time event arrives days late and starves learning.

## Carriers (Algeria)

Every adapter exposes the same interface: `isConfigured, wilayas, communes, desks, create, label, track, fees`.

| Carrier | Base | Auth | Main calls |
|---|---|---|---|
| Yalidine | `https://api.yalidine.app/v1` | headers `X-API-ID`, `X-API-TOKEN` | `GET /wilayas/`, `/communes/?wilaya_id=`, `/centers/?wilaya_id=` (stop desks), `/fees/?from_wilaya_id=&to_wilaya_id=`, `/histories/?tracking=a,b,c` (tracking); `POST /parcels/` (array body); paginated with `has_more` and `links.next`; quota headers per second, minute, hour and day |
| NOEST | `https://app.noest-dz.com/api/public` | `Authorization: Bearer <api_token>` plus `user_guid` in bodies | `POST /create/order`, then `POST /valid/order`; `GET /get/order/label?tracking=`; `POST /get/trackings/info` (batched); `GET /fees`, `/desks`, `/get/wilayas`, `/get/communes/{code}` |
| ZR Express (Procolis) | `https://procolis.com/api_v1` | headers `token`, `key` | `GET /token` (check credentials); `POST /add_colis` `{Colis:[…]}`; `POST /lire` `{Colis:[{Tracking}]}`; `POST /tarification` |

- **Map carrier statuses** onto the ERP status machine, with a table per carrier. Carrier statuses are free text in Arabic or French: match on normalized keywords and log anything unknown instead of guessing.
- **Delivery type:** stop desk (office) or home delivery. A stop desk needs the carrier's desk or center id; home delivery needs a commune.
- **Wilayas:** carriers still use 58 wilayas. The 2026 wilayas (59–69) ship as their parent (`shipAs`).
- **Scoring the best carrier per wilaya:**
  - Weights: delivery success 45%, speed 25%, driver contact quality 15%, price 15%. Store them in `carrier_weights` so they are editable.
  - Use local history when the sample is big enough, otherwise fall back to the carrier's estimate.
  - Show the sample size `n`.

## n8n

- **Inbound order hook:**
  - `POST /api/hooks/<project-slug>/orders` with the header `x-erp-key`, compared with `safeEqual`.
  - Fields: `customer_name, phone, wilaya, commune, address, delivery_type, items[], total, utm_source, utm_campaign, utm_content, landing_url`, plus an external id for idempotency.
- **Outbound events** go to webhook URLs stored in settings: new order, confirmed, shipped, delivered or returned, and the morning report.
  - Never hardcode URLs. Never put shared secrets inside workflow JSON that gets committed; use n8n credentials.
- **Google Sheets bridge:** use it for stores that collect orders in Sheets. The ERP imports through n8n and dedupes by external id plus phone.
- **Workflow building:**
  - Use the n8n MCP flow: SDK reference → best practices → search nodes → node types → validate → create.
  - Add an Error Trigger workflow.
  - Respond to webhooks quickly and do slow work afterwards.

## AI

- Use Anthropic with the model chosen through the claude-api skill. Use JSON schemas for structured output, such as `ADVISOR_SCHEMA` for the weekly report and SEO output.
- **Assistant tools** read real data: orders, stats, advisor insights, journal, split tests. Write tools must propose a change first and only run after the user's approval and the sensitive password.
- **Image generation** (OpenAI or Gemini) is optional and keyed in settings. Store results under `data/uploads`.
