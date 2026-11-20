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
 * Depuis le 18/11 (rattrapage G8, temps MO) : sur une ligne main-d'oeuvre, l'horloge ouvre la
 * fenêtre « Gestion du temps atelier » (mécanicien, heures facturées = quantité, passées,
 * internes, garanties, date des travaux), active quand la migration 20261118110000 est en base.
 *
 * Depuis le 31/10 (ATE008 / ATE009) : onglet « Check-up » pensé tablette — une carte par action
 * (état, photo, temps, pièces, prix) — dont les cartes sont des lignes de l'OR réunies par
 * `checkup_key` (règles pures : `checkup/rules.ts`). Un seul état de lignes : les lignes
 * classiques ici, les cartes dans l'onglet ; à l'enregistrement, les deux sont réécrites ensemble.
 *
 * Depuis le 18/11 (rattrapage G8, `or-base/`) : statuts G8 (attente devis, pièces en commande,
 * client informé), « Promis le », kilométrage obligatoire dès qu'une moto est choisie + dernier
 * relevé affiché + avertissement bloquant à confirmer si le km est inférieur, les 30 points V / R,
 * informations complémentaires non imprimées, modèles de commentaires (Mémoriser / Rappeler /
 * Supprimer), popup « Commentaire client » au chargement du client.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Search, X, Save, ClipboardCheck, FileText, Package, Clock, Tag, Undo2 } from 'lucide-react';
import { KitInsertDialog } from './kits/kit-insert-dialog';
import { kitDuplicateCount, toRoLine, type InsertLine } from './kits/insert-rules';
import { useAuth } from '@/lib/auth/auth-context';
import { effectiveSaleHt, useRoundSalePrices } from '@/lib/pricing';
import { ArticleLinePicker } from '@/modules/sales/article-line-picker';
import { articleLinePrice, labourUnitPrice } from '@/modules/sales/article-price';
import { useCustomerPricer, orInsurerTariff, type PricingContact } from '@/modules/sales/customer-pricing-api';
import { insurerRepriceNeeded, priceOrLine, repriceOrLines } from './or-line-pricing';
import { articleBasePrices } from './or-line-pricing-api';
import { MicroficheImportButton, microficheToSaleArticle, type MicroficheItem } from '@/modules/articles/g8/microfiche-import';
import { useOrExplodedViews } from './exploded/or-exploded-views';
import { mergeReservedLine, OR_LINE_RESERVED_EVENT, type OrLineReservedDetail } from './exploded/rules';
import { listCompanyTeam, listRepairTypes } from './or-page-api';
import { listMechanics as listPlanningMechanics } from './planning/api';
import {
  defaultOperator, legacyOperatorKind, operatorToSave, workshopTeamOptions, nextRepairType, legacyRepairType, matchRepairTypeCode,
  showExpertFields, showWarrantyField, type OperatorChoice,
} from './or-page-rules';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { listContacts, getContact, contactDisplayName, PICKER_LIMIT, type Contact } from '@/modules/contacts/api';
import { LinkedLines, useLinkedBrief } from '@/modules/contacts/linked-line';
import { type SaleArticle } from '@/modules/sales/write-api';
import { getVehicle, vehiclePickLabel } from '@/modules/vehicles/api';
import { VehiclePicker } from '@/modules/vehicles/vehicle-picker';
import { pickContact, clearContact, pickVehicle, clearVehicle, type ClientVehicleSelection, type VehiclePickRow } from '@/modules/vehicles/vehicle-pick';
import { type RepairOrderFull } from './api';
import { computeRoTotals, warrantySchemaReady, type RoLineInput } from './write-api';
import { loadHourlyRateHt } from './maintenance-api';
import { listWorkshopReasons } from './checkup/api';
import { cardsToLines, linesToCards, nonCheckupLines, PROPOSED_STATES, type CheckupCard } from './checkup/rules';
import { CheckupTab } from './checkup/checkup-tab';
import { serviceCodeForReason, serviceLabelKey, type ServiceCode } from './service-code';
import { listWarrantyCessionTypes, loadWarrantyRate } from './warranty/api';
import {
  cessionFromRepairType, isLineDecision, lineCoveredByWarranty, lineReroutedToClient, statusAfterCessionChoice,
  warrantyRequestNote, warrantySummary,
} from './warranty/rules';
import { t, fillVars } from '@/lib/i18n';
import { useFormDraft } from '@/lib/use-form-draft';
import { LabourTimeDialog } from './labour-time/time-dialog';
import { labourTimeSchemaReady, listMechanics } from './labour-time/api';
import { EMPTY_LABOUR_TIME, moQuantity, type LabourTime } from './labour-time/rules';
import { FormDraftBanner } from '@/components/form-draft-banner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { orBaseSchemaReady, vehicleMileageReadings } from './or-base/api';
import { CheckPointsPanel } from './or-base/check-points-panel';
import { CommentTemplatesMenu } from './or-base/comment-templates-menu';
import { ClientCommentPopup } from './or-base/client-comment-popup';
import { orStatusLabel } from './or-base/or-status-badge';
import {
  OR_EDIT_STATUSES, checkMileage, editableStatus, displayedReading, formatOrDate, lastReading, mileageAck, mileageRequired, normalizeCheckPoints,
  type CheckPoints, type MileageReading,
} from './or-base/rules';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
/** Statuts G8 du 18/11 (a faire, attente devis, pieces en commande, en cours, pret, client informe). */
const STATUSES = OR_EDIT_STATUSES;
const WARRANTY = ['aucune', 'en_attente', 'accepte', 'refus_total', 'refus_partiel'] as const;
const NO_REASON = ' none';
/** ISO -> valeur d'un champ `datetime-local` (heure locale du poste). */
const isoToLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const localInputToIso = (v: string) => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
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
  /** undefined = gere par le volet assurance du dossier accident (ne pas ecraser). */
  expertName?: string; expertDate?: string; reasonCode: string | null; lines: RoLineInput[];
  /** Type de cession garantie (05 / 06 / 07, '' = aucun) et commentaire de la demande (rattrapage G8). */
  warrantyCessionCode: string; warrantyNote: string;
  /** Rattrapage G8 (18/11) : promis le (ISO), 30 points V / R, notes internes, dernier releve depasse confirme. */
  promisedAt?: string | null; checkPoints?: CheckPoints; internalNotes?: string; mileageAckPrevious?: number | null;
  /** T4 : tarif assureur applique aux lignes (null = tarif du client ; undefined = ne pas toucher). */
  insurerPriceListId?: string | null;
};

export type OrEditorIntent = 'save' | 'proposal';

export function OrEditor({ companyId, initial, defaultContactId = null, defaultVehicleId = null, busy, error, onSubmit, checkupReady = false, approvalPending = false, header, proposalActions, draftKey = null, onDraftDiscard, expertInPanel = false, pane, workTop, linesBottom }: {
  companyId: string; initial?: RepairOrderFull | null; busy: boolean; error?: string | null;
  /**
   * Lot UX atelier (20/11/2026) : fiche OR en onglets. `work` = reception et fiche (+ check-up),
   * `lines` = lignes, kits, vues eclatees, totaux ; `none` = onglet Documents (rien de l'editeur).
   * L'editeur reste monte (un seul etat, un seul « Enregistrer ») : les volets non choisis sont
   * caches, pas demontes. Absent = page d'origine (nouvel OR) : tout a la suite.
   */
  pane?: 'work' | 'lines' | 'none';
  /** Blocs de la page affiches en tete du volet Travail (photos, operations, dossier accident). */
  workTop?: ReactNode;
  /** Blocs de la page affiches sous les lignes (pieces reservees, acompte). */
  linesBottom?: ReactNode;
  /** Dossier accident ouvert : expert et date de passage se saisissent dans son volet assurance. */
  expertInPanel?: boolean;
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
  // OR accident : le tarif associe au cabinet d'assurance passe avant celui du client (G8, T4).
  const insurerQ = useQuery({
    queryKey: ['or-insurer-price-list', initial?.or?.id ?? null], queryFn: () => orInsurerTariff(initial!.or.id),
    enabled: !!initial?.or?.id, staleTime: 60_000,
  });
  const insurerTariff = insurerQ.data ?? null;
  const insurerList = insurerTariff ? (insurerTariff.listId ?? insurerTariff.code) : null;
  const pricer = useCustomerPricer(companyId, contact as PricingContact | null, insurerList);
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
  const [status, setStatus] = useState(editableStatus(o?.status));
  // Statut change hors de l'editeur (Demarrer / Pause du lot A, « Terminer » du lot D) : le champ
  // suit la base, sinon un enregistrement de l'editeur remettrait l'ancien statut.
  const savedStatus = o?.status;
  useEffect(() => { if (savedStatus) setStatus(editableStatus(savedStatus)); }, [savedStatus]);
  // Rattrapage G8 (18/11) : promis le, 30 points, informations complementaires (non imprimees).
  const [promisedAt, setPromisedAt] = useState(isoToLocalInput((ox?.promised_at as string | null | undefined) ?? null));
  const [checkPoints, setCheckPoints] = useState<CheckPoints>(() => normalizeCheckPoints(ox?.check_points));
  const [internalNotes, setInternalNotes] = useState(o?.notes ?? '');
  const [mileageError, setMileageError] = useState<string | null>(null);
  const [lowerAsk, setLowerAsk] = useState<{ km: number; last: MileageReading; intent: OrEditorIntent } | null>(null);
  const [forceLower, setForceLower] = useState(false);
  const [warrantyStatus, setWarranty] = useState(o?.warranty_status ?? 'aucune');
  const [expertName, setExpertName] = useState(o?.expert_name ?? '');
  const [expertDate, setExpertDate] = useState(o?.expert_date ?? '');
  // OR garantie (rattrapage G8) : type de cession et commentaire de la demande (migration 20261118130000).
  const [cessionCode, setCessionCode] = useState<string>((ox?.warranty_cession_code as string | null) ?? '');
  const [warrantyNote, setWarrantyNote] = useState<string>((ox?.warranty_note as string | null) ?? '');
  const initialLines = useMemo(() => (initial?.lines ?? []) as (RepairOrderFull['lines'][number] & { checkup_key?: string | null; checkup_state?: string | null; photo_path?: string | null; proposal_line_id?: string | null; warranty_decision?: string | null } & Partial<LabourTime>)[], [initial]);
  const [lines, setLines] = useState<EditLine[]>(() => {
    const classic = nonCheckupLines(initialLines);
    return classic.length
      ? classic.map((l) => ({
        _key: `ro${counter++}`, kind: l.kind as RoLineInput['kind'], article_id: l.article_id, designation: l.designation, quantity: Number(l.quantity), unit_price_ht: Number(l.unit_price_ht), vat_rate: Number(l.vat_rate), discount_pct: Number(l.discount_pct), is_warranty: l.is_warranty, warranty_decision: isLineDecision(l.warranty_decision) ? l.warranty_decision : null,
        // Temps MO (migration 20261118110000) : repris tel quel, renvoyé à l'enregistrement.
        ...(l.kind === 'mo' ? lineTimeOf(l) : {}),
      }))
      // Lot OR lisible (19/11) : OR existant sans ligne = tableau vide (plus de ligne fantome
      // « Piece 0,00 € ») ; un nouvel OR garde une ligne prete a saisir.
      : initial ? [] : [blankLine()];
  });
  // Fenêtre « Gestion du temps atelier » (ligne MO) et codes mécano (Paramètres → Tables).
  const [timeKey, setTimeKey] = useState<string | null>(null);
  const labourQ = useQuery({ queryKey: ['labour-time-schema'], queryFn: labourTimeSchemaReady, staleTime: Infinity });
  const mechanicsQ = useQuery({ queryKey: ['workshop-mechanics', companyId], queryFn: () => listMechanics(companyId), staleTime: 300_000, enabled: labourQ.data === true });
  const timeReady = labourQ.data === true;
  const [cards, setCards] = useState<CheckupCard[]>(() => linesToCards(initialLines));
  const [tab, setTab] = useState<'fiche' | 'checkup'>(() => (cards.length > 0 ? 'checkup' : 'fiche'));

  // Saisie en cours gardee dans l'onglet (UX011) : on ouvre la fiche moto ou « Ajouter une moto »,
  // Retour retrouve l'OR tel qu'on l'a laisse. Le client et la moto passes par l'adresse priment.
  const formDraft = useFormDraft({
    key: draftKey ?? null,
    // Operateur (membre choisi ou ancien texte) et type de reparation (code de la liste) inclus (ATE001b).
    value: { sel, mileage, operatorChoice, repairType, reasonCode, workDescription, receptionNotes, status, warrantyStatus, expertName, expertDate, cessionCode, warrantyNote, lines, promisedAt, checkPoints, internalNotes },
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
      setCessionCode(d.cessionCode ?? ''); setWarrantyNote(d.warrantyNote ?? '');
      // Brouillon d'avant le 18/11 : ces champs manquent, on garde les valeurs vierges.
      if (typeof d.promisedAt === 'string') setPromisedAt(d.promisedAt);
      if (d.checkPoints) setCheckPoints(normalizeCheckPoints(d.checkPoints));
      if (typeof d.internalNotes === 'string') setInternalNotes(d.internalNotes);
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
  const savedReason = (ox?.reason_code as string | null | undefined) ?? null;
  const reasonsQ = useQuery({ queryKey: ['workshop-reasons', companyId, savedReason], queryFn: () => listWorkshopReasons(companyId, savedReason), staleTime: 300_000 });
  // L'entretien choisi (mission 10, carte 1, M-110) : donne par le motif, enregistre sur l'OR par la base.
  const serviceCode: ServiceCode | null = reasonCode
    ? ((reasonsQ.data ?? []).find((r) => r.code === reasonCode)?.serviceCode ?? serviceCodeForReason(reasonCode))
    : null;
  const rateQ = useQuery({ queryKey: ['maintenance', 'rate', companyId], queryFn: () => loadHourlyRateHt(companyId), staleTime: 300_000 });
  // Taux STANDARD de l'atelier (base de la MO, decision Q48 : 109,74 HT) ; le tarif du client (VIP :
  // 90,00 HT) s'applique ensuite par le moteur unique des lignes d'OR (or-line-pricing.ts, priceOrLine).
  const rate = rateQ.data ?? null;
  // Dernier releve de la moto (OR, fiche moto, dernier entretien, declaration) : controle du km G8.
  const readingsQ = useQuery({ queryKey: ['vehicle-mileage', vehicle?.id], enabled: !!vehicle?.id, queryFn: () => vehicleMileageReadings(vehicle!.id), staleTime: 30_000 });
  const last = vehicle?.id ? lastReading(readingsQ.data ?? [], o?.id ?? null, o?.created_at ?? null) : null;
  // Constat du 20/11 : sans releve anterieur, on affiche le km de cet OR (meme valeur que le bandeau).
  const shownReading = vehicle?.id && o?.vehicle_id === vehicle.id ? displayedReading(last, o) : last;
  const orBaseQ = useQuery({ queryKey: ['or-base-schema'], queryFn: orBaseSchemaReady, staleTime: Infinity });
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
  // Constat du 20/11 : operateur sans compte venu d'un RDV → « compagnon sans compte », pas « saisi a la main ».
  const crewQ = useQuery({ queryKey: ['planning-mechanics', companyId], queryFn: () => listPlanningMechanics(companyId), staleTime: 300_000, enabled: !!operatorChoice.legacyText && !operatorChoice.operatorId });
  const legacyOperatorKey = legacyOperatorKind(operatorChoice.legacyText, crewQ.data ?? []) === 'mechanic' ? 'orPage.mechanicNoAccount' : 'orPage.legacyValue';
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
  const expertVisible = !expertInPanel && showExpertFields({ reasonCode, repairType, expertName, expertDate });
  const warrantyVisible = showWarrantyField({ reasonCode, repairType, warrantyStatus }) || !!cessionCode;
  // Garantie (rattrapage G8) : types de cession 05 / 06 / 07, taux MO garantie, colonnes en base ?
  const warrantySchemaQ = useQuery({ queryKey: ['warranty-schema'], queryFn: warrantySchemaReady, staleTime: Infinity });
  const warrantyReady = warrantySchemaQ.data === true;
  const cessionTypesQ = useQuery({ queryKey: ['warranty-cession-types', companyId], queryFn: () => listWarrantyCessionTypes(companyId), staleTime: 300_000, enabled: warrantyReady });
  const warrantyRateQ = useQuery({ queryKey: ['warranty-rate', companyId], queryFn: () => loadWarrantyRate(companyId), staleTime: 300_000 });
  const noteTemplate = t('warranty.requestNote');
  const chooseCession = (code: string, withNote = true) => {
    setCessionCode(code);
    if (!code) return;
    setWarranty((w) => statusAfterCessionChoice(w, code));
    if (withNote) setWarrantyNote((n) => (n.trim() ? n : warrantyRequestNote(noteTemplate, { vin: vehicle?.vin, plate: vehicle?.plate })));
  };
  // Type de reparation « Garantie Ducati » / « Garantie magasin » : le type de cession suit (s'il est vide).
  useEffect(() => {
    if (!warrantyReady) return;
    const proposed = cessionFromRepairType(repairType);
    if (proposed && !cessionCode) chooseCession(proposed, !!vehicle?.vin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repairType, warrantyReady]);
  const pickLineArticle = (k: string, a: SaleArticle) => {
    const price = articleLinePrice(a, { effectiveHt: (ht, v) => effectiveSaleHt(ht, v, roundUp) });
    setLine(k, { article_id: a.id, designation: a.designation, ...price });
    // Tarif du client (meme calcul que la vente et la caisse : tarif commun, regles du client,
    // paliers, dates ; rattrapage G8 du 18/11) pose ensuite, sans bloquer la saisie.
    // OR accident : tarif du cabinet d'assurance a la place (meme fonction de prix des lignes d'OR).
    if (contact || insurerList) {
      const cur = lines.find((l) => l._key === k);
      priceOrLine(pricer, { kind: cur?.kind ?? 'piece', article_id: a.id, quantity: Number(cur?.quantity ?? 1) || 1, unit_price_ht: price.unit_price_ht, discount_pct: 0 }, price.unit_price_ht)
        .then((r) => { if (r?.ruled) setLines((ls) => ls.map((l) => (l._key === k && l.article_id === a.id ? { ...l, unit_price_ht: r.unit_price_ht, discount_pct: r.discount_pct } : l))); })
        .catch(() => { /* sans tarif client : prix de base */ });
    }
  };
  // Ligne passee en main-d'oeuvre : taux de l'atelier, puis tarif du client / de l'assureur.
  const switchToLabour = (k: string) => {
    const cur = lines.find((l) => l._key === k);
    const base = labourUnitPrice(cur?.unit_price_ht ?? 0, rate);
    setLine(k, { kind: 'mo', unit_price_ht: base });
    if ((contact || insurerList) && cur && !cur.article_id && base > 0) {
      priceOrLine(pricer, { kind: 'mo', article_id: null, quantity: Number(cur.quantity) || 1, unit_price_ht: base, discount_pct: 0 }, base)
        .then((r) => { if (r?.ruled) setLines((ls) => ls.map((l) => (l._key === k && l.kind === 'mo' && !l.article_id ? { ...l, unit_price_ht: r.unit_price_ht, discount_pct: r.discount_pct } : l))); })
        .catch(() => { /* prix de base */ });
    }
  };

  // T4 : le tarif de l'assureur s'applique AUTOMATIQUEMENT aux lignes de l'OR accident. Quand le
  // tarif effectif (cabinet choisi, change ou retire) n'est pas celui avec lequel les lignes ont
  // ete calculees (`insurer_price_list_id`), toutes les lignes sont re-tarifees ; annulable.
  const [appliedInsurerList, setAppliedInsurerList] = useState<string | null | undefined>(
    () => (ox && 'insurer_price_list_id' in ox ? ((ox.insurer_price_list_id as string | null) ?? null) : undefined),
  );
  const [repriced, setRepriced] = useState<{ previous: EditLine[]; changed: number; code: string | null; insurer: string | null } | null>(null);
  useEffect(() => {
    if (!insurerQ.isSuccess || rateQ.isLoading) return;
    const effective = insurerTariff ? insurerTariff.listId : null;
    if (!insurerRepriceNeeded({ applied: appliedInsurerList, effective, invoiced: o?.status === 'facture' })) return;
    // Retour au tarif du client : attendre la fiche du client.
    if (!effective && contactIdToLoad && !contact) return;
    let cancelled = false;
    const snapshot = lines;
    (async () => {
      const bases = { articleBaseHt: await articleBasePrices(snapshot.map((l) => l.article_id ?? '').filter(Boolean), roundUp), labourRateHt: rate };
      const r = await repriceOrLines(snapshot, pricer, bases);
      if (cancelled) return;
      setAppliedInsurerList(effective);
      setLines(r.lines);
      if (r.changed > 0) setRepriced({ previous: snapshot, changed: r.changed, code: insurerTariff?.code ?? null, insurer: insurerTariff?.insurerName ?? null });
    })().catch(() => { /* re-tarifage impossible : les lignes restent telles quelles */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insurerQ.isSuccess, insurerTariff?.listId, appliedInsurerList, pricer, contact?.id, rate, rateQ.isLoading, roundUp]);
  // Annuler : les lignes d'avant ; le tarif reste « applique » (pas de nouveau re-tarifage).
  const undoReprice = () => {
    if (!repriced) return;
    setLines(repriced.previous);
    setRepriced(null);
  };

  const setLine = (k: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l._key === k ? { ...l, ...patch } : l)));
  // Rattrapage G8 : un kit / forfait insere comme lignes de l'OR (les lignes vides sont remplacees).
  const [kitOpen, setKitOpen] = useState(false);
  // Decision Q49 : kit deja sur l'OR (insere depuis le RDV, ou deux fois) → on previent, « ne pas reinserer » par defaut.
  const [kitDup, setKitDup] = useState<{ lines: InsertLine[]; count: number } | null>(null);
  const insertKitLines = (ins: InsertLine[], force = false) => {
    const dup = kitDuplicateCount(lines, ins);
    if (dup > 0 && !force) { setKitOpen(false); setKitDup({ lines: ins, count: dup }); return; }
    setKitDup(null);
    setKitOpen(false);
    // Decisions Q48 / Q49 : les lignes du kit passent par LA fonction de prix des lignes d'OR (tarif du
    // client ou de l'assureur ; MO au taux du client, VIP compris) ; sans tarif, le prix du kit reste.
    void (async () => {
      let priced = ins.map(toRoLine);
      try {
        const bases = { articleBaseHt: await articleBasePrices(priced.map((l) => l.article_id ?? '').filter(Boolean), roundUp), labourRateHt: rate };
        priced = (await repriceOrLines(priced, pricer, bases)).lines;
      } catch { /* prix du kit */ }
      setLines((ls) => {
        const kept = ls.filter((l) => l.designation.trim() || l.article_id);
        return [...kept, ...priced.map((l) => ({ ...l, _key: `ro${counter++}` }))];
      });
    })();
  };
  const kitModelYear = preVehicle && vehicle?.id === preVehicle.id
    ? ((preVehicle as unknown as { ducati_model_year_id?: string | null }).ducati_model_year_id ?? null) : null;
  // Lot E (19/11) : vues eclatees de la moto (src/modules/workshop/exploded/) ; la piece ajoutee arrive chiffree par priceOrLine.
  const exploded = useOrExplodedViews({
    companyId, modelYearId: kitModelYear, orId: o?.id ?? null, readOnly: o?.status === 'facture' || o?.status === 'annule',
    pricer, effectiveHt: (ht, v) => effectiveSaleHt(ht, v, roundUp),
    onAdd: (l) => setLines((ls) => [...ls.filter((x) => x.designation.trim() || x.article_id), { ...l, _key: `ro${counter++}` }]),
  });
  // Q59 (20/11/2026) : « Réserver » (vue éclatée, ici ou dans le parcours / les opérations) a déjà
  // enregistré la ligne en base ; l'éditeur ajuste SA ligne de cette pièce (sans doublon) ou l'ajoute,
  // pour que son prochain enregistrement la garde.
  const editorOrId = o?.id ?? null;
  useEffect(() => {
    if (!editorOrId || typeof window === 'undefined') return;
    const onReserved = (ev: Event) => {
      const d = (ev as CustomEvent<OrLineReservedDetail>).detail;
      if (!d || d.orId !== editorOrId) return;
      setLines((ls) => mergeReservedLine(ls.filter((x) => x.designation.trim() || x.article_id), d.line, d.lineQty,
        (l) => ({ ...blankLine(), ...l, _key: `ro${counter++}` })));
    };
    window.addEventListener(OR_LINE_RESERVED_EVENT, onReserved);
    return () => window.removeEventListener(OR_LINE_RESERVED_EVENT, onReserved);
  }, [editorOrId]);
  // MO : la quantité est le nombre d'heures facturées (le temps saisi la suit) ; ligne couverte par
  // la garantie : sa quantité porte les heures garanties.
  const setQuantity = (l: EditLine, q: number) => setLine(l._key, l.kind === 'mo' && l.billed_hours != null && !lineCoveredByWarranty(l, warrantyStatus) ? { quantity: q, billed_hours: q } : { quantity: q });
  const timeLine = timeKey ? lines.find((l) => l._key === timeKey) ?? null : null;
  // G8 « Import microfiches » (lot G8 du 18/11/2026) : les pièces de la vue éclatée en lignes d'OR.
  const addMicroficheLines = (items: MicroficheItem[]) => setLines((ls) => {
    const keep = ls.filter((l) => l.article_id || l.designation.trim());
    const added: EditLine[] = items.map(({ article, quantity }) => ({
      ...blankLine(), article_id: article.id, designation: article.designation, quantity,
      ...articleLinePrice(microficheToSaleArticle(article), { effectiveHt: (ht, v) => effectiveSaleHt(ht, v, roundUp) }),
    }));
    return [...keep, ...added];
  });
  const removeLine = (k: string) => setLines((ls) => ls.filter((l) => l._key !== k));
  const classicInputs = lines.filter((l) => l.designation.trim() || l.article_id).map(({ _key, ...l }) => l);
  const cardLines = cardsToLines(cards.filter((c) => c.label.trim() || c.parts.length), rate);
  const totals = computeRoTotals([...classicInputs, ...cardLines], warrantyStatus);
  const wSummary = warrantySummary([...classicInputs, ...cardLines], warrantyStatus, warrantyRateQ.data ?? null);
  const hasWarrantyLines = [...classicInputs, ...cardLines].some((l) => l.is_warranty);
  const proposedCount = cards.filter((c) => PROPOSED_STATES.includes(c.state) && c.label.trim()).length;

  const ownName = profile?.full_name?.trim() || profile?.email || '';
  const savedOperator = operatorToSave(operatorChoice, members, operatorChoice.operatorId === user?.id ? ownName : (o?.operator ?? ''));
  const kmRequired = mileageRequired({ isNew: !o, savedVehicleId: o?.vehicle_id ?? null, vehicleId: vehicle?.id ?? null });
  const payload = (km: number | null = mileage ? Math.round(num(mileage)) : null, ack: number | null = null): OrPayload => ({
    contactId: contact?.id ?? null, vehicleId: vehicle?.id ?? null, mileage: km,
    promisedAt: localInputToIso(promisedAt), checkPoints, internalNotes,
    // Km inferieur au dernier releve confirme par l'utilisateur : on garde le releve depasse.
    mileageAckPrevious: ack,
    operator: savedOperator.operatorText, operatorId: savedOperator.operatorId, repairType, workDescription, receptionNotes, status, warrantyStatus,
    expertName: expertInPanel ? undefined : expertName, expertDate: expertInPanel ? undefined : expertDate,
    reasonCode: reasonCode || null, warrantyCessionCode: cessionCode, warrantyNote,
    lines: [...classicInputs, ...cardLines],
    // T4 : tarif assureur avec lequel les lignes sont calculees (undefined = colonne absente).
    insurerPriceListId: appliedInsurerList,
  });

  // Enregistrer (decision Q42 du 18/11, comme G8) : km obligatoire a la creation de l'OR et quand
  // une moto est rattachee ou changee ; ensuite il reste modifiable sans etre redemande. Km
  // inferieur au dernier releve = avertissement bloquant a confirmer (G8). Le km deja enregistre
  // sur cet OR ne redemande pas (et garde sa confirmation eventuelle).
  const submit = (intent: OrEditorIntent, confirmed = false) => {
    const unchanged = !!o && mileage.trim() !== '' && Math.round(num(mileage)) === o.mileage;
    const required = kmRequired;
    const r = checkMileage({ input: mileage, hasVehicle: !!vehicle, last, confirmed: confirmed || unchanged, required });
    if (r.kind === 'required') { setMileageError(t('orBase.mileageRequired')); return; }
    if (r.kind === 'invalid') { setMileageError(t('orBase.mileageInvalid')); return; }
    setMileageError(null);
    if (r.kind === 'lower') { setLowerAsk({ km: r.km, last: r.last, intent }); return; }
    const savedAck = (ox?.mileage_ack_previous as number | null | undefined) ?? null;
    onSubmit(payload(r.km, confirmed ? mileageAck(r.km, last) : unchanged ? savedAck : null), intent);
  };
  const readingText = (r: MileageReading) => fillVars(t('orBase.lastReading'), {
    km: r.km.toLocaleString('fr-BE'), date: formatOrDate(r.at ? r.at.slice(0, 10) : null) || '-',
    ref: r.ref ? fillVars(t('orBase.lastReadingRef'), { ref: r.ref }) : '',
  });

  const workPart = (
    <>
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
        <Field label={`${t('workshop.mileage')}${kmRequired ? ' *' : ''}`}>
          <Input
            type="number" min={0} value={mileage} onChange={(e) => { setMileage(e.target.value); setMileageError(null); }}
            className={`text-right tabular-nums ${mileageError ? 'border-danger' : ''}`} aria-invalid={!!mileageError}
          />
          {mileageError && <p className="text-[12px] text-danger">{mileageError}</p>}
          {vehicle && !mileageError && (
            <p className="text-[12px] text-muted-foreground">
              {shownReading ? `${readingText(shownReading)} · ${fillVars(t('orBase.lastReadingSource'), { source: t(`orBase.readingSource.${shownReading.source}`) })}` : readingsQ.isSuccess ? t('orBase.noReading') : ''}
            </p>
          )}
        </Field>
        <Field label={t('orBase.promisedAt')}>
          <Input type="datetime-local" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} className="tabular-nums" />
          {o?.created_at && <p className="text-[12px] text-muted-foreground">{t('orBase.receivedAt')} : {formatOrDate(o.created_at)}</p>}
        </Field>
        {checkupReady && (
          <Field label={t('checkup.reason')}>
            <Select value={reasonCode || NO_REASON} onValueChange={(v) => onReasonChange(v === NO_REASON ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('checkup.reasonPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REASON}>{t('checkup.reasonNone')}</SelectItem>
                {(reasonsQ.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {serviceCode && (
              <p className="text-[12px] text-muted-foreground" title={t('reservation.serviceFromReason')}>
                {t('reservation.serviceLabel')} : <b className="text-foreground">{t(serviceLabelKey(serviceCode))}</b>
              </p>
            )}
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
                <SelectItem value={LEGACY}>{t(legacyOperatorKey).replace('{value}', operatorChoice.legacyText)}</SelectItem>
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
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{orStatusLabel(s)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {/* Garantie : seulement pour un OR garantie (ou une prise en charge deja engagee). */}
        {warrantyVisible && warrantyReady && (
          <Field label={t('warranty.cessionType')}>
            <Select value={cessionCode || NO_VALUE} onValueChange={(v) => chooseCession(v === NO_VALUE ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('warranty.cessionPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VALUE}>{t('orPage.none')}</SelectItem>
                {(cessionTypesQ.data ?? []).map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        {warrantyVisible && (
          <Field label={t('workshop.warranty')}>
            <Select value={warrantyStatus} onValueChange={setWarranty}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{WARRANTY.map((w) => <SelectItem key={w} value={w}>{t(`workshop.warranty_${w}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        )}
        {warrantyVisible && warrantyReady && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label={t('warranty.requestNoteLabel')}>
              <Textarea value={warrantyNote} onChange={(e) => setWarrantyNote(e.target.value)} rows={2} />
            </Field>
          </div>
        )}
        {/* Expert : seulement pour un accident (ou deja renseigne). */}
        {expertVisible && <Field label={t('workshop.expertName')}><Input value={expertName} onChange={(e) => setExpertName(e.target.value)} /></Field>}
        {expertVisible && <Field label={t('workshop.expertDate')}><Input type="date" value={expertDate} onChange={(e) => setExpertDate(e.target.value)} /></Field>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('workshop.workDescription')} action={<CommentTemplatesMenu companyId={companyId} text={workDescription} onText={setWork} />}>
          <Textarea value={workDescription} onChange={(e) => setWork(e.target.value)} rows={3} />
        </Field>
        <Field label={t('workshop.receptionNotes')} action={<CommentTemplatesMenu companyId={companyId} text={receptionNotes} onText={setNotes} />}>
          <Textarea value={receptionNotes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
        {/* Informations complementaires G8 : jamais imprimees (repair_orders.notes). */}
        <Field label={t('orBase.internalNotes')} action={<CommentTemplatesMenu companyId={companyId} text={internalNotes} onText={setInternalNotes} />}>
          <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} title={t('orBase.internalNotesHint')} className="bg-muted/40" />
        </Field>
      </div>
      <CheckPointsPanel value={checkPoints} onChange={setCheckPoints} />
      {orBaseQ.data === false && <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('orBase.migrationMissing')}</p>}
    </>
  );

  // « Enregistrer » : rouge sur la page d'origine (seul bouton) ; dans la fiche en onglets, en
  // contour et colle en bas du volet (le seul rouge de l'ecran est l'etape suivante du bandeau).
  const saveRow = pane ? (
    <div className="sticky bottom-0 z-10 flex justify-end border-t border-border bg-background py-2 md:-bottom-6">
      <Button variant="outline" className="h-12 min-w-[180px] text-[15px]" onClick={() => submit('save')} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Save />} {t('workshop.save')}
      </Button>
    </div>
  ) : (
    <div className="flex justify-end"><Button onClick={() => submit('save')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t('workshop.save')}</Button></div>
  );

  const linesPart = (
    <>
      {/* T4 : tarif de l'assureur (OR accident) */}
      {insurerTariff && (
        <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
          <Tag className="size-3.5" aria-hidden /> {t('insurance.orTariff')} : <b className="text-foreground">{insurerTariff.code}</b>
          {insurerTariff.label ? ` — ${insurerTariff.label}` : ''}{insurerTariff.insurerName ? ` (${insurerTariff.insurerName})` : ''}
        </p>
      )}
      {repriced && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info" role="status">
          <Tag className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            {repriced.code
              ? fillVars(t('insurance.repricedInsurer'), { n: String(repriced.changed), code: repriced.code, insurer: repriced.insurer ?? '' })
              : fillVars(t('insurance.repricedClient'), { n: String(repriced.changed) })}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={undoReprice}><Undo2 /> {t('insurance.repricedUndo')}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRepriced(null)} aria-label={t('insurance.repricedClose')}><X /></Button>
        </div>
      )}

      {/* Lignes */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[60rem] border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>
            <Th className="w-28">{t('workshop.colKind')}</Th><Th>{t('workshop.colDesignation')}</Th>
            <Th className="w-20 text-right">{t('workshop.colQty')}</Th><Th className="w-28 text-right">{t('workshop.colPuHt')}</Th>
            <Th className="w-20 text-right">{t('workshop.colVat')}</Th><Th className="w-20 text-right">{t('workshop.colDiscount')}</Th>
            <Th className="w-24 text-right">{t('workshop.colLineHt')}</Th><Th className="w-20 text-center">{t('workshop.warrantyLine')}</Th><Th className="w-20" />
          </tr></thead>
          <tbody>
            {lines.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-3 font-ui text-[13px] text-muted-foreground">{t('orLisible.linesEmpty')}</td></tr>
            )}
            {lines.map((l) => {
              const covered = lineCoveredByWarranty(l, warrantyStatus);
              const rerouted = lineReroutedToClient(l, warrantyStatus);
              const ht = l.quantity * (covered ? 0 : l.unit_price_ht) * (1 - (l.discount_pct || 0) / 100);
              return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td className="px-2 py-1">
                    <Select value={l.kind} onValueChange={(v) => (v === 'mo'
                      // Main-d'oeuvre sans prix : taux horaire de l'atelier (Frais de devis atelier), tarif applique.
                      ? switchToLabour(l._key)
                      : setLine(l._key, { kind: v as RoLineInput['kind'] }))}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="piece">{t('workshop.kind_piece')}</SelectItem><SelectItem value="mo">{t('workshop.kind_mo')}</SelectItem><SelectItem value="texte">{t('workshop.kind_texte')}</SelectItem></SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1 min-w-[180px]">
                    {l.article_id || l.kind !== 'piece'
                      ? <Input value={l.designation} onChange={(e) => setLine(l._key, { designation: e.target.value })} className="h-8" />
                      : <ArticlePicker companyId={companyId} value={l.designation} onText={(v) => setLine(l._key, { designation: v })} onPick={(a) => pickLineArticle(l._key, a)} />}
                    {l.kind === 'mo' && timeSummary(l) && <p className="mt-0.5 font-data text-[12px] tabular-nums text-muted-foreground">{timeSummary(l)}</p>}
                  </td>
                  <td className="px-2 py-1"><Input type="number" step="0.01" value={String(l.quantity)} onChange={(e) => setQuantity(l, num(e.target.value))} className="h-8 min-w-[5rem] text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.01" value={String(l.unit_price_ht)} onChange={(e) => setLine(l._key, { unit_price_ht: num(e.target.value) })} disabled={covered} className="h-8 min-w-[6.5rem] text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.vat_rate)} onChange={(e) => setLine(l._key, { vat_rate: num(e.target.value) })} className="h-8 min-w-[5rem] text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.discount_pct)} onChange={(e) => setLine(l._key, { discount_pct: num(e.target.value) })} className="h-8 min-w-[5rem] text-right tabular-nums" /></td>
                  <td className="px-3 py-1 text-right tabular-nums">{eur(ht)}</td>
                  <td className="px-2 py-1 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {/* Cible de 44 px autour de la case (tablette, lot UX atelier). */}
                      <label className="inline-grid size-11 cursor-pointer place-items-center" title={t('workshop.warrantyHint')}>
                        <input type="checkbox" checked={l.is_warranty} onChange={(e) => setLine(l._key, { is_warranty: e.target.checked, warranty_decision: e.target.checked ? l.warranty_decision ?? null : null })} className="size-4 accent-[var(--ducati-red)]" aria-label={t('workshop.warrantyLine')} />
                      </label>
                      {covered && <span className="rounded-[var(--radius-badge)] bg-info-bg px-1 font-data text-[11px] font-bold text-info" title={t('warranty.lineCovered')}>G</span>}
                      {rerouted && <span className="rounded-[var(--radius-badge)] bg-warning-bg px-1 font-data text-[11px] font-bold text-warning" title={t('warranty.lineRerouted')}>{t('warranty.clientShort')}</span>}
                    </div>
                    {l.is_warranty && warrantyStatus === 'refus_partiel' && (
                      <Select value={l.warranty_decision === 'refuse' ? 'refuse' : 'accepte'} onValueChange={(v) => setLine(l._key, { warranty_decision: v === 'refuse' ? 'refuse' : 'accepte' })}>
                        <SelectTrigger className="mt-1 h-7 w-28 text-[12px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="accepte">{t('warranty.decision_accepte')}</SelectItem>
                          <SelectItem value="refuse">{t('warranty.decision_refuse')}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center whitespace-nowrap">
                    {l.kind === 'mo' && timeReady && (
                      <Button size="sm" variant="ghost" onClick={() => setTimeKey(l._key)} title={t('labourTime.windowTitle')} aria-label={t('labourTime.windowTitle')}><Clock className="size-4" /></Button>
                    )}
                    {l.kind === 'piece' && exploded.rowButton(l.article_id)}
                    <Button size="sm" variant="ghost" onClick={() => removeLine(l._key)}><Trash2 className="size-4 text-danger" /></Button>
                  </td>
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
      {hasWarrantyLines && (
        <div className="rounded-md border border-border bg-card px-4 py-2 font-data text-[13px] tabular-nums">
          <span className="font-bold">{t('warranty.summaryTitle')}</span>{' '}
          {t('warranty.summaryLines').replace('{n}', String(wSummary.coveredLines)).replace('{amount}', eur(wSummary.coveredSaleHt))}
          {wSummary.labourHours > 0 && <> · {t('warranty.summaryLabour').replace('{h}', String(wSummary.labourHours).replace('.', ',')).replace('{amount}', eur(wSummary.labourWarrantyHt))}</>}
          {wSummary.rerouted > 0 && <span className="text-warning"> · {t('warranty.summaryRerouted').replace('{n}', String(wSummary.rerouted))}</span>}
          {warrantyStatus === 'refus_partiel' && <p className="mt-1 font-ui text-[12px] text-muted-foreground">{t('warranty.partialHint')}</p>}
        </div>
      )}
      {timeLine && (
        <LabourTimeDialog
          designation={timeLine.designation} quantity={timeLine.quantity} mechanics={mechanicsQ.data ?? []}
          initial={{ ...EMPTY_LABOUR_TIME, ...lineTimeOf(timeLine) }}
          onClose={() => setTimeKey(null)}
          onSave={(time) => {
            const qty = moQuantity({ billed: time.billed_hours, warranty: time.warranty_hours }, lineCoveredByWarranty(timeLine, warrantyStatus));
            setLine(timeLine._key, { ...time, quantity: qty }); setTimeKey(null);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus /> {t('workshop.addLine')}</Button>
          <Button type="button" variant="outline" onClick={() => setKitOpen(true)}><Package /> {t('parcG8.kitInsertButton')}</Button>
          <MicroficheImportButton companyId={companyId} onImport={addMicroficheLines} />
          {exploded.button}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-border bg-card px-4 py-2 font-data text-sm tabular-nums">
          <span className="whitespace-nowrap">{t('workshop.totalHt')} <b>{eur(totals.total_ht)}</b></span>
          <span className="whitespace-nowrap text-muted-foreground">{t('workshop.totalVat')} {eur(totals.total_vat)}</span>
          <span className="whitespace-nowrap text-base">{t('workshop.totalTtc')} <b>{eur(totals.total_ttc)}</b></span>
        </div>
      </div>

      {kitOpen && (
        <KitInsertDialog companyId={companyId} modelYearId={kitModelYear}
          effectiveHt={(ht, v) => effectiveSaleHt(ht, v, roundUp)}
          onInsert={(ins) => insertKitLines(ins)} onClose={() => setKitOpen(false)} />
      )}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      {saveRow}
    </>
  );

  const fiche = <div className="space-y-4">{workPart}{linesPart}</div>;

  // Popup « Commentaire client » (G8) et avertissement « km inferieur au dernier releve ».
  const overlays = (
    <>
      <ClientCommentPopup contactId={contact?.id ?? null} />
      {exploded.dialog}
      <AlertDialog open={!!kitDup} onOpenChange={(v) => { if (!v) setKitDup(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('orBase.kitAuto_dupTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{fillVars(t('orBase.kitAuto_dupText'), { n: kitDup?.count ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t('orBase.kitAuto_dupSkip')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (kitDup) insertKitLines(kitDup.lines, true); }}>{t('orBase.kitAuto_dupInsert')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!lowerAsk} onOpenChange={(v) => { if (!v) { setLowerAsk(null); setForceLower(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('orBase.lowerTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {lowerAsk && fillVars(t('orBase.lowerBody'), {
                km: lowerAsk.km.toLocaleString('fr-BE'), last: lowerAsk.last.km.toLocaleString('fr-BE'),
                date: formatOrDate(lowerAsk.last.at ? lowerAsk.last.at.slice(0, 10) : null) || '-',
                ref: lowerAsk.last.ref ? fillVars(t('orBase.lastReadingRef'), { ref: lowerAsk.last.ref }) : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Q64 (comme G8) : bloquant sauf la case « Forcer l'enregistrement du kilométrage inférieur ». */}
          <label className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2 text-[13px]">
            <Checkbox checked={forceLower} onCheckedChange={(v) => setForceLower(v === true)} className="mt-0.5" />
            <span>
              <span className="font-semibold">{t('q64.forceLabel')}</span>
              {lowerAsk && <span className="block text-[12px] text-muted-foreground">{fillVars(t('q64.forceHint'), { last: lowerAsk.last.km.toLocaleString('fr-BE') })}</span>}
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('orBase.lowerFix')}</AlertDialogCancel>
            <AlertDialogAction disabled={!forceLower} onClick={() => { const a = lowerAsk; setLowerAsk(null); setForceLower(false); if (a) submit(a.intent, true); }}>
              {lowerAsk ? fillVars(t('q64.save'), { km: lowerAsk.km.toLocaleString('fr-BE') }) : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (pane) {
    const errorLine = error ? <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p> : null;
    const workFiche = <div className="space-y-4">{workPart}{errorLine}{saveRow}</div>;
    return (
      <>
        <div hidden={pane !== 'work'} className="space-y-4">
          {header}
          {workTop}
          {checkupReady && o ? (
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'fiche' | 'checkup')}>
              <TabsList className="h-12">
                <TabsTrigger value="fiche" className="h-10 px-4 text-[14px]"><FileText className="mr-1.5 size-4" /> {t('uxAtelier.ficheTab')}</TabsTrigger>
                <TabsTrigger value="checkup" className="h-10 px-4 text-[14px]">
                  <ClipboardCheck className="mr-1.5 size-4" /> {t('checkup.tabCheckup')}
                  {proposedCount > 0 && <span className="ml-1.5 rounded-[var(--radius-badge)] bg-warning-bg px-1.5 font-data text-[11px] tabular-nums text-warning">{proposedCount}</span>}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="fiche" className="mt-4">{workFiche}</TabsContent>
              <TabsContent value="checkup" className="mt-4">
                <CheckupTab
                  companyId={companyId} orId={o.id} vehicleId={vehicle?.id ?? null} reasonCode={reasonCode || null} serviceCode={serviceCode}
                  cards={cards} onChange={setCards} rate={rate} rateLoading={rateQ.isLoading}
                  busy={busy} error={error} approvalPending={approvalPending}
                  hasClient={!!contact}
                  onSave={() => submit('save')}
                  onSendProposal={() => submit('proposal')}
                  extraActions={proposalActions}
                  sendSecondary
                />
              </TabsContent>
            </Tabs>
          ) : (
            <section className="space-y-3">
              <h2 className="text-[17px] font-bold">{t('uxAtelier.ficheTab')}</h2>
              {workFiche}
            </section>
          )}
        </div>
        <div hidden={pane !== 'lines'} className="space-y-4">
          {linesPart}
          {linesBottom}
        </div>
        {overlays}
      </>
    );
  }

  // Nouvel OR ou migration absente : pas d'onglet Check-up (il faut un OR enregistré pour les photos).
  if (!checkupReady || !o) return <div className="space-y-4">{header}{fiche}{overlays}</div>;

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
            companyId={companyId} orId={o.id} vehicleId={vehicle?.id ?? null} reasonCode={reasonCode || null} serviceCode={serviceCode}
            cards={cards} onChange={setCards} rate={rate} rateLoading={rateQ.isLoading}
            busy={busy} error={error} approvalPending={approvalPending}
            hasClient={!!contact}
            onSave={() => submit('save')}
            onSendProposal={() => submit('proposal')}
            extraActions={proposalActions}
          />
        </TabsContent>
      </Tabs>
      {overlays}
    </div>
  );
}

/** Temps MO d'une ligne (colonnes de la migration 20261118110000), sans les clés absentes. */
function lineTimeOf(l: Partial<LabourTime>): Partial<LabourTime> {
  const out: Record<string, unknown> = {};
  const keys = ['mechanic_code', 'mechanic_name', 'work_date', 'billed_hours', 'worked_hours', 'internal_hours', 'warranty_hours'] as const;
  for (const k of keys) {
    const v = l[k];
    if (v === undefined) continue;
    out[k] = v !== null && k.endsWith('_hours') ? Number(v) : v;
  }
  return out as Partial<LabourTime>;
}

/** Résumé du temps saisi sous la désignation d'une ligne MO (« John · 1,5 h fact. · 2 h passées »). */
function timeSummary(l: Partial<LabourTime>): string {
  const h = (n: number | null | undefined) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');
  const parts: string[] = [];
  if (l.mechanic_name || l.mechanic_code) parts.push(l.mechanic_name || l.mechanic_code || '');
  if (l.billed_hours != null) parts.push(`${h(l.billed_hours)} h ${t('labourTime.shortBilled')}`);
  if (l.worked_hours != null) parts.push(`${h(l.worked_hours)} h ${t('labourTime.shortWorked')}`);
  if (l.internal_hours) parts.push(`${h(l.internal_hours)} h ${t('labourTime.shortInternal')}`);
  if (l.warranty_hours) parts.push(`${h(l.warranty_hours)} h ${t('labourTime.shortWarranty')}`);
  return parts.join(' · ');
}

function Picked({ label, onClear }: { label: string; onClear: () => void }) {
  return <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"><span className="truncate">{label}</span><button type="button" onClick={onClear} className="ml-auto text-muted-foreground hover:text-danger"><X className="size-4" /></button></div>;
}
function ContactPicker({ companyId, onPick }: { companyId: string; onPick: (c: Contact) => void }) {
  const [term, setTerm] = useState(''); const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['ro-cpick', companyId, deb], queryFn: () => listContacts(companyId, deb, undefined, PICKER_LIMIT), enabled: deb.length >= 2 });
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
function Field({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>
        {action}
      </div>
      {children}
    </div>
  );
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
