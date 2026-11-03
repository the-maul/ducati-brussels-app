/**
 * M3 — Registre des vehicules a moteur (AR n° 1 art. 28, circulaire 2018/C/47), VEH010.
 *
 * Regles PURES, miroir des fonctions SQL de la migration 20261103190000 :
 *   - numero d'ordre continu par societe et par annee, affiche AAAA-0001 (au moins 4 positions) ;
 *   - entree a l'ouverture d'un OR (code 1, ou 2 si la garantie est acceptee), a la validation d'une
 *     reprise (code 4), a la reception d'une moto neuve (VN), au depot-vente (code 4) ;
 *   - sortie : date + reference de la facture (ou motif de l'absence de document), a inscrire au plus
 *     tard le DERNIER JOUR DU MOIS QUI SUIT la sortie (`invoice_due_by`) ;
 *   - append-only (B7) : une ligne inscrite ne se modifie pas ; la sortie COMPLETE les champs vides ;
 *     toute correction = ligne de RECTIFICATION (nouveau numero) qui pointe l'ancienne, laquelle reste
 *     lisible et marquee ; une annulation est une rectification `is_void`.
 *   - reprise d'historique idempotente : ce qui est deja inscrit (source + source_id) n'est pas repris.
 * Les tests (tests/vehicle-register.test.ts) fixent le contrat des deux cotes.
 */

export type RegisterSource = 'or' | 'reprise' | 'reception' | 'depot' | 'manuel';
export type RegisterState = 'en_cours' | 'a_facturer' | 'en_retard' | 'close' | 'rectifiee' | 'annulee';

/** Codes de nature de l'operation de la circulaire 2018/C/47 (p. 12-14) + VN interne au DMS. */
export const OFFICIAL_NATURE_CODES = ['1', '2', '3', '4'] as const;
export const NATURE_CODES = ['1', '2', '3', '4', 'VN'] as const;
export type NatureCode = (typeof NATURE_CODES)[number];

export type RegisterLine = {
  id: string;
  year: number;
  seq: number;
  entered_at: string;            // AAAA-MM-JJ
  vehicle_id: string | null;
  vin: string | null;
  plate: string | null;
  contact_id: string | null;
  principal_vat: string | null;
  nature_code: string;
  source: RegisterSource;
  source_id: string | null;
  left_at: string | null;
  invoice_document_id: string | null;
  invoice_ref: string | null;
  no_document_reason: string | null;
  invoice_due_by: string | null;
  is_backfill: boolean;
  is_void: boolean;
  rectifies_id: string | null;
  rectified_by_id: string | null;
  note: string | null;
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(d: string): { y: number; m: number; d: number } {
  const m = ISO.exec(d);
  if (!m) throw new Error(`Date invalide : ${d}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Dernier jour du mois qui suit la sortie (fin du mois suivant). null si pas de sortie. */
export function registerDueBy(leftAt: string | null | undefined): string | null {
  if (!leftAt) return null;
  const { y, m } = parseIso(leftAt);
  // Jour 0 du mois m+2 = dernier jour du mois m+1 (Date.UTC gere le passage d'annee).
  return toIso(new Date(Date.UTC(y, m + 1, 0)));
}

/** Numero d'ordre affiche : AAAA-0001 (au moins 4 positions, circulaire 2018/C/47). */
export function registerNumber(year: number, seq: number): string {
  return `${year}-${String(seq).padStart(4, '0')}`;
}

/** Prochain numero d'ordre de l'annee : continu, repart a 1 chaque annee. */
export function nextSeq(lines: ReadonlyArray<Pick<RegisterLine, 'year' | 'seq'>>, year: number): number {
  let max = 0;
  for (const l of lines) if (l.year === year && l.seq > max) max = l.seq;
  return max + 1;
}

export function yearOf(isoDate: string): number {
  return parseIso(isoDate).y;
}

/** Etat d'une ligne : en cours (pas de sortie), a facturer, en retard, close, rectifiee, annulee. */
export function registerState(line: RegisterLine, today: string): RegisterState {
  if (line.rectified_by_id) return 'rectifiee';
  if (line.is_void) return 'annulee';
  if (!line.left_at) return 'en_cours';
  if (line.invoice_document_id || line.invoice_ref || line.no_document_reason) return 'close';
  const due = line.invoice_due_by ?? registerDueBy(line.left_at);
  return due && due < today ? 'en_retard' : 'a_facturer';
}

/**
 * La moto est-elle deja dans nos murs AU TITRE DU STOCK (reception, reprise, depot-vente, ligne manuelle)
 * a cette date ? Un OR interne sur une moto du stock (preparation, PDI) ne fait alors pas de seconde
 * entree (miroir de `_vehicle_register_in_stock`).
 */
export function isInStock(lines: ReadonlyArray<RegisterLine>, vehicleId: string, at: string): boolean {
  return lines.some((l) => l.vehicle_id === vehicleId && l.source !== 'or' && !l.rectified_by_id && !l.is_void
    && l.entered_at <= at && (!l.left_at || l.left_at >= at));
}

/** Nature a l'ouverture d'un OR : 2 si entierement sous garantie acceptee, sinon 1. */
export function orEntryNature(warrantyStatus: string | null | undefined): '1' | '2' {
  return warrantyStatus === 'accepte' ? '2' : '1';
}

export type EntryInput = {
  id: string;
  entered_at: string;
  vehicle_id?: string | null;
  vin?: string | null;
  plate?: string | null;
  contact_id?: string | null;
  principal_vat?: string | null;
  nature_code: string;
  source: RegisterSource;
  source_id?: string | null;
  note?: string | null;
  is_backfill?: boolean;
};

export function normalizeVin(vin: string | null | undefined): string | null {
  const v = (vin ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return v === '' ? null : v;
}

export function normalizePlate(plate: string | null | undefined): string | null {
  const p = (plate ?? '').trim().toUpperCase();
  return p === '' ? null : p;
}

/** Ligne ouverte (ni rectifiee ni annulee) d'une source donnee. */
export function openLineOf(lines: ReadonlyArray<RegisterLine>, source: RegisterSource, sourceId: string): RegisterLine | undefined {
  return lines.find((l) => l.source === source && l.source_id === sourceId && !l.rectified_by_id && !l.is_void);
}

/**
 * Inscrit une ENTREE : numero suivant de l'annee de la date d'entree. Idempotent par (source, source_id) :
 * si une ligne ouverte existe deja, elle est renvoyee sans doublon. Plaque ou VIN obligatoire.
 */
export function registerEntry(input: EntryInput, lines: ReadonlyArray<RegisterLine>): { line: RegisterLine; created: boolean } {
  if (input.source_id) {
    const existing = openLineOf(lines, input.source, input.source_id);
    if (existing) return { line: existing, created: false };
  }
  const vin = normalizeVin(input.vin);
  const plate = normalizePlate(input.plate);
  if (!vin && !plate) throw new Error('Plaque ou numero de chassis obligatoire');
  const year = yearOf(input.entered_at);
  const line: RegisterLine = {
    id: input.id,
    year,
    seq: nextSeq(lines, year),
    entered_at: input.entered_at,
    vehicle_id: input.vehicle_id ?? null,
    vin,
    plate,
    contact_id: input.contact_id ?? null,
    principal_vat: input.principal_vat ?? null,
    nature_code: input.nature_code,
    source: input.source,
    source_id: input.source_id ?? null,
    left_at: null,
    invoice_document_id: null,
    invoice_ref: null,
    no_document_reason: null,
    invoice_due_by: null,
    is_backfill: !!input.is_backfill,
    is_void: false,
    rectifies_id: null,
    rectified_by_id: null,
    note: input.note ?? null,
  };
  return { line, created: true };
}

export type ExitInput = { left_at: string; invoice_document_id?: string | null; invoice_ref?: string | null; reason?: string | null };

/**
 * Inscrit une SORTIE : complete les champs vides seulement (date, facture ou motif), jamais d'ecrasement.
 * Une sortie deja inscrite a une autre date est conservee (il faut rectifier). La date de sortie ne
 * precede jamais l'entree. `invoice_due_by` = fin du mois suivant.
 */
export function applyExit(line: RegisterLine, exit: ExitInput): RegisterLine {
  if (line.rectified_by_id || line.is_void) throw new Error('Ligne rectifiee ou annulee : inscrivez la sortie sur la ligne en vigueur');
  const leftAt = line.left_at ?? (exit.left_at < line.entered_at ? line.entered_at : exit.left_at);
  const ref = line.invoice_ref ?? (exit.invoice_ref?.trim() || null);
  const docId = line.invoice_document_id ?? (exit.invoice_document_id ?? null);
  const reason = line.no_document_reason ?? (!ref && !docId ? exit.reason?.trim() || null : null);
  return { ...line, left_at: leftAt, invoice_document_id: docId, invoice_ref: ref, no_document_reason: reason, invoice_due_by: registerDueBy(leftAt) };
}

export type RectifyPatch = {
  entered_at?: string;
  vin?: string | null;
  plate?: string | null;
  nature_code?: string;
  left_at?: string | null;
  invoice_ref?: string | null;
  no_document_reason?: string | null;
  note?: string | null;
  void?: boolean;
};

/**
 * RECTIFICATION (B7) : nouvelle ligne avec un nouveau numero qui reprend l'ancienne et les corrections,
 * l'ancienne est marquee `rectified_by_id` et reste dans le registre. Une ligne ne se rectifie qu'une fois.
 */
export function rectifyLine(lines: ReadonlyArray<RegisterLine>, lineId: string, newId: string, patch: RectifyPatch): { lines: RegisterLine[]; line: RegisterLine } {
  const old = lines.find((l) => l.id === lineId);
  if (!old) throw new Error('Ligne introuvable');
  if (old.rectified_by_id) throw new Error('Cette ligne est deja rectifiee');
  const enteredAt = patch.entered_at ?? old.entered_at;
  const year = yearOf(enteredAt);
  const leftAt = patch.left_at === undefined ? old.left_at : patch.left_at;
  const invoiceRef = patch.invoice_ref === undefined ? old.invoice_ref : (patch.invoice_ref?.trim() || null);
  const line: RegisterLine = {
    ...old,
    id: newId,
    year,
    seq: nextSeq(lines, year),
    entered_at: enteredAt,
    vin: patch.vin === undefined ? old.vin : normalizeVin(patch.vin),
    plate: patch.plate === undefined ? old.plate : normalizePlate(patch.plate),
    nature_code: patch.nature_code ?? old.nature_code,
    left_at: leftAt,
    invoice_document_id: patch.invoice_ref === undefined ? old.invoice_document_id : null,
    invoice_ref: invoiceRef,
    no_document_reason: patch.no_document_reason === undefined ? old.no_document_reason : (patch.no_document_reason?.trim() || null),
    invoice_due_by: registerDueBy(leftAt),
    is_void: !!patch.void,
    rectifies_id: old.id,
    rectified_by_id: null,
    note: patch.note ?? `Rectification de ${registerNumber(old.year, old.seq)}`,
  };
  if (!line.vin && !line.plate) throw new Error('Plaque ou numero de chassis obligatoire');
  const next = lines.map((l) => (l.id === old.id ? { ...l, rectified_by_id: newId } : l));
  next.push(line);
  return { lines: next, line };
}

export type BackfillEvent = {
  source: RegisterSource;
  source_id: string;
  entered_at: string;
  sort_at: string;              // horodatage ISO complet pour l'ordre chronologique
  vehicle_id: string | null;
  vin?: string | null;
  plate?: string | null;
  contact_id?: string | null;
  nature_code: string;
  note?: string | null;
  left_at?: string | null;
  invoice_ref?: string | null;
  reason?: string | null;
};

/**
 * Plan de reprise d'historique : evenements a partir de `from`, dans l'ordre chronologique, sans ceux
 * deja inscrits (source + source_id). Rejouer le plan sur un registre deja repris ne rend rien.
 */
export function backfillPlan(events: ReadonlyArray<BackfillEvent>, existing: ReadonlyArray<RegisterLine>, from: string): BackfillEvent[] {
  const done = new Set(existing.map((l) => `${l.source}:${l.source_id ?? ''}`));
  return events
    .filter((e) => e.entered_at >= from && !done.has(`${e.source}:${e.source_id}`))
    .sort((a, b) => (a.sort_at < b.sort_at ? -1 : a.sort_at > b.sort_at ? 1 : a.source_id < b.source_id ? -1 : 1));
}

/** Applique un plan de reprise : lignes numerotees dans l'ordre, marquees reprise d'historique, sorties completees. */
export function applyBackfill(events: ReadonlyArray<BackfillEvent>, existing: ReadonlyArray<RegisterLine>, from: string, idOf: (e: BackfillEvent) => string): RegisterLine[] {
  const lines = [...existing];
  for (const e of backfillPlan(events, existing, from)) {
    let line: RegisterLine;
    try {
      ({ line } = registerEntry({
        id: idOf(e), entered_at: e.entered_at, vehicle_id: e.vehicle_id, vin: e.vin, plate: e.plate, contact_id: e.contact_id,
        nature_code: e.nature_code, source: e.source, source_id: e.source_id,
        note: `${e.note ?? ''} (reprise d'historique)`.trim(), is_backfill: true,
      }, lines));
    } catch {
      continue; // rien pour identifier la moto : pas d'inscription
    }
    if (e.left_at) line = applyExit(line, { left_at: e.left_at, invoice_ref: e.invoice_ref, reason: e.reason });
    lines.push(line);
  }
  return lines;
}

// ---------------------------------------------------------------------
// Export CSV conforme (colonnes de l'art. 28 §2) — separateur « ; », BOM pour Excel
// ---------------------------------------------------------------------
export type RegisterExportRow = RegisterLine & { vehicle_label?: string | null; contact_name?: string | null; nature_label?: string | null; establishment?: string | null };

export const REGISTER_CSV_HEADER = [
  'NumeroOrdre', 'DateEntree', 'Plaque', 'Chassis', 'DonneurOrdre', 'TVA_UE_DonneurOrdre', 'CodeNature', 'NatureOperation',
  'DateSortie', 'ReferenceFacture', 'MotifAbsenceDocument', 'DateLimiteFacture', 'Source', 'Vehicule', 'Rectifie', 'RectifieePar', 'Annulee', 'Note',
] as const;

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildRegisterCsv(rows: ReadonlyArray<RegisterExportRow>, numberOf: (l: RegisterLine) => string = (l) => registerNumber(l.year, l.seq), byId?: Map<string, RegisterLine>): string {
  const ref = (id: string | null) => {
    if (!id) return '';
    const l = byId?.get(id) ?? rows.find((r) => r.id === id);
    return l ? registerNumber(l.year, l.seq) : id;
  };
  const lines = rows.map((r) => [
    numberOf(r), r.entered_at, r.plate ?? '', r.vin ?? '', r.contact_name ?? '', r.principal_vat ?? '', r.nature_code, r.nature_label ?? '',
    r.left_at ?? '', r.invoice_ref ?? '', r.no_document_reason ?? '', r.invoice_due_by ?? '', r.source, r.vehicle_label ?? '',
    ref(r.rectifies_id), ref(r.rectified_by_id), r.is_void ? 'oui' : '', r.note ?? '',
  ].map(csvCell).join(';'));
  return '﻿' + [REGISTER_CSV_HEADER.join(';'), ...lines].join('\r\n');
}
