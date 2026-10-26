import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { getSetting } from '../lib/settings.js';
import { IntegrationError } from '../lib/http.js';

/**
 * Claude داخل الـ ERP: توليد SEO للمنتجات، نصوص الإعلانات، الملخص اليومي، والمساعد الذكي (services/assistant.js).
 * النموذج الافتراضي claude-opus-5-5 مع fallbacks:"default" (إعادة المحاولة تلقائياً على نموذج آخر عند الرفض).
 */
let cachedClient = null;
let cachedKey = null;

export function aiConfigured() {
  return Boolean(getSetting('anthropic_api_key') || config.anthropicApiKey);
}

export function client() {
  const key = getSetting('anthropic_api_key') || config.anthropicApiKey;
  if (!key) throw new IntegrationError('ai', 'config', 'anthropic_key_missing');
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new Anthropic({ apiKey: key, maxRetries: 2 });
    cachedKey = key;
  }
  return cachedClient;
}

export const model = () => getSetting('ai_model') || 'claude-opus-5-5';
const supportsFallback = (m) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(m);

/** معاملات مشتركة لكل طلب */
export function baseParams({ effort, maxTokens = 16000 } = {}) {
  const m = model();
  return {
    model: m,
    max_tokens: maxTokens,
    output_config: { effort: effort || getSetting('ai_effort') || 'medium' },
    ...(supportsFallback(m) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  };
}

export function textOf(message) {
  return (message.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function translateError(e) {
  if (e instanceof Anthropic.AuthenticationError) return new IntegrationError('ai', 'auth', 'anthropic_auth_failed');
  if (e instanceof Anthropic.RateLimitError) return new IntegrationError('ai', 'rate_limit', 'anthropic_rate_limited');
  if (e instanceof Anthropic.NotFoundError) return new IntegrationError('ai', 'config', 'ai_model_not_found');
  if (e instanceof Anthropic.BadRequestError) return new IntegrationError('ai', 'invalid', e.message);
  if (e instanceof Anthropic.APIConnectionError) return new IntegrationError('ai', 'network', 'network_unreachable');
  if (e instanceof Anthropic.APIError) return new IntegrationError('ai', 'server', e.message);
  return e;
}

/** طلب واحد يعيد JSON مطابقاً للمخطط (Structured Outputs) */
export async function structured({ system, prompt, schema, effort = 'medium', maxTokens = 16000, images = [] }) {
  const content = [
    ...images.map((img) => (img.url ? { type: 'image', source: { type: 'url', url: img.url } } : { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text: prompt },
  ];
  let res;
  try {
    res = await client().beta.messages.create({
      ...baseParams({ effort, maxTokens }),
      system,
      messages: [{ role: 'user', content }],
      output_config: { ...baseParams({ effort }).output_config, format: { type: 'json_schema', schema } },
    });
  } catch (e) {
    throw translateError(e);
  }
  if (res.stop_reason === 'refusal') throw new IntegrationError('ai', 'invalid', 'ai_refused');
  if (res.stop_reason === 'max_tokens') throw new IntegrationError('ai', 'invalid', 'ai_output_truncated');
  try {
    return JSON.parse(textOf(res));
  } catch {
    throw new IntegrationError('ai', 'invalid', 'ai_bad_json');
  }
}

/** نص حر قصير (ملخصات، تقارير) */
export async function text({ system, prompt, effort = 'low', maxTokens = 8000 }) {
  try {
    const res = await client().beta.messages.create({ ...baseParams({ effort, maxTokens }), system, messages: [{ role: 'user', content: prompt }] });
    if (res.stop_reason === 'refusal') throw new IntegrationError('ai', 'invalid', 'ai_refused');
    return textOf(res);
  } catch (e) {
    throw translateError(e);
  }
}

export async function createMessage(params) {
  try {
    return await client().beta.messages.create(params);
  } catch (e) {
    throw translateError(e);
  }
}

// ——— مخططات JSON ———
const str = { type: 'string' };
const strArr = { type: 'array', items: { type: 'string' } };

export const SEO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'focus_keyword', 'seo_title', 'seo_description', 'handle', 'product_type', 'tags', 'description_html', 'image_alts', 'specs', 'faq', 'collections_hint', 'notes'],
  properties: {
    title: str,
    focus_keyword: str,
    seo_title: str,
    seo_description: str,
    handle: str,
    product_type: str,
    tags: strArr,
    description_html: str,
    image_alts: strArr,
    specs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: str, value: str } } },
    faq: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { q: str, a: str } } },
    collections_hint: strArr,
    notes: str,
  },
};

export const AD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['angles', 'variants', 'image_prompts', 'audience'],
  properties: {
    angles: strArr,
    audience: str,
    variants: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['angle', 'language', 'primary_text', 'headline', 'description'],
        properties: { angle: str, language: str, primary_text: str, headline: str, description: str },
      },
    },
    image_prompts: strArr,
  },
};
