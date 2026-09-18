-- =====================================================================
-- Mission 01, lot 3 — Portail client /mon-espace (décisions P-1 à P-4, S-2, U-2).
--
-- PRINCIPE DE SÉCURITÉ
--   Un compte client n'a AUCUN rôle : la RLS « membre » (is_member) lui refuse
--   toutes les tables métier, et c'est voulu. Tout ce qu'il voit ou modifie passe
--   par les fonctions ci-dessous, préfixées portal_, en SECURITY DEFINER :
--     - le contact est TOUJOURS retrouvé par contact_accounts.user_id = auth.uid() ;
--     - aucun identifiant envoyé par le navigateur ne décide de la propriété : un
--       identifiant de moto, de facture ou de rendez-vous n'est accepté que s'il
--       appartient à ce contact ET à sa société (S-2 : sociétés étanches) ;
--     - chaque fonction : revoke all from public, anon ; grant execute to authenticated.
--   Fichiers (bucket privé « ged ») : deux politiques Storage ajoutées, dont le
--   prédicat est une fonction portal_ qui vérifie la propriété du fichier. Le client
--   obtient une URL signée courte avec SON jeton ; la clé de service n'intervient pas.
--
-- STRICTEMENT ADDITIVE : nouvelles colonnes nullables, nouvelle table, nouvelles
-- fonctions, nouvelles politiques. Rien n'est modifié ni supprimé.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colonnes nullables
-- ---------------------------------------------------------------------
-- Demande de rendez-vous venant du portail : origine + créneau souhaité.
alter table public.workshop_appointments add column if not exists source text;
alter table public.workshop_appointments add column if not exists requested_slot text;
comment on column public.workshop_appointments.source is
  'Origine du rendez-vous : null = saisi par l’atelier, portail = demande du client (statut demande, à confirmer).';
comment on column public.workshop_appointments.requested_slot is
  'Créneau souhaité par le client (matin / apres_midi) pour une demande du portail.';

-- Préférence de contact choisie par le client dans son espace.
alter table public.contacts add column if not exists contact_preference text;
comment on column public.contacts.contact_preference is
  'Canal préféré déclaré par le client dans le portail : email, telephone, sms, whatsapp.';

-- ---------------------------------------------------------------------
-- 2. Table des dépôts de fichiers du portail
-- ---------------------------------------------------------------------
create table if not exists public.portal_uploads (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  entity_type   text not null check (entity_type in ('contact', 'vehicle')),
  entity_id     uuid not null,
  kind          text not null check (kind in ('avatar', 'permis', 'vehicle_photo', 'carte_grise',
                                                'assurance', 'coc', 'controle_technique', 'autre')),
  storage_path  text not null unique,
  file_name     text not null,
  content_type  text not null,
  size_bytes    bigint,
  attachment_id uuid references public.attachments(id) on delete set null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index if not exists idx_portal_uploads_contact on public.portal_uploads (contact_id, kind, completed_at desc);
create index if not exists idx_portal_uploads_user on public.portal_uploads (user_id, created_at desc);
alter table public.portal_uploads enable row level security;
-- Le personnel peut lire (traçabilité). Le client, lui, ne passe que par les fonctions portal_.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'portal_uploads'
                 and policyname = 'portal_uploads_member_read') then
    create policy portal_uploads_member_read on public.portal_uploads
      for select to authenticated using (public.is_member(company_id));
  end if;
end $$;
comment on table public.portal_uploads is
  'Fichiers déposés par un client depuis /mon-espace. Le fichier final est aussi indexé dans attachments (dossier « Portail client »).';

-- ---------------------------------------------------------------------
-- 3. Aides internes (NON exécutables par les clients)
-- ---------------------------------------------------------------------
-- Contexte du client connecté : sa fiche et sa société, jamais fournies par le navigateur.
create or replace function public._portal_ctx(out contact_id uuid, out company_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select ca.contact_id, ca.company_id
  from public.contact_accounts ca
  join public.contacts c on c.id = ca.contact_id and c.company_id = ca.company_id
  where ca.user_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = ca.user_id and p.is_active = false)
  limit 1;
$$;

-- Le client possède-t-il actuellement cette moto (dans sa société) ?
create or replace function public._portal_owns_vehicle(_contact uuid, _company uuid, _vehicle uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.vehicle_owners vo
    join public.vehicles v on v.id = vo.vehicle_id
    where vo.contact_id = _contact and vo.is_current and v.id = _vehicle and v.company_id = _company
  );
$$;

-- Dernier fichier terminé d'un type donné pour une entité du client.
create or replace function public._portal_last_upload(_contact uuid, _entity uuid, _kind text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select pu.storage_path from public.portal_uploads pu
  where pu.contact_id = _contact and pu.entity_id = _entity and pu.kind = _kind and pu.completed_at is not null
  order by pu.completed_at desc limit 1;
$$;

-- Libellé court d'une moto.
create or replace function public._portal_vehicle_label(_vehicle uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(trim(concat_ws(' ', v.brand, v.model)), '') from public.vehicles v where v.id = _vehicle;
$$;

revoke all on function public._portal_ctx() from public, anon, authenticated;
revoke all on function public._portal_owns_vehicle(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._portal_last_upload(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public._portal_vehicle_label(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Qui suis-je ? (aiguillage après connexion)
-- ---------------------------------------------------------------------
create or replace function public.portal_whoami()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ctx record; _c record;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then return null; end if;
  select c.first_name, c.last_name, c.company_name, c.type, co.name as dealer
    into _c
  from public.contacts c join public.companies co on co.id = c.company_id
  where c.id = _ctx.contact_id;
  return jsonb_build_object(
    'first_name', _c.first_name, 'last_name', _c.last_name, 'company_name', _c.company_name,
    'is_pro', _c.type = 'professionnel', 'dealer', _c.dealer,
    'avatar_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'avatar'));
end $$;

-- ---------------------------------------------------------------------
-- 5. Profil : lecture et mise à jour (liste blanche)
-- ---------------------------------------------------------------------
create or replace function public.portal_profile()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select jsonb_build_object(
    'civility', c.civility, 'first_name', c.first_name, 'last_name', c.last_name,
    'email', c.email, 'mobile', c.mobile, 'phone', c.phone,
    'address', c.address, 'street_number', c.street_number, 'address_complement', c.address_complement,
    'zip', c.zip, 'city', c.city, 'country', c.country, 'birth_date', c.birth_date,
    'is_pro', c.type = 'professionnel', 'company_name', c.company_name, 'vat_number', c.vat_number,
    'vies_valid', c.vies_valid, 'contact_preference', c.contact_preference,
    'marketing_opt_out', c.marketing_opt_out, 'license_number', c.license_number,
    'dealer', co.name,
    'avatar_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'avatar'),
    'license_path', public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'permis'))
  into _r
  from public.contacts c join public.companies co on co.id = c.company_id
  where c.id = _ctx.contact_id and c.company_id = _ctx.company_id;
  return _r;
end $$;

create or replace function public.portal_update_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _ctx record; _k text; _is_pro boolean; _old_vat text; _new_vat text; _bd date; _pref text; _country text;
  _allowed constant text[] := array['civility','first_name','last_name','mobile','phone','address',
    'street_number','address_complement','zip','city','country','birth_date','company_name',
    'vat_number','contact_preference','marketing_opt_out','license_number'];
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'portal: invalid payload' using errcode = '22023'; end if;

  -- Liste blanche : toute autre clé est refusée (id, company_id, credit_limit, email, status…).
  for _k in select jsonb_object_keys(p) loop
    if not (_k = any(_allowed)) then
      raise exception 'portal: field not allowed: %', _k using errcode = '42501';
    end if;
  end loop;

  select c.type = 'professionnel', c.vat_number into _is_pro, _old_vat
  from public.contacts c where c.id = _ctx.contact_id;

  if (p ? 'company_name' or p ? 'vat_number') and not _is_pro then
    raise exception 'portal: company fields reserved to professional accounts' using errcode = '42501';
  end if;

  -- Validations
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

  -- Saisie en majuscules comme dans la fiche du personnel (décision du 17/07), sauf e-mail.
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
    license_number     = case when p ? 'license_number' then left(nullif(upper(trim(p->>'license_number')), ''), 40) else c.license_number end,
    company_name       = case when p ? 'company_name' then left(nullif(upper(trim(p->>'company_name')), ''), 200) else c.company_name end,
    vat_number         = _new_vat,
    -- Un numéro de TVA saisi par le client n'est jamais « vérifié » : le personnel revalide.
    vies_valid         = case when _new_vat is distinct from _old_vat then null else c.vies_valid end,
    vies_checked_at    = case when _new_vat is distinct from _old_vat then null else c.vies_checked_at end,
    contact_preference = case when p ? 'contact_preference' then _pref else c.contact_preference end,
    marketing_opt_out  = case when p ? 'marketing_opt_out' then (p->>'marketing_opt_out')::boolean else c.marketing_opt_out end
  where c.id = _ctx.contact_id and c.company_id = _ctx.company_id;

  return public.portal_profile();
end $$;

-- ---------------------------------------------------------------------
-- 6. Motos
-- ---------------------------------------------------------------------
create or replace function public.portal_vehicles()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'brand', v.brand, 'model', v.model, 'vin', v.vin, 'plate', v.plate,
      'model_year', v.model_year, 'color', v.color, 'mileage', v.mileage,
      'photo_path', public._portal_last_upload(_ctx.contact_id, v.id, 'vehicle_photo'),
      'has_registration', public._portal_last_upload(_ctx.contact_id, v.id, 'carte_grise') is not null,
      'has_insurance', public._portal_last_upload(_ctx.contact_id, v.id, 'assurance') is not null
    ) order by vo.from_date desc, v.model), '[]'::jsonb)
  into _r
  from public.vehicle_owners vo
  join public.vehicles v on v.id = vo.vehicle_id
  where vo.contact_id = _ctx.contact_id and vo.is_current and v.company_id = _ctx.company_id;
  return _r;
end $$;

create or replace function public.portal_vehicle(p_vehicle_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  -- Même réponse qu'il s'agisse d'une moto inexistante ou de celle d'un autre client.
  if p_vehicle_id is null or not public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, p_vehicle_id) then
    raise exception 'portal: vehicle not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    -- Liste blanche : ni prix d'achat, ni coût de revient, ni notes internes.
    'id', v.id, 'brand', v.brand, 'model', v.model, 'vin', v.vin, 'plate', v.plate,
    'model_year', v.model_year, 'color', v.color, 'mileage', v.mileage,
    'displacement', v.displacement, 'power_kw', v.power_kw, 'power_cv', v.power_cv,
    'is_restricted', v.is_restricted, 'first_registration_date', v.first_registration_date,
    'next_inspection_date', v.next_inspection_date, 'warranty_start', v.warranty_start,
    'warranty_end', v.warranty_end,
    'photo_path', public._portal_last_upload(_ctx.contact_id, v.id, 'vehicle_photo'),
    -- Réparations : seulement les OR de CE client sur cette moto (pas ceux d'un ancien propriétaire).
    'repairs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ro.id, 'number', ro.number, 'date', ro.created_at, 'status', ro.status,
        'work_description', ro.work_description, 'mileage', ro.mileage,
        'invoice_document_id', ro.invoice_document_id) order by ro.created_at desc)
      from public.repair_orders ro
      where ro.vehicle_id = v.id and ro.contact_id = _ctx.contact_id
        and ro.company_id = _ctx.company_id and ro.status <> 'annule'), '[]'::jsonb),
    -- Entretiens constructeur (My Ducati) : propres à la moto, sans donnée personnelle.
    'maintenance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', m.kind, 'service_type', m.service_type, 'state', m.state, 'km', m.km,
        'event_date', m.event_date, 'due_date', m.due_date, 'dealer', m.dealer)
        order by coalesce(m.event_date, m.due_date) desc nulls last)
      from public.vehicle_maintenance m
      where m.vehicle_id = v.id and m.company_id = _ctx.company_id), '[]'::jsonb),
    -- Documents et photos : uniquement ceux déposés par le client lui-même.
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pu.id, 'kind', pu.kind, 'file_name', pu.file_name, 'content_type', pu.content_type,
        'path', pu.storage_path, 'created_at', pu.completed_at) order by pu.completed_at desc)
      from public.portal_uploads pu
      where pu.contact_id = _ctx.contact_id and pu.entity_type = 'vehicle'
        and pu.entity_id = v.id and pu.completed_at is not null), '[]'::jsonb),
    -- Factures liées à cette moto.
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'doc_type', d.doc_type, 'number', coalesce(d.number, d.legacy_number),
        'issue_date', d.issue_date, 'total_ttc', d.total_ttc) order by d.issue_date desc)
      from public.documents d
      where d.vehicle_id = v.id and d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id
        and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee')), '[]'::jsonb)
  ) into _r
  from public.vehicles v where v.id = p_vehicle_id and v.company_id = _ctx.company_id;
  return _r;
end $$;

-- ---------------------------------------------------------------------
-- 7. Factures (reprises de G8 avec leur PDF d'origine + créées dans le DMS)
-- ---------------------------------------------------------------------
-- PDF d'origine G8 : pièce jointe PDF sans dossier sur un document importé.
create or replace function public._portal_invoice_pdf(_document uuid, _company uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select a.storage_path from public.attachments a
  join public.documents d on d.id = a.entity_id
  where a.entity_type = 'document' and a.entity_id = _document and a.company_id = _company
    and d.company_id = _company and d.imported_from is not null
    and a.content_type = 'application/pdf' and a.folder is null
  order by a.created_at limit 1;
$$;
revoke all on function public._portal_invoice_pdf(uuid, uuid) from public, anon, authenticated;

create or replace function public.portal_invoices()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'doc_type', d.doc_type, 'number', coalesce(d.number, d.legacy_number),
      'issue_date', d.issue_date, 'due_date', d.due_date, 'status', d.status,
      'total_ttc', d.total_ttc, 'paid_amount', d.paid_amount,
      'vehicle_label', case when d.vehicle_id is not null then public._portal_vehicle_label(d.vehicle_id) end,
      'imported', d.imported_from is not null,
      'pdf_path', public._portal_invoice_pdf(d.id, _ctx.company_id)
    ) order by d.issue_date desc, d.created_at desc), '[]'::jsonb)
  into _r
  from public.documents d
  where d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id
    and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee');
  return _r;
end $$;

create or replace function public.portal_invoice(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.documents d
    where d.id = p_document_id and d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id
      and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee')
  ) then
    raise exception 'portal: invoice not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'id', d.id, 'doc_type', d.doc_type, 'number', coalesce(d.number, d.legacy_number),
    'issue_date', d.issue_date, 'due_date', d.due_date, 'status', d.status,
    'total_ht', d.total_ht, 'total_vat', d.total_vat, 'total_ttc', d.total_ttc,
    'paid_amount', d.paid_amount, 'tax_exempt', d.tax_exempt,
    'imported', d.imported_from is not null,
    'pdf_path', public._portal_invoice_pdf(d.id, _ctx.company_id),
    'vehicle', case when v.id is not null then jsonb_build_object(
      'brand', v.brand, 'model', v.model, 'vin', v.vin, 'plate', v.plate) end,
    'company', jsonb_build_object(
      'name', co.name, 'legal_name', co.legal_name, 'vat_number', co.vat_number,
      'address', co.address, 'zip', co.zip, 'city', co.city, 'country', co.country,
      'iban', co.iban, 'bic', co.bic, 'invoice_footer', co.invoice_footer),
    'customer', jsonb_build_object(
      'first_name', c.first_name, 'last_name', c.last_name, 'company_name', c.company_name,
      'address', c.address, 'street_number', c.street_number, 'zip', c.zip, 'city', c.city,
      'country', c.country, 'vat_number', c.vat_number),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reference', l.reference, 'designation', l.designation, 'quantity', l.quantity,
        'unit_price_ht', l.unit_price_ht, 'vat_rate', l.vat_rate, 'discount_pct', l.discount_pct,
        'line_ht', l.line_ht, 'line_ttc', l.line_ttc) order by l.sort_order, l.created_at)
      from public.document_lines l where l.document_id = d.id), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'method', pm.method, 'amount', pm.amount, 'paid_at', pm.paid_at, 'status', pm.status)
        order by pm.paid_at)
      from public.document_payments pm where pm.document_id = d.id), '[]'::jsonb)
  ) into _r
  from public.documents d
  join public.companies co on co.id = d.company_id
  join public.contacts c on c.id = d.contact_id
  left join public.vehicles v on v.id = d.vehicle_id and v.company_id = d.company_id
  where d.id = p_document_id;
  return _r;
end $$;

-- ---------------------------------------------------------------------
-- 8. Rendez-vous atelier
-- ---------------------------------------------------------------------
create or replace function public.portal_appointments()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'starts_at', a.starts_at, 'status', a.status,
      'work_description', a.work_description, 'requested_slot', a.requested_slot,
      'source', a.source, 'vehicle_id', a.vehicle_id,
      'vehicle_label', case when a.vehicle_id is not null then public._portal_vehicle_label(a.vehicle_id) end
    ) order by a.starts_at desc), '[]'::jsonb)
  into _r
  from public.workshop_appointments a
  where a.contact_id = _ctx.contact_id and a.company_id = _ctx.company_id;
  return _r;
end $$;

create or replace function public.portal_request_appointment(
  p_vehicle_id uuid, p_reason text, p_date date, p_slot text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _ctx record; _id uuid; _reason text; _open int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  if p_vehicle_id is not null and not public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, p_vehicle_id) then
    raise exception 'portal: vehicle not found' using errcode = 'P0002';
  end if;
  _reason := left(trim(coalesce(p_reason, '')), 1000);
  if length(_reason) < 3 then raise exception 'portal: reason required' using errcode = '22023'; end if;
  if p_date is null or p_date <= current_date or p_date > current_date + 180 then
    raise exception 'portal: invalid date' using errcode = '22023';
  end if;
  if p_slot is null or p_slot not in ('matin', 'apres_midi') then raise exception 'portal: invalid slot' using errcode = '22023'; end if;
  -- Garde-fou contre les abus : au plus 3 demandes en attente par client.
  select count(*) into _open from public.workshop_appointments
  where contact_id = _ctx.contact_id and company_id = _ctx.company_id and status = 'demande';
  if _open >= 3 then raise exception 'portal: too many pending requests' using errcode = '54000'; end if;

  -- Arrive côté atelier comme une DEMANDE à confirmer (statut « demande »), à la date
  -- souhaitée : 9 h pour le matin, 14 h pour l'après-midi, heure de Bruxelles.
  insert into public.workshop_appointments (
    company_id, contact_id, vehicle_id, starts_at, planned_minutes, work_description,
    status, notify_sms, source, requested_slot)
  values (
    _ctx.company_id, _ctx.contact_id, p_vehicle_id,
    (p_date + case when p_slot = 'matin' then time '09:00' else time '14:00' end) at time zone 'Europe/Brussels',
    60, _reason, 'demande', false, 'portail', p_slot)
  returning id into _id;
  return _id;
end $$;

create or replace function public.portal_cancel_appointment_request(p_appointment_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _ctx record;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  update public.workshop_appointments set status = 'annule'
  where id = p_appointment_id and contact_id = _ctx.contact_id and company_id = _ctx.company_id
    and status = 'demande';
  if not found then raise exception 'portal: request not found' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. Accueil : résumé + étapes de complétion (P-4)
-- ---------------------------------------------------------------------
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
    _c.license_number is not null or public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'permis') is not null);
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

-- ---------------------------------------------------------------------
-- 10. Dépôt de fichiers (photo de profil, photo de moto, documents du véhicule)
-- ---------------------------------------------------------------------
-- Étape 1 : le client annonce son fichier. La fonction vérifie la propriété de la
-- moto, le type et la taille, puis FIXE elle-même le chemin de stockage (le nom
-- de fichier du client n'entre jamais dans le chemin).
create or replace function public.portal_prepare_upload(
  p_kind text, p_vehicle_id uuid, p_file_name text, p_content_type text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _ctx record; _id uuid := gen_random_uuid(); _entity_type text; _entity uuid; _ext text; _path text; _recent int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;

  if p_kind in ('avatar', 'permis') then
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

-- Étape 3 (après l'envoi du fichier) : on vérifie que le fichier est bien arrivé, à
-- la bonne taille et au bon type, puis on l'indexe dans la GED de la fiche (dossier
-- « Portail client ») pour que le personnel le voie.
create or replace function public.portal_complete_upload(p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _ctx record; _u record; _meta jsonb; _att uuid; _size bigint; _mime text;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select * into _u from public.portal_uploads
  where id = p_upload_id and user_id = auth.uid() and contact_id = _ctx.contact_id and company_id = _ctx.company_id;
  if _u.id is null then raise exception 'portal: upload not found' using errcode = 'P0002'; end if;
  if _u.completed_at is not null then return jsonb_build_object('attachment_id', _u.attachment_id, 'path', _u.storage_path); end if;

  select o.metadata into _meta from storage.objects o where o.bucket_id = 'ged' and o.name = _u.storage_path;
  if _meta is null then raise exception 'portal: file not received' using errcode = 'P0002'; end if;
  _size := nullif(_meta->>'size', '')::bigint;
  _mime := lower(coalesce(_meta->>'mimetype', ''));
  if _size is null or _size > 15 * 1024 * 1024 then raise exception 'portal: file too large' using errcode = '22023'; end if;
  if _mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf') then
    raise exception 'portal: file type not allowed' using errcode = '22023';
  end if;

  insert into public.attachments (company_id, entity_type, entity_id, file_name, storage_path, content_type,
    size_bytes, note, uploaded_by, folder)
  values (_u.company_id, _u.entity_type, _u.entity_id, _u.file_name, _u.storage_path, _mime,
    _size, 'portail:' || _u.kind, auth.uid(), 'Portail client')
  returning id into _att;
  update public.portal_uploads set completed_at = now(), attachment_id = _att, size_bytes = _size, content_type = _mime
  where id = _u.id;
  return jsonb_build_object('attachment_id', _att, 'path', _u.storage_path);
end $$;

-- ---------------------------------------------------------------------
-- 11. Prédicats des politiques Storage (bucket « ged »)
-- ---------------------------------------------------------------------
-- Lecture : le client ne peut lire QUE
--   a) les fichiers qu'il a déposés lui-même (moto qu'il possède toujours, ou sa fiche),
--   b) le PDF d'origine G8 de SES factures.
-- Jamais la GED interne (factures d'achat, reprises, e-mails, pièces d'identité scannées…).
create or replace function public.portal_can_read_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ctx record;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null or p_name is null then return false; end if;
  return exists (
      select 1 from public.portal_uploads pu
      where pu.storage_path = p_name and pu.contact_id = _ctx.contact_id and pu.company_id = _ctx.company_id
        and (
          -- dépôt en cours (moins d'une heure) : nécessaire à l'envoi lui-même
          (pu.completed_at is null and pu.user_id = auth.uid() and pu.created_at > now() - interval '1 hour')
          or (pu.completed_at is not null and (
                (pu.entity_type = 'contact' and pu.entity_id = _ctx.contact_id)
             or (pu.entity_type = 'vehicle' and public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, pu.entity_id))))
        ))
    or exists (
      select 1 from public.attachments a
      join public.documents d on d.id = a.entity_id
      where a.storage_path = p_name and a.entity_type = 'document' and a.company_id = _ctx.company_id
        and d.company_id = _ctx.company_id and d.contact_id = _ctx.contact_id
        and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee')
        and d.imported_from is not null and a.content_type = 'application/pdf' and a.folder is null);
end $$;

-- Écriture : uniquement le chemin exact préparé par portal_prepare_upload, par le même
-- utilisateur, dans l'heure, et une seule fois (pas de politique UPDATE : pas d'écrasement).
create or replace function public.portal_can_write_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ctx record;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null or p_name is null then return false; end if;
  return exists (
    select 1 from public.portal_uploads pu
    where pu.storage_path = p_name and pu.user_id = auth.uid() and pu.contact_id = _ctx.contact_id
      and pu.company_id = _ctx.company_id and pu.completed_at is null
      and pu.created_at > now() - interval '1 hour');
end $$;

-- Politiques AJOUTÉES (les politiques ged_* du personnel restent inchangées).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'ged_portal_select') then
    create policy ged_portal_select on storage.objects
      for select to authenticated
      using (bucket_id = 'ged' and public.portal_can_read_object(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'ged_portal_insert') then
    create policy ged_portal_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'ged' and public.portal_can_write_object(name));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 12. Droits : personne d'autre que les comptes connectés
-- ---------------------------------------------------------------------
revoke all on function public.portal_whoami() from public, anon;
revoke all on function public.portal_profile() from public, anon;
revoke all on function public.portal_update_profile(jsonb) from public, anon;
revoke all on function public.portal_vehicles() from public, anon;
revoke all on function public.portal_vehicle(uuid) from public, anon;
revoke all on function public.portal_invoices() from public, anon;
revoke all on function public.portal_invoice(uuid) from public, anon;
revoke all on function public.portal_appointments() from public, anon;
revoke all on function public.portal_request_appointment(uuid, text, date, text) from public, anon;
revoke all on function public.portal_cancel_appointment_request(uuid) from public, anon;
revoke all on function public.portal_home() from public, anon;
revoke all on function public.portal_prepare_upload(text, uuid, text, text, bigint) from public, anon;
revoke all on function public.portal_complete_upload(uuid) from public, anon;
revoke all on function public.portal_can_read_object(text) from public, anon;
revoke all on function public.portal_can_write_object(text) from public, anon;

grant execute on function public.portal_whoami() to authenticated;
grant execute on function public.portal_profile() to authenticated;
grant execute on function public.portal_update_profile(jsonb) to authenticated;
grant execute on function public.portal_vehicles() to authenticated;
grant execute on function public.portal_vehicle(uuid) to authenticated;
grant execute on function public.portal_invoices() to authenticated;
grant execute on function public.portal_invoice(uuid) to authenticated;
grant execute on function public.portal_appointments() to authenticated;
grant execute on function public.portal_request_appointment(uuid, text, date, text) to authenticated;
grant execute on function public.portal_cancel_appointment_request(uuid) to authenticated;
grant execute on function public.portal_home() to authenticated;
grant execute on function public.portal_prepare_upload(text, uuid, text, text, bigint) to authenticated;
grant execute on function public.portal_complete_upload(uuid) to authenticated;
grant execute on function public.portal_can_read_object(text) to authenticated;
grant execute on function public.portal_can_write_object(text) to authenticated;
