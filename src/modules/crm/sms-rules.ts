/**
 * SMS par Brevo (18/11/2026, decision client T14 / T15) : regles pures, sans acces base ni React.
 * Testees dans `tests/sms-brevo.test.ts`. La base applique les memes regles (migration
 * 20261119170000_m8_sms_brevo.sql) ; ce fichier sert a l'ecran (apercu, compteur, libelles).
 *
 * - Numero E.164, expediteur, taille du SMS : module partage avec les fonctions Edge.
 * - Modeles par defaut FR / NL / EN / IT (miroir de public._sms_default_template), balises
 *   {prenom} {nom} {moto} {or} {horaires} {societe} {date} {heure} (G8 : [client] [daterdv] [heurerdv]).
 * - Mode de la societe : arrete (defaut, rien ne part) / test (tout au numero de test) / actif.
 */
export {
  normalizePhone, isMobile, isValidSender, smsSize, DEFAULT_SENDER, type SmsSize,
} from '../../../supabase/functions/_shared/brevo-sms';

export const SMS_LOCALES = ['fr', 'nl', 'en', 'it'] as const;
export type SmsLocale = (typeof SMS_LOCALES)[number];
export const SMS_KINDS = ['ready', 'reminder'] as const;
export type SmsKind = (typeof SMS_KINDS)[number];
export type SmsTemplates = Partial<Record<SmsKind, Partial<Record<SmsLocale, string>>>>;

export const SMS_MODES = ['arrete', 'test', 'actif'] as const;
export type SmsMode = (typeof SMS_MODES)[number];

export function normalizeSmsMode(m: unknown): SmsMode {
  return typeof m === 'string' && (SMS_MODES as readonly string[]).includes(m) ? (m as SmsMode) : 'arrete';
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function smsModeTone(m: SmsMode): Tone {
  return m === 'actif' ? 'success' : m === 'test' ? 'info' : 'neutral';
}

/** Textes par defaut : miroir EXACT de public._sms_default_template (verifie par le test). */
export const SMS_DEFAULT_TEMPLATES: Record<SmsKind, Record<SmsLocale, string>> = {
  ready: {
    fr: "Bonjour {prenom}, votre {moto} est disponible à l'atelier (OR {or}). Vous pouvez venir la récupérer {horaires}. {societe}",
    nl: 'Beste {prenom}, uw {moto} staat klaar in de werkplaats (OR {or}). U kunt ze ophalen {horaires}. {societe}',
    en: 'Hello {prenom}, your {moto} is ready at the workshop (RO {or}). You can collect it {horaires}. {societe}',
    it: 'Buongiorno {prenom}, la sua {moto} è pronta in officina (OR {or}). Può ritirarla {horaires}. {societe}',
  },
  reminder: {
    fr: 'Bonjour {prenom}, rappel de votre rendez-vous atelier le {date} à {heure}. {societe}',
    nl: 'Beste {prenom}, herinnering aan uw afspraak in de werkplaats op {date} om {heure}. {societe}',
    en: 'Hello {prenom}, reminder of your workshop appointment on {date} at {heure}. {societe}',
    it: "Buongiorno {prenom}, le ricordiamo l'appuntamento in officina il {date} alle {heure}. {societe}",
  },
};

/** {horaires} sans horaires saisis ; {moto} sans moto connue. Miroir de public._sms_fallback. */
export const SMS_FALLBACK: Record<'horaires' | 'moto', Record<SmsLocale, string>> = {
  horaires: { fr: "aux heures d'ouverture", nl: 'tijdens de openingsuren', en: 'during opening hours', it: 'negli orari di apertura' },
  moto: { fr: 'moto', nl: 'moto', en: 'motorcycle', it: 'moto' },
};

/** Balises proposees par type de SMS. */
export const SMS_VARS: Record<SmsKind, readonly string[]> = {
  ready: ['prenom', 'nom', 'moto', 'or', 'horaires', 'societe'],
  reminder: ['prenom', 'nom', 'moto', 'date', 'heure', 'societe'],
};

/** Modele retenu : celui de la societe s'il est rempli, sinon le texte par defaut. */
export function templateFor(templates: SmsTemplates | null | undefined, kind: SmsKind, locale: SmsLocale): string {
  const own = templates?.[kind]?.[locale];
  return own && own.trim() ? own : SMS_DEFAULT_TEMPLATES[kind][locale];
}

/** Remplace les balises {cle} ; espaces doubles et espace avant . , retires. Miroir de public._sms_render. */
export function renderSms(tpl: string, vars: Record<string, string | null | undefined>): string {
  let out = tpl ?? '';
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v ?? '');
  return out.replace(/ {2,}/g, ' ').replace(/ ([.,])/g, '$1').trim();
}

/** Balises inconnues laissees dans un modele (faute de frappe : {prénom}, {client}...). */
export function unknownVars(tpl: string, kind: SmsKind): string[] {
  const found = Array.from((tpl ?? '').matchAll(/\{([^{}\s]+)\}/g)).map((m) => m[1]);
  return [...new Set(found.filter((v) => !SMS_VARS[kind].includes(v)))];
}

/** Valeurs d'exemple pour l'apercu de l'ecran Parametres. */
export function sampleVars(locale: SmsLocale, p: { signature?: string | null; openingHours?: string | null; companyName?: string | null }) {
  return {
    prenom: 'Marco', nom: 'Rossi', moto: 'Ducati Monster', or: 'OR-000123',
    horaires: (p.openingHours ?? '').trim() || SMS_FALLBACK.horaires[locale],
    societe: (p.signature ?? '').trim() || (p.companyName ?? '').trim(),
    date: '21/11', heure: '09:30',
  };
}

/** Templates nettoyes avant enregistrement : vides et textes identiques au defaut retires. */
export function cleanTemplates(t: SmsTemplates | null | undefined): SmsTemplates {
  const out: SmsTemplates = {};
  for (const kind of SMS_KINDS) {
    for (const loc of SMS_LOCALES) {
      const v = (t?.[kind]?.[loc] ?? '').trim();
      if (v && v !== SMS_DEFAULT_TEMPLATES[kind][loc]) (out[kind] ??= {})[loc] = v;
    }
  }
  return out;
}

export const SMS_TEMPLATE_MAX = 480;

/** Statuts de la file (couleur + icone posee par l'ecran + libelle). */
export const SMS_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled', 'not_queued'] as const;
export type SmsStatus = (typeof SMS_STATUSES)[number];

export function smsStatusTone(s: string): Tone {
  switch (s) {
    case 'sent': return 'success';
    case 'pending': case 'sending': return 'info';
    case 'failed': return 'danger';
    case 'skipped': case 'not_queued': return 'warning';
    default: return 'neutral';
  }
}

/** Raisons connues (libelle traduit) ; une erreur Brevo brute (brevo_400_...) garde son code. */
export const SMS_REASONS = [
  'test_company', 'sms_off', 'no_test_recipient', 'consent_refused', 'invalid_number', 'rdv_changed', 'rdv_past',
  'or_not_ready', 'no_api_key', 'no_mobile', 'no_contact', 'auto_off', 'stuck_sending', 'brevo_network',
] as const;

export function isKnownReason(r: string | null | undefined): boolean {
  return !!r && (SMS_REASONS as readonly string[]).includes(r);
}

/** Delai du rappel (minutes) -> jours / heures / minutes. */
export function splitLead(minutes: number): { d: number; h: number; m: number } {
  const n = Math.max(0, Math.round(minutes));
  return { d: Math.floor(n / 1440), h: Math.floor((n % 1440) / 60), m: n % 60 };
}
export function joinLead(p: { d: number; h: number; m: number }): number {
  return Math.max(0, Math.round(p.d || 0)) * 1440 + Math.max(0, Math.round(p.h || 0)) * 60 + Math.max(0, Math.round(p.m || 0));
}

/** Rappel automatique : entre 1 heure et 7 jours avant le RDV (contrainte de sms_settings). */
export function isValidReminderLead(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 60 && minutes <= 10080;
}
