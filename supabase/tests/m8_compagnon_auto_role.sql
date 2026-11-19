-- =====================================================================
-- Fiche compagnon automatique (19/11/2026) — essai a blanc de 20261119300000_m8_compagnon_auto_role.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119300000_m8_compagnon_auto_role.sql \
--      supabase/tests/m8_compagnon_auto_role.sql; echo "rollback;") > t.sql
-- Scenario (comptes fictifs @example.invalid, premiere societe) : role mecanicien -> fiche creee
-- (nom du profil, visible, horaires des autres) ; chef_atelier en plus -> toujours une fiche ;
-- retrait d'un des deux -> active ; retrait du dernier -> inactive, gardee ; role rendu -> la meme
-- fiche reactivee ; fiche du meme nom sans compte -> reliee ; profil sans nom -> l'e-mail ;
-- aucun autre mecanicien -> mardi-samedi 09:00-12:30 / 13:30-18:00 ; rattrapage ; garde-fou de
-- societe toujours actif ; suppression du compte possible ; migration rejouable.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

insert into _t(check_name, result)
select 'trigger et fonctions presents',
  case when exists (select 1 from pg_trigger where tgname = 'trg_user_roles_mechanic_sync' and tgrelid = 'public.user_roles'::regclass)
        and to_regprocedure('public.workshop_mechanic_sync(uuid,uuid)') is not null
        and to_regprocedure('public.workshop_mechanic_default_hours(uuid,uuid)') is not null
       then 'ok' else 'FAIL' end;

insert into _t(check_name, result)
select 'fonctions non executables par les comptes',
  case when not has_function_privilege('authenticated', 'public.workshop_mechanic_sync(uuid,uuid)', 'EXECUTE')
        and not has_function_privilege('anon', 'public.workshop_mechanic_sync(uuid,uuid)', 'EXECUTE')
       then 'ok' else 'FAIL' end;

insert into _t(check_name, result)
select 'aucune politique nouvelle sur les tables touchees',
  case when (select count(*) from pg_policies where schemaname = 'public' and tablename in ('workshop_mechanics', 'workshop_mechanic_hours', 'user_roles')) = 6
       then 'ok' else 'FAIL ' || (select count(*) from pg_policies where schemaname = 'public' and tablename in ('workshop_mechanics', 'workshop_mechanic_hours', 'user_roles')) end;

insert into _t(check_name, result)
select 'rattrapage : chaque compte mecanicien / chef d atelier a une fiche active',
  case when not exists (
    select 1 from public.user_roles ur where ur.role in ('mecanicien', 'chef_atelier')
      and not exists (select 1 from public.workshop_mechanics m where m.company_id = ur.company_id and m.user_id = ur.user_id and m.is_active))
  then 'ok' else 'FAIL' end;

do $s$
declare
  _co uuid := (select id from public.companies order by created_at, id limit 1);
  _a uuid := gen_random_uuid(); _b uuid := gen_random_uuid(); _c uuid := gen_random_uuid(); _d uuid := gen_random_uuid(); _e uuid := gen_random_uuid();
  _id uuid; _id2 uuid; _n int; _h int; _name text; _act boolean; _vis boolean; _u uuid; _err text; _free uuid; _cnt_before int;
  _ref_ok boolean;
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (_a, 'authenticated', 'authenticated', 'test-compagnon-a@example.invalid', '{"full_name":"Testeur Atelier"}'),
    (_b, 'authenticated', 'authenticated', 'test-compagnon-b@example.invalid', '{"full_name":"  livréur   TEST "}'),
    (_c, 'authenticated', 'authenticated', 'test-compagnon-c@example.invalid', '{}'),
    (_d, 'authenticated', 'authenticated', 'test-compagnon-d@example.invalid', '{"full_name":"Sans Collegue"}'),
    (_e, 'authenticated', 'authenticated', 'test-compagnon-e@example.invalid', '{"full_name":"Rattrape Test"}');

  -- 1. Role mecanicien -> fiche creee
  insert into public.user_roles (user_id, company_id, role) values (_a, _co, 'mecanicien');
  select count(*), max(name), bool_and(is_active), bool_and(visible_in_planning) into _n, _name, _act, _vis
  from public.workshop_mechanics where company_id = _co and user_id = _a;
  insert into _t(check_name, result) values ('role mecanicien : une fiche, nom du profil, active, visible',
    case when _n = 1 and _name = 'Testeur Atelier' and _act and _vis then 'ok' else 'FAIL ' || _n || ' ' || coalesce(_name, '') end);
  select id into _id from public.workshop_mechanics where company_id = _co and user_id = _a;

  -- Horaires = les plus courants des autres mecaniciens actifs (meme nombre de jours, memes heures).
  select count(*) into _h from public.workshop_mechanic_hours where mechanic_id = _id;
  select (select count(*) from public.workshop_mechanic_default_hours(_co, _id)) = _h
     and not exists (
       select weekday, am_start, am_end, pm_start, pm_end from public.workshop_mechanic_default_hours(_co, _id)
       except select weekday, am_start, am_end, pm_start, pm_end from public.workshop_mechanic_hours where mechanic_id = _id)
    into _ref_ok;
  insert into _t(check_name, result) values ('horaires repris des autres mecaniciens',
    case when _h > 0 and _ref_ok then 'ok' else 'FAIL ' || _h end);

  -- 2. chef_atelier en plus -> toujours une seule fiche
  insert into public.user_roles (user_id, company_id, role) values (_a, _co, 'chef_atelier');
  select count(*) into _n from public.workshop_mechanics where company_id = _co and user_id = _a;
  insert into _t(check_name, result) values ('deuxieme role atelier : pas de seconde fiche', case when _n = 1 then 'ok' else 'FAIL ' || _n end);

  -- 3. retrait d'un des deux roles -> reste active
  delete from public.user_roles where user_id = _a and company_id = _co and role = 'mecanicien';
  select is_active into _act from public.workshop_mechanics where id = _id;
  insert into _t(check_name, result) values ('un role atelier reste : fiche active', case when _act then 'ok' else 'FAIL' end);

  -- 4. retrait du dernier role (aucun autre role dans la societe) -> inactive, gardee, toujours reliee
  delete from public.user_roles where user_id = _a and company_id = _co;
  select count(*), bool_and(is_active), max(user_id::text)::uuid into _n, _act, _u from public.workshop_mechanics where id = _id;
  insert into _t(check_name, result) values ('dernier role retire : fiche inactive, jamais supprimee',
    case when _n = 1 and not _act and _u = _a then 'ok' else 'FAIL ' || _n || ' ' || coalesce(_act::text, 'NULL') end);
  select count(*) into _h from public.workshop_mechanic_hours where mechanic_id = _id;
  insert into _t(check_name, result) values ('horaires gardes avec la fiche inactive', case when _h > 0 then 'ok' else 'FAIL' end);

  -- 5. role rendu -> la meme fiche reactivee
  insert into public.user_roles (user_id, company_id, role) values (_a, _co, 'mecanicien');
  select count(*), max(id::text)::uuid, bool_and(is_active) into _n, _id2, _act from public.workshop_mechanics where company_id = _co and user_id = _a;
  insert into _t(check_name, result) values ('role rendu : meme fiche reactivee',
    case when _n = 1 and _id2 = _id and _act then 'ok' else 'FAIL' end);

  -- 6. Role non atelier : rien
  insert into public.user_roles (user_id, company_id, role) values (_c, _co, 'vendeur');
  select count(*) into _n from public.workshop_mechanics where company_id = _co and user_id = _c;
  insert into _t(check_name, result) values ('role vendeur : aucune fiche', case when _n = 0 then 'ok' else 'FAIL' end);

  -- 7. Profil sans nom -> l'e-mail
  insert into public.user_roles (user_id, company_id, role) values (_c, _co, 'chef_atelier');
  select name into _name from public.workshop_mechanics where company_id = _co and user_id = _c;
  insert into _t(check_name, result) values ('profil sans nom : la fiche porte l e-mail',
    case when _name = 'test-compagnon-c@example.invalid' then 'ok' else 'FAIL ' || coalesce(_name, 'NULL') end);

  -- 8. Fiche du meme nom sans compte -> reliee, pas de seconde fiche
  insert into public.workshop_mechanics (company_id, name, visible_in_planning, is_active, sort_order)
  values (_co, 'Livreur Test', true, true, 999) returning id into _free;
  select count(*) into _cnt_before from public.workshop_mechanics where company_id = _co;
  insert into public.user_roles (user_id, company_id, role) values (_b, _co, 'mecanicien');
  select user_id into _u from public.workshop_mechanics where id = _free;
  select count(*) into _n from public.workshop_mechanics where company_id = _co;
  insert into _t(check_name, result) values ('fiche du meme nom sans compte : reliee (accents, casse, espaces ignores)',
    case when _u = _b and _n = _cnt_before then 'ok' else 'FAIL ' || coalesce(_u::text, 'NULL') || ' ' || _n || '/' || _cnt_before end);

  -- 9. Aucun autre mecanicien actif -> mardi-samedi 09:00-12:30 / 13:30-18:00
  update public.workshop_mechanics set is_active = false where company_id = _co;
  insert into public.user_roles (user_id, company_id, role) values (_d, _co, 'mecanicien');
  select id into _id2 from public.workshop_mechanics where company_id = _co and user_id = _d;
  select count(*) into _h from public.workshop_mechanic_hours
  where mechanic_id = _id2 and weekday between 2 and 6
    and am_start = '09:00' and am_end = '12:30' and pm_start = '13:30' and pm_end = '18:00';
  select count(*) into _n from public.workshop_mechanic_hours where mechanic_id = _id2;
  insert into _t(check_name, result) values ('sans collegue : mardi-samedi 09:00-12:30 / 13:30-18:00',
    case when _h = 5 and _n = 5 then 'ok' else 'FAIL ' || _h || '/' || _n end);

  -- 10. Rattrapage : role pose sans le trigger, puis l'instruction de rattrapage de la migration
  alter table public.user_roles disable trigger trg_user_roles_mechanic_sync;
  insert into public.user_roles (user_id, company_id, role) values (_e, _co, 'mecanicien');
  alter table public.user_roles enable trigger trg_user_roles_mechanic_sync;
  select count(*) into _n from public.workshop_mechanics where company_id = _co and user_id = _e;
  perform public.workshop_mechanic_sync(r.user_id, r.company_id)
  from (select distinct ur.user_id, ur.company_id from public.user_roles ur where ur.role in ('mecanicien', 'chef_atelier')) r
  where not exists (select 1 from public.workshop_mechanics m where m.company_id = r.company_id and m.user_id = r.user_id and m.is_active);
  select count(*) into _h from public.workshop_mechanics where company_id = _co and user_id = _e and is_active;
  insert into _t(check_name, result) values ('rattrapage : le compte sans fiche en recoit une', case when _n = 0 and _h = 1 then 'ok' else 'FAIL ' || _n || '/' || _h end);

  -- Rejouable : le rattrapage une deuxieme fois ne cree rien
  select count(*) into _cnt_before from public.workshop_mechanics;
  perform public.workshop_mechanic_sync(ur.user_id, ur.company_id) from public.user_roles ur where ur.role in ('mecanicien', 'chef_atelier');
  select count(*) into _n from public.workshop_mechanics;
  insert into _t(check_name, result) values ('rejouable : aucune fiche en double', case when _n = _cnt_before then 'ok' else 'FAIL ' || _n || '/' || _cnt_before end);

  -- 11. Garde-fou : relier une fiche a un compte etranger a la societe reste refuse
  _err := null;
  begin
    insert into public.workshop_mechanics (company_id, user_id, name) values (_co, gen_random_uuid(), 'Etranger');
  exception when others then _err := sqlerrm;
  end;
  insert into _t(check_name, result) values ('garde-fou : compte hors societe refuse',
    case when _err is not null then 'ok' else 'FAIL accepte' end);
  _err := null;
  begin
    update public.workshop_mechanics set user_id = (select u.id from auth.users u where not exists (select 1 from public.user_roles r where r.user_id = u.id and r.company_id = _co) limit 1)
    where id = _free;
  exception when others then _err := sqlerrm;
  end;
  insert into _t(check_name, result) values ('garde-fou : changer le compte relie vers un compte hors societe refuse',
    case when _err is not null then 'ok' else 'FAIL accepte' end);

  -- 12. Suppression du compte : possible, la fiche reste (inactive, sans compte)
  _err := null;
  begin
    delete from auth.users where id = _d;
  exception when others then _err := sqlerrm;
  end;
  select count(*), bool_and(is_active), max(user_id::text) into _n, _act, _name from public.workshop_mechanics where id = _id2;
  insert into _t(check_name, result) values ('suppression du compte : fiche gardee, inactive, sans compte',
    case when _err is null and _n = 1 and not _act and _name is null then 'ok' else 'FAIL ' || coalesce(_err, '') end);
end $s$;
