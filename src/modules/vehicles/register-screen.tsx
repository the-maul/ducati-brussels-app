/**
 * M3 — Vehicules → Registre des vehicules a moteur (AR n° 1 art. 28, circulaire 2018/C/47), VEH010.
 * Liste par annee / mois, filtres (en cours, a facturer, en retard, closes), export CSV / PDF conforme,
 * inscription d'une sortie, ligne manuelle et rectification (administrateur), reprise d'historique.
 * Le registre est append-only : rien ne s'efface, une erreur se rectifie (B7).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, FileDown, FileText, Plus, LogOut, PenLine, History, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import { listRef } from '@/modules/settings/reference-api';
import { findVehiclesByVin } from './api';
import { buildRegisterCsv } from './register';
import {
  addManualLine, downloadText, listRegister, listRegisterYears, rectifyRegisterLine, registerSchemaReady, runBackfill, setExit,
  type RegisterFilter, type RegisterRow,
} from './register-api';
import { buildRegisterPdf } from './register-pdf';

const FILTERS: RegisterFilter[] = ['all', 'open', 'to_invoice', 'overdue', 'closed'];
const STATE_TONE: Record<RegisterRow['state'], StatusTone> = {
  en_cours: 'info', a_facturer: 'warning', en_retard: 'danger', close: 'success', rectifiee: 'neutral', annulee: 'neutral',
};
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const today = () => new Date().toISOString().slice(0, 10);

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export function RegisterScreen({ companyId }: { companyId: string }) {
  const { rolesForActiveCompany } = useAuth();
  const admin = rolesForActiveCompany.includes('admin');
  const queryClient = useQueryClient();
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(nowYear);
  const [month, setMonth] = useState<number | 'all'>('all');
  const [filter, setFilter] = useState<RegisterFilter>('all');
  const [manualOpen, setManualOpen] = useState(false);
  const [exitRow, setExitRow] = useState<RegisterRow | null>(null);
  const [rectifyRow, setRectifyRow] = useState<RegisterRow | null>(null);
  const [backfillOpen, setBackfillOpen] = useState(false);

  const readyQ = useQuery({ queryKey: ['vehicle-register-ready'], queryFn: registerSchemaReady, staleTime: 300_000 });
  const ready = readyQ.data !== false;
  const yearsQ = useQuery({ queryKey: ['vehicle-register-years', companyId], queryFn: () => listRegisterYears(companyId), enabled: ready });
  const years = useMemo(() => {
    const set = new Set<number>([nowYear, ...(yearsQ.data ?? [])]);
    return [...set].sort((a, b) => b - a);
  }, [yearsQ.data, nowYear]);
  const rowsKey = ['vehicle-register', companyId, year, month, filter];
  const rowsQ = useQuery({
    queryKey: rowsKey,
    queryFn: () => listRegister(companyId, year, month === 'all' ? null : month, filter),
    enabled: ready,
  });
  const naturesQ = useQuery({
    queryKey: ['ref', companyId, 'vehicle_register_nature'],
    queryFn: () => listRef(companyId, 'vehicle_register_nature'),
    enabled: ready,
    staleTime: 300_000,
  });
  const natures = (naturesQ.data ?? []).filter((n) => n.is_active);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['vehicle-register'] });
    queryClient.invalidateQueries({ queryKey: ['vehicle-register-years', companyId] });
    queryClient.invalidateQueries({ queryKey: ['vehicle-register-pending', companyId] });
  };

  const rows = rowsQ.data ?? [];
  const periodLabel = month === 'all' ? fillVars(t('vehicleRegister.periodYear'), { year }) : `${t(`vehicleRegister.month_${month}`)} ${year}`;

  const exportCsv = () => {
    const csv = buildRegisterCsv(rows);
    downloadText(`REGISTRE_VEHICULES_${year}${month === 'all' ? '' : `-${String(month).padStart(2, '0')}`}.csv`, csv, 'text/csv;charset=utf-8;');
  };

  const exportPdf = useMutation({
    mutationFn: async () => {
      const { data: c } = await supabase.from('companies').select('name, legal_name, vat_number, address, zip, city').eq('id', companyId).maybeSingle();
      const establishment = rows[0]?.establishment
        ?? [c?.address, [c?.zip, c?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const stateLabels: Record<string, string> = {};
      for (const s of ['en_cours', 'a_facturer', 'en_retard', 'close', 'rectifiee', 'annulee']) stateLabels[s] = t(`vehicleRegister.state_${s}`);
      const blob = await buildRegisterPdf(rows, {
        companyName: (c?.legal_name || c?.name) ?? '',
        establishment: establishment || (c?.name ?? ''),
        vatNumber: c?.vat_number ?? null,
        periodLabel,
        printedAt: today(),
        labels: {
          title: t('vehicleRegister.title'), subtitle: t('vehicleRegister.pdfSubtitle'), establishment: t('vehicleRegister.pdfEstablishment'),
          vat: t('vehicleRegister.vatUe'), period: t('vehicleRegister.pdfPeriod'), printed: t('vehicleRegister.pdfPrinted'), page: t('vehicleRegister.pdfPage'),
          colNumber: t('vehicleRegister.colNumber'), colEntered: t('vehicleRegister.colEntered'), colPlate: t('vehicleRegister.colPlate'),
          colVin: t('vehicleRegister.colVin'), colPrincipal: t('vehicleRegister.colPrincipal'), colNature: t('vehicleRegister.colNature'),
          colLeft: t('vehicleRegister.colLeft'), colInvoice: t('vehicleRegister.colInvoice'), colNote: t('vehicleRegister.colNote'),
          rectifiedBy: t('vehicleRegister.pdfRectifiedBy'), rectifies: t('vehicleRegister.pdfRectifies'), voided: t('vehicleRegister.pdfVoided'),
          backfill: t('vehicleRegister.pdfBackfill'), stateLabels,
        },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `REGISTRE_VEHICULES_${year}${month === 'all' ? '' : `-${String(month).padStart(2, '0')}`}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (readyQ.data === false) {
    return (
      <div className="rounded-md border border-border bg-warning-bg px-3 py-2 text-[13px] text-warning">
        <AlertTriangle className="mr-1 inline size-4" /> {t('vehicleRegister.notReady')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted-foreground">{t('vehicleRegister.legal')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28" aria-label={t('vehicleRegister.year')}><SelectValue /></SelectTrigger>
          <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(month)} onValueChange={(v) => setMonth(v === 'all' ? 'all' : Number(v))}>
          <SelectTrigger className="w-40" aria-label={t('vehicleRegister.month')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('vehicleRegister.allMonths')}</SelectItem>
            {MONTHS.map((m) => <SelectItem key={m} value={String(m)}>{t(`vehicleRegister.month_${m}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-[13px] text-muted-foreground tabular-nums">{rows.length}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}><FileDown /> {t('vehicleRegister.exportCsv')}</Button>
          <Button variant="outline" onClick={() => exportPdf.mutate()} disabled={rows.length === 0 || exportPdf.isPending}>
            {exportPdf.isPending ? <Loader2 className="animate-spin" /> : <FileText />} {t('vehicleRegister.exportPdf')}
          </Button>
          {admin && (
            <>
              <Button variant="outline" onClick={() => setBackfillOpen(true)}><History /> {t('vehicleRegister.backfill')}</Button>
              <Button onClick={() => setManualOpen(true)}><Plus /> {t('vehicleRegister.addManual')}</Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as RegisterFilter)}>
        <TabsList>
          {FILTERS.map((f) => <TabsTrigger key={f} value={f}>{t(`vehicleRegister.filter_${f}`)}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {rowsQ.error && (
        <div className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          <p>{t('vehicleRegister.errLoad')}</p>
          <p className="mt-1 font-mono text-[11px] opacity-80">{(rowsQ.error as Error).message}</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              {(['colNumber', 'colEntered', 'colVehicle', 'colPlate', 'colVin', 'colPrincipal', 'colNature', 'colLeft', 'colInvoice', 'colDue', 'colState'] as const).map((k) => (
                <th key={k} className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`vehicleRegister.${k}`)}</th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rowsQ.isLoading && (
              <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>
            )}
            {!rowsQ.isLoading && rows.length === 0 && (
              <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">{t('vehicleRegister.empty')}</td></tr>
            )}
            {rows.map((r) => {
              const struck = !!r.rectified_by_id || r.is_void;
              const numberOf = (id: string | null) => rows.find((x) => x.id === id)?.number ?? '';
              return (
                <tr key={r.id} className={`border-b border-border last:border-0 ${struck ? 'text-muted-foreground line-through' : ''}`}>
                  <td className="px-3 py-2 font-mono">{r.number}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{fmtDate(r.entered_at)}</td>
                  <td className="px-3 py-2">
                    {r.vehicle_label || '—'}
                    <span className="block text-[11px] text-muted-foreground no-underline">
                      {t(`vehicleRegister.source_${r.source}`)}{r.is_backfill ? ` · ${t('vehicleRegister.backfillTag')}` : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.plate ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.vin ?? '—'}</td>
                  <td className="px-3 py-2">
                    {r.contact_name || '—'}
                    {r.principal_vat && <span className="block text-[11px] text-muted-foreground">{t('vehicleRegister.vatUe')} {r.principal_vat}</span>}
                  </td>
                  <td className="px-3 py-2"><span className="font-mono">{r.nature_code}</span> <span className="text-[12px]">{r.nature_label}</span></td>
                  <td className="px-3 py-2 font-mono text-[12px]">{fmtDate(r.left_at)}</td>
                  <td className="px-3 py-2">
                    {r.invoice_ref ? <span className="font-mono">{r.invoice_ref}</span> : r.no_document_reason ? <span className="text-[12px]">{r.no_document_reason}</span> : '—'}
                  </td>
                  <td className={`px-3 py-2 font-mono text-[12px] ${r.state === 'en_retard' ? 'font-bold text-danger' : ''}`}>
                    {r.left_at && !r.invoice_ref && !r.no_document_reason ? fmtDate(r.invoice_due_by) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <StatusBadge tone={STATE_TONE[r.state]} label={t(`vehicleRegister.state_${r.state}`)} />
                      {r.rectified_by_id && <span className="text-[11px] text-muted-foreground">{fillVars(t('vehicleRegister.rectifiedBy'), { number: numberOf(r.rectified_by_id) })}</span>}
                      {r.rectifies_id && <span className="text-[11px] text-muted-foreground">{fillVars(t('vehicleRegister.rectifies'), { number: numberOf(r.rectifies_id) })}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!struck && (
                      <span className="inline-flex gap-1">
                        {(r.state === 'en_cours' || r.state === 'a_facturer' || r.state === 'en_retard') && (
                          <Button size="sm" variant="outline" onClick={() => setExitRow(r)} title={t('vehicleRegister.exit')}><LogOut /> {t('vehicleRegister.exit')}</Button>
                        )}
                        {admin && (
                          <Button size="sm" variant="ghost" onClick={() => setRectifyRow(r)} title={t('vehicleRegister.rectify')}><PenLine /></Button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {manualOpen && (
        <ManualDialog companyId={companyId} natures={natures.map((n) => ({ code: n.code, label: n.label }))} onClose={() => setManualOpen(false)} onDone={() => { setManualOpen(false); refresh(); }} />
      )}
      {exitRow && <ExitDialog row={exitRow} onClose={() => setExitRow(null)} onDone={() => { setExitRow(null); refresh(); }} />}
      {rectifyRow && (
        <RectifyDialog row={rectifyRow} natures={natures.map((n) => ({ code: n.code, label: n.label }))} onClose={() => setRectifyRow(null)} onDone={() => { setRectifyRow(null); refresh(); }} />
      )}
      {backfillOpen && <BackfillDialog companyId={companyId} onClose={() => setBackfillOpen(false)} onDone={() => { setBackfillOpen(false); refresh(); }} />}
    </div>
  );
}

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</Label>
);

function NatureSelect({ value, onChange, natures, allowEmpty }: { value: string; onChange: (v: string) => void; natures: { code: string; label: string }[]; allowEmpty?: boolean }) {
  return (
    <Select value={value || (allowEmpty ? '__keep' : '')} onValueChange={(v) => onChange(v === '__keep' ? '' : v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value="__keep">{t('vehicleRegister.keep')}</SelectItem>}
        {natures.map((n) => <SelectItem key={n.code} value={n.code}>{n.code} — {n.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ManualDialog({ companyId, natures, onClose, onDone }: { companyId: string; natures: { code: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const [enteredAt, setEnteredAt] = useState(today());
  const [vin, setVin] = useState('');
  const [plate, setPlate] = useState('');
  const [nature, setNature] = useState(natures[0]?.code ?? '1');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      let vehicleId: string | null = null;
      if (vin.trim().length >= 17) {
        const found = await findVehiclesByVin(companyId, vin.trim());
        vehicleId = found[0]?.id ?? null;
      }
      await addManualLine({ companyId, enteredAt, vehicleId, vin: vin.trim() || null, plate: plate.trim() || null, nature, note: note.trim() || null });
    },
    onSuccess: () => { toast.success(t('vehicleRegister.saved')); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('vehicleRegister.addManualTitle')}</DialogTitle></DialogHeader>
        <p className="text-[13px] text-muted-foreground">{t('vehicleRegister.vehicleHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.enteredAt')}</FieldLabel><Input type="date" value={enteredAt} onChange={(e) => setEnteredAt(e.target.value)} /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.nature')}</FieldLabel><NatureSelect value={nature} onChange={setNature} natures={natures} /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.plate')}</FieldLabel><Input value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.vin')}</FieldLabel><Input value={vin} onChange={(e) => setVin(e.target.value)} maxLength={17} className="font-mono" /></div>
          <div className="space-y-1.5 sm:col-span-2"><FieldLabel>{t('vehicleRegister.note')}</FieldLabel><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} /></div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button type="button" disabled={m.isPending || !enteredAt || (!vin.trim() && !plate.trim())} onClick={() => m.mutate()}>
            {m.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('vehicleRegister.addManual')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExitDialog({ row, onClose, onDone }: { row: RegisterRow; onClose: () => void; onDone: () => void }) {
  const [leftAt, setLeftAt] = useState(row.left_at ?? today());
  const [invoiceRef, setInvoiceRef] = useState(row.invoice_ref ?? '');
  const [reason, setReason] = useState(row.no_document_reason ?? '');
  const m = useMutation({
    mutationFn: () => setExit({ lineId: row.id, leftAt, invoiceRef: invoiceRef.trim() || null, reason: reason.trim() || null }),
    onSuccess: () => { toast.success(t('vehicleRegister.saved')); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('vehicleRegister.exitTitle')} — {row.number}</DialogTitle></DialogHeader>
        <p className="text-[13px] text-muted-foreground">{t('vehicleRegister.exitHint')}</p>
        <div className="grid gap-3">
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.leftAt')}</FieldLabel><Input type="date" value={leftAt} min={row.entered_at} disabled={!!row.left_at} onChange={(e) => setLeftAt(e.target.value)} /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.invoiceRef')}</FieldLabel><Input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} maxLength={60} className="font-mono" /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.reason')}</FieldLabel><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} /></div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button type="button" disabled={m.isPending || !leftAt || (!invoiceRef.trim() && !reason.trim())} onClick={() => m.mutate()}>
            {m.isPending ? <Loader2 className="animate-spin" /> : <LogOut />} {t('vehicleRegister.exit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RectifyDialog({ row, natures, onClose, onDone }: { row: RegisterRow; natures: { code: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const [enteredAt, setEnteredAt] = useState(row.entered_at);
  const [vin, setVin] = useState(row.vin ?? '');
  const [plate, setPlate] = useState(row.plate ?? '');
  const [nature, setNature] = useState('');
  const [leftAt, setLeftAt] = useState(row.left_at ?? '');
  const [invoiceRef, setInvoiceRef] = useState(row.invoice_ref ?? '');
  const [reason, setReason] = useState(row.no_document_reason ?? '');
  const [note, setNote] = useState('');
  const [isVoid, setIsVoid] = useState(false);
  const m = useMutation({
    mutationFn: () => rectifyRegisterLine({
      lineId: row.id,
      enteredAt: enteredAt !== row.entered_at ? enteredAt : null,
      vin: vin.trim() !== (row.vin ?? '') ? vin.trim() : null,
      plate: plate.trim() !== (row.plate ?? '') ? plate.trim() : null,
      nature: nature || null,
      leftAt: leftAt && leftAt !== row.left_at ? leftAt : null,
      invoiceRef: invoiceRef.trim() !== (row.invoice_ref ?? '') ? invoiceRef.trim() : null,
      reason: reason.trim() !== (row.no_document_reason ?? '') ? reason.trim() : null,
      note: note.trim() || null,
      isVoid,
    }),
    onSuccess: () => { toast.success(t('vehicleRegister.saved')); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{fillVars(t('vehicleRegister.rectifyTitle'), { number: row.number })}</DialogTitle></DialogHeader>
        <p className="text-[13px] text-muted-foreground">{t('vehicleRegister.rectifyHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.enteredAt')}</FieldLabel><Input type="date" value={enteredAt} onChange={(e) => setEnteredAt(e.target.value)} /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.nature')}</FieldLabel><NatureSelect value={nature} onChange={setNature} natures={natures} allowEmpty /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.plate')}</FieldLabel><Input value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.vin')}</FieldLabel><Input value={vin} onChange={(e) => setVin(e.target.value)} maxLength={17} className="font-mono" /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.leftAt')}</FieldLabel><Input type="date" value={leftAt} onChange={(e) => setLeftAt(e.target.value)} /></div>
          <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.invoiceRef')}</FieldLabel><Input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} maxLength={60} className="font-mono" /></div>
          <div className="space-y-1.5 sm:col-span-2"><FieldLabel>{t('vehicleRegister.reason')}</FieldLabel><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
          <div className="space-y-1.5 sm:col-span-2"><FieldLabel>{t('vehicleRegister.rectifyNote')}</FieldLabel><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} /></div>
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
            <Checkbox checked={isVoid} onCheckedChange={(v) => setIsVoid(v === true)} /> {t('vehicleRegister.rectifyVoid')}
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button type="button" disabled={m.isPending || !enteredAt || (!vin.trim() && !plate.trim())} onClick={() => m.mutate()}>
            {m.isPending ? <Loader2 className="animate-spin" /> : <PenLine />} {t('vehicleRegister.rectify')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BackfillDialog({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const m = useMutation({
    mutationFn: () => runBackfill(companyId, from),
    onSuccess: (r) => { toast.success(fillVars(t('vehicleRegister.backfillDone'), { inserted: r.inserted, skipped: r.skipped })); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('vehicleRegister.backfillTitle')}</DialogTitle></DialogHeader>
        <p className="text-[13px] text-muted-foreground">{t('vehicleRegister.backfillHint')}</p>
        <div className="space-y-1.5"><FieldLabel>{t('vehicleRegister.backfillFrom')}</FieldLabel><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button type="button" disabled={m.isPending || !from} onClick={() => m.mutate()}>
            {m.isPending ? <Loader2 className="animate-spin" /> : <History />} {t('vehicleRegister.backfill')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
