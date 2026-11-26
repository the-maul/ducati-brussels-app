/**
 * M8 — Pièces du kit sur la fiche moto (ATE014) : règles pures du bloc « Pièces du kit ».
 * Les lignes viennent de `serviceKitRows` (kit-from-appointment.ts), la même lecture que l'OR créé
 * depuis un RDV ; le stock vient du détail du kit (`maintenance_kit_detail`).
 */
import { isServiceCode, SERVICE_CODES, type ServiceCode } from '../service-code';
import { fmtQty } from './rules';

/** Entretien montré à l'ouverture : celui qui est dû ; une échéance au km seul → entretien annuel. */
export function defaultServiceForDue(kind: string | null | undefined): ServiceCode {
  return isServiceCode(kind) ? kind : 'annual';
}

/** Les entretiens du sélecteur, l'entretien dû en premier. */
export function serviceChoices(due: ServiceCode): ServiceCode[] {
  return [due, ...SERVICE_CODES.filter((c) => c !== due)];
}

/** Quantité lisible, avec l'unité quand la ligne en a une (huile : « 3,4 l », forfait : « 1,8 h »). */
export function kitQtyLabel(quantity: number | string, unit: string | null | undefined): string {
  const q = fmtQty(Number(quantity) || 0);
  const u = (unit ?? '').trim();
  return u ? `${q} ${u}` : q;
}

/** Les kits d'où viennent les lignes, dans l'ordre d'apparition (annuel + huile = deux kits). */
export function distinctKitIds(rows: { kit_id: string | null }[]): string[] {
  const out: string[] = [];
  for (const r of rows) if (r.kit_id && !out.includes(r.kit_id)) out.push(r.kit_id);
  return out;
}

/** Disponible = réel − réservé (B4), seulement pour une pièce stockée (type A) ; sinon rien à montrer. */
export function availableQty(d: { mgmtType: string | null; realQty: number; reservedQty: number } | null | undefined): number | null {
  if (!d || d.mgmtType !== 'A') return null;
  return d.realQty - d.reservedQty;
}
