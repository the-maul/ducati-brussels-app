/**
 * M7 — Assistant de reprise moto (parcours client, mobile-first).
 * Étapes : type (part./pro) → déjà client ? → retrouver / créer la fiche →
 * données du véhicule → photos → envoi. L'envoi crée la reprise (article
 * occasion + véhicule + stock + ORO + lien vendeur), téléverse les photos
 * (GED véhicule), trace une communication sur la fiche client, crée un lead
 * CRM (source « Reprise ») et diffuse aux marchands partenaires (mailto)
 * selon le mode d'envoi. Pensé tablette/smartphone, réutilisable sur le site.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, Check, X, Search, User, Building2, Recycle, Pencil, Camera,
  Bike, Gauge, Hash, Cog, FileText, CheckCircle2, Download, Mail, Image,
  CircleDot, Disc3, ImagePlus, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { createContact, contactDisplayName } from '@/modules/contacts/api';
import { listOwnedVehicles, type OwnedVehicle } from '@/modules/contacts/subobjects-api';
import { uploadAttachment } from '@/modules/documents/ged-api';
import { createLead, addCommunication } from '@/modules/crm/api';
import { createReprise } from './write-api';
import { markRepriseSent } from './validate-api';
import {
  listPartners, partnersForBrand, getDispatchMode, buildDispatchMailto,
} from './partners-api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { downloadSheetForOro, DOCS_FOLDER, PHOTOS_FOLDER } from './sheet-builder';
import { findSpecs, modelsForBrand } from './moto-specs';
import {
  MOTO_BRANDS, FUELS, TRANSMISSIONS, OWNER_COUNTS, TECH_STATES, TECH_STATES_WITH_DESC,
  WEAR_STATES, WEAR_ITEMS, ACCESSORIES, COUNTRIES, PHOTO_SLOTS, DOC_SLOTS, FREE_PHOTO_SLOTS,
  years, kmSuggestions, ccSuggestions, convertPower, powerConversionLabel, normalizeVat, phonePrefixFor,
  type PowerUnit, type PhotoSlot,
} from './reprise-wizard-data';
import { PhotoEditor } from '@/components/photo-editor';
import { compressImageFile } from '@/lib/image-tools';
import { t } from '@/lib/i18n';

type Step = 'type' | 'docs' | 'client' | 'existing' | 'new' | 'vehicle' | 'photos' | 'done';
const num = (s: string) => { const n = Number(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

type FoundContact = { id: string; first_name: string | null; last_name: string | null; company_name: string | null; vat_number: string | null; email: string | null; mobile: string | null };
type Created = { oroId: string; vehicleId: string; occNumber: string };

export function RepriseWizard({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('type');
  const [isPro, setIsPro] = useState(false);
  // TVA déductible (pro uniquement) — demandé en pop-up au choix « Moto professionnel »
  const [vatDeductible, setVatDeductible] = useState<boolean | null>(null);
  const [vatDialogOpen, setVatDialogOpen] = useState(false);
  const [existing, setExisting] = useState<boolean | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactLabel, setContactLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  // Client — recherche (Oui) et création (Non)
  const [c, setC] = useState({
    lastName: '', firstName: '', company: '', vat: '', country: 'BE',
    phonePrefix: '+32', phone: '', email: '', address: '', zip: '', city: '',
  });
  const setCf = (k: keyof typeof c, v: string) => setC((p) => ({ ...p, [k]: v }));
  const [results, setResults] = useState<FoundContact[] | null>(null);

  // Véhicule
  const [v, setV] = useState({
    brand: '', model: '', year: '', km: '', powerUnit: 'ch' as PowerUnit, power: '', papers100: false,
    fuel: '', transmission: '', cc: '', owners: '', techState: '', techDesc: '',
    chassis: '', engine: '', remarks: '', wishedPrice: '', wishedPriceOnPdf: true,
  });
  const setVf = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
  // État des pièces d'usure, élément par élément (clé WEAR_ITEMS → état choisi)
  const [wear, setWear] = useState<Record<string, string>>({});
  const setWearItem = (key: string, val: string) => setWear((p) => ({ ...p, [key]: val }));
  const [originalPaint, setOriginalPaint] = useState<boolean | null>(null);
  const [imported, setImported] = useState<boolean | null>(null);
  const [accessories, setAccessories] = useState<Set<string>>(new Set());
  const toggleAcc = (a: string) => setAccessories((prev) => { const n = new Set(prev); if (n.has(a)) n.delete(a); else n.add(a); return n; });

  // Photos — 1 fichier par case (remplaçable)
  const [photos, setPhotos] = useState<Record<string, File>>({});
  const photoCount = Object.keys(photos).length;

  // Marchands (diffusion) — chargés en avance pour l'écran final
  const partnersQ = useQuery({ queryKey: ['tradein-partners', companyId], queryFn: () => listPartners(companyId) });
  const dispatchQ = useQuery({ queryKey: ['tradein-dispatch', companyId], queryFn: () => getDispatchMode(companyId) });

  const vehTitle = [v.brand, v.model].filter(Boolean).join(' ') || 'Occasion';
  const displayStep = step === 'type' || step === 'docs' ? 1 : step === 'client' ? 2 : step === 'existing' || step === 'new' ? 3 : step === 'vehicle' ? 4 : 5;
  const docsCount = DOC_SLOTS.filter((s) => photos[s.key]).length;

  // Préremplissage automatique des caractéristiques depuis la fiche modèle
  const [specsFilled, setSpecsFilled] = useState(false);
  const autofillSpecs = (brand: string, model: string) => {
    const spec = findSpecs(brand, model);
    if (!spec) { setSpecsFilled(false); return; }
    setV((p) => ({
      ...p,
      cc: p.cc || (spec.cc > 0 ? String(spec.cc) : p.cc),
      power: p.power || String(spec.ch),
      powerUnit: p.power ? p.powerUnit : 'ch',
      fuel: p.fuel || spec.fuel,
    }));
    setSpecsFilled(true);
  };

  // ── Pré-remplissage depuis le PARC du client (véhicules déjà possédés, B9) ───
  const parcQ = useQuery({
    queryKey: ['tradein-parc', contactId],
    queryFn: () => listOwnedVehicles(contactId!),
    enabled: !!contactId && step === 'vehicle',
  });
  const ownedVehicles = parcQ.data ?? [];
  const [parcFilled, setParcFilled] = useState(false);
  const fillFromVehicle = (veh: OwnedVehicle['vehicle']) => {
    setV((p) => ({
      ...p,
      brand: veh.brand ?? p.brand,
      model: veh.model ?? p.model,
      year: veh.model_year != null ? String(veh.model_year) : p.year,
      km: veh.mileage != null ? String(veh.mileage) : p.km,
      power: veh.power_cv != null ? String(veh.power_cv) : (veh.power_kw != null ? String(veh.power_kw) : p.power),
      powerUnit: veh.power_cv != null ? 'ch' : (veh.power_kw != null ? 'kw' : p.powerUnit),
      cc: veh.displacement != null ? String(veh.displacement) : p.cc,
      fuel: veh.energy ?? p.fuel,
      chassis: veh.vin ?? p.chassis,
      engine: veh.engine_number ?? p.engine,
    }));
    setParcFilled(true);
  };

  // ── Recherche client (Oui) ──────────────────────────────────────────────────
  const search = useMutation({
    mutationFn: async () => {
      const conds: string[] = [];
      if (c.lastName.trim()) conds.push(`last_name.ilike.%${c.lastName.trim()}%`);
      if (c.firstName.trim()) conds.push(`first_name.ilike.%${c.firstName.trim()}%`);
      if (c.company.trim()) conds.push(`company_name.ilike.%${c.company.trim()}%`);
      const vat = normalizeVat(c.vat);
      if (vat) conds.push(`vat_number.ilike.%${vat}%`);
      if (conds.length === 0) return [] as FoundContact[];
      const { data, error: e } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, company_name, vat_number, email, mobile')
        .eq('company_id', companyId)
        .or(conds.join(','))
        .limit(20);
      if (e) throw e;
      return (data ?? []) as FoundContact[];
    },
    onSuccess: (rows) => setResults(rows),
    onError: (e) => setError(e instanceof Error ? e.message : 'Erreur'),
  });

  const pickContact = (fc: FoundContact) => {
    setContactId(fc.id);
    setContactLabel(contactDisplayName(fc));
    setStep('vehicle');
  };

  // ── Création client (Non) ───────────────────────────────────────────────────
  const createClient = useMutation({
    mutationFn: async () => {
      const vat = normalizeVat(c.vat);
      const phone = c.phone.trim() ? `${c.phonePrefix} ${c.phone.trim()}` : null;
      const payload = {
        company_id: companyId,
        type: isPro ? 'professionnel' : 'particulier',
        status: 'prospect',
        first_name: c.firstName.trim() || null,
        last_name: c.lastName.trim() || null,
        company_name: isPro ? (c.company.trim() || null) : null,
        vat_number: isPro ? (vat || null) : null,
        email: c.email.trim() || null,
        mobile: phone,
        address: c.address.trim() || null,
        zip: c.zip.trim() || null,
        city: c.city.trim() || null,
        country: c.country,
      } as Parameters<typeof createContact>[0];
      return createContact(payload);
    },
    onSuccess: (ct) => { setContactId(ct.id); setContactLabel(contactDisplayName(ct)); setStep('vehicle'); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Erreur'),
  });

  // ── Résumé texte (notes véhicule, mail marchands, communication client) ─────
  const buildNotes = (): string => {
    const lines: string[] = [];
    if (isPro && vatDeductible != null) lines.push(`TVA déductible : ${vatDeductible ? 'Oui' : 'Non'}`);
    if (v.fuel) lines.push(`Carburant : ${v.fuel}`);
    if (v.transmission) lines.push(`Transmission : ${v.transmission}`);
    if (v.owners) lines.push(`Propriétaires : ${v.owners}`);
    if (v.techState) lines.push(`État technique : ${v.techState}${v.techDesc ? ` — ${v.techDesc}` : ''}`);
    for (const it of WEAR_ITEMS) {
      if (wear[it.key]) lines.push(`${it.label} : ${wear[it.key]}`);
    }
    if (originalPaint != null) lines.push(`Peinture d'origine : ${originalPaint ? 'Oui' : 'Non'}`);
    if (imported != null) lines.push(`Véhicule importé : ${imported ? 'Oui' : 'Non'}`);
    if (v.papers100) lines.push('Papiers 100 CH : Oui');
    if (accessories.size) lines.push(`Accessoires : ${[...accessories].join(', ')}`);
    if (v.wishedPrice.trim()) lines.push(`Prix souhaité : ${v.wishedPrice.trim()} €`);
    if (v.remarks.trim()) lines.push(`Remarques : ${v.remarks.trim()}`);
    return lines.join('\n');
  };

  // Notes stockées sur le véhicule : résumé + marqueur de visibilité PDF du
  // prix souhaité (parsé/retiré par sheet-builder). Le marqueur n'est PAS
  // envoyé aux marchands (buildNotes seul y va).
  const buildVehicleNotes = (): string => {
    const base = buildNotes();
    if (!v.wishedPrice.trim()) return base;
    return `${base}\nPrix souhaité visible PDF : ${v.wishedPriceOnPdf ? 'Oui' : 'Non'}`;
  };

  const buildDetails = (): string => {
    const pw = num(v.power);
    const conv = pw > 0 ? convertPower(pw, v.powerUnit) : null;
    const lines = [
      `${vehTitle}`,
      v.year ? `Année : ${v.year}` : '',
      v.km ? `Kilométrage : ${v.km} km` : '',
      conv ? `Puissance : ${conv.ch} ch (${conv.kw} kW)` : '',
      v.cc ? `Cylindrée : ${v.cc} cm³` : '',
      v.chassis ? `Châssis : ${v.chassis.toUpperCase()}` : '',
      buildNotes(),
    ].filter(Boolean);
    return lines.join('\n');
  };

  const dispatchMailto = (): string | null => {
    const partners = partnersForBrand(partnersQ.data ?? [], v.brand);
    return buildDispatchMailto(
      partners,
      t('tradein.dispatchSubject').replace('{title}', vehTitle),
      t('tradein.dispatchBody').replace('{details}', buildDetails()).replace('{company}', t('app.name')),
    );
  };

  // ── Envoi final : reprise + photos + lead + diffusion ───────────────────────
  const send = useMutation({
    mutationFn: async (): Promise<Created> => {
      const pw = num(v.power);
      const conv = pw > 0 ? convertPower(pw, v.powerUnit) : null;
      const year = v.year ? parseInt(v.year, 10) : null;
      // 1. Reprise (article O/P + véhicule + stock + ORO + lien vendeur)
      const r = await createReprise({
        companyId, isPro, contactId,
        designation: vehTitle,
        brand: v.brand || null, model: v.model || null, vin: v.chassis.trim().toUpperCase() || null,
        engineNumber: v.engine.trim().toUpperCase() || null,
        mileage: v.km ? Math.round(num(v.km)) : null,
        firstRegistrationDate: year ? `${year}-01-01` : null, modelYear: year,
        powerCv: conv ? conv.ch : null, powerKw: conv ? conv.kw : null,
        displacement: v.cc ? num(v.cc) : null, energy: v.fuel || null,
        notes: buildVehicleNotes() || null,
        reprisePrice: 0, // estimation à faire par le magasin
      });
      // 2. Photos → GED du véhicule (photos : « Reprise » ; documents : « Reprise-Documents »)
      const stamp = Date.now();
      const slots = [...PHOTO_SLOTS, ...FREE_PHOTO_SLOTS, ...DOC_SLOTS];
      let i = 0;
      for (const slot of slots) {
        const file = photos[slot.key];
        if (!file) continue;
        const folder = slot.key.startsWith('doc_') ? DOCS_FOLDER : PHOTOS_FOLDER;
        try {
          await uploadAttachment(companyId, 'vehicle', r.vehicleId, file, stamp + i++, slot.label, folder);
        } catch { /* photo non bloquante */ }
      }
      // 3. Trace sur la fiche client + lead CRM (source Reprise)
      if (contactId) {
        try {
          await addCommunication({
            companyId, contactId, channel: 'note', direction: 'in',
            subject: `Demande de reprise ${r.occNumber}`, body: buildDetails(),
          });
        } catch { /* non bloquant */ }
      }
      try {
        await createLead({
          companyId, name: contactLabel || vehTitle, vehicleInterest: vehTitle,
          source: 'REP', contactId: contactId ?? undefined,
          email: c.email.trim() || undefined, phone: c.phone.trim() ? `${c.phonePrefix} ${c.phone.trim()}` : undefined,
          oroId: r.oroId, repriseStatus: 'collecte',
        });
      } catch { /* non bloquant */ }
      return r;
    },
    onSuccess: (r) => {
      setCreated(r);
      setStep('done');
      // Mode automatique → ouvre directement le mail aux marchands de la marque
      if (dispatchQ.data === 'auto') {
        const url = dispatchMailto();
        if (url) {
          void markRepriseSent(r.oroId, 'collecte'); // statut → Envoyé
          window.location.href = url;
        }
      }
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('tradein.errSave')),
  });

  // ── Fiche PDF téléchargée directement (Téléchargements du navigateur) ───────
  const printSheet = () => {
    if (created) void downloadSheetForOro(created.oroId);
  };

  const back = () => {
    setError(null);
    if (step === 'client') setStep('type');
    else if (step === 'existing' || step === 'new') setStep('client');
    else if (step === 'vehicle') setStep(existing ? 'existing' : 'new');
    else if (step === 'photos') setStep('vehicle');
  };

  // ── Écran de succès ─────────────────────────────────────────────────────────
  if (step === 'done') {
    const mailto = dispatchQ.data !== 'auto' ? dispatchMailto() : null;
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-md border border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
          <CheckCircle2 className="mx-auto size-14 text-success" />
          <h2 className="mt-4 font-ui text-[20px] font-bold text-foreground">{t('tradein.wizDoneTitle')}</h2>
          <p className="mt-2 text-[13px] text-muted-foreground">{t('tradein.wizDoneHint')}</p>
          {created && <p className="mt-2 font-mono text-[13px] text-muted-foreground">{created.occNumber}</p>}
          <div className="mt-6 grid gap-2">
            <Button className="h-12" onClick={printSheet}><Download /> {t('tradein.wizDoneSheet')}</Button>
            {mailto && created && (
              <Button variant="outline" className="h-12" onClick={() => { void markRepriseSent(created.oroId, 'collecte'); window.location.href = mailto; }}>
                <Mail /> {t('tradein.wizDoneDispatch')}
              </Button>
            )}
            {created && (
              <Button variant="outline" className="h-12" onClick={() => navigate({ to: '/tradein/$oroId', params: { oroId: created.oroId } })}>
                {t('tradein.wizDoneOpen')}
              </Button>
            )}
            <Button variant="ghost" className="h-12 text-[15px]" onClick={() => window.location.reload()}>{t('tradein.wizDoneNewRequest')}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progression (5 écrans) */}
      <div className="mb-6 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= displayStep ? 'bg-[var(--ducati-red)]' : 'bg-border'}`} />
        ))}
      </div>

      {error && <p className="mb-4 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      {/* ── Étape 1 : type ───────────────────────────────────────────────────── */}
      {step === 'type' && (
        <Panel title={t('tradein.wizTypeTitle')}>
          {/* Avertissement documents — gros bouton interpellant, à toucher AVANT de choisir */}
          <button
            type="button"
            onClick={() => setStep('docs')}
            className="mb-4 flex w-full items-center gap-3 rounded-md bg-[var(--ducati-red)] px-4 py-4 text-left text-[14px] font-bold leading-snug text-primary-foreground shadow-[var(--shadow-card)] transition-transform hover:bg-[var(--ducati-red-dark)] active:scale-[0.99] sm:text-[15px]"
          >
            <Camera className="size-8 shrink-0" />
            <span>
              {t('tradein.docsWarn')}
              <span className="mt-1 block text-[12px] font-normal underline underline-offset-2 opacity-90">{t('tradein.docsWarnAction')}</span>
            </span>
          </button>
          {docsCount > 0 && (
            <p className="mb-4 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
              {t('tradein.docsAdded').replace('{n}', String(docsCount))}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <BigChoice icon={<User className="size-7" />} label={t('tradein.wizTypePart')} onClick={() => { setIsPro(false); setVatDeductible(null); setStep('client'); }} />
            <BigChoice icon={<Building2 className="size-7" />} label={t('tradein.wizTypePro')} onClick={() => setVatDialogOpen(true)} />
          </div>

          {/* Pop-up TVA déductible (moto professionnelle) */}
          <Dialog open={vatDialogOpen} onOpenChange={setVatDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t('tradein.vatQuestion')}</DialogTitle>
                <DialogDescription>{t('tradein.vatHint')}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <BigChoice icon={<Check className="size-6 text-success" />} label={t('tradein.wizYes')}
                  onClick={() => { setVatDeductible(true); setIsPro(true); setVatDialogOpen(false); setStep('client'); }} />
                <BigChoice icon={<X className="size-6 text-muted-foreground" />} label={t('tradein.wizNo')}
                  onClick={() => { setVatDeductible(false); setIsPro(true); setVatDialogOpen(false); setStep('client'); }} />
              </div>
            </DialogContent>
          </Dialog>
        </Panel>
      )}

      {/* ── Module documents (depuis le bouton rouge) ────────────────────────── */}
      {step === 'docs' && (
        <Panel title={t('tradein.docsTitle')} hint={t('tradein.docsHint')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DOC_SLOTS.map((slot) => (
              <PhotoBox key={slot.key} slot={slot} file={photos[slot.key] ?? null}
                onFile={(f) => setPhotos((p) => { const n = { ...p }; if (f) n[slot.key] = f; else delete n[slot.key]; return n; })} />
            ))}
          </div>
          {docsCount > 0 && (
            <p className="mt-3 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
              {t('tradein.docsAdded').replace('{n}', String(docsCount))}
            </p>
          )}
          <StepFooter onBack={() => setStep('type')} next={{ label: t('tradein.wizNext'), onClick: () => setStep('type') }} />
        </Panel>
      )}

      {/* ── Étape 2 : déjà client ? ──────────────────────────────────────────── */}
      {step === 'client' && (
        <Panel title={t('tradein.wizClientTitle')} recap={<Recap onEdit={() => setStep('type')}>{isPro ? t('tradein.wizTypePro') : t('tradein.wizTypePart')}</Recap>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <BigChoice icon={<Check className="size-6 text-success" />} label={t('tradein.wizYes')} onClick={() => { setExisting(true); setResults(null); setStep('existing'); }} />
            <BigChoice icon={<X className="size-6 text-muted-foreground" />} label={t('tradein.wizNo')} onClick={() => { setExisting(false); setStep('new'); }} />
          </div>
        </Panel>
      )}

      {/* ── Étape 3a : retrouver le client (Oui) ─────────────────────────────── */}
      {step === 'existing' && (
        <Panel title={t('tradein.wizFindTitle')} hint={t('tradein.wizFindHint')} recap={<Recap onEdit={() => setStep('type')}>{isPro ? t('tradein.wizTypePro') : t('tradein.wizTypePart')}</Recap>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {isPro && <Field label={t('tradein.fCompany')}><Input className="h-12 text-[15px]" value={c.company} onChange={(e) => setCf('company', e.target.value)} /></Field>}
            <Field label={t('tradein.fLastName')}><Input className="h-12 text-[15px]" value={c.lastName} onChange={(e) => setCf('lastName', e.target.value)} /></Field>
            <Field label={t('tradein.fFirstName')}><Input className="h-12 text-[15px]" value={c.firstName} onChange={(e) => setCf('firstName', e.target.value)} /></Field>
            <Field label={t('tradein.fVat')}>
              <Input className="h-12 text-[15px] font-mono uppercase" value={c.vat} onChange={(e) => setCf('vat', normalizeVat(e.target.value))} placeholder={t('tradein.fVatPlaceholder')} />
            </Field>
          </div>
          <div className="mt-3">
            <Button variant="outline" className="h-12 text-[15px] w-full sm:w-auto" onClick={() => search.mutate()} disabled={search.isPending}>
              {search.isPending ? <Loader2 className="animate-spin" /> : <Search />} {t('tradein.wizSearch')}
            </Button>
          </div>

          {results && results.length === 0 && (
            <div className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
              {t('tradein.wizNoResult')}
              <Button variant="outline" size="sm" className="ml-2" onClick={() => { setExisting(false); setStep('new'); }}>{t('tradein.wizNewTitle')}</Button>
            </div>
          )}
          {results && results.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.wizResults')}</p>
              {results.map((fc) => (
                <button key={fc.id} type="button" onClick={() => pickContact(fc)}
                  className="flex w-full items-center justify-between rounded-md border border-border px-3 py-3 text-left hover:border-[var(--ducati-red)] hover:bg-accent">
                  <span>
                    <span className="font-bold">{contactDisplayName(fc)}</span>
                    <span className="block text-[12px] text-muted-foreground">{[fc.vat_number, fc.email, fc.mobile].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                  <span className="text-[13px] font-bold text-[var(--ducati-red)]">{t('tradein.wizSelect')}</span>
                </button>
              ))}
            </div>
          )}

          <StepFooter onBack={back} />
        </Panel>
      )}

      {/* ── Étape 3b : nouveau client (Non) ──────────────────────────────────── */}
      {step === 'new' && (
        <Panel title={t('tradein.wizNewTitle')} hint={t('tradein.wizNewHint')} recap={<Recap onEdit={() => setStep('type')}>{isPro ? t('tradein.wizTypePro') : t('tradein.wizTypePart')}</Recap>}>
          {isPro && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('tradein.fCompany')} wide><Input className="h-12 text-[15px]" value={c.company} onChange={(e) => setCf('company', e.target.value)} /></Field>
              <Field label={t('tradein.fVat')}><Input className="h-12 text-[15px] font-mono uppercase" value={c.vat} onChange={(e) => setCf('vat', normalizeVat(e.target.value))} placeholder={t('tradein.fVatPlaceholder')} /></Field>
            </div>
          )}
          {isPro && <p className="mt-4 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.wizPersonSection')}</p>}
          <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('tradein.fLastName')}><Input className="h-12 text-[15px]" value={c.lastName} onChange={(e) => setCf('lastName', e.target.value)} /></Field>
            <Field label={t('tradein.fFirstName')}><Input className="h-12 text-[15px]" value={c.firstName} onChange={(e) => setCf('firstName', e.target.value)} /></Field>
            <Field label={t('contacts.country')}>
              <Select value={c.country} onValueChange={(val) => { setCf('country', val); setCf('phonePrefix', phonePrefixFor(val)); }}>
                <SelectTrigger className="h-12 text-[15px]"><SelectValue /></SelectTrigger>
                <SelectContent>{COUNTRIES.map((co) => <SelectItem key={co.code} value={co.code}>{co.label} ({co.code})</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('tradein.fPhone')}>
              <div className="flex gap-1">
                <Input className="h-12 text-[15px] w-[74px] text-center font-mono" value={c.phonePrefix} onChange={(e) => setCf('phonePrefix', e.target.value)} />
                <Input className="h-12 text-[15px] flex-1" type="tel" value={c.phone} onChange={(e) => setCf('phone', e.target.value)} placeholder="470 12 34 56" />
              </div>
            </Field>
            <Field label={t('tradein.fEmail')} wide><Input className="h-12 text-[15px]" type="email" value={c.email} onChange={(e) => setCf('email', e.target.value)} /></Field>
            <Field label={t('tradein.fAddress')} wide><Input className="h-12 text-[15px]" value={c.address} onChange={(e) => setCf('address', e.target.value)} /></Field>
            <Field label={t('tradein.fZip')}><Input className="h-12 text-[15px]" value={c.zip} onChange={(e) => setCf('zip', e.target.value)} /></Field>
            <Field label={t('tradein.fCity')}><Input className="h-12 text-[15px]" value={c.city} onChange={(e) => setCf('city', e.target.value)} /></Field>
          </div>
          <StepFooter
            onBack={back}
            next={{
              label: t('tradein.wizNext'),
              pending: createClient.isPending,
              disabled: !c.lastName.trim() && !c.company.trim(),
              onClick: () => { setError(null); createClient.mutate(); },
            }}
          />
        </Panel>
      )}

      {/* ── Étape 4 : données du véhicule ────────────────────────────────────── */}
      {step === 'vehicle' && (
        <Panel title={t('tradein.wizVehTitle')} recap={<Recap onEdit={() => setStep(existing ? 'existing' : 'new')}>{(isPro ? t('tradein.wizAnswerPro') : t('tradein.wizAnswerPart')) + (contactLabel ? ` · ${contactLabel}` : '')}</Recap>}>
          {/* Parc du client : pré-remplissage si le client possède déjà des véhicules */}
          {ownedVehicles.length > 0 && (
            <div className="mb-4 rounded-md border border-[var(--ducati-red)]/40 bg-[var(--ducati-red-tint)] p-3">
              <p className="mb-2 flex items-center gap-2 text-[13px] font-bold text-foreground">
                <Bike className="size-4 shrink-0 text-[var(--ducati-red)]" />
                {t('tradein.parcFound').replace('{n}', String(ownedVehicles.length))}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ownedVehicles.map((ov) => (
                  <button
                    key={ov.vehicle.id}
                    type="button"
                    onClick={() => fillFromVehicle(ov.vehicle)}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-left hover:border-[var(--ducati-red)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold">{[ov.vehicle.brand, ov.vehicle.model].filter(Boolean).join(' ') || '—'}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {[ov.vehicle.model_year, ov.vehicle.vin ? `…${ov.vehicle.vin.slice(-6)}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] font-bold text-[var(--ducati-red)]">{t('tradein.parcFillHint')}</span>
                  </button>
                ))}
              </div>
              {parcFilled && <p className="mt-2 text-[12px] text-success">{t('tradein.parcFilled')}</p>}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('tradein.vBrand')}>
              <Select value={v.brand || undefined} onValueChange={(val) => setVf('brand', val)}>
                <SelectTrigger className="h-12 text-[15px]"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
                <SelectContent>{MOTO_BRANDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('tradein.vModel')}>
              <Input
                className="h-12 text-[15px]" list="wiz-models" value={v.model}
                onChange={(e) => { setVf('model', e.target.value); autofillSpecs(v.brand, e.target.value); }}
                placeholder={t('tradein.wizChoose')}
              />
              <datalist id="wiz-models">{modelsForBrand(v.brand).map((m) => <option key={m} value={m} />)}</datalist>
              {specsFilled && <p className="mt-1 text-[12px] text-info">{t('tradein.specsFilled')}</p>}
            </Field>
            {/* N° de châssis + n° moteur (juste après marque/modèle ; absents du PDF partagé) */}
            <Field label={t('tradein.vChassis')}>
              <Input className="h-12 text-[15px] font-mono uppercase" value={v.chassis} onChange={(e) => setVf('chassis', e.target.value.toUpperCase())} maxLength={17} placeholder={t('tradein.vChassisPlaceholder')} />
            </Field>
            <Field label={t('tradein.vEngine')}>
              <Input className="h-12 text-[15px] font-mono uppercase" value={v.engine} onChange={(e) => setVf('engine', e.target.value.toUpperCase())} placeholder={t('tradein.vEnginePlaceholder')} />
            </Field>
            <Field label={t('tradein.vYear')}>
              <Select value={v.year || undefined} onValueChange={(val) => setVf('year', val)}>
                <SelectTrigger className="h-12 text-[15px]"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
                <SelectContent>{years().map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('tradein.vKm')}>
              <Input className="h-12 text-[15px] text-right tabular-nums" list="wiz-km" inputMode="numeric" value={v.km} onChange={(e) => setVf('km', e.target.value)} placeholder={t('tradein.vKmPlaceholder')} />
              <datalist id="wiz-km">{kmSuggestions().map((k) => <option key={k} value={k} />)}</datalist>
            </Field>

            {/* Puissance : unité + valeur + conversion + papiers 100 CH */}
            <Field label={t('tradein.vPower')}>
              <div className="flex gap-2">
                <Select value={v.powerUnit} onValueChange={(val) => setVf('powerUnit', val as PowerUnit)}>
                  <SelectTrigger className="h-12 text-[15px] w-24"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ch">CH</SelectItem><SelectItem value="kw">kW</SelectItem></SelectContent>
                </Select>
                <Input className="h-12 text-[15px] flex-1 text-right tabular-nums" inputMode="numeric" value={v.power} onChange={(e) => setVf('power', e.target.value)} placeholder={t('tradein.vPowerPlaceholder')} />
              </div>
              {num(v.power) > 0 && <p className="mt-1 text-[12px] text-muted-foreground">({powerConversionLabel(num(v.power), v.powerUnit)})</p>}
              <label className="mt-1.5 flex items-center gap-2 text-[13px]">
                <Checkbox checked={v.papers100} onCheckedChange={(val) => setVf('papers100', val === true)} /> {t('tradein.vPapers100')}
              </label>
            </Field>

            <Field label={t('tradein.vFuel')}>
              <Select value={v.fuel || undefined} onValueChange={(val) => setVf('fuel', val)}>
                <SelectTrigger className="h-12 text-[15px]"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
                <SelectContent>{FUELS.map((fu) => <SelectItem key={fu} value={fu}>{fu}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('tradein.vTransmission')}>
              <Select value={v.transmission || undefined} onValueChange={(val) => setVf('transmission', val)}>
                <SelectTrigger className="h-12 text-[15px]"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
                <SelectContent>{TRANSMISSIONS.map((tr) => <SelectItem key={tr} value={tr}>{tr}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('tradein.vCc')}>
              <Input className="h-12 text-[15px] text-right tabular-nums" list="wiz-cc" inputMode="numeric" value={v.cc} onChange={(e) => setVf('cc', e.target.value)} placeholder={t('tradein.vCcPlaceholder')} />
              <datalist id="wiz-cc">{ccSuggestions().map((cc) => <option key={cc} value={cc} />)}</datalist>
            </Field>
            <Field label={t('tradein.vOwners')}>
              <Select value={v.owners || undefined} onValueChange={(val) => setVf('owners', val)}>
                <SelectTrigger className="h-12 text-[15px]"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
                <SelectContent>{OWNER_COUNTS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </Field>

            <Field label={t('tradein.vTechState')}>
              <Select value={v.techState || undefined} onValueChange={(val) => setVf('techState', val)}>
                <SelectTrigger className="h-12 text-[15px]"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
                <SelectContent>{TECH_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {TECH_STATES_WITH_DESC.includes(v.techState) && (
              <Field label={t('tradein.vTechDesc')} wide>
                <Textarea value={v.techDesc} onChange={(e) => setVf('techDesc', e.target.value)} rows={3} placeholder={t('tradein.vTechDesc')} />
              </Field>
            )}

            {/* État des pièces d'usure — un menu par élément (remplace l'ancien
                champ unique + le champ « Pneus » qui faisait doublon). */}
            <div className="sm:col-span-2">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                {t('tradein.vWear')}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {WEAR_ITEMS.map((it) => (
                  <div key={it.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                    <span className="text-[14px]">{it.label}</span>
                    <Select value={wear[it.key] || undefined} onValueChange={(val) => setWearItem(it.key, val)}>
                      <SelectTrigger className="h-10 w-[150px] shrink-0 text-[14px]">
                        <SelectValue placeholder={t('tradein.wizChoose')} />
                      </SelectTrigger>
                      <SelectContent>{WEAR_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Peinture / import — Oui / Non */}
          <div className="mt-4 space-y-2">
            <YesNoRow label={t('tradein.vOriginalPaint')} value={originalPaint} onChange={setOriginalPaint} />
            <YesNoRow label={t('tradein.vImported')} value={imported} onChange={setImported} />
          </div>

          {/* Accessoires & options */}
          <div className="mt-5">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.vAccessories')}</p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {ACCESSORIES.map((a) => (
                <label key={a} className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={accessories.has(a)} onCheckedChange={() => toggleAcc(a)} /> {a}
                </label>
              ))}
            </div>
          </div>

          {/* Remarques */}
          <div className="mt-5">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.vRemarks')}</p>
            <Textarea value={v.remarks} onChange={(e) => setVf('remarks', e.target.value)} rows={3} placeholder={t('tradein.vRemarksPlaceholder')} />
          </div>

          {/* Prix souhaité par le client + visibilité sur le PDF */}
          <div className="mt-5">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.vWishedPrice')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Input
                  inputMode="decimal" value={v.wishedPrice}
                  onChange={(e) => setVf('wishedPrice', e.target.value)}
                  placeholder="0,00" className="h-11 w-40 pr-8 text-right tabular-nums"
                />
                <span className="absolute right-3 top-2.5 text-muted-foreground">€</span>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px]">
                <Checkbox checked={v.wishedPriceOnPdf} onCheckedChange={(c) => setVf('wishedPriceOnPdf', c === true)} />
                {t('tradein.vWishedPriceOnPdf')}
              </label>
            </div>
          </div>

          <StepFooter
            onBack={back}
            next={{
              label: t('tradein.wizValidate'),
              disabled: !v.brand || !v.model.trim(),
              onClick: () => { setError(null); setStep('photos'); },
            }}
          />
        </Panel>
      )}

      {/* ── Étape 5 : photos ─────────────────────────────────────────────────── */}
      {step === 'photos' && (
        <Panel title={t('tradein.wizPhotosTitle')} hint={t('tradein.wizPhotosHint')} recap={<Recap onEdit={() => setStep('vehicle')}>{vehTitle}</Recap>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PHOTO_SLOTS.map((slot) => (
              <PhotoBox key={slot.key} slot={slot} file={photos[slot.key] ?? null}
                onFile={(f) => setPhotos((p) => { const n = { ...p }; if (f) n[slot.key] = f; else delete n[slot.key]; return n; })} />
            ))}
          </div>
          <p className="mb-2 mt-5 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.wizPhotoFree')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {FREE_PHOTO_SLOTS.map((slot) => (
              <PhotoBox key={slot.key} slot={slot} file={photos[slot.key] ?? null}
                onFile={(f) => setPhotos((p) => { const n = { ...p }; if (f) n[slot.key] = f; else delete n[slot.key]; return n; })} />
            ))}
          </div>

          {/* Documents (module « préparez vos documents ») — intégrés en fin d'étape */}
          <p className="mb-2 mt-5 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.docsSection')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DOC_SLOTS.map((slot) => (
              <PhotoBox key={slot.key} slot={slot} file={photos[slot.key] ?? null}
                onFile={(f) => setPhotos((p) => { const n = { ...p }; if (f) n[slot.key] = f; else delete n[slot.key]; return n; })} />
            ))}
          </div>

          {photoCount > 0 && (
            <p className="mt-3 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
              {t('tradein.wizPhotoTaken').replace('{n}', String(photoCount))}
            </p>
          )}

          <StepFooter
            onBack={back}
            next={{
              label: send.isPending ? t('tradein.wizSending') : t('tradein.wizSend'),
              icon: <Recycle />,
              pending: send.isPending,
              onClick: () => { setError(null); send.mutate(); },
            }}
          />
        </Panel>
      )}
    </div>
  );
}

// ── Case photo : appareil photo OU galerie, aperçu, retouche, suppression ────
const SLOT_ICONS: Record<string, ReactNode> = {
  face_avant: <Bike className="size-6" />,
  face_arriere: <Bike className="size-6 -scale-x-100" />,
  cote_gauche: <Bike className="size-6 -scale-x-100" />,
  cote_droit: <Bike className="size-6" />,
  compteur: <Gauge className="size-6" />,
  chassis: <Hash className="size-6" />,
  moteur: <Cog className="size-6" />,
  pneu_avant: <CircleDot className="size-6" />,
  pneu_arriere: <CircleDot className="size-6" />,
  plaquettes_avant: <Disc3 className="size-6" />,
  plaquettes_arriere: <Disc3 className="size-6" />,
};

function PhotoBox({ slot, file, onFile }: { slot: PhotoSlot; file: File | null; onFile: (f: File | null) => void }) {
  const camRef = useRef<HTMLInputElement>(null);     // appareil photo (mobile)
  const libRef = useRef<HTMLInputElement>(null);     // galerie / fichiers
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Aperçu DÉRIVÉ du fichier (état partagé entre étapes) : une photo prise dans
  // le module Documents reste visible dans l'étape Photos, et inversement.
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** Compression à l'ajout : photos ~2000 px, documents ~2400 px (texte lisible). */
  const handle = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      onFile(await compressImageFile(f, slot.key.startsWith('doc_') ? 'document' : 'upload'));
    } finally {
      setBusy(false);
    }
  };

  const isDoc = slot.key.startsWith('doc_');

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <input
        ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={(e) => { void handle(e.target.files?.[0]); if (camRef.current) camRef.current.value = ''; }}
      />
      <input
        ref={libRef} type="file" accept={isDoc ? 'image/*,application/pdf' : 'image/*'} className="sr-only"
        onChange={(e) => { void handle(e.target.files?.[0]); if (libRef.current) libRef.current.value = ''; }}
      />

      <div className="relative">
        {busy ? (
          <div className="grid h-24 w-full place-items-center bg-muted/50 sm:h-28">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : file && preview ? (
          <button type="button" onClick={() => setEditOpen(true)} className="block w-full" title={t('tradein.photoEdit')}>
            <img src={preview} alt={slot.label} className="h-24 w-full object-cover sm:h-28" />
            <span className="absolute right-1 top-1 rounded bg-success-bg px-1 py-0.5 text-[10px] font-bold text-success">
              <Check className="inline size-3" />
            </span>
          </button>
        ) : (
          <button type="button" onClick={() => camRef.current?.click()} className="block w-full">
            <div className="grid h-24 w-full place-items-center bg-muted/50 text-muted-foreground sm:h-28">
              {slot.free ? <Image className="size-6" /> : isDoc ? <FileText className="size-6" /> : (SLOT_ICONS[slot.key] ?? <Camera className="size-6" />)}
            </div>
          </button>
        )}
      </div>

      <div className="px-2 pb-1.5 pt-1.5">
        <p className="truncate text-[11px] leading-tight">{slot.label}</p>
        <div className="mt-1 flex items-center gap-1">
          <IconAction onClick={() => camRef.current?.click()} title={t('tradein.photoCamera')}><Camera className="size-3.5" /></IconAction>
          <IconAction onClick={() => libRef.current?.click()} title={t('tradein.photoGallery')}><ImagePlus className="size-3.5" /></IconAction>
          {file && file.type.startsWith('image/') && (
            <IconAction onClick={() => setEditOpen(true)} title={t('tradein.photoEdit')}><Pencil className="size-3.5" /></IconAction>
          )}
          {file && (
            <IconAction onClick={() => onFile(null)} title={t('tradein.photoRemove')}><Trash2 className="size-3.5" /></IconAction>
          )}
        </div>
      </div>

      {file && file.type.startsWith('image/') && (
        <PhotoEditor
          open={editOpen}
          onOpenChange={setEditOpen}
          file={file}
          title={slot.label}
          onSave={(f) => onFile(f)}
        />
      )}
    </div>
  );
}

function IconAction({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} title={title} aria-label={title}
      className="grid size-7 place-items-center rounded border border-border text-muted-foreground hover:border-[var(--ducati-red)] hover:text-[var(--ducati-red)]"
    >
      {children}
    </button>
  );
}

// ── Sous-composants ───────────────────────────────────────────────────────────
function Panel({ title, hint, recap, children }: { title: string; hint?: string; recap?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-4">
      {recap}
      <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 className="font-ui text-[18px] font-bold text-foreground">{title}</h2>
        {hint && <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function BigChoice({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex flex-col items-center justify-center gap-3 rounded-md border-2 border-border px-4 py-10 text-center text-[17px] font-bold uppercase tracking-[0.02em] text-foreground transition-colors hover:border-[var(--ducati-red)] hover:bg-accent active:scale-[0.99]">
      {icon}
      {label}
    </button>
  );
}

function Recap({ children, onEdit }: { children: ReactNode; onEdit: () => void }) {
  return (
    <button type="button" onClick={onEdit} className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-2.5 text-left text-[13px] hover:bg-accent">
      <span className="font-bold">{children}</span>
      <Pencil className="size-4 text-muted-foreground" />
    </button>
  );
}

function StepFooter({ onBack, next }: { onBack: () => void; next?: { label: string; icon?: ReactNode; pending?: boolean; disabled?: boolean; onClick: () => void } }) {
  return (
    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
      <Button variant="outline" className="h-12" onClick={onBack}><ArrowLeft /> {t('tradein.wizBack')}</Button>
      {next && (
        <Button className="h-12 flex-1 sm:flex-none" onClick={next.onClick} disabled={next.pending || next.disabled}>
          {next.pending ? <Loader2 className="animate-spin" /> : next.icon} {next.label}
        </Button>
      )}
    </div>
  );
}

function YesNoRow({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <span className="text-[14px]">{label}</span>
      <div className="flex gap-2">
        <Toggle active={value === true} onClick={() => onChange(true)}>{t('tradein.wizYes')}</Toggle>
        <Toggle active={value === false} onClick={() => onChange(false)}>{t('tradein.wizNo')}</Toggle>
      </div>
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`min-w-[64px] rounded-md border px-3 py-1.5 text-[13px] font-bold transition-colors ${active ? 'border-[var(--ducati-red)] bg-[var(--ducati-red-tint)] text-[var(--ducati-red)]' : 'border-border text-muted-foreground hover:bg-accent'}`}>
      {children}
    </button>
  );
}

function Field({ label, children, wide }: { label: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
