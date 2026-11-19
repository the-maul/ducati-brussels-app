/**
 * M0 COM005 — Paramètres → Sociétés : « Société de test (ItalTest) » (lot ItalTest, 19/11/2026).
 *
 * Crée ou rafraîchit la société de test depuis la vraie société : tout ce qui a été saisi dans la
 * société de test est supprimé, puis le référentiel est recopié. La vraie société n'est jamais
 * touchée (garde-fou en base). La copie avance par appels de 4 s ; la page affiche l'étape.
 * Réservé aux administrateurs.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import {
  listTestCompanies, phaseProgress, runTestCompanyCopy, TEST_COMPANY_DEFAULT_NAME, type StepResult, type TestCompanyRow,
} from './test-company-api';

const STATUS_TONE: Record<TestCompanyRow['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  pret: 'success', en_cours: 'warning', erreur: 'danger', a_copier: 'neutral',
};
const STATUS_ICON = { pret: CheckCircle2, en_cours: Loader2, erreur: XCircle, a_copier: AlertTriangle } as const;

export function TestCompanyPanel() {
  const { companies, activeCompany, isAdmin, refresh } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [run, setRun] = useState<StepResult | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['test-companies'], queryFn: listTestCompanies });

  const rows = q.data ?? [];
  // Source : la société active si elle est réelle, sinon la source de la société de test active.
  const testRow = rows.find((r) => r.company_id === activeCompany?.id) ?? rows[0] ?? null;
  const sourceId = activeCompany && !activeCompany.is_test ? activeCompany.id : testRow?.source_company_id ?? null;
  const source = companies.find((c) => c.id === sourceId) ?? null;
  const current = rows.find((r) => r.source_company_id === sourceId) ?? null;
  const target = current ? companies.find((c) => c.id === current.company_id) : null;
  const targetName = target?.name ?? TEST_COMPANY_DEFAULT_NAME;
  const vars = { name: targetName, source: source?.name ?? '' };

  if (!source || !isAdmin(source.id)) return null;

  const launch = async () => {
    if (current) {
      const ok = await confirm({
        title: t('testCompany.confirmTitle'), message: fillVars(t('testCompany.confirmMsg'), vars),
        confirmLabel: t('testCompany.confirmLabel'), variant: 'delete',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await runTestCompanyCopy(source.id, setRun, targetName);
      toast.success(fillVars(t('testCompany.done'), vars));
      await refresh();   // le sélecteur de société la propose tout de suite
    } catch (e) {
      toast.error(fillVars(t('testCompany.error'), { error: (e as Error)?.message ?? String(e) }));
    } finally {
      setBusy(false);
      setRun(null);
      void qc.invalidateQueries({ queryKey: ['test-companies'] });
    }
  };

  const status = current?.status ?? null;
  const Icon = status ? STATUS_ICON[status] : AlertTriangle;
  const copied = current?.progress?.copied ?? {};
  const pct = run ? phaseProgress(run.phase, run.done) : 0;

  return (
    <section className="mb-4 rounded-md border border-warning bg-card p-4" aria-labelledby="test-company-title">
      <div className="flex flex-wrap items-start gap-4">
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-64 flex-1 space-y-1">
          <h2 id="test-company-title" className="font-ui text-[15px] font-bold">{t('testCompany.panelTitle')}</h2>
          <p className="text-[13px] text-muted-foreground">{fillVars(t('testCompany.panelDesc'), vars)}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[13px]">
            {status
              ? <StatusBadge tone={STATUS_TONE[status]} icon={Icon} label={t(`testCompany.status_${status}`)} />
              : <StatusBadge tone="neutral" icon={AlertTriangle} label={t('testCompany.statusNone')} />}
            {current?.finished_at && (
              <span className="text-muted-foreground">
                {fillVars(t('testCompany.lastRefresh'), { date: new Date(current.finished_at).toLocaleString() })}
              </span>
            )}
            {current?.status === 'pret' && (
              <span className="tabular-nums text-muted-foreground">
                {fillVars(t('testCompany.counts'), {
                  articles: copied.articles ?? 0, contacts: copied.contacts ?? 0, vehicles: copied.vehicles ?? 0, stock: copied.stock_moves ?? 0,
                })}
              </span>
            )}
          </div>
          {current?.status === 'erreur' && current.last_error && (
            <p className="text-[12px] text-danger">{fillVars(t('testCompany.error'), { error: current.last_error })}</p>
          )}
        </div>
        <Button variant="outline" onClick={() => void launch()} disabled={busy || q.isLoading}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {fillVars(t(current ? 'testCompany.refresh' : 'testCompany.create'), vars)}
        </Button>
      </div>
      {busy && run && (
        <div className="mt-3 space-y-1" role="status" aria-live="polite">
          <Progress value={pct} aria-label={t('testCompany.panelTitle')} />
          <p className="text-[12px] text-muted-foreground">
            {fillVars(t('testCompany.running'), { pct, phase: t(`testCompany.phase_${run.phase}`) })}
          </p>
        </div>
      )}
    </section>
  );
}
