import { request, IntegrationError } from '../../lib/http.js';
import { num } from '../../lib/util.js';
import { dzLocalToIso, matchCommune, productLine } from './common.js';

// NOEST Public API v2.3 — Authorization: Bearer {api_token} + user_guid في جسم الطلب
// تنبيه: الطلبية المنشأة تبقى «مسودة» حتى استدعاء valid/order — نقوم بالتحقق تلقائياً بعد الإنشاء.
const BASE = 'https://app.noest-dz.com/api/public';
const cache = new Map();

const auth = (cfg) => {
  if (!cfg.noest_api_token || !cfg.noest_user_guid) throw new IntegrationError('noest', 'config', 'credentials_missing');
  return { Authorization: `Bearer ${cfg.noest_api_token}` };
};

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

export const noest = {
  name: 'NOEST',
  isConfigured: (cfg) => Boolean(cfg.noest_api_token && cfg.noest_user_guid),

  async test(cfg) {
    await request('noest', `${BASE}/get/wilayas`, { headers: auth(cfg) });
    return true;
  },

  async communes(cfg, wilayaCode) {
    return cached(`communes:${wilayaCode}`, 7 * 86400e3, async () => {
      const { data } = await request('noest', `${BASE}/get/communes/${wilayaCode}`, { headers: auth(cfg) });
      return (Array.isArray(data) ? data : []).filter((c) => c.is_active).map((c) => ({ id: c.code_postal, name: c.nom }));
    });
  },

  async desks(cfg, wilayaCode) {
    const all = await cached('desks', 86400e3, async () => (await request('noest', `${BASE}/desks`, { headers: auth(cfg) })).data || {});
    const prefix = String(Number(wilayaCode));
    return Object.values(all)
      .filter((d) => String(d.code).replace(/[A-Z]+$/i, '') === prefix)
      .map((d) => ({ id: d.code, name: d.name, address: d.address, commune: '' }));
  },

  async create(cfg, o) {
    let commune = o.commune;
    if (o.delivery_type !== 'desk') {
      const list = await this.communes(cfg, o.wilaya_code);
      const hit = matchCommune(o.commune, list);
      if (!hit) throw new IntegrationError('noest', 'invalid', 'commune_not_found', { suggestions: list.slice(0, 60).map((c) => c.name) });
      commune = hit.name;
    }
    let station = null;
    if (o.delivery_type === 'desk') {
      const desks = await this.desks(cfg, o.wilaya_code);
      station = desks.find((d) => d.id === o.stopdesk_id)?.id || desks[0]?.id;
      if (!station) throw new IntegrationError('noest', 'invalid', 'no_stopdesk_in_wilaya');
    }
    const body = {
      user_guid: cfg.noest_user_guid,
      reference: String(o.ref),
      client: o.customer_name || 'Client',
      phone: o.phone,
      ...(o.phone2 ? { phone_2: o.phone2 } : {}),
      adresse: (o.address || commune || '').slice(0, 255),
      wilaya_id: Number(o.wilaya_code),
      ...(commune ? { commune } : {}),
      montant: Math.round(o.total),
      remarque: (o.note || '').slice(0, 255),
      produit: productLine(o.items),
      type_id: 1,
      poids: o.weight || 1,
      stop_desk: o.delivery_type === 'desk' ? 1 : 0,
      ...(station ? { station_code: station } : {}),
    };
    const { data } = await request('noest', `${BASE}/create/order`, { method: 'POST', headers: auth(cfg), body });
    if (!data?.success || !data.tracking) throw new IntegrationError('noest', 'invalid', data?.message || data?.error || 'create_failed', data);
    // خطوة إلزامية: بدون التحقق لا يرى فريق NOEST الطرد ولا يُستلم أبداً
    const valid = await request('noest', `${BASE}/valid/order`, { method: 'POST', headers: auth(cfg), body: { user_guid: cfg.noest_user_guid, tracking: data.tracking } });
    if (!valid.data?.success) throw new IntegrationError('noest', 'invalid', 'validation_failed', { tracking: data.tracking, response: valid.data });
    return { tracking: data.tracking, label_url: null, raw: data };
  },

  async label(cfg, tracking) {
    return request('noest', `${BASE}/get/order/label?tracking=${encodeURIComponent(tracking)}`, { headers: auth(cfg), raw: true });
  },

  async track(cfg, trackings) {
    const out = new Map();
    for (let i = 0; i < trackings.length; i += 100) {
      const batch = trackings.slice(i, i + 100);
      const { data } = await request('noest', `${BASE}/get/trackings/info`, { method: 'POST', headers: auth(cfg), body: { user_guid: cfg.noest_user_guid, trackings: batch } });
      for (const [tracking, info] of Object.entries(data || {})) {
        if (!info || typeof info !== 'object' || !Array.isArray(info.activity)) continue;
        out.set(tracking, {
          events: info.activity.map((a) => ({ raw: a.event, key: a.event_key || null, at: dzLocalToIso(a.date), location: a.name || a.by || '', reason: a.driver ? `livreur: ${a.driver}` : '' })),
          attempts: Array.isArray(info.deliveryAttempts) ? info.deliveryAttempts.length : null,
          driver: info.OrderInfo?.driver_name ? { name: info.OrderInfo.driver_name, phone: info.OrderInfo.driver_tel } : null,
        });
      }
    }
    return out;
  },

  async fees(cfg) {
    const { data } = await request('noest', `${BASE}/fees`, { headers: auth(cfg) });
    const del = data?.tarifs?.delivery || {};
    const ret = data?.tarifs?.return || {};
    return Object.values(del).map((t) => ({
      wilaya_code: Number(t.wilaya_id),
      home_fee: num(t.tarif, null),
      desk_fee: num(t.tarif_stopdesk, null),
      return_fee: num(ret[t.wilaya_id]?.tarif, null),
    }));
  },
};
