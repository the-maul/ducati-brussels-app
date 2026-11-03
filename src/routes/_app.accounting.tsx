import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, FileDown, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import {
  getSalesJournal, getVatRegister, exportWinbooks, generateEntries, listEntries, getVoMarginRegister, getVoMarginSummary, getVoMarginPeriods,
  getVoMarginPurchases, loadVatMarginSettings, exportVoRegister, exportVoMarginWinbooks, printVoMarginAttestation, getAccountingCutover, setAccountingCutover,
  type VoMarginRow, type MarginGranularity,
} from '@/modules/accounting/api';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/accounting')({
  head: () => ({ meta: [{ title: pageTitle('accounting') }] }),
  component: AccountingPage,
});

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const today = () => new Date().toISOString().slice(0, 10);

function AccountingPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());

  const journal = useQuery({ queryKey: ['sales-journal', activeCompanyId, from, to], queryFn: () => getSalesJournal(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  const vat = useQuery({ queryKey: ['vat-register', activeCompanyId, from, to], queryFn: () => getVatRegister(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  const entries = useQuery({ queryKey: ['acct-entries', activeCompanyId, from, to], queryFn: () => listEntries(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  const vo = useQuery({ queryKey: ['vo-register', activeCompanyId, from, to], queryFn: () => getVoMarginRegister(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  const voSum = useQuery({ queryKey: ['vo-summary', activeCompanyId, from, to], queryFn: () => getVoMarginSummary(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  // Registre de la marge par période (M-89) : granularité = réglage de la société, modifiable à l'écran.
  const voSettings = useQuery({ queryKey: ['vo-settings', activeCompanyId], queryFn: () => loadVatMarginSettings(activeCompanyId!), enabled: !!activeCompanyId });
  const [granularityChoice, setGranularity] = useState<MarginGranularity | null>(null);
  const granularity: MarginGranularity = granularityChoice ?? voSettings.data?.period ?? 'month';
  const periods = useQuery({ queryKey: ['vo-periods', activeCompanyId, from, to, granularity], queryFn: () => getVoMarginPeriods(activeCompanyId!, from, to, granularity), enabled: !!activeCompanyId });
  const purchases = useQuery({ queryKey: ['vo-purchases', activeCompanyId, from, to], queryFn: () => getVoMarginPurchases(activeCompanyId!, from, to), enabled: !!activeCompanyId });
  // Export et impression : le fichier produit EST le retour, pas de toast.
  const voCsv = useMutation({ meta: { success: false }, mutationFn: () => exportVoRegister(activeCompanyId!, from, to, granularity) });
  const voWb = useMutation({ meta: { success: false }, mutationFn: () => exportVoMarginWinbooks(activeCompanyId!, from, to, granularity) });
  const attest = useMutation({ meta: { success: false }, mutationFn: (r: VoMarginRow) => printVoMarginAttestation(activeCompanyId!, r) });
  const wb = useMutation({ meta: { success: false }, mutationFn: () => exportWinbooks(activeCompanyId!, from, to), onSuccess: () => entries.refetch() });
  const gen = useMutation({ mutationFn: () => generateEntries(activeCompanyId!, from, to), onSuccess: () => entries.refetch() });
  const cutover = useQuery({ queryKey: ['acct-cutover', activeCompanyId], queryFn: () => getAccountingCutover(activeCompanyId!), enabled: !!activeCompanyId });
  const setCut = useMutation({ mutationFn: (d: string) => setAccountingCutover(activeCompanyId!, d), onSuccess: () => { cutover.refetch(); vat.refetch(); entries.refetch(); } });

  const totalHt = (journal.data ?? []).reduce((s, r) => s + r.total_ht, 0);
  const totalTtc = (journal.data ?? []).reduce((s, r) => s + r.total_ttc, 0);

  return (
    <>
      <PageHeader
        title={t('accounting.title')}
        description={t('accounting.subtitle')}
        actions={<div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate({ to: '/accounting-sepa' })}>{t('accounting.sepa')}</Button>
          <Button variant="outline" onClick={() => navigate({ to: '/accounting-closure' })}>{t('accounting.closure')}</Button>
          <Button variant="outline" onClick={() => gen.mutate()} disabled={gen.isPending || !journal.data?.length}>{gen.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-4" />} {t('accounting.generate')}</Button>
          <Button onClick={() => wb.mutate()} disabled={wb.isPending || !journal.data?.length}>{wb.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('accounting.exportWinbooks')}</Button>
        </div>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Lbl>{t('accounting.from')}</Lbl><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Lbl>{t('accounting.to')}</Lbl><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="outline" onClick={() => { journal.refetch(); vat.refetch(); }}><RefreshCw className="size-4" /> {t('accounting.refresh')}</Button>
        <div className="ml-auto space-y-1">
          <Lbl>{t('accounting.cutover')}</Lbl>
          <Input type="date" value={cutover.data ?? ''} onChange={(e) => setCut.mutate(e.target.value)} className="w-40" title={t('accounting.cutoverHint')} />
        </div>
      </div>
      <p className="mb-4 rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('accounting.cutoverHint')}</p>

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
                  <tr key={r.document_id} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: r.document_id } })} title={t('accounting.openInvoice')}>
                    <td className="px-3 py-2 font-mono text-[12px] text-info underline">{r.number ?? '—'}</td>
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

      {/* Registre de la marge (occasions type O) — B2, M-89 : base globale par période + registre par véhicule */}
      <div className="mt-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.voRegister')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={granularity} onValueChange={(v) => setGranularity(v as MarginGranularity)}>
              <SelectTrigger className="h-8 w-44 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">{t('accounting.voMonth')}</SelectItem>
                <SelectItem value="quarter">{t('accounting.voQuarter')}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => voCsv.mutate()} disabled={voCsv.isPending || !periods.data?.length}><FileDown className="size-4" /> {t('accounting.voExport')}</Button>
            <Button variant="outline" size="sm" onClick={() => voWb.mutate()} disabled={voWb.isPending || !periods.data?.some((p) => p.vat_due > 0)}><FileDown className="size-4" /> {t('accounting.voExportWinbooks')}</Button>
          </div>
        </div>
        <p className="mb-2 text-[12px] text-muted-foreground">{t('accounting.voHint')}</p>
        <p className="mb-2 rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('accounting.voPeriodHint')}</p>
        {periods.data && periods.data.length === 0 && <p className="rounded-md border border-border px-3 py-4 text-[13px] text-muted-foreground">{t('accounting.voEmpty')}</p>}
        {periods.data && periods.data.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('accounting.colPeriod')}</Th><Th className="text-right">{t('accounting.voPurchases')}</Th><Th className="text-right">{t('accounting.voSales')}</Th><Th className="text-right">{t('accounting.voCarriedIn')}</Th><Th className="text-right">{t('accounting.voMargin')}</Th><Th className="text-right">{t('accounting.voBase')}</Th><Th className="text-right">{t('accounting.voVatDue')}</Th><Th className="text-right">{t('accounting.voCarriedOut')}</Th></tr></thead>
              <tbody>
                {periods.data.map((p) => (
                  <tr key={p.period_key} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px]">{p.period_key} <span className="text-muted-foreground">({p.count_sales} / {p.count_purchases})</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(p.purchases)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(p.sales)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(p.carried_in)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(p.margin)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(p.base_ht)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{eur(p.vat_due)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(p.carried_out)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {voSum.data && voSum.data.count_vo > 0 && (
          <div className="mb-2 flex flex-wrap gap-4 rounded-md bg-muted px-3 py-2 text-[12px]">
            <span><strong>{voSum.data.count_vo}</strong> {t('accounting.voCount')}</span>
            <span>{t('accounting.voSales')} : <strong className="tabular-nums">{eur(voSum.data.total_sale)}</strong></span>
            <span>{t('accounting.voMarginIndicative')} : <strong className="tabular-nums">{eur(voSum.data.total_margin)}</strong></span>
          </div>
        )}
        {vo.data && vo.data.length > 0 && (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('accounting.colDate')}</Th><Th>{t('accounting.colNumber')}</Th><Th>{t('accounting.voVin')}</Th><Th className="text-right">{t('accounting.voPa')}</Th><Th className="text-right">{t('accounting.voPv')}</Th><Th className="text-right">{t('accounting.voMarginIndicative')}</Th><Th /></tr></thead>
              <tbody>
                {vo.data.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px]">{r.sale_date}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.doc_number ?? '—'} <span className="text-muted-foreground">{t(`sales.type_${r.doc_type}`)}</span></td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.vin ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.purchase_price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.sale_ttc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(r.margin)}</td>
                    <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => attest.mutate(r)}>{t('accounting.voAttest')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {purchases.data && purchases.data.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accounting.voPurchasesTitle')}</p>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full border-collapse font-data text-[13px]">
                <thead className="bg-muted"><tr><Th>{t('accounting.colDate')}</Th><Th>{t('accounting.colNumber')}</Th><Th>{t('accounting.voVin')}</Th><Th>{t('accounting.colLabel')}</Th><Th className="text-right">{t('accounting.voPa')}</Th></tr></thead>
                <tbody>
                  {purchases.data.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-mono text-[12px]">{r.purchase_date}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{r.reference}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{r.vin ?? '—'}</td>
                      <td className="px-3 py-2">{r.designation}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{eur(r.purchase_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) { return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>; }
