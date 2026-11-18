/**
 * M7 — Dépôt-vente : fiche de dépôt (création et modification). G8 « Fiche dépôt vente » :
 * moto + VIN, déposant, prix demandé, prix de vente TTC, prix minimum de réserve, conditions,
 * mention légale, frais de dépôt, n° livre de police, pro / particulier, documents remis.
 * Le n° DEP est donné par la base (séquence DEP) à l'enregistrement.
 */
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VehiclePicker } from '@/modules/vehicles/vehicle-picker';
import { vehiclePickLabel } from '@/modules/vehicles/api';
import { t } from '@/lib/i18n';
import { CHECKLIST_KEYS } from './validate-data';
import { COMMISSION_MODES, DEPOSITOR_KINDS, settingNumber, type CommissionMode, type DepositorKind } from './consignment-rules';
import { createConsignment, updateConsignment, type ConsignmentFull, type ConsignmentInput } from './consignment-api';
import { ContactSearch, Field, MoneyInput, num } from './consignment-ui';
import { partyName } from './consignment-print';

type Form = {
  depositor: { id: string; label: string } | null; kind: DepositorKind;
  vehicleMode: 'existing' | 'new'; vehicle: { id: string; label: string } | null;
  vin: string; brand: string; model: string; year: string; plate: string; mileage: string; color: string; firstReg: string;
  asked: string; sale: string; min: string; mode: CommissionMode; pct: string; fixed: string; fee: string;
  police: string; entryDate: string; conditions: string; legal: string; notes: string; checklist: Record<string, boolean>;
};

const today = () => new Date().toISOString().slice(0, 10);

function initialForm(settings: Record<string, string>, c: ConsignmentFull | null): Form {
  const kind: DepositorKind = c?.depositor_kind ?? 'particulier';
  return {
    depositor: c?.depositor ? { id: c.depositor.id, label: partyName(c.depositor) } : null, kind,
    vehicleMode: 'existing',
    vehicle: c?.vehicle ? { id: c.vehicle.id, label: vehiclePickLabel(c.vehicle) } : null,
    vin: '', brand: 'Ducati', model: '', year: '', plate: '', mileage: '', color: '', firstReg: '',
    asked: c ? String(c.asked_price) : '', sale: c ? String(c.agreed_price) : '', min: c && c.min_price ? String(c.min_price) : '',
    mode: c?.commission_mode ?? ((settings.commission_mode as CommissionMode) || 'ecart'),
    pct: String(c?.commission_pct ?? settingNumber(settings.commission_pct, 10)),
    fixed: String(c?.commission_amount ?? settingNumber(settings.commission_fixed, 0)),
    fee: String(c?.deposit_fee ?? settingNumber(settings.deposit_fee, 0)),
    police: c?.police_book_number ?? '', entryDate: c?.entry_date ?? today(),
    conditions: c?.conditions ?? settings[`conditions_${kind}`] ?? '',
    legal: c?.legal_mention ?? settings.legal_mention ?? '', notes: c?.notes ?? '',
    checklist: { ...(c?.checklist ?? {}) },
  };
}

export function ConsignmentEntryDialog({ open, onOpenChange, companyId, settings, consignment, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; companyId: string; settings: Record<string, string>;
  consignment: ConsignmentFull | null; onSaved: (id: string) => void;
}) {
  const editing = !!consignment;
  const [f, setF] = useState<Form>(() => initialForm(settings, consignment));
  // Remis a zero a l'ouverture (et quand les reglages arrivent), jamais sur une simple relecture de la liste :
  // la saisie en cours n'est pas effacee quand la fenetre reprend le focus.
  const settingsReady = Object.keys(settings).length > 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setF(initialForm(settings, consignment)); }, [open, consignment?.id, settingsReady]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  const changeKind = (kind: DepositorKind) => setF((s) => ({
    ...s, kind,
    // Conditions par défaut du type de déposant, sauf si elles ont été réécrites à la main.
    conditions: s.conditions === (settings[`conditions_${s.kind}`] ?? '') ? (settings[`conditions_${kind}`] ?? '') : s.conditions,
  }));

  const payload = (): ConsignmentInput => ({
    depositor_id: f.depositor?.id ?? '', depositor_kind: f.kind,
    vehicle_id: f.vehicleMode === 'existing' ? f.vehicle?.id ?? null : null,
    vehicle: f.vehicleMode === 'new' ? {
      vin: f.vin.trim(), brand: f.brand.trim(), model: f.model.trim(), model_year: f.year.trim(), plate: f.plate.trim(),
      mileage: f.mileage.trim(), color: f.color.trim(), first_registration_date: f.firstReg,
    } : null,
    agreed_price: num(f.sale), asked_price: num(f.asked), min_price: num(f.min),
    commission_mode: f.mode, commission_pct: num(f.pct), commission_amount: f.mode === 'forfait' ? num(f.fixed) : null,
    deposit_fee: num(f.fee), conditions: f.conditions, legal_mention: f.legal, police_book_number: f.police,
    checklist: f.checklist, entry_date: f.entryDate, notes: f.notes,
  });

  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      if (!editing) {
        if (!f.depositor) throw new Error(t('consign.errDepositor'));
        if (f.vehicleMode === 'existing' && !f.vehicle) throw new Error(t('consign.errVehicle'));
        if (f.vehicleMode === 'new' && !f.vin.trim()) throw new Error(t('consign.errVin'));
      }
      if (!(num(f.sale) > 0)) throw new Error(t('consign.errSalePrice'));
      if (editing) {
        const { depositor_id: _d, vehicle_id: _v, vehicle: _n, ...rest } = payload();
        await updateConsignment(consignment!.id, rest);
        return consignment!.id;
      }
      return createConsignment(companyId, payload());
    },
    onSuccess: (id) => { toast.success(editing ? t('consign.updated') : t('consign.created')); onSaved(id); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message || t('consign.errSave')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `${t('consign.editTitle')} ${consignment?.number ?? ''}` : t('consign.newTitle')}</DialogTitle>
          <DialogDescription>{t('consign.entryHint')}</DialogDescription>
        </DialogHeader>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label={t('consign.depositor')}>
            {editing ? <Input value={f.depositor?.label ?? '—'} disabled className="h-9" />
              : <ContactSearch companyId={companyId} picked={f.depositor} onPick={(c) => set('depositor', c)} />}
          </Field>
          <Field label={t('consign.kind')}>
            <Select value={f.kind} onValueChange={(v) => changeKind(v as DepositorKind)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{DEPOSITOR_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`consign.kind_${k}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </section>

        <section className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('consign.moto')}</span>
            {!editing && (
              <div className="flex gap-1">
                <Button type="button" size="sm" variant={f.vehicleMode === 'existing' ? 'default' : 'outline'} onClick={() => set('vehicleMode', 'existing')}>{t('consign.motoExisting')}</Button>
                <Button type="button" size="sm" variant={f.vehicleMode === 'new' ? 'default' : 'outline'} onClick={() => set('vehicleMode', 'new')}>{t('consign.motoNew')}</Button>
              </div>
            )}
          </div>
          {editing || f.vehicleMode === 'existing' ? (
            f.vehicle ? (
              <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <span className="truncate">{f.vehicle.label}</span>
                {!editing && <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => set('vehicle', null)}>{t('consign.change')}</Button>}
              </div>
            ) : (
              <VehiclePicker companyId={companyId} contactId={f.depositor?.id ?? null}
                onPick={(v) => set('vehicle', { id: v.id, label: vehiclePickLabel(v) })} placeholder={t('consign.motoSearch')} />
            )
          ) : (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label={t('consign.vin')} className="sm:col-span-2"><Input value={f.vin} onChange={(e) => set('vin', e.target.value.toUpperCase())} className="h-9 font-mono" maxLength={17} /></Field>
              <Field label={t('consign.brand')}><Input value={f.brand} onChange={(e) => set('brand', e.target.value)} className="h-9" /></Field>
              <Field label={t('consign.model')}><Input value={f.model} onChange={(e) => set('model', e.target.value)} className="h-9" /></Field>
              <Field label={t('consign.year')}><Input inputMode="numeric" value={f.year} onChange={(e) => set('year', e.target.value)} className="h-9" /></Field>
              <Field label={t('consign.plate')}><Input value={f.plate} onChange={(e) => set('plate', e.target.value.toUpperCase())} className="h-9" /></Field>
              <Field label={t('consign.mileage')}><Input inputMode="numeric" value={f.mileage} onChange={(e) => set('mileage', e.target.value)} className="h-9" /></Field>
              <Field label={t('consign.color')}><Input value={f.color} onChange={(e) => set('color', e.target.value)} className="h-9" /></Field>
              <Field label={t('consign.firstReg')}><Input type="date" value={f.firstReg} onChange={(e) => set('firstReg', e.target.value)} className="h-9" /></Field>
              {f.vin.trim().length > 0 && f.vin.trim().length !== 17 && <p className="text-xs text-warning sm:col-span-4">{t('consign.vinLength')}</p>}
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Field label={t('consign.asked')}><MoneyInput value={f.asked} onChange={(v) => set('asked', v)} /></Field>
          <Field label={t('consign.salePrice')}><MoneyInput value={f.sale} onChange={(v) => set('sale', v)} /></Field>
          <Field label={t('consign.minPrice')}><MoneyInput value={f.min} onChange={(v) => set('min', v)} /></Field>
          <Field label={t('consign.commissionMode')}>
            <Select value={f.mode} onValueChange={(v) => set('mode', v as CommissionMode)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{COMMISSION_MODES.map((m) => <SelectItem key={m} value={m}>{t(`consign.mode_${m}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {f.mode === 'pourcentage' && <Field label={t('consign.commissionPct')}><Input inputMode="decimal" value={f.pct} onChange={(e) => set('pct', e.target.value)} className="h-9 text-right tabular-nums" /></Field>}
          {f.mode === 'forfait' && <Field label={t('consign.commissionFixed')}><MoneyInput value={f.fixed} onChange={(v) => set('fixed', v)} /></Field>}
          <Field label={t('consign.depositFee')}><MoneyInput value={f.fee} onChange={(v) => set('fee', v)} /></Field>
          <Field label={t('consign.policeBook')}><Input value={f.police} onChange={(e) => set('police', e.target.value)} placeholder={t('consign.policeBookAuto')} className="h-9" /></Field>
          <Field label={t('consign.entryDate')}><Input type="date" value={f.entryDate} onChange={(e) => set('entryDate', e.target.value)} className="h-9" /></Field>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label={t('consign.conditionsTitle')}><Textarea rows={4} value={f.conditions} onChange={(e) => set('conditions', e.target.value)} /></Field>
          <Field label={t('consign.legalMention')}><Textarea rows={4} value={f.legal} onChange={(e) => set('legal', e.target.value)} /></Field>
        </section>

        <section className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('consign.checklistTitle')}</span>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {CHECKLIST_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!f.checklist[k]} onCheckedChange={(v) => set('checklist', { ...f.checklist, [k]: v === true })} />
                {t(`tradein.chk_${k}`)}
              </label>
            ))}
          </div>
        </section>

        <Field label={t('consign.notes')}><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {editing ? t('action.save') : t('consign.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
