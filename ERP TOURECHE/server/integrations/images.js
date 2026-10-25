import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getSetting } from '../lib/settings.js';
import { request, IntegrationError } from '../lib/http.js';
import { randomId } from '../lib/util.js';

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

async function fetchImage(url) {
  if (url.startsWith('/uploads/')) {
    const file = path.join(config.uploadsDir, url.replace('/uploads/', ''));
    if (!file.startsWith(config.uploadsDir)) throw new IntegrationError('images', 'invalid', 'bad_path');
    return { buffer: fs.readFileSync(file), mime: file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : file.endsWith('.webp') ? 'image/webp' : 'image/png' };
  }
  const res = await request('images', url, { raw: true, timeoutMs: 60000 });
  if (!res.ok) throw new IntegrationError('images', 'invalid', `source_image_${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' };
}

export async function generateImages(projectId, { prompt, sourceUrls = [], count = 1, size = '1024x1024', product = null }) {
  const provider = imageProvider();
  if (provider === 'none') throw new IntegrationError('images', 'config', 'image_provider_not_configured');
  const results = [];

  if (provider === 'n8n') {
    const url = getSetting('n8n_image_url');
    if (!url) throw new IntegrationError('images', 'config', 'n8n_image_url_missing');
    const { data } = await request('n8n', url, { method: 'POST', body: { prompt, source_images: sourceUrls.filter((u) => /^https?:/.test(u)), count, size, product }, timeoutMs: 300000, retries: 0 });
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
    for (const img of data?.data || []) if (img.b64_json) results.push(save(projectId, Buffer.from(img.b64_json, 'base64'), 'png'));
  }

  if (provider === 'gemini') {
    const key = getSetting('gemini_api_key');
    if (!key) throw new IntegrationError('images', 'config', 'gemini_key_missing');
    const model = getSetting('gemini_image_model') || 'gemini-2.5-flash-image';
    const parts = [{ text: prompt }];
    for (const u of sourceUrls.slice(0, 3)) {
      const { buffer, mime } = await fetchImage(u);
      parts.push({ inline_data: { mime_type: mime, data: buffer.toString('base64') } });
    }
    for (let i = 0; i < count; i++) {
      const { data } = await request('gemini', `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key },
        body: { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'] } },
        timeoutMs: 300000,
        retries: 0,
      });
      for (const p of data?.candidates?.[0]?.content?.parts || []) {
        const inline = p.inlineData || p.inline_data;
        if (inline?.data) results.push(save(projectId, Buffer.from(inline.data, 'base64'), (inline.mimeType || inline.mime_type || '').includes('jpeg') ? 'jpg' : 'png'));
      }
    }
  }

  if (!results.length) throw new IntegrationError('images', 'invalid', 'no_image_returned');
  return results;
}

export function readUpload(relPath) {
  const file = path.resolve(config.uploadsDir, relPath);
  if (!file.startsWith(config.uploadsDir + path.sep)) throw new IntegrationError('images', 'invalid', 'bad_path');
  return fs.readFileSync(file);
}

export function saveUpload(projectId, buffer, ext) {
  return save(projectId, buffer, ext);
}
