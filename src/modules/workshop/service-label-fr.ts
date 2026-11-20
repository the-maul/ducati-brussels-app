/**
 * Libellé d'entretien lisible (défaut vu au test écran du 20/11/2026) : les plans d'entretien
 * Ducati arrivent en anglais (« Annual Service / Service Temporel », « Oil Service », « Desmo
 * Service / Valve Check »…) et s'affichaient tels quels, en majuscules, dans le parcours guidé
 * ouvert depuis Mon atelier et sur la fiche OR. Seul l'AFFICHAGE est traduit (dictionnaire i18n) ;
 * la donnée (repair_order_plan_operations.service_label, clé de rapprochement avec le manuel)
 * ne change pas. Testé dans tests/vp-g8.test.ts.
 */
import { t } from '@/lib/i18n';

/** Expressions anglaises connues → clé du dictionnaire (les plus longues d'abord). */
const PHRASES: ReadonlyArray<[RegExp, string]> = [
  [/1er entretien\s*\(\s*first service\s*\/\s*oil service 1\s?000\s*\)/gi, 'vpG8.serviceFirst'],
  [/annual service\s*\/\s*service temporel/gi, 'vpG8.serviceAnnual'],
  [/desmo service\s*\/\s*valve check/gi, 'vpG8.serviceDesmo'],
  [/first service(\s*\/\s*oil service)?\s*1\s?000/gi, 'vpG8.serviceFirst'],
  [/oil service\s*1\s?000/gi, 'vpG8.serviceFirst'],
  [/annual service/gi, 'vpG8.serviceAnnual'],
  [/service temporel/gi, 'vpG8.serviceAnnual'],
  [/desmo service/gi, 'vpG8.serviceDesmo'],
  [/valve check/gi, 'vpG8.serviceValve'],
  [/(kilom[ée]trique\s+)?oil service/gi, 'vpG8.serviceOil'],
  [/kilom[ée]trique\s+oil/gi, 'vpG8.serviceOil'],
  [/service check/gi, 'vpG8.serviceCheck'],
];

/** « Annual Service / Service Temporel + Oil Service » → « Entretien annuel + Entretien vidange ». */
export function serviceLabelDisplay(label: string | null | undefined): string {
  let out = (label ?? '').trim();
  if (!out) return '';
  for (const [re, key] of PHRASES) out = out.replace(re, () => t(key));
  return out;
}
