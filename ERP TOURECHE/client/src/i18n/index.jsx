import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DICT } from './dict.js';

/**
 * ترجمة عربي/فرنسي:
 *  t('key')            → من القاموس المشترك
 *  t(['عربي','Français']) → نص محلي للصفحة
 *  tl({ar, fr})        → نصوص قادمة من الخادم (المستشار، الحالات…)
 *  t('key', {n: 3})    → استبدال {n}
 */
const I18n = createContext(null);

const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`)) : s);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      return localStorage.getItem('erp.lang') || 'ar';
    } catch {
      return 'ar';
    }
  });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('erp.lang', lang);
    } catch {
      /* */
    }
  }, [lang]);
  const i = lang === 'ar' ? 0 : 1;
  const t = useCallback(
    (key, vars) => {
      if (Array.isArray(key)) return fill(key[i] ?? key[0], vars);
      const e = DICT[key];
      return fill(e ? e[i] ?? e[0] : key, vars);
    },
    [i],
  );
  const tl = useCallback((o) => (o && typeof o === 'object' ? o[lang] ?? o.ar ?? o.fr ?? '' : o ?? ''), [lang]);
  const err = useCallback(
    (e) => {
      if (!e) return '';
      let code = String(e.code || e.message || e);
      // أخطاء التكاملات تصل «gemini: gemini_free_tier»: الرمز بعد اسم الخدمة هو ما يُترجم
      if (e.service && code.startsWith(`${e.service}: `)) code = code.slice(e.service.length + 2);
      const base = code.split(':')[0];
      const known = DICT[`err.${code}`] || DICT[`err.${base}`];
      if (known) return fill(known[i], { x: code.split(':')[1] || '' });
      if (e.service) return `${e.service}: ${code}`;
      return code;
    },
    [i],
  );
  const value = useMemo(() => ({ lang, setLang: setLangState, dir: lang === 'ar' ? 'rtl' : 'ltr', t, tl, err }), [lang, t, tl, err]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = () => useContext(I18n);
