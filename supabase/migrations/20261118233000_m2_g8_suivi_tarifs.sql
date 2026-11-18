-- =====================================================================
-- M2 — Rattrapage G8 (18/11/2026) : suivi des tarifs fournisseurs et formats « perso ».
-- Source : docs/g8-inventaire/02-articles.md, « Mise à jour de tarifs » : Tarif · Fichier(s) ·
-- Date du tarif · Status · Date d'installation · Doc. ; « Intégrer fichier perso » (Excel /
-- texte / CSV). Orisha fournissait les fichiers BIHR, RIZOMA, PIRELLI, METZELER : ils ne
-- viendront plus, le magasin les recevra du fournisseur et les intégrera lui-même.
--
--   supplier_tariff_formats : le « fichier perso » d'un fournisseur = quelle colonne du fichier
--     va dans quel champ de l'article (mapping par NOM d'en-tête, rejoué au prochain fichier).
--   supplier_tariffs : le registre des tarifs reçus (en attente / installé / abandonné), qui
--     l'a installé, quand, combien de lignes. Rempli par l'écran Import (/parts/import).
--
-- Idempotente. NON APPLIQUÉE.
-- =====================================================================

create table if not exists public.supplier_tariff_formats (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  supplier_name text not null,
  mapping       jsonb not null default '{}'::jsonb,
  vat_rate      numeric(5,2),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null default auth.uid()
);
create unique index if not exists uq_supplier_tariff_formats on public.supplier_tariff_formats(company_id, lower(supplier_name));

create table if not exists public.supplier_tariffs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  supplier_id    uuid references public.contacts(id) on delete set null,
  supplier_name  text not null,
  label          text,
  file_name      text,
  tariff_date    date,
  status         text not null default 'en_attente',
  rows_count     int,
  created_count  int,
  updated_count  int,
  anomalies_count int,
  installed_at   timestamptz,
  installed_by   uuid references auth.users(id) on delete set null,
  attachment_path text,
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at     timestamptz not null default now(),
  constraint supplier_tariffs_status_chk check (status in ('en_attente', 'installe', 'abandonne'))
);
create index if not exists idx_supplier_tariffs_company on public.supplier_tariffs(company_id, created_at desc);

alter table public.supplier_tariff_formats enable row level security;
alter table public.supplier_tariffs enable row level security;

drop policy if exists supplier_tariff_formats_select on public.supplier_tariff_formats;
create policy supplier_tariff_formats_select on public.supplier_tariff_formats for select to authenticated
  using (public.is_member(company_id));
drop policy if exists supplier_tariff_formats_write on public.supplier_tariff_formats;
create policy supplier_tariff_formats_write on public.supplier_tariff_formats for all to authenticated
  using (public.can_write_table(company_id, 'articles')) with check (public.can_write_table(company_id, 'articles'));

drop policy if exists supplier_tariffs_select on public.supplier_tariffs;
create policy supplier_tariffs_select on public.supplier_tariffs for select to authenticated
  using (public.is_member(company_id));
drop policy if exists supplier_tariffs_insert on public.supplier_tariffs;
create policy supplier_tariffs_insert on public.supplier_tariffs for insert to authenticated
  with check (public.can_write_table(company_id, 'articles'));
drop policy if exists supplier_tariffs_update on public.supplier_tariffs;
create policy supplier_tariffs_update on public.supplier_tariffs for update to authenticated
  using (public.can_write_table(company_id, 'articles')) with check (public.can_write_table(company_id, 'articles'));
-- Pas de suppression : un tarif abandonné passe en statut « abandonne » (registre complet).

drop trigger if exists trg_supplier_tariff_formats_updated on public.supplier_tariff_formats;
create trigger trg_supplier_tariff_formats_updated before update on public.supplier_tariff_formats
  for each row execute function public.set_updated_at();
drop trigger if exists trg_supplier_tariffs_updated on public.supplier_tariffs;
create trigger trg_supplier_tariffs_updated before update on public.supplier_tariffs
  for each row execute function public.set_updated_at();
drop trigger if exists trg_supplier_tariffs_audit on public.supplier_tariffs;
create trigger trg_supplier_tariffs_audit after insert or update or delete on public.supplier_tariffs
  for each row execute function public.audit_row();
drop trigger if exists trg_supplier_tariff_formats_audit on public.supplier_tariff_formats;
create trigger trg_supplier_tariff_formats_audit after insert or update or delete on public.supplier_tariff_formats
  for each row execute function public.audit_row();
