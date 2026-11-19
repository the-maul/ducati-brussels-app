/**
 * M8 — Decision du client Q49 (18/11/2026) : l'OR cree depuis un RDV d'entretien recoit TOUTES les
 * lignes du kit d'entretien choisi (pieces, liquides, DDS, controles, petites fournitures, CONTRI,
 * MO). Reutilise la fonction d'insertion de kit existante (insert-rules.ts, kitInsertLines, mode
 * detail) ; les kits sont lus par `workshop_service_kit_lines` (meme choix et meme fusion que la
 * reservation, migration 20261119193000). Les prix passent par LA fonction de prix des lignes d'OR
 * (or-line-pricing.ts, repriceOrLines → priceOrLine) : tarif du client, MO au taux du client (Q48 :
 * standard 109,74 HT, tarif « VIP » 90,00 HT). Pas de nouvelle reservation : celle du RDV suit l'OR
 * (base). Sans moto, sans entretien ou sans la migration : aucune ligne.
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import { CustomerPricer, type PricingContact } from '@/modules/sales/customer-pricing-api';
import { loadHourlyRateHt } from '../maintenance-api';
import { repriceOrLines } from '../or-line-pricing';
import { articleBasePrices } from '../or-line-pricing-api';
import { serviceLabelKey, type ServiceCode } from '../service-code';
import type { RoLineInput } from '../write-api';
import { pricedArticles } from './insert-api';
import { kitInsertLines, toRoLine, type KitComponent } from './insert-rules';

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
// `.bind` obligatoire (19/11) : detache de son client, `supabase.rpc` levait une TypeError avalee par
// le `.catch(() => [])` du planning : l'OR ne recevait jamais les lignes du kit (Q49).
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;

type KitLineRow = { article_id: string | null; reference: string | null; designation: string; quantity: number | string };

/** Lignes d'OR du kit d'entretien de la moto pour cet entretien (vide si rien a inserer). */
export async function serviceKitOrLines(p: {
  companyId: string; vehicleId: string; serviceCode: ServiceCode; contactId: string | null;
}): Promise<RoLineInput[]> {
  const { data, error } = await rpc('workshop_service_kit_lines', { _vehicle: p.vehicleId, _service: p.serviceCode });
  if (error) return [];
  const rows = (data ?? []) as KitLineRow[];
  if (!rows.length) return [];
  const components: KitComponent[] = rows.map((r) => ({
    articleId: r.article_id, reference: r.reference, designation: r.designation, quantity: Number(r.quantity) || 0,
  }));
  const [articles, rate, round, contact] = await Promise.all([
    pricedArticles(components.map((c) => c.articleId ?? '')),
    loadHourlyRateHt(p.companyId).catch(() => null),
    supabase.from('companies').select('round_sale_prices_up').eq('id', p.companyId).maybeSingle()
      .then((r) => ((r.data as { round_sale_prices_up?: boolean | null } | null)?.round_sale_prices_up ?? true)),
    p.contactId
      ? supabase.from('contacts').select('id, company_id, price_list, price_list_id, show_discounts_pos').eq('id', p.contactId).maybeSingle()
        .then((r) => (r.data as PricingContact | null) ?? null)
      : Promise.resolve(null),
  ]);
  const lines = kitInsertLines({
    title: `${t('parcG8.kitLineTitle')} ${t(serviceLabelKey(p.serviceCode))} (${t('orBase.kitAuto_fromAppointment')})`,
    components, articles, mode: 'detail', labourRateHt: rate,
  }).map(toRoLine);
  if (!contact) return lines;
  try {
    const bases = { articleBaseHt: await articleBasePrices(lines.map((l) => l.article_id ?? '').filter(Boolean), round), labourRateHt: rate };
    return (await repriceOrLines(lines, new CustomerPricer(p.companyId, contact), bases)).lines;
  } catch {
    return lines;
  }
}
