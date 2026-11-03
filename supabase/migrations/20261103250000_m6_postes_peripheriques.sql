-- =====================================================================
-- M6 — Postes et périphériques (PDV030, décision de Simon du 03/11/2026 :
-- « permettre de connecter n'importe quel device pour chaque besoin : on va avoir d'autres
-- clients après Italbike Store »). Aucun matériel imposé.
--
-- 1. workstations : les POSTES d'une société (caisse 1, comptoir atelier, tablette atelier...),
--    type, code de caisse imprimé sur le ticket (CAISSE-1), actif. Le poste du navigateur courant
--    n'est PAS en base : il est mémorisé localement par chaque PC / tablette.
-- 2. workstation_devices : pour chaque poste, UN appareil par RÔLE (imprimante ticket, tiroir,
--    imprimante d'étiquettes, douchette, écran client, terminal, balance) avec son TYPE DE
--    CONNEXION (navigateur, Epson ePOS, Star WebPRNT, Web Serial, WebUSB, Zebra ZPL réseau,
--    relais prévu...), sa configuration (IP, HTTPS, largeur 80 / 58 mm, tiroir via l'imprimante,
--    broche...) et le résultat du dernier test.
-- 3. company_device_settings : réglage par société (largeur du ticket par défaut, impression
--    automatique, ouverture du tiroir à l'encaissement en espèces, pied du ticket).
-- 4. device_event(...) : trace dans `events` des ouvertures de tiroir, tickets imprimés /
--    duplicata et tests (B7 : qui, quoi, quand, quel poste). Jamais bloquant côté écran.
--
-- RLS : lecture par les membres de la société (la caisse lit les appareils de son poste),
-- écriture par les administrateurs seulement. Audit `audit_row` sur les trois tables.
-- Additif : 3 tables, 1 fonction, triggers ; aucune donnée existante modifiée.
-- Avant cette migration : la caisse imprime comme avant (A4 du navigateur), rien ne casse.
-- =====================================================================

-- ------------------------------------------------ 1. Postes
create table if not exists public.workstations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  name          text not null check (length(btrim(name)) between 1 and 60),
  kind          text not null default 'caisse'
                check (kind in ('caisse', 'comptoir_atelier', 'tablette', 'bureau', 'autre')),
  register_code text check (register_code is null or register_code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  notes         text,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint workstations_name_unique unique (company_id, name)
);
comment on table public.workstations is
  'PDV030 : postes de la société (caisse, comptoir atelier, tablette...). Le poste du navigateur est mémorisé localement (localStorage), pas en base.';
comment on column public.workstations.register_code is
  'Code de caisse imprimé sur le ticket (ex. CAISSE-1) ; vide = celui de la session de caisse.';
create index if not exists idx_workstations_company on public.workstations (company_id, sort_order, name);

-- ------------------------------------------------ 2. Appareils par rôle
create table if not exists public.workstation_devices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete restrict,
  workstation_id    uuid not null references public.workstations(id) on delete cascade,
  role              text not null check (role in (
                      'receipt_printer', 'cash_drawer', 'label_printer', 'scanner',
                      'customer_display', 'payment_terminal', 'scale')),
  connection        text not null default 'none' check (connection in (
                      'none', 'browser', 'escpos_network', 'epson_epos', 'star_webprnt', 'web_serial', 'web_usb',
                      'zebra_zpl_network', 'relay_printnode', 'relay_qz', 'via_receipt_printer', 'hid_keyboard',
                      'camera', 'second_window', 'paired_tablet', 'standalone', 'ccv_cloud')),
  label             text check (label is null or length(label) <= 80),
  config            jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  is_active         boolean not null default true,
  last_test_at      timestamptz,
  last_test_ok      boolean,
  last_test_message text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint workstation_devices_one_per_role unique (workstation_id, role),
  -- Chaque rôle n'accepte que ses connexions (même liste que src/lib/devices/types.ts).
  constraint workstation_devices_role_connection check (
    connection = 'none'
    or (role = 'receipt_printer'  and connection in ('browser', 'epson_epos', 'star_webprnt', 'web_serial', 'web_usb', 'escpos_network', 'relay_printnode', 'relay_qz'))
    or (role = 'cash_drawer'      and connection in ('via_receipt_printer', 'web_serial'))
    or (role = 'label_printer'    and connection in ('browser', 'zebra_zpl_network', 'web_serial', 'web_usb', 'relay_printnode', 'relay_qz'))
    or (role = 'scanner'          and connection in ('hid_keyboard', 'camera'))
    or (role = 'customer_display' and connection in ('second_window', 'paired_tablet'))
    or (role = 'payment_terminal' and connection in ('standalone', 'ccv_cloud'))
    or (role = 'scale'            and connection in ('web_serial'))
  )
);
comment on table public.workstation_devices is
  'PDV030 : un appareil par rôle et par poste. config jsonb = host, port, https, deviceId, paperWidth (58/80), '
  'drawerViaPrinter, drawerPin (2/5), baudRate, usbVendorId, usbProductId, labelWidthMm, labelHeightMm, dpi.';
create index if not exists idx_workstation_devices_station on public.workstation_devices (workstation_id);
create index if not exists idx_workstation_devices_company on public.workstation_devices (company_id);

-- Même société que le poste (pas d'appareil rattaché au poste d'une autre société).
create or replace function public._workstation_devices_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare ws_company uuid;
begin
  select w.company_id into ws_company from public.workstations w where w.id = new.workstation_id;
  if ws_company is null then
    raise exception 'Poste introuvable' using errcode = '23503';
  end if;
  if new.company_id is distinct from ws_company then
    raise exception 'L''appareil et le poste doivent appartenir à la même société' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_workstation_devices_guard on public.workstation_devices;
create trigger trg_workstation_devices_guard before insert or update on public.workstation_devices
  for each row execute function public._workstation_devices_guard();

-- ------------------------------------------------ 3. Réglage par société
create table if not exists public.company_device_settings (
  company_id          uuid primary key references public.companies(id) on delete cascade,
  receipt_width_mm    int not null default 80 check (receipt_width_mm in (58, 80)),
  auto_print_receipt  boolean not null default false,
  open_drawer_on_cash boolean not null default true,
  receipt_footer      text check (receipt_footer is null or length(receipt_footer) <= 500),
  updated_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.company_device_settings is
  'PDV030 : réglages matériel de la société (largeur du ticket, impression automatique, tiroir sur espèces, pied du ticket). Absent = défauts.';

-- ------------------------------------------------ updated_at + audit (B7)
drop trigger if exists trg_workstations_updated on public.workstations;
create trigger trg_workstations_updated before update on public.workstations
  for each row execute function public.set_updated_at();
drop trigger if exists trg_workstation_devices_updated on public.workstation_devices;
create trigger trg_workstation_devices_updated before update on public.workstation_devices
  for each row execute function public.set_updated_at();
drop trigger if exists trg_company_device_settings_updated on public.company_device_settings;
create trigger trg_company_device_settings_updated before update on public.company_device_settings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_workstations_audit on public.workstations;
create trigger trg_workstations_audit after insert or update or delete on public.workstations
  for each row execute function public.audit_row();
drop trigger if exists trg_workstation_devices_audit on public.workstation_devices;
create trigger trg_workstation_devices_audit after insert or update or delete on public.workstation_devices
  for each row execute function public.audit_row();
drop trigger if exists trg_company_device_settings_audit on public.company_device_settings;
create trigger trg_company_device_settings_audit after insert or update or delete on public.company_device_settings
  for each row execute function public.audit_row();

-- ------------------------------------------------ RLS : lecture membres, écriture administrateurs
alter table public.workstations enable row level security;
alter table public.workstation_devices enable row level security;
alter table public.company_device_settings enable row level security;
revoke all on public.workstations, public.workstation_devices, public.company_device_settings from anon;
grant select, insert, update, delete on public.workstations, public.workstation_devices, public.company_device_settings to authenticated;

drop policy if exists workstations_select on public.workstations;
create policy workstations_select on public.workstations for select to authenticated
  using (public.is_member(company_id));
drop policy if exists workstations_insert on public.workstations;
create policy workstations_insert on public.workstations for insert to authenticated
  with check (public.is_admin(company_id));
drop policy if exists workstations_update on public.workstations;
create policy workstations_update on public.workstations for update to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));
drop policy if exists workstations_delete on public.workstations;
create policy workstations_delete on public.workstations for delete to authenticated
  using (public.is_admin(company_id));

drop policy if exists workstation_devices_select on public.workstation_devices;
create policy workstation_devices_select on public.workstation_devices for select to authenticated
  using (public.is_member(company_id));
drop policy if exists workstation_devices_insert on public.workstation_devices;
create policy workstation_devices_insert on public.workstation_devices for insert to authenticated
  with check (public.is_admin(company_id));
drop policy if exists workstation_devices_update on public.workstation_devices;
create policy workstation_devices_update on public.workstation_devices for update to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));
drop policy if exists workstation_devices_delete on public.workstation_devices;
create policy workstation_devices_delete on public.workstation_devices for delete to authenticated
  using (public.is_admin(company_id));

drop policy if exists company_device_settings_select on public.company_device_settings;
create policy company_device_settings_select on public.company_device_settings for select to authenticated
  using (public.is_member(company_id));
drop policy if exists company_device_settings_insert on public.company_device_settings;
create policy company_device_settings_insert on public.company_device_settings for insert to authenticated
  with check (public.is_admin(company_id));
drop policy if exists company_device_settings_update on public.company_device_settings;
create policy company_device_settings_update on public.company_device_settings for update to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));
drop policy if exists company_device_settings_delete on public.company_device_settings;
create policy company_device_settings_delete on public.company_device_settings for delete to authenticated
  using (public.is_admin(company_id));

-- ------------------------------------------------ 4. Trace des actions matériel (tout membre)
-- Ouverture du tiroir (motif : encaissement en espèces / bouton), ticket imprimé, duplicata, test.
create or replace function public.device_event(_company uuid, _action text, _workstation uuid default null, _detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare ws_name text;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if _action not in ('drawer_opened', 'receipt_printed', 'receipt_reprinted', 'device_tested') then
    raise exception 'Action matériel inconnue : %', _action using errcode = '22023';
  end if;
  if _workstation is not null then
    select w.name into ws_name from public.workstations w where w.id = _workstation and w.company_id = _company;
    if ws_name is null then
      raise exception 'Poste inconnu pour cette société' using errcode = '22023';
    end if;
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), _action, 'workstation', _workstation::text, 'screen', null,
          coalesce(_detail, '{}'::jsonb) || jsonb_build_object('workstation_name', ws_name));
end $$;
revoke all on function public.device_event(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.device_event(uuid, text, uuid, jsonb) to authenticated;
