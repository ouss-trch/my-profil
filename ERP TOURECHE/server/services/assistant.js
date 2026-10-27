import { db, parseJson } from '../db/index.js';
import * as ai from '../integrations/ai.js';
import { HttpError, addDays, dzDay, nowIso, randomId } from '../lib/util.js';
import { STATUSES } from '../lib/statuses.js';
import { parseWilaya } from '../lib/wilayas.js';
import { listProjects } from './projects.js';
import * as analytics from './analytics.js';
import * as orders from './orders.js';
import * as products from './products.js';
import * as ads from './ads.js';
import { analyzeSeo } from './seo.js';
import * as advisor from './advisor.js';
import * as splits from './splits.js';

/**
 * المساعد الذكي: يقرأ بيانات الـ ERP بأدوات مخصصة، ويقترح التعديلات فقط.
 * كل تعديل (حالة طلبية، سعر، حملة، ميزانية…) يصبح «إجراءً معلقاً» يؤكده المستخدم بكلمة مرور العمليات الحساسة.
 */
const SYSTEM = `أنت «مساعد Toureche»، مدير عمليات ذكي داخل نظام ERP لمتاجر جزائرية تعمل بالدفع عند الاستلام (Shopify + إعلانات Meta + شركات التوصيل Yalidine وZR Express وNOEST).
تجيب بالعربية (أو بالفرنسية إن كتب المستخدم بها)، بإيجاز ووضوح، بأرقام حقيقية من الأدوات فقط — لا تخمّن رقماً لم تقرأه.
الحكم على المنتجات والإعلانات يعتمد على الطلبيات المؤكدة والمسلّمة وتكلفة الطلبية المسلّمة مقارنة بحد التعادل، لا على أرقام البيكسل.
عندما يطلب المستخدم تعديلاً (حالة طلبية، منتج، سعر، حملة، ميزانية، إيقاف اختبار) استعمل propose_action: الإجراء لا يُنفَّذ إلا بعد أن يؤكده المستخدم بكلمة مرور العمليات الحساسة. قل ذلك بوضوح.
يمكنك إنشاء المهام مباشرة بـ create_task.
دورك أيضاً مستشار نمو: عند السؤال عن الأداء أو «ماذا أفعل؟» ابدأ بـ advisor_insights وjournal، وقدّم تقييماً صريحاً واستنتاجات واقتراحات مرتبة حسب الأثر مع الأرقام.
المبالغ بالدينار الجزائري (دج) ما لم يُذكر غير ذلك. التواريخ بتوقيت الجزائر.`;

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const S = { type: 'string' };
const N = { type: 'number' };

const TOOLS = [
  { name: 'list_projects', description: 'قائمة المشاريع/المتاجر (المعرّف والاسم).', input_schema: obj({}) },
  { name: 'get_today', description: 'لوحة اليوم: طلبيات اليوم، تنتظر التأكيد، للشحن، في التوصيل، المحاولات الفاشلة، التسليم، الإنفاق، نسب التأكيد والتسليم.', input_schema: obj({ project_id: N }) },
  { name: 'get_stats', description: 'إحصاءات فترة: القمع، الإيرادات، الربح التقديري، الولايات، المنتجات، أداء الموظفين.', input_schema: obj({ from: S, to: S, project_id: N }, ['from', 'to']) },
  {
    name: 'search_orders',
    description: 'البحث في الطلبيات حسب الحالة أو الولاية أو نص (اسم، هاتف، مرجع، تتبع).',
    input_schema: obj({ query: S, status: { type: 'string', enum: Object.keys(STATUSES) }, wilaya: S, project_id: N, limit: N }),
  },
  { name: 'get_order', description: 'تفاصيل طلبية كاملة مع سجل الأحداث وتاريخ الزبون.', input_schema: obj({ order_id: N }, ['order_id']) },
  { name: 'recommend_carrier', description: 'ترتيب شركات التوصيل لولاية ونوع توصيل حسب نسبة التسليم والسرعة وجدية الموزع والسعر.', input_schema: obj({ wilaya: S, delivery_type: { type: 'string', enum: ['home', 'desk'] }, project_id: N }, ['wilaya']) },
  { name: 'carrier_performance', description: 'أداء كل شركة توصيل عموماً وحسب الولايات.', input_schema: obj({ project_id: N }) },
  { name: 'list_products', description: 'المنتجات مع السعر والمخزون ودرجة SEO ومرحلة الاختبار.', input_schema: obj({ query: S, project_id: N }) },
  { name: 'product_seo_report', description: 'فحص SEO مفصّل لصفحة منتج.', input_schema: obj({ product_id: N }, ['product_id']) },
  { name: 'ads_decisions', description: 'قرارات الإعلانات والاختبارات اليوم (إيقاف، زيادة ميزانية، إصلاح…) لمشروع.', input_schema: obj({ project_id: N }, ['project_id']) },
  { name: 'product_tests', description: 'جدول المنتجات قيد الاختبار: الإنفاق، الطلبيات، المسلّمة، تكلفة المسلّمة، حد التعادل، الحكم.', input_schema: obj({ project_id: N, days: N }, ['project_id']) },
  { name: 'campaigns', description: 'حملات Meta مع الإنفاق وCTR والتحويل والتشخيص.', input_schema: obj({ project_id: N, days: N }, ['project_id']) },
  {
    name: 'advisor_insights',
    description: 'ملاحظات «المستشار» المحسوبة من البيانات: تنبيهات وفرص وإنجازات لكل مجال (التأكيد، التوصيل، الولايات، المنتجات، المخزون، الإعلانات، الزبائن، المالية، الأوقات، اختبارات الصفحات) مع الأدلة الرقمية والتقييم العام.',
    input_schema: obj({ project_id: N }),
  },
  { name: 'journal', description: 'دفتر الملاحظات: القرارات والدروس والأفكار والتجارب السابقة التي دوّنها الفريق.', input_schema: obj({ project_id: N }) },
  { name: 'split_tests', description: 'اختبارات صفحات الهبوط A/B: الزوار، الطلبيات، المؤكدة، المسلّمة واحتمال أن تكون كل صفحة الأفضل.', input_schema: obj({ project_id: N }) },
  { name: 'create_task', description: 'إنشاء مهمة متابعة.', input_schema: obj({ title: S, notes: S, due_date: S, project_id: N, priority: { type: 'string', enum: ['low', 'normal', 'high'] } }, ['title']) },
  {
    name: 'propose_action',
    description:
      'اقتراح تعديل يحتاج تأكيد المستخدم. kinds: update_order_status {order_id, status, note} · update_product {product_id, fields:{title,price,compare_at_price,seo_title,seo_description,description_html,tags,stock}} · pause_campaign/activate_campaign {project_id, campaign_id} · set_campaign_budget {project_id, campaign_id, daily_budget (بعملة الحساب)} · stop_test {project_id, product_id}',
    input_schema: obj(
      {
        kind: { type: 'string', enum: ['update_order_status', 'update_product', 'pause_campaign', 'activate_campaign', 'set_campaign_budget', 'stop_test'] },
        params: { type: 'object' },
        summary: S,
      },
      ['kind', 'params', 'summary'],
    ),
  },
];

const allIds = () => listProjects().map((p) => p.id);
const idsFor = (pid) => (pid ? [Number(pid)] : allIds());
const clip = (data) => {
  const s = JSON.stringify(data);
  return s.length > 14000 ? s.slice(0, 14000) + '…(مقتطع)' : s;
};

async function runTool(name, input, ctx) {
  switch (name) {
    case 'list_projects':
      return listProjects().map((p) => ({ id: p.id, name: p.name, domain: p.domain }));
    case 'get_today': {
      const t = analytics.today(idsFor(input.project_id));
      return { ...t, series: t.series.slice(-7) };
    }
    case 'get_stats': {
      const s = analytics.stats(idsFor(input.project_id), input.from, input.to);
      return { ...s, series: undefined, wilayas: s.wilayas.slice(0, 15), products: s.products.slice(0, 15) };
    }
    case 'search_orders': {
      const w = input.wilaya ? parseWilaya(input.wilaya) : null;
      const r = orders.listOrders({ projectIds: idsFor(input.project_id), q: input.query, status: input.status, wilaya: w?.code, limit: Math.min(input.limit || 20, 50) });
      return {
        total: r.total,
        orders: r.rows.map((o) => ({ id: o.id, ref: o.ref, status: o.status, customer: o.customer_name, phone: o.phone, wilaya: o.wilaya?.ar, total: o.total, carrier: o.carrier, tracking: o.tracking, created_at: o.created_at, items: o.items.map((i) => `${i.title} x${i.qty}`).join(', ') })),
      };
    }
    case 'get_order': {
      const o = orders.getOrder(input.order_id);
      return { ...o, events: o.events.slice(-20) };
    }
    case 'recommend_carrier': {
      const w = parseWilaya(input.wilaya);
      if (!w) return { error: 'wilaya_not_found' };
      const r = analytics.recommendCarrier(idsFor(input.project_id), w.code, input.delivery_type || 'home');
      return { wilaya: r.wilaya, ranked: r.ranked.map((x) => ({ carrier: x.name, score: x.score, confidence: x.confidence, est: x.estimated, local_shipments: x.local.shipped, fee: x.fee, configured: x.configured })) };
    }
    case 'carrier_performance': {
      const r = analytics.carrierPerformance(idsFor(input.project_id));
      return { window_days: r.window_days, carriers: r.carriers, wilayas: r.wilayas.slice(0, 30) };
    }
    case 'list_products':
      return products.listProducts(idsFor(input.project_id), { q: input.query }).map((p) => ({ id: p.id, title: p.title, price: p.price, cost: p.cost_price, stock: p.stock, seo_score: p.seo_score, stage: p.stage, test_stage: p.test_stage, url: p.online_url }));
    case 'product_seo_report': {
      const p = products.getProduct(input.product_id);
      return { title: p.title, ...analyzeSeo(p) };
    }
    case 'ads_decisions':
      return ads.decisions(Number(input.project_id));
    case 'product_tests':
      return ads.productTests(Number(input.project_id), input.days || 7).map((t) => ({ ...t, campaigns: t.campaigns.map((c) => ({ id: c.campaign_id, name: c.name, status: c.effective_status, daily_budget: c.daily_budget })) }));
    case 'campaigns':
      return (await ads.campaignsOverview(Number(input.project_id), input.days || 7)).campaigns.slice(0, 40);
    case 'advisor_insights': {
      const a = advisor.analyze(idsFor(input.project_id));
      return { scores: a.scores, counts: a.counts, insights: a.insights.filter((i) => !i.hidden).slice(0, 40).map((i) => ({ key: i.key, area: i.area, type: i.type, severity: i.severity, title: i.title.ar, insight: i.insight?.ar, evidence: i.evidence.map((e) => `${e.label.ar || e.label}: ${typeof e.value === 'object' ? e.value.ar : e.value}`), impact_da: i.impact_da })) };
    }
    case 'journal':
      return advisor.journal(idsFor(input.project_id), { limit: 60 }).map((j) => ({ kind: j.kind, at: j.created_at, text: j.text }));
    case 'split_tests':
      return splits.listTests(idsFor(input.project_id)).slice(0, 10).map((t) => {
        const r = splits.results(t.id);
        return { name: t.name, status: t.status, goal: r.goal, verdict: r.verdict, variants: r.variants.map((v) => ({ label: v.label, name: v.name, url: v.url, visitors: v.visitors, orders: v.orders, confirmed: v.confirmed, delivered: v.delivered, p_best: v.p_best })) };
      });
    case 'create_task': {
      const info = db
        .prepare('INSERT INTO tasks (project_id, title, notes, priority, due_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.project_id || null, String(input.title).slice(0, 200), input.notes || null, input.priority || 'normal', input.due_date || null, ctx.userId);
      return { task_id: Number(info.lastInsertRowid), created: true };
    }
    case 'propose_action': {
      const id = randomId(10);
      db.prepare('INSERT INTO ai_actions (id, user_id, project_id, conversation_id, kind, payload, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id,
        ctx.userId,
        input.params?.project_id || null,
        ctx.conversationId,
        input.kind,
        JSON.stringify(input.params || {}),
        String(input.summary || '').slice(0, 500),
        nowIso(),
      );
      ctx.actions.push({ id, kind: input.kind, summary: input.summary, params: input.params });
      return { pending_action_id: id, status: 'awaiting_user_confirmation' };
    }
    default:
      return { error: 'unknown_tool' };
  }
}

export function listConversations(userId) {
  return db.prepare('SELECT id, title, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30').all(userId);
}

/** نسخة مبسطة للمحادثة لعرضها في الواجهة */
export function transcript(conversationId, userId) {
  const row = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
  if (!row) throw new HttpError(404, 'conversation_not_found');
  const msgs = parseJson(row.messages, []);
  const out = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (text) out.push({ role: 'user', text: text.replace(/^\[سياق\][\s\S]*?\n\n/, '') });
    } else if (m.role === 'assistant') {
      const text = (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const tools = (m.content || []).filter((b) => b.type === 'tool_use').map((b) => b.name);
      if (text || tools.length) out.push({ role: 'assistant', text, tools });
    }
  }
  const actions = db.prepare('SELECT id, kind, summary, status, payload, result FROM ai_actions WHERE conversation_id = ? ORDER BY created_at').all(conversationId);
  return { id: row.id, title: row.title, messages: out, actions: actions.map((a) => ({ ...a, payload: parseJson(a.payload, {}), result: parseJson(a.result, null) })) };
}

export async function chat({ userId, conversationId, message, projectId }) {
  const now = nowIso();
  let row = conversationId ? db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) : null;
  if (!row) {
    const id = randomId(12);
    db.prepare('INSERT INTO ai_conversations (id, user_id, project_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, userId, projectId || null, String(message).slice(0, 80), '[]', now, now);
    row = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id);
  }
  const messages = parseJson(row.messages, []);
  const projectsLine = listProjects().map((p) => `${p.id}=${p.name}`).join('، ');
  messages.push({
    role: 'user',
    content: `[سياق] اليوم ${dzDay()} (أمس ${addDays(dzDay(), -1)}). المشاريع: ${projectsLine}. المشروع المختار في الواجهة: ${projectId || 'كل المشاريع'}.\n\n${String(message).slice(0, 8000)}`,
  });
  const ctx = { userId, conversationId: row.id, actions: [] };
  const params = { ...ai.baseParams({ maxTokens: 16000 }), system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], tools: TOOLS };
  let final = null;
  for (let i = 0; i < 10; i++) {
    const res = await ai.createMessage({ ...params, messages }, { projectId: projectId || null, kind: 'assistant' });
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'refusal') {
      final = 'لا أستطيع المساعدة في هذا الطلب.';
      break;
    }
    if (res.stop_reason === 'pause_turn') continue;
    const calls = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      final = ai.textOf(res);
      break;
    }
    const results = [];
    for (const call of calls) {
      try {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: clip(await runTool(call.name, call.input || {}, ctx)) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: `خطأ: ${e.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  db.prepare('UPDATE ai_conversations SET messages = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(messages), nowIso(), row.id);
  return { conversation_id: row.id, reply: final || '…', actions: ctx.actions };
}

/** تنفيذ إجراء اقترحه المساعد بعد تأكيد المستخدم (المسار محمي بكلمة مرور العمليات الحساسة) */
export async function executeAction(actionId, user) {
  const a = db.prepare('SELECT * FROM ai_actions WHERE id = ?').get(actionId);
  if (!a) throw new HttpError(404, 'action_not_found');
  if (a.status !== 'pending') throw new HttpError(409, 'action_already_handled');
  const p = parseJson(a.payload, {});
  let result;
  try {
    switch (a.kind) {
      case 'update_order_status':
        result = { status: orders.changeStatus(Number(p.order_id), p.status, { userId: user.id, note: p.note || 'AI', source: 'ai' }).status };
        break;
      case 'update_product': {
        const allowed = ['title', 'price', 'compare_at_price', 'seo_title', 'seo_description', 'description_html', 'tags', 'stock'];
        const fields = Object.fromEntries(Object.entries(p.fields || {}).filter(([k]) => allowed.includes(k)));
        const prod = products.updateProduct(Number(p.product_id), fields);
        if (fields.price !== undefined || fields.compare_at_price !== undefined)
          products.updateProduct(prod.id, { variants: prod.variants.map((v) => ({ ...v, price: fields.price ?? v.price, compare_at_price: fields.compare_at_price ?? v.compare_at_price })) });
        result = prod.shopify_id ? { saved: true, published: (await products.publishProduct(prod.id, { status: prod.shopify_status || 'ACTIVE' })).id } : { saved: true };
        break;
      }
      case 'pause_campaign':
        await ads.setCampaignStatus(Number(p.project_id), p.campaign_id, 'PAUSED');
        result = { paused: p.campaign_id };
        break;
      case 'activate_campaign':
        await ads.editCampaign(Number(p.project_id), p.campaign_id, { section: 'activate' });
        result = { activated: p.campaign_id };
        break;
      case 'set_campaign_budget':
        await ads.setCampaignBudget(Number(p.project_id), p.campaign_id, Number(p.daily_budget));
        result = { budget: p.daily_budget };
        break;
      case 'stop_test':
        result = await ads.stopTest(Number(p.project_id), Number(p.product_id), 'AI');
        break;
      default:
        throw new HttpError(400, 'unknown_action');
    }
    db.prepare("UPDATE ai_actions SET status = 'done', result = ?, executed_at = ? WHERE id = ?").run(JSON.stringify(result), nowIso(), actionId);
    return { ...a, status: 'done', result };
  } catch (e) {
    db.prepare("UPDATE ai_actions SET status = 'failed', result = ?, executed_at = ? WHERE id = ?").run(JSON.stringify({ error: e.message }), nowIso(), actionId);
    throw e;
  }
}

export function rejectAction(actionId) {
  db.prepare("UPDATE ai_actions SET status = 'rejected', executed_at = ? WHERE id = ? AND status = 'pending'").run(nowIso(), actionId);
}

/** ملخص يومي قصير (للوحة «يومي») */
export async function dailyBrief(projectIds) {
  const t = analytics.today(projectIds);
  const decisions = projectIds.flatMap((id) => {
    try {
      return ads.decisions(id).slice(0, 5);
    } catch {
      return [];
    }
  });
  return ai.text({
    system: 'أنت مدير عمليات. اكتب بالعربية 5 نقاط قصيرة جداً ومرتبة حسب الأولوية: ماذا يجب فعله اليوم في المتجر (تأكيد، اتصال بالمحاولات الفاشلة، شحن، إعلانات، مخزون). استعمل الأرقام المعطاة فقط.',
    prompt: JSON.stringify({ today: { ...t, series: undefined }, decisions }),
    effort: 'low',
    maxTokens: 2000,
    meter: { projectId: projectIds.length === 1 ? projectIds[0] : null, kind: 'brief' },
  });
}
