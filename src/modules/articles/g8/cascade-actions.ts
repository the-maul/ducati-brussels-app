/**
 * M2 — Rattrapage G8 (18/11/2026) : actions de la « Modification cascade Art/Lib ».
 *
 * G8 « Modifier ensemble » propose 24 actions. Le DMS les exécute en base
 * (`article_cascade_apply`, par lots de 500) : les prix passent par la trace price_changes
 * (origine « cascade »), les autres champs laissent une ligne events par article.
 * « Changer de nomenclature » relève du lot kits (non traité ici).
 */

export type CascadeInput =
  | 'none' | 'text' | 'longtext' | 'number' | 'percent' | 'family' | 'supplier'
  | 'container' | 'minmax' | 'mgmt' | 'vat';

export type CascadeActionDef = {
  key: string;
  /** clé i18n du libellé (bloc g8a.cascade) */
  label: string;
  input: CascadeInput;
  /** touche un prix : passe par price_changes */
  price?: boolean;
  /** action d'un autre circuit (librairie, suppression) */
  special?: 'library_in' | 'library_out' | 'delete';
};

export const CASCADE_ACTIONS: CascadeActionDef[] = [
  { key: 'doc_visible_on', label: 'g8a.cascade.act_doc_visible_on', input: 'none' },
  { key: 'doc_visible_off', label: 'g8a.cascade.act_doc_visible_off', input: 'none' },
  { key: 'pv_from_ppc', label: 'g8a.cascade.act_pv_from_ppc', input: 'none', price: true },
  { key: 'ppc_from_pv', label: 'g8a.cascade.act_ppc_from_pv', input: 'none', price: true },
  { key: 'lock_designation', label: 'g8a.cascade.act_lock_designation', input: 'none' },
  { key: 'unlock_designation', label: 'g8a.cascade.act_unlock_designation', input: 'none' },
  { key: 'lock_purchase', label: 'g8a.cascade.act_lock_purchase', input: 'none' },
  { key: 'unlock_purchase', label: 'g8a.cascade.act_unlock_purchase', input: 'none' },
  { key: 'lock_sale', label: 'g8a.cascade.act_lock_sale', input: 'none' },
  { key: 'unlock_sale', label: 'g8a.cascade.act_unlock_sale', input: 'none' },
  { key: 'set_bin', label: 'g8a.cascade.act_set_bin', input: 'text' },
  { key: 'set_pack_qty', label: 'g8a.cascade.act_set_pack_qty', input: 'number' },
  { key: 'set_color', label: 'g8a.cascade.act_set_color', input: 'text' },
  { key: 'set_descriptif', label: 'g8a.cascade.act_set_descriptif', input: 'longtext' },
  { key: 'set_family', label: 'g8a.cascade.act_set_family', input: 'family' },
  { key: 'set_container', label: 'g8a.cascade.act_set_container', input: 'container' },
  { key: 'set_supplier', label: 'g8a.cascade.act_set_supplier', input: 'supplier' },
  { key: 'set_brand', label: 'g8a.cascade.act_set_brand', input: 'text' },
  { key: 'set_stock_min_max', label: 'g8a.cascade.act_set_stock_min_max', input: 'minmax' },
  { key: 'set_price', label: 'g8a.cascade.act_set_price', input: 'number', price: true },
  { key: 'set_size', label: 'g8a.cascade.act_set_size', input: 'text' },
  { key: 'set_vat', label: 'g8a.cascade.act_set_vat', input: 'vat' },
  { key: 'set_mgmt_type', label: 'g8a.cascade.act_set_mgmt_type', input: 'mgmt' },
  { key: 'pv_pct', label: 'g8a.cascade.act_pv_pct', input: 'percent', price: true },
  { key: 'pa_pct', label: 'g8a.cascade.act_pa_pct', input: 'percent', price: true },
  { key: 'coef', label: 'g8a.cascade.act_coef', input: 'number', price: true },
  { key: 'library_in', label: 'g8a.cascade.act_library_in', input: 'none', special: 'library_in' },
  { key: 'library_out', label: 'g8a.cascade.act_library_out', input: 'none', special: 'library_out' },
  { key: 'delete', label: 'g8a.cascade.act_delete', input: 'none', special: 'delete' },
];

export function cascadeAction(key: string): CascadeActionDef | undefined {
  return CASCADE_ACTIONS.find((a) => a.key === key);
}

export type CascadeValue = {
  value?: string; qty?: string; unit?: string; min?: string; max?: string;
};

/** Valeur prête pour `article_cascade_apply`, ou un code d'erreur i18n si la saisie manque. */
export function cascadePayload(def: CascadeActionDef, v: CascadeValue): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const num = (s?: string) => (s ?? '').trim().replace(',', '.');
  switch (def.input) {
    case 'none':
      return { ok: true, value: {} };
    case 'text':
    case 'longtext':
    case 'family':
    case 'supplier':
    case 'mgmt':
      if (def.input !== 'text' && def.input !== 'longtext' && !(v.value ?? '').trim()) return { ok: false, error: 'g8a.cascade.errValue' };
      return { ok: true, value: { value: (v.value ?? '').trim() } };
    case 'number':
    case 'percent':
    case 'vat': {
      const n = Number(num(v.value));
      if (!num(v.value) || !Number.isFinite(n)) return { ok: false, error: 'g8a.cascade.errNumber' };
      return { ok: true, value: { value: String(n) } };
    }
    case 'container':
      return { ok: true, value: { qty: num(v.qty), unit: (v.unit ?? '').trim() } };
    case 'minmax': {
      const min = num(v.min), max = num(v.max);
      if (!min && !max) return { ok: false, error: 'g8a.cascade.errMinMax' };
      if ((min && !Number.isFinite(Number(min))) || (max && !Number.isFinite(Number(max)))) return { ok: false, error: 'g8a.cascade.errNumber' };
      return { ok: true, value: { min, max } };
    }
    default:
      return { ok: false, error: 'g8a.cascade.errValue' };
  }
}
