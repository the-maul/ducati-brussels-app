/**
 * M8 — Ecrans de la garantie (rattrapage G8 du 18/11/2026) :
 * - `WarrantyOrsTable` : vue « O.R. garantie » de la liste des OR (type de cession, avancement) ;
 * - `WarrantyReturnsPanel` : suivi des retours / remboursements constructeur, global (Historique
 *   garantie) ou pour un fournisseur (fiche fournisseur › Garantie) ;
 * - `WarrantyListsPanel` : liste « Garanties » (temps MO, achat pieces, cout MO) et
 *   « Garanties / CA » sur une periode.
 * Regles pures : `rules.ts`. Acces base : `api.ts` (migration 20261118130000).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Hourglass, Loader2, Pencil, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/mutation-feedback';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, fillVars } from '@/lib/i18n';
import { contactDisplayName } from '@/modules/contacts/api';
import {
  deleteWarrantyReturn, listWarrantyCessionTypes, listWarrantyLines, listWarrantyOrs, listWarrantyReturns,
  updateWarrantyReturn, warrantyStatsByClient, type WarrantyReturnPatch, type WarrantyReturnRow, type WarrantyReturnsFilter,
} from './api';
import {
  WARRANTY_RETURN_STATUSES, isReturnSettled, returnStatusPatch, returnsTotals, warrantyLinesTotals, warrantyRatePct,
  warrantyReturnTone, warrantyStatsTotals, warrantyStatusTone, type WarrantyReturnStatus,
} from './rules';

const eur = (n: number | string) => `${new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)} €`;
const hours = (n: number | string) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '—');
const today = () => new Date().toISOString().slice(0, 10);
const startOfYear = () => `${new Date().getFullYear()}-01-01`;
const ALL = ' all';

export function WarrantyStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={warrantyStatusTone(status)} label={t(`workshop.warranty_${status}`)} />;
}

export function WarrantyReturnBadge({ status }: { status: string }) {
  return <StatusBadge tone={warrantyReturnTone(status)} icon={isReturnSettled(status) ? CheckCircle2 : Hourglass} label={t(`warranty.return_${status}`)} />;
}

// ---------------------------------------------------------------------------------------------
// Vue « O.R. garantie »
// ---------------------------------------------------------------------------------------------

export function WarrantyOrsTable({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const [withInvoiced, setWithInvoiced] = useState(false);
  const q = useQuery({ queryKey: ['warranty-ors', companyId, withInvoiced], queryFn: () => listWarrantyOrs(companyId, { includeInvoiced: withInvoiced }) });
  const types = useQuery({ queryKey: ['warranty-cession-types', companyId], queryFn: () => listWarrantyCessionTypes(companyId), staleTime: 300_000 });
  const typeLabel = (code: string | null) => (code ? types.data?.find((x) => x.code === code)?.label ?? code : '—');
  const rows = q.data?.rows ?? [];
  return (
    <div className="space-y-3">
      {q.data && !q.data.schemaReady && <MigrationNote />}
      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <input type="checkbox" checked={withInvoiced} onChange={(e) => setWithInvoiced(e.target.checked)} className="size-4" />
        {t('warranty.includeInvoiced')}
      </label>
      <TableShell head={[t('workshop.colStatus'), t('warranty.colType'), t('workshop.colNumber'), t('workshop.colClient'), t('warranty.colVehicle'), t('warranty.colVin'), t('warranty.colProgress'), t('warranty.colReceived'), t('workshop.colTtc')]} rightFrom={8}>
        {q.isLoading && <LoadingRow span={9} />}
        {!q.isLoading && rows.length === 0 && <EmptyRow span={9} label={t('warranty.emptyOrs')} />}
        {rows.map((o) => (
          <tr key={o.id} onClick={() => navigate({ to: '/workshop/$orId', params: { orId: o.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
            <td className="px-3 py-2"><StatusBadge tone={o.status === 'facture' ? 'success' : o.status === 'pret' ? 'info' : 'warning'} label={t(`workshop.status_${o.status}`)} /></td>
            <td className="px-3 py-2">{typeLabel(o.warranty_cession_code)}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{o.number ?? '—'}</td>
            <td className="px-3 py-2">
              <div>{o.contact ? contactDisplayName(o.contact) : '—'}</div>
              {o.contact?.code && <div className="text-[12px] text-muted-foreground">{o.contact.code}</div>}
            </td>
            <td className="px-3 py-2">{[o.vehicle?.brand, o.vehicle?.model].filter(Boolean).join(' ') || '—'}<div className="text-[12px] text-muted-foreground">{o.vehicle?.plate ?? ''}</div></td>
            <td className="px-3 py-2 font-data text-[12px] uppercase">{o.vehicle?.vin ?? '—'}</td>
            <td className="px-3 py-2"><WarrantyStatusBadge status={o.warranty_status} /></td>
            <td className="px-3 py-2 tabular-nums">{fmtDate(o.created_at)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{eur(o.total_ttc)}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Retours / remboursements constructeur
// ---------------------------------------------------------------------------------------------

export function WarrantyReturnsPanel({ companyId, supplierId = null }: { companyId: string; supplierId?: string | null }) {
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const [status, setStatus] = useState<string>(ALL);
  const [dateField, setDateField] = useState<NonNullable<WarrantyReturnsFilter['dateField']>>('taken_at');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState<WarrantyReturnRow | null>(null);
  const filter: WarrantyReturnsFilter = {
    supplierId, status: status === ALL ? null : (status as WarrantyReturnStatus | 'en_attente'), dateField, from: from || null, to: to || null,
  };
  const key = ['warranty-returns', companyId, filter];
  const q = useQuery({ queryKey: key, queryFn: () => listWarrantyReturns(companyId, filter) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['warranty-returns'] });
  const quick = useMutation({
    mutationFn: ({ row, next }: { row: WarrantyReturnRow; next: WarrantyReturnStatus }) => updateWarrantyReturn(row.id, returnStatusPatch(next, row, today())),
    meta: { success: false },
    onSuccess: () => { refresh(); toast.success(t('warranty.returnSaved')); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = q.data?.rows ?? [];
  const totals = returnsTotals(rows);

  if (q.data && !q.data.schemaReady) return <MigrationNote />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label={t('warranty.filterStatus')}>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('warranty.filterAllStatuses')}</SelectItem>
              <SelectItem value="en_attente">{t('warranty.filterPending')}</SelectItem>
              {WARRANTY_RETURN_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`warranty.return_${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label={t('warranty.filterDate')}>
          <Select value={dateField} onValueChange={(v) => setDateField(v as typeof dateField)}>
            <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="taken_at">{t('warranty.colTakenAt')}</SelectItem>
              <SelectItem value="received_at">{t('warranty.colReceivedAt')}</SelectItem>
              <SelectItem value="settled_at">{t('warranty.colSettledAt')}</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label={t('warranty.from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></FilterField>
        <FilterField label={t('warranty.to')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></FilterField>
        <div className="ml-auto flex gap-4 rounded-md border border-border bg-card px-4 py-2 font-data text-[13px] tabular-nums">
          <span>{t('warranty.totalPending')} <b>{totals.pendingCount}</b> · <b>{eur(totals.pendingHt)}</b></span>
          <span className="text-muted-foreground">{t('warranty.totalSettled')} {totals.settledCount} · {eur(totals.settledHt)}</span>
        </div>
      </div>
      <TableShell
        head={[t('warranty.colReference'), t('warranty.colDesignation'), supplierId ? t('workshop.colClient') : t('warranty.colSupplier'), t('workshop.colNumber'), t('warranty.colTakenAt'), t('warranty.colReceivedAt'), t('warranty.colInvoice'), t('warranty.colDeliveryNote'), t('warranty.colUnitCost'), t('warranty.colAmount'), t('warranty.colState'), t('warranty.colSettledAt'), '']}
        rightFrom={8} rightTo={9}
      >
        {q.isLoading && <LoadingRow span={13} />}
        {!q.isLoading && rows.length === 0 && <EmptyRow span={13} label={t('warranty.emptyReturns')} />}
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border last:border-0">
            <td className="px-3 py-2 font-data text-[12px]">{r.reference ?? '—'}</td>
            <td className="px-3 py-2">{r.designation}<div className="text-[12px] text-muted-foreground tabular-nums">{fillVars(t('warranty.qty'), { n: hours(r.quantity) })}</div></td>
            <td className="px-3 py-2">{supplierId ? (r.contact ? contactDisplayName(r.contact) : '—') : (r.supplier ? contactDisplayName(r.supplier) : t('warranty.noSupplier'))}</td>
            <td className="px-3 py-2 font-mono text-[12px]">{r.repair_order?.number ?? r.ticket_number ?? '—'}</td>
            <td className="px-3 py-2 tabular-nums">{fmtDate(r.taken_at)}</td>
            <td className="px-3 py-2 tabular-nums">{fmtDate(r.received_at)}</td>
            <td className="px-3 py-2 tabular-nums">{r.purchase_invoice_number ?? '—'}{r.purchase_invoice_date && <div className="text-[12px] text-muted-foreground">{fmtDate(r.purchase_invoice_date)}</div>}</td>
            <td className="px-3 py-2 tabular-nums">{r.delivery_note_number ?? '—'}{r.delivery_note_date && <div className="text-[12px] text-muted-foreground">{fmtDate(r.delivery_note_date)}</div>}</td>
            <td className="px-3 py-2 text-right tabular-nums">{eur(r.unit_cost_ht)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{eur(r.amount_ht)}</td>
            <td className="px-3 py-2">
              {canWrite ? (
                <Select value={r.status} onValueChange={(v) => quick.mutate({ row: r, next: v as WarrantyReturnStatus })}>
                  <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>{WARRANTY_RETURN_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`warranty.return_${s}`)}</SelectItem>)}</SelectContent>
                </Select>
              ) : <WarrantyReturnBadge status={r.status} />}
            </td>
            <td className="px-3 py-2 tabular-nums">{fmtDate(r.settled_at)}</td>
            <td className="px-3 py-2">{canWrite && <Button size="sm" variant="ghost" onClick={() => setEditing(r)} title={t('warranty.edit')}><Pencil className="size-4" /></Button>}</td>
          </tr>
        ))}
      </TableShell>
      {editing && <WarrantyReturnDialog row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function WarrantyReturnDialog({ row, onClose, onDone }: { row: WarrantyReturnRow; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    status: row.status, taken_at: row.taken_at ?? '', received_at: row.received_at ?? '', settled_at: row.settled_at ?? '',
    purchase_invoice_number: row.purchase_invoice_number ?? '', purchase_invoice_date: row.purchase_invoice_date ?? '',
    delivery_note_number: row.delivery_note_number ?? '', delivery_note_date: row.delivery_note_date ?? '',
    ticket_number: row.ticket_number ?? '', amount_ht: String(row.amount_ht ?? ''), notes: row.notes ?? '',
  });
  const nn = (s: string) => (s.trim() ? s.trim() : null);
  const save = useMutation({
    mutationFn: () => {
      const statusPart = f.status !== row.status ? returnStatusPatch(f.status, { settled_at: nn(f.settled_at) }, today()) : { status: f.status, settled_at: nn(f.settled_at) };
      const amount = Number(f.amount_ht.replace(',', '.'));
      const patch: WarrantyReturnPatch = {
        ...statusPart, taken_at: nn(f.taken_at), received_at: nn(f.received_at),
        purchase_invoice_number: nn(f.purchase_invoice_number), purchase_invoice_date: nn(f.purchase_invoice_date),
        delivery_note_number: nn(f.delivery_note_number), delivery_note_date: nn(f.delivery_note_date),
        ticket_number: nn(f.ticket_number), notes: nn(f.notes),
        ...(Number.isFinite(amount) && amount >= 0 ? { amount_ht: Math.round(amount * 100) / 100 } : {}),
      };
      return updateWarrantyReturn(row.id, patch);
    },
    meta: { success: false },
    onSuccess: () => { toast.success(t('warranty.returnSaved')); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => deleteWarrantyReturn(row.id),
    meta: { success: false },
    onSuccess: () => { toast.success(t('warranty.returnDeleted')); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{row.reference ? `${row.reference} — ` : ''}{row.designation}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FilterField label={t('warranty.colState')}>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as WarrantyReturnStatus })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{WARRANTY_RETURN_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`warranty.return_${s}`)}</SelectItem>)}</SelectContent>
            </Select>
          </FilterField>
          <FilterField label={t('warranty.colAmount')}><Input value={f.amount_ht} onChange={set('amount_ht')} className="h-9 text-right tabular-nums" inputMode="decimal" /></FilterField>
          <FilterField label={t('warranty.colTakenAt')}><Input type="date" value={f.taken_at} onChange={set('taken_at')} className="h-9" /></FilterField>
          <FilterField label={t('warranty.colReceivedAt')}><Input type="date" value={f.received_at} onChange={set('received_at')} className="h-9" /></FilterField>
          <FilterField label={t('warranty.colInvoice')}><Input value={f.purchase_invoice_number} onChange={set('purchase_invoice_number')} className="h-9 font-data" /></FilterField>
          <FilterField label={t('warranty.colInvoiceDate')}><Input type="date" value={f.purchase_invoice_date} onChange={set('purchase_invoice_date')} className="h-9" /></FilterField>
          <FilterField label={t('warranty.colDeliveryNote')}><Input value={f.delivery_note_number} onChange={set('delivery_note_number')} className="h-9 font-data" /></FilterField>
          <FilterField label={t('warranty.colDeliveryNoteDate')}><Input type="date" value={f.delivery_note_date} onChange={set('delivery_note_date')} className="h-9" /></FilterField>
          <FilterField label={t('warranty.colTicket')}><Input value={f.ticket_number} onChange={set('ticket_number')} className="h-9 font-data" /></FilterField>
          <FilterField label={t('warranty.colSettledAt')}><Input type="date" value={f.settled_at} onChange={set('settled_at')} className="h-9" /></FilterField>
          <div className="sm:col-span-2"><FilterField label={t('warranty.notes')}><Textarea rows={2} value={f.notes} onChange={set('notes')} /></FilterField></div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => { if (window.confirm(t('warranty.confirmDelete'))) del.mutate(); }} disabled={del.isPending}>
            {del.isPending ? <Loader2 className="animate-spin" /> : <Trash2 className="text-danger" />} {t('warranty.delete')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('warranty.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Listes « Garanties » et « Garanties / CA »
// ---------------------------------------------------------------------------------------------

export function WarrantyListsPanel({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState(startOfYear());
  const [to, setTo] = useState(today());
  const [cession, setCession] = useState<string>(ALL);
  const [tab, setTab] = useState<'lines' | 'ratio'>('lines');
  const types = useQuery({ queryKey: ['warranty-cession-types', companyId], queryFn: () => listWarrantyCessionTypes(companyId), staleTime: 300_000 });
  const linesQ = useQuery({ queryKey: ['warranty-lines', companyId, from, to, cession], queryFn: () => listWarrantyLines(companyId, from, to, cession === ALL ? null : cession), enabled: tab === 'lines' && !!from && !!to });
  const statsQ = useQuery({ queryKey: ['warranty-stats', companyId, from, to], queryFn: () => warrantyStatsByClient(companyId, from, to), enabled: tab === 'ratio' && !!from && !!to });
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const e = (linesQ.error ?? statsQ.error) as Error | null;
    setMissing(!!e && /does not exist|Could not find|schema cache/i.test(e.message));
  }, [linesQ.error, statsQ.error]);
  const lines = linesQ.data ?? [];
  const lt = warrantyLinesTotals(lines);
  const stats = statsQ.data ?? [];
  const st = warrantyStatsTotals(stats);
  const typeLabel = (code: string | null) => (code ? types.data?.find((x) => x.code === code)?.label ?? code : '—');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label={t('warranty.from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></FilterField>
        <FilterField label={t('warranty.to')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></FilterField>
        {tab === 'lines' && (
          <FilterField label={t('warranty.colType')}>
            <Select value={cession} onValueChange={setCession}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('warranty.allTypes')}</SelectItem>
                {(types.data ?? []).map((x) => <SelectItem key={x.code} value={x.code}>{x.code} — {x.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
        )}
        <Button variant="outline" size="sm" onClick={() => { linesQ.refetch(); statsQ.refetch(); }}><RefreshCw /> {t('warranty.refresh')}</Button>
      </div>
      {missing && <MigrationNote />}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'lines' | 'ratio')}>
        <TabsList>
          <TabsTrigger value="lines">{t('warranty.tabLines')}</TabsTrigger>
          <TabsTrigger value="ratio">{t('warranty.tabRatio')}</TabsTrigger>
        </TabsList>
        <TabsContent value="lines" className="mt-3">
          <TableShell head={[t('warranty.colDate'), t('workshop.colClient'), t('warranty.colVehicle'), t('warranty.colVin'), t('warranty.colKm'), t('warranty.colType'), t('warranty.colReference'), t('warranty.colDesignation'), t('warranty.colQtyShort'), t('warranty.colLabourHours'), t('warranty.colPartsCost'), t('warranty.colLabourCost'), t('warranty.colTotalCost')]} rightFrom={8}>
            {linesQ.isLoading && <LoadingRow span={13} />}
            {!linesQ.isLoading && lines.length === 0 && <EmptyRow span={13} label={t('warranty.emptyLines')} />}
            {lines.map((l) => (
              <tr key={l.line_id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 tabular-nums">{fmtDate(l.imputed_on)}</td>
                <td className="px-3 py-2">{l.client_name ?? '—'}{l.client_code && <div className="text-[12px] text-muted-foreground">{l.client_code}</div>}</td>
                <td className="px-3 py-2">{l.vehicle_label || '—'}<div className="text-[12px] text-muted-foreground">{l.or_number ?? ''}</div></td>
                <td className="px-3 py-2 font-data text-[12px] uppercase">{l.vin ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums">{l.mileage != null ? hours(l.mileage) : '—'}</td>
                <td className="px-3 py-2">{typeLabel(l.warranty_cession_code)}</td>
                <td className="px-3 py-2 font-data text-[12px]">{l.reference ?? '—'}</td>
                <td className="px-3 py-2">{l.designation}</td>
                <td className="px-3 py-2 text-right tabular-nums">{hours(l.quantity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{hours(l.labour_hours)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(l.parts_cost_ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(l.labour_cost_ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.parts_cost_ht) + Number(l.labour_cost_ht))}</td>
              </tr>
            ))}
            {lines.length > 0 && (
              <tr className="bg-muted font-bold">
                <td className="px-3 py-2" colSpan={9}>{fillVars(t('warranty.linesCount'), { n: lines.length })}</td>
                <td className="px-3 py-2 text-right tabular-nums">{hours(lt.hours)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(lt.partsHt)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(lt.labourHt)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(lt.totalHt)}</td>
              </tr>
            )}
          </TableShell>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('warranty.linesHint')}</p>
        </TabsContent>
        <TabsContent value="ratio" className="mt-3">
          <TableShell head={[t('workshop.colClient'), t('warranty.colRevenue'), t('warranty.colWarrantyPamp'), t('warranty.colWarrantyPa'), t('warranty.colWarrantySale'), t('warranty.colPct')]} rightFrom={1}>
            {statsQ.isLoading && <LoadingRow span={6} />}
            {!statsQ.isLoading && stats.length === 0 && <EmptyRow span={6} label={t('warranty.emptyLines')} />}
            {stats.map((s) => {
              const pct = warrantyRatePct(Number(s.warranty_pamp_ht), Number(s.revenue_ht));
              return (
                <tr key={s.contact_id ?? 'none'} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{s.client_name ?? '—'}{s.client_code && <div className="text-[12px] text-muted-foreground">{s.client_code}</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(s.revenue_ht)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(s.warranty_pamp_ht)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(s.warranty_pa_ht)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(s.warranty_sale_ht)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct == null ? '—' : `${String(pct).replace('.', ',')} %`}</td>
                </tr>
              );
            })}
            {stats.length > 0 && (
              <tr className="bg-muted font-bold">
                <td className="px-3 py-2">{t('warranty.total')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(st.revenueHt)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(st.pampHt)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(st.paHt)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(st.saleHt)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{st.pct == null ? '—' : `${String(st.pct).replace('.', ',')} %`}</td>
              </tr>
            )}
          </TableShell>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('warranty.ratioHint')}</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Petits composants
// ---------------------------------------------------------------------------------------------

function MigrationNote() {
  return <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('warranty.migrationMissing')}</p>;
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}

/** Tableau dense : colonnes `rightFrom`..`rightTo` alignees a droite (montants). */
function TableShell({ head, children, rightFrom = 99, rightTo = 99 }: { head: string[]; children: ReactNode; rightFrom?: number; rightTo?: number }) {
  const last = rightTo === 99 ? head.length - 1 : rightTo;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[13px]">
        <thead className="bg-muted">
          <tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${i >= rightFrom && i <= last ? 'text-right' : ''}`}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function LoadingRow({ span }: { span: number }) {
  return <tr><td colSpan={span} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>;
}

function EmptyRow({ span, label }: { span: number; label: string }) {
  return <tr><td colSpan={span} className="px-3 py-6 text-center text-muted-foreground">{label}</td></tr>;
}
