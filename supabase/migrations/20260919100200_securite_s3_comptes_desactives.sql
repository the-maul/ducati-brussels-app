-- LOT SÉCURITÉ S3 — Un compte désactivé perd l'accès aux données.
-- Réf. docs/bible/securite-lot-S.md §S3.
--
-- Avant : Paramètres → Utilisateurs → « désactiver » ne modifiait que profiles.is_active.
-- Ni la connexion ni is_member / has_role ne lisaient ce champ : le salarié désactivé gardait
-- tout. Pire, la politique profiles_update_own lui permettait de REMETTRE lui-même
-- is_active = true par l'API (droit UPDATE sur toutes les colonnes de son profil).
--
-- Après :
--   1. is_member et has_role (donc is_admin, qui passe par has_role) exigent un profil actif.
--      Toutes les politiques RLS (97 sur 101 pour authenticated) et toutes les fonctions
--      gardées suivent automatiquement. Effet immédiat, même avec un jeton encore valide.
--   2. Un utilisateur ne peut plus modifier que full_name, phone et default_company_id de
--      son propre profil (le front ne modifie aucun profil lui-même : seul l'écran
--      Utilisateurs le fait, avec la clé de service, côté serveur).
--
-- Choix « fermé par défaut » : un compte sans ligne profiles n'est plus membre de rien.
-- Vérifié le 19/09 : 4 comptes avec rôle, 4 profils, 0 compte sans profil, is_active NOT NULL.
--
-- Coût mesuré le 19/09 (transaction annulée, compte admin, SELECT count(*) sur contacts,
-- 8 108 lignes, RLS évaluée ligne à ligne) : 130 ms → 212 ms (+60 %, ~10 µs par ligne).
-- Les écrans paginés et les fonctions de recherche (contacts_search appelle is_member une
-- seule fois) ne sont pas sensiblement affectés.
--
-- Hors base (recommandé, non fait ici) : à la désactivation, bannir aussi le compte dans
-- Supabase Auth (auth.admin.updateUserById(id, { ban_duration })) pour bloquer la connexion.
--
-- NON APPLIQUÉE.

create or replace function public.is_member(_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.user_id
     where ur.user_id = auth.uid()
       and ur.company_id = _company
       and p.is_active
  );
$$;

create or replace function public.has_role(_company uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.user_id
     where ur.user_id = auth.uid()
       and ur.company_id = _company
       and ur.role = _role
       and p.is_active
  );
$$;
-- is_admin(_company) = has_role(_company, 'admin') : inchangée, suit automatiquement.

-- Profil : plus de modification de is_active, email, id, created_at par l'intéressé.
revoke update on table public.profiles from anon, authenticated;
grant update (full_name, phone, default_company_id) on table public.profiles to authenticated;
