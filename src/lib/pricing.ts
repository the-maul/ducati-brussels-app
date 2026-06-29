/**
 * M2 — Prix de vente « effectif » (arrondi catalogue).
 *
 * Règle société `round_sale_prices_up` (CLAUDE.md §1.3, réglage par société) :
 * arrondir le prix de vente catalogue à l'euro SUPÉRIEUR, avec un plancher à 2 €
 * (9,20 → 10 ; 1,30 → 2). C'est un arrondi **calculé à l'usage**, JAMAIS écrit en
 * base : le prix d'origine reste la source de vérité, donc décocher le réglage
 * restaure instantanément les prix précis partout (aucune migration destructive).
 *
 * Les remises/tarifs client s'appliquent ENSUITE sur ce prix arrondi (décision
 * client : on n'arrondit que le prix catalogue de base, pas le prix après remise).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Arrondi à l'euro supérieur, plancher 2 € (ex. 9,2 → 10 ; 1,3 → 2 ; 0 → 0). */
export const roundUpEuro = (p: number): number => (p > 0 ? Math.max(2, Math.ceil(p - 1e-9)) : p);

/** Prix de vente TTC effectif : arrondi si le réglage société est actif, sinon le prix précis. */
export function effectiveSaleTtc(rawTtc: number | null | undefined, roundUp: boolean): number {
  const ttc = Number(rawTtc ?? 0);
  return roundUp ? roundUpEuro(ttc) : ttc;
}

/**
 * Prix de vente HT effectif. L'arrondi porte sur le TTC (montant payé) ; le HT en
 * découle, donc il garde des décimales par construction (10,00 TTC → 8,26 HT à 21 %).
 */
export function effectiveSaleHt(rawHt: number | null | undefined, vatRate: number | null | undefined, roundUp: boolean): number {
  const ht = Number(rawHt ?? 0);
  if (!roundUp || !(ht > 0)) return ht;
  const vf = 1 + (Number(vatRate ?? 0)) / 100;
  return Math.round((roundUpEuro(ht * vf) / vf) * 100) / 100;
}

/**
 * Réglage société « arrondir les prix de vente » (défaut : activé). Mis en cache ;
 * la clé est partagée avec la fiche article et l'écran société.
 */
export function useRoundSalePrices(companyId?: string | null): boolean {
  const { data } = useQuery({
    queryKey: ['company-round-prices', companyId],
    queryFn: async () => (await supabase.from('companies').select('round_sale_prices_up').eq('id', companyId!).maybeSingle()).data,
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
  return data?.round_sale_prices_up ?? true;
}
