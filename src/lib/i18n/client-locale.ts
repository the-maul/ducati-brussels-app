/**
 * Langue du client (I18N004, décision M-71 du 30/10/2026).
 *
 * « On a la version dans la langue de l'utilisateur (français pour la team Italbike), mais le
 * client, lui, la reçoit dans sa langue. » Une seule source : `contacts.locale` (fr par défaut,
 * migration 20261030160000). Le profil du compte client lié (`profiles.locale`) suit par
 * déclencheur en base ; ici, on ne fait que LIRE la fiche pour choisir la langue d'un document,
 * d'un e-mail ou d'un SMS. Jamais la langue de l'écran de l'utilisateur.
 */
import { DEFAULT_LOCALE, isLocale, type Locale } from './index';

/** Langue d'une fiche contact (colonne `locale`), FR si absente ou inconnue. */
export function contactLocale(contact: { locale?: unknown } | null | undefined): Locale {
  const raw = contact?.locale;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * Désignation d'une ligne pour un document dans la langue du client :
 * `articles.designation_i18n[locale]` quand elle existe (M-67), sinon la désignation de la ligne.
 * Le FR reste la colonne de référence (M-69) : en FR, on garde toujours le texte de la ligne.
 */
export function designationFor(
  locale: Locale,
  lineDesignation: string,
  i18n: unknown,
): string {
  if (locale === DEFAULT_LOCALE || !i18n || typeof i18n !== 'object') return lineDesignation;
  const value = (i18n as Record<string, unknown>)[locale];
  return typeof value === 'string' && value.trim() !== '' ? value : lineDesignation;
}
