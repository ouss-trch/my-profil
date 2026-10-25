import { db, parseJson } from '../db/index.js';
import { getSetting, projectConfig } from '../lib/settings.js';
import { SHIPPED_EVER } from '../lib/statuses.js';
import { wilayaByCode } from '../lib/wilayas.js';
import { addDays, dzDay, dzDayStartIso, median, nowIso, round } from '../lib/util.js';
import { CARRIERS } from '../integrations/carriers/index.js';
import * as shopify from '../integrations/shopify.js';
import * as meta from '../integrations/meta.js';
import * as ai from '../integrations/ai.js';
import { inList, listProjects } from './projects.js';
import { stats, recommendCarrier, toDa } from './analytics.js';
import { decisions } from './ads.js';
import { tariff } from './shipments.js';
import { splitInsights } from './splits.js';
import { suppliersById, restockPlan } from './contacts.js';
import { backupStatus } from './backup.js';

/**
 * «المستشار»: يحلّل بيانات المشروع ويُخرج ملاحظات وتقييمات واستنتاجات واقتراحات قابلة للتنفيذ.
 * كل ملاحظة = { key ثابت، المجال، النوع، الخطورة، العنوان، الاستنتاج، الدليل بالأرقام، التوصية، زر الإجراء، الأثر المالي التقديري }.
 * يعمل بالقواعد (دون ذكاء اصطناعي) ليكون متاحاً دائماً؛ والمستشار الذكي يبني فوقه تقريراً أعمق.
 */
const tx = (ar, fr) => ({ ar, fr });
const joinTx = (...parts) => tx(parts.filter(Boolean).map((p) => p.ar).join(' '), parts.filter(Boolean).map((p) => p.fr).join(' '));
const pct = (a, b) => (b ? round((100 * a) / b) : null);
// أرقام بفاصل ضيق غير قابل للكسر، والمبالغ معزولة اتجاهياً حتى لا تنقلب داخل النص العربي
const fmt = (n) => Math.round(n).toLocaleString('fr-FR').replace(/[\u00a0\u202f ]/g, '\u202f');
const dz = (n) => `\u2066${fmt(n)} DA\u2069`;
const HOUR = 3600e3;
const SEVERITY = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const CONFIRMED_EVER = ['confirmed', ...SHIPPED_EVER];

const W = (code) => {
  const w = wilayaByCode(code);
  return w ? { ar: `${w.code} - ${w.ar}`, fr: `${w.code} - ${w.fr}` } : { ar: String(code), fr: String(code) };
};

function ordersSince(projectIds, sinceIso) {
  return db
    .prepare(`SELECT * FROM orders WHERE project_id IN (${inList(projectIds)}) AND created_at >= ? AND status != 'abandoned'`)
    .all(...projectIds, sinceIso);
}

/** منذ متى الطلبية في حالتها الحالية (من سجل الأحداث) */
function withStatusSince(projectIds, statuses) {
  return db
    .prepare(
      `SELECT o.*, COALESCE((SELECT MAX(e.at) FROM order_events e WHERE e.order_id = o.id AND e.to_status = o.status), o.updated_at) AS status_since
       FROM orders o WHERE o.project_id IN (${inList(projectIds)}) AND o.status IN (${statuses.map(() => '?').join(',')})`,
    )
    .all(...projectIds, ...statuses);
}

const hoursSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / HOUR : 0);

// ————————————————————————————————————————————————
// القواعد
// ————————————————————————————————————————————————
function confirmationRules(projectIds, push) {
  const pending = withStatusSince(projectIds, ['new', 'no_answer', 'callback']);
  const old = pending.filter((o) => hoursSince(o.created_at) > 24);
  if (old.length) {
    const oldest = Math.max(...old.map((o) => hoursSince(o.created_at)));
    const value = old.reduce((s, o) => s + o.total, 0);
    push({
      key: 'confirm.backlog',
      area: 'confirmation',
      type: 'alert',
      severity: old.length >= 10 || oldest > 72 ? 'high' : 'medium',
      title: tx(`${old.length} طلبية تنتظر التأكيد منذ أكثر من 24 ساعة`, `${old.length} commandes attendent la confirmation depuis plus de 24 h`),
      insight: tx(
        'كل ساعة تأخير في الاتصال تُخفض احتمال التأكيد؛ الزبون يبرد أو يشتري من منافس.',
        'Chaque heure de retard réduit la probabilité de confirmation : le client se refroidit ou achète ailleurs.',
      ),
      evidence: [
        { label: tx('الأقدم', 'La plus ancienne'), value: `${Math.round(oldest)} h` },
        { label: tx('القيمة المعلّقة', 'Valeur en attente'), value: `${dz(value)}` },
      ],
      advice: tx(
        'ابدأ بالأقدم، جرّب الاتصال في وقت مختلف، وأرسل رسالة واتساب قصيرة لمن لا يرد قبل الإلغاء.',
        'Commencez par les plus anciennes, rappelez à un autre horaire et envoyez un WhatsApp court avant d’annuler.',
      ),
      action: { to: '/orders?tab=confirm', label: tx('فتح طابور التأكيد', 'Ouvrir la file de confirmation') },
      impact_da: round(value * 0.3),
    });
  }

  const since28 = dzDayStartIso(addDays(dzDay(), -27));
  const since14 = dzDayStartIso(addDays(dzDay(), -13));
  const recent = ordersSince(projectIds, since28);
  const rate = (list) => {
    const conf = list.filter((o) => CONFIRMED_EVER.includes(o.status)).length;
    const handled = conf + list.filter((o) => ['cancelled', 'fake'].includes(o.status)).length;
    return { conf, handled, rate: handled ? conf / handled : null };
  };
  const cur = rate(recent.filter((o) => o.created_at >= since14));
  const prev = rate(recent.filter((o) => o.created_at < since14));
  if (cur.handled >= 20 && cur.rate < 0.6) {
    const reasons = Object.entries(
      recent
        .filter((o) => o.created_at >= since14 && ['cancelled', 'fake'].includes(o.status))
        .reduce((m, o) => ((m[o.cancel_reason || o.status] = (m[o.cancel_reason || o.status] || 0) + 1), m), {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r, n]) => `${r} (${n})`)
      .join('، ');
    push({
      key: 'confirm.rate_low',
      area: 'confirmation',
      type: 'alert',
      severity: cur.rate < 0.45 ? 'critical' : 'high',
      title: tx(`نسبة التأكيد ${round(cur.rate * 100)}% فقط (14 يوماً)`, `Taux de confirmation de ${round(cur.rate * 100)} % seulement (14 j)`),
      insight: tx(
        'أقل من 60% يعني أن جزءاً كبيراً من ميزانية الإعلانات يذهب لطلبيات لا تُشحن أبداً.',
        'Sous 60 %, une grande partie du budget pub finance des commandes qui ne partent jamais.',
      ),
      evidence: [
        { label: tx('مؤكدة / معالجة', 'Confirmées / traitées'), value: `${cur.conf} / ${cur.handled}` },
        ...(prev.rate !== null ? [{ label: tx('الفترة السابقة', 'Période précédente'), value: `${round(prev.rate * 100)}%` }] : []),
        ...(reasons ? [{ label: tx('أهم أسباب الإلغاء', 'Principaux motifs'), value: reasons }] : []),
      ],
      advice: tx(
        'اتصل خلال 15 دقيقة من الطلب، وضّح السعر النهائي مع التوصيل في الإعلان والصفحة، وراجع الإعلانات التي تجلب طلبيات وهمية.',
        'Appelez dans les 15 min, affichez le prix final livraison incluse dans la pub et la page, et coupez les pubs qui ramènent des fausses commandes.',
      ),
      action: { to: '/stats', label: tx('تحليل القمع', "Analyser l'entonnoir") },
    });
  } else if (cur.handled >= 20 && prev.handled >= 20 && cur.rate - prev.rate >= 0.08) {
    push({
      key: 'confirm.rate_up',
      area: 'confirmation',
      type: 'achievement',
      severity: 'info',
      title: tx(`نسبة التأكيد تحسنت إلى ${round(cur.rate * 100)}%`, `Le taux de confirmation monte à ${round(cur.rate * 100)} %`),
      insight: tx('ما تغيّر في الأسبوعين الأخيرين يعمل — دوّنه في دفتر الملاحظات حتى يتكرر.', 'Ce qui a changé ces 2 semaines fonctionne — notez-le dans le journal.'),
      evidence: [{ label: tx('قبل', 'Avant'), value: `${round(prev.rate * 100)}%` }],
      action: { to: '/advisor?tab=journal', label: tx('تدوين الدرس', 'Noter la leçon') },
    });
  }

  if (pending.length >= 8) {
    const na = pending.filter((o) => o.status === 'no_answer').length;
    if (na / pending.length > 0.4)
      push({
        key: 'confirm.no_answer_high',
        area: 'confirmation',
        type: 'observation',
        severity: 'medium',
        title: tx(`${pct(na, pending.length)}% من الطلبيات المعلقة «لا يرد»`, `${pct(na, pending.length)} % des commandes en attente sont « pas de réponse »`),
        insight: tx('الأرقام صحيحة غالباً لكن توقيت الاتصال غير مناسب.', 'Les numéros sont souvent bons, mais l’horaire d’appel ne convient pas.'),
        evidence: [{ label: tx('لا يرد', 'Pas de réponse'), value: String(na) }],
        advice: tx('وزّع المحاولات: صباحاً، بعد الظهر، وبعد المغرب، مع رسالة واتساب بعد المحاولة الثانية.', 'Étalez les essais : matin, après-midi, après le maghrib, avec un WhatsApp après le 2e essai.'),
        action: { to: '/orders?status=no_answer', label: tx('فتح «لا يرد»', 'Ouvrir « pas de réponse »') },
      });
  }

  const confirmed = recent.filter((o) => o.confirmed_at && o.created_at >= since14);
  const delays = confirmed.map((o) => (Date.parse(o.confirmed_at) - Date.parse(o.created_at)) / HOUR).filter((h) => h >= 0 && h < 240);
  const med = median(delays);
  if (delays.length >= 15 && med > 4)
    push({
      key: 'confirm.slow',
      area: 'confirmation',
      type: 'observation',
      severity: med > 12 ? 'high' : 'medium',
      title: tx(`متوسط زمن التأكيد ${round(med, 1)} ساعة`, `Délai médian de confirmation : ${round(med, 1)} h`),
      insight: tx('التأكيد خلال أقل من ساعة يرفع النسبة عادة بـ 10–20 نقطة في الدفع عند الاستلام.', 'Confirmer en moins d’une heure gagne souvent 10 à 20 points en COD.'),
      evidence: [{ label: tx('طلبيات مدروسة', 'Commandes étudiées'), value: String(delays.length) }],
      advice: tx('خصص فترات اتصال ثابتة كل ساعتين وفعّل إشعار الطلبيات الجديدة على الهاتف.', 'Planifiez des créneaux d’appel toutes les 2 h et activez la notification des nouvelles commandes.'),
      action: { to: '/orders?tab=confirm', label: tx('طابور التأكيد', 'File de confirmation') },
    });

  // أداء الموظفين
  const agents = db
    .prepare(
      `SELECT u.display_name AS name, SUM(e.to_status = 'confirmed') AS c, SUM(e.to_status IN ('cancelled','fake')) AS x
       FROM order_events e JOIN users u ON u.id = e.user_id JOIN orders o ON o.id = e.order_id
       WHERE o.project_id IN (${inList(projectIds)}) AND e.at >= ? AND e.type = 'status' GROUP BY u.id`,
    )
    .all(...projectIds, since14)
    .filter((a) => a.c + a.x >= 20);
  if (agents.length >= 2) {
    const team = agents.reduce((s, a) => s + a.c, 0) / agents.reduce((s, a) => s + a.c + a.x, 0);
    for (const a of agents) {
      const r = a.c / (a.c + a.x);
      if (team - r >= 0.12)
        push({
          key: `confirm.agent:${a.name}`,
          area: 'confirmation',
          type: 'observation',
          severity: 'medium',
          title: tx(`نسبة تأكيد ${a.name} أقل من الفريق`, `Taux de ${a.name} inférieur à l’équipe`),
          insight: tx('الفارق كبير بما يكفي ليكون أسلوب المكالمة لا الصدفة.', 'L’écart est trop grand pour être du hasard : c’est la façon d’appeler.'),
          evidence: [
            { label: a.name, value: `${round(r * 100)}%` },
            { label: tx('الفريق', 'Équipe'), value: `${round(team * 100)}%` },
          ],
          advice: tx('استمع لمكالمات الأفضل أداءً ووحّد نص المكالمة.', 'Faites écouter les appels du meilleur agent et unifiez le script.'),
          action: { to: '/stats?tab=agents', label: tx('أداء الفريق', "Performance de l'équipe") },
        });
    }
  }
}

function deliveryRules(projectIds, push) {
  const s30 = stats(projectIds, addDays(dzDay(), -29), dzDay());
  const s60 = stats(projectIds, addDays(dzDay(), -59), addDays(dzDay(), -30));
  const closed = s30.funnel.delivered + s30.funnel.returned;
  const closedDeliv = s30.delivery_rate;
  if (closedDeliv !== null && closed >= 15 && closedDeliv < 72) {
    const returns = db
      .prepare(`SELECT * FROM orders WHERE project_id IN (${inList(projectIds)}) AND status = 'returned' AND returned_at >= ?`)
      .all(...projectIds, dzDayStartIso(addDays(dzDay(), -29)));
    const loss = returns.reduce((s, o) => s + (tariff(o.project_id, o.carrier, o.wilaya_code, o.delivery_type)?.return_fee || 200) + (o.shipping_cost || 0), 0);
    push({
      key: 'delivery.rate_low',
      area: 'delivery',
      type: 'alert',
      severity: closedDeliv < 60 ? 'critical' : 'high',
      title: tx(`نسبة التسليم ${closedDeliv}% (30 يوماً)`, `Taux de livraison de ${closedDeliv} % (30 j)`),
      insight: tx(
        'كل مرتجع يكلف التوصيل ذهاباً وإياباً ويستهلك المخزون والإعلان الذي جلبه.',
        'Chaque retour coûte l’aller-retour, bloque le stock et gaspille la pub qui l’a amené.',
      ),
      evidence: [
        { label: tx('مسلّمة / مرتجعة', 'Livrées / retournées'), value: `${s30.funnel.delivered} / ${s30.funnel.returned}` },
        ...(s60.delivery_rate !== null ? [{ label: tx('الشهر السابق', 'Mois précédent'), value: `${s60.delivery_rate}%` }] : []),
        { label: tx('تكلفة المرتجعات التقديرية', 'Coût estimé des retours'), value: `${dz(loss)}` },
      ],
      advice: tx(
        'أعد تأكيد الطلبيات قبل الشحن بيوم، اتصل بالزبون عند وصول الطرد للمكتب، وراجع الولايات وشركات التوصيل الأسوأ أدناه.',
        'Reconfirmez la veille de l’expédition, appelez le client à l’arrivée au bureau et revoyez les pires wilayas/transporteurs ci-dessous.',
      ),
      action: { to: '/carriers', label: tx('أداء شركات التوصيل', 'Performance transporteurs') },
      impact_da: round(loss),
    });
  }

  const atOffice = withStatusSince(projectIds, ['at_office']).filter((o) => hoursSince(o.status_since) > 48);
  if (atOffice.length)
    push({
      key: 'delivery.stuck_office',
      area: 'delivery',
      type: 'alert',
      severity: atOffice.length >= 5 ? 'high' : 'medium',
      title: tx(`${atOffice.length} طرد في المكتب منذ أكثر من يومين`, `${atOffice.length} colis au bureau depuis plus de 2 jours`),
      insight: tx('الطرود التي تبقى في المكتب تتحول إلى مرتجعات بعد بضعة أيام.', 'Un colis qui reste au bureau devient un retour en quelques jours.'),
      evidence: [{ label: tx('القيمة', 'Valeur'), value: `${dz(atOffice.reduce((s, o) => s + o.total, 0))}` }],
      advice: tx('اتصل بكل زبون اليوم وذكّره بعنوان المكتب ومدة الاحتفاظ.', 'Appelez chaque client aujourd’hui avec l’adresse du bureau et le délai de garde.'),
      action: { to: '/orders?status=at_office', label: tx('فتح الطرود', 'Voir les colis') },
      impact_da: round(atOffice.reduce((s, o) => s + o.total, 0) * 0.5),
    });

  const failed = withStatusSince(projectIds, ['attempt_failed']);
  if (failed.length)
    push({
      key: 'delivery.attempt_failed',
      area: 'delivery',
      type: 'alert',
      severity: failed.length >= 5 ? 'high' : 'medium',
      title: tx(`${failed.length} طرد فشلت محاولة تسليمه`, `${failed.length} colis en échec de livraison`),
      insight: tx('اتصال منك الآن ينقذ نسبة كبيرة منها قبل أن تُرجع.', 'Un appel de votre part maintenant en sauve une bonne partie avant retour.'),
      evidence: [{ label: tx('القيمة', 'Valeur'), value: `${dz(failed.reduce((s, o) => s + o.total, 0))}` }],
      advice: tx('اتصل بالزبون، حدد موعداً جديداً وأبلغ شركة التوصيل أو حوّل إلى المكتب.', 'Appelez, fixez un nouveau créneau et prévenez le transporteur ou passez en stop-desk.'),
      action: { to: '/orders?status=attempt_failed', label: tx('معالجة', 'Traiter') },
    });

  const stuck = withStatusSince(projectIds, ['shipped', 'in_transit']).filter((o) => hoursSince(o.shipped_at || o.status_since) > 6 * 24);
  if (stuck.length)
    push({
      key: 'delivery.stuck_transit',
      area: 'delivery',
      type: 'observation',
      severity: 'medium',
      title: tx(`${stuck.length} طرد في الطريق منذ أكثر من 6 أيام`, `${stuck.length} colis en transit depuis plus de 6 jours`),
      insight: tx('غالباً طرد ضائع أو تتبع غير محدّث.', 'Souvent un colis égaré ou un suivi non mis à jour.'),
      evidence: [{ label: tx('الشركات', 'Transporteurs'), value: [...new Set(stuck.map((o) => o.carrier))].join(', ') }],
      advice: tx('حدّث التتبع ثم راسل خدمة الشركة بأرقام التتبع.', 'Actualisez le suivi puis contactez le support avec les numéros de suivi.'),
      action: { to: '/orders?status=in_transit', label: tx('فتح', 'Ouvrir') },
    });

  const toShip = withStatusSince(projectIds, ['confirmed']).filter((o) => hoursSince(o.confirmed_at || o.status_since) > 24);
  if (toShip.length)
    push({
      key: 'delivery.to_ship_backlog',
      area: 'delivery',
      type: 'alert',
      severity: toShip.length >= 10 ? 'high' : 'medium',
      title: tx(`${toShip.length} طلبية مؤكدة لم تُشحن منذ أكثر من 24 ساعة`, `${toShip.length} commandes confirmées non expédiées depuis +24 h`),
      insight: tx('التأخر في الشحن بعد التأكيد من أهم أسباب رفض الاستلام.', 'Tarder à expédier après confirmation est une cause majeure de refus.'),
      evidence: [{ label: tx('القيمة', 'Valeur'), value: `${dz(toShip.reduce((s, o) => s + o.total, 0))}` }],
      advice: tx('اشحنها اليوم دفعة واحدة مع اقتراح أفضل شركة لكل ولاية.', 'Expédiez-les aujourd’hui en lot avec le meilleur transporteur par wilaya.'),
      action: { to: '/orders?status=confirmed', label: tx('شحن الآن', 'Expédier') },
    });
}

function carrierRules(projectIds, push) {
  const rows = db
    .prepare(
      `SELECT project_id, carrier, wilaya_code, delivery_type, status, shipped_at, delivered_at, returned_at, delivery_attempts, livreur_called, livreur_rating
       FROM orders WHERE project_id IN (${inList(projectIds)}) AND carrier IS NOT NULL AND shipped_at >= ?`,
    )
    .all(...projectIds, new Date(Date.now() - (getSetting('carrier_window_days') || 120) * 86400e3).toISOString());
  if (rows.length < 20) return;
  const byW = {};
  for (const r of rows) ((byW[r.wilaya_code] ||= { all: [], by: {} }).all.push(r), ((byW[r.wilaya_code].by[r.carrier] ||= []).push(r)));
  const switches = [];
  const bad = [];
  for (const [code, w] of Object.entries(byW)) {
    const closed = w.all.filter((r) => ['delivered', 'returned'].includes(r.status));
    if (closed.length >= 8) {
      const ret = closed.filter((r) => r.status === 'returned').length / closed.length;
      if (ret > 0.4) bad.push({ code: Number(code), ret, n: closed.length });
    }
    const used = Object.entries(w.by).sort((a, b) => b[1].length - a[1].length)[0]?.[0];
    if (!used || w.all.length < 6) continue;
    const rec = recommendCarrier(projectIds, Number(code), 'home', { rows });
    const best = rec.ranked[0];
    const cur = rec.ranked.find((x) => x.carrier === used);
    if (best && cur && best.carrier !== used && best.configured && ['medium', 'high'].includes(best.confidence) && best.score - cur.score >= 8)
      switches.push({ code: Number(code), from: used, to: best.carrier, gain: best.estimated.success_rate - cur.estimated.success_rate, n: w.all.length });
  }
  if (switches.length) {
    const top = switches.sort((a, b) => b.gain * b.n - a.gain * a.n).slice(0, 6);
    push({
      key: 'carriers.switch',
      area: 'carriers',
      type: 'opportunity',
      severity: 'high',
      title: tx(`تغيير شركة التوصيل في ${switches.length} ولاية يرفع التسليم`, `Changer de transporteur dans ${switches.length} wilayas améliorerait la livraison`),
      insight: tx('الشركة الأكثر استعمالاً ليست الأفضل في هذه الولايات حسب بياناتك الحقيقية.', 'Le transporteur le plus utilisé n’est pas le meilleur dans ces wilayas selon vos propres données.'),
      evidence: top.map((x) => ({
        label: W(x.code),
        value: `${CARRIERS[x.from]?.name || x.from} → ${CARRIERS[x.to]?.name || x.to} (+${round(x.gain)} pts)`,
      })),
      advice: tx('عند الشحن، الـ ERP يقترح تلقائياً الشركة الأفضل لكل ولاية — اعتمد الاقتراح.', 'À l’expédition, l’ERP propose le meilleur transporteur par wilaya — suivez la suggestion.'),
      action: { to: '/carriers?tab=best', label: tx('أفضل شركة لكل ولاية', 'Meilleur par wilaya') },
    });
  }
  if (bad.length) {
    const top = bad.sort((a, b) => b.ret * b.n - a.ret * a.n).slice(0, 6);
    push({
      key: 'wilayas.high_returns',
      area: 'wilayas',
      type: 'alert',
      severity: 'medium',
      title: tx(`${bad.length} ولاية نسبة المرتجعات فيها فوق 40%`, `${bad.length} wilayas avec plus de 40 % de retours`),
      insight: tx('هذه الولايات تستهلك الإعلان والتوصيل دون ربح.', 'Ces wilayas consomment pub et livraison sans profit.'),
      evidence: top.map((x) => ({ label: W(x.code), value: `${round(x.ret * 100)}% (${x.n})` })),
      advice: tx(
        'فيها: اطلب تأكيداً مزدوجاً، فضّل التوصيل للمكتب، أو استثنها من استهداف الإعلانات مؤقتاً.',
        'Pour elles : double confirmation, privilégier le stop-desk, ou les exclure temporairement du ciblage pub.',
      ),
      action: { to: '/stats?tab=wilayas', label: tx('تحليل الولايات', 'Analyse par wilaya') },
    });
  }
  const closedBy = (type) => rows.filter((r) => r.delivery_type === type && ['delivered', 'returned'].includes(r.status));
  const home = closedBy('home');
  const desk = closedBy('desk');
  if (home.length >= 15 && desk.length >= 10) {
    const hr = home.filter((r) => r.status === 'delivered').length / home.length;
    const dr = desk.filter((r) => r.status === 'delivered').length / desk.length;
    if (dr - hr >= 0.12)
      push({
        key: 'carriers.desk_better',
        area: 'carriers',
        type: 'opportunity',
        severity: 'medium',
        title: tx('التوصيل للمكتب ينجح أكثر بكثير من المنزل', 'Le stop-desk réussit nettement mieux que le domicile'),
        insight: tx('الزبون الذي يتنقل للمكتب ملتزم أكثر بالاستلام.', 'Le client qui se déplace au bureau est plus engagé.'),
        evidence: [
          { label: tx('المكتب', 'Stop-desk'), value: `${round(dr * 100)}%` },
          { label: tx('المنزل', 'Domicile'), value: `${round(hr * 100)}%` },
        ],
        advice: tx('شجّع خيار المكتب بخصم صغير على التوصيل في صفحة المنتج.', 'Encouragez le stop-desk avec une petite remise livraison sur la page produit.'),
        action: { to: '/carriers', label: tx('التفاصيل', 'Détails') },
      });
  }
}

function productRules(projectIds, push) {
  const since14 = dzDayStartIso(addDays(dzDay(), -13));
  const since30 = dzDayStartIso(addDays(dzDay(), -29));
  const recent = ordersSince(projectIds, since30);
  const qty14 = {};
  const orders30 = {};
  for (const o of recent)
    for (const i of parseJson(o.items, [])) {
      if (!i.product_id) continue;
      orders30[i.product_id] = (orders30[i.product_id] || 0) + 1;
      if (o.created_at >= since14 && !['cancelled', 'fake'].includes(o.status)) qty14[i.product_id] = (qty14[i.product_id] || 0) + i.qty;
    }
  const products = db.prepare(`SELECT * FROM products WHERE project_id IN (${inList(projectIds)}) AND stage != 'archived'`).all(...projectIds);
  const activeAds = new Set(
    db
      .prepare("SELECT cp.product_id FROM campaign_products cp JOIN ad_campaigns c ON c.campaign_id = cp.campaign_id WHERE c.effective_status = 'ACTIVE' AND c.deleted = 0")
      .all()
      .map((r) => r.product_id),
  );
  const outSoon = [];
  const dead = [];
  const noCost = [];
  const weakSeo = [];
  const lowMargin = [];
  const suppliers = suppliersById();
  for (const p of products) {
    const perDay = (qty14[p.id] || 0) / 14;
    if (p.stock !== null && perDay > 0) {
      const days = p.stock / perDay;
      const sup = suppliers[p.supplier_id] || null;
      // التنبيه يسبق مدة توريد المورد بـ 3 أيام على الأقل
      if (days < Math.max(7, (sup?.lead_time_days ?? 0) + 3)) outSoon.push({ p, days, perDay, ads: activeAds.has(p.id), sup, plan: restockPlan(p, perDay, sup?.lead_time_days) });
    }
    if (p.stock > 0 && p.shopify_id && !orders30[p.id] && Date.parse(p.created_at) < Date.now() - 30 * 86400e3) dead.push(p);
    if (orders30[p.id] && !p.cost_price) noCost.push(p);
    if (p.shopify_id && p.stage === 'published' && p.seo_score !== null && p.seo_score < 60) weakSeo.push(p);
    if (p.price && p.cost_price) {
      const m = (p.price - p.cost_price - (p.packaging_cost || 0)) / p.price;
      if (m < 0.35 && orders30[p.id]) lowMargin.push({ p, m });
    }
  }
  for (const x of outSoon.sort((a, b) => a.days - b.days).slice(0, 5))
    push({
      key: `stock.out_soon:${x.p.id}`,
      area: 'stock',
      type: 'alert',
      severity: x.days < 2 || (x.sup?.lead_time_days ?? -1) >= x.days ? 'critical' : x.days < 4 || (x.sup?.lead_time_days ?? -1) + 2 >= x.days ? 'high' : 'medium',
      title: tx(`«${x.p.title}» ينفد خلال ${Math.max(0, round(x.days, 1))} يوم`, `« ${x.p.title} » en rupture dans ${Math.max(0, round(x.days, 1))} j`),
      insight: x.ads
        ? tx('الإعلان ما زال يعمل: نفاد المخزون يعني دفع ثمن طلبيات لن تُلبّى.', 'La pub tourne encore : une rupture = payer des commandes impossibles à servir.')
        : tx('بوتيرة البيع الحالية سينفد المخزون قريباً.', 'Au rythme actuel, le stock sera bientôt épuisé.'),
      evidence: [
        { label: tx('المخزون', 'Stock'), value: String(x.p.stock) },
        { label: tx('البيع اليومي', 'Ventes / jour'), value: String(round(x.perDay, 1)) },
        ...(x.sup
          ? [
              { label: tx('المورد', 'Fournisseur'), value: x.sup.name },
              ...(x.sup.lead_time_days !== null ? [{ label: tx('مدة التوريد', 'Délai fournisseur'), value: tx(`${x.sup.lead_time_days} يوم`, `${x.sup.lead_time_days} j`) }] : []),
              ...(x.plan.suggested_qty ? [{ label: tx('الكمية المقترحة', 'Quantité suggérée'), value: String(x.plan.suggested_qty) }] : []),
            ]
          : []),
      ],
      advice: joinTx(
        x.sup?.lead_time_days !== null && x.sup?.lead_time_days !== undefined && x.sup.lead_time_days >= x.days
          ? tx(`المورد يحتاج ${x.sup.lead_time_days} يوم والمخزون يكفي ${Math.max(0, round(x.days, 1))}: اطلب اليوم.`, `Le fournisseur livre en ${x.sup.lead_time_days} j, le stock tient ${Math.max(0, round(x.days, 1))} j : commandez aujourd’hui.`)
          : tx('اطلب كمية جديدة من المورد.', 'Passez une commande fournisseur.'),
        x.ads ? tx('الإعلان ما زال يعمل: خفّض الميزانية إن لم يصل المخزون قبل النفاد.', 'La pub tourne : baissez le budget si le réassort n’arrive pas avant la rupture.') : null,
        x.sup ? null : tx('اربط المنتج بمورده ليقترح الـ ERP الكمية ويجهّز رسالة الطلب.', 'Liez le produit à son fournisseur : l’ERP proposera la quantité et préparera le message.'),
      ),
      action: x.sup ? { to: '/contacts?kind=supplier', label: tx('اطلب من المورد', 'Commander') } : { to: `/products/${x.p.id}`, label: tx('اربط مورداً', 'Lier un fournisseur') },
    });
  if (dead.length)
    push({
      key: 'stock.dead',
      area: 'stock',
      type: 'opportunity',
      severity: 'low',
      title: tx(`${dead.length} منتج بمخزون دون أي طلبية في 30 يوماً`, `${dead.length} produits en stock sans commande depuis 30 j`),
      insight: tx('مال مجمّد في المخزن.', 'De la trésorerie immobilisée.'),
      evidence: dead.slice(0, 5).map((p) => ({ label: tx(p.title, p.title), value: `${p.stock} ${p.price ? `× ${dz(p.price)}` : ''}` })),
      advice: tx('اصنع عرض «اشترِ 2» أو أضفه كهدية مع منتج رابح، أو أطلق اختباراً إعلانياً قصيراً.', 'Faites un pack « 2 achetés », offrez-le avec un produit gagnant, ou lancez un test pub court.'),
      action: { to: '/products?filter=dead', label: tx('عرض', 'Voir') },
      impact_da: round(dead.reduce((s, p) => s + p.stock * (p.cost_price || 0), 0)),
    });
  if (noCost.length)
    push({
      key: 'catalog.missing_cost',
      area: 'finance',
      type: 'observation',
      severity: 'medium',
      title: tx(`${noCost.length} منتج يُباع دون سعر تكلفة`, `${noCost.length} produits vendus sans prix de revient`),
      insight: tx('دون التكلفة لا يمكن حساب الربح الحقيقي ولا حد التعادل للإعلانات.', 'Sans coût, impossible de calculer le vrai profit ni le seuil de rentabilité pub.'),
      evidence: noCost.slice(0, 5).map((p) => ({ label: tx(p.title, p.title), value: '—' })),
      advice: tx('أدخل سعر الشراء وتكلفة التغليف لكل منتج.', "Saisissez le prix d'achat et l'emballage de chaque produit."),
      action: { to: '/products?filter=no_cost', label: tx('إكمال', 'Compléter') },
    });
  for (const x of lowMargin.slice(0, 3))
    push({
      key: `product.low_margin:${x.p.id}`,
      area: 'products',
      type: 'observation',
      severity: 'medium',
      title: tx(`هامش «${x.p.title}» ${round(x.m * 100)}% فقط`, `Marge de « ${x.p.title} » : ${round(x.m * 100)} % seulement`),
      insight: tx('هامش أقل من 35% لا يتحمل تكلفة إعلان ومرتجعات في الدفع عند الاستلام.', 'Une marge < 35 % ne supporte pas pub + retours en COD.'),
      evidence: [
        { label: tx('السعر', 'Prix'), value: `${dz(x.p.price)}` },
        { label: tx('التكلفة', 'Coût'), value: `${dz(x.p.cost_price + (x.p.packaging_cost || 0))}` },
      ],
      advice: tx('ارفع السعر قليلاً مع قيمة مضافة (هدية، ضمان) أو اعرضه في حزمة.', 'Augmentez légèrement le prix avec une valeur ajoutée (cadeau, garantie) ou vendez-le en pack.'),
      action: { to: `/products/${x.p.id}`, label: tx('تعديل السعر', 'Modifier le prix') },
    });
  if (weakSeo.length)
    push({
      key: 'catalog.seo_weak',
      area: 'catalog',
      type: 'opportunity',
      severity: 'low',
      title: tx(`${weakSeo.length} صفحة منتج بتقييم SEO ضعيف`, `${weakSeo.length} fiches produit avec un SEO faible`),
      insight: tx('الزيارات المجانية من Google تقلل الاعتماد على الإعلانات على المدى البعيد.', 'Le trafic gratuit de Google réduit la dépendance aux pubs à long terme.'),
      evidence: weakSeo.slice(0, 5).map((p) => ({ label: tx(p.title, p.title), value: `${p.seo_score}/100` })),
      advice: tx('استعمل «توليد SEO» في محرر المنتج ثم «تطبيق» لنشره على المتجر.', 'Utilisez « Générer SEO » dans l’éditeur puis « Appliquer » pour publier.'),
      action: { to: '/products?filter=seo', label: tx('تحسين', 'Améliorer') },
    });

  // المنتجات حسب المرتجعات والأفضل ربحاً
  const closed = db
    .prepare(`SELECT items, status, total, cogs FROM orders WHERE project_id IN (${inList(projectIds)}) AND closed_at >= ? AND status IN ('delivered','returned')`)
    .all(...projectIds, dzDayStartIso(addDays(dzDay(), -59)));
  const byP = {};
  for (const o of closed)
    for (const i of parseJson(o.items, [])) {
      if (!i.product_id) continue;
      const x = (byP[i.product_id] ||= { d: 0, r: 0, title: i.title, rev: 0 });
      if (o.status === 'delivered') {
        x.d++;
        x.rev += i.price * i.qty;
      } else x.r++;
    }
  for (const [id, x] of Object.entries(byP))
    if (x.d + x.r >= 8 && x.r / (x.d + x.r) > 0.35)
      push({
        key: `product.high_returns:${id}`,
        area: 'products',
        type: 'alert',
        severity: 'medium',
        title: tx(`مرتجعات «${x.title}» ${pct(x.r, x.d + x.r)}%`, `Retours de « ${x.title} » : ${pct(x.r, x.d + x.r)} %`),
        insight: tx('نسبة أعلى من باقي المنتجات تعني غالباً فرقاً بين الإعلان والمنتج الحقيقي، أو سعراً مفاجئاً.', 'Plus élevé que les autres : souvent un écart pub/produit réel ou un prix surprise.'),
        evidence: [{ label: tx('مسلّمة / مرتجعة (60 يوماً)', 'Livrées / retours (60 j)'), value: `${x.d} / ${x.r}` }],
        advice: tx('اسأل المرتجعين عن السبب، وطابق الصور والوصف مع المنتج الحقيقي.', 'Demandez la raison aux clients, alignez photos et description avec le produit réel.'),
        action: { to: `/products/${id}`, label: tx('المنتج', 'Produit') },
      });
  const best = Object.entries(byP)
    .filter(([, x]) => x.d >= 5)
    .sort((a, b) => b[1].rev - a[1].rev)[0];
  if (best)
    push({
      key: `product.top:${best[0]}`,
      area: 'products',
      type: 'achievement',
      severity: 'info',
      title: tx(`«${best[1].title}» هو أفضل منتج (60 يوماً)`, `« ${best[1].title} » est le meilleur produit (60 j)`),
      insight: tx('المنتج الرابح أساس للتوسع: منتجات مكمّلة، حزم، وإعادة استهداف المشترين.', 'Un gagnant est une base : produits complémentaires, packs, retargeting des acheteurs.'),
      evidence: [
        { label: tx('مسلّمة', 'Livrées'), value: String(best[1].d) },
        { label: tx('الإيراد', 'CA'), value: `${dz(best[1].rev)}` },
      ],
      advice: tx('ابحث عن منتج مكمّل له واختبره لنفس الجمهور.', 'Cherchez un produit complémentaire et testez-le sur la même audience.'),
      action: { to: `/products/${best[0]}`, label: tx('المنتج', 'Produit') },
    });
}

function customerRules(projectIds, push) {
  const P = inList(projectIds);
  const ab = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS v FROM orders WHERE project_id IN (${P}) AND status = 'abandoned' AND created_at >= ? AND call_attempts = 0`)
    .get(...projectIds, dzDayStartIso(addDays(dzDay(), -6)));
  if (ab.n >= 3)
    push({
      key: 'leads.abandoned',
      area: 'customers',
      type: 'opportunity',
      severity: ab.n >= 10 ? 'high' : 'medium',
      title: tx(`${ab.n} سلة متروكة لم يُتصل بها (7 أيام)`, `${ab.n} paniers abandonnés jamais rappelés (7 j)`),
      insight: tx('زبون ترك رقمه = اهتمام حقيقي؛ مكالمة واحدة تسترجع جزءاً معتبراً.', 'Un client qui laisse son numéro est intéressé : un appel en récupère une bonne partie.'),
      evidence: [{ label: tx('القيمة', 'Valeur'), value: `${dz(ab.v)}` }],
      advice: tx('اتصل بهم اليوم بعرض صغير (توصيل مجاني أو هدية).', 'Rappelez-les aujourd’hui avec une petite offre (livraison offerte ou cadeau).'),
      action: { to: '/leads', label: tx('السلات المتروكة', 'Paniers abandonnés') },
      impact_da: round(ab.v * 0.2),
    });
  const repeat = db
    .prepare(`SELECT COUNT(*) AS n FROM (SELECT phone FROM orders WHERE project_id IN (${P}) AND status = 'delivered' AND phone IS NOT NULL GROUP BY phone HAVING COUNT(*) >= 2)`)
    .get(...projectIds).n;
  const buyers = db.prepare(`SELECT COUNT(DISTINCT phone) AS n FROM orders WHERE project_id IN (${P}) AND status = 'delivered'`).get(...projectIds).n;
  if (buyers >= 30)
    push({
      key: 'customers.repeat',
      area: 'customers',
      type: repeat / buyers >= 0.1 ? 'achievement' : 'opportunity',
      severity: 'low',
      title: tx(`${pct(repeat, buyers)}% من زبائنك اشتروا أكثر من مرة`, `${pct(repeat, buyers)} % de vos clients ont racheté`),
      insight: tx(
        `لديك ${buyers} زبوناً استلموا فعلاً — جمهور ثقة لا يحتاج إعلاناً باهظاً.`,
        `Vous avez ${buyers} clients livrés — une audience de confiance qui ne coûte presque rien.`,
      ),
      evidence: [{ label: tx('زبائن متكررون', 'Clients récurrents'), value: String(repeat) }],
      advice: tx('صدّر أرقامهم كجمهور مخصص في Meta (Lookalike) وأرسل لهم العروض الجديدة عبر واتساب.', 'Exportez-les en audience personnalisée Meta (Lookalike) et envoyez-leur les nouveautés via WhatsApp.'),
      action: { to: '/customers', label: tx('الزبائن', 'Clients') },
    });
  const fake = db
    .prepare(`SELECT COUNT(*) AS n FROM orders WHERE project_id IN (${P}) AND status = 'fake' AND created_at >= ?`)
    .get(...projectIds, dzDayStartIso(addDays(dzDay(), -13))).n;
  const all14 = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE project_id IN (${P}) AND status != 'abandoned' AND created_at >= ?`).get(...projectIds, dzDayStartIso(addDays(dzDay(), -13))).n;
  if (all14 >= 30 && fake / all14 > 0.08)
    push({
      key: 'customers.fake_orders',
      area: 'customers',
      type: 'alert',
      severity: 'medium',
      title: tx(`${pct(fake, all14)}% طلبيات وهمية (14 يوماً)`, `${pct(fake, all14)} % de fausses commandes (14 j)`),
      insight: tx('غالباً من موضع إعلاني رخيص (Audience Network) أو من منافس.', 'Souvent un placement bon marché (Audience Network) ou un concurrent.'),
      evidence: [{ label: tx('وهمية', 'Fausses'), value: String(fake) }],
      advice: tx('احظر الأرقام في قائمة الزبائن وأوقف موضع Audience Network.', 'Blacklistez les numéros et coupez Audience Network.'),
      action: { to: '/customers?flag=blacklist', label: tx('القائمة السوداء', 'Liste noire') },
    });
}

function financeAndTimingRules(projectIds, push) {
  const today = dzDay();
  const cur = stats(projectIds, addDays(today, -6), today);
  const prev = stats(projectIds, addDays(today, -13), addDays(today, -7));
  const f = cur.finance;
  if (cur.funnel.delivered + cur.funnel.returned >= 5 && f.profit < 0)
    push({
      key: 'finance.loss_week',
      area: 'finance',
      type: 'alert',
      severity: 'critical',
      title: tx(`خسارة تقديرية ${dz(-f.profit)} هذا الأسبوع`, `Perte estimée de ${dz(-f.profit)} cette semaine`),
      insight: tx('المصاريف (إعلان + توصيل + مرتجعات) أكبر من هامش الطلبيات المسلّمة.', 'Les charges (pub + livraison + retours) dépassent la marge des commandes livrées.'),
      evidence: [
        { label: tx('الإيراد', 'CA'), value: `${dz(f.revenue)}` },
        { label: tx('الإعلانات', 'Pub'), value: `${dz(f.ad_spend_da)}` },
        { label: tx('تكلفة كل طلبية مسلّمة', 'Coût par livrée'), value: f.cost_per_delivered ? `${dz(f.cost_per_delivered)}` : '—' },
      ],
      advice: tx('راجع قرارات الإعلانات (أوقف الخاسر) وأولويات التأكيد والتسليم أعلاه.', 'Appliquez les décisions pub (couper les perdants) et les priorités confirmation/livraison.'),
      action: { to: '/ads?tab=decisions', label: tx('قرارات الإعلانات', 'Décisions pub') },
      impact_da: round(-f.profit),
    });
  else if (prev.finance.profit > 0 && f.profit > prev.finance.profit * 1.2 && f.profit > 0)
    push({
      key: 'finance.profit_up',
      area: 'finance',
      type: 'achievement',
      severity: 'info',
      title: tx(`الربح ارتفع ${pct(f.profit - prev.finance.profit, prev.finance.profit)}% عن الأسبوع الماضي`, `Profit en hausse de ${pct(f.profit - prev.finance.profit, prev.finance.profit)} % vs semaine dernière`),
      insight: tx('دوّن ما تغيّر حتى تكرره.', 'Notez ce qui a changé pour le reproduire.'),
      evidence: [{ label: tx('هذا الأسبوع', 'Cette semaine'), value: `${dz(f.profit)}` }],
      action: { to: '/finance', label: tx('المالية', 'Finance') },
    });
  if (f.cost_per_delivered && prev.finance.cost_per_delivered && f.cost_per_delivered > prev.finance.cost_per_delivered * 1.3 && cur.funnel.delivered >= 5)
    push({
      key: 'ads.cpd_up',
      area: 'ads',
      type: 'alert',
      severity: 'high',
      title: tx('تكلفة الإعلان لكل طلبية مسلّمة ارتفعت بقوة', 'Le coût pub par commande livrée a fortement augmenté'),
      insight: tx('تعب الجمهور أو تصميم مستهلك أو ارتفاع المنافسة.', 'Audience fatiguée, créa usée ou concurrence en hausse.'),
      evidence: [
        { label: tx('هذا الأسبوع', 'Cette semaine'), value: `${dz(f.cost_per_delivered)}` },
        { label: tx('الأسبوع الماضي', 'Semaine passée'), value: `${dz(prev.finance.cost_per_delivered)}` },
      ],
      advice: tx('جدّد التصاميم (زاوية جديدة)، وراقب التكرار (Frequency) في الحملات.', 'Renouvelez les créas (nouvel angle) et surveillez la fréquence.'),
      action: { to: '/ads?tab=campaigns', label: tx('الحملات', 'Campagnes') },
    });

  // أفضل الأوقات
  const rows = db
    .prepare(`SELECT created_at FROM orders WHERE project_id IN (${inList(projectIds)}) AND status != 'abandoned' AND created_at >= ?`)
    .all(...projectIds, dzDayStartIso(addDays(today, -41)));
  if (rows.length >= 60) {
    const hours = Array(24).fill(0);
    const days = Array(7).fill(0);
    for (const r of rows) {
      const d = new Date(Date.parse(r.created_at) + HOUR);
      hours[d.getUTCHours()]++;
      days[d.getUTCDay()]++;
    }
    const topHours = hours
      .map((n, h) => ({ h, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((x) => `${String(x.h).padStart(2, '0')}h`);
    const dayNames = { ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'], fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] };
    const bestDay = days.indexOf(Math.max(...days));
    const worstDay = days.indexOf(Math.min(...days));
    push({
      key: 'timing.peaks',
      area: 'timing',
      type: 'observation',
      severity: 'info',
      title: tx(`ذروة الطلبيات: ${topHours.join('، ')} — أفضل يوم ${dayNames.ar[bestDay]}`, `Pic de commandes : ${topHours.join(', ')} — meilleur jour : ${dayNames.fr[bestDay]}`),
      insight: tx('ركّز فرق التأكيد في هذه الساعات وكن متاحاً للرد على الرسائل.', 'Concentrez l’équipe de confirmation sur ces heures et soyez joignable.'),
      evidence: [
        { label: tx('أضعف يوم', 'Jour le plus faible'), value: tx(dayNames.ar[worstDay], dayNames.fr[worstDay]) },
        { label: tx('عيّنة', 'Échantillon'), value: `${rows.length}` },
      ],
      advice: tx('اتصل بالطلبيات الجديدة مباشرة في الذروة؛ ولا تغيّر ميزانية الإعلانات بسبب يوم ضعيف واحد.', 'Appelez en direct pendant les pics ; ne touchez pas au budget pub pour un seul jour faible.'),
      action: { to: '/stats', label: tx('الإحصاءات', 'Statistiques') },
    });
  }
}

const PARAM_LABELS = {
  spend_da: tx('الإنفاق', 'Dépense'),
  cpd: tx('تكلفة الطلبية المسلّمة', 'Coût par livrée'),
  be: tx('حد التعادل', 'Seuil de rentabilité'),
  feedback: tx('سبب الرفض', 'Motif du refus'),
  link: tx('الرابط الحالي', 'Lien actuel'),
  score: tx('تقييم SEO', 'Score SEO'),
  budget: tx('ميزانية الاختبار', 'Budget du test'),
  budget_now: tx('الميزانية اليومية الحالية', 'Budget journalier actuel'),
  budget_next: tx('الزيادة الآمنة التالية (+20%)', 'Prochaine hausse sûre (+20 %)'),
};
const MONEY_PARAMS = new Set(['spend_da', 'cpd', 'be', 'budget']);

function adsRules(projectIds, push) {
  for (const pid of projectIds) {
    let list = [];
    try {
      list = decisions(pid, 7);
    } catch {
      continue;
    }
    const titles = {
      fx_not_set: tx('أسعار صرف الدولار/اليورو غير محددة', 'Taux de change USD/EUR non définis'),
      stop_test: tx('أوقف اختباراً خاسراً', 'Arrêtez un test perdant'),
      scale_budget: tx('منتج رابح: زِد الميزانية تدريجياً', 'Produit gagnant : augmentez le budget progressivement'),
      thin_margin: tx('هامش ضيق بعد الإعلان', 'Marge faible après pub'),
      ad_rejected: tx('إعلان مرفوض أو به مشكلة', 'Pub refusée ou en erreur'),
      wrong_link: tx('رابط الإعلان لا يشير إلى متجرك', "Le lien de la pub ne pointe pas vers votre boutique"),
      campaign_not_running: tx('منتج في الاختبار وحملته متوقفة', 'Produit en test avec campagne à l’arrêt'),
      no_campaign: tx('منتج في الاختبار دون حملة', 'Produit en test sans campagne'),
      weak_page: tx('صفحة المنتج المُعلَن ضعيفة', 'Page du produit en pub trop faible'),
      budget_spent_no_verdict: tx('الميزانية صُرفت دون حكم واضح', 'Budget dépensé sans verdict'),
    };
    const advice = {
      fx_not_set: tx('حدد سعر الصرف الفعلي (السوق الموازي) في الإعدادات حتى تكون الأرباح صحيحة.', 'Saisissez le taux réel (marché parallèle) dans les paramètres.'),
      stop_test: tx('تكلفة الطلبية المسلّمة أعلى من حد التعادل: أوقف الحملة وجرّب زاوية أو منتجاً آخر.', 'Coût par livrée au-dessus du seuil : coupez et testez un autre angle/produit.'),
      scale_budget: tx(
        'حسب Meta: تغيير الميزانية الكبير قد يعيد المجموعة إلى مرحلة التعلم. ارفع 20% كحد أقصى في كل مرة، ثم انتظر 3–4 أيام (وبعد خروج المجموعة من التعلم ≈50 نتيجة في 7 أيام) قبل الزيادة التالية. للتوسع الأسرع: انسخ المجموعة الرابحة بميزانية جديدة بدل القفزة الكبيرة.',
        'Selon Meta, un gros changement de budget peut relancer l’apprentissage. Augmentez de 20 % maximum à la fois, puis attendez 3–4 jours (et la sortie d’apprentissage ≈ 50 résultats/7 j). Pour aller plus vite : dupliquez l’ensemble gagnant plutôt qu’un saut brutal.',
      ),
      thin_margin: tx('حسّن نسبة التأكيد والتسليم أو ارفع السعر قبل التوسع.', 'Améliorez confirmation/livraison ou le prix avant de scaler.'),
      ad_rejected: tx('عدّل النص أو الصورة من محرر الحملة داخل الـ ERP.', "Modifiez texte ou image depuis l'éditeur de campagne."),
      wrong_link: tx('صحّح الرابط في قسم الإعلان.', 'Corrigez le lien dans la section Publicité.'),
      campaign_not_running: tx('فعّل الحملة أو غيّر مرحلة المنتج.', 'Activez la campagne ou changez l’étape du produit.'),
      no_campaign: tx('أطلق حملة للمنتج من زر «إطلاق حملة».', 'Lancez une campagne via « Lancer une campagne ».'),
      weak_page: tx('حسّن صفحة المنتج (صور، وصف، SEO) قبل صرف المزيد.', 'Améliorez la page (photos, description, SEO) avant de dépenser plus.'),
      budget_spent_no_verdict: tx('قرر الآن: أوقف أو مدّد بميزانية محدودة.', 'Décidez : arrêter ou prolonger avec un budget limité.'),
    };
    for (const d of list)
      push({
        key: `ads.${d.id}`,
        area: 'ads',
        type: ['scale_budget'].includes(d.kind) ? 'opportunity' : 'alert',
        severity: d.severity,
        title: d.title ? tx(`${titles[d.kind]?.ar || d.kind}: ${d.title}`, `${titles[d.kind]?.fr || d.kind} : ${d.title}`) : titles[d.kind] || tx(d.kind, d.kind),
        insight: advice[d.kind] || tx('', ''),
        evidence: Object.entries(d.params || {})
          .filter(([k, v]) => v !== null && v !== undefined && v !== '' && k !== 'currency')
          .map(([k, v]) => ({
            label: PARAM_LABELS[k] || tx(k, k),
            value: k.startsWith('budget_') ? `\u2066${v} ${d.params.currency || ''}\u2069` : typeof v === 'number' ? (MONEY_PARAMS.has(k) ? dz(v) : fmt(v)) : String(v),
          })),
        action: { to: d.action === 'open_settings' ? '/settings?tab=general' : d.product_id ? `/ads?product=${d.product_id}` : '/ads?tab=decisions', label: tx('فتح', 'Ouvrir') },
        project_id: pid,
      });
  }
}

function splitRules(projectIds, push) {
  for (const r of splitInsights(projectIds)) {
    const t = r.test;
    if (r.no_traffic)
      push({
        key: `split.no_traffic:${t.id}`,
        area: 'splits',
        type: 'alert',
        severity: 'high',
        title: tx(`اختبار «${t.name}» لا يصله أي زائر`, `Le test « ${t.name} » ne reçoit aucun visiteur`),
        insight: tx('الرابط غير موضوع في الإعلان أو غير متاح من الإنترنت.', 'Le lien n’est pas dans la pub ou n’est pas accessible depuis Internet.'),
        evidence: [{ label: tx('الرابط', 'Lien'), value: r.test.public_url || `/go/${t.slug}` }],
        advice: tx('تحقق من الرابط العام في إعدادات المشروع (Tailscale Funnel أو Cloudflare) وضعه في الإعلان.', 'Vérifiez l’URL publique (Tailscale Funnel ou Cloudflare) et mettez-la dans la pub.'),
        action: { to: `/splits/${t.id}`, label: tx('الاختبار', 'Le test') },
      });
    else if (r.verdict === 'winner') {
      const w = r.variants.find((v) => v.id === r.leader.id);
      push({
        key: `split.winner:${t.id}`,
        area: 'splits',
        type: 'opportunity',
        severity: 'high',
        title: tx(`الصفحة ${w.label} فازت في «${t.name}» (${r.leader.p_best}%)`, `La page ${w.label} gagne « ${t.name} » (${r.leader.p_best} %)`),
        insight: tx('الفارق ثابت إحصائياً: إبقاء الصفحات الأخرى يكلف طلبيات.', 'L’écart est statistiquement solide : garder les autres pages coûte des commandes.'),
        evidence: r.variants.map((v) => ({ label: tx(`${v.label}${v.name ? ` · ${v.name}` : ''}`, `${v.label}${v.name ? ` · ${v.name}` : ''}`), value: `${v.successes}/${v.visitors} (${v.goal_rate ?? 0}%)` })),
        advice: tx('أنهِ الاختبار واعتمد الصفحة الفائزة، ثم اختبر تحسيناً جديداً ضدها.', 'Terminez le test, gardez la gagnante puis testez une nouvelle amélioration contre elle.'),
        action: { to: `/splits/${t.id}`, label: tx('اعتماد الفائز', 'Valider la gagnante') },
      });
    } else if (r.verdict === 'no_difference')
      push({
        key: `split.no_diff:${t.id}`,
        area: 'splits',
        type: 'observation',
        severity: 'low',
        title: tx(`لا فرق حقيقي بين صفحات «${t.name}»`, `Pas de vraie différence entre les pages de « ${t.name} »`),
        insight: tx('الاختلاف بين الصفحات صغير جداً ليؤثر؛ جرّب تغييراً أكبر (العرض، السعر، الصورة الأولى).', 'Les variantes sont trop proches ; testez un changement plus fort (offre, prix, première image).'),
        evidence: r.variants.map((v) => ({ label: tx(v.label, v.label), value: `${v.goal_rate ?? 0}%` })),
        action: { to: `/splits/${t.id}`, label: tx('الاختبار', 'Le test') },
      });
  }
}

function setupRules(projectIds, push) {
  for (const pid of projectIds) {
    const cfg = projectConfig(pid);
    const missing = [];
    if (!shopify.isConfigured(cfg)) missing.push(tx('ربط Shopify', 'Connexion Shopify'));
    if (!Object.values(CARRIERS).some((c) => c.isConfigured(cfg))) missing.push(tx('شركة توصيل واحدة على الأقل', 'Au moins un transporteur'));
    if (!meta.isConfigured(cfg)) missing.push(tx('حساب Meta الإعلاني', 'Compte publicitaire Meta'));
    if (!cfg.meta_pixel_id) missing.push(tx('البيكسل', 'Pixel'));
    if (!ai.aiConfigured()) missing.push(tx('مفتاح الذكاء الاصطناعي', 'Clé IA'));
    if (missing.length)
      push({
        key: `setup.missing:${pid}`,
        area: 'setup',
        type: 'observation',
        severity: missing.length >= 3 ? 'medium' : 'low',
        title: tx(`${missing.length} ربط ناقص لتحليل كامل`, `${missing.length} connexions manquantes pour une analyse complète`),
        insight: tx('كل ربط يضيف بيانات حقيقية يعتمد عليها المستشار.', 'Chaque connexion apporte des données réelles à l’analyse.'),
        evidence: missing.map((m) => ({ label: m, value: '✗' })),
        action: { to: '/settings?tab=integrations', label: tx('الإعدادات', 'Paramètres') },
        project_id: pid,
      });
  }
  // البيانات خارج الجهاز: الكود في GitHub، لكن الطلبيات والزبائن في قاعدة البيانات المحلية فقط
  const b = backupStatus().mirror;
  if (!b.configured || !b.reachable || b.behind)
    push({
      key: 'setup.backup_offsite',
      area: 'setup',
      type: 'alert',
      severity: b.configured ? 'high' : 'medium',
      title: b.configured
        ? tx('النسخة الاحتياطية خارج الجهاز متوقفة', 'La sauvegarde hors ordinateur ne se fait plus')
        : tx('النسخ الاحتياطية على هذا الجهاز فقط', 'Sauvegardes uniquement sur cet ordinateur'),
      insight: tx('إن تعطّل الجهاز تضيع الطلبيات والزبائن والإعدادات. الكود محفوظ في GitHub، أما البيانات فلا.', 'Si l’ordinateur lâche, commandes, clients et réglages sont perdus. Le code est sur GitHub, pas les données.'),
      evidence: [
        { label: tx('المجلد السحابي', 'Dossier cloud'), value: b.dir || '✗' },
        { label: tx('آخر نسخة خارج الجهاز', 'Dernière copie externe'), value: b.last?.name || '—' },
      ],
      advice: b.configured
        ? tx('تأكد أن المجلد موجود وأن تطبيق Google Drive أو OneDrive يعمل، ثم اضغط «نسخة احتياطية الآن».', 'Vérifiez que le dossier existe et que Google Drive / OneDrive tourne, puis « Sauvegarder maintenant ».')
        : tx('ضع مسار مجلد Google Drive أو OneDrive أو iCloud في ERP_BACKUP_MIRROR داخل ملف .env ثم أعد التشغيل.', 'Indiquez un dossier Google Drive / OneDrive / iCloud dans ERP_BACKUP_MIRROR (.env) puis redémarrez.'),
      action: { to: '/settings?tab=system', label: tx('النظام', 'Système') },
    });
}

// ————————————————————————————————————————————————
// التقييم العام (0–100) لكل مجال
// ————————————————————————————————————————————————
function scores(projectIds) {
  const s = stats(projectIds, addDays(dzDay(), -29), dzDay());
  const grade = (v, good, bad) => (v === null || v === undefined ? null : Math.round(Math.max(0, Math.min(100, ((v - bad) / (good - bad)) * 100))));
  const confirmation = grade(s.confirmation_rate, 80, 40);
  const delivery = grade(s.delivery_rate, 85, 50);
  const margin = s.finance.revenue ? (100 * s.finance.profit) / s.finance.revenue : null;
  const profit = grade(margin, 30, -10);
  const products = db.prepare(`SELECT AVG(seo_score) AS a FROM products WHERE project_id IN (${inList(projectIds)}) AND stage = 'published' AND seo_score IS NOT NULL`).get(...projectIds).a;
  const catalog = products === null ? null : Math.round(products);
  const parts = [
    [confirmation, 0.3],
    [delivery, 0.3],
    [profit, 0.3],
    [catalog, 0.1],
  ].filter(([v]) => v !== null);
  const weight = parts.reduce((x, [, w]) => x + w, 0);
  return {
    overall: weight ? Math.round(parts.reduce((x, [v, w]) => x + v * w, 0) / weight) : null,
    confirmation,
    delivery,
    profit,
    catalog,
    raw: { confirmation_rate: s.confirmation_rate, delivery_rate: s.delivery_rate, profit_margin: margin === null ? null : round(margin), profit: s.finance.profit, revenue: s.finance.revenue, orders: s.funnel.orders },
  };
}

// ————————————————————————————————————————————————
export function analyze(projectIds) {
  const out = [];
  const errors = [];
  const push = (i) => out.push({ project_id: projectIds.length === 1 ? projectIds[0] : null, impact_da: null, ...i });
  // قاعدة معطوبة لا تُسقط الصفحة، لكنها تُسجَّل وتظهر في النتيجة حتى لا تمر بصمت
  const safe = (fn) => {
    try {
      fn(projectIds, push);
    } catch (e) {
      console.error('[advisor]', fn.name, e);
      errors.push({ rule: fn.name, error: e.message });
    }
  };
  [confirmationRules, deliveryRules, carrierRules, productRules, customerRules, financeAndTimingRules, adsRules, splitRules, setupRules].forEach(safe);

  const states = db
    .prepare(`SELECT * FROM insight_states WHERE project_id IN (0, ${inList(projectIds)})`)
    .all(...projectIds);
  const stateOf = (k) => states.find((s) => s.key === k);
  const now = nowIso();
  const insights = out
    .map((i) => {
      const st = stateOf(i.key);
      const hidden = st && (st.status === 'dismissed' || st.status === 'done' || (st.status === 'snoozed' && st.until > now));
      return { ...i, state: st ? { status: st.status, until: st.until, note: st.note, at: st.updated_at } : null, hidden: Boolean(hidden) };
    })
    .sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || (b.impact_da || 0) - (a.impact_da || 0));
  const visible = insights.filter((i) => !i.hidden);
  return {
    generated_at: now,
    scores: scores(projectIds),
    counts: {
      critical: visible.filter((i) => i.severity === 'critical').length,
      high: visible.filter((i) => i.severity === 'high').length,
      opportunities: visible.filter((i) => i.type === 'opportunity').length,
      achievements: visible.filter((i) => i.type === 'achievement').length,
      hidden: insights.length - visible.length,
    },
    potential_da: round(visible.reduce((s, i) => s + (i.impact_da || 0), 0)),
    insights,
    errors,
  };
}

/** وضع علامة على ملاحظة: تم التنفيذ / تجاهل / تأجيل حتى تاريخ */
export function setInsightState(projectId, key, { status, days, note, userId }) {
  if (!status) {
    db.prepare('DELETE FROM insight_states WHERE project_id = ? AND key = ?').run(projectId || 0, key);
    return;
  }
  const until = status === 'snoozed' ? new Date(Date.now() + (days || 3) * 86400e3).toISOString() : null;
  db.prepare(
    `INSERT INTO insight_states (project_id, key, status, until, note, user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET status = excluded.status, until = excluded.until, note = excluded.note, user_id = excluded.user_id, updated_at = excluded.updated_at`,
  ).run(projectId || 0, key, status, until, note || null, userId || null, nowIso());
  // «تم التنفيذ» يُسجَّل في دفتر الملاحظات كقرار، حتى يقيس المستشار أثره لاحقاً
  if (status === 'done' && note) db.prepare("INSERT INTO journal (project_id, kind, text, created_by) VALUES (?, 'decision', ?, ?)").run(projectId || null, note, userId || null);
}

// ——— دفتر الملاحظات ———
export function journal(projectIds, { kind, limit = 200 } = {}) {
  return db
    .prepare(
      `SELECT j.*, u.display_name AS author, p.name AS project_name FROM journal j LEFT JOIN users u ON u.id = j.created_by LEFT JOIN projects p ON p.id = j.project_id
       WHERE (j.project_id IS NULL OR j.project_id IN (${inList(projectIds)})) ${kind ? 'AND j.kind = ?' : ''} ORDER BY j.pinned DESC, j.created_at DESC LIMIT ?`,
    )
    .all(...projectIds, ...(kind ? [kind] : []), limit);
}

export function addJournal({ projectId, kind, text, entityType, entityId, userId }) {
  const info = db
    .prepare('INSERT INTO journal (project_id, kind, text, entity_type, entity_id, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(projectId || null, kind || 'note', text, entityType || null, entityId || null, userId || null);
  return db.prepare('SELECT * FROM journal WHERE id = ?').get(info.lastInsertRowid);
}

export function updateJournal(id, { text, kind, pinned }) {
  const cur = db.prepare('SELECT * FROM journal WHERE id = ?').get(id);
  if (!cur) return null;
  db.prepare('UPDATE journal SET text = ?, kind = ?, pinned = ? WHERE id = ?').run(text ?? cur.text, kind ?? cur.kind, pinned === undefined ? cur.pinned : pinned ? 1 : 0, id);
  return db.prepare('SELECT * FROM journal WHERE id = ?').get(id);
}

export const deleteJournal = (id) => db.prepare('DELETE FROM journal WHERE id = ?').run(id).changes;

// ————————————————————————————————————————————————
// المستشار الذكي: تقرير تحليلي عميق (تقييمات، استنتاجات، اقتراحات، تجارب)
// ————————————————————————————————————————————————
const s = { type: 'string' };
export const ADVISOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'evaluations', 'conclusions', 'suggestions', 'experiments', 'watch', 'questions'],
  properties: {
    headline: s,
    summary: s,
    evaluations: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['area', 'grade', 'comment'], properties: { area: s, grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] }, comment: s } },
    },
    conclusions: { type: 'array', items: s },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why', 'how', 'impact', 'effort', 'area'],
        properties: { title: s, why: s, how: s, impact: { type: 'string', enum: ['high', 'medium', 'low'] }, effort: { type: 'string', enum: ['low', 'medium', 'high'] }, area: s },
      },
    },
    experiments: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['hypothesis', 'test', 'metric', 'duration_days'], properties: { hypothesis: s, test: s, metric: s, duration_days: { type: 'integer' } } },
    },
    watch: { type: 'array', items: s },
    questions: { type: 'array', items: s },
  },
};

function compactStats(st) {
  return {
    period: `${st.from}..${st.to}`,
    funnel: st.funnel,
    confirmation_rate: st.confirmation_rate,
    delivery_rate: st.delivery_rate,
    finance: st.finance,
    top_wilayas: st.wilayas.slice(0, 12).map((w) => ({ w: w.wilaya?.fr || w.wilaya_code, orders: w.orders, delivery_rate: w.delivery_rate })),
    top_products: st.products.slice(0, 10).map((p) => ({ title: p.title, orders: p.orders, delivered: p.delivered, returned: p.returned, revenue: Math.round(p.revenue) })),
    sources: st.sources.slice(0, 8),
    agents: st.agents.map((a) => ({ name: a.display_name, confirmed: a.confirmed, cancelled: a.cancelled, no_answer: a.no_answer })),
  };
}

export async function aiReport(projectIds, { userId, lang = 'ar', focus = '' } = {}) {
  if (!ai.aiConfigured()) throw Object.assign(new Error('ai_not_configured'), { status: 400 });
  const to = dzDay();
  const from = addDays(to, -29);
  const cur = stats(projectIds, from, to);
  const prev = stats(projectIds, addDays(from, -30), addDays(from, -1));
  const a = analyze(projectIds);
  const notes = journal(projectIds, { limit: 40 }).map((j) => ({ kind: j.kind, at: j.created_at.slice(0, 10), text: j.text }));
  const projects = listProjects()
    .filter((p) => projectIds.includes(p.id))
    .map((p) => ({ id: p.id, name: p.name, domain: projectConfig(p.id).store_domain }));
  const spend = db
    .prepare(`SELECT currency, SUM(spend) AS s FROM ad_spend WHERE project_id IN (${inList(projectIds)}) AND date >= ? GROUP BY currency`)
    .all(...projectIds, from)
    .map((r) => ({ currency: r.currency, spend: round(r.s, 2), spend_da: round(toDa(r.s, r.currency)) }));
  const language = lang === 'fr' ? 'le français' : 'العربية الفصحى المبسطة (مع مصطلحات التجارة الإلكترونية الشائعة في الجزائر)';
  const res = await ai.structured({
    system: `أنت مستشار نمو لمتجر تجارة إلكترونية جزائري يعمل بالدفع عند الاستلام (COD) عبر Shopify وإعلانات Meta وشركات التوصيل Yalidine وNOEST وZR Express.
مهمتك: تقييم صريح ومبني على الأرقام فقط، استنتاجات واضحة، واقتراحات عملية مرتبة حسب الأثر — لا عموميات ولا نصائح لا ترتبط بالبيانات.
قواعد:
- استشهد بالأرقام الواردة في كل استنتاج واقتراح؛ لا تخترع أرقاماً غير موجودة.
- اعتمد على الطلبيات المسلّمة لا على مشتريات البيكسل عند الحكم على الإعلانات.
- قارن الفترة الحالية بالسابقة واذكر الاتجاه.
- استفد من دفتر الملاحظات (قرارات ودروس سابقة) لتقييم أثر ما نُفذ وتجنب تكرار الأخطاء.
- إن كانت البيانات قليلة فقل ذلك واقترح ما يجب قياسه.
- الاقتراحات: 4 إلى 8، لكل واحد لماذا (بالأرقام) وكيف (خطوات داخل الـ ERP أو خارجه) والأثر والجهد.
- التجارب: 1 إلى 3 تجارب A/B قابلة للقياس.
- اكتب بـ ${language}.`,
    prompt: JSON.stringify({
      projects,
      current_30d: compactStats(cur),
      previous_30d: compactStats(prev),
      ad_spend_30d: spend,
      health_scores: a.scores,
      rule_based_insights: a.insights
        .filter((i) => !i.hidden)
        .slice(0, 30)
        .map((i) => ({ area: i.area, type: i.type, severity: i.severity, title: i.title.ar, evidence: i.evidence.map((e) => `${e.label.ar || e.label}: ${typeof e.value === 'object' ? e.value.ar : e.value}`) })),
      journal: notes,
      focus: focus || null,
    }),
    schema: ADVISOR_SCHEMA,
    effort: 'high',
    maxTokens: 12000,
  });
  const key = projectIds.slice().sort().join(',');
  const info = db.prepare('INSERT INTO advisor_reports (project_key, period_from, period_to, content, model, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(key, from, to, JSON.stringify(res), ai.model(), userId || null);
  return { id: Number(info.lastInsertRowid), period_from: from, period_to: to, created_at: nowIso(), content: res };
}

export function reports(projectIds, limit = 20) {
  const key = projectIds.slice().sort().join(',');
  return db
    .prepare('SELECT * FROM advisor_reports WHERE project_key = ? ORDER BY id DESC LIMIT ?')
    .all(key, limit)
    .map((r) => ({ ...r, content: parseJson(r.content, {}) }));
}
