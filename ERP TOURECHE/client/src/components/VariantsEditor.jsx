import { useState } from 'react';
import { Plus, XCircle } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { Button, Input } from './ui.jsx';

const SUGGESTED = ['اللون', 'المقاس', 'الموديل', 'Couleur', 'Taille'];
const keyOf = (options) => JSON.stringify(Object.entries(options || {}).sort(([a], [b]) => a.localeCompare(b)));
const splitValues = (s) => [...new Set(String(s || '').split(/[,،\n]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 30);

/** كل التركيبات (أزرق/S، أزرق/M…) مع الحفاظ على بيانات المتغير الموجود (معرّفه في Shopify، سعره، مخزونه) */
export function buildVariants(options, previous = [], defaults = {}) {
  const opts = options.filter((o) => o.name && o.values.length);
  if (!opts.length) return [];
  let combos = [{}];
  for (const o of opts) combos = combos.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v })));
  const old = new Map(previous.map((v) => [keyOf(v.options), v]));
  return combos.map((c) => {
    const prev = old.get(keyOf(c));
    return prev ? { ...prev, options: c } : { options: c, title: Object.values(c).join(' / '), price: defaults.price ?? '', compare_at_price: defaults.compare_at_price ?? '', sku: '', stock: '' };
  });
}

/**
 * الخيارات (حتى 3 كما في Shopify) والمتغيرات: السعر، السعر قبل التخفيض، SKU، والمخزون لكل تركيبة.
 * منتج في Shopify: المخزون يصل فوراً عند الحفظ، والخيارات والأسعار عند «تحديث على المتجر».
 */
export default function VariantsEditor({ options, variants, onChange, price, compare, onShopify }) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState(() => options.map((o) => o.values.join('، ')));
  const apply = (nextOptions) => onChange({ options: nextOptions, variants: buildVariants(nextOptions, variants, { price, compare_at_price: compare }) });
  const setOption = (k, patch) => apply(options.map((o, j) => (j === k ? { ...o, ...patch } : o)));
  const editVariant = (k, patch) => onChange({ options, variants: variants.map((v, j) => (j === k ? { ...v, ...patch } : v)) });
  const active = options.some((o) => o.name && o.values.length);
  return (
    <div className="space-y-3">
      <datalist id="variant-option-names">
        {SUGGESTED.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {options.map((o, k) => (
        <div key={k} className="space-y-2 rounded-lg border border-line p-2">
          <div className="flex items-center gap-2">
            <Input className="min-w-0 flex-1" list="variant-option-names" aria-label={t(['اسم الخيار', 'Nom de l’option'])} value={o.name} placeholder={t(['اللون، المقاس…', 'Couleur, taille…'])} onChange={(e) => setOption(k, { name: e.target.value.slice(0, 40) })} />
            <Button
              size="sm"
              variant="ghost"
              icon={XCircle}
              aria-label={t(['حذف الخيار', 'Supprimer l’option'])}
              onClick={() => {
                setDrafts(drafts.filter((_, j) => j !== k));
                apply(options.filter((_, j) => j !== k));
              }}
            />
          </div>
          <Input
            aria-label={t(['القيم', 'Valeurs'])}
            value={drafts[k] ?? ''}
            placeholder={t(['القيم مفصولة بفاصلة: أزرق، وردي، أخضر', 'Valeurs séparées par des virgules : bleu, rose, vert'])}
            onChange={(e) => setDrafts(drafts.map((d, j) => (j === k ? e.target.value : d)))}
            onBlur={() => setOption(k, { values: splitValues(drafts[k]) })}
          />
        </div>
      ))}
      {options.length < 3 && (
        <Button
          size="sm"
          icon={Plus}
          onClick={() => {
            setDrafts([...drafts, '']);
            onChange({ options: [...options, { name: options.length ? '' : SUGGESTED[0], values: [] }], variants });
          }}
        >
          {t(['إضافة خيار (لون، مقاس…)', 'Ajouter une option (couleur, taille…)'])}
        </Button>
      )}
      {active && variants.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="table text-xs">
            <thead>
              <tr>
                <th>{t(['المتغير', 'Variante'])}</th>
                <th>{t(['السعر', 'Prix'])}</th>
                <th>{t(['قبل التخفيض', 'Prix barré'])}</th>
                <th>SKU</th>
                <th>{t(['المخزون', 'Stock'])}</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, k) => (
                <tr key={keyOf(v.options)}>
                  <td className="whitespace-nowrap font-medium" dir="auto">
                    {Object.values(v.options || {}).join(' / ')}
                  </td>
                  <td>
                    <Input type="number" className="w-24 px-2 py-1" aria-label={t(['السعر', 'Prix'])} value={v.price ?? ''} onChange={(e) => editVariant(k, { price: e.target.value === '' ? '' : Number(e.target.value) })} />
                  </td>
                  <td>
                    <Input type="number" className="w-24 px-2 py-1" aria-label={t(['قبل التخفيض', 'Prix barré'])} value={v.compare_at_price ?? ''} onChange={(e) => editVariant(k, { compare_at_price: e.target.value === '' ? null : Number(e.target.value) })} />
                  </td>
                  <td>
                    <Input className="ltr w-24 px-2 py-1" aria-label="SKU" value={v.sku ?? ''} onChange={(e) => editVariant(k, { sku: e.target.value.slice(0, 60) })} />
                  </td>
                  <td>
                    <Input type="number" min="0" className="w-20 px-2 py-1" aria-label={t(['المخزون', 'Stock'])} value={v.stock ?? ''} onChange={(e) => editVariant(k, { stock: e.target.value === '' ? '' : Math.max(0, Math.round(Number(e.target.value))) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] leading-5 text-muted">
        {onShopify
          ? t(['المخزون يصل إلى المتجر فوراً عند الحفظ. الخيارات والأسعار تُطبَّق عند «تحديث على المتجر» في تبويب النشر.', 'Le stock part vers la boutique dès l’enregistrement. Options et prix s’appliquent avec « Mettre à jour » (onglet Publication).'])
          : t(['كل تركيبة متغير في المتجر بسعرها ومخزونها، ويختارها الزبون في نموذج الطلب.', 'Chaque combinaison devient une variante avec son prix et son stock, au choix du client dans le formulaire.'])}
      </p>
    </div>
  );
}
