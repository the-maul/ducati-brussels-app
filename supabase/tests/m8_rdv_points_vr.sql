-- =====================================================================
-- Essai a blanc de 20261123115000_m8_rdv_points_vr.sql, DANS UNE TRANSACTION ANNULEE.
-- Administrateur simule, societe ItalTest. Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

with a as (
  insert into public.workshop_appointments (company_id, status, unassigned, starts_at, check_points)
  values ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'prevu', true, now() + interval '30 days',
          '{"huile_moteur":"R","tension_chaine":"V"}'::jsonb)
  returning id)
insert into _ctx select 'rdv', id::text from a;

insert into _t(check_name, result)
select 'le RDV garde les marques V et R',
  case when (select check_points ->> 'huile_moteur' = 'R' and check_points ->> 'tension_chaine' = 'V'
               from public.workshop_appointments where id = (select v::uuid from _ctx where k = 'rdv')) then 'ok' else 'KO' end;

update public.workshop_appointments set check_points = '{}'::jsonb where id = (select v::uuid from _ctx where k = 'rdv');
insert into _t(check_name, result)
select 'decocher vide la liste',
  case when (select check_points = '{}'::jsonb from public.workshop_appointments where id = (select v::uuid from _ctx where k = 'rdv')) then 'ok' else 'KO' end;

with a as (
  insert into public.workshop_appointments (company_id, status, unassigned, starts_at)
  values ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'prevu', true, now() + interval '31 days')
  returning check_points)
insert into _t(check_name, result)
select 'un RDV sans demande reste vide', case when check_points = '{}'::jsonb then 'ok' else 'KO' end from a;
reset role;
