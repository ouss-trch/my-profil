# my-profil

The main project here is **ERP TOURECHE** (`ERP TOURECHE/`). It is the owner's ERP/CRM for COD e-commerce in Algeria:

- Shopify stores (souqnna.com and others), Meta Ads, carriers (Yalidine · NOEST · ZR Express), n8n, AI.
- Multi-project, Arabic/French, dark/light.
- It runs 24/7 on the owner's Hostinger VPS (KVM 2), in Docker next to n8n behind the same Traefik, on its own subdomain. See `ERP TOURECHE/deploy/` and the README section on the VPS. It can also run on a computer.
- Deploy updates on the VPS with `bash deploy/erp.sh update`.
- Full docs: `ERP TOURECHE/README.md`.

## Working rules (from the owner)

- **Always save to GitHub.** Commit and push after every completed change. The owner must be able to reach the code from any conversation or account; a lost computer must never mean a lost ERP.
- **Communication:** reply in Arabic, short, clear and confident. Give a numbered plan, not options. Never claim something works without running it; report what was verified and what was not.
- **Secrets:**
  - Never commit secrets: tokens, keys, `.env`, `data/`, n8n bridge secrets, webhook URLs.
  - Any delete, price change, budget change, Meta activation or settings change requires the **sensitive password**.
- **Meta:**
  - Follow Meta's own documentation: budget changes of +20% at most per step, then wait 3–4 days.
  - Significant edits restart the learning phase.
  - Campaigns are created PAUSED.
  - Never guess a budget, and never activate or spend without the owner's explicit yes.
- **Judging products and ads:** by cost per *delivered* order against the break-even, never by pixel purchases.
- **Database:** the ERP is already installed, so **never edit `MIGRATIONS[0]`**. Add a new migration at the end of the list (`server/db/index.js`) and test it on a database built from the previous schema.

## Commands (inside `ERP TOURECHE/`)

```bash
npm run setup                      # install + build the UI
npm start                          # http://localhost:3600
npm test                           # node:test (must stay green)
npm --prefix client run build      # rebuild the UI after client changes
npm run restore -- <backup.db>     # restore data on a new computer (stop the ERP first)
scripts/demo.sh                    # seeded demo server (DEMO_PASSWORD, DEMO_SENSITIVE)
node scripts/ui-audit.cjs http://localhost:3600 out.json   # contrast, names, labels, overflow on every page (DEMO_PASSWORD)
```

## Skills in this repo (`.claude/skills/`)

- **ecommerce-erp-builder**: how this ERP was built. It covers the question-first workflow, architecture, Shopify/Meta/carriers/n8n knowledge, pitfalls with their fixes, verification, and delivery. Use it for any new store project (e.g. «مكتبة ألواني»).
- **impeccable**: frontend design and quality, by pbakaus (Apache-2.0). Use `audit`, `polish`, `harden` and `critique` on the UI. Its engine downloads a binary on first run; if that is blocked, apply its reference checklists (`reference/audit.md`, `craft-floor.md`, `operate.md`) and `scripts/ui-audit.cjs` instead.
- **Review and improvement skills** (vendored with their licenses; sources in `ERP TOURECHE/SKILLS.md`):
  - security: `sentry-security-review`, `find-bugs`, `sharp-edges`, `supply-chain-risk-auditor`, `skill-scanner` (scan any new skill before adding it);
  - UI and React: `react-best-practices`, `web-design-guidelines`, `webapp-testing`;
  - method: `systematic-debugging`, `verification-before-completion`;
  - growth: `cro`, `ab-testing`, `offers`, `conversion-tracking`.
- **Dependencies:** never install a release younger than two weeks; pin exact versions; run `npm audit --omit=dev` after any change.

## Before finishing any change

1. `npm test` passes.
2. The UI builds.
3. Pages that changed were checked in a browser: AR and FR, dark and light, mobile at 390px, zero console errors.
4. Commit and push.
