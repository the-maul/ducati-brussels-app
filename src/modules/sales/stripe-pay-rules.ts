/**
 * Mission 12, carte P3 -- PDV040 « Payer par QR (Bancontact / carte) » : regles pures de l ecran.
 * Statut en direct (couleur + icone + libelle), montant propose (jamais majore : reste a payer,
 * acompte 10 %, libre), liens « a distance » (mailto: / sms:, ouverts dans l application du vendeur :
 * le DMS n envoie rien lui-meme), raison d indisponibilite -> message.
 */
import { Ban, CheckCircle2, Clock, type LucideIcon } from 'lucide-react';
import type { StatusTone } from '@/components/status-badge';
import { qrProposedAmount, type QrAmountChoice } from './epc-qr';
import { t, fillVars } from '@/lib/i18n';

export const STRIPE_METHOD = 'STRIPE';
export type StripePaymentStatus = 'attendu' | 'recu' | 'annule';
export type StripeChannel = 'comptoir' | 'distance';

export function stripeStatusView(status: string): { tone: StatusTone; icon: LucideIcon; labelKey: string } {
  if (status === 'recu') return { tone: 'success', icon: CheckCircle2, labelKey: 'stripePay.statusPaid' };
  if (status === 'annule') return { tone: 'neutral', icon: Ban, labelKey: 'stripePay.statusCancelled' };
  return { tone: 'warning', icon: Clock, labelKey: 'stripePay.statusPending' };
}

/** Montant propose au client : exactement ce qui est du (ou un acompte), aucun supplement. */
export function stripeProposedAmount(choice: QrAmountChoice, clientDue: number, totalTtc: number, free: number): number {
  return qrProposedAmount(choice, clientDue, totalTtc, free);
}

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

type LinkInput = { url: string; amount: number; documentNumber: string | null; company: string };

function message(i: LinkInput): { subject: string; body: string } {
  const vars = { amount: eur(i.amount), number: i.documentNumber ?? '', company: i.company, url: i.url };
  return { subject: fillVars(t('stripePay.mailSubject'), vars), body: fillVars(t('stripePay.mailBody'), vars) };
}

/** Lien mailto: (ouvre la messagerie du vendeur, rien ne part du DMS). */
export function stripeMailtoLink(i: LinkInput & { to?: string | null }): string {
  const m = message(i);
  return `mailto:${encodeURIComponent((i.to ?? '').trim())}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
}

/** Lien sms: (telephone / tablette du vendeur). */
export function stripeSmsLink(i: LinkInput & { phone?: string | null }): string {
  const phone = (i.phone ?? '').replace(/[^\d+]/g, '');
  const vars = { amount: eur(i.amount), number: i.documentNumber ?? '', company: i.company, url: i.url };
  return `sms:${phone}?body=${encodeURIComponent(fillVars(t('stripePay.smsBody'), vars))}`;
}

/** Message affiche quand le bouton est masque (cle absente, reglage desactive, mode different). */
export function stripeReasonKey(reason: string | null | undefined): string | null {
  switch (reason) {
    case null: case undefined: case '': return null;
    case 'no_key': return 'stripePay.unavailableNoKey';
    case 'disabled': return 'stripePay.unavailableDisabled';
    case 'mode_mismatch': return 'stripePay.unavailableMode';
    default: return 'stripePay.unavailableOther';
  }
}

/** Temps restant avant l expiration du lien, en minutes arrondies (0 si expire). */
export function minutesLeft(expiresAt: string | null | undefined, nowMs: number): number | null {
  if (!expiresAt) return null;
  const v = Date.parse(expiresAt);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.ceil((v - nowMs) / 60_000));
}
