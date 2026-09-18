-- =====================================================================
-- M0 — « Mot de passe oublié ? » sur /login (carte « Inscription en ligne : créer
-- mon compte et choisir ma moto », 19/09).
-- Migration STRICTEMENT ADDITIVE : une table de suivi + deux fonctions.
--
-- Le lien de réinitialisation est envoyé par Outlook par la fonction Edge
-- `send-account-invitation` (kind = 'reset', appel PUBLIC), pas par
-- supabase.auth.resetPasswordForEmail : l'adresse de retour configurée dans
-- Supabase Auth pointe encore vers localhost.
--
-- Protection contre les abus :
--   - au plus 1 envoi par adresse toutes les 5 minutes et 5 par heure ;
--   - au plus 20 demandes par heure depuis une même adresse IP ;
--   - la table ne contient AUCUNE adresse e-mail ni IP en clair : seulement leur
--     empreinte SHA-256 (calculée par la fonction Edge). Lignes purgées après 24 h.
--   - la réponse de la fonction Edge est identique que le compte existe ou non.
-- Les deux fonctions ne sont exécutables que par la clé de service.
-- =====================================================================

create table if not exists public.password_reset_requests (
  id          bigint generated always as identity primary key,
  email_hash  text not null,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
comment on table public.password_reset_requests is
  'Suivi anti-abus des demandes « Mot de passe oublié » (empreintes SHA-256 seulement, purge après 24 h). '
  'Écrit uniquement par password_reset_allow (clé de service).';
create index if not exists idx_password_reset_requests_email
  on public.password_reset_requests(email_hash, created_at desc);
create index if not exists idx_password_reset_requests_ip
  on public.password_reset_requests(ip_hash, created_at desc);

alter table public.password_reset_requests enable row level security;
-- Aucune politique : ni anon ni authenticated ne lisent ou n'écrivent.
revoke all on table public.password_reset_requests from public, anon, authenticated;

-- ------------------------------------------------ 1. Limiteur
-- Renvoie true (et enregistre la demande) si un envoi est permis, false sinon.
create or replace function public.password_reset_allow(_email_hash text, _ip_hash text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if _email_hash is null or length(_email_hash) <> 64 then
    return false;
  end if;
  -- Deux demandes simultanées pour la même adresse passent l'une après l'autre.
  perform pg_advisory_xact_lock(hashtext('password_reset:' || _email_hash));

  delete from public.password_reset_requests where created_at < now() - interval '24 hours';

  if exists (
    select 1 from public.password_reset_requests
     where email_hash = _email_hash and created_at > now() - interval '5 minutes'
  ) then
    return false;
  end if;
  if (select count(*) from public.password_reset_requests
       where email_hash = _email_hash and created_at > now() - interval '1 hour') >= 5 then
    return false;
  end if;
  if _ip_hash is not null and (select count(*) from public.password_reset_requests
       where ip_hash = _ip_hash and created_at > now() - interval '1 hour') >= 20 then
    return false;
  end if;

  insert into public.password_reset_requests (email_hash, ip_hash) values (_email_hash, _ip_hash);
  return true;
end $fn$;
revoke all on function public.password_reset_allow(text, text) from public, anon, authenticated;
grant execute on function public.password_reset_allow(text, text) to service_role;

-- ------------------------------------------------ 2. Destinataire
-- Le compte correspondant à l'adresse, s'il existe, est ACTIF et appartient à une
-- société (rôle d'équipe, sinon compte client). Aucune ligne sinon.
create or replace function public.password_reset_target(_email text)
returns table (user_id uuid, company_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select u.id,
         coalesce(
           (select ur.company_id from public.user_roles ur where ur.user_id = u.id order by ur.company_id limit 1),
           (select ca.company_id from public.contact_accounts ca where ca.user_id = u.id order by ca.created_at limit 1)
         )
    from auth.users u
    left join public.profiles p on p.id = u.id
   where lower(u.email) = lower(btrim(_email))
     and coalesce(p.is_active, true)
     and u.deleted_at is null
     and coalesce(u.banned_until, '-infinity'::timestamptz) < now()
     and (exists (select 1 from public.user_roles ur where ur.user_id = u.id)
          or exists (select 1 from public.contact_accounts ca where ca.user_id = u.id))
   limit 1;
$fn$;
revoke all on function public.password_reset_target(text) from public, anon, authenticated;
grant execute on function public.password_reset_target(text) to service_role;
