/**
 * A trade-in request on a bike already in the DMS reuses its record (Simon, 26/11/2026):
 * one VIN = one record. Pure rules, tested in tests/reprise-vehicle-rules.test.ts.
 */

/** Statuses of a bike that is a customer's bike: the trade-in can take over its record. */
const CUSTOMER_BIKE = new Set(['vendu', 'livre']);

export type ExistingBike = { id: string; status: string | null; created_at?: string | null; openReprise: boolean };

export type RepriseVehicleChoice =
  | { kind: 'create' }
  | { kind: 'reuse'; id: string }
  | { kind: 'refuse'; status: string; id: string };

/**
 * No record: a new one. Customer bike (sold, delivered, or a closed trade-in): its record.
 * A bike still in the shop's hands (stock, order, consignment, demo...) or with a trade-in in
 * progress: refused, the user opens that record. Several records already (old duplicates): the
 * oldest one, which carries the history.
 */
export function repriseVehicleChoice(existing: ExistingBike[]): RepriseVehicleChoice {
  if (existing.length === 0) return { kind: 'create' };
  const sorted = [...existing].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const busy = sorted.find((v) => v.openReprise || !(v.status === null || CUSTOMER_BIKE.has(v.status) || v.status === 'repris'));
  if (busy) return { kind: 'refuse', status: busy.openReprise ? 'repris' : String(busy.status), id: busy.id };
  return { kind: 'reuse', id: sorted[0].id };
}

/** Identity fields of the record: only the empty ones are filled by the trade-in. */
export function repriseFillPatch(current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null || v === undefined || v === '') continue;
    const cur = current[k];
    if (cur === null || cur === undefined || cur === '') patch[k] = v;
  }
  // The mileage declared for the trade-in is newer than an old reading, never lower.
  const km = incoming.mileage;
  if (typeof km === 'number' && (typeof current.mileage !== 'number' || km > current.mileage)) patch.mileage = km;
  return patch;
}
