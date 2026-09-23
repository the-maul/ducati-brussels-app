/**
 * M8 — Parcours d'entretien pas à pas (mission 07) : RÈGLES PURES, sans accès base ni React.
 * Testées dans `tests/workshop-journey.test.ts`.
 *
 * Trois familles de règles :
 *  1. choisir l'entretien dû (réutilise `nextDue` de maintenance-plans : premier atteint km ou mois) ;
 *  2. construire le parcours (opérations du manuel ↔ procédures pas à pas, opération sans procédure) ;
 *  3. avancement et temps (étapes cochées, chronos, comparaison avec le temps officiel UT et le temps facturé B11).
 *
 * Décisions :
 *  - **1 UT = 6 minutes** (barème Ducati) ; quand le manuel donne les deux, `minutes` fait foi.
 *  - Une opération est « faite » si le technicien l'a cochée **ou** si toutes les étapes de sa
 *    procédure sont cochées. Sans procédure, seule la case du technicien compte (§6 : ne jamais bloquer).
 *  - **Rien n'est facturé automatiquement** : le récapitulatif ne fait que proposer des lignes d'OR.
 */
import { nextDue, type ServiceInterval } from '../maintenance-plans';
import type {
  Figure, JourneyState, MaintenanceProgram, OfficialTime, OperationProgress, Procedure,
  ServiceDef, ServiceSchedule, Torque, Warning, WarningKind, Finding,
} from './types';

/** 1 unité de temps du barème Ducati = 6 minutes. */
export const MINUTES_PER_UT = 6;

// ---------------------------------------------------------------------------
// 1. Noms d'entretien : le manuel n'écrit pas deux fois la même chose de la même façon
// ---------------------------------------------------------------------------

/** « OIL Service 15000 » → « oil service 15000 » : sans accent, sans ponctuation, espaces réduits. */
export function normalizeService(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Famille d'entretien : « First Service 1000 », « Oil Service 1000 », « Service 1000 » désignent le
 * même premier entretien ; « Temporel », « Annual Service », « Temps (mois) » l'entretien annuel.
 * Sert à rapprocher les échéances, les listes de procédures et les temps officiels, qui viennent de
 * trois tableaux différents du manuel.
 */
export function serviceFamily(name: string | null | undefined): string {
  const n = normalizeService(name).replace(/\binterventions?\b/g, '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  const first = /\b(first|1000|premier)\b/.test(n) && /\b(service|1000)\b/.test(n) && /\b1000\b/.test(n);
  if (first) return 'premier_1000';
  if (/\bdesmo\b/.test(n)) return 'desmo';
  if (/\b(valve|soupape)\b/.test(n)) return 'valve';
  if (/\b(annual|annuel|temporel|temps mois|temps)\b/.test(n)) return 'annual';
  if (/\boil\b/.test(n)) return 'oil';
  return n.replace(/\s*\d+\s*$/, '').trim() || n;
}

/**
 * Clés parasites du manuel : ce sont des en-têtes de colonnes du tableau d'entretien
 * (« km x 1000 », « mi x 1000 », « Temps (mois) »), pas des entretiens.
 */
export function isRealService(name: string): boolean {
  const n = normalizeService(name);
  if (!n) return false;
  return !/^(km|mi|miles)\s*(x|×)?\s*\d*$/.test(n) && !/^temps\s*(mois|heures)?$/.test(n) && !/^mois$/.test(n);
}

// ---------------------------------------------------------------------------
// 2. Quel entretien est dû ?
// ---------------------------------------------------------------------------

export type DueService = {
  service: ServiceDef;
  /** Échéance du programme correspondant (opérations à faire), si elle existe. */
  schedule: ServiceSchedule | null;
  dueKm: number | null;
  dueDate: string | null;
  /** L'échéance est atteinte (km OU mois). */
  reached: boolean;
  reachedBy: 'km' | 'mois' | null;
  /** Nombre d'opérations à faire (0 = le manuel ne détaille pas cet entretien). */
  operations: number;
};

/**
 * Les entretiens de la moto, le plus urgent d'abord : atteints en tête, puis par km d'échéance.
 * `now` = km et date du jour ; `last` = dernier entretien de ce type (facultatif) ;
 * `start` = mise en service (sert au premier entretien et aux échéances en mois).
 */
export function dueServices(
  program: Pick<MaintenanceProgram, 'services' | 'echeances'>,
  now: { km: number | null; date: string | Date },
  last?: Record<string, { km: number | null; date: string | null }> | null,
  start?: { date: string | null } | null,
): DueService[] {
  const out = program.services.filter((s) => isRealService(s.service)).map((s) => {
    const fam = serviceFamily(s.service);
    const schedule = program.echeances.find((e) => serviceFamily(e.echeance) === fam) ?? null;
    const interval: ServiceInterval = s.premiereEcheance
      ? { km_first: s.km ?? null, km_interval: s.km ?? null, months: s.mois ?? null }
      : { km_interval: s.km ?? null, months: s.mois ?? null };
    const d = nextDue(interval, now, last?.[fam] ?? null, start ?? null);
    return {
      service: s, schedule,
      dueKm: d.dueKm, dueDate: d.dueDate, reached: d.reached, reachedBy: d.reachedBy,
      operations: schedule?.operations?.length ?? 0,
    };
  });
  return out.sort((a, b) =>
    Number(b.reached) - Number(a.reached)
    || (a.dueKm ?? Number.MAX_SAFE_INTEGER) - (b.dueKm ?? Number.MAX_SAFE_INTEGER)
    || String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')),
  );
}

// ---------------------------------------------------------------------------
// 3. Construire le parcours : opérations du manuel ↔ procédures pas à pas
// ---------------------------------------------------------------------------

/** Procédures du manuel rattachées à un entretien (rapprochement par famille d'entretien). */
export function proceduresForService(program: Pick<MaintenanceProgram, 'proceduresParService'>, serviceLabel: string) {
  const fam = serviceFamily(serviceLabel);
  const entries = Object.entries(program.proceduresParService);
  const exact = entries.find(([k]) => normalizeService(k) === normalizeService(serviceLabel));
  const list = exact ? [exact] : entries.filter(([k]) => isRealService(k) && serviceFamily(k) === fam);
  const seen = new Set<string>();
  const out: { parcoursId: string; titre: string; operation: string }[] = [];
  for (const [, procs] of list) {
    for (const p of procs) if (!seen.has(p.parcoursId)) { seen.add(p.parcoursId); out.push(p); }
  }
  return out;
}

/**
 * Le parcours d'un entretien : une ligne par opération du programme, avec sa procédure quand il y
 * en a une. Une opération sans procédure reste dans la liste avec `parcoursId: null` — case à
 * cocher seule, jamais bloquante (§6 de la demande).
 */
export function buildOperations(program: MaintenanceProgram, serviceLabel: string): OperationProgress[] {
  const fam = serviceFamily(serviceLabel);
  const schedule = program.echeances.find((e) => serviceFamily(e.echeance) === fam)
    ?? program.echeances.find((e) => normalizeService(e.echeance) === normalizeService(serviceLabel))
    ?? null;
  const procs = proceduresForService(program, serviceLabel);
  const used = new Set<string>();

  const labels = schedule?.operations?.length ? schedule.operations : procs.map((p) => p.operation || p.titre);
  const ops: OperationProgress[] = labels.map((label, i) => {
    const match = matchProcedure(label, procs, used);
    if (match) used.add(match.parcoursId);
    return { id: `op${i + 1}`, label, parcoursId: match?.parcoursId ?? null, done: false, steps: {}, note: '', chrono: [] };
  });

  // Procédures du manuel qu'aucune opération n'a réclamées : on ne les perd pas.
  let n = ops.length;
  for (const p of procs) {
    if (used.has(p.parcoursId)) continue;
    ops.push({ id: `op${++n}`, label: p.titre, parcoursId: p.parcoursId, done: false, steps: {}, note: '', chrono: [] });
  }
  return ops;
}

/** Rapproche le libellé d'une opération d'une procédure : l'opération citée, puis le titre, puis les mots. */
function matchProcedure(label: string, procs: { parcoursId: string; titre: string; operation: string }[], used: Set<string>) {
  const l = normalizeService(label);
  if (!l) return null;
  const free = procs.filter((p) => !used.has(p.parcoursId));
  const pools = [free, procs];
  for (const pool of pools) {
    const exact = pool.find((p) => normalizeService(p.operation) === l) ?? pool.find((p) => normalizeService(p.titre) === l);
    if (exact) return exact;
  }
  const words = new Set(l.split(' ').filter((w) => w.length > 3));
  if (!words.size) return null;
  let best: { p: (typeof procs)[number]; score: number } | null = null;
  for (const pool of pools) {
    for (const p of pool) {
      const t = new Set(normalizeService(`${p.operation} ${p.titre}`).split(' ').filter((w) => w.length > 3));
      let common = 0;
      for (const w of words) if (t.has(w)) common++;
      const score = common / words.size;
      if (score >= 0.6 && (!best || score > best.score)) best = { p, score };
    }
    if (best) return best.p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Avancement
// ---------------------------------------------------------------------------

export type Progress = { opsDone: number; opsTotal: number; stepsDone: number; stepsTotal: number; percent: number };

/** Une opération est faite si elle est cochée, ou si toutes les étapes de sa procédure le sont. */
export function isOperationDone(op: OperationProgress, stepCount: number | null | undefined): boolean {
  if (op.done) return true;
  if (!stepCount) return false;
  return Object.keys(op.steps).length >= stepCount;
}

/**
 * Avancement du parcours. `stepCounts` = nombre d'étapes par procédure (id → n) ; une opération sans
 * procédure compte pour une « étape » afin que la barre avance aussi quand il n'y a rien à détailler.
 */
export function journeyProgress(ops: OperationProgress[], stepCounts: Record<string, number>): Progress {
  let stepsDone = 0, stepsTotal = 0, opsDone = 0;
  for (const op of ops) {
    const n = op.parcoursId ? stepCounts[op.parcoursId] ?? 0 : 0;
    if (n > 0) {
      stepsTotal += n;
      stepsDone += Math.min(n, Object.keys(op.steps).length);
    } else {
      stepsTotal += 1;
      if (op.done) stepsDone += 1;
    }
    if (isOperationDone(op, n)) opsDone++;
  }
  return {
    opsDone, opsTotal: ops.length, stepsDone, stepsTotal,
    percent: stepsTotal ? Math.round((stepsDone / stepsTotal) * 100) : 0,
  };
}

/** Reprise après une coupure : première opération non faite, et première étape non cochée dedans. */
export function resumePoint(ops: OperationProgress[], stepCounts: Record<string, number>): { operationId: string; stepNo: number | null } | null {
  for (const op of ops) {
    const n = op.parcoursId ? stepCounts[op.parcoursId] ?? 0 : 0;
    if (isOperationDone(op, n)) continue;
    let stepNo: number | null = null;
    for (let i = 1; i <= n; i++) if (!op.steps[String(i)]) { stepNo = i; break; }
    return { operationId: op.id, stepNo };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. Temps : chronos, temps officiel (UT), temps facturé (B11)
// ---------------------------------------------------------------------------

/** Millisecondes d'un chrono, segment ouvert compris (arrêté à `now`). */
export function elapsedMs(chrono: { startedAt: string; endedAt: string | null }[], now: number | Date = Date.now()): number {
  const end = now instanceof Date ? now.getTime() : now;
  let ms = 0;
  for (const s of chrono ?? []) {
    const a = new Date(s.startedAt).getTime();
    if (!Number.isFinite(a)) continue;
    const b = s.endedAt ? new Date(s.endedAt).getTime() : end;
    if (Number.isFinite(b) && b > a) ms += b - a;
  }
  return ms;
}

/** Minutes passées sur une opération (arrondi à la minute inférieure : on ne gonfle jamais un temps). */
export function operationMinutes(op: OperationProgress, now: number | Date = Date.now()): number {
  return Math.floor(elapsedMs(op.chrono, now) / 60000);
}

export function spentMinutes(ops: OperationProgress[], now: number | Date = Date.now()): number {
  return ops.reduce((n, op) => n + operationMinutes(op, now), 0);
}

/** Un seul chrono tourne à la fois : démarrer une opération arrête celle qui courait. */
export function startChrono(ops: OperationProgress[], operationId: string, now: Date = new Date()): OperationProgress[] {
  const iso = now.toISOString();
  return ops.map((op) => {
    const closed = op.chrono.map((s) => (s.endedAt ? s : { ...s, endedAt: iso }));
    return op.id === operationId
      ? { ...op, chrono: [...closed, { startedAt: iso, endedAt: null }] }
      : { ...op, chrono: closed };
  });
}

export function stopChrono(ops: OperationProgress[], now: Date = new Date()): OperationProgress[] {
  const iso = now.toISOString();
  return ops.map((op) => ({ ...op, chrono: op.chrono.map((s) => (s.endedAt ? s : { ...s, endedAt: iso })) }));
}

export function runningOperationId(ops: OperationProgress[]): string | null {
  return ops.find((op) => op.chrono.some((s) => !s.endedAt))?.id ?? null;
}

/**
 * Temps officiel Ducati de l'entretien, en minutes. Les intitulés du poster reprennent souvent le
 * kilométrage (« OIL SERVICE 15000 ») : on l'enlève avant de rapprocher, et on retient le premier
 * intitulé de la bonne famille. `minutes` fait foi ; sinon UT × 6.
 */
export function officialMinutes(times: OfficialTime[] | null | undefined, serviceLabel: string, km?: number | null): number | null {
  const fam = serviceFamily(serviceLabel);
  if (!fam) return null;
  const value = (t: OfficialTime) => (t.minutes != null && Number.isFinite(t.minutes) ? Number(t.minutes)
    : t.ut != null && Number.isFinite(t.ut) ? Number(t.ut) * MINUTES_PER_UT : null);
  // « OIL SERVICE 15000 » : le kilométrage fait partie de l'intitulé. Selon l'entretien, c'est lui qui
  // porte le sens (« OIL SERVICE 1000 » = le premier entretien) ou du bruit (« OIL SERVICE 15000 » = un
  // Oil Service ordinaire) : on garde les deux lectures.
  const strip = (s: string) => normalizeService(s).replace(/\b\d{3,6}\b/g, ' ').replace(/\s+/g, ' ').trim();
  const families = (s: string) => {
    const whole = serviceFamily(s), stripped = serviceFamily(strip(s));
    return whole === stripped ? [whole] : [whole, stripped];
  };
  const cites = (t: OfficialTime, n: number) => new RegExp(`\\b${n}\\b`).test(normalizeService(t.intitule));
  const pool = (times ?? []).filter((t) => value(t) != null);

  // 1) l'intitulé cite le kilométrage de l'entretien : c'est la bonne ligne du poster.
  if (km) {
    const hit = pool.find((t) => cites(t, km) && families(t.intitule).includes(fam));
    if (hit) return value(hit);
  }
  // 2) même famille, intitulés composés écartés (« OIL SERVICE + Interventions DESMO SERVICE »),
  //    lecture directe avant lecture sans kilométrage, et kilométrage étranger écarté.
  const simple = pool
    .filter((t) => !t.intitule.includes('+') && families(t.intitule).includes(fam))
    .sort((a, b) => Number(serviceFamily(b.intitule) === fam) - Number(serviceFamily(a.intitule) === fam));
  if (simple.length) {
    const clean = km ? simple.filter((t) => !/\b\d{4,6}\b/.test(normalizeService(t.intitule)) || cites(t, km)) : simple;
    return value((clean.length ? clean : simple)[0]);
  }
  return null;
}

export type TimeComparison = {
  spent: number;
  official: number | null;
  billed: number | null;
  /** Temps passé − temps officiel (positif = on a dépassé le barème). */
  vsOfficial: number | null;
  /** Temps passé − temps facturé (B11 : rapprochement passé / facturé). */
  vsBilled: number | null;
  /** Temps passé / temps officiel, arrondi au centième (null si pas de barème). */
  ratio: number | null;
};

export function compareTimes(spent: number, official: number | null, billed: number | null): TimeComparison {
  return {
    spent, official, billed,
    vsOfficial: official == null ? null : spent - official,
    vsBilled: billed == null ? null : spent - billed,
    ratio: official && official > 0 ? Math.round((spent / official) * 100) / 100 : null,
  };
}

/** Temps facturé sur l'OR (B11, étage 3) : lignes de main-d'œuvre, quantité en heures. */
export function billedMinutes(lines: { kind: string; quantity: number | string | null }[] | null | undefined): number | null {
  const mo = (lines ?? []).filter((l) => l.kind === 'mo');
  if (!mo.length) return null;
  const hours = mo.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
  return Math.round(hours * 60);
}

/** « 1 h 42 » / « 42 min » / « — ». */
export function fmtMinutes(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  const sign = m < 0 ? '−' : '';
  const a = Math.abs(Math.round(m));
  return a < 60 ? `${sign}${a} min` : `${sign}${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// 6. Affichage : couples, avertissements, pièces à ajouter à l'OR
// ---------------------------------------------------------------------------

/** « 6 Nm (5,4 – 6,6) » — la valeur en Nm reste en tête, la plage suit. */
export function torqueLabel(c: Torque): string {
  const nb = (n: number) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(n);
  if (c.valeurNm == null) return c.texte ?? '';
  const range = c.min != null && c.max != null ? ` (${nb(c.min)} – ${nb(c.max)})` : c.tolerance ? ` ${c.tolerance}` : '';
  return `${nb(c.valeurNm)} Nm${range}`;
}

/** Attention = danger (rouge), Important = warning (orange), le reste = info. */
export function warningTone(type: WarningKind): 'danger' | 'warning' | 'info' {
  const n = normalizeService(type);
  if (n.startsWith('attention') || n.startsWith('danger') || n.startsWith('avertissement')) return 'danger';
  if (n.startsWith('important') || n.startsWith('elimination')) return 'warning';
  return 'info';
}

/** Couples de l'étape : ceux portés par l'étape, plus ceux que la procédure rattache à ce numéro. */
export function torquesForStep(proc: Procedure | null | undefined, stepNo: number): Torque[] {
  const step = proc?.etapes?.find((e) => e.n === stepNo);
  const own = step?.couples ?? [];
  const fromProc = (proc?.couples ?? []).filter((c) => c.etape === stepNo);
  const seen = new Set(own.map((c) => c.texte ?? String(c.valeurNm)));
  return [...own, ...fromProc.filter((c) => !seen.has(c.texte ?? String(c.valeurNm)))];
}

export function allFigures(proc: Procedure | null | undefined): Figure[] {
  const out: Figure[] = [...(proc?.figuresIntro ?? [])];
  for (const e of proc?.etapes ?? []) out.push(...(e.figures ?? []));
  return out;
}

export type ProposedOrLine = { kind: 'piece' | 'texte'; designation: string; quantity: number };

/**
 * Récapitulatif → lignes à ajouter à l'OR. **Rien n'est facturé automatiquement** : les pièces
 * partent à prix 0, c'est le comptoir qui met le prix ; les observations deviennent des lignes texte.
 */
export function findingsToOrLines(findings: Finding[] | null | undefined): ProposedOrLine[] {
  const out: ProposedOrLine[] = [];
  for (const f of findings ?? []) {
    if (f.kind === 'piece') {
      const designation = [f.reference, f.texte].filter(Boolean).join(' — ') || f.texte;
      out.push({ kind: 'piece', designation, quantity: f.quantity && f.quantity > 0 ? f.quantity : 1 });
    } else if (f.kind === 'observation' && f.texte.trim()) {
      out.push({ kind: 'texte', designation: f.texte.trim(), quantity: 1 });
    }
  }
  return out;
}

/** Le récapitulatif de fin : ce qui a été fait, le temps, les pièces, les observations. */
export type JourneySummary = {
  progress: Progress;
  spent: number;
  times: TimeComparison;
  parts: Finding[];
  observations: Finding[];
  photos: Finding[];
  pending: { id: string; label: string }[];
  lines: ProposedOrLine[];
};

export function summarize(
  state: JourneyState,
  stepCounts: Record<string, number>,
  official: number | null,
  billed: number | null,
  now: number | Date = Date.now(),
): JourneySummary {
  const progress = journeyProgress(state.operations, stepCounts);
  const spent = spentMinutes(state.operations, now);
  return {
    progress, spent,
    times: compareTimes(spent, official, billed),
    parts: state.findings.filter((f) => f.kind === 'piece'),
    observations: state.findings.filter((f) => f.kind === 'observation'),
    photos: state.findings.filter((f) => f.kind === 'photo'),
    pending: state.operations
      .filter((op) => !isOperationDone(op, op.parcoursId ? stepCounts[op.parcoursId] ?? 0 : 0))
      .map((op) => ({ id: op.id, label: op.label })),
    lines: findingsToOrLines(state.findings),
  };
}

/** Avertissements à montrer en tête d'une étape (les généraux de la procédure ne sont pas répétés). */
export function stepWarnings(proc: Procedure | null | undefined, stepNo: number): Warning[] {
  return proc?.etapes?.find((e) => e.n === stepNo)?.avertissements ?? [];
}
