import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as landing from '../server/services/landing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const prompts = path.join(here, '..', 'server', 'prompts', 'landing');
const skill = path.join(here, '..', '..', '.claude', 'skills', 'cod-landing-page-builder');

test('craft: the builder and the cod-landing-page-builder skill read the same rule files (no drift)', () => {
  for (const [file, copy] of [
    ['angles.md', 'references/angles.md'],
    ['copy.md', 'references/copy.md'],
    ['visuals.md', 'references/visuals.md'],
    ['SOURCES.md', 'references/sources.md'],
  ]) {
    assert.equal(fs.readFileSync(path.join(skill, copy), 'utf8'), fs.readFileSync(path.join(prompts, file), 'utf8'), `${copy} differs from server/prompts/landing/${file}: copy the ERP file into the skill`);
  }
  const md = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
  const description = /^description: (.*)$/m.exec(md)[1];
  assert.match(md, /^name: cod-landing-page-builder$/m);
  assert.ok(description.length <= 1024, `skill description ${description.length} chars (claude.ai limit 1024)`);
});

test('craft: the system messages carry the craft, the rules and the method; owner answers are features, never FAQ', () => {
  const system = landing.landingSystem('SOU9NA');
  assert.ok(system.includes(landing.CRAFT.copy) && system.includes(landing.CRAFT.visuals), 'copy and visuals craft inside');
  assert.match(system, /<role>[\s\S]*<\/role>\s*<craft>[\s\S]*<\/craft>\s*<rules>[\s\S]*<\/rules>\s*<method>[\s\S]*<\/method>/);
  assert.match(system, /علامات الكتابة الآلية/);
  assert.match(system, /اختبار «الآن يمكنك…»/);
  assert.match(system, /لا تحوّلها إلى أسئلة شائعة/);
  assert.match(system, /خصائص المنتج \(product\.owner_facts وproduct_facts\) لا تُكتب أسئلةً شائعة/);
  assert.ok(landing.INSIGHT_SYSTEM.includes(landing.CRAFT.angles), 'angles craft in the analysis');
  assert.match(landing.INSIGHT_SYSTEM, /awareness/);
  assert.ok(landing.VISUAL_KINDS.includes('box'), 'what-you-receive image');
});
