import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { getMonthlyRevenue, getTopArticles, getWorkshopProductivity } from '@/modules/reports/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/reports')({
  head: () => ({ meta: [{ title: 'Rapports — Ducati Bruxelles' }] }),
  component: ReportsPage,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const h = (min: number) => `${Math.round((min / 60) * 10) / 10}`;
const firstOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

function ReportsPage() {
  const { activeCompanyId } = useAuth();
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(today());

  const monthly = useQuery({ queryKey: ['rep-monthly', activeCompanyId], queryFn: () => getMonthlyRevenue(activeCompanyId!), enabled: !!activeCompanyId });
  const top = useQuery({ queryKey: ['rep-top', activeCompanyId, from, to], queryFn: () => getTopArticles(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  const prod = useQuery({ queryKey: ['rep-prod', activeCompanyId, from, to], queryFn: () => getWorkshopProductivity(activeCompanyId!, new Date(from).toISOString(), new Date(to + 'T23:59:59').toISOString()), enabled: !!activeCompanyId });

  const maxRev = Math.max(1, ...(monthly.data ?? []).map((m) => m.revenue_ttc));

  return (
    <>
      <PageHeader title={t('reports.title')} description={t('reports.subtitle')} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Lbl>{t('reports.from')}</Lbl><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Lbl>{t('reports.to')}</Lbl><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="outline" onClick={() => { top.refetch(); prod.refetch(); }}><RefreshCw className="size-4" /> {t('reports.refresh')}</Button>
      </div>

      {/* CA mensuel */}
      <section className="mb-6">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('reports.monthlyRevenue')}</p>
        <div className="rounded-md border border-border bg-card p-4">
          {monthly.isLoading ? <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /> : (monthly.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t('reports.empty')}</p> : (
            <div className="space-y-1.5">
              {monthly.data!.map((m) => (
                <div key={m.month} className="flex items-center gap-3 text-[13px]">
                  <span className="w-16 font-mono text-[12px] text-muted-foreground">{m.month}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-muted"><div className="h-full bg-[var(--ducati-red)]" style={{ width: `${(m.revenue_ttc / maxRev) * 100}%` }} /></div>
                  <span className="w-28 text-right font-data tabular-nums">{eur(m.revenue_ttc)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top articles */}
        <section>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('reports.topArticles')}</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('reports.colRef')}</Th><Th>{t('reports.colDesignation')}</Th><Th className="text-right">{t('reports.colQty')}</Th><Th className="text-right">{t('reports.colRevenue')}</Th></tr></thead>
              <tbody>
                {top.isLoading && <tr><td colSpan={4} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
                {top.data && top.data.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{t('reports.empty')}</td></tr>}
                {top.data?.map((a) => (
                  <tr key={a.article_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px]">{a.reference ?? '—'}</td>
                    <td className="px-3 py-2">{a.designation ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(a.revenue_ht)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Productivité */}
        <section>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('reports.productivity')}</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('reports.mechanic')}</Th><Th className="text-right">{t('reports.presence')}</Th><Th className="text-right">{t('reports.work')}</Th><Th className="text-right">{t('reports.rate')}</Th></tr></thead>
              <tbody>
                {prod.isLoading && <tr><td colSpan={4} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
                {prod.data && prod.data.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{t('reports.empty')}</td></tr>}
                {prod.data?.map((p) => (
                  <tr key={p.mechanic} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{p.mechanic}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h(p.presence_min)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h(p.work_min)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.presence_min > 0 ? `${Math.round((p.work_min / p.presence_min) * 100)} %` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
