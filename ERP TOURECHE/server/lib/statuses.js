import { fold } from './util.js';

/**
 * مراحل الطلبية من الاستلام إلى التسليم.
 * group: confirm (مرحلة التأكيد) · shipping (عند شركة التوصيل) · final (نهائية) · closed (ألغيت قبل الشحن)
 */
export const STATUSES = {
  abandoned: { group: 'confirm', ar: 'غير مكتملة', fr: 'Abandonnée', tone: 'neutral' },
  new: { group: 'confirm', ar: 'جديدة', fr: 'Nouvelle', tone: 'info' },
  no_answer: { group: 'confirm', ar: 'لا يرد', fr: 'Ne répond pas', tone: 'warning' },
  callback: { group: 'confirm', ar: 'اتصل لاحقاً', fr: 'À rappeler', tone: 'warning' },
  confirmed: { group: 'confirm', ar: 'مؤكدة', fr: 'Confirmée', tone: 'success' },
  cancelled: { group: 'closed', ar: 'ملغاة', fr: 'Annulée', tone: 'danger' },
  fake: { group: 'closed', ar: 'مزيفة / مكررة', fr: 'Fausse / doublon', tone: 'danger' },
  shipped: { group: 'shipping', ar: 'أُرسلت للتوصيل', fr: 'Expédiée', tone: 'info' },
  in_transit: { group: 'shipping', ar: 'في الطريق', fr: 'En transit', tone: 'info' },
  at_office: { group: 'shipping', ar: 'في مكتب التوصيل', fr: 'Au bureau / centre', tone: 'info' },
  out_for_delivery: { group: 'shipping', ar: 'خرجت مع الموزع', fr: 'En livraison', tone: 'active' },
  attempt_failed: { group: 'shipping', ar: 'محاولة فاشلة', fr: 'Tentative échouée', tone: 'warning' },
  delivered: { group: 'final', ar: 'تم التسليم', fr: 'Livrée', tone: 'success' },
  returning: { group: 'shipping', ar: 'في طريق الإرجاع', fr: 'Retour en cours', tone: 'danger' },
  returned: { group: 'final', ar: 'مرتجعة', fr: 'Retournée', tone: 'danger' },
};

export const STATUS_KEYS = Object.keys(STATUSES);
export const groupOf = (s) => STATUSES[s]?.group || null;
export const CONFIRM_PENDING = ['new', 'no_answer', 'callback'];
export const SHIPPING_ACTIVE = ['shipped', 'in_transit', 'at_office', 'out_for_delivery', 'attempt_failed', 'returning'];
export const SHIPPED_EVER = [...SHIPPING_ACTIVE, 'delivered', 'returned'];

// الانتقالات اليدوية المسموح بها (تحديثات شركات التوصيل تتجاوز هذا الجدول)
export const MANUAL = {
  abandoned: ['new', 'no_answer', 'callback', 'confirmed', 'cancelled', 'fake'],
  new: ['no_answer', 'callback', 'confirmed', 'cancelled', 'fake'],
  no_answer: ['no_answer', 'callback', 'confirmed', 'cancelled', 'fake'],
  callback: ['no_answer', 'callback', 'confirmed', 'cancelled', 'fake'],
  // تأكيد أو إلغاء بالخطأ يُصحَّح: الزبون لم يرد، أو يُعاد الاتصال به
  confirmed: ['new', 'no_answer', 'callback', 'shipped', 'cancelled'],
  cancelled: ['new', 'no_answer', 'callback', 'confirmed'],
  fake: ['new', 'no_answer', 'callback', 'cancelled'],
  shipped: ['in_transit', 'at_office', 'out_for_delivery', 'attempt_failed', 'delivered', 'returning', 'returned', 'confirmed'],
  in_transit: ['at_office', 'out_for_delivery', 'attempt_failed', 'delivered', 'returning', 'returned'],
  at_office: ['out_for_delivery', 'attempt_failed', 'delivered', 'returning', 'returned'],
  out_for_delivery: ['attempt_failed', 'delivered', 'returning', 'returned', 'at_office'],
  attempt_failed: ['out_for_delivery', 'at_office', 'delivered', 'returning', 'returned'],
  delivered: ['returned'],
  returning: ['returned', 'out_for_delivery', 'delivered'],
  returned: ['delivered'],
};

export const canTransition = (from, to) => from === to || (MANUAL[from] || []).includes(to);

// ——— توحيد حالات شركات التوصيل ———
// ترتيب التقدم لمنع الرجوع إلى حالة أقدم إذا وصلت الأحداث بغير ترتيبها
export const SHIPPING_RANK = { shipped: 1, in_transit: 2, at_office: 3, out_for_delivery: 4, attempt_failed: 4, returning: 5, delivered: 6, returned: 6 };

const YALIDINE = {
  'pas encore expedie': 'shipped',
  'a verifier': 'shipped',
  'en preparation': 'shipped',
  'pas encore ramasse': 'shipped',
  'pret a expedier': 'shipped',
  ramasse: 'in_transit',
  bloque: 'in_transit',
  debloque: 'in_transit',
  transfert: 'in_transit',
  expedie: 'in_transit',
  centre: 'in_transit',
  'en localisation': 'in_transit',
  'vers wilaya': 'in_transit',
  'recu a wilaya': 'at_office',
  'en attente du client': 'at_office',
  'pret pour livreur': 'at_office',
  'sorti en livraison': 'out_for_delivery',
  'en attente': 'attempt_failed',
  'en alerte': 'attempt_failed',
  'tentative echouee': 'attempt_failed',
  livre: 'delivered',
  'echec livraison': 'returning',
  'echec de livraison': 'returning',
  'retour vers centre': 'returning',
  'retourne au centre': 'returning',
  'retour transfert': 'returning',
  'retour groupe': 'returning',
  'retour a retirer': 'returning',
  'retour vers vendeur': 'returning',
  'retourne au vendeur': 'returned',
  'echange echoue': 'returned',
};

const NOEST = {
  upload: 'shipped',
  customer_validation: 'shipped',
  validation_collect_colis: 'in_transit',
  validation_reception_admin: 'in_transit',
  validation_reception: 'in_transit',
  sent_to_redispatch: 'in_transit',
  fdr_activated: 'out_for_delivery',
  mise_a_jour: 'attempt_failed',
  colis_suspendu: 'attempt_failed',
  return_asked_by_customer: 'returning',
  return_asked_by_hub: 'returning',
  retour_dispatched_to_partenaires: 'returning',
  return_dispatched_to_partenaire: 'returning',
  colis_retour_transmit_to_partner: 'returning',
  return_dispatched_to_warehouse: 'returning',
  return_redispatched_to_livraison: 'in_transit',
  livraison_echoue_recu: 'returned',
  return_validated_by_partner: 'returned',
  livre: 'delivered',
  livred: 'delivered',
  echange_valide: 'delivered',
  echange_valid_by_hub: 'delivered',
};
// أحداث مالية/إدارية عند NOEST ليست حركة للطرد — تُسجل ولا تُغيّر الحالة
const NOEST_IGNORE = new Set([
  'verssement_admin_cust', 'verssement_admin_cust_canceled', 'verssement_hub_cust_canceled', 'validation_reception_cash_by_partner',
  'edited_informations', 'edit_price', 'edit_wilaya', 'extra_fee', 'nouvel_tentative_asked_by_customer', 'annulation_dispatch_retour',
  'cancel_return_dispatched_to_partenaire', 'ask_to_delete_by_admin', 'ask_to_delete_by_hub',
]);

/** قاموس عام بالكلمات المفتاحية (فرنسي/عربي/إنجليزي) لأي صيغة غير معروفة */
export function genericStatus(raw) {
  const s = fold(raw);
  if (!s) return null;
  if (/annul|cancel|ملغ/.test(s)) return 'cancelled';
  if (/(retourne|retour recu|retour valide|livraison_echoue_recu|returned|تم الارجاع|مرتجع)/.test(s) && !/vers|en cours|transit/.test(s)) return 'returned';
  if (/retour|return|ارجاع/.test(s)) return 'returning';
  if (/(non livr|echec|tentative|injoignable|absent|ne repond|reporte|en attente$|en alerte|suspendu|refus|failed|محاولة|لا يرد)/.test(s)) return 'attempt_failed';
  if (/(sorti|en livraison|en cours de livraison|out for delivery|خرج|مع الموزع|livreur)/.test(s)) return 'out_for_delivery';
  if (/(livre|delivered|تم التسليم)/.test(s)) return 'delivered';
  if (/(recu a wilaya|bureau|stop ?desk|en attente du client|agence|pret pour livreur|مكتب)/.test(s)) return 'at_office';
  if (/(transit|expedie|centre|vers wilaya|ramasse|transfert|en route|hub|في الطريق)/.test(s)) return 'in_transit';
  if (/(pret|prepar|attente de ramassage|cree|upload|enregistr|nouveau|valide|pending)/.test(s)) return 'shipped';
  return null;
}

/** يعيد الحالة الداخلية من نص شركة التوصيل؛ null = حدث لا يغيّر الحالة */
export function normalizeCarrierStatus(carrier, raw, eventKey) {
  if (carrier === 'noest' && eventKey) {
    if (NOEST_IGNORE.has(eventKey)) return null;
    if (NOEST[eventKey]) return NOEST[eventKey];
  }
  const s = fold(raw).replace(/[^a-z0-9؀-ۿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (carrier === 'yalidine' && YALIDINE[s]) return YALIDINE[s];
  return genericStatus(raw);
}
