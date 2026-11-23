/**
 * « Données DCS » block of the bike record (VEH001): what was read, with its status, in the three
 * columns of the Ducati portal. Pure functions, no database: tests/dcs-block-rules.test.ts.
 */
import { dcsText, parseDcsKm, type DcsClientSnapshot, type DcsFieldStatus } from '@/lib/dcs-rules';
import { ducatiCommercialName } from '@/lib/vin-identify';

export type DcsFieldRow = {
  field: string; status: DcsFieldStatus; dcs_value: string | null; previous_value: string | null;
  source: string | null; updated_at?: string | null;
};
export type DcsClientRow = DcsClientSnapshot & { read_at?: string | null };
export type DcsRowKind = 'text' | 'mono' | 'date' | 'km';
export type DcsBlockRow = {
  key: string; labelKey: string; value: string | null; kind: DcsRowKind;
  status: DcsFieldStatus | null; sheet: string | null;
};
export type DcsBlockColumns = { moto: DcsBlockRow[]; warranty: DcsBlockRow[]; client: DcsBlockRow[] };

/** Fields a user can settle from the block. */
export const DCS_RESOLVABLE = ['plate', 'mileage', 'color', 'model', 'owner'] as const;
export type DcsResolvable = (typeof DCS_RESOLVABLE)[number];
export const isDcsResolvable = (f: string): f is DcsResolvable => (DCS_RESOLVABLE as readonly string[]).includes(f);

const asRecord = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const asText = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

type Def = { key: string; labelKey: string; kind?: DcsRowKind };

const MOTO_FIELDS: Def[] = [
  { key: 'model', labelKey: 'dossier.dcsBlockFModel' },
  { key: 'plate', labelKey: 'dossier.dcsBlockFPlate', kind: 'mono' },
  { key: 'engine_number', labelKey: 'dossier.dcsBlockFEngine', kind: 'mono' },
  { key: 'mileage', labelKey: 'dossier.dcsBlockFKm', kind: 'km' },
  { key: 'color', labelKey: 'dossier.dcsBlockFColor' },
  { key: 'ducati_state', labelKey: 'dossier.dcsBlockFState' },
  { key: 'ducati_usage', labelKey: 'dossier.dcsBlockFUsage' },
  { key: 'production_date', labelKey: 'dossier.dcsBlockFProduction', kind: 'date' },
  { key: 'ship_date', labelKey: 'dossier.dcsBlockFShip', kind: 'date' },
  { key: 'invoiced_to', labelKey: 'dossier.dcsBlockFInvoiced' },
  { key: 'origin', labelKey: 'dossier.dcsBlockFOrigin' },
];
const WARRANTY_FIELDS: Def[] = [
  { key: 'warranty_type', labelKey: 'dossier.dcsBlockFWType' },
  { key: 'warranty_state', labelKey: 'dossier.dcsBlockFWState' },
  { key: 'warranty_start', labelKey: 'dossier.dcsBlockFWStart', kind: 'date' },
  { key: 'warranty_end', labelKey: 'dossier.dcsBlockFWEnd', kind: 'date' },
  { key: 'warranty_activated_by', labelKey: 'dossier.dcsBlockFWBy' },
];
const CLIENT_FIELDS: Array<Def & { from: keyof DcsClientSnapshot }> = [
  { key: 'owner', from: 'full_name', labelKey: 'dossier.dcsBlockFName' },
  { key: 'ducati_code', from: 'ducati_code', labelKey: 'dossier.dcsBlockFCode', kind: 'mono' },
  { key: 'email', from: 'email', labelKey: 'dossier.dcsBlockFEmail' },
  { key: 'mobile', from: 'mobile', labelKey: 'dossier.dcsBlockFMobile', kind: 'mono' },
  { key: 'address', from: 'address', labelKey: 'dossier.dcsBlockFAddress' },
  { key: 'postal_code', from: 'postal_code', labelKey: 'dossier.dcsBlockFZip', kind: 'mono' },
  { key: 'city', from: 'city', labelKey: 'dossier.dcsBlockFCity' },
  { key: 'region', from: 'region', labelKey: 'dossier.dcsBlockFRegion' },
  { key: 'country', from: 'country', labelKey: 'dossier.dcsBlockFCountry' },
  { key: 'birth_date', from: 'birth_date', labelKey: 'dossier.dcsBlockFBirth', kind: 'date' },
];

/** The block's three columns. Only values really read are listed. */
export function dcsBlockColumns(
  vehicle: Record<string, unknown>,
  statuses: DcsFieldRow[],
  client: DcsClientRow | null,
  ownerName: string | null = null,
): DcsBlockColumns {
  const byField = new Map(statuses.map((s) => [s.field, s]));
  const raw = asRecord(vehicle.my_ducati_data);
  const header = asRecord(raw.header);
  const rawVehicle = asRecord(raw.vehicle);

  const fieldRow = (d: Def): DcsBlockRow => {
    const st = byField.get(d.key);
    const fromRaw = d.key === 'mileage' ? asText(parseDcsKm(rawVehicle.last_km)) : dcsText(rawVehicle[d.key]);
    return {
      key: d.key, labelKey: d.labelKey, kind: d.kind ?? 'text',
      value: st?.dcs_value ?? fromRaw, status: st?.status ?? null, sheet: asText(vehicle[d.key]),
    };
  };
  // Portal header values exist only at the DCS: nothing to compare them with.
  const readOnly = (key: string, labelKey: string, value: unknown): DcsBlockRow =>
    ({ key, labelKey, kind: 'text', value: dcsText(value), status: 'certifie', sheet: null });

  const moto = [
    readOnly('title', 'dossier.dcsBlockFTitle', header.title ?? header.descriptor),
    readOnly('year', 'dossier.dcsBlockFYear', header.year),
    readOnly('market', 'dossier.dcsBlockFMarket', header.market),
    ...MOTO_FIELDS.map(fieldRow),
  ].filter((r) => r.value !== null);

  const warranty = [
    ...WARRANTY_FIELDS.map(fieldRow),
    readOnly('warranty_age', 'dossier.dcsBlockFWAge', rawVehicle.warranty_age),
  ].filter((r) => r.value !== null);

  const ownerStatus = byField.get('owner');
  const clientRows = client
    ? CLIENT_FIELDS.map((d): DcsBlockRow => ({
      key: d.key, labelKey: d.labelKey, kind: d.kind ?? 'text', value: asText(client[d.from]),
      status: d.key === 'owner' ? ownerStatus?.status ?? 'certifie' : 'certifie',
      sheet: d.key === 'owner' ? ownerName : null,
    })).filter((r) => r.value !== null)
    // Read before the customer was kept: only the name remains, and its difference must stay visible.
    : ownerStatus?.dcs_value
      ? [{ key: 'owner', labelKey: 'dossier.dcsBlockFName', kind: 'text' as const, value: ownerStatus.dcs_value, status: ownerStatus.status, sheet: ownerName }]
      : [];
  return { moto, warranty, client: clientRows };
}

/** Number of differences still to settle (model-year goes with the model). */
export function dcsOpenConflicts(statuses: DcsFieldRow[]): number {
  return statuses.filter((s) => s.status === 'conflit' && s.field !== 'ducati_model_year_id').length;
}

export const dcsCatalogFields = (statuses: DcsFieldRow[]): string[] =>
  statuses.filter((s) => s.status === 'catalogue').map((s) => s.field);

export type DcsClientSituation = 'none' | 'same' | 'no_owner' | 'other' | 'settled';

/** What the Client column has to offer. */
export function dcsClientSituation(client: DcsClientRow | null, ownerStatus: DcsFieldRow | undefined, currentOwnerId: string | null): DcsClientSituation {
  if (!client) return 'none';
  if (!currentOwnerId) return 'no_owner';
  if (ownerStatus?.status === 'certifie') return 'same';
  if (ownerStatus?.status === 'saisi') return 'settled';
  return 'other';
}

export type DcsIdentityCandidate = {
  model_year_id: string; family?: string | null; supermodel?: string | null;
  model?: string | null; name?: string | null; year?: number | null;
};
export type DcsModelChoice = { id: string; label: string; year: number | null };

/** Versions to choose from: only the ones recorded when the DCS title could not settle it. */
export function dcsModelChoices(status: DcsFieldRow | undefined, candidates: DcsIdentityCandidate[]): DcsModelChoice[] {
  const ids = (status?.dcs_value ?? '').split(',').filter(Boolean);
  return ids.flatMap((id) => {
    const c = candidates.find((x) => x.model_year_id === id);
    if (!c) return [];
    const label = ducatiCommercialName(c.family ?? null, c.supermodel ?? null, c.model ?? c.name ?? null) || c.name || '';
    return label ? [{ id, label, year: c.year ?? null }] : [];
  });
}

export type DcsEventLike = { kind?: string | null; event_date?: string | null; due_date?: string | null };
export const DCS_EVENT_KINDS = ['upcoming', 'current', 'past'] as const;
export type DcsEventKind = (typeof DCS_EVENT_KINDS)[number];

const byDate = (key: 'event_date' | 'due_date', dir: 1 | -1) => <T extends DcsEventLike>(a: T, b: T) => {
  const x = a[key] ?? '';
  const y = b[key] ?? '';
  if (!x || !y) return x ? -1 : y ? 1 : 0; // no date: last
  return x === y ? 0 : x < y ? -dir : dir;
};

/** The three DCS tables: next due first for upcoming, most recent first otherwise. */
export function groupDcsEvents<T extends DcsEventLike>(rows: T[]): Array<{ kind: DcsEventKind; rows: T[] }> {
  return DCS_EVENT_KINDS.map((kind) => {
    const list = rows.filter((r) => (DCS_EVENT_KINDS as readonly string[]).includes(r.kind ?? '') ? r.kind === kind : kind === 'past');
    return { kind, rows: [...list].sort(kind === 'upcoming' ? byDate('due_date', 1) : byDate('event_date', -1)) };
  }).filter((g) => g.rows.length > 0);
}

export type DcsEventTone = 'info' | 'warning' | 'success' | 'neutral';
/** Event family as shown by the DCS: Maintenance, Garantie, Checklist. */
export function dcsEventFamily(category: string | null | undefined): { family: 'maintenance' | 'warranty' | 'checklist' | 'other'; tone: DcsEventTone } {
  const c = String(category ?? '').trim().toLowerCase();
  if (c === 'maintenance') return { family: 'maintenance', tone: 'info' };
  if (c === 'garantie' || c === 'warranty') return { family: 'warranty', tone: 'warning' };
  if (c === 'checklist') return { family: 'checklist', tone: 'success' };
  return { family: 'other', tone: 'neutral' };
}
