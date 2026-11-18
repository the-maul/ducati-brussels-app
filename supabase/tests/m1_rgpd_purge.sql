-- =====================================================================
-- Rattrapage G8 « clients » (18/11/2026) -- essai a blanc de 20261118220000_m1_rgpd_consentements_portabilite_purge.sql
-- (+ 221000 pour les colonnes de fiche). A executer DANS UNE TRANSACTION ANNULEE, migrations comprises :
--   (echo "begin;"; cat supabase/migrations/20261118220000_m1_rgpd_consentements_portabilite_purge.sql \
--      supabase/migrations/20261118221000_m1_fiche_client_groupes_vente_groupement.sql \
--      supabase/tests/m1_rgpd_purge.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Scenario, administrateur simule d'ITALBIKE STORE : declarations (garde, revocation, etat d'un canal),
-- portabilite, purge phase 1 (aucune fiche modifiee) puis phase 2 sur trois fiches d'essai :
-- prospect de 4 ans -> anonymise en entier ; client sans facture depuis 6 ans -> anonymise en gardant
-- nom et adresse (facture de moins de 10 ans) ; client avec un brouillon -> garde. Les fiches reelles
-- identifiees sont exclues de la confirmation. Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');
with c as (
  insert into public.contacts (company_id, type, status, first_name, last_name, email, mobile, created_at, notes)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'prospect', 'ESSAI', 'PROSPECTRGPD', 'essai.prospect@example.invalid',
          '+32470000001', now() - interval '4 years', 'essai rgpd')
  returning id)
insert into _ctx select 'prospect', id::text from c;
with c as (
  insert into public.contacts (company_id, type, status, first_name, last_name, email, address, zip, city, created_at, birth_date)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'client', 'ESSAI', 'CLIENTRGPD', 'essai.client@example.invalid',
          'Rue de l''Essai', '1000', 'Bruxelles', now() - interval '8 years', '1970-01-01')
  returning id)
insert into _ctx select 'client', id::text from c;
with c as (
  insert into public.contacts (company_id, type, status, first_name, last_name, created_at)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'client', 'ESSAI', 'GARDERGPD', now() - interval '8 years')
  returning id)
insert into _ctx select 'kept', id::text from c;
insert into public.documents (company_id, doc_type, number, contact_id, status, issue_date, total_ttc, paid_amount)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'FAC', 'ESSAI-RGPD-1', (select v::uuid from _ctx where k = 'client'), 'payee',
        current_date - 6 * 365, 100, 100),
       ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'FAC', 'ESSAI-RGPD-2', (select v::uuid from _ctx where k = 'kept'), 'payee',
        current_date - 6 * 365, 50, 50),
       ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'DEV', null, (select v::uuid from _ctx where k = 'kept'), 'brouillon',
        current_date - 6 * 365, 0, 0);

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

insert into public.contact_consents (company_id, contact_id, declared_at, accepted, refused, form)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'client'), current_date - 30,
        array['email', 'sms'], array['courrier'], 'comptoir');
insert into _t(check_name, result)
select 'declaration : e-mail accepte, courrier refuse, telephone non declare',
       case when public.contact_consent_channel((select v::uuid from _ctx where k = 'client'), 'email') = 'accepte'
             and public.contact_consent_channel((select v::uuid from _ctx where k = 'client'), 'courrier') = 'refuse'
             and public.contact_consent_channel((select v::uuid from _ctx where k = 'client'), 'telephone') is null
            then 'ok' else 'KO' end;

do $$ begin
  update public.contact_consents set accepted = array['email'] where contact_id = (select v::uuid from _ctx where k = 'client');
  insert into _t(check_name, result) values ('une declaration ne se modifie pas', 'KO');
exception when others then
  insert into _t(check_name, result) values ('une declaration ne se modifie pas', case when sqlerrm like '%CONSENT_IMMUTABLE%' then 'ok' else 'KO ' || sqlerrm end);
end $$;

insert into public.contact_consents (company_id, contact_id, declared_at, accepted, refused, form)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'client'), current_date - 5,
        '{}', array['sms'], 'telephone');
update public.contact_consents set revoked_at = now(), revoke_reason = 'essai'
 where contact_id = (select v::uuid from _ctx where k = 'client') and declared_at = current_date - 30;
insert into _t(check_name, result)
select 'revocation : la declaration revoquee ne compte plus, la plus recente fait foi',
       case when public.contact_consent_channel((select v::uuid from _ctx where k = 'client'), 'email') is null
             and public.contact_consent_channel((select v::uuid from _ctx where k = 'client'), 'sms') = 'refuse'
             and (select revoked_by from public.contact_consents where contact_id = (select v::uuid from _ctx where k = 'client')
                    and declared_at = current_date - 30) = 'd9409378-a554-4cb2-97d6-e0b84aba204e'
            then 'ok' else 'KO' end;

-- Exports dans des instructions separees : la trace ecrite par l'export n'est visible qu'a
-- l'instruction suivante (instantane de l'instruction SQL).
insert into _ctx select 'export_p', public.contact_gdpr_export((select v::uuid from _ctx where k = 'client'), 'portabilite')::text;
insert into _ctx select 'export_e', public.contact_gdpr_export((select v::uuid from _ctx where k = 'client'), 'edition')::text;
insert into _t(check_name, result)
select 'portabilite : fiche, documents et consentements exportes, export trace',
       case when ((select v::jsonb from _ctx where k = 'export_p') -> 'contact' ->> 'last_name') = 'CLIENTRGPD'
             and jsonb_array_length((select v::jsonb from _ctx where k = 'export_e') -> 'documents') = 1
             and jsonb_array_length((select v::jsonb from _ctx where k = 'export_p') -> 'consents') >= 1
             and (select count(*) from public.events where action = 'gdpr_export' and entity_id = (select v from _ctx where k = 'client')) = 2
            then 'ok' else 'KO' end;

-- Phase 1
insert into _ctx select 'run', public.gdpr_purge_identify('3d9f0f13-a691-4d07-ad58-34590df86e33')::text;
insert into _t(check_name, result)
select 'phase 1 : prospect et client identifies, le client au brouillon est garde, aucune fiche modifiee',
       case when (select reason || '/' || mode from public.gdpr_purge_items where run_id = (select v::uuid from _ctx where k = 'run')
                   and contact_id = (select v::uuid from _ctx where k = 'prospect')) = 'prospect/complete'
             and (select reason || '/' || mode from public.gdpr_purge_items where run_id = (select v::uuid from _ctx where k = 'run')
                   and contact_id = (select v::uuid from _ctx where k = 'client')) = 'client_sans_facture/partielle'
             and (select kept_reason from public.gdpr_purge_items where run_id = (select v::uuid from _ctx where k = 'run')
                   and contact_id = (select v::uuid from _ctx where k = 'kept')) = 'document_en_cours'
             and (select last_name from public.contacts where id = (select v::uuid from _ctx where k = 'prospect')) = 'PROSPECTRGPD'
            then 'ok' else 'KO' end;

-- Phase 2 : uniquement les fiches d'essai (les fiches reelles identifiees sont exclues).
insert into _ctx
select 'result', public.gdpr_purge_confirm((select v::uuid from _ctx where k = 'run'),
         array(select contact_id from public.gdpr_purge_items
                where run_id = (select v::uuid from _ctx where k = 'run')
                  and contact_id not in (select v::uuid from _ctx where k in ('prospect', 'client', 'kept'))))::text;
insert into _t(check_name, result)
select 'phase 2 : deux fiches anonymisees, la fiche au brouillon gardee',
       case when ((select v from _ctx where k = 'result')::jsonb ->> 'anonymised')::int = 2
             and (select outcome from public.gdpr_purge_items where run_id = (select v::uuid from _ctx where k = 'run')
                   and contact_id = (select v::uuid from _ctx where k = 'kept')) = 'garde_document_en_cours'
             and (select status from public.gdpr_purge_runs where id = (select v::uuid from _ctx where k = 'run')) = 'execute'
            then 'ok' else 'KO ' || coalesce((select v from _ctx where k = 'result'), '') end;
insert into _t(check_name, result)
select 'anonymisation complete du prospect, partielle du client (nom et adresse gardes)',
       case when (select last_name like 'ANONYMISE%' and first_name is null and email is null and mobile is null and not is_active
                    from public.contacts where id = (select v::uuid from _ctx where k = 'prospect'))
             and (select last_name = 'CLIENTRGPD' and address is not null and email is null and birth_date is null and marketing_opt_out
                    from public.contacts where id = (select v::uuid from _ctx where k = 'client'))
             and not exists (select 1 from public.contact_consents where contact_id = (select v::uuid from _ctx where k = 'client'))
            then 'ok' else 'KO' end;

reset role;
insert into _t(check_name, result)
select 'traces : plus aucune adresse e-mail des fiches purgees dans events, la purge est tracee',
       case when not exists (select 1 from public.events
                              where entity_type = 'contacts'
                                and entity_id in (select v from _ctx where k in ('prospect', 'client'))
                                and (old_data ? 'email' or new_data ? 'email'))
             and exists (select 1 from public.events where action = 'gdpr_purge_confirm' and entity_id = (select v from _ctx where k = 'run'))
            then 'ok' else 'KO' end;

select n, check_name, result from _t order by n;
