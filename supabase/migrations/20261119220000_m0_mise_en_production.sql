-- =====================================================================
-- M0 / M10 — MISE EN PRODUCTION ET MAILS AUTOMATIQUES PAR OUTLOOK (19/11/2026, lot-mise-en-prod)
-- Demandes du client du 19/11 : Q53 « tous les mails automatiques partent de la boite Outlook de la
-- concession » et bouton « Mise en production » dans Parametres (administrateurs).
--
-- CONSTAT EN PRODUCTION (lecture seule, 19/11) : « les relances sont en test, je n'ai jamais rien recu »
--   - Relances d'entretien (followup_settings : mode test, adresse de test posee) : la tache pg_cron
--     `followups-plan` ECHOUE TOUS LES JOURS depuis le 31/10 (20 echecs sur 20) : « Acces refuse a la
--     societe » dans vehicles_maintenance_upcoming. Sous pg_cron il n'y a pas de jeton : auth.role()
--     est vide, is_member() est faux, la fonction refuse. Aucune relance n'a donc jamais ete planifiee
--     (table followups vide), et `followups-send` (6 h 15) n'a jamais rien eu a envoyer.
--   - Relances de factures automatiques (`invoice-reminders`, 7 h) et rappels de RDV par mail
--     (`appointment-reminders`, 17 h) : enfiles dans `notifications`, partis vers Resend qui n'a jamais
--     ete configure -> 23 lignes, toutes « skipped ». Et elles visaient l'adresse DU CLIENT : aucun mode
--     test n'existait sur ce chemin.
--   - Relances d'impayes G8 (lettres 01-04, envoi depuis l'ecran) : 0 envoi a ce jour (dunning_letters vide).
--
-- CE QUE FAIT CETTE MIGRATION
--   1. vehicles_maintenance_upcoming : un appel interne (pg_cron, cle de service : pas d'utilisateur)
--      est accepte ; un utilisateur doit toujours etre membre. -> la planification des relances marche.
--   2. _cron_appointment_reminders : date et heure de BRUXELLES (avant : UTC, 1 h ou 2 h de decalage
--      dans le texte du mail, et « demain » calcule en UTC).
--   3. automation_settings (une ligne par societe) : boite partagee d'envoi des mails automatiques
--      (defaut : info@, sinon la boite principale, sinon la premiere boite active) et adresse de test.
--   4. automation_switches : interrupteurs des automatismes qui n'en avaient pas (mail de rappel de
--      RDV, relance automatique des factures echues, confirmation de commande e-shop, invitation a
--      l'espace client en pied de mail, releve Outlook, classification IA des mails, resume IA des
--      echanges). Arrete par defaut, SAUF ce qui tourne deja volontairement en production (releve
--      Outlook, classification, resume, invitation en pied de mail : Actif par defaut).
--   5. File `notifications`, partie MAIL : mail_dispatch_claim / mail_dispatch_result (cle de service,
--      appelees par dispatch-notifications) ; la base decide : societe de test, interrupteur
--      (arrete -> « skipped / mail_off », test -> adresse de test + objet prefixe, actif -> client),
--      boite d'envoi, RDV deplace, facture payee entre-temps. Envoi par Microsoft Graph (Resend retire).
--   6. receivable_settings.dunning_mode accepte « actif » : le jour J n'est plus une migration, c'est
--      le bouton « Mise en production » (production_apply). receivable_settings_set refuse toujours
--      « actif » : le seul chemin vers l'envoi reel est la fenetre de mise en production.
--   7. integration_status : presence (oui / non, JAMAIS la valeur) des secrets du serveur, relevee par
--      la fonction Edge `production-status` a l'ouverture de la fenetre.
--   8. production_overview(_company) : TOUT ce qui sort, son etat (arrete / test / actif / non utilise),
--      ce qui manque pour le demarrer, et les taches pg_cron (derniere execution).
--      production_apply(_company, _keys, _action) : start | test | pause, via les interrupteurs
--      EXISTANTS de chaque module (shopify_sync_set_mode, shopify_orders_set_import,
--      followup_settings_set, sms_settings_set...), une ligne `events` par element (qui, quand,
--      quoi, ancien / nouveau). Refus : non configure, societe de test (pour start / test).
--
-- Idempotente. NON APPLIQUEE (Simon la passe). Plage du lot : 20261119220000 -> 20261119229999.
-- Suppose appliquees : 20261119170000 (SMS Brevo, _sms_is_test_company), 20261118171000 (relances
-- d'impayes), 20261118250000 (transfert comptable). Societe de test : lot ItalTest
-- (public.is_test_company) lu s'il existe, via _sms_is_test_company.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Planification des relances d'entretien : la tache pg_cron n'a pas d'utilisateur
-- ---------------------------------------------------------------------
create or replace function public.vehicles_maintenance_upcoming(_company uuid, _days integer default 30)
returns table (
  vehicle_id uuid, vin text, model_label text, contact_id uuid, contact_name text, email text, phone text,
  locale text, kind text, due_date date, due_km integer, days_left integer, source text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- 19/11/2026 : appel interne (pg_cron via followups_daily, cle de service) = pas d'utilisateur.
  -- Avant, seul auth.role() = service_role passait : sous pg_cron la fonction refusait et
  -- `followups-plan` echouait chaque jour. anon n'a pas le droit d'execution (revoke ci-dessous).
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' and not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select distinct on (v.id)
         v.id,
         v.vin,
         nullif(concat_ws(' ', v.brand, v.model, v.model_year::text), '') as model_label,
         c.id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as contact_name,
         coalesce(nullif(btrim(c.email), ''), nullif(btrim(c.email_pro), '')) as email,
         coalesce(nullif(btrim(c.mobile), ''), nullif(btrim(c.gsm), ''), nullif(btrim(c.phone), ''),
                  nullif(btrim(c.mobile_pro), ''), nullif(btrim(c.phone_pro), '')) as phone,
         coalesce(to_jsonb(c) ->> 'locale', 'fr') as locale,
         d.kind,
         d.due_date,
         d.due_km,
         case when d.due_date is not null then (d.due_date - current_date)::integer
              else 0 end as days_left,
         d.source
    from public.vehicle_maintenance_due d
    join public.vehicles v on v.id = d.vehicle_id
    left join public.vehicle_owners vo on vo.vehicle_id = v.id and vo.is_current
    left join public.contacts c on c.id = vo.contact_id
   where d.company_id = _company and d.is_current
     and v.is_active
     and (
          (d.due_date is not null and d.due_date <= current_date + greatest(0, coalesce(_days, 30)))
          or (d.due_km is not null and greatest(coalesce(v.declared_km, 0), coalesce(v.mileage, 0)) >= d.due_km)
         )
   order by v.id, d.due_date nulls last, vo.from_date desc;
end $fn$;
revoke all on function public.vehicles_maintenance_upcoming(uuid, integer) from public, anon;
grant execute on function public.vehicles_maintenance_upcoming(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Rappel de RDV par mail : heure de Bruxelles (bug signale par le lot SMS)
-- ---------------------------------------------------------------------
create or replace function public._cron_appointment_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; _n int := 0;
begin
  for a in
    select ap.id, ap.company_id, ap.starts_at, c.email,
           coalesce(c.company_name, trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))) as name
    from public.workshop_appointments ap join public.contacts c on c.id = ap.contact_id
    where ap.status = 'prevu'
      and (ap.starts_at at time zone 'Europe/Brussels')::date = ((now() at time zone 'Europe/Brussels')::date + 1)
  loop
    if coalesce(a.email,'') <> '' then
      perform public.enqueue_notification(a.company_id, 'email', a.email, 'Rappel de rendez-vous atelier',
        'Bonjour ' || a.name || ', nous vous rappelons votre rendez-vous atelier le '
          || to_char(a.starts_at at time zone 'Europe/Brussels', 'DD/MM/YYYY à HH24:MI') || '.',
        'appointment_reminder', 'appointment', a.id::text);
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end $$;
revoke execute on function public._cron_appointment_reminders() from public, anon, authenticated;
grant execute on function public._cron_appointment_reminders() to service_role;

-- ---------------------------------------------------------------------
-- 3. Reglages des mails automatiques : boite d'envoi, adresse de test
-- ---------------------------------------------------------------------
create table if not exists public.automation_settings (
  company_id          uuid primary key references public.companies(id) on delete cascade,
  sender_mailbox      text check (sender_mailbox is null or sender_mailbox = lower(btrim(sender_mailbox))),
  mail_test_recipient text check (mail_test_recipient is null or mail_test_recipient ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$'),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null
);
comment on table public.automation_settings is
  'Q53 (19/11/2026) : boite partagee d envoi des mails automatiques (vide = info@, sinon boite principale, '
  'sinon premiere boite active) et adresse qui recoit les mails automatiques en mode test.';

drop trigger if exists trg_automation_settings_audit on public.automation_settings;
create trigger trg_automation_settings_audit after insert or update or delete on public.automation_settings
  for each row execute function public.audit_row();

alter table public.automation_settings enable row level security;
revoke all on public.automation_settings from anon;
revoke insert, update, delete on public.automation_settings from authenticated;
grant select on public.automation_settings to authenticated;
drop policy if exists automation_settings_select on public.automation_settings;
create policy automation_settings_select on public.automation_settings for select to authenticated
  using (public.is_member(company_id));

-- Boite d'envoi effective : reglage (si c'est une boite active de la societe), puis une boite
-- « atelier », puis info@, puis la boite principale de la societe, puis la premiere boite active.
-- Jamais une adresse hors de company_mailboxes (meme regle que graph-send-email : boites de la societe).
create or replace function public.notification_sender(_company uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  with boxes as (
    select lower(m.address) as address, m.purpose
      from public.company_mailboxes m
     where m.company_id = _company and m.is_active
  )
  select coalesce(
    (select b.address from boxes b join public.automation_settings s on s.company_id = _company and s.sender_mailbox = b.address),
    (select b.address from boxes b where b.purpose in ('atelier', 'workshop') order by b.address limit 1),
    (select b.address from boxes b where b.address like 'info@%' order by b.address limit 1),
    (select b.address from boxes b join public.companies co on co.id = _company and lower(co.inbound_mailbox) = b.address),
    (select b.address from boxes b order by b.address limit 1)
  )
  where auth.uid() is null or public.is_member(_company);
$$;
revoke all on function public.notification_sender(uuid) from public, anon;
grant execute on function public.notification_sender(uuid) to authenticated, service_role;

-- Adresse de test des mails automatiques : reglage, puis (relances de factures) celle des relances
-- d'impayes, puis celle des relances d'entretien. Null = aucune.
create or replace function public.mail_test_recipient(_company uuid, _template text default null)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _r text;
begin
  if auth.uid() is not null and not public.is_member(_company) then return null; end if;
  select nullif(btrim(s.mail_test_recipient), '') into _r from public.automation_settings s where s.company_id = _company;
  if _r is null and _template = 'invoice_reminder' and to_regclass('public.receivable_settings') is not null then
    execute 'select nullif(btrim(dunning_test_recipient), '''') from public.receivable_settings where company_id = $1'
      into _r using _company;
  end if;
  if _r is null and to_regclass('public.followup_settings') is not null then
    execute 'select nullif(btrim(test_recipient), '''') from public.followup_settings where company_id = $1'
      into _r using _company;
  end if;
  return lower(_r);
end $$;
revoke all on function public.mail_test_recipient(uuid, text) from public, anon;
grant execute on function public.mail_test_recipient(uuid, text) to authenticated, service_role;

create or replace function public.automation_settings_set(_company uuid, _sender_mailbox text, _mail_test_recipient text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _old jsonb; _box text; _rcpt text;
begin
  if not public.is_admin(_company) then raise exception 'MEP_FORBIDDEN' using errcode = '42501'; end if;
  _box := nullif(lower(btrim(coalesce(_sender_mailbox, ''))), '');
  if _box is not null and not exists (select 1 from public.company_mailboxes m
                                       where m.company_id = _company and m.is_active and lower(m.address) = _box) then
    raise exception 'MEP_UNKNOWN_MAILBOX' using errcode = '22023';
  end if;
  _rcpt := nullif(lower(btrim(coalesce(_mail_test_recipient, ''))), '');
  if _rcpt is not null and _rcpt !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' then
    raise exception 'MEP_BAD_TEST_RECIPIENT' using errcode = '22023';
  end if;
  select to_jsonb(s) into _old from public.automation_settings s where s.company_id = _company;
  insert into public.automation_settings (company_id, sender_mailbox, mail_test_recipient, updated_at, updated_by)
  values (_company, _box, _rcpt, now(), auth.uid())
  on conflict (company_id) do update
    set sender_mailbox = excluded.sender_mailbox, mail_test_recipient = excluded.mail_test_recipient,
        updated_at = now(), updated_by = auth.uid();
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'automation_settings_set', 'automation_settings', _company::text, 'screen',
          _old, jsonb_build_object('sender_mailbox', _box, 'mail_test_recipient', _rcpt,
                                   'effective_sender', public.notification_sender(_company)));
  return jsonb_build_object('sender_mailbox', _box, 'mail_test_recipient', _rcpt,
                            'effective_sender', public.notification_sender(_company));
end $$;
revoke all on function public.automation_settings_set(uuid, text, text) from public, anon;
grant execute on function public.automation_settings_set(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Interrupteurs des automatismes qui n'en avaient pas
-- ---------------------------------------------------------------------
create table if not exists public.automation_switches (
  company_id uuid not null references public.companies(id) on delete cascade,
  key        text not null check (key in ('appointment_reminder_mail', 'invoice_reminder_auto', 'order_confirm_mail',
                                          'portal_invite', 'outlook_poll', 'prospect_classify', 'exchange_summary')),
  mode       text not null check (mode in ('arrete', 'test', 'actif')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (company_id, key)
);
comment on table public.automation_switches is
  'Mise en production (19/11/2026) : interrupteur par societe des automatismes qui n en avaient pas. '
  'Pas de ligne = defaut de automation_default_mode (arrete, sauf ce qui tournait deja en production).';

drop trigger if exists trg_automation_switches_audit on public.automation_switches;
create trigger trg_automation_switches_audit after insert or update or delete on public.automation_switches
  for each row execute function public.audit_row();

alter table public.automation_switches enable row level security;
revoke all on public.automation_switches from anon;
revoke insert, update, delete on public.automation_switches from authenticated;
grant select on public.automation_switches to authenticated;
drop policy if exists automation_switches_select on public.automation_switches;
create policy automation_switches_select on public.automation_switches for select to authenticated
  using (public.is_member(company_id));

-- Defaut sans ligne. Verifie en production le 19/11 : la releve Outlook (toutes les 5 min), la
-- classification IA des mails d'inconnus (9 prospects « mail » en 30 jours), le resume IA des echanges
-- (9 en 7 jours) et l'invitation en pied de mail (decisions P-5 / P-6) tournent VOLONTAIREMENT depuis
-- septembre : Actif. Tout le reste : Arrete.
create or replace function public.automation_default_mode(_key text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when _key in ('outlook_poll', 'prospect_classify', 'exchange_summary', 'portal_invite') then 'actif' else 'arrete' end;
$$;

create or replace function public.automation_mode(_company uuid, _key text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.mode from public.automation_switches s where s.company_id = _company and s.key = _key),
                  public.automation_default_mode(_key));
$$;
revoke all on function public.automation_mode(uuid, text) from public, anon;
grant execute on function public.automation_mode(uuid, text) to authenticated, service_role;

-- Pour les fonctions Edge (cle de service) : les societes ou l'automatisme est ARRETE.
create or replace function public.automation_companies_off(_key text)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select co.id from public.companies co where public.automation_mode(co.id, _key) = 'arrete'
  union
  select co.id from public.companies co where public._sms_is_test_company(co.id);
$$;
revoke all on function public.automation_companies_off(text) from public, anon, authenticated;
grant execute on function public.automation_companies_off(text) to service_role;

-- ---------------------------------------------------------------------
-- 5. Relances d'impayes : « actif » devient possible (uniquement par production_apply)
-- ---------------------------------------------------------------------
alter table public.receivable_settings drop constraint if exists receivable_settings_dunning_mode_check;
alter table public.receivable_settings add constraint receivable_settings_dunning_mode_check
  check (dunning_mode in ('arrete', 'test', 'actif'));
comment on column public.receivable_settings.dunning_mode is
  'arrete : rien ne part ; test : tout part a l adresse de test ; actif : envoi aux clients, ouvert UNIQUEMENT '
  'par la fenetre « Mise en production » (production_apply). receivable_settings_set refuse actif.';

-- ---------------------------------------------------------------------
-- 6. Presence des secrets du serveur (jamais leur valeur)
-- ---------------------------------------------------------------------
create table if not exists public.integration_status (
  company_id  uuid not null references public.companies(id) on delete cascade,
  integration text not null check (integration in ('graph', 'brevo', 'shopify', 'anthropic', 'stripe', 'cron', 'resend')),
  present     boolean not null,
  checked_at  timestamptz not null default now(),
  primary key (company_id, integration)
);
comment on table public.integration_status is
  'Mise en production : le secret du serveur est-il pose ? (oui / non, releve par la fonction Edge production-status). '
  'La valeur d un secret n est JAMAIS lue ni stockee.';
alter table public.integration_status enable row level security;
revoke all on public.integration_status from anon;
revoke insert, update, delete on public.integration_status from authenticated;
grant select on public.integration_status to authenticated;
drop policy if exists integration_status_select on public.integration_status;
create policy integration_status_select on public.integration_status for select to authenticated
  using (public.is_admin(company_id));

create or replace function public.integration_status_record(_company uuid, _status jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(_status) <> 'object' then raise exception 'MEP_BAD_STATUS' using errcode = '22023'; end if;
  for k, v in select key, value from jsonb_each(_status) loop
    continue when k not in ('graph', 'brevo', 'shopify', 'anthropic', 'stripe', 'cron', 'resend') or jsonb_typeof(v) <> 'boolean';
    insert into public.integration_status (company_id, integration, present, checked_at)
    values (_company, k, (v)::text::boolean, now())
    on conflict (company_id, integration) do update set present = excluded.present, checked_at = now();
  end loop;
end $$;
revoke all on function public.integration_status_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.integration_status_record(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 7. File de notifications, partie MAIL (envoi par Microsoft Graph)
-- ---------------------------------------------------------------------
create index if not exists idx_notif_mail_pending on public.notifications(scheduled_at)
  where channel <> 'sms' and status = 'pending';
comment on column public.notifications.provider is 'brevo (SMS) | graph (mail Outlook, depuis le 19/11/2026 ; Resend retire).';

-- Quel interrupteur pour quel modele de mail de la file. Null = aucun : la ligne n'est pas envoyee.
create or replace function public._mail_switch_key(_template text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case _template
    when 'invoice_reminder'     then 'invoice_reminder_auto'
    when 'appointment_reminder' then 'appointment_reminder_mail'
    when 'order_confirm'        then 'order_confirm_mail'
  end;
$$;

create or replace function public.mail_dispatch_claim(_limit int default 50)
returns table(id bigint, company_id uuid, send_to text, subject text, body text, sender_mailbox text,
              is_test boolean, template text, real_to text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  n public.notifications%rowtype; _key text; _mode text; _box text; _rcpt text; _to text; _reason text;
  _st text; _due numeric;
begin
  -- Prise en charge restee sans reponse (fonction coupee) : echec, jamais de second envoi.
  update public.notifications x set status = 'failed', error = 'stuck_sending'
   where x.channel <> 'sms' and x.status = 'sending' and x.claimed_at < now() - interval '15 minutes';

  for n in
    select * from public.notifications x
     where x.channel <> 'sms' and x.status = 'pending' and x.scheduled_at <= now()
     order by x.scheduled_at limit least(greatest(coalesce(_limit, 50), 1), 200)
     for update skip locked
  loop
    _reason := null; _box := null; _rcpt := null;
    _key := public._mail_switch_key(n.template);
    _mode := case when _key is null then null else public.automation_mode(n.company_id, _key) end;
    _to := lower(btrim(coalesce(n.to_address, '')));
    if public._sms_is_test_company(n.company_id) then _reason := 'test_company';
    elsif _key is null then _reason := 'no_switch';
    elsif _mode = 'arrete' then _reason := 'mail_off';
    else
      _box := public.notification_sender(n.company_id);
      if _mode = 'test' then _rcpt := public.mail_test_recipient(n.company_id, n.template); end if;
      if _box is null then _reason := 'no_sender_mailbox';
      elsif _mode = 'test' and (_rcpt is null or _rcpt !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$') then _reason := 'no_test_recipient';
      elsif _mode = 'actif' and _to !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' then _reason := 'invalid_address';
      elsif n.template = 'appointment_reminder' then
        select a.status into _st from public.workshop_appointments a where a.id::text = n.entity_id;
        if _st is null or _st <> 'prevu' then _reason := 'rdv_changed';
        elsif (select a.starts_at from public.workshop_appointments a where a.id::text = n.entity_id) <= now() then _reason := 'rdv_past';
        end if;
      elsif n.template = 'invoice_reminder' then
        select d.total_ttc - d.paid_amount into _due from public.documents d where d.id::text = n.entity_id;
        if _due is null or _due <= 0.005 then _reason := 'invoice_paid'; end if;
      end if;
    end if;

    if _reason is not null then
      update public.notifications x set status = 'skipped', error = _reason where x.id = n.id;
    else
      update public.notifications x
         set status = 'sending', claimed_at = now(), is_test = (_mode = 'test'),
             sent_to = case when _mode = 'test' then _rcpt else _to end, provider = 'graph'
       where x.id = n.id;
      id := n.id; company_id := n.company_id; body := n.body; template := n.template; sender_mailbox := _box;
      is_test := (_mode = 'test'); real_to := _to;
      send_to := case when _mode = 'test' then _rcpt else _to end;
      subject := case when _mode = 'test'
                      then '[TEST pour ' || coalesce(nullif(_to, ''), 'client') || '] ' || coalesce(nullif(n.subject, ''), '(sans objet)')
                      else coalesce(nullif(n.subject, ''), '(sans objet)') end;
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.mail_dispatch_claim(int) from public, anon, authenticated;
grant execute on function public.mail_dispatch_claim(int) to service_role;

create or replace function public.mail_dispatch_result(_id bigint, _status text, _error text default null, _provider_id text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.notifications%rowtype;
begin
  if _status not in ('sent', 'failed', 'skipped') then raise exception 'MAIL_BAD_STATUS' using errcode = '22023'; end if;
  select * into n from public.notifications where id = _id and channel <> 'sms' for update;
  if not found then raise exception 'MAIL_NOT_FOUND' using errcode = 'P0002'; end if;
  if n.status <> 'sending' then return; end if;
  update public.notifications
     set status = _status, error = case when _status = 'sent' then null else left(coalesce(_error, _status), 300) end,
         sent_at = case when _status = 'sent' then now() else null end,
         provider = 'graph', provider_message_id = left(_provider_id, 100)
   where id = _id;
end $$;
revoke all on function public.mail_dispatch_result(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.mail_dispatch_result(bigint, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 8. Mise en production : la liste complete, et le demarrage / la pause
-- ---------------------------------------------------------------------
-- Secret pose ? true / false ; null = jamais verifie (fonction production-status pas encore appelee).
create or replace function public._mep_secret(_company uuid, _integration text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _p boolean;
begin
  if _integration = 'cron' then
    -- Secret du coffre (Vault) des taches pg_cron : on ne lit que son NOM.
    begin
      execute 'select exists (select 1 from vault.secrets where name = ''cron_secret'')' into _p;
    exception when others then _p := null;
    end;
    if _p then
      -- Et le secret CRON_SECRET des fonctions Edge (releve par production-status), s'il est connu.
      return coalesce((select s.present from public.integration_status s
                        where s.company_id = _company and s.integration = 'cron'), true);
    end if;
    return _p;
  end if;
  select s.present into _p from public.integration_status s where s.company_id = _company and s.integration = _integration;
  return _p;
end $$;
revoke all on function public._mep_secret(uuid, text) from public, anon, authenticated;

create or replace function public._mep_need(_company uuid, _integration text)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select case public._mep_secret(_company, _integration)
           when true then '{}'::text[]
           when false then array[_integration || '_secret']
           else array[_integration || '_unchecked'] end;
$$;
revoke all on function public._mep_need(uuid, text) from public, anon, authenticated;

-- Une ligne de la fenetre.
create or replace function public._mep_item(_key text, _group text, _mode text, _missing text[], _test_ok boolean,
                                            _detail jsonb default '{}'::jsonb, _missing_test text[] default '{}'::text[])
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'key', _key, 'group', _group, 'mode', _mode,
    'missing', to_jsonb(coalesce(_missing, '{}'::text[])),
    'missing_test', to_jsonb(coalesce(_missing_test, '{}'::text[])),
    'test_ok', _test_ok, 'detail', coalesce(_detail, '{}'::jsonb));
$$;

-- Tout ce qui sort, dans l'ordre d'affichage. Reserve aux administrateurs.
create or replace function public.production_overview(_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  _items jsonb := '[]'::jsonb;
  _crons jsonb := '[]'::jsonb;
  _graph text[]; _brevo text[]; _shop text[]; _ai text[]; _cron text[];
  _box text; _rcpt text; _m text; _flag boolean; _sms jsonb; _sms_mode text; _p jsonb; _freq text; _en boolean;
  _send_email boolean; _poll text; _mb int; _is_test boolean; _r record; _miss text[];
begin
  if not public.is_admin(_company) then raise exception 'MEP_FORBIDDEN' using errcode = '42501'; end if;
  _is_test := public._sms_is_test_company(_company);
  _graph := public._mep_need(_company, 'graph');
  _brevo := public._mep_need(_company, 'brevo');
  _shop  := public._mep_need(_company, 'shopify');
  _ai    := public._mep_need(_company, 'anthropic');
  _cron  := public._mep_need(_company, 'cron');
  _box   := public.notification_sender(_company);
  _rcpt  := public.mail_test_recipient(_company, null);
  select count(*) into _mb from public.company_mailboxes m where m.company_id = _company and m.is_active;

  -- Shopify : stock, prix et publication (shopify_sync_settings.mode arrete / essai / tous).
  _m := public._shopify_sync_mode(_company);
  _items := _items || public._mep_item('shopify_stock', 'shopify',
    case _m when 'tous' then 'actif' when 'essai' then 'test' else 'arrete' end, _shop || _cron, false,
    jsonb_build_object('raw_mode', _m));
  -- Shopify : import des commandes du site.
  select coalesce(s.import_enabled, false) into _flag from (select 1) x
    left join public.shopify_order_settings s on s.company_id = _company;
  _items := _items || public._mep_item('shopify_orders', 'shopify', case when _flag then 'actif' else 'arrete' end, _shop || _cron, false);

  -- Relances d'entretien (followups-send).
  select coalesce(s.mode, 'arrete'), s.test_recipient into _m, _rcpt from (select 1) x
    left join public.followup_settings s on s.company_id = _company;
  _items := _items || public._mep_item('followups', 'mail', _m,
    _graph || _cron || case when _box is null then array['sender_mailbox'] else '{}'::text[] end, true,
    jsonb_build_object('test_recipient', _rcpt),
    case when _rcpt is null then array['test_recipient'] else '{}'::text[] end);
  -- Relances d'impayes (lettres G8, envoyees depuis l'ecran).
  select coalesce(s.dunning_mode, 'test') into _m from (select 1) x left join public.receivable_settings s on s.company_id = _company;
  _rcpt := public.mail_test_recipient(_company, 'invoice_reminder');
  select coalesce(nullif(btrim(s.dunning_test_recipient), ''), _rcpt) into _rcpt from (select 1) x
    left join public.receivable_settings s on s.company_id = _company;
  _items := _items || public._mep_item('dunning', 'mail', _m,
    _graph || case when _mb = 0 then array['sender_mailbox'] else '{}'::text[] end, true,
    jsonb_build_object('test_recipient', _rcpt),
    case when _rcpt is null then array['test_recipient'] else '{}'::text[] end);
  -- Mails de la file : relance automatique des factures, rappel de RDV, confirmation e-shop.
  for _r in select * from (values ('invoice_reminder_auto', 'invoice_reminder'), ('appointment_reminder_mail', 'appointment_reminder'),
                                  ('order_confirm_mail', 'order_confirm')) v(k, tpl) loop
    _rcpt := public.mail_test_recipient(_company, _r.tpl);
    _items := _items || public._mep_item(_r.k, 'mail', public.automation_mode(_company, _r.k),
      _graph || _cron || case when _box is null then array['sender_mailbox'] else '{}'::text[] end, true,
      jsonb_build_object('sender', _box, 'test_recipient', _rcpt),
      case when _rcpt is null then array['test_recipient'] else '{}'::text[] end);
  end loop;
  -- Invitation a l'espace client en pied des mails envoyes depuis le DMS.
  _items := _items || public._mep_item('portal_invite', 'mail', public.automation_mode(_company, 'portal_invite'), _graph, false);

  -- SMS (Brevo) et ses deux automatismes.
  _sms := public.sms_settings_get(_company);
  _sms_mode := coalesce(_sms ->> 'mode', 'arrete');
  _items := _items || public._mep_item('sms', 'sms', _sms_mode, _brevo || _cron, true,
    jsonb_build_object('test_recipient', _sms ->> 'test_recipient'),
    case when coalesce(_sms ->> 'test_recipient', '') = '' then array['test_recipient_sms'] else '{}'::text[] end);
  _items := _items || public._mep_item('sms_ready', 'sms',
    case when coalesce((_sms ->> 'ready_auto')::boolean, true) then _sms_mode else 'arrete' end,
    _brevo || case when _sms_mode <> 'actif' then array['depends_sms'] else '{}'::text[] end, false,
    jsonb_build_object('flag', coalesce((_sms ->> 'ready_auto')::boolean, true)));
  _items := _items || public._mep_item('sms_reminder', 'sms',
    case when coalesce((_sms ->> 'reminder_auto')::boolean, true) then _sms_mode else 'arrete' end,
    _brevo || _cron || case when _sms_mode <> 'actif' then array['depends_sms'] else '{}'::text[] end, false,
    jsonb_build_object('flag', coalesce((_sms ->> 'reminder_auto')::boolean, true)));

  -- Transfert comptable automatique (EBP) : params.enabled + params.auto.frequency.
  select coalesce(s.params, '{}'::jsonb) into _p from (select 1) x left join public.accounting_transfer_settings s on s.company_id = _company;
  _en := coalesce((_p ->> 'enabled')::boolean, true);
  _freq := coalesce(_p #>> '{auto,frequency}', 'off');
  if _freq not in ('daily', 'weekly', 'fortnightly', 'monthly') then _freq := 'off'; end if;
  _send_email := coalesce((_p #>> '{auto,sendEmail}')::boolean, false);
  _miss := _cron || case when _freq = 'off' then array['accounting_frequency'] else '{}'::text[] end
                 || case when _send_email then _graph else '{}'::text[] end;
  _items := _items || public._mep_item('accounting_auto_transfer', 'accounting',
    case when _en and _freq <> 'off' then 'actif' else 'arrete' end, _miss, false,
    jsonb_build_object('frequency', _freq, 'send_email', _send_email));

  -- Releve Outlook, puis les deux appels a Claude qu'elle declenche.
  _poll := public.automation_mode(_company, 'outlook_poll');
  _items := _items || public._mep_item('outlook_poll', 'outlook', _poll,
    _graph || _cron || case when _mb = 0 then array['mailbox_none'] else '{}'::text[] end, false,
    jsonb_build_object('mailboxes', _mb));
  _items := _items || public._mep_item('prospect_classify', 'outlook', public.automation_mode(_company, 'prospect_classify'),
    _ai || case when _poll <> 'actif' then array['depends_outlook_poll'] else '{}'::text[] end, false);
  _items := _items || public._mep_item('exchange_summary', 'outlook', public.automation_mode(_company, 'exchange_summary'),
    _ai || case when _poll <> 'actif' then array['depends_outlook_poll'] else '{}'::text[] end, false);

  -- Application client publique (lien du site, page « bientot disponible » sinon).
  select s.client_app_open into _flag from public.signup_settings s where s.company_id = _company;
  _items := _items || public._mep_item('client_app', 'portal',
    case when _flag then 'actif' else 'arrete' end,
    case when _flag is null then array['no_signup_settings'] else '{}'::text[] end, false);

  -- Stripe : debranche par decision du client, affiche « non utilise ».
  select coalesce(s.enabled, false) into _flag from (select 1) x left join public.stripe_settings s on s.company_id = _company;
  _items := _items || public._mep_item('stripe', 'payment', case when _flag then 'actif' else 'non_utilise' end,
    array['not_used'], false);

  -- Taches pg_cron (lecture) : etat et derniere execution.
  begin
    for _r in
      select j.jobname, j.schedule, j.active, d.status, d.start_time, left(d.return_message, 300) as message
        from cron.job j
        left join lateral (select x.status, x.start_time, x.return_message from cron.job_run_details x
                            where x.jobid = j.jobid order by x.start_time desc limit 1) d on true
       order by j.jobname
    loop
      _crons := _crons || jsonb_build_object('jobname', _r.jobname, 'schedule', _r.schedule, 'active', _r.active,
        'last_status', _r.status, 'last_run', _r.start_time, 'last_message', case when _r.status = 'failed' then _r.message end);
    end loop;
  exception when others then
    _crons := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'company_id', _company, 'is_test_company', _is_test,
    'sender_mailbox', _box,
    'settings', (select to_jsonb(s) - 'company_id' from public.automation_settings s where s.company_id = _company),
    'mailboxes', coalesce((select jsonb_agg(lower(m.address) order by m.address) from public.company_mailboxes m
                            where m.company_id = _company and m.is_active), '[]'::jsonb),
    'mail_test_recipient', public.mail_test_recipient(_company, null),
    'integrations', coalesce((select jsonb_object_agg(s.integration, jsonb_build_object('present', s.present, 'checked_at', s.checked_at))
                               from public.integration_status s where s.company_id = _company), '{}'::jsonb),
    'items', _items, 'crons', _crons);
end $$;
revoke all on function public.production_overview(uuid) from public, anon;
grant execute on function public.production_overview(uuid) to authenticated;

-- Demarrer (start -> Actif), passer en test, ou mettre en pause (pause -> Arrete) une selection.
-- Tout ou rien : un element refuse annule l'appel entier (rien n'est change). Une ligne `events`
-- « production_switch » par element change (qui, quand, quoi, ancien / nouveau) ; les fonctions de
-- chaque module tracent en plus leur propre evenement, comme depuis leur ecran.
create or replace function public.production_apply(_company uuid, _keys text[], _action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _ov jsonb; _it jsonb; _k text; _old text; _new text; _done jsonb := '[]'::jsonb; _sms jsonb;
  _order text[] := array['shopify_stock', 'shopify_orders', 'followups', 'dunning', 'invoice_reminder_auto',
                         'appointment_reminder_mail', 'order_confirm_mail', 'portal_invite', 'sms', 'sms_ready',
                         'sms_reminder', 'accounting_auto_transfer', 'outlook_poll', 'prospect_classify',
                         'exchange_summary', 'client_app', 'stripe'];
  _miss text[]; _target text; _rcpt text;
begin
  if not public.is_admin(_company) then raise exception 'MEP_FORBIDDEN' using errcode = '42501'; end if;
  if _action not in ('start', 'test', 'pause') then raise exception 'MEP_BAD_ACTION' using errcode = '22023'; end if;
  if coalesce(array_length(_keys, 1), 0) = 0 then raise exception 'MEP_EMPTY' using errcode = '22023'; end if;
  select min(u.k) into _k from unnest(_keys) as u(k) where not (u.k = any(_order));
  if _k is not null then raise exception 'MEP_UNKNOWN_KEY:%', _k using errcode = '22023'; end if;
  if _action in ('start', 'test') and public._sms_is_test_company(_company) then
    raise exception 'MEP_TEST_COMPANY' using errcode = '22023';
  end if;

  _ov := public.production_overview(_company);
  _target := case _action when 'start' then 'actif' when 'test' then 'test' else 'arrete' end;

  -- 1. Controle de TOUTE la selection avant de changer quoi que ce soit.
  foreach _k in array _order loop
    continue when not (_k = any(_keys));
    select x.v into _it from jsonb_array_elements(_ov -> 'items') as x(v) where x.v ->> 'key' = _k;
    if _action in ('start', 'test') then
      if _k = 'stripe' then raise exception 'MEP_NOT_USED:%', _k using errcode = '22023'; end if;
      if _action = 'test' and not coalesce((_it ->> 'test_ok')::boolean, false) then
        raise exception 'MEP_NO_TEST_MODE:%', _k using errcode = '22023';
      end if;
      select coalesce(array_agg(m.v), '{}') into _miss from jsonb_array_elements_text(_it -> 'missing') as m(v)
       where not (m.v = 'depends_sms' and 'sms' = any(_keys) and _action = 'start')
         and not (m.v = 'depends_outlook_poll' and 'outlook_poll' = any(_keys) and _action = 'start');
      if _action = 'test' then
        select _miss || coalesce(array_agg(m.v), '{}') into _miss from jsonb_array_elements_text(_it -> 'missing_test') as m(v);
      end if;
      if coalesce(array_length(_miss, 1), 0) > 0 then
        raise exception 'MEP_NOT_CONFIGURED:%:%', _k, array_to_string(_miss, ',') using errcode = '22023';
      end if;
    end if;
  end loop;

  -- 2. Application, par l'interrupteur existant de chaque module.
  foreach _k in array _order loop
    continue when not (_k = any(_keys));
    select x.v ->> 'mode' into _old from jsonb_array_elements(public.production_overview(_company) -> 'items') as x(v) where x.v ->> 'key' = _k;
    _new := _target;
    if _k = 'shopify_stock' then
      perform public.shopify_sync_set_mode(_company, case _target when 'actif' then 'tous' else 'arrete' end);
    elsif _k = 'shopify_orders' then
      perform public.shopify_orders_set_import(_company, _target = 'actif');
    elsif _k = 'followups' then
      select s.test_recipient into _rcpt from public.followup_settings s where s.company_id = _company;
      perform public.followup_settings_set(_company, _target, _rcpt, null);
    elsif _k = 'dunning' then
      insert into public.receivable_settings (company_id, dunning_mode, updated_by)
      values (_company, _target, auth.uid())
      on conflict (company_id) do update set dunning_mode = excluded.dunning_mode, updated_by = auth.uid();
    elsif _k in ('invoice_reminder_auto', 'appointment_reminder_mail', 'order_confirm_mail', 'portal_invite',
                 'outlook_poll', 'prospect_classify', 'exchange_summary') then
      insert into public.automation_switches (company_id, key, mode, updated_at, updated_by)
      values (_company, _k, _target, now(), auth.uid())
      on conflict (company_id, key) do update set mode = excluded.mode, updated_at = now(), updated_by = auth.uid();
    elsif _k = 'sms' then
      perform public.sms_settings_set(_company, public.sms_settings_get(_company) || jsonb_build_object('mode', _target));
    elsif _k = 'sms_ready' then
      perform public.sms_settings_set(_company, public.sms_settings_get(_company) || jsonb_build_object('ready_auto', _target <> 'arrete'));
    elsif _k = 'sms_reminder' then
      perform public.sms_settings_set(_company, public.sms_settings_get(_company) || jsonb_build_object('reminder_auto', _target <> 'arrete'));
    elsif _k = 'accounting_auto_transfer' then
      insert into public.accounting_transfer_settings (company_id, params, updated_by)
      values (_company, jsonb_build_object('enabled', _target <> 'arrete'), auth.uid())
      on conflict (company_id) do update
        set params = coalesce(accounting_transfer_settings.params, '{}'::jsonb) || jsonb_build_object('enabled', _target <> 'arrete'),
            updated_at = now(), updated_by = auth.uid();
    elsif _k = 'client_app' then
      update public.signup_settings set client_app_open = (_target <> 'arrete'), updated_at = now(), updated_by = auth.uid()
       where company_id = _company;
    elsif _k = 'stripe' then
      update public.stripe_settings set enabled = false, updated_at = now(), updated_by = auth.uid() where company_id = _company;
    end if;
    select x.v ->> 'mode' into _new from jsonb_array_elements(public.production_overview(_company) -> 'items') as x(v) where x.v ->> 'key' = _k;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'production_switch', 'production', _k, 'screen',
            jsonb_build_object('mode', _old), jsonb_build_object('mode', _new, 'action', _action));
    _done := _done || jsonb_build_object('key', _k, 'old', _old, 'new', _new);
  end loop;
  return _done;
end $$;
revoke all on function public.production_apply(uuid, text[], text) from public, anon;
grant execute on function public.production_apply(uuid, text[], text) to authenticated;

revoke all on function public._mep_item(text, text, text, text[], boolean, jsonb, text[]) from public, anon, authenticated;
revoke all on function public._mail_switch_key(text) from public, anon, authenticated;
grant execute on function public.automation_default_mode(text) to authenticated, service_role;

comment on function public.production_overview(uuid) is
  'Mise en production (19/11/2026) : tout ce qui sort (connexions, automatismes, taches pg_cron), etat, ce qui manque. Administrateurs.';
comment on function public.production_apply(uuid, text[], text) is
  'Mise en production : start (Actif) | test | pause (Arrete) d une selection, par les interrupteurs de chaque module. Tout ou rien, trace events production_switch.';
