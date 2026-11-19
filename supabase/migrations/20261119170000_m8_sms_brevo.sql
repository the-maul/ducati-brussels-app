-- =====================================================================
-- M8 / M10 — SMS par Brevo (18/11/2026, decision client T14 / T15 ; ATE018, ATE002).
-- Meme comportement que G8 : SMS automatique de fin de travaux (OR « Pret »), SMS de rappel de RDV
-- selon la case du RDV, « SMS programmes » (envoi differe, liste, annulation).
-- Idempotente. NON APPLIQUEE (Simon la passe avec les autres). Rien n'est supprime.
--
-- UN SEUL SYSTEME : la file `notifications` (M10, 20260612240000) et la fonction Edge
-- `dispatch-notifications` (pg_cron, 10 min). Le « fournisseur SMS generique » est remplace par
-- l'adaptateur Brevo (supabase/functions/_shared/brevo-sms.ts). Les mails ne changent pas.
--
-- 1. Societe de TEST : le marquage est celui du lot ItalTest (20261119160000, table test_companies,
--    fonction public.is_test_company). _sms_is_test_company le lit s'il existe (sinon : aucune societe
--    de test, donc rien a bloquer). Aucun SMS ne part jamais d'une societe de test : la ligne est
--    enfilee directement « skipped / test_company » (visible), le mode SMS est force a « arrete »,
--    l'envoi de test et les SMS programmes sont refuses, et la fonction d'envoi reverifie.
-- 2. sms_settings (une ligne par societe, pas de ligne = ARRETE, comme les relances CRM011) :
--      mode arrete | test | actif   (test : tout SMS part au numero de test, jamais au client)
--      ready_auto      : SMS automatique de fin de travaux (oui par defaut, G8)
--      reminder_auto   : rappels de RDV pour les RDV coches (oui par defaut)
--      reminder_lead_minutes : « SMS rappel RDV N avant » (G8), 24 h par defaut
--      sender (expediteur, sinon secret BREVO_SMS_SENDER, sinon DucatiBXL), signature, horaires,
--      templates { ready: {fr,nl,en,it}, reminder: {fr,nl,en,it} } (vide = texte par defaut).
-- 3. notifications : contact, langue, numero reellement utilise, test, fournisseur + id Brevo,
--    auteur, annulation, prise en charge. Statuts : pending | sending | sent | failed | skipped |
--    cancelled. Index unique : UN SEUL SMS de fin de travaux par OR, UN SEUL rappel par RDV et par
--    horaire (meme si le statut fait des allers-retours ou si le rappel est aussi programme a la main).
--    Declencheur avant insertion (SMS) : numero normalise E.164 (Belgique par defaut), societe de
--    test -> skipped, mode arrete -> skipped. Toute ligne SMS, envoyee ou non, reste visible.
-- 4. Fin de travaux : declencheur sur repair_orders (passage a « pret ») -> _sms_queue_ready.
--    Pas de mobile, refus SMS (consentement RGPD), envoi auto coupe, pas de client : rien n'est
--    enfile, la raison est tracee dans events (sms_ready_not_queued). Une erreur ne bloque JAMAIS
--    le changement de statut de l'OR.
-- 5. Rappels de RDV : la tache mail `_cron_appointment_reminders` n'enfile plus de SMS (le mail
--    reste tel quel) ; nouvelle tache `sms-appointment-reminders` (15 min) : RDV « prevu », case
--    SMS cochee, N avant le RDV.
-- 6. SMS programmes : sms_schedule_appointments (RDV entre deux dates, type, N j/h/min avant ou
--    jour J-n a heure fixe, texte avec balises), sms_list, sms_cancel.
-- 7. Envoi : sms_dispatch_claim / sms_dispatch_result (cle de service, appeles par
--    dispatch-notifications et sms-brevo) ; sms_test_prepare (SMS de test au numero saisi par
--    l'administrateur, jamais celui d'un client).
-- RLS : sms_settings lecture membre / ecriture admin (via sms_settings_set, trace events).
-- =====================================================================

-- ------------------------------------------------------------ 1. societe de test (marquage ItalTest)
create or replace function public._sms_is_test_company(_company uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _r boolean;
begin
  if _company is null then return false; end if;
  if to_regprocedure('public.is_test_company(uuid)') is null then return false; end if;
  execute 'select public.is_test_company($1)' into _r using _company;
  return coalesce(_r, false);
end $$;
revoke execute on function public._sms_is_test_company(uuid) from public, anon;
grant execute on function public._sms_is_test_company(uuid) to authenticated, service_role;

-- ------------------------------------------------------------ 2. reglages SMS
create table if not exists public.sms_settings (
  company_id            uuid primary key references public.companies(id) on delete cascade,
  mode                  text not null default 'arrete' check (mode in ('arrete', 'test', 'actif')),
  test_recipient        text check (test_recipient is null or test_recipient ~ '^\+[1-9][0-9]{7,14}$'),
  sender                text check (sender is null or sender ~ '^[A-Za-z0-9]{1,11}$' or sender ~ '^[0-9]{1,15}$'),
  signature             text check (signature is null or length(signature) <= 40),
  opening_hours         text check (opening_hours is null or length(opening_hours) <= 120),
  ready_auto            boolean not null default true,
  reminder_auto         boolean not null default true,
  reminder_lead_minutes int not null default 1440 check (reminder_lead_minutes between 60 and 10080),
  templates             jsonb not null default '{}'::jsonb check (jsonb_typeof(templates) = 'object'),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id) on delete set null
);
comment on table public.sms_settings is
  'SMS (Brevo) par societe. Pas de ligne = arrete. arrete : rien ne part ; test : tout part au numero de test ; actif : envoi reel.';

drop trigger if exists trg_sms_settings_audit on public.sms_settings;
create trigger trg_sms_settings_audit after insert or update or delete on public.sms_settings
  for each row execute function public.audit_row();

-- Societe de test : le mode SMS reste « arrete » quoi qu'on enregistre (meme esprit que ItalTest).
create or replace function public.trg_sms_settings_test_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._sms_is_test_company(new.company_id) then
    new.mode := 'arrete'; new.test_recipient := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_sms_settings_test_company on public.sms_settings;
create trigger trg_sms_settings_test_company before insert or update on public.sms_settings
  for each row execute function public.trg_sms_settings_test_company();

alter table public.sms_settings enable row level security;
revoke all on public.sms_settings from anon;
revoke insert, update, delete on public.sms_settings from authenticated;
grant select on public.sms_settings to authenticated;
drop policy if exists sms_settings_select on public.sms_settings;
create policy sms_settings_select on public.sms_settings for select to authenticated
  using (public.is_member(company_id));
drop policy if exists sms_settings_write on public.sms_settings;
create policy sms_settings_write on public.sms_settings for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- ------------------------------------------------------------ 3. file de notifications
alter table public.notifications add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.notifications add column if not exists locale text;
alter table public.notifications add column if not exists sent_to text;
alter table public.notifications add column if not exists is_test boolean not null default false;
alter table public.notifications add column if not exists provider text;
alter table public.notifications add column if not exists provider_message_id text;
alter table public.notifications add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.notifications add column if not exists claimed_at timestamptz;
alter table public.notifications add column if not exists cancelled_at timestamptz;
alter table public.notifications add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

comment on column public.notifications.status is 'pending | sending | sent | failed | skipped | cancelled';
comment on column public.notifications.sent_to is 'Numero / adresse reellement utilise (numero de test en mode test).';
comment on column public.notifications.is_test is 'Vrai si le SMS est parti au numero de test (mode test ou SMS de test), pas chez le client.';
comment on column public.notifications.error is
  'Raison si non envoye : test_company, sms_off, no_test_recipient, consent_refused, invalid_number, rdv_changed, or_not_ready, no_api_key, brevo_<code>...';

create index if not exists idx_notif_sms_pending on public.notifications(scheduled_at) where channel = 'sms' and status = 'pending';
create index if not exists idx_notif_entity on public.notifications(entity_type, entity_id);
-- Un seul SMS de fin de travaux par OR, un seul rappel par RDV et par horaire (annule = rejouable).
create unique index if not exists uq_notif_sms_once on public.notifications(template, entity_id)
  where channel = 'sms' and template in ('workshop_ready', 'appointment_reminder_sms') and status <> 'cancelled';

-- ------------------------------------------------------------ outils (internes)
-- Numero en E.164, Belgique (+32) par defaut ; null si illisible. Miroir de normalizePhone (brevo-sms.ts).
create or replace function public._sms_e164(_raw text, _cc text default '32')
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare d text;
begin
  if _raw is null then return null; end if;
  d := regexp_replace(btrim(_raw), '[\s./()\-]', '', 'g');
  if d = '' then return null; end if;
  if d ~ '^\+' then d := substr(d, 2);
  elsif d ~ '^00' then d := substr(d, 3);
  elsif d ~ '^0' then d := _cc || substr(d, 2);
  elsif _cc = '32' and d ~ '^4[0-9]{8}$' then d := '32' || d;
  end if;
  if d !~ '^[1-9][0-9]{7,14}$' then return null; end if;
  -- Belgique : 8 ou 9 chiffres apres +32.
  if d ~ '^32' and length(d) not in (10, 11) then return null; end if;
  return '+' || d;
end $$;

-- Mobile ? Belgique : +32 4xx xx xx xx. Etranger : on ne sait pas, accepte.
create or replace function public._sms_is_mobile(_e164 text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select _e164 is not null and (_e164 !~ '^\+32' or _e164 ~ '^\+324[0-9]{8}$');
$$;

-- Le mobile connu d'un contact : mobile, puis GSM, puis telephone s'il s'agit d'un mobile.
create or replace function public._sms_mobile_of(_contact uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select x from (select public._sms_e164(c.mobile) x) a where public._sms_is_mobile(x)),
    (select x from (select public._sms_e164(c.gsm) x) a where public._sms_is_mobile(x)),
    (select x from (select public._sms_e164(c.phone) x) a where public._sms_is_mobile(x)))
  from public.contacts c where c.id = _contact;
$$;

-- Textes par defaut (sobres, sans caractere hors alphabet SMS standard : 1 SMS = 160 caracteres).
-- Miroir de SMS_DEFAULT_TEMPLATES (src/modules/crm/sms-rules.ts, test sms-brevo.test.ts).
create or replace function public._sms_default_template(_kind text, _locale text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case _kind
    when 'ready' then case coalesce(_locale, 'fr')
      when 'nl' then 'Beste {prenom}, uw {moto} staat klaar in de werkplaats (OR {or}). U kunt ze ophalen {horaires}. {societe}'
      when 'en' then 'Hello {prenom}, your {moto} is ready at the workshop (RO {or}). You can collect it {horaires}. {societe}'
      when 'it' then 'Buongiorno {prenom}, la sua {moto} è pronta in officina (OR {or}). Può ritirarla {horaires}. {societe}'
      else 'Bonjour {prenom}, votre {moto} est disponible à l''atelier (OR {or}). Vous pouvez venir la récupérer {horaires}. {societe}'
    end
    when 'reminder' then case coalesce(_locale, 'fr')
      when 'nl' then 'Beste {prenom}, herinnering aan uw afspraak in de werkplaats op {date} om {heure}. {societe}'
      when 'en' then 'Hello {prenom}, reminder of your workshop appointment on {date} at {heure}. {societe}'
      when 'it' then 'Buongiorno {prenom}, le ricordiamo l''appuntamento in officina il {date} alle {heure}. {societe}'
      else 'Bonjour {prenom}, rappel de votre rendez-vous atelier le {date} à {heure}. {societe}'
    end
  end;
$$;

-- {horaires} quand la societe n'a pas saisi ses horaires ; {moto} quand la moto est inconnue.
create or replace function public._sms_fallback(_what text, _locale text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case _what
    when 'horaires' then case coalesce(_locale, 'fr') when 'nl' then 'tijdens de openingsuren' when 'en' then 'during opening hours'
                                                      when 'it' then 'negli orari di apertura' else 'aux heures d''ouverture' end
    when 'moto' then case coalesce(_locale, 'fr') when 'nl' then 'moto' when 'en' then 'motorcycle' when 'it' then 'moto' else 'moto' end
  end;
$$;

-- Remplace les balises {cle} ; espaces doubles retires. Miroir de renderSms (sms-rules.ts).
create or replace function public._sms_render(_tpl text, _vars jsonb)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare k text; v text; _out text := coalesce(_tpl, '');
begin
  for k, v in select key, value from jsonb_each_text(coalesce(_vars, '{}'::jsonb)) loop
    _out := replace(_out, '{' || k || '}', coalesce(v, ''));
  end loop;
  _out := regexp_replace(_out, '[ ]{2,}', ' ', 'g');
  _out := regexp_replace(_out, ' ([.,])', '\1', 'g');
  return btrim(_out);
end $$;

-- Langue du client (FR par defaut).
create or replace function public._sms_locale(_l text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when _l in ('fr', 'nl', 'en', 'it') then _l else 'fr' end;
$$;

-- Modele de la societe pour un type et une langue, sinon texte par defaut.
create or replace function public._sms_template(_company uuid, _kind text, _locale text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    nullif(btrim((select s.templates -> _kind ->> public._sms_locale(_locale) from public.sms_settings s where s.company_id = _company)), ''),
    public._sms_default_template(_kind, public._sms_locale(_locale)));
$$;

-- Variables communes au client et a la societe.
create or replace function public._sms_base_vars(_company uuid, _contact uuid, _locale text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'prenom', coalesce(nullif(btrim(c.first_name), ''), nullif(btrim(c.company_name), ''), nullif(btrim(c.last_name), ''), ''),
    'nom', coalesce(nullif(btrim(c.last_name), ''), nullif(btrim(c.company_name), ''), ''),
    'horaires', coalesce(nullif(btrim(s.opening_hours), ''), public._sms_fallback('horaires', _locale)),
    'societe', coalesce(nullif(btrim(s.signature), ''), co.name, ''))
  from public.companies co
  left join public.contacts c on c.id = _contact
  left join public.sms_settings s on s.company_id = co.id
  where co.id = _company;
$$;

-- Cle d'un rappel : RDV + horaire (un RDV deplace recoit un nouveau rappel, l'ancien est ecarte).
create or replace function public._sms_appt_key(_id uuid, _starts timestamptz)
returns text language sql immutable set search_path = public, pg_temp as $$
  select _id::text || '@' || to_char(_starts at time zone 'UTC', 'YYYYMMDD"T"HH24MI');
$$;

-- ------------------------------------------------------------ 3b. garde a l'insertion (SMS)
create or replace function public.trg_notifications_sms_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _n text; _mode text;
begin
  if new.channel is distinct from 'sms' then return new; end if;
  if new.status not in ('pending', 'sending') then return new; end if;
  _n := public._sms_e164(new.to_address);
  if _n is not null then new.to_address := _n; end if;
  if public._sms_is_test_company(new.company_id) then
    new.status := 'skipped'; new.error := 'test_company'; return new;
  end if;
  if _n is null then
    new.status := 'skipped'; new.error := 'invalid_number'; return new;
  end if;
  if coalesce(new.template, '') <> 'sms_test' then
    _mode := coalesce((select mode from public.sms_settings where company_id = new.company_id), 'arrete');
    if _mode = 'arrete' then new.status := 'skipped'; new.error := 'sms_off'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_notifications_sms_guard on public.notifications;
create trigger trg_notifications_sms_guard before insert on public.notifications
  for each row execute function public.trg_notifications_sms_guard();

-- Enfiler un SMS (interne) : une fois par cle pour la fin de travaux et les rappels. Null = deja la.
create or replace function public._sms_enqueue(
  _company uuid, _contact uuid, _to text, _body text, _template text, _entity_type text, _entity_id text,
  _locale text, _scheduled timestamptz default now()
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare _id bigint;
begin
  insert into public.notifications (company_id, channel, to_address, body, template, entity_type, entity_id,
                                    contact_id, locale, scheduled_at, created_by)
  values (_company, 'sms', _to, _body, _template, _entity_type, _entity_id, _contact, _locale,
          coalesce(_scheduled, now()), auth.uid())
  on conflict (template, entity_id)
    where channel = 'sms' and template in ('workshop_ready', 'appointment_reminder_sms') and status <> 'cancelled'
    do nothing
  returning id into _id;
  return _id;
end $$;

-- Outils internes security definer : jamais appelables depuis l'application.
revoke execute on function public._sms_mobile_of(uuid) from public, anon, authenticated;
revoke execute on function public._sms_template(uuid, text, text) from public, anon, authenticated;
revoke execute on function public._sms_base_vars(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._sms_enqueue(uuid, uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------ 4. fin de travaux (OR « pret »)
create or replace function public._sms_queue_ready(_or uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype;
  s public.sms_settings%rowtype;
  _loc text; _to text; _moto text; _reason text; _id bigint; _vars jsonb;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then return 'no_or'; end if;
  select * into s from public.sms_settings where company_id = r.company_id;
  if r.contact_id is null then _reason := 'no_contact';
  elsif found and not s.ready_auto then _reason := 'auto_off';
  elsif public._consent_channel(r.contact_id, 'sms') = 'refuse' then _reason := 'consent_refused';
  else
    _to := public._sms_mobile_of(r.contact_id);
    if _to is null then _reason := 'no_mobile'; end if;
  end if;
  if _reason is not null then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
    values (r.company_id, auth.uid(), 'sms_ready_not_queued', 'repair_orders', r.id::text, 'system',
            jsonb_build_object('reason', _reason, 'number', r.number));
    return _reason;
  end if;
  _loc := public._sms_locale((select locale from public.contacts where id = r.contact_id));
  select nullif(btrim(concat_ws(' ', v.brand, v.model)), '') into _moto from public.vehicles v where v.id = r.vehicle_id;
  _vars := public._sms_base_vars(r.company_id, r.contact_id, _loc)
           || jsonb_build_object('moto', coalesce(_moto, public._sms_fallback('moto', _loc)), 'or', coalesce(r.number, ''));
  _id := public._sms_enqueue(r.company_id, r.contact_id, _to,
           public._sms_render(public._sms_template(r.company_id, 'ready', _loc), _vars),
           'workshop_ready', 'repair_order', r.id::text, _loc, now());
  return case when _id is null then 'already' else 'queued' end;
end $$;
revoke execute on function public._sms_queue_ready(uuid) from public, anon, authenticated;

create or replace function public.trg_repair_orders_ready_sms()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'pret' and (tg_op = 'INSERT' or old.status is distinct from 'pret') then
    begin
      perform public._sms_queue_ready(new.id);
    exception when others then
      -- Le SMS ne doit jamais empecher de passer l'OR a « Pret ».
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
      values (new.company_id, auth.uid(), 'sms_ready_error', 'repair_orders', new.id::text, 'system',
              jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_repair_orders_ready_sms on public.repair_orders;
create trigger trg_repair_orders_ready_sms after insert or update of status on public.repair_orders
  for each row execute function public.trg_repair_orders_ready_sms();

-- Etat du SMS de fin de travaux d'un OR (ecran de l'OR).
create or replace function public.sms_ready_state(_or uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _c uuid; n record; e record;
begin
  select company_id into _c from public.repair_orders where id = _or;
  if _c is null or not public.is_member(_c) then return null; end if;
  select id, status, error, scheduled_at, sent_at, created_at, is_test into n from public.notifications
   where channel = 'sms' and template = 'workshop_ready' and entity_id = _or::text
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('status', n.status, 'reason', n.error, 'at', coalesce(n.sent_at, n.created_at), 'is_test', n.is_test, 'id', n.id);
  end if;
  select occurred_at, new_data into e from public.events
   where entity_type = 'repair_orders' and entity_id = _or::text and action = 'sms_ready_not_queued'
   order by occurred_at desc limit 1;
  if found then
    return jsonb_build_object('status', 'not_queued', 'reason', e.new_data ->> 'reason', 'at', e.occurred_at);
  end if;
  return null;
end $$;
revoke all on function public.sms_ready_state(uuid) from public, anon;
grant execute on function public.sms_ready_state(uuid) to authenticated;

-- ------------------------------------------------------------ 5. rappels de RDV
-- Tache mail : identique, sans la partie SMS (passee a _cron_sms_appointment_reminders).
create or replace function public._cron_appointment_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; _n int := 0;
begin
  for a in
    select ap.id, ap.company_id, ap.starts_at, c.email,
           coalesce(c.company_name, trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))) as name
    from public.workshop_appointments ap join public.contacts c on c.id = ap.contact_id
    where ap.status = 'prevu' and ap.starts_at::date = (current_date + 1)
  loop
    if coalesce(a.email,'') <> '' then
      perform public.enqueue_notification(a.company_id, 'email', a.email, 'Rappel de rendez-vous atelier',
        'Bonjour ' || a.name || ', nous vous rappelons votre rendez-vous atelier le ' || to_char(a.starts_at, 'DD/MM/YYYY à HH24:MI') || '.',
        'appointment_reminder', 'appointment', a.id::text);
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end $$;
revoke execute on function public._cron_appointment_reminders() from public, anon, authenticated;
grant execute on function public._cron_appointment_reminders() to service_role;

-- Un rappel SMS pour un RDV (interne). Retourne queued | already | no_mobile | consent_refused | no_contact.
create or replace function public._sms_queue_reminder(_appt uuid, _scheduled timestamptz, _custom text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.workshop_appointments%rowtype; _loc text; _to text; _vars jsonb; _tpl text; _id bigint;
begin
  select * into a from public.workshop_appointments where id = _appt;
  if not found or a.contact_id is null then return 'no_contact'; end if;
  if public._consent_channel(a.contact_id, 'sms') = 'refuse' then return 'consent_refused'; end if;
  _to := public._sms_mobile_of(a.contact_id);
  if _to is null then return 'no_mobile'; end if;
  _loc := public._sms_locale((select locale from public.contacts where id = a.contact_id));
  _vars := public._sms_base_vars(a.company_id, a.contact_id, _loc) || jsonb_build_object(
    'date', to_char(a.starts_at at time zone 'Europe/Brussels', 'DD/MM'),
    'heure', to_char(a.starts_at at time zone 'Europe/Brussels', 'HH24:MI'),
    'moto', coalesce((select nullif(btrim(concat_ws(' ', v.brand, v.model)), '') from public.vehicles v where v.id = a.vehicle_id),
                     public._sms_fallback('moto', _loc)),
    'or', '');
  _tpl := coalesce(nullif(btrim(_custom), ''), public._sms_template(a.company_id, 'reminder', _loc));
  _id := public._sms_enqueue(a.company_id, a.contact_id, _to, public._sms_render(_tpl, _vars),
           'appointment_reminder_sms', 'appointment', public._sms_appt_key(a.id, a.starts_at), _loc, _scheduled);
  return case when _id is null then 'already' else 'queued' end;
end $$;
revoke execute on function public._sms_queue_reminder(uuid, timestamptz, text) from public, anon, authenticated;

-- Tache (15 min) : RDV « prevu », case SMS cochee, a moins de N du RDV (et a plus d'une heure).
create or replace function public._cron_sms_appointment_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; _n int := 0;
begin
  for a in
    select ap.id
      from public.workshop_appointments ap
      left join public.sms_settings s on s.company_id = ap.company_id
     where ap.status = 'prevu' and ap.notify_sms and coalesce(ap.unassigned, false) = false
       and coalesce(s.reminder_auto, true)
       and ap.starts_at > now() + interval '1 hour'
       and ap.starts_at - make_interval(mins => coalesce(s.reminder_lead_minutes, 1440)) <= now()
  loop
    if public._sms_queue_reminder(a.id, now()) = 'queued' then _n := _n + 1; end if;
  end loop;
  return _n;
end $$;
revoke execute on function public._cron_sms_appointment_reminders() from public, anon, authenticated;
grant execute on function public._cron_sms_appointment_reminders() to service_role;

-- ------------------------------------------------------------ 6. SMS programmes
create or replace function public.sms_schedule_appointments(
  _company uuid, _from date, _to date, _type text default null,
  _lead_minutes int default null, _days_before int default null, _at_time time default null,
  _template text default null, _only_checked boolean default true, _appointment uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record; _when timestamptz; _r text;
  _res jsonb := jsonb_build_object('queued', 0, 'already', 0, 'no_mobile', 0, 'consent_refused', 0, 'no_contact', 0, 'too_late', 0);
begin
  if not public.is_member(_company) or not public.can_write_table(_company, 'workshop_appointments') then
    raise exception 'SMS_FORBIDDEN' using errcode = '42501';
  end if;
  if public._sms_is_test_company(_company) then
    raise exception 'SMS_TEST_COMPANY' using errcode = '22023';
  end if;
  if _appointment is null and (_from is null or _to is null or _to < _from or _to - _from > 62) then
    raise exception 'SMS_BAD_RANGE' using errcode = '22023';
  end if;
  if _at_time is null and (_lead_minutes is null or _lead_minutes < 10 or _lead_minutes > 20160) then
    raise exception 'SMS_BAD_LEAD' using errcode = '22023';
  end if;
  if _at_time is not null and (_days_before is null or _days_before < 0 or _days_before > 14) then
    raise exception 'SMS_BAD_LEAD' using errcode = '22023';
  end if;
  if _template is not null and length(_template) > 480 then
    raise exception 'SMS_TOO_LONG' using errcode = '22023';
  end if;
  for a in
    select ap.id, ap.starts_at from public.workshop_appointments ap
     where ap.company_id = _company and ap.status = 'prevu' and ap.starts_at > now()
       and coalesce(ap.unassigned, false) = false
       and (_appointment is not null and ap.id = _appointment
            or _appointment is null
               and (ap.starts_at at time zone 'Europe/Brussels')::date between _from and _to
               and (_type is null or ap.appointment_type = _type)
               and (not coalesce(_only_checked, true) or ap.notify_sms))
     order by ap.starts_at
  loop
    if _at_time is not null then
      _when := (((a.starts_at at time zone 'Europe/Brussels')::date - _days_before) + _at_time) at time zone 'Europe/Brussels';
    else
      _when := a.starts_at - make_interval(mins => _lead_minutes);
    end if;
    if _when < now() - interval '5 minutes' or _when >= a.starts_at then
      _r := 'too_late';
    else
      _r := public._sms_queue_reminder(a.id, greatest(_when, now()), _template);
    end if;
    _res := jsonb_set(_res, array[_r], to_jsonb(coalesce((_res ->> _r)::int, 0) + 1));
  end loop;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'sms_scheduled', 'notifications', null, 'screen',
          jsonb_build_object('from', _from, 'to', _to, 'type', _type, 'lead_minutes', _lead_minutes, 'days_before', _days_before,
                             'at_time', _at_time, 'appointment', _appointment, 'custom_text', _template is not null, 'result', _res));
  return _res;
end $$;
revoke all on function public.sms_schedule_appointments(uuid, date, date, text, int, int, time, text, boolean, uuid) from public, anon;
grant execute on function public.sms_schedule_appointments(uuid, date, date, text, int, int, time, text, boolean, uuid) to authenticated;

-- Liste : scope 'scheduled' (en attente) ou 'history' (le reste, du plus recent).
create or replace function public.sms_list(_company uuid, _scope text default 'scheduled', _limit int default 200)
returns table(
  id bigint, template text, status text, error text, to_address text, sent_to text, is_test boolean, body text,
  scheduled_at timestamptz, sent_at timestamptz, created_at timestamptz, cancelled_at timestamptz,
  contact_id uuid, contact_name text, entity_type text, entity_id text
) language sql stable security definer set search_path = public, pg_temp as $$
  select n.id, n.template, n.status, n.error, n.to_address, n.sent_to, n.is_test, n.body,
         n.scheduled_at, n.sent_at, n.created_at, n.cancelled_at, n.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as contact_name,
         n.entity_type, n.entity_id
    from public.notifications n
    left join public.contacts c on c.id = n.contact_id
   where n.company_id = _company and n.channel = 'sms' and public.is_member(_company)
     and (case when _scope = 'scheduled' then n.status = 'pending' else n.status <> 'pending' end)
   order by case when _scope = 'scheduled' then extract(epoch from n.scheduled_at) else -extract(epoch from n.created_at) end
   limit least(greatest(coalesce(_limit, 200), 1), 500);
$$;
revoke all on function public.sms_list(uuid, text, int) from public, anon;
grant execute on function public.sms_list(uuid, text, int) to authenticated;

create or replace function public.sms_cancel(_id bigint, _reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.notifications%rowtype;
begin
  select * into n from public.notifications where id = _id and channel = 'sms' for update;
  if not found then raise exception 'SMS_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_member(n.company_id)
     or not (public.is_admin(n.company_id) or public.can_write_table(n.company_id, 'workshop_appointments')) then
    raise exception 'SMS_FORBIDDEN' using errcode = '42501';
  end if;
  if n.status <> 'pending' then raise exception 'SMS_NOT_PENDING' using errcode = '22023'; end if;
  update public.notifications set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         error = nullif(left(btrim(coalesce(_reason, '')), 200), '')
   where id = _id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (n.company_id, auth.uid(), 'sms_cancelled', 'notifications', _id::text, 'screen',
          jsonb_build_object('status', n.status, 'scheduled_at', n.scheduled_at, 'template', n.template),
          jsonb_build_object('status', 'cancelled', 'reason', _reason));
end $$;
revoke all on function public.sms_cancel(bigint, text) from public, anon;
grant execute on function public.sms_cancel(bigint, text) to authenticated;

-- ------------------------------------------------------------ reglages : lire / changer
create or replace function public.sms_settings_get(_company uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'mode', coalesce(s.mode, 'arrete'), 'test_recipient', s.test_recipient, 'sender', s.sender,
    'signature', s.signature, 'opening_hours', s.opening_hours,
    'ready_auto', coalesce(s.ready_auto, true), 'reminder_auto', coalesce(s.reminder_auto, true),
    'reminder_lead_minutes', coalesce(s.reminder_lead_minutes, 1440), 'templates', coalesce(s.templates, '{}'::jsonb),
    'company_name', co.name, 'is_test_company', public._sms_is_test_company(co.id), 'updated_at', s.updated_at)
  from public.companies co left join public.sms_settings s on s.company_id = co.id
  where co.id = _company and (auth.uid() is null or public.is_member(_company));
$$;
revoke all on function public.sms_settings_get(uuid) from public, anon;
grant execute on function public.sms_settings_get(uuid) to authenticated, service_role;

create or replace function public.sms_settings_set(_company uuid, _s jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_s jsonb; _mode text; _rec text; _sender text; _lead int; _tpl jsonb; k text; l text; v text;
begin
  if not public.is_admin(_company) then raise exception 'SMS_FORBIDDEN' using errcode = '42501'; end if;
  _mode := coalesce(_s ->> 'mode', 'arrete');
  if _mode not in ('arrete', 'test', 'actif') then raise exception 'SMS_BAD_MODE' using errcode = '22023'; end if;
  _rec := nullif(btrim(coalesce(_s ->> 'test_recipient', '')), '');
  if _rec is not null then
    _rec := public._sms_e164(_rec);
    if _rec is null then raise exception 'SMS_BAD_NUMBER' using errcode = '22023'; end if;
  end if;
  if _mode = 'test' and _rec is null then raise exception 'SMS_TEST_NEEDS_NUMBER' using errcode = '22023'; end if;
  _sender := nullif(btrim(coalesce(_s ->> 'sender', '')), '');
  if _sender is not null and _sender !~ '^[A-Za-z0-9]{1,11}$' and _sender !~ '^[0-9]{1,15}$' then
    raise exception 'SMS_BAD_SENDER' using errcode = '22023';
  end if;
  _lead := coalesce((_s ->> 'reminder_lead_minutes')::int, 1440);
  if _lead < 60 or _lead > 10080 then raise exception 'SMS_BAD_LEAD' using errcode = '22023'; end if;
  _tpl := coalesce(_s -> 'templates', '{}'::jsonb);
  if jsonb_typeof(_tpl) <> 'object' then raise exception 'SMS_BAD_TEMPLATE' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(_tpl) loop
    if k not in ('ready', 'reminder') or jsonb_typeof(_tpl -> k) <> 'object' then
      raise exception 'SMS_BAD_TEMPLATE' using errcode = '22023';
    end if;
    for l, v in select key, value from jsonb_each_text(_tpl -> k) loop
      if l not in ('fr', 'nl', 'en', 'it') or length(coalesce(v, '')) > 480 then
        raise exception 'SMS_BAD_TEMPLATE' using errcode = '22023';
      end if;
    end loop;
  end loop;
  old_s := public.sms_settings_get(_company);
  insert into public.sms_settings (company_id, mode, test_recipient, sender, signature, opening_hours, ready_auto, reminder_auto,
                                   reminder_lead_minutes, templates, updated_at, updated_by)
  values (_company, _mode, _rec, _sender, nullif(btrim(coalesce(_s ->> 'signature', '')), ''),
          nullif(btrim(coalesce(_s ->> 'opening_hours', '')), ''),
          coalesce((_s ->> 'ready_auto')::boolean, true), coalesce((_s ->> 'reminder_auto')::boolean, true),
          _lead, _tpl, now(), auth.uid())
  on conflict (company_id) do update set
    mode = excluded.mode, test_recipient = excluded.test_recipient, sender = excluded.sender,
    signature = excluded.signature, opening_hours = excluded.opening_hours, ready_auto = excluded.ready_auto,
    reminder_auto = excluded.reminder_auto, reminder_lead_minutes = excluded.reminder_lead_minutes,
    templates = excluded.templates, updated_at = now(), updated_by = auth.uid();
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'sms_settings', 'sms_settings', _company::text, 'screen', old_s, public.sms_settings_get(_company));
  return public.sms_settings_get(_company);
end $$;
revoke all on function public.sms_settings_set(uuid, jsonb) from public, anon;
grant execute on function public.sms_settings_set(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ 7. envoi (fonctions Edge)
-- SMS de test : administrateur, numero saisi a l'ecran, 5 par heure et par societe au plus.
create or replace function public.sms_test_prepare(_company uuid, _to text, _body text)
returns table(id bigint, to_address text, body text, sender text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare _n text; _id bigint; _b text;
begin
  if not public.is_admin(_company) then raise exception 'SMS_FORBIDDEN' using errcode = '42501'; end if;
  if public._sms_is_test_company(_company) then
    raise exception 'SMS_TEST_COMPANY' using errcode = '22023';
  end if;
  _n := public._sms_e164(_to);
  if _n is null then raise exception 'SMS_BAD_NUMBER' using errcode = '22023'; end if;
  _b := left(btrim(coalesce(_body, '')), 160);
  if _b = '' then raise exception 'SMS_EMPTY' using errcode = '22023'; end if;
  if (select count(*) from public.notifications x where x.company_id = _company and x.template = 'sms_test'
        and x.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'SMS_TEST_LIMIT' using errcode = '22023';
  end if;
  insert into public.notifications (company_id, channel, to_address, body, template, entity_type, entity_id, status,
                                    sent_to, is_test, claimed_at, created_by)
  values (_company, 'sms', _n, _b, 'sms_test', 'company', _company::text, 'sending', _n, true, now(), auth.uid())
  returning notifications.id into _id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'sms_test_requested', 'notifications', _id::text, 'screen', jsonb_build_object('to', _n));
  return query select n.id, n.to_address, n.body, s.sender
    from public.notifications n left join public.sms_settings s on s.company_id = n.company_id
   where n.id = _id and n.status = 'sending';
end $$;
revoke all on function public.sms_test_prepare(uuid, text, text) from public, anon;
grant execute on function public.sms_test_prepare(uuid, text, text) to authenticated;

-- Prendre un lot de SMS a envoyer (cle de service). Ecarte (skipped, raison) ce qui ne doit plus partir.
create or replace function public.sms_dispatch_claim(_limit int default 50)
returns table(id bigint, company_id uuid, send_to text, body text, sender text, is_test boolean, template text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  n public.notifications%rowtype; s public.sms_settings%rowtype; _has boolean;
  _reason text; _appt public.workshop_appointments%rowtype; _ro text;
begin
  -- Prise en charge restee sans reponse (fonction coupee) : echec, jamais de second envoi.
  update public.notifications x set status = 'failed', error = 'stuck_sending'
   where x.channel = 'sms' and x.status = 'sending' and x.claimed_at < now() - interval '15 minutes';

  for n in
    select * from public.notifications x
     where x.channel = 'sms' and x.status = 'pending' and x.scheduled_at <= now()
     order by x.scheduled_at limit least(greatest(coalesce(_limit, 50), 1), 200)
     for update skip locked
  loop
    _reason := null;
    select * into s from public.sms_settings where sms_settings.company_id = n.company_id;
    _has := found;
    if public._sms_is_test_company(n.company_id) then _reason := 'test_company';
    elsif not _has or s.mode = 'arrete' then _reason := 'sms_off';
    elsif s.mode = 'test' and s.test_recipient is null then _reason := 'no_test_recipient';
    elsif public._sms_e164(n.to_address) is null then _reason := 'invalid_number';
    elsif n.contact_id is not null and public._consent_channel(n.contact_id, 'sms') = 'refuse' then _reason := 'consent_refused';
    elsif n.template = 'appointment_reminder_sms' then
      select * into _appt from public.workshop_appointments a where a.id::text = split_part(n.entity_id, '@', 1);
      if not found or _appt.status <> 'prevu' or public._sms_appt_key(_appt.id, _appt.starts_at) <> n.entity_id then
        _reason := 'rdv_changed';
      elsif _appt.starts_at <= now() then _reason := 'rdv_past';
      end if;
    elsif n.template = 'workshop_ready' then
      select r.status into _ro from public.repair_orders r where r.id::text = n.entity_id;
      if _ro is null or _ro not in ('pret', 'client_informe', 'facture') then _reason := 'or_not_ready'; end if;
    end if;

    if _reason is not null then
      update public.notifications x set status = 'skipped', error = _reason where x.id = n.id;
    else
      update public.notifications x
         set status = 'sending', claimed_at = now(), is_test = (s.mode = 'test'),
             sent_to = case when s.mode = 'test' then s.test_recipient else public._sms_e164(n.to_address) end
       where x.id = n.id;
      id := n.id; company_id := n.company_id; body := n.body; sender := s.sender; template := n.template;
      is_test := (s.mode = 'test');
      send_to := case when s.mode = 'test' then s.test_recipient else public._sms_e164(n.to_address) end;
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.sms_dispatch_claim(int) from public, anon, authenticated;
grant execute on function public.sms_dispatch_claim(int) to service_role;

-- Resultat d'un envoi (cle de service). Envoye chez le client : echange ajoute a l'historique CRM.
create or replace function public.sms_dispatch_result(_id bigint, _status text, _error text default null, _provider_id text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.notifications%rowtype;
begin
  if _status not in ('sent', 'failed', 'skipped') then raise exception 'SMS_BAD_STATUS' using errcode = '22023'; end if;
  select * into n from public.notifications where id = _id and channel = 'sms' for update;
  if not found then raise exception 'SMS_NOT_FOUND' using errcode = 'P0002'; end if;
  if n.status <> 'sending' then return; end if;
  update public.notifications
     set status = _status, error = case when _status = 'sent' then null else left(coalesce(_error, _status), 300) end,
         sent_at = case when _status = 'sent' then now() else null end,
         provider = 'brevo', provider_message_id = left(_provider_id, 100)
   where id = _id;
  if _status = 'sent' and not n.is_test and n.contact_id is not null
     and n.template in ('workshop_ready', 'appointment_reminder_sms') then
    insert into public.communications (company_id, contact_id, channel, direction, subject, body, occurred_at)
    values (n.company_id, n.contact_id, 'sms', 'out', null, n.body, now());
  end if;
end $$;
revoke all on function public.sms_dispatch_result(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.sms_dispatch_result(bigint, text, text, text) to service_role;

-- ------------------------------------------------------------ planification (pg_cron)
do $$
begin
  perform cron.schedule('sms-appointment-reminders', '*/15 * * * *',
    $cron$ select public._cron_sms_appointment_reminders(); $cron$);
exception when others then
  raise notice 'pg_cron sms-appointment-reminders skipped: %', sqlerrm;
end $$;
