/**
 * M8 — Q59 (20/11/2026) : la fonction de prix des lignes d'un OR hors de son editeur (parcours
 * guide, bloc des operations, Mon atelier). « Reserver » y ajoute aussi la ligne a l'OR : elle
 * doit etre chiffree comme dans l'editeur — LA fonction priceOrLine, tarif du client ou de
 * l'assureur sur un OR accident (T4), arrondi de la societe. Rien n'est recalcule autrement.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { effectiveSaleHt, useRoundSalePrices } from '@/lib/pricing';
import { getContact } from '@/modules/contacts/api';
import { orInsurerTariff, useCustomerPricer, type PricingContact } from '@/modules/sales/customer-pricing-api';
import type { OrLinePricer } from '@/modules/workshop/or-line-pricing';

type Ctx = { contact: PricingContact | null; insurerList: string | null };

async function loadPricingContext(orId: string): Promise<Ctx> {
  const sb = supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> } } } };
  const { data } = await sb.from('repair_orders').select('contact_id').eq('id', orId).maybeSingle();
  const contactId = (data as { contact_id: string | null } | null)?.contact_id ?? null;
  const [contact, insurer] = await Promise.all([
    contactId ? getContact(contactId).catch(() => null) : Promise.resolve(null),
    orInsurerTariff(orId).catch(() => null),
  ]);
  return { contact: (contact as PricingContact | null) ?? null, insurerList: insurer ? (insurer.listId ?? insurer.code) : null };
}

/** Pricer de l'OR (null tant que le client de l'OR n'est pas lu, ou sans OR). */
export function useOrLinePricer(companyId: string, orId: string | null, enabled = true): { pricer: OrLinePricer | null; effectiveHt: (ht: number, vat: number) => number } {
  const ctx = useQuery({
    queryKey: ['or-pricing-context', orId], queryFn: () => loadPricingContext(orId as string),
    enabled: enabled && !!orId, staleTime: 60_000,
  });
  const pricer = useCustomerPricer(companyId, ctx.data?.contact ?? null, ctx.data?.insurerList ?? null);
  const roundUp = useRoundSalePrices(companyId);
  return { pricer: ctx.isSuccess ? pricer : null, effectiveHt: (ht, v) => effectiveSaleHt(ht, v, roundUp) };
}
