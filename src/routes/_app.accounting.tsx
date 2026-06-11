import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, FileDown, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { getSalesJournal, getVatRegister, exportWinbooks } from '@/modules/accounting/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/accounting')({
  head: () => ({ meta: [{ title: 'Comptabilité — Ducati Bruxelles' }] }),
  component: AccountingPage,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const today = () => new Date().toISOString().slice(0, 10);

function AccountingPage() {
  const { activeCompanyId } = useAuth();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());

  const journal = useQuery({ queryKey: ['sales-journal', activeCompanyId, from, to], queryFn: () => getSalesJournal(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  const vat = useQuery({ queryKey: ['vat-register', activeCompanyId, from, to], queryFn: () => getVatRegister(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  const wb = useMutation({ mutationFn: () => exportWinbooks(activeCompanyId!, from, to) });

  const totalHt = (journal.data ?? []).reduce((s, r) => s + r.total_ht, 0);
  const totalTtc = (journal.data ?? []).reduce((s, r) => s + r.total_ttc, 0);

  return (
    <>
      <PageHeader
        title={t('accounting.title')}
        description={t('accounting.subtitle')}
        actions={<Button onClick={() => wb.mutate()} disabled={wb.isPending || !journal.data?.length}>{wb.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('accounting.exportWinbooks')}</Button>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Lbl>{t('accounting.from')}</Lbl><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Lbl>{t('accounting.to')}</Lbl><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="outline" onClick={() => { journal.refetch(); vat.refetch(); }}><RefreshCw className="size-4" /> {t('accounting.refresh')}</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.journal')}</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('accounting.colNumber')}</Th><Th>{t('accounting.colDate')}</Th><Th className="text-right">{t('accounting.colHt')}</Th><Th className="text-right">{t('accounting.colVat')}</Th><Th className="text-right">{t('accounting.colTtc')}</Th></tr></thead>
              <tbody>
                {journal.isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
                {journal.data && journal.data.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('accounting.empty')}</td></tr>}
                {journal.data?.map((r) => (
                  <tr key={r.document_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px]">{r.number ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.issue_date}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.total_ht)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.total_vat)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.total_ttc)}</td>
                  </tr>
                ))}
                {journal.data && journal.data.length > 0 && (
                  <tr className="bg-muted font-bold"><td className="px-3 py-2" colSpan={2}>{t('accounting.total')}</td><td className="px-3 py-2 text-right tabular-nums">{eur(totalHt)}</td><td /><td className="px-3 py-2 text-right tabular-nums">{eur(totalTtc)}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.vatRegister')}</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th className="text-right">{t('accounting.vatRate')}</Th><Th className="text-right">{t('accounting.baseHt')}</Th><Th className="text-right">{t('accounting.vatAmount')}</Th></tr></thead>
              <tbody>
                {vat.data && vat.data.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">—</td></tr>}
                {vat.data?.map((r) => (
                  <tr key={r.vat_rate} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-right tabular-nums">{r.vat_rate}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.base_ht)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.vat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
