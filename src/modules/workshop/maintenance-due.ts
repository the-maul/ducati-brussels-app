/**
 * M8 / M3 — Prochain entretien de chaque moto (mission 07, cartes 4 et 5, ATE014) : règles pures,
 * testées dans tests/maintenance-due.test.ts. Miroir TypeScript des fonctions SQL de la migration
 * 20261031100000_m8_prochain_entretien.sql (maintenance_label_is_service, vehicle_maintenance_recompute).
 *
 * Décisions (Simon, 30/10, mission 07) :
 *  - chaque moto a UNE date de prochain entretien, avec sa source ;
 *  - regle Ducati lue dans l'extract DCS : prochain = dernier entretien + 12 mois ;
 *    premier entretien = 6 mois apres le debut de garantie (ou 1 000 km, le premier atteint) ;
 *  - echeance au premier atteint entre la date et le km (M-16) ;
 *  - sources par ordre de confiance : OR facture du DMS, facture G8 relue, declaration du client,
 *    extract DCS, puis le plan seul (date de depart sans aucun entretien connu).
 */

export type DueKind = 'first_1000' | 'oil' | 'annual' | 'km';
export type DueSource = 'or_dms' | 'invoice_g8' | 'client' | 'dcs_extract' | 'plan';
export const DUE_KINDS: DueKind[] = ['first_1000', 'oil', 'annual', 'km'];
export const DUE_SOURCES: DueSource[] = ['or_dms', 'invoice_g8', 'client', 'dcs_extract', 'plan'];

/** Prochain entretien = dernier + 12 mois (Ducati, extract DCS « Annual Service » / « Oil Service »). */
export const SERVICE_INTERVAL_MONTHS = 12;
/** Premier entretien = 6 mois apres le debut de garantie (« Oil Service 1000km/600mi »). */
export const FIRST_SERVICE_MONTHS = 6;
export const FIRST_SERVICE_KM = 1000;
/** Fenetre de retard encore proposee quand on ne connait que le plan (180 jours, comme l'extract DCS). */
export const PLAN_GRACE_DAYS = 180;

const DAY = 86_400_000;
const toDate = (s: string | Date) => (s instanceof Date ? new Date(s.getTime()) : new Date(`${String(s).slice(0, 10)}T00:00:00Z`));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** AAAA-MM-JJ + n mois (fin de mois bornee : 31/01 + 1 mois = 28/02). */
export function addMonthsIso(date: string, months: number): string {
  const d = toDate(date);
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), last));
  return iso(r);
}

/** Jours entiers entre deux dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
}

// ---------------------------------------------------------------- 1. un entretien dans un libelle
/**
 * Mots qui annoncent un entretien sur une ligne de facture (G8 relue ou OR du DMS).
 * Verifie sur les libelles reels des 89 853 lignes G8 : « VIDANGE », « ENTRETIEN SF V2 »,
 * « RODAGE 1000 KM » sont des entretiens ; « BOUCHON VIDANGE HUILE », « KIT DE REVISION DE PIVOTS »,
 * « SERVICE BOOKLET », « T-SHIRT DESMO » n'en sont pas : ce sont des pieces et du merchandising.
 */
const SERVICE_POSITIVE = /\b(entretien|vidange|r[eéÉ]vision|service|rodage|annual|annuel|desmo)\b|\b1[ .]?000 ?km|\b(7|12|15|24|30|36)[ .]?000\b/i;
const SERVICE_NEGATIVE = /\b(bouchon|vis|kit|jeu|groupe|soupape|booklet|tasses?|t-?shirt|veste|manuel|embl[eè]me|d[eé]calcomanie|pantalon|polo|sweat|boots?|collection|pivots?|silenc\w*|meccano|casque|gants?|autocollant|joint|filtre|durite|[eé]trier)\b|\bbot\./i;

export function isServiceLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  const s = String(label);
  return SERVICE_POSITIVE.test(s) && !SERVICE_NEGATIVE.test(s);
}

// ---------------------------------------------------------------- 2. l'extract DCS
/** « Oil Service 1000km/600mi » → premier entretien ; « Oil Service » → vidange ; « Annual Service » → annuel. */
export function dcsKind(maintenanceType: string | null | undefined): DueKind {
  const s = String(maintenanceType ?? '').toLowerCase();
  if (/1[ .]?000|600 ?mi|first/.test(s)) return 'first_1000';
  if (/annual|annuel|temporel/.test(s)) return 'annual';
  if (/oil|vidange/.test(s)) return 'oil';
  return 'annual';
}

export type DcsRow = {
  /** Numero de ligne dans la feuille (1 = premiere ligne, en-tete comprise). */
  row: number;
  vin: string;
  warrantyStart: string | null;
  plannedDate: string;
  maintenanceType: string;
  daysBefore: number | null;
  dealer: string | null;
};

/** Serie Excel (45659 = 12/01/2025) → AAAA-MM-JJ ; null si ce n'est pas une date. */
export function excelSerialToIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (/^\d+(\.\d+)?$/.test(s)) v = Number(s); else return null;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1000) return null;
  // Excel compte depuis le 30/12/1899 (bug 1900 inclus).
  return iso(new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * DAY));
}

export function normalizeVin(v: unknown): string {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const cellText = (v: unknown) => (v == null ? '' : String(v).trim());
const findCol = (headers: string[], ...needles: string[]) =>
  headers.findIndex((h) => needles.some((n) => h.toLowerCase().includes(n)));

export type DcsParse = { rows: DcsRow[]; ignored: { row: number; reason: string }[]; header: number };

/**
 * Lit la feuille « Export » de l'extract DCS (tableau de cellules brutes, dates en serie Excel) :
 * en-tete reconnu par ses libelles (« VIN », « Maintenance Planned Date », « Maintenance Type »…),
 * derniere ligne « Applied filters: … » ignoree, VIN normalise (17 caracteres).
 */
export function parseDcsRows(aoa: unknown[][]): DcsParse {
  const headerIdx = aoa.findIndex((r) => (r ?? []).some((c) => cellText(c).toUpperCase() === 'VIN'));
  if (headerIdx < 0) return { rows: [], ignored: [{ row: 0, reason: 'no_header' }], header: -1 };
  const headers = (aoa[headerIdx] ?? []).map(cellText);
  const cVin = findCol(headers, 'vin');
  const cWarranty = findCol(headers, 'warranty start');
  const cPlanned = findCol(headers, 'planned date', 'maintenance planned');
  const cType = findCol(headers, 'maintenance type', 'type');
  const cDays = findCol(headers, 'day');
  const cDealer = findCol(headers, 'wa dealer');
  const rows: DcsRow[] = [];
  const ignored: DcsParse['ignored'] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const raw = cellText(r[cVin]);
    const rowNo = i + 1;
    if (!raw && r.every((c) => cellText(c) === '')) continue; // ligne vide
    if (/^applied filters/i.test(raw) || (!raw && /^applied filters/i.test(cellText(r[0])))) { ignored.push({ row: rowNo, reason: 'filters' }); continue; }
    const vin = normalizeVin(raw);
    if (vin.length !== 17) { ignored.push({ row: rowNo, reason: vin ? 'vin_length' : 'vin_missing' }); continue; }
    const planned = cPlanned >= 0 ? excelSerialToIso(r[cPlanned]) : null;
    if (!planned) { ignored.push({ row: rowNo, reason: 'planned_date' }); continue; }
    const days = cDays >= 0 ? Number(String(r[cDays] ?? '').replace(',', '.')) : NaN;
    rows.push({
      row: rowNo,
      vin,
      warrantyStart: cWarranty >= 0 ? excelSerialToIso(r[cWarranty]) : null,
      plannedDate: planned,
      maintenanceType: cType >= 0 ? cellText(r[cType]) || 'Annual Service' : 'Annual Service',
      daysBefore: Number.isFinite(days) ? Math.trunc(days) : null,
      dealer: cDealer >= 0 ? cellText(r[cDealer]) || null : null,
    });
  }
  return { rows, ignored, header: headerIdx };
}

/** Un VIN deja present pour la meme date et le meme type n'entre qu'une fois (premiere ligne gardee). */
export function dedupeDcsRows<T extends { vin: string; plannedDate: string; maintenanceType: string }>(rows: T[]): { kept: T[]; duplicates: T[] } {
  const seen = new Set<string>();
  const kept: T[] = []; const duplicates: T[] = [];
  for (const r of rows) {
    const k = `${r.vin}|${r.plannedDate}|${r.maintenanceType.trim().toLowerCase()}`;
    if (seen.has(k)) duplicates.push(r); else { seen.add(k); kept.push(r); }
  }
  return { kept, duplicates };
}

// ---------------------------------------------------------------- 3. le calcul de l'echeance
export type DueLine = { kind: DueKind; dueDate: string | null; dueKm: number | null };

/** Prochain entretien apres un entretien connu : + 12 mois ; + intervalle km du plan si on connait le km. */
export function nextFromLastService(last: { date: string; km?: number | null }, kmInterval?: number | null): DueLine {
  const dueKm = last.km != null && kmInterval != null && kmInterval > 0 ? last.km + kmInterval : null;
  return { kind: 'annual', dueDate: addMonthsIso(last.date, SERVICE_INTERVAL_MONTHS), dueKm };
}

/** Premier entretien : 6 mois apres le debut de garantie ou 1 000 km, le premier atteint. */
export function firstServiceDue(start: string, kmFirst: number = FIRST_SERVICE_KM): DueLine {
  return { kind: 'first_1000', dueDate: addMonthsIso(start, FIRST_SERVICE_MONTHS), dueKm: kmFirst };
}

/**
 * Aucun entretien connu, seulement une date de depart (garantie, mise en circulation) : on suit
 * le calendrier Ducati — 6 mois, puis tous les 12 mois — et on retient la premiere echeance qui
 * n'est pas plus vieille que `graceDays` (180 j : la fenetre de l'extract DCS). Source « plan ».
 */
export function plannedDue(start: string, today: string, graceDays: number = PLAN_GRACE_DAYS): DueLine {
  const first = firstServiceDue(start);
  if (daysBetween(first.dueDate!, today) <= graceDays) return first;
  for (let n = 1; n < 80; n++) {
    const due = addMonthsIso(first.dueDate!, SERVICE_INTERVAL_MONTHS * n);
    if (daysBetween(due, today) <= graceDays) return { kind: 'annual', dueDate: due, dueKm: null };
  }
  return { kind: 'annual', dueDate: addMonthsIso(today, SERVICE_INTERVAL_MONTHS), dueKm: null };
}

/** Ligne de l'extract DCS → echeance (la date planifiee est la verite) et dernier entretien implicite. */
export function dueFromDcs(row: { plannedDate: string; maintenanceType: string | null }): DueLine & { lastServiceAt: string } {
  const kind = dcsKind(row.maintenanceType);
  const months = kind === 'first_1000' ? FIRST_SERVICE_MONTHS : SERVICE_INTERVAL_MONTHS;
  return { kind, dueDate: row.plannedDate, dueKm: kind === 'first_1000' ? FIRST_SERVICE_KM : null, lastServiceAt: addMonthsIso(row.plannedDate, -months) };
}

export type DueStatus = {
  daysLeft: number | null;   // negatif = depasse
  kmLeft: number | null;
  reached: boolean;
  reachedBy: 'km' | 'mois' | null;
};

/** Etat de l'echeance au premier atteint (M-16) : jours restants, km restants, atteinte par quoi. */
export function dueStatus(due: { dueDate: string | null; dueKm: number | null }, now: { date: string; km: number | null }): DueStatus {
  const daysLeft = due.dueDate ? daysBetween(now.date, due.dueDate) : null;
  const kmLeft = due.dueKm != null && now.km != null ? due.dueKm - now.km : null;
  const byDate = daysLeft != null && daysLeft <= 0;
  const byKm = kmLeft != null && kmLeft <= 0;
  return { daysLeft, kmLeft, reached: byDate || byKm, reachedBy: byKm ? 'km' : byDate ? 'mois' : null };
}

/** Candidats « dernier entretien » : le plus recent gagne ; a date egale, l'ordre de confiance. */
export type LastServiceCandidate = { source: DueSource; date: string; km?: number | null; ref?: string | null };
const CONFIDENCE: Record<DueSource, number> = { or_dms: 1, invoice_g8: 2, client: 3, dcs_extract: 4, plan: 5 };

export function pickLastService(candidates: LastServiceCandidate[]): LastServiceCandidate | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => b.date.localeCompare(a.date) || CONFIDENCE[a.source] - CONFIDENCE[b.source])[0];
}
