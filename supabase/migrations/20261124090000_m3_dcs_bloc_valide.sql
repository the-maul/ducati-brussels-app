-- M3 (Simon, 24/11/2026) : le bloc « Données DCS » se valide. Le bouton remplit la fiche avec les
-- valeurs DCS (écarts tranchés côté écran), puis le bloc se replie ; un clic le rouvre.
-- Une nouvelle lecture DCS après la validation rouvre le bloc (date de lecture plus récente).
alter table public.vehicles
  add column if not exists dcs_validated_at timestamptz,
  add column if not exists dcs_validated_by uuid references auth.users(id) on delete set null;

comment on column public.vehicles.dcs_validated_at is 'Dernière validation du bloc Données DCS de la fiche.';
comment on column public.vehicles.dcs_validated_by is 'Utilisateur qui a validé le bloc Données DCS.';

-- Valide seulement quand plus aucun écart n'attend de choix.
create or replace function public.dcs_block_validate(_company uuid, _vehicle uuid)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare
  left_fields text[];
  at timestamptz := now();
begin
  perform public._dcs_write_guard(_company);
  perform 1 from public.vehicles v where v.id = _vehicle and v.company_id = _company for update;
  if not found then raise exception 'dcs_vehicle_not_found'; end if;

  select array_agg(s.field order by s.field) into left_fields
    from public.vehicle_field_status s
   where s.vehicle_id = _vehicle and s.company_id = _company and s.status = 'conflit';
  if left_fields is not null then
    raise exception 'dcs_conflicts_left: %', array_to_string(left_fields, ', ') using errcode = '22023';
  end if;

  update public.vehicles set dcs_validated_at = at, dcs_validated_by = auth.uid() where id = _vehicle;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'dcs_block_validated', 'vehicles', _vehicle::text, 'screen', null,
          jsonb_build_object('validated_at', at));
  return at;
end $$;

revoke all on function public.dcs_block_validate(uuid, uuid) from public, anon;
grant execute on function public.dcs_block_validate(uuid, uuid) to authenticated;
