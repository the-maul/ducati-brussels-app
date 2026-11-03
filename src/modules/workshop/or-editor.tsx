/**
 * M8 — Éditeur d'ordre de réparation (OR). En-tête (client, VIN, km, motif d'entrée, type de
 * réparation, opérateur, statut, garantie, expert) + travaux, observations + lignes pièces/MO/texte
 * (garantie par ligne) + totaux.
 *
 * Depuis le 03/11 (ATE001b, retours client) : opérateur choisi dans l'équipe (connecté par défaut),
 * type de réparation en liste (Paramètres → Tables, pré-rempli par le motif), garantie et expert
 * seulement quand ils servent, recherche d'article partagée avec les ventes (surcouche, clavier),
 * prix de ligne tiré de l'article (HT déduit du TTC, TVA de l'article, remise client), main-d'oeuvre
 * au taux horaire de l'atelier. Règles pures : `or-page-rules.ts`, `sales/article-price.ts`.
 *
 * Depuis le 31/10 (ATE008 / ATE009) : onglet « Check-up » pensé tablette — une carte par action
 * (état, photo, temps, pièces, prix) — dont les cartes sont des lignes de l'OR réunies par
 * `checkup_key` (règles pures : `checkup/rules.ts`). Un seul état de lignes : les lignes
 * classiques ici, les cartes dans l'onglet ; à l'enregistrement, les deux sont réécrites ensemble.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Search, X, Save, ClipboardCheck, FileText } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { effectiveSaleHt, useRoundSalePrices } from '@/lib/pricing';
import { ArticleLinePicker } from '@/modules/sales/article-line-picker';
import { articleLinePrice, customerDiscountPct, labourUnitPrice } from '@/modules/sales/article-price';
import { resolveCustomerPrice } from '@/modules/contacts/pricing';
import { listCompanyTeam, listRepairTypes } from './or-page-api';
import {
  defaultOperator, operatorToSave, workshopTeamOptions, nextRepairType, legacyRepairType, matchRepairTypeCode,
  showExpertFields, showWarrantyField, type OperatorChoice,
} from './or-page-rules';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { listContacts, getContact, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { LinkedLines, useLinkedBrief } from '@/modules/contacts/linked-line';
import { type SaleArticle } from '@/modules/sales/write-api';
import { getVehicle, vehiclePickLabel } from '@/modules/vehicles/api';
import { VehiclePicker } from '@/modules/vehicles/vehicle-picker';
import { pickContact, clearContact, pickVehicle, clearVehicle, type ClientVehicleSelection, type VehiclePickRow } from '@/modules/vehicles/vehicle-pick';
import { type RepairOrderFull } from './api';
import { computeRoTotals, type RoLineInput } from './write-api';
import { loadHourlyRateHt } from './maintenance-api';
import { listWorkshopReasons } from './checkup/api';
import { cardsToLines, linesToCards, nonCheckupLines, PROPOSED_STATES, type CheckupCard } from './checkup/rules';
import { CheckupTab } from './checkup/checkup-tab';
import { t } from '@/lib/i18n';
import { useFormDraft } from '@/lib/use-form-draft';
import { FormDraftBanner } from '@/components/form-draft-banner';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const STATUSES = ['a_faire', 'en_cours', 'pret'] as const;
const WARRANTY = ['aucune', 'en_attente', 'accepte', 'refus_total', 'refus_partiel'] as const;
const NO_REASON = ' none';
const NO_VALUE = ' none';
const LEGACY = ' legacy';

type EditLine = RoLineInput & { _key: string };
let counter = 0;
const blankLine = (): EditLine => ({ _key: `ro${counter++}`, kind: 'piece', article_id: null, designation: '', quantity: 1, unit_price_ht: 0, vat_rate: 21, discount_pct: 0, is_warranty: false });

export type OrPayload = {
  contactId: string | null; vehicleId: string | null; mileage: number | null; operator: string;
  /** Membre de l'equipe choisi (null = personne / ancien texte seulement). */
  operatorId: string | null;
  repairType: string; workDescription: string; receptionNotes: string; status: string; warrantyStatus: string;
  expertName: string; expertDate: string; reasonCode: string | null; lines: RoLineInput[];
};

export type OrEditorIntent = 'save' | 'proposal';

export function OrEditor({ companyId, initial, defaultContactId = null, defaultVehicleId = null, busy, error, onSubmit, checkupReady = false, approvalPending = false, header, proposalActions, draftKey = null, onDraftDiscard }: {
  companyId: string; initial?: RepairOrderFull | null; busy: boolean; error?: string | null;
  /** Nouvel OR : cle du brouillon de saisie (UX011, `useFormDraft`) ; null en edition. */
  draftKey?: string | null;
  /** « Recommencer a zero » : l'appelant remonte l'editeur vierge. */
  onDraftDiscard?: () => void;
  /** Nouvel OR ouvert depuis une fiche client / moto : client et moto pre-remplis. */
  defaultContactId?: string | null; defaultVehicleId?: string | null;
  /** `intent = 'proposal'` : enregistrer puis envoyer la proposition au client. */
  onSubmit: (p: OrPayload, intent: OrEditorIntent) => void;
  /** La migration du check-up est en base (onglet et motif actifs). */
  checkupReady?: boolean;
  /** Accord client en attente : les cartes restent modifiables, le bandeau le rappelle. */
  approvalPending?: boolean;
  /** Bloc affiché au-dessus de l'éditeur (accord client). */
  header?: ReactNode;
  /** Boutons supplémentaires de la barre du check-up (faire signer, voir la proposition…). */
  proposalActions?: ReactNode;
}) {
  const o = initial?.or;
  const ox = (o ?? null) as (Record<string, unknown> | null);
  // Client + moto : deux cases independantes (ATE001) — choisir l'une ne touche jamais l'autre.
  const contactIdToLoad = o?.contact_id ?? defaultContactId;
  const vehicleIdToLoad = o?.vehicle_id ?? defaultVehicleId;
  const [sel, setSel] = useState<ClientVehicleSelection<Contact, VehiclePickRow>>({
    contact: null,
    vehicle: vehicleIdToLoad ? { id: vehicleIdToLoad, vin: null, plate: null, brand: null, model: null } : null,
  });
  const contact = sel.contact;
  const vehicle = sel.vehicle;
  const [mileage, setMileage] = useState(o?.mileage != null ? String(o.mileage) : '');
  // Operateur = un membre de l'equipe, l'utilisateur connecte par defaut (ATE001b) ; ancien texte garde.
  const { user, profile } = useAuth();
  const [operatorChoice, setOperatorChoice] = useState<OperatorChoice>(() => defaultOperator({
    isNew: !o, currentUserId: user?.id ?? null, members: [],
    savedOperatorId: (ox?.operator_id as string | null | undefined) ?? null, savedOperatorText: o?.operator ?? null,
  }));
  const [operatorTouched, setOperatorTouched] = useState(false);
  const [repairType, setRepairType] = useState(o?.repair_type ?? '');
  const [reasonCode, setReasonCode] = useState<string>((ox?.reason_code as string | null) ?? '');
  const [workDescription, setWork] = useState(o?.work_description ?? '');
  const [receptionNotes, setNotes] = useState(o?.reception_notes ?? '');
  const [status, setStatus] = useState(o?.status && o.status !== 'facture' && o.status !== 'annule' ? o.status : 'a_faire');
  const [warrantyStatus, setWarranty] = useState(o?.warranty_status ?? 'aucune');
  const [expertName, setExpertName] = useState(o?.expert_name ?? '');
  const [expertDate, setExpertDate] = useState(o?.expert_date ?? '');
  const initialLines = useMemo(() => (initial?.lines ?? []) as (RepairOrderFull['lines'][number] & { checkup_key?: string | null; checkup_state?: string | null; photo_path?: string | null; proposal_line_id?: string | null })[], [initial]);
  const [lines, setLines] = useState<EditLine[]>(() => {
    const classic = nonCheckupLines(initialLines);
    return classic.length
      ? classic.map((l) => ({ _key: `ro${counter++}`, kind: l.kind as RoLineInput['kind'], article_id: l.article_id, designation: l.designation, quantity: Number(l.quantity), unit_price_ht: Number(l.unit_price_ht), vat_rate: Number(l.vat_rate), discount_pct: Number(l.discount_pct), is_warranty: l.is_warranty }))
      : [blankLine()];
  });
  const [cards, setCards] = useState<CheckupCard[]>(() => linesToCards(initialLines));
  const [tab, setTab] = useState<'fiche' | 'checkup'>(() => (cards.length > 0 ? 'checkup' : 'fiche'));

  // Saisie en cours gardee dans l'onglet (UX011) : on ouvre la fiche moto ou « Ajouter une moto »,
  // Retour retrouve l'OR tel qu'on l'a laisse. Le client et la moto passes par l'adresse priment.
  const formDraft = useFormDraft({
    key: draftKey ?? null,
    // Operateur (membre choisi ou ancien texte) et type de reparation (code de la liste) inclus (ATE001b).
    value: { sel, mileage, operatorChoice, repairType, reasonCode, workDescription, receptionNotes, status, warrantyStatus, expertName, expertDate, lines },
    fingerprint: (v) => ({ ...v, sel: [v.sel.contact?.id ?? contactIdToLoad ?? null, v.sel.vehicle?.id ?? null], lines: v.lines.map(({ _key, ...l }) => l) }),
    accept: (d) => !defaultContactId || !d.sel.contact || d.sel.contact.id === defaultContactId,
    restore: (d) => {
      setSel((s) => ({
        contact: d.sel.contact ?? s.contact,
        vehicle: defaultVehicleId && d.sel.vehicle?.id !== defaultVehicleId ? s.vehicle : d.sel.vehicle,
      }));
      setMileage(d.mileage); setRepairType(d.repairType); setReasonCode(d.reasonCode);
      // Brouillon d'avant le 03/11 (sans operatorChoice) : on garde l'operateur par defaut (connecte).
      if (d.operatorChoice && (d.operatorChoice.operatorId || d.operatorChoice.legacyText)) {
        setOperatorChoice({ operatorId: d.operatorChoice.operatorId ?? null, legacyText: d.operatorChoice.legacyText ?? null });
        setOperatorTouched(true);
      }
      setWork(d.workDescription); setNotes(d.receptionNotes); setStatus(d.status); setWarranty(d.warrantyStatus);
      setExpertName(d.expertName); setExpertDate(d.expertDate);
      if (d.lines?.length) setLines(d.lines.map((l) => ({ ...l, _key: `ro${counter++}` })));
    },
  });

  // Precharge du client et de la moto (edition, ou nouvel OR depuis une fiche) — par id, jamais
  // via la liste des contacts (plafonnee a 500 : au-dela, le client « disparaissait », ATE001).
  const preContactQ = useQuery({
    queryKey: ['ro-contact', contactIdToLoad], enabled: !!contactIdToLoad, staleTime: Infinity,
    queryFn: () => getContact(contactIdToLoad as string),
  });
  const preVehicleQ = useQuery({
    queryKey: ['ro-vehicle', vehicleIdToLoad], enabled: !!vehicleIdToLoad, staleTime: Infinity,
    queryFn: () => getVehicle(vehicleIdToLoad as string),
  });
  const preContact = preContactQ.data;
  const preVehicle = preVehicleQ.data;
  useEffect(() => { if (preContact) setSel((s) => (s.contact ? s : pickContact(s, preContact))); }, [preContact]);
  useEffect(() => { if (preVehicle) setSel((s) => (s.vehicle && s.vehicle.id !== preVehicle.id ? s : pickVehicle(s, preVehicle))); }, [preVehicle]);
  useEffect(() => { if (preContactQ.error || preVehicleQ.error) toast.error(t('workshop.headerLoadError')); }, [preContactQ.error, preVehicleQ.error]);

  // Motifs d'entrée (Paramètres → Tables) et taux horaire de l'atelier (frais de devis atelier).
  const reasonsQ = useQuery({ queryKey: ['workshop-reasons', companyId], queryFn: () => listWorkshopReasons(companyId), staleTime: 300_000 });
  const rateQ = useQuery({ queryKey: ['maintenance', 'rate', companyId], queryFn: () => loadHourlyRateHt(companyId), staleTime: 300_000 });
  const rate = rateQ.data ?? null;
  const teamQ = useQuery({ queryKey: ['company-team', companyId], queryFn: () => listCompanyTeam(companyId), staleTime: 300_000 });
  const typesQ = useQuery({ queryKey: ['workshop-repair-types', companyId], queryFn: () => listRepairTypes(companyId), staleTime: 300_000 });
  const members = useMemo(() => teamQ.data ?? [], [teamQ.data]);
  const repairTypes = useMemo(() => typesQ.data ?? [], [typesQ.data]);
  const roundUp = useRoundSalePrices(companyId);
  // Ancien OR (texte seul) : des que l'equipe est chargee, le nom retrouve son membre ;
  // nouvel OR : l'utilisateur connecte, s'il n'etait pas encore connu au premier rendu.
  useEffect(() => {
    if (operatorTouched) return;
    setOperatorChoice((c) => {
      if (c.operatorId) return c;
      const next = defaultOperator({ isNew: !o, currentUserId: user?.id ?? null, members, savedOperatorText: c.legacyText });
      return next.operatorId !== c.operatorId || next.legacyText !== c.legacyText ? next : c;
    });
  }, [members, user?.id, o, operatorTouched]);
  const teamOptions = workshopTeamOptions(members, [user?.id, operatorChoice.operatorId]);
  // Ancien texte (« ENTRETIEN ») : rattache a son code des que la liste est chargee ; hors liste, garde tel quel.
  useEffect(() => {
    if (!typesQ.isSuccess) return;
    setRepairType((cur) => {
      const code = matchRepairTypeCode(cur, repairTypes);
      return code && code !== cur ? code : cur;
    });
  }, [typesQ.isSuccess, repairTypes]);
  const legacyType = typesQ.isSuccess ? legacyRepairType(repairType, repairTypes) : null;
  const onReasonChange = (next: string) => {
    setRepairType((cur) => nextRepairType({ current: cur, previousReason: reasonCode || null, nextReason: next || null }));
    setReasonCode(next);
  };
  const expertVisible = showExpertFields({ reasonCode, repairType, expertName, expertDate });
  const warrantyVisible = showWarrantyField({ reasonCode, repairType, warrantyStatus });
  const pickLineArticle = (k: string, a: SaleArticle) => {
    const price = articleLinePrice(a, { effectiveHt: (ht, v) => effectiveSaleHt(ht, v, roundUp) });
    setLine(k, { article_id: a.id, designation: a.designation, ...price });
    // Remise du client (Tarifs clients) si elle existe : posee ensuite, sans bloquer la saisie.
    const contactId = contact?.id;
    if (contactId) {
      resolveCustomerPrice(companyId, contactId, a.id, 1)
        .then((r) => { const d = customerDiscountPct(r); if (d > 0) setLines((ls) => ls.map((l) => (l._key === k && l.article_id === a.id ? { ...l, discount_pct: d } : l))); })
        .catch(() => { /* sans tarif client : prix de base */ });
    }
  };

  const setLine = (k: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l._key === k ? { ...l, ...patch } : l)));
  const removeLine = (k: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l._key !== k) : ls));
  const classicInputs = lines.filter((l) => l.designation.trim() || l.article_id).map(({ _key, ...l }) => l);
  const cardLines = cardsToLines(cards.filter((c) => c.label.trim() || c.parts.length), rate);
  const totals = computeRoTotals([...classicInputs, ...cardLines]);
  const proposedCount = cards.filter((c) => PROPOSED_STATES.includes(c.state) && c.label.trim()).length;

  const ownName = profile?.full_name?.trim() || profile?.email || '';
  const savedOperator = operatorToSave(operatorChoice, members, operatorChoice.operatorId === user?.id ? ownName : (o?.operator ?? ''));
  const payload = (): OrPayload => ({
    contactId: contact?.id ?? null, vehicleId: vehicle?.id ?? null, mileage: mileage ? Math.round(num(mileage)) : null,
    operator: savedOperator.operatorText, operatorId: savedOperator.operatorId, repairType, workDescription, receptionNotes, status, warrantyStatus, expertName, expertDate,
    reasonCode: reasonCode || null,
    lines: [...classicInputs, ...cardLines],
  });

  const fiche = (
    <div className="space-y-4">
      {formDraft.restored && <FormDraftBanner onDiscard={() => { formDraft.discard(); onDraftDiscard?.(); }} />}
      {/* En-tête */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('workshop.client')}>
          {contact
            ? <Picked label={contactDisplayName(contact)} onClear={() => setSel((s) => clearContact(s))} />
            : <ContactPicker companyId={companyId} onPick={(c) => setSel((s) => pickContact(s, c))} />}
        </Field>
        <Field label={t('workshop.vehicle')}>
          {vehicle
            ? <Picked label={vehiclePickLabel(vehicle) !== '—' ? vehiclePickLabel(vehicle) : vehicle.id.slice(0, 8)} onClear={() => setSel((s) => clearVehicle(s))} />
            : <VehiclePicker companyId={companyId} contactId={contact?.id ?? null} onPick={(v) => setSel((s) => pickVehicle(s, v))} placeholder={t('workshop.vehiclePlaceholder')} />}
        </Field>
        <Field label={t('workshop.mileage')}><Input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} className="text-right tabular-nums" /></Field>
        {checkupReady && (
          <Field label={t('checkup.reason')}>
            <Select value={reasonCode || NO_REASON} onValueChange={(v) => onReasonChange(v === NO_REASON ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('checkup.reasonPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REASON}>{t('checkup.reasonNone')}</SelectItem>
                {(reasonsQ.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label={t('workshop.repairType')}>
          <Select value={repairType ? (legacyType ? LEGACY : repairType) : NO_VALUE} onValueChange={(v) => { if (v !== LEGACY) setRepairType(v === NO_VALUE ? '' : v); }}>
            <SelectTrigger><SelectValue placeholder={t('orPage.repairTypePlaceholder')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_VALUE}>{t('orPage.none')}</SelectItem>
              {legacyType && <SelectItem value={LEGACY}>{t('orPage.legacyValue').replace('{value}', legacyType)}</SelectItem>}
              {repairTypes.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('workshop.operator')}>
          <Select
            value={operatorChoice.operatorId ?? (operatorChoice.legacyText ? LEGACY : NO_VALUE)}
            onValueChange={(v) => {
              if (v === LEGACY) return;
              setOperatorTouched(true);
              setOperatorChoice((c) => (v === NO_VALUE ? { operatorId: null, legacyText: null } : { operatorId: v, legacyText: c.legacyText }));
            }}
          >
            <SelectTrigger><SelectValue placeholder={t('orPage.operatorPlaceholder')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_VALUE}>{t('orPage.none')}</SelectItem>
              {operatorChoice.legacyText && !operatorChoice.operatorId && (
                <SelectItem value={LEGACY}>{t('orPage.legacyValue').replace('{value}', operatorChoice.legacyText)}</SelectItem>
              )}
              {teamOptions.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}{m.userId === user?.id ? ` ${t('orPage.you')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('workshop.status')}>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`workshop.status_${s}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {/* Garantie : seulement pour un OR garantie (ou une prise en charge deja engagee). */}
        {warrantyVisible && (
          <Field label={t('workshop.warranty')}>
            <Select value={warrantyStatus} onValueChange={setWarranty}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{WARRANTY.map((w) => <SelectItem key={w} value={w}>{t(`workshop.warranty_${w}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        )}
        {/* Expert : seulement pour un accident (ou deja renseigne). */}
        {expertVisible && <Field label={t('workshop.expertName')}><Input value={expertName} onChange={(e) => setExpertName(e.target.value)} /></Field>}
        {expertVisible && <Field label={t('workshop.expertDate')}><Input type="date" value={expertDate} onChange={(e) => setExpertDate(e.target.value)} /></Field>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('workshop.workDescription')}><Textarea value={workDescription} onChange={(e) => setWork(e.target.value)} rows={3} /></Field>
        <Field label={t('workshop.receptionNotes')}><Textarea value={receptionNotes} onChange={(e) => setNotes(e.target.value)} rows={3} /></Field>
      </div>

      {/* Lignes */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>
            <Th className="w-28">{t('workshop.colKind')}</Th><Th>{t('workshop.colDesignation')}</Th>
            <Th className="w-20 text-right">{t('workshop.colQty')}</Th><Th className="w-28 text-right">{t('workshop.colPuHt')}</Th>
            <Th className="w-20 text-right">{t('workshop.colVat')}</Th><Th className="w-20 text-right">{t('workshop.colDiscount')}</Th>
            <Th className="w-24 text-right">{t('workshop.colLineHt')}</Th><Th className="w-20 text-center">{t('workshop.warrantyLine')}</Th><Th className="w-10" />
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const ht = l.quantity * (l.is_warranty ? 0 : l.unit_price_ht) * (1 - (l.discount_pct || 0) / 100);
              return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td className="px-2 py-1">
                    <Select value={l.kind} onValueChange={(v) => setLine(l._key, v === 'mo'
                      // Main-d'oeuvre sans prix : taux horaire de l'atelier (Frais de devis atelier).
                      ? { kind: 'mo', unit_price_ht: labourUnitPrice(l.unit_price_ht, rate) }
                      : { kind: v as RoLineInput['kind'] })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="piece">{t('workshop.kind_piece')}</SelectItem><SelectItem value="mo">{t('workshop.kind_mo')}</SelectItem><SelectItem value="texte">{t('workshop.kind_texte')}</SelectItem></SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1 min-w-[180px]">
                    {l.article_id || l.kind !== 'piece'
                      ? <Input value={l.designation} onChange={(e) => setLine(l._key, { designation: e.target.value })} className="h-8" />
                      : <ArticlePicker companyId={companyId} value={l.designation} onText={(v) => setLine(l._key, { designation: v })} onPick={(a) => pickLineArticle(l._key, a)} />}
                  </td>
                  <td className="px-2 py-1"><Input type="number" step="0.01" value={String(l.quantity)} onChange={(e) => setLine(l._key, { quantity: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.01" value={String(l.unit_price_ht)} onChange={(e) => setLine(l._key, { unit_price_ht: num(e.target.value) })} disabled={l.is_warranty} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.vat_rate)} onChange={(e) => setLine(l._key, { vat_rate: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.discount_pct)} onChange={(e) => setLine(l._key, { discount_pct: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-3 py-1 text-right tabular-nums">{eur(ht)}</td>
                  <td className="px-2 py-1 text-center"><input type="checkbox" checked={l.is_warranty} onChange={(e) => setLine(l._key, { is_warranty: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" title={t('workshop.warrantyHint')} /></td>
                  <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" onClick={() => removeLine(l._key)}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cards.length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {t('checkup.linesFromCheckup').replace('{n}', String(cards.length))}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus /> {t('workshop.addLine')}</Button>
        <div className="flex gap-5 rounded-md border border-border bg-card px-4 py-2 font-data text-sm tabular-nums">
          <span>{t('workshop.totalHt')} <b>{eur(totals.total_ht)}</b></span>
          <span className="text-muted-foreground">{t('workshop.totalVat')} {eur(totals.total_vat)}</span>
          <span className="text-base">{t('workshop.totalTtc')} <b>{eur(totals.total_ttc)}</b></span>
        </div>
      </div>

      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end"><Button onClick={() => onSubmit(payload(), 'save')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t('workshop.save')}</Button></div>
    </div>
  );

  // Nouvel OR ou migration absente : pas d'onglet Check-up (il faut un OR enregistré pour les photos).
  if (!checkupReady || !o) return <div className="space-y-4">{header}{fiche}</div>;

  return (
    <div className="space-y-4">
      {header}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'fiche' | 'checkup')}>
        <TabsList className="h-11">
          <TabsTrigger value="fiche" className="h-9 px-4 text-[14px]"><FileText className="mr-1.5 size-4" /> {t('checkup.tabFiche')}</TabsTrigger>
          <TabsTrigger value="checkup" className="h-9 px-4 text-[14px]">
            <ClipboardCheck className="mr-1.5 size-4" /> {t('checkup.tabCheckup')}
            {proposedCount > 0 && <span className="ml-1.5 rounded-[var(--radius-badge)] bg-warning-bg px-1.5 font-data text-[11px] tabular-nums text-warning">{proposedCount}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="fiche" className="mt-4">{fiche}</TabsContent>
        <TabsContent value="checkup" className="mt-4">
          <CheckupTab
            companyId={companyId} orId={o.id} vehicleId={vehicle?.id ?? null} reasonCode={reasonCode || null}
            cards={cards} onChange={setCards} rate={rate} rateLoading={rateQ.isLoading}
            busy={busy} error={error} approvalPending={approvalPending}
            hasClient={!!contact}
            onSave={() => onSubmit(payload(), 'save')}
            onSendProposal={() => onSubmit(payload(), 'proposal')}
            extraActions={proposalActions}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Picked({ label, onClear }: { label: string; onClear: () => void }) {
  return <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"><span className="truncate">{label}</span><button type="button" onClick={onClear} className="ml-auto text-muted-foreground hover:text-danger"><X className="size-4" /></button></div>;
}
function ContactPicker({ companyId, onPick }: { companyId: string; onPick: (c: Contact) => void }) {
  const [term, setTerm] = useState(''); const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['ro-cpick', companyId, deb], queryFn: () => listContacts(companyId, deb), enabled: deb.length >= 2 });
  // Fiches liees des resultats affiches, en un appel (retour du 05/10).
  const linkedByContact = useLinkedBrief((data ?? []).slice(0, 8).map((c) => c.id));
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('workshop.clientPlaceholder')} className="h-9 pl-9" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.slice(0, 8).map((c) => (
            <div key={c.id} className="border-b border-border last:border-0">
              <button type="button" onClick={() => onPick(c)} className="block w-full px-3 pt-2 text-left text-sm hover:bg-accent">{contactDisplayName(c)}</button>
              {/* Fiche liee sous la ligne, en plus clair (retour du 05/10). */}
              <div className="px-3 pb-1.5"><LinkedLines links={linkedByContact.get(c.id)} clickable={false} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
/**
 * Recherche d'article d'une ligne de l'OR et du check-up : le composant partage avec les documents
 * de vente (`ArticleLinePicker`, liste en surcouche, clavier, stock, prix) — ATE001b.
 */
export function ArticlePicker({ companyId, value, onText, onPick, className = 'h-8' }: { companyId: string; value: string; onText: (v: string) => void; onPick: (a: SaleArticle) => void; className?: string }) {
  return <ArticleLinePicker companyId={companyId} value={value} onText={onText} onPick={onPick} placeholder={t('workshop.articlePlaceholder')} className={className} />;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
