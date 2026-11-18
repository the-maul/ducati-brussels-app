-- =====================================================================
-- Rattrapage G8 « clients » (18/11/2026) -- essai a blanc de 20261118229000_m1_fusion_toutes_references.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, apres les migrations 20261118220000, 221000, 222000, 229000 :
--   (echo "begin;"; cat supabase/migrations/20261118220000_*.sql supabase/migrations/20261118221000_*.sql \
--      supabase/migrations/20261118222000_*.sql supabase/migrations/20261118229000_*.sql \
--      supabase/tests/m1_fusion_toutes_references.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Scenario, administrateur simule d'ITALBIKE STORE : deux fiches de la meme personne ; le doublon a une
-- relance (table ajoutee apres la fusion du 19/09, qui bloquait la fusion), un groupe en commun avec
-- la fiche gardee, un groupement vers elle et un document valide -> tout passe sur la fiche gardee,
-- sans doublon, et la fusion est tracee. Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
with c as (
  insert into public.contacts (company_id, type, status, first_name, last_name, email)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'client', 'ESSAI', 'FUSIONGARDEE', 'essai.fusion1@example.invalid')
  returning id)
insert into _ctx select 'keep', id::text from c;
with c as (
  insert into public.contacts (company_id, type, status, first_name, last_name, email, mobile)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'prospect', 'ESSAI', 'FUSIONDOUBLON', 'essai.fusion2@example.invalid', '+32470000009')
  returning id)
insert into _ctx select 'absorb', id::text from c;

insert into public.followups (company_id, kind, contact_id, label, send_at)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'manuel', (select v::uuid from _ctx where k = 'absorb'), 'essai fusion', current_date + 30);
insert into public.contact_group_members (company_id, contact_id, group_code)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'keep'), 'INT_BALADE'),
       ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'absorb'), 'INT_BALADE'),
       ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'absorb'), 'ORI_ATELIER');
insert into public.contact_group_sales (company_id, contact_id, member_id, participation_rate)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'absorb'), (select v::uuid from _ctx where k = 'keep'), 50);
insert into public.documents (company_id, doc_type, number, contact_id, status, issue_date, total_ttc, paid_amount)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'FAC', 'ESSAI-FUSION-1', (select v::uuid from _ctx where k = 'absorb'), 'validee',
        current_date, 10, 0);

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

insert into _t(check_name, result)
select 'apercu : la relance et le groupe du doublon sont comptes',
       case when (public.contact_merge_preview((select v::uuid from _ctx where k = 'keep'), (select v::uuid from _ctx where k = 'absorb'))
                    -> 'counts' ->> 'followups')::int = 1
             and (public.contact_merge_preview((select v::uuid from _ctx where k = 'keep'), (select v::uuid from _ctx where k = 'absorb'))
                    -> 'counts' ->> 'contact_group_members')::int = 2
            then 'ok' else 'KO' end;

insert into _ctx select 'result', public.contact_merge((select v::uuid from _ctx where k = 'keep'), (select v::uuid from _ctx where k = 'absorb'))::text;

insert into _t(check_name, result)
select 'la relance et le document valide passent sur la fiche gardee (la fusion n''est plus refusee)',
       case when (select contact_id from public.followups where label = 'essai fusion') = (select v::uuid from _ctx where k = 'keep')
             and (select contact_id from public.documents where number = 'ESSAI-FUSION-1') = (select v::uuid from _ctx where k = 'keep')
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'groupes reunis sans doublon, groupement entre les deux fiches supprime',
       case when (select count(*) from public.contact_group_members where contact_id = (select v::uuid from _ctx where k = 'keep')) = 2
             and not exists (select 1 from public.contact_group_sales
                              where contact_id in (select v::uuid from _ctx where k in ('keep', 'absorb'))
                                 or member_id in (select v::uuid from _ctx where k in ('keep', 'absorb')))
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'doublon archive, plus aucune reference vers lui, fusion tracee avec son auteur',
       case when not (select is_active from public.contacts where id = (select v::uuid from _ctx where k = 'absorb'))
             and not exists (select 1 from public.contact_group_members where contact_id = (select v::uuid from _ctx where k = 'absorb'))
             and exists (select 1 from public.events where action = 'merge' and entity_id = (select v from _ctx where k = 'keep')
                           and actor_id = 'd9409378-a554-4cb2-97d6-e0b84aba204e')
             and (select mobile from public.contacts where id = (select v::uuid from _ctx where k = 'keep')) = '+32470000009'
            then 'ok' else 'KO ' || coalesce((select v from _ctx where k = 'result'), '') end;

reset role;
select n, check_name, result from _t order by n;
