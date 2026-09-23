-- =====================================================================
-- Missions 03 + 06 — Purge de la file « à valider » du rapprochement
--
-- Simon (23/09) : « il faut trouver un moyen de purifier tous ces éléments sans validation
-- humaine, c'est intenable. » Cette migration passe la décision automatique
-- (article_links_autoresolve, migration 20260923140000) sur chaque société et garde le compte
-- avant / après dans events.
--
-- Idempotente : un lien rejeté n'est jamais recréé, un lien relié n'est pas retouché ; un
-- second passage ne change rien.
--
-- Ajoute aussi un contrôle en lecture seule des articles « à compléter » (1 316 pièces Ducati
-- et 127 accessoires / vêtements sans prix) : aucun prix de vente, aucun stock, non stockés.
-- =====================================================================

-- 1. Contrôle des articles « à compléter » (lecture seule) -------------
create or replace function public.articles_a_completer_controle(_company uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with a as (
    select x.id, x.reference, x.is_library, x.sale_price_ttc, x.sale_price_ht, x.ppc_ttc, x.ppc_ht,
           x.to_complete_source,
           regexp_replace(upper(x.reference), '[^A-Z0-9]', '', 'g') as n
      from public.articles x where x.company_id = _company and x.to_complete
  ), f as (
    select a.*,
      case when exists (select 1 from public.ducati_catalog_parts p where p.reference_norm = a.n) then 'piece_ducati'
           when exists (select 1 from public.ducati_catalog_product_variants v where v.sku_norm = a.n) then 'accessoire_vetement'
           when a.reference like 'SHOP-%' then 'produit_site_sans_sku'
           else 'autre' end as famille,
      coalesce(a.sale_price_ttc, 0) <> 0 or coalesce(a.sale_price_ht, 0) <> 0
        or coalesce(a.ppc_ttc, 0) <> 0 or coalesce(a.ppc_ht, 0) <> 0 as a_un_prix,
      coalesce((select sum(m.qty_delta) from public.stock_moves m where m.article_id = a.id), 0) <> 0 as a_du_stock
      from a
  )
  select coalesce(jsonb_object_agg(x.famille, x.d), '{}'::jsonb)
    from (select f.famille,
                 jsonb_build_object('total', count(*),
                                    'sans_aucun_prix', count(*) filter (where not f.a_un_prix),
                                    'non_stocke', count(*) filter (where f.is_library),
                                    'avec_un_prix', count(*) filter (where f.a_un_prix),
                                    'avec_du_stock', count(*) filter (where f.a_du_stock)) as d
            from f group by f.famille) x;
$$;
comment on function public.articles_a_completer_controle(uuid) is
  'Contrôle en lecture seule des articles « à compléter » : combien par famille, combien portent encore un prix ou du stock (doit être 0 pour les pièces Ducati et les accessoires / vêtements).';
revoke all on function public.articles_a_completer_controle(uuid) from public, anon;
grant execute on function public.articles_a_completer_controle(uuid) to authenticated, service_role;

-- 2. Purge : décision automatique sur chaque société -------------------
do $$
declare
  c record;
  avant jsonb;
  apres jsonb;
  res   jsonb;
begin
  for c in select id, name from public.companies loop
    select jsonb_build_object(
             'a_valider', count(*) filter (where status = 'a_valider'),
             'lie',       count(*) filter (where status = 'lie'),
             'rejete',    count(*) filter (where status = 'rejete'))
      into avant from public.article_links where company_id = c.id;

    if (avant->>'a_valider')::int = 0 then
      continue;
    end if;

    res := public.article_links_autoresolve(c.id);

    select jsonb_build_object(
             'a_valider', count(*) filter (where status = 'a_valider'),
             'lie',       count(*) filter (where status = 'lie'),
             'rejete',    count(*) filter (where status = 'rejete'))
      into apres from public.article_links where company_id = c.id;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (c.id, null, 'article_links_purge', 'article_links', c.id::text, 'system', avant,
            apres || jsonb_build_object('autoresolve', res,
                                        'a_completer', public.articles_a_completer_controle(c.id)));
    raise notice 'Purge % : % -> % a valider', c.name, avant->>'a_valider', apres->>'a_valider';
  end loop;
end $$;
