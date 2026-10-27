import { Fragment, useEffect, useState } from 'react';
import { Link2Off } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { ago, n0 } from '../lib/format.js';
import { useApp } from './ProjectContext.jsx';
import { Badge, Button, Card, ErrorBox, Loading, Select, useAction } from './ui.jsx';

/** رابط بمقاطع عربية: كل مقطع معزول اتجاهياً حتى يبقى «/products/» أولاً ولا تتقطع الأرقام داخل الكلمات العربية */
function PathText({ path }) {
  return (
    <span dir="ltr" className="break-all">
      {String(path)
        .split('/')
        .map((seg, i) => (
          <Fragment key={i}>
            {i > 0 && '/'}
            <bdi>{seg}</bdi>
          </Fragment>
        ))}
    </span>
  );
}

const KIND = { home: ['الرئيسية', 'Accueil'], product: ['منتج', 'Produit'], landing: ['صفحة هبوط', 'Landing'], page: ['صفحة', 'Page'] };

/**
 * الروابط المكسورة: صفحات «غير موجودة» (404) فتحها زوار حقيقيون، وتحويلات قديمة تشير إلى منتج محذوف.
 * لكل واحدة صفحة مقترحة (الأقرب بالكلمات)، و«حوّل» ينشئ تحويل 301 في Shopify (يشمل /ar و/fr).
 */
export default function BrokenLinks() {
  const { t, lang } = useI18n();
  const { auth, isAll } = useApp();
  const admin = auth.user?.role === 'admin';
  const { data, error, loading, reload } = useApi(isAll ? null : '/pages/broken-links', { skip: isAll });
  const { run, busy } = useAction();
  const [pick, setPick] = useState({});
  const [done, setDone] = useState({});
  useEffect(() => setPick({}), [data]);
  if (isAll) return null;
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const rows = [...data.hits.map((h) => ({ ...h, key: `h:${h.page}`, path: h.page, current: h.redirect })), ...data.dead.map((d) => ({ ...d, key: `d:${d.id}`, current: d.target, dead: true }))];
  const options = data.targets.map((x) => ({ value: x.target, label: `${t(KIND[x.kind] || KIND.page)}${x.label ? ` · ${x.label}` : ''}` }));
  const fix = async (r) => {
    const target = pick[r.key] ?? r.suggestion;
    const out = await run(`fix:${r.key}`, () => api.post('/pages/redirects', { path: r.path, target }, { reason: t(['أدخل كلمة المرور الحساسة لإنشاء التحويل', 'Mot de passe sensible pour créer la redirection']) }), {
      success: t(['تم التحويل: الرابط القديم يفتح الصفحة الجديدة', 'Redirection créée : l’ancien lien ouvre la nouvelle page']),
    });
    if (out) setDone({ ...done, [r.key]: target });
  };
  return (
    <Card
      icon={Link2Off}
      title={t(['الروابط المكسورة (404)', 'Liens cassés (404)'])}
      subtitle={t(
        ['صفحات «غير موجودة» فتحها زوار في آخر {d} يوماً، وتحويلات قديمة تشير إلى منتج محذوف. كل زيارة منها زبون ضائع وإشارة سيئة لـ Google: حوّلها إلى أقرب صفحة حية (تحويل 301 يشمل كل اللغات).', 'Pages « introuvables » ouvertes par des visiteurs ces {d} derniers jours, et anciennes redirections vers un produit supprimé. Chacune = un client perdu et un mauvais signal pour Google : redirigez-les vers la page vivante la plus proche (301, toutes langues).'],
        { d: data.days },
      )}
      pad={false}
    >
      {data.error && <p className="px-4 pt-3 text-xs text-bad">{data.error}</p>}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t(['الرابط المكسور', 'Lien cassé'])}</th>
                <th className="text-end">{t(['زوار', 'Visiteurs'])}</th>
                <th>{t(['حوّله إلى', 'Rediriger vers'])}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="min-w-[14rem] max-w-[22rem]">
                    <div className="text-start text-xs font-medium">
                      <PathText path={r.path} />
                    </div>
                    {r.dead ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                        <Badge tone="bad">{t(['تحويل معطّل', 'Redirection morte'])}</Badge>
                        <span>
                          → <PathText path={r.current} />
                        </span>
                      </div>
                    ) : (
                      r.last_at && <div className="text-[11px] text-muted">{t(['آخر زيارة', 'Dernière visite'])} {ago(r.last_at, lang)}</div>
                    )}
                  </td>
                  <td className="num text-end">{r.dead ? '—' : n0(r.visitors)}</td>
                  <td className="min-w-[14rem]">
                    {done[r.key] ? (
                      <Badge tone="good">
                        <span className="ltr" dir="ltr">
                          → {done[r.key]}
                        </span>
                      </Badge>
                    ) : (
                      <Select className="w-full text-xs" aria-label={t(['حوّله إلى', 'Rediriger vers'])} value={pick[r.key] ?? r.suggestion} disabled={!admin} onChange={(e) => setPick({ ...pick, [r.key]: e.target.value })} options={options} />
                    )}
                  </td>
                  <td>
                    {admin && !done[r.key] && (
                      <Button size="sm" variant="primary" loading={busy === `fix:${r.key}`} onClick={() => fix(r)}>
                        {r.dead ? t(['صحّح', 'Corriger']) : t(['حوّل', 'Rediriger'])}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-good">{t(['لا روابط مكسورة: كل الصفحات التي فتحها الزوار موجودة.', 'Aucun lien cassé : toutes les pages ouvertes existent.'])}</p>
      )}
      <p className="px-4 pb-3 pt-1 text-[11px] leading-5 text-muted">
        {t(['العدّاد يسجّل صفحات 404 ابتداءً من هذا التحديث. الصفحة المقترحة هي الأقرب بالكلمات (اسم المنتج ورابطه)؛ غيّرها من القائمة إن لزم.', 'Le compteur enregistre les 404 depuis cette mise à jour. La page proposée est la plus proche par les mots (nom et lien du produit) ; changez-la si besoin.'])}
      </p>
    </Card>
  );
}
