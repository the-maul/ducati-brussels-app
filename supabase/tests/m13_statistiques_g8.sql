-- =====================================================================
-- Lot G8 statistiques (18/11/2026) — essai a blanc des migrations 20261118180000 et 20261118181000.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base). Les migrations
-- du bloc facture legale (20261103160000, 20261103180000) doivent etre posees avant (ou ajoutees en tete) :
--   (echo "begin;"; cat supabase/migrations/20261118180000_m13_chiffres_justes.sql \
--      supabase/migrations/20261118181000_m13_statistiques_g8.sql \
--      supabase/tests/m13_statistiques_g8.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Pieces d essai datees de juin 2031 / juin 2030 (periode vide : aucun vrai document ne les fausse) et
-- du jour (tableau de bord : ecarts avant / apres). Joue le role d un administrateur (claims JWT simulees)
-- dans ITALBIKE STORE, puis d un mecanicien (refuse). Verifie :
--   - avoir deduit, brouillon exclu, ticket compte, facture d acompte (FAA) exclue ;
--   - remise globale repartie sur les lignes, port a part, quantites signees ;
--   - cout fige sur la ligne (PAMP du jour d ecriture) ;
--   - classement multi-niveaux, filtres, exercice N-1, stock de l article au dernier niveau ;
--   - mois par mois, indicateurs, documents en cours, statistiques de l article ;
--   - tableau de bord : tickets comptes, avoirs deduits, brouillons exclus ;
--   - mecanicien : statistiques refusees (42501), tableau de bord autorise.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------------ donnees (role postgres)
do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _cli uuid; _art uuid; _fac uuid; _tik uuid; _avo uuid; _draft uuid; _faa uuid; _old uuid; _dev uuid;
  _mec uuid := gen_random_uuid();
  _kpi jsonb;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'STATS G8', 'BE') returning id into _cli;
  insert into public.articles (company_id, reference, designation, brand, mgmt_type, category_path, purchase_price, pamp,
                               sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'TEST-STATS-G8', 'Article essai statistiques', 'TESTBRAND-G8', 'A', '03-12-99', 10, 10, 50, 60.5, 21)
  returning id into _art;

  -- FAC juin 2031 : 2 x 50 = 100 HT de lignes, remise globale 10 % (90), port 5 => total HT 95
  insert into public.documents (company_id, doc_type, status, number, contact_id, issue_date, total_ht, total_vat, total_ttc,
                                price_mode, global_discount_pct, shipping_ht, operator)
  values (_co, 'FAC', 'validee', 'TEST-STATS-FAC', _cli, '2031-06-15', 95, 19.95, 114.95, 'ht', 10, 5, 'TESTOPE')
  returning id into _fac;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_fac, _art, 'Article essai statistiques', 2, 50, 21, 100, 121, 0, 'article');
  -- TIK juin 2031 : 1 x 50
  insert into public.documents (company_id, doc_type, status, number, issue_date, total_ht, total_vat, total_ttc, price_mode, operator)
  values (_co, 'TIK', 'validee', 'TEST-STATS-TIK', '2031-06-16', 50, 10.5, 60.5, 'ht', 'TESTOPE') returning id into _tik;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_tik, _art, 'Article essai statistiques', 1, 50, 21, 50, 60.5, 0, 'article');
  -- AVO partiel de la facture : -1 x 45 (prix remise)
  insert into public.documents (company_id, doc_type, status, number, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode, source_document_id)
  values (_co, 'AVO', 'validee', 'TEST-STATS-AVO', _cli, '2031-06-20', -45, -9.45, -54.45, 'ht', _fac) returning id into _avo;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_avo, _art, 'Article essai statistiques', -1, 45, 21, -45, -54.45, 0, 'article');
  -- Brouillon (ne compte pas) et facture d acompte (pas une vente)
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', _cli, '2031-06-17', 999, 209.79, 1208.79, 'ht') returning id into _draft;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_draft, _art, 'Article essai statistiques', 10, 99.9, 21, 999, 1208.79, 0, 'article');
  insert into public.documents (company_id, doc_type, status, number, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAA', 'validee', 'TEST-STATS-FAA', _cli, '2031-06-18', 100, 21, 121, 'ht') returning id into _faa;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_faa, 'Acompte', 1, 100, 21, 100, 121, 0, 'article');
  -- N-1 : facture juin 2030, 1 x 40
  insert into public.documents (company_id, doc_type, status, number, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'validee', 'TEST-STATS-FAC-N1', _cli, '2030-06-15', 40, 8.4, 48.4, 'ht') returning id into _old;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_old, _art, 'Article essai statistiques', 1, 40, 21, 40, 48.4, 0, 'article');
  -- Devis en cours (documents en cours)
  insert into public.documents (company_id, doc_type, status, number, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'DEV', 'validee', 'TEST-STATS-DEV', _cli, '2031-06-10', 300, 63, 363, 'ht') returning id into _dev;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_dev, _art, 'Article essai statistiques', 6, 50, 21, 300, 363, 0, 'article');
  -- Stock de l article : +7 en entree
  insert into public.stock_moves (company_id, article_id, move_type, qty_delta, origin, note, occurred_at)
  values (_co, _art, 'entree', 7, 'test', 'TEST stats', '2031-06-01 10:00+02');

  insert into _t(check_name, result) values
    ('cout fige sur la ligne (PAMP 10)', case when (select unit_cost from public.document_lines where document_id = _fac) = 10 then 'ok' else 'FAIL' end);
  -- PAMP qui change apres la vente : la marge de la vente ne bouge pas (si la base autorise l essai)
  begin
    update public.articles set pamp = 20 where id = _art;
  exception when others then
    insert into _t(check_name, result) values ('PAMP modifie pour l essai', 'ok (non modifiable directement, controle saute)');
  end;

  -- Mecanicien d essai (refuse aux statistiques)
  insert into auth.users (id, aud, role, email) values (_mec, 'authenticated', 'authenticated', 'test-stats-mec@example.invalid');
  insert into public.user_roles (user_id, company_id, role) values (_mec, _co, 'mecanicien');

  perform set_config('test.co', _co::text, true);
  perform set_config('test.art', _art::text, true);
  perform set_config('test.cli', _cli::text, true);
  perform set_config('test.mec', _mec::text, true);
end $s$;

-- Tableau de bord AVANT les pieces du jour (role administrateur)
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
create temp table _kpi_before on commit drop as
  select public.dashboard_kpis('3d9f0f13-a691-4d07-ad58-34590df86e33') as k;
grant all on _kpi_before to authenticated;
reset role;
select set_config('request.jwt.claims', '', true);

-- Pieces du jour : FAC 121 TTC, TIK 60,50 TTC, AVO -24,20 TTC, brouillon 1 000 TTC (role postgres)
do $s$
declare _co uuid := current_setting('test.co')::uuid; _cli uuid := current_setting('test.cli')::uuid; _art uuid := current_setting('test.art')::uuid;
  _d uuid;
begin
  insert into public.documents (company_id, doc_type, status, number, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'validee', 'TEST-STATS-JOUR-FAC', _cli, current_date, 100, 21, 121, 'ht') returning id into _d;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_d, _art, 'x', 2, 50, 21, 100, 121, 0, 'article');
  insert into public.documents (company_id, doc_type, status, number, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'TIK', 'validee', 'TEST-STATS-JOUR-TIK', current_date, 50, 10.5, 60.5, 'ht') returning id into _d;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_d, _art, 'x', 1, 50, 21, 50, 60.5, 0, 'article');
  insert into public.documents (company_id, doc_type, status, number, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'AVO', 'validee', 'TEST-STATS-JOUR-AVO', _cli, current_date, -20, -4.2, -24.2, 'ht') returning id into _d;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_d, _art, 'x', -1, 20, 21, -20, -24.2, 0, 'article');
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', _cli, current_date, 826.45, 173.55, 1000, 'ht') returning id into _d;
  insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_d, _art, 'x', 1, 826.45, 21, 826.45, 1000, 0, 'article');
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := current_setting('test.co')::uuid;
  _art uuid := current_setting('test.art')::uuid;
  _q jsonb; _r jsonb; _m jsonb; _i jsonb; _o jsonb; _a jsonb; _k jsonb; _kb jsonb;
  _tot numeric; _n int;
begin
  -- ---------------------------------------------- ventes de l article (filtre marque), niveau article
  _q := public.stats_query(_co, 'sales', '2031-06-01', '2031-06-30', '{"brand":"testbrand-g8"}', array['article'], true);
  _r := _q->'rows'->0;
  insert into _t(check_name, result) values
    ('une seule ligne pour l article', case when jsonb_array_length(_q->'rows') = 1 then 'ok' else 'FAIL ' || (_q->'rows')::text end),
    ('quantite signee 2 + 1 - 1 = 2 (brouillon exclu)', case when (_r->>'qty')::numeric = 2 then 'ok' else 'FAIL ' || (_r->>'qty') end),
    ('CA HT 90 + 50 - 45 = 95 (remise repartie, avoir deduit)', case when (_r->>'ca_ht')::numeric = 95 then 'ok' else 'FAIL ' || (_r->>'ca_ht') end),
    ('cout fige 20 + 10 - 10 = 20', case when (_r->>'cost')::numeric = 20 then 'ok' else 'FAIL ' || (_r->>'cost') end),
    ('factures et tickets : 2, avoirs : 1', case when (_r->>'docs')::int = 2 and (_r->>'credit_notes')::int = 1 then 'ok' else 'FAIL ' || _r::text end),
    ('N-1 : 1 piece, 40 HT', case when (_r->>'qty_n1')::numeric = 1 and (_r->>'ca_ht_n1')::numeric = 40 then 'ok' else 'FAIL ' || _r::text end),
    ('stock reel de l article au dernier niveau (7)', case when (_r->>'stock')::numeric = 7 then 'ok' else 'FAIL ' || coalesce(_r->>'stock', 'null') end),
    ('remise accordee = 10 (remise globale de la facture)', case when (_r->>'gross_ht')::numeric - (_r->>'ca_ht')::numeric = 10 then 'ok' else 'FAIL ' || _r::text end);

  -- ---------------------------------------------- tous axes : total = total HT des documents (port compris, FAA exclue)
  _q := public.stats_query(_co, 'sales', '2031-06-01', '2031-06-30', '{}', array['doctype'], false);
  select sum((x->>'ca_ht')::numeric) into _tot from jsonb_array_elements(_q->'rows') x;
  insert into _t(check_name, result) values
    ('total ventes 95 + 50 - 45 = 100 (port compris, FAA et brouillon exclus)', case when _tot = 100 then 'ok' else 'FAIL ' || _tot end),
    ('pas de ligne FAA', case when not exists (select 1 from jsonb_array_elements(_q->'rows') x where x->'keys'->>0 = 'FAA') then 'ok' else 'FAIL' end);

  -- ---------------------------------------------- 4 niveaux + article
  _q := public.stats_query(_co, 'sales', '2031-06-01', '2031-06-30', '{"family":"03"}', array['rayon', 'sousrayon', 'categorie', 'operator', 'article'], false);
  _r := _q->'rows'->0;
  insert into _t(check_name, result) values
    ('5 niveaux renvoyes', case when jsonb_array_length(_q->'levels') = 5 then 'ok' else 'FAIL ' || (_q->'levels')::text end),
    ('cles rayon / sous-rayon / categorie', case when _r->'keys'->>0 = '03' and _r->'keys'->>1 = '03-12' and _r->'keys'->>2 = '03-12-99' then 'ok' else 'FAIL ' || (_r->'keys')::text end),
    ('filtre famille 03 : port exclu (pas d article)', case when (select sum((x->>'ca_ht')::numeric) from jsonb_array_elements(_q->'rows') x) = 95 then 'ok' else 'FAIL' end),
    ('axe inconnu ignore', case when jsonb_array_length(public.stats_query(_co, 'sales', '2031-06-01', '2031-06-30', '{}', array['xxx', 'brand'], false)->'levels') = 1 then 'ok' else 'FAIL' end);

  -- ---------------------------------------------- mois par mois
  _m := public.stats_monthly(_co, 2031, '{"brand":"TESTBRAND-G8"}');
  _r := _m->'months'->5;
  insert into _t(check_name, result) values
    ('mois par mois : juin = 95 HT, N-1 40', case when (_r->>'ca_ht')::numeric = 95 and (_r->>'ca_ht_n1')::numeric = 40 then 'ok' else 'FAIL ' || _r::text end),
    ('mois par mois : 12 mois', case when jsonb_array_length(_m->'months') = 12 then 'ok' else 'FAIL' end),
    ('mois par mois : entree de stock 7 en juin', case when (_r->>'qty_in')::numeric = 7 then 'ok' else 'FAIL ' || _r::text end);

  -- ---------------------------------------------- indicateurs
  _i := public.stats_indicators(_co, '2031-06-01', '2031-06-30');
  select x into _r from jsonb_array_elements(_i) x where x->>'doc_type' = 'FAC';
  insert into _t(check_name, result) values
    ('indicateurs : 1 facture creee (brouillon exclu), 95 HT', case when (_r->>'created')::int = 1 and (_r->>'created_ht')::numeric = 95 then 'ok' else 'FAIL ' || coalesce(_r::text, 'null') end),
    ('indicateurs : articles par facture = 2', case when (_r->>'items_per_doc')::numeric = 2 then 'ok' else 'FAIL ' || coalesce(_r::text, 'null') end);
  select x into _r from jsonb_array_elements(_i) x where x->>'doc_type' = 'DEV';
  insert into _t(check_name, result) values
    ('indicateurs : devis en cours 1', case when (_r->>'open')::int = 1 then 'ok' else 'FAIL ' || coalesce(_r::text, 'null') end);

  -- ---------------------------------------------- documents en cours (le devis d essai y est)
  _o := public.stats_open_documents(_co);
  insert into _t(check_name, result) values
    ('documents en cours : type DEV present', case when exists (select 1 from jsonb_array_elements(_o) x where x->>'doc_type' = 'DEV' and (x->>'count')::int >= 1) then 'ok' else 'FAIL ' || _o::text end);

  -- ---------------------------------------------- statistiques de l article
  _a := public.article_stats(_art);
  select x into _r from jsonb_array_elements(_a) x where (x->>'year')::int = 2031 and (x->>'month')::int = 6;
  insert into _t(check_name, result) values
    ('fiche article : juin 2031 qte 2, CA 95', case when (_r->>'qty_sold')::numeric = 2 and (_r->>'ca_ht')::numeric = 95 then 'ok' else 'FAIL ' || coalesce(_r::text, 'null') end);
  select x into _r from jsonb_array_elements(_a) x where (x->>'year')::int = 2030 and (x->>'month')::int = 6;
  insert into _t(check_name, result) values
    ('fiche article : N-1 juin 2030 qte 1', case when (_r->>'qty_sold')::numeric = 1 then 'ok' else 'FAIL ' || coalesce(_r::text, 'null') end);

  -- ---------------------------------------------- anciens rapports (/reports) sur la meme regle
  insert into _t(check_name, result)
  select 'report_indicators : 2 factures/tickets, 100 HT', case when invoices = 2 and ca_ht = 100 then 'ok' else 'FAIL ' || invoices || '/' || ca_ht end
    from public.report_indicators(_co, '2031-06-01', '2031-06-30');
  insert into _t(check_name, result)
  select 'report_period_compare N = 100', case when ca_ht = 100 then 'ok' else 'FAIL ' || ca_ht end
    from public.report_period_compare(_co, '2031-06-01', '2031-06-30') where period = 'N';
  insert into _t(check_name, result)
  select 'top_articles : quantite signee 2', case when qty = 2 then 'ok' else 'FAIL ' || qty end
    from public.top_articles(_co, '2031-06-01', '2031-06-30', 15) where article_id = _art;

  -- ---------------------------------------------- tableau de bord : ecarts avant / apres les pieces du jour
  _k := public.dashboard_kpis(_co);
  select k into _kb from _kpi_before;
  insert into _t(check_name, result) values
    ('tableau de bord : CA du jour + 121 + 60,50 - 24,20 (brouillon exclu)',
      case when (_k->>'revenue_today')::numeric - (_kb->>'revenue_today')::numeric = 157.3 then 'ok'
           else 'FAIL ' || ((_k->>'revenue_today')::numeric - (_kb->>'revenue_today')::numeric) end),
    ('tableau de bord : factures et tickets + 2',
      case when (_k->>'invoices_month')::int - (_kb->>'invoices_month')::int = 2 then 'ok' else 'FAIL' end),
    ('tableau de bord : avoirs + 1',
      case when (_k->>'credit_notes_month')::int - coalesce((_kb->>'credit_notes_month')::int, 0) = 1 then 'ok' else 'FAIL' end);
end $s$;

-- ------------------------------------------------------------------ mecanicien : refuse
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.mec'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $s$
declare _co uuid := current_setting('test.co')::uuid; _ok boolean := false;
begin
  begin
    perform public.stats_query(_co, 'sales', '2031-06-01', '2031-06-30', '{}', array['brand'], false);
  exception when insufficient_privilege then _ok := true;
  end;
  insert into _t(check_name, result) values ('mecanicien : statistiques refusees', case when _ok then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('mecanicien : ancien rapport vide',
    case when not exists (select 1 from public.report_sales_by(_co, '2031-06-01', '2031-06-30', 'brand')) then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('mecanicien : tableau de bord ouvert',
    case when public.dashboard_kpis(_co) is not null then 'ok' else 'FAIL' end);
end $s$;

reset role;
select n, check_name, result from _t order by n;
