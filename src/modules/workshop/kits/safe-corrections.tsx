/**
 * Corrections de kits sourcées (ATE014, décision de Simon du 23/11/2026) : bon manuel ou dessin de la
 * moto, sinon « à compléter ». Elles s'appliquent en un geste, par lots annulables ; les cas douteux
 * restent à trancher par l'atelier. Visible seulement pour un administrateur ou le chef d'atelier.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';
import { t } from '@/lib/i18n';
import { applySafeKitProposals, getKitProposalStats, KIT_PROPOSAL_BATCH } from './api';

export function KitSafeCorrections({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [progress, setProgress] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['kit-proposal-stats', companyId, KIT_PROPOSAL_BATCH],
    queryFn: () => getKitProposalStats(companyId),
    retry: false,
  });
  const s = q.data;
  if (!s || s.total === 0) return null;

  const run = async () => {
    const ok = await confirm({
      title: t('dossier.kitSafeApply'),
      message: t('dossier.kitSafeConfirm').replace('{n}', String(s.safePending)),
      confirmLabel: t('dossier.kitSafeApply'),
      cancelLabel: t('action.cancel'),
    });
    if (!ok) return;
    let applied = 0;
    setProgress(0);
    try {
      for (let i = 0; i < 60; i += 1) {
        const r = await applySafeKitProposals(companyId);
        if (r.done) break;
        applied += r.applied;
        setProgress(applied);
      }
      toast.success(t('dossier.kitSafeDone').replace('{n}', String(applied)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('workshop.errSave'));
    } finally {
      setProgress(null);
      void qc.invalidateQueries();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-[13px]">
      {s.safePending > 0
        ? <ShieldCheck className="size-4 shrink-0 text-info" aria-hidden />
        : <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />}
      <span className="min-w-0 flex-1">
        {s.safePending > 0
          ? t('dossier.kitSafeReady').replace('{n}', String(s.safePending))
          : t('dossier.kitSafeDone').replace('{n}', String(s.safeApplied))}
        {s.toReview > 0 && (
          <span className="ml-2 inline-flex items-center gap-1 font-medium text-warning">
            <AlertTriangle className="size-3.5" aria-hidden />
            {t('dossier.kitSafeReview').replace('{n}', String(s.toReview)).replace('{g}', String(s.reviewGroups))}
          </span>
        )}
      </span>
      {s.safePending > 0 && (
        <Button type="button" size="sm" disabled={progress !== null} onClick={() => { void run(); }}>
          {progress !== null ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {progress !== null ? t('dossier.kitSafeRunning').replace('{n}', String(progress)) : t('dossier.kitSafeApply')}
        </Button>
      )}
    </div>
  );
}
