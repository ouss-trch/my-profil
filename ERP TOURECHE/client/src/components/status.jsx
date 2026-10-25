import { useI18n } from '../i18n/index.jsx';
import { useApp } from './ProjectContext.jsx';
import { Badge } from './ui.jsx';

const TONE = { neutral: 'neutral', info: 'info', warning: 'warn', success: 'good', danger: 'bad', active: 'purple' };

export function StatusBadge({ status }) {
  const { meta } = useApp();
  const { lang } = useI18n();
  const s = meta?.statuses?.[status];
  return <Badge tone={TONE[s?.tone] || 'neutral'}>{s ? s[lang] : status}</Badge>;
}

export function useStatusLabel() {
  const { meta } = useApp();
  const { lang } = useI18n();
  return (status) => meta?.statuses?.[status]?.[lang] || status;
}

export const CARRIER_NAMES = { yalidine: 'Yalidine', zr: 'ZR Express', noest: 'NOEST' };
