-- =====================================================================
-- M3 (Simon, 26/11/2026) : « on doit pouvoir voir les anciens contrats de leasing (un peu comme pour
-- les anciennes réf : on voit celle en cours et on voit les anciennes) ». VEH001
-- Historique des financements d'une moto : table vehicle_financings.
--   * en cours = la banque et le contrat de la fiche moto (vehicles.financing_contact_id /
--     financing_contract, inchangés) ;
--   * anciennes = les autres financements relus dans les factures G8 (avoirs déduits), clos à la
--     date de la revente suivante quand elle est connue.
-- Enregistrer une autre banque sur la fiche moto clôt l'ancien financement et ouvre le nouveau
-- (déclencheur sur vehicles) ; changer seulement le contrat corrige la ligne en cours.
-- Aucun propriétaire n'est modifié. Audit : audit_row comme les autres tables.
-- =====================================================================

-- 0) Crelan, citée sur une facture de 2015 (financement ancien), devient une fiche banque / leasing.
insert into public.contacts (company_id, type, company_name, last_name, country, origin, notes)
select '3d9f0f13-a691-4d07-ad58-34590df86e33', 'banque_leasing', 'CRELAN', 'CRELAN', 'BE', 'import_g8',
       'Créée le 26/11/2026 depuis les factures G8 (mention de financement).'
 where not exists (select 1 from public.contacts c where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
                     and upper(coalesce(c.company_name, c.last_name)) = 'CRELAN');

-- 1) Table
create table if not exists public.vehicle_financings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  financing_contact_id uuid references public.contacts(id) on delete set null,
  contract text,
  client_contact_id uuid references public.contacts(id) on delete set null,
  source_document_id uuid references public.documents(id) on delete set null,
  source_invoice text,
  started_on date,
  ended_on date,
  is_current boolean not null default false,
  origin text not null default 'fiche_moto' check (origin in ('facture_g8', 'fiche_moto')),
  created_at timestamptz not null default now(),
  constraint vehicle_financings_current_open check (not is_current or ended_on is null)
);
create unique index if not exists uq_vehicle_financings_current on public.vehicle_financings (vehicle_id) where is_current;
create index if not exists idx_vehicle_financings_vehicle on public.vehicle_financings (vehicle_id, started_on);
create index if not exists idx_vehicle_financings_bank on public.vehicle_financings (financing_contact_id);
create index if not exists idx_vehicle_financings_company on public.vehicle_financings (company_id);

comment on table public.vehicle_financings is
  'Historique des financements (banque / leasing, contrat) d''une moto. En cours = vehicles.financing_*. VEH001';

-- La société est celle de la moto ; banque, client et facture doivent être de la même société.
create or replace function public._vehicle_financing_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select v.company_id into new.company_id from public.vehicles v where v.id = new.vehicle_id;
  if new.company_id is null then raise exception 'Moto introuvable' using errcode = 'P0002'; end if;
  if new.financing_contact_id is not null and not exists (
       select 1 from public.contacts c where c.id = new.financing_contact_id and c.company_id = new.company_id) then
    raise exception 'La banque ou le leasing doit appartenir à la même société que la moto.' using errcode = '23514';
  end if;
  if new.client_contact_id is not null and not exists (
       select 1 from public.contacts c where c.id = new.client_contact_id and c.company_id = new.company_id) then
    raise exception 'Le client financé doit appartenir à la même société que la moto.' using errcode = '23514';
  end if;
  if new.source_document_id is not null and not exists (
       select 1 from public.documents d where d.id = new.source_document_id and d.company_id = new.company_id) then
    raise exception 'La facture doit appartenir à la même société que la moto.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public._vehicle_financing_company() from public, anon, authenticated;
drop trigger if exists trg_vehicle_financings_company on public.vehicle_financings;
create trigger trg_vehicle_financings_company
  before insert or update of vehicle_id, financing_contact_id, client_contact_id, source_document_id, company_id
  on public.vehicle_financings for each row execute function public._vehicle_financing_company();

drop trigger if exists trg_vehicle_financings_audit on public.vehicle_financings;
create trigger trg_vehicle_financings_audit after insert or update or delete on public.vehicle_financings
  for each row execute function public.audit_row();

alter table public.vehicle_financings enable row level security;
drop policy if exists vehicle_financings_select on public.vehicle_financings;
create policy vehicle_financings_select on public.vehicle_financings for select to authenticated
  using (public.is_member(company_id));
drop policy if exists vehicle_financings_write on public.vehicle_financings;
create policy vehicle_financings_write on public.vehicle_financings for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- 2) Financements relus dans les factures G8 (une facture refaite ou annulée par avoir ne compte qu'une fois).
create temporary table _vf (vin text, banque uuid, banque_nom text, contrat text, client uuid, doc uuid,
                            facture text, debut date, fin date, en_cours boolean);
insert into _vf (vin, banque, banque_nom, contrat, client, doc, facture, debut, fin, en_cours) values
  ('ML01V00AAPT001754', '7a3e77fb-b188-4ed8-8984-2306234b6fdb', 'EUROPABANK', null, '0cdd277f-a64f-4dba-a6f6-6d27de06c84b', '77596e9a-835a-4b4e-8d3c-1024aad12767', '25000136', '2025-02-20', null, true),
  ('ZDM1002BGSB001725', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '3b43c782-ad25-4857-805e-7a34afa8e261', 'd85b46be-efb4-49d2-af7f-ee6ec1205ef0', '25000218', '2025-03-13', null, true),
  ('ZDM1002BGSB003116', '3609c8fa-1779-4be0-b60e-f8e66b08fe64', 'ES FINANCE', 'A1D15984', '85b1fdaa-83ca-464f-91fe-9115fca1da1f', '4c578afe-6aaf-49d0-a3e6-cea995909233', '25000650', '2025-05-28', '2026-04-08', false),
  ('ZDM1003PPSB005735', '3609c8fa-1779-4be0-b60e-f8e66b08fe64', 'ES FINANCE', 'A1D25670', null, 'bca6edcd-a4e5-4339-9ff4-df2a7049c303', '25001550', '2025-12-02', null, true),
  ('ZDM1007BGTB007808', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150378730689', '57a12e6e-b54c-4746-9d20-2a838f8fff3b', '8a8d3545-9bf0-4663-bd89-f0765d855662', '26000103', '2026-02-12', null, true),
  ('ZDM1007BGTB008896', '3609c8fa-1779-4be0-b60e-f8e66b08fe64', 'ES FINANCE', 'A1D52077', '85b1fdaa-83ca-464f-91fe-9115fca1da1f', '3cec8483-9d99-4c06-a75c-65279145692e', '26000175', '2026-03-05', null, true),
  ('ZDM1007BGTB009109', '066a52c8-efce-4955-ad6f-864e220509ce', 'CBC BANQUE', null, '688201da-fc85-47b5-9637-5b85d5ddf28e', 'a7053632-5b96-4b0d-9ce0-3692821bd9df', '26000290', '2026-04-01', null, true),
  ('ZDM1007BGTB009110', '3d9eb412-9f5d-4e31-8561-baaa37b01cee', 'BELFIUS LEASE', '737556', null, 'de6e628b-2a51-4920-81a9-ffa31d0dd9fa', '26000257', '2026-03-24', null, true),
  ('ZDM1007BGTB009279', 'd95491e3-d4cc-44e4-98e2-831e4467d2f9', 'KBC BANK SA', '420716581443', null, 'dbf7bc91-0fa3-4bc9-a106-be9bd5943059', '26000547', '2026-05-15', null, true),
  ('ZDM1B00AARB005239', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', 'S/150367938532', '59e393c1-37a2-494a-8f23-cbe9eef274a9', '223cbf4b-77eb-4af9-88df-8b613d1f587c', '24001538', '2024-12-17', null, true),
  ('ZDM1B00AARB005278', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118107231726', '6b8cacfa-62fb-4947-9ff4-99689fd4ca2e', '4e7eb7a8-3458-440c-95c7-cba91c1b9e97', '24000144', '2024-02-21', null, true),
  ('ZDM1K00AANB002369', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150383695170', null, '1dfd9c34-f0b1-4820-bf54-122082c8440d', '26000157', '2026-02-25', null, true),
  ('ZDM1K00AAPB003439', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118097317619', '2f2dfaed-0e68-4437-bf83-47d145e0ea54', '8e7fcd4f-b34e-49b1-a12c-755cd88b837a', '23001336', '2023-11-21', null, true),
  ('ZDM1K00AASB004243', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', '971343-91-0', null, '41c1a29a-3d06-4705-93a6-a3f363d2d0e3', '25000116', '2025-02-14', null, true),
  ('ZDM1M00AAMB002306', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150374017503', null, '5b6de402-cf02-4a90-9fca-de4cd32a4486', '25000976', '2025-07-20', null, true),
  ('ZDM1V00AARB006028', '3d9eb412-9f5d-4e31-8561-baaa37b01cee', 'BELFIUS LEASE', null, '0f13b231-d25a-4a39-95ea-78d14fbffed4', 'a8755c72-949c-44e0-8fdc-0fc546a20b04', '23001340', '2023-11-21', null, true),
  ('ZDM1X00AASB011027', 'd95491e3-d4cc-44e4-98e2-831e4467d2f9', 'KBC BANK SA', '0001/00000266719', '524c22bb-4091-4299-96a0-5fe685dcc2c2', '28d421bd-fabc-4019-a157-44dae805bf4f', '24001245', '2024-09-25', null, true),
  ('ZDM1X00AASB011642', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118192269303', '786f7dcb-8805-4e0f-baf1-c68f2942327b', 'cc689193-39d3-4e9e-8837-15cc6b6ba5da', '26000293', '2026-04-01', null, true),
  ('ZDM1X02AASB010227', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118175042709', 'fcbfd943-72d7-40a3-9176-35f916d24d6c', '5603dbbb-ee04-455a-beab-cf2112b4205a', '25001511', '2025-11-20', null, true),
  ('ZDM2000AASB002135', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150375257887', null, 'bb958ed2-e402-4ead-a8c5-c464acfc814a', '25000824', '2025-06-26', null, true),
  ('ZDM2A02AARB009573', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118099446060', 'c5e4b05d-ceb8-4609-9044-be5d6a618865', '16fc1d2d-1e14-4059-b1b9-ddf8f93bee67', '24000162', '2024-02-24', null, true),
  ('ZDM3000AATB002068', '066a52c8-efce-4955-ad6f-864e220509ce', 'CBC BANQUE', '728275430023', null, 'a422d291-fac2-495a-8443-17ee842370e2', '25001434', '2025-10-28', null, true),
  ('ZDM3000AATB004451', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150386203228', null, '09c0397c-58b0-4049-a351-cd25fab211a1', '26000706', '2026-06-10', null, true),
  ('ZDM3D02BGPB003013', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118124003329', 'd0c90814-9666-4a22-858d-32ad5be62900', 'c935fce1-90be-4c49-92fc-6231c4e16a6a', '24000925', '2024-07-19', null, true),
  ('ZDM3D02BGRB008958', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118099876395', 'b3058c92-e4e3-41d7-b1db-6428fbb2f68e', '40a7a68a-05b7-4203-8218-62ee3c03a55b', '23001415', '2023-12-19', null, true),
  ('ZDM3D02BGRB009620', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118100192354', '9f427d16-edb1-48b8-921d-627fb46e0287', 'f751e39f-dde7-4f02-a3f5-c02785dfdff1', '24000277', '2024-03-21', null, true),
  ('ZDM3D06AARB007055', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150361119331', null, '204c0704-84ea-461e-ad8d-7b06cdaf4ab8', '25000151', '2025-02-22', null, true),
  ('ZDM3DFBBGRB011361', '7a3e77fb-b188-4ed8-8984-2306234b6fdb', 'EUROPABANK', 'EBL-8368585-901-44', null, '50c683d6-bafd-4eeb-8b06-f5fdf6f4cd02', '24001446', '2024-11-21', null, true),
  ('ZDM3F02BGRB007851', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150358381103', null, '027a2e7b-e41d-47a0-adbd-226fb5c92bc1', '24000304', '2024-03-27', null, true),
  ('ZDM3G02BGPB000941', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150360700312', '75058b5d-a25c-483d-b336-78832dc69ee2', '7226e1d8-5552-4dcc-bc9c-23045ee472ed', '24000719', '2024-06-13', null, true),
  ('ZDM3G02BGPB001477', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118115306772', 'd0193795-c059-478f-8863-7db58967af99', '1015d301-f1fb-4bfe-9135-cea48f38790d', '24000495', '2024-05-03', null, true),
  ('ZDM3G02BGRB002337', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118114135597', '97f2aac3-791c-4f13-8266-bd7e0ccd5b6e', 'b65278b6-184c-4bfe-ab93-8165de04674b', '24000486', '2024-05-02', null, true),
  ('ZDM3G02BGRB005023', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118119305192', 'f49e9dd6-e0e6-4bd8-8898-4cf7b8edfd28', '87e9629d-f143-4434-9d01-40f939f59e55', '24000715', '2024-06-12', null, true),
  ('ZDM3G02BGRB005473', '0c7d3ac9-79a0-44a1-98b5-a6006339b4b9', 'EXECUTIVE CAR LEASE & RENTING', '2024.32.10.5643', null, 'd05e4c92-96c7-434d-89c3-7ccf5c765ae0', '24001356', '2024-10-21', null, true),
  ('ZDM3G02BGRB005628', '31d07e88-99bb-4cb5-9a27-3d22b9d9db77', 'CA AUTO BANK', '350697', null, 'efb03bc3-f938-4404-97fd-08ea2ab6f3f7', '24001545', '2024-12-18', null, true),
  ('ZDM3H00AASB001450', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118136143382', '5f5340aa-f534-42f4-a537-49a8e10a2efd', '00578311-99ac-4f33-a436-c09a86cf991b', '25000472', '2025-04-29', null, true),
  ('ZDM3H00AASB001568', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150368978452', null, 'b7e89fd9-0775-446e-95b0-6862fdca3b92', '25000446', '2025-04-25', null, true),
  ('ZDM3H00AATB003265', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150374496641', '8f4dbc0e-7d3e-44ba-b991-1d48a6e5ee46', '1dd5cb9d-8b9e-4142-9973-bfbc708c87e8', '25000952', '2025-07-16', null, true),
  ('ZDM3H00AATB004387', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150376698440', 'bcc29976-3431-4f77-952b-431637a39ea8', 'd60c4ce2-0e6e-4a7f-b696-b595b7464a1b', '25001138', '2025-08-21', null, true),
  ('ZDM3H00AATB004664', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150387887186', null, '95b30666-50f4-4bdb-9214-316151fb43b4', '26000682', '2026-06-06', null, true),
  ('ZDM4B00AARB001216', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118108187578', '2665a064-b211-4da5-a2a7-22aefad0369f', '689b6ec4-9b18-4ea2-a13a-0a114f6ebf2f', '24000303', '2024-03-27', null, true),
  ('ZDM4B00AARB003200', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118123210252', 'ffcec848-d3ee-437b-933e-a75648f4cd9f', '2aa9ab27-ba02-41c5-a77e-cda26a5c340e', '24000958', '2024-07-26', '2026-01-16', false),
  ('ZDM4F00AAPB002089', '3d9eb412-9f5d-4e31-8561-baaa37b01cee', 'BELFIUS LEASE', '619586', null, '854f85a8-f62e-4b03-a0f6-369a5e25a243', '23001323', '2023-11-15', null, true),
  ('ZDM4F00AAPB002430', '7a3e77fb-b188-4ed8-8984-2306234b6fdb', 'EUROPABANK', 'EBL-8368581-901-21', null, 'b884ec7c-4d26-4c3e-bec6-c1cf88bbc9e9', '23001268', '2023-10-26', null, true),
  ('ZDM4F02BGRB002683', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', 'S/150350662832', '98a5196f-5348-4034-83bc-e56e7a016b40', '02371b28-ed39-496c-9df3-a903bede27da', '23001178', '2023-10-06', null, true),
  ('ZDM4F02BGRB003250', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118099435653', '88f5d6ba-f1c1-41cc-a963-a10aab36acbc', '0b4728c4-6d6b-4745-a3f1-7ca48dea7bad', '23001394', '2023-12-11', null, true),
  ('ZDM4F02BGRB003305', '7a3e77fb-b188-4ed8-8984-2306234b6fdb', 'EUROPABANK', 'EBL-7060581-901-13', null, '11066448-ee1b-488f-86a2-880aaf39841e', '25000708', '2025-06-07', null, true),
  ('ZDM4M00AARB007547', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118080633619', '189e1596-b392-4ea7-b34d-0f5b3caf20dc', '857bb6ac-5f92-42ab-bb37-c1c730b65152', '23001005', '2023-08-25', null, true),
  ('ZDM4M00AARB010096', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118129495650', '0151ed70-4361-489b-b7e5-ea8ff6f023ec', '2ce3a27e-a58d-479e-ba64-9a3697b830a3', '24001188', '2024-09-13', null, true),
  ('ZDM4M00AASB011623', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118126950816', 'dc8c658b-e7e7-4079-b01d-49cc90870533', 'aa740e8e-51f9-454e-9a2f-033176401a92', '24001060', '2024-08-21', null, true),
  ('ZDM5000AATB001004', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118187357766', 'c3753353-5d34-431e-b8ab-4e6379c998ba', '1c737e31-9b9f-4809-b932-c9176655c870', '26000289', '2026-03-31', null, true),
  ('ZDM5D02BGSB001159', '31d07e88-99bb-4cb5-9a27-3d22b9d9db77', 'CA AUTO BANK', '2028302', null, '7f31f3c4-bd69-4265-b9b4-66f8ac5b1445', '25000561', '2025-05-13', null, true),
  ('ZDM5G01BGSB000619', '3609c8fa-1779-4be0-b60e-f8e66b08fe64', 'ES FINANCE', 'A1D5279', null, '4aff3ce5-7fac-4564-98c1-574dd3a25f4d', '26000246', '2026-03-21', null, true),
  ('ZDM5H35AATB000311', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118169419335', '67fd94ba-59fd-458b-a4e6-ac9c3dd49dbe', 'b045fda2-6a5c-41ce-863c-95f0db19f5be', '25001331', '2025-09-30', null, true),
  ('ZDM6A02BGNB002534', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118100960775', '04681f68-589f-4f6d-93db-2cb9f456dea1', '5bb2bb37-f30a-4960-8d07-a40126bbdf5b', '23001416', '2023-12-19', null, true),
  ('ZDM6A02BGPB015094', '9b229574-9e2b-47e4-bae4-954e5710868a', 'VAN BREDA', '1941104/009', '38f456c2-a3b9-423e-a8e2-b39f2b6e2b8c', 'b1c3d564-f682-4aa0-a9b4-eb557472c2bf', '24000492', '2024-05-02', null, true),
  ('ZDM6A02BGRB016988', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118105870490', '4d0a7b80-3d06-430c-b51d-9c1665c551e2', '3831da0d-9fb7-4ca5-9239-d0ad9e54bcc3', '24000092', '2024-02-08', null, true),
  ('ZDM6A02BGRB018684', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118110145261', 'fbe56cdd-76ce-4af2-a995-37f8f75cf117', 'e3058399-f75e-470c-9dde-0c8121f3cd4c', '24000294', '2024-03-23', null, true),
  ('ZDM6A03BGRB017506', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118102584416', '3479cd6a-9bf7-4ade-a031-e99c819c3e00', 'd43b083f-f6f1-4e64-8abd-d70e086e6d2f', '24000102', '2024-02-10', null, true),
  ('ZDM6A03BGRB017859', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118095880197', '47cd3a51-a79e-44c4-8366-a8b0a05177eb', '02afd6c2-2b2a-44ed-9ce7-8838f14386ee', '24000245', '2024-03-15', null, true),
  ('ZDM6A03BGRB018714', '3d9eb412-9f5d-4e31-8561-baaa37b01cee', 'BELFIUS LEASE', '621826', '73dd0b24-faf1-439c-831e-6a1b513827bb', 'e64633f9-227c-4a9c-a77f-c30c9e0f6e68', '24000172', '2024-02-29', null, true),
  ('ZDM6A05BGRB017215', '3609c8fa-1779-4be0-b60e-f8e66b08fe64', 'ES FINANCE', 'A1C70042', null, 'afc5e902-0b8f-4966-b969-d7a21fac6210', '24000319', '2024-03-28', null, true),
  ('ZDM6A05BGRB019720', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', '971360-37-0', null, 'ca5011cc-24b2-4196-b2c2-df6d34d78dfc', '25000401', '2025-04-17', null, true),
  ('ZDM7F02BGSB001418', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150378714020', 'e705defd-375a-4634-8e6e-94ed715690ca', 'fc204cf7-fc6a-4c8c-bdaf-3aa337c27888', '26000201', '2026-03-13', null, true),
  ('ZDM7G02BGTB001360', '3d9eb412-9f5d-4e31-8561-baaa37b01cee', 'BELFIUS LEASE', '735596', 'f7ac67de-a0c7-4ef0-8c87-5f4813ef7e06', 'a8356c1e-0f45-4aff-929c-17a3f23aba79', '25000987', '2025-07-23', null, true),
  ('ZDM7K00AARB004802', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150363086916', null, 'f71c98bd-f7a3-4e27-9386-cea196f73afe', '24000891', '2024-07-12', null, true),
  ('ZDM8A01BGSB002040', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', 'S/150384104186', null, '80721ace-d177-4242-a41b-8ed3cda3aa2d', '26000149', '2026-02-24', null, true),
  ('ZDMA201ACAB000754', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '7461f8c8-4331-493b-baaf-18aaf270fe26', '89a9e4e7-77d6-45d4-8e7c-7d9057766410', '20140125', '2014-03-04', null, true),
  ('ZDMA201ACCB021169', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '27453ec3-c26f-4071-aee2-a7a969a7bf39', 'bd316337-3908-48cf-9be1-c29e2ee35276', '20160809', '2016-08-03', null, true),
  ('ZDMA301FADB002677', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '27f1c029-1917-4f5e-ab31-307099d1277a', '9516bf3f-efef-4682-a893-8259c806fb28', '20140029', '2014-01-23', '2016-07-14', false),
  ('ZDMA301FADB002895', '258b47db-7697-4892-b33b-60aa347deeb1', 'CITIBANK', null, '77b39bec-081d-4197-a8c7-9fbaeb37f424', 'd3a17022-8910-4be6-9892-e573b14d0076', '2013085', '2013-03-05', null, true),
  ('ZDMA301FADB002910', '258b47db-7697-4892-b33b-60aa347deeb1', 'CITIBANK', null, '7b034e8c-6228-428e-a89b-9522bd7c2e56', 'd7b8ae28-6374-45e9-bc6d-a066a7a2953e', '2013083', '2013-03-05', null, true),
  ('ZDMA301FADB002928', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'a301655f-7551-49b1-a46c-d7b3ba1bb0b1', '3eaf7a93-8bfe-4e87-8fb1-d5dc85029ab1', '2013091', '2013-03-07', null, false),
  ('ZDMA301FADB005654', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '7175f3e4-7d4b-4455-83d5-78eaeb069863', 'ce396ba2-cd3c-470f-85c5-2f49e8cebd2b', '2013497', '2013-06-12', null, false),
  ('ZDMA301FAEB009755', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '2c72354d-b013-4a05-9a76-492fdcb803fb', 'b98acda7-ae8f-42ae-a76e-46fd15f5b358', '20140482', '2014-05-24', null, false),
  ('ZDMAA01FAFB001293', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '07c4b850-0213-4579-8cf3-90b574e3b7ce', '74ee3f59-3a9a-41ba-be2e-32cf418e62ad', '20190649', '2019-07-10', null, true),
  ('ZDMAA01FAFB001836', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '1e548f1e-c62a-4e5c-872d-dd2ea87c56cc', 'dfa7692f-2002-418d-b075-2323d21531bf', '20150392', '2015-04-29', null, true),
  ('ZDMAA01FAFB001837', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '1a4f01f5-2286-4cdb-b400-1a81bc39a73b', '1959d094-bbbb-4042-8f93-0d79a539a73c', '20150404', '2015-05-02', null, false),
  ('ZDMAA01FAFB002386', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '3df11195-4a29-4de6-9c35-dcd0f1b4cb98', '99dafbbe-0b32-4ee6-aab3-ebca75c509cf', '20150587', '2015-06-04', null, true),
  ('ZDMAA01FAFB002524', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', null, null, 'c788bf86-1c8a-47b6-8c9d-0e904ad8ad05', '20150426', '2015-05-06', null, true),
  ('ZDMAA01FAFB002622', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, null, 'ca6c4954-9f6a-4db0-9c77-b2bf8c9515fd', '20160114', '2016-02-27', '2019-07-09', false),
  ('ZDMAA01FAFB004458', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '4da03e7d-16cf-4636-b157-47c283cbc0c9', '1077e839-bb17-45e6-8b8f-985b345c0ca1', '20150987', '2015-09-10', null, true),
  ('ZDMAA01FAGB006209', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'b5fa29b0-d1c9-498a-9f05-dc834d99990d', '280a3ae6-7752-4475-b609-53ead5aaedf0', '20150972', '2015-09-05', null, false),
  ('ZDMAA01FAGB007787', '066a52c8-efce-4955-ad6f-864e220509ce', 'CBC BANQUE', null, '44cb89b4-29cd-4061-af96-9bbe2b18a682', '285a6601-9806-420d-83d2-b26d38baafa7', '20160461', '2016-05-19', null, true),
  ('ZDMAA01FAGB010128', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'ab84429a-3ee3-4bbe-8cda-15625229921d', '0230b4a1-7d13-4f8c-acb0-80ba6d3b0fd0', '20160733', '2016-07-16', null, true),
  ('ZDMAA01FAGB011750', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '074616b9-4ab7-482d-a90a-42e7632b3e09', '875e1455-d46a-43f4-ba7d-073df1d06a48', '20160776', '2016-07-28', null, true),
  ('ZDMAA01FAGB011804', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, null, 'cbc6efe5-3206-4371-baa1-baab2e70d8fc', '20160254', '2016-04-07', null, false),
  ('ZDMAA01FAGB013595', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '412364fe-d79e-4042-b219-9e0e6397ec14', '3e93c3b2-8386-4b24-80eb-c0dcbad4a03f', '20160437', '2016-05-13', null, true),
  ('ZDMAA01FAHB024223', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', '970557-38-0', null, '1ded40ba-a277-48a1-b3c9-958f9b81c4c5', '20170620', '2017-06-20', null, true),
  ('ZDMAA01FAHB025364', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', null, null, '373fa59f-57f5-4b51-8e90-f94423d03a34', '20181191', '2018-12-18', null, true),
  ('ZDMAA05AAHB018369', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '7f0a9881-6a7a-4ee4-8253-589b70a535c4', '691ed6c9-55a9-4c1f-9b90-f37d0621f91b', '20180037', '2018-01-30', null, false),
  ('ZDMAA05AAHB020819', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, null, '24c188c8-458b-4f5c-aea1-3b8f298a7c24', '20170283', '2017-04-14', null, true),
  ('ZDMAB00FAGB000055', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '27f1c029-1917-4f5e-ab31-307099d1277a', 'fa570235-1631-4e15-8ef4-84a9e1029d3a', '20160430', '2016-05-12', null, true),
  ('ZDMAB00FAGB000057', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '448dc4b5-930e-42d0-9dc1-cc611b4bd836', '1c88a81e-b71f-4ac5-bb29-af7c137f44dd', '20160435', '2016-05-13', null, true),
  ('ZDMAC02FAJB004517', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'c7b7e276-46f3-4a79-96e6-4c8f17a0b098', 'aa7ebcc3-95a9-4fd3-856c-bab32f3aad27', '20180506', '2018-06-09', null, false),
  ('ZDMAC02FAJB004796', '066a52c8-efce-4955-ad6f-864e220509ce', 'CBC BANQUE', null, null, 'ffe598e3-59c5-4e98-be9c-cf4c5f2e42e5', '20190234', '2019-04-05', null, true),
  ('ZDMAC02FAKB006348', '7a3e77fb-b188-4ed8-8984-2306234b6fdb', 'EUROPABANK', null, null, 'a3f364a2-1f5f-408b-8b9e-80644955d8b6', '20180949', '2018-09-21', null, true),
  ('ZDMAC02FAKB006976', '9b229574-9e2b-47e4-bae4-954e5710868a', 'VAN BREDA', null, '4d331f3a-42f2-4abf-9dd4-b4e784858d9b', '96377e9b-fc81-4e9a-bc19-d928abfc2918', '20190170', '2019-03-19', null, true),
  ('ZDMAC02FAKB009497', '7c849a8c-1e29-4572-bea4-9ac5165e89ca', 'BNP PARIBAS LEASE', null, null, '6b147c45-9947-44d8-bcbe-9d3474ab0a04', '20190427', '2019-05-25', null, true),
  ('ZDMB200AADB006124', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '27b392b0-3045-42af-9faf-30bcfc1d02aa', 'ef35348d-4896-4f13-a665-93f7b31444bd', '20140927', '2014-09-17', null, true),
  ('ZDMB200AAEB007886', '3d9eb412-9f5d-4e31-8561-baaa37b01cee', 'BELFIUS LEASE', '574461', null, 'f2bab45e-da2b-4965-8310-e287c0190552', '20150507', '2015-05-21', null, true),
  ('ZDMB200AAEB007983', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '7a2dc555-4c18-4b71-be60-e8736fcb4455', 'ec388371-4ae4-47ec-948a-a1b9fed766fd', '20150461', '2015-05-12', null, true),
  ('ZDMB200AAFB011129', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'e13444c7-88b5-463a-90e6-0ac62324f5af', '12de6869-40c0-4987-8250-e859fcffc8d9', '20150911', '2015-08-20', null, true),
  ('ZDMB200AAFB011957', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '5b1fbd7d-666f-471f-919f-9a6a7f89e7bb', '95566c36-6084-4bf2-a96b-6514415e8877', '20150845', '2015-07-30', null, true),
  ('ZDMB300FADB000451', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '7eb51c4e-95e1-441b-820e-846bb349b91d', 'a927944f-128e-40e2-b2b4-08c4d3c0ef70', '20150024', '2015-01-22', null, true),
  ('ZDMB300FADB000583', '066a52c8-efce-4955-ad6f-864e220509ce', 'CBC BANQUE', null, '0bdb8a0c-f12c-4df2-8a10-a316f7d46f7a', '86c9a5fa-cab4-4bb4-87d9-871fd2aff867', '2013777', '2013-08-08', null, true),
  ('ZDMBA00AAGB000643', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '30f5a368-7b34-4c48-ba6b-c9140577b189', '69183601-9797-46d5-aeef-f2b95b68801b', '20160190', '2016-03-19', null, true),
  ('ZDMBA00AAGB001795', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'd4db1984-b5d3-4cc8-ba93-a8e90f231c29', '5638579b-9986-46e2-996e-3d304807bba8', '20170401', '2017-05-09', null, true),
  ('ZDMBA00AAHB002606', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, null, 'ee3abe4a-ad51-443f-86b9-5935bf331d71', '20170505', '2017-05-27', null, true),
  ('ZDMBA00AAJB004454', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '48506027-e717-4e0c-a544-16a70e7a8f49', '62b063c4-5799-452f-b10d-dcc372315304', '20181099', '2018-11-10', null, true),
  ('ZDMBB00AAKB003270', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '9a0cbd94-b0f6-4025-b4c4-8e6291b826c7', 'dce2f887-a433-4071-953d-785bce56bd16', '20190963', '2019-10-01', null, true),
  ('ZDMBB00AALB005718', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '150386621742', null, 'f61cbcf0-aabb-47c8-8e3d-bfe18b673121', '26000494', '2026-05-07', null, true),
  ('ZDMDB00FAKB000086', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', null, null, 'e2174638-d645-4c33-a3de-dc8822d07907', '20190078', '2019-02-19', null, true),
  ('ZDMDB00FAKB000102', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '784b7b96-96c1-494e-b134-35b0fd9a348a', '7f78f638-9e3a-4fad-aa52-10380d756280', '20190114', '2019-03-02', null, true),
  ('ZDMDB00FAKB000104', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '44328233-a79d-4e0d-b638-6e90a48bef2f', '5533d0e2-08e3-4060-a9c7-f6e2e7bc94c2', '20190477', '2019-06-08', null, true),
  ('ZDMDB01FAKB000068', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118-1764465-79', '991d715e-e14e-47e6-915f-673466c0a45b', '58f4a21b-2800-4479-a9b7-fe7e0c31306f', '25001514', '2025-11-20', null, true),
  ('ZDMF101AADB014657', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '328c2bbe-8393-44b3-add9-68cd8ff36cd0', '6a106202-3e12-405b-80c7-373640bcbf54', '20150450', '2015-05-09', null, true),
  ('ZDMG101ABCB011427', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '6fcedbb2-fdbd-4130-8c39-9f4479aa1c68', '255d339f-2193-46ee-869d-55c5c97f0068', '2013282', '2013-04-30', null, true),
  ('ZDMG101ABDB016518', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'b21f9346-241b-4150-9d68-e5dc88655d4a', '5a831d03-b4a1-423d-8637-d2eb1a391571', '2013279', '2013-04-30', null, true),
  ('ZDMG101ACDB017314', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '9ae18cc4-0231-4e4d-bdf5-4c6dbddb66a0', '6d1cc2e2-81af-4524-8490-eb4a6bed6e28', '20140105', '2014-02-25', '2017-03-29', false),
  ('ZDMG104FAEB019898', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '81115c2a-a836-4973-b3e2-8965c29d53be', '9c20a2fb-4c5f-4405-b642-4cf61ed66726', '20150387', '2015-04-28', null, true),
  ('ZDMG104FAEB022069', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '28463022-f562-4e0e-9150-b10a58954827', '36cb9715-1a29-4e31-8e9c-e50a08f93027', '20160146', '2016-03-08', null, true),
  ('ZDMGB00FAGB000018', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '229c4894-4ae6-4bd9-80d9-0a3e4d656a3d', '8f72af2f-c935-4606-a741-5a0c58b289db', '20160193', '2016-03-19', null, true),
  ('ZDMGB00FAGB000021', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '0fc89d82-5607-4d25-92e9-8735f37d2ca2', 'e773e4ff-59ab-4246-90dd-e7d161e9fc27', '20160167', '2016-03-12', null, true),
  ('ZDMGB00FAGB000041', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '6da0538e-c5b4-490a-bfd1-e106eb5edc1d', '4e0c51e5-0a6b-438c-97a8-f23b43ccc119', '20161229', '2016-12-20', null, true),
  ('ZDMGB00FAGB000046', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '908ba0b0-94f6-4aa1-94a6-c6d339e17e81', '63643aa8-7b0b-4629-b20d-8ebd0b7b1b62', '20160348', '2016-04-26', null, true),
  ('ZDMGB00FAGB000092', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'ffd3ffa1-2f06-432e-8d58-26fad76d0ca7', '75dbb6b3-b499-4773-a322-7e9c4678451e', '20180043', '2018-02-01', null, true),
  ('ZDMGD00FAHB000001', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'c943770f-af03-4189-be5d-b327e55fbae4', 'd2470133-a53b-4622-99b9-1f66f9c2b448', '20170416', '2017-05-11', null, true),
  ('ZDMGE02FAKB001357', '066a52c8-efce-4955-ad6f-864e220509ce', 'CBC BANQUE', null, null, 'a75ec6c6-0e2f-4108-ac0c-3619eb8a3e05', '20190674', '2019-07-13', null, true),
  ('ZDMGE02FAKB001385', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'f7b7b6b4-63f2-456a-a249-8df5e731b154', 'b6570784-78e5-4ff1-a81b-e6032da692dc', '20190292', '2019-04-19', null, true),
  ('ZDMGE02FALB003150', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'ace3bb5b-4912-4ac4-813d-9e4dc3b944f3', 'd3e6f91c-fc7e-4acf-8490-04983bf14ff0', '20190815', '2019-08-24', null, true),
  ('ZDMH603AABB015654', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'ecc8cf91-5a34-4851-8a5c-ab60de8b08c6', 'cfba4c69-ba34-4705-a80b-006ab2ee6fae', '20160075', '2016-02-16', null, true),
  ('ZDMH603AABB017865', null, 'CRELAN', null, '2c72354d-b013-4a05-9a76-492fdcb803fb', '976a37a0-5bb6-4110-9dd5-c90d8aa4ca3a', '20150224', '2015-03-26', null, false),
  ('ZDMH801ABCB010482', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, null, '1e0f2ce4-8baf-4c97-a6d7-f061b8295658', '20140582', '2014-06-17', null, true),
  ('ZDMH801ABDB013079', '066a52c8-efce-4955-ad6f-864e220509ce', 'CBC BANQUE', null, null, '8322057c-59ca-42c2-94ca-a48cff7e8a27', '20140856', '2014-08-26', null, false),
  ('ZDMH804FAEB018590', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'af5ab220-519a-4271-89e9-644a6e3c2ad4', '08819e17-e800-4084-8e43-5a46dfeb3710', '20140126', '2014-03-04', null, true),
  ('ZDMH804FAEB020015', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'a3673c9b-7865-47e1-b411-5eb52424f73e', '55e2c951-f97e-4b9b-b2ed-ceae2bbb4d3f', '20140239', '2014-04-02', null, true),
  ('ZDMH804FAEB021066', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '6042b244-4f32-4dfe-a3e8-7ad804b7efd3', '5c87c9c4-92c4-4a8e-8ff2-b4b4dcdf98d4', '20140762', '2014-07-31', '2017-09-12', false),
  ('ZDMH804FAFB026243', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '27f9bbb2-7f84-48b7-8b44-0298bdb38a09', '3d6ffd0d-3f80-46a5-8244-e9e2f627c330', '20150856', '2015-08-01', null, true),
  ('ZDMH804FAFB027035', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'f4855f3f-d413-4ad8-9146-6ff2f35f6145', 'c9d0d4de-5fe5-4a7b-80ae-2c19ca08e043', '20150908', '2015-08-20', null, true),
  ('ZDMH804FAFB027292', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '706381fc-b64e-42c3-bf57-1d4ad0f1cd69', '5480c189-324d-4423-9863-8cbeccecd2b5', '20151205', '2015-11-20', null, true),
  ('ZDMH904FAGB006409', '2ce76edc-569b-4b37-8ac6-904d95a5ee71', 'KBC LEASE BELGIUM', null, null, '5b054ff4-3774-4e0d-b733-4e3883ec1417', '20160671', '2016-07-02', null, true),
  ('ZDMH904FAGB007116', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '0e939ab9-ed35-4ab0-8c9a-22f5916841d6', '03a8ace1-999b-445f-baf1-30594a276576', '20161019', '2016-09-28', null, false),
  ('ZDMHB00FAGB000009', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'af6a177b-3bc4-4dfc-9559-05b5568ef03e', '16d20e80-c06b-49a9-a711-77bfce4000a3', '20160917', '2016-09-01', null, true),
  ('ZDMHB00FAGB000023', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '784b7b96-96c1-494e-b134-35b0fd9a348a', '95ac237c-f23e-4009-8783-4986e5f7671c', '20160525', '2016-06-04', '2018-02-03', false),
  ('ZDMHB00FAGB000047', '3609c8fa-1779-4be0-b60e-f8e66b08fe64', 'ES FINANCE', 'Y0026145', null, 'f6f2f745-18e4-43a9-bebe-067e8e04841b', '20161130', '2016-11-04', null, true),
  ('ZDMHB00FAJB000077', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', null, null, '0e842f41-2ded-4851-864b-09df7a235d25', '20180523', '2018-06-09', null, true),
  ('ZDMHB00FAKB000102', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'bcc397c0-56f6-4930-94cc-cd5784147eb8', '405fec26-711d-4b85-958f-ef13aa8c3bfc', '20190501', '2019-06-15', null, true),
  ('ZDMHB00FAKB000106', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '786a1165-3a0c-481a-befb-b709bf65cb49', '2f116237-86ad-492e-955b-22c5b6107b02', '20190333', '2019-04-30', null, true),
  ('ZDMHD01FAJB000149', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', '970638-01-0', null, 'e05c7e9b-0aae-4059-96d6-c1362ab5efa7', '20180325', '2018-05-03', null, true),
  ('ZDMK100AAEB000211', 'd2fc0b85-5151-4526-9264-094dd48ed284', 'RECORD BANK', null, '95fed792-06ea-423d-9a21-017f8c314170', 'dc0e3ee4-cbf1-48bc-9f9d-a668f5091546', '20160814', '2016-08-05', null, true),
  ('ZDMK100AAFB000590', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'e28ad906-3da3-451b-9878-0744c554da83', '1e2d1a72-e8c4-4113-9c69-cefb4c009717', '20150056', '2015-02-07', '2017-09-01', false),
  ('ZDMK100AAFB003986', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'bf0f8f16-61fe-45ad-9c93-f8bb866f1f5e', '02659876-d269-4fd8-bf04-2779740b7616', '20150311', '2015-04-15', null, true),
  ('ZDMK100AAFB004232', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'd8068c56-f7ef-4bbc-8b82-908aaafb0404', '32426647-15bd-4ec0-84ce-123ee3ba0aec', '20150348', '2015-04-22', null, true),
  ('ZDMK100AAFB006063', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '2b4b1fc1-0a43-4dcc-b6e5-cdc86d376a97', '014c2366-c19b-4816-98c1-2a73d7f4f1ba', '20150599', '2015-06-06', null, false),
  ('ZDMK100AAFB006631', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'aafa1ed1-eba4-4545-939f-5d4f6790489c', '1e2c86e2-0c2f-4481-8c0b-3c31e3432fc4', '20150827', '2015-07-25', null, true),
  ('ZDMK100AAFB008475', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '674832f2-7b28-4375-b4c3-36132e01f526', '02992281-f106-4203-8af0-485ed5e5f41a', '20151004', '2015-09-16', null, false),
  ('ZDMK100AAGB012707', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'c592c1bb-f91f-4eca-b96c-041d7dac67c0', '8540f7fd-a444-40dd-98ad-58b0a36772a0', '20160144', '2016-03-08', null, true),
  ('ZDMK100AAGB013017', '6d7f2556-ca56-49b7-8926-3a9bfaad3dc9', 'KEN LEASE', null, null, '986450f1-1514-48f3-a3fe-ceb714c19e8d', '20170253', '2017-04-07', null, true),
  ('ZDMK100AAGB015294', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '5797059d-0aca-4872-949e-9cd1bf4f4e79', '23fa47b8-9d22-40a7-8a50-40eeda03799a', '20160387', '2016-05-04', null, true),
  ('ZDMK100AAGB016008', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '62009235-8549-4e1a-85cb-067afc1062d7', 'ed2f9758-7aaf-4937-8b6b-c9d2240ca14c', '20160346', '2016-04-26', null, true),
  ('ZDMK100AAGB016555', 'f15f1990-b010-44e1-bf69-48bee60e7a56', 'AB LEASE', null, null, '1039008f-7f58-4560-b204-d084f41ffeba', '20160451', '2016-05-17', null, true),
  ('ZDMK100AAGB016572', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '55e48db6-2933-4f87-8007-6e700ccff3ce', '7902acf4-fa20-4cc4-8ed4-8b8879128463', '20160460', '2016-05-19', null, true),
  ('ZDMK100AAGB017652', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '5bee1f3c-93a5-40c0-870c-e703132b20f8', '84cbc1ca-5b2d-44cf-8343-d84a0b6f85ab', '20161071', '2016-10-13', null, true),
  ('ZDMK102AAFB001864', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '8cbc5eeb-affd-4c6f-9497-1de11accaab4', 'd29206b7-8823-4143-b8ab-54cf0064406f', '20150575', '2015-06-02', '2017-11-04', false),
  ('ZDMKA00AAGB000965', '6d7f2556-ca56-49b7-8926-3a9bfaad3dc9', 'KEN LEASE', null, null, '7661c2d1-c36d-41eb-ae27-c72e3277d431', '20170484', '2017-05-24', null, true),
  ('ZDMKB00AAHB000790', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, null, 'c32b4335-31c0-447b-8c9c-6149c7d64fb3', '20170465', '2017-05-20', null, true),
  ('ZDMKC00AAJB004439', '71d114fa-e0a5-4bea-a652-283b5d7d82f6', 'KBC BANK', null, null, 'ca3beddd-3efd-469c-b094-11bd74f5b886', '20170909', '2017-08-24', null, true),
  ('ZDMKC00AAJB006800', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', null, null, '232242a6-e817-4bb8-824c-150ff1d9ff02', '20180560', '2018-06-20', null, true),
  ('ZDMKC00AAJB007348', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'd34508ad-ffca-4e8f-86ec-40cf65c0e9fc', '1e152394-c945-4b80-a19e-e97e1866ef21', '20180227', '2018-04-13', null, true),
  ('ZDMKC00AAJB007753', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '9655de33-d30a-49d2-948f-84db94ba93fa', 'adee4f72-5c69-443c-b346-c7848d2e8177', '20180342', '2018-05-05', null, true),
  ('ZDMKC00AAJB008719', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '319fbce4-3c36-411d-b7aa-17104b8e8f20', 'a37b9d49-bac6-4619-8da5-106942e1dba2', '20180642', '2018-07-06', null, true),
  ('ZDMKC02AAHB001507', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '9da2f3ff-9cf9-406b-83d7-5b4016ba0b50', 'f6b33740-b9c3-4092-a30a-011990b0eafe', '20170262', '2017-04-08', null, true),
  ('ZDMKC02AAHB001882', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '42645d86-7b52-47e2-939c-fd2105d9d206', '44a23fd1-fa39-480d-9f5f-9136a110fa96', '20171050', '2017-10-04', null, true),
  ('ZDMKC02AAHB002540', '71d114fa-e0a5-4bea-a652-283b5d7d82f6', 'KBC BANK', null, null, '299792b2-bb64-4c4d-b00c-1ff33b492078', '20170872', '2017-08-17', null, true),
  ('ZDMKC06AAKB010694', 'f15f1990-b010-44e1-bf69-48bee60e7a56', 'AB LEASE', null, null, '783510b6-41f8-4d8d-8778-61c68a0f2711', '20190894', '2019-09-11', null, true),
  ('ZDMKF00AAJB001000', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, null, 'f505eb68-4099-4130-b764-9a4e19c3e46e', '20180272', '2018-04-20', null, true),
  ('ZDMKF00AAJB001064', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '20b7d269-7994-442f-ab43-361411d9e727', 'fb47f3c5-6f2e-4f7c-bcba-f96d44e0c897', '20180529', '2018-06-12', null, true),
  ('ZDMM400AA2B025287', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '27f9bbb2-7f84-48b7-8b44-0298bdb38a09', '81b1f1e3-7aaf-4599-a786-0675416491cb', '20140042', '2014-01-30', null, true),
  ('ZDMM502AA9B020011', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'f0b250f3-a316-423a-8f48-0c8f837f0c3b', '1ce6e014-dfda-46ce-8686-8873474bbe5c', '2013054', '2013-02-19', null, true),
  ('ZDMM503AAAB033770', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '5a2a0ad8-bffd-441e-85bd-45769d2157a7', 'febb2ccc-124e-4304-af3b-b6745e39c200', '2013988', '2013-10-05', null, true),
  ('ZDMM503AAAB036526', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'c57059b7-3bbf-489b-9a43-93a386e51f79', '1335fec1-1146-4056-815b-998573eacddc', '20140184', '2014-03-19', null, true),
  ('ZDMM503AADB070973', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '233de2cd-901c-4eea-94f1-fc7dc548a4a3', '2b90002a-436f-467d-8525-b06cb6af0f2d', '20140263', '2014-04-05', null, true),
  ('ZDMM503AAEB079047', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '7420b69d-826b-4f0f-963d-cf8b95fa63fa', 'e4cf2b07-16c0-404f-8c1b-615ac47338de', '20140688', '2014-07-12', null, true),
  ('ZDMM506ABCB065398', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '8e513874-2583-4311-b049-19e631264aa1', '185b5207-9e86-4178-9f68-0c8acc34c579', '2013990', '2013-10-05', null, true),
  ('ZDMM506ABDB067907', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '189e1596-b392-4ea7-b34d-0f5b3caf20dc', 'fc89254c-1da6-4a19-b4ea-48f443c3b374', '2013989', '2013-10-05', null, true),
  ('ZDMM506ABDB068047', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '8eb95cb3-8545-4d02-94b3-7f16f0f073a2', '8475e290-ae91-4649-8057-8db391516010', '2013329', '2013-05-10', null, true),
  ('ZDMM506ABDB075164', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '227f1781-da27-43b5-9415-3e9ce6a29167', '17872a79-c2c6-46c8-9f35-cac49babaaa9', '20140240', '2014-04-03', null, true),
  ('ZDMM506ABDB075499', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '894fb07b-e2ce-4b02-be79-42523e63ccdd', '95d24003-57f9-47c2-b49d-f6d82f37f422', '20140177', '2014-03-18', null, true),
  ('ZDMM506ABEB075893', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '46a8f6b1-43b8-4859-b00b-7968a6f45ace', 'a69e3647-3f5f-4658-a2b5-2d3a6598dc50', '20140329', '2014-04-19', null, true),
  ('ZDMM511AACB063507', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'f3ff003a-84c7-44d9-87cd-24e7d9740559', 'd2145752-2e6b-4f80-81d5-8a7f1d0c0fb4', '2013604', '2013-07-03', null, true),
  ('ZDMM511AADB072848', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'baebc4db-f029-40b7-b8f8-f29e332b1082', 'fad791de-371d-400f-b12b-0617cff0dd0a', '20131015', '2013-10-15', null, true),
  ('ZDMM511AADB072850', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '7e8c58e8-1b7b-4780-ac04-59302915c4a5', '05d36662-60be-450c-930e-6dc74384c9fa', '2013904', '2013-09-14', null, true),
  ('ZDMM602FAEB001914', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '9dd7ff75-e487-40b6-b2bd-4ff13364899b', '95d4d5f3-c6f1-49f4-bcc4-035d498552b2', '20140273', '2014-04-09', null, false),
  ('ZDMM602FAEB003453', '606e49b6-fcb4-493c-b3aa-21e0cb1c8448', 'ING EQUIPMENT LEASE BELGIUM', '970369-81-0', null, '5c89e791-70b3-4fbd-8cc8-77da8aaf40fc', '20150398', '2015-04-30', null, true),
  ('ZDMM602FAEB004160', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, null, 'ac518aa4-e513-4dcd-8352-2f3189776b4c', '20140450', '2014-05-17', null, false),
  ('ZDMM602FAEB004161', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'ee4b5053-57ac-420c-893a-0c1aa0734d10', 'd5ee988d-9ffc-4d48-b28d-d30362731384', '20150047', '2015-02-04', '2018-04-28', false),
  ('ZDMM602FAEB004161', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'a414ea9b-f630-4b8b-919b-9b8d86b8fe4d', '2214f919-3c10-40a5-b5f5-a258e4ed7f0a', '20180316', '2018-04-28', null, true),
  ('ZDMM602FAEB005278', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '3b43c782-ad25-4857-805e-7a34afa8e261', '23db78d9-74ac-48ec-a4ae-844e43407f6f', '20150073', '2015-02-13', '2025-06-05', false),
  ('ZDMM602FAFB014516', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'a8d9512c-3926-4245-9dc3-09986a227ab3', '305a369d-75fc-48fb-9dd5-052864ffd9c6', '20150341', '2015-04-21', null, true),
  ('ZDMM602FAFB014601', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'd361dfc7-7af6-4d30-a893-f52f1c4d9093', '9c5fe2d1-f57d-4a87-8f8a-f02e4680c58f', '20150556', '2015-05-29', null, true),
  ('ZDMM602FAFB016163', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '784b7b96-96c1-494e-b134-35b0fd9a348a', '5c8859b7-9f12-46eb-930f-8d0efb9452cd', '20170837', '2017-08-05', null, true),
  ('ZDMM604AAEB007658', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '878ab54c-a1ba-49cd-ac68-b882de5212ac', 'd0a7c6c2-571a-4ba8-8ea4-8048f845257c', '20171220', '2017-12-28', null, false),
  ('ZDMM604AAEB009590', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'e86dfcce-fea4-4083-9c0f-af1c2222a6a7', '7136bdec-065b-4fee-966a-90118cf056ad', '20150048', '2015-02-05', null, true),
  ('ZDMM604AAEB011321', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'af3e4186-8613-4d53-b65b-f74cd39d0fb0', '26a36288-fc7c-4ab4-ac75-ac9cf336c79d', '20150153', '2015-03-10', null, true),
  ('ZDMM604AAFB014424', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '20b7d269-7994-442f-ab43-361411d9e727', '86b0760b-ce53-4fbf-a9ba-ba40c59450ae', '20150644', '2015-06-16', '2018-08-08', false),
  ('ZDMM604AAFB014683', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '5f114abb-c06e-48d1-b8da-b9e59de0d1c9', 'c6370627-ad03-45de-9561-a4be188d9a72', '20150378', '2015-04-25', null, true),
  ('ZDMM604AAFB016420', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '509f982f-95f9-405a-8e7e-cccca05d665f', 'b9b756b6-fe98-41a2-bce5-9a9ce204f134', '20150692', '2015-06-24', null, true),
  ('ZDMM604AAFB016815', '493c7d53-4e32-4976-9812-d84273ec15b7', 'BNP PARIBAS', null, '7420b69d-826b-4f0f-963d-cf8b95fa63fa', '9ae13544-cb6b-4b66-b21f-d457a2568094', '20160135', '2016-03-05', null, true),
  ('ZDMM604AAFB017604', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'ae7302c8-6b83-4b67-9b9a-96dc2d2a63e7', '3c98277d-d601-4e27-afeb-ffb5d1401d58', '20160090', '2016-02-19', null, true),
  ('ZDMM604AAFB017663', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '12c3c500-c590-478e-ad22-9532546663e0', 'de6c4cb6-d2bb-41b6-8a0c-f5d00ed31790', '20160107', '2016-02-25', null, true),
  ('ZDMM604AAGB018815', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '0793e239-9be2-4672-9627-d92bfb8a155b', 'c53937f0-43c3-473b-ba31-bd0afda1e74f', '20160073', '2016-02-13', null, false),
  ('ZDMM604AAGB019561', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '61311c6a-7f1e-46a7-b595-96893f058209', '69b7d5e3-70fb-4cb7-8993-975cf3c35fa7', '20170173', '2017-03-21', '2026-03-14', false),
  ('ZDMM604AAGB019651', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '181896c6-a7bd-4ac2-81fc-ea07ce709c17', '2de18e11-024a-4e83-8050-7dc7a61083ae', '20160204', '2016-03-23', null, true),
  ('ZDMM604AAGB021175', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'bdc547e3-46f7-4fd3-a171-c037ec313e8c', 'be6e5e94-3e43-4521-ad38-4239f1623a28', '20160542', '2016-06-08', null, true),
  ('ZDMM604AAGB022179', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'efaccdc7-73ac-481e-a285-e33902a3b3fc', '90cdcc3f-166a-461f-9550-fe450c7177d6', '20160614', '2016-06-22', null, true),
  ('ZDMM604AAGB022280', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'dc2e410b-cb7f-440a-969a-d230b27c440f', '43b699d5-2eb9-47af-a73e-311c3d22d179', '20160628', '2016-06-24', null, true),
  ('ZDMM701AAGB001700', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '03ad54b2-e311-4144-9550-7f617cee7920', '64ea89a1-06ee-4a47-a47e-c11c54003437', '20160421', '2016-05-10', '2017-05-17', false),
  ('ZDMM701AAGB001700', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '493e4b78-1202-4d14-9d2b-ad6e106f23dc', '4ce63b71-fbda-4de6-825a-77dc063befd0', '20170446', '2017-05-17', null, true),
  ('ZDMMA00AAHB002547', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', '118179856333', '747edcc6-a9bc-4235-b96b-bfd4bb5060b2', '208cf8be-9cae-42a5-9131-bd316dd3fffb', '26000001', '2026-01-02', null, true),
  ('ZDMMB00FAGB000014', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'acd8af03-ca58-4504-a8d7-97c9099369ae', '825c444c-b681-4129-aa06-56fc1cee83be', '20160086', '2016-02-18', null, true),
  ('ZDMMB00FAGB000037', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'd420e386-338d-41ca-9848-bc2345e1a837', '5b7f52cf-e0f6-49a2-8993-605f470e0939', '20161074', '2016-10-14', null, true),
  ('ZDMMB01FAJB000125', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'ee4b5053-57ac-420c-893a-0c1aa0734d10', '21a06bb2-1bc7-427e-8f39-b7ee856009ba', '20180045', '2018-02-02', null, true),
  ('ZDMMC00AAHB000828', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '63e20452-31d2-4fd5-9b1a-032028ea93a9', '2e0d3aa5-b4fe-42f8-9012-365113ded698', '20170802', '2017-07-28', null, true),
  ('ZDMMD00AAHB001055', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '18d06529-3e37-47c7-bbf6-feaad3d5b318', '7c95039e-a3cf-4612-83d1-f61cae7035dc', '20170206', '2017-03-29', null, true),
  ('ZDMMD00AAHB001168', '71d114fa-e0a5-4bea-a652-283b5d7d82f6', 'KBC BANK', null, null, '33bfc15f-e101-4f7d-a710-d2322c8b9140', '20170319', '2017-04-22', null, true),
  ('ZDMMD00AAHB002663', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'e4f6bd4d-6b5c-4766-945a-7ee8ae1b35f0', 'f3b963aa-5364-40a3-beb7-845b69a4c525', '20180425', '2018-05-23', null, true),
  ('ZDMMD00AAJB004633', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '4af869c6-6766-4333-9c98-e6c19033591b', '8d173b87-973e-431a-bebc-05309304f224', '20180299', '2018-04-27', null, true),
  ('ZDMME35AAHB000096', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '2effabb0-5816-4668-ab65-f54abf294170', '8910f3ec-b7c7-49f5-84c0-6024b5f3b43c', '20170502', '2017-05-27', null, true),
  ('ZDMMH00AAJB002320', '3d9eb412-9f5d-4e31-8561-baaa37b01cee', 'BELFIUS LEASE', null, null, '7c1233f6-21b3-44eb-9bd5-242dbd5a5781', '20180307', '2018-04-27', null, true),
  ('ZDMMH00AAJB002986', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '19e57cec-dc0d-4f04-90d6-52fb9d272e6c', '043c8803-71b8-4707-8747-bc86cb61e8a6', '20180515', '2018-06-09', null, true),
  ('ZDMMH00AAKB005094', '066a52c8-efce-4955-ad6f-864e220509ce', 'CBC BANQUE', null, null, 'aaf45d59-17d9-455e-926d-19fe07bc267d', '20190526', '2019-06-20', null, true),
  ('ZDMMH00AAKB005424', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, 'f4ae2232-9e26-4a81-a976-5214bbfabb77', 'bdfa8188-d2df-444d-ac88-dab7bd8ed915', '20190418', '2019-05-23', null, true),
  ('ZDMMH00AAKB005697', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '784b7b96-96c1-494e-b134-35b0fd9a348a', '3930230d-9010-4d1e-88db-ba8ce7968719', '20190897', '2019-09-12', null, false),
  ('ZDMVA00AAHB000809', '066a52c8-efce-4955-ad6f-864e220509ce', 'CBC BANQUE', null, '93cd8a12-17b3-4955-b0cb-762f550d7f5b', '6d84d961-9a27-482c-b3ae-13ebf9f44854', '20170203', '2017-03-28', null, true),
  ('ZDMVA00AAHB001082', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '8cbc5eeb-affd-4c6f-9497-1de11accaab4', '4d178b12-041b-4ab8-beb1-8fb010fdb0e8', '20171070', '2017-10-12', null, true),
  ('ZDMVA00AAHB001509', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '682c8f4f-ff85-4426-bade-e35f36444f39', '1dcbeb2e-d7ad-4f10-ad11-662e1aa54a08', '20170204', '2017-03-28', null, false),
  ('ZDMVA00AAJB005585', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '45ea8771-1d13-4652-a853-83415fe844e9', 'b1467562-7945-4f0c-ae2f-fbad53db0a23', '20180358', '2018-04-06', null, true),
  ('ZDMVA00AAJB006190', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '78433ddc-af9c-4910-b7bc-b7358cd1ecb1', 'e42286a6-9232-46e9-88fc-01f8feafd3f4', '20181040', '2018-10-19', null, true),
  ('ZDMVA00AAJB006683', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '8c0cbf09-f192-4d12-92c3-1a733907986d', 'f962b609-3a9a-483d-8eed-45c032b1b3ab', '20190039', '2019-02-01', null, false),
  ('ZDMVA00AAKB008222', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '67c37f89-91b2-4cec-a7e1-a6b162a8b463', 'd8bac21c-3298-4226-9fa6-7958aa274bdd', '20190932', '2019-09-20', null, true),
  ('ZDMVA00AALB008723', '13687e13-074d-4844-8357-3a01ff1c920b', 'ALPHA CREDIT', null, '931eb85b-fbef-4419-9475-24cdde10786d', '7c5455c1-b7e2-455a-8ba3-c7cd9fe6114d', '20190743', '2019-08-02', null, true);

update _vf set banque = c.id
  from public.contacts c
 where _vf.banque is null and c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and c.type = 'banque_leasing'
   and upper(coalesce(c.company_name, c.last_name)) = _vf.banque_nom;

insert into public.vehicle_financings (company_id, vehicle_id, financing_contact_id, contract, client_contact_id,
                                       source_document_id, source_invoice, started_on, ended_on, is_current, origin)
select v.company_id, v.id, f.banque, f.contrat, f.client, f.doc, f.facture, f.debut, f.fin,
       -- en cours seulement si c'est bien la banque actuelle de la fiche moto
       f.en_cours and v.financing_contact_id = f.banque, 'facture_g8'
  from _vf f join public.vehicles v on v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and upper(v.vin) = f.vin
 where f.banque is not null
   and not exists (select 1 from public.vehicle_financings x where x.vehicle_id = v.id and x.source_invoice = f.facture);
drop table _vf;

-- 3) Ligne en cours = la fiche moto (banque et contrat actuels), pour toutes les sociétés.
update public.vehicle_financings x
   set contract = v.financing_contract
  from public.vehicles v
 where v.id = x.vehicle_id and x.is_current
   and x.contract is distinct from v.financing_contract;

insert into public.vehicle_financings (company_id, vehicle_id, financing_contact_id, contract, is_current, origin)
select v.company_id, v.id, v.financing_contact_id, v.financing_contract, true, 'fiche_moto'
  from public.vehicles v
 where (v.financing_contact_id is not null or v.financing_contract is not null)
   and not exists (select 1 from public.vehicle_financings x where x.vehicle_id = v.id and x.is_current);

-- 4) La fiche moto tient l'historique à jour.
create or replace function public._vehicle_financing_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _client uuid;
begin
  if tg_op = 'UPDATE' then
    if old.financing_contact_id is not distinct from new.financing_contact_id
       and old.financing_contract is not distinct from new.financing_contract then
      return null;
    end if;
    -- Même banque, autre contrat : correction de la ligne en cours.
    if old.financing_contact_id is not distinct from new.financing_contact_id then
      update public.vehicle_financings set contract = new.financing_contract
       where vehicle_id = new.id and is_current;
      if found then return null; end if;
    end if;
  end if;
  -- Autre banque (ou financement retiré) : l'ancien est clos, le nouveau est ouvert.
  update public.vehicle_financings set is_current = false, ended_on = coalesce(ended_on, current_date)
   where vehicle_id = new.id and is_current;
  if new.financing_contact_id is not null or new.financing_contract is not null then
    select o.contact_id into _client
      from public.vehicle_owners o join public.contacts c on c.id = o.contact_id
     where o.vehicle_id = new.id and o.is_current and c.type <> 'banque_leasing'
     order by o.from_date desc nulls last, o.created_at desc limit 1;
    insert into public.vehicle_financings (company_id, vehicle_id, financing_contact_id, contract, client_contact_id,
                                           started_on, is_current, origin)
    values (new.company_id, new.id, new.financing_contact_id, new.financing_contract, _client,
            current_date, true, 'fiche_moto');
  end if;
  return null;
end $$;
revoke all on function public._vehicle_financing_history() from public, anon, authenticated;
drop trigger if exists trg_vehicle_financing_history on public.vehicles;
create trigger trg_vehicle_financing_history
  after insert or update of financing_contact_id, financing_contract on public.vehicles
  for each row execute function public._vehicle_financing_history();
