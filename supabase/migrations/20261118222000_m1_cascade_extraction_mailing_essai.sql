-- =====================================================================
-- M1 / M10 — Modification en cascade, extraction / mailing client, campagnes e-mail et SMS
-- EN MODE ESSAI (rattrapage G8 du 18/11/2026, lot-g8-clients).
--
-- G8 « Fichiers > Clients > Modification en cascade » : filtres Type, Civilite, Categorie, Tarif,
-- Code client, Ville, Solde -> Lister -> actions de masse avec « Confirmer modification client ».
-- G8 « Extraction/Mailing client » : criteres Client / Vehicule / Localisation / Ventes, liste,
-- etiquettes, export Excel, Mailing E-mail, Mailing SMS.
--
--   1. be_province / be_region : province et region belges depuis le code postal (criteres
--      « Departement » et « Region » de G8, adaptes a la Belgique).
--   2. contacts_cascade_list (lecture, membre) / contacts_cascade_apply (ecriture, ADMIN, une
--      transaction, trace events). Actions : changer le code postal, la civilite / forme juridique,
--      supprimer les civilites, changer / supprimer la categorie, affecter / retirer un groupe,
--      changer la condition de reglement, ajouter un commentaire, poser / retirer « a surveiller »
--      et « oppose au marketing direct », archiver. Tarifs et cases bloque / detaxe / HT / en compte
--      sont du lot « regles client » : refuses ici (CASCADE_ACTION_UNKNOWN).
--   3. contacts_extract : la selection multicritere (opposes au marketing et NPAI exclus par defaut).
--   4. marketing_campaigns / marketing_campaign_recipients + marketing_campaign_prepare : une
--      campagne e-mail ou SMS est PREPAREE (destinataires, adresse, message personnalise, raisons
--      d'exclusion) en MODE ESSAI UNIQUEMENT. La contrainte mode = 'test' interdit toute autre
--      valeur et AUCUNE fonction d'envoi n'existe : rien ne part chez un client.
--
-- STRICTEMENT ADDITIVE, idempotente. NE PAS APPLIQUER depuis un agent.
-- Essai a blanc : supabase/tests/m1_fiche_cascade_extraction.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Province / region belges
-- ---------------------------------------------------------------------
create or replace function public.be_province(_zip text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when z is null then null
    when z between 1000 and 1299 then 'BRU'
    when z between 1300 and 1499 then 'BWA'
    when z between 1500 and 1999 then 'VBR'
    when z between 2000 and 2999 then 'ANT'
    when z between 3000 and 3499 then 'VBR'
    when z between 3500 and 3999 then 'LIM'
    when z between 4000 and 4999 then 'LIE'
    when z between 5000 and 5999 then 'NAM'
    when z between 6000 and 6599 then 'HAI'
    when z between 6600 and 6999 then 'LUX'
    when z between 7000 and 7999 then 'HAI'
    when z between 8000 and 8999 then 'WVL'
    when z between 9000 and 9999 then 'OVL'
  end
  from (select case when btrim(coalesce(_zip, '')) ~ '^[0-9]{4}$' then btrim(_zip)::int end as z) s;
$$;
grant execute on function public.be_province(text) to authenticated;

create or replace function public.be_region(_zip text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case public.be_province(_zip)
    when 'BRU' then 'bruxelles'
    when 'BWA' then 'wallonie' when 'LIE' then 'wallonie' when 'NAM' then 'wallonie'
    when 'HAI' then 'wallonie' when 'LUX' then 'wallonie'
    when 'VBR' then 'flandre' when 'ANT' then 'flandre' when 'LIM' then 'flandre'
    when 'WVL' then 'flandre' when 'OVL' then 'flandre'
  end;
$$;
grant execute on function public.be_region(text) to authenticated;

-- Pays belge, quelle que soit l'ecriture reprise de G8.
create or replace function public._is_be(_country text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(upper(btrim(_country)), 'BE') in ('BE', 'BEL', 'BELGIQUE', 'BELGIE', 'BELGIË', 'BELGIUM', '');
$$;

-- Solde client (factures et tickets ouverts + solde d'ouverture G8).
create or replace function public._contact_balance(_id uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.opening_balance from public.contacts c where c.id = _id), 0)
       + coalesce((select sum(d.total_ttc - d.paid_amount) from public.documents d
                    where d.contact_id = _id and d.doc_type in ('FAC', 'TIK')
                      and d.status not in ('brouillon', 'annulee', 'converti', 'avoir_emis')), 0);
$$;
revoke all on function public._contact_balance(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Modification en cascade
-- ---------------------------------------------------------------------
create or replace function public.contacts_cascade_list(_company uuid, _f jsonb default '{}'::jsonb, _limit int default 5000)
returns table (
  id uuid, code text, type text, civility text, legal_form text, first_name text, last_name text, company_name text,
  zip text, city text, category text, price_list text, payment_terms text,
  is_blocked boolean, is_detaxe boolean, mode_ht boolean, marketing_opt_out boolean, is_account boolean,
  is_watch boolean, show_discounts_pos boolean, is_active boolean, balance numeric
)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  _type text := nullif(_f->>'type', '');
  _civ text := nullif(_f->>'civility', '');
  _cat text := nullif(_f->>'category', '');
  _tar text := nullif(_f->>'price_list', '');
  _code_from text := nullif(btrim(_f->>'code_from'), '');
  _code_to text := nullif(btrim(_f->>'code_to'), '');
  _place text := nullif(public.contact_norm_txt(_f->>'place'), '');
  _bal_min numeric := nullif(_f->>'balance_min', '')::numeric;
  _bal_max numeric := nullif(_f->>'balance_max', '')::numeric;
  _archived boolean := coalesce((_f->>'include_archived')::boolean, false);
begin
  if auth.uid() is null or not public.is_member(_company) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
  select * from (
    select c.id, c.code, c.type::text, c.civility, c.legal_form, c.first_name, c.last_name, c.company_name,
           c.zip, c.city, c.category, c.price_list, c.payment_terms,
           c.is_blocked, c.is_detaxe, c.mode_ht, c.marketing_opt_out, c.is_account, c.is_watch,
           c.show_discounts_pos, c.is_active, public._contact_balance(c.id) as balance
      from public.contacts c
     where c.company_id = _company
       and (_archived or c.is_active)
       and (_type is null or c.type::text = _type)
       and (_civ is null
            or (_civ = '__none__' and nullif(btrim(c.civility), '') is null and nullif(btrim(c.legal_form), '') is null)
            or c.civility = _civ or c.legal_form = _civ)
       and (_cat is null or (_cat = '__none__' and nullif(btrim(c.category), '') is null) or c.category = _cat)
       and (_tar is null or (_tar = '__none__' and nullif(btrim(c.price_list), '') is null) or c.price_list = _tar)
       and (_code_from is null or (case when c.code ~ '^[0-9]+$' and _code_from ~ '^[0-9]+$'
                                        then c.code::bigint >= _code_from::bigint else c.code >= _code_from end))
       and (_code_to is null or (case when c.code ~ '^[0-9]+$' and _code_to ~ '^[0-9]+$'
                                      then c.code::bigint <= _code_to::bigint else c.code <= _code_to end))
       and (_place is null or public.contact_norm_txt(c.city) like '%' || _place || '%' or coalesce(c.zip, '') like _place || '%')
  ) x
  where (_bal_min is null or x.balance >= _bal_min)
    and (_bal_max is null or x.balance <= _bal_max)
  order by x.last_name nulls last, x.first_name nulls last, x.company_name nulls last
  limit greatest(1, least(coalesce(_limit, 5000), 20000));
end $$;
revoke all on function public.contacts_cascade_list(uuid, jsonb, int) from public, anon;
grant execute on function public.contacts_cascade_list(uuid, jsonb, int) to authenticated;

create or replace function public.contacts_cascade_apply(_company uuid, _ids uuid[], _action text, _value jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _n int := 0;
  _v text := nullif(btrim(coalesce(_value->>'value', '')), '');
  _flag text := _value->>'flag';
  _on boolean := coalesce((_value->>'on')::boolean, true);
  _stamp text := to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY');
  _ids_ok uuid[];
  _before jsonb;
begin
  if auth.uid() is null or not public.is_admin(_company) then
    raise exception 'FORBIDDEN' using errcode = '42501',
      hint = 'La modification en cascade est reservee aux administrateurs.';
  end if;
  select coalesce(array_agg(c.id), '{}') into _ids_ok
    from public.contacts c where c.company_id = _company and c.id = any(coalesce(_ids, '{}'));
  if cardinality(_ids_ok) = 0 then return 0; end if;
  if cardinality(_ids_ok) > 20000 then raise exception 'CASCADE_TOO_MANY' using errcode = '22023'; end if;

  -- Anciennes valeurs (trace de synthese ; chaque fiche a aussi sa ligne audit_row).
  select jsonb_object_agg(c.id::text, jsonb_build_object('zip', c.zip, 'city', c.city, 'civility', c.civility,
           'legal_form', c.legal_form, 'category', c.category, 'payment_terms', c.payment_terms,
           'is_watch', c.is_watch, 'marketing_opt_out', c.marketing_opt_out, 'is_active', c.is_active))
    into _before from public.contacts c where c.id = any(_ids_ok);

  if _action = 'set_zip' then
    if _v is null then raise exception 'CASCADE_VALUE_REQUIRED' using errcode = '22023'; end if;
    update public.contacts set zip = _v, city = coalesce(nullif(btrim(_value->>'city'), ''), city)
     where id = any(_ids_ok);
  elsif _action = 'set_civility' then
    if _v is null then raise exception 'CASCADE_VALUE_REQUIRED' using errcode = '22023'; end if;
    -- Civilite d'une personne (Monsieur / Madame / Mx) ou forme juridique (table Civilites, Professionnel).
    if _v in ('Monsieur', 'Madame', 'Mx') then
      update public.contacts set civility = _v where id = any(_ids_ok);
    else
      update public.contacts set legal_form = _v where id = any(_ids_ok);
    end if;
  elsif _action = 'clear_civility' then
    update public.contacts set civility = null, legal_form = null where id = any(_ids_ok);
  elsif _action = 'set_category' then
    if _v is null then raise exception 'CASCADE_VALUE_REQUIRED' using errcode = '22023'; end if;
    update public.contacts set category = _v where id = any(_ids_ok);
  elsif _action = 'clear_category' then
    update public.contacts set category = null where id = any(_ids_ok);
  elsif _action = 'add_group' then
    if _v is null or not exists (select 1 from public.reference_values r
                                  where r.company_id = _company and r.table_key = 'contact_group' and r.code = _v) then
      raise exception 'CASCADE_VALUE_REQUIRED' using errcode = '22023';
    end if;
    insert into public.contact_group_members (company_id, contact_id, group_code)
    select _company, x, _v from unnest(_ids_ok) x
    on conflict (contact_id, group_code) do nothing;
  elsif _action = 'remove_group' then
    delete from public.contact_group_members where contact_id = any(_ids_ok) and group_code = _v;
  elsif _action = 'set_payment_terms' then
    if _v is null then raise exception 'CASCADE_VALUE_REQUIRED' using errcode = '22023'; end if;
    update public.contacts set payment_terms = _v where id = any(_ids_ok);
  elsif _action = 'add_comment' then
    if _v is null then raise exception 'CASCADE_VALUE_REQUIRED' using errcode = '22023'; end if;
    -- G8 remplace le commentaire ; ici on AJOUTE une ligne datee (rien n'est perdu).
    update public.contacts set notes = concat_ws(E'\n', nullif(btrim(notes), ''), _stamp || ' : ' || _v)
     where id = any(_ids_ok);
  elsif _action = 'set_flag' then
    if _flag = 'is_watch' then
      update public.contacts set is_watch = _on where id = any(_ids_ok);
    elsif _flag = 'marketing_opt_out' then
      update public.contacts set marketing_opt_out = _on where id = any(_ids_ok);
    else
      raise exception 'CASCADE_ACTION_UNKNOWN' using errcode = '22023';
    end if;
  elsif _action = 'archive' then
    update public.contacts set is_active = false where id = any(_ids_ok) and is_active;
  else
    raise exception 'CASCADE_ACTION_UNKNOWN' using errcode = '22023';
  end if;
  get diagnostics _n = row_count;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'contacts_cascade', 'contacts', null, 'screen', _before,
          jsonb_build_object('action', _action, 'value', _value, 'selected', cardinality(_ids_ok), 'changed', _n,
                             'ids', to_jsonb(_ids_ok)));
  return _n;
end $$;
revoke all on function public.contacts_cascade_apply(uuid, uuid[], text, jsonb) from public, anon;
grant execute on function public.contacts_cascade_apply(uuid, uuid[], text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Extraction multicritere
-- ---------------------------------------------------------------------
create or replace function public.contacts_extract(_company uuid, _c jsonb default '{}'::jsonb)
returns table (
  id uuid, code text, type text, status text, civility text, legal_form text, first_name text, last_name text,
  company_name text, email text, mobile text, address text, street_number text, address_complement text,
  zip text, city text, country text, birth_date date, category text, price_list text, created_at timestamptz,
  marketing_opt_out boolean, npai boolean, consent_email text, consent_sms text, province text, region text
)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  _code_from text := nullif(btrim(_c->>'code_from'), '');
  _code_to text := nullif(btrim(_c->>'code_to'), '');
  _name text := nullif(public.contact_norm_txt(_c->>'name'), '');
  _civs text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(_c->'civilities', '[]')) x);
  _types text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(_c->'types', '[]')) x);
  _statuses text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(_c->'statuses', '[]')) x);
  _cats text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(_c->'categories', '[]')) x);
  _tars text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(_c->'price_lists', '[]')) x);
  _groups text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(_c->'groups', '[]')) x);
  _created_from date := nullif(_c->>'created_from', '')::date;
  _created_to date := nullif(_c->>'created_to', '')::date;
  _birth_from date := nullif(_c->>'birth_from', '')::date;
  _birth_to date := nullif(_c->>'birth_to', '')::date;
  _bday_from text := nullif(_c->>'birthday_from', '');   -- MM-DD
  _bday_to text := nullif(_c->>'birthday_to', '');
  _ex_email boolean := coalesce((_c->>'exclude_with_email')::boolean, false);
  _ex_mobile boolean := coalesce((_c->>'exclude_with_mobile')::boolean, false);
  _ex_opt boolean := coalesce((_c->>'exclude_opt_out')::boolean, true);
  _consent text := nullif(_c->>'consent', '');            -- email | sms | any | none_refused
  _veh boolean := coalesce((_c->>'has_vehicle')::boolean, false);
  _veh_current boolean := coalesce((_c->>'vehicle_current_only')::boolean, true);
  _veh_brand text := nullif(public.contact_norm_txt(_c->>'vehicle_brand'), '');
  _veh_model text := nullif(public.contact_norm_txt(_c->>'vehicle_model'), '');
  _ct_from date := nullif(_c->>'ct_from', '')::date;
  _ct_to date := nullif(_c->>'ct_to', '')::date;
  _place text := nullif(public.contact_norm_txt(_c->>'place'), '');
  _provinces text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(_c->'provinces', '[]')) x);
  _regions text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(_c->'regions', '[]')) x);
  _countries text[] := (select array_agg(upper(x)) from jsonb_array_elements_text(coalesce(_c->'countries', '[]')) x);
  _ex_npai boolean := coalesce((_c->>'exclude_npai')::boolean, true);
  _sales_from date := nullif(_c->>'sales_from', '')::date;
  _sales_to date := nullif(_c->>'sales_to', '')::date;
  _sales_mode text := nullif(_c->>'sales_mode', '');      -- with_invoice | without_invoice | workshop
  _supplier uuid := nullif(_c->>'supplier_id', '')::uuid;
  _rayon text := nullif(public.contact_norm_txt(_c->>'rayon'), '');
  _article text := nullif(public.contact_norm_txt(_c->>'article'), '');
  _brand text := nullif(public.contact_norm_txt(_c->>'brand'), '');
  _archived boolean := coalesce((_c->>'include_archived')::boolean, false);
  _art_filter boolean;
begin
  if auth.uid() is null or not public.is_member(_company) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  _art_filter := _supplier is not null or _rayon is not null or _article is not null or _brand is not null;
  if _sales_mode is null and (_sales_from is not null or _sales_to is not null or _art_filter) then
    _sales_mode := 'with_invoice';
  end if;

  return query
  select x.* from (
    select c.id, c.code, c.type::text, c.status::text, c.civility, c.legal_form, c.first_name, c.last_name,
           c.company_name, c.email, c.mobile, c.address, c.street_number, c.address_complement,
           c.zip, c.city, c.country, c.birth_date, c.category, c.price_list, c.created_at,
           c.marketing_opt_out, c.address_mismatch,
           public._consent_channel(c.id, 'email'), public._consent_channel(c.id, 'sms'),
           case when public._is_be(c.country) then public.be_province(c.zip) end,
           case when public._is_be(c.country) then public.be_region(c.zip) end
      from public.contacts c
     where c.company_id = _company
       and (_archived or c.is_active)
       and coalesce(c.notes, '') not like 'Donnees personnelles purgees (RGPD)%'
       -- Par defaut : les clients et prospects (ni fournisseurs ni organismes).
       and (case when _types is null then c.type::text in ('particulier', 'professionnel') else c.type::text = any(_types) end)
       and (_statuses is null or c.status::text = any(_statuses))
       and (_code_from is null or (case when c.code ~ '^[0-9]+$' and _code_from ~ '^[0-9]+$'
                                        then c.code::bigint >= _code_from::bigint else c.code >= _code_from end))
       and (_code_to is null or (case when c.code ~ '^[0-9]+$' and _code_to ~ '^[0-9]+$'
                                      then c.code::bigint <= _code_to::bigint else c.code <= _code_to end))
       and (_name is null or public.contact_norm_txt(concat_ws(' ', c.last_name, c.first_name, c.company_name)) like '%' || _name || '%')
       and (_civs is null or c.civility = any(_civs) or c.legal_form = any(_civs))
       and (_cats is null or c.category = any(_cats))
       and (_tars is null or c.price_list = any(_tars))
       and (_created_from is null or c.created_at >= _created_from)
       and (_created_to is null or c.created_at < _created_to + 1)
       and (_birth_from is null or c.birth_date >= _birth_from)
       and (_birth_to is null or c.birth_date <= _birth_to)
       and (_bday_from is null or _bday_to is null or (c.birth_date is not null and (
             case when _bday_from <= _bday_to
                  then to_char(c.birth_date, 'MM-DD') between _bday_from and _bday_to
                  else to_char(c.birth_date, 'MM-DD') >= _bday_from or to_char(c.birth_date, 'MM-DD') <= _bday_to end)))
       and (not _ex_email or nullif(btrim(c.email), '') is null)
       and (not _ex_mobile or nullif(btrim(c.mobile), '') is null)
       and (not _ex_opt or not c.marketing_opt_out)
       and (_groups is null or exists (select 1 from public.contact_group_members g
                                        where g.contact_id = c.id and g.group_code = any(_groups)))
       and (_consent is null
            or (_consent = 'email' and public._consent_channel(c.id, 'email') = 'accepte')
            or (_consent = 'sms' and public._consent_channel(c.id, 'sms') = 'accepte')
            or (_consent = 'any' and 'accepte' in (public._consent_channel(c.id, 'email'), public._consent_channel(c.id, 'sms'),
                                                   public._consent_channel(c.id, 'courrier'), public._consent_channel(c.id, 'telephone')))
            or (_consent = 'none_refused' and not exists (
                  select 1 from unnest(array['email', 'sms', 'courrier', 'telephone']) ch
                   where public._consent_channel(c.id, ch) = 'refuse')))
       and (not (_veh or _veh_brand is not null or _veh_model is not null or _ct_from is not null or _ct_to is not null)
            or exists (select 1 from public.vehicle_owners o join public.vehicles v on v.id = o.vehicle_id
                        where o.contact_id = c.id
                          and (not _veh_current or o.is_current)
                          and (_veh_brand is null or public.contact_norm_txt(v.brand) like '%' || _veh_brand || '%')
                          and (_veh_model is null or public.contact_norm_txt(v.model) like '%' || _veh_model || '%')
                          and (_ct_from is null or v.next_inspection_date >= _ct_from)
                          and (_ct_to is null or v.next_inspection_date <= _ct_to)))
       and (_place is null or public.contact_norm_txt(c.city) like '%' || _place || '%' or coalesce(c.zip, '') like _place || '%')
       and (_provinces is null or (public._is_be(c.country) and public.be_province(c.zip) = any(_provinces)))
       and (_regions is null or (public._is_be(c.country) and public.be_region(c.zip) = any(_regions)))
       and (_countries is null or (case when public._is_be(c.country) then 'BE' else upper(btrim(c.country)) end) = any(_countries))
       and (not _ex_npai or not coalesce(c.address_mismatch, false))
       and (_sales_mode is null
            or (_sales_mode = 'with_invoice' and exists (
                  select 1 from public.documents d
                   where d.contact_id = c.id and d.doc_type in ('FAC', 'TIK')
                     and d.status not in ('brouillon', 'annulee', 'converti')
                     and (_sales_from is null or d.issue_date >= _sales_from)
                     and (_sales_to is null or d.issue_date <= _sales_to)
                     and (not _art_filter or exists (
                           select 1 from public.document_lines l join public.articles a on a.id = l.article_id
                            where l.document_id = d.id
                              and (_supplier is null or a.main_supplier_id = _supplier)
                              and (_rayon is null or public.contact_norm_txt(a.category_path) like '%' || _rayon || '%')
                              and (_article is null or public.contact_norm_txt(a.reference) = _article
                                   or public.contact_norm_txt(a.designation) like '%' || _article || '%')
                              and (_brand is null or public.contact_norm_txt(a.brand) like '%' || _brand || '%')))))
            or (_sales_mode = 'without_invoice' and not exists (
                  select 1 from public.documents d
                   where d.contact_id = c.id and d.doc_type in ('FAC', 'TIK')
                     and d.status not in ('brouillon', 'annulee', 'converti')
                     and (_sales_from is null or d.issue_date >= _sales_from)
                     and (_sales_to is null or d.issue_date <= _sales_to)))
            or (_sales_mode = 'workshop' and exists (
                  select 1 from public.repair_orders r
                   where r.contact_id = c.id and r.status <> 'annule'
                     and (_sales_from is null or r.created_at >= _sales_from)
                     and (_sales_to is null or r.created_at < _sales_to + 1))))
  ) x
  order by x.last_name nulls last, x.first_name nulls last, x.company_name nulls last
  limit 20000;
end $$;
revoke all on function public.contacts_extract(uuid, jsonb) from public, anon;
grant execute on function public.contacts_extract(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Campagnes e-mail / SMS en mode essai
-- ---------------------------------------------------------------------
create table if not exists public.marketing_campaigns (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete restrict,
  channel           text not null check (channel in ('email', 'sms')),
  name              text not null,
  subject           text,
  body              text not null,
  -- Mode essai UNIQUEMENT : aucune autre valeur n'est admise et aucune fonction d'envoi n'existe.
  mode              text not null default 'test' check (mode = 'test'),
  status            text not null default 'preparee' check (status in ('preparee', 'annulee')),
  criteria          jsonb not null default '{}'::jsonb,
  recipients_count  int not null default 0,
  skipped_count     int not null default 0,
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  cancelled_at      timestamptz
);
create index if not exists idx_marketing_campaigns_company on public.marketing_campaigns(company_id, created_at desc);
comment on table public.marketing_campaigns is
  'G8 Mailing E-mail / Mailing SMS : campagne PREPAREE en mode essai (mode = test impose). Rien n''est envoye : '
  'brancher un vrai envoi demandera une decision client, un fournisseur SMS et une nouvelle migration.';

create table if not exists public.marketing_campaign_recipients (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete restrict,
  campaign_id       uuid not null references public.marketing_campaigns(id) on delete cascade,
  contact_id        uuid references public.contacts(id) on delete set null,
  address           text,
  status            text not null check (status in ('pret', 'ignore')),
  skip_reason       text check (skip_reason is null or skip_reason in
                      ('sans_email', 'sans_mobile', 'oppose_marketing', 'consentement_refuse', 'archive')),
  rendered_subject  text,
  rendered_body     text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_mcr_campaign on public.marketing_campaign_recipients(campaign_id);
create index if not exists idx_mcr_contact on public.marketing_campaign_recipients(contact_id, created_at desc);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_recipients enable row level security;
revoke all on public.marketing_campaigns, public.marketing_campaign_recipients from anon;
revoke insert, update, delete on public.marketing_campaigns, public.marketing_campaign_recipients from authenticated;
grant select on public.marketing_campaigns, public.marketing_campaign_recipients to authenticated;
drop policy if exists marketing_campaigns_select on public.marketing_campaigns;
create policy marketing_campaigns_select on public.marketing_campaigns for select to authenticated
  using (public.is_member(company_id));
drop policy if exists marketing_campaign_recipients_select on public.marketing_campaign_recipients;
create policy marketing_campaign_recipients_select on public.marketing_campaign_recipients for select to authenticated
  using (public.is_member(company_id));

drop trigger if exists trg_marketing_campaigns_audit on public.marketing_campaigns;
create trigger trg_marketing_campaigns_audit after insert or update or delete on public.marketing_campaigns
  for each row execute function public.audit_row();

-- Remplace {civilite} {prenom} {nom} {societe} {code} dans un texte.
create or replace function public._campaign_render(_t text, _c public.contacts)
returns text language sql immutable set search_path = public, pg_temp as $$
  select replace(replace(replace(replace(replace(coalesce(_t, ''),
           '{civilite}', coalesce(case _c.civility when 'Monsieur' then 'M.' when 'Madame' then 'Mme' when 'Mx' then 'Mx' else '' end, '')),
           '{prenom}', coalesce(initcap(_c.first_name), '')),
           '{nom}', coalesce(initcap(_c.last_name), '')),
           '{societe}', coalesce(_c.company_name, '')),
           '{code}', coalesce(_c.code, ''));
$$;

create or replace function public.marketing_campaign_prepare(
  _company uuid, _channel text, _name text, _subject text, _body text, _contacts uuid[], _criteria jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _id uuid;
  _c public.contacts%rowtype;
  _addr text; _skip text;
  _ok int := 0; _ko int := 0;
begin
  if auth.uid() is null or not public.is_member(_company) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if _channel not in ('email', 'sms') then raise exception 'CAMPAIGN_CHANNEL' using errcode = '22023'; end if;
  if nullif(btrim(_name), '') is null or nullif(btrim(_body), '') is null then
    raise exception 'CAMPAIGN_EMPTY' using errcode = '22023';
  end if;
  if _channel = 'email' and nullif(btrim(_subject), '') is null then
    raise exception 'CAMPAIGN_SUBJECT' using errcode = '22023';
  end if;
  if cardinality(coalesce(_contacts, '{}')) = 0 then raise exception 'CAMPAIGN_NO_RECIPIENT' using errcode = '22023'; end if;
  if cardinality(_contacts) > 20000 then raise exception 'CAMPAIGN_TOO_MANY' using errcode = '22023'; end if;

  insert into public.marketing_campaigns (company_id, channel, name, subject, body, criteria)
  values (_company, _channel, btrim(_name), nullif(btrim(_subject), ''), _body, coalesce(_criteria, '{}'::jsonb))
  returning id into _id;

  for _c in select * from public.contacts where company_id = _company and id = any(_contacts) loop
    _addr := case when _channel = 'email' then nullif(btrim(_c.email), '') else nullif(btrim(_c.mobile), '') end;
    _skip := case
      when not _c.is_active then 'archive'
      when _addr is null then case when _channel = 'email' then 'sans_email' else 'sans_mobile' end
      when _c.marketing_opt_out then 'oppose_marketing'
      when public._consent_channel(_c.id, _channel) = 'refuse' then 'consentement_refuse'
    end;
    insert into public.marketing_campaign_recipients (company_id, campaign_id, contact_id, address, status, skip_reason,
                                                      rendered_subject, rendered_body)
    values (_company, _id, _c.id, _addr, case when _skip is null then 'pret' else 'ignore' end, _skip,
            case when _channel = 'email' then public._campaign_render(_subject, _c) end,
            public._campaign_render(_body, _c));
    if _skip is null then _ok := _ok + 1; else _ko := _ko + 1; end if;
  end loop;

  update public.marketing_campaigns set recipients_count = _ok, skipped_count = _ko where id = _id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'marketing_campaign_prepared_test', 'marketing_campaigns', _id::text, 'screen',
          jsonb_build_object('channel', _channel, 'mode', 'test', 'ready', _ok, 'skipped', _ko));
  return _id;
end $$;
revoke all on function public.marketing_campaign_prepare(uuid, text, text, text, text, uuid[], jsonb) from public, anon;
grant execute on function public.marketing_campaign_prepare(uuid, text, text, text, text, uuid[], jsonb) to authenticated;

create or replace function public.marketing_campaign_cancel(_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _co uuid;
begin
  select company_id into _co from public.marketing_campaigns where id = _id and status = 'preparee';
  if _co is null then raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_member(_co) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.marketing_campaigns set status = 'annulee', cancelled_at = now() where id = _id;
end $$;
revoke all on function public.marketing_campaign_cancel(uuid) from public, anon;
grant execute on function public.marketing_campaign_cancel(uuid) to authenticated;

notify pgrst, 'reload schema';
