/**
 * M8 — Parcours mecanicien (Simon, 26/11/2026, ATE014) : seulement les operations A ECHEANCE.
 * Regles PURES (tests/atelier-operations-dues.test.ts). Contexte lu par
 * `workshop_periodic_due_context` (migration 20261126270000).
 *
 * Le plan Ducati generique range dans l'entretien annuel des operations a periodicite plus longue
 * (courroies 60 mois, liquide de refroidissement 48, huile de fourche 36, liquide de frein 24). Une
 * telle operation n'est affichee que si elle est due pour CETTE moto, a la date et au km de l'OR :
 *  - derniere fois connue (operation cochee sur un autre OR, entretien qui la fait d'office — Desmo
 *    → courroies —, piece ou liquide sur une facture DMS / G8, entretien DCS, historique) :
 *    due si derniere fois + periodicite <= date de l'OR (+ DUE_TOLERANCE_DAYS) ;
 *  - jamais vue, depart connu (garantie, puis mise en circulation) : pas due tant que la premiere
 *    echeance n'est pas atteinte ; atteinte → affichee « a verifier » (on ne sait pas si elle a ete
 *    faite ailleurs) ;
 *  - rien de connu : affichee, « A verifier : derniere date inconnue » (jamais de masquage silencieux).
 * Toujours affichee : operation d'un service CHOISI qui la fait d'office (« forced »), « Faire quand
 * meme » (due_forced), operation deja faite, operation qui a des pieces sur l'OR (le kit les a mises).
 * Une operation pas due est reglee une fois « non faite », motif « pas necessaire », note
 * « Pas a echeance (derniere fois : ...) » (fonction tracee habituelle) : « Terminer » ne l'attend pas,
 * elle n'est ni sur la facture ni sur l'OR imprime ; « Faire quand meme » la remet « a faire ».
 * Les memes signatures servent au kit : une piece d'une operation pas due n'est pas chargee.
 */
import { normalizeText } from '../exploded/operation-components';
import { isAbsentOnBike } from '../exploded/operation-presence';
import { addMonthsIso, daysBetween } from '../maintenance-due';

/** Une operation faite un peu avant l'echeance (entretien avance de quelques semaines) compte. */
export const DUE_TOLERANCE_DAYS = 60;
/** Periodicite du service lui-meme : au-dela, l'operation n'est pas faite a chaque entretien annuel. */
export const SERVICE_BASE_MONTHS = 12;

export type DueEvidence = {
  source: 'or_op' | 'or_service' | 'invoice_line' | 'dcs' | 'history' | string;
  date: string;
  km?: number | null;
  ref?: string | null;
  text?: string | null;
  kinds?: string[] | null;
};
export type PeriodicOp = {
  text: string;
  periodicity_months: number | null;
  periodicity_km?: number | null;
  forced: boolean;
  covered_by: string[];
  families?: string[];
};
export type DueContext = {
  now_date: string;
  now_km: number | null;
  start_date: string | null;
  start_source: 'garantie' | 'mise_en_circulation' | string | null;
  periodic: PeriodicOp[];
  evidence: DueEvidence[];
};

export type DueState = 'due' | 'not_due' | 'unknown';
export type DueVerdict = {
  state: DueState;
  basis: 'last' | 'start' | 'none';
  last: DueEvidence | null;
  /** Prochaine echeance (derniere fois ou depart + periodicite). */
  nextDate: string | null;
};

type Signature = { id: string; op: RegExp; ev: RegExp; evNot?: RegExp };
/**
 * Ce qui dit qu'une operation periodique a ete faite, dans un libelle de piece / de ligne / d'entretien.
 * Verifie sur la facture G8 de la Monster 1100 S de l'OR-2026-00003 (« COURROIE DENTEE COMMANDE
 * DISTRIBUTION », « 5 HUILE DE FREIN DOT 5.1 », mais pas « RESERVOIR LIQUIDE FREINS »).
 */
export const DUE_SIGNATURES: Signature[] = [
  { id: 'courroie_pompe_eau', op: /COURROIE (DE LA )?POMPE A EAU/, ev: /COURROIE.*POMPE A EAU|POMPE A EAU.*COURROIE/ },
  { id: 'courroies_distribution', op: /COURROIES? (DE )?(LA )?DISTRIBUTION/, ev: /COURROIES?.*(DISTRIBUTION|DENTEE)|KIT COURROIES?|TIMING BELT|CINGHI/, evNot: /POMPE A EAU|TENDEUR|GALET|CARTER|COUVERCLE|PROTECTION/ },
  { id: 'liquide_frein', op: /(HUILE|LIQUIDE) (DE |DES |DU )?FREINS?/, ev: /(HUILE|LIQUIDE) (DE |DES |DU |POUR )?FREINS?|\bDOT ?[345]|BRAKE FLUID/, evNot: /RESERVOIR|BOUCHON|DURITE|TUYAU|CAPTEUR|CONTACTEUR|SUPPORT|COUVERCLE|MEMBRANE|JOINT|PLAQUETTE|DISQUE|ETRIER|LEVIER/ },
  { id: 'liquide_refroidissement', op: /LIQUIDE (DE |DU )?REFROIDISSEMENT/, ev: /LIQUIDE (DE |DU )?REFROIDISSEMENT|ANTI ?-?GEL|COOLANT/, evNot: /RESERVOIR|VASE|DURITE|TUYAU|BOUCHON|RADIATEUR|CAPTEUR|POMPE|SONDE|NIVEAU|THERMOSTAT/ },
  { id: 'huile_fourche', op: /HUILE (DE |DE LA )?FOURCHE/, ev: /HUILE (DE |POUR )?FOURCHE|FORK OIL|VIDANGE (DE LA )?FOURCHE|REVISION (DE LA )?FOURCHE/ },
  { id: 'filtre_air', op: /FILTRE A AIR/, ev: /FILTRE A AIR|AIR FILTER/, evNot: /BOITE|COUVERCLE|SUPPORT|DURITE|COLLIER/ },
  { id: 'huile_moteur', op: /HUILE MOTEUR/, ev: /FILTRE A HUILE|HUILE MOTEUR|\b\d{1,2}W ?-?\d{2}\b/ },
  { id: 'bougies', op: /BOUGIES?/, ev: /\bBOUGIES?\b/, evNot: /CAPUCHON|ANTIPARASITE|\bCLE\b|JOINT|PIPE|CABLE/ },
];

/** La signature d'une operation periodique (null : seule l'operation cochee ailleurs la prouve). */
export function signatureOf(opText: string): Signature | null {
  const s = normalizeText(opText);
  return DUE_SIGNATURES.find((g) => g.op.test(s)) ?? null;
}

/** Ce libelle (piece, ligne, entretien) dit-il que l'operation a ete faite ? */
export function evidenceMatches(sig: Signature, text: string | null | undefined): boolean {
  const s = normalizeText(text);
  return !!s && sig.ev.test(s) && !(sig.evNot?.test(s) ?? false);
}

/** La derniere fois que CETTE operation a ete faite sur la moto (null : inconnue). */
export function lastDoneFor(op: Pick<PeriodicOp, 'text' | 'covered_by'>, evidence: readonly DueEvidence[]): DueEvidence | null {
  const key = normalizeText(op.text);
  const sig = signatureOf(op.text);
  const covered = new Set(op.covered_by ?? []);
  let best: DueEvidence | null = null;
  for (const e of evidence) {
    if (!e.date) continue;
    let hit = false;
    if (e.source === 'or_op') hit = normalizeText(e.text) === key || (!!sig && sig.op.test(normalizeText(e.text)));
    else if ((e.kinds ?? []).some((k) => covered.has(k))) hit = true;
    else if (sig && e.source !== 'or_service') hit = evidenceMatches(sig, e.text);
    if (hit && (!best || e.date > best.date)) best = e;
  }
  return best;
}

/** Due / pas due / inconnue, a la date et au km de l'OR. */
export function periodicDue(
  p: { months: number | null; km?: number | null },
  now: { date: string; km: number | null },
  last: Pick<DueEvidence, 'date' | 'km'> | null,
  start: string | null,
  toleranceDays = DUE_TOLERANCE_DAYS,
): DueVerdict {
  const months = p.months && p.months > 0 ? p.months : null;
  const kmP = p.km && p.km > 0 ? p.km : null;
  if (!months && !kmP) return { state: 'due', basis: 'none', last: null, nextDate: null };
  const reachedByDate = (from: string) => {
    const next = months ? addMonthsIso(from, months) : null;
    return { next, reached: next != null && daysBetween(now.date, next) <= toleranceDays };
  };
  if (last) {
    const d = reachedByDate(last.date);
    const byKm = kmP != null && last.km != null && now.km != null && now.km >= last.km + kmP;
    return { state: d.reached || byKm ? 'due' : 'not_due', basis: 'last', last: last as DueEvidence, nextDate: d.next };
  }
  if (start) {
    const d = reachedByDate(start);
    const byKm = kmP != null && now.km != null && now.km >= kmP;
    // Premiere echeance pas atteinte : pas due ; atteinte sans trace : a verifier.
    return { state: d.reached || byKm ? 'unknown' : 'not_due', basis: 'start', last: null, nextDate: d.next };
  }
  return { state: 'unknown', basis: 'none', last: null, nextDate: null };
}

/** Le verdict d'une operation periodique du plan (null : pas une operation periodique, ou forcee). */
export function verdictFor(ctx: DueContext | null, label: string): DueVerdict | null {
  if (!ctx) return null;
  const key = normalizeText(label);
  const per = ctx.periodic.find((p) => normalizeText(p.text) === key);
  if (!per || per.forced || !per.periodicity_months || per.periodicity_months <= SERVICE_BASE_MONTHS) return null;
  const last = lastDoneFor(per, ctx.evidence);
  return periodicDue({ months: per.periodicity_months, km: per.periodicity_km ?? null }, { date: ctx.now_date, km: ctx.now_km }, last, ctx.start_date);
}

const frDate = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export const NOT_DUE_NOTE_PREFIX = 'Pas à échéance';

/** Note posee sur l'operation reglee « pas a echeance » (donnee FR, comme ABSENT_ON_BIKE_NOTE). */
export function notDueNote(v: DueVerdict, startSource?: string | null): string {
  if (v.basis === 'last' && v.last) {
    return `${NOT_DUE_NOTE_PREFIX} (dernière fois : ${frDate(v.last.date)}${v.last.ref ? `, ${v.last.ref}` : ''}${v.nextDate ? ` ; prochaine : ${frDate(v.nextDate)}` : ''})`;
  }
  const from = startSource === 'garantie' ? 'garantie' : 'mise en circulation';
  return `${NOT_DUE_NOTE_PREFIX} (première échéance : ${frDate(v.nextDate)}, depuis la ${from})`;
}

/** Reglee « pas a echeance » par la regle (pas par le mecanicien). */
export function isNotDueSettled(o: { status: string; not_done_note?: string | null }): boolean {
  return o.status === 'non_fait' && !!o.not_done_note && o.not_done_note.startsWith(NOT_DUE_NOTE_PREFIX);
}

/** Reglee automatiquement (element absent de la moto, ou pas a echeance) : ni facture ni OR imprime. */
export function isAutoSettled(o: { status: string; not_done_note?: string | null }): boolean {
  return isAbsentOnBike(o) || isNotDueSettled(o);
}

type DueOp = { id: string; label: string; status: string; source?: string | null; not_done_note?: string | null; due_forced?: boolean | null };

/**
 * La liste de l'OR vue « a echeance ». `hidden` : pas dues (reglees ou a regler) ; `toSettle` : encore
 * « a faire » ; `info` : verdict des operations periodiques affichees (due / a verifier).
 * `withLines` : operations qui ont des pieces sur l'OR (toujours affichees).
 */
export function applyDueRule<O extends DueOp>(ops: readonly O[], ctx: DueContext | null, withLines: ReadonlySet<string> = new Set()): {
  visible: O[]; hidden: { op: O; verdict: DueVerdict | null }[]; toSettle: { op: O; note: string }[]; info: Map<string, DueVerdict>;
} {
  const visible: O[] = [];
  const hidden: { op: O; verdict: DueVerdict | null }[] = [];
  const toSettle: { op: O; note: string }[] = [];
  const info = new Map<string, DueVerdict>();
  for (const o of ops) {
    if (isNotDueSettled(o) && !o.due_forced) {
      hidden.push({ op: o, verdict: verdictFor(ctx, o.label) });
      continue;
    }
    const v = o.source === 'plan' ? verdictFor(ctx, o.label) : null;
    const keep = !v || v.state !== 'not_due' || !!o.due_forced || o.status !== 'a_faire' || withLines.has(o.id);
    if (keep) {
      visible.push(o);
      if (v && v.state !== 'not_due' && o.status === 'a_faire') info.set(o.id, v);
      continue;
    }
    hidden.push({ op: o, verdict: v });
    toSettle.push({ op: o, note: notDueNote(v!, ctx?.start_source) });
  }
  return { visible, hidden, toSettle, info };
}

/**
 * Kit d'entretien (OR cree depuis un RDV, fiche moto) : les pieces / liquides d'une operation
 * periodique pas due ne sont pas chargees (meme signatures que l'historique). Rien de connu : gardees.
 */
export function filterKitByDue<R extends { designation: string }>(rows: readonly R[], ctx: DueContext | null): { kept: R[]; dropped: { row: R; op: string; verdict: DueVerdict }[] } {
  if (!ctx) return { kept: [...rows], dropped: [] };
  const notDue = ctx.periodic
    .map((p) => ({ p, sig: signatureOf(p.text), v: verdictFor(ctx, p.text) }))
    .filter((x): x is { p: PeriodicOp; sig: Signature; v: DueVerdict } => !!x.sig && !!x.v && x.v.state === 'not_due');
  const kept: R[] = [];
  const dropped: { row: R; op: string; verdict: DueVerdict }[] = [];
  for (const r of rows) {
    const hit = notDue.find((x) => evidenceMatches(x.sig, r.designation));
    if (hit) dropped.push({ row: r, op: hit.p.text, verdict: hit.v });
    else kept.push(r);
  }
  return { kept, dropped };
}
