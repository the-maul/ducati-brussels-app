// M10 — INTERRUPTEUR DES RELANCES (migration 20261103140000, CRM011).
//
// Module PUR (aucun acces reseau ni base) : partage par la fonction serveur `followups-send`,
// par l'ecran CRM → Relances et par les tests (`bun test`).
//
// Constat du 03/11/2026 en production : le client est encore en developpement, les crons
// `followups-plan` / `followups-send` sont actifs et les cles Microsoft Graph sont posees. Des que
// les echeances d'entretien seront calculees (extract DCS : 229 motos, 142 proprietaires avec
// e-mail, echeances deja depassees), la planification creerait des relances dues immediatement et
// le cron enverrait de VRAIS mails aux clients. D'ou un interrupteur, FERME PAR DEFAUT :
//   - arrete : rien ne part (la planification continue, on voit la liste) ;
//   - test   : tout mail part a l'adresse de test uniquement, objet prefixe
//              « [TEST relance pour <client>] », relance marquee envoyee avec is_test ;
//   - actif  : envoi reel chez les clients.
// Sans ligne `followup_settings` pour la societe : arrete. Meme esprit que « Import des commandes
// du site » (Arrete / Actif, mission 03) et que `shopify_sync_settings.mode` (arrete / essai / tous).

export const FOLLOWUP_MODES = ['arrete', 'test', 'actif'] as const;
export type FollowupMode = (typeof FOLLOWUP_MODES)[number];

/** Le mode effectif : tout ce qui n'est pas explicitement test ou actif est ARRETE. */
export function normalizeFollowupMode(m: unknown): FollowupMode {
  return m === 'test' || m === 'actif' ? m : 'arrete';
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
/** Une adresse e-mail plausible (une seule, sans espace ni separateur). */
export function isEmail(v: unknown): v is string {
  return typeof v === 'string' && EMAIL_RE.test(v.trim());
}

/** Prefixe de l'objet en mode test : « [TEST relance pour Marco Rossi] Votre Ducati... ». */
export function testSubject(subject: string, clientLabel: string | null | undefined): string {
  const who = String(clientLabel ?? '').trim() || 'client';
  return `[TEST relance pour ${who}] ${subject}`;
}

export type DeliveryInput = {
  mode: unknown;
  testRecipient: string | null | undefined;
  /** Destinataire reel (e-mail du client), deja nettoye. */
  to: string;
  subject: string;
  /** Nom du client pour le prefixe de l'objet en mode test. */
  clientLabel?: string | null;
};

export type Delivery =
  | { send: false; reason: 'arrete' | 'no_test_recipient' | 'no_email'; mode: FollowupMode }
  | { send: true; mode: 'test' | 'actif'; to: string; subject: string; isTest: boolean; sentTo: string };

/**
 * Ou part le mail, et avec quel objet, selon le mode de la societe.
 *   - arrete : rien ;
 *   - test   : a l'adresse de test (sinon rien : `no_test_recipient`), objet prefixe ;
 *   - actif  : au client (sinon rien : `no_email`).
 */
export function resolveDelivery(input: DeliveryInput): Delivery {
  const mode = normalizeFollowupMode(input.mode);
  if (mode === 'arrete') return { send: false, reason: 'arrete', mode };
  if (mode === 'test') {
    const tr = String(input.testRecipient ?? '').trim().toLowerCase();
    if (!isEmail(tr)) return { send: false, reason: 'no_test_recipient', mode };
    return { send: true, mode, to: tr, subject: testSubject(input.subject, input.clientLabel), isTest: true, sentTo: tr };
  }
  const to = String(input.to ?? '').trim().toLowerCase();
  if (!isEmail(to)) return { send: false, reason: 'no_email', mode };
  return { send: true, mode, to, subject: input.subject, isTest: false, sentTo: to };
}

/** « Envoyer maintenant » est-il possible dans ce mode ? (arrete : les boutons sont grises) */
export function canSendNow(mode: unknown): boolean {
  return normalizeFollowupMode(mode) !== 'arrete';
}

/** Couleur du statut du bandeau (l'icone et le libelle sont poses par l'ecran). */
export function modeTone(mode: unknown): 'neutral' | 'warning' | 'success' {
  const m = normalizeFollowupMode(mode);
  return m === 'actif' ? 'success' : m === 'test' ? 'warning' : 'neutral';
}
