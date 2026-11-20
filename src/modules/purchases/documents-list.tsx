/**
 * M4 — « Consultation des documents fournisseurs » (G8 Appros › Liste des documents), rattrapage du 18/11/2026 :
 * période + fournisseur, onglets Réceptions (Tout / Livraisons / Factures), Commandes (avec regroupement :
 * franco, minimum, totaux), Propositions, Rétrocessions, Échéances fournisseurs, Montants TVA par fournisseur
 * (date de réception ou de facture), Frais de réception, Historique des commandes (date et heure d'envoi,
 * n° de réception), Remises de fin d'année ; export Excel de chaque onglet.
 *
 * Revue UX/UI (20/11/2026) : trois onglets seulement (Réceptions · Commandes · Propositions) ; les
 * rapports (rétrocessions, échéances, TVA, frais, historique, remises de fin d'année) passent dans
 * un menu « Rapports » ; une phrase d'aide sous chaque terme G8 ; les boutons de vue (Livraisons /
 * Factures achat, base de TVA) ne sont plus rouges : le rouge reste à « Nouvelle réception ».
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FileBarChart, Loader2, FileSpreadsheet, Merge } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/status-badge';
import { listSuppliers, supplierName } from './api';
import {
  listPurchaseDocuments, listDueSchedules, listVatBySupplier, listOrderHistory, mergeOrders, getSupplierConditions,
  type PurchaseDocRow, type ListFilter,
} from './g8-api';
import { purchaseStatusTone, periodBounds, mergeProblem, thresholdStatus, type PurchaseDocType } from './g8-rules';
import { YearEndRebatesPanel } from './supplier-tabs';
import { t, fillVars } from '@/lib/i18n';

const eur = (n: number | null | undefined) => `${(Math.round(Number(n ?? 0) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function exportXlsx(name: string, header: string[], rows: (string | number | null)[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), name.slice(0, 31));
  XLSX.writeFile(wb, `${name}.xlsx`);
}

type Tab = 'REC' | 'CMD' | 'PCF' | 'RTF' | 'due' | 'vat' | 'fees' | 'history' | 'rfa';
/** Les documents du quotidien, en onglets. */
const DOC_TABS: Tab[] = ['REC', 'CMD', 'PCF'];
/** Les rapports, dans le menu « Rapports ». */
const REPORT_TABS: Tab[] = ['RTF', 'due', 'vat', 'fees', 'history', 'rfa'];

/** Bouton de vue (choix dans une barre) : contour, le choix actif en gras sur fond gris, jamais rouge. */
function ViewToggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button size="sm" variant="outline" aria-pressed={on} onClick={onClick}
      className={cn(on && 'border-foreground bg-accent font-bold')}>
      {children}
    </Button>
  );
}

export function PurchaseDocumentsList({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const [tab, setTab] = useState<Tab>('REC');
  const [from, setFrom] = useState<string>(periodBounds('year').from ?? '');
  const [to, setTo] = useState<string>(periodBounds('year').to ?? '');
  const [supplierId, setSupplierId] = useState<string>('all');
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-all', companyId], queryFn: () => listSuppliers(companyId, '', 500) });
  const filter: ListFilter = { from: from || null, to: to || null, supplierId: supplierId === 'all' ? null : supplierId };
  const quick = (k: 'month' | 'quarter' | 'year' | 'all') => { const b = periodBounds(k); setFrom(b.from ?? ''); setTo(b.to ?? ''); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <Field label={t('purchasesG8.from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
        <Field label={t('purchasesG8.to')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
        <div className="flex gap-1">
          {(['month', 'quarter', 'year', 'all'] as const).map((k) => <Button key={k} size="sm" variant="ghost" onClick={() => quick(k)}>{t(`purchasesG8.period_${k}`)}</Button>)}
        </div>
        <Field label={t('purchases.colSupplier')}>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('purchasesG8.allSuppliers')}</SelectItem>
              {(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{supplierName(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="h-auto flex-wrap">
            {DOC_TABS.map((k) => (
              <TabsTrigger key={k} value={k}>{t(`purchasesG8.tab_${k}`)}</TabsTrigger>
            ))}
          </TabsList>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-pressed={REPORT_TABS.includes(tab)}
                className={cn(REPORT_TABS.includes(tab) && 'border-foreground bg-accent font-bold')}>
                <FileBarChart />
                {REPORT_TABS.includes(tab)
                  ? fillVars(t('designTransverse.purchases.reportsActive'), { name: t(`purchasesG8.tab_${tab}`) })
                  : t('designTransverse.purchases.reports')}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-sm">
              {REPORT_TABS.map((k) => (
                <DropdownMenuItem key={k} onSelect={() => setTab(k)} className="flex-col items-start gap-0.5">
                  <span className={cn(tab === k && 'font-bold')}>{t(`purchasesG8.tab_${k}`)}</span>
                  <span className="text-[12px] text-muted-foreground">{t(`designTransverse.purchases.help_${k}`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Aide sous chaque terme G8 : ce que contient l'onglet ou le rapport ouvert. */}
        <p className="mt-2 text-[13px] text-muted-foreground">{t(`designTransverse.purchases.help_${tab}`)}</p>
        <TabsContent value="REC"><DocsTab companyId={companyId} docType="REC" filter={filter} canWrite={canWrite} /></TabsContent>
        <TabsContent value="CMD"><DocsTab companyId={companyId} docType="CMD" filter={filter} canWrite={canWrite} /></TabsContent>
        <TabsContent value="PCF"><DocsTab companyId={companyId} docType="PCF" filter={filter} canWrite={canWrite} /></TabsContent>
        <TabsContent value="RTF"><DocsTab companyId={companyId} docType="RTF" filter={filter} canWrite={canWrite} /></TabsContent>
        <TabsContent value="due"><DueTab companyId={companyId} filter={filter} /></TabsContent>
        <TabsContent value="vat"><VatTab companyId={companyId} filter={filter} /></TabsContent>
        <TabsContent value="fees"><FeesTab companyId={companyId} filter={filter} /></TabsContent>
        <TabsContent value="history"><HistoryTab companyId={companyId} filter={filter} /></TabsContent>
        <TabsContent value="rfa"><YearEndRebatesPanel companyId={companyId} supplierId={filter.supplierId} /></TabsContent>
      </Tabs>
    </div>
  );
}

function DocsTab({ companyId, docType, filter, canWrite }: { companyId: string; docType: PurchaseDocType; filter: ListFilter; canWrite: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [view, setView] = useState<'all' | 'bl' | 'invoice'>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const q = useQuery({ queryKey: ['purchase-docs', companyId, docType, filter], queryFn: () => listPurchaseDocuments(companyId, docType, filter) });
  const rows = useMemo(() => (q.data ?? []).filter((d) => docType !== 'REC' || view === 'all'
    || (view === 'bl' ? !d.supplier_invoice_no : !!d.supplier_invoice_no)), [q.data, view, docType]);
  const canMerge = docType === 'CMD' || docType === 'PCF';
  const selected = rows.filter((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const exp = () => exportXlsx(t(`purchasesG8.tab_${docType}`), [
    t('purchases.colNumber'), t('purchases.colDate'), t('purchases.colSupplier'), t('purchases.colStatus'), t('purchasesG8.orderType'),
    t('purchases.totalHt'), t('purchases.colTtc'), t('purchasesG8.operator'), t('purchases.invoiceNo'), t('purchases.invoiceDate'),
    t('purchases.blNo'), t('purchases.shippingHt'), t('purchasesG8.lastSent'), t('purchasesG8.receiptsNo'),
  ], rows.map((d) => [d.number, d.doc_date, d.supplier_name, t(`purchases.status_${d.status}`), d.order_type ? t(`purchasesG8.orderType_${d.order_type}`) : '',
    d.total_ht, d.total_ttc, d.operator_name, d.supplier_invoice_no, d.invoice_date, d.supplier_bl_no, d.shipping_ht, d.last_sent_at, d.receipts]));

  const totalHt = rows.reduce((s, d) => s + d.total_ht, 0);
  const totalTtc = rows.reduce((s, d) => s + d.total_ttc, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {docType === 'REC' && (['all', 'bl', 'invoice'] as const).map((v) => (
          <ViewToggle key={v} on={view === v} onClick={() => setView(v)}>{t(`purchasesG8.view_${v}`)}</ViewToggle>
        ))}
        {canMerge && canWrite && (
          <Button size="sm" variant="outline" disabled={selected.length < 2} onClick={() => setMergeOpen(true)}><Merge /> {fillVars(t('purchasesG8.mergeBtn'), { n: selected.length })}</Button>
        )}
        <span className="ml-auto font-data text-[13px] tabular-nums text-muted-foreground">{fillVars(t('purchasesG8.countTotals'), { n: rows.length, ht: eur(totalHt), ttc: eur(totalTtc) })}</span>
        <Button size="sm" variant="outline" onClick={exp} disabled={!rows.length}><FileSpreadsheet /> {t('purchasesG8.excel')}</Button>
      </div>
      {docType === 'REC' && <p className="text-[12px] text-muted-foreground">{t('designTransverse.purchases.help_views')}</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              {canMerge && <Th className="w-8" />}
              <Th>{t('purchases.colNumber')}</Th><Th>{t('purchases.colDate')}</Th><Th>{t('purchases.colSupplier')}</Th><Th>{t('purchases.colStatus')}</Th>
              {docType === 'REC' ? <><Th>{t('purchases.invoiceNo')}</Th><Th>{t('purchases.invoiceDate')}</Th><Th className="text-right">{t('purchases.shippingHt')}</Th></>
                : <><Th>{t('purchasesG8.orderType')}</Th><Th>{t('purchasesG8.lastSent')}</Th><Th>{t('purchasesG8.receiptsNo')}</Th></>}
              <Th>{t('purchasesG8.operator')}</Th><Th className="text-right">{t('purchases.totalHt')}</Th><Th className="text-right">{t('purchases.colTtc')}</Th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={12} className="py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {q.error && <tr><td colSpan={12} className="px-3 py-3 text-danger">{(q.error as Error).message}</td></tr>}
            {q.data && rows.length === 0 && <tr><td colSpan={12} className="py-6 text-center text-muted-foreground">{t('purchases.empty')}</td></tr>}
            {rows.map((d) => (
              <tr key={d.id} onClick={() => navigate({ to: '/purchases/$orderId', params: { orderId: d.id }, search: {} })} className="cursor-pointer border-t border-border hover:bg-accent">
                {canMerge && <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} className="size-4 accent-[var(--ducati-red)]" /></td>}
                <td className="px-3 py-2 font-mono text-[12px]">{d.number ?? t('purchases.status_brouillon')}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.doc_date ?? '—'}</td>
                <td className="px-3 py-2">{d.supplier_name ?? '—'}</td>
                <td className="px-3 py-2"><StatusBadge tone={purchaseStatusTone(d.status)} label={t(`purchases.status_${d.status}`)} /></td>
                {docType === 'REC' ? (
                  <><td className="px-3 py-2 font-mono text-[12px]">{d.supplier_invoice_no ?? '—'}</td><td className="px-3 py-2 font-mono text-[12px]">{d.invoice_date ?? '—'}</td><td className="px-3 py-2 text-right tabular-nums">{eur(d.shipping_ht)}</td></>
                ) : (
                  <><td className="px-3 py-2">{d.order_type ? t(`purchasesG8.orderType_${d.order_type}`) : '—'}</td><td className="px-3 py-2 font-mono text-[12px]">{dt(d.last_sent_at)}</td><td className="px-3 py-2 font-mono text-[12px]">{d.receipts ?? '—'}</td></>
                )}
                <td className="px-3 py-2 text-[12px]">{d.operator_name ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(d.total_ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(d.total_ttc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mergeOpen && (
        <MergeDialog companyId={companyId} rows={selected} onClose={() => setMergeOpen(false)}
          onDone={(id) => { setMergeOpen(false); setSel(new Set()); qc.invalidateQueries({ queryKey: ['purchase-docs'] }); navigate({ to: '/purchases/$orderId', params: { orderId: id }, search: {} }); }} />
      )}
    </div>
  );
}

/** Regroupement G8 : franco, minimum, nombre de commandes, total commandes, total sélection. */
function MergeDialog({ companyId, rows, onClose, onDone }: { companyId: string; rows: PurchaseDocRow[]; onClose: () => void; onDone: (id: string) => void }) {
  const problem = mergeProblem(rows.map((r) => ({ supplier_id: r.supplier_id, doc_type: r.doc_type, status: r.status, dcs_kind: r.dcs_kind })));
  const supplierId = rows[0]?.supplier_id ?? null;
  const cond = useQuery({ queryKey: ['supplier-conditions', supplierId], queryFn: () => getSupplierConditions(supplierId!), enabled: !!supplierId && !problem });
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((s, r) => s + r.total_ht, 0);
  const th = cond.data ? thresholdStatus(total, 0, { franco: cond.data.supplier_franco_min, minAmount: cond.data.supplier_order_min, minQty: null }) : null;
  const go = async () => {
    setBusy(true);
    try { const r = await mergeOrders(companyId, rows.map((x) => x.id), null); toast.success(fillVars(t('purchasesG8.merged'), { n: r.merged })); onDone(r.id); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('purchases.errSave')); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('purchasesG8.mergeTitle')}</DialogTitle></DialogHeader>
        {problem ? <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t(`purchasesG8.mergeProblem_${problem}`)}</p> : (
          <div className="space-y-2 font-data text-[13px]">
            <p>{rows[0]?.supplier_name}</p>
            <p>{fillVars(t('purchasesG8.mergeCount'), { n: rows.length, list: rows.map((r) => r.number ?? t('purchases.status_brouillon')).join(', ') })}</p>
            <p className="tabular-nums">{t('purchasesG8.selectionTotal')} : <b>{eur(total)}</b></p>
            {th && (
              <div className="flex flex-wrap gap-2">
                {th.francoMet !== null && <StatusBadge tone={th.francoMet ? 'success' : 'warning'} label={th.francoMet ? fillVars(t('proposal.thresholdMet'), { label: t('proposal.franco'), min: eur(cond.data?.supplier_franco_min) }) : fillVars(t('proposal.thresholdRest'), { label: t('proposal.franco'), rest: eur(th.francoRest) })} />}
                {th.minMet !== null && <StatusBadge tone={th.minMet ? 'success' : 'warning'} label={th.minMet ? fillVars(t('proposal.thresholdMet'), { label: t('proposal.orderMin'), min: eur(cond.data?.supplier_order_min) }) : fillVars(t('proposal.thresholdRest'), { label: t('proposal.orderMin'), rest: eur(th.minRest) })} />}
              </div>
            )}
            <p className="text-[12px] text-muted-foreground">{t('purchasesG8.mergeEffect')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={go} disabled={!!problem || busy}>{busy ? <Loader2 className="animate-spin" /> : <Merge />} {t('purchasesG8.mergeDo')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DueTab({ companyId, filter }: { companyId: string; filter: ListFilter }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['purchase-due', companyId, filter], queryFn: () => listDueSchedules(companyId, filter) });
  const rows = q.data ?? [];
  const exp = () => exportXlsx(t('purchasesG8.tab_due'), [t('purchasesG8.receiptsNo'), t('purchasesG8.dueDate'), t('purchases.colSupplier'), t('purchasesG8.supplierCode'), t('purchases.schedAmount'), t('purchases.invoiceNo'), t('purchases.invoiceDate'), t('purchasesG8.account'), t('purchasesG8.chassisNo')],
    rows.map((r) => [r.number, r.due_date, r.supplier_name, r.supplier_code, r.amount, r.supplier_invoice_no, r.invoice_date, r.accounting_account, r.chassis]));
  return (
    <TabFrame onExport={exp} disabled={!rows.length} total={eur(rows.reduce((s, r) => s + r.amount, 0))} loading={q.isLoading} error={q.error as Error | null}>
      <thead className="bg-muted"><tr>{[t('purchasesG8.receiptsNo'), t('purchasesG8.dueDate'), t('purchases.colSupplier'), t('purchases.invoiceNo'), t('purchases.invoiceDate'), t('purchasesG8.account'), t('purchasesG8.chassisNo'), t('purchases.schedAmount')].map((h, i) => <Th key={i} className={i === 7 ? 'text-right' : ''}>{h}</Th>)}</tr></thead>
      <tbody>
        {rows.length === 0 && !q.isLoading && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">{t('purchases.empty')}</td></tr>}
        {rows.map((r, i) => (
          <tr key={`${r.order_id}-${i}`} onClick={() => navigate({ to: '/purchases/$orderId', params: { orderId: r.order_id }, search: {} })} className="cursor-pointer border-t border-border hover:bg-accent">
            <td className="px-3 py-2 font-mono text-[12px]">{r.number}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{r.due_date ?? <StatusBadge tone="warning" label={t('purchasesG8.dueMissing')} />}</td>
            <td className="px-3 py-2">{r.supplier_name ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{r.supplier_invoice_no ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{r.invoice_date ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{r.accounting_account ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{r.chassis ?? '—'}</td>
            <td className="px-3 py-2 text-right tabular-nums">{eur(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </TabFrame>
  );
}

function VatTab({ companyId, filter }: { companyId: string; filter: ListFilter }) {
  const [basis, setBasis] = useState<'receipt' | 'invoice'>('receipt');
  const q = useQuery({ queryKey: ['purchase-vat', companyId, filter, basis], queryFn: () => listVatBySupplier(companyId, filter, basis) });
  const rows = q.data ?? [];
  const exp = () => exportXlsx(t('purchasesG8.tab_vat'), [t('purchases.colSupplier'), t('purchasesG8.vatNumber'), t('purchases.colVat'), t('purchases.totalHt'), t('purchases.totalVat'), t('purchases.totalTtc'), t('purchasesG8.receiptsCount')],
    rows.map((r) => [r.supplier_name, r.vat_number, r.vat_rate, r.base_ht, r.vat, r.ttc, r.receipts]));
  return (
    <div className="space-y-2">
      <div className="flex gap-2">{(['receipt', 'invoice'] as const).map((b) => <ViewToggle key={b} on={basis === b} onClick={() => setBasis(b)}>{t(`purchasesG8.basis_${b}`)}</ViewToggle>)}</div>
      <TabFrame onExport={exp} disabled={!rows.length} total={`${eur(rows.reduce((s, r) => s + r.base_ht, 0))} ${t('purchases.totalHt')} · ${eur(rows.reduce((s, r) => s + r.vat, 0))} ${t('purchases.totalVat')}`} loading={q.isLoading} error={q.error as Error | null}>
        <thead className="bg-muted"><tr>{[t('purchases.colSupplier'), t('purchasesG8.vatNumber'), t('purchases.colVat'), t('purchases.totalHt'), t('purchases.totalVat'), t('purchases.totalTtc'), t('purchasesG8.receiptsCount')].map((h, i) => <Th key={i} className={i >= 2 ? 'text-right' : ''}>{h}</Th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && !q.isLoading && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">{t('purchases.empty')}</td></tr>}
          {rows.map((r, i) => (
            <tr key={`${r.supplier_id}-${r.vat_rate}-${i}`} className="border-t border-border">
              <td className="px-3 py-2">{r.supplier_name ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-[12px]">{r.vat_number ?? '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.vat_rate} %</td>
              <td className="px-3 py-2 text-right tabular-nums">{eur(r.base_ht)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{eur(r.vat)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{eur(r.ttc)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.receipts}</td>
            </tr>
          ))}
        </tbody>
      </TabFrame>
    </div>
  );
}

function FeesTab({ companyId, filter }: { companyId: string; filter: ListFilter }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['purchase-docs', companyId, 'REC', filter], queryFn: () => listPurchaseDocuments(companyId, 'REC', filter) });
  const rows = (q.data ?? []).filter((d) => d.status === 'recue' && Math.abs(d.shipping_ht) > 0.005);
  const exp = () => exportXlsx(t('purchasesG8.tab_fees'), [t('purchases.colDate'), t('purchases.colSupplier'), t('purchases.invoiceNo'), t('purchases.invoiceDate'), t('purchasesG8.receiptsNo'), t('purchases.shippingHt'), t('purchasesG8.feesTtc')],
    rows.map((d) => [d.doc_date, d.supplier_name, d.supplier_invoice_no, d.invoice_date, d.number, d.shipping_ht, d.shipping_ttc]));
  return (
    <TabFrame onExport={exp} disabled={!rows.length} total={eur(rows.reduce((s, d) => s + d.shipping_ht, 0))} loading={q.isLoading} error={q.error as Error | null}>
      <thead className="bg-muted"><tr>{[t('purchases.colDate'), t('purchases.colSupplier'), t('purchases.invoiceNo'), t('purchases.invoiceDate'), t('purchasesG8.receiptsNo'), t('purchases.shippingHt'), t('purchasesG8.feesTtc')].map((h, i) => <Th key={i} className={i >= 5 ? 'text-right' : ''}>{h}</Th>)}</tr></thead>
      <tbody>
        {rows.length === 0 && !q.isLoading && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">{t('purchases.empty')}</td></tr>}
        {rows.map((d) => (
          <tr key={d.id} onClick={() => navigate({ to: '/purchases/$orderId', params: { orderId: d.id }, search: {} })} className="cursor-pointer border-t border-border hover:bg-accent">
            <td className="px-3 py-2 font-mono text-[12px]">{d.doc_date}</td>
            <td className="px-3 py-2">{d.supplier_name ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{d.supplier_invoice_no ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{d.invoice_date ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{d.number}</td>
            <td className="px-3 py-2 text-right tabular-nums">{eur(d.shipping_ht)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{eur(d.shipping_ttc)}</td>
          </tr>
        ))}
      </tbody>
    </TabFrame>
  );
}

function HistoryTab({ companyId, filter }: { companyId: string; filter: ListFilter }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['purchase-history', companyId, filter], queryFn: () => listOrderHistory(companyId, filter) });
  const rows = q.data ?? [];
  const exp = () => exportXlsx(t('purchasesG8.tab_history'), [t('purchases.colNumber'), t('purchasesG8.sentDate'), t('purchasesG8.sentTime'), t('purchasesG8.channel'), t('purchasesG8.supplierCode'), t('purchases.colSupplier'), t('purchasesG8.receiptsNo'), t('purchasesG8.operator')],
    rows.map((r) => [r.number, r.sent_at.slice(0, 10), new Date(r.sent_at).toLocaleTimeString('fr-BE'), t(`purchasesG8.send_${r.channel}`), r.supplier_code, r.supplier_name, r.receipts, r.sent_by_name]));
  return (
    <TabFrame onExport={exp} disabled={!rows.length} total={String(rows.length)} loading={q.isLoading} error={q.error as Error | null}>
      <thead className="bg-muted"><tr>{[t('purchases.colNumber'), t('purchasesG8.sentAt'), t('purchasesG8.channel'), t('purchases.colSupplier'), t('purchasesG8.receiptsNo'), t('purchasesG8.operator'), t('purchasesG8.notes')].map((h, i) => <Th key={i}>{h}</Th>)}</tr></thead>
      <tbody>
        {rows.length === 0 && !q.isLoading && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">{t('purchasesG8.historyEmpty')}</td></tr>}
        {rows.map((r, i) => (
          <tr key={`${r.order_id}-${i}`} onClick={() => navigate({ to: '/purchases/$orderId', params: { orderId: r.order_id }, search: {} })} className="cursor-pointer border-t border-border hover:bg-accent">
            <td className="px-3 py-2 font-mono text-[12px]">{r.number}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{dt(r.sent_at)}</td>
            <td className="px-3 py-2">{t(`purchasesG8.send_${r.channel}`)}</td>
            <td className="px-3 py-2">{r.supplier_name ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{r.receipts ?? '—'}</td>
            <td className="px-3 py-2 text-[12px]">{r.sent_by_name ?? '—'}</td>
            <td className="px-3 py-2 text-[12px] text-muted-foreground">{r.note ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </TabFrame>
  );
}

function TabFrame({ children, onExport, disabled, total, loading, error }: { children: ReactNode; onExport: () => void; disabled: boolean; total: string; loading: boolean; error: Error | null }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto font-data text-[13px] tabular-nums text-muted-foreground">{t('purchasesG8.total')} : {total}</span>
        <Button size="sm" variant="outline" onClick={onExport} disabled={disabled}><FileSpreadsheet /> {t('purchasesG8.excel')}</Button>
      </div>
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error.message}</p>}
      <div className="overflow-x-auto rounded-md border border-border"><table className="w-full border-collapse font-data text-[13px]">{children}</table></div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
