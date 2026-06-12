import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, FileDown, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { getSalesJournal, getVatRegister, exportWinbooks, generateEntries, listEntries } from '@/modules/accounting/api';
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
  const entries = useQuery({ queryKey: ['acct-entries', activeCompanyId, from, to], queryFn: () => listEntries(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  const wb = useMutation({ mutationFn: () => exportWinbooks(activeCompanyId!, from, to), onSuccess: () => entries.refetch() });
  const gen = useMutation({ mutationFn: () => generateEntries(activeCompanyId!, from, to), onSuccess: () => entries.refetch() });

  const totalHt = (journal.data ?? []).reduce((s, r) => s + r.total_ht, 0);
  const totalTtc = (journal.data ?? []).reduce((s, r) => s + r.total_ttc, 0);

  return (
    <>
      <PageHeader
        title={t('accounting.title')}
        description={t('accounting.subtitle')}
        actions={<div className="flex gap-2">
          <Button variant="outline" onClick={() => gen.mutate()} disabled={gen.isPending || !journal.data?.length}>{gen.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-4" />} {t('accounting.generate')}</Button>
          <Button onClick={() => wb.mutate()} disabled={wb.isPending || !journal.data?.length}>{wb.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('accounting.exportWinbooks')}</Button>
        </div>}
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

      {/* Écritures comptables générées (prévisualisation avant export) */}
      <div className="mt-6">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.entries')}</p>
        <p className="mb-2 text-[12px] text-muted-foreground">{t('accounting.entryHint')}</p>
        {gen.isSuccess && <p className="mb-2 text-[12px] text-success">{gen.data} {t('accounting.generated')}</p>}
        {entries.data && entries.data.length === 0 && <p className="rounded-md border border-border px-3 py-4 text-[13px] text-muted-foreground">{t('accounting.noEntries')}</p>}
        <div className="space-y-3">
          {entries.data?.map((e) => {
            const d = e.lines.reduce((s, l) => s + l.debit, 0);
            const c = e.lines.reduce((s, l) => s + l.credit, 0);
            const ok = Math.abs(d - c) < 0.005;
            return (
              <div key={e.id} className="overflow-hidden rounded-md border border-border">
                <div className="flex items-center justify-between bg-muted px-3 py-1.5 text-[12px]">
                  <span className="font-mono font-bold">{e.journal_code} · {e.doc_number ?? '—'}</span>
                  <span className="text-muted-foreground">{e.entry_date}</span>
                  <span className={ok ? 'text-success' : 'text-danger'}>{ok ? t('accounting.balanced') : t('accounting.unbalanced')}</span>
                </div>
                <table className="w-full border-collapse font-data text-[12px]">
                  <thead><tr className="border-b border-border"><Th>{t('accounting.colAccount')}</Th><Th>{t('accounting.colAux')}</Th><Th>{t('accounting.colLabel')}</Th><Th className="text-right">{t('accounting.colDebit')}</Th><Th className="text-right">{t('accounting.colCredit')}</Th></tr></thead>
                  <tbody>
                    {e.lines.map((l, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5 font-mono">{l.account_code} <span className="text-muted-foreground">{l.account_label}</span></td>
                        <td className="px-3 py-1.5 font-mono">{l.auxiliary_code ?? ''}</td>
                        <td className="px-3 py-1.5">{l.label ?? ''}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{l.debit ? eur(l.debit) : ''}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{l.credit ? eur(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
