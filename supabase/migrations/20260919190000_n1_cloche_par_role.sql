-- =====================================================================
-- DÉCISION N-1 (19/09) : la cloche montre à chacun ce qui le concerne.
-- Migration ADDITIVE : une fonction nouvelle + resserrement d'une politique
-- (ALTER POLICY, rien n'est supprimé, aucune donnée modifiée).
--
-- Les alertes « nouvelle inscription de client » (team_notifications, kind =
-- 'signup') étaient lisibles par TOUT membre de la société. Elles ne le sont
-- plus que par les rôles vendeur, marketing et admin : un mécanicien ne peut
-- plus les lire, même par l'API.
--
-- Conséquence automatique : la politique d'insertion de `team_notification_reads`
-- vérifie l'existence de la notification SOUS RLS ; qui ne la voit pas ne peut
-- donc pas non plus la marquer comme lue.
--
-- Les tâches CRM (lead_tasks) et les demandes de rendez-vous atelier restent
-- lisibles par les membres (le pipeline et le planning en ont besoin) : le tri
-- « ce qui me concerne » de la cloche est fait à l'écran.
-- =====================================================================

-- Qui peut voir une alerte interne d'un type donné, dans une société donnée.
-- Un type inconnu : tout membre (comportement antérieur).
create or replace function public.can_see_team_notification(_company uuid, _kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case _kind
    when 'signup' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'vendeur')
      or public.has_role(_company, 'marketing')
    else public.is_member(_company)
  end;
$fn$;
comment on function public.can_see_team_notification(uuid, text) is
  'Décision N-1 : une alerte « inscription » n''est visible que des rôles admin, vendeur, marketing.';
revoke all on function public.can_see_team_notification(uuid, text) from public, anon;
grant execute on function public.can_see_team_notification(uuid, text) to authenticated, service_role;

alter policy team_notifications_member_read on public.team_notifications
  using (public.is_member(company_id) and public.can_see_team_notification(company_id, kind));
