-- =====================================================================
-- Lot « OR lisible » (19/11/2026) — essai a blanc de 20261119310000_m8_or_lisible_repli_entretien.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base).
-- Joue un administrateur d'ITALBIKE STORE (claims JWT simulees). Scenario, sur la vraie moto de
-- l'essai du client (Monster 1100 S 2009, modele-annee 1468) et sur une moto d'essai creee ici :
--   kit annuel sans piece sur un 2 soupapes → le kit huile s'ajoute (filtre, joint, huile) ;
--   les lignes de service (DDS, controles) ne sont pas doublees ; « annuel + huile » inchange ;
--   un modele-annee dont l'annuel a des pieces ne change pas ; le plan Monster 696-796-1100 est
--   lie au 1100 S 2009 ; la liste des operations de l'OR se construit depuis ce plan (dont la
--   vidange) ; la proposition automatique reconnait « famille + modele » ; droits inchanges.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _c uuid; _v uuid; _or uuid; _o1 text; _o2 text;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values (_co, 'particulier', 'TEST', 'OR LISIBLE', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes, ducati_model_year_id)
  values (_co, 'DUCATI', 'MONSTER 1100 S', 'vendu', 'ESSAI A BLANC', '1468') returning id into _v;
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, reason_code)
  values (_co, 'ESSAI-ORL-1', _c, _v, 8886, 'a_faire', 'entretien_annuel') returning id into _or;
  perform set_config('test.v', _v::text, true);
  perform set_config('test.or', _or::text, true);
  -- un modele-annee dont le kit annuel contient des pieces : pas de repli
  select y.model_year_id into _o1
    from public.maintenance_kits k join public.maintenance_kit_model_years y on y.kit_id = k.id
   where k.company_id = _co and k.status = 'actif' and coalesce(k.service_kind, '') = 'annual'
     and public._workshop_kit_has_parts(public._workshop_kit_for(_co, y.model_year_id, 'annual'))
   limit 1;
  perform set_config('test.other1', coalesce(_o1, ''), true);
  -- un modele-annee 4 soupapes dont l'annuel est sans piece : pas de repli
  select y.model_year_id into _o2
    from public.maintenance_kits k join public.maintenance_kit_model_years y on y.kit_id = k.id
    join public.maintenance_engine_profiles p on p.id = public._maintenance_engine_profile_for(k.id)
   where k.company_id = _co and k.status = 'actif' and coalesce(k.service_kind, '') = 'annual' and p.code <> 'deux_soupapes'
     and not public._workshop_kit_has_parts(public._workshop_kit_for(_co, y.model_year_id, 'annual'))
     and public._workshop_kit_has_parts(public._workshop_kit_for(_co, y.model_year_id, 'oil'))
   limit 1;
  perform set_config('test.other2', coalesce(_o2, ''), true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _v uuid := current_setting('test.v')::uuid;
  _or uuid := current_setting('test.or')::uuid; n int; m int; r jsonb; _codes text[]; _other text;
begin
  -- 1. Codes des kits
  _codes := public._workshop_service_kit_codes_for(_co, '1468', 'annual');
  insert into _t(check_name, result) values ('1468 annuel : kits annuel + huile', case when _codes = array['annual','oil'] then 'ok' else 'KO ' || _codes::text end);
  _codes := public._workshop_service_kit_codes_for(_co, '1468', 'oil');
  insert into _t(check_name, result) values ('1468 annuel + huile : inchange', case when _codes = array['annual','oil'] then 'ok' else 'KO ' || _codes::text end);
  _codes := public._workshop_service_kit_codes_for(_co, '1468', 'desmo');
  insert into _t(check_name, result) values ('1468 desmo : inchange', case when _codes = array['desmo'] then 'ok' else 'KO ' || _codes::text end);
  _codes := public._workshop_service_kit_codes_for(null, '1468', 'annual');
  insert into _t(check_name, result) values ('sans societe : codes de base', case when _codes = array['annual'] then 'ok' else 'KO ' || _codes::text end);

  _other := nullif(current_setting('test.other1'), '');
  _codes := public._workshop_service_kit_codes_for(_co, _other, 'annual');
  insert into _t(check_name, result) values ('annuel avec pieces : pas de repli', case when _other is null or _codes = array['annual'] then 'ok' else 'KO ' || _codes::text end);

  _other := nullif(current_setting('test.other2'), '');
  _codes := public._workshop_service_kit_codes_for(_co, _other, 'annual');
  insert into _t(check_name, result) values ('autre profil moteur : pas de repli', case when _other is null or _codes = array['annual'] then 'ok' else 'KO ' || _codes::text end);

  -- 2. Kit de la moto (pieces seules) et lignes du kit (toutes)
  select count(*) into n from public.workshop_service_kit(_v, 'annual');
  insert into _t(check_name, result) values ('kit annuel 1100 S : 3 pieces (filtre, joint, huile)', case when n = 3 then 'ok' else 'KO ' || n end);
  select count(*) into n from public.workshop_service_kit(_v, 'annual') where designation ilike '%filtre%';
  insert into _t(check_name, result) values ('filtre a huile present', case when n = 1 then 'ok' else 'KO ' || n end);
  select count(*), count(*) filter (where kind = 'forfait') into n, m from public.workshop_service_kit_lines(_v, 'annual');
  insert into _t(check_name, result) values ('lignes du kit : 3 pieces + 10 lignes de service, sans doublon', case when n = 13 and m = 10 then 'ok' else 'KO ' || n || '/' || m end);
  select count(*) into n from (select article_id from public.workshop_service_kit_lines(_v, 'annual') where article_id is not null group by 1 having count(*) > 1) d;
  insert into _t(check_name, result) values ('aucun article en double', case when n = 0 then 'ok' else 'KO ' || n end);

  -- 3. Plan d'entretien de la moto
  select count(*) into n from public.maintenance_plan_catalog_links where model_year_id = '1468' and plan_id = 'monster696_796_1100_08_14' and status = 'lie';
  insert into _t(check_name, result) values ('1100 S 2009 lie au plan Monster 696-796-1100', case when n = 1 then 'ok' else 'KO ' || n end);
  select count(*) into n from public.maintenance_plan_catalog_links where model_year_id = '1469' and plan_id = 'monster696_796_1100_08_14' and status = 'lie';
  insert into _t(check_name, result) values ('1100 S 2010 lie aussi', case when n = 1 then 'ok' else 'KO ' || n end);
  select count(*) into n from public.maintenance_plan_catalog_links l join public.ducati_catalog_model_years y on y.id = l.model_year_id
   where l.plan_id = 'diavel_11_18' and l.reason like 'Famille + mod%' and l.status = 'lie'
     and exists (select 1 from public.ducati_catalog_models m where m.id = y.model_id and m.description ilike '%XDIAVEL%');
  insert into _t(check_name, result) values ('XDiavel pas lie d''office au plan Diavel (variante du nom)', case when n = 0 then 'ok' else 'KO ' || n end);

  r := public.repair_order_operations_init(_or, false);
  insert into _t(check_name, result) values ('liste des operations construite depuis le plan Ducati', case when r->>'status' = 'created' and r->>'source' = 'plan' and (r->>'count')::int >= 20 then 'ok' else 'KO ' || r::text end);
  select count(*) into n from public.repair_order_plan_operations where or_id = _or and label ilike 'Vidange de l''huile moteur%';
  insert into _t(check_name, result) values ('la vidange fait partie des operations', case when n = 1 then 'ok' else 'KO ' || n end);

  -- 4. Proposition automatique : relancee, elle ne casse rien et ne duplique pas
  r := public.maintenance_propose_catalog_links(_co);
  insert into _t(check_name, result) values ('proposition relancee sans doublon', case when (r->>'linked')::int = 0 then 'ok' else 'KO ' || r::text end);

  -- 5. Droits : fonctions internes non appelables directement
  begin
    perform public._workshop_kit_has_parts(null);
    insert into _t(check_name, result) values ('_workshop_kit_has_parts interdit au client', 'KO appel accepte');
  exception when insufficient_privilege then
    insert into _t(check_name, result) values ('_workshop_kit_has_parts interdit au client', 'ok');
  end;
end $s$;

reset role;
