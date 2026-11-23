/**
 * M8 — Ecran « Contrat » d'un pret (contrat repris de G8, 19/11/2026, a-trancher T10).
 *
 * Pre-remplit tout ce que demande le contrat G8 depuis ce qui existe deja : fiche client (nom, ne le / a,
 * adresse, telephone, permis n° / delivre le / par), OR (n°, date, moto, « promis le »), moto du client,
 * moto de pret et sa fiche du parc (MEC, chassis, puissance), sortie / retour (date, heure, km,
 * carburant), franchise de la societe (Planning → Reglages, 500 EUR par defaut). L'utilisateur corrige
 * (conducteur different du client, n° de licence…) ; la saisie est gardee sur le pret quand la
 * migration 20261119180000 est appliquee. Impression : recto contrat, verso conditions generales,
 * dans la langue de la fiche client (modifiable), en double exemplaire par defaut.
 */
import { motoName } from '@/lib/moto-name';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { getContact, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { listContactCurrentVehicles } from '@/modules/vehicles/api';
import { t, tIn, fillVars, LOCALES, type Locale, ensureLocale } from '@/lib/i18n';
import type { PlanningSettings } from '../planning/api';
import { localYmd } from '../planning/rules';
import { Field } from '../planning/ui-bits';
import {
  getAppointmentVehicleId, getContractCompany, getContractVehicle, getLoanOr, saveLoanContract,
  type ContractCompany, type ContractVehicle, type Loan, type LoanerVehicle, type LoanOr,
} from './api';
import {
  CV_UNIT, contractDate, contractLeg, contractLocale, contractTime, customerMoto, driverPrefill, formatEuro,
  loanTermsFor, loanerMoto, oneLineAddress, parseDeductible, resolveDeductible, type DriverFields,
} from './contract-rules';
import { openPrintWindow, printLoanContract } from './contract-print';

const NONE = '__none__';
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${localYmd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Props = {
  companyId: string; companyName: string; settings: PlanningSettings; loan: Loan; loaner: LoanerVehicle | null;
  canSave: boolean; onClose: () => void; onSaved: () => void;
};

export function ContractDialog(p: Props) {
  const { loan, loaner } = p;
  const contact = useQuery({ queryKey: ['loan-contract-contact', loan.contact_id], queryFn: () => (loan.contact_id ? getContact(loan.contact_id) : null) });
  const or = useQuery({ queryKey: ['loan-contract-or', loan.or_id], queryFn: () => (loan.or_id ? getLoanOr(loan.or_id) : null) });
  const apptVehicle = useQuery({
    queryKey: ['loan-contract-appt', loan.appointment_id],
    queryFn: () => (loan.appointment_id ? getAppointmentVehicleId(loan.appointment_id) : null),
  });
  const fleetVehicle = useQuery({ queryKey: ['loan-contract-veh', loaner?.vehicle_id], queryFn: () => (loaner?.vehicle_id ? getContractVehicle(loaner.vehicle_id) : null) });
  const company = useQuery({ queryKey: ['loan-contract-company', p.companyId], queryFn: () => getContractCompany(p.companyId) });
  const owned = useQuery({ queryKey: ['loan-contract-owned', loan.contact_id], queryFn: () => (loan.contact_id ? listContactCurrentVehicles(loan.contact_id) : []) });
  const loading = [contact, or, apptVehicle, fleetVehicle, company, owned].some((q) => q.isLoading);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) p.onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-[760px] overflow-y-auto">
        <DialogHeader><DialogTitle>{fillVars(t('loans.contractTitle'), { number: loan.number ?? '' })}</DialogTitle></DialogHeader>
        {loading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : (
          <ContractForm {...p} contact={contact.data ?? null} or={or.data ?? null} apptVehicleId={apptVehicle.data ?? null}
            fleetVehicle={fleetVehicle.data ?? null} company={company.data ?? null} owned={owned.data ?? []} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContractForm(p: Props & {
  contact: Contact | null; or: LoanOr | null; apptVehicleId: string | null; fleetVehicle: ContractVehicle | null;
  company: ContractCompany | null; owned: { id: string; brand: string | null; model: string | null; plate: string | null }[];
}) {
  const { loan, loaner, contact: c } = p;
  // Champs de la fiche client arrives par des migrations recentes : lus sans dependre de types.ts.
  const cx = (c ?? {}) as Record<string, unknown>;
  const [driver, setDriver] = useState<DriverFields>(() => driverPrefill(loan, c ? {
    name: contactDisplayName(c), birth_date: str(cx.birth_date), birth_place: str(cx.birth_place),
    address: str(cx.address), street_number: str(cx.street_number), zip: str(cx.zip), city: str(cx.city),
    mobile: str(cx.mobile), gsm: str(cx.gsm), phone: str(cx.phone),
    license_number: str(cx.license_number), license_date: str(cx.license_date),
    license_issued_by: str(cx.license_issued_by), license_place: str(cx.license_place),
  } : null));
  const [customerVehicleId, setCustomerVehicleId] = useState(loan.customer_vehicle_id ?? p.or?.vehicle_id ?? p.apptVehicleId ?? '');
  const [delivery, setDelivery] = useState(toLocalInput(loan.delivery_planned_at ?? p.or?.promised_at));
  const [deductible, setDeductible] = useState(String(resolveDeductible(loan.deductible_amount, p.settings.loan_deductible)).replace('.', ','));
  const [place, setPlace] = useState(loan.contract_place ?? p.company?.city ?? '');
  const [locale, setLocale] = useState<Locale>(contractLocale(cx.locale));
  const [twoCopies, setTwoCopies] = useState(true);

  const vehicleChoices = [...p.owned];
  const customerVehicle = useQuery({ queryKey: ['loan-contract-veh', customerVehicleId], queryFn: () => (customerVehicleId ? getContractVehicle(customerVehicleId) : null) });
  if (customerVehicle.data && !vehicleChoices.some((v) => v.id === customerVehicle.data!.id)) vehicleChoices.unshift(customerVehicle.data);

  const go = useMutation({
    mutationFn: async ({ save, win }: { save: boolean; win: Window }) => {
      const amount = parseDeductible(deductible);
      if (amount === null) throw new Error(t('loans.err_deductible'));
      const deliveryIso = delivery ? new Date(delivery).toISOString() : null;
      if (save) {
        await saveLoanContract(loan.id, {
          ...driver, customer_vehicle_id: customerVehicleId || null, delivery_planned_at: deliveryIso,
          deductible_amount: amount, contract_place: place.trim() || null,
        });
      }
      await ensureLocale(locale); // dictionnaire de la langue du contrat (charge a la demande, lot perf 2)
      const fuel = (f: string | null | undefined) => (f ? tIn(locale, `loans.fuel_${f}`) : '');
      const co = p.company;
      printLoanContract({
        locale,
        company: { name: co?.legal_name || co?.name || p.companyName, address: oneLineAddress(co), logoUrl: co?.logo_url ?? null },
        number: loan.number ?? '',
        date: contractDate(loan.out_at ?? new Date().toISOString()),
        driver,
        customerVehicle: customerMoto(customerVehicle.data, CV_UNIT[locale]),
        orNumber: p.or?.number ?? '',
        orDate: contractDate(p.or?.created_at),
        deliveryDate: contractDate(deliveryIso),
        deliveryTime: contractTime(deliveryIso),
        loaner: loanerMoto(loaner, p.fleetVehicle, CV_UNIT[locale]),
        out: contractLeg(loan.out_at, loan.out_km, fuel(loan.out_fuel)),
        back: contractLeg(loan.returned_at, loan.return_km, fuel(loan.return_fuel)),
        deductible: formatEuro(amount),
        place: place.trim(),
        terms: loanTermsFor(locale, p.settings),
        copies: twoCopies ? 2 : 1,
      }, win);
    },
    onSuccess: (_r, v) => { if (v.save) { toast.success(t('feedback.saved')); p.onSaved(); } },
    onError: (e, v) => { v.win.close(); toast.error(e instanceof Error ? e.message : t('feedback.error')); },
  });

  const run = (save: boolean) => {
    const win = openPrintWindow();
    if (!win) { toast.error(t('loans.popupBlocked')); return; }
    go.mutate({ save, win });
  };

  const txt = (k: keyof DriverFields, label: string, type: 'text' | 'date' = 'text', className = '') => (
    <Field label={label} className={className}>
      <Input type={type} value={driver[k] ?? ''} onChange={(e) => setDriver({ ...driver, [k]: e.target.value || null })} />
    </Field>
  );

  return (
    <>
      <p className="text-[12px] text-muted-foreground">{t('loans.contractHint')}</p>
      {!p.canSave && <p className="rounded-[var(--radius-card)] border border-warning bg-warning-bg px-3 py-2 text-[12px] text-warning">{t('loans.contractPending')}</p>}

      <h3 className="mt-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('loans.driverSection')}</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {txt('driver_name', t('loans.driverName'), 'text', 'col-span-2')}
        {txt('driver_phone', t('loans.driverPhone'))}
        {txt('driver_birth_date', t('loans.birthDate'), 'date')}
        {txt('driver_birth_place', t('loans.birthPlace'), 'text', 'col-span-1 md:col-span-2')}
        {txt('driver_address', t('loans.driverAddress'), 'text', 'col-span-2 md:col-span-3')}
        {txt('driver_license_number', t('loans.licenseNumber'))}
        {txt('driver_license_date', t('loans.licenseDate'), 'date')}
        {txt('driver_license_issued_by', t('loans.licenseIssuedBy'))}
        {txt('driver_licence_number', t('loans.licenceNumber'))}
      </div>

      <h3 className="mt-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('loans.customerVehicleSection')}</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label={t('loans.customerVehicle')} className="col-span-2">
          <Select value={customerVehicleId || NONE} onValueChange={(v) => setCustomerVehicleId(v === NONE ? '' : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('loans.noCustomerVehicle')}</SelectItem>
              {vehicleChoices.map((v) => <SelectItem key={v.id} value={v.id}>{[motoName(v), v.plate].filter(Boolean).join(' · ') || v.id}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('loans.or')}><Input value={p.or ? `${p.or.number ?? ''} · ${contractDate(p.or.created_at)}` : ''} readOnly className="font-mono" /></Field>
        <Field label={t('loans.deliveryPlanned')}><Input type="datetime-local" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></Field>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={t('loans.deductible')}><Input value={deductible} onChange={(e) => setDeductible(e.target.value)} inputMode="decimal" className="text-right tabular-nums" /></Field>
        <Field label={t('loans.contractPlace')}><Input value={place} onChange={(e) => setPlace(e.target.value)} /></Field>
        <Field label={t('loans.contractLanguage')}>
          <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{LOCALES.map((l) => <SelectItem key={l} value={l}>{t(`locale.${l}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={twoCopies} onChange={(e) => setTwoCopies(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('loans.twoCopies')}
        </label>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={p.onClose}>{t('action.cancel')}</Button>
        {p.canSave ? (
          <Button onClick={() => run(true)} disabled={go.isPending}><Printer /> {t('loans.saveAndPrint')}</Button>
        ) : (
          <Button onClick={() => run(false)} disabled={go.isPending}><Printer /> {t('loans.contractButton')}</Button>
        )}
      </DialogFooter>
    </>
  );
}
