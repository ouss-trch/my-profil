import { useEffect, useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { api } from '../lib/api.js';
import { useApp } from './ProjectContext.jsx';
import { Button, Field, Input, Modal, useAction } from './ui.jsx';

/** سعر الدولار واليورو الفعلي (السوق الموازي) — يُستعمل في تحويل إنفاق الإعلانات والأرباح وحد التعادل */
export default function FxEditor({ onSaved }) {
  const { t } = useI18n();
  const { meta, auth, loadProjects } = useApp();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ usd: '', eur: '' });
  useEffect(() => {
    if (open && meta?.fx) setF({ usd: meta.fx.usd, eur: meta.fx.eur });
  }, [open, meta]);
  if (!meta?.fx) return null;
  const admin = auth.user?.role === 'admin';
  const save = async () => {
    const r = await run('fx', () => api.put('/settings/global', { fx_usd_dza: Number(f.usd), fx_eur_dza: Number(f.eur) }), { success: t(['حُدّث سعر الصرف — كل الحسابات تُعاد بالسعر الجديد', 'Taux mis à jour — tous les calculs l’utilisent']) });
    if (r) {
      await loadProjects();
      setOpen(false);
      onSaved?.();
    }
  };
  return (
    <>
      <button type="button" className="btn btn-sm ltr" onClick={() => admin && setOpen(true)} title={admin ? t(['تعديل سعر الصرف', 'Modifier le taux']) : ''}>
        <CircleDollarSign className="h-3.5 w-3.5" />
        1$ = {meta.fx.usd} DA · 1€ = {meta.fx.eur} DA
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={t(['سعر الصرف الفعلي', 'Taux de change réel'])}
        icon={CircleDollarSign}
        footer={
          <Button variant="primary" loading={busy === 'fx'} disabled={!(Number(f.usd) > 0 && Number(f.eur) > 0)} onClick={save}>
            {t('c.save')}
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t(['1 دولار = ؟ دج', '1 USD = ? DA'])}>
            <Input type="number" min="1" step="0.5" value={f.usd} onChange={(e) => setF({ ...f, usd: e.target.value })} />
          </Field>
          <Field label={t(['1 يورو = ؟ دج', '1 EUR = ? DA'])}>
            <Input type="number" min="1" step="0.5" value={f.eur} onChange={(e) => setF({ ...f, eur: e.target.value })} />
          </Field>
        </div>
        <p className="mt-3 text-xs leading-5 text-sub">{t(['ضع سعر السوق الموازي الذي تشحن به بطاقتك فعلاً: يُستعمل في تكلفة الطلبية المسلّمة، الربح، وحد التعادل للإعلانات.', 'Mettez le taux réel auquel vous rechargez votre carte : utilisé pour le coût par livrée, le profit et le seuil pub.'])}</p>
      </Modal>
    </>
  );
}
