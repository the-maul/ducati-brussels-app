/**
 * M7 — Assistant de reprise moto (parcours client, mobile-first).
 * Étapes : type (part./pro) → déjà client ? → retrouver / créer la fiche →
 * données du véhicule → photos → envoi. L'envoi crée la reprise (article
 * occasion + véhicule + stock + ORO + lien vendeur), téléverse les photos
 * (GED véhicule), trace une communication sur la fiche client, crée un lead
 * CRM (source « Reprise ») et diffuse aux marchands partenaires (mailto)
 * selon le mode d'envoi. Pensé tablette/smartphone, réutilisable sur le site.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, Check, X, Search, User, Building2, Recycle, Pencil, Camera,
  Bike, Gauge, Hash, Cog, FileText, CheckCircle2, Printer, Mail, Image,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { createContact, contactDisplayName } from '@/modules/contacts/api';
import { uploadAttachment } from '@/modules/documents/ged-api';
import { createLead, addCommunication } from '@/modules/crm/api';
import { createReprise } from './write-api';
import {
  listPartners, partnersForBrand, getDispatchMode, buildDispatchMailto,
} from './partners-api';
import { printSheetForOro, DOCS_FOLDER, PHOTOS_FOLDER } from './sheet-builder';
import { findSpecs, modelsForBrand } from './moto-specs';
import {
  MOTO_BRANDS, FUELS, TRANSMISSIONS, OWNER_COUNTS, TECH_STATES, TECH_STATES_WITH_DESC,
  WEAR_STATES, TIRE_STATES, ACCESSORIES, COUNTRIES, PHOTO_SLOTS, DOC_SLOTS, FREE_PHOTO_SLOTS,
  years, kmSuggestions, ccSuggestions, convertPower, powerConversionLabel, normalizeVat, phonePrefixFor,
  type PowerUnit, type PhotoSlot,
} from './reprise-wizard-data';
import { t } from '@/lib/i18n';

type Step = 'type' | 'docs' | 'client' | 'existing' | 'new' | 'vehicle' | 'photos' | 'done';
const num = (s: string) => { const n = Number(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

type FoundContact = { id: string; first_name: string | null; last_name: string | null; company_name: string | null; vat_number: string | null; email: string | null; mobile: string | null };
type Created = { oroId: string; vehicleId: string; occNumber: string };

export function RepriseWizard({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('type');
  const [isPro, setIsPro] = useState(false);
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
    fuel: '', transmission: '', cc: '', owners: '', techState: '', techDesc: '', wear: '', tires: '',
    chassis: '', remarks: '',
  });
  const setVf = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
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
    if (v.fuel) lines.push(`Carburant : ${v.fuel}`);
    if (v.transmission) lines.push(`Transmission : ${v.transmission}`);
    if (v.owners) lines.push(`Propriétaires : ${v.owners}`);
    if (v.techState) lines.push(`État technique : ${v.techState}${v.techDesc ? ` — ${v.techDesc}` : ''}`);
    if (v.wear) lines.push(`Pièces d'usure : ${v.wear}`);
    if (v.tires) lines.push(`Pneus : ${v.tires}`);
    if (originalPaint != null) lines.push(`Peinture d'origine : ${originalPaint ? 'Oui' : 'Non'}`);
    if (imported != null) lines.push(`Véhicule importé : ${imported ? 'Oui' : 'Non'}`);
    if (v.papers100) lines.push('Papiers 100 CH : Oui');
    if (accessories.size) lines.push(`Accessoires : ${[...accessories].join(', ')}`);
    if (v.remarks.trim()) lines.push(`Remarques : ${v.remarks.trim()}`);
    return lines.join('\n');
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
        mileage: v.km ? Math.round(num(v.km)) : null,
        firstRegistrationDate: year ? `${year}-01-01` : null, modelYear: year,
        powerCv: conv ? conv.ch : null, powerKw: conv ? conv.kw : null,
        displacement: v.cc ? num(v.cc) : null, energy: v.fuel || null,
        notes: buildNotes() || null,
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
        if (url) window.location.href = url;
      }
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('tradein.errSave')),
  });

  // ── Fiche imprimable (PDF via impression) — données + photos depuis l'ERP ───
  const printSheet = () => {
    if (created) void printSheetForOro(created.oroId);
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
            <Button className="h-12" onClick={printSheet}><Printer /> {t('tradein.wizDoneSheet')}</Button>
            {mailto && (
              <Button variant="outline" className="h-12" onClick={() => { window.location.href = mailto; }}>
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
            <BigChoice icon={<User className="size-7" />} label={t('tradein.wizTypePart')} onClick={() => { setIsPro(false); setStep('client'); }} />
            <BigChoice icon={<Building2 className="size-7" />} label={t('tradein.wizTypePro')} onClick={() => { setIsPro(true); setStep('client'); }} />
          </div>
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

            <Field label={<>{t('tradein.vWear')} <span className="font-normal normal-case text-muted-foreground">{t('tradein.vWearHint')}</span></>} wide>
              <Select value={v.wear || undefined} onValueChange={(val) => setVf('wear', val)}>
                <SelectTrigger className="h-12 text-[15px] sm:max-w-xs"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
                <SelectContent>{WEAR_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('tradein.vTires')}>
              <Select value={v.tires || undefined} onValueChange={(val) => setVf('tires', val)}>
                <SelectTrigger className="h-12 text-[15px]"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
                <SelectContent>{TIRE_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={t('tradein.vChassis')}>
              <Input className="h-12 text-[15px] font-mono uppercase" value={v.chassis} onChange={(e) => setVf('chassis', e.target.value.toUpperCase())} maxLength={17} placeholder={t('tradein.vChassisPlaceholder')} />
            </Field>
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

// ── Case photo (prise de vue ou galerie, aperçu, reprendre) ──────────────────
const SLOT_ICONS: Record<string, ReactNode> = {
  face_avant: <Bike className="size-6" />,
  face_arriere: <Bike className="size-6 -scale-x-100" />,
  cote_gauche: <Bike className="size-6 -scale-x-100" />,
  cote_droit: <Bike className="size-6" />,
  compteur: <Gauge className="size-6" />,
  chassis: <Hash className="size-6" />,
  moteur: <Cog className="size-6" />,
};

function PhotoBox({ slot, file, onFile }: { slot: PhotoSlot; file: File | null; onFile: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handle = (f: File | undefined) => {
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    onFile(f);
  };

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <input
        ref={inputRef} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={(e) => { handle(e.target.files?.[0]); if (inputRef.current) inputRef.current.value = ''; }}
      />
      <button type="button" onClick={() => inputRef.current?.click()} className="block w-full text-left">
        {file && preview ? (
          <div className="relative">
            <img src={preview} alt={slot.label} className="h-24 w-full object-cover sm:h-28" />
            <span className="absolute right-1 top-1 rounded bg-success-bg px-1 py-0.5 text-[10px] font-bold text-success">
              <Check className="inline size-3" />
            </span>
          </div>
        ) : (
          <div className="grid h-24 w-full place-items-center bg-muted/50 text-muted-foreground sm:h-28">
            {slot.free ? <Image className="size-6" /> : slot.key.startsWith('doc_') ? <FileText className="size-6" /> : (SLOT_ICONS[slot.key] ?? <Camera className="size-6" />)}
          </div>
        )}
        <div className="flex items-center justify-between gap-1 px-2 py-1.5">
          <span className="truncate text-[11px] leading-tight">{slot.label}</span>
          <Camera className="size-3.5 shrink-0 text-muted-foreground" />
        </div>
      </button>
    </div>
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
