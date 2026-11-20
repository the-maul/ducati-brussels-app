/**
 * M8 — Decision client Q57 (20/11/2026) : fin de journee, « Vous etes toujours la ? ». Regles PURES.
 *
 * A l'heure de fin de l'horaire du mecanicien, si son pointage tourne encore, la fenetre
 * s'affiche (Mon atelier, OR, parcours, pointeuse). Sans reponse en 5 min : pause automatique,
 * motif « Fin de journee (automatique) », a l'heure de fin + 5 min (le serveur le fait aussi,
 * tablette eteinte). « Oui, je continue » repousse la question de 1 h (reglable).
 * Miroir SQL : workshop_time_entry_ask_at / workshop_end_of_day_due (20261120101000).
 */

export const EOD_POLL_MS = 60_000;
export const DEFAULT_PROMPT_MINUTES = 5;
export const DEFAULT_SNOOZE_MINUTES = 60;

/**
 * Heure de la question d'un pointage (miroir de workshop_time_entry_ask_at) :
 * fin de l'horaire du jour, repoussee a la derniere reponse « je continue » ; pointage commence
 * apres la fin de l'horaire : un report apres son debut (ou la derniere reponse si plus tard).
 */
export function endOfDayAskAt(p: { scheduleEnd: Date; startedAt: Date; lastContinue?: Date | null; snoozeMinutes?: number }): Date {
  const snooze = (p.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES) * 60_000;
  const last = p.lastContinue ? p.lastContinue.getTime() : -Infinity;
  const base = p.startedAt.getTime() >= p.scheduleEnd.getTime() ? p.startedAt.getTime() + snooze : p.scheduleEnd.getTime();
  return new Date(Math.max(base, last));
}

/** Heure de la pause automatique = question + delai de reponse. */
export const endOfDayPauseAt = (askAt: Date, promptMinutes = DEFAULT_PROMPT_MINUTES) => new Date(askAt.getTime() + promptMinutes * 60_000);

/** Secondes restantes avant la pause automatique (0 = c'est l'heure). */
export const secondsUntil = (at: string | Date, now: number = Date.now()) =>
  Math.max(0, Math.ceil(((typeof at === 'string' ? Date.parse(at) : at.getTime()) - now) / 1000));
export const countdownLabel = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export type EndOfDayDue = {
  entry_id: string; kind: string; or_id: string | null; or_number: string | null; task_code: string | null;
  mechanic_id: string | null; mechanic_code: string | null; workshop_mechanic_id: string | null; mechanic_name: string | null;
  started_at: string; ask_at: string; pause_at: string;
};

/**
 * Questions a montrer sur CET ecran : compte personnel → ses pointages (compte connecte, ou le
 * code mecano saisi a la pointeuse) ; tablette partagee → tous ceux de l'atelier (chacun repond
 * apres « Qui etes-vous ? »).
 */
export function dueForViewer(rows: readonly EndOfDayDue[], v: { shared: boolean; userId: string | null; codes?: readonly string[] }): EndOfDayDue[] {
  if (v.shared) return [...rows];
  const codes = new Set((v.codes ?? []).filter(Boolean));
  return rows.filter((r) => (r.mechanic_code ? codes.has(r.mechanic_code) : !!v.userId && r.mechanic_id === v.userId));
}

/** Ecrans ou la fenetre s'affiche : Mon atelier, fiche OR, parcours guide, pointeuse. */
export function isEndOfDayScreen(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '');
  if (p === '/workshop/my-workshop' || p === '/workshop/chrono') return true;
  if (/^\/workshop\/journey\/[^/]+$/.test(p)) return true;
  // Fiche OR : /workshop/<id> (hors pages nommees de l'atelier).
  const m = /^\/workshop\/([^/]+)$/.exec(p);
  return !!m && !['new', 'planning', 'chrono', 'kits', 'maintenance-plans', 'my-workshop', 'accidents', 'journey'].includes(m[1]);
}
