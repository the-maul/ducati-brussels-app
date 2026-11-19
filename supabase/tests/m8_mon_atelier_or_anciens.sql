-- =====================================================================
-- « Mon atelier » : cartes lisibles (19/11/2026) — essai a blanc de
-- 20261119320000_m8_mon_atelier_or_anciens.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119320000_m8_mon_atelier_or_anciens.sql \
--      supabase/tests/m8_mon_atelier_or_anciens.sql; echo "rollback;") > t.sql
-- Scenario : colonne presente (14 par defaut, lignes existantes comprises) ; 1 et 365 acceptes,
-- 0, 366 et vide refuses ; migration rejouable ; politiques du reglage inchangees ; la colonne
-- relue par l'ecran se lit.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

insert into _t(check_name, result)
select 'colonne stale_or_days presente, 14 par defaut',
  case when exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'workshop_planning_settings'
                       and column_name = 'stale_or_days' and column_default = '14' and is_nullable = 'NO')
       then 'ok' else 'FAIL' end;

insert into _t(check_name, result)
select 'lignes existantes a 14 jours',
  case when not exists (select 1 from public.workshop_planning_settings where stale_or_days <> 14) then 'ok' else 'FAIL' end;

-- Bornes : une ligne de reglage (celle d'une societe existante, creee si besoin).
do $s$
declare _c uuid; _ok boolean;
begin
  select id into _c from public.companies order by created_at limit 1;
  insert into public.workshop_planning_settings (company_id) values (_c) on conflict (company_id) do nothing;

  update public.workshop_planning_settings set stale_or_days = 1 where company_id = _c;
  update public.workshop_planning_settings set stale_or_days = 365 where company_id = _c;
  insert into _t(check_name, result) values ('1 et 365 jours acceptes', 'ok');

  _ok := false;
  begin update public.workshop_planning_settings set stale_or_days = 0 where company_id = _c;
  exception when check_violation then _ok := true; end;
  insert into _t(check_name, result) values ('0 jour refuse', case when _ok then 'ok' else 'FAIL' end);

  _ok := false;
  begin update public.workshop_planning_settings set stale_or_days = 366 where company_id = _c;
  exception when check_violation then _ok := true; end;
  insert into _t(check_name, result) values ('366 jours refuses', case when _ok then 'ok' else 'FAIL' end);

  _ok := false;
  begin update public.workshop_planning_settings set stale_or_days = null where company_id = _c;
  exception when not_null_violation then _ok := true; end;
  insert into _t(check_name, result) values ('valeur vide refusee', case when _ok then 'ok' else 'FAIL' end);

  update public.workshop_planning_settings set stale_or_days = 21 where company_id = _c;
  insert into _t(check_name, result)
  select 'la valeur reglee se relit (requete de l ecran)',
    case when (select stale_or_days from public.workshop_planning_settings where company_id = _c) = 21 then 'ok' else 'FAIL' end;
end $s$;

-- Rejouable : la meme migration une deuxieme fois ne casse rien et ne remet pas la valeur a 14.
do $r$ begin
  alter table public.workshop_planning_settings add column if not exists stale_or_days smallint not null default 14;
  if (select count(*) from pg_constraint where conname = 'workshop_planning_settings_stale_or_days_chk') <> 1 then
    raise exception 'contrainte absente ou en double';
  end if;
  insert into _t(check_name, result)
  select 'migration rejouable, reglage garde',
    case when exists (select 1 from public.workshop_planning_settings where stale_or_days = 21) then 'ok' else 'FAIL' end;
end $r$;

insert into _t(check_name, result)
select 'RLS toujours active sur les reglages du planning',
  case when (select relrowsecurity from pg_class where oid = 'public.workshop_planning_settings'::regclass) then 'ok' else 'FAIL' end;

select n, check_name, result from _t order by n;
