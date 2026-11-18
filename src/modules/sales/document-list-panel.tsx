/**
 * M6 — Tableau paginé des documents de vente, partagé par la « Liste des factures » et les onglets
 * de « Documents clients » (G8). Pagination serveur (au-delà des 100 derniers documents de l'ancienne
 * liste), filtres exercice / n° / date / montant / client / opérateur / pro-public / transfert
 * comptable, colonnes montant dû, remise, acompte, marge, % marge, règlements, TVA, transfert ;
 * totaux de toute la sélection et panier moyen ; cases à cocher pour les actions groupées.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { listCompanyMembers } from '@/modules/crm/api';
import { contactDisplayName, type Contact } from '@/modules/contacts/api';
import { ContactPicker } from './document-editor';
import { listPaymentMethods } from './write-api';
import { listDocumentsPage } from './document-list-api';
import {
  emptyDocListFilters, countDocListFilters, marginPct, averageBasket, paymentsSummary, displayNumber,
  type DocListFilters, type DocListRow, type FiscalChoice, type ClientKind, type TransferFilter, type DocListSort,
} from './document-list';

const eur = (n: number | null | undefined) => (n == null ? '—' : `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`);
const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(2).replace('.', ',')} %`);
const fmtDate = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-BE') : '');
const statusTone = (s: string) => (s === 'payee' ? 'success' : s === 'annulee' || s === 'converti' || s === 'avoir_emis' ? 'neutral' : s === 'brouillon' ? 'info' : 'warning');
const ALL = '__all';
export const DOC_LIST_PAGE_SIZE = 50;

export type DocListToolbarContext = {
  selected: DocListRow[];
  filters: DocListFilters;
  total: number;
  clearSelection: () => void;
};

export function DocumentListPanel({
  companyId, docTypes, typeChoices, fixed, showTransfer = false, showFiscal = true, toolbar, rowActions, emptyLabel,
}: {
  companyId: string;
  /** Types affichés par défaut. */
  docTypes: readonly string[];
  /** Types que l'utilisateur peut cocher / décocher (sinon `docTypes` fixes). */
  typeChoices?: readonly string[];
  /** Filtres imposés par l'écran parent (période, client, opérateur de « Documents clients »). */
  fixed?: Partial<DocListFilters>;
  showTransfer?: boolean;
  showFiscal?: boolean;
  toolbar?: (ctx: DocListToolbarContext) => ReactNode;
  rowActions?: (r: DocListRow) => ReactNode;
  emptyLabel?: string;
}) {
  const navigate = useNavigate();
  const [own, setOwn] = useState<DocListFilters>(() => emptyDocListFilters(docTypes));
  const [contact, setContact] = useState<Contact | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Map<string, DocListRow>>(new Map());
  // Filtres effectifs : ceux de l'écran parent l'emportent (période, client, opérateur communs aux onglets).
  const filters: DocListFilters = useMemo(() => ({ ...own, ...(fixed ?? {}) }), [own, fixed]);
  const set = <K extends keyof DocListFilters>(k: K, v: DocListFilters[K]) => { setOwn((p) => ({ ...p, [k]: v })); setPage(0); };
  const active = countDocListFilters(own);
  const isFixed = (k: keyof DocListFilters) => fixed != null && k in fixed;

  const q = useQuery({
    queryKey: ['sales-doc-list', companyId, filters, page],
    queryFn: () => listDocumentsPage(companyId, filters, page * DOC_LIST_PAGE_SIZE, DOC_LIST_PAGE_SIZE),
    placeholderData: keepPreviousData,
  });
  const membersQ = useQuery({ queryKey: ['company-members', companyId], queryFn: () => listCompanyMembers(companyId), staleTime: 300_000 });
  const methodsQ = useQuery({ queryKey: ['payment-methods', companyId], queryFn: () => listPaymentMethods(companyId), staleTime: 300_000 });
  const methodLabel = useMemo(() => {
    const m = new Map((methodsQ.data ?? []).map((x) => [x.code, x.label]));
    return (code: string) => m.get(code) ?? code;
  }, [methodsQ.data]);

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const totals = q.data?.totals;
  const basket = totals ? averageBasket(totals) : null;
  const pages = Math.max(1, Math.ceil(total / DOC_LIST_PAGE_SIZE));
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (r: DocListRow) => setSelected((prev) => { const n = new Map(prev); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n; });
  const togglePage = () => setSelected((prev) => {
    const n = new Map(prev);
    if (allOnPage) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.set(r.id, r));
    return n;
  });
  const ctx: DocListToolbarContext = { selected: [...selected.values()], filters, total, clearSelection: () => setSelected(new Map()) };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={own.search} onChange={(e) => set('search', e.target.value)} placeholder={t('docList.searchPlaceholder')} className="pl-9" />
        </div>
        {typeChoices && typeChoices.map((dt) => (
          <label key={dt} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={own.docTypes.includes(dt)}
              onCheckedChange={(v) => set('docTypes', v === true ? [...own.docTypes, dt] : own.docTypes.filter((x) => x !== dt).length ? own.docTypes.filter((x) => x !== dt) : own.docTypes)}
            />
            {t(`sales.type_${dt}`)}
          </label>
        ))}
        <Button variant={active > 0 ? 'default' : 'outline'} onClick={() => setFiltersOpen((o) => !o)}>
          <SlidersHorizontal /> {t('sales.filters')}{active > 0 ? ` (${active})` : ''}
        </Button>
        <Select value={own.sort} onValueChange={(v) => set('sort', v as DocListSort)}>
          <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(['date_desc', 'date_asc', 'number_desc', 'number_asc', 'amount_desc'] as DocListSort[]).map((s) => <SelectItem key={s} value={s}>{t(`docList.sort_${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar?.(ctx)}</div>
      </div>

      {filtersOpen && (
        <div className="rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {showFiscal && !isFixed('fiscal') && (
              <Field label={t('docList.fiscal')}>
                <Select value={own.fiscal} onValueChange={(v) => set('fiscal', v as FiscalChoice)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">{t('docList.fiscalCurrent')}</SelectItem>
                    <SelectItem value="previous">{t('docList.fiscalPrevious')}</SelectItem>
                    <SelectItem value="all">{t('docList.fiscalAll')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            {!isFixed('dateFrom') && <Field label={t('sales.filterDateFrom')}><Input type="date" value={own.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} /></Field>}
            {!isFixed('dateTo') && <Field label={t('sales.filterDateTo')}><Input type="date" value={own.dateTo} onChange={(e) => set('dateTo', e.target.value)} /></Field>}
            <Field label={t('docList.numberFrom')}><Input value={own.numberFrom} onChange={(e) => set('numberFrom', e.target.value)} placeholder={t('docList.numberPlaceholder')} /></Field>
            <Field label={t('docList.numberTo')}><Input value={own.numberTo} onChange={(e) => set('numberTo', e.target.value)} /></Field>
            <Field label={t('docList.amountMin')}><Input inputMode="decimal" value={own.amountMin} onChange={(e) => set('amountMin', e.target.value)} /></Field>
            <Field label={t('docList.amountMax')}><Input inputMode="decimal" value={own.amountMax} onChange={(e) => set('amountMax', e.target.value)} /></Field>
            {!isFixed('contactId') && (
              <Field label={t('sales.client')}>
                {contact ? (
                  <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                    <span className="truncate">{contactDisplayName(contact)}</span>
                    <button type="button" onClick={() => { setContact(null); set('contactId', null); }} className="ml-auto text-muted-foreground hover:text-danger" aria-label={t('sales.filterReset')}><X className="size-4" /></button>
                  </div>
                ) : <ContactPicker companyId={companyId} onPick={(c) => { setContact(c); set('contactId', c.id); }} />}
              </Field>
            )}
            {!isFixed('operatorUserId') && (
              <Field label={t('sales.operator')}>
                <Select value={own.operatorUserId ?? ALL} onValueChange={(v) => set('operatorUserId', v === ALL ? null : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('sales.filterAll')}</SelectItem>
                    {(membersQ.data ?? []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label={t('docList.clientKind')}>
              <Select value={own.clientKind} onValueChange={(v) => set('clientKind', v as ClientKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('sales.filterAll')}</SelectItem>
                  <SelectItem value="pro">{t('docList.kindPro')}</SelectItem>
                  <SelectItem value="public">{t('docList.kindPublic')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {showTransfer && (
              <Field label={t('docList.transfer')}>
                <Select value={own.transfer} onValueChange={(v) => set('transfer', v as TransferFilter)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('sales.filterAll')}</SelectItem>
                    <SelectItem value="done">{t('docList.transferDone')}</SelectItem>
                    <SelectItem value="pending">{t('docList.transferPending')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <div className="flex items-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setOwn(emptyDocListFilters(docTypes)); setContact(null); setPage(0); }} disabled={active === 0}>
                <X /> {t('sales.filterReset')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {totals && (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-[13px]">
          <span className="font-medium">{t('docList.banner').replace('{n}', String(totals.count))}</span>
          <span className="mx-2 text-muted-foreground">·</span>
          {t('docList.basket')} <span className="tabular-nums">{eur(basket?.ht ?? 0)} {t('docList.ht')} / {eur(basket?.ttc ?? 0)} {t('docList.ttc')}</span>
          {!q.data?.marginExact && <span className="ml-2 text-[12px] text-muted-foreground">{t('docList.marginFallback')}</span>}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th className="w-8"><Checkbox checked={allOnPage} onCheckedChange={togglePage} aria-label={t('docList.selectPage')} /></Th>
              <Th>{t('sales.colNumber')}</Th>
              <Th>{t('sales.colType')}</Th>
              <Th>{t('sales.colDate')}</Th>
              <Th>{t('docList.colCode')}</Th>
              <Th>{t('sales.client')}</Th>
              <Th>{t('sales.operator')}</Th>
              <Th className="text-right">{t('docList.colDue')}</Th>
              <Th className="text-right">{t('docList.colDiscount')}</Th>
              <Th className="text-right">{t('docList.ht')}</Th>
              <Th className="text-right">{t('docList.colVat')}</Th>
              <Th className="text-right">{t('docList.ttc')}</Th>
              <Th className="text-right">{t('docList.colDeposit')}</Th>
              <Th className="text-right">{t('docList.colMargin')}</Th>
              <Th className="text-right">{t('docList.colMarginPct')}</Th>
              <Th>{t('docList.colPayments')}</Th>
              {showTransfer && <Th>{t('docList.colTransfer')}</Th>}
              <Th>{t('sales.colStatus')}</Th>
              {rowActions && <Th className="text-right">{t('sales.colActions')}</Th>}
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={20} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {q.isError && <tr><td colSpan={20} className="px-3 py-6 text-center text-danger">{t('docList.loadError')}</td></tr>}
            {!q.isLoading && rows.length === 0 && !q.isError && <tr><td colSpan={20} className="px-3 py-6 text-center text-muted-foreground">{emptyLabel ?? t('sales.filterEmpty')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} onClick={() => navigate({ to: r.status === 'brouillon' ? '/sales/$documentId/edit' : '/sales/$documentId', params: { documentId: r.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r)} /></td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">{displayNumber(r) || '—'}</td>
                <td className="px-3 py-2">{t(`sales.type_${r.doc_type}`)}{r.tax_exempt && <span className="ml-1 text-[11px] text-muted-foreground">({t('sales.taxExempt')})</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.issue_date)}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{r.contact_code ?? ''}</td>
                <td className="px-3 py-2">{r.contact_name ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2">{r.operator ?? ''}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.due > 0.004 ? 'font-semibold text-danger' : ''}`}>{eur(r.due)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.discount ? eur(r.discount) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.total_ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.total_vat)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.total_ttc)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.deposit ? eur(r.deposit) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.margin)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(marginPct(r.margin, r.total_ht))}</td>
                <td className="px-3 py-2 text-[12px]">{paymentsSummary(r.payments, methodLabel, t('docList.expected'))}</td>
                {showTransfer && (
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.compta_transferred
                      ? <StatusBadge tone="success" icon={CheckCircle2} label={`${t('docList.transferDone')}${r.date_transfert ? ` ${fmtDate(r.date_transfert)}` : ''}`} />
                      : <StatusBadge tone="neutral" icon={Clock} label={t('docList.transferPending')} />}
                  </td>
                )}
                <td className="px-3 py-2"><StatusBadge tone={statusTone(r.status)} label={t(`sales.status_${r.status}`)} /></td>
                {rowActions && <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><div className="flex justify-end gap-1">{rowActions(r)}</div></td>}
              </tr>
            ))}
          </tbody>
          {totals && totals.count > 0 && (
            <tfoot className="bg-muted font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={7}>{t('docList.totals').replace('{n}', String(totals.count))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(totals.due)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(totals.discount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(totals.ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(totals.vat)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(totals.ttc)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(totals.deposit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(totals.margin)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(marginPct(totals.margin, totals.ht))}</td>
                <td colSpan={showTransfer ? 3 : 2} />
                {rowActions && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
        <span>
          {total > 0 ? t('docList.range').replace('{from}', String(page * DOC_LIST_PAGE_SIZE + 1)).replace('{to}', String(Math.min(total, (page + 1) * DOC_LIST_PAGE_SIZE))).replace('{n}', String(total)) : ''}
          {selected.size > 0 && <span className="ml-3">{t('docList.selectedCount').replace('{n}', String(selected.size))}</span>}
          {q.isFetching && !q.isLoading && <Loader2 className="ml-2 inline size-3 animate-spin" />}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}><ChevronLeft /> {t('docList.prev')}</Button>
          <span className="px-2 tabular-nums">{page + 1} / {pages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page + 1 >= pages}>{t('docList.next')} <ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
