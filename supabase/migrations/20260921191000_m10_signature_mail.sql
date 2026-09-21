-- =====================================================================
-- M10 — Carte ERP « Signature de mail selon l'adresse d'envoi »
-- Retour client du 21/09 : « Mettre une belle signature à la fin de chaque mail en
-- fonction du mail utilisé. » Modèles : nom en gras, fonction en gris italique, nom de
-- la concession en rouge gras, adresse, T :, E : (adresse d'envoi), lien vers le site.
--
-- La signature est ajoutée par la fonction serveur `graph-send-email` à TOUS les envois
-- (CRM, documents de vente, fournisseurs), selon l'adresse d'envoi :
--   - adresse PERSONNELLE de l'utilisateur → son nom (profiles.full_name) + sa fonction
--     (profiles.job_title, NOUVEAU) ;
--   - BOÎTE PARTAGÉE → nom de la boîte (company_mailboxes.signature_name, NOUVEAU),
--     sans personne.
-- Suivent les coordonnées de la société (companies.mail_signature_*, NOUVEAU), réglables
-- par société dans Paramètres → Sociétés → « Signature des e-mails ».
--
-- Aucune donnée personnelle ni adresse réelle dans ce fichier : le nom de la concession,
-- l'adresse et le téléphone se saisissent à l'écran (ou par l'intégrateur, voir rapport).
-- Seuls le lien public du site et son libellé sont préremplis (même valeur que la
-- constante PUBLIC_SITE_URL de src/modules/signup/app-client-page.tsx).
--
-- Écritures par deux fonctions tracées dans `events` :
--   - set_user_mail_signature(_user, _full_name, _job_title) : l'utilisateur pour
--     lui-même, ou un administrateur d'une société où l'utilisateur a un rôle ;
--   - set_company_mail_signature(_company, _settings jsonb) : administrateur de la société
--     (coordonnées + nom de chaque boîte partagée).
-- Lecture : get_user_mail_signature(_user) (mêmes droits) ; les colonnes de companies et
-- company_mailboxes sont lisibles par les membres (politiques existantes).
--
-- NON DESTRUCTIVE : uniquement des colonnes ajoutées (nullable) et des fonctions.
-- =====================================================================

-- ------------------------------------------------ 1. Colonnes
alter table public.profiles add column if not exists job_title text;
comment on column public.profiles.job_title is
  'Fonction affichée sous le nom dans la signature des e-mails (ex. « Sales Manager »). '
  'Réglable par l''utilisateur (menu du compte) et par l''administrateur (Paramètres → Utilisateurs).';

alter table public.company_mailboxes add column if not exists signature_name text;
comment on column public.company_mailboxes.signature_name is
  'Nom de la boîte partagée en tête de signature (ex. « Service commercial »), sans personne. '
  'Vide = la signature commence par le nom de la concession.';

alter table public.companies add column if not exists mail_signature_brand text;
alter table public.companies add column if not exists mail_signature_address text;
alter table public.companies add column if not exists mail_signature_phone text;
alter table public.companies add column if not exists mail_signature_site_url text;
alter table public.companies add column if not exists mail_signature_site_label text;
comment on column public.companies.mail_signature_brand is
  'Signature des e-mails : nom de la concession (en rouge gras). Vide = nom de la société.';
comment on column public.companies.mail_signature_address is
  'Signature des e-mails : ligne d''adresse. Vide = adresse, code postal et ville de la société.';
comment on column public.companies.mail_signature_phone is
  'Signature des e-mails : téléphone au format E.164 (+3223853282), affiché « +32 (0) 2 385 32 82 ».';
comment on column public.companies.mail_signature_site_url is
  'Signature des e-mails : lien du site public (https://…).';
comment on column public.companies.mail_signature_site_label is
  'Signature des e-mails : texte souligné du lien vers le site.';

-- Garde-fous légers (valeurs saisies à l'écran) : lien en https, téléphone E.164.
do $$ begin
  alter table public.companies add constraint companies_mail_signature_site_url_chk
    check (mail_signature_site_url is null or mail_signature_site_url ~ '^https://[^[:space:]]+$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.companies add constraint companies_mail_signature_phone_chk
    check (mail_signature_phone is null or mail_signature_phone ~ '^\+[1-9][0-9]{7,14}$');
exception when duplicate_object then null; end $$;

-- Lien public du site (W-1 / S-3 : ducatibruxelles.be = site Shopify) et son libellé.
update public.companies
   set mail_signature_site_url = coalesce(mail_signature_site_url, 'https://ducatibruxelles.be'),
       mail_signature_site_label = coalesce(mail_signature_site_label, 'Ducati Bruxelles - Ducati Store officiel')
 where mail_signature_site_url is null or mail_signature_site_label is null;

-- ------------------------------------------------ 2. Droits : qui règle la signature de qui
-- Vrai si l'appelant est l'utilisateur lui-même, ou administrateur d'une société où
-- l'utilisateur a un rôle.
create or replace function public._can_edit_user_signature(_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select auth.uid() is not null and (
    _user = auth.uid()
    or exists (
      select 1 from public.user_roles ur
       where ur.user_id = _user and public.is_admin(ur.company_id)
    )
  );
$fn$;
revoke all on function public._can_edit_user_signature(uuid) from public, anon;
grant execute on function public._can_edit_user_signature(uuid) to authenticated;

-- ------------------------------------------------ 3. Lecture / écriture de la signature d'un utilisateur
create or replace function public.get_user_mail_signature(_user uuid)
returns table (full_name text, job_title text, email text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public._can_edit_user_signature(_user) then
    raise exception 'signature: forbidden' using errcode = '42501';
  end if;
  return query select p.full_name, p.job_title, p.email from public.profiles p where p.id = _user;
end $fn$;
revoke all on function public.get_user_mail_signature(uuid) from public, anon;
grant execute on function public.get_user_mail_signature(uuid) to authenticated;

create or replace function public.set_user_mail_signature(_user uuid, _full_name text, _job_title text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _old     record;
  _name    text := nullif(btrim(coalesce(_full_name, '')), '');
  _title   text := nullif(btrim(coalesce(_job_title, '')), '');
  _company uuid;
begin
  if not public._can_edit_user_signature(_user) then
    raise exception 'signature: forbidden' using errcode = '42501';
  end if;
  if length(coalesce(_name, '')) > 120 or length(coalesce(_title, '')) > 80 then
    raise exception 'signature: too long' using errcode = '22001';
  end if;

  select full_name, job_title, default_company_id into _old from public.profiles where id = _user for update;
  if not found then raise exception 'signature: unknown user' using errcode = 'P0002'; end if;
  if _old.full_name is not distinct from _name and _old.job_title is not distinct from _title then
    return;
  end if;

  update public.profiles
     set full_name = coalesce(_name, full_name),   -- le nom n'est jamais vidé
         job_title = _title
   where id = _user;

  -- Société de la trace : celle administrée par l'appelant (admin), sinon la société par défaut.
  select ur.company_id into _company from public.user_roles ur
   where ur.user_id = _user and public.is_admin(ur.company_id) limit 1;
  _company := coalesce(_company, _old.default_company_id);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'user_mail_signature_update', 'profiles', _user::text, 'screen',
          jsonb_build_object('full_name', _old.full_name, 'job_title', _old.job_title),
          jsonb_build_object('full_name', coalesce(_name, _old.full_name), 'job_title', _title));
end $fn$;
revoke all on function public.set_user_mail_signature(uuid, text, text) from public, anon;
grant execute on function public.set_user_mail_signature(uuid, text, text) to authenticated;

-- ------------------------------------------------ 4. Coordonnées de la société et noms des boîtes
-- _settings = { brand, address, phone, site_url, site_label,
--               mailboxes: [{ id, signature_name }] }
create or replace function public.set_company_mail_signature(_company uuid, _settings jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _old   jsonb;
  _new   jsonb;
  _phone text := nullif(btrim(coalesce(_settings->>'phone', '')), '');
  _url   text := nullif(btrim(coalesce(_settings->>'site_url', '')), '');
  _box   jsonb;
  _prev  text;
  _name  text;
begin
  if auth.uid() is null or not public.is_admin(_company) then
    raise exception 'signature: admin only' using errcode = '42501';
  end if;
  if _phone is not null and _phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'signature: invalid phone' using errcode = '22023';
  end if;
  if _url is not null and _url !~ '^https://[^[:space:]]+$' then
    raise exception 'signature: invalid site url' using errcode = '22023';
  end if;

  select jsonb_build_object('brand', mail_signature_brand, 'address', mail_signature_address,
                            'phone', mail_signature_phone, 'site_url', mail_signature_site_url,
                            'site_label', mail_signature_site_label)
    into _old from public.companies where id = _company for update;
  if _old is null then raise exception 'signature: unknown company' using errcode = 'P0002'; end if;

  update public.companies
     set mail_signature_brand      = left(nullif(btrim(coalesce(_settings->>'brand', '')), ''), 80),
         mail_signature_address    = left(nullif(btrim(coalesce(_settings->>'address', '')), ''), 200),
         mail_signature_phone      = _phone,
         mail_signature_site_url   = left(_url, 300),
         mail_signature_site_label = left(nullif(btrim(coalesce(_settings->>'site_label', '')), ''), 120)
   where id = _company
  returning jsonb_build_object('brand', mail_signature_brand, 'address', mail_signature_address,
                               'phone', mail_signature_phone, 'site_url', mail_signature_site_url,
                               'site_label', mail_signature_site_label)
    into _new;

  if _new is distinct from _old then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'company_mail_signature_update', 'companies', _company::text, 'screen', _old, _new);
  end if;

  -- Noms des boîtes partagées (seulement celles de la société).
  for _box in select * from jsonb_array_elements(coalesce(_settings->'mailboxes', '[]'::jsonb))
  loop
    _name := left(nullif(btrim(coalesce(_box->>'signature_name', '')), ''), 80);
    select signature_name into _prev from public.company_mailboxes
     where id = (_box->>'id')::uuid and company_id = _company for update;
    if not found or _prev is not distinct from _name then continue; end if;
    update public.company_mailboxes set signature_name = _name where id = (_box->>'id')::uuid;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'mailbox_signature_update', 'company_mailboxes', _box->>'id', 'screen',
            jsonb_build_object('signature_name', _prev), jsonb_build_object('signature_name', _name));
  end loop;
end $fn$;
revoke all on function public.set_company_mail_signature(uuid, jsonb) from public, anon;
grant execute on function public.set_company_mail_signature(uuid, jsonb) to authenticated;
