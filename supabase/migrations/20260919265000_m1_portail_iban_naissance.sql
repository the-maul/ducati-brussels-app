-- =====================================================================
-- MISSION 04 — CARTE 5 : « Naissance, IBAN et n° TVA complétés par le client
-- dans son espace ».
-- Migration ADDITIVE : une colonne, une fonction nouvelle, deux fonctions du
-- portail remplacées en GARDANT tout l'existant (liste blanche élargie), la
-- contrainte `kind` de team_notifications élargie (aucun type retiré) et un type
-- d'alerte de plus dans can_see_team_notification.
--
--  1. contacts.birth_place : lieu de naissance (vidéo 1:39, « CP/ville de naissance »).
--  2. iban_is_valid(text) : contrôle ISO 13616 (modulo 97), même règle que
--     isValidIban (src/lib/contact-normalize.ts).
--  3. team_notifications : nouveau type 'client_iban_changed' (cloche), visible des
--     rôles admin, comptable et vendeur.
--  4. portal_profile() : renvoie aussi birth_place, iban, bic.
--  5. portal_update_profile(p) : accepte aussi birth_place, iban, bic ; le n° de TVA
--     est ouvert aux particuliers (la raison sociale reste réservée aux pros).
--     Un changement d'IBAN par le client : ligne `events` (action
--     'portal_iban_changed', origine 'portal') + alerte dans la cloche de l'équipe.
-- =====================================================================

-- ------------------------------------------------ 1. Lieu de naissance
alter table public.contacts add column if not exists birth_place text;
comment on column public.contacts.birth_place is
  'Mission 04 : lieu de naissance (localité, éventuellement code postal), saisi au comptoir ou par le client dans son espace.';

-- ------------------------------------------------ 2. Contrôle IBAN
create or replace function public.iban_is_valid(_iban text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  s text := upper(regexp_replace(coalesce(_iban, ''), '[[:space:].-]', '', 'g'));
  m text;
  v text;
  ch text;
  r int := 0;
  i int;
  j int;
begin
  if s !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then return false; end if;
  if left(s, 2) = 'BE' and length(s) <> 16 then return false; end if;
  m := substr(s, 5) || left(s, 4);
  for i in 1 .. length(m) loop
    ch := substr(m, i, 1);
    v := case when ch ~ '[A-Z]' then (ascii(ch) - 55)::text else ch end;
    for j in 1 .. length(v) loop
      r := (r * 10 + substr(v, j, 1)::int) % 97;
    end loop;
  end loop;
  return r = 1;
end $fn$;
comment on function public.iban_is_valid(text) is
  'Mission 04 carte 5 : IBAN valide (format + modulo 97, 16 caractères pour la Belgique).';
revoke all on function public.iban_is_valid(text) from public, anon;
grant execute on function public.iban_is_valid(text) to authenticated, service_role;

-- ------------------------------------------------ 3. Nouveau type d'alerte (cloche)
-- La contrainte est reconstruite à partir des types DÉJÀ autorisés (lus dans la
-- définition actuelle) + le nouveau : aucun type ajouté par un autre lot n'est perdu.
do $do$
declare
  _def text;
  _kinds text[];
begin
  select pg_get_constraintdef(c.oid) into _def
    from pg_constraint c
   where c.conrelid = 'public.team_notifications'::regclass
     and c.conname = 'team_notifications_kind_check';
  select array_agg(distinct k order by k) into _kinds
    from (
      select (regexp_matches(coalesce(_def, ''), '''([a-z_]+)''', 'g'))[1] as k
      union select 'signup'
      union select 'client_iban_changed'
    ) x;
  alter table public.team_notifications drop constraint if exists team_notifications_kind_check;
  execute format(
    'alter table public.team_notifications add constraint team_notifications_kind_check check (kind = any (%L::text[]))',
    _kinds);
end $do$;

comment on table public.team_notifications is
  'Alertes internes affichées dans la cloche de la barre du haut (membres de la société). '
  'Aucun envoi : ce n''est PAS la file d''envoi e-mail/SMS (table notifications). '
  'kind = signup : un client s''est inscrit (origin web = en ligne, comptoir = borne) ; '
  'kind = client_iban_changed : un client a modifié son IBAN dans son espace (mission 04).';

-- Visibilité par type (décision N-1 + mission 04). Types inconnus : tout membre.
create or replace function public.can_see_team_notification(_company uuid, _kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case _kind
    when 'signup' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'vendeur')
      or public.has_role(_company, 'marketing')
    when 'client_iban_changed' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'comptable')
      or public.has_role(_company, 'vendeur')
    else public.is_member(_company)
  end;
$fn$;
comment on function public.can_see_team_notification(uuid, text) is
  'Décision N-1 : alerte « inscription » visible des rôles admin, vendeur, marketing. '
  'Mission 04 : alerte « IBAN modifié par le client » visible des rôles admin, comptable, vendeur.';
revoke all on function public.can_see_team_notification(uuid, text) from public, anon;
grant execute on function public.can_see_team_notification(uuid, text) to authenticated, service_role;

-- ------------------------------------------------ 4. Profil lu par l'espace client
create or replace function public.portal_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select jsonb_build_object(
    'civility', c.civility, 'first_name', c.first_name, 'last_name', c.last_name,
    'email', c.email, 'mobile', c.mobile, 'phone', c.phone,
    'address', c.address, 'street_number', c.street_number, 'address_complement', c.address_complement,
    'zip', c.zip, 'city', c.city, 'country', c.country, 'birth_date', c.birth_date,
    'birth_place', c.birth_place,
    'is_pro', c.type = 'professionnel', 'company_name', c.company_name, 'vat_number', c.vat_number,
    'vies_valid', c.vies_valid, 'iban', c.iban, 'bic', c.bic,
    'contact_preference', c.contact_preference,
    'marketing_opt_out', c.marketing_opt_out, 'license_number', c.license_number,
    'dealer', co.name,
    'avatar_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'avatar'),
    'license_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'permis'))
  into _r
  from public.contacts c join public.companies co on co.id = c.company_id
  where c.id = _ctx.contact_id and c.company_id = _ctx.company_id;
  return _r;
end $fn$;
revoke all on function public.portal_profile() from public, anon;
grant execute on function public.portal_profile() to authenticated;

-- ------------------------------------------------ 5. Profil modifié par le client
create or replace function public.portal_update_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _ctx record; _k text; _is_pro boolean; _old_vat text; _new_vat text; _bd date; _pref text; _country text;
  _old_iban text; _new_iban text; _new_bic text; _name text;
  _allowed constant text[] := array['civility','first_name','last_name','mobile','phone','address',
    'street_number','address_complement','zip','city','country','birth_date','company_name',
    'vat_number','contact_preference','marketing_opt_out','license_number',
    -- mission 04, carte 5
    'birth_place','iban','bic'];
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'portal: invalid payload' using errcode = '22023'; end if;

  for _k in select jsonb_object_keys(p) loop
    if not (_k = any(_allowed)) then
      raise exception 'portal: field not allowed: %', _k using errcode = '42501';
    end if;
  end loop;

  select c.type = 'professionnel', c.vat_number, c.iban into _is_pro, _old_vat, _old_iban
  from public.contacts c where c.id = _ctx.contact_id;

  -- Mission 04 : le n° de TVA est ouvert aux particuliers ; la raison sociale reste aux pros.
  if p ? 'company_name' and not _is_pro then
    raise exception 'portal: company fields reserved to professional accounts' using errcode = '42501';
  end if;

  if p ? 'birth_date' and nullif(trim(p->>'birth_date'), '') is not null then
    begin _bd := (p->>'birth_date')::date;
    exception when others then raise exception 'portal: invalid birth_date' using errcode = '22023'; end;
    if _bd < date '1900-01-01' or _bd > (current_date - interval '14 years') then
      raise exception 'portal: invalid birth_date' using errcode = '22023';
    end if;
  end if;
  if p ? 'contact_preference' then
    _pref := nullif(trim(p->>'contact_preference'), '');
    if _pref is not null and _pref not in ('email', 'telephone', 'sms', 'whatsapp') then
      raise exception 'portal: invalid contact_preference' using errcode = '22023';
    end if;
  end if;
  if p ? 'country' then
    _country := upper(trim(coalesce(p->>'country', '')));
    if _country !~ '^[A-Z]{2}$' then raise exception 'portal: invalid country' using errcode = '22023'; end if;
  end if;
  if p ? 'marketing_opt_out' and jsonb_typeof(p->'marketing_opt_out') <> 'boolean' then
    raise exception 'portal: invalid marketing_opt_out' using errcode = '22023';
  end if;
  if (p ? 'mobile' and coalesce(p->>'mobile', '') !~ '^[0-9 +()./-]{0,40}$')
     or (p ? 'phone' and coalesce(p->>'phone', '') !~ '^[0-9 +()./-]{0,40}$') then
    raise exception 'portal: invalid phone' using errcode = '22023';
  end if;
  _new_vat := case when p ? 'vat_number' then nullif(upper(regexp_replace(coalesce(p->>'vat_number', ''), '[^A-Za-z0-9]', '', 'g')), '') else _old_vat end;
  if _new_vat is not null and length(_new_vat) > 20 then
    raise exception 'portal: invalid vat_number' using errcode = '22023';
  end if;
  -- IBAN : sans espaces, majuscules, contrôle modulo 97.
  _new_iban := case when p ? 'iban' then nullif(upper(regexp_replace(coalesce(p->>'iban', ''), '[^A-Za-z0-9]', '', 'g')), '') else _old_iban end;
  if p ? 'iban' and _new_iban is not null and not public.iban_is_valid(_new_iban) then
    raise exception 'portal: invalid iban' using errcode = '22023';
  end if;
  if p ? 'bic' then
    _new_bic := nullif(upper(regexp_replace(coalesce(p->>'bic', ''), '[^A-Za-z0-9]', '', 'g')), '');
    if _new_bic is not null and _new_bic !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' then
      raise exception 'portal: invalid bic' using errcode = '22023';
    end if;
  end if;

  update public.contacts c set
    civility           = case when p ? 'civility' then left(nullif(upper(trim(p->>'civility')), ''), 20) else c.civility end,
    first_name         = case when p ? 'first_name' then left(nullif(upper(trim(p->>'first_name')), ''), 100) else c.first_name end,
    last_name          = case when p ? 'last_name' then left(nullif(upper(trim(p->>'last_name')), ''), 100) else c.last_name end,
    mobile             = case when p ? 'mobile' then nullif(trim(p->>'mobile'), '') else c.mobile end,
    phone              = case when p ? 'phone' then nullif(trim(p->>'phone'), '') else c.phone end,
    address            = case when p ? 'address' then left(nullif(upper(trim(p->>'address')), ''), 200) else c.address end,
    street_number      = case when p ? 'street_number' then left(nullif(upper(trim(p->>'street_number')), ''), 20) else c.street_number end,
    address_complement = case when p ? 'address_complement' then left(nullif(upper(trim(p->>'address_complement')), ''), 200) else c.address_complement end,
    zip                = case when p ? 'zip' then left(nullif(upper(trim(p->>'zip')), ''), 12) else c.zip end,
    city               = case when p ? 'city' then left(nullif(upper(trim(p->>'city')), ''), 100) else c.city end,
    country            = case when p ? 'country' then _country else c.country end,
    birth_date         = case when p ? 'birth_date' then _bd else c.birth_date end,
    birth_place        = case when p ? 'birth_place' then left(nullif(upper(trim(p->>'birth_place')), ''), 100) else c.birth_place end,
    license_number     = case when p ? 'license_number' then left(nullif(upper(trim(p->>'license_number')), ''), 40) else c.license_number end,
    company_name       = case when p ? 'company_name' then left(nullif(upper(trim(p->>'company_name')), ''), 200) else c.company_name end,
    vat_number         = _new_vat,
    vies_valid         = case when _new_vat is distinct from _old_vat then null else c.vies_valid end,
    vies_checked_at    = case when _new_vat is distinct from _old_vat then null else c.vies_checked_at end,
    iban               = _new_iban,
    bic                = case when p ? 'bic' then _new_bic else c.bic end,
    contact_preference = case when p ? 'contact_preference' then _pref else c.contact_preference end,
    marketing_opt_out  = case when p ? 'marketing_opt_out' then (p->>'marketing_opt_out')::boolean else c.marketing_opt_out end
  where c.id = _ctx.contact_id and c.company_id = _ctx.company_id;

  -- Changement d'IBAN par le client : trace + alerte de l'équipe (cloche).
  if _new_iban is distinct from _old_iban then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_ctx.company_id, auth.uid(), 'portal_iban_changed', 'contacts', _ctx.contact_id::text, 'portal',
            jsonb_build_object('iban', _old_iban), jsonb_build_object('iban', _new_iban));

    select nullif(btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), ''))), '')
      into _name from public.contacts c where c.id = _ctx.contact_id;
    insert into public.team_notifications (company_id, kind, contact_id, title, origin)
    values (_ctx.company_id, 'client_iban_changed', _ctx.contact_id, coalesce(_name, '—'), null);
  end if;

  return public.portal_profile();
end $fn$;
revoke all on function public.portal_update_profile(jsonb) from public, anon;
grant execute on function public.portal_update_profile(jsonb) to authenticated;
