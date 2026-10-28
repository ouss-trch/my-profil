import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, openDb } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { createProject } from '../server/services/projects.js';
import { createProduct, updateProduct } from '../server/services/products.js';
import * as landing from '../server/services/landing.js';

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
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('http://anthropic.test')) throw new Error(`unexpected ${url}`);
  const body = JSON.parse(init.body);
  aiCalls.push(body);
  const req = body.output_config.format.schema.required;
  const out = req.includes('angles') ? insight : req.includes('hero') ? copy : { compare: { heading: 'بدونه / معه', without_label: 'بدونه', with_label: 'معه', without: ['يبرد'], with: ['يبقى دافئاً'] }, visuals: [{ kind: 'hero', framing: 'close', headline: 'دافئ حتى الاستراحة', points: ['320 مل'], scene: 'On a school desk.' }] };
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
  assert.deepEqual(out.missing, ['مدة حفظ الحرارة بالساعات']);
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
