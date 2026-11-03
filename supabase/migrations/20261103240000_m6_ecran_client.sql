-- =====================================================================
-- Mission 12, carte P2 (synthese caisse du 03/11/2026) -- PDV020 « Ecran client tablette »
-- Etude : docs/etudes/2026-11-paiements-comptoir.md, paragraphes 4 et 5.
--
-- 1. L ecran client generalise : `counter_displays` (une ligne par societe x vendeur, deja
--    Realtime) recoit un `mode` (accueil / ticket / qr / terminal / signature / merci), une charge
--    utile `payload` (le ticket en cours : lignes, totaux, langue, moyens proposes...), une reponse
--    du client `reply` (adresse e-mail tapee sur la tablette, signature) et un numero de version.
--    Le QR de virement existant (qr_payment_start / confirm / cancel / counter_display_show /
--    counter_display_current) n est PAS modifie : il continue de poser `payment_id`, et l ecran en
--    deduit le mode « qr » (attendu) ou « merci » (recu).
-- 2. Les appareils : `customer_display_devices`. Une tablette s appaire SANS compte utilisateur :
--    elle demande un code a 6 caracteres (`customer_display_pair_begin`, ouvert a anon, limite),
--    le vendeur saisit le code a la caisse (`customer_display_pair`) : l appareil est lie a la
--    societe, au poste (`register_code`) et au vendeur dont il suit l ecran. Il garde un jeton long
--    (64 hexa) ; la base n en garde que l empreinte SHA-256. Revocable (Parametres -> Ecrans clients).
--    L appareil ne lit que SON ecran, par jeton (`customer_display_read`, security definer) ; il ne
--    voit que le ticket en cours (nom du client, lignes, montants), jamais la reponse du client.
-- 3. Temps reel : `counter_displays` reste dans la publication Realtime (vendeur, apercu) ; chaque
--    changement envoie en plus un signal SANS donnee (`realtime.send`, canal public au nom secret,
--    un par appareil) ; l appareil relit alors par jeton, et relit de toute facon toutes les 5 s.
--
-- Additif : 6 colonnes, 1 table, 1 contrainte, 2 declencheurs, 11 fonctions (+ 5 internes) ; anon perd le droit (inutile) de lire counter_displays. Aucune donnee ecrite.
-- Exception documentee a la regle « company_id partout » : un appareil EN ATTENTE d appairage n a
-- pas encore de societe (company_id null, invisible de tous, purge apres 15 min) -- decision M-104.
-- =====================================================================

-- 1. Ecran client : mode, ticket en cours, reponse du client --------------------------------------
alter table public.counter_displays
  add column if not exists mode            text   not null default 'accueil',
  add column if not exists payload         jsonb  not null default '{}'::jsonb,
  add column if not exists reply           jsonb,
  add column if not exists reply_at        timestamptz,
  add column if not exists mode_changed_at timestamptz not null default now(),
  add column if not exists version         bigint not null default 0;

do $$ begin
  alter table public.counter_displays
    add constraint counter_displays_mode_chk
    check (mode in ('accueil', 'ticket', 'qr', 'terminal', 'signature', 'merci'));
exception when duplicate_object then null; end $$;

-- La tablette n a pas de compte : elle ne lit jamais la table (RLS la vidait deja), seulement par jeton.
revoke all on public.counter_displays from anon;

comment on column public.counter_displays.mode is
  'Ce que montre l ecran client : accueil, ticket (en direct), qr, terminal, signature, merci. Un paiement QR attendu (payment_id) l emporte : mode qr.';
comment on column public.counter_displays.payload is
  'Ticket en cours tel que le client le voit (cles filtrees par counter_display_set) : jamais d adresse, de telephone ni d historique.';
comment on column public.counter_displays.reply is
  'Reponse du client tapee sur la tablette (email, signature). Lue par le vendeur seulement, effacee au changement de mode.';

-- Version + horodatage de mode a chaque changement ; la reponse du client tombe quand le mode change.
create or replace function public._counter_display_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.mode_changed_at := now();
    new.updated_at := now();
    return new;
  end if;
  new.version := coalesce(old.version, 0) + 1;
  new.updated_at := now();
  if new.mode is distinct from old.mode or new.payment_id is distinct from old.payment_id then
    new.mode_changed_at := now();
    if new.reply is not distinct from old.reply then
      new.reply := null;
      new.reply_at := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function public._counter_display_touch() from public, anon, authenticated;

drop trigger if exists counter_displays_touch on public.counter_displays;
create trigger counter_displays_touch before insert or update on public.counter_displays
  for each row execute function public._counter_display_touch();

-- 2. Appareils appaires -----------------------------------------------------------------------
create table if not exists public.customer_display_devices (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid references public.companies(id) on delete cascade,      -- null = en attente d appairage
  user_id            uuid references auth.users(id) on delete set null,           -- vendeur dont l ecran est suivi
  name               text not null default 'Ecran client',
  register_code      text not null default 'CAISSE-1',                            -- poste de caisse
  token_hash         text not null unique,                                        -- SHA-256 du jeton (le jeton n est jamais stocke)
  channel_key        text not null unique,                                        -- nom secret du canal Realtime (signal sans donnee)
  pairing_code       text unique,
  pairing_expires_at timestamptz,
  user_agent         text,
  created_at         timestamptz not null default now(),
  paired_at          timestamptz,
  paired_by          uuid references auth.users(id) on delete set null,
  last_seen_at       timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid references auth.users(id) on delete set null,
  constraint customer_display_devices_paired_chk check ((company_id is null) = (paired_at is null)),
  constraint customer_display_devices_name_chk check (length(btrim(name)) between 1 and 60),
  constraint customer_display_devices_register_chk check (length(btrim(register_code)) between 1 and 12)
);
create index if not exists customer_display_devices_screen_idx
  on public.customer_display_devices (company_id, user_id) where revoked_at is null;

alter table public.customer_display_devices enable row level security;
-- Lecture par les membres de la societe, hors jeton, canal et code ; aucune ecriture directe.
drop policy if exists customer_display_devices_select on public.customer_display_devices;
create policy customer_display_devices_select on public.customer_display_devices for select to authenticated
  using (company_id is not null and public.is_member(company_id));
revoke all on public.customer_display_devices from anon, authenticated;
grant select (id, company_id, user_id, name, register_code, created_at, paired_at, last_seen_at, revoked_at)
  on public.customer_display_devices to authenticated;
-- Volontairement HORS de la publication Realtime (le flux Realtime porterait toutes les colonnes).

-- Signal sans donnee vers les appareils de l ecran (canal public au nom secret). Sans effet si
-- realtime.send n existe pas ; ne fait jamais echouer l ecriture de l ecran.
create or replace function public._counter_display_ping()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare k text;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return null; end if;
  for k in
    select d.channel_key from public.customer_display_devices d
     where d.company_id = new.company_id and d.user_id = new.user_id and d.revoked_at is null
  loop
    begin
      perform realtime.send(jsonb_build_object('v', new.version), 'changed', 'ecran-client-' || k, false);
    exception when others then null;
    end;
  end loop;
  return null;
end $$;
revoke all on function public._counter_display_ping() from public, anon, authenticated;

drop trigger if exists counter_displays_ping on public.counter_displays;
create trigger counter_displays_ping after insert or update on public.counter_displays
  for each row execute function public._counter_display_ping();

-- 3. Fonctions internes -------------------------------------------------------------------------
create or replace function public._customer_display_hash(_token text)
returns text language sql immutable set search_path = public, extensions, pg_temp as $$
  select encode(extensions.digest(convert_to(coalesce(_token, ''), 'UTF8'), 'sha256'), 'hex')
$$;
revoke all on function public._customer_display_hash(text) from public, anon, authenticated;

-- Code d appairage : 6 caracteres sans ambiguite (ni 0/O, ni 1/I/L).
create or replace function public._customer_display_code()
returns text language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(6);
  c text := '';
begin
  for i in 0..5 loop
    c := c || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  return c;
end $$;
revoke all on function public._customer_display_code() from public, anon, authenticated;

-- Etat de l ecran tel que le CLIENT le voit (aucune reponse du client, aucune autre donnee).
create or replace function public._counter_display_json(_company uuid, _user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'mode', coalesce(cd.mode, 'accueil'),
    'payload', coalesce(cd.payload, '{}'::jsonb),
    'version', coalesce(cd.version, 0),
    'mode_changed_at', cd.mode_changed_at,
    'reply_kind', cd.reply ->> 'kind',
    'company_name', co.name,
    'bank', jsonb_build_object('beneficiary', coalesce(nullif(btrim(co.legal_name), ''), co.name), 'iban', co.iban, 'bic', co.bic),
    'payment', case when p.id is null then null else jsonb_build_object(
      'id', p.id, 'status', p.status, 'method', p.method, 'amount', p.amount, 'reference', p.qr_reference,
      'received_at', p.received_at, 'document_number', d.number,
      'customer_name', nullif(coalesce(nullif(btrim(ct.company_name), ''), btrim(concat_ws(' ', ct.first_name, ct.last_name))), '')
    ) end
  )
    from public.companies co
    left join public.counter_displays cd on cd.company_id = co.id and cd.user_id = _user
    left join public.document_payments p on p.id = cd.payment_id
    left join public.documents d on d.id = p.document_id
    left join public.contacts ct on ct.id = d.contact_id
   where co.id = _company
$$;
revoke all on function public._counter_display_json(uuid, uuid) from public, anon, authenticated;

-- 4. Appairage (tablette, sans compte) -------------------------------------------------------------
create or replace function public.customer_display_pair_begin(_user_agent text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  tok text := encode(extensions.gen_random_bytes(32), 'hex');
  code text;
  did uuid;
  exp timestamptz := now() + interval '10 minutes';
  tries int := 0;
begin
  -- Purge des demandes jamais abouties ; plafond anti-abus des demandes en cours.
  delete from public.customer_display_devices where company_id is null and created_at < now() - interval '15 minutes';
  if (select count(*) from public.customer_display_devices where company_id is null) >= 50 then
    raise exception 'Trop de demandes d''appairage en cours, réessayez dans quelques minutes.' using errcode = 'P0001';
  end if;
  loop
    code := public._customer_display_code();
    exit when not exists (select 1 from public.customer_display_devices where pairing_code = code);
    tries := tries + 1;
    if tries > 20 then raise exception 'Code indisponible, réessayez.' using errcode = 'P0001'; end if;
  end loop;
  insert into public.customer_display_devices (token_hash, channel_key, pairing_code, pairing_expires_at, user_agent)
  values (public._customer_display_hash(tok), encode(extensions.gen_random_bytes(16), 'hex'), code, exp, left(_user_agent, 300))
  returning id into did;
  return jsonb_build_object('device_id', did, 'token', tok, 'code', code, 'expires_at', exp);
end $$;

-- Au comptoir : le vendeur saisit le code ; l appareil suit SON ecran dans cette societe.
create or replace function public.customer_display_pair(_code text, _company uuid, _name text default null, _register text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  dev public.customer_display_devices%rowtype;
  c text := upper(regexp_replace(coalesce(_code, ''), '[^A-Za-z0-9]', '', 'g'));
  nm text := coalesce(nullif(btrim(_name), ''), 'Ecran client');
  reg text := upper(coalesce(nullif(btrim(_register), ''), 'CAISSE-1'));
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if length(c) <> 6 then raise exception 'Le code de l''écran a 6 caractères.' using errcode = 'P0001'; end if;
  select * into dev from public.customer_display_devices
   where pairing_code = c and company_id is null for update;
  if not found or dev.pairing_expires_at < now() then
    raise exception 'Code inconnu ou expiré : rechargez l''écran client pour obtenir un nouveau code.' using errcode = 'P0002';
  end if;
  update public.customer_display_devices
     set company_id = _company, user_id = auth.uid(), name = left(nm, 60), register_code = left(reg, 12),
         paired_at = now(), paired_by = auth.uid(), pairing_code = null, pairing_expires_at = null
   where id = dev.id;
  insert into public.counter_displays (company_id, user_id) values (_company, auth.uid())
  on conflict (company_id, user_id) do nothing;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, new_data, origin)
  values (_company, auth.uid(), 'customer_display_paired', 'customer_display_devices', dev.id::text,
          jsonb_build_object('name', left(nm, 60), 'register_code', left(reg, 12)), 'screen');
  return dev.id;
end $$;

-- Garde commune : appareil appaire de la societe, droit du vendeur lie ou d un administrateur.
create or replace function public._customer_display_lock(_device uuid, _admin_only boolean)
returns public.customer_display_devices
language plpgsql security definer set search_path = public, pg_temp as $$
declare dev public.customer_display_devices%rowtype;
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into dev from public.customer_display_devices where id = _device and company_id is not null for update;
  if not found or not public.is_member(dev.company_id) then
    raise exception 'Écran introuvable.' using errcode = 'P0002';
  end if;
  if _admin_only and not public.is_admin(dev.company_id) and dev.user_id is distinct from auth.uid() then
    raise exception 'Réservé à un administrateur ou au vendeur de cet écran.' using errcode = '42501';
  end if;
  return dev;
end $$;
revoke all on function public._customer_display_lock(uuid, boolean) from public, anon, authenticated;

-- « Prendre cet écran » : un autre vendeur au meme poste fait suivre l appareil a SON ecran.
create or replace function public.customer_display_claim(_device uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare dev public.customer_display_devices%rowtype;
begin
  dev := public._customer_display_lock(_device, false);
  if dev.revoked_at is not null then raise exception 'Écran révoqué.' using errcode = 'P0001'; end if;
  update public.customer_display_devices set user_id = auth.uid() where id = dev.id;
  insert into public.counter_displays (company_id, user_id) values (dev.company_id, auth.uid())
  on conflict (company_id, user_id) do nothing;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
  values (dev.company_id, auth.uid(), 'customer_display_claimed', 'customer_display_devices', dev.id::text,
          jsonb_build_object('user_id', dev.user_id), jsonb_build_object('user_id', auth.uid()), 'screen');
end $$;

create or replace function public.customer_display_rename(_device uuid, _name text, _register text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  dev public.customer_display_devices%rowtype;
  nm text := nullif(btrim(coalesce(_name, '')), '');
  reg text := upper(nullif(btrim(coalesce(_register, '')), ''));
begin
  dev := public._customer_display_lock(_device, true);
  if nm is null or length(nm) > 60 then raise exception 'Nom de 1 à 60 caractères.' using errcode = 'P0001'; end if;
  if reg is null or length(reg) > 12 then raise exception 'Poste de 1 à 12 caractères.' using errcode = 'P0001'; end if;
  update public.customer_display_devices set name = nm, register_code = reg where id = dev.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
  values (dev.company_id, auth.uid(), 'customer_display_renamed', 'customer_display_devices', dev.id::text,
          jsonb_build_object('name', dev.name, 'register_code', dev.register_code),
          jsonb_build_object('name', nm, 'register_code', reg), 'screen');
end $$;

create or replace function public.customer_display_revoke(_device uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare dev public.customer_display_devices%rowtype;
begin
  dev := public._customer_display_lock(_device, true);
  if dev.revoked_at is not null then return; end if;
  update public.customer_display_devices set revoked_at = now(), revoked_by = auth.uid() where id = dev.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, origin)
  values (dev.company_id, auth.uid(), 'customer_display_revoked', 'customer_display_devices', dev.id::text,
          jsonb_build_object('name', dev.name, 'register_code', dev.register_code, 'user_id', dev.user_id), 'screen');
end $$;

-- Liste des ecrans de la societe (Parametres, bouton de la caisse), avec le nom du vendeur.
create or replace function public.customer_display_list(_company uuid)
returns table (
  id uuid, name text, register_code text, user_id uuid, user_name text,
  paired_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz, server_now timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select d.id, d.name, d.register_code, d.user_id, coalesce(nullif(btrim(p.full_name), ''), p.email::text),
         d.paired_at, d.last_seen_at, d.revoked_at, now()
    from public.customer_display_devices d
    left join public.profiles p on p.id = d.user_id
   where d.company_id = _company
   order by (d.revoked_at is null) desc, d.register_code, d.name;
end $$;

-- 5. Lecture et reponse PAR JETON (la tablette, sans compte) ------------------------------------
create or replace function public.customer_display_read(_token text)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare dev public.customer_display_devices%rowtype;
begin
  if _token is null or length(_token) < 32 then return jsonb_build_object('status', 'unknown'); end if;
  select * into dev from public.customer_display_devices where token_hash = public._customer_display_hash(_token);
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  if dev.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if dev.company_id is null then
    if dev.pairing_expires_at < now() then return jsonb_build_object('status', 'expired'); end if;
    return jsonb_build_object('status', 'pending', 'code', dev.pairing_code, 'expires_at', dev.pairing_expires_at, 'now', now());
  end if;
  -- Signe de vie, ecrit au plus toutes les 15 s.
  if dev.last_seen_at is null or dev.last_seen_at < now() - interval '15 seconds' then
    update public.customer_display_devices set last_seen_at = now() where id = dev.id;
  end if;
  return jsonb_build_object(
    'status', 'paired', 'now', now(),
    'device', jsonb_build_object('name', dev.name, 'register_code', dev.register_code, 'channel', 'ecran-client-' || dev.channel_key),
    'screen', public._counter_display_json(dev.company_id, dev.user_id)
  );
end $$;

-- Le client repond depuis la tablette : son adresse e-mail (si le vendeur l autorise, ecran merci)
-- ou sa signature (ecran signature). Rien d autre n est accepte. La reponse n est lue que par le vendeur.
create or replace function public.customer_display_reply(_token text, _kind text, _data jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  dev public.customer_display_devices%rowtype;
  cd  public.counter_displays%rowtype;
  rep jsonb;
  em  text;
  png text;
  txt text;
  hsh text;
begin
  if _token is null or length(_token) < 32 then raise exception 'Écran inconnu.' using errcode = '42501'; end if;
  select * into dev from public.customer_display_devices where token_hash = public._customer_display_hash(_token);
  if not found or dev.revoked_at is not null or dev.company_id is null then
    raise exception 'Écran inconnu ou révoqué.' using errcode = '42501';
  end if;
  select * into cd from public.counter_displays where company_id = dev.company_id and user_id = dev.user_id for update;
  if not found then raise exception 'Rien à valider sur cet écran.' using errcode = 'P0001'; end if;

  if _kind = 'email' then
    if cd.mode <> 'merci' or coalesce((cd.payload ->> 'allow_email')::boolean, false) is not true then
      raise exception 'Envoi du ticket par e-mail non proposé.' using errcode = 'P0001';
    end if;
    em := lower(btrim(coalesce(_data ->> 'email', '')));
    if length(em) > 254 or em !~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
      raise exception 'Adresse e-mail invalide.' using errcode = 'P0001';
    end if;
    rep := jsonb_build_object('kind', 'email', 'email', em, 'at', now());
  elsif _kind = 'signature' then
    if cd.mode <> 'signature' then raise exception 'Aucune signature demandée.' using errcode = 'P0001'; end if;
    png := coalesce(_data ->> 'png', '');
    if left(png, 22) <> 'data:image/png;base64,' or length(png) > 600000 then
      raise exception 'Signature illisible.' using errcode = 'P0001';
    end if;
    txt := coalesce(cd.payload #>> '{signature,text}', '');
    -- Empreinte : texte signe + image (meme principe que les propositions d intervention).
    hsh := encode(extensions.digest(convert_to(txt || E'\n' || png, 'UTF8'), 'sha256'), 'hex');
    rep := jsonb_build_object('kind', 'signature', 'png', png, 'hash', hsh,
                              'signer_name', left(btrim(coalesce(_data ->> 'signer_name', '')), 120),
                              'document_id', cd.payload #>> '{signature,document_id}', 'at', now());
  else
    raise exception 'Réponse inconnue.' using errcode = 'P0001';
  end if;

  update public.counter_displays set reply = rep, reply_at = now() where id = cd.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, new_data, origin)
  values (dev.company_id, null, 'customer_display_reply', 'customer_display_devices', dev.id::text,
          case when _kind = 'signature' then jsonb_build_object('kind', 'signature', 'hash', hsh, 'document_id', cd.payload #>> '{signature,document_id}')
               else jsonb_build_object('kind', _kind) end, 'tablette');
  return jsonb_build_object('ok', true, 'kind', _kind);
end $$;

-- 6. Cote vendeur (session) -----------------------------------------------------------------------
-- Pousser l ecran : mode + ticket. Seules les cles prevues passent ; 64 Ko au plus.
create or replace function public.counter_display_set(_company uuid, _mode text, _payload jsonb)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  clean jsonb;
  v bigint;
  allowed constant text[] := array[
    'doc_type', 'document_number', 'customer_name', 'locale', 'lines', 'totals', 'vat', 'amount', 'due',
    'methods', 'qr', 'signature', 'allow_email', 'email_sent', 'thanks_seconds', 'message', 'stage'];
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if _mode is null or _mode not in ('accueil', 'ticket', 'qr', 'terminal', 'signature', 'merci') then
    raise exception 'Mode d''écran inconnu : %', _mode using errcode = 'P0001';
  end if;
  if _payload is not null and jsonb_typeof(_payload) <> 'object' then
    raise exception 'Contenu d''écran invalide.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into clean
    from jsonb_each(coalesce(_payload, '{}'::jsonb)) e
   where e.key = any(allowed);
  if jsonb_typeof(clean -> 'lines') = 'array' and jsonb_array_length(clean -> 'lines') > 200 then
    raise exception 'Ticket trop long pour l''écran (200 lignes au plus).' using errcode = 'P0001';
  end if;
  if octet_length(clean::text) > 65536 then
    raise exception 'Contenu d''écran trop volumineux.' using errcode = 'P0001';
  end if;
  if _mode = 'accueil' then clean := '{}'::jsonb; end if;

  insert into public.counter_displays (company_id, user_id, mode, payload)
  values (_company, auth.uid(), _mode, clean)
  on conflict (company_id, user_id) do update
     set mode = excluded.mode, payload = excluded.payload,
         -- un QR de virement en attente reste affiche seulement en mode qr / merci
         payment_id = case when excluded.mode in ('qr', 'merci') then public.counter_displays.payment_id else null end
  returning version into v;
  return v;
end $$;

-- Ce que voit le vendeur : l ecran du client (apercu) + la reponse du client + ses appareils.
create or replace function public.counter_display_state(_company uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'now', now(),
    'screen', public._counter_display_json(_company, auth.uid()),
    'reply', (select cd.reply from public.counter_displays cd where cd.company_id = _company and cd.user_id = auth.uid()),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'register_code', d.register_code, 'last_seen_at', d.last_seen_at)
                       order by d.register_code, d.name)
        from public.customer_display_devices d
       where d.company_id = _company and d.user_id = auth.uid() and d.revoked_at is null), '[]'::jsonb)
  );
end $$;

-- Le vendeur a traite la reponse (signature rangee en GED, ticket envoye) : on l efface.
create or replace function public.counter_display_reply_clear(_company uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  update public.counter_displays set reply = null, reply_at = null
   where company_id = _company and user_id = auth.uid() and reply is not null;
end $$;

-- 7. Droits -----------------------------------------------------------------------------------
revoke all on function public.customer_display_pair_begin(text) from public;
revoke all on function public.customer_display_read(text) from public;
revoke all on function public.customer_display_reply(text, text, jsonb) from public;
grant execute on function public.customer_display_pair_begin(text) to anon, authenticated;
grant execute on function public.customer_display_read(text) to anon, authenticated;
grant execute on function public.customer_display_reply(text, text, jsonb) to anon, authenticated;

revoke all on function public.customer_display_pair(text, uuid, text, text) from public, anon;
revoke all on function public.customer_display_claim(uuid) from public, anon;
revoke all on function public.customer_display_rename(uuid, text, text) from public, anon;
revoke all on function public.customer_display_revoke(uuid) from public, anon;
revoke all on function public.customer_display_list(uuid) from public, anon;
revoke all on function public.counter_display_set(uuid, text, jsonb) from public, anon;
revoke all on function public.counter_display_state(uuid) from public, anon;
revoke all on function public.counter_display_reply_clear(uuid) from public, anon;
grant execute on function public.customer_display_pair(text, uuid, text, text) to authenticated;
grant execute on function public.customer_display_claim(uuid) to authenticated;
grant execute on function public.customer_display_rename(uuid, text, text) to authenticated;
grant execute on function public.customer_display_revoke(uuid) to authenticated;
grant execute on function public.customer_display_list(uuid) to authenticated;
grant execute on function public.counter_display_set(uuid, text, jsonb) to authenticated;
grant execute on function public.counter_display_state(uuid) to authenticated;
grant execute on function public.counter_display_reply_clear(uuid) to authenticated;

notify pgrst, 'reload schema';
