-- =====================================================================
-- M1 — Langue du client (I18N004, décision client du 30/10/2026, M-71)
-- « On a la version dans la langue de l'utilisateur (français pour la team Italbike),
--   mais le client, lui, la reçoit dans sa langue. »
--
-- UNE SEULE SOURCE : `contacts.locale` ('fr' par défaut | 'nl' | 'en' | 'it').
--   - Les documents PDF (devis, bon de commande, réservation, livraison, facture…),
--     les e-mails et les SMS adressés au client sont composés dans cette langue.
--   - Le compte client lié (contact_accounts → profiles.locale, migration 20261030150000)
--     SUIT la fiche : un déclencheur recopie contacts.locale dans profiles.locale
--     à chaque changement, et à la liaison d'un compte. L'espace client n'écrit plus
--     profiles.locale directement : il passe par portal_set_locale(), qui écrit la fiche.
--
-- STRICTEMENT ADDITIVE : une colonne avec défaut, une contrainte, deux déclencheurs,
-- une fonction portal_*. Aucune ligne existante modifiée (toutes les fiches sont en FR).
-- Ordre : s'applique après 20261030150000 (profiles.locale) ; la colonne est tout de même
-- garantie ici (même définition) pour que l'ordre d'application ne casse rien.
--
-- À APPLIQUER PAR LE CLIENT (pas par un agent) :
--   npx supabase@2.117.0 db push --linked --project-ref ujmrosbgkvgvwfnuryna
-- =====================================================================

-- 0. Garde-fou : profiles.locale (migration 20261030150000), même définition.
alter table public.profiles
  add column if not exists locale text not null default 'fr';
alter table public.profiles drop constraint if exists profiles_locale_check;
alter table public.profiles
  add constraint profiles_locale_check check (locale in ('fr', 'nl', 'en', 'it'));

-- 1. La langue du client sur sa fiche.
alter table public.contacts
  add column if not exists locale text not null default 'fr';

comment on column public.contacts.locale is
  'Langue du client (I18N004) : fr (défaut), nl, en, it. Celle de ses documents PDF, '
  'de nos e-mails et SMS. Le compte client lié (profiles.locale) suit cette valeur.';

alter table public.contacts drop constraint if exists contacts_locale_check;
alter table public.contacts
  add constraint contacts_locale_check check (locale in ('fr', 'nl', 'en', 'it'));

-- 2. Le compte client suit la fiche (fiche → profil), à chaque changement de langue.
create or replace function public.contacts_locale_to_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.locale is not distinct from old.locale then
    return new;
  end if;
  update public.profiles p
     set locale = new.locale
    from public.contact_accounts ca
   where ca.contact_id = new.id
     and p.id = ca.user_id
     and p.locale is distinct from new.locale;
  return new;
end $$;

revoke all on function public.contacts_locale_to_profile() from public, anon;

drop trigger if exists trg_contacts_locale_to_profile on public.contacts;
create trigger trg_contacts_locale_to_profile
  after insert or update of locale on public.contacts
  for each row execute function public.contacts_locale_to_profile();

-- 3. À la liaison d'un compte client (inscription, invitation), le profil prend la langue
--    de la fiche : une seule source dès le premier jour.
create or replace function public.contact_accounts_locale_from_contact()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _locale text;
begin
  select c.locale into _locale from public.contacts c where c.id = new.contact_id;
  if _locale is not null then
    update public.profiles p set locale = _locale
     where p.id = new.user_id and p.locale is distinct from _locale;
  end if;
  return new;
end $$;

revoke all on function public.contact_accounts_locale_from_contact() from public, anon;

drop trigger if exists trg_contact_accounts_locale on public.contact_accounts;
create trigger trg_contact_accounts_locale
  after insert or update of contact_id on public.contact_accounts
  for each row execute function public.contact_accounts_locale_from_contact();

-- 4. Espace client → Mon profil → Préférences → Langue : écrit la FICHE (le profil suit
--    par le déclencheur 2). Même protection que les autres portal_* : SECURITY DEFINER,
--    client retrouvé par _portal_ctx() (jamais un identifiant du navigateur).
create or replace function public.portal_set_locale(p_locale text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare _ctx record;
begin
  if p_locale is null or p_locale not in ('fr', 'nl', 'en', 'it') then
    raise exception 'PORTAL_BAD_LOCALE' using errcode = '22023';
  end if;
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then
    raise exception 'PORTAL_NO_CONTACT' using errcode = '42501';
  end if;
  update public.contacts c
     set locale = p_locale
   where c.id = _ctx.contact_id
     and c.locale is distinct from p_locale;
end $$;

revoke all on function public.portal_set_locale(text) from public, anon;
grant execute on function public.portal_set_locale(text) to authenticated;
