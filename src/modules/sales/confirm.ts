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

export type ConfirmLine = { designation: string; quantity: number; lineTtc: number };

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
}): ConfirmSummary {
  const credit = p.docType === 'AVO';
  const consequences: string[] = [];
  if (credit) consequences.push('confirmStockBack', 'confirmInvoiceCancelled', 'confirmRefunds');
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
