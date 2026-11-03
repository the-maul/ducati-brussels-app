/**
 * B12 / PDV030 — Etiquettes par l'imprimante d'etiquettes DU POSTE : Zebra ZPL (reseau, Web Serial,
 * WebUSB) quand le poste en a une ; sinon (aucun poste, « impression du navigateur ») la fenetre
 * d'impression des gabarits, comme avant. Le ZPL suit une mise en page simple (designation,
 * reference, prix, code-barres) a la taille de l'etiquette du poste, ou du gabarit choisi.
 */
import { printRawLabels, type DeviceContext, type DeviceResult } from '@/lib/devices';
import type { ZplLabel } from '@/lib/devices/protocols';
import { receiptAmount } from '@/lib/devices/receipt';
import { printLabelsWithTemplate, type TemplateLabelItem } from './render';
import type { LabelData, LabelTemplateConfig } from './template-types';

/** Donnees d'etiquette → etiquette ZPL (prix promo s'il existe, sinon TTC, puis HT). */
export function zplFromLabelData(d: LabelData, qty: number): ZplLabel {
  const price = d.price_promo ?? d.price_ttc ?? d.price_ht;
  return {
    reference: d.reference, designation: d.designation, barcode: d.barcode_value || d.reference,
    price: price != null ? `${receiptAmount(price)} EUR` : null, qty,
  };
}

export async function printTemplateLabels(ctx: DeviceContext, cfg: LabelTemplateConfig, items: TemplateLabelItem[]): Promise<DeviceResult> {
  const raw = await printRawLabels(
    ctx,
    items.map((it) => zplFromLabelData(it.data, it.qty)),
    { width: cfg.widthMm, height: cfg.heightMm },
  );
  if (raw) return raw;
  printLabelsWithTemplate(cfg, items);
  return { ok: true, code: 'printed' };
}
