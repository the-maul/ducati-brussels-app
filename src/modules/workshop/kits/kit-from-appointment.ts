/**
 * M8 — Decision du client Q49 (18/11/2026) : l'OR cree depuis un RDV d'entretien recoit TOUTES les
 * lignes du kit d'entretien choisi (pieces, liquides, DDS, controles, petites fournitures, CONTRI,
 * MO au taux du client Q48). Reutilise la fonction d'insertion de kit existante (insert-rules.ts,
 * kitInsertLines, mode detail) ; les kits sont lus par `workshop_service_kit_lines` (meme choix et
 * meme fusion que la reservation, migration 20261119193000). Pas de nouvelle reservation : celle du
 * RDV suit l'OR (base). Sans moto, sans entretien ou sans la migration : aucune ligne.
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import { CustomerPricer, type PricingContact } from '@/modules/sales/customer-pricing-api';
import { loadHourlyRateHt } from '../maintenance-api';
import { clientLabourRate, loadMoArticleId } from '../labour-rate';
import { serviceLabelKey, type ServiceCode } from '../service-code';
import type { RoLineInput } from '../write-api';
import { pricedArticles } from './insert-api';
import { kitInsertLines, toRoLine, type InsertLine, type KitComponent } from './insert-rules';

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const rpc = supabase.rpc as unknown as Rpc;

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
  const [articles, standard, moId, contact] = await Promise.all([
    pricedArticles(components.map((c) => c.articleId ?? '')),
    loadHourlyRateHt(p.companyId).catch(() => null),
    loadMoArticleId(p.companyId).catch(() => null),
    p.contactId
      ? supabase.from('contacts').select('id, company_id, price_list, price_list_id, show_discounts_pos').eq('id', p.contactId).maybeSingle()
        .then((r) => (r.data as PricingContact | null) ?? null)
      : Promise.resolve(null),
  ]);
  // Taux du client (Q48) : le moteur de tarifs sur l'article MO, sinon le taux standard.
  let rate = standard;
  if (contact && moId && standard != null) {
    rate = clientLabourRate(standard, await new CustomerPricer(p.companyId, contact).price(moId, standard, 1).catch(() => null));
  }
  const lines: InsertLine[] = kitInsertLines({
    title: `${t('parcG8.kitLineTitle')} ${t(serviceLabelKey(p.serviceCode))} (${t('orBase.kitAuto_fromAppointment')})`,
    components, articles, mode: 'detail', labourRateHt: rate,
  });
  return lines.map(toRoLine);
}
