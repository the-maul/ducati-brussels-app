-- =====================================================================
-- VP9 (décision du client, 20/11/2026, comme G8) — Planning : seuls les compagnons comptent dans la
-- charge (case par personne). Migration 20261120346000. ItalTest + lecture ITALBIKE STORE,
-- simon@themaul.be, transaction annulée (rt.py). La formule de charge (écran) est testée dans
-- tests/vp-g8.test.ts ; ici : le réglage et ses valeurs par défaut.
-- Contrôles :
--   1. colonne counts_in_load renseignée pour tous les compagnons (non nulle) ;
--   2. ITALBIKE STORE : John, Livio, Luis comptent ; Domenico Desouter, Simon, Simon-atelier non
--      (3 compagnons, comme G8 : 2 h sur 24 h = 8,33 %) ; idem ItalTest ;
--   3. nouveau compagnon sans compte : compte ; relié à un administrateur : ne compte pas ;
--   4. choix de l'écran gardé (case décochée / cochée) ;
--   5. capacité du mercredi 18/11 calculée comme l'écran sur les compagnons qui comptent : 24 h chez
--      ITALBIKE STORE si leurs horaires G8 sont posés (constat sinon).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

insert into _t(check_name, result)
select 'counts_in_load renseigne pour tous les compagnons',
       case when not exists (select 1 from public.workshop_mechanics where counts_in_load is null) then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'compagnons qui comptent (' || co.name || ') : ' || coalesce(string_agg(m.name, ', ' order by m.name) filter (where m.counts_in_load), '-')
       || ' / ne comptent pas : ' || coalesce(string_agg(m.name, ', ' order by m.name) filter (where not m.counts_in_load), '-'),
       case when coalesce(string_agg(m.name, ',' order by m.name) filter (where m.counts_in_load), '') = 'John,Livio,Luis'
                 and coalesce(string_agg(m.name, ',' order by m.name) filter (where not m.counts_in_load), '') = 'Domenico Desouter,Simon,Simon-atelier'
            then 'ok' else 'KO' end
  from public.workshop_mechanics m join public.companies co on co.id = m.company_id
 where m.company_id in ('3d9f0f13-a691-4d07-ad58-34590df86e33', '5593d97e-69ad-43dd-8237-4ab8aa4e5c08')
 group by co.name;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _m1 uuid;
begin
  insert into public.workshop_mechanics (company_id, name) values (_co, 'COMPAGNON VP9') returning id into _m1;
  insert into _t(check_name, result) values ('nouveau compagnon sans compte : compte dans la charge',
    case when (select counts_in_load from public.workshop_mechanics where id = _m1) then 'ok' else 'KO' end);
  -- Compte administrateur (simon@themaul.be est admin d'ItalTest) : non par defaut.
  insert into _t(check_name, result) values ('compte administrateur : ne compte pas par defaut',
    case when public.workshop_mechanic_counts_default(_co, auth.uid()) = false then 'ok' else 'KO' end);
  update public.workshop_mechanics set counts_in_load = false where id = _m1;
  insert into _t(check_name, result) values ('choix de l''ecran garde (decoche)',
    case when (select counts_in_load from public.workshop_mechanics where id = _m1) = false then 'ok' else 'KO' end);
  update public.workshop_mechanics set name = 'COMPAGNON VP9 BIS' where id = _m1;
  insert into _t(check_name, result) values ('modification sans toucher la case : valeur gardee',
    case when (select counts_in_load from public.workshop_mechanics where id = _m1) = false then 'ok' else 'KO' end);
end $s$;

reset role;
-- 5. Capacité du mercredi 18/11/2026 (jour ISO 3) sur les compagnons qui comptent, chez ITALBIKE STORE.
insert into _t(check_name, result)
select 'capacite du mercredi (compagnons qui comptent, ITALBIKE STORE) : ' || round(coalesce(sum(
         greatest(0, extract(epoch from (h.am_end - h.am_start)) / 60) + greatest(0, extract(epoch from (h.pm_end - h.pm_start)) / 60)), 0) / 60, 2) || ' h',
       case when coalesce(sum(greatest(0, extract(epoch from (h.am_end - h.am_start)) / 60) + greatest(0, extract(epoch from (h.pm_end - h.pm_start)) / 60)), 0) in (0, 1440)
            then 'ok' else 'KO' end
  from public.workshop_mechanics m join public.workshop_mechanic_hours h on h.mechanic_id = m.id and h.weekday = 3
 where m.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and m.counts_in_load and m.is_active and m.visible_in_planning;

select n, check_name, result from _t order by n;
