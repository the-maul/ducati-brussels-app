/**
 * Paramètres → Mise en production (revue UX/UI du 20/11/2026) : la fréquence d'une tâche du serveur
 * (expression cron de pg_cron, heures UTC) dite en français et à l'heure de Bruxelles —
 * « 30 23 * * * » → « tous les jours à 00:30 » en hiver. Règle PURE, testée par
 * tests/cron-describe.test.ts. Ce qui n'entre dans aucun cas connu est rendu tel quel
 * (« réglage particulier (…) »), jamais deviné.
 */

export const BRUSSELS_TZ = 'Europe/Brussels';

/** Clé du libellé (bloc designTransverse.production) + variables à remplir. */
export type CronText = { key: string; vars: Record<string, string> };

const INT = /^\d+$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Heure de Bruxelles (HH:MM) et jour du mois / de la semaine, pour un instant UTC. */
function brusselsParts(d: Date): { time: string; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BRUSSELS_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: 'numeric', weekday: 'short',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { time: `${get('hour')}:${get('minute')}`, day: Number(get('day')), weekday: weekdays.indexOf(get('weekday')) };
}

/**
 * Décrit une expression cron à 5 champs (minute heure jour-du-mois mois jour-de-semaine).
 * `now` fixe la date de référence (heure d'été ou d'hiver) ; par défaut, maintenant.
 */
export function describeCron(expr: string, now: Date = new Date()): CronText {
  const raw: CronText = { key: 'raw', vars: { expr } };
  const f = String(expr ?? '').trim().split(/\s+/);
  if (f.length !== 5) return raw;
  const [mi, ho, dom, mon, dow] = f;
  if (mon !== '*') return raw;

  // Toutes les minutes / toutes les n minutes.
  if (ho === '*' && dom === '*' && dow === '*') {
    if (mi === '*') return { key: 'every_minute', vars: {} };
    const every = /^\*\/(\d+)$/.exec(mi);
    if (every) return Number(every[1]) === 1 ? { key: 'every_minute', vars: {} } : { key: 'every_minutes', vars: { n: every[1] } };
    // Toutes les heures à :MM (le décalage horaire de Bruxelles est d'heures pleines).
    if (INT.test(mi) && Number(mi) < 60) return { key: 'hourly_at', vars: { min: `:${pad2(Number(mi))}` } };
    return raw;
  }

  // Toutes les n heures, à :MM.
  const everyH = /^\*\/(\d+)$/.exec(ho);
  if (everyH && dom === '*' && dow === '*' && INT.test(mi) && Number(mi) < 60) {
    return { key: 'every_hours', vars: { n: everyH[1], min: `:${pad2(Number(mi))}` } };
  }

  // Heure fixe : conversion UTC → Bruxelles sur la date de référence.
  if (!INT.test(mi) || !INT.test(ho) || Number(mi) > 59 || Number(ho) > 23) return raw;
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, Number(ho), Number(mi)));
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  if (dom === '*' && dow === '*') {
    return { key: 'daily_at', vars: { time: brusselsParts(at(y, m, now.getUTCDate())).time } };
  }
  if (dom === '*' && (dow === '1-5' || INT.test(dow))) {
    // Une date de la semaine courante qui tombe (en UTC) le jour demandé, pour connaître le jour à Bruxelles.
    const target = dow === '1-5' ? 1 : Number(dow) % 7;
    const base = new Date(Date.UTC(y, m, now.getUTCDate()));
    const shift = (target - base.getUTCDay() + 7) % 7;
    const p = brusselsParts(at(y, m, now.getUTCDate() + shift));
    if (dow === '1-5') {
      // Lundi à vendredi en UTC reste lundi à vendredi à Bruxelles tant qu'on ne change pas de jour.
      return p.weekday === 1 ? { key: 'weekdays_at', vars: { time: p.time } } : raw;
    }
    return { key: 'weekly_at', vars: { dayIndex: String(p.weekday), time: p.time } };
  }
  if (dow === '*' && INT.test(dom) && Number(dom) >= 1 && Number(dom) <= 28) {
    const p = brusselsParts(at(y, m, Number(dom)));
    return { key: 'monthly_at', vars: { d: String(p.day), time: p.time } };
  }
  return raw;
}
