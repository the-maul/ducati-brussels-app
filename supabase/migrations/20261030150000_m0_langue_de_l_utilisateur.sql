-- =====================================================================
-- M0 — Langue de l'application par utilisateur (I18N001)
-- Décision client du 30/10/2026 : l'application existe en français, néerlandais,
-- anglais et italien ; chaque utilisateur choisit sa langue (menu du compte, en haut
-- à droite). L'équipe Italbike reste en français par défaut.
--
-- Colonne `profiles.locale` : 'fr' (défaut) | 'nl' | 'en' | 'it'.
-- Lecture : politique existante `profiles_select_own` (chacun lit son profil).
-- Écriture : politique existante `profiles_update_own` (id = auth.uid()) ; mais la
-- migration de sécurité 20260919100200 a restreint l'UPDATE aux colonnes
-- full_name, phone, default_company_id → on ajoute `locale` à cette liste.
--
-- NON DESTRUCTIVE : une colonne ajoutée avec défaut + une contrainte + un GRANT.
-- =====================================================================

alter table public.profiles
  add column if not exists locale text not null default 'fr';

comment on column public.profiles.locale is
  'Langue de l''interface choisie par l''utilisateur : fr (défaut), nl, en, it. '
  'Lue au chargement de la session, modifiable par l''utilisateur lui-même (menu du compte).';

alter table public.profiles drop constraint if exists profiles_locale_check;
alter table public.profiles
  add constraint profiles_locale_check check (locale in ('fr', 'nl', 'en', 'it'));

-- L'utilisateur peut changer sa propre langue (RLS profiles_update_own + droit colonne).
grant update (locale) on table public.profiles to authenticated;
