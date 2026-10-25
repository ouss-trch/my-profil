import { fold, stripHtml, slugify } from '../lib/util.js';

/**
 * تقييم SEO لصفحة المنتج قبل النشر (0–100) مع قائمة فحوص قابلة للتنفيذ.
 * مبني على قواعد seo-audit (coreyhaines31/marketingskills): عنوان 50–60 حرفاً بالكلمة المفتاحية في البداية،
 * وصف ميتا 150–160 حرفاً، H1 واحد (عنوان المنتج في القالب) ثم H2/H3، الكلمة المفتاحية في أول 100 كلمة،
 * نص بديل وصفي لكل صورة، رابط لاتيني قصير، محتوى عميق غير مكرر، دون حشو للكلمات.
 */
const has = (text, kw) => Boolean(kw) && fold(text).includes(fold(kw));
const words = (text) => stripHtml(text).split(/\s+/).filter(Boolean);

export function analyzeSeo(p, { otherSeoTitles = [], otherHandles = [] } = {}) {
  const kw = (p.focus_keyword || '').trim();
  const html = p.description_html || '';
  const body = stripHtml(html);
  const w = words(html);
  const first100 = w.slice(0, 100).join(' ');
  const images = Array.isArray(p.images) ? p.images : [];
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const seoTitle = (p.seo_title || '').trim();
  const seoDesc = (p.seo_description || '').trim();
  const handle = (p.handle || '').trim();
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  const headings = (html.match(/<h[23][\s>]/gi) || []).length;
  const kwCount = kw ? (fold(body).match(new RegExp(fold(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length : 0;
  const density = w.length ? (kwCount * Math.max(1, kw.split(/\s+/).length) * 100) / w.length : 0;

  const checks = [
    { key: 'focus_keyword', weight: 8, ok: kw.length >= 3, value: kw },
    { key: 'title_length', weight: 4, ok: p.title?.length >= 20 && p.title.length <= 80, value: p.title?.length || 0 },
    { key: 'seo_title_length', weight: 8, ok: seoTitle.length >= 35 && seoTitle.length <= 65, value: seoTitle.length },
    { key: 'kw_in_seo_title', weight: 8, ok: has(seoTitle, kw), value: null },
    { key: 'kw_at_title_start', weight: 3, ok: Boolean(kw) && fold(seoTitle).indexOf(fold(kw)) >= 0 && fold(seoTitle).indexOf(fold(kw)) <= 20, value: null },
    { key: 'seo_description_length', weight: 8, ok: seoDesc.length >= 120 && seoDesc.length <= 165, value: seoDesc.length },
    { key: 'kw_in_seo_description', weight: 5, ok: has(seoDesc, kw), value: null },
    { key: 'handle_clean', weight: 6, ok: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle) && handle.length <= 70, value: handle },
    { key: 'kw_in_handle', weight: 3, ok: Boolean(kw) && (handle.includes(slugify(kw)) || slugify(kw).split('-').filter((x) => x.length > 2).some((x) => handle.includes(x))), value: null },
    { key: 'kw_in_first_100_words', weight: 6, ok: has(first100, kw), value: null },
    { key: 'description_depth', weight: 8, ok: w.length >= 250, partial: w.length >= 150, value: w.length },
    { key: 'no_h1_in_description', weight: 3, ok: h1Count === 0, value: h1Count },
    { key: 'headings_structure', weight: 4, ok: headings >= 2, value: headings },
    { key: 'has_bullets', weight: 3, ok: /<li[\s>]/i.test(html), value: null },
    { key: 'has_specs', weight: 3, ok: /<table[\s>]/i.test(html) || (Array.isArray(p.specs) && p.specs.length >= 3), value: null },
    { key: 'has_faq', weight: 3, ok: /(أسئلة|faq|questions)/i.test(body), value: null },
    { key: 'keyword_density', weight: 3, ok: !kw || (density >= 0.3 && density <= 3.5), value: Math.round(density * 10) / 10 },
    { key: 'images_count', weight: 5, ok: images.length >= 4, partial: images.length >= 2, value: images.length },
    { key: 'images_alt', weight: 6, ok: images.length > 0 && images.every((i) => (i.alt || '').trim().length >= 8), value: images.filter((i) => (i.alt || '').trim().length >= 8).length },
    { key: 'kw_in_alt', weight: 2, ok: images.some((i) => has(i.alt, kw)), value: null },
    { key: 'unique_seo_title', weight: 4, ok: Boolean(seoTitle) && !otherSeoTitles.map(fold).includes(fold(seoTitle)), value: null },
    { key: 'unique_handle', weight: 3, ok: Boolean(handle) && !otherHandles.includes(handle), value: null },
    { key: 'product_type', weight: 2, ok: Boolean(p.product_type), value: p.product_type || '' },
    { key: 'tags', weight: 2, ok: tags.length >= 3 && tags.length <= 20, value: tags.length },
    { key: 'collection', weight: 4, ok: Array.isArray(p.collections) && p.collections.length > 0, value: (p.collections || []).length },
    { key: 'price_logic', weight: 2, ok: !p.compare_at_price || Number(p.compare_at_price) > Number(p.price), value: null },
  ];
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.weight : c.partial ? c.weight / 2 : 0), 0);
  return { score: Math.round((got / total) * 100), checks, words: w.length };
}

/** قالب HTML للوصف (نفس بنية صفحات SOU9NA الحالية) انطلاقاً من مخرجات الذكاء الاصطناعي */
export function buildDescriptionHtml({ intro, specs = [], features = [], faq = [], delivery }) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = intro || '';
  if (specs.length) html += `<h3>المواصفات</h3><table>${specs.map((s) => `<tr><th>${esc(s.label)}</th><td>${esc(s.value)}</td></tr>`).join('')}</table>`;
  if (features.length) html += `<h3>المميزات</h3><ul>${features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
  if (faq.length) html += `<h3>أسئلة شائعة</h3>${faq.map((f) => `<p><strong>${esc(f.q)}</strong> ${esc(f.a)}</p>`).join('')}`;
  if (delivery) html += `<h3>الطلب والتوصيل</h3><p>${esc(delivery)}</p>`;
  return html;
}
