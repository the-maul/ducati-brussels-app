-- M3 (Simon, 23/11/2026) : une moto a un propriétaire et, à côté, la banque ou le leasing qui la
-- finance, avec le n° de contrat. Détenteur et utilisateur disparaissent des écrans. Leurs colonnes,
-- vides sur toutes les motos, restent en base pour l'instant : aucune donnée n'est supprimée.
alter table public.vehicles
  add column if not exists financing_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists financing_contract text;

comment on column public.vehicles.financing_contact_id is 'Banque ou société de leasing qui finance la moto.';
comment on column public.vehicles.financing_contract is 'N° du contrat de financement ou de leasing.';

create index if not exists idx_vehicles_financing on public.vehicles (financing_contact_id)
  where financing_contact_id is not null;

create or replace function public._vehicle_financing_company_check()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.financing_contact_id is not null and not exists (
    select 1 from public.contacts c where c.id = new.financing_contact_id and c.company_id = new.company_id
  ) then
    raise exception 'La banque ou le leasing doit appartenir à la même société que la moto.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_vehicle_financing_company on public.vehicles;
create trigger trg_vehicle_financing_company
  before insert or update of financing_contact_id, company_id on public.vehicles
  for each row execute function public._vehicle_financing_company_check();
