/**
 * M10 — RELANCES : les regles, pures (aucun acces base, aucun React). Testees dans
 * `tests/followups.test.ts`. La base applique les memes regles (migration 20261031120000) ;
 * ce fichier sert a l'ecran (onglets, compteurs, apercu des modeles) et aux tests.
 *
 * Decision client du 30/10/2026 (M-72) :
 *   - relance d'entretien envoyee 15 jours avant la date due ;
 *   - intervention reportee relancee a la date fixee au comptoir ;
 *   - mail envoye + 5 jours sans reponse ni rendez-vous → « a rappeler » dans le CRM commercial ;
 *   - un rendez-vous pris ferme la relance ;
 *   - le mail part dans la langue de la fiche du client (M-71).
 */

export const FOLLOWUP_KINDS = ['entretien', 'intervention_reportee', 'manuel'] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];
/** Kinds qui ont un modele de mail (le kind « manuel » porte son propre texte). */
export const TEMPLATE_KINDS = ['entretien', 'intervention_reportee'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const FOLLOWUP_STATUSES = ['planifiee', 'envoyee', 'repondue', 'a_rappeler', 'close', 'annulee'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export const FOLLOWUP_LOCALES = ['fr', 'nl', 'en', 'it'] as const;
export type FollowupLocale = (typeof FOLLOWUP_LOCALES)[number];

/** Jours avant la date due pour une relance d'entretien. */
export const LEAD_DAYS = 15;
/** Jours sans reponse apres l'envoi avant de passer la main au commercial. */
export const CALLBACK_DAYS = 5;

/** Les variables acceptees dans un modele, avec la cle i18n de leur explication. */
export const TEMPLATE_VARS = ['prenom', 'nom', 'moto', 'date', 'objet', 'km', 'lien_rdv'] as const;

const DAY = 24 * 3600 * 1000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY));

/**
 * Date d'envoi d'une relance.
 *   - entretien : date due − 15 jours, jamais avant aujourd'hui (une echeance deja proche part
 *     tout de suite) ;
 *   - intervention reportee : la date fixee au comptoir (jamais avant aujourd'hui).
 * Dates ISO (AAAA-MM-JJ).
 */
export function sendAtFor(kind: FollowupKind, dueDate: string, today: string): string {
  const base = kind === 'entretien' ? addDays(dueDate, -LEAD_DAYS) : dueDate;
  return base < today ? today : base;
}

export type FollowupLite = {
  status: FollowupStatus;
  sent_at: string | null;
  answered_at: string | null;
  vehicle_id: string | null;
  contact_id: string | null;
};
export type AppointmentLite = {
  created_at: string;
  status: string;
  vehicle_id: string | null;
  contact_id: string | null;
};

/** Un rendez-vous (non annule) pris apres l'envoi, pour la moto — ou le client quand une moto manque. */
export function appointmentAfter(f: FollowupLite, appointments: AppointmentLite[]): boolean {
  if (!f.sent_at) return false;
  const sent = Date.parse(f.sent_at);
  return appointments.some((a) => {
    if (a.status === 'annule' || Date.parse(a.created_at) <= sent) return false;
    if (f.vehicle_id && a.vehicle_id) return a.vehicle_id === f.vehicle_id;
    return !!f.contact_id && a.contact_id === f.contact_id;
  });
}

/**
 * Regle J+5 : que devient une relance envoyee ?
 *   - 'close'       : un rendez-vous a ete pris depuis l'envoi ;
 *   - 'a_rappeler'  : 5 jours sans reponse ni rendez-vous → carte CRM ;
 *   - 'unchanged'   : trop tot, ou deja repondue / terminee.
 */
export function j5State(f: FollowupLite, appointments: AppointmentLite[], now: Date): 'close' | 'a_rappeler' | 'unchanged' {
  if (f.status !== 'envoyee' || !f.sent_at) return 'unchanged';
  if (appointmentAfter(f, appointments)) return 'close';
  if (f.answered_at) return 'unchanged';
  const elapsed = now.getTime() - Date.parse(f.sent_at);
  return elapsed >= CALLBACK_DAYS * DAY ? 'a_rappeler' : 'unchanged';
}

/** Langue du modele : celle de la fiche du client si on l'a dans cette langue, sinon FR. */
export function pickTemplateLocale(contactLocale: unknown, available: readonly string[]): FollowupLocale {
  const loc = typeof contactLocale === 'string' && (FOLLOWUP_LOCALES as readonly string[]).includes(contactLocale) ? contactLocale : 'fr';
  return (available.includes(loc) ? loc : 'fr') as FollowupLocale;
}

/**
 * Remplit les variables d'un modele. Un prenom manquant ne laisse pas « Bonjour , » :
 * l'espace devant la virgule disparait. Les valeurs sont inserees telles quelles (texte brut).
 */
export function fillTemplate(text: string, vars: Partial<Record<(typeof TEMPLATE_VARS)[number], string | null | undefined>>): string {
  let out = text;
  for (const k of TEMPLATE_VARS) out = out.split(`{${k}}`).join(vars[k] ?? '');
  return out.replace(/[ \t]+,/g, ',');
}

/** Variables encore presentes dans un texte (pour signaler une faute de frappe : {prenon}). */
export function unknownVars(text: string): string[] {
  const found = text.match(/\{[a-zA-Z_]+\}/g) ?? [];
  return [...new Set(found.filter((v) => !(TEMPLATE_VARS as readonly string[]).includes(v.slice(1, -1))))];
}

/** Onglet de l'ecran ou vit une relance. */
export type FollowupTab = 'a_envoyer' | 'en_attente' | 'a_rappeler';
export function followupTab(status: FollowupStatus): FollowupTab {
  if (status === 'planifiee') return 'a_envoyer';
  if (status === 'envoyee') return 'en_attente';
  return 'a_rappeler';
}

/** Couleur du statut (l'icone et le libelle sont poses par l'ecran : couleur + icone + libelle). */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export function statusTone(status: FollowupStatus): Tone {
  switch (status) {
    case 'planifiee': return 'info';
    case 'envoyee': return 'warning';
    case 'repondue': return 'success';
    case 'a_rappeler': return 'danger';
    case 'close': return 'success';
    default: return 'neutral';
  }
}

/** Compteurs du haut de page : a envoyer cette semaine, en attente de reponse, a rappeler. */
export function counters(list: { status: FollowupStatus; send_at: string }[], today: string) {
  const weekEnd = addDays(today, 7);
  return {
    toSendThisWeek: list.filter((f) => f.status === 'planifiee' && f.send_at <= weekEnd).length,
    waiting: list.filter((f) => f.status === 'envoyee').length,
    toCall: list.filter((f) => f.status === 'a_rappeler').length,
  };
}
