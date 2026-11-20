/**
 * M8 — Lot « OR lisible » (19/11/2026) : « Où en est cet OR / prochaine étape ». Règles PURES
 * (sans base ni React), testées dans `tests/atelier-or-lisible.test.ts`.
 *
 * Retour du client (19/11) : « on arrive sur l'OR et on comprend que dalle ». La fiche montrait trois
 * états qui se contredisaient (statut « EN COURS », pointage « PAS ENCORE DÉMARRÉ », photos « À
 * FAIRE ») et onze boutons de même poids. Ici, UNE seule lecture de l'OR, à partir des mêmes
 * sources que les blocs (statut de l'OR, pointages du lot A, photos du lot C, opérations du lot D) :
 *  - la frise : Réception (photos) → Travail (pointage) → Opérations x / y → Prêt → Facture ;
 *  - l'étape courante ;
 *  - le titre de l'état, cohérent (« en cours, personne ne pointe » quand c'est le cas) ;
 *  - LE geste suivant (un seul bouton primaire) ;
 *  - les actions secondaires utiles à cette étape (2 ou 3), le reste allant dans « Plus d'actions ».
 */

export type ReceptionStatusLite = 'none' | 'en_cours' | 'complete' | 'plus_tard';
export type WorkStateLite = 'running' | 'paused' | 'stopped' | 'none';

export type OrProgressInput = {
  orStatus: string;
  /** Série de photos de réception disponible (migration du lot C). */
  receptionOn: boolean;
  receptionStatus: ReceptionStatusLite;
  photosTaken: number;
  photosTotal: number;
  photosMissing: number;
  /** Pointage du lot A disponible. */
  pointageOn: boolean;
  workState: WorkStateLite;
  /** Mon pointage tourne sur cet OR. */
  mineRunning: boolean;
  /** Mon dernier pointage sur cet OR est en pause (Reprendre). */
  minePaused: boolean;
  /** Nom de qui pointe (premier pointage ouvert), pour le titre. */
  runningBy?: string | null;
  /** Opérations du plan (lot D) : 0 = pas de liste. */
  planTotal: number;
  planResolved: number;
  planMandatoryOpen: number;
  /** Un entretien est choisi sur l'OR (le parcours guidé peut s'ouvrir). */
  hasService: boolean;
  /** Accord du client : rien ne démarre tant qu'une proposition est en attente ou refusée. */
  workAllowed: boolean;
  /** Garantie en attente de réponse : pas de facture. */
  warrantyPending: boolean;
  /**
   * Lot UX atelier (20/11) : une liste d'opérations viendra (entretien choisi, RDV sans OR encore) :
   * l'étape « Opérations » est montrée « à faire », sans compteur. Présentation seulement.
   */
  planExpected?: boolean;
};

export type StepKey = 'reception' | 'work' | 'operations' | 'ready' | 'invoice';
/** `paused` : le travail est en pause (pointage en pause), ni fait ni en cours (test écran du 20/11). */
export type StepState = 'done' | 'current' | 'todo' | 'skipped' | 'warning' | 'paused';
export type Step = { key: StepKey; state: StepState; count?: { done: number; total: number } };

/** Le geste du gros bouton. */
export type NextAction =
  | 'photos'       // prendre les photos de réception (puis Démarrer)
  | 'start'        // Démarrer = pointage + OR en cours
  | 'resume'       // Reprendre mon pointage en pause
  | 'journey'      // Continuer le parcours guidé (opérations à cocher)
  | 'finish'       // Terminer : toutes les opérations obligatoires réglées → Prêt
  | 'ready'        // Passer prêt (OR sans liste d'opérations)
  | 'invoice'      // Facturer
  | 'view_invoice' // Voir la facture
  | 'none';

/** Titre de l'état (clé i18n `orLisible.head_*`), une seule lecture cohérente. */
export type Headline =
  | 'cancelled' | 'invoiced' | 'ready' | 'informed' | 'blocked_approval' | 'blocked_warranty'
  | 'running' | 'paused' | 'in_progress_nobody' | 'waiting_parts' | 'waiting_quote' | 'todo_photos' | 'todo';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Actions secondaires mises en avant à cette étape (Imprimer reste en tête ; le reste : menu « Plus d'actions »). */
export type SideAction = 'pause' | 'stop' | 'photos' | 'journey' | 'notify_ready' | 'approval';

export type OrProgress = {
  steps: Step[];
  current: StepKey | null;
  next: NextAction;
  headline: Headline;
  tone: Tone;
  side: SideAction[];
};

const DONE_STATUSES = new Set(['pret', 'client_informe', 'facture']);
const WORKABLE = new Set(['a_faire', 'attente_devis', 'attente_pieces', 'en_cours']);

/** Photos « réglées » : terminées (même incomplètes, signalé) ou remises à plus tard. */
export const receptionSettled = (s: ReceptionStatusLite) => s === 'complete' || s === 'plus_tard';

export function orProgress(i: OrProgressInput): OrProgress {
  const st = i.orStatus;
  const finished = DONE_STATUSES.has(st);
  const invoiced = st === 'facture';
  const cancelled = st === 'annule';
  const workable = WORKABLE.has(st);
  const hasPlan = i.planTotal > 0;
  const planDone = hasPlan && i.planMandatoryOpen === 0;
  // Travail commencé = quelqu'un a pointé (pointage du lot A) ; sans pointage en base : statut « en cours ».
  // Un OR « en cours » sans aucun pointage n'est PAS commencé (titre « en cours, personne ne pointe »).
  const workStarted = finished || (i.pointageOn ? i.workState !== 'none' : st === 'en_cours');

  // ---- étape courante : la première non réglée (les photos d'abord tant que personne n'a pointé)
  let current: StepKey | null = null;
  if (!cancelled && !invoiced) {
    if (finished) current = 'invoice';
    else if (i.receptionOn && !receptionSettled(i.receptionStatus) && i.workState === 'none') current = 'reception';
    else if (hasPlan && workStarted && !planDone) current = 'operations';
    else if (planDone || (!hasPlan && i.workState === 'stopped')) current = 'ready';
    else current = 'work';
  }

  // ---- frise
  const at = (k: StepKey, done: boolean): StepState => (done ? 'done' : current === k ? 'current' : 'todo');
  const steps: Step[] = [];
  if (i.receptionOn) {
    const photos: StepState = i.receptionStatus === 'complete' ? (i.photosMissing > 0 ? 'warning' : 'done')
      : i.receptionStatus === 'plus_tard' || finished ? 'skipped'
      : current === 'reception' ? 'current' : 'todo';
    steps.push({ key: 'reception', state: photos, count: { done: i.photosTaken, total: i.photosTotal } });
  }
  // Pointage en pause : « Travail : en pause », jamais « fait » (défaut vu au test écran du 20/11).
  steps.push({ key: 'work', state: !finished && !cancelled && i.workState === 'paused' ? 'paused' : at('work', finished || (workStarted && current !== 'work')) });
  if (hasPlan) steps.push({ key: 'operations', state: at('operations', finished || planDone), count: { done: i.planResolved, total: i.planTotal } });
  else if (i.planExpected && !finished && !cancelled) steps.push({ key: 'operations', state: 'todo' });
  steps.push({ key: 'ready', state: at('ready', finished) });
  steps.push({ key: 'invoice', state: at('invoice', invoiced) });

  // ---- titre (une seule source cohérente)
  let headline: Headline;
  if (cancelled) headline = 'cancelled';
  else if (invoiced) headline = 'invoiced';
  else if (st === 'client_informe') headline = 'informed';
  else if (st === 'pret') headline = 'ready';
  else if (!i.workAllowed) headline = 'blocked_approval';
  else if (i.workState === 'running') headline = 'running';
  else if (i.workState === 'paused') headline = 'paused';
  else if (st === 'attente_pieces') headline = 'waiting_parts';
  else if (st === 'attente_devis') headline = 'waiting_quote';
  else if (st === 'en_cours' && i.pointageOn) headline = 'in_progress_nobody';
  else if (st === 'en_cours') headline = 'running';
  else if (i.receptionOn && !receptionSettled(i.receptionStatus)) headline = 'todo_photos';
  else headline = 'todo';

  const tone: Tone = cancelled || invoiced ? 'neutral'
    : finished ? 'success'
    : headline === 'blocked_approval' ? 'danger'
    : headline === 'running' ? 'info'
    : headline === 'paused' || headline === 'in_progress_nobody' || headline === 'waiting_parts' || headline === 'waiting_quote' ? 'warning'
    : 'neutral';

  // ---- geste suivant
  let next: NextAction = 'none';
  if (invoiced) next = 'view_invoice';
  else if (finished) next = i.warrantyPending ? 'none' : 'invoice';
  else if (cancelled || !workable || !i.workAllowed) next = 'none';
  else if (!i.pointageOn) {
    // Sans pointage en base : « Démarrer » passe seulement l'OR en cours (décision Q43).
    next = st !== 'en_cours' ? (i.receptionOn && !receptionSettled(i.receptionStatus) ? 'photos' : 'start')
      : planDone ? 'finish' : hasPlan || i.hasService ? 'journey' : 'ready';
  }
  else if (i.mineRunning) next = planDone ? 'finish' : hasPlan || i.hasService ? 'journey' : 'ready';
  else if (i.minePaused) next = 'resume';
  else if (planDone) next = 'finish';
  else if (i.receptionOn && !receptionSettled(i.receptionStatus)) next = 'photos';
  else next = 'start';

  // ---- actions secondaires de l'étape (2 ou 3, le reste dans « Plus d'actions »)
  const side: SideAction[] = [];
  if (i.mineRunning && !finished) side.push('pause', 'stop');
  if (finished && !invoiced && st === 'pret') side.push('notify_ready');
  if (!finished && !cancelled && next !== 'journey' && (hasPlan || i.hasService) && workStarted) side.push('journey');
  if (!i.workAllowed && workable) side.push('approval');
  if (i.receptionOn && next !== 'photos' && !finished && !cancelled && !receptionSettled(i.receptionStatus)) side.push('photos');

  return { steps, current, next, headline, tone, side: side.slice(0, 3) };
}

// ---------------------------------------------------------------------------------------------
// « Commentaire client » (popup G8) : ne s'ouvre que pour un vrai commentaire
// ---------------------------------------------------------------------------------------------
/**
 * L'import G8 a écrit le statut du client G8 dans le commentaire de la fiche (« Statut G8 :
 * Client », « Statut G8 : Prospect », « Statut G8 : Client atelier »… : 15 966 fiches sur 16 364).
 * Ce n'est pas un commentaire : la popup ne doit pas s'ouvrir pour ça. On retire ces lignes
 * techniques, on garde tout le reste (le texte de la fiche n'est pas modifié).
 */
const IMPORT_META_LINE = /^\s*statut\s+g8\s*:.*$/i;

export function meaningfulClientComment(notes: string | null | undefined): string {
  return String(notes ?? '')
    .split(/\r?\n/)
    .filter((l) => !IMPORT_META_LINE.test(l))
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Autres OR ouverts sur la même moto
// ---------------------------------------------------------------------------------------------
export type SiblingOr = { id: string; number: string | null; status: string; created_at: string };

/**
 * Essai du client (19/11) : la moto avait DEUX OR ouverts (un ancien OR accident et l'OR du RDV
 * d'entretien) ; les photos et le pointage sont partis sur l'ancien. La fiche le dit : les autres
 * OR encore ouverts de la même moto, du plus récent au plus ancien.
 */
export function openSiblings(rows: readonly SiblingOr[], orId: string): SiblingOr[] {
  return rows
    .filter((r) => r.id !== orId && r.status !== 'facture' && r.status !== 'annule')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
