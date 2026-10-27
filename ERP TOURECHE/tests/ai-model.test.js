import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from '../server/db/index.js';
import { getSetting, setSetting } from '../server/lib/settings.js';
import * as ai from '../server/integrations/ai.js';

// قيمة محفوظة قبل القائمة المنسدلة، كما كتبها المالك يدوياً
const storeRaw = (v) =>
  db.prepare(`INSERT INTO settings (scope, key, value, is_secret, updated_at) VALUES ('global', 'ai_model', ?, 0, '') ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(v));

test('ai model: a hand-typed name is corrected, an unknown one falls back to the default', () => {
  storeRaw('claude-sonnet 5.5');
  assert.equal(getSetting('ai_model'), 'claude-sonnet-5-5');
  assert.equal(ai.baseParams().model, 'claude-sonnet-5-5');
  assert.equal(ai.baseParams().fallbacks, 'default');

  setSetting('ai_model', 'Claude Haiku 5.5');
  assert.equal(getSetting('ai_model'), 'claude-haiku-5-5');
  assert.equal(ai.baseParams().fallbacks, undefined); // لا fallback من الخادم لـ Haiku 5.5

  assert.throws(() => setSetting('ai_model', 'gpt-4o'), /invalid_value:ai_model/);
  storeRaw('claude-sonnet-9');
  assert.equal(getSetting('ai_model'), 'claude-opus-5-5');
});

test('ai model: a 404 from Claude reads as «model not found», not raw JSON', async () => {
  const srv = http.createServer((req, res) => {
    req.resume();
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-sonnet-9' } }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
  setSetting('anthropic_api_key', 'sk-test-404');
  try {
    await assert.rejects(ai.text({ system: 's', prompt: 'p', maxTokens: 1024 }), (e) => e.kind === 'config' && e.message === 'ai: ai_model_not_found');
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
    srv.close();
  }
});

test('ai: a schema Claude cannot compile reads as a clear ERP error, not raw JSON', async () => {
  const srv = http.createServer((req, res) => {
    req.resume();
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.' } }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
  setSetting('anthropic_api_key', 'sk-test-400');
  setSetting('ai_model', 'claude-opus-5-5');
  try {
    const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } };
    await assert.rejects(ai.structured({ system: 's', prompt: 'p', schema, maxTokens: 1024 }), (e) => e.kind === 'invalid' && e.message === 'ai: ai_schema_too_large');
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
    srv.close();
  }
});
