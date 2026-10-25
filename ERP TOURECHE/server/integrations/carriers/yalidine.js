import { request, IntegrationError } from '../../lib/http.js';
import { wilayaByCode } from '../../lib/wilayas.js';
import { num } from '../../lib/util.js';
import { dzLocalToIso, matchCommune, productLine } from './common.js';

// Yalidine API v1 — المفاتيح من لوحة Yalidine (قسم API): API ID و API TOKEN، ويجب ضبط ولاية الإرسال
const BASE = 'https://api.yalidine.app/v1';
const cache = new Map();

const headers = (cfg) => {
  if (!cfg.yalidine_api_id || !cfg.yalidine_api_token) throw new IntegrationError('yalidine', 'config', 'credentials_missing');
  return { 'X-API-ID': cfg.yalidine_api_id, 'X-API-TOKEN': cfg.yalidine_api_token };
};

const get = async (cfg, path) => (await request('yalidine', `${BASE}${path}`, { headers: headers(cfg) })).data;

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

async function wilayaName(cfg, code) {
  const list = await cached('wilayas', 7 * 86400e3, async () => (await get(cfg, '/wilayas/?page_size=100')).data || []);
  return list.find((w) => Number(w.id) === Number(code))?.name || wilayaByCode(code)?.fr;
}

export const yalidine = {
  name: 'Yalidine',
  isConfigured: (cfg) => Boolean(cfg.yalidine_api_id && cfg.yalidine_api_token),

  async test(cfg) {
    await get(cfg, '/wilayas/?page_size=1');
    return true;
  },

  async communes(cfg, wilayaCode) {
    return cached(`communes:${wilayaCode}`, 7 * 86400e3, async () => {
      const d = await get(cfg, `/communes/?wilaya_id=${wilayaCode}&page_size=1000`);
      return (d.data || []).filter((c) => c.is_deliverable !== 0).map((c) => ({ id: c.id, name: c.name, has_stop_desk: Boolean(c.has_stop_desk) }));
    });
  },

  async desks(cfg, wilayaCode) {
    return cached(`centers:${wilayaCode}`, 86400e3, async () => {
      const d = await get(cfg, `/centers/?wilaya_id=${wilayaCode}&page_size=1000`);
      return (d.data || []).map((c) => ({ id: String(c.center_id), name: c.name, address: c.address, commune: c.commune_name }));
    });
  },

  async create(cfg, o) {
    const communes = await this.communes(cfg, o.wilaya_code);
    let communeName = o.commune;
    let stopdeskId = null;
    if (o.delivery_type === 'desk') {
      const desks = await this.desks(cfg, o.wilaya_code);
      const desk = desks.find((d) => d.id === String(o.stopdesk_id)) || desks[0];
      if (!desk) throw new IntegrationError('yalidine', 'invalid', 'no_stopdesk_in_wilaya');
      stopdeskId = Number(desk.id);
      communeName = desk.commune;
    } else {
      const hit = matchCommune(o.commune, communes);
      if (!hit) throw new IntegrationError('yalidine', 'invalid', 'commune_not_found', { suggestions: communes.slice(0, 50).map((c) => c.name) });
      communeName = hit.name;
    }
    const [firstname, ...rest] = String(o.customer_name || 'Client').trim().split(/\s+/);
    const parcel = {
      order_id: o.ref,
      from_wilaya_name: await wilayaName(cfg, cfg.yalidine_from_wilaya || 16),
      firstname,
      familyname: rest.join(' ') || firstname,
      contact_phone: [o.phone, o.phone2].filter(Boolean).join(','),
      address: o.address || communeName,
      to_commune_name: communeName,
      to_wilaya_name: await wilayaName(cfg, o.wilaya_code),
      product_list: productLine(o.items),
      price: Math.round(o.total),
      do_insurance: false,
      declared_value: Math.round(o.total),
      length: 30,
      width: 20,
      height: 10,
      weight: o.weight || 1,
      freeshipping: true, // المبلغ المحصّل يتضمن التوصيل مسبقاً
      is_stopdesk: o.delivery_type === 'desk',
      ...(stopdeskId ? { stopdesk_id: stopdeskId } : {}),
      has_exchange: false,
    };
    const { data } = await request('yalidine', `${BASE}/parcels/`, { method: 'POST', headers: headers(cfg), body: [parcel] });
    const res = data?.[o.ref] || Object.values(data || {})[0];
    if (!res?.success || !res.tracking) throw new IntegrationError('yalidine', 'invalid', res?.message || 'create_failed', data);
    return { tracking: res.tracking, label_url: res.label || null, raw: res };
  },

  /** سجل كامل لكل طرد: [{raw, at, location, reason}] */
  async track(cfg, trackings) {
    const out = new Map();
    for (let i = 0; i < trackings.length; i += 25) {
      const batch = trackings.slice(i, i + 25);
      let url = `/histories/?tracking=${encodeURIComponent(batch.join(','))}&page_size=1000`;
      for (let page = 0; page < 5 && url; page++) {
        const d = await get(cfg, url);
        for (const h of d.data || []) {
          if (!out.has(h.tracking)) out.set(h.tracking, { events: [] });
          out.get(h.tracking).events.push({
            raw: h.status,
            at: dzLocalToIso(h.date_status),
            location: [h.center_name, h.commune_name, h.wilaya_name].filter(Boolean).join(' — '),
            reason: h.reason || '',
          });
        }
        url = d.has_more && d.links?.next ? d.links.next.replace(BASE, '') : null;
      }
    }
    return out;
  },

  async fees(cfg) {
    const from = cfg.yalidine_from_wilaya || 16;
    const out = [];
    for (let to = 1; to <= 58; to++) {
      try {
        const d = await get(cfg, `/fees/?from_wilaya_id=${from}&to_wilaya_id=${to}`);
        const first = Object.values(d.per_commune || {})[0] || {};
        out.push({ wilaya_code: to, home_fee: num(first.express_home) || null, desk_fee: num(first.express_desk) || null, return_fee: num(d.return_fee) || null });
      } catch (e) {
        if (e.kind === 'auth') throw e;
      }
    }
    return out;
  },
};
