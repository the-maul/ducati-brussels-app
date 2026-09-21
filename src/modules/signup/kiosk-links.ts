/**
 * Mission 01, lot 4 — écran d'accueil de la borne (retour client du 21/09 :
 * « passer facilement du Configurateur Ducati à Créer mon compte » + lien vers
 * les occasions Ducati Bruxelles).
 *
 * Logique PURE (testée dans tests/kiosk-links.test.ts) : adresses par défaut,
 * validation de l'adresse saisie dans Paramètres → Borne d'inscription, et
 * résolution de ce que montre la borne.
 *
 * Réglage en base (migration 20260921180000, colonnes de `signup_settings`) :
 *   - null (jamais réglé, ou migration pas encore appliquée) → adresse par défaut ;
 *   - ''   (vidé volontairement)                              → tuile masquée ;
 *   - 'https://…'                                             → cette adresse.
 * Si les deux tuiles externes sont masquées, la borne ouvre directement le
 * formulaire, comme avant.
 *
 * Pourquoi un lien dans le même onglet et pas un cadre (iframe) : les deux sites
 * refusent d'être affichés dans un cadre (en-têtes vérifiés le 21/09 :
 * configurator.ducati.com → `X-Frame-Options: DENY` ; ducatibruxelles.be →
 * `X-Frame-Options: DENY` et `frame-ancestors 'none'`). Le retour à la borne est
 * assuré par l'application kiosque de la tablette (docs/bible/guides/borne-kiosque.md).
 */

/** Configurateur officiel Ducati, Belgique, en français. */
export const DEFAULT_CONFIGURATOR_URL = 'https://configurator.ducati.com/bikes/be/fr';
/** Motos d'occasion du site public Ducati Bruxelles (boutique Shopify). */
export const DEFAULT_USED_URL = 'https://ducatibruxelles.be/collections/motos-doccasion-new';

export const KIOSK_URL_MAX = 500;

export type KioskUrlCheck =
  | { ok: true; value: string } // '' = tuile masquée
  | { ok: false; code: 'not_https' | 'invalid' | 'too_long' };

/**
 * Valide l'adresse saisie par l'administrateur. Vide = tuile masquée.
 * Seules les adresses https:// complètes sont acceptées (pas de javascript:,
 * pas de http://, pas d'adresse relative).
 */
export function checkKioskUrl(input: string | null | undefined): KioskUrlCheck {
  const raw = (input ?? '').trim();
  if (raw === '') return { ok: true, value: '' };
  if (raw.length > KIOSK_URL_MAX) return { ok: false, code: 'too_long' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // « ducatibruxelles.be/… » tapé sans le https:// : on le complète.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(raw)) {
      return checkKioskUrl(`https://${raw}`);
    }
    return { ok: false, code: 'invalid' };
  }
  if (url.protocol !== 'https:') return { ok: false, code: 'not_https' };
  if (!url.hostname.includes('.') || url.username || url.password) return { ok: false, code: 'invalid' };
  return { ok: true, value: url.toString() };
}

export interface KioskLinks {
  /** null = tuile masquée. */
  configurator: string | null;
  used: string | null;
}

/** Valeur en base → adresse affichée (null = défaut, '' = masquée, invalide = défaut). */
function resolveOne(stored: unknown, fallback: string): string | null {
  if (stored === null || stored === undefined) return fallback;
  if (typeof stored !== 'string') return fallback;
  const check = checkKioskUrl(stored);
  if (!check.ok) return fallback;
  return check.value === '' ? null : check.value;
}

/** Ligne `signup_settings` (ou null si illisible) → liens de l'écran d'accueil. */
export function resolveKioskLinks(row: Record<string, unknown> | null | undefined): KioskLinks {
  return {
    configurator: resolveOne(row?.kiosk_configurator_url, DEFAULT_CONFIGURATOR_URL),
    used: resolveOne(row?.kiosk_used_url, DEFAULT_USED_URL),
  };
}

/** L'écran d'accueil à tuiles n'a de sens que s'il propose autre chose que le formulaire. */
export function kioskHasHome(links: KioskLinks): boolean {
  return !!(links.configurator || links.used);
}

/** Nom de domaine affiché sous une tuile, et à mettre en liste blanche du kiosque. */
export function kioskUrlHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
