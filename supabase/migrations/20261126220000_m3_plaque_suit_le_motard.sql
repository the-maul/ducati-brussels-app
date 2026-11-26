-- =====================================================================
-- M3 (Simon, 26/11/2026) : « en Belgique la plaque suit le motard ». VEH001
-- Quand un client rachète une moto et y met sa plaque, la plaque est ENLEVÉE de ses motos plus
-- anciennes (qui restent dans le DMS, sans plaque) et chaque moto garde l'historique de ses plaques.
--
-- 1) Table vehicle_plate_history : une ligne par plaque portée (en cours / ancienne, du … au …,
--    raison). Amorce : une ligne « en cours » pour chaque moto ITALBIKE qui a une plaque.
-- 2) Déclencheur sur vehicles (plaque enregistrée ou changée) : l'ancienne plaque est close, la
--    nouvelle ouverte ; si la même plaque est sur une AUTRE moto du MÊME motard, elle y est enlevée
--    (raison « plaque reprise sur <VIN> le <date> »). Même motard = même propriétaire actuel, ou
--    propriétaire = banque / leasing (ou organisme payeur) et même client financé
--    (vehicle_financings.client_contact_id). Moto d'un autre client : rien n'est touché, l'écran
--    avertit (vehicle_plate_conflicts).
--    Déclencheur sur vehicle_owners : une moto créée pour un client (ou rattachée à lui) avec sa
--    plaque enlève cette plaque de ses motos plus anciennes (propriétaire depuis une date antérieure).
-- 3) Données ITALBIKE : groupes de motos portant la même plaque, même motard (ou fiche sans
--    propriétaire). La plaque reste sur la plus récente : facture de vente au motard, sinon début du
--    propriétaire actuel (les dates « import G8 » ne comptent pas), puis année du modèle (model_year,
--    production_date, 10e caractère du VIN Ducati). Une fiche sans propriétaire (reprise revendue)
--    n'a pas de date de vente : la moto du client datée l'emporte. Laissés de côté (liste pour
--    Domenico, plaques-en-double-a-verifier.xlsx) : même moto en deux fiches (VIN quasi identiques),
--    clients différents, plaques non valables, et les cas où les dates se contredisent.
--    Valeurs explicites ci-dessous (48 motos), vérifiées une à une : la plaque doit être inchangée.
-- Société d'essai ItalTest : non touchée (seul le déclencheur s'y applique, comme partout).
-- =====================================================================

-- 1) Table -------------------------------------------------------------
create table if not exists public.vehicle_plate_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  plate text not null,
  from_date date,
  to_date date,
  is_current boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint vehicle_plate_history_current_open check (not is_current or to_date is null)
);
create unique index if not exists uq_vehicle_plate_history_current on public.vehicle_plate_history (vehicle_id) where is_current;
create index if not exists idx_vehicle_plate_history_vehicle on public.vehicle_plate_history (vehicle_id, to_date);
create index if not exists idx_vehicle_plate_history_plate on public.vehicle_plate_history (company_id, plate);
comment on table public.vehicle_plate_history is
  'Historique des plaques d''une moto (la plaque suit le motard, Simon 26/11/2026). En cours = vehicles.plate. Tenu par trg_vehicle_plate_history. VEH001';

drop trigger if exists trg_vehicle_plate_history_audit on public.vehicle_plate_history;
create trigger trg_vehicle_plate_history_audit after insert or update or delete on public.vehicle_plate_history
  for each row execute function public.audit_row();

alter table public.vehicle_plate_history enable row level security;
drop policy if exists vehicle_plate_history_select on public.vehicle_plate_history;
create policy vehicle_plate_history_select on public.vehicle_plate_history for select to authenticated
  using (public.is_member(company_id));
drop policy if exists vehicle_plate_history_write on public.vehicle_plate_history;
create policy vehicle_plate_history_write on public.vehicle_plate_history for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- 2) Règles -------------------------------------------------------------
-- Le(s) motard(s) d'une moto : propriétaires actuels ; si l'un d'eux est une banque / un leasing
-- (ou l'organisme payeur de la moto), on ajoute le client financé.
create or replace function public._vehicle_riders(_vehicle uuid)
returns uuid[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
    select o.contact_id as x from public.vehicle_owners o where o.vehicle_id = _vehicle and o.is_current
    union
    select f.client_contact_id from public.vehicle_financings f
     where f.vehicle_id = _vehicle and f.client_contact_id is not null
       and exists (select 1 from public.vehicle_owners o join public.contacts c on c.id = o.contact_id
                     join public.vehicles v on v.id = o.vehicle_id
                    where o.vehicle_id = _vehicle and o.is_current
                      and (c.type::text = 'banque_leasing' or c.id = v.financing_contact_id
                           or exists (select 1 from public.vehicle_financings f2 where f2.financing_contact_id = c.id)))
  ) z where x is not null
$$;
revoke all on function public._vehicle_riders(uuid) from public, anon, authenticated;

-- Enlève la plaque de _vehicle des autres motos du même motard. _owner_from renseigné (propriétaire
-- qui vient d'être rattaché) : seulement les motos dont le propriétaire actuel date d'avant.
create or replace function public._vehicle_plate_take_over(_vehicle uuid, _owner_from date default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _v record;
  _riders uuid[];
  _w record;
  _n integer := 0;
  _on date := coalesce(_owner_from, current_date);
begin
  select v.id, v.company_id, v.vin, nullif(btrim(coalesce(v.plate, '')), '') as plate into _v
    from public.vehicles v where v.id = _vehicle;
  if _v.plate is null then return 0; end if;
  _riders := public._vehicle_riders(_vehicle);
  if cardinality(_riders) = 0 then return 0; end if;
  for _w in
    select w.id from public.vehicles w
     where w.company_id = _v.company_id and w.plate = _v.plate and w.id <> _vehicle
       and public._vehicle_riders(w.id) && _riders
       and (_owner_from is null or coalesce((select max(o.from_date) from public.vehicle_owners o
                                              where o.vehicle_id = w.id and o.is_current), '-infinity'::date) <= _owner_from)
  loop
    perform set_config('dms.plate_reason',
      'plaque reprise sur ' || coalesce(_v.vin, _v.plate) || ' le ' || to_char(_on, 'DD/MM/YYYY'), true);
    perform set_config('dms.plate_until', _on::text, true);
    perform set_config('dms.plate_takeover', 'off', true);
    update public.vehicles set plate = null where id = _w.id;
    perform set_config('dms.plate_reason', '', true);
    perform set_config('dms.plate_until', '', true);
    perform set_config('dms.plate_takeover', '', true);
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke all on function public._vehicle_plate_take_over(uuid, date) from public, anon, authenticated;

-- Historique : plaque close / ouverte à chaque changement, puis reprise sur les autres motos du motard.
-- Réglages de transaction (migrations, reprise) : dms.plate_reason, dms.plate_until ('inconnue' =
-- date de fin non connue), dms.plate_takeover = 'off'.
create or replace function public._vehicle_plate_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _reason text := nullif(current_setting('dms.plate_reason', true), '');
  _until text := nullif(current_setting('dms.plate_until', true), '');
  _to date;
  _new text := nullif(btrim(coalesce(new.plate, '')), '');
  _old text;
begin
  if tg_op = 'UPDATE' then
    _old := nullif(btrim(coalesce(old.plate, '')), '');
    if _old is not distinct from _new then return null; end if;
  end if;
  _to := case when _until = 'inconnue' then null when _until is not null then _until::date else current_date end;
  update public.vehicle_plate_history h
     set is_current = false,
         to_date = case when h.from_date is not null and _to < h.from_date then h.from_date else _to end,
         reason = coalesce(_reason, h.reason)
   where h.vehicle_id = new.id and h.is_current;
  if not found and _old is not null then
    insert into public.vehicle_plate_history (company_id, vehicle_id, plate, to_date, is_current, reason)
    values (new.company_id, new.id, _old, _to, false, _reason);
  end if;
  if _new is not null then
    insert into public.vehicle_plate_history (company_id, vehicle_id, plate, from_date, is_current)
    values (new.company_id, new.id, _new, current_date, true);
    if coalesce(current_setting('dms.plate_takeover', true), '') <> 'off' then
      perform public._vehicle_plate_take_over(new.id, null);
    end if;
  end if;
  return null;
end $$;
revoke all on function public._vehicle_plate_history() from public, anon, authenticated;
drop trigger if exists trg_vehicle_plate_history on public.vehicles;
create trigger trg_vehicle_plate_history
  after insert or update of plate on public.vehicles
  for each row execute function public._vehicle_plate_history();

-- Moto créée pour un client (ou rattachée à lui) qui porte déjà sa plaque.
create or replace function public._vehicle_owner_plate_take_over()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_current and coalesce(current_setting('dms.plate_takeover', true), '') <> 'off' then
    perform public._vehicle_plate_take_over(new.vehicle_id, coalesce(new.from_date, current_date));
  end if;
  return null;
end $$;
revoke all on function public._vehicle_owner_plate_take_over() from public, anon, authenticated;
drop trigger if exists trg_vehicle_owner_plate_take_over on public.vehicle_owners;
create trigger trg_vehicle_owner_plate_take_over
  after insert on public.vehicle_owners
  for each row execute function public._vehicle_owner_plate_take_over();

-- Écran : autres motos qui portent déjà cette plaque, et si c'est le même motard (plaque enlevée à
-- l'enregistrement) ou un autre client (avertissement, rien n'est modifié).
create or replace function public.vehicle_plate_conflicts(
  _company uuid, _plate text, _vehicle uuid default null, _contact uuid default null
)
returns table (vehicle_id uuid, vin text, brand text, model text, model_year integer, owner_name text, same_rider boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  _p text := upper(btrim(coalesce(_plate, '')));
  _riders uuid[] := '{}'::uuid[];
begin
  if not public.is_member(_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  if _p = '' then return; end if;
  if _vehicle is not null then _riders := public._vehicle_riders(_vehicle); end if;
  if _contact is not null then _riders := _riders || _contact; end if;
  return query
    select w.id, w.vin, w.brand, w.model, w.model_year,
           (select coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.last_name, c.first_name)), ''))
              from public.vehicle_owners o join public.contacts c on c.id = o.contact_id
             where o.vehicle_id = w.id and o.is_current order by o.from_date desc nulls last limit 1),
           (cardinality(_riders) > 0 and public._vehicle_riders(w.id) && _riders)
      from public.vehicles w
     where w.company_id = _company and upper(w.plate) = _p and w.id is distinct from _vehicle
     order by w.model_year desc nulls last, w.vin;
end $$;
revoke all on function public.vehicle_plate_conflicts(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.vehicle_plate_conflicts(uuid, text, uuid, uuid) to authenticated;
comment on function public.vehicle_plate_conflicts(uuid, text, uuid, uuid) is
  'VEH001 : motos qui portent déjà cette plaque ; same_rider = même motard (plaque enlevée à l''enregistrement).';

-- 3) Amorce : la plaque actuelle de chaque moto ITALBIKE ------------------
insert into public.vehicle_plate_history (company_id, vehicle_id, plate, is_current, created_by)
select v.company_id, v.id, btrim(v.plate), true, null
  from public.vehicles v
 where v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
   and nullif(btrim(coalesce(v.plate, '')), '') is not null
   and not exists (select 1 from public.vehicle_plate_history h where h.vehicle_id = v.id and h.is_current);

-- 4) La plaque quitte les anciennes motos du motard (valeurs explicites) ------------
do $$
declare
  r record;
  _done integer := 0;
  _list jsonb := '[]'::jsonb;
begin
  for r in
    select x.* from (values
      -- ancienne moto, VIN, plaque, moto qui garde la plaque, son VIN, date de reprise (null = inconnue), raison
  ('c0049b1b-5da5-4ffa-87b7-7a4c4698a1dd'::uuid, 'ZDM600', '1MLE635', '298d0359-5f26-4a34-8946-a03711fc79dd'::uuid, 'ZDMM500AA9B026465', date '2009-08-06', 'plaque reprise sur ZDMM500AA9B026465 le 06/08/2009'),
  ('4743a39e-0079-4833-aec8-da1734c4b198'::uuid, 'ZDMM506ABAB40330', 'MAAE692', '132b2858-e603-41cd-9c44-2e8f12143acd'::uuid, 'ZDMG104FAFB028531', date '2016-11-16', 'plaque reprise sur ZDMG104FAFB028531 le 16/11/2016'),
  ('09265ce7-26a4-4f61-bc76-3da46bd80c8d'::uuid, 'ZDMA201ACAB000766', 'MABF601', '827b2a12-ca4f-4ffd-9517-be9cfafbd11d'::uuid, 'ZDMAA01FAGB011061', date '2017-05-13', 'plaque reprise sur ZDMAA01FAGB011061 le 13/05/2017'),
  ('6d9763ac-3a21-4307-b4cd-737d500e6b22'::uuid, 'ZDMH804FAFB025932', 'MABF940', 'efbb406e-fcdc-4d86-a7bf-98b9780f3573'::uuid, 'ZDMGD00FAHB000008', date '2017-09-30', 'plaque reprise sur ZDMGD00FAHB000008 le 30/09/2017'),
  ('f9c48563-f5d8-46f3-8886-e92344a6ec9a'::uuid, 'ZDMH200AAXB003147', 'MABL461', 'ccd2c3cf-0acc-4327-94bf-41c294a5e8a3'::uuid, 'ZDMH804FAEB021066', date '2019-06-14', 'plaque reprise sur ZDMH804FAEB021066 le 14/06/2019'),
  ('257d8897-d8ce-45b7-800d-5c81eba1c911'::uuid, 'ZDM1003PPVB012122', 'MACC260', '456affa5-49c3-4d39-a473-8b2dbb217b7e'::uuid, 'ZDMAA01FAFB002665', null::date, 'plaque reprise sur ZDMAA01FAFB002665'),
  ('0b75b4f3-efa0-40cc-9b14-3172952a24fd'::uuid, 'ZDMAC02FAJB002511', 'MACS435', '4e241684-af4c-420d-8175-8700ada291c2'::uuid, 'ZDMAC02FALB016639', date '2020-07-13', 'plaque reprise sur ZDMAC02FALB016639 le 13/07/2020'),
  ('eec0eeb6-ae2c-4b51-b90b-d7f36d94a7a8'::uuid, 'ZDMH801ABCB008392', 'MADL497', 'd469bd95-89fc-4575-abe7-9d9342f70e22'::uuid, 'ZDMG104FAFB028215', date '2016-04-27', 'plaque reprise sur ZDMG104FAFB028215 le 27/04/2016'),
  ('5ccbd725-eccb-4fe4-a576-41aebb4ec4b6'::uuid, 'ZDMH801ABCB004101', 'MADT548', '9bbd02bd-dee3-4e28-8ec3-af21c4f8bf41'::uuid, 'ZDMDB01FAKB000073', date '2019-01-15', 'plaque reprise sur ZDMDB01FAKB000073 le 15/01/2019'),
  ('2181547a-1f49-42c9-9b47-854466b5f203'::uuid, 'ZDMB200AAEB009577', 'MADZ666', '0f205c8c-b505-4470-975a-02ce80bffef8'::uuid, 'ZDMBB00AALB004677', date '2020-05-13', 'plaque reprise sur ZDMBB00AALB004677 le 13/05/2020'),
  ('388412fc-1312-43e5-8a44-f401dd4cd8e8'::uuid, 'ZDMAA01FAFB003387', 'MAEA886', 'aec4eafd-c999-484a-9f93-073fbed6c82c'::uuid, 'ZDM1002BGSB001731', date '2025-03-03', 'plaque reprise sur ZDM1002BGSB001731 le 03/03/2025'),
  ('aa004484-3cf4-43fe-a523-28bf2a6b9eac'::uuid, 'ZDM900M022146', 'MAEC858', '56fa6121-8926-4ec2-8d20-66fc0d137cb6'::uuid, 'ZDMMD00AAJB003623', date '2017-08-23', 'plaque reprise sur ZDMMD00AAJB003623 le 23/08/2017'),
  ('66f213e4-8f6f-4f23-a3c5-b6dd1e6d5028'::uuid, 'ZDMM602FAFB013648', 'MAFC270', 'd4babc2c-f860-42f6-bf3f-88fad83c47d4'::uuid, 'ZDM1F02BGMB000764', date '2021-02-11', 'plaque reprise sur ZDM1F02BGMB000764 le 11/02/2021'),
  ('23d61da4-12b6-4c8f-af16-9874e503ad8d'::uuid, 'ZDMAC02FALB014781', 'MAFG812', 'b1061fd4-11e9-43eb-a855-e84981b51a42'::uuid, 'ZDM6A02BGRB016988', date '2024-02-08', 'plaque reprise sur ZDM6A02BGRB016988 le 08/02/2024'),
  ('be122b00-9383-4804-9807-c7762cbbbbc4'::uuid, 'ZDMB300FADB000507', 'MAGH931', 'f5c2f496-795d-4810-887c-2210191caef8'::uuid, 'ZDMAA01FAGB010531', date '2016-03-01', 'plaque reprise sur ZDMAA01FAGB010531 le 01/03/2016'),
  ('1a8c34ff-e113-41c1-90eb-edb90d9d118a'::uuid, 'VBKV79400MM939579', 'MAHJ205', '0816c189-8f3b-4a47-81fc-c9a1ad685a11'::uuid, 'ZDM1003PPSB005853', date '2025-05-25', 'plaque reprise sur ZDM1003PPSB005853 le 25/05/2025'),
  ('cd59353b-5515-430e-979d-6b9031dac815'::uuid, 'ZDMMB00FAGB000044', 'MAHU010', '642da4f9-92cb-499c-b4bf-fa45e4187976'::uuid, 'ZDM1F02BGNB003916', date '2024-07-03', 'plaque reprise sur ZDM1F02BGNB003916 le 03/07/2024'),
  ('f333e602-6529-40a2-acf4-f25fe551201f'::uuid, 'ZDMAC02FAKB006446', 'MAHX899', 'f7ab44e9-daf6-4a78-9358-ed090d873774'::uuid, 'ZDM6A02BGNB004001', date '2023-05-25', 'plaque reprise sur ZDM6A02BGNB004001 le 25/05/2023'),
  ('00820d59-f679-47ab-8b7a-a8eeb0dceb0c'::uuid, 'ZDMA201ACBB012062', 'MAHX899', 'f7ab44e9-daf6-4a78-9358-ed090d873774'::uuid, 'ZDM6A02BGNB004001', date '2023-05-25', 'plaque reprise sur ZDM6A02BGNB004001 le 25/05/2023'),
  ('faf1c5f5-71d5-496d-b28f-bc0f432a5110'::uuid, 'ZDMM500AA8B004019', 'MAJE944', '15024a2f-8acb-45e8-9b9d-843d5d119e42'::uuid, 'ZDMGE02FAKB002207', date '2020-02-27', 'plaque reprise sur ZDMGE02FAKB002207 le 27/02/2020'),
  ('a5776e09-0914-4858-9bd9-959a323e15d8'::uuid, 'ZDMAA05AAHB019502', 'MAKC780', '49900b7c-3eb2-4a5c-943f-fbbd421eca2b'::uuid, 'ZDM1A02BGNB012840', date '2022-01-21', 'plaque reprise sur ZDM1A02BGNB012840 le 21/01/2022'),
  ('f74858df-e1a2-4451-ab84-c326df3217de'::uuid, 'ZDMKC02AAHB002105', 'MALC427', '2b4397c2-d582-4323-9707-9b7a380e3890'::uuid, 'ZDM2A02AAPB006149', date '2022-06-29', 'plaque reprise sur ZDM2A02AAPB006149 le 29/06/2022'),
  ('4a7ce068-739f-4888-8259-6d3bbee94264'::uuid, 'ZDMAA01FAHB020985', 'MALD778', 'c6638b02-0a0a-4725-935b-8d5d3c253757'::uuid, 'ZDM1002BGSB005451', date '2025-06-03', 'plaque reprise sur ZDM1002BGSB005451 le 03/06/2025'),
  ('b804e343-a3d8-47c6-961d-dff23aeb19cf'::uuid, 'ZDMV500AA3B001331', 'MAPJ864', '3dd4d51a-1475-401d-8328-2af98afd0f61'::uuid, 'ZDMM604AAFB014266', date '2015-05-26', 'plaque reprise sur ZDMM604AAFB014266 le 26/05/2015'),
  ('6f5b622a-909e-4aaa-88fa-c922bd99f52c'::uuid, 'ZDMBA00AAJB004284', 'MAPP367', '8ec9f3c3-74f7-4e51-a074-0147a05e7075'::uuid, 'ZDMAC02FALB013859', date '2019-12-20', 'plaque reprise sur ZDMAC02FALB013859 le 20/12/2019'),
  ('0c584445-2728-4e88-987f-6b17abb90468'::uuid, 'ZDMG104FAEB020454', 'MAPT905', '9969b582-0023-43eb-900f-3a6381f13c54'::uuid, 'ZDMGE02FALB004357', date '2020-04-14', 'plaque reprise sur ZDMGE02FALB004357 le 14/04/2020'),
  ('4a72f822-5847-49b2-89db-7a0dccc81da1'::uuid, 'ZDM900M015003', 'MAPX053', '8646c32d-3d36-454c-b573-9928cdc624f6'::uuid, 'ZDMGB00FAGB000035', date '2016-03-30', 'plaque reprise sur ZDMGB00FAGB000035 le 30/03/2016'),
  ('91937a24-1b01-4109-8f41-5b969ed0f56c'::uuid, 'ZDMMH00AAKB004304', 'MARG887', 'd761d673-45ad-4f4f-983e-0330f6d62d2c'::uuid, 'ZDM1002BGSB000445', date '2024-12-18', 'plaque reprise sur ZDM1002BGSB000445 le 18/12/2024'),
  ('e62232a4-13e2-4c49-aca3-c59fe47b827d'::uuid, 'ZDM1F02BGMB001256', 'MARG887', 'd761d673-45ad-4f4f-983e-0330f6d62d2c'::uuid, 'ZDM1002BGSB000445', date '2024-12-18', 'plaque reprise sur ZDM1002BGSB000445 le 18/12/2024'),
  ('fd589b60-6017-440a-b28f-d750786bafeb'::uuid, 'ZDM906SC2001930', 'MARN917', 'f507615f-74d6-4254-87ec-3ddccf92f5c8'::uuid, 'ZDMS301AA3B000210', date '2004-06-16', 'plaque reprise sur ZDMS301AA3B000210 le 16/06/2004'),
  ('b6c34373-c8d8-4576-a3e7-e7564dc3e190'::uuid, 'ZDMM416AA6B091025', 'MATY194', '2234652b-542d-45c4-b9ca-a2387e5a7faa'::uuid, 'ZDMKC04AALB015641', date '2020-06-29', 'plaque reprise sur ZDMKC04AALB015641 le 29/06/2020'),
  ('3e8a8694-d844-4d77-9b2c-8c222b432be3'::uuid, 'VG5DM112000005906', 'MAUR427', 'af5294bb-03ec-4c57-ae5f-6f06266af613'::uuid, 'ZDM1X02AASB011494', date '2026-03-31', 'plaque reprise sur ZDM1X02AASB011494 le 31/03/2026'),
  ('a648067a-29a8-4ddf-8bb4-8ffe1533f1ad'::uuid, 'ZDMVA00AAHB000605', 'MAXB619', '5f8341a4-094a-4057-841b-2086d72d423b'::uuid, 'ZDM1H02BGMB003319', date '2021-01-07', 'plaque reprise sur ZDM1H02BGMB003319 le 07/01/2021'),
  ('e2c8b027-3277-414e-9cc0-5917e598fe89'::uuid, 'ZDMF101AAAB006060', 'MAXY309', '6b9220c2-8568-4321-bc80-4a53e66fdcdb'::uuid, 'ZDMAA01FAFB004268', date '2015-07-28', 'plaque reprise sur ZDMAA01FAFB004268 le 28/07/2015'),
  ('49b58d5a-0848-492f-90a1-0dfb0edcc59d'::uuid, 'ZDMA201ADBB011452', 'MAZB053', '8a9a7860-25c5-4412-b2d7-80701d4b511a'::uuid, 'ZDM1F02BGNB003790', date '2022-03-17', 'plaque reprise sur ZDM1F02BGNB003790 le 17/03/2022'),
  ('b7dab1d4-9e8f-4fc5-a0f5-a9fd7b5ab060'::uuid, 'JKAZRT00KKA002775', 'MAZB494', '25ea9ac0-4a06-445b-85fc-8b1d352c7803'::uuid, 'ZDM7F02BGSB001101', date '2025-06-05', 'plaque reprise sur ZDM7F02BGSB001101 le 05/06/2025'),
  ('9104e965-b677-461f-a64a-dc07a71c3727'::uuid, 'VBKTU9406PM853441', 'MBAG460', '6d9026b6-d3ed-45d8-aba6-11b18b429ca9'::uuid, 'ZDM4F02BGRB004631', date '2024-06-27', 'plaque reprise sur ZDM4F02BGRB004631 le 27/06/2024'),
  ('d460a1d1-1635-473c-8374-7e6dc047a57e'::uuid, 'ZDMAC02FAJB004796', 'MBAM758', 'c82bfbd8-e5e1-478a-9e92-5de308ca5f14'::uuid, 'ZDM6A02BGNB003718', date '2022-09-29', 'plaque reprise sur ZDM6A02BGNB003718 le 29/09/2022'),
  ('a873b572-1adc-445d-b0f7-f8f89d37bcdd'::uuid, 'ZDMAA01FAHB022531', 'MBED304', 'd06bc607-bc85-43c5-a775-c03b66f722fd'::uuid, 'ZDM6A03BGRB017506', date '2024-02-10', 'plaque reprise sur ZDM6A03BGRB017506 le 10/02/2024'),
  ('14192ba6-c0f8-4626-b910-997e79aae517'::uuid, 'ZDMMH00AALB006208', 'MBEW926', '85f4a1ac-15e4-4d6b-be61-2563c4f2f33e'::uuid, 'ZDM3F02BGPB003481', date '2026-05-08', 'plaque reprise sur ZDM3F02BGPB003481 le 08/05/2026'),
  ('56d87138-ddda-4863-982c-1790c9eb9edc'::uuid, 'ZDMMH00AAMB008586', 'MBFA101', 'c812fc8d-319d-404d-a785-2c5bc27e0152'::uuid, 'ZDMAD00AAKB001800', null::date, 'plaque reprise sur ZDMAD00AAKB001800'),
  ('3389d4c5-ff8a-43b1-8f4d-a5ca919dc677'::uuid, 'ZDMBA00AAGB000738', 'MBHV220', '770883c7-2a2b-4d88-a0c6-f2c367b1f234'::uuid, 'ZDM1B00AANB000055', date '2025-03-18', 'plaque reprise sur ZDM1B00AANB000055 le 18/03/2025'),
  ('76fe413e-9b00-4ed9-8425-d0a556323d29'::uuid, 'WB10N0109S6K86766', 'MBJQ886', 'fa9ff670-914c-425a-865f-63216cefef17'::uuid, 'ZDM5000AATB001004', date '2026-03-31', 'plaque reprise sur ZDM5000AATB001004 le 31/03/2026'),
  ('4d4f9ac1-2b16-4cac-9458-c39b04047721'::uuid, 'ZDMK100AAGB019392', 'MBKA989', 'fc1aa8e0-e32b-4db4-9d45-11de71b5c822'::uuid, 'ZDM1200AATB006300', date '2026-06-11', 'plaque reprise sur ZDM1200AATB006300 le 11/06/2026'),
  ('e96655aa-c9d9-4950-ac52-4f509bc60d7e'::uuid, 'ZDM2A02AANB003987', 'MBKA989', 'fc1aa8e0-e32b-4db4-9d45-11de71b5c822'::uuid, 'ZDM1200AATB006300', date '2026-06-11', 'plaque reprise sur ZDM1200AATB006300 le 11/06/2026'),
  ('45edbd9c-38cf-47e3-b133-e2eba88a3b9f'::uuid, 'SMTS3P01SCNAF5197', 'MBPC228', '31e43d37-c0fe-4907-9082-1dae0252724e'::uuid, 'ZDMH904FAGB007385', date '2026-01-02', 'plaque reprise sur ZDMH904FAGB007385 le 02/01/2026'),
  ('859de5ab-d3ad-48b3-bdb1-b1b007a0e3e4'::uuid, 'ZDMFA02BGLB002965', 'MBPS946', '71d75852-7e83-49a0-bcd5-691c42eac72e'::uuid, 'ZDM3G02BGRB003316', date '2026-05-27', 'plaque reprise sur ZDM3G02BGRB003316 le 27/05/2026'),
  ('5046e518-bb24-41e3-bdd7-caa4498f30b7'::uuid, 'ZDM4F02BGRB004312', 'MBPS946', '71d75852-7e83-49a0-bcd5-691c42eac72e'::uuid, 'ZDM3G02BGRB003316', date '2026-05-27', 'plaque reprise sur ZDM3G02BGRB003316 le 27/05/2026')
    ) as x(old_id, old_vin, plate, new_id, new_vin, until, reason)
  loop
    perform 1 from public.vehicles v
     where v.id = r.old_id and v.vin = r.old_vin and v.plate = r.plate
       and v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' for update;
    if not found then raise exception 'plaque déjà changée, migration à revoir : % (%)', r.old_vin, r.plate; end if;
    perform 1 from public.vehicles v
     where v.id = r.new_id and v.vin = r.new_vin and v.plate = r.plate
       and v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
    if not found then raise exception 'moto qui garde la plaque introuvable : % (%)', r.new_vin, r.plate; end if;
    perform set_config('dms.plate_reason', r.reason, true);
    perform set_config('dms.plate_until', coalesce(r.until::text, 'inconnue'), true);
    perform set_config('dms.plate_takeover', 'off', true);
    update public.vehicles set plate = null where id = r.old_id;
    _done := _done + 1;
    _list := _list || jsonb_build_object('vehicle_id', r.old_id, 'vin', r.old_vin, 'plate', r.plate,
                                         'kept_on', r.new_vin, 'until', r.until);
  end loop;
  perform set_config('dms.plate_reason', '', true);
  perform set_config('dms.plate_until', '', true);
  perform set_config('dms.plate_takeover', '', true);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', null, 'data_cleanup', 'vehicles',
          '20261126220000_m3_plaque_suit_le_motard', 'migration', null,
          jsonb_build_object('rule', 'La plaque suit le motard (Simon 26/11/2026) : enlevée des anciennes motos du même motard, gardée sur la plus récente, historique dans vehicle_plate_history.',
                             'count', _done, 'plates_removed', _list));
end $$;
