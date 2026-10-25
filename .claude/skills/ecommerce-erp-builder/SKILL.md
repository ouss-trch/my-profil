---
name: ecommerce-erp-builder
description: Build or extend a professional ERP/CRM for a cash-on-delivery (COD) e-commerce business in Algeria or the Maghreb, connected to Shopify, Meta Ads (Business Manager, pixel, campaigns), local carriers (Yalidine, NOEST, ZR Express), n8n and AI. Starts with a short batch of important questions, then builds about 80% of a working system, verifies it and delivers a phone-ready link. Use whenever the user wants an ERP, CRM, back-office, order or confirmation system, ads dashboard, carrier dashboard or landing-page A/B testing for an online store. Triggers include "ERP", "CRM", "نظام إدارة", "إدارة الطلبيات", "تأكيد الطلبيات", "الدفع عند الاستلام", "COD", "متجر شوبيفاي", "Yalidine", "ZR Express", "NOEST", "Meta ads", "Business Manager", "gestion de commandes", "boutique en ligne Algérie", and new store projects such as "مكتبة ألواني".
---

# E-commerce ERP builder (COD · Algeria)

The reference build is **ERP TOURECHE** in this repository (`ERP TOURECHE/`). Reuse its code; don't start from zero unless the user asks. Read the reference files only when the step needs them:

| File | Read it when |
|---|---|
| `references/architecture.md` | Setting up the stack, data model, security, multi-project, build order |
| `references/integrations.md` | Touching Shopify, Meta Marketing API, Yalidine/NOEST/ZR, n8n or AI |
| `references/growth.md` | KPIs, the Advisor, ad decisions, same-domain A/B pages, niche notes (e.g. مكتبة ألواني) |
| `references/pitfalls.md` | Before verifying and delivering; when something breaks |

## How the user wants to work

- Reply in the user's language (usually Arabic; French technical terms are fine). Be short, clear and confident. Give a numbered plan, not a list of possibilities.
- Never improvise rules. Ads advice follows Meta's own documentation, and the reply names the source (for example: Meta Business Help, *About significant edits*). If something can't be verified, say so in one line.
- Never claim something works without running it. Report what was verified and what was not.
- Hard limits:
  - Never commit secrets: tokens, keys, n8n bridge secrets or webhook URLs.
  - Never guess a budget. The user always types the amount.
  - Never activate a Meta campaign or spend money without the user's explicit yes in this conversation.
  - Every delete, price change, budget change, activation or settings change asks for the separate **sensitive password**.

## Workflow

### 1. Discover before asking

Look at what already exists. Don't ask for anything a tool can answer.

- The repo: is there an old ERP, a design to copy, or a Google Sheet export?
- Connectors:
  - Shopify: shop info, products, orders.
  - Meta: ad accounts, pages, pixels, existing campaigns.
  - n8n: existing workflows and webhooks.
- Memory and earlier conversations: store names, domains, carriers in use.

### 2. Ask once: short, important questions

Send **one** batch of no more than 8 questions. Use AskUserQuestion with up to 4 per call, and offer defaults so the user can just pick. Skip any question already answered in step 1.

1. **Projects:** how many stores, pages and domains? Each one becomes a project with its own settings. *Default: 1 project, more can be added later.*
2. **Channels:** Shopify, landing pages, Google Sheets forms, Facebook/Instagram/TikTok messages? *Default: Shopify + Sheets bridge.*
3. **Carriers:** Yalidine, NOEST, ZR Express, others? Stop desk, home delivery or both? *Default: all three, both modes.*
4. **Team:** who confirms orders, who ships, and are roles separate? *Default: admin + confirmer roles.*
5. **Costs per product:** unit cost, packaging, and who pays delivery and returns. This is needed for break-even. *Default: enter per product in the ERP.*
6. **Ads:** Business Manager(s), number of ad accounts, account currency (USD/EUR), and the parallel-market FX rate. *Default: rate editable in the ERP; never guessed.*
7. **Hosting:** the user's computer plus Tailscale, or a VPS? *Default: the user's computer, opened as a phone app over Tailscale.*
8. **Look and languages:** copy an old design? Arabic and French, dark and light? *Default: AR/FR, dark first.*

For a **new niche** (for example مكتبة ألواني: coloring books, activity books, puzzles, mazes and notebooks), add up to 2 niche questions. Read `references/growth.md → Niche notes`.

### 3. Plan in one screen

Write the plan in the user's language:

- the modules in build order;
- what the user must provide (tokens and scopes per integration, see `references/integrations.md`);
- what stays manual for now.

Get a yes, then build without further check-ins unless something is truly blocked.

### 4. Build about 80%

Follow the build order in `references/architecture.md`:

1. Core: auth, projects, settings, secrets.
2. The order pipeline.
3. Carriers.
4. Shopify sync.
5. Meta, read first and then create campaigns as PAUSED.
6. The UI.
7. The Advisor.
8. A/B pages.
9. n8n hooks.
10. Documentation and start scripts.

Every module ships with:

- AR and FR labels;
- dark and light themes;
- empty states;
- the sensitive-password guard on destructive actions;
- an entry in the activity log.

### 5. Verify (required)

Use the checklist in `references/pitfalls.md`:

- `npm test` (node:test);
- Playwright screenshots of every page in AR dark at 1440px, AR mobile at 390px and FR light;
- zero console errors;
- integration logic tested against simulated responses;
- the theme snippet tested on a simulated store.

Fix, re-run, then report the numbers.

### 6. Deliver

1. **A link to try on the phone.**
   - Build the demo copy with `VITE_DEMO=1 npm --prefix client run build`. It contains recorded real responses and disables saving.
   - Publish it as an Artifact: an index page without `<html>`/`<head>`, plus every file through `files` with `root`.
   - Give the user the link.
2. **Real use.**
   - `npm run setup && npm start` on the user's computer.
   - `tailscale serve --bg 3600`.
   - Open the Tailscale URL on the phone, then "Add to Home Screen".
3. **Code.** Commit on the assigned branch and push. If the push returns 403, give the user the GitHub connect link and the Claude GitHub App install step; the commits stay local until then.
4. **Final message** in about 10 lines:
   - what was built;
   - the link;
   - how to run it;
   - what was verified;
   - what the user must do next: tokens, approvals, budgets.

### 7. The remaining 20%

Iterate on real data with the user: thresholds, wording, extra reports. Update this skill whenever a new pitfall or rule is learned (see "Maintaining this skill").

## Non-negotiable product rules

- **Truth metric = delivered orders.** Judge products and ads by cost per *delivered* order against the break-even, never by pixel purchases.
  - Break-even = price − unit cost − packaging − seller-paid delivery − the expected cost of returns.
  - A product with no running ads and zero spend gets the verdict **no_ads**, never "winning".
- **Meta scaling:** at most **+20% per change**, then wait 3–4 days. Any bigger change needs an explicit acknowledgment, because large budget changes can restart the learning phase.
  - Changing targeting, creative, optimization event or bid strategy, adding an ad, or pausing for 7 days or more is a significant edit. Show a warning before saving.
- **Campaigns are created PAUSED.** Activation happens only after the user approves and enters the sensitive password.
- **A/B landing pages:** the same product and the same offer in every variant, no cloaking (bots are routed exactly like humans, just not counted), the visitor sticks to one variant, and the result is judged by delivered orders.
- **Numbers in RTL:** wrap amounts in Unicode isolates (`⁦…⁩`) with a narrow no-break space as the thousands separator, otherwise "14 500 DA" renders reversed.

## Maintaining this skill

When a session discovers a new pitfall, API change or business rule:

- add one line to the right reference file: what happened, the cause, the fix;
- keep SKILL.md under 200 lines.

To use the skill outside this repo, copy the folder to `~/.claude/skills/ecommerce-erp-builder/`. To use it in claude.ai, zip the folder and upload it under Settings → Capabilities → Skills.
