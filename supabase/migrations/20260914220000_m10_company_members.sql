-- =====================================================================
-- M10 — Liste des personnes d'une société, pour assigner une tâche.
-- Réf. docs/plan-nouveau-client.md (retours client du 14/09).
--
-- `leads.assigned_to` existe déjà et pointe vers `auth.users`. Il manquait le
-- moyen de proposer une liste de noms dans l'interface.
--
-- Pourquoi une fonction dédiée plutôt que les moyens existants :
--   · `user_roles` n'est lisible que pour soi-même ou par un admin
--     (`user_roles_select`), donc un vendeur ne voit pas ses collègues ;
--   · `profiles` n'est lisible que pour soi-même (`profiles_select_own`) ;
--   · la fonction serveur `listOrgUsers` refuse l'accès à qui n'est pas admin,
--     et renvoie tout l'organisation, pas une société.
-- On renvoie donc ici les membres de LA société, à tout membre de cette société,
-- sans exposer les profils ni les rôles au-delà de ce périmètre.
--
-- Les rôles sont agrégés : dans cette base une même personne en cumule jusqu'à six.
-- =====================================================================

create or replace function public.company_members(_company uuid)
returns table(user_id uuid, name text, roles text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select ur.user_id,
         coalesce(nullif(btrim(p.full_name), ''), p.email, ur.user_id::text) as name,
         string_agg(distinct ur.role::text, ', ' order by ur.role::text) as roles
    from public.user_roles ur
    left join public.profiles p on p.id = ur.user_id
   where ur.company_id = _company
     -- Même garde que `contacts_search` et `lead_audit` : un appel serveur passe,
     -- un utilisateur connecté doit être membre de la société.
     and (auth.uid() is null or public.is_member(_company))
     and coalesce(p.is_active, true)
   group by ur.user_id, coalesce(nullif(btrim(p.full_name), ''), p.email, ur.user_id::text)
   order by 2;
$fn$;
revoke execute on function public.company_members(uuid) from public, anon;
grant  execute on function public.company_members(uuid) to authenticated, service_role;

comment on function public.company_members(uuid) is
  'Membres d''une societe (nom + roles agreges), pour assigner une tache. Contourne user_roles_select et profiles_select_own sans elargir leur portee.';
