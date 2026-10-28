import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, openDb } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { createProduct, getProduct, updateProduct } from '../server/services/products.js';
import * as landing from '../server/services/landing.js';
import * as products from '../server/services/products.js';
import { mergeAnswers } from '../server/services/seo.js';

// ——— Claude وهمي: تحليل المنتج (فيه زيادات وأخطاء يجب أن تُصلح)، نصوص الصفحة، وخطة الصور ———
const beats = [
  { kind: 'feature', headline: 'دافئ حتى الاستراحة', shows: 'الترمس على مكتب المدرسة والبخار يخرج من الكوب' },
  { kind: 'feature', headline: 'لا يسرّب في الحقيبة', shows: 'الترمس مقلوب داخل حقيبة مع كتب جافة' },
  { kind: 'in_use', headline: 'حزام لا يُنسى', shows: 'طفل من الخلف والترمس على كتفه' },
  { kind: 'robot', headline: 'نوع غريب', shows: 'شيء' },
];
const angle = (name, extra = {}) => ({ name, slug: 'Ecole Matin!', audience: 'أمهات تلاميذ الابتدائي', why: 'المشروب يبقى دافئاً', promise: 'مشروب طفلك دافئ حتى وقت الاستراحة', pains: ['مشروب بارد'], proofs: ['ستانلس ستيل', 'حزام كتف'], objections: ['هل يسرّب؟'], framework: 'pas', layout: 'problem', beats, ...extra });
const insight = {
  summary: 'ترمس أطفال 320 مل بحزام كتف.',
  facts: [{ fact: 'ستانلس ستيل', benefit: 'متين', source: 'description' }],
  missing: ['مدة حفظ الحرارة بالساعات'],
  angles: [angle('مشروب دافئ حتى الاستراحة'), angle('مشروب دافئ حتى الاستراحة'), angle('هدية الدخول المدرسي', { framework: 'zzz', layout: 'nope', slug: 'cadeau-rentree' }), ...Array.from({ length: 6 }, (_, i) => angle(`زاوية ${i}`))],
};
const copy = {
  product_short: 'thermos',
  angle_slug: 'x',
  hero: { eyebrow: '', headline: 'مشروب طفلك دافئ حتى الاستراحة', subheadline: '', bullets: [], cta: 'اطلب الآن', note: '' },
  trust: [],
  story: [{ stage: 'problem', heading: 'كل صباح', body: 'المشروب يبرد.' }],
  benefits: { heading: '', items: [] },
  steps: { heading: 'كيف تطلب', items: ['املأ النموذج'] },
  guarantee: { heading: '', items: [] },
  faq: [],
  final_cta: { headline: '', cta: 'اطلب الآن', note: '' },
  seo: { title: '', description: '' },
  owner_todo: [],
};
const aiCalls = [];
// صياغة جواب التاجر (Claude): يتغيّر حسب الاختبار
let answerReply = { answers: true, label: 'مانع للتسرب', value: 'نعم، مضاد لتسرب الماء', feature: 'غطاء ومصاصة مضادان للتسرب: الحقيبة تبقى جافة', reason: '' };
// صياغة أجوبة قديمة (نُشرت أسئلةً شائعة قبل هذا التحديث) كميزات
let featuresReply = { items: [] };
// Shopify وهمي: وصف المنتج الحي بنفس بنية صفحات المتجر (جدول المواصفات بأسطر جديدة، أسئلة شائعة، الطلب والتوصيل)
let liveHtml = '<h2>ترمس</h2><h3>المواصفات</h3><table>\n<tr>\n<th>السعة</th>\n<td>320 مل</td>\n</tr>\n</table><h3>المميزات</h3><ul><li>حزام</li></ul><h3>أسئلة شائعة</h3><p><strong>ما سعة الترمس؟</strong> سعته 320 مل.</p><h3>الطلب والتوصيل</h3><p>الدفع عند الاستلام.</p>';
const shopUpdates = [];
globalThis.fetch = async (url, init) => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (String(url).includes('myshopify.com')) {
    const { query, variables } = JSON.parse(init.body);
    const node = () => ({ id: 'gid://shopify/Product/77', title: 'ترمس', handle: 'thermos-kids-320', status: 'ACTIVE', descriptionHtml: liveHtml, variants: { nodes: [] }, options: [], media: { nodes: [] }, collections: { nodes: [] } });
    if (query.includes('productUpdate')) {
      shopUpdates.push(variables.product);
      liveHtml = variables.product.descriptionHtml;
      return json({ data: { productUpdate: { product: node(), userErrors: [] } } });
    }
    if (query.includes('product(id:')) return json({ data: { product: node() } });
    throw new Error(`unexpected shopify ${query.slice(0, 40)}`);
  }
  if (!String(url).startsWith('http://anthropic.test')) throw new Error(`unexpected ${url}`);
  const body = JSON.parse(init.body);
  aiCalls.push(body);
  const req = body.output_config.format.schema.required;
  const out = req.includes('answers') ? answerReply : req.includes('items') ? featuresReply : req.includes('angles') ? insight : req.includes('hero') ? copy : { compare: { heading: 'بدونه / معه', without_label: 'بدونه', with_label: 'معه', without: ['يبرد'], with: ['يبقى دافئاً'] }, visuals: [{ kind: 'hero', framing: 'close', headline: 'دافئ حتى الاستراحة', points: ['320 مل'], scene: 'On a school desk.' }] };
  return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
process.env.ANTHROPIC_BASE_URL = 'http://anthropic.test';
setSetting('anthropic_api_key', 'sk-test-insight');
const project = createProject({ name: 'Insight shop', domain: 'insight.example' });
const product = createProduct(project.id, { title: 'ترمس أطفال 320 مل', handle: 'thermos-kids-320', price: 2900, stock: 40, description_html: '<p>ستانلس ستيل، 320 مل، حزام كتف.</p>' });
const facts = (call) => JSON.parse(call.messages[0].content.at(-1).text.match(/\{[\s\S]*\}/)[0]);

test('insight: Claude reads the product page and proposes product-specific angles (cleaned, saved, redone only when the page changes)', async () => {
  const out = await landing.analyzeProduct(project.id, product.id);
  const sent = aiCalls.at(-1);
  assert.match(sent.system, /زوايا تسويقية خاصة بهذا المنتج/);
  assert.ok(sent.output_config.format.schema.required.includes('angles'));
  assert.equal(facts(sent).product.description_text, 'ستانلس ستيل، 320 مل، حزام كتف.');
  // اسمان متطابقان = زاوية واحدة؛ 6 زوايا على الأكثر
  assert.equal(out.angles.length, 6);
  assert.equal(out.angles.filter((a) => a.name === 'مشروب دافئ حتى الاستراحة').length, 1);
  const a = out.angles[0];
  assert.equal(a.slug, 'ecole-matin', 'latin slug for the link');
  assert.equal(a.beats[0].kind, 'hero', 'the page always opens on the hook');
  assert.equal(a.beats[3].kind, 'feature', 'unknown image kinds fixed');
  // إطار أو تصميم غير معروف: الافتراضي، والتصميم من كلمات الزاوية («هدية» ← gift)
  const gift = out.angles.find((x) => x.name === 'هدية الدخول المدرسي');
  assert.equal(gift.framework, 'aida');
  assert.equal(gift.layout, 'gift');
  assert.deepEqual(out.missing, [{ question: 'مدة حفظ الحرارة بالساعات', label: '', hint: '' }], 'an old plain-text question becomes a question to answer');
  assert.equal(out.stale, false);

  // محفوظ: لا طلب جديد ما دامت صفحة المنتج كما هي
  const calls = aiCalls.length;
  await landing.analyzeProduct(project.id, product.id);
  assert.equal(aiCalls.length, calls);
  // تغيّر الوصف ← التحليل قديم ← يُعاد
  updateProduct(product.id, { description_html: '<p>ستانلس ستيل، 320 مل، حزام كتف، غطاء محكم.</p>' });
  assert.equal(landing.getInsight(product.id).stale, true);
  await landing.analyzeProduct(project.id, product.id);
  assert.equal(aiCalls.length, calls + 1);
  // «حلّل من جديد» يفرضه
  await landing.analyzeProduct(project.id, product.id, { fresh: true });
  assert.equal(aiCalls.length, calls + 2);
  // منتج مشروع آخر
  const other = createProject({ name: 'Other shop', domain: 'other.example' });
  await assert.rejects(landing.analyzeProduct(other.id, product.id), /product_not_found/);
});

test('insight: the chosen angle drives the copy and the visual plan (promise, pains, beats), its framework, design and link', async () => {
  const l = await landing.generateLanding(project.id, { product_id: product.id, angle: 'مشروب دافئ حتى الاستراحة' });
  const pair = aiCalls.slice(-2);
  const sent = pair.find((c) => c.output_config.format.schema.required.includes('hero'));
  const plan = pair.find((c) => c !== sent);
  for (const call of [sent, plan]) {
    const data = facts(call);
    assert.equal(data.angle_brief.promise, 'مشروب طفلك دافئ حتى وقت الاستراحة');
    assert.deepEqual(data.angle_brief.beats.map((b) => b.kind), ['hero', 'feature', 'in_use', 'feature']);
    assert.equal(data.product_facts[0].fact, 'ستانلس ستيل');
    assert.equal(data.audience, 'أمهات تلاميذ الابتدائي');
  }
  assert.match(sent.system, /14\. angle_brief/);
  assert.equal(l.framework, 'pas', 'the angle’s framework when none is chosen');
  assert.equal(l.copy.layout, 'problem');
  assert.equal(l.slug, 'thermos-kids-ecole-matin');
  assert.equal(l.copy.brief.name, 'مشروب دافئ حتى الاستراحة', 'kept with the page for a new visual plan');
  assert.equal(l.visuals[0].framing, 'close');
  // خطة جديدة لاحقاً: نفس تسلسل الزاوية
  await landing.planVisuals(l.id);
  assert.equal(facts(aiCalls.at(-1)).angle_brief.beats[1].headline, 'لا يسرّب في الحقيبة');
  // زاوية مكتوبة يدوياً: دون تحليل، كما كانت
  const manual = await landing.generateLanding(project.id, { product_id: product.id, angle: 'زاوية لم يقترحها التحليل' });
  assert.equal(facts(aiCalls.at(-1)).angle_brief, undefined);
  assert.equal(manual.copy.brief, undefined);
});

test('board page: hook image first, then the written images one after another (no paragraph between), the form, then reassurance', () => {
  const tpl = { sections: { main: { type: 'product-main', settings: {}, blocks: {} } } };
  const page = { ...copy, story: [{ stage: 'a', heading: 'فقرة', body: 'نص' }], guarantee: { heading: 'ضمان', items: ['المعاينة قبل الدفع'] }, specs: { heading: 'الخصائص', items: [{ label: 'السعة', value: '320 مل' }] } };
  const shot = (id, kind, written = true) => ({ id, kind, headline: `t-${id}`, points: [], shopify_url: `https://cdn/${id}.png`, drawn_with_text: written });
  const visuals = [shot('v1', 'hero'), shot('v2', 'feature'), shot('v3', 'feature'), shot('v4', 'in_use'), shot('v5', 'detail'), shot('v6', 'outcome', false)];
  const out = landing.buildTemplate(page, tpl, { visuals, layout: 'problem' });
  const types = (sec) => out.sections[sec].block_order.map((k) => out.sections[sec].blocks[k].type);
  assert.deepEqual(types('lp_top'), ['hero', 'trust', 'visual', 'visual', 'visual', 'steps']);
  assert.deepEqual(types('lp_bottom'), ['visual', 'visual', 'specs', 'guarantee', 'cta']);
  assert.ok(!types('lp_top').includes('text') && !types('lp_bottom').includes('text'), 'the images are the description');
  assert.equal(out.sections.lp_top.settings.board, true);
  const hero = Object.values(out.sections.lp_top.blocks)[0];
  assert.equal(hero.settings.image_text, true);
  assert.equal(hero.settings.image_url, 'https://cdn/v1.png');
  // صورة لم تُكتب فيها: عنوانها نص حيّ تحتها
  assert.equal(Object.values(out.sections.lp_bottom.blocks)[1].settings.headline, 't-v6');
  // صورتان مكتوبتان فقط: تصميم الزاوية المعتاد (الفقرات والمقارنة)
  const few = landing.buildTemplate(page, tpl, { visuals: visuals.slice(0, 2), layout: 'problem' });
  assert.equal(few.sections.lp_top.settings.board, false);
  assert.ok(few.sections.lp_top.block_order.some((k) => few.sections.lp_top.blocks[k].type === 'text'));
  // القسم في المتجر يعرف الوضعين
  const liquid = landing.sectionLiquid();
  assert.match(liquid, /erp-lp--board/);
  assert.match(liquid, /erp-lp__hero--img/);
  assert.match(liquid, /"id": "image_text"/);
});

test('visual prompts: each image type has its own style and camera; the colors view sees all real photos', () => {
  const p = { title: 'ترمس', description_html: '<p>ستانلس ستيل</p>' };
  const problem = landing.visualPrompt(p, { kind: 'problem', framing: 'wide', scene: 'A cold drink in a lunch box.', headline: 'مشروب بارد؟', points: [], with_text: true }, { layout: 'problem', angle: 'مشروب دافئ' });
  assert.match(problem, /Image type: Realistic everyday photo of the problem/);
  assert.match(problem, /Camera: wide shot/);
  assert.match(problem, /#0f766e/);
  assert.match(problem, /marketing angle: مشروب دافئ/);
  const benefits = landing.visualPrompt(p, { kind: 'benefits', scene: 'Centered.', headline: 'كل ما يحتاجه', points: ['غطاء محكم', 'حزام كتف'], with_text: true }, { layout: 'value' });
  assert.match(benefits, /labels «غطاء محكم», «حزام كتف»/);
  assert.match(benefits, /thin pointer line/);
  assert.doesNotMatch(benefits, /Camera:/, 'no framing = no camera line');
  const off = landing.visualPrompt(p, { kind: 'detail', scene: 'Macro.', headline: 'خامة', points: ['x'], with_text: false });
  assert.match(off, /Do not write any text/);
  assert.doesNotMatch(off, /labels/);
  assert.match(landing.visualPrompt(p, { kind: 'variants', scene: 'Side by side.' }), /The attached photos are the real photos/);
});

test('customer questions: an answer becomes a product feature: product card, landing copy and images, re-analysis, Shopify specs and features (never FAQ)', async () => {
  insight.missing = [{ question: 'هل يسرّب الماء؟', label: 'مانع للتسرب', hint: 'نعم / لا' }, { question: 'ما العمر المناسب؟', label: 'العمر المناسب', hint: 'من 3 سنوات' }, { question: 'ما الأبعاد؟', label: 'الأبعاد', hint: '' }];
  await landing.analyzeProduct(project.id, product.id, { fresh: true });
  const ask = landing.getInsight(product.id);
  assert.deepEqual(ask.missing.map((m) => m.question), ['هل يسرّب الماء؟', 'ما العمر المناسب؟', 'ما الأبعاد؟']);

  // الجواب بالدارجة ← Claude يصوغه دون إضافة ← سطر في المواصفات + سطر ميزة (الفائدة أولاً)
  const r = await landing.answerQuestion(project.id, product.id, { question: 'هل يسرّب الماء؟', label: 'مانع للتسرب', answer: 'نعم البرودوي هذا مضاد للتسرب' });
  const polish = aiCalls.at(-1);
  assert.match(polish.system, /ممنوع إضافة أي معلومة/);
  assert.match(polish.system, /feature: الخاصية كما تُعرض ميزةً/);
  assert.equal(JSON.parse(polish.messages[0].content.at(-1).text).owner_answer, 'نعم البرودوي هذا مضاد للتسرب');
  const row = r.product.specs.find((x) => x.q === 'هل يسرّب الماء؟');
  assert.equal(row.label, 'مانع للتسرب');
  assert.equal(row.value, 'نعم، مضاد لتسرب الماء');
  assert.equal(row.feature, 'غطاء ومصاصة مضادان للتسرب: الحقيبة تبقى جافة');
  assert.equal(row.faq, undefined, 'no FAQ answer is written any more');
  assert.deepEqual(r.insight.missing.map((m) => m.question), ['ما العمر المناسب؟', 'ما الأبعاد؟']);
  assert.equal(r.insight.answered[0].question, 'هل يسرّب الماء؟');
  assert.equal(r.insight.answered[0].feature, 'غطاء ومصاصة مضادان للتسرب: الحقيبة تبقى جافة');
  assert.equal(r.insight.stale, false, 'our own answer keeps the analysis valid');
  assert.equal(r.insight.fresh_answers, 1);

  // جواب لا يعطي قيمة («موجود في الصورة»): لا يُحفظ، والسبب يصل إلى التاجر
  answerReply = { answers: false, label: 'الأبعاد', value: '', feature: '', reason: 'اكتب الطول والعرض بالسنتيمتر' };
  await assert.rejects(landing.answerQuestion(project.id, product.id, { question: 'ما الأبعاد؟', answer: 'عندنا في الصورة' }), (e) => e.code === 'answer_not_a_value' && e.details.reason === 'اكتب الطول والعرض بالسنتيمتر');
  // «لا يهم» يخفيه، ويعود بـ «أعده»
  assert.ok(!landing.dismissQuestion(project.id, product.id, { question: 'ما الأبعاد؟' }).missing.some((m) => m.question === 'ما الأبعاد؟'));
  assert.deepEqual(landing.getInsight(product.id).dismissed, ['ما الأبعاد؟']);
  assert.ok(landing.dismissQuestion(project.id, product.id, { question: 'ما الأبعاد؟', undo: true }).missing.some((m) => m.question === 'ما الأبعاد؟'));
  landing.dismissQuestion(project.id, product.id, { question: 'ما الأبعاد؟' });

  // تعديل يدوي لجواب محفوظ: كما كتبه التاجر، دون Claude، وسطر واحد للسؤال
  const calls = aiCalls.length;
  const exact = await landing.answerQuestion(project.id, product.id, { question: 'هل يسرّب الماء؟', exact: true, label: 'مانع للتسرب', value: 'نعم، حتى مقلوباً', feature: 'لا يسرّب حتى وهو مقلوب في الحقيبة' });
  assert.equal(aiCalls.length, calls);
  assert.equal(exact.product.specs.filter((x) => x.q === 'هل يسرّب الماء؟').length, 1);
  assert.equal(exact.product.specs.find((x) => x.q).value, 'نعم، حتى مقلوباً');
  assert.equal(exact.product.specs.find((x) => x.q).feature, 'لا يسرّب حتى وهو مقلوب في الحقيبة');

  // صفحة الهبوط: أجوبة التاجر خصائص مؤكدة في معطيات النصوص وخطة الصور، وفي وصف كل صورة
  await landing.generateLanding(project.id, { product_id: product.id, angle: 'مشروب دافئ حتى الاستراحة' });
  const pair = aiCalls.slice(-2);
  const sent = pair.find((c) => c.output_config.format.schema.required.includes('hero'));
  const plan = pair.find((c) => c !== sent);
  const fact = [{ label: 'مانع للتسرب', value: 'نعم، حتى مقلوباً', feature: 'لا يسرّب حتى وهو مقلوب في الحقيبة' }];
  assert.deepEqual(facts(sent).product.owner_facts, fact);
  assert.deepEqual(facts(plan).product.owner_facts, fact);
  assert.equal(facts(sent).product.answered_questions, undefined);
  assert.match(sent.system, /لا تحوّلها إلى أسئلة شائعة/);
  assert.match(sent.messages[0].content.at(-1).text, /<task>[\s\S]*owner_facts في النقاط والفوائد لا في الأسئلة الشائعة/);
  assert.match(plan.messages[0].content.at(-1).text, /كل خاصية في product\.owner_facts تخدم الزاوية تظهر في صورة على الأقل/);
  const shot = landing.visualPrompt(getProduct(product.id), { kind: 'benefits', scene: 'Centered.', headline: 'كل ما يحتاجه', points: ['مانع للتسرب'], with_text: true }, { layout: 'problem' });
  assert.match(shot, /Confirmed product features from the store owner[^\n]*مانع للتسرب: نعم، حتى مقلوباً/);

  // «حدّث الزوايا بالأجوبة»: Claude يعرف ما أُجيب عنه وما قيل إنه لا يهم، ولا يعيد طرحهما
  await landing.analyzeProduct(project.id, product.id, { fresh: true });
  const again = facts(aiCalls.at(-1));
  assert.deepEqual(again.product.owner_facts, fact);
  assert.deepEqual(again.dismissed_questions, ['ما الأبعاد؟']);
  const after = landing.getInsight(product.id);
  assert.deepEqual(after.dismissed, ['ما الأبعاد؟'], 'dismissed questions survive a re-analysis');
  assert.equal(after.fresh_answers, 0);
  assert.deepEqual(after.missing.map((m) => m.question), ['ما العمر المناسب؟'], 'answered and dismissed questions stay closed');

  // النشر في صفحة المنتج: الوصف الحي من Shopify + سطر المواصفات + سطر في «المميزات»، والباقي كما هو.
  // نسخة قديمة من نفس الجواب في «أسئلة شائعة» (كان الـ ERP ينشرها هناك) تُحذف، وسؤال شائع آخر يبقى
  setSetting('shopify_shop', 'insight-test.myshopify.com', project.id);
  setSetting('shopify_access_token', 'shpat_test', project.id);
  db.prepare("UPDATE products SET shopify_id = 'gid://shopify/Product/77' WHERE id = ?").run(product.id);
  liveHtml = liveHtml.replace('سعته 320 مل.</p>', 'سعته 320 مل.</p><p><strong>هل يسرّب الماء؟</strong> نعم، الغطاء والمصاصة مضادان لتسرب الماء.</p>');
  assert.equal(landing.getInsight(product.id).answered[0].on_store, false);
  const pub = await products.publishAnswers(product.id);
  assert.equal(shopUpdates.length, 1);
  assert.deepEqual(Object.keys(shopUpdates[0]).sort(), ['descriptionHtml', 'id'], 'only the description is sent');
  assert.match(liveHtml, /<tr><th>مانع للتسرب<\/th><td>نعم، حتى مقلوباً<\/td><\/tr><\/table>/);
  assert.match(liveHtml, /<th>السعة<\/th>\n<td>320 مل<\/td>/, 'the rest of the table untouched');
  assert.match(liveHtml, /<h3>المميزات<\/h3><ul><li>حزام<\/li><li data-erp-q="[0-9a-z]+">لا يسرّب حتى وهو مقلوب في الحقيبة<\/li><\/ul>/);
  assert.doesNotMatch(liveHtml, /هل يسرّب الماء؟/, 'the old FAQ copy is gone');
  assert.match(liveHtml, /<h3>أسئلة شائعة<\/h3><p><strong>ما سعة الترمس؟<\/strong> سعته 320 مل\.<\/p><h3>الطلب والتوصيل<\/h3>/, 'other FAQ untouched');
  assert.equal(pub.description_html, liveHtml, 'the ERP card and the store page match');
  assert.equal(landing.getInsight(product.id).answered[0].on_store, true);
  // مرة ثانية: لا تغيير، ولا كتابة في المتجر
  assert.equal((await products.publishAnswers(product.id)).changed, false);
  assert.equal(shopUpdates.length, 1);
  // تعديل الميزة لاحقاً: نفس السطر يُستبدل، لا يتكرر
  await landing.answerQuestion(project.id, product.id, { question: 'هل يسرّب الماء؟', exact: true, label: 'مانع للتسرب', value: 'نعم، حتى مقلوباً', feature: 'مضاد للتسرب حتى وهو مقلوب' });
  await products.publishAnswers(product.id);
  assert.equal((liveHtml.match(/data-erp-q=/g) || []).length, 1);
  assert.match(liveHtml, /<li data-erp-q="[0-9a-z]+">مضاد للتسرب حتى وهو مقلوب<\/li>/);

  // SEO بالذكاء الاصطناعي يقترح جدولاً جديداً: جواب التاجر يبقى ويغلب سطر Claude بنفس الاسم
  const seo = products.applySeo(product.id, { title: 'ترمس أطفال 320 مل', specs: [{ label: 'مانع للتسرب', value: 'اقتراح Claude' }, { label: 'السعة', value: '320 مل' }] });
  assert.equal(seo.specs.find((x) => x.label === 'مانع للتسرب').value, 'نعم، حتى مقلوباً');
  assert.equal(seo.specs.find((x) => x.label === 'مانع للتسرب').feature, 'مضاد للتسرب حتى وهو مقلوب');
  assert.ok(seo.specs.some((x) => x.label === 'السعة'));
  assert.equal(seo.specs.filter((x) => x.label === 'مانع للتسرب').length, 1);
});

test('old answers published as FAQ: worded as features once by Claude, then moved from the FAQ to «المميزات» on the next publish', async () => {
  const old = createProduct(project.id, { title: 'ترمس قديم', handle: 'thermos-old', price: 2900, stock: 5 });
  // كما في المتجر قبل هذا التحديث: الجواب سطر مواصفات + سؤال شائع، بلا ميزة
  updateProduct(old.id, { specs: [{ label: 'السعة', value: '320 مل' }, { label: 'مدة حفظ الحرارة', value: 'أكثر من ثلاث ساعات', q: 'كم يحفظ الماء باردا أو دافئا؟', faq: 'يحفظ حرارة المشروب أكثر من ثلاث ساعات.', source: 'owner', at: '2026-10-28T18:06:00Z' }] });
  db.prepare("UPDATE products SET shopify_id = 'gid://shopify/Product/78' WHERE id = ?").run(old.id);
  liveHtml = '<h2>ترمس</h2><h3>المواصفات</h3><table><tr><th>مدة حفظ الحرارة</th><td>أكثر من ثلاث ساعات</td></tr></table><h3>أسئلة شائعة</h3><p><strong>كم يحفظ الماء باردا أو دافئا؟</strong> يحفظ حرارة المشروب أكثر من ثلاث ساعات.</p><h3>الطلب والتوصيل</h3><p>COD</p>';
  featuresReply = { items: [{ i: 0, feature: 'مشروبه دافئ أكثر من ثلاث ساعات' }, { i: 9, feature: 'خارج القائمة' }] };
  const before = aiCalls.length;
  const pub = await products.publishAnswers(old.id);
  assert.equal(aiCalls.length, before + 1, 'one call for all old answers');
  const ask = aiCalls.at(-1);
  assert.match(ask.system, /ممنوع إضافة أي معلومة/);
  assert.deepEqual(JSON.parse(ask.messages[0].content.at(-1).text).answers, [{ i: 0, question: 'كم يحفظ الماء باردا أو دافئا؟', label: 'مدة حفظ الحرارة', value: 'أكثر من ثلاث ساعات', answer: 'يحفظ حرارة المشروب أكثر من ثلاث ساعات.' }]);
  assert.equal(getProduct(old.id).specs.find((x) => x.q).feature, 'مشروبه دافئ أكثر من ثلاث ساعات', 'saved on the product card');
  assert.equal(liveHtml, '<h2>ترمس</h2><h3>المواصفات</h3><table><tr><th>مدة حفظ الحرارة</th><td>أكثر من ثلاث ساعات</td></tr></table><h3>المميزات</h3><ul><li data-erp-q="' + /data-erp-q="([0-9a-z]+)"/.exec(liveHtml)[1] + '">مشروبه دافئ أكثر من ثلاث ساعات</li></ul><h3>الطلب والتوصيل</h3><p>COD</p>', 'FAQ copy removed with its empty heading; feature added before ordering info');
  assert.equal(pub.description_html, liveHtml);
  // بعد ذلك: لا صياغة جديدة ولا كتابة
  assert.equal((await products.publishAnswers(old.id)).changed, false);
  assert.equal(aiCalls.length, before + 1);
});

test('description merge: spec row and feature line replaced in place, FAQ copies removed, missing sections created before ordering info, idempotent', () => {
  const a = [{ label: 'العمر المناسب', value: 'من 3 إلى 8 سنوات', q: 'ما العمر المناسب؟', feature: 'مناسب لطفل من 3 إلى 8 سنوات' }];
  const bare = mergeAnswers('<p>وصف</p><h3>الطلب والتوصيل</h3><p>COD</p>', a);
  const mark = /data-erp-q="([0-9a-z]+)"/.exec(bare)[1];
  assert.equal(bare, `<p>وصف</p><h3>المواصفات</h3><table><tr><th>العمر المناسب</th><td>من 3 إلى 8 سنوات</td></tr></table><h3>المميزات</h3><ul><li data-erp-q="${mark}">مناسب لطفل من 3 إلى 8 سنوات</li></ul><h3>الطلب والتوصيل</h3><p>COD</p>`);
  assert.equal(mergeAnswers(bare, a), bare);
  const changed = mergeAnswers(bare, [{ ...a[0], value: 'من سنتين ونصف', feature: 'مناسب من سنتين ونصف' }]);
  assert.equal((changed.match(/<th>العمر المناسب<\/th>/g) || []).length, 1, 'row replaced, not duplicated');
  assert.equal((changed.match(/<li /g) || []).length, 1, 'feature replaced, not duplicated');
  assert.match(changed, /<li data-erp-q="[0-9a-z]+">مناسب من سنتين ونصف<\/li>/);
  // ميزة كتبها التاجر بنفسه في الوصف بنفس النص: لا تُكرَّر
  assert.equal(mergeAnswers('<h3>المميزات</h3><ul><li>مناسب لطفل من 3 إلى 8 سنوات</li></ul>', a).match(/<li/g).length, 1);
  // دون صياغة: «الخاصية: القيمة»
  assert.match(mergeAnswers('', [{ label: 'العمر', value: '3 سنوات', q: 'س؟' }]), /<li data-erp-q="[0-9a-z]+">العمر: 3 سنوات<\/li>/);
  // سؤال شائع نشره الـ ERP سابقاً لنفس السؤال يُحذف، والباقي يبقى
  const faq = mergeAnswers('<h3>أسئلة شائعة</h3><p><strong>ما العمر المناسب؟</strong> من 3 سنوات.</p><p><strong>هل الدفع عند الاستلام؟</strong> نعم.</p>', a);
  assert.doesNotMatch(faq, /ما العمر المناسب؟/);
  assert.match(faq, /<h3>المميزات<\/h3><ul>[\s\S]*<\/ul><h3>أسئلة شائعة<\/h3><p><strong>هل الدفع عند الاستلام؟<\/strong> نعم\.<\/p>$/);
  assert.match(mergeAnswers('', [{ label: 'x', value: '<b>', q: 'س؟', feature: 'a & b' }]), /<td>&lt;b&gt;<\/td>.*>a &amp; b<\/li>/, 'escaped');
});

test('migration 12: a database from the previous schema gets the insights table, its data intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-mig-'));
  const file = path.join(dir, 'erp.db');
  const old = openDb(file);
  // قاعدة بآخر مخطط قبل هذا التحديث (11): بلا جدول التحليل، وفيها مشروع ومنتج
  old.exec('DROP TABLE product_insights');
  old.prepare('UPDATE schema_version SET version = 11').run();
  const pid = old.prepare("INSERT INTO projects (slug, name) VALUES ('old', 'Old')").run().lastInsertRowid;
  old.prepare("INSERT INTO products (project_id, title, price) VALUES (?, 'قديم', 1000)").run(pid);
  old.close();
  const next = openDb(file);
  assert.equal(next.prepare('SELECT version FROM schema_version').get().version, 12);
  assert.ok(next.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'product_insights'").get());
  assert.equal(next.prepare('SELECT title FROM products').get().title, 'قديم');
  next.close();
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'product_insights'").get());
});
