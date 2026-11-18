-- =====================================================================
-- M2 — Rattrapage G8 (18/11/2026) : écran « Gestion des remplacements ».
-- Source : docs/g8-inventaire/02-articles.md : filtres sur la référence SOURCE et la référence
-- CIBLE (fournisseur, rayon, sous-rayon, catégorie, référence, désignation), date de
-- remplacement à partir du…, état Tous / Liaison / Redirection ; actions Supprimer source,
-- Supprimer liaison, Fusionner.
--
-- Le DMS porte le remplacement par articles.superseded_by_id (INV012) ; l'état et la date
-- viennent de 20261118230000 (replacement_mode, superseded_at).
--   - redirection : l'ancienne référence renvoie vers la nouvelle (comportement du DMS avant
--     ce lot, valeur par défaut) ;
--   - liaison : les deux fiches restent consultables, la nouvelle est proposée.
-- Fusionner = transfert du stock et du PAMP (transfer_stock_on_replace, deux mouvements
-- « transfert » tracés, B5/B7), codes-barres de la source repris par la cible (plus la
-- référence source elle-même, pour qu'un scan de l'ancienne étiquette trouve la nouvelle),
-- source désactivée et passée en redirection.
--
-- Idempotente. NON APPLIQUÉE. Suppose 20261118230000 et 20261118231000 appliquées avant.
-- =====================================================================

create or replace function public._g8_family_match(_path text, _rayon text, _sous text, _cat text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select (nullif(_rayon, '') is null or coalesce((string_to_array(coalesce(_path, ''), '-'))[1], '') = _rayon)
     and (nullif(_sous, '') is null or coalesce((string_to_array(coalesce(_path, ''), '-'))[2], '') = _sous)
     and (nullif(_cat, '') is null or coalesce((string_to_array(coalesce(_path, ''), '-'))[3], '') = _cat);
$$;

-- Filtres (jsonb) : src_supplier_id, src_rayon, src_sous_rayon, src_categorie, src_reference,
-- src_designation, et les mêmes en tgt_* ; date_from (date) ; state ('liaison' | 'redirection').
create or replace function public.article_replacements_list(_company uuid, _f jsonb default '{}'::jsonb, _limit int default 200, _offset int default 0)
returns table (
  source_id uuid, source_reference text, source_designation text, source_supplier text,
  source_real_qty numeric, source_active boolean,
  state text, replaced_at timestamptz,
  target_id uuid, target_reference text, target_designation text, target_supplier text,
  total bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _x jsonb := coalesce(_f, '{}'::jsonb);
begin
  if not public.is_member(_company) then return; end if;
  return query
  with sel as (
    select s.id as sid, s.reference as sref, s.designation as sdes, s.main_supplier_id as ssup, s.is_active as sact,
           s.replacement_mode as smode, s.superseded_at as sat,
           t.id as tid, t.reference as tref, t.designation as tdes, t.main_supplier_id as tsup
      from public.articles s
      join public.articles t on t.id = s.superseded_by_id
     where s.company_id = _company
       and (nullif(_x->>'state', '') is null or s.replacement_mode = _x->>'state')
       and (nullif(_x->>'date_from', '') is null or s.superseded_at >= (_x->>'date_from')::date)
       and (nullif(_x->>'src_supplier_id', '') is null or s.main_supplier_id = (_x->>'src_supplier_id')::uuid)
       and (nullif(_x->>'tgt_supplier_id', '') is null or t.main_supplier_id = (_x->>'tgt_supplier_id')::uuid)
       and public._g8_family_match(s.category_path, _x->>'src_rayon', _x->>'src_sous_rayon', _x->>'src_categorie')
       and public._g8_family_match(t.category_path, _x->>'tgt_rayon', _x->>'tgt_sous_rayon', _x->>'tgt_categorie')
       and (nullif(_x->>'src_reference', '') is null or s.reference ilike '%' || (_x->>'src_reference') || '%')
       and (nullif(_x->>'tgt_reference', '') is null or t.reference ilike '%' || (_x->>'tgt_reference') || '%')
       and (nullif(_x->>'src_designation', '') is null or s.designation ilike '%' || (_x->>'src_designation') || '%')
       and (nullif(_x->>'tgt_designation', '') is null or t.designation ilike '%' || (_x->>'tgt_designation') || '%')
  ),
  tot as (select count(*)::bigint as n from sel),
  page as (
    select * from sel order by sel.sat desc nulls last, sel.sref
     limit least(greatest(coalesce(_limit, 200), 1), 1000) offset greatest(coalesce(_offset, 0), 0)
  )
  select p.sid, p.sref, p.sdes, public._g8_contact_name(p.ssup),
         (select coalesce(sum(m.qty_delta), 0) from public.stock_moves m where m.article_id = p.sid and not m.is_reservation),
         p.sact, p.smode, p.sat,
         p.tid, p.tref, p.tdes, public._g8_contact_name(p.tsup),
         tot.n
    from page p cross join tot
   order by p.sat desc nulls last, p.sref;
end $$;
revoke all on function public.article_replacements_list(uuid, jsonb, int, int) from public, anon;
grant execute on function public.article_replacements_list(uuid, jsonb, int, int) to authenticated, service_role;

-- Actions sur un remplacement : 'unlink' (Supprimer liaison) · 'delete_source' (Supprimer
-- source) · 'merge' (Fusionner) · 'set_link' / 'set_redirect' (changer l'état).
-- Retour : {"result": "<ce qui a été fait>"}.
create or replace function public.article_replacement_action(_source uuid, _action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _s public.articles; _t public.articles; _real numeric; _result text;
begin
  select * into _s from public.articles where id = _source;
  if not found then raise exception 'Article introuvable'; end if;
  if auth.uid() is not null and not public.can_write_table(_s.company_id, 'articles') then raise exception 'Accès refusé'; end if;
  if _s.superseded_by_id is null then raise exception 'Cette référence n''est pas remplacée'; end if;
  select * into _t from public.articles where id = _s.superseded_by_id;

  if _action = 'unlink' then
    update public.articles set superseded_by_id = null, updated_at = now() where id = _s.id;
    _result := 'unlinked';
  elsif _action in ('set_link', 'set_redirect') then
    update public.articles set replacement_mode = case when _action = 'set_link' then 'liaison' else 'redirection' end,
           updated_at = now() where id = _s.id;
    _result := _action;
  elsif _action = 'merge' then
    perform public.transfer_stock_on_replace(_s.id, _t.id);
    insert into public.article_barcodes (article_id, barcode, is_primary)
    select _t.id, b.barcode, false from public.article_barcodes b
     where b.article_id = _s.id
       and not exists (select 1 from public.article_barcodes x where x.article_id = _t.id and x.barcode = b.barcode);
    if not exists (select 1 from public.article_barcodes x where x.article_id = _t.id and x.barcode = _s.reference) then
      insert into public.article_barcodes (article_id, barcode, is_primary) values (_t.id, _s.reference, false);
    end if;
    update public.articles set is_active = false, replacement_mode = 'redirection', updated_at = now() where id = _s.id;
    _result := 'merged';
  elsif _action = 'delete_source' then
    select real_qty into _real from public.article_stock(_s.id);
    if coalesce(_real, 0) <> 0 then raise exception 'La référence source a encore du stock : fusionnez d''abord'; end if;
    begin
      if exists (select 1 from public.stock_moves m where m.article_id = _s.id) then raise foreign_key_violation; end if;
      delete from public.articles where id = _s.id;
      _result := 'deleted';
    exception when foreign_key_violation then
      update public.articles set is_active = false, updated_at = now() where id = _s.id;
      _result := 'deactivated';
    end;
  else
    raise exception 'Action inconnue : %', _action;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_s.company_id, auth.uid(), 'article_replacement_' || _action, 'article', _s.id, 'replacements',
          jsonb_build_object('reference', _s.reference, 'superseded_by_id', _s.superseded_by_id, 'replacement_mode', _s.replacement_mode),
          jsonb_build_object('target_reference', _t.reference, 'result', _result));
  return jsonb_build_object('result', _result);
end $$;
revoke all on function public.article_replacement_action(uuid, text) from public, anon;
grant execute on function public.article_replacement_action(uuid, text) to authenticated, service_role;
