-- =====================================================================
-- Lot « numerotation G8 » (18/11/2026) — essai a blanc de la migration 20261118260000.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118260000_m0_numerotation_deux_modes.sql \
--    supabase/tests/m0_numerotation_deux_modes.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Cree une societe de test (annulee avec la transaction), joue le role d un administrateur (claims
-- JWT simulees) et verifie :
--   - societe sans document : passage immediat au compteur unique accepte et trace ;
--   - compteur unique : facture / ticket / avoir entrelaces sur UN compteur continu, sans doublon,
--     les series FAC / TIK / AVO ne bougent pas ;
--   - validation atomique : un brouillon refuse (sans client) ne consomme aucun numero ;
--   - changement de mode refuse avec des documents numerotes dans l exercice (societe de test ET
--     ITALBIKE STORE), programmation au 1er janvier suivant acceptee puis appliquee et tracee ;
--   - series separees : chaque serie continue, sans doublon ;
--   - prochain numero : vers le haut seulement, motif obligatoire, trace ; jamais par l API directe ;
--   - prefixe en double refuse, suppression d une serie impossible, role vendeur refuse ;
--   - plus de troncature au-dela de la longueur.
-- La continuite SOUS CONCURRENCE (plusieurs sessions) est verifiee par m0_numerotation_concurrence.sql.
-- Chaque ligne du resultat doit valoir « ok » (« avis » pour l index d unicite : voir le detail).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- Societes et donnees de test (role postgres : configuration)
do $s$
declare _u uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e'; _co uuid; _co2 uuid; _ct uuid;
begin
  insert into public.companies (code, name, legal_name, country)
  values ('test-numerotation', 'TEST NUMEROTATION', 'TEST NUMEROTATION', 'BE') returning id into _co;
  insert into public.companies (code, name, legal_name, country)
  values ('test-numerotation-2', 'TEST NUMEROTATION VENDEUR', 'TEST NUMEROTATION VENDEUR', 'BE') returning id into _co2;
  insert into public.user_roles (user_id, company_id, role) values (_u, _co, 'admin'), (_u, _co2, 'vendeur');
  insert into public.contacts (company_id, type, company_name, country)
  values (_co, 'professionnel', 'TEST CLIENT NUMEROTATION', 'BE') returning id into _ct;
  perform set_config('test.co', _co::text, true);
  perform set_config('test.co2', _co2::text, true);
  perform set_config('test.ct', _ct::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := current_setting('test.co')::uuid;
  _co2 uuid := current_setting('test.co2')::uuid;
  _ct uuid := current_setting('test.ct')::uuid;
  _italbike uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _y int := public._numbering_year();
  _types text[] := array['FAC', 'TIK', 'AVO'];
  _nums text[] := '{}'; _num text; _i int; _ok boolean; _msg text; _o jsonb; _doc uuid; _bad uuid;
  _before bigint; _after bigint; _seq uuid;
begin
  -- ------------------------------------------------ societe neuve : mode separe par defaut
  _o := public.numbering_overview(_co);
  insert into _t(check_name, result) values
    ('defaut : series separees', case when _o->>'sales_mode' = 'separate' then 'ok' else 'FAIL ' || _o::text end),
    ('defaut : changement possible (aucun document)', case when (_o->>'can_change_now')::boolean then 'ok' else 'FAIL' end),
    ('admin : peut gerer la numerotation', case when (_o->>'can_manage')::boolean then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ passage immediat au compteur unique (aucun document)
  _o := public.set_sales_numbering_mode(_co, 'single', false);
  insert into _t(check_name, result) values
    ('societe sans document : passage au compteur unique accepte', case when _o->>'sales_mode' = 'single' then 'ok' else 'FAIL' end),
    ('changement de mode trace dans events', case when exists (select 1 from public.events where company_id = _co and action = 'numbering_mode_change'
       and new_data->>'sales_mode' = 'single') then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ compteur unique : 60 numeros entrelaces FAC / TIK / AVO
  for _i in 1..60 loop
    _nums := _nums || public.next_document_number(_co, _types[1 + (_i % 3)]);
  end loop;
  insert into _t(check_name, result) values
    ('compteur unique : 60 numeros continus 00000001 a 00000060',
       case when _nums = (select array_agg(lpad(g::text, 8, '0') order by g) from generate_series(1, 60) g) then 'ok' else 'FAIL ' || array_to_string(_nums[1:5], ',') end),
    ('compteur unique : series FAC / TIK / AVO non entamees',
       case when not exists (select 1 from public.document_sequences where company_id = _co and doc_type in ('FAC', 'TIK', 'AVO') and next_value > 1)
       then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ validation atomique (numero + statut, meme transaction)
  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc)
  values (_co, 'FAC', 'brouillon', _ct, current_date, 100, 21, 121) returning id into _doc;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order)
  values (_doc, 'TEST numerotation', 1, 100, 21, 100, 121, 0);
  _num := public.document_assign_number(_doc);
  insert into _t(check_name, result) values
    ('validation : la facture prend le numero suivant du compteur unique', case when _num = '00000061'
       and (select status from public.documents where id = _doc) = 'validee' then 'ok' else 'FAIL ' || coalesce(_num, 'null') end),
    ('validation : rappel sur un document deja numerote = meme numero', case when public.document_assign_number(_doc) = '00000061' then 'ok' else 'FAIL' end);

  insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc)
  values (_co, 'FAC', 'brouillon', null, current_date, 100, 21, 121) returning id into _bad;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order)
  values (_bad, 'TEST sans client', 1, 100, 21, 100, 121, 0);
  select next_value into _before from public.document_sequences where company_id = _co and doc_type = 'VEN';
  _ok := false;
  begin
    perform public.document_assign_number(_bad);
  exception when others then _ok := true;
  end;
  select next_value into _after from public.document_sequences where company_id = _co and doc_type = 'VEN';
  insert into _t(check_name, result) values
    ('validation refusee (sans client) : aucun numero consomme, pas de trou',
       case when _ok and _before = _after and (select number from public.documents where id = _bad) is null then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ changement de mode refuse en cours d exercice
  _ok := false;
  begin
    perform public.set_sales_numbering_mode(_co, 'separate', false);
  exception when others then _ok := true; _msg := sqlerrm;
  end;
  insert into _t(check_name, result) values
    ('documents valides dans l exercice : changement immediat refuse', case when _ok and _msg like 'Changement refusé%' then 'ok' else 'FAIL ' || coalesce(_msg, '') end),
    ('refus : le mode reste le compteur unique', case when public.numbering_overview(_co)->>'sales_mode' = 'single' then 'ok' else 'FAIL' end);

  _ok := false; _msg := null;
  begin
    perform public.set_sales_numbering_mode(_italbike, 'single', false);
  exception when others then _ok := true; _msg := sqlerrm;
  end;
  insert into _t(check_name, result) values
    ('ITALBIKE STORE (factures 2026 deja emises) : changement immediat refuse', case when _ok and _msg like 'Changement refusé%' then 'ok' else 'FAIL ' || coalesce(_msg, 'accepte') end);

  -- ------------------------------------------------ programmation au 1er janvier suivant
  _o := public.set_sales_numbering_mode(_co, 'separate', true);
  insert into _t(check_name, result) values
    ('programmation au 1er janvier suivant acceptee', case when _o->>'next_sales_mode' = 'separate' and (_o->>'next_sales_mode_year')::int = _y + 1 then 'ok' else 'FAIL ' || _o::text end),
    ('programmation tracee', case when exists (select 1 from public.events where company_id = _co and action = 'numbering_mode_scheduled') then 'ok' else 'FAIL' end),
    ('programmation : le mode en cours ne change pas avant l echeance', case when public.numbering_overview(_co)->>'sales_mode' = 'single'
       and public.next_document_number(_co, 'TIK') = '00000062' then 'ok' else 'FAIL' end);
end $s$;

-- Simule le passage a l exercice suivant (role postgres : l echeance programmee est atteinte)
reset role;
update public.numbering_settings set next_sales_mode_year = public._numbering_year() where company_id = current_setting('test.co')::uuid;
set local role authenticated;

do $s$
declare
  _co uuid := current_setting('test.co')::uuid;
  _co2 uuid := current_setting('test.co2')::uuid;
  _y int := public._numbering_year();
  _types text[] := array['FAC', 'TIK', 'AVO'];
  _num text; _i int; _ok boolean; _msg text; _o jsonb; _seq uuid; _n int;
  _fac text[] := '{}'; _tik text[] := '{}'; _avo text[] := '{}';
begin
  -- ------------------------------------------------ series separees : chaque serie continue
  for _i in 1..30 loop
    _num := public.next_document_number(_co, _types[1 + (_i % 3)]);
    if _num like 'FAC%' then _fac := _fac || _num; elsif _num like 'TIK%' then _tik := _tik || _num; else _avo := _avo || _num; end if;
  end loop;
  insert into _t(check_name, result) values
    ('echeance atteinte : mode separe applique et trace', case when exists (select 1 from public.events where company_id = _co and action = 'numbering_mode_applied')
       and (select sales_mode from public.numbering_settings where company_id = _co) = 'separate' then 'ok' else 'FAIL' end),
    ('series separees : FAC continue 1 a 10', case when _fac = (select array_agg('FAC-' || _y || '-' || lpad(g::text, 5, '0') order by g) from generate_series(1, 10) g) then 'ok' else 'FAIL ' || array_to_string(_fac, ',') end),
    ('series separees : TIK continue 1 a 10', case when _tik = (select array_agg('TIK-' || _y || '-' || lpad(g::text, 5, '0') order by g) from generate_series(1, 10) g) then 'ok' else 'FAIL' end),
    ('series separees : AVO continue 1 a 10', case when _avo = (select array_agg('AVO-' || _y || '-' || lpad(g::text, 5, '0') order by g) from generate_series(1, 10) g) then 'ok' else 'FAIL' end),
    ('series separees : le compteur unique est en sommeil', case when (select next_value from public.document_sequences where company_id = _co and doc_type = 'VEN') = 63 then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ prochain numero : vers le haut seulement, motif, trace
  select id into _seq from public.document_sequences where company_id = _co and doc_type = 'FAC';
  _ok := false; begin perform public.set_sequence_next_value(_seq, 5, 'Retour en arriere'); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('prochain numero : vers le bas refuse', case when _ok then 'ok' else 'FAIL' end);
  _ok := false; begin perform public.set_sequence_next_value(_seq, 11, 'Valeur identique'); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('prochain numero : valeur identique refusee', case when _ok then 'ok' else 'FAIL' end);
  _ok := false; begin perform public.set_sequence_next_value(_seq, 500, ''); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('prochain numero : motif obligatoire', case when _ok then 'ok' else 'FAIL' end);
  _o := public.set_sequence_next_value(_seq, 500, 'Demarrage apres les donnees de test');
  insert into _t(check_name, result) values
    ('prochain numero : vers le haut accepte', case when (_o->>'skipped')::int = 489 and public.next_document_number(_co, 'FAC') = 'FAC-' || _y || '-00500' then 'ok' else 'FAIL ' || _o::text end),
    ('prochain numero : trace avec motif', case when exists (select 1 from public.events where company_id = _co and action = 'numbering_next_value_change'
       and new_data->>'reason' = 'Demarrage apres les donnees de test' and (old_data->>'next_value')::int = 11) then 'ok' else 'FAIL' end);

  _ok := false; _msg := null;
  begin update public.document_sequences set next_value = 2 where id = _seq; exception when others then _ok := true; _msg := sqlerrm; end;
  insert into _t(check_name, result) values ('API directe : modifier le compteur refuse', case when _ok and _msg like 'Le prochain numéro ne se modifie pas directement%' then 'ok' else 'FAIL ' || coalesce(_msg, 'accepte') end);

  _ok := false;
  begin update public.document_sequences set prefix = 'TIK' where id = _seq; exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('prefixe deja pris par une autre serie : refuse', case when _ok then 'ok' else 'FAIL' end);

  update public.document_sequences set label = 'Facture (test)' where id = _seq;
  insert into _t(check_name, result) values ('changement de format trace', case when exists (select 1 from public.events where company_id = _co
       and action = 'numbering_format_change' and new_data->>'label' = 'Facture (test)') then 'ok' else 'FAIL' end);

  _ok := false;
  begin delete from public.document_sequences where id = _seq; get diagnostics _n = row_count; _ok := _n = 0; exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('une serie ne se supprime pas par l API', case when _ok and exists (select 1 from public.document_sequences where id = _seq) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ plus de troncature au-dela de la longueur
  update public.document_sequences set padding = 2 where id = _seq;
  insert into _t(check_name, result) values ('numero plus long que la longueur : garde tous ses chiffres',
    case when public.next_document_number(_co, 'FAC') = 'FAC-' || _y || '-501' then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ role vendeur : ni mode ni prochain numero
  _ok := false; begin perform public.set_sales_numbering_mode(_co2, 'single', false); exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('vendeur : changement de mode refuse', case when _ok then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('vendeur : pas de gestion dans la vue d ensemble', case when not (public.numbering_overview(_co2)->>'can_manage')::boolean then 'ok' else 'FAIL' end);
end $s$;

reset role;
insert into _t(check_name, result) values
  ('index d unicite numero / societe', case when to_regclass('public.documents_company_number_uq') is not null then 'ok' else 'avis : doublons deja en base, index non pose (voir le NOTICE)' end),
  ('anon n execute pas set_sales_numbering_mode', case when has_function_privilege('anon', 'public.set_sales_numbering_mode(uuid,text,boolean)', 'execute') then 'FAIL' else 'ok' end),
  ('authenticated n execute pas la fonction interne', case when has_function_privilege('authenticated', 'public._next_document_number_unchecked(uuid,text)', 'execute') then 'FAIL' else 'ok' end),
  ('authenticated execute document_assign_number', case when has_function_privilege('authenticated', 'public.document_assign_number(uuid)', 'execute') then 'ok' else 'FAIL' end);

select n, check_name, result from _t order by n;
