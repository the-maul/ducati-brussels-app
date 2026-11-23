-- =====================================================================
-- M8 — ATE014 (23/11/2026, décision de Simon) : les corrections qui viennent du bon manuel et du
-- dessin de cette moto s'appliquent d'un seul geste ; ce qui n'a pas de source passe « à compléter ».
-- Les cas douteux restent à trancher par l'atelier.
-- Même garde que le reste : administrateur ou chef d'atelier connecté, jamais la clé de service seule.
-- Chaque lot garde sa photo et reste annulable (maintenance_kit_proposals_revert).
-- Cette migration ne change aucun kit.
-- =====================================================================
alter table public.maintenance_kit_proposals add column if not exists auto_safe boolean not null default false;
comment on column public.maintenance_kit_proposals.auto_safe is
  'Groupe entièrement sourcé (bon manuel ou dessin de la moto) ou passage « à compléter » : applicable sans décision ligne par ligne.';

create or replace function public.maintenance_kit_proposals_stats(_company uuid, _batch text)
returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public._maintenance_kit_proposal_gate(_company);
  return (
    select jsonb_build_object(
      'safe_pending', count(*) filter (where auto_safe and applied_at is null and status <> 'refuse'),
      'safe_applied', count(*) filter (where auto_safe and applied_at is not null),
      'safe_blocked', count(*) filter (where auto_safe and applied_at is null and apply_result is not null),
      'to_review', count(*) filter (where not auto_safe and status = 'a_valider'),
      'review_groups', count(distinct group_code) filter (where not auto_safe and status = 'a_valider'),
      'total', count(*))
    from public.maintenance_kit_proposals
    where company_id = _company and batch_code = _batch
  );
end $$;

create or replace function public.maintenance_kit_proposals_apply_safe(_company uuid, _batch text, _max_kits integer default 40)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  grp text[];
  res jsonb;
begin
  perform public._maintenance_kit_proposal_gate(_company);

  update public.maintenance_kit_proposals p
     set status = 'accepte', decided_by = auth.uid(), decided_at = now(),
         decision_note = 'Correction sourcée, application validée par Simon le 23/11/2026'
   where p.company_id = _company and p.batch_code = _batch and p.auto_safe
     and p.status = 'a_valider' and p.applied_at is null;

  -- une ligne déjà tentée et refusée par un contrôle n'est pas rejouée en boucle
  select array_agg(distinct p.group_code) into grp
    from public.maintenance_kit_proposals p
   where p.company_id = _company and p.batch_code = _batch and p.auto_safe
     and p.status = 'accepte' and p.applied_at is null and p.apply_result is null;
  if grp is null then
    return jsonb_build_object('done', true, 'proposals', 0);
  end if;

  res := public._maintenance_kit_proposals_apply_core(_company, _batch, grp, _max_kits, auth.uid());
  return res || jsonb_build_object('done', false);
end $$;

revoke all on function public.maintenance_kit_proposals_stats(uuid, text) from public, anon;
revoke all on function public.maintenance_kit_proposals_apply_safe(uuid, text, integer) from public, anon;
grant execute on function public.maintenance_kit_proposals_stats(uuid, text) to authenticated;
grant execute on function public.maintenance_kit_proposals_apply_safe(uuid, text, integer) to authenticated;
