-- =====================================================================
-- M9 — Documents & GED (gestion électronique de documents) : pièces jointes
-- génériques rattachées à n'importe quelle entité (véhicule, contact, OR, document…)
-- via Supabase Storage. Bucket privé 'ged', chemin = {company_id}/{entity}/{id}/{fichier}.
-- company_id + RLS + audit (B7). Sert : photos/COC véhicule, pièce d'identité client,
-- photos de réception OR, justificatifs.
-- =====================================================================

create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  entity_type  text not null,                 -- 'vehicle' | 'contact' | 'repair_order' | 'document' | ...
  entity_id    uuid not null,
  file_name    text not null,
  storage_path text not null,                  -- chemin dans le bucket 'ged'
  content_type text,
  size_bytes   bigint,
  note         text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_attachments_entity on public.attachments(entity_type, entity_id);
create index if not exists idx_attachments_company on public.attachments(company_id);

drop trigger if exists trg_attachments_audit on public.attachments;
create trigger trg_attachments_audit after insert or update or delete on public.attachments for each row execute function public.audit_row();

alter table public.attachments enable row level security;
drop policy if exists attachments_all on public.attachments;
create policy attachments_all on public.attachments for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Bucket privé pour la GED.
insert into storage.buckets (id, name, public) values ('ged', 'ged', false) on conflict (id) do nothing;

-- RLS Storage : un membre de la société (1er segment du chemin = company_id) gère ses fichiers.
drop policy if exists ged_select on storage.objects;
create policy ged_select on storage.objects for select to authenticated
  using (bucket_id = 'ged' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists ged_insert on storage.objects;
create policy ged_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ged' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists ged_delete on storage.objects;
create policy ged_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ged' and public.is_member(((storage.foldername(name))[1])::uuid));
