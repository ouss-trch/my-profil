---
name: cod-landing-page-builder
description: Build high-converting cash-on-delivery (COD) landing pages for Algerian and Maghreb online stores (Shopify or any stack). Analyze the product page, ask the owner the buyer questions the page does not answer and turn the answers into product features (never FAQ entries), propose product-specific marketing angles (segment, motivation, awareness level, buyer voice), plan an image-led page (a hook image, then descriptive images with short Arabic text inside), write the Arabic or darija copy without AI tells, and write the image-generation prompts, all under Meta ad policy and with no invented claims. Ships ready system messages and user prompts for any landing builder (ERP, n8n agent, chat). Use whenever the user wants a landing page, صفحة هبوط, لاندينغ بيج, page de vente, marketing angles, زوايا تسويقية, product analysis for ads, صور وصفية, image prompts for a product, or a prompt for a landing page builder, even without saying "skill".
---

# COD landing page builder

A landing page for a COD store has one job: the visitor fills the order form. The visitor arrives from a Facebook or Instagram ad built on one angle, on a phone, and fears one thing above all: regret (will it arrive, will it match the photo, is it worth the price). Everything below serves that reader.

The rules come from the most-installed marketing skills on skills.sh (copywriting, cro, marketing-psychology, product-marketing, ad-creative, image), distilled for Algerian COD. Sources and versions: `references/sources.md`.

## Workflow

1. **Read the product page.** Title, description, specs, variants, every photo, price, compare-at price, quantity offers, delivery prices and the store's policies (inspection before paying, exchange, returns). List each verifiable fact with its benefit to the buyer and its source. Never state a number, duration or material the page does not give.

2. **Ask the owner the buyer questions** the page does not answer (0 to 6): leaks, how long it keeps heat, suitable age, size, cleaning, what is in the box. Give each one a spec label and an answer hint.
   - The owner's answers are **confirmed product features**. Each becomes a spec row ("Leak-proof: yes, even upside down") and a feature line, benefit first ("Leak-proof lid and straw: the school bag stays dry").
   - They feed the angles, the benefits and above all the images (callout labels, a "feature at work" shot). They are **never FAQ entries**. The page FAQ stays for buying objections only: delivery, payment, inspection, exchange, choosing a size or color.
   - Reword a darija or voice-typed answer into clean Arabic without adding any fact. An answer that gives no value ("it's in the photo") is sent back with what is missing.

3. **Propose 4 to 6 angles**, each a narrow segment × one motivation ("mothers of primary pupils × the drink is cold before break"), never a generic word ("daily use"). Per angle: audience, awareness level (unaware, problem, solution, product), buyer voice (2 to 3 phrases as they would really say them), promise (6 to 10 words that pass the "Now you can…" test), pains, proofs (from facts and owner answers), objections, writing framework (AIDA, PAS, BAB, FAB, 4P, or honest FOMO only with a real offer or real low stock), page design, and a storyboard of 5 to 7 images. Details: `references/angles.md`.

4. **Plan the images.** The images are the page, not decoration between paragraphs. Image 1 is the hook that completes the ad's promise; image 2 pays it off; then one template per image (callouts with the owner's answers, feature at work, problem then solution, old way vs this, real use, what you receive, macro detail, real colors, gift or emotional result). The headline says what the picture means, not what it shows. 3 to 7 words of headline and at most 3 labels of 2 to 4 words: more than that and image models misspell Arabic. Every image a different place, framing and camera angle. Details: `references/visuals.md`.

5. **Write the copy.** The first screen carries the whole path to action: current discomfort, better vision, path (product + button). Clarity over cleverness, benefit before feature, specific over vague, the buyer's words over brand words, one idea per section. COD risk reversal (pay on delivery, inspection, exchange, confirmation call) next to every button. No invented reviews, counts, awards, scarcity or countdowns. No AI tells; the Arabic blacklist is in `references/copy.md`.

6. **Write the image prompts** with the structure in `references/prompt-templates.md`: real product photo as the reference, 100% product fidelity, image type, scene (25 to 70 words: action, place, light, framing, space for text), camera, style, the owner's confirmed features as context, then exactly the Arabic texts to write in the page's accent color, and no faces.

7. **Assemble the page.** With 3 or more written images: hook image (live H1 hidden visually), trust strip, 3 images in a row, how to order, the order form, the remaining images, specs, guarantees, delivery, FAQ (objections only), final button. Fewer written images: the angle's usual layout with paragraphs.

8. **Verify before publishing.** Every claim traced to the page or an owner answer; no AI tells; Meta policy (no health claims, no personal attributes, no fake urgency); each image checked for product fidelity and correct Arabic letters (turn the text off and redraw if not); the page read at 390 px wide.

## Ready prompts for any builder

`references/prompt-templates.md` holds the system messages and user prompts for each step: product analysis, answer to feature, copywriter, visual planner, image prompt. Use them in an n8n AI agent, another ERP, or a plain chat. The `<craft>` blocks there are filled with the three files in `references/`.

## In the ERP TOURECHE repository

The ERP implements this skill end to end, and both read the same rule files:

- `ERP TOURECHE/server/prompts/landing/{angles,copy,visuals}.md`: the rule files, loaded into the builder's system messages. Copies live in this skill's `references/`; a test fails if they differ.
- `ERP TOURECHE/server/services/landing.js`: analysis (`analyzeProduct`), owner answers (`answerQuestion`), copy and visual plan (`generateLanding`), image prompt (`visualPrompt`), image-led template (`buildTemplate`).
- `ERP TOURECHE/server/services/seo.js` (`mergeAnswers`) and `products.js` (`publishAnswers`): owner answers into the Shopify product description as spec rows and features, never FAQ.
- To update the rules: edit the ERP files, copy them here, run `npm test`, then re-upload this skill (see the repository's `SKILLS.md`).
