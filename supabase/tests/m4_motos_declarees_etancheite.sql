-- =====================================================================
-- Mission 04, carte 8 — test d'étanchéité du portail et du circuit de validation.
-- À exécuter DANS UNE TRANSACTION ANNULÉE (aucune donnée de test ne reste en base) :
--   (echo "begin;"; cat supabase/tests/m4_motos_declarees_etancheite.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Crée deux comptes clients fictifs (A et B) dans la société ITALBIKE STORE, puis vérifie :
--   - A déclare une moto ; B ne la voit pas et ne peut pas y déposer de fichier ;
--   - un client ne peut ni lister ni valider les déclarations de l'équipe ;
--   - anon n'exécute aucune des nouvelles fonctions ;
--   - la cloche reçoit l'alerte, visible vendeur/admin, pas mécanicien ;
--   - après validation par un vendeur, la moto apparaît chez A et pas chez B.
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare
  _co uuid := (select id from public.companies where name ilike 'ITALBIKE%' limit 1);
  _ua uuid := gen_random_uuid(); _ub uuid := gen_random_uuid();
  _ca uuid; _cb uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (_ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-a-' || _ua || '@example.invalid', '{}', now(), now()),
         (_ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-b-' || _ub || '@example.invalid', '{}', now(), now());
  insert into public.contacts (company_id, type, first_name, last_name) values (_co, 'particulier', 'TEST', 'CLIENT A') returning id into _ca;
  insert into public.contacts (company_id, type, first_name, last_name) values (_co, 'particulier', 'TEST', 'CLIENT B') returning id into _cb;
  insert into public.contact_accounts (company_id, contact_id, user_id) values (_co, _ca, _ua), (_co, _cb, _ub);
  perform set_config('test.ua', _ua::text, true); perform set_config('test.ub', _ub::text, true);
  perform set_config('test.ca', _ca::text, true); perform set_config('test.co', _co::text, true);
end $s$;

-- ------------------------------------------------ droits
insert into _t(check_name, result)
select 'anon ne peut exécuter ' || f, case when has_function_privilege('anon', f, 'execute') then 'FAIL' else 'ok' end
  from unnest(array[
    'public.portal_declare_vehicle(text,text,integer,text,text)',
    'public.portal_prepare_declaration_upload(uuid,text,text,bigint)',
    'public.portal_declared_vehicles()',
    'public.declared_vehicles_pending(uuid)',
    'public.declared_vehicle_attach(uuid,uuid,date)',
    'public.declared_vehicle_create(uuid,jsonb,date)',
    'public.declared_vehicle_ignore(uuid,text)',
    'public.vehicle_create_for_contact(uuid,uuid,jsonb,date)',
    'public.vehicle_attach_owner(uuid,uuid,date,text)',
    'public.vehicles_find_by_vin(uuid,text,uuid)']) f;

-- ------------------------------------------------ client A déclare
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ua'), 'role', 'authenticated')::text, true);
do $a$
declare _id uuid; _id2 uuid;
begin
  _id := public.portal_declare_vehicle('ducati', 'Monster 937', 2022, 'zdm-test-vin-000001', '1-abc-123');
  _id2 := public.portal_declare_vehicle('Yamaha', 'MT-07', 2019, null, null);
  perform set_config('test.decl', _id::text, true); perform set_config('test.decl2', _id2::text, true);
  insert into _t(check_name, result) values ('A voit ses 2 déclarations',
    case when jsonb_array_length(public.portal_declared_vehicles()) = 2 then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('déclaration « à valider », pas dans le parc de A',
    case when (public.portal_declared_vehicles()->0->>'status') = 'a_valider'
              and jsonb_array_length(public.portal_vehicles()) = 0 then 'ok' else 'FAIL' end);
  begin
    perform public.declared_vehicles_pending(current_setting('test.co')::uuid);
    insert into _t(check_name, result) values ('un client ne lit pas la liste de l''équipe', 'FAIL');
  exception when insufficient_privilege then
    insert into _t(check_name, result) values ('un client ne lit pas la liste de l''équipe', 'ok');
  end;
  begin
    perform public.declared_vehicle_ignore(_id, 'x');
    insert into _t(check_name, result) values ('un client ne valide pas', 'FAIL');
  exception when insufficient_privilege then
    insert into _t(check_name, result) values ('un client ne valide pas', 'ok');
  end;
  begin
    perform public.portal_declare_vehicle('', 'X', null, null, null);
    insert into _t(check_name, result) values ('marque obligatoire', 'FAIL');
  exception when others then
    insert into _t(check_name, result) values ('marque obligatoire', case when sqlerrm like '%brand required%' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
end $a$;

-- ------------------------------------------------ client B
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ub'), 'role', 'authenticated')::text, true);
do $b$
begin
  insert into _t(check_name, result) values ('B ne voit pas les déclarations de A',
    case when jsonb_array_length(public.portal_declared_vehicles()) = 0 then 'ok' else 'FAIL' end);
  begin
    perform public.portal_prepare_declaration_upload(current_setting('test.decl')::uuid, 'cg.jpg', 'image/jpeg', 1000);
    insert into _t(check_name, result) values ('B ne dépose rien sur la déclaration de A', 'FAIL');
  exception when others then
    insert into _t(check_name, result) values ('B ne dépose rien sur la déclaration de A',
      case when sqlerrm like '%declaration not found%' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  insert into _t(check_name, result) values ('B ne lit pas la table des déclarations (RLS)',
    case when (select count(*) from public.contact_declared_vehicles) = 0 then 'ok' else 'FAIL' end);
end $b$;

-- ------------------------------------------------ A dépose la photo de sa carte grise
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ua'), 'role', 'authenticated')::text, true);
do $u$
declare _r jsonb;
begin
  _r := public.portal_prepare_declaration_upload(current_setting('test.decl')::uuid, 'cg.jpg', 'image/jpeg', 1000);
  insert into _t(check_name, result) values ('A prépare le dépôt, chemin fixé par la base sur SA fiche',
    case when _r->>'path' like current_setting('test.co') || '/contact/' || current_setting('test.ca') || '/portail_%.jpg' then 'ok' else 'FAIL' end);
  insert into _t(check_name, result) values ('A peut écrire ce seul chemin',
    case when public.portal_can_write_object(_r->>'path') and not public.portal_can_write_object(current_setting('test.co') || '/contact/x/y.jpg') then 'ok' else 'FAIL' end);
end $u$;

-- ------------------------------------------------ équipe
reset role;
insert into _t(check_name, result)
select 'alerte cloche créée pour chaque déclaration',
  case when (select count(*) from public.team_notifications n where n.kind = 'vehicle_declared'
              and n.contact_id = current_setting('test.ca')::uuid) = 2 then 'ok' else 'FAIL' end;

set local role authenticated;
-- vendeur (simon@ducatibxl.be)
select set_config('request.jwt.claims', '{"sub":"ea0e5718-a32d-423d-addd-e3112ec7b471","role":"authenticated"}', true);
do $v$
declare _list jsonb; _vid uuid;
begin
  insert into _t(check_name, result) values ('vendeur voit l''alerte',
    case when public.can_see_team_notification(current_setting('test.co')::uuid, 'vehicle_declared') then 'ok' else 'FAIL' end);
  _list := public.declared_vehicles_pending(current_setting('test.co')::uuid);
  insert into _t(check_name, result) values ('vendeur voit la déclaration à valider',
    case when exists (select 1 from jsonb_array_elements(_list) e where e->>'id' = current_setting('test.decl')) then 'ok' else 'FAIL' end);
  _vid := public.declared_vehicle_create(current_setting('test.decl')::uuid,
            '{"vin":"ZDMTESTVIN000001","brand":"DUCATI","model":"MONSTER 937"}'::jsonb, null);
  perform set_config('test.vid', _vid::text, true);
  insert into _t(check_name, result) values ('fiche créée au nom de A, tracée',
    case when exists (select 1 from public.vehicle_owners o where o.vehicle_id = _vid and o.contact_id = current_setting('test.ca')::uuid and o.is_current)
          and exists (select 1 from public.events e where e.action = 'vehicle_declaration_created' and e.entity_id = current_setting('test.decl'))
          and (select article_id from public.vehicles where id = _vid) is null then 'ok' else 'FAIL' end);
  begin
    perform public.declared_vehicle_ignore(current_setting('test.decl')::uuid, null);
    insert into _t(check_name, result) values ('pas de double validation', 'FAIL');
  exception when others then
    insert into _t(check_name, result) values ('pas de double validation', case when sqlerrm like '%ALREADY_REVIEWED%' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  perform public.declared_vehicle_ignore(current_setting('test.decl2')::uuid, 'doublon');
end $v$;

-- mécanicien (simon+1@themaul.be) : pas l'alerte
select set_config('request.jwt.claims', '{"sub":"088da12b-d29d-452c-9b05-f245362d43a4","role":"authenticated"}', true);
insert into _t(check_name, result)
select 'mécanicien ne voit pas l''alerte',
  case when not public.can_see_team_notification(current_setting('test.co')::uuid, 'vehicle_declared')
        and (select count(*) from public.team_notifications where kind = 'vehicle_declared'
              and contact_id = current_setting('test.ca')::uuid) = 0 then 'ok' else 'FAIL' end;

-- ------------------------------------------------ après validation
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ua'), 'role', 'authenticated')::text, true);
insert into _t(check_name, result)
select 'A voit sa moto validée, et la déclaration ignorée « non retenue »',
  case when exists (select 1 from jsonb_array_elements(public.portal_vehicles()) e where e->>'id' = current_setting('test.vid'))
        and (select string_agg(e->>'status', ',') from jsonb_array_elements(public.portal_declared_vehicles()) e) = 'ignoree'
       then 'ok' else 'FAIL' end;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.ub'), 'role', 'authenticated')::text, true);
insert into _t(check_name, result)
select 'B ne voit pas la moto de A',
  case when jsonb_array_length(public.portal_vehicles()) = 0 then 'ok' else 'FAIL' end;
do $w$
begin
  perform public.portal_vehicle(current_setting('test.vid')::uuid);
  insert into _t(check_name, result) values ('B ne peut pas ouvrir la moto de A', 'FAIL');
exception when others then
  insert into _t(check_name, result) values ('B ne peut pas ouvrir la moto de A', case when sqlerrm like '%vehicle not found%' then 'ok' else 'FAIL ' || sqlerrm end);
end $w$;

reset role;
select check_name, result from _t order by n;
