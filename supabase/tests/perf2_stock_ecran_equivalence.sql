-- =====================================================================
-- Perf 2 (20/11/2026) -- essai a blanc de 20261120113000_perf2_stock_ecran_pagine.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise :
--   PRE_SQL=supabase/migrations/20261120113000_perf2_stock_ecran_pagine.sql python rt.py perf2_stock_ecran_equivalence.sql
-- Verifie, pour chaque societe et un administrateur connecte :
--   1. sans filtre : les lignes de stock_screen_page = article_stock_list(_stock => 'actif'),
--      memes colonnes, memes valeurs, meme ordre ; total = nombre de lignes ; valeur = somme ;
--   2. chaque filtre de l'ecran (stock <> 0, sous le mini, a commander, dormant, fournisseur,
--      rayon par code, rayon par libelle, texte sur reference / designation / casier) = le meme
--      filtre applique a article_stock_list ; totaux et valeur exacts ;
--   3. les pages de 1 000 mises bout a bout = la liste complete (export) ;
--   4. un utilisateur qui n'est pas membre ne voit rien.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

create temp table _cases(label text, filters jsonb) on commit drop;

do $s$ declare co record; _u uuid; _sup uuid; _cp text; _bin text; _des text; c record;
  ref jsonb; got jsonb; bad int; n int; pages jsonb; k int; pg jsonb;
begin
  for co in select id from public.companies loop
    select ur.user_id into _u from public.user_roles ur where ur.company_id = co.id and ur.role = 'admin' limit 1;
    if _u is null then continue; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);

    -- valeurs reelles pour les filtres
    select l.supplier_id into _sup from public.article_stock_list(co.id, 'actif') l where l.supplier_id is not null group by 1 order by count(*) desc limit 1;
    select l.category_path into _cp from public.article_stock_list(co.id, 'actif') l where l.category_path ~ '^[0-9A-Za-z]+-' limit 1;
    select l.bin_location into _bin from public.article_stock_list(co.id, 'actif') l where coalesce(l.bin_location, '') <> '' limit 1;
    select split_part(l.designation, ' ', 1) into _des from public.article_stock_list(co.id, 'actif') l where length(l.designation) > 4 order by l.reference limit 1;

    truncate _cases;
    insert into _cases values
      ('sans filtre', '{}'),
      ('stock <> 0', '{"only_stocked": true}'),
      ('sous le mini', '{"below_min": true}'),
      ('a commander', '{"reorder": true}'),
      ('dormant', '{"dormant": true}'),
      ('fournisseur', jsonb_build_object('supplier_id', _sup)),
      ('rayon code', jsonb_build_object('rayon_code', split_part(_cp, '-', 1), 'rayon_label', 'zzz-introuvable')),
      ('rayon libelle', jsonb_build_object('rayon_code', 'ZZ', 'rayon_label', lower(substr(_cp, 1, 2)))),
      ('texte designation', jsonb_build_object('q', upper(_des))),
      ('texte casier', jsonb_build_object('q', _bin, 'only_stocked', true)),
      ('texte reference', jsonb_build_object('q', '  0  ')),
      ('combine', jsonb_build_object('q', 'a', 'only_stocked', true, 'reorder', true)),
      ('liste d''articles', jsonb_build_object('article_ids', (
         select jsonb_agg(x) from (
           (select l.article_id::text x from public.article_stock_list(co.id, 'actif') l order by md5(l.article_id::text) limit 7)
           union all (select a.id::text from public.articles a where a.company_id = co.id order by md5(a.id::text) limit 3)) s)));

    bad := 0; n := 0;
    for c in select * from _cases loop
      n := n + 1;
      select coalesce(jsonb_agg(to_jsonb(l) order by l.reference, l.article_id), '[]') into ref
        from public.article_stock_list(co.id, 'actif') l
       where (not coalesce((c.filters->>'only_stocked')::boolean, false) or abs(l.real_qty) >= 0.0001)
         and (not coalesce((c.filters->>'below_min')::boolean, false) or (l.stock_min > 0 and l.available_qty < l.stock_min))
         and (nullif(c.filters->>'supplier_id', '') is null or l.supplier_id = (c.filters->>'supplier_id')::uuid)
         and (nullif(c.filters->>'rayon_code', '') is null or (l.category_path is not null and (
               lower(l.category_path) like lower(c.filters->>'rayon_code') || '-%'
               or strpos(lower(l.category_path), lower(c.filters->>'rayon_label')) > 0)))
         and (not coalesce((c.filters->>'dormant')::boolean, false) or l.available_qty > 0)
         and (nullif(btrim(coalesce(c.filters->>'q', '')), '') is null
              or strpos(lower(l.reference || ' ' || coalesce(l.designation, '') || ' ' || coalesce(l.bin_location, '')), lower(btrim(c.filters->>'q'))) > 0)
         and (not coalesce((c.filters->>'reorder')::boolean, false) or (l.stock_min > 0 and l.available_qty < l.stock_min) or l.available_qty < 0)
         and (c.filters->'article_ids' is null or l.article_id::text in (select jsonb_array_elements_text(c.filters->'article_ids')));
      got := public.stock_screen_page(co.id, c.filters, 100000, 0);
      if (got->'rows') is distinct from ref
         or (got->>'total')::bigint is distinct from jsonb_array_length(ref)::bigint
         or (got->>'value')::numeric is distinct from coalesce((select sum((e->>'stock_value')::numeric) from jsonb_array_elements(ref) e), 0) then
        bad := bad + 1;
        raise notice 'KO % % : % / %', co.id, c.label, got->>'total', jsonb_array_length(ref);
      end if;
    end loop;
    insert into _t(check_name, result) values ('1-2 ' || co.id || ' : ' || n || ' filtres = article_stock_list filtre (lignes, total, valeur)',
      case when bad = 0 then 'ok' else 'KO ' || bad end);

    -- 3. pages de 1 000 bout a bout = liste complete
    pages := '[]'; k := 0;
    loop
      pg := public.stock_screen_page(co.id, '{}', 1000, k * 1000);
      pages := pages || (pg->'rows');
      exit when jsonb_array_length(pg->'rows') < 1000;
      k := k + 1;
    end loop;
    insert into _t(check_name, result) values ('3 ' || co.id || ' : pages de 1000 = liste complete (' || jsonb_array_length(pages) || ')',
      case when pages = (public.stock_screen_page(co.id, '{}', 100000, 0)->'rows') then 'ok' else 'KO' end);
  end loop;

  -- 4. non membre
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000abcd', 'role', 'authenticated')::text, true);
  got := public.stock_screen_page('3d9f0f13-a691-4d07-ad58-34590df86e33', '{}', 100, 0);
  insert into _t(check_name, result) values ('4 non membre : rien', case when (got->>'total')::int = 0 and jsonb_array_length(got->'rows') = 0 then 'ok' else 'KO' end);
  perform set_config('request.jwt.claims', '', true);
end $s$;

insert into _t(check_name, result)
select '5 index partiel stock mini pose', case when count(*) = 1 then 'ok' else 'KO' end
  from pg_indexes where schemaname = 'public' and indexname = 'idx_articles_company_stock_min';
