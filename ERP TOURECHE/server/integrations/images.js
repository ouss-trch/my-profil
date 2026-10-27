import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getSetting } from '../lib/settings.js';
import { request, IntegrationError } from '../lib/http.js';
import { randomId } from '../lib/util.js';
import { recordGemini, recordOpenAIImage } from '../services/apiCost.js';

/**
 * توليد صور الإعلانات والمنتجات. المزوّد يُختار من الإعدادات:
 *  - n8n: يرسل {prompt, source_images, size, product} إلى webhook ويتوقع {images:[{url}|{base64, mime}]}
 *         (يسمح باستعمال سير العمل الموجودة لديك مثل dresse-Image-Generator)
 *  - openai: gpt-image-1 (تعديل صورة المنتج الأصلية أو توليد من نص)
 *  - gemini: نماذج Gemini للصور (تعديل/توليد)
 * الصور تُحفظ في data/uploads/<project>/ وتُعرض للمستخدمين المسجلين فقط.
 */
export const imageProvider = () => getSetting('image_provider') || 'none';

function save(projectId, buffer, ext = 'png') {
  const dir = path.join(config.uploadsDir, String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${randomId(6)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return { file: `${projectId}/${name}`, url: `/uploads/${projectId}/${name}` };
}

/** مسار ملف محلي من رابط /uploads/… — null إن خرج عن مجلد الصور (مثل /uploads/../.secret-key) */
export function uploadPath(url) {
  if (!String(url || '').startsWith('/uploads/')) return null;
  const file = path.resolve(config.uploadsDir, url.slice('/uploads/'.length));
  return file.startsWith(path.resolve(config.uploadsDir) + path.sep) ? file : null;
}

async function fetchImage(url) {
  if (url.startsWith('/uploads/')) {
    const file = uploadPath(url);
    if (!file) throw new IntegrationError('images', 'invalid', 'bad_path');
    return { buffer: fs.readFileSync(file), mime: file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : file.endsWith('.webp') ? 'image/webp' : 'image/png' };
  }
  // روابط عامة فقط: لا يُستعمل الخادم لطلب عناوين داخلية (n8n، شبكة Docker…)
  if (!/^https:\/\//i.test(url)) throw new IntegrationError('images', 'invalid', 'bad_path');
  const res = await request('images', url, { raw: true, timeoutMs: 60000 });
  if (!res.ok) throw new IntegrationError('images', 'invalid', `source_image_${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' };
}

// النسبة المطلوبة (4:5 لصور صفحات الهبوط) → أقرب مقاس يقبله gpt-image
const OPENAI_SIZE = { '1:1': '1024x1024', '4:5': '1024x1536', '2:3': '1024x1536', '3:4': '1024x1536', '9:16': '1024x1536', '16:9': '1536x1024', '3:2': '1536x1024' };

/**
 * أخطاء Gemini بلغة التاجر (المصدر: ai.google.dev/gemini-api/docs/billing و rate-limits):
 *  - free_tier + limit 0: مشروع المفتاح على الطبقة المجانية، ونماذج الصور غير متاحة فيها. الحدود للمشروع لا للمفتاح،
 *    والطبقة المدفوعة تحتاج ربط الفوترة + رصيد Prepay (5$ على الأقل؛ رصيد تجربة Google Cloud لا يُقبل).
 *  - PerDay: حصة اليوم انتهت (تتجدد منتصف الليل بتوقيت المحيط الهادئ). غير ذلك: حد الدقيقة، ينتهي بعد retryDelay.
 */
export function geminiError(e, model) {
  const body = e?.details?.data?.error;
  if (!body) return e;
  const status = e.details.status;
  const text = JSON.stringify(body);
  const retry = (body.details || []).find((d) => /RetryInfo/.test(d['@type'] || ''))?.retryDelay;
  const seconds = retry ? Math.ceil(parseFloat(retry)) : null;
  if (status === 429 || body.status === 'RESOURCE_EXHAUSTED') {
    if (/free_tier|FreeTier|limit: 0\b/.test(text)) return new IntegrationError('gemini', 'config', 'gemini_free_tier', { model });
    if (/prepa(y|id)|credit balance|insufficient/i.test(text)) return new IntegrationError('gemini', 'config', 'gemini_no_credit', { model });
    if (/PerDay|per.?day|daily/i.test(text)) return new IntegrationError('gemini', 'rate_limit', 'gemini_daily_quota', { model });
    return new IntegrationError('gemini', 'rate_limit', `gemini_rate_limit:${seconds || 60}`, { model, retry_seconds: seconds });
  }
  if (/API_KEY_INVALID|API key not valid/i.test(text)) return new IntegrationError('gemini', 'config', 'gemini_key_invalid');
  if (status === 403) return new IntegrationError('gemini', 'config', 'gemini_key_refused');
  if (status === 404) return new IntegrationError('gemini', 'config', `gemini_model_not_found:${model}`);
  return e;
}

export async function generateImages(projectId, { prompt, sourceUrls = [], count = 1, size = '1024x1024', aspect = null, product = null, kind = 'image' }) {
  if (aspect && OPENAI_SIZE[aspect]) size = OPENAI_SIZE[aspect];
  const provider = imageProvider();
  if (provider === 'none') throw new IntegrationError('images', 'config', 'image_provider_not_configured');
  const results = [];

  if (provider === 'n8n') {
    const url = getSetting('n8n_image_url');
    if (!url) throw new IntegrationError('images', 'config', 'n8n_image_url_missing');
    const { data } = await request('n8n', url, { method: 'POST', body: { prompt, source_images: sourceUrls.filter((u) => /^https?:/.test(u)), count, size, aspect, product }, timeoutMs: 300000, retries: 0 });
    for (const img of data?.images || (data?.url ? [data] : [])) {
      if (img.base64) results.push(save(projectId, Buffer.from(img.base64, 'base64'), (img.mime || '').includes('jpeg') ? 'jpg' : 'png'));
      else if (img.url) {
        const { buffer, mime } = await fetchImage(img.url);
        results.push(save(projectId, buffer, mime.includes('jpeg') ? 'jpg' : 'png'));
      }
    }
  }

  if (provider === 'openai') {
    const key = getSetting('openai_api_key');
    if (!key) throw new IntegrationError('images', 'config', 'openai_key_missing');
    const model = getSetting('openai_image_model') || 'gpt-image-1';
    let data;
    if (sourceUrls.length) {
      const form = new FormData();
      form.set('model', model);
      form.set('prompt', prompt);
      form.set('size', size);
      form.set('n', String(count));
      for (const [i, u] of sourceUrls.slice(0, 4).entries()) {
        const { buffer, mime } = await fetchImage(u);
        form.append('image[]', new Blob([buffer], { type: mime }), `source-${i}.${mime.includes('png') ? 'png' : 'jpg'}`);
      }
      ({ data } = await request('openai', 'https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, timeoutMs: 300000, retries: 0 }));
    } else {
      ({ data } = await request('openai', 'https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: { model, prompt, size, n: count },
        timeoutMs: 300000,
        retries: 0,
      }));
    }
    const made = (data?.data || []).filter((img) => img.b64_json);
    recordOpenAIImage(model, data?.usage, made.length || count, { projectId, kind });
    for (const img of made) results.push(save(projectId, Buffer.from(img.b64_json, 'base64'), 'png'));
  }

  if (provider === 'gemini') {
    const key = getSetting('gemini_api_key');
    if (!key) throw new IntegrationError('images', 'config', 'gemini_key_missing');
    const model = getSetting('gemini_image_model') || 'gemini-nano-banana-2.1';
    // صور المرجع أولاً ثم التعليمات (توصية Google لتعديل الصور والحفاظ على شكل المنتج)
    const parts = [];
    for (const u of sourceUrls.slice(0, 4)) {
      const { buffer, mime } = await fetchImage(u);
      parts.push({ inline_data: { mime_type: mime, data: buffer.toString('base64') } });
    }
    parts.push({ text: prompt });
    const generationConfig = { responseModalities: ['IMAGE'], ...(aspect ? { imageConfig: { aspectRatio: aspect, imageSize: '1K' } } : {}) };
    const call = () =>
      request('gemini', `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key },
        body: { contents: [{ parts }], generationConfig },
        timeoutMs: 300000,
        retries: 0,
      }).catch((e) => Promise.reject(geminiError(e, model)));
    for (let i = 0; i < count; i++) {
      // حد الدقيقة وحده يزول بالانتظار: محاولة ثانية واحدة بعد المدة التي يطلبها Google (إن كانت قصيرة)
      const { data } = await call().catch(async (e) => {
        const wait = e.details?.retry_seconds;
        if (!/^gemini_rate_limit/.test(e.message.replace(/^gemini: /, '')) || !wait || wait > 40) throw e;
        await new Promise((r) => setTimeout(r, wait * 1000));
        return call();
      });
      const before = results.length;
      for (const p of data?.candidates?.[0]?.content?.parts || []) {
        const inline = p.inlineData || p.inline_data;
        if (inline?.data) results.push(save(projectId, Buffer.from(inline.data, 'base64'), (inline.mimeType || inline.mime_type || '').includes('jpeg') ? 'jpg' : 'png'));
      }
      recordGemini(model, data?.usageMetadata, results.length - before, { projectId, kind });
    }
  }

  if (!results.length) throw new IntegrationError('images', 'invalid', 'no_image_returned');
  return results;
}

export function readUpload(relPath) {
  const file = path.resolve(config.uploadsDir, relPath);
  if (!file.startsWith(path.resolve(config.uploadsDir) + path.sep)) throw new IntegrationError('images', 'invalid', 'bad_path');
  return fs.readFileSync(file);
}

export function saveUpload(projectId, buffer, ext) {
  return save(projectId, buffer, ext);
}
