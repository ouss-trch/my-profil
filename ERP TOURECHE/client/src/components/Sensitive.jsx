import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { setSensitiveAsker } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import { Button, Input, Modal } from './ui.jsx';

/** نافذة كلمة مرور العمليات الحساسة — تفتح تلقائياً عند أي عملية يرفضها الخادم بـ 428 */
export function SensitiveProvider({ children }) {
  const { t } = useI18n();
  const [req, setReq] = useState(null);
  const [pw, setPw] = useState('');
  const resolver = useRef(null);
  const inputRef = useRef(null);

  const ask = useCallback(
    ({ wrong, reason } = {}) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setPw('');
        setReq({ wrong, reason });
      }),
    [],
  );
  useEffect(() => setSensitiveAsker(ask), [ask]);
  useEffect(() => {
    if (req) setTimeout(() => inputRef.current?.focus(), 30);
  }, [req]);

  const finish = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setReq(null);
    setPw('');
  };

  return (
    <>
      {children}
      <Modal
        open={Boolean(req)}
        onClose={() => finish(null)}
        title={t('sens.title')}
        icon={ShieldAlert}
        size="sm"
        footer={
          <>
            <Button onClick={() => finish(null)}>{t('c.cancel')}</Button>
            <Button variant="primary" disabled={!pw} onClick={() => finish(pw)}>
              {t('c.confirm')}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pw) finish(pw);
          }}
          className="space-y-3"
        >
          <p className="text-sm text-sub">{req?.reason || t('sens.hint')}</p>
          <Input ref={inputRef} type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} aria-label={t('sens.title')} />
          {req?.wrong && <p className="text-xs text-bad">{t('sens.wrong')}</p>}
        </form>
      </Modal>
    </>
  );
}
