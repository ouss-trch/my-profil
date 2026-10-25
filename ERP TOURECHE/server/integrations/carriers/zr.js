import { request, IntegrationError } from '../../lib/http.js';
import { num } from '../../lib/util.js';
import { dzLocalToIso, productLine } from './common.js';

// ZR Express (منصة Procolis) — المفاتيح من zrexpress.com ← Développement: Token و Clé
const BASE = 'https://procolis.com/api_v1';

const headers = (cfg) => {
  if (!cfg.zr_token || !cfg.zr_key) throw new IntegrationError('zr', 'config', 'credentials_missing');
  return { token: cfg.zr_token, key: cfg.zr_key };
};

const pickField = (obj, names) => {
  for (const n of names) {
    const k = Object.keys(obj || {}).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
};

export const zr = {
  name: 'ZR Express',
  isConfigured: (cfg) => Boolean(cfg.zr_token && cfg.zr_key),

  async test(cfg) {
    await request('zr', `${BASE}/token`, { headers: headers(cfg) });
    return true;
  },

  async communes() {
    return []; // ZR يقبل اسم البلدية نصاً حراً
  },

  async desks() {
    return []; // لا توجد قائمة مكاتب في واجهة ZR — يكفي اختيار «مكتب»
  },

  async create(cfg, o) {
    const colis = {
      Tracking: o.ref,
      TypeLivraison: o.delivery_type === 'desk' ? '1' : '0',
      TypeColis: '0',
      Confrimee: '1', // (الاسم مكتوب هكذا في واجهة ZR نفسها) — الطلبية مؤكدة فتذهب مباشرة إلى «جاهز للشحن»
      Client: o.customer_name || 'Client',
      MobileA: o.phone,
      MobileB: o.phone2 || '',
      Adresse: o.address || o.commune || '',
      IDWilaya: String(o.wilaya_code),
      Commune: o.commune || '',
      Total: String(Math.round(o.total)),
      Note: o.note || '',
      TProduit: productLine(o.items),
      id_Externe: o.ref,
      Source: o.source || 'ERP TOURECHE',
    };
    const { data } = await request('zr', `${BASE}/add_colis`, { method: 'POST', headers: headers(cfg), body: { Colis: [colis] } });
    const row = Array.isArray(data?.Colis) ? data.Colis[0] : Array.isArray(data) ? data[0] : data;
    const msg = String(pickField(row, ['MessageRetour', 'Message', 'message']) || '');
    if (row && /erreur|error|existe|invalid/i.test(msg) && !/good|succ/i.test(msg)) throw new IntegrationError('zr', 'invalid', msg, data);
    return { tracking: pickField(row, ['Tracking']) || o.ref, label_url: null, raw: data };
  },

  async track(cfg, trackings) {
    const out = new Map();
    for (let i = 0; i < trackings.length; i += 50) {
      const batch = trackings.slice(i, i + 50);
      const { data } = await request('zr', `${BASE}/lire`, { method: 'POST', headers: headers(cfg), body: { Colis: batch.map((t) => ({ Tracking: t })) } });
      const rows = Array.isArray(data?.Colis) ? data.Colis : Array.isArray(data) ? data : [];
      for (const r of rows) {
        const tracking = pickField(r, ['Tracking']);
        const raw = pickField(r, ['Situation', 'Statut', 'Etat', 'Status']);
        if (!tracking || !raw) continue;
        // بدون تاريخ من ZR: null — يُسجَّل الحدث فقط عند تغيّر نص الحالة (لا تكرار في كل مزامنة)
        const at = dzLocalToIso(pickField(r, ['DateH_Action', 'Date_Action', 'DateSituation', 'Date_Situation', 'DateA', 'Date']));
        out.set(tracking, {
          events: [{ raw: String(raw), at, location: String(pickField(r, ['Wilaya', 'Commune']) || ''), reason: String(pickField(r, ['Motif', 'Remarque']) || '') }],
          attempts: num(pickField(r, ['NbTentative', 'Tentative', 'NbrTentative']), null),
        });
      }
    }
    return out;
  },

  async fees(cfg) {
    const { data } = await request('zr', `${BASE}/tarification`, { method: 'POST', headers: headers(cfg), body: {} });
    const rows = Array.isArray(data) ? data : Array.isArray(data?.Tarifs) ? data.Tarifs : [];
    return rows
      .map((r) => ({
        wilaya_code: num(pickField(r, ['IDWilaya', 'Wilaya_id', 'IdWilaya']), null),
        home_fee: num(pickField(r, ['Domicile', 'Prix_Domicile']), null),
        desk_fee: num(pickField(r, ['Stopdesk', 'StopDesk', 'Prix_Stopdesk']), null),
        return_fee: num(pickField(r, ['Annuler', 'Retour']), null),
      }))
      .filter((r) => r.wilaya_code);
  },
};
