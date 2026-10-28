import { useState } from 'react';
import { Languages, Lock, Moon, Sun } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApp } from '../components/ProjectContext.jsx';
import { api } from '../lib/api.js';
import { Button, ErrorBox, Field, Input } from '../components/ui.jsx';

export default function Login() {
  const { t, lang, setLang } = useI18n();
  const { auth, refreshAuth } = useApp();
  const setup = auth.setupRequired;
  const [f, setF] = useState({ setup_token: '', username: '', password: '', display_name: '', sensitive_password: '', project_name: 'SOU9NA', project_domain: 'souqnna.com' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (setup) await api.post('/auth/setup', f, { project: null });
      else await api.post('/auth/login', { username: f.username, password: f.password }, { project: null });
      await refreshAuth();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('erp.theme', next ? 'dark' : 'light');
      localStorage.setItem('erp.theme.v', JSON.stringify(next ? 'dark' : 'light'));
    } catch {
      /* */
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-fill text-lg font-bold text-brand-on">T</span>
            <div>
              <div className="text-lg font-bold tracking-wide">ERP TOURECHE</div>
              <div className="text-xs text-muted">{t(['إدارة المتجر من الطلبية إلى التسليم', 'De la commande à la livraison'])}</div>
            </div>
          </div>
          <div className="flex gap-1">
            <button type="button" className="btn btn-ghost h-9 px-2 text-xs" onClick={() => setLang(lang === 'ar' ? 'fr' : 'ar')}>
              <Languages className="h-4 w-4" />
              {lang === 'ar' ? 'FR' : 'ع'}
            </button>
            <button type="button" className="btn btn-ghost h-9 w-9 p-0" onClick={toggleTheme} aria-label={t('c.theme')}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <form onSubmit={submit} className="card card-pad space-y-4">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <Lock className="h-4 w-4 text-brand" />
              {setup ? t('auth.setupTitle') : t('auth.login')}
            </h1>
            {setup && <p className="mt-1 text-xs leading-relaxed text-sub">{t('auth.setupHint')}</p>}
          </div>
          {auth.offline && <ErrorBox error={{ code: 'network_error' }} onRetry={refreshAuth} />}
          {setup && auth.setupTokenRequired && (
            <Field
              label={t('auth.setupToken')}
              hint={
                <>
                  {t('auth.setupTokenHint')}{' '}
                  <code dir="ltr" className="whitespace-nowrap">
                    bash deploy/erp.sh setup-token
                  </code>
                </>
              }
            >
              <Input autoFocus className="ltr font-mono tracking-wider" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" value={f.setup_token} onChange={set('setup_token')} required />
            </Field>
          )}
          <Field label={t('auth.username')}>
            <Input autoFocus={!(setup && auth.setupTokenRequired)} autoComplete="username" value={f.username} onChange={set('username')} required />
          </Field>
          {setup && (
            <Field label={t('auth.displayName')}>
              <Input value={f.display_name} onChange={set('display_name')} />
            </Field>
          )}
          <Field label={t('auth.password')} hint={setup ? t('auth.pwRule') : null}>
            <Input type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} required />
          </Field>
          {setup && (
            <>
              <Field label={t('auth.sensitive')} hint={t(['تُطلب عند الحذف وتغيير الأسعار والميزانيات وتفعيل الحملات — يجب أن تختلف عن كلمة الدخول', 'Demandé pour suppressions, prix, budgets et activation des campagnes — différent du mot de passe de connexion'])}>
                <Input type="password" autoComplete="new-password" value={f.sensitive_password} onChange={set('sensitive_password')} required />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('auth.projectName')}>
                  <Input value={f.project_name} onChange={set('project_name')} />
                </Field>
                <Field label={t('auth.projectDomain')}>
                  <Input className="ltr" value={f.project_domain} onChange={set('project_domain')} />
                </Field>
              </div>
            </>
          )}
          <ErrorBox error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {setup ? t('auth.start') : t('auth.login')}
          </Button>
        </form>
      </div>
    </div>
  );
}
