/**
 * M6 — Confirmation avant un document irréversible (mission 08, cartes 4 et 6, 03/11/2026).
 * Créer une facture ou un avoir consomme un numéro, fait bouger le stock et ne se défait pas :
 * l'écran demande confirmation avec un récapitulatif (type, prochain numéro, client, total,
 * lignes, conséquences). Cette logique est pure (testée sans DOM) ; la fenêtre est dans
 * `confirm-document-dialog.tsx`, l'aperçu du numéro reprend `previewNumber` (séquences M0).
 */
import { previewNumber } from '@/modules/settings/sequences-api';
import { CONVERSIONS, REAL_OUT_DOC_TYPES } from './write-api';

/** Types de document dont la création (validation, conversion, avoir) demande confirmation. */
export const CONFIRMED_DOC_TYPES = ['FAC', 'AVO'] as const;

export type ConfirmAction = 'validate' | 'convert' | 'creditNote';

/** Faut-il confirmer avant de créer un document de ce type ? */
export function requiresConfirmation(docType: string): boolean {
  return (CONFIRMED_DOC_TYPES as readonly string[]).includes(docType);
}

/** Conversions d'un type source qui demandent confirmation (DEV → FAC, RES → FAC…). */
export function confirmedConversions(sourceType: string): string[] {
  return (CONVERSIONS[sourceType] ?? []).filter(requiresConfirmation);
}

export type ConfirmLine = {
  designation: string; quantity: number; lineTtc: number;
  /** Avoir : ligne de la facture et quantité encore créditable (avoir partiel, étude §3 ligne 10). */
  lineId?: string; maxQuantity?: number;
};

/** Avoir : quantités choisies par ligne (clé = `lineId`). */
export type CreditChoice = Map<string, number>;

/** Quantités proposées par défaut pour un avoir : tout ce qui reste créditable. */
export function defaultCreditChoice(lines: ConfirmLine[]): CreditChoice {
  return new Map(lines.filter((l) => l.lineId && (l.maxQuantity ?? 0) > 0).map((l) => [l.lineId as string, l.maxQuantity as number]));
}

/** Borne une quantité saisie : entre 0 et le reste créditable, 3 décimales. */
export function clampCreditQuantity(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(Math.min(value, max) * 1000) / 1000;
}

/** Lignes et total TTC d un avoir d après le choix (montant au prorata de la quantité créditée), signés négatifs. */
export function creditChoiceSummary(lines: ConfirmLine[], choice: CreditChoice): { lines: ConfirmLine[]; totalTtc: number; full: boolean } {
  const out: ConfirmLine[] = [];
  let total = 0;
  let full = true;
  for (const l of lines) {
    if (!l.lineId || !(l.maxQuantity && l.maxQuantity > 0)) continue;
    const q = clampCreditQuantity(choice.get(l.lineId) ?? 0, l.maxQuantity);
    if (Math.abs(q - l.maxQuantity) > 0.0005) full = false;
    if (q <= 0) continue;
    const ttc = Math.round((Math.abs(l.lineTtc) / Math.abs(l.quantity || 1)) * q * 100) / 100;
    out.push({ ...l, quantity: -q, lineTtc: -ttc });
    total += ttc;
  }
  return { lines: out, totalTtc: -Math.round(total * 100) / 100, full };
}

export type ConfirmSummary = {
  action: ConfirmAction;
  docType: string;
  /** Numéro qui sera attribué (aperçu de la séquence), null si la séquence est inconnue. */
  nextNumber: string | null;
  clientName: string | null;
  totalTtc: number;
  lines: ConfirmLine[];
  /** Clés i18n `sales.*` des conséquences à afficher. */
  consequences: string[];
  /** Clés i18n `sales.*` du titre et du bouton principal (« Créer la facture »). */
  titleKey: string;
  primaryKey: string;
};

const MAX_LINES = 8;

/** Lignes montrées dans la fenêtre (les lignes vides sont ignorées, au plus 8 ; `hiddenLines` dit le reste). */
export function visibleConfirmLines(lines: ConfirmLine[]): { shown: ConfirmLine[]; hidden: number } {
  const kept = lines.filter((l) => l.designation.trim());
  return { shown: kept.slice(0, MAX_LINES), hidden: Math.max(0, kept.length - MAX_LINES) };
}

/** Récapitulatif d'une création à confirmer. */
export function buildConfirmSummary(p: {
  action: ConfirmAction; docType: string; clientName?: string | null; totalTtc: number; lines: ConfirmLine[];
  sequence?: Parameters<typeof previewNumber>[0] | null;
  /** Avoir partiel : la facture reste telle quelle, seules les lignes choisies sont reprises. */
  partialCredit?: boolean;
}): ConfirmSummary {
  const credit = p.docType === 'AVO';
  const consequences: string[] = [];
  if (credit) consequences.push('confirmStockBack', p.partialCredit ? 'confirmInvoiceCreditedPartial' : 'confirmInvoiceCredited', 'confirmRefunds');
  else if ((REAL_OUT_DOC_TYPES as readonly string[]).includes(p.docType)) consequences.push('confirmStockOut');
  if (p.action === 'convert') consequences.push('confirmSourceConverted');
  consequences.push('confirmIrreversible');
  return {
    action: p.action, docType: p.docType,
    nextNumber: p.sequence ? previewNumber(p.sequence) : null,
    clientName: p.clientName ?? null, totalTtc: p.totalTtc, lines: p.lines, consequences,
    titleKey: credit ? 'confirmCreditTitle' : 'confirmInvoiceTitle',
    primaryKey: credit ? 'confirmCreateCredit' : 'confirmCreateInvoice',
  };
}
