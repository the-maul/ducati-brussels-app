/**
 * M5 / M2 — Règles PURES de l'étiquetage (B12, rattrapage G8 du 18/11/2026).
 *  - quantité par défaut : stock réel (au moins 1) ou une seule étiquette ;
 *    à la réception : la quantité reçue (ou le nombre d'étiquettes saisi sur la ligne) ;
 *  - édition différée CUMULÉE par poste : les ajouts successifs d'un même article au même
 *    poste s'additionnent ;
 *  - double étiquette avec prix tarif : une seconde étiquette porte le prix tarif (PPC).
 * Testées dans tests/inventaire-guide.test.ts.
 */
import type { LabelData } from '@/modules/articles/labels/template-types';

export type DefaultQtyMode = 'stock' | 'one';

export function defaultLabelQty(mode: DefaultQtyMode, realQty: number, receivedQty?: number | null): number {
  if (mode === 'one') return 1;
  if (receivedQty != null && receivedQty > 0) return Math.ceil(receivedQty);
  return Math.max(1, Math.round(realQty));
}

export type PendingRow = {
  workstation_id: string | null; workstation_name: string | null; article_id: string;
  reference: string; designation: string; with_barcode: boolean; with_price: boolean; with_tarif: boolean;
  qty: number; lines: number; first_at: string; last_at: string; operators: string | null; ids: number[];
};

export type PendingGroup = { workstation_id: string | null; workstation_name: string | null; rows: PendingRow[]; total: number };

/** Regroupe la file par poste (un poste = une liste « étiquettes en attente »), cumuls conservés. */
export function groupPendingByWorkstation(rows: PendingRow[]): PendingGroup[] {
  const map = new Map<string, PendingGroup>();
  for (const r of rows) {
    const key = r.workstation_id ?? '';
    const g = map.get(key) ?? { workstation_id: r.workstation_id, workstation_name: r.workstation_name, rows: [], total: 0 };
    g.rows.push(r);
    g.total += Number(r.qty);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => (a.workstation_name ?? '').localeCompare(b.workstation_name ?? ''));
}

/** Cumul côté écran (avant envoi en base) : même article + mêmes options → quantités additionnées. */
export function cumulate<T extends { article_id: string; qty: number }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const it of items) {
    const prev = map.get(it.article_id);
    map.set(it.article_id, prev ? { ...prev, qty: prev.qty + it.qty } : { ...it });
  }
  return [...map.values()];
}

export type LabelSourceArticle = {
  reference: string; designation: string; bin_location: string | null; bin_location2: string | null;
  price_ttc: number | null; price_ht: number | null; price_tarif: number | null; pack_qty: number | null; barcode: string | null;
};

export type BuildOptions = { withPrice: boolean; withBarcode: boolean; withTarif: boolean; storeName: string; tarifLabel: string };

/**
 * Étiquettes d'un article : la normale (prix de vente) et, en double étiquetage, une seconde
 * au prix tarif (si l'article en a un). `priceTtc` = PV TTC déjà arrondi selon la règle de la société.
 */
export function labelItemsFor(a: LabelSourceArticle, qty: number, priceTtc: number | null, o: BuildOptions): { data: LabelData; qty: number }[] {
  const base: LabelData = {
    reference: a.reference, designation: a.designation,
    price_ttc: o.withPrice ? priceTtc : null,
    price_ht: o.withPrice ? a.price_ht : null,
    price_promo: null, discount: null, store_name: o.storeName,
    bin: a.bin_location, bin2: a.bin_location2,
    pack_qty: a.pack_qty, barcode_value: o.withBarcode ? (a.barcode || a.reference) : a.reference,
  };
  const out = [{ data: base, qty }];
  if (o.withTarif && a.price_tarif != null && a.price_tarif > 0) {
    // Le libellé « Prix tarif » précède la désignation : visible quel que soit le format d'étiquette.
    out.push({ data: { ...base, designation: `${o.tarifLabel} · ${a.designation}`, price_ttc: a.price_tarif, price_ht: null, discount: o.tarifLabel }, qty });
  }
  return out;
}
