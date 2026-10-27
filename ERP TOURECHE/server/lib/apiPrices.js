/**
 * الأسعار الرسمية بالدولار لكل مليون رمز (أكتوبر 2026):
 *  - Claude: وثائق Anthropic (models): Opus 5.5 ‏4/20، Sonnet 5.5 ‏2/10، Haiku 5.5 ‏0.10/0.50 (فوق 100 ألف رمز: 0.50/2.50)، Fable 5.1 ‏10/50.
 *    قراءة الذاكرة المؤقتة بسعرها، والكتابة فيها 1.25 × سعر الإدخال (TTL خمس دقائق).
 *  - Gemini Nano Banana 2.1: ai.google.dev/gemini-api/docs/pricing — إدخال 1.50، إخراج نص 7.50، إخراج صور 30 (صورة 1K = 1120 رمزاً ≈ 0.0336$).
 *  - gpt-image-1: developers.openai.com — إدخال نص 5، إدخال صور 10، إخراج صور 40.
 * نموذج غير معروف يُحسب بسعر أقرب عائلة (opus/sonnet/haiku/fable)، فلا يضيع مصروف لأن Anthropic أضافت إصداراً.
 */
export const CLAUDE = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, over: { tokens: 100000, in: 0.5, out: 2.5, cacheRead: 0.05 } },
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25 },
  'claude-fable-5': { in: 10, out: 50, cacheRead: 1 },
};
const FAMILY = [
  [/opus/, 'claude-opus-5-5'],
  [/sonnet/, 'claude-sonnet-5-5'],
  [/haiku/, 'claude-haiku-5-5'],
  [/fable|mythos/, 'claude-fable-5-1'],
];
export const GEMINI = {
  'gemini-nano-banana-2.1': { in: 1.5, outText: 7.5, outImage: 30, tokensPer1k: 1120 },
};
export const OPENAI_IMAGE = {
  'gpt-image-1': { inText: 5, inImage: 10, outImage: 40, tokensPer1k: 1056 },
};

const claudePrice = (model) => {
  const m = String(model || '').toLowerCase();
  if (CLAUDE[m]) return CLAUDE[m];
  const base = Object.keys(CLAUDE).find((k) => m.startsWith(k));
  if (base) return CLAUDE[base];
  return CLAUDE[FAMILY.find(([re]) => re.test(m))?.[1] || 'claude-opus-5-5'];
};

/** كلفة طلب Claude من usage كما يرجعه الـ API (الإدخال لا يشمل رموز الذاكرة المؤقتة: لها حقولها) */
export function claudeUsd(model, u = {}) {
  let p = claudePrice(model);
  const input = u.input_tokens || 0;
  if (p.over && input + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) > p.over.tokens) p = p.over;
  return (input * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.cacheRead + (u.cache_creation_input_tokens || 0) * p.in * 1.25) / 1e6;
}

/** كلفة طلب صورة Gemini من usageMetadata؛ دونه: سعر الصورة 1K */
export function geminiUsd(model, meta, images = 1) {
  const p = GEMINI[model] || GEMINI['gemini-nano-banana-2.1'];
  if (!meta) return (images * p.tokensPer1k * p.outImage) / 1e6;
  const details = meta.candidatesTokensDetails || [];
  const imageOut = details.length ? details.filter((d) => d.modality === 'IMAGE').reduce((s, d) => s + (d.tokenCount || 0), 0) : meta.candidatesTokenCount || 0;
  const textOut = Math.max(0, (meta.candidatesTokenCount || 0) - imageOut) + (meta.thoughtsTokenCount || 0);
  return ((meta.promptTokenCount || 0) * p.in + imageOut * p.outImage + textOut * p.outText) / 1e6;
}

/** كلفة صور OpenAI من usage؛ دونه: تقدير بصورة 1024² متوسطة الجودة */
export function openaiImageUsd(model, u, images = 1) {
  const p = OPENAI_IMAGE[model] || OPENAI_IMAGE['gpt-image-1'];
  if (!u) return (images * p.tokensPer1k * p.outImage) / 1e6;
  const d = u.input_tokens_details || {};
  const textIn = d.text_tokens ?? (d.image_tokens === undefined ? u.input_tokens || 0 : 0);
  return (textIn * p.inText + (d.image_tokens || 0) * p.inImage + (u.output_tokens || 0) * p.outImage) / 1e6;
}
