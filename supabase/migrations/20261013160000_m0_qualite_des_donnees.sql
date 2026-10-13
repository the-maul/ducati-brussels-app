-- M0 — « Qualité des données » : un seul compteur pour les écrans de
-- maintenance, afin que le menu ne les signale que s'il y a vraiment quelque
-- chose à traiter (demande de Simon : ranger les écrans techniques hors du
-- menu principal, et une pastille avec le nombre).
--
-- Une seule requête pour les quatre chantiers, sinon la barre latérale
-- déclencherait quatre appels sur chaque page.
create or replace function public.data_quality_counts(_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  _links int := 0;
  _shopify int := 0;
  _decl int := 0;
  _gsm int := 0;
begin
  if not public.is_member(_company) then
    raise exception 'data_quality: not a member' using errcode = '42501';
  end if;

  -- Rapprochements proposés qui attendent une décision.
  select coalesce((public.article_links_counts(_company) ->> 'pending')::int, 0) into _links;

  -- Produits du site sans article dans le DMS (la fonction renvoie le total
  -- sur chaque ligne : une ligne suffit).
  select coalesce(max(u.total_count), 0) into _shopify
    from public.shopify_unlinked_products(_company, 1, 0) u;

  -- Motos déclarées par les clients, en attente de validation.
  select count(*) into _decl from public.declared_vehicles_pending(_company);

  -- Numéros fixes qui sont en réalité des GSM (reprise G8).
  select coalesce(max(c.total), 0) into _gsm
    from public.contacts_phone_gsm_candidates(_company, 1, 0) c;

  return jsonb_build_object(
    'links', _links,
    'shopify_unlinked', _shopify,
    'declarations', _decl,
    'phone_gsm', _gsm,
    'total', _links + _shopify + _decl + _gsm
  );
end $function$;

grant execute on function public.data_quality_counts(uuid) to authenticated, service_role;
