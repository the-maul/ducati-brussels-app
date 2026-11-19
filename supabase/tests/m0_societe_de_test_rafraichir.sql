-- =====================================================================
-- M0 COM005 (19/11/2026) — essai a blanc du RAFRAICHISSEMENT d une societe de test
-- (20261119160000_m0_societe_de_test_italtest.sql), sur une SOURCE REDUITE creee dans l essai
-- (la copie complete d ITALBIKE STORE est essayee par m0_societe_de_test_italtest.sql).
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119160000_m0_societe_de_test_italtest.sql \
--      supabase/tests/m0_societe_de_test_rafraichir.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Duree : quelques secondes.
-- Controle :
--   - copie de la source reduite (fournisseur, client, piece, moto + article, stock, kit, version) ;
--   - activite de test dans la copie (devis + ligne, mouvement, notification) ;
--   - lien croise depuis la source vers la copie → purge refusee, rien supprime ;
--   - rafraichissement depuis l ecran (role authenticated, appels de 4 s) : activite purgee,
--     nouveaux ids, liens recables, stock identique, source intacte ; ITALBIKE STORE intacte.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _ctx to authenticated;

-- ------------------------------------------------ source reduite
do $s$
declare _co uuid; _sup uuid; _cli uuid; _pl uuid; _a uuid; _av uuid; _v uuid; _k uuid;
begin
  insert into public.companies (code, name) values ('ZZESSAISRC', 'ZZ Source essai') returning id into _co;
  insert into public.user_roles (user_id, company_id, role) values ('d9409378-a554-4cb2-97d6-e0b84aba204e', _co, 'admin');
  insert into public.reference_values (company_id, table_key, code, label) values (_co, 'essai', 'X', 'Valeur essai');
  insert into public.document_sequences (company_id, doc_type, prefix, label, next_value) values (_co, 'FAC', 'FAC', 'Factures', 57);
  insert into public.price_lists (company_id, code, label) values (_co, 'T15', 'Tarif 15') returning id into _pl;
  insert into public.contacts (company_id, type, company_name, email, phone) values (_co, 'fournisseur', 'ESSAI FOURNISSEUR', 'frs@example.com', '+3221234567') returning id into _sup;
  insert into public.contacts (company_id, type, first_name, last_name, email, mobile, price_list_id, country)
  values (_co, 'particulier', 'Marco', 'ESSAI', 'marco.essai@example.com', '+32470123456', _pl, 'BE') returning id into _cli;
  insert into public.articles (company_id, reference, designation, mgmt_type, main_supplier_id, pamp, purchase_price, sale_price_ttc)
  values (_co, 'ESSAI-FILTRE', 'Filtre essai', 'A', _sup, 10, 10, 20) returning id into _a;
  insert into public.articles (company_id, reference, designation, mgmt_type, pamp)
  values (_co, 'ESSAI-MOTO', 'Moto essai', 'V', 9000) returning id into _av;
  insert into public.vehicles (company_id, article_id, vin, brand, model, holder_contact_id, status)
  values (_co, _av, 'ZDMESSAI000000001', 'DUCATI', 'ESSAI', _cli, 'stock_vn') returning id into _v;
  update public.articles set vehicle_id = _v where id = _av and vehicle_id is null;
  insert into public.vehicle_owners (vehicle_id, contact_id, is_current) values (_v, _cli, true);
  insert into public.stock_moves (company_id, article_id, move_type, qty_delta, unit_cost, origin) values
    (_co, _a, 'entree', 5, 10, 'import'), (_co, _a, 'sortie', -2, 10, 'import'), (_co, _av, 'entree', 1, 9000, 'import');
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label, content_hash)
  values (_co, 'ESSAI', 'Moteur essai', 'S1', 'Entretien 1', 'h1') returning id into _k;
  insert into public.maintenance_kit_items (company_id, kit_id, designation, article_id, quantity) values (_co, _k, 'Filtre', _a, 1);
  insert into public.maintenance_kit_versions (company_id, kit_id, version, items)
  values (_co, _k, 1, jsonb_build_array(jsonb_build_object('article_id', _a::text, 'quantity', 1, 'reference', 'ESSAI-FILTRE')));
  insert into _ctx values ('src', _co::text), ('src_article', _a::text), ('src_supplier', _sup::text),
    ('itb_before', (select count(*) from public.articles where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text || '/'
                || (select count(*) from public.stock_moves where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text);
end $s$;

-- ------------------------------------------------ premiere copie (SQL)
do $s$
declare _src uuid := (select v::uuid from _ctx where k = 'src'); _r jsonb; _tgt uuid;
begin
  _r := public.admin_clone_company_for_test(_src, 'ZZ Essai copie');
  _tgt := (_r ->> 'company_id')::uuid;
  insert into _ctx values ('tgt', _tgt::text);
  insert into _t(check_name, result) values
    ('1 premiere copie de la source reduite : prete', case when _r ->> 'status' = 'pret' then 'ok' else 'KO ' || left(_r::text, 300) end),
    ('2 copie : 2 contacts, 2 articles, 1 moto, 1 kit, 1 version, 2 mouvements d ouverture',
     case when (select count(*) from public.contacts where company_id = _tgt) = 2 and (select count(*) from public.articles where company_id = _tgt) = 2
           and (select count(*) from public.vehicles where company_id = _tgt) = 1 and (select count(*) from public.maintenance_kits where company_id = _tgt) = 1
           and (select count(*) from public.maintenance_kit_versions where company_id = _tgt) = 1 and (select count(*) from public.stock_moves where company_id = _tgt) = 2
          then 'ok' else 'KO' end),
    ('3 numerotation copiee : TESTFAC au compteur 1', case when exists (select 1 from public.document_sequences where company_id = _tgt and prefix = 'TESTFAC' and next_value = 1) then 'ok' else 'KO' end);

  -- activite de test dans la copie
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_tgt, 'DEV', 'brouillon', (select id from public.contacts where company_id = _tgt and type = 'particulier'), current_date, 100, 21, 121, 'ttc')
  returning id into _tgt;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_tgt, 'TEST parcours', 1, 100, 21, 100, 121, 0, 'article');
  insert into _ctx values ('test_doc', _tgt::text);
  _tgt := (select v::uuid from _ctx where k = 'tgt');
  insert into public.stock_moves (company_id, article_id, move_type, qty_delta, unit_cost, origin)
  select _tgt, id, 'sortie', -1, 10, 'sale' from public.articles where company_id = _tgt and reference = 'ESSAI-FILTRE';
  perform public.enqueue_notification(_tgt, 'email', 'test+x@invalid.local', 's', 'b', null, null, null);
  insert into _ctx values ('old_article', (select id::text from public.articles where company_id = _tgt and reference = 'ESSAI-FILTRE'));
end $s$;

-- ------------------------------------------------ lien croise : purge refusee
do $s$
declare _src uuid := (select v::uuid from _ctx where k = 'src'); _tgt uuid := (select v::uuid from _ctx where k = 'tgt'); _r jsonb;
begin
  insert into public.article_equivalences (company_id, article_id, equivalent_id)
  select _src, least(a, b), greatest(a, b)
    from (select (select v::uuid from _ctx where k = 'src_article') a, (select v::uuid from _ctx where k = 'old_article') b) x;
  perform public.admin_test_company_start(_src, 'ZZ Essai copie');
  _r := public.admin_test_company_step(_tgt, 30000);
  insert into _t(check_name, result) values
    ('4 lien croise depuis la source vers la copie : purge refusee, rien supprime',
     case when _r ->> 'status' = 'erreur' and _r ->> 'error' like 'Garde-fou%'
           and exists (select 1 from public.documents where id = (select v::uuid from _ctx where k = 'test_doc'))
           and exists (select 1 from public.articles where id = (select v::uuid from _ctx where k = 'old_article'))
          then 'ok' else 'KO ' || left(_r::text, 300) end);
  delete from public.article_equivalences where company_id = _src;
end $s$;

-- ------------------------------------------------ rafraichissement depuis l ecran (administrateur, appels de 4 s)
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare _src uuid := (select v::uuid from _ctx where k = 'src'); _tgt uuid; _r jsonb; _calls int := 0;
begin
  _tgt := public.admin_test_company_start(_src, 'ZZ Essai copie');
  loop
    _r := public.admin_test_company_step(_tgt, 4000);
    _calls := _calls + 1;
    exit when _r ->> 'status' in ('pret', 'erreur') or _calls >= 200;
  end loop;
  insert into _t(check_name, result) values
    ('5 rafraichissement (' || _calls || ' appels) : meme societe, prete',
     case when _r ->> 'status' = 'pret' and _tgt = (select v::uuid from _ctx where k = 'tgt') then 'ok' else 'KO ' || left(_r::text, 300) end),
    ('6 l administrateur voit la societe de test et sa marque (selecteur, bandeau)',
     case when exists (select 1 from public.companies where id = _tgt) and exists (select 1 from public.test_companies where company_id = _tgt and status = 'pret') then 'ok' else 'KO' end);
end $s$;
reset role;

do $s$
declare _src uuid := (select v::uuid from _ctx where k = 'src'); _tgt uuid := (select v::uuid from _ctx where k = 'tgt'); _a uuid; _sup uuid;
begin
  select id, main_supplier_id into _a, _sup from public.articles where company_id = _tgt and reference = 'ESSAI-FILTRE';
  insert into _t(check_name, result) values
    ('7 activite de test purgee (devis, ligne, vente, notification) et anciens ids disparus',
     case when not exists (select 1 from public.documents where company_id = _tgt)
           and not exists (select 1 from public.document_lines where document_id = (select v::uuid from _ctx where k = 'test_doc'))
           and not exists (select 1 from public.notifications where company_id = _tgt)
           and not exists (select 1 from public.articles where id = (select v::uuid from _ctx where k = 'old_article'))
           and (select count(*) from public.stock_moves where company_id = _tgt) = 2
          then 'ok' else 'KO' end),
    ('8 liens recables : fournisseur, tarif du client, moto ↔ article, proprietaire, kit, version',
     case when (select company_name from public.contacts where id = _sup) = 'ESSAI FOURNISSEUR' and _sup <> (select v::uuid from _ctx where k = 'src_supplier')
           and exists (select 1 from public.contacts c join public.price_lists p on p.id = c.price_list_id and p.company_id = _tgt where c.company_id = _tgt and c.type = 'particulier')
           and exists (select 1 from public.vehicles v join public.articles a on a.id = v.article_id and a.vehicle_id = v.id and a.company_id = _tgt
                        join public.contacts c on c.id = v.holder_contact_id and c.company_id = _tgt where v.company_id = _tgt)
           and exists (select 1 from public.vehicle_owners o join public.vehicles v on v.id = o.vehicle_id and v.company_id = _tgt
                        join public.contacts c on c.id = o.contact_id and c.company_id = _tgt)
           and exists (select 1 from public.maintenance_kit_items i where i.company_id = _tgt and i.article_id = _a)
           and exists (select 1 from public.maintenance_kit_versions v where v.company_id = _tgt and v.items -> 0 ->> 'article_id' = _a::text)
          then 'ok' else 'KO' end),
    ('9 client copie neutralise (mail test+<id>@invalid.local, mobile +00)',
     case when exists (select 1 from public.contacts c where c.company_id = _tgt and c.type = 'particulier'
                        and c.email = 'test+' || c.id || '@invalid.local' and c.mobile like '+00%') then 'ok' else 'KO' end),
    ('10 stock identique a la source (filtre 3, moto 1)',
     case when (select sum(qty_delta) from public.stock_moves where article_id = _a) = 3
           and (select sum(m.qty_delta) from public.stock_moves m join public.articles x on x.id = m.article_id where x.company_id = _tgt and x.reference = 'ESSAI-MOTO') = 1
          then 'ok' else 'KO' end),
    ('11 source intacte (2 articles, 3 mouvements, compteur FAC a 57) ; ITALBIKE STORE intacte',
     case when (select count(*) from public.articles where company_id = _src) = 2 and (select count(*) from public.stock_moves where company_id = _src) = 3
           and (select next_value from public.document_sequences where company_id = _src and doc_type = 'FAC') = 57
           and (select v from _ctx where k = 'itb_before') = (select count(*) from public.articles where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text || '/'
                || (select count(*) from public.stock_moves where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text
          then 'ok' else 'KO' end);
end $s$;

select n, check_name, result from _t order by n;
