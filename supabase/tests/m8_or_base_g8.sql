-- =====================================================================
-- Rattrapage G8 « OR de base » (18/11/2026) -- essai a blanc de la migration
-- 20261118100000_m8_or_base_g8.sql. A executer DANS UNE TRANSACTION ANNULEE, migration comprise
-- (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118100000_m8_or_base_g8.sql \
--      supabase/tests/m8_or_base_g8.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Proprietaire de la base (postgres). Scenario sur ITALBIKE STORE :
--   colonnes posees (promis le, 30 points, km confirme, km du RDV) ; 30 points = objet JSON seulement ;
--   km negatif refuse ; nouveaux statuts acceptes ; deux RDV demain pour un client avec portable, un
--   avec la case SMS, un sans -> un seul SMS enfile, deux mails ; relance idempotente.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;

insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');

-- Client de test (portable + mail), cree dans la transaction.
insert into public.contacts (company_id, first_name, last_name, email, mobile)
values ((select v::uuid from _ctx where k = 'company'), 'Essai', 'G8 OR BASE', 'essai-or-base@example.invalid', '+32470000000');
insert into _ctx select 'contact', id::text from public.contacts where last_name = 'G8 OR BASE' order by created_at desc limit 1;

-- ------------------------------------------------------------ 1. colonnes
insert into _t(check_name, result)
select 'repair_orders : promised_at, check_points, mileage_ack_previous',
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'repair_orders'
                   and column_name in ('promised_at', 'check_points', 'mileage_ack_previous')) = 3 then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'workshop_appointments.mileage',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'workshop_appointments'
                   and column_name = 'mileage') then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 2. OR : 30 points, statuts G8, km confirme
insert into public.repair_orders (company_id, number, contact_id, mileage, status, check_points, promised_at, mileage_ack_previous)
values ((select v::uuid from _ctx where k = 'company'), 'ESSAI-G8-1', (select v::uuid from _ctx where k = 'contact'), 14500,
        'attente_pieces', '{"huile_moteur":"V","liquide_frein":"R"}', now() + interval '2 days', 15000);
insert into _ctx select 'or', id::text from public.repair_orders where number = 'ESSAI-G8-1';

insert into _t(check_name, result)
select 'OR : statut « pieces en commande » et 30 points gardes',
       case when (select status = 'attente_pieces' and check_points ->> 'liquide_frein' = 'R' and mileage_ack_previous = 15000
                    from public.repair_orders where id = (select v::uuid from _ctx where k = 'or')) then 'ok' else 'KO' end;

update public.repair_orders set status = 'client_informe' where id = (select v::uuid from _ctx where k = 'or');
insert into _t(check_name, result)
select 'OR : statut « client informe » accepte, trace audit (events)',
       case when exists (select 1 from public.events where entity_id = (select v from _ctx where k = 'or'))
            then 'ok' else 'KO (pas de trace events)' end;

do $$
begin
  begin
    update public.repair_orders set check_points = '["V"]'::jsonb where number = 'ESSAI-G8-1';
    insert into _t(check_name, result) values ('30 points : un tableau JSON est refuse', 'KO');
  exception when check_violation then
    insert into _t(check_name, result) values ('30 points : un tableau JSON est refuse', 'ok');
  end;
  begin
    update public.repair_orders set mileage = -1 where number = 'ESSAI-G8-1';
    insert into _t(check_name, result) values ('km negatif refuse', 'KO');
  exception when check_violation then
    insert into _t(check_name, result) values ('km negatif refuse', 'ok');
  end;
end $$;

-- ------------------------------------------------------------ 3. rappel RDV : SMS seulement si la case est cochee
insert into public.workshop_appointments (company_id, contact_id, starts_at, status, notify_sms, mileage)
values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'contact'),
        (current_date + 1) + time '09:00', 'prevu', true, 15000),
       ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'contact'),
        (current_date + 1) + time '14:00', 'prevu', false, null);

select public._cron_appointment_reminders();

insert into _t(check_name, result)
select 'rappel RDV : 1 SMS (case cochee), pas pour le RDV sans la case',
       case when (select count(*) from public.notifications n
                   where n.channel = 'sms' and n.template = 'appointment_reminder' and n.to_address = '+32470000000'
                     and n.created_at > now() - interval '1 minute') = 1 then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'rappel RDV : le mail part pour les deux RDV (inchange)',
       case when (select count(*) from public.notifications n
                   where n.channel = 'email' and n.template = 'appointment_reminder' and n.to_address = 'essai-or-base@example.invalid'
                     and n.created_at > now() - interval '1 minute') = 2 then 'ok' else 'KO' end;

select public._cron_appointment_reminders();
insert into _t(check_name, result)
select 'rappel RDV : relance le meme jour sans doublon',
       case when (select count(*) from public.notifications n where n.to_address in ('+32470000000', 'essai-or-base@example.invalid')
                     and n.created_at > now() - interval '1 minute') = 3 then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'droits : _cron_appointment_reminders non executable par authenticated',
       case when not has_function_privilege('authenticated', 'public._cron_appointment_reminders()', 'EXECUTE') then 'ok' else 'KO' end;

select n, check_name, result from _t order by n;
