import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Lock, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { getDebtorsList, getPendingDeposits, getPendingEffects, closeFiscalYear, listClosures } from '@/modules/accounting/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/accounting-closure')({
  head: () => ({ meta: [{ title: 'Clôture d\'exercice — Ducati Bruxelles' }] }),
  component: ClosurePage,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const today = () => new Date().toISOString().slice(0, 10);

function ClosurePage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const y = new Date().getFullYear();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(`${y}-12-31`);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const debtors = useQuery({ queryKey: ['debtors', activeCompanyId, to], queryFn: () => getDebtorsList(activeCompanyId!, to), enabled: !!activeCompanyId });
  const deposits = useQuery({ queryKey: ['deposits', activeCompanyId], queryFn: () => getPendingDeposits(activeCompanyId!), enabled: !!activeCompanyId });
  const effects = useQuery({ queryKey: ['effects', activeCompanyId, to], queryFn: () => getPendingEffects(activeCompanyId!, to), enabled: !!activeCompanyId });
  const closures = useQuery({ queryKey: ['closures', activeCompanyId], queryFn: () => listClosures(activeCompanyId!), enabled: !!activeCompanyId });

  const close = useMutation({
    mutationFn: () => closeFiscalYear(activeCompanyId!, from, to, `Exercice ${y}`),
    onSuccess: () => { setMsg(t('accounting.closureDone')); setErr(null); closures.refetch(); },
    onError: (e) => { setErr(e instanceof Error ? e.message : 'Erreur'); setMsg(null); },
  });

  return (
    <>
      <PageHeader title={t('accounting.closure')} description={t('accounting.closureSub')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/accounting' })}><ArrowLeft /> {t('accounting.title')}</Button>} />

      {msg && <p className="mb-3 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{msg}</p>}
      {err && <p className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{err}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title={t('accounting.closureDebtors')}>
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr><Th>{t('accounting.sepaContact')}</Th><Th className="text-right">{t('accounting.closureNb')}</Th><Th className="text-right">{t('accounting.colDue')}</Th></tr></thead>
            <tbody>
              {debtors.data?.length === 0 && <Empty cols={3} />}
              {debtors.data?.map((r) => <tr key={r.contact_id} className="border-b border-border last:border-0"><td className="px-3 py-1.5">{r.contact_name}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.invoices}</td><td className="px-3 py-1.5 text-right tabular-nums">{eur(r.total_due)}</td></tr>)}
            </tbody>
          </table>
        </Panel>
        <Panel title={t('accounting.closureDeposits')}>
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr><Th>{t('accounting.colNumber')}</Th><Th>{t('accounting.sepaContact')}</Th><Th className="text-right">{t('accounting.colAmount')}</Th></tr></thead>
            <tbody>
              {deposits.data?.length === 0 && <Empty cols={3} />}
              {deposits.data?.map((r) => <tr key={r.document_id} className="border-b border-border last:border-0"><td className="px-3 py-1.5 font-mono">{r.number}</td><td className="px-3 py-1.5">{r.contact_name}</td><td className="px-3 py-1.5 text-right tabular-nums">{eur(r.deposit)}</td></tr>)}
            </tbody>
          </table>
        </Panel>
        <Panel title={t('accounting.closureEffects')}>
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr><Th>{t('accounting.colNumber')}</Th><Th>{t('accounting.colMethod')}</Th><Th className="text-right">{t('accounting.colAmount')}</Th><Th>{t('accounting.colDueDate')}</Th></tr></thead>
            <tbody>
              {effects.data?.length === 0 && <Empty cols={4} />}
              {effects.data?.map((r) => <tr key={r.payment_id} className="border-b border-border last:border-0"><td className="px-3 py-1.5 font-mono">{r.document_number}</td><td className="px-3 py-1.5">{r.method}</td><td className="px-3 py-1.5 text-right tabular-nums">{eur(r.amount)}</td><td className="px-3 py-1.5 font-mono">{r.due_date ?? '—'}</td></tr>)}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* Clôture */}
      <div className="mt-6 rounded-md border border-border bg-card p-4">
        <p className="mb-2 flex items-center gap-2 text-[13px] text-warning"><AlertTriangle className="size-4" /> {t('accounting.closureWarn')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Lbl>{t('accounting.closureFrom')}</Lbl><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Lbl>{t('accounting.closureTo')}</Lbl><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button onClick={() => close.mutate()} disabled={close.isPending}>{close.isPending ? <Loader2 className="animate-spin" /> : <Lock className="size-4" />} {t('accounting.closureDo')}</Button>
        </div>
      </div>

      {/* Historique */}
      <div className="mt-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.closureHistory')}</p>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr><Th>{t('accounting.closureFrom')}</Th><Th>{t('accounting.closureTo')}</Th><Th>Clôturé le</Th></tr></thead>
            <tbody>
              {closures.data?.length === 0 && <Empty cols={3} />}
              {closures.data?.map((c) => <tr key={c.id} className="border-b border-border last:border-0"><td className="px-3 py-1.5 font-mono">{c.period_from}</td><td className="px-3 py-1.5 font-mono">{c.period_to}</td><td className="px-3 py-1.5 font-mono">{c.closed_at?.slice(0, 10)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</p><div className="overflow-hidden rounded-md border border-border">{children}</div></div>;
}
function Empty({ cols }: { cols: number }) { return <tr><td colSpan={cols} className="px-3 py-4 text-center text-muted-foreground">{t('accounting.closureNone')}</td></tr>; }
function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
