import { useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { CTA_CODES, CTA_OPTIONS } from '../lib/cta.js';
import { Field, Input, Select } from './ui.jsx';

const OTHER = '__other';

/**
 * زر الدعوة في الإعلان: يُختار من قائمة Meta (أو يُكتب رمز نوع آخر منها). نص الزر نفسه تحدده Meta ولا يقبل نصاً حراً،
 * فالعبارة الحرة تُكتب في «العنوان» (تظهر بجانب الزر كما كُتبت).
 */
export default function CtaField({ value, onChange, label }) {
  const { t, lang } = useI18n();
  const known = CTA_OPTIONS.some((o) => o.value === value);
  const [other, setOther] = useState(!known);
  const valid = CTA_CODES.includes(value);
  return (
    <Field
      label={label || t(['زر الدعوة', 'Bouton'])}
      hint={t([
        'نص الزر تحدده Meta بحسب النوع ولغة من يشاهد الإعلان، ولا تسمح بنص حر عليه. عبارتك الحرة تُكتب في «العنوان» وتظهر بجانب الزر كما كتبتها.',
        'Le texte du bouton est fixé par Meta selon le type et la langue du spectateur : pas de texte libre. Votre phrase libre va dans le « Titre », affichée à côté du bouton telle quelle.',
      ])}
    >
      <Select
        value={other ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOther(true);
            return;
          }
          setOther(false);
          onChange(e.target.value);
        }}
        options={[
          ...CTA_OPTIONS.map((o) => ({ value: o.value, label: `${lang === 'ar' ? o.ar : o.fr} · ${o.value}` })),
          { value: OTHER, label: t(['نوع آخر من قائمة Meta…', 'Autre type de la liste Meta…']) },
        ]}
      />
      {other && (
        <>
          <Input className="ltr mt-2" list="meta-cta-codes" value={value} placeholder="VIEW_PRODUCT" onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z_]/g, ''))} />
          <datalist id="meta-cta-codes">
            {CTA_CODES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {value && !valid && <p className="mt-1 text-xs text-bad">{t(['هذا الرمز ليس في قائمة Meta', 'Ce code n’est pas dans la liste Meta'])}</p>}
        </>
      )}
    </Field>
  );
}
