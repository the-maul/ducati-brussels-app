/**
 * M11 — E-shop : catalogue produits (stock unifié avec le magasin). Lit les articles
 * publiables, leur stock disponible et leur 1re photo (GED). Publication = flag
 * `publishable` sur l'article.
 */
import { supabase } from '@/integrations/supabase/client';
import { listStock } from '@/modules/stock/stock-api';

export type ShopItem = {
  article_id: string; reference: string; designation: string; mgmt_type: string;
  price_ttc: number; publishable: boolean; available: number; image_path: string | null;
};

export async function listShop(companyId: string): Promise<ShopItem[]> {
  const [{ data: arts, error }, stock, { data: imgs }] = await Promise.all([
    supabase.from('articles').select('id, reference, designation, sale_price_ttc, publishable, mgmt_type').eq('company_id', companyId).order('reference').limit(500),
    listStock(companyId),
    supabase.from('attachments').select('entity_id, storage_path, content_type, created_at')
      .eq('company_id', companyId).eq('entity_type', 'article').order('created_at', { ascending: true }),
  ]);
  if (error) throw error;
  const availByArt = new Map(stock.map((s) => [s.article_id, s.available_qty]));
  const imgByArt = new Map<string, string>();
  for (const im of imgs ?? []) {
    if (im.content_type?.startsWith('image/') && !imgByArt.has(im.entity_id)) imgByArt.set(im.entity_id, im.storage_path);
  }
  return (arts ?? []).map((a) => ({
    article_id: a.id, reference: a.reference, designation: a.designation, mgmt_type: a.mgmt_type as string,
    price_ttc: Number(a.sale_price_ttc ?? 0), publishable: !!a.publishable,
    available: Number(availByArt.get(a.id) ?? 0), image_path: imgByArt.get(a.id) ?? null,
  }));
}

export async function setPublishable(articleId: string, value: boolean): Promise<void> {
  const { error } = await supabase.from('articles').update({ publishable: value }).eq('id', articleId);
  if (error) throw error;
}

// ---- Réglages boutique ----
export type ShopSettings = Database['public']['Tables']['shop_settings']['Row'];
export async function getShopSettings(companyId: string): Promise<ShopSettings | null> {
  const { data, error } = await supabase.from('shop_settings').select('*').eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}
export type ShopPatch = Partial<Pick<ShopSettings, 'name' | 'slug' | 'custom_domain' | 'description' | 'hero_text' | 'theme_color' | 'phone' | 'email' | 'address' | 'published'>>;
export async function saveShopSettings(companyId: string, patch: ShopPatch): Promise<void> {
  const { error } = await supabase.from('shop_settings').upsert({ company_id: companyId, ...patch });
  if (error) throw error;
}

// ---- Commandes web ----
export type WebOrder = Database['public']['Tables']['web_orders']['Row'];
export type CartLine = { article_id: string; designation: string; quantity: number; unit_price_ttc: number };

export async function listWebOrders(companyId: string): Promise<WebOrder[]> {
  const { data, error } = await supabase.from('web_orders').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

/** Crée une commande web + réserve le stock (disponible) — paiement à brancher (Stripe). */
export async function createWebOrder(companyId: string, customer: { name: string; email?: string; phone?: string; address?: string }, lines: CartLine[]): Promise<string> {
  const total = lines.reduce((s, l) => s + l.quantity * l.unit_price_ttc, 0);
  const { data: order, error } = await supabase.from('web_orders').insert({
    company_id: companyId, customer_name: customer.name, email: customer.email ?? null, phone: customer.phone ?? null,
    address: customer.address ?? null, status: 'en_attente_paiement', total_ttc: Math.round(total * 100) / 100,
  }).select('id').single();
  if (error) throw error;
  const orderId = order.id as string;
  const rows = lines.map((l) => ({ order_id: orderId, article_id: l.article_id, designation: l.designation, quantity: l.quantity, unit_price_ttc: l.unit_price_ttc, line_ttc: Math.round(l.quantity * l.unit_price_ttc * 100) / 100 }));
  await supabase.from('web_order_lines').insert(rows);
  // Réservation de stock (disponible), append-only B4/B7
  for (const l of lines) {
    if (l.quantity <= 0) continue;
    await supabase.rpc('record_stock_move', { _article: l.article_id, _type: 'reservation', _qty: Math.abs(l.quantity), _unit_cost: null, _is_reservation: true, _bin: null, _origin: 'eshop', _ref: orderId, _note: 'Commande web' });
  }
  return orderId;
}

export async function setWebOrderStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from('web_orders').update({ status }).eq('id', id);
  if (error) throw error;
}
