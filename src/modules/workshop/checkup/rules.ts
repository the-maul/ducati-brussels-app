/**
 * M8 — Check-up a l'accueil, proposition d'intervention, accord client, interventions
 * reportees (ATE008, ATE009 ; decision client du 30/10/2026). REGLES PURES, sans acces base,
 * testees dans tests/workshop-checkup.test.ts.
 *
 * Une CARTE du check-up (une action : « Plaquettes avant usees », « Vidange »...) est portee
 * par les lignes de l'OR : une ligne main-d'oeuvre (libelle, etat, photo, heures) + ses lignes
 * pieces, reunies par `checkup_key`. Prix = heures x taux horaire HT de l'atelier (Parametres →
 * Tables → Frais de devis atelier → hourly_rate_ht) + pieces au prix de vente.
 */
import type { RoLineInput } from '../write-api';

export type CheckupState = 'ok' | 'a_faire' | 'a_prevoir' | 'reporte';
export const CHECKUP_STATES: readonly CheckupState[] = ['ok', 'a_faire', 'a_prevoir'];

/** Etats qui entrent dans la proposition envoyee au client. */
export const PROPOSED_STATES: readonly CheckupState[] = ['a_faire', 'a_prevoir'];

export type CheckupPart = {
  key: string;
  article_id: string | null;
  reference: string | null;
  designation: string;
  quantity: number;
  unit_price_ht: number;
  vat_rate: number;
  proposal_line_id?: string | null;
};

export type CheckupCard = {
  key: string;
  label: string;
  state: CheckupState;
  photo_path: string | null;
  /** Heures decimales (0 = constat sans main-d'oeuvre). */
  hours: number;
  /** Taux horaire HT fige sur la carte (null = taux de l'atelier au moment du calcul). */
  hourly_rate_ht: number | null;
  vat_rate: number;
  parts: CheckupPart[];
  proposal_line_id?: string | null;
  /** D'ou vient la carte : plan d'entretien, constat de l'atelier, saisie. */
  origin?: 'plan' | 'constat' | 'manuel';
  /** Temps propose (plan / bareme), pour l'afficher a cote de la saisie. */
  suggested_hours?: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

let seq = 0;
/** Cle stable d'une carte ou d'une piece (unique dans l'OR, survit aux reecritures de lignes). */
export function newCheckupKey(prefix = 'ck'): string {
  seq += 1;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${seq}_${rnd}`;
}

export function blankCard(p: Partial<CheckupCard> = {}): CheckupCard {
  return {
    key: newCheckupKey(), label: '', state: 'a_faire', photo_path: null, hours: 0, hourly_rate_ht: null,
    vat_rate: 21, parts: [], proposal_line_id: null, origin: 'constat', suggested_hours: null, ...p,
  };
}

export function blankPart(p: Partial<CheckupPart> = {}): CheckupPart {
  return { key: newCheckupKey('pt'), article_id: null, reference: null, designation: '', quantity: 1, unit_price_ht: 0, vat_rate: 21, ...p };
}

/** Taux applique a une carte : le sien s'il est fige, sinon celui de l'atelier (0 si inconnu). */
export function cardRate(card: Pick<CheckupCard, 'hourly_rate_ht'>, rate: number | null | undefined): number {
  if (card.hourly_rate_ht != null && Number.isFinite(card.hourly_rate_ht)) return card.hourly_rate_ht;
  return rate != null && Number.isFinite(rate) && rate > 0 ? rate : 0;
}

export function cardLabourHt(card: Pick<CheckupCard, 'hours' | 'hourly_rate_ht'>, rate: number | null | undefined): number {
  return r2(num(card.hours) * cardRate(card, rate));
}

export function cardPartsHt(card: Pick<CheckupCard, 'parts'>): number {
  return r2(card.parts.reduce((s, p) => s + num(p.quantity) * num(p.unit_price_ht), 0));
}

/** Prix d'une carte : MO = heures x taux, pieces = somme qte x PV ; TTC avec la TVA de chaque partie. */
export function cardPrice(card: CheckupCard, rate: number | null | undefined): { labourHt: number; partsHt: number; totalHt: number; totalTtc: number } {
  const labourHt = cardLabourHt(card, rate);
  const partsHt = cardPartsHt(card);
  const labourTtc = labourHt * (1 + num(card.vat_rate) / 100);
  const partsTtc = card.parts.reduce((s, p) => s + num(p.quantity) * num(p.unit_price_ht) * (1 + num(p.vat_rate) / 100), 0);
  return { labourHt, partsHt, totalHt: r2(labourHt + partsHt), totalTtc: r2(labourTtc + partsTtc) };
}

/** Total du check-up : seulement les actions proposees (a faire + a prevoir), jamais OK ni reportees. */
export function checkupTotals(cards: CheckupCard[], rate: number | null | undefined): { ht: number; vat: number; ttc: number; count: number } {
  let ht = 0, ttc = 0, count = 0;
  for (const c of cards) {
    if (!PROPOSED_STATES.includes(c.state)) continue;
    const p = cardPrice(c, rate);
    ht += p.totalHt; ttc += p.totalTtc; count += 1;
  }
  ht = r2(ht); ttc = r2(ttc);
  return { ht, vat: r2(ttc - ht), ttc, count };
}

/**
 * Cartes → lignes de l'OR. La ligne main-d'oeuvre porte le libelle, l'etat, la photo et les
 * heures (quantite) au taux horaire ; les pieces suivent avec la meme cle et le meme etat.
 * Une carte a 0 h garde sa ligne (libelle, etat) : elle n'a simplement pas de montant.
 */
export function cardsToLines(cards: CheckupCard[], rate: number | null | undefined): RoLineInput[] {
  const out: RoLineInput[] = [];
  for (const c of cards) {
    out.push({
      kind: 'mo', article_id: null, designation: c.label, quantity: num(c.hours), unit_price_ht: cardRate(c, rate),
      vat_rate: num(c.vat_rate) || 21, discount_pct: 0, is_warranty: false,
      checkup_key: c.key, checkup_state: c.state, photo_path: c.photo_path, proposal_line_id: c.proposal_line_id ?? null,
    });
    for (const p of c.parts) {
      out.push({
        kind: 'piece', article_id: p.article_id, designation: p.designation, quantity: num(p.quantity), unit_price_ht: num(p.unit_price_ht),
        vat_rate: num(p.vat_rate) || 21, discount_pct: 0, is_warranty: false,
        checkup_key: c.key, checkup_state: c.state, photo_path: null, proposal_line_id: p.proposal_line_id ?? null,
      });
    }
  }
  return out;
}

type LineLike = {
  kind: string; article_id?: string | null; designation: string; quantity: number | string; unit_price_ht: number | string;
  vat_rate: number | string; checkup_key?: string | null; checkup_state?: string | null; photo_path?: string | null;
  proposal_line_id?: string | null; reference?: string | null;
};

/** Lignes de l'OR → cartes (par `checkup_key`, dans l'ordre d'apparition). Les lignes sans cle sont ignorees. */
export function linesToCards(lines: LineLike[]): CheckupCard[] {
  const byKey = new Map<string, CheckupCard>();
  for (const l of lines) {
    const key = l.checkup_key;
    if (!key) continue;
    const state = (['ok', 'a_faire', 'a_prevoir', 'reporte'] as const).includes(l.checkup_state as CheckupState) ? (l.checkup_state as CheckupState) : 'a_faire';
    let card = byKey.get(key);
    if (!card) {
      card = blankCard({ key, label: '', state, hours: 0, hourly_rate_ht: null, parts: [], origin: 'manuel' });
      byKey.set(key, card);
    }
    if (l.kind === 'mo') {
      card.label = l.designation;
      card.state = state;
      card.hours = num(l.quantity);
      card.hourly_rate_ht = num(l.unit_price_ht) > 0 ? num(l.unit_price_ht) : null;
      card.vat_rate = num(l.vat_rate) || 21;
      card.photo_path = l.photo_path ?? null;
      card.proposal_line_id = l.proposal_line_id ?? null;
    } else {
      card.parts.push({
        key: newCheckupKey('pt'), article_id: l.article_id ?? null, reference: l.reference ?? null, designation: l.designation,
        quantity: num(l.quantity), unit_price_ht: num(l.unit_price_ht), vat_rate: num(l.vat_rate) || 21, proposal_line_id: l.proposal_line_id ?? null,
      });
      if (!card.label) card.label = l.designation;
    }
  }
  return [...byKey.values()];
}

/** Lignes classiques (hors check-up) de l'OR. */
export function nonCheckupLines<T extends { checkup_key?: string | null }>(lines: T[]): T[] {
  return lines.filter((l) => !l.checkup_key);
}

// ---------------------------------------------------------------------------------------------
// Accord client et garde-fou
// ---------------------------------------------------------------------------------------------

export type ApprovalState = 'none' | 'en_attente' | 'signe' | 'accord_verbal' | 'refuse';

export function approvalState(or: { customer_approval?: string | null } | null | undefined): ApprovalState {
  const v = or?.customer_approval;
  return v === 'en_attente' || v === 'signe' || v === 'accord_verbal' || v === 'refuse' ? v : 'none';
}

/**
 * « Aucune intervention sans accord trace » : tant qu'une proposition est en attente (ou refusee),
 * l'atelier ne demarre ni chrono ni parcours sur cet OR. Sans proposition, rien ne bloque.
 */
export function canStartWork(or: { customer_approval?: string | null } | null | undefined): boolean {
  const s = approvalState(or);
  return s === 'none' || s === 'signe' || s === 'accord_verbal';
}

// ---------------------------------------------------------------------------------------------
// Proposition : groupes (cartes) a cocher, partition gardees / reportees, texte accepte
// ---------------------------------------------------------------------------------------------

export type ProposalLine = {
  id: string;
  line_type: string;
  reference?: string | null;
  designation: string;
  quantity: number | string;
  unit_price_ht: number | string;
  vat_rate: number | string;
  discount_pct?: number | string | null;
  line_ht: number | string;
  line_ttc: number | string;
  sort_order?: number;
  checkup_key?: string | null;
  accepted?: boolean | null;
  photo_path?: string | null;
};

export type ProposalGroup = {
  /** Identifiant de la case a cocher = ligne de tete (la main-d'oeuvre de la carte). */
  id: string;
  key: string;
  label: string;
  lines: ProposalLine[];
  photo_path: string | null;
  hours: number;
  totalHt: number;
  totalTtc: number;
  accepted: boolean | null;
};

/** Les lignes de la proposition regroupees par carte (checkup_key), dans l'ordre ; ligne isolee = son propre groupe. */
export function proposalGroups(lines: ProposalLine[]): ProposalGroup[] {
  const sorted = [...lines].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const groups: ProposalGroup[] = [];
  const byKey = new Map<string, ProposalGroup>();
  for (const l of sorted) {
    const key = l.checkup_key || l.id;
    let g = byKey.get(key);
    if (!g) {
      g = { id: l.id, key, label: l.designation, lines: [], photo_path: null, hours: 0, totalHt: 0, totalTtc: 0, accepted: l.accepted ?? null };
      byKey.set(key, g);
      groups.push(g);
    }
    g.lines.push(l);
    if (l.line_type === 'main_oeuvre') { g.label = l.designation; g.hours += num(l.quantity); g.id = l.id; }
    if (l.photo_path && !g.photo_path) g.photo_path = l.photo_path;
    g.totalHt = r2(g.totalHt + num(l.line_ht));
    g.totalTtc = r2(g.totalTtc + num(l.line_ttc));
    if (l.accepted === false) g.accepted = false;
  }
  return groups;
}

/** Partition a la signature : groupes gardes (coches) et reportes (decoches), avec les totaux. */
export function partitionProposal(groups: ProposalGroup[], keptIds: Iterable<string>): {
  kept: ProposalGroup[]; deferred: ProposalGroup[]; keptLineIds: string[]; totalHt: number; totalTtc: number; deferredTtc: number;
} {
  const keep = new Set(keptIds);
  const kept = groups.filter((g) => keep.has(g.id));
  const deferred = groups.filter((g) => !keep.has(g.id));
  return {
    kept, deferred,
    keptLineIds: kept.flatMap((g) => g.lines.map((l) => l.id)),
    totalHt: r2(kept.reduce((s, g) => s + g.totalHt, 0)),
    totalTtc: r2(kept.reduce((s, g) => s + g.totalTtc, 0)),
    deferredTtc: r2(deferred.reduce((s, g) => s + g.totalTtc, 0)),
  };
}

/** Brouillons d'interventions reportees, miroir de ce que la base cree (une par carte decochee). */
export function deferredFromDeclined(deferred: ProposalGroup[]): { document_line_id: string; label: string; amount_ttc: number; status: 'a_planifier' }[] {
  return deferred.map((g) => ({ document_line_id: g.lines[0]?.id ?? g.id, label: g.label, amount_ttc: g.totalTtc, status: 'a_planifier' }));
}

export const eurText = (n: number): string => `${r2(n).toFixed(2).replace('.', ',')} EUR`;

/**
 * Texte EXACT accepte par le client (celui dont on garde l'empreinte) : numero, client, moto,
 * chaque carte gardee avec son montant TTC, total TTC, phrase d'acceptation, nom, date.
 * Deterministe : memes entrees → meme texte → meme empreinte.
 */
export function acceptedTextFor(p: {
  number: string | null; companyName: string; clientName: string; vehicleLabel: string | null;
  kept: ProposalGroup[]; totalTtc: number; signerName: string; sentence: string; dateIso: string;
}): string {
  const lines = [
    `${p.companyName} - ${p.number ?? ''}`.trim(),
    `Client : ${p.clientName}`,
    p.vehicleLabel ? `Moto : ${p.vehicleLabel}` : '',
    ...p.kept.map((g) => `[x] ${g.label} - ${eurText(g.totalTtc)}`),
    `Total TTC : ${eurText(p.totalTtc)}`,
    p.sentence,
    `${p.signerName.trim()} - ${p.dateIso.slice(0, 10)}`,
  ].filter((l) => l !== '');
  return lines.join('\n');
}

/** Empreinte SHA-256 (hexadecimal) d'un texte, via Web Crypto (navigateur et bun). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------------------------
// Interventions reportees : date proposee au comptoir
// ---------------------------------------------------------------------------------------------

export const DEFERRED_DEFAULT_DAYS = 30;

/** Date proposee par defaut pour les interventions reportees : aujourd'hui + 30 jours (AAAA-MM-JJ). */
export function defaultPlannedDate(today: Date | string = new Date(), days = DEFERRED_DEFAULT_DAYS): string {
  const base = typeof today === 'string' ? new Date(`${today.slice(0, 10)}T00:00:00Z`) : new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Lignes de l'OR a facturer : jamais les actions OK ni reportees ; une carte sans heures devient un texte. */
export function invoiceableRoLines<T extends { kind: string; quantity: number | string; unit_price_ht: number | string; checkup_state?: string | null }>(lines: T[]): (T & { as_text: boolean })[] {
  return lines
    .filter((l) => l.checkup_state !== 'ok' && l.checkup_state !== 'reporte')
    .map((l) => ({ ...l, as_text: l.kind === 'mo' && !!l.checkup_state && num(l.quantity) === 0 }));
}

/** Code de motif qui pre-remplit les actions du plan d'entretien de la moto. */
export function isMaintenanceReason(code: string | null | undefined): boolean {
  return !!code && (code.startsWith('entretien') || code === 'vidange');
}

/** Pour un motif d'entretien : quelle echeance du plan ? (km cible, ou annuel / vidange) */
export function reasonTarget(code: string | null | undefined): { km: number | null; annual: boolean; oil: boolean } {
  const m = String(code ?? '').match(/(\d{3,6})/);
  return { km: m ? Number(m[1]) : null, annual: code === 'entretien_annuel', oil: code === 'vidange' };
}

/**
 * Choisit l'echeance du plan la plus proche du motif : meme km (intervalle en vigueur), sinon
 * annuelle (12 mois), sinon vidange (nom contenant oil / vidange), sinon la premiere.
 */
export function pickServiceForReason<T extends { name: string; code: string; kmFirst: number | null; kmInterval: number | null; months: number | null }>(
  services: T[], code: string | null | undefined,
): T | null {
  if (!services.length) return null;
  const target = reasonTarget(code);
  if (target.km) {
    const exact = services.find((s) => s.kmFirst === target.km || s.kmInterval === target.km);
    if (exact) return exact;
    const byName = services.find((s) => s.name.replace(/\s|\./g, '').includes(String(target.km)));
    if (byName) return byName;
  }
  if (target.annual) {
    const annual = services.find((s) => /annu/i.test(s.name) || /annu/i.test(s.code)) ?? services.find((s) => s.months === 12);
    if (annual) return annual;
  }
  if (target.oil) {
    const oil = services.find((s) => /oil|vidange|huile/i.test(s.name) || /oil/i.test(s.code));
    if (oil) return oil;
  }
  return services[0];
}
