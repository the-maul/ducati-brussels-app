-- M1 — Liaison entre fiches contact (M:N). Un pro peut être lié à un/plusieurs particuliers
-- (et inversement). Sert à : retrouver le compte privé d'un pro (et vice versa), fusionner
-- la VUE du parc moto (non destructif : chaque moto reste sur sa fiche), recoupement Ducati.
-- Remplace l'approche « bloc privé en dur » : on retire les champs privés et owner_kind.

create table if not exists public.contact_links (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  contact_a   uuid not null references public.contacts(id) on delete cascade,
  contact_b   uuid not null references public.contacts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  check (contact_a <> contact_b)
);
-- Paire non ordonnée unique (un seul lien entre deux fiches).
create unique index if not exists uq_contact_links_pair
  on public.contact_links (least(contact_a, contact_b), greatest(contact_a, contact_b));
create index if not exists idx_contact_links_a on public.contact_links(contact_a);
create index if not exists idx_contact_links_b on public.contact_links(contact_b);

alter table public.contact_links enable row level security;
drop policy if exists contact_links_all on public.contact_links;
create policy contact_links_all on public.contact_links for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- On abandonne l'approche précédente (champs privés en dur + drapeau moto).
alter table public.contacts
  drop column if exists private_address,
  drop column if exists private_address_complement,
  drop column if exists private_zip,
  drop column if exists private_city,
  drop column if exists private_country,
  drop column if exists private_phone,
  drop column if exists private_mobile,
  drop column if exists private_email;
alter table public.vehicle_owners drop column if exists owner_kind;

notify pgrst, 'reload schema';
