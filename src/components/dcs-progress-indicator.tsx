/** Chargement visible sur toutes les pages pendant qu'un onglet DCS travaille en arrière-plan. */
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { onDcsTimeout, useDcsRunning } from '@/lib/dcs-progress';
import { t } from '@/lib/i18n';

export function DcsProgressIndicator() {
  const running = useDcsRunning();
  useEffect(() => onDcsTimeout(() => { toast.error(t('dossier.dcsTimeout')); }), []);
  if (running.length === 0) return null;
  return (
    <div role="status" aria-live="polite"
      className="fixed bottom-20 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-[13px] font-medium shadow-[var(--shadow-modal)] md:bottom-4">
      <Loader2 className="size-4 shrink-0 animate-spin text-info" aria-hidden />
      <span className="truncate">{t('dossier.dcsLoading')}</span>
      <span className="hidden font-data text-[12px] text-muted-foreground sm:inline">{running[running.length - 1]}</span>
    </div>
  );
}
