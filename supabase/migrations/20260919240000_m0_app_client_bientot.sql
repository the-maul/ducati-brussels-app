-- =====================================================================
-- MISSION 01 — Lien du site Shopify vers l'application client (décision W-5,
-- 19/09). Migration STRICTEMENT ADDITIVE.
--
--   1. signup_settings.client_app_open : l'interrupteur « Application client :
--      bientôt disponible / ouverte ». Faux par défaut : la page publique
--      /app-client affiche « Notre application client sera bientôt disponible » ;
--      vrai : /app-client redirige vers /inscription.
--      + trace d'audit (events) sur signup_settings, qui n'en avait pas.
--   2. app_client_waitlist : les e-mails laissés sur « Prévenez-moi à
--      l'ouverture », avec la preuve du consentement (moment + texte affiché).
--
-- Accès : la page publique lit le réglage et enregistre les e-mails par une
-- server function avec la clé de service (src/modules/signup/app-client.functions.ts).
-- Aucune fonction SQL, aucun droit pour anon. Les administrateurs de la société
-- lisent la liste (Paramètres → Application client).
-- =====================================================================

-- ------------------------------------------------ 1. Interrupteur
alter table public.signup_settings
  add column if not exists client_app_open boolean not null default false;
comment on column public.signup_settings.client_app_open is
  'Application client ouverte au public ? false = /app-client affiche la page « bientôt disponible » '
  '(et le formulaire « Prévenez-moi ») ; true = /app-client redirige vers /inscription. Décision W-5.';

drop trigger if exists trg_signup_settings_audit on public.signup_settings;
create trigger trg_signup_settings_audit
  after insert or update or delete on public.signup_settings
  for each row execute function public.audit_row();

-- ------------------------------------------------ 2. « Prévenez-moi à l'ouverture »
create table if not exists public.app_client_waitlist (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  email        text not null
               check (email = lower(btrim(email)) and char_length(email) between 3 and 200 and email like '%_@_%'),
  consent_at   timestamptz not null default now(),
  consent_text text not null check (char_length(consent_text) between 1 and 500),
  source       text not null default 'app-client' check (source in ('app-client')),
  -- Empreinte SHA-256 (salée) de l'adresse IP : sert seulement à limiter les envois.
  client_hash  text,
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (company_id, email)
);
comment on table public.app_client_waitlist is
  'E-mails laissés sur la page publique /app-client (« Prévenez-moi à l''ouverture »), avec consentement '
  'explicite (consent_at + consent_text affiché). notified_at : rempli quand le mail d''ouverture est parti. '
  'Écriture uniquement par la server function (clé de service) ; lecture : administrateurs de la société.';
create index if not exists idx_app_client_waitlist_company
  on public.app_client_waitlist(company_id, created_at desc);
create index if not exists idx_app_client_waitlist_client
  on public.app_client_waitlist(client_hash, created_at desc);

alter table public.app_client_waitlist enable row level security;
drop policy if exists app_client_waitlist_admin_read on public.app_client_waitlist;
create policy app_client_waitlist_admin_read on public.app_client_waitlist
  for select using (public.is_admin(company_id));

revoke all on table public.app_client_waitlist from public, anon, authenticated;
grant select on table public.app_client_waitlist to authenticated;
grant all on table public.app_client_waitlist to service_role;
