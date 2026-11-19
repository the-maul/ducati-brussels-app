/**
 * M8 — Rattrapage G8 « OR de base » (18/11/2026) : regles pures, sans acces base ni React.
 * Testees dans `tests/workshop-or-base.test.ts`.
 *
 * - Statuts d'OR alignes sur G8 (A faire, Attente devis, Pieces en commande, En cours, Pret,
 *   Client informe) en gardant les statuts du DMS (facture, annule).
 * - Les 30 points G8 « a verifier (V) / a remplacer (R) ».
 * - Kilometrage obligatoire + controle « inferieur au dernier releve » (avertissement a confirmer).
 * - Liste des OR : vues (OR, devis de reparation, garantie, accident), recherche, pagination, export.
 * - Impression : OR seul / fiche de travail seule / OR + fiche, chiffree ou non, sans nom du client.
 * - Rappel de RDV : le SMS ne part que si la case du RDV est cochee (miroir de la migration).
 */

// ---------------------------------------------------------------------------------------------
// Statuts
// ---------------------------------------------------------------------------------------------

/** Statuts que l'on choisit a l'ecran, dans l'ordre G8. */
export const OR_EDIT_STATUSES = ['a_faire', 'attente_devis', 'attente_pieces', 'en_cours', 'pret', 'client_informe'] as const;
/** Tous les statuts (filtres de la liste) : ceux de l'ecran + facture / annule poses par le DMS. */
export const OR_ALL_STATUSES = [...OR_EDIT_STATUSES, 'facture', 'annule'] as const;
export type OrStatus = (typeof OR_ALL_STATUSES)[number];
/** OR encore « ouverts » : la pointeuse peut y pointer du travail. */
export const OR_WORKABLE_STATUSES = ['a_faire', 'attente_devis', 'attente_pieces', 'en_cours'] as const;
/** OR non termines (filtre « Ouverts » de la liste). */
export const OR_OPEN_STATUSES = OR_EDIT_STATUSES;

export type OrTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function isOrStatus(s: unknown): s is OrStatus {
  return typeof s === 'string' && (OR_ALL_STATUSES as readonly string[]).includes(s);
}

/** Couleur du statut (toujours avec icone + libelle, charte §1). */
export function orStatusTone(s: string): OrTone {
  // Decision Q43 (18/11) : « en travail » (en cours, info) se distingue de « deposee / a faire »
  // (neutre) ; termine (pret, client informe) = succes ; facture / annule = neutre (archive),
  // comme les statuts du RDV au planning (planning/rules.ts).
  switch (s) {
    case 'en_cours': return 'info';
    case 'pret': case 'client_informe': return 'success';
    case 'facture': case 'annule': return 'neutral';
    case 'attente_devis': case 'attente_pieces': return 'warning';
    default: return 'neutral';
  }
}

/** Statuts depuis lesquels l'OR peut « Demarrer » (passer en cours, decision Q43 du 18/11). */
export const OR_STARTABLE_STATUSES = ['a_faire', 'attente_devis', 'attente_pieces'] as const;
export const canStartOr = (s: string | null | undefined): boolean =>
  !!s && (OR_STARTABLE_STATUSES as readonly string[]).includes(s);

/** Statut a afficher dans le choix de l'ecran : un OR facture / annule garde « a faire » (comme avant). */
export function editableStatus(s: string | null | undefined): string {
  return s && (OR_EDIT_STATUSES as readonly string[]).includes(s) ? s : 'a_faire';
}

/** Proposer de prevenir le client que sa moto est prete : statut « pret » enregistre et un client. */
export function canNotifyReady(p: { status: string | null | undefined; hasContact: boolean }): boolean {
  return p.status === 'pret' && p.hasContact;
}

// ---------------------------------------------------------------------------------------------
// Les 30 points G8 « Elements a verifier (V) ou a remplacer (R) »
// ---------------------------------------------------------------------------------------------

export const CHECK_POINTS = [
  'bougie', 'jeu_soupapes', 'filtre_air', 'jeu_poignee_gaz', 'vitesse_ralenti', 'synchro_carbu',
  'circuit_alimentation', 'huile_moteur', 'pompe_huile', 'filtre_huile', 'huile_bv', 'liquide_refroidissement',
  'filtre_carburant', 'liquide_embrayage', 'usure_chaine', 'chaine_transmission', 'tension_chaine', 'ecrous_fixations',
  'durites_frein', 'plaquettes_av', 'plaquettes_ar', 'liquide_frein', 'direction', 'huile_fourche',
  'usure_pneus', 'pivot_bras', 'graissage', 'decalaminage_pot', 'eclairage', 'lavage',
] as const;
export type CheckPointCode = (typeof CHECK_POINTS)[number];
export type CheckMark = 'V' | 'R';
export type CheckPoints = Partial<Record<CheckPointCode, CheckMark>>;

/** Relit la colonne jsonb : codes connus et marques V / R seulement (le reste est ignore). */
export function normalizeCheckPoints(raw: unknown): CheckPoints {
  const out: CheckPoints = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const code of CHECK_POINTS) {
    const v = (raw as Record<string, unknown>)[code];
    if (v === 'V' || v === 'R') out[code] = v;
  }
  return out;
}

/** Cocher V ou R ; recliquer sur la marque deja posee l'enleve (comme la case G8). */
export function toggleCheckPoint(cp: CheckPoints, code: CheckPointCode, mark: CheckMark): CheckPoints {
  const next: CheckPoints = { ...cp };
  if (next[code] === mark) delete next[code];
  else next[code] = mark;
  return next;
}

export function countCheckPoints(cp: CheckPoints): { v: number; r: number } {
  let v = 0, r = 0;
  for (const m of Object.values(cp)) { if (m === 'V') v++; else if (m === 'R') r++; }
  return { v, r };
}

// ---------------------------------------------------------------------------------------------
// Kilometrage
// ---------------------------------------------------------------------------------------------

export type MileageSource = 'or' | 'vehicle' | 'service' | 'declared' | 'appointment';
export type MileageReading = { km: number; at: string | null; source: MileageSource; ref?: string | null; orId?: string | null };

/**
 * Dernier releve = le plus grand kilometrage connu de la moto (un compteur ne recule pas) ;
 * a km egal, le plus recent. Les releves vides, negatifs ou de l'OR en cours sont ignores.
 * `before` (OR deja enregistre) : seuls les releves anterieurs a l'OR comptent (un OR ancien
 * n'est pas compare aux OR venus apres lui).
 */
export function lastReading(readings: ReadonlyArray<MileageReading>, excludeOrId?: string | null, before?: string | null): MileageReading | null {
  let best: MileageReading | null = null;
  for (const r of readings) {
    if (!Number.isFinite(r.km) || r.km <= 0) continue;
    if (excludeOrId && r.orId === excludeOrId) continue;
    if (before && r.at && r.at > before) continue;
    if (!best || r.km > best.km || (r.km === best.km && (r.at ?? '') > (best.at ?? ''))) best = r;
  }
  return best;
}

/** Lit la saisie (« 12 500 », « 12500 », « 12.500 ») en entier ; null si vide ou illisible. */
export function parseMileage(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[\s  .']/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export type MileageCheck =
  | { kind: 'ok'; km: number | null }
  | { kind: 'required' }
  | { kind: 'invalid' }
  | { kind: 'lower'; km: number; last: MileageReading };

/**
 * Decision Q42 (18/11, comme G8) : le km est obligatoire a la CREATION de l'OR et quand une moto est
 * rattachee (ou changee) ; ensuite il reste modifiable mais n'est plus redemande a chaque
 * modification. Meme regle en base (trg_repair_orders_mileage_required, 20261119190000).
 */
export function mileageRequired(p: { isNew: boolean; savedVehicleId: string | null | undefined; vehicleId: string | null | undefined }): boolean {
  if (!p.vehicleId) return false;
  return p.isNew || (p.savedVehicleId ?? null) !== p.vehicleId;
}

/**
 * Controle G8 a l'enregistrement de l'OR : km obligatoire quand `required` (sinon : des qu'une moto
 * est choisie, ancien comportement) ; un km inferieur au dernier releve bloque tant que
 * l'utilisateur ne l'a pas confirme (`confirmed`).
 */
export function checkMileage(p: { input: string; hasVehicle: boolean; last: MileageReading | null; confirmed?: boolean; required?: boolean }): MileageCheck {
  const raw = p.input.trim();
  if (!raw) return (p.required ?? p.hasVehicle) ? { kind: 'required' } : { kind: 'ok', km: null };
  const km = parseMileage(raw);
  if (km == null) return { kind: 'invalid' };
  if (p.hasVehicle && p.last && km < p.last.km && !p.confirmed) return { kind: 'lower', km, last: p.last };
  return { kind: 'ok', km };
}

/** Valeur a garder dans `mileage_ack_previous` : le releve depasse quand l'utilisateur a confirme. */
export function mileageAck(km: number | null, last: MileageReading | null): number | null {
  return km != null && last && km < last.km ? last.km : null;
}

// ---------------------------------------------------------------------------------------------
// Liste des OR
// ---------------------------------------------------------------------------------------------

export const OR_LIST_VIEWS = ['or', 'devis', 'garantie', 'accident'] as const;
export type OrListView = (typeof OR_LIST_VIEWS)[number];
export const OR_LIST_PAGE_SIZE = 50;

export function isOrListView(v: unknown): v is OrListView {
  return typeof v === 'string' && (OR_LIST_VIEWS as readonly string[]).includes(v);
}

/**
 * Filtre PostgREST (`or=(...)`) de la vue. null = pas de filtre (vue OR : tous les OR).
 * - devis de reparation : attente devis, ou proposition d'intervention en attente d'accord ;
 * - garantie : prise en charge engagee ou type garantie ;
 * - accident : motif ou type accident, ou expert renseigne.
 * `withApproval = false` : colonne `customer_approval` absente (migration du 31/10 non posee).
 */
export function viewFilter(view: OrListView, withApproval = true): string | null {
  switch (view) {
    case 'devis': return withApproval ? 'status.eq.attente_devis,customer_approval.eq.en_attente' : 'status.eq.attente_devis';
    case 'garantie': return 'warranty_status.neq.aucune,repair_type.like.garantie*';
    case 'accident': return 'repair_type.eq.accident,reason_code.eq.accident,expert_name.not.is.null';
    default: return null;
  }
}

/** Texte cherche sans les caracteres qui cassent un filtre PostgREST. */
export function sanitizeSearch(term: string | null | undefined): string {
  return String(term ?? '').replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Recherche G8 « N° d'O.R. · Immat. · Client · Chassis » : numero de l'OR, ou un des clients /
 * une des motos trouves au prealable (nom / code client, plaque / VIN / modele / reference).
 */
export function searchFilter(term: string, contactIds: ReadonlyArray<string>, vehicleIds: ReadonlyArray<string>): string | null {
  const s = sanitizeSearch(term);
  if (!s) return null;
  const parts = [`number.ilike.*${s}*`];
  if (contactIds.length) parts.push(`contact_id.in.(${contactIds.join(',')})`);
  if (vehicleIds.length) parts.push(`vehicle_id.in.(${vehicleIds.join(',')})`);
  return parts.join(',');
}

/** Deux filtres « ou » cumules (vue ET recherche) dans un seul parametre `or`. */
export function combineOrFilters(a: string | null, b: string | null): string | null {
  if (a && b) return `and(or(${a}),or(${b}))`;
  return a ?? b ?? null;
}

/** Bornes `range()` d'une page (page 1 = premiere). */
export function pageRange(page: number, size = OR_LIST_PAGE_SIZE): { from: number; to: number } {
  const p = Math.max(1, Math.floor(page) || 1);
  return { from: (p - 1) * size, to: p * size - 1 };
}

export function pageCount(total: number, size = OR_LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/** Debut / fin de periode (dates AAAA-MM-JJ) en bornes ISO : la fin est incluse (jour entier). */
export function periodBounds(from: string | null | undefined, to: string | null | undefined): { gte: string | null; lt: string | null } {
  const ok = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  let lt: string | null = null;
  if (ok(to)) {
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    lt = d.toISOString().slice(0, 10);
  }
  return { gte: ok(from) ? (from as string) : null, lt };
}

export type OrListRow = {
  id: string; number: string | null; status: string; warranty_status: string; repair_type: string | null;
  created_at: string; promised_at: string | null; operator: string | null; total_ttc: number; mileage: number | null;
  expert_name: string | null; expert_date: string | null;
  client: string; vehicleRef: string | null; vehicleModel: string | null; plate: string | null; vin: string | null;
};

/** Date (AAAA-MM-JJ) → JJ/MM/AAAA ; horodatage → JJ/MM/AAAA HH:MM a l'heure locale du poste. */
const dmy = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d0 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (d0) return `${d0[3]}/${d0[2]}/${d0[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const formatOrDate = dmy;

/** Grille de l'export Excel (en-tete + une ligne par OR), montants en nombres. */
/**
 * Grille de l'export Excel. `deposit` (decision Q45 du 18/11) : acompte net de l'OR, en DERNIERE
 * colonne (les colonnes d'avant gardent leur place) ; vide sans acompte.
 */
export function exportGrid(rows: ReadonlyArray<OrListRow>, h: { headers: string[]; status: (s: string) => string; warranty: (s: string) => string; deposit?: (id: string) => number | null }): (string | number)[][] {
  return [
    h.headers,
    ...rows.map((r) => {
      const base: (string | number)[] = [
        r.number ?? '', r.client, r.vehicleRef ?? '', r.vehicleModel ?? '', r.plate ?? '', r.vin ?? '',
        dmy(r.created_at), dmy(r.promised_at), r.operator ?? '', r.mileage ?? '', Math.round(Number(r.total_ttc) * 100) / 100,
        h.status(r.status), r.warranty_status && r.warranty_status !== 'aucune' ? h.warranty(r.warranty_status) : '',
      ];
      if (h.deposit) { const d = h.deposit(r.id); base.push(d != null && d !== 0 ? Math.round(d * 100) / 100 : ''); }
      return base;
    }),
  ];
}

// ---------------------------------------------------------------------------------------------
// Impression de l'OR et de la fiche de travail
// ---------------------------------------------------------------------------------------------

/** Formats d'impression (decision Q46 du 18/11) : PDF A4 (defaut) ou ticket 80 mm. */
export const OR_PRINT_FORMATS = ['a4', 'ticket'] as const;
export type OrPrintFormat = (typeof OR_PRINT_FORMATS)[number];
export const OR_PRINT_MODES = ['or', 'fiche', 'both'] as const;
export type OrPrintMode = (typeof OR_PRINT_MODES)[number];
export type OrPrintOptions = { mode: OrPrintMode; priced: boolean; hideClient: boolean };

/** Pages a produire : l'OR (remis au client, signature de depot) et / ou la fiche de travail (atelier). */
export function printParts(mode: OrPrintMode): { or: boolean; fiche: boolean } {
  return { or: mode === 'or' || mode === 'both', fiche: mode === 'fiche' || mode === 'both' };
}

export type PrintLineIn = { kind: string; designation: string; quantity: number; unit_price_ht: number; vat_rate: number; discount_pct: number; is_warranty: boolean; line_ttc?: number | null; checkup_state?: string | null };
export type PrintLine = { kind: string; designation: string; quantity: number; unitTtc: number | null; totalTtc: number | null; warranty: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lignes imprimees : les actions du check-up « OK » ou « reportees » ne sont pas des travaux.
 * Edition chiffree : PU et total TTC (garantie = 0) ; sinon montants a null (rien n'est imprime).
 */
export function printLines(lines: ReadonlyArray<PrintLineIn>, priced: boolean): PrintLine[] {
  return lines
    .filter((l) => l.checkup_state !== 'ok' && l.checkup_state !== 'reporte')
    .filter((l) => l.designation.trim() !== '')
    .map((l) => {
      const unitHt = l.is_warranty ? 0 : Number(l.unit_price_ht) * (1 - (Number(l.discount_pct) || 0) / 100);
      const unitTtc = r2(unitHt * (1 + (Number(l.vat_rate) || 0) / 100));
      const total = r2(unitTtc * Number(l.quantity));
      return {
        kind: l.kind, designation: l.designation, quantity: Number(l.quantity),
        unitTtc: priced && l.kind !== 'texte' ? unitTtc : null,
        totalTtc: priced && l.kind !== 'texte' ? total : null,
        warranty: l.is_warranty,
      };
    });
}

/** Nom de fichier du PDF : OR_<numero>[_FICHE].pdf. */
export function printFileName(number: string | null | undefined, mode: OrPrintMode): string {
  const n = String(number ?? '').replace(/[^A-Za-z0-9_-]+/g, '-') || 'OR';
  return `OR_${n}${mode === 'fiche' ? '_FICHE' : mode === 'both' ? '_OR-FICHE' : ''}.pdf`;
}

// ---------------------------------------------------------------------------------------------
// Rappel de RDV (miroir de _cron_appointment_reminders, migration 20261118100000)
// ---------------------------------------------------------------------------------------------

/** Le SMS de rappel ne part que si la case « SMS de rappel » du RDV est cochee et qu'un numero existe. */
export function reminderSmsTo(p: { notify_sms: boolean | null | undefined; mobile?: string | null; phone?: string | null }): string | null {
  if (!p.notify_sms) return null;
  const n = (p.mobile ?? '').trim() || (p.phone ?? '').trim();
  return n || null;
}
