-- =====================================================================
-- M8 — Dossiers accident (mission 09, carte 5, ACH005 — specification de Simon du 30/10/2026,
-- reponses du 03/11/2026).
--
-- Un DOSSIER ACCIDENT reunit, pour une moto accidentee, tout ce que Ducati West Europe
-- demande pour l'aide a la reparation : la fiche (moto / VIN, client, assurance, n° de sinistre,
-- expert, urgence), le DEVIS du DMS, les PHOTOS avant reparation (dont la photo du n° de chassis
-- grave), le FORMULAIRE Excel « Aide Reparation Moto Accidentee » genere depuis le devis, et le
-- MAIL envoye depuis la boite Outlook de l'utilisateur a technique.dwe@ducati.com.
-- Regle M08 : « un dossier part complet ou ne part pas » (devis, formulaire, >= 4 photos,
-- photo du chassis, devis >= 1 500 € HTVA).
--
-- STRICTEMENT ADDITIVE : deux tables, une ligne de parametres par societe. Les fichiers
-- (photos, formulaire, PDF de photos, rapport de l'expert) sont dans la GED (bucket `ged`,
-- entite `accident_file`), jamais en base64 en base.
--
-- NE PAS APPLIQUER depuis un agent. Essai a blanc :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f <ce fichier>
--   (entre begin; et rollback;). Application par le client :
--   npx supabase@2.117.0 db push --linked --project-ref ujmrosbgkvgvwfnuryna
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Le dossier
-- ---------------------------------------------------------------------
create table if not exists public.accident_files (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  vehicle_id         uuid references public.vehicles(id) on delete set null,
  contact_id         uuid references public.contacts(id) on delete set null,
  repair_order_id    uuid references public.repair_orders(id) on delete set null,
  quote_document_id  uuid references public.documents(id) on delete set null,
  insurer            text,
  claim_number       text,
  expert_name        text,
  expert_email       text,
  expert_report_path text,
  is_urgent          boolean not null default false,
  urgent_note        text,
  status             text not null default 'brouillon',
  sent_at            timestamptz,
  sent_to            text,
  sent_cc            text,
  mail_subject       text,
  form_path          text,
  photos_pdf_path    text,
  vin_photo_path     text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint accident_files_status_check
    check (status in ('brouillon', 'envoye', 'accorde', 'pieces_recues', 'repare', 'clos'))
);
create index if not exists idx_accident_files_company_status on public.accident_files(company_id, status);
create index if not exists idx_accident_files_vehicle on public.accident_files(vehicle_id);
create index if not exists idx_accident_files_contact on public.accident_files(contact_id);
create index if not exists idx_accident_files_or on public.accident_files(repair_order_id);
create index if not exists idx_accident_files_quote on public.accident_files(quote_document_id);

comment on table public.accident_files is
  'Dossier accident envoye a Ducati West Europe (aide a la reparation) : fiche, devis du DMS, photos (GED), formulaire Excel genere, mail conserve. brouillon → envoye → accorde → pieces_recues → repare → clos.';
comment on column public.accident_files.quote_document_id is
  'Devis du DMS (documents.doc_type = DEV) joint au dossier ; ses lignes pieces remplissent le formulaire Ducati.';
comment on column public.accident_files.form_path is
  'Chemin GED du formulaire Excel « Aide Reparation Moto Accidentee » genere (format du modele Ducati).';
comment on column public.accident_files.photos_pdf_path is
  'Chemin GED du PDF de photos assemble (une photo par page, horodatee).';
comment on column public.accident_files.vin_photo_path is
  'Chemin GED de la photo du n° de chassis grave (jointe au mail en JPG, en plus du PDF).';
comment on column public.accident_files.sent_cc is
  'Copie du mail (vide par defaut, decision client du 03/11/2026) ; reglable dans Parametres → Tables, cle accident_file_mail.';

drop trigger if exists trg_accident_files_updated on public.accident_files;
create trigger trg_accident_files_updated before update on public.accident_files
  for each row execute function public.set_updated_at();
drop trigger if exists trg_accident_files_audit on public.accident_files;
create trigger trg_accident_files_audit after insert or update or delete on public.accident_files
  for each row execute function public.audit_row();

alter table public.accident_files enable row level security;
drop policy if exists accident_files_select on public.accident_files;
create policy accident_files_select on public.accident_files for select to authenticated
  using (public.is_member(company_id));
drop policy if exists accident_files_write on public.accident_files;
create policy accident_files_write on public.accident_files for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 2. Les photos du dossier (fichiers dans la GED ; ici la legende, l'ordre, la photo du chassis)
-- ---------------------------------------------------------------------
create table if not exists public.accident_file_photos (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  file_id    uuid not null references public.accident_files(id) on delete cascade,
  path       text not null,
  caption    text,
  is_vin     boolean not null default false,
  taken_at   timestamptz,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_accident_file_photos_file on public.accident_file_photos(file_id, sort);

comment on table public.accident_file_photos is
  'Photos avant reparation d''un dossier accident : chemin GED, legende, horodatage, is_vin = photo du n° de chassis grave (une par dossier, obligatoire pour envoyer).';

-- Une seule photo « chassis » par dossier.
create unique index if not exists uq_accident_file_photos_vin
  on public.accident_file_photos(file_id) where is_vin;

drop trigger if exists trg_accident_file_photos_audit on public.accident_file_photos;
create trigger trg_accident_file_photos_audit after insert or update or delete on public.accident_file_photos
  for each row execute function public.audit_row();

alter table public.accident_file_photos enable row level security;
drop policy if exists accident_file_photos_select on public.accident_file_photos;
create policy accident_file_photos_select on public.accident_file_photos for select to authenticated
  using (public.is_member(company_id));
drop policy if exists accident_file_photos_write on public.accident_file_photos;
create policy accident_file_photos_write on public.accident_file_photos for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 3. Parametres : destinataire du dossier (Parametres → Tables → « Mail du dossier accident »)
--    code `to` = destinataire ; code `cc` = copie (aucune par defaut, decision du 03/11/2026).
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order)
select c.id, 'accident_file_mail', 'to', 'technique.dwe@ducati.com', 10
  from public.companies c
on conflict (company_id, table_key, code) do nothing;
