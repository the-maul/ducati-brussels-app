/**
 * M8 — Motos de pret (G8 « Vehicules de pret », 07-atelier.md §6 et §14) dans le planning :
 *   - Disponibilite : 14 jours × motos de la flotte (libre / reservee / sortie) ;
 *   - Prets : reservation (moto, client, periode, RDV / OR lies), sortie (date, km, carburant),
 *     retour (date, km, carburant), contrat imprimable avec conditions generales, annulation ;
 *   - Flotte : modele, marque, immatriculation, chassis, couleur, 1re mise en circulation, km.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightFromLine, ArrowLeftToLine, Loader2, Pencil, Plus, Printer, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getContact, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { t } from '@/lib/i18n';
import {
  listLoanerVehicles, saveLoanerVehicle, listLoans, createLoan, loanOut, loanReturn, cancelLoan,
  type LoanerVehicle, type Loan,
} from './api';
import {
  FUEL_LEVELS, LOAN_TONE, checkOut, checkPeriod, checkReturn, isOverdue, loanDistance, loanerDayState,
  type FuelLevel,
} from './rules';
import { printLoanContract } from './contract-print';
import { addDays, localYmd, parseMileage, startOfDay } from '../planning/rules';
import { ContactPicker, Field, Picked, contactLabel, fmtDate, fmtDateTime } from '../planning/ui-bits';

const NONE = '__none__';
const toLocalInput = (d: Date) => `${localYmd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function LoansView({ companyId, companyName, loanTerms }: { companyId: string; companyName: string; loanTerms: string | null }) {
  const qc = useQueryClient();
  const today = startOfDay(new Date());
  const from = addDays(today, -30); const to = addDays(today, 90);
  const fleet = useQuery({ queryKey: ['loaners', companyId], queryFn: () => listLoanerVehicles(companyId) });
  const loans = useQuery({ queryKey: ['loans', companyId, localYmd(today)], queryFn: () => listLoans(companyId, from.toISOString(), to.toISOString()) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['loaners', companyId] }); void qc.invalidateQueries({ queryKey: ['loans', companyId] }); };
  const [editVehicle, setEditVehicle] = useState<LoanerVehicle | 'new' | null>(null);
  const [newLoan, setNewLoan] = useState<{ loanerId?: string; day?: Date } | null>(null);
  const [outFor, setOutFor] = useState<Loan | null>(null);
  const [backFor, setBackFor] = useState<Loan | null>(null);

  const active = (fleet.data ?? []).filter((v) => v.is_active);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const rows = (loans.data ?? []).filter((l) => l.status !== 'annule' && (l.status !== 'rendu' || new Date(l.returned_at ?? l.planned_end) >= addDays(today, -30)));
  const vehicleOf = (id: string) => (fleet.data ?? []).find((v) => v.id === id);

  const cancel = useMutation({ mutationFn: (id: string) => cancelLoan(id), onSuccess: () => { toast.success(t('feedback.saved')); refresh(); }, onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')) });

  const print = async (l: Loan) => {
    const v = vehicleOf(l.loaner_id);
    const c: Contact | null = l.contact_id ? await getContact(l.contact_id) : null;
    const fuel = (f: FuelLevel | null) => (f ? t(`loans.fuel_${f}`) : '');
    try {
      printLoanContract({
        companyName, number: l.number ?? '', issuedAt: new Date().toLocaleDateString('fr-BE'),
        borrower: {
          name: c ? contactDisplayName(c) : '', address: c ? [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '',
          phone: c ? c.mobile || c.phone || '' : '', email: c?.email ?? '',
          license: c ? [c.license_number, c.license_category].filter(Boolean).join(' · ') : '',
        },
        moto: { label: v?.label ?? '', brand: v?.brand ?? '', plate: v?.plate ?? '', vin: v?.vin ?? '', color: v?.color ?? '' },
        plannedStart: fmtDateTime(l.planned_start), plannedEnd: fmtDateTime(l.planned_end),
        out: l.out_at ? { at: fmtDateTime(l.out_at), km: String(l.out_km ?? ''), fuel: fuel(l.out_fuel) } : null,
        back: l.returned_at ? { at: fmtDateTime(l.returned_at), km: String(l.return_km ?? ''), fuel: fuel(l.return_fuel) } : null,
        orNumber: l.repair_orders?.number ?? null, terms: loanTerms ?? '',
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('feedback.error'));
    }
  };

  const stateClass = (s: 'libre' | 'reserve' | 'sorti') => (s === 'sorti' ? 'bg-warning-bg text-warning' : s === 'reserve' ? 'bg-info-bg text-info' : 'bg-success-bg text-success');

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-bold">{t('loans.availability')}</h2>
          <Button size="sm" onClick={() => setNewLoan({})} disabled={!active.length}><Plus /> {t('loans.newLoan')}</Button>
        </div>
        {active.length === 0 ? <p className="text-sm text-muted-foreground">{t('loans.noFleet')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-data text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-card px-2 py-1 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('loans.moto')}</th>
                  {days.map((d) => <th key={localYmd(d)} className="px-1 py-1 text-center text-[11px] font-bold uppercase text-muted-foreground">{fmtDate(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {active.map((v) => (
                  <tr key={v.id} className="border-t border-border">
                    <td className="sticky left-0 whitespace-nowrap bg-card px-2 py-1 font-medium">{v.label}{v.plate ? ` · ${v.plate}` : ''}</td>
                    {days.map((d) => {
                      const st = loanerDayState(loans.data ?? [], v.id, d);
                      return (
                        <td key={localYmd(d)} className="p-0.5">
                          <button type="button" onClick={() => (st.state === 'libre' ? setNewLoan({ loanerId: v.id, day: d }) : undefined)}
                            title={st.loan ? `${st.loan.number ?? ''} ${contactLabel(st.loan.contacts)}` : t('loans.state_libre')}
                            className={`w-full rounded-[var(--radius-badge)] px-1 py-1 text-[11px] font-bold uppercase ${stateClass(st.state)}`}>
                            {t(`loans.stateShort_${st.state}`)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-[17px] font-bold">{t('loans.loansTitle')}</h2>
        {loans.isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('loans.number')}</TableHead><TableHead>{t('loans.status')}</TableHead><TableHead>{t('loans.moto')}</TableHead>
                <TableHead>{t('loans.client')}</TableHead><TableHead>{t('loans.period')}</TableHead><TableHead className="text-right">{t('loans.outKm')}</TableHead>
                <TableHead className="text-right">{t('loans.returnKm')}</TableHead><TableHead>{t('loans.or')}</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => {
                const v = vehicleOf(l.loaner_id);
                const late = isOverdue(l);
                return (
                  <TableRow key={l.id} className="font-data text-[13px]">
                    <TableCell className="font-mono">{l.number}</TableCell>
                    <TableCell className="space-x-1">
                      <StatusBadge tone={LOAN_TONE[l.status]} label={t(`loans.state_${l.status}`)} />
                      {late && <StatusBadge tone="danger" label={t('loans.overdue')} />}
                    </TableCell>
                    <TableCell>{v ? `${v.label}${v.plate ? ` · ${v.plate}` : ''}` : '—'}</TableCell>
                    <TableCell>{contactLabel(l.contacts) || '—'}</TableCell>
                    <TableCell className="tabular-nums">{fmtDateTime(l.planned_start)} → {fmtDateTime(l.planned_end)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.out_km ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.return_km ?? '—'}{loanDistance(l) !== null ? ` (+${loanDistance(l)})` : ''}</TableCell>
                    <TableCell className="font-mono">{l.repair_orders?.number ?? ''}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {l.status === 'reserve' && <Button size="sm" variant="ghost" className="h-8" onClick={() => setOutFor(l)}><ArrowRightFromLine className="size-3.5" /> {t('loans.out')}</Button>}
                      {l.status === 'sorti' && <Button size="sm" variant="ghost" className="h-8" onClick={() => setBackFor(l)}><ArrowLeftToLine className="size-3.5" /> {t('loans.back')}</Button>}
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => void print(l)}><Printer className="size-3.5" /> {t('loans.contractButton')}</Button>
                      {l.status === 'reserve' && <Button size="sm" variant="ghost" className="h-8" onClick={() => cancel.mutate(l.id)} aria-label={t('loans.cancel')}><XCircle className="size-3.5" /></Button>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-sm text-muted-foreground">{t('loans.noLoans')}</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-bold">{t('loans.fleetTitle')}</h2>
          <Button size="sm" variant="outline" onClick={() => setEditVehicle('new')}><Plus /> {t('loans.addVehicle')}</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('loans.model')}</TableHead><TableHead>{t('loans.brand')}</TableHead><TableHead>{t('loans.plate')}</TableHead>
              <TableHead>{t('loans.vin')}</TableHead><TableHead>{t('loans.color')}</TableHead><TableHead>{t('loans.firstRegistration')}</TableHead>
              <TableHead className="text-right">{t('loans.km')}</TableHead><TableHead>{t('planningG8.active')}</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(fleet.data ?? []).map((v) => (
              <TableRow key={v.id} className="font-data text-[13px]">
                <TableCell className="font-medium">{v.label}</TableCell><TableCell>{v.brand ?? ''}</TableCell><TableCell>{v.plate ?? ''}</TableCell>
                <TableCell className="font-mono">{v.vin ?? ''}</TableCell><TableCell>{v.color ?? ''}</TableCell>
                <TableCell className="tabular-nums">{v.first_registration ? new Date(v.first_registration).toLocaleDateString('fr-BE') : ''}</TableCell>
                <TableCell className="text-right tabular-nums">{v.current_km ?? ''}</TableCell>
                <TableCell>{v.is_active ? t('loans.yes') : t('loans.no')}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="ghost" className="h-8" onClick={() => setEditVehicle(v)} aria-label={t('action.edit')}><Pencil className="size-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            {(fleet.data ?? []).length === 0 && <TableRow><TableCell colSpan={9} className="text-sm text-muted-foreground">{t('loans.noFleet')}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </section>

      {editVehicle && <VehicleDialog companyId={companyId} vehicle={editVehicle === 'new' ? null : editVehicle} onClose={() => setEditVehicle(null)} onSaved={() => { setEditVehicle(null); refresh(); }} />}
      {newLoan && <NewLoanDialog companyId={companyId} fleet={active} loans={loans.data ?? []} preset={newLoan} onClose={() => setNewLoan(null)} onSaved={() => { setNewLoan(null); refresh(); }} />}
      {outFor && <MoveDialog mode="out" loan={outFor} vehicle={vehicleOf(outFor.loaner_id) ?? null} onClose={() => setOutFor(null)} onSaved={() => { setOutFor(null); refresh(); }} />}
      {backFor && <MoveDialog mode="back" loan={backFor} vehicle={vehicleOf(backFor.loaner_id) ?? null} onClose={() => setBackFor(null)} onSaved={() => { setBackFor(null); refresh(); }} />}
    </div>
  );
}

function VehicleDialog({ companyId, vehicle, onClose, onSaved }: { companyId: string; vehicle: LoanerVehicle | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<LoanerVehicle>>(vehicle ?? { is_active: true, sort_order: 0 });
  const [km, setKm] = useState(vehicle?.current_km != null ? String(vehicle.current_km) : '');
  const save = useMutation({
    mutationFn: async () => {
      if (!(v.label ?? '').trim()) throw new Error(t('loans.err_label'));
      const k = parseMileage(km);
      if (Number.isNaN(k as number)) throw new Error(t('loans.err_out_km'));
      await saveLoanerVehicle({ ...v, company_id: companyId, label: (v.label ?? '').trim(), current_km: k });
    },
    onSuccess: () => { toast.success(t('feedback.saved')); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });
  const txt = (k: 'label' | 'brand' | 'plate' | 'vin' | 'color', label: string) => (
    <Field label={label}><Input value={(v[k] as string | null | undefined) ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value || null })} /></Field>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader><DialogTitle>{vehicle ? t('loans.editVehicle') : t('loans.addVehicle')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {txt('label', `${t('loans.model')} *`)}{txt('brand', t('loans.brand'))}{txt('plate', t('loans.plate'))}{txt('vin', t('loans.vin'))}{txt('color', t('loans.color'))}
          <Field label={t('loans.firstRegistration')}><Input type="date" value={v.first_registration ?? ''} onChange={(e) => setV({ ...v, first_registration: e.target.value || null })} /></Field>
          <Field label={t('loans.km')}><Input value={km} onChange={(e) => setKm(e.target.value)} inputMode="numeric" className="text-right tabular-nums" /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={v.is_active ?? true} onChange={(e) => setV({ ...v, is_active: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" /> {t('planningG8.active')}</label>
          <Field label={t('loans.notes')} className="col-span-2"><Textarea rows={2} value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value || null })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{t('action.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewLoanDialog({ companyId, fleet, loans, preset, onClose, onSaved }: {
  companyId: string; fleet: LoanerVehicle[]; loans: Loan[]; preset: { loanerId?: string; day?: Date }; onClose: () => void; onSaved: () => void;
}) {
  const d0 = preset.day ?? new Date();
  const [loanerId, setLoanerId] = useState(preset.loanerId ?? '');
  const [contact, setContact] = useState<Contact | null>(null);
  const [start, setStart] = useState(toLocalInput(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), 9, 0)));
  const [end, setEnd] = useState(toLocalInput(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), 18, 0)));
  const save = useMutation({
    mutationFn: async () => {
      if (!loanerId) throw new Error(t('loans.err_loaner'));
      const p = { loaner_id: loanerId, status: 'reserve', planned_start: new Date(start).toISOString(), planned_end: new Date(end).toISOString() };
      const err = checkPeriod(loans, p);
      if (err) throw new Error(t(`loans.err_${err}`));
      await createLoan({ companyId, loanerId, contactId: contact?.id ?? null, appointmentId: null, plannedStart: p.planned_start, plannedEnd: p.planned_end });
    },
    onSuccess: () => { toast.success(t('feedback.created')); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader><DialogTitle>{t('loans.newLoan')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('loans.moto')} className="col-span-2">
            <Select value={loanerId || NONE} onValueChange={(v) => setLoanerId(v === NONE ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {fleet.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}{v.plate ? ` · ${v.plate}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('loans.client')} className="col-span-2">{contact ? <Picked label={contactDisplayName(contact)} onClear={() => setContact(null)} /> : <ContactPicker companyId={companyId} onPick={setContact} />}</Field>
          <Field label={t('loans.from')}><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label={t('loans.to')}><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <p className="text-[12px] text-muted-foreground">{t('loans.fromRdvHint')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{t('action.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ mode, loan, vehicle, onClose, onSaved }: { mode: 'out' | 'back'; loan: Loan; vehicle: LoanerVehicle | null; onClose: () => void; onSaved: () => void }) {
  const [at, setAt] = useState(toLocalInput(new Date()));
  const defaultKm = mode === 'out' ? vehicle?.current_km : loan.out_km;
  const [km, setKm] = useState(defaultKm != null ? String(defaultKm) : '');
  const [fuel, setFuel] = useState<FuelLevel | ''>(mode === 'back' && loan.out_fuel ? loan.out_fuel : '');
  const [notes, setNotes] = useState('');
  const kmValue = useMemo(() => parseMileage(km), [km]);
  const save = useMutation({
    mutationFn: async () => {
      const iso = at ? new Date(at).toISOString() : null;
      const k = kmValue === null || Number.isNaN(kmValue) ? null : kmValue;
      if (mode === 'out') {
        const err = checkOut({ outAt: iso, outKm: k });
        if (err) throw new Error(t(`loans.err_${err}`));
        await loanOut(loan.id, { outAt: iso!, outKm: k!, outFuel: fuel || null, notes: notes || null });
      } else {
        const err = checkReturn({ outAt: loan.out_at, outKm: loan.out_km, returnedAt: iso, returnKm: k });
        if (err) throw new Error(t(`loans.err_${err}`));
        await loanReturn(loan.id, { returnedAt: iso!, returnKm: k!, returnFuel: fuel || null, notes: notes || null });
      }
    },
    onSuccess: () => { toast.success(t('feedback.saved')); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader><DialogTitle>{mode === 'out' ? t('loans.outTitle') : t('loans.backTitle')} — {loan.number}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label={mode === 'out' ? t('loans.outAt') : t('loans.returnedAt')}><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          <Field label={`${t('loans.km')} *`}><Input value={km} onChange={(e) => setKm(e.target.value)} inputMode="numeric" className="text-right tabular-nums" /></Field>
          <Field label={t('loans.fuel')}>
            <Select value={fuel || NONE} onValueChange={(v) => setFuel(v === NONE ? '' : (v as FuelLevel))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {FUEL_LEVELS.map((f) => <SelectItem key={f} value={f}>{t(`loans.fuel_${f}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {mode === 'back' && loan.out_km !== null && <p className="self-end pb-2 font-data text-[12px] tabular-nums text-muted-foreground">{t('loans.outKm')} : {loan.out_km}</p>}
          <Field label={t('loans.notes')} className="col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{t('action.validate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
