/**
 * M8 — Temps de main-d'oeuvre atelier (rattrapage G8 du 18/11/2026, B11). Regles PURES (aucun
 * import) : testees par tests/workshop-temps-mo.test.ts.
 *
 * - « Gestion du temps atelier » (G8) par ligne MO : mecanicien, heures facturees / passees /
 *   internes / garanties, date des travaux. Sur une ligne MO, la QUANTITE = les heures facturees.
 *   Regle G8 : des heures internes ou garanties sur une ligne remettent les heures facturees a zero
 *   (le temps facture se saisit sur une nouvelle ligne MO).
 * - « Controle du temps atelier » avant facture : valeurs proposees (temps pointe de l'OR repris
 *   quand il n'y a qu'une ligne MO), rapprochement passe / facture / pointe.
 * - Productivite atelier (G8 « Productivite atelier ») : cumul par mecanicien / jour / semaine /
 *   mois, temps non facture, ratios, tableau pour Excel. La base donne une ligne par jour et par
 *   mecanicien (`workshop_productivity_detail`, migration 20261118110000).
 */

export type LabourTime = {
  mechanic_code: string | null;
  mechanic_name: string | null;
  work_date: string | null;
  billed_hours: number | null;
  worked_hours: number | null;
  internal_hours: number | null;
  warranty_hours: number | null;
};

export const EMPTY_LABOUR_TIME: LabourTime = {
  mechanic_code: null, mechanic_name: null, work_date: null,
  billed_hours: null, worked_hours: null, internal_hours: null, warranty_hours: null,
};

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Nombre >= 0 arrondi a 2 decimales ; vide / invalide → null. Accepte la virgule. */
export function hoursOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return r2(Math.max(0, n));
}
const h0 = (v: unknown) => hoursOrNull(v) ?? 0;

// ---------------------------------------------------------------------------------------------
// Fenetre « Gestion du temps atelier »
// ---------------------------------------------------------------------------------------------

export type TimeWindowInput = { billed: unknown; worked: unknown; internal: unknown; warranty: unknown };
export type TimeWindowResult = {
  billed: number; worked: number | null; internal: number; warranty: number;
  /** true quand des heures facturees ont ete remises a zero (message G8 a afficher). */
  billedReset: boolean;
};

/** Applique la regle G8 : internes ou garanties > 0 → heures facturees remises a zero. */
export function applyTimeWindow(i: TimeWindowInput): TimeWindowResult {
  const billed = h0(i.billed), internal = h0(i.internal), warranty = h0(i.warranty);
  const worked = hoursOrNull(i.worked);
  if ((internal > 0 || warranty > 0) && billed > 0) return { billed: 0, worked, internal, warranty, billedReset: true };
  return { billed, worked, internal, warranty, billedReset: false };
}

type MoLike = {
  kind: string; quantity: number | string; is_warranty?: boolean | null;
  billed_hours?: number | string | null; worked_hours?: number | string | null;
  internal_hours?: number | string | null; warranty_hours?: number | string | null;
};

/** Quantite facturee d'une ligne : MO = heures facturees (la quantite les porte), autres = quantite. */
export function invoiceQuantity(l: MoLike): number {
  if (l.kind !== 'mo') return h0(l.quantity);
  const billed = hoursOrNull(l.billed_hours);
  return billed ?? h0(l.quantity);
}

/**
 * Ventilation d'une ligne MO pour la productivite (meme regle que `workshop_productivity_detail`) :
 * une ligne en garantie n'est pas facturee au client, ses heures sont des heures garanties.
 */
export function lineHours(l: MoLike, orStatus: string): { billed: number; toBill: number; internal: number; warranty: number; worked: number } {
  if (l.kind !== 'mo' || orStatus === 'annule') return { billed: 0, toBill: 0, internal: 0, warranty: 0, worked: 0 };
  const qty = h0(l.quantity);
  const hours = l.is_warranty ? 0 : qty;
  const warranty = hoursOrNull(l.warranty_hours) ?? (l.is_warranty ? qty : 0);
  const invoiced = orStatus === 'facture';
  return { billed: invoiced ? hours : 0, toBill: invoiced ? 0 : hours, internal: h0(l.internal_hours), warranty, worked: h0(l.worked_hours) };
}

// ---------------------------------------------------------------------------------------------
// Controle du temps atelier (avant facture)
// ---------------------------------------------------------------------------------------------

export type ControlLineSource = MoLike & {
  id: string; designation: string; unit_price_ht: number | string; discount_pct?: number | string | null;
  mechanic_code?: string | null; mechanic_name?: string | null; work_date?: string | null;
  checkup_state?: string | null;
};
export type PointedByMechanic = { mechanic_key: string; mechanic_code: string | null; mechanic_name: string | null; pointed_h: number };

export type ControlRow = {
  id: string; designation: string; unit_price_ht: number; discount_pct: number; is_warranty: boolean;
  mechanic_code: string | null; mechanic_name: string | null; work_date: string;
  billed: number; worked: number | null; internal: number; warranty: number;
};

/** Lignes du controle : les lignes MO facturables de l'OR (jamais les actions OK / reportees). */
export function controlRows(lines: ControlLineSource[], pointed: PointedByMechanic[], today: string): ControlRow[] {
  const mo = lines.filter((l) => l.kind === 'mo' && l.checkup_state !== 'ok' && l.checkup_state !== 'reporte');
  const totalPointed = r2(pointed.reduce((s, p) => s + h0(p.pointed_h), 0));
  const single = pointed.length === 1 ? pointed[0] : null;
  return mo.map((l) => {
    const hasMechanic = !!(l.mechanic_code || l.mechanic_name);
    const warranty = hoursOrNull(l.warranty_hours) ?? (l.is_warranty ? h0(l.quantity) : 0);
    return {
      id: l.id, designation: l.designation, unit_price_ht: h0(l.unit_price_ht), discount_pct: h0(l.discount_pct), is_warranty: !!l.is_warranty,
      mechanic_code: hasMechanic ? (l.mechanic_code ?? null) : (single?.mechanic_code ?? null),
      mechanic_name: hasMechanic ? (l.mechanic_name ?? null) : (single?.mechanic_name ?? null),
      work_date: l.work_date || today,
      // Sans temps saisi, G8 facturait 0 € : le DMS propose la quantite de la ligne.
      billed: l.is_warranty ? 0 : (hoursOrNull(l.billed_hours) ?? h0(l.quantity)),
      // Une seule ligne MO : le temps pointe sur l'OR est son temps passe.
      worked: hoursOrNull(l.worked_hours) ?? (mo.length === 1 && totalPointed > 0 ? totalPointed : null),
      internal: h0(l.internal_hours),
      warranty,
    };
  });
}

/** Ligne du controle apres saisie : regle G8 appliquee (internes / garanties → facturees a zero). */
export function normalizeControlRow(r: ControlRow): ControlRow & { billedReset: boolean } {
  const w = applyTimeWindow({ billed: r.billed, worked: r.worked, internal: r.internal, warranty: r.warranty });
  return { ...r, billed: w.billed, worked: w.worked, internal: w.internal, warranty: w.warranty, billedReset: w.billedReset };
}

/** Montant HT de la ligne MO a la facture (heures facturees x PU, remise ; garantie = 0). */
export function controlLineHt(r: Pick<ControlRow, 'billed' | 'unit_price_ht' | 'discount_pct' | 'is_warranty'>): number {
  return r2(r.billed * (r.is_warranty ? 0 : r.unit_price_ht) * (1 - (r.discount_pct || 0) / 100));
}

export type Reconciliation = {
  billed: number; worked: number; internal: number; warranty: number; pointed: number;
  /** Heures passees qui ne seront ni facturees, ni internes, ni garanties (>= 0). */
  notBilled: number;
  /** Passe saisi − pointe (positif : plus de temps declare que pointe). */
  gapPointed: number;
  /** Facture / passe en % (null si rien de passe). */
  billedPct: number | null;
};

/** Rapprochement temps passe / temps facture d'un OR (B11, controle avant facture). */
export function reconcile(rows: Pick<ControlRow, 'billed' | 'worked' | 'internal' | 'warranty'>[], pointedHours: number): Reconciliation {
  const billed = r2(rows.reduce((s, r) => s + h0(r.billed), 0));
  const internal = r2(rows.reduce((s, r) => s + h0(r.internal), 0));
  const warranty = r2(rows.reduce((s, r) => s + h0(r.warranty), 0));
  const declared = rows.some((r) => r.worked !== null && r.worked !== undefined);
  const pointed = r2(h0(pointedHours));
  // Passe = heures passees saisies ; sans saisie, le temps pointe de l'OR.
  const worked = declared ? r2(rows.reduce((s, r) => s + h0(r.worked), 0)) : pointed;
  return {
    billed, worked, internal, warranty, pointed,
    notBilled: r2(Math.max(0, worked - billed - internal - warranty)),
    gapPointed: r2(worked - pointed),
    billedPct: worked > 0 ? r2((billed / worked) * 100) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Productivite atelier (B11)
// ---------------------------------------------------------------------------------------------

/** Une ligne de `workshop_productivity_detail` (heures). */
export type ProductivityRow = {
  day: string; mechanic_key: string; mechanic_name: string;
  presence_h: number; pointed_h: number; improductive_h: number;
  billed_h: number; to_bill_h: number; internal_h: number; warranty_h: number; line_worked_h: number;
};

export type Granularity = 'mechanic' | 'day' | 'week' | 'month' | 'mechanic_day';

export type ProductivitySummary = {
  key: string; label: string; mechanicKey: string | null; period: string | null;
  presence: number; worked: number; billed: number; toBill: number; notBilled: number;
  internal: number; warranty: number; improductive: number;
  /** Heures facturees (+ a facturer si demande) / passe. */
  billedPct: number | null;
  /** (facture [+ a facturer] + internes + garanties) / passe : rendement production. */
  productionPct: number | null;
  /** passe / (passe + improductif) : rendement atelier. */
  efficiencyPct: number | null;
  /** improductif / presence. */
  improductivePct: number | null;
  /** passe / presence : part de la presence passee sur des OR. */
  presenceRatioPct: number | null;
};

/** Semaine ISO « AAAA-Snn » d'un jour « AAAA-MM-JJ ». */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // jeudi de la semaine
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-S${String(week).padStart(2, '0')}`;
}

export function periodKey(day: string, g: Granularity): string | null {
  if (g === 'day' || g === 'mechanic_day') return day;
  if (g === 'week') return isoWeek(day);
  if (g === 'month') return day.slice(0, 7);
  return null;
}

const pct = (a: number, b: number) => (b > 0 ? r2((a / b) * 100) : null);

/** Libelle « Non pointe » (lignes MO sans mecanicien) fourni par l'appelant (i18n). */
export function summarizeProductivity(
  rows: ProductivityRow[],
  opts: { by: Granularity; includeToBill: boolean; unassignedLabel: string },
): ProductivitySummary[] {
  // 1. Cumul par (groupe, mecanicien) : le temps passe d'un mecanicien = son pointage ; s'il ne
  //    pointe jamais sur la periode du groupe, ses heures passees saisies sur les lignes MO.
  type Acc = { presence: number; pointed: number; lineWorked: number; improd: number; billed: number; toBill: number; internal: number; warranty: number };
  const zero = (): Acc => ({ presence: 0, pointed: 0, lineWorked: 0, improd: 0, billed: 0, toBill: 0, internal: 0, warranty: 0 });
  const groups = new Map<string, { label: string; mechanicKey: string | null; period: string | null; byMech: Map<string, Acc> }>();
  for (const r of rows) {
    const period = periodKey(r.day, opts.by);
    const withMechanic = opts.by === 'mechanic' || opts.by === 'mechanic_day';
    const mLabel = r.mechanic_key ? (r.mechanic_name || r.mechanic_key) : opts.unassignedLabel;
    const key = withMechanic ? `${r.mechanic_key}|${period ?? ''}` : (period ?? '');
    const label = withMechanic ? (period ? `${mLabel} · ${period}` : mLabel) : (period ?? '');
    let g = groups.get(key);
    if (!g) { g = { label, mechanicKey: withMechanic ? r.mechanic_key : null, period, byMech: new Map() }; groups.set(key, g); }
    let a = g.byMech.get(r.mechanic_key);
    if (!a) { a = zero(); g.byMech.set(r.mechanic_key, a); }
    a.presence += h0(r.presence_h); a.pointed += h0(r.pointed_h); a.lineWorked += h0(r.line_worked_h);
    a.improd += h0(r.improductive_h); a.billed += h0(r.billed_h); a.toBill += h0(r.to_bill_h);
    a.internal += h0(r.internal_h); a.warranty += h0(r.warranty_h);
  }
  // 2. Totaux et ratios.
  const out: ProductivitySummary[] = [];
  for (const [key, g] of groups) {
    let presence = 0, worked = 0, billed = 0, toBill = 0, internal = 0, warranty = 0, improd = 0;
    for (const a of g.byMech.values()) {
      presence += a.presence; worked += a.pointed > 0 ? a.pointed : a.lineWorked;
      billed += a.billed; toBill += a.toBill; internal += a.internal; warranty += a.warranty; improd += a.improd;
    }
    const counted = billed + (opts.includeToBill ? toBill : 0);
    out.push({
      key, label: g.label, mechanicKey: g.mechanicKey, period: g.period,
      presence: r2(presence), worked: r2(worked), billed: r2(billed), toBill: r2(toBill),
      notBilled: r2(Math.max(0, worked - billed - toBill - internal - warranty)),
      internal: r2(internal), warranty: r2(warranty), improductive: r2(improd),
      billedPct: pct(counted, worked),
      productionPct: pct(counted + internal + warranty, worked),
      efficiencyPct: pct(worked, worked + improd),
      improductivePct: pct(improd, presence),
      presenceRatioPct: pct(worked, presence),
    });
  }
  return out.sort((a, b) => (a.period ?? '').localeCompare(b.period ?? '') || a.label.localeCompare(b.label));
}

/**
 * Ligne « Total » : somme des mecaniciens (le temps passe de chacun suit la regle du point 1 sur
 * toute la periode), ratios recalcules sur les sommes.
 */
export function productivityTotal(rows: ProductivityRow[], includeToBill: boolean, label: string): ProductivitySummary {
  const per = summarizeProductivity(rows, { by: 'mechanic', includeToBill, unassignedLabel: label });
  const sum = (k: 'presence' | 'worked' | 'billed' | 'toBill' | 'notBilled' | 'internal' | 'warranty' | 'improductive') =>
    r2(per.reduce((s, m) => s + m[k], 0));
  const presence = sum('presence'), worked = sum('worked'), billed = sum('billed'), toBill = sum('toBill');
  const internal = sum('internal'), warranty = sum('warranty'), improductive = sum('improductive');
  const counted = billed + (includeToBill ? toBill : 0);
  return {
    key: 'total', label, mechanicKey: null, period: null,
    presence, worked, billed, toBill, notBilled: sum('notBilled'), internal, warranty, improductive,
    billedPct: pct(counted, worked), productionPct: pct(counted + internal + warranty, worked),
    efficiencyPct: pct(worked, worked + improductive), improductivePct: pct(improductive, presence),
    presenceRatioPct: pct(worked, presence),
  };
}

/** Colonnes du tableau / de l'export Excel, dans l'ordre (cles i18n `labourTime.col_*`). */
export const PRODUCTIVITY_COLUMNS = [
  'presence', 'worked', 'billed', 'toBill', 'notBilled', 'internal', 'warranty', 'improductive',
  'billedPct', 'productionPct', 'efficiencyPct', 'improductivePct',
] as const;
export type ProductivityColumn = (typeof PRODUCTIVITY_COLUMNS)[number];

/** Grille Excel : en-tete + une ligne par groupe + total (nombres bruts, pourcentages en nombre). */
export function productivitySheet(
  summaries: ProductivitySummary[], total: ProductivitySummary,
  headers: { label: string; columns: Record<ProductivityColumn, string> },
): (string | number | null)[][] {
  const head = [headers.label, ...PRODUCTIVITY_COLUMNS.map((c) => headers.columns[c])];
  const row = (s: ProductivitySummary) => [s.label, ...PRODUCTIVITY_COLUMNS.map((c) => s[c])];
  return [head, ...summaries.map(row), row(total)];
}

// ---------------------------------------------------------------------------------------------
// Pointeuse : tableau « atelier maintenant »
// ---------------------------------------------------------------------------------------------

export type EntryLike = {
  id: string; kind: string; mechanic_code?: string | null; mechanic_name?: string | null; mechanic_id?: string | null;
  or_id?: string | null; task_code?: string | null; started_at: string; ended_at?: string | null;
};
export type MechanicState = {
  key: string; code: string | null; name: string;
  presentSince: string | null;
  current: { kind: 'travail' | 'improductif'; orId: string | null; taskCode: string | null; since: string } | null;
};

/** Cle d'un pointage : code mecano, sinon nom, sinon compte. */
export const entryMechanicKey = (e: Pick<EntryLike, 'mechanic_code' | 'mechanic_name' | 'mechanic_id'>): string =>
  (e.mechanic_code || '').trim() || (e.mechanic_name || '').trim() || e.mechanic_id || '';

/** Etat de chaque mecanicien (presence ouverte, travail en cours) a partir des pointages du jour. */
export function mechanicBoard(entries: EntryLike[], mechanics: { code: string; name: string }[]): MechanicState[] {
  const states = new Map<string, MechanicState>();
  for (const m of mechanics) states.set(m.code, { key: m.code, code: m.code, name: m.name, presentSince: null, current: null });
  const sorted = [...entries].sort((a, b) => a.started_at.localeCompare(b.started_at));
  for (const e of sorted) {
    const key = entryMechanicKey(e);
    if (!key) continue;
    let s = states.get(key);
    if (!s) { s = { key, code: e.mechanic_code || null, name: e.mechanic_name || key, presentSince: null, current: null }; states.set(key, s); }
    if (e.ended_at) continue;
    if (e.kind === 'presence') s.presentSince = e.started_at;
    else if (e.kind === 'travail' || e.kind === 'improductif') {
      s.current = { kind: e.kind, orId: e.or_id ?? null, taskCode: e.task_code ?? null, since: e.started_at };
    }
  }
  return [...states.values()];
}

/** Code mecano scanne / tape : retrouve le mecanicien (code exact, sans tenir compte des espaces ni de la casse). */
export function findMechanicByCode<T extends { code: string }>(mechanics: T[], scanned: string): T | null {
  const s = scanned.trim().toUpperCase();
  if (!s) return null;
  return mechanics.find((m) => m.code.trim().toUpperCase() === s) ?? null;
}

/** N° d'OR scanne (« OR-2026-00012 », « 00012 », « 12 ») : retrouve l'OR ouvert correspondant. */
export function findOrByScan<T extends { number: string | null }>(ors: T[], scanned: string): T | null {
  const s = scanned.trim().toUpperCase();
  if (!s) return null;
  const exact = ors.find((o) => (o.number ?? '').toUpperCase() === s);
  if (exact) return exact;
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  // Meme suite de chiffres, ou meme compteur (dernier groupe de chiffres : « 12 » = « OR-2026-00012 »).
  const sameDigits = ors.filter((o) => (o.number ?? '').replace(/\D/g, '') === digits);
  if (sameDigits.length === 1) return sameDigits[0];
  const lastGroup = (v: string) => { const m = v.match(/(\d+)\D*$/); return m ? Number(m[1]) : null; };
  const n = lastGroup(s);
  const byCounter = ors.filter((o) => n !== null && lastGroup(o.number ?? '') === n);
  return byCounter.length === 1 ? byCounter[0] : null;
}
