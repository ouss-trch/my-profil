import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db/index.js';
import { setSetting } from '../server/lib/settings.js';
import { dzDay } from '../server/lib/util.js';
import { createProject } from '../server/services/projects.js';
import { claudeUsd, geminiUsd, openaiImageUsd } from '../server/lib/apiPrices.js';

const p = createProject({ name: 'Cost shop', domain: 'cost.example' });
const other = createProject({ name: 'Other shop', domain: 'other.example' });
const today = dzDay();

// Claude وGemini وهميان: نفس شكل الردود الحقيقية (usage / usageMetadata)
let claudeModel = 'claude-opus-5-5';
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('http://anthropic.test')) {
    return json({ id: 'msg_1', type: 'message', role: 'assistant', model: claudeModel, content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: { input_tokens: 10000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  }
  if (u.includes('generativelanguage.googleapis.com')) {
    return json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('png').toString('base64') } }] } }],
      usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] },
    });
  }
  throw new Error(`unexpected fetch ${u}`);
};
process.env.ANTHROPIC_BASE_URL = 'http://anthropic.test';
setSetting('anthropic_api_key', 'sk-test-cost');
setSetting('image_provider', 'gemini');
setSetting('gemini_api_key', 'g-test');
setSetting('fx_usd_dza', 250);
const ai = await import('../server/integrations/ai.js');
const { generateImages } = await import('../server/integrations/images.js');
const { stats } = await import('../server/services/analytics.js');

test('api prices: official per-token prices, the model actually served, and per-image fallbacks', () => {
  assert.equal(claudeUsd('claude-opus-5-5', { input_tokens: 10000, output_tokens: 3000 }), 0.1);
  assert.equal(claudeUsd('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 12);
  assert.equal(claudeUsd('claude-opus-5-5-20261101', { input_tokens: 1e6 }), 4, 'a dated id uses its family price');
  assert.equal(claudeUsd('claude-haiku-5-5', { input_tokens: 200000 }), 0.1, 'Haiku above 100K tokens: higher tier');
  assert.equal(claudeUsd('claude-opus-5-5', { cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6 }), 5.2);
  assert.equal(geminiUsd('gemini-nano-banana-2.1', null, 2), 0.0672);
  assert.ok(Math.abs(openaiImageUsd('gpt-image-1', { input_tokens: 600, input_tokens_details: { text_tokens: 100, image_tokens: 500 }, output_tokens: 1056 }) - 0.04774) < 1e-9);
});

test('api cost ledger: every Claude call and generated image is recorded, then counted in finance and profit', async () => {
  await ai.structured({ system: 's', prompt: 'p', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, meter: { projectId: p.id, kind: 'landing' } });
  claudeModel = 'claude-sonnet-5-5'; // نموذج احتياطي خدم الطلب: يُحسب بسعره هو
  await ai.text({ system: 's', prompt: 'p', meter: { projectId: p.id, kind: 'seo' } });
  await ai.text({ system: 's', prompt: 'p', meter: { projectId: null, kind: 'assistant' } });
  await generateImages(p.id, { prompt: 'x', count: 1, aspect: '4:5', kind: 'landing_image' });
  const rows = db.prepare('SELECT provider, model, kind, project_id, images, cost_usd FROM api_usage ORDER BY id').all();
  assert.deepEqual(
    rows.map((r) => [r.provider, r.model, r.kind, r.project_id, r.images, r.cost_usd]),
    [
      ['anthropic', 'claude-opus-5-5', 'landing', p.id, 0, 0.1],
      ['anthropic', 'claude-sonnet-5-5', 'seo', p.id, 0, 0.05],
      ['anthropic', 'claude-sonnet-5-5', 'assistant', null, 0, 0.05],
      ['gemini', 'gemini-nano-banana-2.1', 'landing_image', p.id, 1, 0.03585],
    ],
  );
  // مشروع واحد: طلباته فقط ($0.18585 × 250 ≈ 46 دج). كل المشاريع: + طلبات «كل المشاريع»
  const one = stats([p.id], today, today);
  assert.equal(one.finance.api_cost, 46);
  assert.equal(one.api_costs.rows.length, 3);
  const all = stats([p.id, other.id], today, today);
  assert.equal(all.finance.api_cost, 59);
  assert.equal(all.finance.profit, -59, 'no revenue yet: the API cost is the loss');
  assert.equal(stats([other.id], today, today).finance.api_cost, 0);
});
