-- =====================================================================
-- Mise en production + mails automatiques par Outlook (19/11/2026) -- essai a blanc de la migration
-- 20261119220000_m0_mise_en_production.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base, rien ne part :
-- l'essai n'appelle ni Microsoft Graph ni Brevo, il ne fait que remplir et lire les tables) :
--   (echo "begin;"; cat supabase/migrations/20261119220000_m0_mise_en_production.sql \
--      supabase/tests/m0_mise_en_production.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Proprietaire de la base (postgres, sans jeton = comme pg_cron) ; une partie en administrateur
-- (jeton simule). Scenario sur ITALBIKE STORE. Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33'),
                        ('admin', 'd9409378-a554-4cb2-97d6-e0b84aba204e');

-- ------------------------------------------------------------ 1. schema
insert into _t(check_name, result)
select 'tables automation_settings / automation_switches / integration_status : RLS active',
       case when (select bool_and(relrowsecurity) from pg_class
                   where oid in ('public.automation_settings'::regclass, 'public.automation_switches'::regclass,
                                 'public.integration_status'::regclass)) then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'droits : claim / result / presence des secrets non executables par un utilisateur',
       case when not has_function_privilege('authenticated', 'public.mail_dispatch_claim(int)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public.mail_dispatch_result(bigint, text, text, text)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public.integration_status_record(uuid, jsonb)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public.automation_companies_off(text)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.vehicles_maintenance_upcoming(uuid, integer)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.production_overview(uuid, boolean)', 'EXECUTE')
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 2. cause du « jamais rien recu »
-- Sans jeton (comme pg_cron) : la planification des relances ne doit plus etre refusee.
do $$
declare _n int;
begin
  select count(*) into _n from public.vehicles_maintenance_upcoming((select v::uuid from _ctx where k = 'company'), 200);
  perform * from public.followups_daily();
  insert into _t(check_name, result) values ('relances d''entretien : followups_daily passe sous pg_cron (avant : acces refuse chaque jour)', 'ok');
exception when others then
  insert into _t(check_name, result) values ('relances d''entretien : followups_daily passe sous pg_cron (avant : acces refuse chaque jour)', 'KO ' || sqlerrm);
end $$;
insert into _t(check_name, result)
select 'relances d''entretien : des relances sont planifiees (sources fiables seulement, pas « plan »)',
       case when (select count(*) from public.followups where company_id = (select v::uuid from _ctx where k = 'company')
                   and status = 'planifiee') > 0
             and not exists (select 1 from public.followups where company_id = (select v::uuid from _ctx where k = 'company')
                              and status = 'planifiee' and source = 'plan')
            then 'ok' else 'KO ' || (select count(*)::text from public.followups) end;

insert into _t(check_name, result)
select 'relances d''entretien : aucune relance planifiee pour une societe de test (ItalTest)',
       case when not exists (select 1 from public.followups f where public._sms_is_test_company(f.company_id)
                              and f.created_at > now() - interval '10 minutes')
            then 'ok' else 'KO ' || (select count(*)::text from public.followups f where public._sms_is_test_company(f.company_id)) end;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  perform * from public.vehicles_maintenance_upcoming((select v::uuid from _ctx where k = 'company'), 30);
  reset role;
  insert into _t(check_name, result) values ('echeances : un utilisateur non membre est toujours refuse', 'KO');
exception when others then
  reset role;
  insert into _t(check_name, result) values ('echeances : un utilisateur non membre est toujours refuse', case when sqlstate = '42501' then 'ok' else 'KO ' || sqlerrm end);
end $$;
select set_config('request.jwt.claims', null, true);

-- ------------------------------------------------------------ 3. rappel de RDV : heure de Bruxelles
insert into public.contacts (company_id, first_name, last_name, email)
values ((select v::uuid from _ctx where k = 'company'), 'Essai', 'MEP RAPPEL', 'essai.mep.rappel@example.invalid');
insert into _ctx select 'contact', id::text from public.contacts where last_name = 'MEP RAPPEL';
insert into public.workshop_appointments (company_id, contact_id, starts_at, status)
values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'contact'),
        (((now() at time zone 'Europe/Brussels')::date + 1) + time '09:30') at time zone 'Europe/Brussels', 'prevu');
insert into _ctx select 'appt', id::text from public.workshop_appointments where contact_id = (select v::uuid from _ctx where k = 'contact');
select public._cron_appointment_reminders();
insert into _t(check_name, result)
select 'rappel de RDV par mail : « 09:30 » (heure de Bruxelles), pas l''heure UTC',
       case when (select body from public.notifications where template = 'appointment_reminder' and entity_id = (select v from _ctx where k = 'appt'))
                 like '%' || to_char((now() at time zone 'Europe/Brussels')::date + 1, 'DD/MM/YYYY') || ' à 09:30.'
            then 'ok' else 'KO ' || coalesce((select body from public.notifications where template = 'appointment_reminder'
                                                and entity_id = (select v from _ctx where k = 'appt')), 'rien') end;

-- ------------------------------------------------------------ 4. boite d'envoi, adresse de test
delete from public.automation_settings where company_id = (select v::uuid from _ctx where k = 'company');
delete from public.automation_switches where company_id = (select v::uuid from _ctx where k = 'company');
insert into _t(check_name, result)
select 'boite d''envoi par defaut : une boite active de la societe (info@ si elle existe)',
       case when public.notification_sender((select v::uuid from _ctx where k = 'company')) in
                 (select lower(address) from public.company_mailboxes where company_id = (select v::uuid from _ctx where k = 'company') and is_active)
             and (not exists (select 1 from public.company_mailboxes where company_id = (select v::uuid from _ctx where k = 'company')
                               and is_active and lower(address) like 'info@%')
                  or public.notification_sender((select v::uuid from _ctx where k = 'company')) like 'info@%')
            then 'ok' else 'KO ' || coalesce(public.notification_sender((select v::uuid from _ctx where k = 'company')), 'null') end;

insert into _t(check_name, result)
select 'interrupteurs : arrete par defaut, sauf ce qui tournait deja (releve, classification, resume, invitation)',
       case when public.automation_mode((select v::uuid from _ctx where k = 'company'), 'appointment_reminder_mail') = 'arrete'
             and public.automation_mode((select v::uuid from _ctx where k = 'company'), 'invoice_reminder_auto') = 'arrete'
             and public.automation_mode((select v::uuid from _ctx where k = 'company'), 'order_confirm_mail') = 'arrete'
             and public.automation_mode((select v::uuid from _ctx where k = 'company'), 'outlook_poll') = 'actif'
             and public.automation_mode((select v::uuid from _ctx where k = 'company'), 'prospect_classify') = 'actif'
             and public.automation_mode((select v::uuid from _ctx where k = 'company'), 'exchange_summary') = 'actif'
             and public.automation_mode((select v::uuid from _ctx where k = 'company'), 'portal_invite') = 'actif'
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 5. file de mails : arrete / test / actif
create temp table _c1 on commit drop as select * from public.mail_dispatch_claim(200);
insert into _t(check_name, result)
select 'file de mails, interrupteur arrete : rappel « skipped / mail_off », rien n''est pris en charge',
       case when (select status || '/' || error from public.notifications where template = 'appointment_reminder'
                   and entity_id = (select v from _ctx where k = 'appt')) = 'skipped/mail_off'
             and not exists (select 1 from _c1 where template = 'appointment_reminder')
            then 'ok' else 'KO ' || (select status || '/' || coalesce(error, '') from public.notifications where template = 'appointment_reminder'
                                      and entity_id = (select v from _ctx where k = 'appt')) end;

insert into public.automation_settings (company_id, mail_test_recipient)
values ((select v::uuid from _ctx where k = 'company'), 'essai.test@example.invalid');
insert into public.automation_switches (company_id, key, mode)
values ((select v::uuid from _ctx where k = 'company'), 'appointment_reminder_mail', 'test');
insert into public.notifications (company_id, channel, to_address, subject, body, template, entity_type, entity_id)
values ((select v::uuid from _ctx where k = 'company'), 'email', 'essai.mep.rappel@example.invalid', 'Rappel de rendez-vous atelier',
        'Corps', 'appointment_reminder', 'appointment', (select v from _ctx where k = 'appt'));
create temp table _c2 on commit drop as select * from public.mail_dispatch_claim(200);
insert into _t(check_name, result)
select 'file de mails, mode test : part a l''adresse de test, objet prefixe, depuis la boite de la societe, jamais au client',
       case when (select count(*) from _c2 where template = 'appointment_reminder' and send_to = 'essai.test@example.invalid'
                   and is_test and subject = '[TEST pour essai.mep.rappel@example.invalid] Rappel de rendez-vous atelier'
                   and sender_mailbox = public.notification_sender((select v::uuid from _ctx where k = 'company'))) = 1
             and not exists (select 1 from _c2 where send_to = 'essai.mep.rappel@example.invalid')
            then 'ok' else 'KO ' || coalesce((select string_agg(send_to || ' ' || subject, ' | ') from _c2), 'rien') end;

select public.mail_dispatch_result((select id from _c2 where template = 'appointment_reminder'), 'sent', null, 'graph-id');
insert into _t(check_name, result)
select 'resultat : envoye, fournisseur Graph, adresse reellement utilisee notee',
       case when (select status || '/' || provider || '/' || sent_to from public.notifications where id = (select id from _c2 where template = 'appointment_reminder'))
                 = 'sent/graph/essai.test@example.invalid' then 'ok' else 'KO' end;

update public.automation_switches set mode = 'actif' where company_id = (select v::uuid from _ctx where k = 'company') and key = 'appointment_reminder_mail';
insert into public.notifications (company_id, channel, to_address, subject, body, template, entity_type, entity_id)
values ((select v::uuid from _ctx where k = 'company'), 'email', 'Essai.MEP.Rappel@example.invalid', 'Rappel', 'Corps', 'appointment_reminder', 'appointment', (select v from _ctx where k = 'appt')),
       ((select v::uuid from _ctx where k = 'company'), 'email', 'x@example.invalid', 'Sans modele', 'Corps', null, null, null);
create temp table _c3 on commit drop as select * from public.mail_dispatch_claim(200);
insert into _t(check_name, result)
select 'file de mails, mode actif : part au client ; un mail sans interrupteur ne part pas (no_switch)',
       case when (select count(*) from _c3 where template = 'appointment_reminder' and send_to = 'essai.mep.rappel@example.invalid' and not is_test) = 1
             and exists (select 1 from public.notifications where to_address = 'x@example.invalid' and status = 'skipped' and error = 'no_switch')
            then 'ok' else 'KO' end;

update public.workshop_appointments set status = 'annule' where id = (select v::uuid from _ctx where k = 'appt');
insert into public.notifications (company_id, channel, to_address, subject, body, template, entity_type, entity_id)
values ((select v::uuid from _ctx where k = 'company'), 'email', 'essai.mep.rappel@example.invalid', 'Rappel', 'Corps', 'appointment_reminder', 'appointment', (select v from _ctx where k = 'appt'));
create temp table _c4 on commit drop as select * from public.mail_dispatch_claim(200);
insert into _t(check_name, result)
select 'file de mails : RDV annule entre-temps -> « skipped / rdv_changed »',
       case when exists (select 1 from public.notifications where template = 'appointment_reminder' and entity_id = (select v from _ctx where k = 'appt')
                          and status = 'skipped' and error = 'rdv_changed') and not exists (select 1 from _c4 where template = 'appointment_reminder')
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 6. fenetre de mise en production (administrateur)
delete from public.integration_status where company_id = (select v::uuid from _ctx where k = 'company');
delete from public.automation_switches where company_id = (select v::uuid from _ctx where k = 'company');

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  perform public.production_overview((select v::uuid from _ctx where k = 'company'));
  reset role;
  insert into _t(check_name, result) values ('fenetre : refusee a un non-administrateur', 'KO');
exception when others then
  reset role;
  insert into _t(check_name, result) values ('fenetre : refusee a un non-administrateur', case when sqlerrm = 'MEP_FORBIDDEN' then 'ok' else 'KO ' || sqlerrm end);
end $$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

insert into _ctx select 'ov', public.production_overview((select v::uuid from _ctx where k = 'company'))::text;
insert into _t(check_name, result)
select 'liste complete : les 18 elements, dans l''ordre',
       case when (select string_agg(x.v ->> 'key', ',' order by x.o) from jsonb_array_elements((select v from _ctx where k = 'ov')::jsonb -> 'items') with ordinality as x(v, o))
                 = 'shopify_stock,shopify_orders,followups,dunning,invoice_reminder_auto,appointment_reminder_mail,order_confirm_mail,parts_received_mail,portal_invite,'
                   'sms,sms_ready,sms_reminder,accounting_auto_transfer,outlook_poll,prospect_classify,exchange_summary,client_app,stripe'
            then 'ok' else 'KO ' || (select string_agg(x.v ->> 'key', ',') from jsonb_array_elements((select v from _ctx where k = 'ov')::jsonb -> 'items') as x(v)) end;
insert into _t(check_name, result)
select 'liste : chaque element a un etat connu ; Stripe « non utilise » ; les taches pg_cron sont listees',
       case when not exists (select 1 from jsonb_array_elements((select v from _ctx where k = 'ov')::jsonb -> 'items') as x(v)
                              where x.v ->> 'mode' not in ('arrete', 'test', 'actif', 'non_utilise'))
             and (select x.v ->> 'mode' from jsonb_array_elements((select v from _ctx where k = 'ov')::jsonb -> 'items') as x(v) where x.v ->> 'key' = 'stripe') in ('non_utilise', 'actif')
             and jsonb_array_length((select v from _ctx where k = 'ov')::jsonb -> 'crons') > 0
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'liste : secrets jamais verifies -> « graph_unchecked » dans ce qui manque',
       case when (select x.v -> 'missing' from jsonb_array_elements((select v from _ctx where k = 'ov')::jsonb -> 'items') as x(v)
                   where x.v ->> 'key' = 'appointment_reminder_mail') ? 'graph_unchecked' then 'ok' else 'KO' end;

-- Refus si non configure : rien ne change.
do $$
begin
  perform public.production_apply((select v::uuid from _ctx where k = 'company'), array['appointment_reminder_mail'], 'start');
  insert into _t(check_name, result) values ('demarrage refuse si non configure (secret Graph non verifie)', 'KO');
exception when others then
  insert into _t(check_name, result) values ('demarrage refuse si non configure (secret Graph non verifie)',
    case when sqlerrm like 'MEP_NOT_CONFIGURED:appointment_reminder_mail:%graph_unchecked%' then 'ok' else 'KO ' || sqlerrm end);
end $$;
insert into _t(check_name, result)
select 'refus : tout ou rien, l''interrupteur est reste arrete',
       case when public.automation_mode((select v::uuid from _ctx where k = 'company'), 'appointment_reminder_mail') = 'arrete' then 'ok' else 'KO' end;
do $$
begin
  perform public.production_apply((select v::uuid from _ctx where k = 'company'), array['stripe'], 'start');
  insert into _t(check_name, result) values ('Stripe (non utilise) ne peut pas etre demarre', 'KO');
exception when others then
  insert into _t(check_name, result) values ('Stripe (non utilise) ne peut pas etre demarre', case when sqlerrm = 'MEP_NOT_USED:stripe' then 'ok' else 'KO ' || sqlerrm end);
end $$;

reset role;
select public.integration_status_record((select v::uuid from _ctx where k = 'company'),
  '{"graph":true,"brevo":false,"shopify":true,"anthropic":true,"stripe":false,"cron":true}'::jsonb);
set local role authenticated;

do $$
begin
  perform public.production_apply((select v::uuid from _ctx where k = 'company'), array['sms'], 'start');
  insert into _t(check_name, result) values ('SMS : refuse tant que la cle Brevo manque', 'KO');
exception when others then
  insert into _t(check_name, result) values ('SMS : refuse tant que la cle Brevo manque',
    case when sqlerrm like 'MEP_NOT_CONFIGURED:sms:%brevo_secret%' then 'ok' else 'KO ' || sqlerrm end);
end $$;

insert into _ctx select 'start', public.production_apply((select v::uuid from _ctx where k = 'company'),
  array['appointment_reminder_mail', 'invoice_reminder_auto'], 'start')::text;
insert into _t(check_name, result)
select 'demarrage : les deux elements coches passent en Actif',
       case when public.automation_mode((select v::uuid from _ctx where k = 'company'), 'appointment_reminder_mail') = 'actif'
             and public.automation_mode((select v::uuid from _ctx where k = 'company'), 'invoice_reminder_auto') = 'actif'
             and jsonb_array_length((select v from _ctx where k = 'start')::jsonb) = 2
            then 'ok' else 'KO ' || (select v from _ctx where k = 'start') end;
insert into _t(check_name, result)
select 'demarrage trace : events production_switch (qui, quoi, ancien arrete -> nouveau actif)',
       case when (select count(*) from public.events where action = 'production_switch' and entity_type = 'production'
                   and actor_id = (select v::uuid from _ctx where k = 'admin')
                   and entity_id in ('appointment_reminder_mail', 'invoice_reminder_auto')
                   and old_data ->> 'mode' = 'arrete' and new_data ->> 'mode' = 'actif' and new_data ->> 'action' = 'start'
                   and occurred_at >= now() - interval '1 minute') = 2
            then 'ok' else 'KO' end;

insert into _ctx select 'pause', public.production_apply((select v::uuid from _ctx where k = 'company'), array['appointment_reminder_mail', 'outlook_poll'], 'pause')::text;
insert into _t(check_name, result)
select 'chemin inverse : mise en pause (Arrete), tracee',
       case when public.automation_mode((select v::uuid from _ctx where k = 'company'), 'appointment_reminder_mail') = 'arrete'
             and public.automation_mode((select v::uuid from _ctx where k = 'company'), 'outlook_poll') = 'arrete'
             and exists (select 1 from public.events where action = 'production_switch' and entity_id = 'outlook_poll'
                          and old_data ->> 'mode' = 'actif' and new_data ->> 'mode' = 'arrete')
            then 'ok' else 'KO ' || (select v from _ctx where k = 'pause') end;
insert into _t(check_name, result)
select 'dependance : classification IA non demarrable tant que la releve Outlook est arretee',
       case when (select x.v -> 'missing' from jsonb_array_elements(public.production_overview((select v::uuid from _ctx where k = 'company')) -> 'items') as x(v)
                   where x.v ->> 'key' = 'prospect_classify') ? 'depends_outlook_poll' then 'ok' else 'KO' end;

insert into _ctx select 'test', public.production_apply((select v::uuid from _ctx where k = 'company'), array['dunning'], 'test')::text;
insert into _ctx select 'dstart', public.production_apply((select v::uuid from _ctx where k = 'company'), array['dunning'], 'start')::text;
insert into _t(check_name, result)
select 'relances d''impayes : test puis Actif par la fenetre (seul chemin vers l''envoi reel)',
       case when (select dunning_mode from public.receivable_settings where company_id = (select v::uuid from _ctx where k = 'company')) = 'actif'
            then 'ok' else 'KO' end;
do $$
begin
  perform public.receivable_settings_set((select v::uuid from _ctx where k = 'company'), '{"dunning_mode":"actif"}'::jsonb);
  insert into _t(check_name, result) values ('relances d''impayes : l''ecran des reglages refuse toujours « actif »', 'KO');
exception when others then
  insert into _t(check_name, result) values ('relances d''impayes : l''ecran des reglages refuse toujours « actif »', 'ok');
end $$;

do $$
begin
  perform public.automation_settings_set((select v::uuid from _ctx where k = 'company'), 'pirate@example.invalid', null);
  insert into _t(check_name, result) values ('boite d''envoi : une adresse hors des boites de la societe est refusee', 'KO');
exception when others then
  insert into _t(check_name, result) values ('boite d''envoi : une adresse hors des boites de la societe est refusee', case when sqlerrm = 'MEP_UNKNOWN_MAILBOX' then 'ok' else 'KO ' || sqlerrm end);
end $$;
reset role;

-- ------------------------------------------------------------ 7. societe de test : jamais en production
-- La fonction du lot ItalTest est simulee dans la transaction (annulee) : ITALBIKE passe pour une societe de test.
create or replace function public.is_test_company(_company uuid) returns boolean language sql stable as $$
  select _company = '3d9f0f13-a691-4d07-ad58-34590df86e33'::uuid;
$$;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.production_apply((select v::uuid from _ctx where k = 'company'), array['invoice_reminder_auto'], 'start');
  insert into _t(check_name, result) values ('societe de test : demarrage refuse', 'KO');
exception when others then
  insert into _t(check_name, result) values ('societe de test : demarrage refuse', case when sqlerrm = 'MEP_TEST_COMPANY' then 'ok' else 'KO ' || sqlerrm end);
end $$;
insert into _ctx select 'tpause', public.production_apply((select v::uuid from _ctx where k = 'company'), array['invoice_reminder_auto'], 'pause')::text;
insert into _t(check_name, result)
select 'societe de test : la mise en pause reste possible',
       case when public.automation_mode((select v::uuid from _ctx where k = 'company'), 'invoice_reminder_auto') = 'arrete' then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'societe de test : signalee dans la fenetre',
       case when (public.production_overview((select v::uuid from _ctx where k = 'company')) ->> 'is_test_company')::boolean then 'ok' else 'KO' end;
reset role;
update public.automation_switches set mode = 'actif' where company_id = (select v::uuid from _ctx where k = 'company') and key = 'invoice_reminder_auto';
insert into public.notifications (company_id, channel, to_address, subject, body, template, entity_type, entity_id)
values ((select v::uuid from _ctx where k = 'company'), 'email', 'y@example.invalid', 'Relance', 'Corps', 'invoice_reminder', 'document', gen_random_uuid()::text);
create temp table _c5 on commit drop as select * from public.mail_dispatch_claim(200);
insert into _t(check_name, result)
select 'societe de test : la file de mails ne part jamais (« skipped », a l enfilage par ItalTest ou a la prise en charge), meme interrupteur actif',
       case when exists (select 1 from public.notifications where to_address = 'y@example.invalid' and status = 'skipped'
                          and (error = 'test_company' or error like 'societe_de_test%'))
             and not exists (select 1 from _c5) then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'lot ItalTest : les nouvelles tables sont classees « non copiees » dans l inventaire de la copie',
       case when to_regprocedure('public._tc_skip()') is null
              or (select count(*) from public._tc_skip() where tbl in ('automation_settings', 'automation_switches', 'integration_status')) = 3
            then 'ok' else 'KO' end;
