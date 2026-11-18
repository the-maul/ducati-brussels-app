-- =====================================================================
-- Rattrapage G8 « clients » (18/11/2026) -- essai a blanc de 20261118221000_m1_fiche_client_groupes_vente_groupement.sql
-- et 20261118222000_m1_cascade_extraction_mailing_essai.sql (apres 20261118220000).
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises :
--   (echo "begin;"; cat supabase/migrations/20261118220000_*.sql supabase/migrations/20261118221000_*.sql \
--      supabase/migrations/20261118222000_*.sql supabase/tests/m1_fiche_cascade_extraction.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Scenario, administrateur simule d'ITALBIKE STORE : groupes G8 poses, nom de naissance, vente groupement
-- (pas avec soi-meme), cascade (lister, changer le CP, affecter a un groupe, commentaire ajoute, action
-- refusee pour les tarifs), extraction (opposes au marketing et NPAI exclus par defaut, province,
-- groupe), campagne SMS en mode ESSAI (aucun autre mode accepte). Chaque ligne doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
insert into _t(check_name, result)
select 'groupes G8 poses pour chaque societe (9 valeurs)',
       case when (select count(*) from public.reference_values where table_key = 'contact_group'
                   and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33') >= 9 then 'ok' else 'KO' end;

with c as (
  insert into public.contacts (company_id, type, status, first_name, last_name, mobile, zip, city, birth_name, notes)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'client', 'ESSAI', 'ZZCASCADEA', '+32470000011', '1000', 'Bruxelles', 'NAISSANCE', 'note initiale')
  returning id)
insert into _ctx select 'a', id::text from c;
with c as (
  insert into public.contacts (company_id, type, status, first_name, last_name, mobile, zip, city, marketing_opt_out)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'client', 'ESSAI', 'ZZCASCADEB', '+32470000012', '4000', 'Liege', true)
  returning id)
insert into _ctx select 'b', id::text from c;
with c as (
  insert into public.contacts (company_id, type, status, first_name, last_name, zip, city, address_mismatch)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'client', 'ESSAI', 'ZZCASCADEC', '9000', 'Gent', true)
  returning id)
insert into _ctx select 'c', id::text from c;

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  insert into public.contact_group_sales (company_id, contact_id, member_id, participation_rate)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'a'), (select v::uuid from _ctx where k = 'a'), 10);
  insert into _t(check_name, result) values ('vente groupement : pas avec soi-meme', 'KO');
exception when check_violation then
  insert into _t(check_name, result) values ('vente groupement : pas avec soi-meme', 'ok');
end $$;
insert into public.contact_group_sales (company_id, contact_id, member_id, participation_rate)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'a'), (select v::uuid from _ctx where k = 'b'), 40);

insert into _t(check_name, result)
select 'cascade : lister par nom de ville et par code postal',
       case when (select count(*) from public.contacts_cascade_list('3d9f0f13-a691-4d07-ad58-34590df86e33', '{"place":"bruxelles"}'::jsonb)
                   where id = (select v::uuid from _ctx where k = 'a')) = 1
             and (select count(*) from public.contacts_cascade_list('3d9f0f13-a691-4d07-ad58-34590df86e33', '{"place":"40"}'::jsonb)
                   where id = (select v::uuid from _ctx where k = 'b')) = 1
            then 'ok' else 'KO' end;

insert into _ctx select 'n_zip', public.contacts_cascade_apply('3d9f0f13-a691-4d07-ad58-34590df86e33',
  array[(select v::uuid from _ctx where k = 'a'), (select v::uuid from _ctx where k = 'b')], 'set_zip', '{"value":"1050","city":"Ixelles"}'::jsonb)::text;
insert into _ctx select 'n_grp', public.contacts_cascade_apply('3d9f0f13-a691-4d07-ad58-34590df86e33',
  array[(select v::uuid from _ctx where k = 'a'), (select v::uuid from _ctx where k = 'c')], 'add_group', '{"value":"INT_BALADE"}'::jsonb)::text;
insert into _ctx select 'n_comment', public.contacts_cascade_apply('3d9f0f13-a691-4d07-ad58-34590df86e33',
  array[(select v::uuid from _ctx where k = 'a')], 'add_comment', '{"value":"rappel essai"}'::jsonb)::text;
insert into _t(check_name, result)
select 'cascade : CP + ville changes, groupe affecte, commentaire ajoute sans perdre l''ancien, trace',
       case when (select v from _ctx where k = 'n_zip') = '2' and (select v from _ctx where k = 'n_grp') = '2'
             and (select zip || ' ' || city from public.contacts where id = (select v::uuid from _ctx where k = 'b')) = '1050 Ixelles'
             and (select notes like 'note initiale%rappel essai' from public.contacts where id = (select v::uuid from _ctx where k = 'a'))
             and (select count(*) from public.events where action = 'contacts_cascade' and actor_id = 'd9409378-a554-4cb2-97d6-e0b84aba204e') >= 3
            then 'ok' else 'KO' end;

do $$ begin
  perform public.contacts_cascade_apply('3d9f0f13-a691-4d07-ad58-34590df86e33',
    array[(select v::uuid from _ctx where k = 'a')], 'set_flag', '{"flag":"is_blocked","on":true}'::jsonb);
  insert into _t(check_name, result) values ('cascade : bloque / tarifs refuses ici (lot regles client)', 'KO');
exception when others then
  insert into _t(check_name, result) values ('cascade : bloque / tarifs refuses ici (lot regles client)',
    case when sqlerrm like '%CASCADE_ACTION_UNKNOWN%' then 'ok' else 'KO ' || sqlerrm end);
end $$;

insert into _t(check_name, result)
select 'extraction : oppose au marketing et NPAI exclus par defaut, inclus sur demande',
       case when (select count(*) from public.contacts_extract('3d9f0f13-a691-4d07-ad58-34590df86e33', '{"name":"zzcascade"}'::jsonb)) = 1
             and (select count(*) from public.contacts_extract('3d9f0f13-a691-4d07-ad58-34590df86e33',
                    '{"name":"zzcascade","exclude_opt_out":false,"exclude_npai":false}'::jsonb)) = 3
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'extraction : province, region et groupe',
       case when (select count(*) from public.contacts_extract('3d9f0f13-a691-4d07-ad58-34590df86e33',
                    '{"name":"zzcascade","exclude_opt_out":false,"exclude_npai":false,"provinces":["OVL"]}'::jsonb)) = 1
             and (select count(*) from public.contacts_extract('3d9f0f13-a691-4d07-ad58-34590df86e33',
                    '{"name":"zzcascade","exclude_opt_out":false,"exclude_npai":false,"regions":["bruxelles"]}'::jsonb)) = 2
             and (select count(*) from public.contacts_extract('3d9f0f13-a691-4d07-ad58-34590df86e33',
                    '{"name":"zzcascade","exclude_npai":false,"groups":["INT_BALADE"]}'::jsonb)) = 2
             and public.be_province('1050') = 'BRU' and public.be_region('6700') = 'wallonie'
            then 'ok' else 'KO' end;

insert into _ctx select 'campaign', public.marketing_campaign_prepare('3d9f0f13-a691-4d07-ad58-34590df86e33', 'sms', 'Essai', null,
  'Bonjour {prenom} {nom}', array(select v::uuid from _ctx where k in ('a', 'b', 'c')), '{}'::jsonb)::text;
insert into _t(check_name, result)
select 'campagne SMS en essai : 1 prete, opposee au marketing et sans mobile ecartees, message personnalise',
       case when (select mode || '/' || recipients_count || '/' || skipped_count from public.marketing_campaigns
                   where id = (select v::uuid from _ctx where k = 'campaign')) = 'test/1/2'
             and (select rendered_body from public.marketing_campaign_recipients
                   where campaign_id = (select v::uuid from _ctx where k = 'campaign') and status = 'pret') = 'Bonjour Essai Zzcascadea'
             and (select skip_reason from public.marketing_campaign_recipients
                   where campaign_id = (select v::uuid from _ctx where k = 'campaign') and contact_id = (select v::uuid from _ctx where k = 'b')) = 'oppose_marketing'
             and (select skip_reason from public.marketing_campaign_recipients
                   where campaign_id = (select v::uuid from _ctx where k = 'campaign') and contact_id = (select v::uuid from _ctx where k = 'c')) = 'sans_mobile'
            then 'ok' else 'KO' end;

reset role;
do $$ begin
  update public.marketing_campaigns set mode = 'live' where id = (select v::uuid from _ctx where k = 'campaign');
  insert into _t(check_name, result) values ('aucun autre mode que l''essai n''est accepte', 'KO');
exception when check_violation then
  insert into _t(check_name, result) values ('aucun autre mode que l''essai n''est accepte', 'ok');
end $$;

select n, check_name, result from _t order by n;
