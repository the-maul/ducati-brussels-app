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
 *
 * Mission 06, carte 4 : dès que le VIN est complet, reconnaissance hors ligne (famille, modèle,
 * version, année, cylindrée, puissance, norme, modèle-année du catalogue) et reprise des infos de
 * nos factures pour ce VIN ; seuls les champs vides sont remplis (surlignés « d'après le VIN »).
 */
import { CARGARANTIE_PLANS, isCarGarantie, warrantyPlanFor, warrantyTypesFor } from './warranty-types';
import { ChevronDown } from 'lucide-react';
import { getModelYearContext, listCatalogModelYears } from '@/modules/catalog/api';
import { ModelChooserDialog, type ChosenModel } from './model-chooser';
import { isDucatiBrand, VEHICLE_BRANDS, yearOptions } from './model-pick';
import { cleanPlate, normalizePlate, PLATE_MIN, plateInput, plateIsValid } from '@/lib/plate';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, Bike, CheckCircle2, Link2, Loader2, ScanSearch, ScanText } from 'lucide-react';
import { decodeDucatiVin } from '@/lib/ducati-vin';
import { checkVin, normalizeVin } from '@/lib/vin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SaveButton, type SaveStatus } from '@/components/ui/save-button';
import { useIsDirty, useLeaveGuard } from '@/lib/use-dirty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fillVars, t } from '@/lib/i18n';
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
import { VinIdentifyPanel, type VinValues } from './vin-identify-panel';
import { VinSuggestions } from './vin-suggestions';
import { SpecSelect } from './spec-select';
import {
  ANTIPOLLUTION_OPTIONS, COLOR_OPTIONS, CYLINDER_OPTIONS, ENERGY_OPTIONS, VEHICLE_FAMILIES,
  fillEmptyVehicleFields, loadCatalogSpec, loadSpecOptions,
} from './catalog-specs';
import { isDucatiFullVin, type VinSuggestKey } from '@/lib/vin-identify';

/** Champs de la fiche remplis par la reconnaissance du VIN (clé métier → champ). */
const VIN_FIELD: Record<VinSuggestKey, string> = {
  brand: 'brand', family: 'category', model: 'model', model_year: 'model_year', displacement: 'displacement',
  power_cv: 'power_cv', power_kw: 'power_kw', cylinders: 'cylinders', antipollution: 'antipollution',
};
/** Infos de nos factures pour ce VIN exact (`ducati_vin_facts`) reprises si le champ est vide. */
const FACT_FIELDS = ['color', 'engine_number', 'plate', 'reference', 'origin', 'mileage', 'first_registration_date', 'warranty_end'] as const;

type F = Record<string, string | boolean>;

const TEXT_FIELDS = [
  'vin','reference','brand','model','plate','engine_number',
  'origin','production_code','energy','antipollution',
  'color','category','gps_tracker_id','pin_tracker',
  'tpms_av','tpms_ar','antitheft_code','key_number','key_number2','police_book_number','warranty_type','exposition_code',
  // Mission 06 carte 4 : modèle-année du catalogue Ducati (reconnu par le VIN ou choisi).
  'ducati_model_year_id',
] as const;
// Rattrapage G8 (18/11) : duree de garantie (mois) et cote, migration 20261118141000 (colonne inconnue = retiree a l'envoi).
const NUM_FIELDS = ['displacement','power_kw','power_cv','cylinders','mileage','model_year','purchase_price','cost_price','display_price','warranty_months','market_value'] as const;
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
export { VEHICLE_FAMILIES };

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
  for (const k of NUM_FIELDS) { const n = (v as Record<string, unknown> | null)?.[k] as number | null | undefined; f[k] = n != null ? String(n) : ''; }
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
  f.plate_custom = (v as { plate_custom?: boolean } | null)?.plate_custom === true;
  f.warranty_plan = (v as { warranty_plan?: string | null } | null)?.warranty_plan ?? '';
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
  out.plate_custom = f.plate_custom === true;
  out.warranty_plan = warrantyPlanFor(f.warranty_type, f.warranty_plan);
  out.status = f.status as VehicleStatus;
  out.mileage_qualif = f.mileage_qualif as MileageQualif;
  out.notes = nn(f.notes);
  return out as VehicleInsert;
}

export function VehicleForm({
  initial, companyId, status, error, onSubmit, onCancel, client, prefill, onAttachExisting, attaching, clientScanPath, catalogFilled, dirtyRef,
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
  /** Carte 8 : carte grise déposée par le client dans son espace (chemin GED), lisible d'un clic. */
  clientScanPath?: string | null;
  /** Champs complétés à l'ouverture depuis le catalogue ou nos factures (surlignés). */
  catalogFilled?: string[];
  /** La fiche sait ainsi si une saisie est en cours quand un import DCS arrive. */
  dirtyRef?: { current: boolean };
}) {
  const isClient = !!client;
  const [f, setF] = useState<F>(() => fromVehicle(initial, isClient, prefill));
  const [ownerFrom, setOwnerFrom] = useState(() => new Date().toISOString().slice(0, 10));
  // Rien de modifié = rien à enregistrer : le bouton reste grisé (sauf pré-remplissage à créer).
  const dirty = useIsDirty(f);
  useEffect(() => { if (dirtyRef) dirtyRef.current = dirty; }, [dirty, dirtyRef]);
  // Import DCS reçu pendant une saisie : seuls les champs auxquels on n'a pas touché sont mis à jour.
  const baseF = useRef(f);
  const seenSync = useRef((initial as { my_ducati_synced_at?: string | null } | null)?.my_ducati_synced_at ?? null);
  useEffect(() => {
    if (!initial) return;
    const synced = (initial as { my_ducati_synced_at?: string | null }).my_ducati_synced_at ?? null;
    if (synced === seenSync.current) return;
    seenSync.current = synced;
    const next = fromVehicle(initial, isClient, prefill);
    const base = baseF.current;
    baseF.current = next;
    setF((cur) => {
      const merged = { ...cur };
      for (const k of Object.keys(next)) if (cur[k] === base[k]) merged[k] = next[k];
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  // Bouton Retour : confirmation avant de quitter si quelque chose a change (UX010).
  useLeaveGuard(dirty);
  const [localError, setLocalError] = useState<string | null>(null);

  // Carte 7 : champs lus sur la carte grise (surlignés tant que l'employé n'y a pas touché).
  const qc = useQueryClient();
  const [pendingId] = useState(() => crypto.randomUUID());
  const [cgConf, setCgConf] = useState<Partial<Record<CgField, CgConfidence>>>({});
  const [cgConflicts, setCgConflicts] = useState<Partial<Record<CgField, string>>>({});
  const [cgInfo, setCgInfo] = useState<Pick<CgReading, 'holder' | 'unmapped'> | null>(null);
  const [cgModel, setCgModel] = useState<string | null>(null);
  const [cgMsg, setCgMsg] = useState<{ tone: 'info' | 'warning' | 'danger'; text: string } | null>(null);
  const [cgBusy, setCgBusy] = useState(false);
  const [scan, setScan] = useState<CgScan | null>(null);
  const cgInput = useRef<HTMLInputElement>(null);

  // Mission 06 carte 4 : champs remplis d'après le VIN (surlignés tant qu'on n'y touche pas).
  const [vinFilled, setVinFilled] = useState<Set<string>>(() => new Set(catalogFilled ?? []));
  const set = (k: string, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    setVinFilled((s) => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n; });
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
    setCgModel(r.values.model ?? null);
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
        : code === 'not_registration' ? t('motoClient.readNotCg') : code === 'no_credit' ? t('motoClient.readNoCredit') : t('motoClient.readErr'),
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

  /** Carte 8 : lecture de la carte grise déjà déposée par le client (pas de nouveau dépôt). */
  const onClientScan = async () => {
    if (!clientScanPath) return;
    setCgMsg({ tone: 'info', text: t('motoClient.reading') }); setCgBusy(true);
    try { applyReading(await readCarteGrise([clientScanPath])); }
    catch (e) { cgError(e); } finally { setCgBusy(false); }
  };

  /** Surlignage d'un champ lu : bleu = lu net, orange = à vérifier (couleur + icône + libellé). */
  const hl = (k: string) => {
    const c = cgConf[k as CgField];
    if (!c) return vinFilled.has(k) ? 'ring-2 ring-info/60' : '';
    return c === 'high' ? 'ring-2 ring-info/60' : 'ring-2 ring-warning/70';
  };
  const cgHint = (k: string) => {
    const c = cgConf[k as CgField];
    const conflict = cgConflicts[k as CgField];
    if (!c && !conflict && vinFilled.has(k)) {
      return <p className="flex items-center gap-1 text-[11px] font-medium text-info"><ScanSearch className="size-3.5" />{t('vinId.filledHint')}</p>;
    }
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

  // Mission 06 carte 4 : reconnaissance par le VIN → champs de la fiche (clés métier).
  const vinValues: VinValues = Object.fromEntries(
    (Object.entries(VIN_FIELD) as [VinSuggestKey, string][]).map(([k, field]) => [k, String(f[field] ?? '')]),
  );
  const applyVin = (patch: VinValues) => {
    setF((p) => {
      const n = { ...p };
      for (const [k, val] of Object.entries(patch) as [VinSuggestKey, string][]) n[VIN_FIELD[k]] = k === 'brand' ? val.toUpperCase() : val;
      return n;
    });
  };
  const markVinFilled = (keys: string[]) => setVinFilled((s) => new Set([...s, ...keys]));
  // Sources that can point at the right candidate (highlight only, the user still clicks).
  const dcsVehicle = (initial as { my_ducati_data?: { vehicle?: { title?: unknown; model?: unknown } } | null } | null)?.my_ducati_data?.vehicle;
  const dcsTitle = dcsVehicle?.title ?? dcsVehicle?.model;
  const vinHints = { carteGrise: cgModel, dcsTitle: typeof dcsTitle === 'string' ? dcsTitle : null };

  // VIN Ducati saisi maintenant : infos de nos factures pour ce VIN exact (couleur, n° moteur…).
  const factsFor = useRef<string | null>(null);
  const fRef = useRef(f);
  fRef.current = f;
  useEffect(() => {
    const v = vin.normalized;
    if (!vinChanged || !isDucatiFullVin(v) || factsFor.current === v) return;
    factsFor.current = v;
    decodeDucatiVin(v).then((r) => {
      if (!r || r.source !== 'facts') return;
      const vals: Record<string, string | number | undefined> = {
        color: r.color, engine_number: r.engineNumber, plate: r.plate, reference: r.reference, origin: r.origin,
        mileage: r.mileage, first_registration_date: r.firstRegistrationDate, warranty_end: r.warrantyEnd,
      };
      const cur = fRef.current;
      const patch: Record<string, string> = {};
      for (const k of FACT_FIELDS) {
        const val = vals[k];
        if (val != null && val !== '' && !String(cur[k] ?? '').trim()) patch[k] = String(val);
      }
      const done = Object.keys(patch);
      if (done.length) setF((p) => {
        const n = { ...p };
        for (const k of done) if (!String(p[k] ?? '').trim()) n[k] = patch[k];
        return n;
      });
      if (done.length) markVinFilled(done);
    }).catch(() => { /* infos de factures facultatives */ });
  }, [vin.normalized, vinChanged]);

  // Modèle choisi ou reconnu : ses caractéristiques remplissent les champs encore vides.
  const specOptions = useQuery({ queryKey: ['vehicle-spec-options'], queryFn: loadSpecOptions, staleTime: 3_600_000 });
  const modelYearId = String(f.ducati_model_year_id ?? '');
  useEffect(() => {
    if (!modelYearId || modelYearId === String(initial?.ducati_model_year_id ?? '')) return;
    let stop = false;
    loadCatalogSpec(modelYearId).then((spec) => {
      if (stop || !spec) return;
      const r = fillEmptyVehicleFields(fRef.current as Record<string, unknown>, null, spec);
      if (!r.filled.length) return;
      setF((p) => {
        const n = { ...p };
        for (const k of r.filled) if (!String(p[k] ?? '').trim()) n[k] = String(r.vehicle[k]);
        return n;
      });
      markVinFilled(r.filled);
    }).catch(() => { /* catalogue facultatif */ });
    return () => { stop = true; };
  }, [modelYearId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!f.vin && !f.plate && !f.model) { setLocalError(t('motoClient.identityRequired')); return; }
    // Une recherche avec * n'est pas un n° de châssis à enregistrer.
    if (String(f.vin ?? '').includes('*')) { setLocalError(t('motoClient.vinFinish')); return; }
    // Jamais de 2e fiche pour un VIN déjà connu : on rattache (ou on ouvre) l'existante.
    if (duplicates.length > 0) { setLocalError(t('motoClient.vinExistsBlock')); return; }
    // Plaque : contrôlée à la création ou quand on la change ; une ancienne plaque intacte ne bloque rien.
    const plateCustom = f.plate_custom === true;
    const plateChanged = !initial || String(f.plate ?? '') !== String(initial.plate ?? '')
      || plateCustom !== ((initial as { plate_custom?: boolean }).plate_custom === true);
    const plate = cleanPlate(f.plate as string, plateCustom);
    if (plateChanged && !plateIsValid(plate, plateCustom)) {
      setLocalError(fillVars(t('dossier.plateInvalid'), { n: PLATE_MIN }));
      return;
    }
    const payload = buildPayload(plateChanged ? { ...f, plate } : f, companyId);
    // Carte grise déjà déposée sous l'identifiant fixé d'avance : la moto le reprend.
    onSubmit(!initial && scan ? { ...payload, id: pendingId } : payload, { ownerFrom, scan: initial ? null : scan });
  };

  // Marque, modèle, année : au choix dans les listes, ou à la main pour un cas hors catalogue.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [modelManual, setModelManual] = useState(false);
  const siblingYears = useQuery({
    queryKey: ['catalog-sibling-years', modelYearId],
    queryFn: async () => {
      const c = await getModelYearContext(modelYearId);
      return c ? listCatalogModelYears(c.model_id) : [];
    },
    enabled: !!modelYearId, staleTime: 3_600_000,
  });
  const pickCatalogModel = (c: ChosenModel) => {
    // Les caractéristiques remplies pour l'ancien choix repartent du nouveau modèle ; une saisie reste.
    const auto = ['displacement', 'power_cv', 'power_kw', 'cylinders', 'antipollution', 'energy', 'category'];
    setF((p) => {
      const n: F = { ...p, brand: c.brand, model: c.model, model_year: c.year != null ? String(c.year) : '', ducati_model_year_id: c.modelYearId };
      for (const k of auto) if (vinFilled.has(k)) n[k] = '';
      return n;
    });
    setVinFilled((s) => { const n = new Set(s); for (const k of [...auto, 'brand', 'model', 'model_year']) n.delete(k); return n; });
    setModelManual(false);
    setChooserOpen(false);
  };
  const onBrand = (v: string) => {
    set('brand', v);
    if (!isDucatiBrand(v) && modelYearId) set('ducati_model_year_id', '');
  };
  const onYear = (v: string) => {
    const y = (siblingYears.data ?? []).find((x) => String(x.year) === v);
    if (y && y.id !== modelYearId) pickCatalogModel({ brand: String(f.brand || 'DUCATI'), model: String(f.model ?? ''), year: y.year, modelYearId: y.id });
    else if (!y) set('model_year', v);
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

  const C = (k: string, label: string, options: readonly string[], numeric = false) => (
    <Field label={label} code={CARTE_GRISE_CODES[k]}>
      <SpecSelect value={String(f[k] ?? '')} options={options} onChange={(v) => set(k, v)} className={hl(k)} numeric={numeric} />
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
            {clientScanPath && (
              <Button type="button" variant="outline" disabled={cgBusy} onClick={onClientScan}>
                {cgBusy ? <Loader2 className="animate-spin" /> : <ScanText />} {t('motoClient.readClientCg')}
              </Button>
            )}
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
            onBlur={() => { if (f.vin && !String(f.vin).includes('*')) set('vin', normalizeVin(f.vin as string)); }}
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
        {/* Utiles en permanence : en tête de l'identification, à côté du VIN. */}
        {D('first_registration_date', t('vehicles.firstRegistration'))}
        {N('mileage', t('vehicles.mileage'))}
        {D('warranty_end', t('vehicles.warrantyEnd'))}
        <Field label={t('vehicles.warrantyType')}>
          <SpecSelect value={String(f.warranty_type ?? '')} options={warrantyTypesFor(f)} allowOther={false} clearable className={hl('warranty_type')}
            onChange={(v) => { set('warranty_type', v); if (!isCarGarantie(v)) set('warranty_plan', ''); }} />
          {cgHint('warranty_type')}
          {isCarGarantie(f.warranty_type) && (
            <SpecSelect value={String(f.warranty_plan ?? '')} options={CARGARANTIE_PLANS} allowOther={false} placeholder={t('dossier.warrantyPlan')}
              className={f.warranty_plan ? '' : 'border-warning'} onChange={(v) => set('warranty_plan', v)} />
          )}
        </Field>
        <Field label={t('vehicles.modelYear')} code={CARTE_GRISE_CODES.model_year}>
          <SpecSelect value={String(f.model_year ?? '')} numeric allowOther={!modelYearId} onChange={onYear} className={hl('model_year')}
            options={modelYearId && siblingYears.data?.length
              ? siblingYears.data.map((y) => String(y.year)).filter((y) => y !== 'null')
              : yearOptions(new Date().getFullYear())} />
          {cgHint('model_year')}
        </Field>
        <div className="col-span-full">
          <VinIdentifyPanel
            vin={vin.normalized} values={vinValues} onApply={applyVin}
            modelYearId={(f.ducati_model_year_id as string) || null}
            onModelYearChange={(id) => set('ducati_model_year_id', id ?? '')}
            autoApply={!initial || vinChanged}
            onAutoFilled={(keys) => markVinFilled(keys.map((k) => VIN_FIELD[k]))}
            hints={vinHints}
          />
        </div>
        {!initial && duplicates.length === 0 && (
          <VinSuggestions companyId={companyId} term={f.vin as string} client={client} ownerFrom={ownerFrom} onAttach={onAttachExisting} attaching={attaching} />
        )}
        <Field label={t('vehicles.plate')} code={CARTE_GRISE_CODES.plate}>
          <Input value={f.plate as string} onChange={(e) => set('plate', plateInput(e.target.value, f.plate_custom === true))}
            className={`font-mono ${hl('plate')}`} autoCapitalize="characters" spellCheck={false} />
          {cgHint('plate')}
          <Check label={t('dossier.plateCustom')} checked={f.plate_custom === true}
            onChange={(v) => { set('plate_custom', v); if (!v) set('plate', normalizePlate(f.plate as string)); }} />
        </Field>
        <Field label={t('vehicles.brand')} code={CARTE_GRISE_CODES.brand}>
          <SpecSelect value={String(f.brand ?? '')} options={VEHICLE_BRANDS} onChange={onBrand} className={hl('brand')} />
          {cgHint('brand')}
        </Field>
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
        {isDucatiBrand(f.brand) && !modelManual ? (
          <Field label={t('vehicles.model')} code={CARTE_GRISE_CODES.model}>
            <Button type="button" variant="outline" onClick={() => setChooserOpen(true)} className={`w-full justify-between font-normal ${hl('model')}`}>
              <span className="truncate">{String(f.model ?? '') || t('dossier.modelPick')}</span>
              <ChevronDown className="size-4 shrink-0 opacity-60" />
            </Button>
            {cgHint('model')}
          </Field>
        ) : T('model', t('vehicles.model'))}
        {chooserOpen && (
          <ModelChooserDialog currentModelYearId={modelYearId || null} onPick={pickCatalogModel} onClose={() => setChooserOpen(false)}
            onManual={() => { setModelManual(true); setChooserOpen(false); if (modelYearId) set('ducati_model_year_id', ''); }} />
        )}
        {T('engine_number', t('vehicles.engineNumber'), true)}
        {T('reference', t('vehicles.reference'), true)}
        {T('origin', t('vehicles.origin'))}
        {T('production_code', t('vehicles.productionCode'))}
        <div className="col-span-full">
          <Check label={t('vehicles.papers100hp')} checked={f.papers_100hp === true} onChange={(v) => set('papers_100hp', v)} />
        </div>
      </Section>

      <Section title={t('vehicles.secInfo')}>
        {T('gps_tracker_id', t('vehicles.gpsTracker'))}
        {T('pin_tracker', t('vehicles.pinTracker'))}
        {T('tpms_av', t('vehicles.tpmsAv'))}
        {T('tpms_ar', t('vehicles.tpmsAr'))}
        {D('next_inspection_date', t('vehicles.nextInspection'))}
        {T('key_number', t('vehicles.keyNumber'))}
        {T('key_number2', t('vehicles.keyNumber2'))}
        {T('antitheft_code', t('vehicles.antitheftCode'))}
        {T('police_book_number', t('vehicles.policeBook'))}
        {N('warranty_months', t('parcG8.warrantyMonths'))}
        {T('exposition_code', t('vehicles.expositionCode'))}
        <div className="col-span-full">
          <Check label={t('vehicles.restricted')} checked={f.is_restricted === true} onChange={(v) => set('is_restricted', v)} />
        </div>
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
          {N('market_value', t('parcG8.ecoMarket'), '0.01')}
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

      <Section title={t('vehicles.secCarac')}>
        <p className="col-span-full text-[12px] text-muted-foreground">{t('motoClient.caracHint')}</p>
        {C('displacement', t('vehicles.displacement'), specOptions.data?.displacement ?? [], true)}
        {C('power_kw', t('vehicles.powerKw'), specOptions.data?.power_kw ?? [], true)}
        {C('power_cv', t('vehicles.powerCv'), specOptions.data?.power_cv ?? [], true)}
        {C('energy', t('vehicles.energy'), ENERGY_OPTIONS)}
        {C('antipollution', t('vehicles.antipollution'), ANTIPOLLUTION_OPTIONS)}
        {C('color', t('vehicles.color'), COLOR_OPTIONS)}
        {C('category', t('vehicles.category'), VEHICLE_FAMILIES)}
        {C('cylinders', t('vehicles.cylinders'), CYLINDER_OPTIONS, true)}
      </Section>

      {(localError || error) && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{localError || error}</p>
      )}
      {/* Barre collée en bas (revue UX/UI) : le seul bouton rouge de la fiche reste visible pendant la saisie. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
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
      {/* Revue UX/UI : le libellé d'abord, le code de la carte grise (E, D.1…) en petit à droite. */}
      <Label className="flex items-baseline justify-between gap-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
        <span>{label}</span>
        {code && (
          <span title={`${t('motoClient.cgCode')} ${code}`} className="shrink-0 font-mono text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
            {code}
          </span>
        )}
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
