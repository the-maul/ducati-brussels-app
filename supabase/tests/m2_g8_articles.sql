-- =====================================================================
-- Rattrapage G8 articles (18/11/2026) — essai a blanc des migrations 20261118230000 a 233000.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118230000_m2_g8_fiche_article.sql \
--      supabase/migrations/20261118231000_m2_g8_outils_prix.sql \
--      supabase/migrations/20261118232000_m2_g8_remplacements.sql \
--      supabase/migrations/20261118233000_m2_g8_suivi_tarifs.sql \
--      supabase/tests/m2_g8_articles.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue un administrateur (claims JWT simulees) dans ITALBIKE STORE. Articles d essai crees puis
-- annules avec la transaction. Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _a uuid; _b uuid; _c uuid; _r jsonb; _n int; _x numeric; _rec record;
begin
  -- ------------------------------------------------ articles d essai
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, sale_price_ttc, sale_price_ht, vat_rate, ppc_ttc, ppc_ht, category_path)
  values (_co, 'ZZG8-A', 'ESSAI G8 A', 'A', 10, 30, 24.793, 21, 36.30, 30, '02-01-01') returning id into _a;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, sale_price_ttc, vat_rate, price_sale_locked)
  values (_co, 'ZZG8-B', 'ESSAI G8 B', 'A', 20, 50, 21, true) returning id into _b;
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, sale_price_ttc, vat_rate)
  values (_co, 'ZZG8-C', 'ESSAI G8 C', 'A', 5, 12, 21) returning id into _c;

  -- ------------------------------------------------ equivalences (et equivalences d equivalences)
  perform public.article_equivalence_set(_a, _b, true);
  perform public.article_equivalence_set(_c, _b, true);
  insert into _t(check_name, result) values
    ('equivalence rangee une seule fois', case when (select count(*) from public.article_equivalences where article_id in (_a,_b,_c) or equivalent_id in (_a,_b,_c)) = 2 then 'ok' else 'FAIL' end),
    ('A voit B (niveau 1) et C (niveau 2 via B)', case when (select string_agg(reference || ':' || level, ',' order by reference) from public.article_equivalents(_a)) = 'ZZG8-B:1,ZZG8-C:2' then 'ok' else 'FAIL ' || coalesce((select string_agg(reference || ':' || level, ',') from public.article_equivalents(_a)), 'vide') end);
  perform public.article_equivalence_set(_b, _a, false);
  insert into _t(check_name, result) values
    ('retrait dans l autre sens', case when not exists (select 1 from public.article_equivalents(_a)) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ mouvements : ancien / nouveau stock reel
  perform public.record_stock_move(_a, 'entree', 5, 10, false, null, 'screen', null, 'essai');
  perform public.record_stock_move(_a, 'sortie', -2, null, false, null, 'screen', null, 'essai');
  select * into _rec from public.article_moves_detail(_a) order by occurred_at desc, move_id desc limit 1;
  insert into _t(check_name, result) values
    ('mouvement : reel avant 5, apres 3', case when _rec.real_before = 5 and _rec.real_after = 3 then 'ok' else 'FAIL ' || _rec.real_before || '/' || _rec.real_after end);

  -- ------------------------------------------------ mise en librairie refusee avec du stock
  _r := public.article_set_library(array[_a, _c], true);
  insert into _t(check_name, result) values
    ('librairie : A refuse (stock), C accepte', case when (_r->>'refused_stock')::int = 1 and (_r->>'done')::int = 1 then 'ok' else 'FAIL ' || _r::text end),
    ('librairie : trace events', case when exists (select 1 from public.events where entity_id = _c and action = 'article_library_in') then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ cascade : verrou PV respecte, prix traces
  _r := public.article_cascade_apply(_co, array[_a, _b], 'pv_pct', '{"value":"10"}');
  insert into _t(check_name, result) values
    ('cascade PV +10 % : A modifie, B verrouille ignore', case when (_r->>'done')::int = 1 and (_r->>'skipped')::int = 1 then 'ok' else 'FAIL ' || _r::text end),
    ('cascade : PV A = 33', case when (select sale_price_ttc from public.articles where id = _a) = 33 then 'ok' else 'FAIL' end),
    ('cascade : trace price_changes origine cascade', case when exists (select 1 from public.price_changes where article_id = _a and origin = 'cascade' and new_sale_ttc = 33) then 'ok' else 'FAIL' end);
  _r := public.article_cascade_apply(_co, array[_a], 'ppc_from_pv', '{}');
  insert into _t(check_name, result) values
    ('aligner PPC sur PV : PPC trace', case when exists (select 1 from public.price_changes where article_id = _a and new_ppc_ttc = 33) then 'ok' else 'FAIL' end);
  _r := public.article_cascade_apply(_co, array[_a], 'lock_designation', '{}');
  insert into _t(check_name, result) values
    ('verrou designation pose + events', case when (select designation_locked from public.articles where id = _a)
      and exists (select 1 from public.events where entity_id = _a and action = 'article_cascade') then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ prix par lots : verrou PV respecte
  _r := public.article_price_batch(_co, jsonb_build_array(
    jsonb_build_object('id', _b, 'sale_ttc', 99, 'purchase', 21),
    jsonb_build_object('id', _c, 'sale_ttc', 12.5)), 'rounding');
  insert into _t(check_name, result) values
    ('lots : B garde son PV verrouille, PA ecrit', case when (select sale_price_ttc from public.articles where id = _b) = 50 and (select purchase_price from public.articles where id = _b) = 21 then 'ok' else 'FAIL ' || _r::text end),
    ('lots : origine rounding tracee', case when exists (select 1 from public.price_changes where article_id = _c and origin = 'rounding') then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ selection filtree (paginee, total exact)
  select count(*) into _n from public.article_select_page(_co, '{"reference":"ZZG8-","stock":"pos"}'::jsonb, 50, 0);
  insert into _t(check_name, result) values
    ('selection : stock positif = A seul', case when _n = 1 then 'ok' else 'FAIL ' || _n end),
    ('selection : ids en un tableau', case when cardinality(public.article_select_ids(_co, '{"reference":"ZZG8-"}'::jsonb)) = 3 then 'ok' else 'FAIL' end),
    ('selection : librairie', case when (select count(*) from public.article_select_page(_co, '{"reference":"ZZG8-","file":"library"}'::jsonb, 50, 0)) = 1 then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ remplacements : liste, liaison, fusion
  update public.articles set superseded_by_id = _c where id = _a;
  insert into _t(check_name, result) values
    ('date de remplacement posee par trigger', case when (select superseded_at from public.articles where id = _a) is not null then 'ok' else 'FAIL' end),
    ('liste des remplacements : redirection par defaut', case when exists (select 1 from public.article_replacements_list(_co, '{"src_reference":"ZZG8-A"}'::jsonb) where state = 'redirection' and target_reference = 'ZZG8-C') then 'ok' else 'FAIL' end);
  perform public.article_replacement_action(_a, 'set_link');
  insert into _t(check_name, result) values
    ('passage en liaison', case when (select replacement_mode from public.articles where id = _a) = 'liaison' then 'ok' else 'FAIL' end);
  _r := public.article_replacement_action(_a, 'merge');
  select real_qty into _x from public.article_stock(_c);
  insert into _t(check_name, result) values
    ('fusion : stock transfere sur la cible', case when _x = 3 and (select real_qty from public.article_stock(_a)) = 0 then 'ok' else 'FAIL ' || _x end),
    ('fusion : reference source lue comme code-barres de la cible', case when exists (select 1 from public.article_barcodes where article_id = _c and barcode = 'ZZG8-A') then 'ok' else 'FAIL' end),
    ('fusion : source desactivee', case when not (select is_active from public.articles where id = _a) then 'ok' else 'FAIL' end);
  _r := public.article_replacement_action(_a, 'delete_source');
  insert into _t(check_name, result) values
    ('supprimer source avec historique : desactivee, pas supprimee', case when _r->>'result' = 'deactivated' and exists (select 1 from public.articles where id = _a) then 'ok' else 'FAIL ' || _r::text end);

  -- ------------------------------------------------ documents / en cours fournisseur (lecture sans erreur)
  perform * from public.article_documents(_c);
  perform * from public.article_supplier_open_orders(_c);
  insert into _t(check_name, result) values ('documents et en cours fournisseur lisibles', 'ok');

  -- ------------------------------------------------ arrondis par famille, suivi des tarifs, formats
  insert into public.price_rounding_rules (company_id, category_prefix, up_to, step, mode) values (_co, '02-01', 0, 0.5, 'up');
  insert into public.supplier_tariffs (company_id, supplier_name, file_name, status) values (_co, 'ESSAI', 'essai.xlsx', 'en_attente');
  insert into public.supplier_tariff_formats (company_id, supplier_name, mapping) values (_co, 'ESSAI', '{"reference":"Ref"}');
  insert into _t(check_name, result) values ('tables arrondis / tarifs / formats ecrites sous RLS', 'ok');
  begin
    insert into public.price_rounding_rules (company_id, step) values (_co, 0);
    insert into _t(check_name, result) values ('pas d arrondi nul refuse', 'FAIL');
  exception when check_violation then
    insert into _t(check_name, result) values ('pas d arrondi nul refuse', 'ok');
  end;
end $s$;

select n, check_name, result from _t order by n;
