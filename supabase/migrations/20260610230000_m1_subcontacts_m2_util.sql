-- =====================================================================
-- M1 — Sous-contacts (interlocuteurs d'une fiche B2B)
-- M2 — Références utilitaires (templates POS hérités de G8) en seed
-- =====================================================================

create table if not exists public.contact_subcontacts (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  name        text not null,
  role        text,
  phone       text,
  email       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_subcontacts_contact on public.contact_subcontacts(contact_id);

alter table public.contact_subcontacts enable row level security;
drop policy if exists subcontacts_all on public.contact_subcontacts;
create policy subcontacts_all on public.contact_subcontacts for all to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id and public.is_member(c.company_id)))
  with check (exists (select 1 from public.contacts c where c.id = contact_id and public.is_member(c.company_id)));

-- ---------------------------------------------------------------------
-- Références utilitaires G8 (comportements POS) — seed par société
-- ---------------------------------------------------------------------
insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate, descriptif)
select c.id, d.reference, d.designation, d.mgmt_type::public.article_mgmt_type, d.vat_rate, d.descriptif
from public.companies c
cross join (values
  ('MO',       'Main d''œuvre atelier (taux horaire)', 'T', 21, 'Quantité en centièmes d''heure (hérité G8, ADR-002).'),
  ('TEXTE',    'Ligne de texte libre',                 'F', 0,  'Ligne libre non valorisée (type F).'),
  ('FRAIS_BL', 'Frais de bon de livraison',            'M', 21, 'Frais ajoutés en pied de document.'),
  ('+2.0',     'Petites fournitures (% du total)',     'M', 21, 'Pourcentage du total HT (comportement POS G8).'),
  ('PORT',     'Frais de port',                        'M', 21, 'Frais de port taxables.')
) as d(reference, designation, mgmt_type, vat_rate, descriptif)
on conflict (company_id, reference) do nothing;
