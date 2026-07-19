/**
 * M7 — Statuts du flux de reprise (appel d'offres → entrée en stock).
 * Flux : Collecté → Envoyé → Accepté → Repris ; Annulé hors flux.
 *  - collecte : formulaire rempli (magasin / domicile) ;
 *  - envoye   : formulaire (PDF) envoyé aux marchands ;
 *  - accepte  : le client marque son accord pour une offre ;
 *  - repris   : reprise validée, véhicule entré en stock occasion.
 * Rétrocompat : anciens statuts « ouvert » → collecte, « valide » → repris.
 * Icônes lucide (charte §9 : statut = couleur + icône + libellé, pas d'emoji).
 * Logique PURE testée dans tests/reprise-status.test.ts.
 */
import { ClipboardList, Send, Check, Flag, XCircle, type LucideIcon } from 'lucide-react';

export type RepriseStatus = 'collecte' | 'envoye' | 'accepte' | 'repris' | 'annule';

/** Ordre d'affichage (sélecteur manuel). */
export const REPRISE_STATUSES: RepriseStatus[] = ['collecte', 'envoye', 'accepte', 'repris', 'annule'];

/** Étapes du flux (progression), Annulé exclu. */
export const REPRISE_FLOW: RepriseStatus[] = ['collecte', 'envoye', 'accepte', 'repris'];

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const REPRISE_STATUS_META: Record<RepriseStatus, { tone: Tone; icon: LucideIcon }> = {
  collecte: { tone: 'neutral', icon: ClipboardList },
  envoye: { tone: 'info', icon: Send },
  accepte: { tone: 'warning', icon: Check },
  repris: { tone: 'success', icon: Flag },
  annule: { tone: 'neutral', icon: XCircle },
};

/** Anciens statuts (ouvert/valide) + valeurs inconnues → statut du nouveau flux. */
export function normalizeRepriseStatus(s: string | null | undefined): RepriseStatus {
  switch (s) {
    case 'ouvert': return 'collecte';
    case 'valide': return 'repris';
    case 'collecte':
    case 'envoye':
    case 'accepte':
    case 'repris':
    case 'annule':
      return s;
    default: return 'collecte';
  }
}

/**
 * Transition AUTOMATIQUE sûre : n'avance jamais en arrière dans le flux et ne
 * touche pas un dossier annulé. Renvoie le statut à écrire, ou null si aucun
 * changement (déjà à ce stade ou plus avancé). Les changements MANUELS ne
 * passent pas par ici (l'utilisateur peut mettre n'importe quel statut).
 */
export function autoAdvance(current: RepriseStatus, target: RepriseStatus): RepriseStatus | null {
  if (current === 'annule') return null;                 // annulé : figé
  if (target === current) return null;
  const ci = REPRISE_FLOW.indexOf(current);
  const ti = REPRISE_FLOW.indexOf(target);
  if (ci >= 0 && ti >= 0 && ti <= ci) return null;       // pas de recul
  return target;
}
