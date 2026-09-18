-- =====================================================================
-- MISSION 01 — LOT 5 : prévenir l'équipe quand un client s'inscrit.
-- Migration STRICTEMENT ADDITIVE (deux tables, une fonction, un déclencheur).
--
-- Quand un client crée lui-même son compte (page /inscription ou borne /borne),
-- une ligne apparaît dans la CLOCHE de la barre du haut de chaque membre de la
-- société : « Nouvelle inscription : Prénom Nom (borne / en ligne) », cliquable
-- vers la fiche client. Aucun e-mail, aucun SMS.
--
-- Pourquoi une table dédiée et pas `notifications` : `notifications` est la FILE
-- D'ENVOI e-mail / SMS vidée par l'Edge Function `dispatch-notifications` (toutes
-- les 10 min). Y mettre une alerte interne risquerait qu'elle parte un jour chez
-- quelqu'un dès qu'une clé Resend / SMS sera posée.
--
-- Déclencheur : APRÈS l'insertion dans `contact_accounts`, SEULEMENT si le compte
-- de connexion a été créé par l'inscription publique (métadonnée
-- `signup_origin` = web | comptoir posée par src/modules/signup/signup.functions.ts).
-- Un compte client créé par un administrateur (écran Utilisateurs) ne notifie pas.
-- Aucune modification de `signup_register` ni de la server function : rien à
-- redéployer. Une erreur ici ne fait JAMAIS échouer l'inscription (avertissement).
--
-- « Lu » PAR UTILISATEUR : table `team_notification_reads` (une ligne par
-- utilisateur et par notification lue). La cloche affiche les 7 derniers jours.
-- =====================================================================

-- ------------------------------------------------ 1. Notifications internes
create table if not exists public.team_notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        text not null check (kind in ('signup')),
  -- Volontairement SANS clé étrangère : `contact_merge` refuse toute fusion d'une
  -- fiche encore référencée par une clé étrangère qu'il ne connaît pas (filet
  -- MERGE_UNHANDLED_REFERENCE). Une alerte d'inscription ne doit pas bloquer la
  -- fusion d'un doublon. Si la fiche est fusionnée, le lien mène à la fiche archivée
  -- (qui indique la fiche gardée).
  contact_id  uuid,
  title       text not null,            -- « Prénom Nom » au moment de l'inscription
  origin      text check (origin in ('web', 'comptoir')),
  created_at  timestamptz not null default now()
);
comment on table public.team_notifications is
  'Alertes internes affichées dans la cloche de la barre du haut (membres de la société). '
  'Aucun envoi : ce n''est PAS la file d''envoi e-mail/SMS (table notifications). '
  'kind = signup : un client s''est inscrit (origin web = en ligne, comptoir = borne).';
create index if not exists idx_team_notifications_company
  on public.team_notifications(company_id, created_at desc);

alter table public.team_notifications enable row level security;
create policy team_notifications_member_read on public.team_notifications
  for select to authenticated using (public.is_member(company_id));
-- Écriture : uniquement par le déclencheur ci-dessous (security definer).
revoke all on table public.team_notifications from anon;
revoke insert, update, delete, truncate on table public.team_notifications from authenticated;
grant select on table public.team_notifications to authenticated;

-- ------------------------------------------------ 2. « Lu » par utilisateur
create table if not exists public.team_notification_reads (
  notification_id uuid not null references public.team_notifications(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);
comment on table public.team_notification_reads is
  'Notifications internes lues, par utilisateur (chacun a sa propre cloche).';
create index if not exists idx_team_notification_reads_user
  on public.team_notification_reads(user_id);

alter table public.team_notification_reads enable row level security;
create policy team_notification_reads_own_read on public.team_notification_reads
  for select to authenticated using (user_id = auth.uid());
create policy team_notification_reads_own_insert on public.team_notification_reads
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.team_notifications n
       where n.id = notification_id and public.is_member(n.company_id)
    )
  );
revoke all on table public.team_notification_reads from anon;
revoke update, delete, truncate on table public.team_notification_reads from authenticated;
grant select, insert on table public.team_notification_reads to authenticated;

-- ------------------------------------------------ 3. Déclencheur d'inscription
create or replace function public.trg_notify_team_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _origin text;
  _meta_name text;
  _name text;
begin
  begin
    select u.raw_user_meta_data->>'signup_origin', u.raw_user_meta_data->>'full_name'
      into _origin, _meta_name
      from auth.users u
     where u.id = new.user_id;

    -- Compte créé par un administrateur (pas d'origine d'inscription) : rien.
    if _origin is null or _origin not in ('web', 'comptoir') then
      return new;
    end if;

    select nullif(btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), ''))), '')
      into _name
      from public.contacts c
     where c.id = new.contact_id;

    insert into public.team_notifications (company_id, kind, contact_id, title, origin)
    values (
      new.company_id, 'signup', new.contact_id,
      coalesce(_name, nullif(btrim(_meta_name), ''), '—'),
      _origin
    );
  exception when others then
    -- Jamais d'inscription refusée à cause d'une alerte interne.
    raise warning 'trg_notify_team_signup: %', sqlerrm;
  end;
  return new;
end $fn$;
revoke all on function public.trg_notify_team_signup() from public, anon, authenticated;

create trigger trg_contact_accounts_notify_signup
  after insert on public.contact_accounts
  for each row execute function public.trg_notify_team_signup();

-- ------------------------------------------------ 4. Reprise des inscriptions récentes
-- Les inscriptions des 7 derniers jours (avant ce déclencheur) apparaissent aussi
-- dans la cloche, à leur date réelle.
insert into public.team_notifications (company_id, kind, contact_id, title, origin, created_at)
select ca.company_id, 'signup', ca.contact_id,
       coalesce(
         nullif(btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), ''))), ''),
         nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), '—'),
       u.raw_user_meta_data->>'signup_origin',
       ca.created_at
  from public.contact_accounts ca
  join auth.users u on u.id = ca.user_id
  left join public.contacts c on c.id = ca.contact_id
 where u.raw_user_meta_data->>'signup_origin' in ('web', 'comptoir')
   and ca.created_at > now() - interval '7 days'
   and not exists (
     select 1 from public.team_notifications n
      where n.kind = 'signup' and n.contact_id = ca.contact_id
   );
