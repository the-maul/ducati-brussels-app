/**
 * VP8 (20/11/2026, « tout comme G8 ») — champs obligatoires de l'OR et de la cession. Règles PURES,
 * mêmes que la base (migration 20261120344000, déclencheurs trg_repair_orders_aa_required_g8 et
 * trg_icession_aa_required_g8), testées dans tests/vp-g8.test.ts.
 *  - OR : opérateur, client, n° de série (moto) à la création ; ensuite, on ne peut plus retirer
 *    une valeur déjà posée (les anciens OR incomplets restent modifiables).
 *  - Cession ouverte à l'écran : type, opérateur ; moto pour les types qui la demandent
 *    (réglage requires_vehicle du type, 01 Cession VO et 02 Cession VN / Démo par défaut).
 */
import { t, fillVars } from '@/lib/i18n';

export type OrRequiredField = 'operator' | 'contact' | 'vehicle';
export type CessionRequiredField = 'type' | 'operator' | 'vehicle';

export function orMissingFields(p: {
  isNew: boolean;
  saved?: { contactId?: string | null; vehicleId?: string | null; hasOperator?: boolean } | null;
  contactId: string | null | undefined;
  vehicleId: string | null | undefined;
  hasOperator: boolean;
}): OrRequiredField[] {
  const out: OrRequiredField[] = [];
  const s = p.saved ?? {};
  if (!p.hasOperator && (p.isNew || s.hasOperator)) out.push('operator');
  if (!p.contactId && (p.isNew || !!s.contactId)) out.push('contact');
  if (!p.vehicleId && (p.isNew || !!s.vehicleId)) out.push('vehicle');
  return out;
}

export function cessionMissingFields(p: {
  type: string | null | undefined;
  hasOperator: boolean;
  vehicleId: string | null | undefined;
  typeRequiresVehicle: boolean;
}): CessionRequiredField[] {
  const out: CessionRequiredField[] = [];
  if (!(p.type ?? '').trim()) out.push('type');
  if (!p.hasOperator) out.push('operator');
  if (p.typeRequiresVehicle && !p.vehicleId) out.push('vehicle');
  return out;
}

/** Réglage requires_vehicle d'un type de cession (extra de reference_values) ; 01 et 02 à défaut. */
export function cessionTypeRequiresVehicle(code: string | null | undefined, extra?: Record<string, unknown> | null): boolean {
  const v = extra?.requires_vehicle;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === 'oui';
  return code === '01' || code === '02';
}

const FIELD_KEY: Record<string, string> = {
  operator: 'vpG8.fieldOperator', contact: 'vpG8.fieldClient', vehicle: 'vpG8.fieldVehicle', type: 'vpG8.fieldType',
};

/** Libellés des champs manquants (codes de la base « operator,contact,vehicle »), dans l'ordre G8. */
export function requiredFieldsLabel(codes: ReadonlyArray<string>): string {
  const order = ['type', 'operator', 'contact', 'vehicle'];
  return [...new Set(codes)].filter((c) => FIELD_KEY[c]).sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((c) => t(FIELD_KEY[c])).join(', ');
}

export const orRequiredMessage = (codes: ReadonlyArray<string>) => fillVars(t('vpG8.orRequired'), { fields: requiredFieldsLabel(codes) });
export const cessionRequiredMessage = (codes: ReadonlyArray<string>) => fillVars(t('vpG8.cessionRequired'), { fields: requiredFieldsLabel(codes) });
