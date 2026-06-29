/**
 * M0 — Métadonnées des 5 statuts du board Améliorations (charte §9 : couleur + icône + libellé).
 * Rouge Ducati réservé au primaire → on n'utilise que les tokens de statut (neutral/info/warning/danger/success).
 */
import { Clock, ListTodo, Timer, Eye, CheckCircle2, type LucideIcon } from 'lucide-react';
import type { ImprovementStatus } from './api';
import { t } from '@/lib/i18n';

export const STATUS_META: Record<ImprovementStatus, { labelKey: string; Icon: LucideIcon; text: string; bg: string }> = {
  pending:     { labelKey: 'improvements.st_pending',     Icon: Clock,        text: 'text-muted-foreground', bg: 'bg-muted' },
  todo:        { labelKey: 'improvements.st_todo',        Icon: ListTodo,     text: 'text-info',             bg: 'bg-info-bg' },
  in_progress: { labelKey: 'improvements.st_in_progress', Icon: Timer,        text: 'text-warning',          bg: 'bg-warning-bg' },
  to_validate: { labelKey: 'improvements.st_to_validate', Icon: Eye,          text: 'text-danger',           bg: 'bg-danger-bg' },
  done:        { labelKey: 'improvements.st_done',        Icon: CheckCircle2, text: 'text-success',          bg: 'bg-success-bg' },
};

export function StatusBadge({ status }: { status: ImprovementStatus }) {
  const m = STATUS_META[status];
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-[var(--radius-badge)] px-1.5 py-0.5 text-[11px] font-medium ${m.bg} ${m.text}`}>
      <Icon className="size-3" /> {t(m.labelKey)}
    </span>
  );
}
