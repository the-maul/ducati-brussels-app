-- =====================================================================
-- M10 — INTERRUPTEUR DES RELANCES : RIEN NE PART CHEZ LES CLIENTS TANT QU'IL EST SUR ARRETE (CRM011)
-- Constat du 03/11/2026 en production : le client est encore en developpement. Les taches pg_cron
-- `followups-plan` (6 h) et `followups-send` (6 h 15) sont ACTIVES, le secret cron est en place, la
-- fonction Edge `followups-send` est deployee et les cles Microsoft Graph posees. 0 relance pour
-- l'instant uniquement parce que les echeances d'entretien (`vehicle_maintenance_due`) n'ont pas
-- encore ete calculees. Des que l'extract DCS sera importe (229 motos, 142 proprietaires avec e-mail,
-- echeances deja depassees), la planification creerait des relances dues immediatement et le cron
-- enverrait de VRAIS mails aux clients.
--
-- REGLE : rien ne part avant la mise en production, apres test a 100 %.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. `followup_settings` : un reglage par societe, `mode` in (arrete, test, actif), FERME PAR
--      DEFAUT (pas de ligne = arrete), `test_recipient` = l'adresse qui recoit TOUS les mails en mode
--      test. Meme esprit que « Import des commandes du site » (mission 03, Arrete / Actif) et que
--      `shopify_sync_settings.mode` (arrete / essai / tous).
--   2. `followups.is_test` + `followups.sent_to` : ce qui est parti, et ou (adresse de test ou client).
--   3. `followup_settings_get(_company)` (membre) : le mode effectif ; `followup_settings_set`
--      (admin) : changer le mode / l'adresse, trace `events` (`followup_settings_mode`).
--   4. `followup_mark_sent` : nouveaux parametres `_sent_to`, `_is_test` ; en test, l'echange n'est
--      PAS ajoute a l'historique du client (il n'a rien recu).
--   5. `followups_list` : colonnes `is_test`, `sent_to` pour le badge « test » de l'ecran.
--   6. `followups_plan` CONTINUE de planifier (on veut voir la liste). Seul L'ENVOI respecte le mode,
--      dans la fonction Edge `followups-send` (cron et bouton « Envoyer maintenant ») :
--        arrete → rien ne part, le cron journalise « arrete » et sort ;
--        test   → tout mail part a `test_recipient`, objet prefixe « [TEST relance pour <client>] »,
--                 relance marquee envoyee avec is_test, sent_to = adresse de test ;
--        actif  → envoi reel.
--      J+5 et cloture par rendez-vous ne changent pas.
--   7. Rappels de RDV (`appointment-reminders` → file `notifications` → `dispatch-notifications`) :
--      aucun envoi reel possible aujourd'hui (pas de cle Resend ni SMS : tout finit `skipped`,
--      verifie le 03/11 : 20 notifications, toutes `skipped`). Rien a changer.
--
-- NON APPLIQUEE. Essai a blanc (begin; / rollback;) :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f <fichier.sql>
-- Application (par le client) :
--   npx supabase@2.117.0 db push --linked --project-ref ujmrosbgkvgvwfnuryna
-- Deploiement de la fonction Edge (apres la migration) :
--   npx supabase@2.117.0 functions deploy followups-send --project-ref ujmrosbgkvgvwfnuryna
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Le reglage par societe
-- ---------------------------------------------------------------------
create table if not exists public.followup_settings (
  company_id     uuid primary key references public.companies(id) on delete cascade,
  mode           text not null default 'arrete' check (mode in ('arrete', 'test', 'actif')),
  test_recipient text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null
);
comment on table public.followup_settings is
  'CRM011 : interrupteur des relances par societe. Pas de ligne = arrete. '
  'arrete : rien ne part ; test : tout mail part a test_recipient (objet prefixe [TEST relance pour ...]) ; actif : envoi reel.';
comment on column public.followup_settings.test_recipient is
  'Adresse qui recoit TOUS les mails de relance en mode test (obligatoire dans ce mode).';

drop trigger if exists trg_followup_settings_updated on public.followup_settings;
create trigger trg_followup_settings_updated before update on public.followup_settings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_followup_settings_audit on public.followup_settings;
create trigger trg_followup_settings_audit after insert or update or delete on public.followup_settings
  for each row execute function public.audit_row();

-- RLS : lecture par tout membre, ecriture reservee aux administrateurs. Les ecritures passent par
-- `followup_settings_set` (trace events) : aucune ecriture directe depuis l'application.
alter table public.followup_settings enable row level security;
revoke all on public.followup_settings from anon;
revoke insert, update, delete on public.followup_settings from authenticated;
grant select on public.followup_settings to authenticated;
drop policy if exists followup_settings_select on public.followup_settings;
create policy followup_settings_select on public.followup_settings for select to authenticated
  using (public.is_member(company_id));
drop policy if exists followup_settings_write on public.followup_settings;
create policy followup_settings_write on public.followup_settings for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- ---------------------------------------------------------------------
-- 2. Ce qui est parti, et ou
-- ---------------------------------------------------------------------
alter table public.followups add column if not exists is_test boolean not null default false;
alter table public.followups add column if not exists sent_to text;
comment on column public.followups.is_test is 'Vrai si le mail est parti a l adresse de test (mode test), pas chez le client.';
comment on column public.followups.sent_to is 'Adresse qui a recu le mail (client en mode actif, adresse de test en mode test).';

-- ---------------------------------------------------------------------
-- 3. Lire et changer le reglage
-- ---------------------------------------------------------------------
create or replace function public.followup_settings_get(_company uuid)
returns table(mode text, test_recipient text, updated_at timestamptz, updated_by uuid)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(s.mode, 'arrete') as mode, s.test_recipient, s.updated_at, s.updated_by
    from (select 1) x
    left join public.followup_settings s on s.company_id = _company
   where auth.uid() is null or public.is_member(_company);
$fn$;
comment on function public.followup_settings_get(uuid) is
  'CRM011 : mode effectif des relances de la societe (arrete sans ligne). Membre, ou cle de service.';
revoke all on function public.followup_settings_get(uuid) from public, anon;
grant execute on function public.followup_settings_get(uuid) to authenticated, service_role;

create or replace function public.followup_settings_set(_company uuid, _mode text, _test_recipient text default null)
returns public.followup_settings
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  old_s public.followup_settings%rowtype;
  new_s public.followup_settings%rowtype;
  _rec  text;
begin
  if not public.is_admin(_company) then
    raise exception 'followup_settings_set: reserve aux administrateurs' using errcode = '42501';
  end if;
  if _mode not in ('arrete', 'test', 'actif') then
    raise exception 'followup_settings_set: mode inconnu %', _mode using errcode = '22023';
  end if;
  _rec := nullif(lower(btrim(coalesce(_test_recipient, ''))), '');
  if _rec is not null and _rec !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' then
    raise exception 'followup_settings_set: adresse de test invalide' using errcode = '22023';
  end if;
  if _mode = 'test' and _rec is null then
    raise exception 'followup_settings_set: le mode test exige une adresse de test' using errcode = '22023';
  end if;
  select * into old_s from public.followup_settings where company_id = _company;
  insert into public.followup_settings (company_id, mode, test_recipient, updated_at, updated_by)
  values (_company, _mode, _rec, now(), auth.uid())
  on conflict (company_id) do update
    set mode = excluded.mode, test_recipient = excluded.test_recipient, updated_at = now(), updated_by = auth.uid()
  returning * into new_s;
  if coalesce(old_s.mode, 'arrete') is distinct from _mode or old_s.test_recipient is distinct from _rec then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'followup_settings_mode', 'followup_settings', _company::text, 'screen',
            jsonb_build_object('mode', coalesce(old_s.mode, 'arrete'), 'test_recipient', old_s.test_recipient),
            jsonb_build_object('mode', _mode, 'test_recipient', _rec));
  end if;
  return new_s;
end $fn$;
comment on function public.followup_settings_set(uuid, text, text) is
  'CRM011 : changer l interrupteur des relances (administrateurs). Le mode test exige une adresse de test. Trace events.';
revoke all on function public.followup_settings_set(uuid, text, text) from public, anon;
grant execute on function public.followup_settings_set(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Marquer envoyee : ou c'est parti, et en test ou non
--    (l'ancienne signature a 5 parametres est remplacee : avec des valeurs par defaut, les deux
--    cohabiteraient de facon ambigue pour PostgREST)
-- ---------------------------------------------------------------------
drop function if exists public.followup_mark_sent(uuid, text, text, text, text);
create or replace function public.followup_mark_sent(
  _id uuid, _subject text, _body text, _mailbox text default null, _template_key text default null,
  _sent_to text default null, _is_test boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare f public.followups%rowtype;
begin
  select * into f from public.followups where id = _id for update;
  if not found then raise exception 'followup_mark_sent: relance introuvable' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.is_member(f.company_id) then
    raise exception 'followup_mark_sent: acces refuse' using errcode = '42501';
  end if;
  if f.status <> 'planifiee' then
    raise exception 'followup_mark_sent: statut % (attendu planifiee)', f.status using errcode = '22023';
  end if;
  update public.followups
     set status = 'envoyee', sent_at = now(), mail_subject = _subject, mail_body = _body,
         template_key = coalesce(_template_key, template_key), last_error = null,
         is_test = coalesce(_is_test, false), sent_to = coalesce(_sent_to, to_email)
   where id = _id;
  -- L'echange apparait dans l'historique du client — sauf en mode test : le client n'a rien recu.
  if f.contact_id is not null and not coalesce(_is_test, false) then
    insert into public.communications (company_id, contact_id, channel, direction, subject, body, occurred_at)
    values (f.company_id, f.contact_id, 'email', 'out', _subject, left(coalesce(_body, ''), 12000), now());
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (f.company_id, auth.uid(), 'followup_sent', 'followups', _id::text,
          case when auth.uid() is null then 'system' else 'screen' end,
          jsonb_build_object('to', f.to_email, 'sent_to', coalesce(_sent_to, f.to_email), 'is_test', coalesce(_is_test, false),
                             'from', _mailbox, 'subject', _subject, 'kind', f.kind, 'locale', f.locale));
end $fn$;
revoke all on function public.followup_mark_sent(uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.followup_mark_sent(uuid, text, text, text, text, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. La liste de l'ecran : + is_test, sent_to (le type de retour change : drop puis create)
-- ---------------------------------------------------------------------
drop function if exists public.followups_list(uuid);
create or replace function public.followups_list(_company uuid)
returns table(
  id uuid, kind text, status text, label text, due_date date, send_at date, sent_at timestamptz,
  answered_at timestamptz, answered_how text, closed_at timestamptz, channel text, to_email text, locale text,
  contact_id uuid, contact_name text, vehicle_id uuid, vehicle_label text, source_id uuid,
  crm_card_id uuid, crm_task_id uuid, last_error text, token uuid, created_at timestamptz,
  is_test boolean, sent_to text
)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select f.id, f.kind, f.status, f.label, f.due_date, f.send_at, f.sent_at,
         f.answered_at, f.answered_how, f.closed_at, f.channel, f.to_email, f.locale,
         f.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), f.to_email) as contact_name,
         f.vehicle_id,
         nullif(btrim(concat_ws(' ', v.brand, v.model)), '')
           || case when nullif(btrim(v.plate), '') is not null then ' (' || btrim(v.plate) || ')' else '' end as vehicle_label,
         f.source_id, f.crm_card_id, f.crm_task_id, f.last_error, f.token, f.created_at,
         f.is_test, f.sent_to
    from public.followups f
    left join public.contacts c on c.id = f.contact_id
    left join public.vehicles v on v.id = f.vehicle_id
   where f.company_id = _company and public.is_member(_company)
   order by case f.status when 'planifiee' then 0 when 'envoyee' then 1 when 'a_rappeler' then 2 when 'repondue' then 3 else 4 end,
            coalesce(f.send_at, current_date), f.created_at desc
   limit 1000;
$fn$;
revoke all on function public.followups_list(uuid) from public, anon;
grant execute on function public.followups_list(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Journal du cron quand des relances dues sont retenues (mode arrete) : appele par la
--    fonction Edge avec la cle de service, une ligne events par societe et par passage.
-- ---------------------------------------------------------------------
create or replace function public.followups_log_held(_company uuid, _mode text, _held integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if auth.uid() is not null then
    raise exception 'followups_log_held: reservee a la fonction serveur' using errcode = '42501';
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, null, 'followups_send_held', 'followup_settings', _company::text, 'system',
          jsonb_build_object('mode', _mode, 'held', _held));
end $fn$;
revoke all on function public.followups_log_held(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.followups_log_held(uuid, text, integer) to service_role;
