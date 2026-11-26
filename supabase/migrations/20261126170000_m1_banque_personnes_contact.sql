-- =====================================================================
-- M1 — Fiche d'une banque / d'un leasing : personnes de contact (Simon, 26/11/2026). CON002
-- Les interlocuteurs (contact_subcontacts) gagnent un prénom et un « dossier moto lié ».
-- La table reçoit aussi son company_id (règle 2), recopié de la fiche contact.
-- Une moto liée doit appartenir à la même société que la fiche.
-- =====================================================================

alter table public.contact_subcontacts
  add column if not exists first_name text,
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists company_id uuid references public.companies(id);

update public.contact_subcontacts s
   set company_id = c.company_id
  from public.contacts c
 where c.id = s.contact_id and s.company_id is distinct from c.company_id;

create index if not exists idx_subcontacts_vehicle on public.contact_subcontacts(vehicle_id) where vehicle_id is not null;
create index if not exists idx_subcontacts_company on public.contact_subcontacts(company_id);

create or replace function public.trg_contact_subcontacts_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.company_id into new.company_id from public.contacts c where c.id = new.contact_id;
  if new.company_id is null then
    raise exception 'Fiche contact introuvable pour cette personne de contact';
  end if;
  if new.vehicle_id is not null and not exists (
    select 1 from public.vehicles v where v.id = new.vehicle_id and v.company_id = new.company_id
  ) then
    raise exception 'La moto liée n''appartient pas à la même société que la fiche';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contact_subcontacts_company on public.contact_subcontacts;
create trigger trg_contact_subcontacts_company
  before insert or update of contact_id, vehicle_id, company_id on public.contact_subcontacts
  for each row execute function public.trg_contact_subcontacts_company();

alter table public.contact_subcontacts alter column company_id set not null;
