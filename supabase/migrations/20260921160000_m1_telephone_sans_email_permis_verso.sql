-- =====================================================================
-- MISSION 01 — Carte « Inscription en ligne : créer mon compte et choisir ma moto »
-- Retour client du 21/09 (vidéo) : dans l'espace client, le GSM affichait
-- « +32 desouter.d@gmail.com ». L'adresse e-mail avait été enregistrée comme
-- numéro de mobile à l'inscription.
--
-- CAUSE : à l'inscription (/inscription), le champ « Téléphone » acceptait n'importe
-- quel texte (server function signup.functions.ts : `z.string().max(40)`, puis
-- `signup_register` recopie tel quel dans contacts.mobile). Le gestionnaire de mots
-- de passe du navigateur, qui venait d'enregistrer « desouter.d@gmail.com » comme
-- identifiant, a rempli le champ téléphone (le champ e-mail ne portait pas
-- autocomplete="username"). L'espace client, lui, refusait déjà ce texte
-- (portal_update_profile), mais le mal était fait. Corrigé côté écran et serveur
-- (même lot) ; cette migration :
--
--   1. RÉPARE les fiches existantes dont mobile, gsm ou téléphone contient « @ » :
--      l'adresse va dans `email` si celui-ci est vide, sinon le champ est vidé.
--      Une ligne `events` par fiche corrigée (action `contact_phone_email_repair`,
--      origine `system`), avec les anciennes valeurs : rien n'est perdu.
--      (Le déclencheur d'audit générique trg_contacts_audit écrit aussi sa ligne.)
--   2. GARDE-FOU en base pour toutes les entrées (inscription, borne, CRM, relève
--      mail, import) : déclencheur BEFORE INSERT/UPDATE qui applique la même règle,
--      tracée dans `events` (action `contact_phone_email_guard`).
--   3. PERMIS RECTO / VERSO : nouveau type de dépôt `permis_verso` (le type
--      existant `permis` devient le recto) ; portal_profile renvoie aussi
--      `license_back_path` ; l'étape « Votre permis de conduire » de l'accueil est
--      faite avec le numéro de permis OU les deux photos.
--
-- NON DESTRUCTIVE : aucune colonne ni table supprimée ; les valeurs retirées des
-- champs téléphone sont conservées dans events.old_data.
--
-- À VÉRIFIER AVANT D'APPLIQUER (dérive code/base connue) : portal_home et
-- portal_prepare_upload sont redéfinies ici à partir du dépôt
-- (20260919120000_m0_portail_client.sql), portal_profile à partir de
-- 20260919265000_m1_portail_iban_naissance.sql. Si la base contient une version plus
-- récente (pg_get_functiondef), reporter la différence avant d'appliquer.
-- =====================================================================

-- ------------------------------------------------ 0. Aide : adresse contenue dans un « numéro »
-- « +32 desouter.d@gmail.com » → « desouter.d@gmail.com » (préfixe pays retiré,
-- minuscules). NULL si le texte ne ressemble pas à une adresse e-mail.
create or replace function public.contact_email_in_phone(_v text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case when x ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then x end
  from (select lower(btrim(regexp_replace(coalesce(_v, ''), '^\s*(\+|00)[0-9]{1,3}\s*', ''))) as x) y;
$fn$;
comment on function public.contact_email_in_phone(text) is
  'Retour client 21/09 : adresse e-mail rangée par erreur dans un champ téléphone (préfixe pays retiré), sinon NULL.';
revoke all on function public.contact_email_in_phone(text) from public, anon;
grant execute on function public.contact_email_in_phone(text) to authenticated, service_role;

-- ------------------------------------------------ 1. Réparation des fiches existantes
do $$
declare
  _c        record;
  _email    text;
  _new_mail text;
  _mobile   text;
  _gsm      text;
  _phone    text;
  _cand     text;
  _n        integer := 0;
begin
  for _c in
    select id, company_id, email, email_pro, mobile, gsm, phone
      from public.contacts
     where position('@' in coalesce(mobile, '')) > 0
        or position('@' in coalesce(gsm, '')) > 0
        or position('@' in coalesce(phone, '')) > 0
     order by id
     for update
  loop
    _email := nullif(btrim(coalesce(_c.email, '')), '');
    _new_mail := _email;
    _mobile := _c.mobile; _gsm := _c.gsm; _phone := _c.phone;

    -- Ordre : mobile, puis gsm, puis téléphone. La première adresse valide remplit
    -- un e-mail vide ; les autres champs fautifs sont simplement vidés.
    if position('@' in coalesce(_mobile, '')) > 0 then
      _cand := public.contact_email_in_phone(_mobile);
      if _new_mail is null and _cand is not null then _new_mail := _cand; end if;
      _mobile := null;
    end if;
    if position('@' in coalesce(_gsm, '')) > 0 then
      _cand := public.contact_email_in_phone(_gsm);
      if _new_mail is null and _cand is not null then _new_mail := _cand; end if;
      _gsm := null;
    end if;
    if position('@' in coalesce(_phone, '')) > 0 then
      _cand := public.contact_email_in_phone(_phone);
      if _new_mail is null and _cand is not null then _new_mail := _cand; end if;
      _phone := null;
    end if;

    update public.contacts
       set mobile = _mobile, gsm = _gsm, phone = _phone, email = _new_mail
     where id = _c.id;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_c.company_id, null, 'contact_phone_email_repair', 'contacts', _c.id::text, 'system',
            jsonb_build_object('email', _c.email, 'mobile', _c.mobile, 'gsm', _c.gsm, 'phone', _c.phone),
            jsonb_build_object('email', _new_mail, 'mobile', _mobile, 'gsm', _gsm, 'phone', _phone,
                               'reason', 'Adresse e-mail trouvée dans un champ téléphone (migration 20260921160000)'));
    _n := _n + 1;
  end loop;
  raise notice 'contact_phone_email_repair : % fiche(s) corrigée(s)', _n;
end $$;

-- ------------------------------------------------ 2. Garde-fou pour les prochaines saisies
create or replace function public.trg_contacts_phone_not_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _old  jsonb := jsonb_build_object('email', new.email, 'mobile', new.mobile, 'gsm', new.gsm, 'phone', new.phone);
  _hit  boolean := false;
  _cand text;
begin
  if position('@' in coalesce(new.mobile, '')) > 0 then
    _cand := public.contact_email_in_phone(new.mobile);
    if nullif(btrim(coalesce(new.email, '')), '') is null and _cand is not null then new.email := _cand; end if;
    new.mobile := null; _hit := true;
  end if;
  if position('@' in coalesce(new.gsm, '')) > 0 then
    _cand := public.contact_email_in_phone(new.gsm);
    if nullif(btrim(coalesce(new.email, '')), '') is null and _cand is not null then new.email := _cand; end if;
    new.gsm := null; _hit := true;
  end if;
  if position('@' in coalesce(new.phone, '')) > 0 then
    _cand := public.contact_email_in_phone(new.phone);
    if nullif(btrim(coalesce(new.email, '')), '') is null and _cand is not null then new.email := _cand; end if;
    new.phone := null; _hit := true;
  end if;

  if _hit then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (new.company_id, auth.uid(), 'contact_phone_email_guard', 'contacts', new.id::text, 'system',
            _old,
            jsonb_build_object('email', new.email, 'mobile', new.mobile, 'gsm', new.gsm, 'phone', new.phone,
                               'reason', 'Adresse e-mail refusée dans un champ téléphone'));
  end if;
  return new;
end $fn$;
comment on function public.trg_contacts_phone_not_email() is
  'Retour client 21/09 : une adresse e-mail n''est jamais enregistrée comme téléphone (mobile, gsm, phone) ; '
  'elle va dans l''e-mail s''il est vide, sinon le champ est vidé. Tracé dans events.';
revoke all on function public.trg_contacts_phone_not_email() from public, anon, authenticated;

drop trigger if exists trg_contacts_phone_not_email on public.contacts;
create trigger trg_contacts_phone_not_email
  before insert or update of mobile, gsm, phone on public.contacts
  for each row execute function public.trg_contacts_phone_not_email();

-- ------------------------------------------------ 3. Permis : recto (permis) et verso (permis_verso)
do $$
declare _c record;
begin
  for _c in
    select conname from pg_constraint
     where conrelid = 'public.portal_uploads'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.portal_uploads drop constraint %I', _c.conname);
  end loop;
  alter table public.portal_uploads add constraint portal_uploads_kind_check
    check (kind in ('avatar', 'permis', 'permis_verso', 'vehicle_photo', 'carte_grise',
                    'assurance', 'coc', 'controle_technique', 'autre'));
end $$;
comment on column public.portal_uploads.kind is
  'Type de dépôt. permis = recto du permis de conduire, permis_verso = verso (retour client 21/09).';

-- Étape 1 du dépôt : identique à 20260919120000, avec `permis_verso` (fiche du client).
create or replace function public.portal_prepare_upload(
  p_kind text, p_vehicle_id uuid, p_file_name text, p_content_type text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _ctx record; _id uuid := gen_random_uuid(); _entity_type text; _entity uuid; _ext text; _path text; _recent int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;

  if p_kind in ('avatar', 'permis', 'permis_verso') then
    _entity_type := 'contact'; _entity := _ctx.contact_id;
  elsif p_kind in ('vehicle_photo', 'carte_grise', 'assurance', 'coc', 'controle_technique', 'autre') then
    if p_vehicle_id is null or not public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, p_vehicle_id) then
      raise exception 'portal: vehicle not found' using errcode = 'P0002';
    end if;
    _entity_type := 'vehicle'; _entity := p_vehicle_id;
  else
    raise exception 'portal: invalid kind' using errcode = '22023';
  end if;

  _ext := case lower(coalesce(p_content_type, ''))
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'application/pdf' then 'pdf' end;
  if _ext is null then raise exception 'portal: file type not allowed' using errcode = '22023'; end if;
  if p_kind in ('avatar', 'vehicle_photo') and _ext = 'pdf' then
    raise exception 'portal: a photo is expected' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 15 * 1024 * 1024 then
    raise exception 'portal: file too large' using errcode = '22023';
  end if;
  select count(*) into _recent from public.portal_uploads
  where user_id = auth.uid() and created_at > now() - interval '24 hours';
  if _recent >= 40 then raise exception 'portal: too many uploads' using errcode = '54000'; end if;

  _path := _ctx.company_id::text || '/' || _entity_type || '/' || _entity::text || '/portail_' || _id::text || '.' || _ext;
  insert into public.portal_uploads (id, company_id, contact_id, user_id, entity_type, entity_id, kind,
    storage_path, file_name, content_type, size_bytes)
  values (_id, _ctx.company_id, _ctx.contact_id, auth.uid(), _entity_type, _entity, p_kind, _path,
    left(coalesce(nullif(trim(p_file_name), ''), p_kind || '.' || _ext), 150), lower(p_content_type), p_size);
  return jsonb_build_object('upload_id', _id, 'path', _path);
end $$;

-- Profil : identique à 20260919265000, avec `license_back_path` (verso).
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
    'license_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'permis'),
    'license_back_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'permis_verso'))
  into _r
  from public.contacts c join public.companies co on co.id = c.company_id
  where c.id = _ctx.contact_id and c.company_id = _ctx.company_id;
  return _r;
end $fn$;
revoke all on function public.portal_profile() from public, anon;
grant execute on function public.portal_profile() to authenticated;

-- Accueil : identique à 20260919120000, sauf l'étape « permis » : numéro de permis
-- OU les deux photos (recto et verso).
create or replace function public.portal_home()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  _ctx record; _c record; _steps jsonb := '[]'::jsonb; _v record; _done int := 0; _total int := 0;
  _next jsonb; _pending int; _nv int; _ni int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select * into _c from public.contacts where id = _ctx.contact_id;

  _steps := _steps || jsonb_build_object('key', 'coordonnees', 'done',
    coalesce(_c.mobile, _c.phone) is not null and _c.address is not null and _c.zip is not null and _c.city is not null);
  _steps := _steps || jsonb_build_object('key', 'avatar', 'done',
    public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'avatar') is not null);
  _steps := _steps || jsonb_build_object('key', 'preferences', 'done', _c.contact_preference is not null);
  _steps := _steps || jsonb_build_object('key', 'permis', 'done',
    _c.license_number is not null
    or (public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'permis') is not null
        and public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'permis_verso') is not null));
  if _c.type = 'professionnel' then
    _steps := _steps || jsonb_build_object('key', 'societe', 'done', _c.company_name is not null and _c.vat_number is not null);
  end if;
  for _v in
    select v.id, public._portal_vehicle_label(v.id) as label
    from public.vehicle_owners vo join public.vehicles v on v.id = vo.vehicle_id
    where vo.contact_id = _ctx.contact_id and vo.is_current and v.company_id = _ctx.company_id
    order by vo.from_date desc limit 5
  loop
    _steps := _steps
      || jsonb_build_object('key', 'vehicle_photo', 'vehicle_id', _v.id, 'vehicle_label', _v.label, 'done',
           public._portal_last_upload(_ctx.contact_id, _v.id, 'vehicle_photo') is not null)
      || jsonb_build_object('key', 'carte_grise', 'vehicle_id', _v.id, 'vehicle_label', _v.label, 'done',
           public._portal_last_upload(_ctx.contact_id, _v.id, 'carte_grise') is not null)
      || jsonb_build_object('key', 'assurance', 'vehicle_id', _v.id, 'vehicle_label', _v.label, 'done',
           public._portal_last_upload(_ctx.contact_id, _v.id, 'assurance') is not null);
  end loop;
  select count(*), count(*) filter (where (s->>'done')::boolean) into _total, _done from jsonb_array_elements(_steps) s;

  select jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'status', a.status,
           'work_description', a.work_description,
           'vehicle_label', case when a.vehicle_id is not null then public._portal_vehicle_label(a.vehicle_id) end)
    into _next
  from public.workshop_appointments a
  where a.contact_id = _ctx.contact_id and a.company_id = _ctx.company_id
    and a.status in ('prevu', 'arrive', 'en_cours', 'demande') and a.starts_at >= now() - interval '12 hours'
  order by a.starts_at limit 1;
  select count(*) into _pending from public.workshop_appointments
  where contact_id = _ctx.contact_id and company_id = _ctx.company_id and status = 'demande';
  select count(*) into _nv from public.vehicle_owners vo join public.vehicles v on v.id = vo.vehicle_id
  where vo.contact_id = _ctx.contact_id and vo.is_current and v.company_id = _ctx.company_id;
  select count(*) into _ni from public.documents d
  where d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id
    and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee');

  return jsonb_build_object(
    'first_name', _c.first_name, 'last_name', _c.last_name, 'company_name', _c.company_name,
    'steps', _steps, 'steps_done', _done, 'steps_total', _total,
    'progress', case when _total = 0 then 100 else round(100.0 * _done / _total) end,
    'vehicles_count', _nv, 'invoices_count', _ni, 'pending_requests', _pending,
    'next_appointment', _next);
end $$;
