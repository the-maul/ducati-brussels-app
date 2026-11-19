/**
 * M8 — Taux horaire de la main-d'oeuvre POUR UN CLIENT (decision Q48 du 18/11/2026, comme G8).
 *
 * Taux standard : Parametres -> Tables -> Frais de devis atelier (DIAGNOSTIC, `hourly_rate_ht`,
 * 109,74 HT), lu par `loadHourlyRateHt`. Taux d'un client : le MOTEUR DE TARIFS existant
 * (`CustomerPricer`, lot regles client) applique a l'article MO (type T) : le tarif client « VIP »
 * (migration 20261119192000) en fixe le prix net a 90,00 HT. Aucun second mecanisme de tarifs.
 * Seule une ligne de tarif qui vise l'article MO lui-meme change le taux : une remise generale
 * (ex. « REMISE 15 % » sur tout le catalogue, reprise de G8) ne touche pas la main-d'oeuvre (a trancher).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CustomerPricer } from '@/modules/sales/customer-pricing-api';
import type { ResolvedSalePrice } from '@/modules/sales/customer-pricing';

/** Taux a appliquer : le prix net du tarif client s'il vise l'article MO, sinon le taux standard. */
export function clientLabourRate(standardHt: number | null | undefined, resolved: Pick<ResolvedSalePrice, 'rule' | 'netHt'> | null | undefined): number | null {
  const std = Number(standardHt);
  const base = Number.isFinite(std) && std > 0 ? std : null;
  if (resolved?.rule && resolved.rule.scope === 'reference' && resolved.netHt > 0) return Math.round(resolved.netHt * 100) / 100;
  return base;
}

/** Article MO (main-d'oeuvre, type T) de la societe ; null s'il n'existe pas. */
export async function loadMoArticleId(companyId: string): Promise<string | null> {
  const { data } = await supabase.from('articles').select('id')
    .eq('company_id', companyId).eq('reference', 'MO').eq('mgmt_type', 'T').order('created_at').limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Taux horaire du client de l'ecran (taux standard tant qu'il n'y a pas de client ou de tarif MO). */
export function useClientLabourRate(companyId: string, pricer: CustomerPricer, standardHt: number | null, contactKey: string | null): number | null {
  const moQ = useQuery({ queryKey: ['mo-article', companyId], queryFn: () => loadMoArticleId(companyId), staleTime: 600_000 });
  const q = useQuery({
    queryKey: ['client-labour-rate', companyId, contactKey, moQ.data, standardHt],
    enabled: !!contactKey && !!moQ.data && standardHt != null,
    queryFn: async () => clientLabourRate(standardHt, await pricer.price(moQ.data!, standardHt ?? 0, 1)),
    staleTime: 60_000,
  });
  return contactKey && q.data !== undefined ? q.data : standardHt;
}
