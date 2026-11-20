-- =====================================================================
-- SMS par Brevo (18/11/2026) -- essai a blanc de la migration 20261119170000_m8_sms_brevo.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base, rien ne part :
-- l'essai n'appelle jamais Brevo, il ne fait que remplir et lire la file `notifications`) :
--   (echo "begin;"; cat supabase/migrations/20261119170000_m8_sms_brevo.sql \
--      supabase/tests/m8_sms_brevo.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Proprietaire de la base (postgres) ; une partie en administrateur (jeton simule). Scenario sur
-- ITALBIKE STORE (+ une societe de test creee dans la transaction) : numeros E.164, mode arrete par defaut, SMS de fin de travaux (langue du client,
-- une seule fois par OR), pas de mobile / refus SMS / envoi auto coupe, rappels de RDV selon la case,
-- SMS programmes + annulation, prise en charge (claim) et resultat, societe de test.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33'),
                        ('admin', 'd9409378-a554-4cb2-97d6-e0b84aba204e');

-- ------------------------------------------------------------ 1. schema
insert into _t(check_name, result)
select 'sms_settings (RLS), colonnes notifications',
       case when (select relrowsecurity from pg_class where oid = 'public.sms_settings'::regclass)
             and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'notifications'
                   and column_name in ('contact_id', 'locale', 'sent_to', 'is_test', 'provider_message_id', 'claimed_at', 'cancelled_at')) = 7
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 2. numeros
insert into _t(check_name, result)
select 'E.164 : 0470 12 34 56 / +32 470/12.34.56 / 0032... / 470123456 -> +32470123456',
       case when public._sms_e164('0470 12 34 56') = '+32470123456' and public._sms_e164('+32 470/12.34.56') = '+32470123456'
             and public._sms_e164('0032470123456') = '+32470123456' and public._sms_e164('470123456') = '+32470123456'
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'E.164 : fixe belge pas mobile, francais accepte, illisible = null',
       case when public._sms_e164('02 123 45 67') = '+3221234567' and not public._sms_is_mobile('+3221234567')
             and public._sms_e164('+33 6 12 34 56 78') = '+33612345678' and public._sms_is_mobile('+33612345678')
             and public._sms_e164('abc') is null and public._sms_e164('+32 12') is null
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 3. donnees d'essai
insert into public.contacts (company_id, first_name, last_name, mobile, locale)
values ((select v::uuid from _ctx where k = 'company'), 'Essai', 'SMS BREVO NL', '0470 00 00 01', 'nl');
insert into _ctx select 'c_nl', id::text from public.contacts where last_name = 'SMS BREVO NL';
insert into public.contacts (company_id, first_name, last_name, phone)
values ((select v::uuid from _ctx where k = 'company'), 'Essai', 'SMS BREVO FIXE', '02 123 45 67');
insert into _ctx select 'c_fixe', id::text from public.contacts where last_name = 'SMS BREVO FIXE';
insert into public.contacts (company_id, first_name, last_name, mobile)
values ((select v::uuid from _ctx where k = 'company'), 'Essai', 'SMS BREVO REFUS', '0470000002');
insert into _ctx select 'c_refus', id::text from public.contacts where last_name = 'SMS BREVO REFUS';
insert into public.contact_consents (company_id, contact_id, refused, form)
values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'c_refus'), array['sms'], 'comptoir');

insert into public.vehicles (company_id, brand, model)
values ((select v::uuid from _ctx where k = 'company'), 'Ducati', 'Monster SMS-ESSAI');
insert into _ctx select 'veh', id::text from public.vehicles where model = 'Monster SMS-ESSAI';

insert into public.repair_orders (company_id, number, contact_id, vehicle_id, status)
values ((select v::uuid from _ctx where k = 'company'), 'ESSAI-SMS-1', (select v::uuid from _ctx where k = 'c_nl'), (select v::uuid from _ctx where k = 'veh'), 'en_cours'),
       ((select v::uuid from _ctx where k = 'company'), 'ESSAI-SMS-2', (select v::uuid from _ctx where k = 'c_fixe'), null, 'en_cours'),
       ((select v::uuid from _ctx where k = 'company'), 'ESSAI-SMS-3', (select v::uuid from _ctx where k = 'c_refus'), null, 'en_cours'),
       ((select v::uuid from _ctx where k = 'company'), 'ESSAI-SMS-4', (select v::uuid from _ctx where k = 'c_nl'), null, 'en_cours');
insert into _ctx select 'or' || right(number, 1), id::text from public.repair_orders where number like 'ESSAI-SMS-_';

-- ------------------------------------------------------------ 4. fin de travaux, mode arrete (defaut)
delete from public.sms_settings where company_id = (select v::uuid from _ctx where k = 'company');
update public.repair_orders set status = 'pret' where number = 'ESSAI-SMS-1';
insert into _t(check_name, result)
select 'fin de travaux : SMS enfile en NL, numero E.164, mais « skipped / sms_off » (pas de reglage = arrete)',
       case when (select count(*) from public.notifications n where n.template = 'workshop_ready' and n.entity_id = (select v from _ctx where k = 'or1')
                    and n.status = 'skipped' and n.error = 'sms_off' and n.to_address = '+32470000001' and n.locale = 'nl'
                    and n.body ilike 'Beste Essai, uw Ducati Monster SMS-ESSAI staat klaar%ESSAI-SMS-1%') = 1
            then 'ok' else 'KO ' || coalesce((select string_agg(status || '/' || coalesce(error, '') || '/' || body, ' | ') from public.notifications
                                                 where entity_id = (select v from _ctx where k = 'or1')), 'rien') end;

-- ------------------------------------------------------------ 5. mode actif, allers-retours
insert into public.sms_settings (company_id, mode, signature, opening_hours)
values ((select v::uuid from _ctx where k = 'company'), 'actif', 'Ducati BXL', 'du mardi au samedi');
update public.repair_orders set status = 'en_cours' where number = 'ESSAI-SMS-1';
update public.repair_orders set status = 'pret' where number = 'ESSAI-SMS-1';
insert into _t(check_name, result)
select 'allers-retours du statut : toujours UN seul SMS de fin de travaux pour l''OR',
       case when (select count(*) from public.notifications where template = 'workshop_ready' and entity_id = (select v from _ctx where k = 'or1')) = 1
            then 'ok' else 'KO' end;

update public.repair_orders set status = 'pret' where number = 'ESSAI-SMS-4';
insert into _t(check_name, result)
select 'mode actif : SMS en attente, signature et horaires repris',
       case when (select count(*) from public.notifications where template = 'workshop_ready' and entity_id = (select v from _ctx where k = 'or4')
                    and status = 'pending' and body like '%du mardi au samedi. Ducati BXL') = 1 then 'ok' else 'KO' end;

update public.repair_orders set status = 'pret' where number = 'ESSAI-SMS-2';
insert into _t(check_name, result)
select 'pas de mobile (fixe seulement) : rien enfile, raison tracee (events no_mobile)',
       case when not exists (select 1 from public.notifications where entity_id = (select v from _ctx where k = 'or2'))
             and exists (select 1 from public.events where action = 'sms_ready_not_queued' and entity_id = (select v from _ctx where k = 'or2')
                           and new_data ->> 'reason' = 'no_mobile') then 'ok' else 'KO' end;

update public.repair_orders set status = 'pret' where number = 'ESSAI-SMS-3';
insert into _t(check_name, result)
select 'client qui refuse les SMS : rien enfile (events consent_refused)',
       case when not exists (select 1 from public.notifications where entity_id = (select v from _ctx where k = 'or3'))
             and exists (select 1 from public.events where action = 'sms_ready_not_queued' and entity_id = (select v from _ctx where k = 'or3')
                           and new_data ->> 'reason' = 'consent_refused') then 'ok' else 'KO' end;

update public.sms_settings set ready_auto = false where company_id = (select v::uuid from _ctx where k = 'company');
insert into public.repair_orders (company_id, number, contact_id, status)
values ((select v::uuid from _ctx where k = 'company'), 'ESSAI-SMS-5', (select v::uuid from _ctx where k = 'c_nl'), 'pret');
insert into _t(check_name, result)
select 'envoi automatique coupe : rien enfile (events auto_off)',
       case when exists (select 1 from public.events e join public.repair_orders r on r.id::text = e.entity_id
                          where r.number = 'ESSAI-SMS-5' and e.action = 'sms_ready_not_queued' and e.new_data ->> 'reason' = 'auto_off')
             and not exists (select 1 from public.notifications n join public.repair_orders r on r.id::text = n.entity_id where r.number = 'ESSAI-SMS-5')
            then 'ok' else 'KO' end;
update public.sms_settings set ready_auto = true where company_id = (select v::uuid from _ctx where k = 'company');

-- ------------------------------------------------------------ 6. rappels de RDV
insert into public.workshop_appointments (company_id, contact_id, starts_at, status, notify_sms)
values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'c_nl'), date_trunc('minute', now()) + interval '3 hours', 'prevu', true),
       ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'c_nl'), date_trunc('minute', now()) + interval '4 hours', 'prevu', false),
       ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'c_nl'), date_trunc('minute', now()) + interval '3 days', 'prevu', true);
insert into _ctx select 'appt_on', id::text from public.workshop_appointments
  where contact_id = (select v::uuid from _ctx where k = 'c_nl') and notify_sms and starts_at < now() + interval '1 day';
insert into _ctx select 'appt_far', id::text from public.workshop_appointments
  where contact_id = (select v::uuid from _ctx where k = 'c_nl') and starts_at > now() + interval '2 days';

select public._cron_sms_appointment_reminders();
select public._cron_sms_appointment_reminders();
insert into _t(check_name, result)
select 'rappel RDV : 1 SMS pour le RDV coche dans les 24 h, rien pour le RDV sans case ni pour celui dans 3 jours, relance sans doublon',
       case when (select count(*) from public.notifications where template = 'appointment_reminder_sms'
                    and contact_id = (select v::uuid from _ctx where k = 'c_nl')) = 1
             and exists (select 1 from public.notifications where template = 'appointment_reminder_sms'
                           and split_part(entity_id, '@', 1) = (select v from _ctx where k = 'appt_on') and body ilike 'Beste Essai, herinnering%')
            then 'ok' else 'KO' end;

select public._cron_appointment_reminders();
insert into _t(check_name, result)
select 'tache mail des rappels : n''enfile plus aucun SMS',
       case when not exists (select 1 from public.notifications where channel = 'sms' and template = 'appointment_reminder'
                              and created_at > now() - interval '1 minute') then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 7. SMS programmes (administrateur)
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

insert into _ctx select 'sched', public.sms_schedule_appointments(
  (select v::uuid from _ctx where k = 'company'), current_date, current_date + 5, null, 120, null, null,
  'Rappel {prenom} : RDV le {date} a {heure}.', true, null)::text;
insert into _t(check_name, result)
select 'SMS programmes : le RDV dans 3 jours est programme (2 h avant), celui deja rappele ne l''est pas deux fois',
       case when ((select v from _ctx where k = 'sched')::jsonb ->> 'queued')::int = 1
             and ((select v from _ctx where k = 'sched')::jsonb ->> 'already')::int = 1
            then 'ok' else 'KO ' || (select v from _ctx where k = 'sched') end;

insert into _t(check_name, result)
select 'liste « SMS programmes » : le SMS differe est visible, texte rendu',
       case when exists (select 1 from public.sms_list((select v::uuid from _ctx where k = 'company'), 'scheduled', 200) l
                          where split_part(l.entity_id, '@', 1) = (select v from _ctx where k = 'appt_far')
                            and l.scheduled_at > now() + interval '1 day' and l.body ilike 'Rappel Essai : RDV le %')
            then 'ok' else 'KO' end;

select public.sms_cancel((select id from public.notifications where split_part(entity_id, '@', 1) = (select v from _ctx where k = 'appt_far')), 'essai');
insert into _t(check_name, result)
select 'annulation : statut cancelled, trace events',
       case when (select status from public.notifications where split_part(entity_id, '@', 1) = (select v from _ctx where k = 'appt_far')) = 'cancelled'
             and exists (select 1 from public.events where action = 'sms_cancelled' and actor_id = (select v::uuid from _ctx where k = 'admin'))
            then 'ok' else 'KO' end;

do $$
begin
  perform public.sms_settings_set((select v::uuid from _ctx where k = 'company'), '{"mode":"test"}'::jsonb);
  insert into _t(check_name, result) values ('reglages : mode test sans numero refuse', 'KO');
exception when others then
  insert into _t(check_name, result) values ('reglages : mode test sans numero refuse', case when sqlerrm = 'SMS_TEST_NEEDS_NUMBER' then 'ok' else 'KO ' || sqlerrm end);
end $$;
do $$
begin
  perform public.sms_settings_set((select v::uuid from _ctx where k = 'company'), '{"mode":"actif","sender":"Ducati Bruxelles"}'::jsonb);
  insert into _t(check_name, result) values ('reglages : expediteur de plus de 11 caracteres / espace refuse', 'KO');
exception when others then
  insert into _t(check_name, result) values ('reglages : expediteur de plus de 11 caracteres / espace refuse', case when sqlerrm = 'SMS_BAD_SENDER' then 'ok' else 'KO ' || sqlerrm end);
end $$;
insert into _ctx select 'settings', public.sms_settings_set((select v::uuid from _ctx where k = 'company'),
  '{"mode":"actif","test_recipient":"0470 99 99 99","sender":"DucatiBXL","signature":"Ducati BXL","opening_hours":"du mardi au samedi"}'::jsonb)::text;
insert into _t(check_name, result)
select 'reglages : enregistres par l''administrateur, numero de test normalise, trace events',
       case when ((select v from _ctx where k = 'settings')::jsonb ->> 'test_recipient') = '+32470999999'
             and exists (select 1 from public.events where action = 'sms_settings' and actor_id = (select v::uuid from _ctx where k = 'admin'))
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'SMS de test : prepare au numero saisi, marque test',
       case when (select count(*) from public.sms_test_prepare((select v::uuid from _ctx where k = 'company'), '0470 12 34 56', 'Essai')
                   where to_address = '+32470123456') = 1 then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'droits : claim / result non executables par un utilisateur',
       case when not has_function_privilege('authenticated', 'public.sms_dispatch_claim(int)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public.sms_dispatch_result(bigint, text, text, text)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public._sms_mobile_of(uuid)', 'EXECUTE')
            then 'ok' else 'KO' end;

reset role;

-- ------------------------------------------------------------ 8. envoi : claim / result
update public.workshop_appointments set starts_at = starts_at + interval '30 minutes' where id = (select v::uuid from _ctx where k = 'appt_on');
create temp table _claim on commit drop as select * from public.sms_dispatch_claim(200);
insert into _t(check_name, result)
select 'claim : fin de travaux de l''OR 4 prise en charge (sending), numero client',
       case when exists (select 1 from _claim c join public.notifications n on n.id = c.id
                          where n.entity_id = (select v from _ctx where k = 'or4') and n.status = 'sending'
                            and c.send_to = '+32470000001' and c.sender = 'DucatiBXL' and not c.is_test)
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'claim : rappel d''un RDV deplace ecarte (skipped / rdv_changed)',
       case when (select status || '/' || error from public.notifications where template = 'appointment_reminder_sms'
                   and split_part(entity_id, '@', 1) = (select v from _ctx where k = 'appt_on')) = 'skipped/rdv_changed'
            then 'ok' else 'KO' end;

select public.sms_dispatch_result((select c.id from _claim c join public.notifications n on n.id = c.id where n.entity_id = (select v from _ctx where k = 'or4')),
                                  'sent', null, '1511882900100020');
insert into _t(check_name, result)
select 'resultat : envoye, id Brevo garde, echange SMS ajoute a l''historique du client',
       case when exists (select 1 from public.notifications where entity_id = (select v from _ctx where k = 'or4') and status = 'sent'
                           and provider = 'brevo' and provider_message_id = '1511882900100020' and sent_at is not null)
             and exists (select 1 from public.communications where contact_id = (select v::uuid from _ctx where k = 'c_nl') and channel = 'sms')
            then 'ok' else 'KO' end;

-- Mode test : le SMS part au numero de test, jamais au client.
update public.sms_settings set mode = 'test' where company_id = (select v::uuid from _ctx where k = 'company');
insert into public.repair_orders (company_id, number, contact_id, status)
values ((select v::uuid from _ctx where k = 'company'), 'ESSAI-SMS-6', (select v::uuid from _ctx where k = 'c_nl'), 'pret');
create temp table _claim2 on commit drop as select * from public.sms_dispatch_claim(200);
insert into _t(check_name, result)
select 'mode test : SMS reroute vers le numero de test (is_test, sent_to)',
       case when exists (select 1 from _claim2 c join public.notifications n on n.id = c.id join public.repair_orders r on r.id::text = n.entity_id
                          where r.number = 'ESSAI-SMS-6' and c.send_to = '+32470999999' and c.is_test and n.sent_to = '+32470999999')
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 9. societe de test : rien ne part
-- Societe vide creee dans la transaction et marquee « test » avec le marquage du lot ItalTest
-- (test_companies) s'il est en base ; sinon une fonction is_test_company provisoire (annulee avec
-- le reste) joue son role.
insert into public.companies (code, name) values ('essai-sms-test', 'ESSAI SMS SOCIETE TEST');
insert into _ctx select 'tc', id::text from public.companies where code = 'essai-sms-test';
do $$
begin
  if to_regclass('public.test_companies') is not null then
    execute 'insert into public.test_companies (company_id, source_company_id) values ($1, $2)'
      using (select v::uuid from _ctx where k = 'tc'), (select v::uuid from _ctx where k = 'company');
  elsif to_regprocedure('public.is_test_company(uuid)') is null then
    execute format('create function public.is_test_company(_c uuid) returns boolean language sql stable as %L',
                   'select _c = ''' || (select v from _ctx where k = 'tc') || '''::uuid');
  end if;
end $$;
insert into public.user_roles (user_id, company_id, role)
values ((select v::uuid from _ctx where k = 'admin'), (select v::uuid from _ctx where k = 'tc'), 'admin');
insert into public.sms_settings (company_id, mode, test_recipient) values ((select v::uuid from _ctx where k = 'tc'), 'actif', '+32470999999');
insert into _t(check_name, result)
select 'societe de test : reconnue, mode SMS force a « arrete »',
       case when public._sms_is_test_company((select v::uuid from _ctx where k = 'tc'))
             and not public._sms_is_test_company((select v::uuid from _ctx where k = 'company'))
             and (select mode from public.sms_settings where company_id = (select v::uuid from _ctx where k = 'tc')) = 'arrete'
            then 'ok' else 'KO' end;

insert into public.contacts (company_id, first_name, last_name, mobile)
values ((select v::uuid from _ctx where k = 'tc'), 'Essai', 'SMS BREVO SOCIETE TEST', '0470000003');
insert into public.repair_orders (company_id, number, contact_id, status)
values ((select v::uuid from _ctx where k = 'tc'), 'ESSAI-SMS-7',
        (select id from public.contacts where last_name = 'SMS BREVO SOCIETE TEST'), 'pret');
insert into _t(check_name, result)
select 'societe de test : fin de travaux sans aucun SMS en attente (skipped / test_company, ou pas enfile)',
       case when not exists (select 1 from public.notifications n join public.repair_orders r on r.id::text = n.entity_id
                              where r.number = 'ESSAI-SMS-7' and n.status not in ('skipped'))
            then 'ok' else 'KO' end;
insert into public.notifications (company_id, channel, to_address, body, status)
values ((select v::uuid from _ctx where k = 'tc'), 'sms', '0470000001', 'insertion directe', 'pending');
insert into _t(check_name, result)
select 'societe de test : meme une insertion directe dans la file est ecartee (skipped / test_company)',
       case when (select status || '/' || error from public.notifications where body = 'insertion directe') = 'skipped/test_company'
             and not exists (select 1 from public.sms_dispatch_claim(200)) then 'ok' else 'KO' end;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform * from public.sms_test_prepare((select v::uuid from _ctx where k = 'tc'), '0470123456', 'Essai');
  insert into _t(check_name, result) values ('societe de test : SMS de test refuse', 'KO');
exception when others then
  insert into _t(check_name, result) values ('societe de test : SMS de test refuse', case when sqlerrm = 'SMS_TEST_COMPANY' then 'ok' else 'KO ' || sqlerrm end);
end $$;
do $$
begin
  perform public.sms_schedule_appointments((select v::uuid from _ctx where k = 'tc'), current_date, current_date + 1, null, 120, null, null, null, true, null);
  insert into _t(check_name, result) values ('societe de test : SMS programmes refuses', 'KO');
exception when others then
  insert into _t(check_name, result) values ('societe de test : SMS programmes refuses', case when sqlerrm = 'SMS_TEST_COMPANY' then 'ok' else 'KO ' || sqlerrm end);
end $$;
reset role;

select n, check_name, result from _t order by n;
