/**
 * M8 — Programme d'Aide à la Réparation Ducati (moto accidentée).
 * Remise constructeur de 15% sur les pièces si le devis pièces (prix client HT)
 * dépasse 1500 € HT. Fichier de commande à joindre, avec devis, photos moto et
 * photo du n° de châssis, à envoyer à Technique@ducati.fr.
 */
import { supabase } from '@/integrations/supabase/client';
import type { RepairOrderFull } from './api';

export const ACCIDENT_HELP_EMAIL = 'Technique@ducati.fr';
export const ACCIDENT_HELP_THRESHOLD_HT = 1500;
export const ACCIDENT_HELP_DISCOUNT_RATE = 0.15;

export type AccidentPart = { reference: string; designation: string; qty: number; unitPriceHt: number };

export type AccidentOrderSummary = {
  partsTotalHt: number;
  eligible: boolean;
  discount: number;
  netAfterDiscount: number;
};

export function buildAccidentOrder(p: { chassis: string; clientName: string; parts: AccidentPart[] }): AccidentOrderSummary {
  const partsTotalHt = p.parts.reduce((sum, l) => sum + l.qty * l.unitPriceHt, 0);
  const eligible = partsTotalHt > ACCIDENT_HELP_THRESHOLD_HT;
  const discount = eligible ? partsTotalHt * ACCIDENT_HELP_DISCOUNT_RATE : 0;
  return { partsTotalHt, eligible, discount, netAfterDiscount: partsTotalHt - discount };
}

/**
 * Extrait les pièces (kind === 'piece', hors main d'œuvre et lignes texte) d'un OR.
 * repair_order_lines n'a pas de colonne référence (seulement article_id, une FK) :
 * on résout la vraie référence article (articles.reference) pour le fichier de
 * commande Ducati, sinon un UUID interne y serait envoyé par erreur.
 */
export async function extractPartsFromOR(orFull: RepairOrderFull): Promise<AccidentPart[]> {
  const partLines = orFull.lines.filter((l) => l.kind === 'piece');
  const articleIds = [...new Set(partLines.map((l) => l.article_id).filter((id): id is string => !!id))];
  const refByArticle = new Map<string, string>();
  if (articleIds.length) {
    const { data, error } = await supabase.from('articles').select('id, reference').in('id', articleIds);
    if (error) throw error;
    for (const a of data ?? []) refByArticle.set(a.id, a.reference);
  }
  return partLines.map((l) => ({
    reference: (l.article_id && refByArticle.get(l.article_id)) || '',
    designation: l.designation,
    qty: Number(l.quantity),
    unitPriceHt: Number(l.unit_price_ht),
  }));
}

function accidentOrderRows(p: { chassis: string; clientName: string; parts: AccidentPart[] }): unknown[][] {
  return [
    ['Aide Réparation Moto Accidentée'],
    ['Chassis N°', p.chassis],
    ['Nom Client', p.clientName],
    [],
    ['Référence', 'Désignation', 'Qté'],
    ...p.parts.map((l) => [l.reference, l.designation, l.qty]),
  ];
}

/** Génère et télécharge le fichier de commande au format Excel imposé. */
export async function downloadAccidentOrderXlsx(p: { chassis: string; clientName: string; parts: AccidentPart[] }): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(accidentOrderRows(p));
  XLSX.utils.book_append_sheet(wb, ws, 'Commande');
  XLSX.writeFile(wb, `AideReparation_${p.chassis || 'moto'}.xlsx`);
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Fallback CSV du fichier de commande (même pattern que l'export DCS). */
export function downloadAccidentOrderCsv(p: { chassis: string; clientName: string; parts: AccidentPart[] }): void {
  const csv = '﻿' + accidentOrderRows(p).map((row) => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AideReparation_${p.chassis || 'moto'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
