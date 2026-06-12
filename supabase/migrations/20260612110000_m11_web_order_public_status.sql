-- =====================================================================
-- M11 — Statut PUBLIC d'une commande web (pour la page de retour Stripe).
-- Le client revient sur /shop/{slug}?paid=1&order=<id> : le storefront (anon) doit
-- pouvoir confirmer que la commande est bien passée « payée » côté serveur (webhook).
-- On n'expose QUE le numéro + le statut (aucune donnée perso), par id de commande.
-- =====================================================================

create or replace function public.web_order_public_status(_order uuid)
returns table(number text, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select number, status from public.web_orders where id = _order;
$$;
grant execute on function public.web_order_public_status(uuid) to anon, authenticated;
