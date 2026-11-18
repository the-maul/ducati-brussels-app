/**
 * Rattrapage G8 (18/11/2026, lot parc) — plusieurs chassis du meme modele (moto neuve).
 *
 * Logique G8 (docs/g8-inventaire/03-vehicules.md, parcours 14) : un « produit fini » est le
 * MODELE (article de type V, ex. DESERTX) ; dessous, la LISTE DE SES CHASSIS (une fiche moto par
 * moto physique). Le stock du modele = nombre de chassis en stock.
 *
 * Regles PURES, miroir de la migration 20261118140000_m3_chassis_multiples_par_modele.sql :
 *  - seul un article V porte plusieurs chassis (`_vehicle_article_share_check`) ;
 *  - une ligne de reception avec chassis = UNE moto (quantite 1), sur un article, VIN unique ;
 *  - a la vente, le chassis vendu est celui du document, sinon le plus ancien en stock
 *    (`_moto_vehicle_for_move`).
 * Tests : tests/parc-chassis.test.ts.
 */
import { normalizeVin } from '@/lib/vin';
import { parcKind } from './parc';
import type { VehicleStatus } from './api';

/** Un article de ce type peut-il porter plusieurs fiches moto ? (V = modele de moto neuve) */
export function articleCanShareChassis(mgmtType: string | null | undefined): boolean {
  return (mgmtType ?? '').toUpperCase() === 'V';
}

export type ChassisLineError = 'chassisQtyOne' | 'chassisNeedsArticle' | 'chassisVinDuplicate' | 'chassisVinMissing';

/**
 * Controle des lignes de reception AVANT toute ecriture : un chassis = une moto (quantite 1),
 * rattache a un article (le modele), VIN present et non repete dans la meme reception.
 * Renvoie la premiere erreur de chaque ligne concernee (index de la ligne).
 */
export function receptionChassisErrors(
  lines: ReadonlyArray<{ article_id?: string | null; quantity: number; chassis?: { vin?: string | null } | null }>,
): { index: number; error: ChassisLineError; vin?: string }[] {
  const out: { index: number; error: ChassisLineError; vin?: string }[] = [];
  const seen = new Map<string, number>();
  lines.forEach((l, index) => {
    if (!l.chassis) return;
    const raw = l.chassis.vin ?? '';
    const vin = normalizeVin(raw);
    if (!vin) {
      // fiche chassis ouverte mais vide : pas de moto, ligne d'article ordinaire
      if (raw.trim() === '') return;
      out.push({ index, error: 'chassisVinMissing' });
      return;
    }
    if (!l.article_id) { out.push({ index, error: 'chassisNeedsArticle', vin }); return; }
    if (Number(l.quantity) !== 1) { out.push({ index, error: 'chassisQtyOne', vin }); return; }
    if (seen.has(vin)) { out.push({ index, error: 'chassisVinDuplicate', vin }); return; }
    seen.set(vin, index);
  });
  return out;
}

export type ChassisRow = {
  id: string;
  status: VehicleStatus;
  entry_date: string | null;
  created_at: string;
};

/** Stock du modele « a la G8 » : chassis en stock / vendus / total. */
export function modelChassisSummary(rows: ReadonlyArray<Pick<ChassisRow, 'status'>>): { total: number; inStock: number; sold: number } {
  let inStock = 0, sold = 0;
  for (const r of rows) {
    const k = parcKind(r.status);
    if (k === 'en_stock' || k === 'depot_vente') inStock += 1;
    else if (k === 'vendue') sold += 1;
  }
  return { total: rows.length, inStock, sold };
}

/**
 * Chassis qui sort du stock a la vente (miroir de `_moto_vehicle_for_move`) :
 * un seul chassis -> lui ; le chassis choisi sur le document s'il appartient au modele ;
 * sinon le plus ancien chassis encore en stock (date d'entree, puis creation).
 */
export function chassisForSale(rows: ReadonlyArray<ChassisRow>, documentVehicleId?: string | null): { id: string; rule: 'unique' | 'document' | 'plus_ancien_en_stock' } | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return { id: rows[0].id, rule: 'unique' };
  if (documentVehicleId && rows.some((r) => r.id === documentVehicleId)) return { id: documentVehicleId, rule: 'document' };
  const candidates = rows
    .filter((r) => { const k = parcKind(r.status); return k === 'en_stock' || k === 'depot_vente'; })
    .slice()
    .sort((a, b) => {
      const ea = a.entry_date ?? '9999-12-31';
      const eb = b.entry_date ?? '9999-12-31';
      if (ea !== eb) return ea < eb ? -1 : 1;
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    });
  return candidates[0] ? { id: candidates[0].id, rule: 'plus_ancien_en_stock' } : null;
}
