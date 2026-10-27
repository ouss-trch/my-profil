import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { useApp } from './ProjectContext.jsx';
import { Button, Modal, useAction, useToast } from './ui.jsx';

/**
 * حذف جماعي من أي جدول (للمدير فقط):
 * «حذف» ← بطاقة تشرح ما سيحدث بالضبط ← إن كان كل ما في القائمة محدداً: «أخطأت» / «نعم متأكد» ← كلمة المرور الحساسة (يطلبها الخادم دائماً).
 * label: نص الزر والعنوان، points: ما سيحدث سطراً سطراً، run: نداء الحذف، onDone: بعد النجاح.
 */
export default function BulkDelete({ count, all, label, allLabel, points = [], run, onDone, done }) {
  const { t } = useI18n();
  const { auth } = useApp();
  const toast = useToast();
  const { run: act, busy } = useAction();
  const [step, setStep] = useState(null); // explain | all
  if (auth.user?.role !== 'admin' || !count) return null;
  const close = () => setStep(null);
  const go = async () => {
    close(); // نافذة كلمة المرور الحساسة وحدها بعد هذه الخطوة
    const r = await act('bulk-delete', run, { success: false });
    if (r) {
      toast.ok(done(r));
      onDone?.(r);
    }
  };
  return (
    <>
      <Button size="sm" variant="danger" icon={Trash2} onClick={() => setStep('explain')}>
        {t(['حذف', 'Supprimer'])}
      </Button>
      <Modal
        open={step === 'explain'}
        onClose={close}
        size="sm"
        icon={Trash2}
        title={label}
        footer={
          <>
            <Button onClick={close}>{t('c.cancel')}</Button>
            <Button variant="danger" icon={Trash2} loading={busy === 'bulk-delete'} onClick={() => (all && count > 1 ? setStep('all') : go())}>
              {label}
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1.5 ps-5 text-sm text-sub">
          {points.map((p, k) => (
            <li key={k}>{p}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">{t(['بعد التأكيد تُطلب كلمة المرور الحساسة.', 'Le mot de passe sensible sera demandé après confirmation.'])}</p>
      </Modal>
      <Modal
        open={step === 'all'}
        onClose={close}
        size="sm"
        icon={AlertTriangle}
        title={allLabel}
        footer={
          <>
            <Button onClick={close}>{t(['أخطأت', 'Je me suis trompé'])}</Button>
            <Button variant="danger" loading={busy === 'bulk-delete'} onClick={go}>
              {t(['نعم، متأكد', 'Oui, je confirme'])}
            </Button>
          </>
        }
      >
        <p className="text-sm text-sub">{t(['حددت كل ما في هذه القائمة ({n}). هل هذا ما تريده فعلاً، أم ضغطت «تحديد الكل» بالخطأ؟', 'Vous avez tout sélectionné dans cette liste ({n}). Est-ce voulu, ou avez-vous coché « tout sélectionner » par erreur ?'], { n: count })}</p>
      </Modal>
    </>
  );
}
