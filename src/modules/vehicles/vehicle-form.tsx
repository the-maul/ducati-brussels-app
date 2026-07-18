/**
 * M3 — Formulaire fiche véhicule (création + édition). Parité G8.
 * Sections : identification (carte grise), caractéristiques, infos compl., commercial.
 */
import { useState, type ReactNode } from 'react';
import { Loader2, Save, Wand2 } from 'lucide-react';
import { decodeDucatiVin } from '@/lib/ducati-vin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { VEHICLE_STATUSES, type Vehicle, type VehicleInsert, type VehicleStatus, type MileageQualif } from './api';
import { PurchaseInvoiceField } from './purchase-invoice-field';

type F = Record<string, string | boolean>;

const TEXT_FIELDS = [
  'vin','reference','brand','model','plate','engine_number',
  'origin','production_code','energy','antipollution',
  'color','category','gps_tracker_id','pin_tracker',
  'tpms_av','tpms_ar','antitheft_code','key_number','key_number2','police_book_number','warranty_type','exposition_code',
] as const;
const NUM_FIELDS = ['displacement','power_kw','power_cv','cylinders','mileage','model_year','purchase_price','cost_price','display_price'] as const;
const DATE_FIELDS = ['first_registration_date','next_inspection_date','warranty_end','entry_date','sold_date'] as const;

/** Jours en stock : de l'entrée en stock à la sortie (ou à aujourd'hui si encore en stock). */
function daysInStock(entry: string, sold: string): number | null {
  if (!entry) return null;
  const start = new Date(entry);
  if (Number.isNaN(start.getTime())) return null;
  const end = sold ? new Date(sold) : new Date();
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

// Listes à choix fixes. Valeurs identiques FR/NL (gamme constructeur, normes, nb de cylindres)
// donc constantes plutôt que dictionnaire i18n.
const VEHICLE_FAMILIES = [
  'SCRAMBLER','HERITAGE','SUPERSPORT','MULTISTRADA','DIAVEL','XDIAVEL','MONSTER','SUPERBIKE',
  'STREETFIGHTER','HYPERMOTARD','DESERT X','OFF-ROAD','SPORTCLASSIC','DESMOSEDICI RR','SPORT TOURING',
] as const;
const CYLINDER_OPTIONS = ['1','2','4'] as const;
const ANTIPOLLUTION_OPTIONS = ['NA','EURO 3','EURO 4','EURO 5','EURO 5+'] as const;

function fromVehicle(v: Vehicle | null): F {
  const f: F = {};
  for (const k of TEXT_FIELDS) f[k] = (v?.[k] as string | null) ?? '';
  for (const k of NUM_FIELDS) { const n = v?.[k] as number | null | undefined; f[k] = n != null ? String(n) : ''; }
  for (const k of DATE_FIELDS) f[k] = (v?.[k] as string | null) ?? '';
  f.is_restricted = v?.is_restricted ?? false;
  f.papers_100hp = (v as { papers_100hp?: boolean } | null)?.papers_100hp ?? false;
  f.status = v?.status ?? 'stock_vn';
  f.mileage_qualif = v?.mileage_qualif ?? 'reel';
  f.notes = v?.notes ?? '';
  return f;
}

const nn = (s: unknown) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : null);
const nnum = (s: unknown) => (typeof s === 'string' && s.trim() !== '' ? Number(s) : null);

function buildPayload(f: F, companyId: string): VehicleInsert {
  const out: Record<string, unknown> = { company_id: companyId };
  for (const k of TEXT_FIELDS) out[k] = nn(f[k]);
  for (const k of NUM_FIELDS) out[k] = nnum(f[k]);
  for (const k of DATE_FIELDS) out[k] = nn(f[k]);
  out.is_restricted = f.is_restricted === true;
  out.papers_100hp = f.papers_100hp === true;
  out.status = f.status as VehicleStatus;
  out.mileage_qualif = f.mileage_qualif as MileageQualif;
  out.notes = nn(f.notes);
  return out as VehicleInsert;
}

export function VehicleForm({
  initial, companyId, submitting, error, onSubmit, onCancel,
}: {
  initial: Vehicle | null;
  companyId: string;
  submitting: boolean;
  error?: string | null;
  onSubmit: (p: VehicleInsert) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<F>(() => fromVehicle(initial));
  const [localError, setLocalError] = useState<string | null>(null);
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const [decoding, setDecoding] = useState(false);
  const [decodeMsg, setDecodeMsg] = useState<string | null>(null);
  const decodeVin = async () => {
    setDecodeMsg(null); setDecoding(true);
    try {
      const r = await decodeDucatiVin(String(f.vin ?? ''));
      if (!r) { setDecodeMsg(t('vehicles.vinInvalid')); return; }
      const fill = (cur: string | boolean, val: string | number | undefined | null) =>
        (val != null && val !== '' ? String(val) : (cur as string));
      setF((p) => ({
        ...p,
        brand: (p.brand as string) || 'Ducati',
        model: fill(p.model, r.model),
        displacement: fill(p.displacement, r.displacement),
        power_cv: fill(p.power_cv, r.powerCv),
        cylinders: fill(p.cylinders, r.cylinders),
        antipollution: fill(p.antipollution, r.euro),
        model_year: fill(p.model_year, r.year),
        color: fill(p.color, r.color),
        engine_number: fill(p.engine_number, r.engineNumber),
        plate: fill(p.plate, r.plate),
        reference: fill(p.reference, r.reference),
        origin: fill(p.origin, r.origin),
        category: fill(p.category, r.category),
        mileage: fill(p.mileage, r.mileage),
        first_registration_date: fill(p.first_registration_date, r.firstRegistrationDate),
        warranty_end: fill(p.warranty_end, r.warrantyEnd),
      }));
      setDecodeMsg(r.source === 'facts' ? t('vehicles.vinDecodedFull')
        : r.source === 'vds' ? t('vehicles.vinDecoded')
        : t('vehicles.vinPartial'));
    } finally { setDecoding(false); }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!f.vin && !f.plate && !f.model) { setLocalError('Renseignez au moins le VIN, la plaque ou le modèle.'); return; }
    onSubmit(buildPayload(f, companyId));
  };

  const T = (k: string, label: string, mono = false) => (
    <Field label={label}><Input value={f[k] as string} onChange={(e) => set(k, e.target.value)} className={mono ? 'font-mono' : ''} /></Field>
  );
  const N = (k: string, label: string, step = '1') => (
    <Field label={label}><Input type="number" step={step} value={f[k] as string} onChange={(e) => set(k, e.target.value)} className="text-right tabular-nums" /></Field>
  );
  const D = (k: string, label: string) => (
    <Field label={label}><Input type="date" value={f[k] as string} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  const S = (k: string, label: string, options: readonly string[]) => (
    <Field label={label}>
      <Select value={(f[k] as string) || undefined} onValueChange={(v) => set(k, v)}>
        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );

  const stockDays = daysInStock(f.entry_date as string, f.sold_date as string);

  return (
    <form onSubmit={submit} className="space-y-6">
      <Section title={t('vehicles.secId')}>
        {T('vin', t('vehicles.vin'), true)}
        {T('plate', t('vehicles.plate'), true)}
        {T('brand', t('vehicles.brand'))}
        {T('model', t('vehicles.model'))}
        {T('engine_number', t('vehicles.engineNumber'), true)}
        {T('reference', t('vehicles.reference'), true)}
        {T('origin', t('vehicles.origin'))}
        {T('production_code', t('vehicles.productionCode'))}
        <div className="col-span-full">
          <Check label={t('vehicles.papers100hp')} checked={f.papers_100hp === true} onChange={(v) => set('papers_100hp', v)} />
        </div>
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={decodeVin} disabled={decoding || !f.vin}>
            {decoding ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('vehicles.decodeVin')}
          </Button>
          {decodeMsg && <span className="text-[12px] text-muted-foreground">{decodeMsg}</span>}
        </div>
      </Section>

      <Section title={t('vehicles.secCarac')}>
        {N('displacement', t('vehicles.displacement'), '0.1')}
        {N('power_kw', t('vehicles.powerKw'), '0.01')}
        {N('power_cv', t('vehicles.powerCv'), '0.01')}
        {T('energy', t('vehicles.energy'))}
        {S('antipollution', t('vehicles.antipollution'), ANTIPOLLUTION_OPTIONS)}
        {T('color', t('vehicles.color'))}
        {S('category', t('vehicles.category'), VEHICLE_FAMILIES)}
        {S('cylinders', t('vehicles.cylinders'), CYLINDER_OPTIONS)}
        {T('gps_tracker_id', t('vehicles.gpsTracker'))}
        {T('pin_tracker', t('vehicles.pinTracker'))}
        {T('tpms_av', t('vehicles.tpmsAv'))}
        {T('tpms_ar', t('vehicles.tpmsAr'))}
        <div className="col-span-full">
          <Check label={t('vehicles.restricted')} checked={f.is_restricted === true} onChange={(v) => set('is_restricted', v)} />
        </div>
      </Section>

      <Section title={t('vehicles.secInfo')}>
        {D('first_registration_date', t('vehicles.firstRegistration'))}
        {D('next_inspection_date', t('vehicles.nextInspection'))}
        {N('mileage', t('vehicles.mileage'))}
        <Field label={t('vehicles.mileageQualif')}>
          <Select value={f.mileage_qualif as string} onValueChange={(v) => set('mileage_qualif', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="reel">{t('vehicles.mileage_reel')}</SelectItem>
              <SelectItem value="nc">{t('vehicles.mileage_nc')}</SelectItem>
              <SelectItem value="ng">{t('vehicles.mileage_ng')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {N('model_year', t('vehicles.modelYear'))}
        {T('key_number', t('vehicles.keyNumber'))}
        {T('key_number2', t('vehicles.keyNumber2'))}
        {T('antitheft_code', t('vehicles.antitheftCode'))}
        {T('police_book_number', t('vehicles.policeBook'))}
        {T('warranty_type', t('vehicles.warrantyType'))}
        {D('warranty_end', t('vehicles.warrantyEnd'))}
        {T('exposition_code', t('vehicles.expositionCode'))}
      </Section>

      <Section title={t('vehicles.secCommercial')}>
        <Field label={t('vehicles.status')}>
          <Select value={f.status as string} onValueChange={(v) => set('status', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {VEHICLE_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{t(`vehicles.status_${s.value}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {N('purchase_price', t('vehicles.purchasePrice'), '0.01')}
        {N('cost_price', t('vehicles.costPrice'), '0.01')}
        {N('display_price', t('vehicles.displayPrice'), '0.01')}
        {D('entry_date', t('vehicles.entryDate'))}
        {D('sold_date', t('vehicles.soldDate'))}
        <Field label={t('vehicles.daysInStock')}>
          <Input value={stockDays != null ? String(stockDays) : '—'} readOnly disabled className="text-right tabular-nums" />
        </Field>
        <Field label={t('vehicles.invoice')} wide>
          <PurchaseInvoiceField companyId={companyId} vehicleId={initial?.id ?? null} />
        </Field>
        <Field label={t('vehicles.notes')} wide>
          <Textarea value={f.notes as string} onChange={(e) => set('notes', e.target.value)} rows={2} />
        </Field>
      </Section>

      {(localError || error) && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{localError || error}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('action.cancel')}</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : <Save />}
          {submitting ? t('vehicles.saving') : initial ? t('vehicles.save') : t('vehicles.create')}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 font-ui text-[15px] font-bold text-foreground">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}
function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1.5 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}
