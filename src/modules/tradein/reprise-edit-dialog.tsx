/**
 * M7 — Modifier une reprise à tout moment : données du véhicule (marque, modèle,
 * châssis, moteur, km, puissance…) ET réponses du formulaire (transmission,
 * état technique, pièces d'usure, accessoires, remarques, prix souhaité).
 * Les réponses sont stockées en bloc structuré sur la fiche véhicule :
 * parsées à l'ouverture (reprise-notes) puis re-sérialisées à l'enregistrement.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { updateRepriseVehicle } from './write-api';
import { parseRepriseNotes, buildRepriseNotes, type RepriseNotes } from './reprise-notes';
import {
  MOTO_BRANDS, FUELS, TRANSMISSIONS, OWNER_COUNTS, TECH_STATES, TECH_STATES_WITH_DESC,
  WEAR_STATES, WEAR_ITEMS, ACCESSORIES, years, convertPower, type PowerUnit,
} from './reprise-wizard-data';
import { modelsForBrand } from './moto-specs';
import type { OroVehicle } from './api';
import { t } from '@/lib/i18n';

const num = (s: string) => { const n = Number(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function RepriseEditDialog({ open, onOpenChange, vehicle, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: OroVehicle;
  onSaved: () => void;
}) {
  // Champs colonnes de la fiche véhicule
  const [f, setF] = useState(() => ({
    brand: vehicle.brand ?? '',
    model: vehicle.model ?? '',
    vin: vehicle.vin ?? '',
    engine: vehicle.engine_number ?? '',
    year: vehicle.model_year != null ? String(vehicle.model_year) : '',
    km: vehicle.mileage != null ? String(vehicle.mileage) : '',
    powerUnit: 'ch' as PowerUnit,
    power: vehicle.power_cv != null ? String(vehicle.power_cv) : '',
    cc: vehicle.displacement != null ? String(vehicle.displacement) : '',
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  // Réponses du formulaire (bloc de notes structuré).
  // Repli sur la colonne `energy` si les notes ne portent pas de ligne
  // « Carburant » (fiche créée hors assistant) — sinon l'enregistrement
  // effacerait la valeur existante.
  const [n, setN] = useState<RepriseNotes>(() => {
    const parsed = parseRepriseNotes(vehicle.notes);
    return { ...parsed, fuel: parsed.fuel || (vehicle.energy ?? '') };
  });
  const setN2 = <K extends keyof RepriseNotes>(k: K, v: RepriseNotes[K]) => setN((p) => ({ ...p, [k]: v }));
  const toggleAcc = (a: string) =>
    setN((p) => ({ ...p, accessories: p.accessories.includes(a) ? p.accessories.filter((x) => x !== a) : [...p.accessories, a] }));

  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const pw = num(f.power);
      const conv = pw > 0 ? convertPower(pw, f.powerUnit) : null;
      const year = f.year ? parseInt(f.year, 10) : null;
      await updateRepriseVehicle(vehicle.id, {
        brand: f.brand || null,
        model: f.model || null,
        vin: f.vin.trim().toUpperCase() || null,
        engine_number: f.engine.trim().toUpperCase() || null,
        model_year: year,
        mileage: f.km ? Math.round(num(f.km)) : null,
        power_cv: conv ? conv.ch : null,
        power_kw: conv ? conv.kw : null,
        displacement: f.cc ? num(f.cc) : null,
        energy: n.fuel || null,
        notes: buildRepriseNotes(n) || null,
      });
    },
    onSuccess: () => { onSaved(); onOpenChange(false); },
    onError: (e) => setError(e instanceof Error ? e.message : t('tradein.errSave')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('tradein.editTitle')}</DialogTitle>
          <DialogDescription>{t('tradein.editHint')}</DialogDescription>
        </DialogHeader>

        {/* ── Identification ─────────────────────────────────────────────── */}
        <Section title={t('tradein.wizVehTitle')}>
          <Field label={t('tradein.vBrand')}>
            <Select value={f.brand || undefined} onValueChange={(v) => set('brand', v)}>
              <SelectTrigger><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
              <SelectContent>{MOTO_BRANDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('tradein.vModel')}>
            <Input list="edit-models" value={f.model} onChange={(e) => set('model', e.target.value)} />
            <datalist id="edit-models">{modelsForBrand(f.brand).map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
          <Field label={t('tradein.vChassis')}>
            <Input className="font-mono uppercase" maxLength={17} value={f.vin} onChange={(e) => set('vin', e.target.value.toUpperCase())} />
          </Field>
          <Field label={t('tradein.vEngine')}>
            <Input className="font-mono uppercase" value={f.engine} onChange={(e) => set('engine', e.target.value.toUpperCase())} />
          </Field>
          <Field label={t('tradein.vYear')}>
            <Select value={f.year || undefined} onValueChange={(v) => set('year', v)}>
              <SelectTrigger><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
              <SelectContent>{years().map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('tradein.vKm')}>
            <Input className="text-right tabular-nums" inputMode="numeric" value={f.km} onChange={(e) => set('km', e.target.value)} />
          </Field>
          <Field label={t('tradein.vPower')}>
            <div className="flex gap-2">
              <Select value={f.powerUnit} onValueChange={(v) => set('powerUnit', v as PowerUnit)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ch">CH</SelectItem><SelectItem value="kw">kW</SelectItem></SelectContent>
              </Select>
              <Input className="flex-1 text-right tabular-nums" inputMode="numeric" value={f.power} onChange={(e) => set('power', e.target.value)} />
            </div>
          </Field>
          <Field label={t('tradein.vCc')}>
            <Input className="text-right tabular-nums" inputMode="numeric" value={f.cc} onChange={(e) => set('cc', e.target.value)} />
          </Field>
          <Field label={t('tradein.vFuel')}>
            <Select value={n.fuel || undefined} onValueChange={(v) => setN2('fuel', v)}>
              <SelectTrigger><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
              <SelectContent>{FUELS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('tradein.vTransmission')}>
            <Select value={n.transmission || undefined} onValueChange={(v) => setN2('transmission', v)}>
              <SelectTrigger><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
              <SelectContent>{TRANSMISSIONS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('tradein.vOwners')}>
            <Select value={n.owners || undefined} onValueChange={(v) => setN2('owners', v)}>
              <SelectTrigger><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
              <SelectContent>{OWNER_COUNTS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('tradein.vTechState')}>
            <Select
              value={n.techState || undefined}
              onValueChange={(v) => setN((p) => ({
                ...p, techState: v,
                // La description ne concerne que les états « à réparer / accidenté »
                techDesc: TECH_STATES_WITH_DESC.includes(v) ? p.techDesc : '',
              }))}
            >
              <SelectTrigger><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
              <SelectContent>{TECH_STATES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {TECH_STATES_WITH_DESC.includes(n.techState) && (
            <Field label={t('tradein.vTechDesc')} wide>
              <Textarea rows={2} value={n.techDesc} onChange={(e) => setN2('techDesc', e.target.value)} />
            </Field>
          )}
        </Section>

        {/* ── Pièces d'usure ─────────────────────────────────────────────── */}
        <Section title={t('tradein.vWear')}>
          <div className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-2">
            {WEAR_ITEMS.map((it) => (
              <div key={it.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="text-[14px]">{it.label}</span>
                <Select
                  value={n.wear[it.key] || undefined}
                  onValueChange={(v) => setN((p) => ({ ...p, wear: { ...p.wear, [it.key]: v } }))}
                >
                  <SelectTrigger className="h-9 w-[150px] shrink-0"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
                  <SelectContent>{WEAR_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Options / divers ───────────────────────────────────────────── */}
        <Section title={t('tradein.vAccessories')}>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:col-span-2 sm:grid-cols-2">
            {ACCESSORIES.map((a) => (
              <label key={a} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={n.accessories.includes(a)} onCheckedChange={() => toggleAcc(a)} /> {a}
              </label>
            ))}
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-4 pt-1">
            <YesNo label={t('tradein.vOriginalPaint')} value={n.originalPaint} onChange={(v) => setN2('originalPaint', v)} />
            <YesNo label={t('tradein.vImported')} value={n.imported} onChange={(v) => setN2('imported', v)} />
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={n.papers100} onCheckedChange={(v) => setN2('papers100', v === true)} /> {t('tradein.vPapers100')}
            </label>
          </div>
          <Field label={t('tradein.vRemarks')} wide>
            <Textarea rows={3} value={n.remarks} onChange={(e) => setN2('remarks', e.target.value)} />
          </Field>
        </Section>

        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('action.cancel')}</Button>
          <Button onClick={() => { setError(null); save.mutate(); }} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('action.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span>{label}</span>
      <Button type="button" size="sm" variant={value === true ? 'default' : 'outline'} onClick={() => onChange(true)}>{t('tradein.wizYes')}</Button>
      <Button type="button" size="sm" variant={value === false ? 'default' : 'outline'} onClick={() => onChange(false)}>{t('tradein.wizNo')}</Button>
    </div>
  );
}
