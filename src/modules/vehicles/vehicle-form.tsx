/**
 * M3 — Formulaire fiche véhicule (création + édition). Parité G8.
 * Sections : identification (carte grise), caractéristiques, infos compl., commercial.
 *
 * Mission 04, carte 6 : codes officiels de la carte grise à côté des libellés
 * (E, A, B, D.1, D.3, P.1, P.2, P.3, V.9, R — directive 1999/37/CE), contrôle du
 * VIN (avertissements, jamais bloquant) et refus d'un VIN déjà présent dans le parc
 * (on propose de rattacher la moto existante). Mode « moto de client » (`client`) :
 * pas de suivi commercial, la moto rejoint le parc du client.
 *
 * Mission 04, carte 7 : « Lire la carte grise » (photo ou PDF) → champs pré-remplis et
 * surlignés (lu / à vérifier), jamais d'écrasement d'une saisie ; la photo est rangée
 * dans les documents de la moto (GED). L'employé vérifie avant d'enregistrer.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, Bike, CheckCircle2, Link2, Loader2, ScanText, Wand2 } from 'lucide-react';
import { decodeDucatiVin } from '@/lib/ducati-vin';
import { checkVin, normalizeVin } from '@/lib/vin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SaveButton, type SaveStatus } from '@/components/ui/save-button';
import { useIsDirty } from '@/lib/use-dirty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import {
  VEHICLE_STATUSES, findVehiclesByVin, vehicleLabel,
  type Vehicle, type VehicleInsert, type VehicleStatus, type MileageQualif,
} from './api';
import { PurchaseInvoiceField } from './purchase-invoice-field';
import {
  attachCarteGrise, CgReadError, readCarteGrise, uploadCarteGrise,
  type CgConfidence, type CgField, type CgReading, type CgScan,
} from './carte-grise';
import { applyCgReading } from './carte-grise-apply';

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

/**
 * Codes officiels des cases du certificat d'immatriculation (directive 1999/37/CE,
 * repris par la carte grise belge) : l'employé recopie case par case, comme dans G8.
 * Codes internationaux, identiques FR/NL : constantes plutôt que dictionnaire.
 */
export const CARTE_GRISE_CODES: Record<string, string> = {
  vin: 'E', plate: 'A', first_registration_date: 'B', brand: 'D.1', model: 'D.3',
  displacement: 'P.1', power_kw: 'P.2', energy: 'P.3', antipollution: 'V.9', color: 'R',
};

/** Moto de client : le formulaire la rattache à ce contact (vehicle_owners). */
export type VehicleFormClient = { id: string; name: string };
/** `scan` : carte grise lue sur une moto pas encore enregistrée, à ranger après création. */
export type VehicleSubmitMeta = { ownerFrom: string; scan: CgScan | null };

function fromVehicle(v: Vehicle | null, client: boolean, prefill?: Partial<Record<string, string>>): F {
  const f: F = {};
  for (const k of TEXT_FIELDS) f[k] = (v?.[k] as string | null) ?? '';
  for (const k of NUM_FIELDS) { const n = v?.[k] as number | null | undefined; f[k] = n != null ? String(n) : ''; }
  for (const k of DATE_FIELDS) f[k] = (v?.[k] as string | null) ?? '';
  f.is_restricted = v?.is_restricted ?? false;
  f.papers_100hp = (v as { papers_100hp?: boolean } | null)?.papers_100hp ?? false;
  // Moto de client : statut « vendu », comme les motos « RÉPARÉ » reprises de G8.
  f.status = v?.status ?? (client ? 'vendu' : 'stock_vn');
  f.mileage_qualif = v?.mileage_qualif ?? 'reel';
  f.notes = v?.notes ?? '';
  if (!v && prefill) {
    for (const [k, val] of Object.entries(prefill)) if (val != null && val !== '') f[k] = val;
  }
  return f;
}

const nn = (s: unknown) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : null);
const nnum = (s: unknown) => (typeof s === 'string' && s.trim() !== '' ? Number(s) : null);

function buildPayload(f: F, companyId: string): VehicleInsert {
  const out: Record<string, unknown> = { company_id: companyId };
  for (const k of TEXT_FIELDS) out[k] = nn(f[k]);
  out.vin = normalizeVin(f.vin as string) || null;
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
  initial, companyId, status, error, onSubmit, onCancel, client, prefill, onAttachExisting, attaching,
}: {
  initial: Vehicle | null;
  companyId: string;
  status: SaveStatus;
  error?: string | null;
  onSubmit: (p: VehicleInsert, meta: VehicleSubmitMeta) => void;
  onCancel: () => void;
  /** Mission 04 carte 6 : moto d'un client (création depuis sa fiche). */
  client?: VehicleFormClient | null;
  /** Valeurs de départ d'une nouvelle moto (ex. déclaration du client). */
  prefill?: Partial<Record<string, string>>;
  /** VIN déjà présent : rattacher la moto existante au client au lieu d'en créer une 2e. */
  onAttachExisting?: (vehicleId: string, ownerFrom: string) => void;
  attaching?: boolean;
}) {
  const isClient = !!client;
  const [f, setF] = useState<F>(() => fromVehicle(initial, isClient, prefill));
  const [ownerFrom, setOwnerFrom] = useState(() => new Date().toISOString().slice(0, 10));
  // Rien de modifié = rien à enregistrer : le bouton reste grisé (sauf pré-remplissage à créer).
  const dirty = useIsDirty(f);
  const [localError, setLocalError] = useState<string | null>(null);

  // Carte 7 : champs lus sur la carte grise (surlignés tant que l'employé n'y a pas touché).
  const qc = useQueryClient();
  const [pendingId] = useState(() => crypto.randomUUID());
  const [cgConf, setCgConf] = useState<Partial<Record<CgField, CgConfidence>>>({});
  const [cgConflicts, setCgConflicts] = useState<Partial<Record<CgField, string>>>({});
  const [cgInfo, setCgInfo] = useState<Pick<CgReading, 'holder' | 'unmapped'> | null>(null);
  const [cgMsg, setCgMsg] = useState<{ tone: 'info' | 'warning' | 'danger'; text: string } | null>(null);
  const [cgBusy, setCgBusy] = useState(false);
  const [scan, setScan] = useState<CgScan | null>(null);
  const cgInput = useRef<HTMLInputElement>(null);

  const set = (k: string, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    // Champ corrigé ou confirmé par l'employé : plus surligné.
    setCgConf((c) => { if (!(k in c)) return c; const n = { ...c }; delete n[k as CgField]; return n; });
    setCgConflicts((c) => { if (!(k in c)) return c; const n = { ...c }; delete n[k as CgField]; return n; });
  };

  const applyReading = (r: CgReading) => {
    const { next, filled, conflicts } = applyCgReading(f, r);
    setF(next);
    setCgConf(Object.fromEntries([...filled, ...Object.keys(conflicts)].map((k) => [k, r.confidence[k as CgField] ?? 'low'])));
    setCgConflicts(conflicts);
    setCgInfo({ holder: r.holder, unmapped: r.unmapped });
    const n = filled.length;
    setCgMsg(n + Object.keys(conflicts).length === 0
      ? { tone: 'warning', text: t('motoClient.readNothing') }
      : { tone: 'info', text: t('motoClient.readDone').replace('{n}', String(n)) });
  };

  const cgError = (e: unknown) => {
    const code = e instanceof CgReadError ? e.code : 'read_failed';
    setCgMsg({
      tone: code === 'not_registration' ? 'warning' : 'danger',
      text: code === 'not_configured' ? t('motoClient.readNotConfigured')
        : code === 'not_registration' ? t('motoClient.readNotCg') : t('motoClient.readErr'),
    });
  };

  /** Photo ou PDF choisi : dépôt dans la GED de la moto, lecture, pré-remplissage. */
  const onCgFile = async (file: File | undefined) => {
    if (!file) return;
    setCgMsg({ tone: 'info', text: t('motoClient.reading') }); setCgBusy(true);
    try {
      const vehicleId = initial?.id ?? pendingId;
      const sc = await uploadCarteGrise(companyId, vehicleId, file);
      if (initial) {
        // Moto déjà enregistrée : la photo est rangée tout de suite.
        await attachCarteGrise(companyId, vehicleId, sc);
        qc.invalidateQueries({ queryKey: ['attachments', 'vehicle', vehicleId] });
      } else setScan(sc);
      applyReading(await readCarteGrise([sc.path]));
    } catch (e) { cgError(e); } finally {
      setCgBusy(false);
      if (cgInput.current) cgInput.current.value = '';
    }
  };

  /** Surlignage d'un champ lu : bleu = lu net, orange = à vérifier (couleur + icône + libellé). */
  const hl = (k: string) => {
    const c = cgConf[k as CgField];
    return !c ? '' : c === 'high' ? 'ring-2 ring-info/60' : 'ring-2 ring-warning/70';
  };
  const cgHint = (k: string) => {
    const c = cgConf[k as CgField];
    const conflict = cgConflicts[k as CgField];
    if (!c && !conflict) return null;
    return (
      <>
        {c && (c === 'high' ? (
          <p className="flex items-center gap-1 text-[11px] font-medium text-info"><CheckCircle2 className="size-3.5" />{t('motoClient.confHigh')}</p>
        ) : (
          <p className="flex items-center gap-1 text-[11px] font-medium text-warning"><AlertTriangle className="size-3.5" />{t('motoClient.confCheck')}</p>
        ))}
        {conflict && (
          <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            {t('motoClient.onCard')}<span className="font-mono text-foreground">{conflict}</span>
            <button type="button" className="font-medium text-info underline-offset-2 hover:underline" onClick={() => set(k, conflict)}>
              {t('motoClient.useValue')}
            </button>
          </p>
        )}
      </>
    );
  };

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

  // Contrôle du VIN : avertissements (longueur, I/O/Q), jamais bloquants.
  const vin = checkVin(f.vin as string);
  const vinChanged = vin.normalized !== normalizeVin(initial?.vin);
  // Doublon : une autre moto de la société porte déjà ce VIN.
  const dupQ = useQuery({
    queryKey: ['vin-duplicates', companyId, vin.normalized, initial?.id ?? null],
    queryFn: () => findVehiclesByVin(companyId, vin.normalized, initial?.id ?? null),
    enabled: vin.normalized.length >= 6 && vinChanged,
    staleTime: 30_000,
  });
  const duplicates = vinChanged && vin.normalized.length >= 6 ? dupQ.data ?? [] : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!f.vin && !f.plate && !f.model) { setLocalError(t('motoClient.identityRequired')); return; }
    // Jamais de 2e fiche pour un VIN déjà connu : on rattache (ou on ouvre) l'existante.
    if (duplicates.length > 0) { setLocalError(t('motoClient.vinExistsBlock')); return; }
    const payload = buildPayload(f, companyId);
    // Carte grise déjà déposée sous l'identifiant fixé d'avance : la moto le reprend.
    onSubmit(!initial && scan ? { ...payload, id: pendingId } : payload, { ownerFrom, scan: initial ? null : scan });
  };

  const T = (k: string, label: string, mono = false) => (
    <Field label={label} code={CARTE_GRISE_CODES[k]}>
      <Input value={f[k] as string} onChange={(e) => set(k, e.target.value)} className={`${mono ? 'font-mono' : ''} ${hl(k)}`} />
      {cgHint(k)}
    </Field>
  );
  const N = (k: string, label: string, step = '1') => (
    <Field label={label} code={CARTE_GRISE_CODES[k]}>
      <Input type="number" step={step} value={f[k] as string} onChange={(e) => set(k, e.target.value)} className={`text-right tabular-nums ${hl(k)}`} />
      {cgHint(k)}
    </Field>
  );
  const D = (k: string, label: string) => (
    <Field label={label} code={CARTE_GRISE_CODES[k]}>
      <Input type="date" value={f[k] as string} onChange={(e) => set(k, e.target.value)} className={hl(k)} />
      {cgHint(k)}
    </Field>
  );
  const S = (k: string, label: string, options: readonly string[]) => (
    <Field label={label} code={CARTE_GRISE_CODES[k]}>
      <Select value={(f[k] as string) || undefined} onValueChange={(v) => set(k, v)}>
        <SelectTrigger className={hl(k)}><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
      {cgHint(k)}
    </Field>
  );

  const stockDays = daysInStock(f.entry_date as string, f.sold_date as string);
  const notesField = (
    <Field label={t('vehicles.notes')} wide>
      <Textarea value={f.notes as string} onChange={(e) => set('notes', e.target.value)} rows={2} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-6">
      {client && (
        <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('motoClient.owner')}>
              <p className="flex h-9 items-center gap-2 text-sm font-medium"><Bike className="size-4 text-muted-foreground" />{client.name}</p>
            </Field>
            <Field label={t('motoClient.ownerFrom')}>
              <Input type="date" value={ownerFrom} onChange={(e) => setOwnerFrom(e.target.value)} />
            </Field>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('motoClient.clientModeHint')}</p>
        </div>
      )}

      <Section title={t('vehicles.secId')}>
        <div className="col-span-full space-y-2 rounded-md border border-dashed border-border p-3">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={cgInput} type="file" accept="image/*,application/pdf" className="hidden"
              onChange={(e) => onCgFile(e.target.files?.[0])} />
            <Button type="button" variant="outline" disabled={cgBusy} onClick={() => cgInput.current?.click()}>
              {cgBusy ? <Loader2 className="animate-spin" /> : <ScanText />} {t('motoClient.readCg')}
            </Button>
            <span className="text-[12px] text-muted-foreground">{t('motoClient.readCgHint')}</span>
          </div>
          {cgMsg && (
            <p className={`flex items-start gap-1.5 text-[12px] font-medium ${cgMsg.tone === 'info' ? 'text-info' : cgMsg.tone === 'warning' ? 'text-warning' : 'text-danger'}`}>
              {cgMsg.tone === 'info' ? <ScanText className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
              {cgMsg.text}
            </p>
          )}
          {cgInfo?.holder && (
            <p className="text-[12px] text-muted-foreground">{t('motoClient.holder')}<span className="font-medium text-foreground">{cgInfo.holder}</span></p>
          )}
          {cgInfo && cgInfo.unmapped.length > 0 && (
            <p className="text-[12px] text-muted-foreground">
              {t('motoClient.unmapped')}{cgInfo.unmapped.map((u) => `${u.code} « ${u.raw} »`).join(' · ')}
            </p>
          )}
          {scan && !initial && <p className="text-[12px] text-muted-foreground">{t('motoClient.scanPending')}</p>}
          {cgInfo && initial && <p className="text-[12px] text-muted-foreground">{t('motoClient.scanAttached')}</p>}
        </div>
        <Field label={t('vehicles.vin')} code={CARTE_GRISE_CODES.vin}>
          <Input value={f.vin as string} onChange={(e) => set('vin', e.target.value.toUpperCase())}
            onBlur={() => { if (f.vin) set('vin', normalizeVin(f.vin as string)); }}
            className={`font-mono ${hl('vin')}`} autoCapitalize="characters" spellCheck={false} maxLength={30} />
          {cgHint('vin')}
          {vin.warnings.includes('length') && (
            <p className="flex items-start gap-1 text-[12px] text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t('motoClient.vinWarnLength').replace('{n}', String(vin.normalized.length))}
            </p>
          )}
          {vin.warnings.includes('forbidden_letters') && (
            <p className="flex items-start gap-1 text-[12px] text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t('motoClient.vinWarnLetters').replace('{l}', vin.forbidden.join(', '))}
            </p>
          )}
        </Field>
        {T('plate', t('vehicles.plate'), true)}
        {T('brand', t('vehicles.brand'))}
        {duplicates.length > 0 && (
          <div className="col-span-full rounded-md border border-warning/40 bg-warning-bg p-3">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-warning">
              <AlertTriangle className="size-4 shrink-0" />{t('motoClient.vinExistsTitle')}
            </p>
            <p className="mt-0.5 text-[12px] text-foreground">
              {onAttachExisting ? t('motoClient.vinExistsHintClient') : t('motoClient.vinExistsHint')}
            </p>
            <ul className="mt-2 space-y-2">
              {duplicates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
                  <Bike className="size-4 text-muted-foreground" />
                  <span className="font-medium">{vehicleLabel(d)}</span>
                  <span className="font-mono text-[12px]">{d.vin}</span>
                  {d.plate && <span className="font-mono text-[12px] text-muted-foreground">{d.plate}</span>}
                  <span className="text-[12px] text-muted-foreground">
                    {t('motoClient.currentOwner')}{d.owner_name ?? t('motoClient.noOwner')}
                  </span>
                  <span className="ml-auto flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" asChild>
                      <Link to="/vehicles/$vehicleId" params={{ vehicleId: d.id }} target="_blank">{t('motoClient.openExisting')}</Link>
                    </Button>
                    {onAttachExisting && (
                      <Button type="button" size="sm" disabled={attaching} onClick={() => onAttachExisting(d.id, ownerFrom)}>
                        {attaching ? <Loader2 className="animate-spin" /> : <Link2 />} {t('motoClient.attachExisting')}
                      </Button>
                    )}
                  </span>
                  {onAttachExisting && d.owner_id && d.owner_id !== client?.id && (
                    <span className="w-full text-[12px] text-muted-foreground">{t('motoClient.attachReplaces')}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
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
        {isClient && notesField}
      </Section>

      {!isClient && (
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
          {notesField}
        </Section>
      )}

      {(localError || error) && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{localError || error}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('action.cancel')}</Button>
        <SaveButton type="submit" status={status} disabled={!dirty && !(isClient || prefill)}>
          {initial ? t('vehicles.save') : isClient ? t('motoClient.addForClient') : t('vehicles.create')}
        </SaveButton>
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
function Field({ label, children, wide, code }: { label: string; children: ReactNode; wide?: boolean; code?: string }) {
  return (
    <div className={`space-y-1.5 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
      <Label className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
        {code && (
          <span title={`${t('motoClient.cgCode')} ${code}`}
            className="rounded-[var(--radius-badge)] border border-border bg-muted px-1 font-mono text-[11px] font-bold normal-case tracking-normal text-foreground">
            {code}
          </span>
        )}
        {label}
      </Label>
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
