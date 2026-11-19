-- =====================================================================
-- M8 / M0 — Lot F du parcours mecanicien (19/11/2026) : ecran tablette « Mon atelier ». ATE010 ATE011
--
-- L'ecran lui-meme ne demande rien en base : il relit les tables et vues des lots A a E
-- (workshop_time_entries, workshop_or_work_status, repair_order_plan_progress,
-- repair_order_receptions, stock_reservations, picking_lists) et ses gestes passent par les
-- fonctions existantes (workshop_work_start / pause / stop, ouverture de l'OR depuis le RDV).
--
-- Seule chose ajoutee : la PAGE D'ACCUEIL du compte apres connexion (« preference ou reglage »).
--   profiles.home_page : null (ou 'auto') = selon le role : un mecanicien ou un chef d'atelier
--   arrive sur « Mon atelier », un administrateur et les autres roles sur le tableau de bord ;
--   'my_workshop' / 'dashboard' = choix du compte (reglage en bas de l'ecran « Mon atelier »).
--   Regle pure miroir : homeTarget() dans src/modules/workshop/my-workshop/rules.ts.
--
-- Aucune table, aucune fonction, aucune politique nouvelle, aucun droit d'acces aux ecrans change :
-- la colonne suit la politique existante de profiles (profiles_select_own / profiles_update_own :
-- chacun lit et modifie SA ligne). Comme pour la langue `locale` (20261030150000), le droit de
-- modifier se donne colonne par colonne (20260919100200) : grant update (home_page).
-- profiles n'a pas de company_id (une ligne par compte, toutes societes) : c'est un reglage de
-- compte, pas une donnee de societe.
-- Additive et rejouable. Essai a blanc : supabase/tests/m8_mon_atelier_accueil.sql.
-- NON APPLIQUEE.
-- =====================================================================
set local lock_timeout = '15s';

alter table public.profiles add column if not exists home_page text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_home_page_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_home_page_check
      check (home_page is null or home_page in ('auto', 'dashboard', 'my_workshop'));
  end if;
end $$;

-- Le compte change sa propre page d'accueil (RLS profiles_update_own + droit colonne).
grant update (home_page) on table public.profiles to authenticated;

comment on column public.profiles.home_page is
  'Page d''accueil apres connexion (lot F, 19/11/2026) : null / auto = selon le role (mecanicien, chef d''atelier -> Mon atelier ; autres -> tableau de bord), my_workshop, dashboard.';
