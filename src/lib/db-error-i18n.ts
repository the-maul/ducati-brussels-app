/**
 * Messages de la base traduits dans la langue de l'écran (décisions Q63, Q64, Q67 du 20/11/2026).
 * Les déclencheurs posent un `hint` stable et les valeurs utiles dans `details` :
 *  - contact_identity_required : champs manquants « civility,last_name,first_name,company_name » ;
 *  - mileage_lower : le dernier relevé (km) ;
 *  - operator_unknown / operator_locked : opérateur refusé ;
 *  - repair_order_required / cession_required (VP8) : champs manquants « operator,contact,vehicle » / « type,operator,vehicle ».
 * Sans hint connu : null (le message d'origine est gardé).
 */
import { t, fillVars } from '@/lib/i18n';
import { orRequiredMessage, cessionRequiredMessage } from '@/modules/workshop/required-g8';

const FIELD_KEYS: Record<string, string> = {
  civility: 'q67.civility', last_name: 'q67.lastName', first_name: 'q67.firstName', company_name: 'q67.companyName',
};

/** Champs manquants (codes de la base) → libellés, dans l'ordre G8 : Civilité, Prénom, Nom. */
export function identityFieldsLabel(codes: ReadonlyArray<string>): string {
  const order = ['civility', 'first_name', 'last_name', 'company_name'];
  return [...codes].filter((c) => FIELD_KEYS[c]).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((c) => t(FIELD_KEYS[c])).join(', ');
}

export function translateDbError(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const o = err as { hint?: unknown; details?: unknown };
  const hint = typeof o.hint === 'string' ? o.hint : '';
  const details = typeof o.details === 'string' ? o.details.trim() : '';
  switch (hint) {
    case 'contact_identity_required':
      return fillVars(t('q67.errRequired'), { fields: identityFieldsLabel(details.split(',')) });
    case 'mileage_lower':
      return fillVars(t('q64.errLowerShort'), { last: Number(details || 0).toLocaleString('fr-BE') });
    case 'operator_unknown':
      return t('q63.errUnknown');
    case 'operator_locked':
      return t('q63.errLocked');
    case 'repair_order_required':
      return orRequiredMessage(details.split(','));
    case 'cession_required':
      return cessionRequiredMessage(details.split(','));
    default:
      return null;
  }
}
