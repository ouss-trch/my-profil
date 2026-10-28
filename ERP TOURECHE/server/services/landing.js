import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { db, parseJson } from '../db/index.js';
import * as ai from '../integrations/ai.js';
import { generateImages, imageProvider, uploadPath } from '../integrations/images.js';
import * as shopify from '../integrations/shopify.js';
import { projectConfig } from '../lib/settings.js';
import { HttpError, badRequest, escapeHtml, nowIso, slugify } from '../lib/util.js';
import { getProduct, imageBlocks } from './products.js';
import { getProject, inList } from './projects.js';
import { deliveryFacts, getDelivery } from './delivery.js';
import { addPages, storeBase } from './pages.js';
import { metricsByPage, pageKey } from './tracking.js';
import { detachPage } from './splits.js';

/**
 * صفحات الهبوط: منتج واحد + زاوية تسويقية + إطار كتابة (AIDA، PAS…) → صفحة بيع دون قائمة ولا تذييل،
 * بنفس نموذج الطلب والعروض التي في صفحة المنتج (شرط Meta: نفس المنتج ونفس العرض).
 *
 * التنفيذ على Shopify (دون لمس كود النموذج):
 *  - قالب منتج مستقل templates/product.lp-<slug>.json بتخطيط layout/erp-landing.liquid (theme.liquid دون الرأس والتذييل)
 *    وقسم sections/erp-lp.liquid للنصوص، يمكن تعديلها لاحقاً من محرر القالب في Shopify؛
 *  - رابط الإعلان ‎/pages/<slug>‎ تحويلة Shopify إلى ‎/products/<handle>?view=lp-<slug>‎ (Shopify لا يقبل «/» داخل اسم الصفحة).
 *  - تحليل المنتج أولاً (analyzeProduct): حقائق صفحته ونواقصها + زوايا خاصة به، لكل زاوية وعدها وجمهورها وتسلسل صورها.
 *  - الصور هي الصفحة: Claude يخطط 5–7 صور حسب تسلسل الزاوية (الخطاف، المشكلة، ميزة تُرى، المزايا، الاستعمال، النتيجة…)،
 *    ومولّد الصور يرسمها من صورة المنتج الحقيقية بعنوانها وتسمياتها داخلها بلون تصميم الصفحة. التاجر يراجع كل صورة
 *    (ويطفئ الكتابة في صورة أخطأت حروفها)، وتُرفع إلى «Fichiers» في Shopify (write_files) فلا تدخل معرض المنتج.
 */

export const FRAMEWORKS = {
  aida: {
    label: ['AIDA: انتباه ← اهتمام ← رغبة ← طلب', 'AIDA : attention → intérêt → désir → action'],
    when: ['جمهور بارد لا يعرف المنتج (أغلب إعلانات Facebook)', 'Audience froide (la plupart des pubs Facebook)'],
    story: 'ثلاث فقرات: (1) انتباه: موقف يومي يعرفه الزبون يربطه بالزاوية؛ (2) اهتمام: كيف يعمل المنتج وما الذي يميّزه بمعلومات محددة؛ (3) رغبة: الصورة بعد الشراء، كيف يتغير اليوم أو الموقف.',
  },
  pas: {
    label: ['PAS: المشكلة ← تضخيمها ← الحل', 'PAS : problème → agitation → solution'],
    when: ['جمهور يعرف المشكلة ويبحث عن حل', 'Audience consciente du problème'],
    story: 'ثلاث فقرات: (1) المشكلة: سمّها كما يعيشها الزبون بموقف ملموس؛ (2) تضخيمها: ما الذي تكلّفه من وقت أو مال أو راحة إن بقيت، دون تخويف أو مبالغة؛ (3) الحل: المنتج وكيف يحلها تحديداً.',
  },
  bab: {
    label: ['BAB: قبل ← بعد ← الجسر', 'BAB : avant → après → pont'],
    when: ['منتج يغيّر روتيناً أو موقفاً يومياً', 'Produit qui change une routine'],
    story: 'ثلاث فقرات: (1) قبل: الوضع الحالي كما هو؛ (2) بعد: نفس الموقف والمنتج معك (واقعي، دون وعود بنتائج مضمونة)؛ (3) الجسر: المنتج وما يجعله ممكناً.',
  },
  fab: {
    label: ['FAB: خاصية ← ميزة ← فائدة', 'FAB : caractéristique → avantage → bénéfice'],
    when: ['منتج تقني أو بمواصفات تحتاج شرحاً', 'Produit technique, à expliquer'],
    story: 'فقرتان أو ثلاث: كل فقرة تأخذ خاصية حقيقية من المعطيات ← ماذا تعني ← ما الذي يربحه الزبون منها في حياته.',
  },
  fourp: {
    label: ['4P: وعد ← صورة ← دليل ← دفعة', '4P : promesse → image → preuve → poussée'],
    when: ['جمهور متردد يحتاج ثقة قبل الشراء', 'Audience hésitante, besoin de confiance'],
    story: 'ثلاث فقرات: (1) الوعد: الفائدة الأساسية بجملة واضحة؛ (2) الصورة: الزبون يستعمل المنتج في موقف محدد؛ (3) الدليل: حقائق من المعطيات فقط (المادة، المقاس، سياسة المعاينة والاستبدال) — لا آراء ولا أرقام مختلقة.',
  },
  fomo: {
    label: ['FOMO الصادق: عرض حقيقي لا يُفوَّت', 'FOMO honnête : offre réelle'],
    when: ['منتج عليه عرض كمية حقيقي أو مخزون قليل فعلاً', 'Offre quantité réelle ou stock vraiment bas'],
    story: 'ثلاث فقرات: (1) لماذا الآن: العرض الحقيقي الموجود في المعطيات (عرض الكمية) وما يوفّره بالدينار؛ (2) الفائدة اليومية من المنتج؛ (3) إن كان المخزون قليلاً في المعطيات اذكر العدد الحقيقي، وإلا ركّز على سهولة الطلب والدفع عند الاستلام. ممنوع العدّاد التنازلي و«العرض ينتهي الليلة» وأي ندرة غير موجودة في المعطيات.',
  },
};

export const ANGLE_PRESETS = [
  ['هدية', 'cadeau'],
  ['المشكلة والحل', 'solution'],
  ['الاستعمال اليومي', 'quotidien'],
  ['الجودة مقابل السعر', 'qualite-prix'],
  ['للأطفال والعائلة', 'famille'],
  ['التوفير', 'economie'],
];

/**
 * تصميم لكل زاوية تسويقية: ترتيب الأقسام، أقسام خاصة بالزاوية، الألوان، ونوع الصور.
 * القاعدة في صفحات الدفع عند الاستلام في الجزائر: الشاشة الأولى فيها العنوان والصورة والسعر والزر،
 * تحتها مباشرة شريط الثقة (الدفع عند الاستلام، المعاينة، التوصيل)، ثم قسم الزاوية نفسه وصورتان والفوائد، فالنموذج مبكراً؛
 * وبعده القصة والصور الباقية وما يجيب عن الاعتراضات (التوصيل، الضمانات، الأسئلة) وزر يعيد إلى النموذج.
 * الرموز: hero · trust · story · story:first · story:rest · benefits · steps · occasions · compare · moments · specs ·
 * gallery (صورتان متجاورتان) · visual (صورة) · visuals (الباقي) · visuals:2 · delivery · guarantee · faq · cta
 */
export const LAYOUTS = {
  gift: {
    label: ['هدية: دافئ، الصورة أولاً، المناسبات', 'Cadeau : chaleureux, image d’abord, occasions'],
    match: /هدي|cadeau|gift/i,
    top: ['hero', 'trust', 'occasions', 'gallery', 'benefits', 'steps'],
    bottom: ['story', 'visuals', 'delivery', 'guarantee', 'faq', 'cta'],
    brief: 'occasions: من 3 إلى 6 مناسبات أو أشخاص يُهدى لهم المنتج (عيد ميلاد، النجاح، العودة إلى المدرسة…) تناسبه فعلاً. الصفحة دافئة: فرحة من يتلقّى الهدية. لا تذكر تغليفاً أو علبة هدية إلا إن وُجدا في المعطيات.',
    shots: 'Gift mood. hero: the product presented as a gift on a festive table, wrapping paper and a ribbon placed around it (never covering or changing the product). Then: hands holding it as if just unwrapped, the product next to a gift bag, a close-up detail, the real colors side by side.',
  },
  problem: {
    label: ['المشكلة والحل: مقارنة «بدونه / معه»', 'Problème → solution : comparaison sans / avec'],
    match: /مشكل|solution|probl/i,
    top: ['hero', 'trust', 'story:first', 'compare', 'visual', 'benefits', 'steps'],
    bottom: ['story:rest', 'visuals', 'guarantee', 'delivery', 'faq', 'cta'],
    brief: 'compare: «بدونه» و«معه»: من 3 إلى 4 أسطر قصيرة متقابلة، المشكلة اليومية كما يعيشها الزبون مقابل ما يحلّه المنتج بخصائصه المذكورة في المعطيات فقط. الفقرة الأولى من story هي المشكلة.',
    shots: 'Problem → solution mood. hero: the product as the clean, reliable answer, bright studio light. Then: a close-up of the part that solves the problem (lid, seal, strap…), the product in use (hands only), the product where it is needed (bag, desk), the real colors.',
  },
  daily: {
    label: ['الاستعمال اليومي: يوم كامل مع المنتج', 'Usage quotidien : une journée avec le produit'],
    match: /يومي|روتين|quotidien|daily/i,
    top: ['hero', 'trust', 'moments', 'visuals:2', 'benefits', 'steps'],
    bottom: ['story', 'visuals', 'delivery', 'guarantee', 'faq', 'cta'],
    brief: 'moments: من 3 إلى 4 لحظات من يوم الزبون (الصباح، المدرسة أو العمل، الخروج، المساء) وكيف يخدمه المنتج فيها، جملة لكل لحظة.',
    shots: 'Everyday-life mood, natural daylight. hero: the product in a bright morning scene (breakfast table or school bag). Then one shot per moment of the day: at school or a desk, outdoors in a park, on the go — hands only.',
  },
  value: {
    label: ['الجودة مقابل السعر: خصائص ومقارنة', 'Qualité-prix : caractéristiques et comparaison'],
    match: /جودة|مقابل السعر|qualit|prix|توفير|econom|économ/i,
    top: ['hero', 'trust', 'specs', 'gallery', 'compare', 'steps'],
    bottom: ['benefits', 'guarantee', 'story', 'visuals', 'delivery', 'faq', 'cta'],
    brief: 'specs: من 4 إلى 6 خصائص حقيقية من المعطيات فقط (المادة، السعة، المقاس، الألوان، الملحقات) بشكل «الخاصية» و«القيمة». compare: ما تدفع مقابله: 3 أسطر «منتج عادي» مقابل 3 أسطر «هذا المنتج» بخصائص حقيقية فقط، دون ذكر علامات أخرى.',
    shots: 'Premium product mood. hero: studio shot on a neutral seamless background, crisp detail. Then: macro of the material and finish, the product with its real parts laid out, a size reference next to a familiar object, the real colors lined up.',
  },
  family: {
    label: ['للأطفال والعائلة: لحظات عائلية', 'Enfants et famille : moments en famille'],
    match: /أطفال|طفل|عائل|famil|enfant|kids/i,
    top: ['hero', 'trust', 'moments', 'gallery', 'benefits', 'steps'],
    bottom: ['story', 'occasions', 'visuals', 'delivery', 'guarantee', 'faq', 'cta'],
    brief: 'moments: 3 لحظات عائلية يُستعمل فيها المنتج. occasions: من 3 إلى 5 لمن يناسب (العمر، الاستعمال) من المعطيات فقط.',
    shots: 'Warm family-home mood. hero: the product in a child’s or a parent’s hands at home (hands only). Then: a kids’ room or school setting, a family outing, a close-up detail, the real colors.',
  },
  classic: {
    label: ['كلاسيكي: الفقرات والصور بالتناوب', 'Classique : paragraphes et images alternés'],
    top: ['hero', 'trust', 'story:first', 'visual', 'benefits', 'steps'],
    bottom: ['story:rest', 'visuals', 'delivery', 'guarantee', 'faq', 'cta'],
    brief: '',
    shots: 'hero: the product as the clear subject in a scene that fits the angle. Then: design, a close-up detail, a visible feature, in use (hands only), the real colors.',
  },
};
const FRAMEWORK_LAYOUT = { pas: 'problem', bab: 'daily', fab: 'value', fourp: 'value', fomo: 'value', aida: 'classic' };
/** التصميم: ما اختاره التاجر، وإلا من كلمات الزاوية، وإلا من إطار الكتابة */
export function layoutFor(angle, framework, chosen) {
  if (LAYOUTS[chosen]) return chosen;
  for (const [id, l] of Object.entries(LAYOUTS)) if (l.match?.test(String(angle || ''))) return id;
  return FRAMEWORK_LAYOUT[framework] || 'classic';
}

const TONES = {
  ar: 'العربية الفصحى المبسّطة القريبة من الزبون الجزائري (جمل قصيرة، كلمات يومية).',
  darija: 'الدارجة الجزائرية مكتوبة بالحروف العربية بشكل طبيعي ومحترم، مع كلمات فرنسية شائعة عند الحاجة.',
};

/** القواعد: من أُطر الكتابة المجرّبة (AIDA، PAS، BAB، FAB، 4P) + معايير Meta للإعلانات + خصوصية الدفع عند الاستلام في الجزائر */
export function landingSystem(brand) {
  return `أنت كاتب صفحات هبوط (Landing pages) محترف لمتجر «${brand}» الجزائري الذي يبيع بالدفع عند الاستلام.
تكتب صفحة بيع لمنتج واحد، هدفها الوحيد: أن يملأ الزائر نموذج الطلب. الزائر يأتي من إعلان Facebook/Instagram بزاوية تسويقية محددة.

قواعد إلزامية (أي مخالفة تُرفض):
1. هدف واحد: كل جملة تخدم الطلب. لا روابط لصفحات أخرى ولا منتجات أخرى.
2. تطابق الرسالة: العنوان الرئيسي يعبّر عن الزاوية المطلوبة حرفياً تقريباً، لأن الإعلان مبني عليها.
3. الصدق التام: استعمل فقط الحقائق الموجودة في المعطيات. ممنوع اختلاق: أرقام، نسب، عدد زبائن، تقييمات، آراء زبائن، جوائز، شهادات، مواد أو مقاسات غير مذكورة، أو مدة توصيل غير مذكورة. إن نقصت معلومة يحتاجها الزبون فاكتب أنها تُؤكَّد عند اتصال التأكيد، وأضفها في owner_todo — إلا التوصيل والسياسات (القاعدة 5) فمصدرها delivery.
4. سياسة Meta: لا ادعاءات صحية أو علاجية، لا «قبل/بعد» بنتائج مضمونة، لا مخاطبة صفات شخصية للزائر (مثل: «هل أنت سمين؟»، «هل تعاني من…؟» عن جسده)، لا عدّاد تنازلي، لا «آخر قطع» أو «ينتهي اليوم» إلا إن كان المخزون الحقيقي في المعطيات قليلاً فتذكر رقمه كما هو. العرض في الصفحة هو نفس العروض المذكورة في المعطيات بالضبط.
5. الدفع عند الاستلام يطمئن: اذكر الدفع عند الاستلام، واتصال التأكيد قبل الشحن، وسياسات المتجر. مصدر التوصيل والسياسات هو delivery (من موقع المتجر نفسه):
   - الولايات: التوصيل متوفر لجميع الولايات (wilayas_served): اكتب «جميع الولايات» ولا تذكر ولايات مستثناة ولا تكتب 58. الأسعار: «من X دج للمكتب، من Y دج للمنزل»، والسعر الدقيق يظهر في النموذج حسب الولاية.
   - مدة التوصيل: delivery_time حرفياً إن وُجدت؛ وإن كانت فارغة فاكتب أنها تختلف حسب الولاية وتُؤكَّد عند اتصال التأكيد (هذا ما تقوله سياسة المتجر)، ولا تضفها إلى owner_todo.
   - المعاينة قبل الدفع، الاسترجاع، الاستبدال، الاسترداد: لخّصها من shipping_policy وreturns_policy بالشروط والمدد المذكورة فيها (مثل عدد الأيام ومن يدفع مصاريف الإرجاع)، دون زيادة ولا حذف لشرط مهم.
   - إن كان delivery فارغاً: اكتفِ بما في store_policies، وأضف «استيراد أسعار التوصيل والسياسات» إلى owner_todo.
6. الفائدة قبل الخاصية: كل خاصية تُترجم إلى ما يربحه الزبون في يومه.
7. الأسلوب: ${'{tone}'} جمل قصيرة، فقرة لا تتجاوز سطرين على الهاتف، بلا مبالغة ولا علامات تعجب متتالية ولا رموز تعبيرية.
8. الطول: العنوان الرئيسي 6–12 كلمة. العنوان الفرعي جملة أو جملتان. 3 نقاط في الأعلى. 3 إلى 5 فوائد. 3 خطوات طلب. 2 إلى 4 ضمانات. 4 إلى 6 أسئلة شائعة عن اعتراضات حقيقية (التوصيل، الدفع، المعاينة، الاستبدال، المقاس/اللون، الاستعمال) بأجوبة من المعطيات فقط.
9. زر الطلب فعل واضح (مثال: «اطلب الآن وادفع عند الاستلام»).
10. product_short و angle_slug: كلمة أو كلمتان بالحروف اللاتينية الصغيرة فقط (a-z و0-9 و-)، لرابط مثل ‎/pages/thermos-cadeau‎.
11. seo: عنوان حتى 60 حرفاً ووصف حتى 155 حرفاً.
12. visuals: من 5 إلى 7 صور تكوّن جسم الصفحة نفسه (الصور هي الوصف، لا زينة بين الفقرات)، تُرسم من صورة المنتج الحقيقية المرفقة، وكل صورة تحمل فكرة واحدة من الزاوية مكتوبة داخلها (headline وpoints):
   - إن وُجد angle_brief.beats فاتبعه بالترتيب: صورة لكل beat، بنفس نوعه وفكرته (headline منه تقريباً).
   - الأولى kind=hero وهي الخطاف: المنتج كبير وواضح مع لمسة الزاوية (هدية ← تغليف ومناسبة؛ مشكلة ← المنتج حلّ واضح؛ يومي ← لحظة الاستعمال؛ جودة ← فخامة التفاصيل). headline = وعد الزاوية، points = فائدتان أو ثلاث قصيرة.
   - الباقي من: problem (المشكلة كما يعيشها الزبون، لزاوية المشكلة فقط)، benefits (المنتج في الوسط وحوله تسميات لأجزائه الحقيقية)، feature (ميزة واحدة تُرى وهي تعمل، مثل ترمس مقلوب لا يسرّب إن ذُكر ذلك في المعطيات)، in_use (أثناء الاستعمال في مكان حقيقي)، outcome (النتيجة العاطفية: فرحة، راحة، اطمئنان)، gift (المنتج هدية)، detail (خامة أو تفصيل عن قرب)، design، size (فقط إن كان المقاس أو السعة في المعطيات)، variants (الألوان أو الموديلات الموجودة فعلاً في variants فقط).
   - التنويع إلزامي: لكل صورة مكان مختلف، وframing مختلف قدر الإمكان (macro، close، medium، wide، top_down)، وزاوية كاميرا مختلفة. ممنوع صورتان بنفس الخلفية أو التركيب.
   - كل ما يُرى حقيقي: من الصور أو المعطيات (product وproduct_facts). ممنوع ملحق أو قطعة أو لون غير موجود، أو ميزة غير مذكورة، أو نتيجة غير مثبتة.
   - headline: من 3 إلى 7 كلمات بالعربية تقول الفائدة. points: من 0 إلى 3 تسميات من كلمتين إلى 4 تشير لما يُرى في الصورة.
   - scene: بالإنجليزية لمولّد الصور، جملتان أو ثلاث: المكان والخلفية، الإضاءة، زاوية الكاميرا، ما حول المنتج، وأين تبقى مساحة فارغة للكتابة (أعلى الصورة أو جانبها). لا تكتب النص نفسه في scene ولا تصف المنتج بشكل مختلف عن صوره.
   - إن لم يوجد angle_brief: اتبع أجواء الصور الخاصة بتصميم الصفحة (layout.shots)، حتى تختلف صور كل زاوية عن صور الزوايا الأخرى.
13. التصميم (layout) يُعطى مع المعطيات، ولكل تصميم أقسامه الخاصة (occasions، compare، moments، specs): اكتب فقط الأقسام الموجودة في المخطط المطلوب، كما يصفها layout.brief.
   - trust: من 3 إلى 4 نقاط ثقة قصيرة جداً (2–5 كلمات) من delivery وstore_policies فقط، مثل: الدفع عند الاستلام، المعاينة قبل الدفع (إن كانت في السياسة)، التوصيل إلى N ولاية، الاستبدال (إن كان في السياسة).
   - العناوين بنفس الأسلوب والزاوية، والأسطر قصيرة تُقرأ على الهاتف في ثانية.

14. angle_brief (إن وُجد) هو تحليل هذا المنتج لهذه الزاوية: promise هو العنوان الرئيسي تقريباً، pains في الفقرات الأولى، proofs في الفوائد، objections تجيب عنها الأسئلة الشائعة والضمانات. product_facts هي الحقائق التي وُجدت في صفحة المنتج: لا تتجاوزها.

الإطار المطلوب للفقرات (story) يُعطى مع المعطيات؛ اتبعه بالترتيب، وstage لكل فقرة هو اسم مرحلتها.`;
}

const s = { type: 'string' };
const sArr = { type: 'array', items: s };
export const VISUAL_KINDS = ['hero', 'problem', 'benefits', 'feature', 'in_use', 'outcome', 'gift', 'detail', 'design', 'size', 'variants'];
export const FRAMINGS = ['macro', 'close', 'medium', 'wide', 'top_down'];
const VISUAL_ITEM = { type: 'object', additionalProperties: false, required: ['kind', 'framing', 'headline', 'points', 'scene'], properties: { kind: { type: 'string', enum: VISUAL_KINDS }, framing: { type: 'string', enum: FRAMINGS }, headline: s, points: sArr, scene: s } };
/**
 * مخطط واحد بكل الأقسام (النصوص + أقسام الزوايا الأربعة + خطة الصور) تجاوز حدّ Claude لحجم المخطط
 * (400: The compiled grammar is too large). لذلك طلبان متوازيان، كلٌّ أصغر من المخطط الذي كان يعمل:
 *  1) LANDING_SCHEMA: نصوص الصفحة؛
 *  2) planSchema(extras): أقسام تصميم الزاوية التي يستعملها فعلاً (المناسبات، المقارنة…) + خطة الصور الوصفية.
 */
export const LANDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['product_short', 'angle_slug', 'hero', 'trust', 'story', 'benefits', 'steps', 'guarantee', 'faq', 'final_cta', 'seo', 'owner_todo'],
  properties: {
    product_short: s,
    angle_slug: s,
    hero: { type: 'object', additionalProperties: false, required: ['eyebrow', 'headline', 'subheadline', 'bullets', 'cta', 'note'], properties: { eyebrow: s, headline: s, subheadline: s, bullets: sArr, cta: s, note: s } },
    trust: sArr,
    story: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['stage', 'heading', 'body'], properties: { stage: s, heading: s, body: s } } },
    benefits: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: { heading: s, items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: { title: s, text: s } } } } },
    steps: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: { heading: s, items: sArr } },
    guarantee: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: { heading: s, items: sArr } },
    faq: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { q: s, a: s } } },
    final_cta: { type: 'object', additionalProperties: false, required: ['headline', 'cta', 'note'], properties: { headline: s, cta: s, note: s } },
    seo: { type: 'object', additionalProperties: false, required: ['title', 'description'], properties: { title: s, description: s } },
    owner_todo: sArr,
  },
};

const pairs = (a, b) => ({ type: 'array', items: { type: 'object', additionalProperties: false, required: [a, b], properties: { [a]: s, [b]: s } } });
const EXTRA_SCHEMAS = {
  occasions: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: { heading: s, items: sArr } },
  compare: { type: 'object', additionalProperties: false, required: ['heading', 'without_label', 'with_label', 'without', 'with'], properties: { heading: s, without_label: s, with_label: s, without: sArr, with: sArr } },
  moments: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: { heading: s, items: pairs('when', 'text') } },
  specs: { type: 'object', additionalProperties: false, required: ['heading', 'items'], properties: { heading: s, items: pairs('label', 'value') } },
};

/** أقسام الزاوية التي يعرضها تصميم الصفحة فعلاً (هدية ← المناسبات، المشكلة ← المقارنة…) */
export function layoutExtras(id) {
  const l = LAYOUTS[id] || LAYOUTS.classic;
  const used = [...l.top, ...l.bottom].map((x) => x.split(':')[0]);
  return Object.keys(EXTRA_SCHEMAS).filter((k) => used.includes(k));
}

export const planSchema = (extras = []) => ({
  type: 'object',
  additionalProperties: false,
  required: [...extras, 'visuals'],
  properties: { ...Object.fromEntries(extras.map((k) => [k, EXTRA_SCHEMAS[k]])), visuals: { type: 'array', items: VISUAL_ITEM } },
});

const extrasNames = { occasions: 'occasions (المناسبات)', compare: 'compare (بدونه / معه)', moments: 'moments (لحظات اليوم)', specs: 'specs (المواصفات)' };

// ——— تحليل المنتج: ما في صفحته فعلاً + زوايا تسويقية خاصة به (بدل الزوايا العامة) ———
export const INSIGHT_SYSTEM = `أنت مسوّق أداء محترف (Direct response) لإعلانات Facebook/Instagram في الجزائر، لمتجر يبيع بالدفع عند الاستلام.
تحلّل صفحة منتج واحد (العنوان، الوصف، المواصفات، المتغيرات، الصور المرفقة، السعر، العروض) ثم تقترح زوايا تسويقية خاصة بهذا المنتج بالذات.

1. facts: كل حقيقة يمكن إثباتها من الصفحة (المادة، السعة، المقاس، طريقة الإغلاق، الحزام، الألوان، ما في العلبة…)، مع فائدتها للزبون في يومه (benefit) ومصدرها (source). ما لا تراه في الصور ولا تقرؤه في المعطيات لا يُكتب. لا أرقام أو مدد غير مذكورة (مثل «يحفظ الحرارة 12 ساعة» إن لم يُذكر الرقم).
2. missing: ما يسأل عنه الزبون عادة لهذا النوع من المنتجات وغير موجود في الصفحة (مثل السعة، المقاس، المادة، العمر المناسب)، جملة قصيرة لكل نقص، ليضيفه التاجر.
3. angles: من 4 إلى 6 زوايا، كل زاوية دافع شراء مختلف عند جمهور مختلف (مشكلة يحلها، استعمال يومي محدد، مناسبة هدية، الجودة مقابل السعر، الأطفال والعائلة، التوفير بعرض حقيقي…)، مسمّاة بشكل ملموس خاص بالمنتج، لا بكلمة عامة.
   مثال لترمس أطفال: «مشروب دافئ حتى الاستراحة» لا «الاستعمال اليومي».
   - name: من 2 إلى 6 كلمات بالعربية. slug: كلمة أو كلمتان لاتينية صغيرة (a-z و0-9 و-) للرابط، مثل ecole أو cadeau-aid.
   - audience: من بالضبط (مثل: أمهات تلاميذ الابتدائي). why: لماذا تناسب هذا المنتج، جملة واحدة.
   - promise: وعد الزاوية كعنوان إعلان، من 6 إلى 10 كلمات، صادق ومن الحقائق فقط.
   - pains: من 2 إلى 3 مشكلات أو رغبات يعيشها هذا الجمهور يومياً. proofs: من 2 إلى 4 حقائق من facts تثبت الوعد. objections: من 2 إلى 3 اعتراضات قبل الطلب وما يجيب عنها من الصفحة أو الدفع عند الاستلام.
   - framework: إطار الكتابة الأنسب (aida جمهور بارد، pas مشكلة معروفة، bab تغيير روتين، fab منتج تقني، fourp جمهور متردد، fomo فقط إن وُجد عرض كمية حقيقي أو مخزون قليل فعلاً). layout: تصميم الصفحة الأنسب (gift، problem، daily، value، family، classic).
   - beats: من 5 إلى 7 صور متتابعة تكوّن الصفحة (الصور هي الوصف، مثل صفحات البيع الناجحة: خطاف ثم صور تشرح)، بالترتيب:
     الأولى kind=hero: الخطاف (المنتج مع لمسة الزاوية ووعدها). ثم صورة لكل فكرة: problem للمشكلة (زاوية المشكلة)، feature لميزة تُرى وهي تعمل، benefits للمنتج وحوله تسميات أجزائه، in_use للاستعمال في مكان حقيقي، outcome للنتيجة العاطفية، gift للهدية، detail للخامة، size إن عُرف المقاس، variants للألوان الموجودة فعلاً.
     headline: النص الذي يُكتب داخل الصورة (3 إلى 7 كلمات، فائدة لا وصف). shows: ماذا تُظهر الصورة بالضبط، جملة بالعربية.
     كل beat فكرة واحدة مختلفة ومشهد مختلف؛ والزوايا المختلفة صورها مختلفة.
4. سياسة Meta: لا ادعاءات صحية أو علاجية، لا مخاطبة صفات شخصية للزائر، لا ندرة أو عدّاد غير حقيقي، لا آراء زبائن مختلقة.
5. summary: ما هو المنتج ولمن، جملتان قصيرتان.`;

const INSIGHT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'facts', 'missing', 'angles'],
  properties: {
    summary: s,
    facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['fact', 'benefit', 'source'], properties: { fact: s, benefit: s, source: { type: 'string', enum: ['title', 'description', 'specs', 'variants', 'photo', 'offer'] } } } },
    missing: sArr,
    angles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'slug', 'audience', 'why', 'promise', 'pains', 'proofs', 'objections', 'framework', 'layout', 'beats'],
        properties: {
          name: s,
          slug: s,
          audience: s,
          why: s,
          promise: s,
          pains: sArr,
          proofs: sArr,
          objections: sArr,
          framework: { type: 'string', enum: Object.keys(FRAMEWORKS) },
          layout: { type: 'string', enum: Object.keys(LAYOUTS) },
          beats: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'headline', 'shows'], properties: { kind: { type: 'string', enum: VISUAL_KINDS }, headline: s, shows: s } } },
        },
      },
    },
  },
};

const clipList = (a, n, max) => (Array.isArray(a) ? a : []).map((x) => clip(x, max)).filter(Boolean).slice(0, n);

/** زاوية واحدة من التحليل كما تُستعمل في الكتابة وخطة الصور (تُحفظ مع نص الصفحة) */
function cleanBrief(a) {
  if (!a?.name) return undefined;
  const framework = FRAMEWORKS[a.framework] ? a.framework : 'aida';
  const beats = (Array.isArray(a.beats) ? a.beats : [])
    .map((b) => ({ kind: VISUAL_KINDS.includes(b.kind) ? b.kind : 'feature', headline: clip(b.headline, 90), shows: clip(b.shows, 240) }))
    .filter((b) => b.headline || b.shows)
    .slice(0, 7);
  // الخطاف أولاً دائماً: صفحة تبدأ بصورة تشرح تفصيلاً تفقد الزائر في ثانيتين
  if (beats.length && beats[0].kind !== 'hero') beats[0] = { ...beats[0], kind: 'hero' };
  return {
    name: clip(a.name, 80),
    slug: latin(a.slug, 24),
    audience: clip(a.audience, 200),
    why: clip(a.why, 240),
    promise: clip(a.promise, 140),
    pains: clipList(a.pains, 3, 160),
    proofs: clipList(a.proofs, 4, 160),
    objections: clipList(a.objections, 3, 200),
    framework,
    layout: LAYOUTS[a.layout] ? a.layout : layoutFor(a.name, framework),
    beats,
  };
}

export function cleanInsight(raw) {
  const names = new Set();
  return {
    summary: clip(raw?.summary, 400),
    facts: (Array.isArray(raw?.facts) ? raw.facts : [])
      .map((f) => ({ fact: clip(f.fact, 160), benefit: clip(f.benefit, 200), source: clip(f.source, 20) || 'description' }))
      .filter((f) => f.fact)
      .slice(0, 14),
    missing: clipList(raw?.missing, 6, 200),
    // اسمان متطابقان = زاوية واحدة: الاسم هو ما يُختار به في الواجهة
    angles: (Array.isArray(raw?.angles) ? raw.angles : [])
      .map(cleanBrief)
      .filter((a) => a && !names.has(a.name) && names.add(a.name))
      .slice(0, 6),
  };
}

/** بصمة صفحة المنتج: التحليل يُعاد فقط إن تغيّر ما يقرؤه (الوصف، المواصفات، المتغيرات، السعر، الصور) */
const insightHash = (p) =>
  createHash('sha1')
    .update(JSON.stringify({ f: productFacts(p), i: (p.images || []).map((x) => x.url).slice(0, 4), a: p.audience || '' }))
    .digest('hex');

export function getInsight(productId) {
  const r = db.prepare('SELECT * FROM product_insights WHERE product_id = ?').get(productId);
  if (!r) return null;
  const p = getProduct(productId);
  return { ...parseJson(r.data, {}), product_id: r.product_id, at: r.created_at, model: r.model, stale: r.source_hash !== insightHash(p) };
}

/** الزاوية المختارة من تحليل المنتج (بالاسم)، أو لا شيء إن كانت زاوية عامة أو مكتوبة يدوياً */
export function insightAngle(productId, name) {
  const angle = clip(name, 80);
  return getInsight(productId)?.angles?.find((a) => a.name === angle) || null;
}

/** تحليل صفحة المنتج (Claude يقرأ الوصف والمواصفات والصور) → حقائق + نواقص + زوايا خاصة به. محفوظ حتى تتغير الصفحة */
export async function analyzeProduct(projectId, productId, { fresh = false } = {}) {
  const p = getProduct(Number(productId));
  if (p.project_id !== projectId) throw new HttpError(404, 'product_not_found');
  const cached = getInsight(p.id);
  if (cached && !cached.stale && !fresh) return cached;
  const cfg = projectConfig(projectId);
  let offers = [];
  if (shopify.isConfigured(cfg)) offers = await mainTemplate(cfg).then(({ tpl }) => templateFacts(tpl).offers).catch(() => []);
  const images = await imageBlocks(p.images, 4).catch(() => []);
  const data = { product: productFacts(p), store_offers: offers, audience_hint: clip(p.audience, 200) || null };
  const raw = await ai.structured({
    system: INSIGHT_SYSTEM,
    prompt: `المعطيات (JSON):\n${JSON.stringify(data, null, 2)}\n\n${images.length ? 'الصور المرفقة هي صور المنتج الحقيقية من صفحته.' : 'لا صور للمنتج: اعتمد على النص وحده.'}\n\nحلّل المنتج واقترح زواياه حسب القواعد.`,
    schema: INSIGHT_SCHEMA,
    effort: 'medium',
    images,
    meter: { projectId, kind: 'landing_insight' },
  });
  const insight = cleanInsight(raw);
  if (!insight.angles.length) throw new HttpError(502, 'landing_insight_empty');
  db.prepare(
    'INSERT INTO product_insights (product_id, project_id, source_hash, data, model, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET source_hash = excluded.source_hash, data = excluded.data, model = excluded.model, created_at = excluded.created_at',
  ).run(p.id, projectId, insightHash(p), JSON.stringify(insight), ai.model(), nowIso());
  return getInsight(p.id);
}

// ——— المعطيات الحقيقية من القالب: العروض وسياسات المتجر كما تظهر في صفحة المنتج ———
export const parseTemplate = shopify.parseThemeJson;

function walkBlocks(node, fn) {
  for (const b of Object.values(node?.blocks || {})) {
    fn(b);
    walkBlocks(b, fn);
  }
}

export function templateFacts(tpl) {
  const offers = [];
  const policies = [];
  for (const sec of Object.values(tpl?.sections || {})) {
    if (sec.disabled) continue;
    walkBlocks(sec, (b) => {
      if (b.disabled) return;
      const st = b.settings || {};
      if (b.type === '_offer') offers.push({ title: st.title || '', subtitle: st.subtitle || '', quantity: st.quantity || 1, discount_type: st.discount_type || 'none', value: st.value || 0, free_shipping: Boolean(st.free_shipping) });
      if (b.type === '_trust-line' && st.text) policies.push(st.text);
      if (b.type === '_trust-item' && st.title) policies.push(st.text ? `${st.title}: ${st.text}` : st.title);
    });
  }
  return { offers, policies: [...new Set(policies)] };
}

async function mainTemplate(cfg) {
  const theme = await shopify.mainTheme(cfg);
  if (!theme) throw new HttpError(404, 'theme_not_found');
  const [file] = await shopify.themeFiles(cfg, theme.id, ['templates/product.json']);
  if (!file?.content) throw new HttpError(409, 'landing_theme_unsupported');
  return { theme, tpl: parseTemplate(file.content) };
}

const LANDING_SCOPES = ['read_themes', 'write_themes', 'write_online_store_navigation'];

/** بعد رفض Shopify: أي الصلاحيات تنقص لصفحات الهبوط؟ (write_files فقط إن كانت هناك صور وصفية للرفع) */
async function scopesError(cfg, e, needed = LANDING_SCOPES) {
  if (!/access_denied/.test(e.message)) return e;
  const granted = await shopify.grantedScopes(cfg).catch(() => null);
  const missing = granted ? needed.filter((x) => !shopify.hasScope(granted, x)) : null;
  return new HttpError(403, missing?.length ? `landing_scopes_missing:${missing.join(' + ')}` : 'theme_write_refused', null, { missing_scopes: missing });
}

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const latin = (v, n) => slugify(v, n);

function cleanCopy(c) {
  const list = (a, n, max) => (Array.isArray(a) ? a : []).map((x) => clip(x, max)).filter(Boolean).slice(0, n);
  return {
    hero: { eyebrow: clip(c.hero?.eyebrow, 80), headline: clip(c.hero?.headline, 140), subheadline: clip(c.hero?.subheadline, 300), bullets: list(c.hero?.bullets, 4, 140), cta: clip(c.hero?.cta, 60) || 'اطلب الآن', note: clip(c.hero?.note, 140) },
    trust: list(c.trust, 4, 60),
    story: (c.story || []).slice(0, 4).map((x) => ({ stage: clip(x.stage, 40), heading: clip(x.heading, 120), body: String(x.body || '').trim().slice(0, 900) })).filter((x) => x.body),
    occasions: { heading: clip(c.occasions?.heading, 120), items: list(c.occasions?.items, 6, 60) },
    compare: { heading: clip(c.compare?.heading, 120), without_label: clip(c.compare?.without_label, 40), with_label: clip(c.compare?.with_label, 40), without: list(c.compare?.without, 4, 120), with: list(c.compare?.with, 4, 120) },
    moments: { heading: clip(c.moments?.heading, 120), items: (c.moments?.items || []).slice(0, 4).map((x) => ({ when: clip(x.when, 40).replace(/\|/g, '/'), text: clip(x.text, 220) })).filter((x) => x.text) },
    specs: { heading: clip(c.specs?.heading, 120), items: (c.specs?.items || []).slice(0, 6).map((x) => ({ label: clip(x.label, 60).replace(/\|/g, '/'), value: clip(x.value, 120) })).filter((x) => x.label && x.value) },
    layout: LAYOUTS[c.layout] ? c.layout : undefined,
    benefits: { heading: clip(c.benefits?.heading, 120), items: (c.benefits?.items || []).slice(0, 5).map((x) => ({ title: clip(x.title, 80).replace(/\|/g, '/'), text: clip(x.text, 220) })).filter((x) => x.title) },
    steps: { heading: clip(c.steps?.heading, 120), items: list(c.steps?.items, 4, 160) },
    guarantee: { heading: clip(c.guarantee?.heading, 120), items: list(c.guarantee?.items, 4, 180) },
    faq: (c.faq || []).slice(0, 6).map((x) => ({ q: clip(x.q, 160), a: clip(x.a, 400) })).filter((x) => x.q && x.a),
    final_cta: { headline: clip(c.final_cta?.headline, 140), cta: clip(c.final_cta?.cta, 60) || 'اطلب الآن', note: clip(c.final_cta?.note, 160) },
    seo: { title: clip(c.seo?.title, 70), description: clip(c.seo?.description, 160) },
    owner_todo: list(c.owner_todo, 8, 200),
    // تحليل المنتج للزاوية المختارة: يبقى مع الصفحة لإعادة تخطيط صورها بنفس التسلسل
    brief: c.brief ? cleanBrief(c.brief) : undefined,
  };
}

/** خطة الصور: حتى 7 صور، الأولى الخطاف؛ الكتابة داخل الصورة افتراضياً (الصور هي وصف الصفحة)، والتاجر يطفئها لصورة أخطأت حروفها */
function cleanVisuals(list) {
  return (Array.isArray(list) ? list : [])
    .slice(0, 7)
    .map((x, i) => ({
      id: `v${i + 1}`,
      kind: VISUAL_KINDS.includes(x.kind) ? x.kind : i ? 'feature' : 'hero',
      framing: FRAMINGS.includes(x.framing) ? x.framing : null,
      headline: clip(x.headline, 90),
      points: (Array.isArray(x.points) ? x.points : []).map((t) => clip(t, 40)).filter(Boolean).slice(0, 3),
      scene: clip(x.scene, 700),
      with_text: true,
      image: null,
      approved: true,
      shopify_url: null,
      width: null,
      height: null,
    }))
    .filter((x) => x.scene);
}

function uniqueSlug(projectId, base, ignoreId = 0) {
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM landing_pages WHERE project_id = ? AND slug = ? AND id != ?').get(projectId, slug, ignoreId); i++) slug = `${base}-${i}`;
  return slug;
}

// النص يُطبَّع عند القراءة: صفحة قديمة (قبل أقسام الزوايا) أو ناقصة تُعرض وتُنشر دون أن تنكسر الواجهة
const hydrate = (r) => (r ? { ...r, copy: cleanCopy(parseJson(r.copy, {})), visuals: parseJson(r.visuals, []) } : null);

export function getLanding(id) {
  const r = hydrate(db.prepare('SELECT l.*, p.title AS product_title, p.handle AS product_handle FROM landing_pages l JOIN products p ON p.id = l.product_id WHERE l.id = ?').get(id));
  if (!r) throw new HttpError(404, 'landing_not_found');
  const base = storeBase(r.project_id);
  return { ...r, public_url: r.public_path && base ? `${base}${r.public_path}` : null, image_provider: imageProvider() };
}

export function listLandings(projectIds) {
  const metrics = metricsByPage(projectIds, 30);
  return db
    .prepare(`SELECT l.id FROM landing_pages l WHERE l.project_id IN (${inList(projectIds)}) ORDER BY l.id DESC`)
    .all(...projectIds)
    .map((r) => {
      const l = getLanding(r.id);
      // زوار الصفحة وطلبياتها (30 يوماً) من عدّاد المتجر: رابطها النهائي ‎/products/<handle>?view=lp-<slug>‎
      const key = l.product_handle ? pageKey(`/products/${l.product_handle}?view=lp-${l.slug}`) : null;
      return { ...l, stats: key ? metrics(l.project_id, key) : null };
    });
}

function productFacts(p) {
  const managed = p.stock !== null && p.stock !== undefined;
  return {
    title: p.title,
    price_da: p.price,
    compare_at_price_da: p.compare_at_price && p.compare_at_price > p.price ? p.compare_at_price : null,
    description_text: String(p.description_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000),
    specs: p.specs,
    notes: p.notes,
    options: p.options,
    variants: (p.variants || []).map((v) => v.title).filter((t) => t && t !== 'Default Title'),
    // مخزون قليل فعلاً = ندرة حقيقية يجوز ذكرها برقمها؛ غير ذلك لا ندرة
    real_low_stock: managed && p.stock > 0 && p.stock <= Math.max(5, p.low_stock || 0) ? p.stock : null,
  };
}

/** ما يُرسل للكاتب من الزاوية: بلا الاسم اللاتيني ولا الإطار والتصميم (يُرسلان في حقولهما) */
const briefFacts = (b) => ({ audience: b.audience, why: b.why, promise: b.promise, pains: b.pains, proofs: b.proofs, objections: b.objections, beats: b.beats });

/** توليد النصوص (مسودة، لا شيء يُكتب في Shopify بعد) */
export async function generateLanding(projectId, input, userId = null) {
  const p = getProduct(Number(input.product_id));
  if (p.project_id !== projectId) throw new HttpError(404, 'product_not_found');
  if (!p.handle) throw badRequest('landing_product_not_on_shopify');
  const angle = clip(input.angle, 80);
  if (!angle) throw badRequest('landing_angle_required');
  // زاوية من تحليل المنتج: وعدها وآلام جمهورها وأدلتها وتسلسل صورها يوجّه الكتابة والصور
  const brief = insightAngle(p.id, angle);
  const framework = FRAMEWORKS[input.framework] ? input.framework : brief?.framework || 'aida';
  const layout = layoutFor(angle, framework, input.layout || brief?.layout);
  const tone = TONES[input.tone] ? input.tone : 'ar';
  const cfg = projectConfig(projectId);
  const brand = cfg.brand_name || getProject(projectId).name;
  let facts = { offers: [], policies: [] };
  if (shopify.isConfigured(cfg)) facts = await mainTemplate(cfg).then(({ tpl }) => templateFacts(tpl)).catch(() => facts);
  const data = {
    product: productFacts(p),
    store_offers: facts.offers,
    store_policies: [...facts.policies, 'الدفع عند الاستلام', 'فريقنا يتصل لتأكيد الطلب قبل الشحن'],
    delivery: deliveryFacts(projectId),
    angle,
    audience: clip(input.audience || brief?.audience || p.audience, 200) || null,
    framework: { id: framework, story_plan: FRAMEWORKS[framework].story },
    layout: { id: layout, brief: LAYOUTS[layout].brief, shots: LAYOUTS[layout].shots },
    ...(brief ? { angle_brief: briefFacts(brief), product_facts: getInsight(p.id)?.facts || [] } : {}),
  };
  const images = await imageBlocks(p.images, 4).catch(() => []);
  const system = landingSystem(brand).replace('{tone}', TONES[tone]);
  const given = `المعطيات (JSON):\n${JSON.stringify(data, null, 2)}\n\n`;
  const extra = input.instructions ? `تعليمات إضافية من التاجر: ${clip(input.instructions, 500)}\n\n` : '';
  const extras = layoutExtras(layout);
  // طلبان متوازيان (انتظار واحد): النصوص بكل صور المنتج، وأقسام الزاوية + خطة الصور بالصورة الرئيسية وحدها
  const [raw, plan] = await Promise.all([
    ai.structured({
      system,
      prompt: `${given}الصور المرفقة هي صور المنتج الحقيقية.\n\n${extra}اكتب نصوص صفحة الهبوط حسب القواعد والإطار (خطة الصور وأقسام التصميم الخاصة تُكتب في طلب آخر).`,
      schema: LANDING_SCHEMA,
      effort: 'medium',
      images,
      meter: { projectId, kind: 'landing' },
    }),
    ai
      .structured({
        system,
        prompt: `${given}الصورة المرفقة هي الصورة الرئيسية للمنتج، ووصفه في description_text.\n\n${extra}${extras.length ? `اكتب أقسام تصميم الصفحة الخاصة بهذه الزاوية: ${extras.map((k) => extrasNames[k]).join('، ')} (القاعدة 13)، ثم ` : 'اكتب '}خطة الصور الوصفية (القاعدة 12).`,
        schema: planSchema(extras),
        effort: 'medium',
        images: images.slice(0, 1),
        meter: { projectId, kind: 'landing_plan' },
      })
      // النص هو الأهم: إن فشل هذا الطلب تُحفظ الصفحة دونه، و«خطط الصور» يكمله
      .catch(() => ({ visuals: [] })),
  ]);
  const copy = cleanCopy({ ...raw, ...Object.fromEntries(extras.map((k) => [k, plan[k]])), layout, brief });
  // الرابط: ما كتبه التاجر، وإلا «المنتج-الزاوية» كما تقترحه الواجهة (مقبض لاتيني + زاوية جاهزة)، وإلا اقتراح Claude
  const handlePart = /^[a-z0-9-]+$/.test(p.handle) ? p.handle.split('-').slice(0, 2).join('-') : '';
  const anglePart = ANGLE_PRESETS.find(([ar]) => ar === angle)?.[1] || brief?.slug || '';
  const base = latin(input.slug, 40) || latin(`${handlePart || latin(raw.product_short, 20) || 'produit'}-${anglePart || latin(raw.angle_slug, 18) || latin(angle, 18) || framework}`, 40);
  const slug = uniqueSlug(projectId, base);
  const now = nowIso();
  const info = db
    .prepare('INSERT INTO landing_pages (project_id, product_id, slug, angle, framework, tone, audience, copy, visuals, status, model, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(projectId, p.id, slug, angle, framework, tone, data.audience, JSON.stringify(copy), JSON.stringify(cleanVisuals(plan.visuals)), 'draft', ai.model(), userId, now, now);
  return getLanding(info.lastInsertRowid);
}

/** تعديل النص أو الرابط قبل النشر (أو بعده ثم إعادة النشر) */
export function updateLanding(id, input) {
  const cur = getLanding(id);
  const copy = input.copy ? cleanCopy({ ...cur.copy, ...input.copy }) : cur.copy;
  const slug = input.slug !== undefined ? uniqueSlug(cur.project_id, latin(input.slug, 40) || cur.slug, id) : cur.slug;
  db.prepare('UPDATE landing_pages SET copy = ?, slug = ?, angle = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(copy), slug, clip(input.angle, 80) || cur.angle, nowIso(), id);
  return getLanding(id);
}

// ——— الصور الوصفية ———
const saveVisuals = (id, list) => db.prepare('UPDATE landing_pages SET visuals = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(list), nowIso(), id);

/** خطة الصور لمسودة قديمة (قبل الصور الوصفية) أو لإعادة التخطيط: تستبدل اللقطات كلها */
export async function planVisuals(id) {
  const l = getLanding(id);
  const p = getProduct(l.product_id);
  const cfg = projectConfig(l.project_id);
  const brand = cfg.brand_name || getProject(l.project_id).name;
  // الصورة الرئيسية وحدها + وصف صفحة المنتج: الشكل من الصورة والتفاصيل من الوصف
  const images = await imageBlocks(p.images, 1).catch(() => []);
  const layoutId = layoutFor(l.angle, l.framework, l.copy.layout);
  const layout = LAYOUTS[layoutId];
  // أقسام الزاوية التي لم تُكتب بعد (صفحة قديمة، أو فشل طلبها عند الإنشاء) تُكتب مع الخطة؛ المكتوبة لا تُلمس
  const empty = (x) => !x || !((x.items && x.items.length) || (x.without && x.without.length));
  const missing = layoutExtras(layoutId).filter((k) => empty(l.copy[k]));
  const raw = await ai.structured({
    system: landingSystem(brand).replace('{tone}', TONES[l.tone] || TONES.ar),
    prompt: `المعطيات (JSON):\n${JSON.stringify({ product: productFacts(p), angle: l.angle, delivery: deliveryFacts(l.project_id), layout: { id: layoutId, brief: layout.brief, shots: layout.shots }, headline: l.copy.hero?.headline, benefits: l.copy.benefits?.items, ...(l.copy.brief ? { angle_brief: briefFacts(l.copy.brief), product_facts: getInsight(p.id)?.facts || [] } : {}) }, null, 2)}\n\nالصورة المرفقة هي الصورة الرئيسية للمنتج، ووصفه في description_text. ${missing.length ? `اكتب أقسام التصميم الناقصة: ${missing.map((k) => extrasNames[k]).join('، ')} (القاعدة 13)، ثم ` : 'اكتب '}خطة الصور الوصفية (القاعدة 12) لهذه الصفحة.`,
    schema: planSchema(missing),
    effort: 'medium',
    images,
    meter: { projectId: l.project_id, kind: 'landing_plan' },
  });
  if (missing.length) db.prepare('UPDATE landing_pages SET copy = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(cleanCopy({ ...l.copy, ...Object.fromEntries(missing.map((k) => [k, raw[k]])) })), nowIso(), id);
  saveVisuals(id, cleanVisuals(raw.visuals));
  return getLanding(id);
}

const plainText = (html, n) =>
  String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

// لون الكتابة داخل الصور = لون تصميم الصفحة (نفس --lp-a في erp-lp.liquid): الصور والصفحة سلسلة واحدة
const ACCENTS = { gift: ['#be185d', 'deep rose'], problem: ['#0f766e', 'deep teal'], daily: ['#0369a1', 'ocean blue'], value: ['#a16207', 'warm gold'], family: ['#7c3aed', 'violet'], classic: ['#141821', 'near-black'] };

// نوع الصورة يحدد أسلوبها: كانت كل الصور «استوديو بخلفية نظيفة» فخرجت متشابهة
const KIND_STYLE = {
  hero: 'The hook of the page, like a top-performing Facebook ad key visual: the product large, sharp and centered in the foreground, the angle’s setting behind it, strong contrast, generous empty space at the top for the headline.',
  problem: 'Realistic everyday photo of the problem situation described in the scene, as the buyer lives it. The product is not the subject here; if it appears, only small on one side as the answer.',
  benefits: 'Clean product infographic: the product centered on a soft background lightly tinted with the accent color, with clear space around it for short labels, each label next to the real part it names with a thin pointer line.',
  feature: 'Demonstration photo: one real feature shown working, so it is understood without reading. The product is the clear subject.',
  in_use: 'Candid lifestyle photo of the product being used in a real place (home, school, office, car, outdoors), natural light.',
  outcome: 'Emotional lifestyle moment showing the result for the buyer (joy, calm, relief, pride), the product clearly visible in the scene.',
  gift: 'Gift moment: the product offered as a present, wrapping paper and a ribbon around it (never covering or changing the product), warm festive light.',
  detail: 'Macro photo of a real material, finish or part of the product, crisp texture, shallow depth of field.',
  design: 'Product design shot from a new angle on a styled surface that fits the angle.',
  size: 'Scale photo: the product next to a familiar everyday object so its real size is obvious, real proportions kept.',
  variants: 'All the real colors or models of the product side by side, same light and camera angle, as shown in the reference photos.',
};
const FRAMING_TEXT = {
  macro: 'macro close-up',
  close: 'close shot, the product fills most of the frame',
  medium: 'medium shot, the product and its immediate surroundings',
  wide: 'wide shot showing the whole setting, the product still clearly identifiable',
  top_down: 'top-down flat lay shot from directly above',
};

/**
 * تعليمات مولّد الصور: المنتج الذي في الصورة الرئيسية نفسه بالضبط (تطابق 100%)، وتفاصيله من وصف صفحة المنتج، في مشهد جديد
 * بأسلوب نوع الصورة (الخطاف، المشكلة، المزايا، الاستعمال…). الكتابة داخل الصورة افتراضياً (الصور هي وصف الصفحة):
 * العنوان شريط بلون تصميم الصفحة والتسميات بجانب ما تشير إليه، والتاجر يراجع الحروف قبل اعتماد الصورة.
 */
export function visualPrompt(p, v, { layout = 'classic', angle = '' } = {}) {
  const description = plainText(p.description_html, 900);
  const [hex, color] = ACCENTS[layout] || ACCENTS.classic;
  const text = Boolean(v.with_text && v.headline);
  const labels = text ? (v.points || []).filter(Boolean) : [];
  return [
    `${v.kind === 'variants' ? 'The attached photos are the real photos of the product' : 'The attached photo is the main photo of the real product'} "${p.title}". Create one new image of THIS exact product for its landing page${angle ? ` (marketing angle: ${angle})` : ''}.`,
    'Product fidelity must be 100%: identical shape, proportions, colors, prints and characters, logos, materials and parts as in the photo. Do not redesign, recolor, add or remove anything on the product, and do not add accessories that are not in the photo or the description.',
    description ? `Product description from its page (use it for real details only, never to change how it looks): ${description}` : '',
    `Image type: ${KIND_STYLE[v.kind] || KIND_STYLE.feature}`,
    `Scene: ${v.scene}`,
    v.framing && FRAMING_TEXT[v.framing] ? `Camera: ${FRAMING_TEXT[v.framing]}.` : '',
    'Style: photorealistic high-end commercial photography, natural believable light, sharp focus on the product, portrait 4:5 composition for a phone screen.',
    text
      ? [
          `Text in the image (same design on every image of this page): a bold rounded banner filled with ${hex} (${color}) with white bold modern Arabic sans-serif type, soft shadow; labels are small rounded tags in white with ${hex} text.`,
          `Write ONLY these Arabic texts, each exactly once, spelled exactly as given, letters correctly joined, right-to-left, large and legible on a phone, in empty space and never covering the product: headline banner «${v.headline}»${labels.length ? `; labels ${labels.map((x) => `«${x}»`).join(', ')}` : ''}.`,
          'No other text, numbers, prices, logos or watermarks.',
        ].join('\n')
      : 'Do not write any text, letters, numbers, prices, logos or watermarks anywhere in the image.',
    'People may appear only as hands, seen from behind, or with the face out of frame: no visible faces. The product stays the clear subject.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** رسم لقطة واحدة (التاجر يرسمها واحدة واحدة ليراجعها، أو كلها بالتتابع من الواجهة) */
export async function generateVisual(id, vid) {
  const l = getLanding(id);
  const v = l.visuals.find((x) => x.id === vid);
  if (!v) throw new HttpError(404, 'visual_not_found');
  const p = getProduct(l.product_id);
  // الصورة الرئيسية وحدها، إلا صورة الألوان: تحتاج صور الألوان الحقيقية كلها حتى لا يخترع المولّد لوناً
  const sources = (p.images || []).map((i) => i.url).filter((u) => /^https:\/\//.test(u || '') || uploadPath(u)).slice(0, v.kind === 'variants' ? 4 : 1);
  if (!sources.length) throw badRequest('visual_needs_product_photos');
  const prompt = visualPrompt(p, v, { layout: layoutFor(l.angle, l.framework, l.copy.layout), angle: l.angle });
  const [img] = await generateImages(l.project_id, { prompt, sourceUrls: sources, count: 1, aspect: '4:5', product: { id: p.id, title: p.title }, kind: 'landing_image' });
  db.prepare('INSERT INTO creatives (project_id, product_id, kind, file, url, prompt, provider) VALUES (?, ?, ?, ?, ?, ?, ?)').run(l.project_id, p.id, 'image', img.file, img.url, prompt, imageProvider());
  // قراءة جديدة: لقطات أخرى قد تكون رُسمت في الأثناء
  const fresh = getLanding(id).visuals.map((x) => (x.id === vid ? { ...x, image: img.url, drawn_with_text: Boolean(v.with_text && v.headline), shopify_url: null, width: null, height: null, approved: true } : x));
  saveVisuals(id, fresh);
  return getLanding(id);
}

/** تعديل اللقطة: إظهارها أو إخفاؤها، عنوانها ونقاطها، أو مشهدها (ثم إعادة الرسم) */
export function updateVisual(id, vid, input) {
  const l = getLanding(id);
  if (!l.visuals.some((x) => x.id === vid)) throw new HttpError(404, 'visual_not_found');
  const list = l.visuals.map((x) => {
    if (x.id !== vid) return x;
    const next = { ...x };
    if (input.approved !== undefined) next.approved = Boolean(input.approved);
    if (input.headline !== undefined) next.headline = clip(input.headline, 90);
    if (input.points !== undefined) next.points = (Array.isArray(input.points) ? input.points : String(input.points).split(/\n+/)).map((t) => clip(t, 40)).filter(Boolean).slice(0, 3);
    if (input.scene !== undefined && clip(input.scene, 700)) next.scene = clip(input.scene, 700);
    // الخطاف أيضاً: عنوانه داخل الصورة، والعنوان الحيّ يُخفى بصرياً في الصفحة (يبقى لمحركات البحث وقارئ الشاشة)
    if (input.with_text !== undefined) next.with_text = Boolean(input.with_text);
    if (input.framing !== undefined) next.framing = FRAMINGS.includes(input.framing) ? input.framing : null;
    return next;
  });
  saveVisuals(id, list);
  return getLanding(id);
}

const readyVisuals = (list) => (list || []).filter((x) => x.approved && x.image);

/** رفع الصور الموافق عليها إلى Shopify مرة واحدة (إعادة النشر لا تعيد الرفع) */
async function uploadVisuals(cfg, l, title) {
  const list = [...l.visuals];
  for (const [i, x] of list.entries()) {
    if (!x.approved || !x.image || x.shopify_url) continue;
    const file = uploadPath(x.image);
    if (!file || !fs.existsSync(file)) continue;
    const ext = file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'jpg' : file.endsWith('.webp') ? 'webp' : 'png';
    const up = await shopify.uploadFile(cfg, {
      buffer: fs.readFileSync(file),
      filename: `lp-${l.slug}-${x.id}.${ext}`,
      mimeType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
      alt: [title, x.headline].filter(Boolean).join(' · '),
    });
    list[i] = { ...x, shopify_url: up.url, shopify_file_id: up.id || null, width: up.width, height: up.height };
    saveVisuals(l.id, list); // بعد كل صورة: فشلٌ في الوسط لا يعيد رفع ما نجح
  }
  return list;
}

// ——— ملفات القالب ———
const paragraphs = (t) =>
  String(t || '')
    .split(/\r?\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => `<p>${escapeHtml(x)}</p>`)
    .join('');

// صفحة بالصور: الخطاف ← الثقة ← 3 صور ← خطوات الطلب ← [النموذج] ← بقية الصور ← ما يجيب عن الاعتراضات
const BOARD = { top: ['hero', 'trust', 'visuals:3', 'steps'], bottom: ['visuals', 'specs', 'guarantee', 'delivery', 'faq', 'cta'] };

/**
 * قالب صفحة الهبوط حسب تصميم الزاوية (LAYOUTS): قسم أعلى (الإقناع) ← قسم المنتج نفسه (المعرض، السعر، العروض، النموذج)
 * ← قسم أسفل (الاعتراضات). الصور الوصفية تحلّ محل صور المنتج الأصلية وتتوزع حسب التصميم.
 */
export function buildTemplate(copy, productTpl, { visuals = [], delivery = null, layout = 'classic' } = {}) {
  const main = structuredClone(productTpl?.sections?.main);
  if (!main || main.type !== 'product-main') throw new HttpError(409, 'landing_theme_unsupported');
  main.settings = { ...(main.settings || {}), layout: 'stack', show_breadcrumb: false, show_sticky: true };
  // الوصف الطويل يحلّ محله نص الصفحة: صفحة مركّزة على الطلب
  walkBlocks(main, (b) => {
    if (b.type === '_pdp-description') b.disabled = true;
  });
  const L = LAYOUTS[layout] || LAYOUTS.classic;
  let n = 0;
  const block = (type, settings) => [`${type}_${++n}`, { type, settings }];
  const shots = visuals.filter((x) => x.shopify_url);
  const heroShot = shots.find((x) => x.kind === 'hero') || shots[0] || null;
  const queue = shots.filter((x) => x !== heroShot);
  // صفحة بالصور (3 صور مكتوبة على الأقل): الخطاف ثم الصور متتابعة هي الوصف، لا فقرة ثم صورة ثم فقرة؛
  // النص الحيّ يبقى لما يطمئن (الثقة، خطوات الطلب، الخصائص، الضمانات، التوصيل، الأسئلة)
  const board = shots.filter((x) => x.drawn_with_text).length >= 3;
  const plan = board ? BOARD : L;
  // صورة رُسم عنوانها داخلها لا يُكرَّر عنوانها تحتها
  const caption = (x) => (x.drawn_with_text ? '' : x.headline);
  const visual = (x) => block('visual', { image_url: x.shopify_url, width: x.width || 928, height: x.height || 1152, headline: caption(x), points: (x.points || []).join('\n'), alt: x.headline });
  let photosShown = false;
  // لا صور وصفية: صور المنتج الأصلية مرة واحدة في أول مكان مخصص للصور
  const photos = () => (shots.length || photosShown ? [] : ((photosShown = true), [block('images', { offset: 1, count: 3 })]));
  const take = (k) => queue.splice(0, k);
  const story = copy.story || [];
  const para = (x, i) => block('text', { heading: x.heading, body: paragraphs(x.body) || `<p>${escapeHtml(x.body)}</p>`, tone: layout === 'problem' && i === 0 ? 'alert' : i % 2 ? 'soft' : 'plain' });
  const trust = copy.trust?.length ? copy.trust : ['الدفع عند الاستلام', ...(delivery?.served ? ['التوصيل إلى جميع الولايات'] : []), 'اتصال تأكيد قبل الشحن'];
  const parts = {
    hero: () => [block('hero', { eyebrow: copy.hero.eyebrow, headline: copy.hero.headline, subheadline: copy.hero.subheadline, bullets: copy.hero.bullets.join('\n'), cta: copy.hero.cta, note: copy.hero.note, show_image: true, image_url: heroShot?.shopify_url || '', image_width: heroShot?.width || 928, image_height: heroShot?.height || 1152, image_text: Boolean(heroShot?.drawn_with_text) })],
    trust: () => [block('trust', { items: trust.join('\n') })],
    story: () => story.flatMap((x, i) => [para(x, i), ...take(1).map(visual)]),
    'story:first': () => (story[0] ? [para(story[0], 0)] : []),
    'story:rest': () => story.slice(1).flatMap((x, i) => [para(x, i + 1), ...take(1).map(visual)]),
    occasions: () => (copy.occasions?.items?.length ? [block('occasions', { heading: copy.occasions.heading, items: copy.occasions.items.join('\n') })] : []),
    compare: () =>
      copy.compare?.without?.length && copy.compare?.with?.length
        ? [block('compare', { heading: copy.compare.heading, without_label: copy.compare.without_label || 'بدونه', with_label: copy.compare.with_label || 'معه', without: copy.compare.without.join('\n'), with: copy.compare.with.join('\n') })]
        : [],
    moments: () => (copy.moments?.items?.length ? [block('moments', { heading: copy.moments.heading, items: copy.moments.items.map((x) => `${x.when} | ${x.text}`).join('\n') })] : []),
    specs: () => (copy.specs?.items?.length ? [block('specs', { heading: copy.specs.heading, items: copy.specs.items.map((x) => `${x.label} | ${x.value}`).join('\n') })] : []),
    gallery: () => {
      const pair = take(2);
      if (pair.length === 2) return [block('gallery', { image_1: pair[0].shopify_url, width_1: pair[0].width || 928, height_1: pair[0].height || 1152, caption_1: caption(pair[0]), image_2: pair[1].shopify_url, width_2: pair[1].width || 928, height_2: pair[1].height || 1152, caption_2: caption(pair[1]) })];
      return pair.length ? pair.map(visual) : photos();
    },
    visual: () => {
      const one = take(1);
      return one.length ? one.map(visual) : photos();
    },
    'visuals:2': () => {
      const two = take(2);
      return two.length ? two.map(visual) : photos();
    },
    'visuals:3': () => take(3).map(visual),
    visuals: () => queue.splice(0).map(visual),
    benefits: () => (copy.benefits.items.length ? [block('benefits', { heading: copy.benefits.heading, items: copy.benefits.items.map((x) => `${x.title} | ${x.text}`).join('\n') })] : []),
    steps: () => (copy.steps.items.length ? [block('steps', { heading: copy.steps.heading, items: copy.steps.items.join('\n') })] : []),
    delivery: () => (delivery ? [block('delivery', delivery)] : []),
    guarantee: () => (copy.guarantee.items.length ? [block('guarantee', { heading: copy.guarantee.heading, items: copy.guarantee.items.join('\n') })] : []),
    faq: () => copy.faq.map((x) => block('faq', { q: x.q, a: x.a })),
    cta: () => [block('cta', { headline: copy.final_cta.headline, cta: copy.final_cta.cta, note: copy.final_cta.note })],
  };
  // الترتيب في المصفوفة = ترتيب الصفحة، والمعرّفات (hero_1، trust_2…) تُعطى بنفس الترتيب
  const top = plan.top.flatMap((k) => parts[k]());
  // صور المنتج الأصلية تبقى فوق النموذج إن لم يجد التصميم مكاناً لها
  if (!shots.length && !photosShown) top.push(...photos());
  const bottom = plan.bottom.flatMap((k) => parts[k]());
  const section = (list) => ({ type: 'erp-lp', blocks: Object.fromEntries(list), block_order: list.map(([id]) => id), settings: { style: L === LAYOUTS.classic ? 'classic' : layout, board } });
  return { layout: 'erp-landing', sections: { lp_top: section(top), main, lp_bottom: section(bottom) }, order: ['lp_top', 'main', 'lp_bottom'] };
}

/** إعدادات بلوك التوصيل: الأسعار تُحسب في القالب من shipping_table نفسه (تبقى صحيحة إن تغيّرت)، وهذه احتياط */
export function deliveryBlock(d) {
  if (!d || (!d.imported_at && !d.delivery_time)) return null;
  return {
    heading: 'التوصيل والدفع',
    carriers: d.carriers || '',
    time: d.delivery_time || 'تختلف حسب الولاية، ونؤكدها لك عند اتصال التأكيد',
    served: d.summary.served || 0,
    desk_from: d.summary.desk?.min || 0,
    home_from: d.summary.home?.min || 0,
  };
}

/** تخطيط صفحات الهبوط: theme.liquid نفسه دون الرأس والتذييل وزر واتساب (لا مخارج من الصفحة) */
export function landingLayout(themeLayout) {
  const src = String(themeLayout || '');
  if (!src.includes('content_for_header') || !src.includes('content_for_layout')) throw new HttpError(409, 'landing_theme_unsupported');
  const out = src
    .replace(/\{%-?\s*render\s+'erp-split'\s*-?%\}(?:[ \t]*%\})+/g, "{% render 'erp-split' %}")
    .replace(/^[ \t]*\{%-?\s*sections?\s+'(?:header-group|footer-group|header|footer|announcement-bar)'\s*-?%\}[ \t]*\r?\n?/gm, '')
    .replace(/^[ \t]*\{%-?\s*render\s+'whatsapp-button'\s*-?%\}[ \t]*\r?\n?/gm, '');
  return `{%- comment -%} ERP TOURECHE · تخطيط صفحات الهبوط: theme.liquid دون الرأس والتذييل. يُعاد توليده عند النشر من الـ ERP. {%- endcomment -%}\n${out}`;
}

export function sectionLiquid() {
  return `{%- comment -%}
  ERP TOURECHE · نصوص صفحة الهبوط (كتبها الـ ERP، ويمكن تعديلها هنا). في قوالب المنتج فقط: الصورة والسعر من منتج الصفحة نفسه.
{%- endcomment -%}
{%- assign lp_v = product.selected_or_first_available_variant -%}
<div class="erp-lp erp-lp--{{ section.settings.style | default: 'classic' }}{% if section.settings.board %} erp-lp--board{% endif %}" data-erp-lp>
  {%- for block in section.blocks -%}
    {%- case block.type -%}
      {%- when 'hero' -%}
        {%- comment -%} image_text: العنوان والفوائد مكتوبة داخل صورة الخطاف، فالنص الحيّ يُخفى بصرياً (يبقى للبحث وقارئ الشاشة) {%- endcomment -%}
        <header class="erp-lp__hero{% if block.settings.image_text and block.settings.image_url != blank %} erp-lp__hero--img{% endif %}" {{ block.shopify_attributes }}>
          {%- if block.settings.eyebrow != blank -%}<p class="erp-lp__eyebrow">{{ block.settings.eyebrow | escape }}</p>{%- endif -%}
          <h1 class="erp-lp__h1">{{ block.settings.headline | escape }}</h1>
          {%- if block.settings.subheadline != blank -%}<p class="erp-lp__lead">{{ block.settings.subheadline | escape }}</p>{%- endif -%}
          {%- if block.settings.show_image and block.settings.image_url != blank -%}
            {%- assign src = block.settings.image_url | escape -%}{%- assign sep = '?' -%}{%- if src contains '?' -%}{%- assign sep = '&amp;' -%}{%- endif -%}
            <div class="erp-lp__media"><img src="{{ src }}{{ sep }}width=900" srcset="{{ src }}{{ sep }}width=480 480w, {{ src }}{{ sep }}width=720 720w, {{ src }}{{ sep }}width=1000 1000w" sizes="(min-width: 760px) 720px, 100vw" width="{{ block.settings.image_width | default: 928 }}" height="{{ block.settings.image_height | default: 1152 }}" loading="eager" fetchpriority="high" alt="{{ product.title | escape }}"></div>
          {%- elsif block.settings.show_image and product.featured_media -%}
            <div class="erp-lp__media">{{ product.featured_media | image_url: width: 1100 | image_tag: widths: '400, 700, 1100', sizes: '(min-width: 760px) 720px, 100vw', loading: 'eager', fetchpriority: 'high', alt: product.title }}</div>
          {%- endif -%}
          {%- assign lines = block.settings.bullets | newline_to_br | split: '<br />' -%}
          <ul class="erp-lp__ticks">{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ul>
          <p class="erp-lp__price"><b>{{ lp_v.price | money_without_trailing_zeros }}</b>{%- if lp_v.compare_at_price > lp_v.price -%} <s>{{ lp_v.compare_at_price | money_without_trailing_zeros }}</s>{%- endif -%}</p>
          <button type="button" class="rw-b rw-o erp-lp__cta" data-erp-to-form>{{ block.settings.cta | default: 'اطلب الآن' | escape }}</button>
          {%- if block.settings.note != blank -%}<p class="erp-lp__note">{{ block.settings.note | escape }}</p>{%- endif -%}
        </header>
      {%- when 'trust' -%}
        {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
        <ul class="erp-lp__trust" {{ block.shopify_attributes }}>{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ul>
      {%- when 'occasions' -%}
        <section class="erp-lp__block erp-lp__block--tint" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
          <ul class="erp-lp__chips erp-lp__chips--big">{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ul>
        </section>
      {%- when 'compare' -%}
        <section class="erp-lp__block" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          <div class="erp-lp__compare">
            <div class="erp-lp__col erp-lp__col--no">
              <h3>{{ block.settings.without_label | default: 'بدونه' | escape }}</h3>
              {%- assign lines = block.settings.without | newline_to_br | split: '<br />' -%}
              <ul>{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ul>
            </div>
            <div class="erp-lp__col erp-lp__col--yes">
              <h3>{{ block.settings.with_label | default: 'معه' | escape }}</h3>
              {%- assign lines = block.settings.with | newline_to_br | split: '<br />' -%}
              <ul>{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ul>
            </div>
          </div>
        </section>
      {%- when 'moments' -%}
        <section class="erp-lp__block" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
          <ol class="erp-lp__timeline">
            {%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}
              {%- assign parts = t | split: '|' -%}{%- assign rest = t | remove_first: parts.first | remove_first: '|' | strip -%}
              <li><b>{{ parts.first | strip | escape }}</b>{%- if rest != blank -%}<span>{{ rest | escape }}</span>{%- endif -%}</li>
            {%- endif -%}{%- endfor -%}
          </ol>
        </section>
      {%- when 'specs' -%}
        <section class="erp-lp__block erp-lp__block--soft" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
          <dl class="erp-lp__specs">
            {%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}
              {%- assign parts = t | split: '|' -%}{%- assign rest = t | remove_first: parts.first | remove_first: '|' | strip -%}
              <div><dt>{{ parts.first | strip | escape }}</dt><dd>{{ rest | escape }}</dd></div>
            {%- endif -%}{%- endfor -%}
          </dl>
        </section>
      {%- when 'gallery' -%}
        <div class="erp-lp__gallery" {{ block.shopify_attributes }}>
          {%- for i in (1..2) -%}
            {%- assign k = 'image_' | append: i -%}{%- assign wk = 'width_' | append: i -%}{%- assign hk = 'height_' | append: i -%}{%- assign ck = 'caption_' | append: i -%}
            {%- if block.settings[k] != blank -%}
              {%- assign src = block.settings[k] | escape -%}{%- assign sep = '?' -%}{%- if src contains '?' -%}{%- assign sep = '&amp;' -%}{%- endif -%}
              <figure>
                <img src="{{ src }}{{ sep }}width=600" srcset="{{ src }}{{ sep }}width=360 360w, {{ src }}{{ sep }}width=600 600w" sizes="(min-width: 760px) 352px, 50vw" width="{{ block.settings[wk] | default: 928 }}" height="{{ block.settings[hk] | default: 1152 }}" loading="lazy" decoding="async" alt="{{ block.settings[ck] | default: product.title | escape }}">
                {%- if block.settings[ck] != blank -%}<figcaption>{{ block.settings[ck] | escape }}</figcaption>{%- endif -%}
              </figure>
            {%- endif -%}
          {%- endfor -%}
        </div>
      {%- when 'text' -%}
        <section class="erp-lp__block{% if block.settings.tone == 'soft' %} erp-lp__block--soft{% elsif block.settings.tone == 'alert' %} erp-lp__block--alert{% endif %}" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          <div class="erp-lp__rte">{{ block.settings.body }}</div>
        </section>
      {%- when 'images' -%}
        <div class="erp-lp__images" {{ block.shopify_attributes }}>
          {%- for m in product.media offset: block.settings.offset limit: block.settings.count -%}
            {%- if m.media_type == 'image' -%}{{ m | image_url: width: 1100 | image_tag: widths: '400, 700, 1100', sizes: '(min-width: 760px) 720px, 100vw', loading: 'lazy', alt: product.title }}{%- endif -%}
          {%- endfor -%}
        </div>
      {%- when 'visual' -%}
        {%- if block.settings.image_url != blank -%}
          {%- assign src = block.settings.image_url | escape -%}{%- assign sep = '?' -%}{%- if src contains '?' -%}{%- assign sep = '&amp;' -%}{%- endif -%}
          <figure class="erp-lp__visual" {{ block.shopify_attributes }}>
            <img src="{{ src }}{{ sep }}width=900" srcset="{{ src }}{{ sep }}width=480 480w, {{ src }}{{ sep }}width=720 720w, {{ src }}{{ sep }}width=1000 1000w" sizes="(min-width: 760px) 720px, 100vw" width="{{ block.settings.width | default: 928 }}" height="{{ block.settings.height | default: 1152 }}" loading="lazy" decoding="async" alt="{{ block.settings.alt | default: block.settings.headline | escape }}">
            {%- if block.settings.headline != blank -%}
              <figcaption>
                <h2 class="erp-lp__h2">{{ block.settings.headline | escape }}</h2>
                {%- assign lines = block.settings.points | newline_to_br | split: '<br />' -%}
                <ul class="erp-lp__chips">{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ul>
              </figcaption>
            {%- endif -%}
          </figure>
        {%- endif -%}
      {%- when 'delivery' -%}
        {%- comment -%} الأسعار من جدول التوصيل في إعدادات القالب نفسه (نفس مصدر الفورم)، وإلا الأرقام المحفوظة في البلوك {%- endcomment -%}
        {%- assign d_from = block.settings.desk_from | plus: 0 -%}
        {%- assign h_from = block.settings.home_from | plus: 0 -%}
        {%- assign served = block.settings.served | plus: 0 -%}
        {%- if settings.shipping_table != blank -%}
          {%- assign d_from = 0 -%}{%- assign h_from = 0 -%}{%- assign served = 0 -%}
          {%- assign rows = settings.shipping_table | newline_to_br | split: '<br />' -%}
          {%- for row in rows -%}
            {%- assign p = row | strip | split: '|' -%}
            {%- if p.size < 3 -%}{%- continue -%}{%- endif -%}
            {%- assign code_n = p[0] | strip | plus: 0 -%}
            {%- if code_n < 1 or code_n > 69 -%}{%- continue -%}{%- endif -%}
            {%- assign h = p[2] | strip -%}{%- assign dk = p[3] | strip -%}
            {%- assign served = served | plus: 1 -%}
            {%- if h != blank -%}{%- assign hn = h | plus: 0 -%}{%- if h_from == 0 or hn < h_from -%}{%- assign h_from = hn -%}{%- endif -%}{%- endif -%}
            {%- if dk != blank -%}{%- assign dn = dk | plus: 0 -%}{%- if d_from == 0 or dn < d_from -%}{%- assign d_from = dn -%}{%- endif -%}{%- endif -%}
          {%- endfor -%}
        {%- endif -%}
        <section class="erp-lp__block erp-lp__block--soft" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          <ul class="erp-lp__ticks">
            {%- if served > 0 -%}<li>{% if served >= 58 %}التوصيل إلى جميع الولايات{% else %}التوصيل إلى {{ served }} {% if served >= 3 and served <= 10 %}ولايات{% else %}ولاية{% endif %}{% endif %}{% if block.settings.carriers != blank %} عبر {{ block.settings.carriers | escape }}{% endif %}، إلى مكتب شركة التوصيل أو إلى باب المنزل</li>{%- endif -%}
            {%- if d_from > 0 or h_from > 0 -%}<li>{% if d_from > 0 %}المكتب من {{ d_from | times: 100 | money_without_trailing_zeros }}{% endif %}{% if d_from > 0 and h_from > 0 %} · {% endif %}{% if h_from > 0 %}المنزل من {{ h_from | times: 100 | money_without_trailing_zeros }}{% endif %}. السعر الدقيق لولايتك يظهر في نموذج الطلب قبل التأكيد.</li>{%- endif -%}
            {%- if block.settings.time != blank -%}<li>مدة التوصيل: {{ block.settings.time | escape }}</li>{%- endif -%}
            <li>الدفع نقداً عند الاستلام، بعد معاينة الطرد.</li>
          </ul>
        </section>
      {%- when 'benefits' -%}
        <section class="erp-lp__block" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
          <ul class="erp-lp__grid">
            {%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}
              {%- assign parts = t | split: '|' -%}{%- assign rest = t | remove_first: parts.first | remove_first: '|' | strip -%}
              <li><b>{{ parts.first | strip | escape }}</b>{%- if rest != blank -%}<span>{{ rest | escape }}</span>{%- endif -%}</li>
            {%- endif -%}{%- endfor -%}
          </ul>
        </section>
      {%- when 'steps' -%}
        <section class="erp-lp__block" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
          <ol class="erp-lp__steps">{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ol>
        </section>
      {%- when 'guarantee' -%}
        <section class="erp-lp__block erp-lp__block--soft" {{ block.shopify_attributes }}>
          {%- if block.settings.heading != blank -%}<h2 class="erp-lp__h2">{{ block.settings.heading | escape }}</h2>{%- endif -%}
          {%- assign lines = block.settings.items | newline_to_br | split: '<br />' -%}
          <ul class="erp-lp__ticks">{%- for l in lines -%}{%- assign t = l | strip -%}{%- if t != blank -%}<li>{{ t | escape }}</li>{%- endif -%}{%- endfor -%}</ul>
        </section>
      {%- when 'faq' -%}
        <details class="erp-lp__faq" {{ block.shopify_attributes }}>
          <summary>{{ block.settings.q | escape }}</summary>
          <p>{{ block.settings.a | escape }}</p>
        </details>
      {%- when 'cta' -%}
        <section class="erp-lp__final" {{ block.shopify_attributes }}>
          {%- if block.settings.headline != blank -%}<h2 class="erp-lp__h2">{{ block.settings.headline | escape }}</h2>{%- endif -%}
          <button type="button" class="rw-b rw-o erp-lp__cta" data-erp-to-form>{{ block.settings.cta | default: 'اطلب الآن' | escape }}</button>
          {%- if block.settings.note != blank -%}<p class="erp-lp__note">{{ block.settings.note | escape }}</p>{%- endif -%}
        </section>
    {%- endcase -%}
  {%- endfor -%}
</div>
<style>
  .erp-lp{--lp-a:var(--btn,#141821);--lp-t:color-mix(in srgb,var(--lp-a) 8%,var(--card,#fff));--lp-no:#b42318;max-width:720px;margin-inline:auto;padding:24px 16px 8px;display:grid;gap:20px;color:var(--text)}
  .erp-lp--gift{--lp-a:#be185d}.erp-lp--problem{--lp-a:#0f766e}.erp-lp--daily{--lp-a:#0369a1}.erp-lp--value{--lp-a:#a16207}.erp-lp--family{--lp-a:#7c3aed}
  .erp-lp__hero{display:grid;gap:12px;text-align:center}
  .erp-lp--gift .erp-lp__hero,.erp-lp--family .erp-lp__hero{background:var(--lp-t);border-radius:var(--radius-lg,20px);padding:14px 14px 18px}
  .erp-lp--gift .erp-lp__hero .erp-lp__media,.erp-lp--daily .erp-lp__hero .erp-lp__media,.erp-lp--value .erp-lp__hero .erp-lp__media,.erp-lp--family .erp-lp__hero .erp-lp__media{order:-1}
  .erp-lp--value .erp-lp__price{font-size:1.7em}
  .erp-lp__eyebrow{margin:0;justify-self:center;padding:4px 12px;border-radius:999px;background:var(--lp-t);font-size:.85em;font-weight:700;color:var(--lp-a)}
  .erp-lp__h1{margin:0;font-family:var(--font-h,inherit);font-size:clamp(1.5rem,6vw,2.2rem);line-height:1.3}
  .erp-lp__hero--img .erp-lp__media{order:-1}
  .erp-lp__hero--img .erp-lp__eyebrow,.erp-lp__hero--img .erp-lp__lead,.erp-lp__hero--img .erp-lp__ticks{display:none}
  .erp-lp__hero--img .erp-lp__h1{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .erp-lp--board{gap:12px}.erp-lp--board .erp-lp__visual{border-radius:var(--radius,12px)}
  .erp-lp__lead{margin:0;font-size:1.05em;opacity:.85;line-height:1.7}
  .erp-lp__media img,.erp-lp__images img{display:block;width:100%;height:auto;border-radius:var(--radius,12px)}
  .erp-lp__images{display:grid;gap:12px}
  .erp-lp__visual{margin:0;display:grid;background:var(--card,#fff);border-radius:var(--radius-lg,16px);overflow:hidden}
  .erp-lp__visual img{display:block;width:100%;height:auto}
  .erp-lp__visual figcaption{display:grid;gap:10px;padding:14px 16px 16px}
  .erp-lp__chips{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px}
  .erp-lp__chips li{padding:6px 12px;border-radius:999px;background:color-mix(in srgb,currentColor 8%,transparent);font-size:.9em;font-weight:600;line-height:1.5}
  .erp-lp__price{margin:0;font-size:1.4em}.erp-lp__price s{opacity:.55;font-size:.7em;margin-inline-start:8px}
  .erp-lp__cta{width:100%;min-height:52px;font-size:1.05em}
  .erp-lp__note{margin:0;font-size:.85em;opacity:.75}
  .erp-lp__block{display:grid;gap:10px;line-height:1.8}
  .erp-lp__block--soft{background:var(--card,#fff);border-radius:var(--radius-lg,16px);padding:18px}
  .erp-lp__h2{margin:0;font-family:var(--font-h,inherit);font-size:1.3em;line-height:1.4}
  .erp-lp__rte p{margin:0 0 .6em}
  .erp-lp__ticks,.erp-lp__grid,.erp-lp__steps{margin:0;padding:0;list-style:none;display:grid;gap:10px;text-align:start}
  .erp-lp__ticks li{position:relative;padding-inline-start:28px;line-height:1.7}
  .erp-lp__ticks li::before{content:"✓";position:absolute;inset-inline-start:0;top:0;color:var(--lp-a);font-weight:700}
  .erp-lp__trust{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .erp-lp__trust li{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:var(--radius,12px);background:var(--lp-t);font-weight:600;font-size:.9em;line-height:1.4}
  .erp-lp__trust li::before{content:"✓";flex:0 0 22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--lp-a);color:#fff;font-size:.8em}
  .erp-lp__block--tint{background:var(--lp-t);border-radius:var(--radius-lg,16px);padding:18px}
  .erp-lp__block--alert{background:color-mix(in srgb,var(--lp-no) 7%,var(--card,#fff));border-inline-start:4px solid var(--lp-no);border-radius:var(--radius,12px);padding:16px 18px}
  .erp-lp__chips--big li{padding:8px 14px;background:var(--card,#fff);color:var(--lp-a);font-size:.95em}
  .erp-lp__compare{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .erp-lp__col{display:grid;align-content:start;gap:8px;border-radius:var(--radius,12px);padding:12px}
  .erp-lp__col h3{margin:0;font-size:1em}
  .erp-lp__col ul{margin:0;padding:0;list-style:none;display:grid;gap:8px}
  .erp-lp__col li{position:relative;padding-inline-start:22px;font-size:.92em;line-height:1.6}
  .erp-lp__col--no{background:color-mix(in srgb,var(--lp-no) 6%,var(--card,#fff))}.erp-lp__col--no h3{color:var(--lp-no)}
  .erp-lp__col--no li::before{content:"✕";position:absolute;inset-inline-start:0;color:var(--lp-no);font-weight:700}
  .erp-lp__col--yes{background:var(--lp-t);box-shadow:inset 0 0 0 2px var(--lp-a)}.erp-lp__col--yes h3{color:var(--lp-a)}
  .erp-lp__col--yes li::before{content:"✓";position:absolute;inset-inline-start:0;color:var(--lp-a);font-weight:700}
  .erp-lp__timeline{margin:0;padding:0;list-style:none;display:grid;gap:14px;border-inline-start:2px solid var(--lp-t)}
  .erp-lp__timeline li{position:relative;display:grid;gap:2px;padding-inline-start:20px;line-height:1.7}
  .erp-lp__timeline li::before{content:"";position:absolute;inset-inline-start:-7px;top:.45em;width:12px;height:12px;border-radius:50%;background:var(--lp-a)}
  .erp-lp__timeline b{color:var(--lp-a)}
  .erp-lp__specs{margin:0;display:grid}
  .erp-lp__specs div{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent)}
  .erp-lp__specs div:last-child{border-bottom:0}
  .erp-lp__specs dt{opacity:.75}.erp-lp__specs dd{margin:0;font-weight:700;text-align:end}
  .erp-lp__gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .erp-lp__gallery figure{margin:0;display:grid;gap:6px}
  .erp-lp__gallery img{display:block;width:100%;height:auto;border-radius:var(--radius,12px)}
  .erp-lp__gallery figcaption{font-weight:600;font-size:.9em;line-height:1.5;text-align:center}
  .erp-lp__grid li{display:grid;gap:4px;background:var(--card,#fff);border-radius:var(--radius,12px);padding:14px}
  .erp-lp__grid span{opacity:.8;font-size:.95em}
  .erp-lp__steps{counter-reset:s}
  .erp-lp__steps li{counter-increment:s;display:flex;gap:12px;align-items:flex-start;line-height:1.7}
  .erp-lp__steps li::before{content:counter(s);flex:0 0 30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--lp-a);color:#fff;font-weight:700}
  .erp-lp__faq{background:var(--card,#fff);border-radius:var(--radius,12px);padding:14px 16px}
  .erp-lp__faq summary{cursor:pointer;font-weight:600;line-height:1.6}
  .erp-lp__faq p{margin:10px 0 0;line-height:1.8;opacity:.85}
  .erp-lp__final{display:grid;gap:12px;text-align:center;padding:8px 0 24px}
</style>
<script>
  (function(){
    if (window.erpLpScroll) return; window.erpLpScroll = true;
    document.addEventListener('click', function(e){
      var b = e.target.closest('[data-erp-to-form]'); if (!b) return;
      var f = document.querySelector('[data-lead-form]'); if (!f) return;
      e.preventDefault();
      var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: f.getBoundingClientRect().top + window.scrollY - 80, behavior: calm ? 'auto' : 'smooth' });
      var i = f.querySelector('input:not([type=hidden]):not([data-hp])'); if (i) setTimeout(function(){ i.focus({ preventScroll: true }); }, 450);
    });
  })();
</script>

{% schema %}
{
  "name": "ERP · صفحة هبوط",
  "tag": "section",
  "class": "erp-lp-s",
  "enabled_on": { "templates": ["product"] },
  "settings": [
    { "type": "select", "id": "style", "label": "التصميم", "default": "classic", "options": [
      { "value": "classic", "label": "كلاسيكي" }, { "value": "gift", "label": "هدية" }, { "value": "problem", "label": "المشكلة والحل" },
      { "value": "daily", "label": "الاستعمال اليومي" }, { "value": "value", "label": "الجودة مقابل السعر" }, { "value": "family", "label": "الأطفال والعائلة" }
    ] },
    { "type": "checkbox", "id": "board", "label": "صفحة بالصور (الصور متتابعة هي الوصف)", "default": false }
  ],
  "blocks": [
    { "type": "trust", "name": "شريط الثقة", "settings": [
      { "type": "textarea", "id": "items", "label": "سطر لكل نقطة" }
    ] },
    { "type": "occasions", "name": "المناسبات / لمن", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "textarea", "id": "items", "label": "سطر لكل مناسبة" }
    ] },
    { "type": "compare", "name": "بدونه / معه", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "text", "id": "without_label", "label": "عنوان العمود الأول", "default": "بدونه" },
      { "type": "text", "id": "with_label", "label": "عنوان العمود الثاني", "default": "معه" },
      { "type": "textarea", "id": "without", "label": "سطر لكل نقطة (بدونه)" },
      { "type": "textarea", "id": "with", "label": "سطر لكل نقطة (معه)" }
    ] },
    { "type": "moments", "name": "يوم مع المنتج", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "textarea", "id": "items", "label": "سطر لكل لحظة: الوقت | النص" }
    ] },
    { "type": "specs", "name": "الخصائص", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "textarea", "id": "items", "label": "سطر لكل خاصية: الخاصية | القيمة" }
    ] },
    { "type": "gallery", "name": "صورتان متجاورتان", "settings": [
      { "type": "text", "id": "image_1", "label": "الصورة 1 (رابط Fichiers)" },
      { "type": "number", "id": "width_1", "label": "عرض 1", "default": 928 },
      { "type": "number", "id": "height_1", "label": "ارتفاع 1", "default": 1152 },
      { "type": "text", "id": "caption_1", "label": "تعليق 1" },
      { "type": "text", "id": "image_2", "label": "الصورة 2 (رابط Fichiers)" },
      { "type": "number", "id": "width_2", "label": "عرض 2", "default": 928 },
      { "type": "number", "id": "height_2", "label": "ارتفاع 2", "default": 1152 },
      { "type": "text", "id": "caption_2", "label": "تعليق 2" }
    ] },
    { "type": "hero", "name": "العنوان الرئيسي", "limit": 1, "settings": [
      { "type": "text", "id": "eyebrow", "label": "سطر صغير فوق العنوان" },
      { "type": "textarea", "id": "headline", "label": "العنوان الرئيسي" },
      { "type": "textarea", "id": "subheadline", "label": "العنوان الفرعي" },
      { "type": "textarea", "id": "bullets", "label": "نقاط (سطر لكل نقطة)" },
      { "type": "text", "id": "cta", "label": "زر الطلب", "default": "اطلب الآن" },
      { "type": "text", "id": "note", "label": "سطر تحت الزر" },
      { "type": "checkbox", "id": "show_image", "label": "صورة المنتج", "default": true },
      { "type": "text", "id": "image_url", "label": "صورة وصفية (رابط ملف من Fichiers)", "info": "فارغ = الصورة الأولى للمنتج" },
      { "type": "number", "id": "image_width", "label": "عرض الصورة", "default": 928 },
      { "type": "number", "id": "image_height", "label": "ارتفاع الصورة", "default": 1152 },
      { "type": "checkbox", "id": "image_text", "label": "العنوان مكتوب داخل الصورة (يُخفى النص فوقها)", "default": false }
    ] },
    { "type": "visual", "name": "صورة وصفية", "settings": [
      { "type": "text", "id": "image_url", "label": "رابط الصورة (Fichiers)" },
      { "type": "number", "id": "width", "label": "العرض", "default": 928 },
      { "type": "number", "id": "height", "label": "الارتفاع", "default": 1152 },
      { "type": "text", "id": "headline", "label": "العنوان" },
      { "type": "textarea", "id": "points", "label": "نقاط قصيرة (سطر لكل نقطة)" },
      { "type": "text", "id": "alt", "label": "وصف الصورة (alt)" }
    ] },
    { "type": "delivery", "name": "التوصيل والدفع", "limit": 1, "settings": [
      { "type": "text", "id": "heading", "label": "العنوان", "default": "التوصيل والدفع" },
      { "type": "text", "id": "carriers", "label": "شركات التوصيل" },
      { "type": "text", "id": "time", "label": "مدة التوصيل" },
      { "type": "number", "id": "served", "label": "عدد الولايات (إن لم يوجد جدول التوصيل في إعدادات القالب)" },
      { "type": "number", "id": "desk_from", "label": "المكتب من (دج)" },
      { "type": "number", "id": "home_from", "label": "المنزل من (دج)" }
    ] },
    { "type": "text", "name": "فقرة", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "richtext", "id": "body", "label": "النص" },
      { "type": "select", "id": "tone", "label": "الخلفية", "options": [{ "value": "plain", "label": "بدون" }, { "value": "soft", "label": "بطاقة" }, { "value": "alert", "label": "تنبيه (المشكلة)" }], "default": "plain" }
    ] },
    { "type": "images", "name": "صور وصفية", "settings": [
      { "type": "range", "id": "offset", "label": "ابدأ بعد الصورة رقم", "min": 0, "max": 20, "step": 1, "default": 1 },
      { "type": "range", "id": "count", "label": "عدد الصور", "min": 1, "max": 10, "step": 1, "default": 3 }
    ] },
    { "type": "benefits", "name": "الفوائد", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "textarea", "id": "items", "label": "سطر لكل فائدة: العنوان | الشرح" }
    ] },
    { "type": "steps", "name": "خطوات الطلب", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "textarea", "id": "items", "label": "سطر لكل خطوة" }
    ] },
    { "type": "guarantee", "name": "الضمانات", "settings": [
      { "type": "text", "id": "heading", "label": "العنوان" },
      { "type": "textarea", "id": "items", "label": "سطر لكل ضمان" }
    ] },
    { "type": "faq", "name": "سؤال شائع", "settings": [
      { "type": "text", "id": "q", "label": "السؤال" },
      { "type": "textarea", "id": "a", "label": "الجواب" }
    ] },
    { "type": "cta", "name": "دعوة للطلب", "settings": [
      { "type": "textarea", "id": "headline", "label": "العنوان" },
      { "type": "text", "id": "cta", "label": "زر الطلب", "default": "اطلب الآن" },
      { "type": "text", "id": "note", "label": "سطر تحت الزر" }
    ] }
  ],
  "presets": [{ "name": "ERP · صفحة هبوط" }]
}
{% endschema %}
`;
}

/** النشر: ملفات القالب + التحويل ‎/pages/<slug>‎ + تثبيت الصفحة في «صفحات المتجر» */
export async function publishLanding(id) {
  const l = getLanding(id);
  const cfg = projectConfig(l.project_id);
  if (!shopify.isConfigured(cfg)) throw badRequest('shopify_not_configured');
  const p = getProduct(l.product_id);
  if (!p.handle) throw badRequest('landing_product_not_on_shopify');
  const suffix = `lp-${l.slug}`;
  const publicPath = `/pages/${l.slug}`;
  const target = `/products/${p.handle}?view=${suffix}`;
  const needed = l.visuals.some((x) => x.approved && x.image && !x.shopify_url) ? [...LANDING_SCOPES, 'write_files'] : LANDING_SCOPES;
  let redirect;
  let written = null;
  try {
    const { theme, tpl } = await mainTemplate(cfg);
    const [layoutFile] = await shopify.themeFiles(cfg, theme.id, ['layout/theme.liquid']);
    // الصور بعد التأكد من صلاحية القالب، وقبل كتابة القالب الذي يعرض روابطها
    const visuals = await uploadVisuals(cfg, l, p.title);
    const template = buildTemplate(l.copy, tpl, { visuals: readyVisuals(visuals), delivery: deliveryBlock(getDelivery(l.project_id)), layout: layoutFor(l.angle, l.framework, l.copy.layout) });
    await shopify.upsertThemeFiles(cfg, theme.id, [
      { filename: 'layout/erp-landing.liquid', content: landingLayout(layoutFile?.content) },
      { filename: 'sections/erp-lp.liquid', content: sectionLiquid() },
      { filename: `templates/product.${suffix}.json`, content: JSON.stringify(template, null, 2) },
    ]);
    written = { themeId: theme.id, file: `templates/product.${suffix}.json` };
    // صفحة Shopify حقيقية بنفس الاسم تمنع التحويل: Shopify لا يحوّل رابطاً موجوداً
    const existing = await shopify.findUrlRedirect(cfg, publicPath);
    redirect = existing ? await shopify.updateUrlRedirect(cfg, existing.id, publicPath, target) : await shopify.createUrlRedirect(cfg, publicPath, target);
  } catch (e) {
    // نشر أول فشل بعد كتابة القالب (إذن التحويلات ناقص مثلاً): يُحذف القالب حتى لا تبقى صفحة نصف منشورة في المتجر.
    // إعادة نشر صفحة منشورة لا تُلمس: قالبها السابق يعمل
    if (written && l.status !== 'published') await shopify.deleteThemeFiles(cfg, written.themeId, [written.file]).catch(() => null);
    throw await scopesError(cfg, e, needed);
  }
  db.prepare("UPDATE landing_pages SET status = 'published', template_suffix = ?, redirect_id = ?, public_path = ?, target_url = ?, published_at = ?, updated_at = ? WHERE id = ?").run(
    suffix,
    redirect?.id || null,
    publicPath,
    target,
    nowIso(),
    nowIso(),
    id,
  );
  const base = storeBase(l.project_id);
  // الطلبيات تُنسب بالرابط النهائي (قالب ?view=) — صفحات المتجر تحسب طلبيات كل صفحة هبوط وحدها
  if (base) addPages(l.project_id, { urls: [`${base}${target}`], title: `${p.title} · ${l.angle}`, product_id: p.id });
  return getLanding(id);
}

/**
 * إزالة الصفحة من المتجر: التحويل ‎/pages/<slug>‎ (بمعرّفه أو بمساره)، ملف القالب، و(عند الحذف) صورها في «Fichiers».
 * كل خطوة تُبلَّغ إن فشلت: كان فشل حذف القالب يُبتلع فتبقى الصفحة في المتجر وهي محذوفة من الـ ERP.
 */
async function removeFromStore(cfg, l, { files = false } = {}) {
  const removed = [];
  const redirect = l.redirect_id ? { id: l.redirect_id } : l.public_path ? await shopify.findUrlRedirect(cfg, l.public_path) : null;
  if (redirect) {
    const gone = await shopify.deleteUrlRedirect(cfg, redirect.id).catch((e) => (/not.?found|does not exist/i.test(e.message) ? null : Promise.reject(e)));
    if (gone) removed.push('redirect');
  }
  const theme = await shopify.mainTheme(cfg);
  const name = `templates/product.${l.template_suffix || `lp-${l.slug}`}.json`;
  if (theme && (await shopify.themeFileNames(cfg, theme.id, name)).includes(name)) {
    await shopify.deleteThemeFiles(cfg, theme.id, [name]);
    removed.push('template');
  }
  if (files) {
    const uploaded = l.visuals.filter((x) => x.shopify_url);
    const names = uploaded.map((x) => {
      try {
        return decodeURIComponent(new URL(x.shopify_url).pathname.split('/').pop());
      } catch {
        return null;
      }
    });
    const ids = [...new Set([...uploaded.map((x) => x.shopify_file_id).filter(Boolean), ...(await shopify.findFilesByName(cfg, names)).map((f) => f.id)])];
    if (ids.length) {
      await shopify.deleteFiles(cfg, ids);
      removed.push('files');
    }
  }
  return removed;
}

/** سحب الصفحة: حذف التحويل وملف القالب (النصوص والصور تبقى في الـ ERP لإعادة النشر) */
export async function unpublishLanding(id) {
  const l = getLanding(id);
  const cfg = projectConfig(l.project_id);
  try {
    await removeFromStore(cfg, l);
  } catch (e) {
    throw await scopesError(cfg, e);
  }
  db.prepare("UPDATE landing_pages SET status = 'unpublished', redirect_id = NULL, updated_at = ? WHERE id = ?").run(nowIso(), id);
  // قالبها لم يعد في المتجر: نسختها في اختبارات A/B تتوقف أيضاً (كما عند الحذف)، وإلا ذهب زوارها إلى صفحة المنتج العادية
  const tests = detachPage(l.project_id, l.template_suffix || `lp-${l.slug}`);
  return { ...getLanding(id), tests };
}

/**
 * الحذف: الـ ERP هو المرجع — تُحذف الصفحة من المتجر أيضاً (القالب، الرابط، صورها المرفوعة)، وتُزال من «صفحات المتجر»،
 * وتُعطَّل نسختها في اختبارات A/B. الطلبيات وزياراتها تبقى بأرقامها.
 */
export async function deleteLanding(id) {
  const l = getLanding(id);
  const cfg = projectConfig(l.project_id);
  const onStore = l.status === 'published' || l.redirect_id || l.visuals.some((x) => x.shopify_url);
  let removed = [];
  if (onStore && shopify.isConfigured(cfg)) {
    try {
      removed = await removeFromStore(cfg, l, { files: true });
    } catch (e) {
      throw await scopesError(cfg, e, l.visuals.some((x) => x.shopify_url) ? [...LANDING_SCOPES, 'write_files'] : LANDING_SCOPES);
    }
  }
  const tests = detachPage(l.project_id, l.template_suffix || `lp-${l.slug}`);
  const base = storeBase(l.project_id);
  if (base && l.target_url) {
    try {
      db.prepare('DELETE FROM store_pages WHERE project_id = ? AND url = ?').run(l.project_id, new URL(`${base}${l.target_url}`).href);
    } catch {
      /* رابط غير صالح: لا صفحة مثبتة له */
    }
  }
  db.prepare('DELETE FROM landing_pages WHERE id = ?').run(id);
  return { ...l, removed, tests };
}

/**
 * التطابق بين الـ ERP والمتجر: قوالب ‎lp-…‎ وتحويلات ‎?view=lp-…‎ في المتجر لا تقابلها صفحة منشورة في الـ ERP (بقايا)،
 * وصفحات منشورة في الـ ERP اختفى قالبها من المتجر.
 */
export async function storeCheck(projectId) {
  const cfg = projectConfig(projectId);
  if (!shopify.isConfigured(cfg)) return { configured: false, leftovers: [], missing: [] };
  const theme = await shopify.mainTheme(cfg);
  const templates = theme ? await shopify.themeFileNames(cfg, theme.id, 'templates/product.lp-*') : [];
  const redirects = (await shopify.listUrlRedirects(cfg)).filter((r) => /[?&]view=lp-/i.test(r.target));
  const rows = db.prepare('SELECT id, slug, angle, status, template_suffix FROM landing_pages WHERE project_id = ?').all(projectId);
  const published = new Map(rows.filter((r) => r.status === 'published').map((r) => [(r.template_suffix || `lp-${r.slug}`).toLowerCase(), r]));
  const byView = new Map(rows.map((r) => [(r.template_suffix || `lp-${r.slug}`).toLowerCase(), r]));
  const leftovers = new Map();
  const entry = (suffix) => leftovers.get(suffix) || leftovers.set(suffix, { suffix, template: null, redirects: [], erp: byView.get(suffix) ? { id: byView.get(suffix).id, angle: byView.get(suffix).angle, status: byView.get(suffix).status } : null }).get(suffix);
  for (const f of templates) {
    const suffix = f.replace(/^templates\/product\./, '').replace(/\.json$/, '').toLowerCase();
    if (!published.has(suffix)) entry(suffix).template = f;
  }
  for (const r of redirects) {
    let suffix = '';
    try {
      suffix = (new URL(r.target, 'https://store.invalid').searchParams.get('view') || '').toLowerCase();
    } catch {
      continue;
    }
    if (suffix && !published.has(suffix)) entry(suffix).redirects.push({ id: r.id, path: r.path });
  }
  const missing = [...published.entries()].filter(([suffix]) => !templates.some((f) => f.toLowerCase() === `templates/product.${suffix}.json`)).map(([, r]) => ({ id: r.id, slug: r.slug, angle: r.angle }));
  return { configured: true, theme: theme?.name || null, leftovers: [...leftovers.values()], missing };
}

/** حذف بقايا صفحة هبوط من المتجر (قالبها وتحويلاتها) — لا تمسّ أي صفحة منشورة في الـ ERP */
export async function removeLeftover(projectId, suffix) {
  const check = await storeCheck(projectId);
  const item = check.leftovers.find((x) => x.suffix === String(suffix || '').toLowerCase());
  if (!item) throw new HttpError(404, 'leftover_not_found');
  const cfg = projectConfig(projectId);
  try {
    for (const r of item.redirects) await shopify.deleteUrlRedirect(cfg, r.id);
    if (item.template) {
      const theme = await shopify.mainTheme(cfg);
      await shopify.deleteThemeFiles(cfg, theme.id, [item.template]);
    }
  } catch (e) {
    throw await scopesError(cfg, e);
  }
  detachPage(projectId, item.suffix);
  return item;
}
