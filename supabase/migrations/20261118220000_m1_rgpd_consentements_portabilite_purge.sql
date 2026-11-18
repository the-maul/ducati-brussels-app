-- =====================================================================
-- M1 — RGPD (rattrapage G8 du 18/11/2026, lot « lot-g8-clients »).
--
-- G8 (fiche client, onglet RGPD + barre du bas + liste) :
--   * declarations de consentement : Date · Statut · Accepte · Refuse · Formulaire · Expiration,
--     boutons Nouvelle declaration · Revoquer · Supprimer ;
--   * « RGPD - Edition fiche » et « RGPD - Portabilite » (export des donnees du client) ;
--   * « RGPD - Purge » en deux phases : identification (prospects de plus de 3 ans, clients
--     sans facture depuis plus de 5 ans, sauf document en cours) puis confirmation.
--
-- Ce que fait cette migration (STRICTEMENT ADDITIVE, idempotente) :
--   1. table contact_consents (declarations ; revocation tracee ; jamais modifiee autrement) ;
--   2. contact_consent_channel / contact_consent_state : etat d'un canal (email, sms, courrier,
--      telephone) d'apres la derniere declaration valable ;
--   3. contact_gdpr_export : toutes les donnees d'un client en un JSON (portabilite et edition
--      de la fiche RGPD), l'export lui-meme est trace dans events (sans donnees personnelles) ;
--   4. purge en deux phases : gdpr_purge_runs / gdpr_purge_items, gdpr_purge_identify (phase 1,
--      ne modifie aucune fiche), gdpr_purge_confirm (phase 2, admin, re-verifie chaque fiche),
--      gdpr_purge_abandon. La purge ANONYMISE (elle ne supprime pas la fiche : les factures et
--      le journal doivent rester coherents) et efface les donnees personnelles des traces events
--      de la fiche (droit a l'effacement). Duree legale de conservation des factures : les fiches
--      dont la derniere facture a moins de N ans (10 par defaut) gardent nom, adresse et TVA
--      (mentions de facture) et perdent tout le reste.
--   Reglages (Parametres -> Tables, cle « gdpr_purge », code « default ») :
--      extra.prospect_years (3), extra.client_years (5), extra.legal_years (10).
--
-- NE PAS APPLIQUER depuis un agent. Essai a blanc : supabase/tests/m1_rgpd_purge.sql
-- (dans une transaction annulee, apres cette migration).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Declarations de consentement
-- ---------------------------------------------------------------------
create table if not exists public.contact_consents (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  declared_at    date not null default current_date,
  accepted       text[] not null default '{}',
  refused        text[] not null default '{}',
  form           text,
  form_ref       text,
  expires_at     date,
  note           text,
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users(id) on delete set null,
  revoke_reason  text,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint contact_consents_channels_check
    check (accepted <@ array['email', 'sms', 'courrier', 'telephone']::text[]
       and refused  <@ array['email', 'sms', 'courrier', 'telephone']::text[]
       and not (accepted && refused)
       and cardinality(accepted) + cardinality(refused) > 0),
  constraint contact_consents_expiry_check check (expires_at is null or expires_at >= declared_at)
);
create index if not exists idx_contact_consents_contact on public.contact_consents(contact_id, declared_at desc);
create index if not exists idx_contact_consents_company on public.contact_consents(company_id);

comment on table public.contact_consents is
  'RGPD (G8 onglet RGPD) : une declaration de consentement par ligne. accepted / refused = canaux '
  '(email, sms, courrier, telephone). form = formulaire (comptoir, inscription en ligne, borne, papier signe, telephone, autre). '
  'Statut calcule : revoquee (revoked_at), expiree (expires_at depassee), sinon active. Seule la revocation modifie une ligne.';

-- La societe vient TOUJOURS de la fiche (jamais une declaration d'une societe sur la fiche d'une autre).
create or replace function public._contact_child_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select c.company_id into new.company_id from public.contacts c where c.id = new.contact_id;
  if new.company_id is null then
    raise exception 'CONTACT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return new;
end $$;
revoke all on function public._contact_child_company() from public, anon, authenticated;

drop trigger if exists trg_contact_consents_company on public.contact_consents;
create trigger trg_contact_consents_company before insert on public.contact_consents
  for each row execute function public._contact_child_company();

-- Garde : une declaration ne se modifie pas ; seule la revocation (une fois) est permise.
create or replace function public._contact_consents_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.revoked_at is not null then
    raise exception 'CONSENT_ALREADY_REVOKED' using errcode = '22023',
      hint = 'Une declaration revoquee ne se modifie plus : faites une nouvelle declaration.';
  end if;
  if new.revoked_at is null
     or new.contact_id   is distinct from old.contact_id
     or new.company_id   is distinct from old.company_id
     or new.declared_at  is distinct from old.declared_at
     or new.accepted     is distinct from old.accepted
     or new.refused      is distinct from old.refused
     or new.form         is distinct from old.form
     or new.form_ref     is distinct from old.form_ref
     or new.expires_at   is distinct from old.expires_at
     or new.note         is distinct from old.note
     or new.created_by   is distinct from old.created_by
     or new.created_at   is distinct from old.created_at then
    raise exception 'CONSENT_IMMUTABLE' using errcode = '22023',
      hint = 'Une declaration de consentement ne se modifie pas : revoquez-la et faites-en une nouvelle.';
  end if;
  new.revoked_by := coalesce(new.revoked_by, auth.uid());
  return new;
end $$;

drop trigger if exists trg_contact_consents_guard on public.contact_consents;
create trigger trg_contact_consents_guard before update on public.contact_consents
  for each row execute function public._contact_consents_guard();
drop trigger if exists trg_contact_consents_audit on public.contact_consents;
create trigger trg_contact_consents_audit after insert or update or delete on public.contact_consents
  for each row execute function public.audit_row();

alter table public.contact_consents enable row level security;
revoke all on public.contact_consents from anon;
drop policy if exists contact_consents_select on public.contact_consents;
create policy contact_consents_select on public.contact_consents for select to authenticated
  using (public.is_member(company_id));
drop policy if exists contact_consents_insert on public.contact_consents;
create policy contact_consents_insert on public.contact_consents for insert to authenticated
  with check (public.is_member(company_id));
drop policy if exists contact_consents_update on public.contact_consents;
create policy contact_consents_update on public.contact_consents for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
-- « Supprimer » (G8) : administrateurs seulement, et trace par audit_row.
drop policy if exists contact_consents_delete on public.contact_consents;
create policy contact_consents_delete on public.contact_consents for delete to authenticated
  using (public.is_admin(company_id));

-- ---------------------------------------------------------------------
-- 2. Etat d'un canal : 'accepte' | 'refuse' | null (aucune declaration valable)
--    La derniere declaration non revoquee et non expiree qui cite le canal fait foi.
--    Repli : l'inscription en ligne (contacts.marketing_consent_at) vaut accord e-mail et SMS.
-- ---------------------------------------------------------------------
create or replace function public.contact_consent_channel(_contact uuid, _channel text, _on date default current_date)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select case when _channel = any(k.accepted) then 'accepte' else 'refuse' end
       from public.contact_consents k
      where k.contact_id = _contact
        and k.revoked_at is null
        and (k.expires_at is null or k.expires_at >= _on)
        and k.declared_at <= _on
        and (_channel = any(k.accepted) or _channel = any(k.refused))
      order by k.declared_at desc, k.created_at desc
      limit 1),
    (select 'accepte' from public.contacts c
      where c.id = _contact and c.marketing_consent_at is not null and _channel in ('email', 'sms'))
  )
  where exists (select 1 from public.contacts c where c.id = _contact and public.is_member(c.company_id));
$$;
revoke all on function public.contact_consent_channel(uuid, text, date) from public, anon;
grant execute on function public.contact_consent_channel(uuid, text, date) to authenticated;

-- Version interne, sans garde (appelee par les fonctions security definer ci-dessous).
create or replace function public._consent_channel(_contact uuid, _channel text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select case when _channel = any(k.accepted) then 'accepte' else 'refuse' end
       from public.contact_consents k
      where k.contact_id = _contact
        and k.revoked_at is null
        and (k.expires_at is null or k.expires_at >= current_date)
        and k.declared_at <= current_date
        and (_channel = any(k.accepted) or _channel = any(k.refused))
      order by k.declared_at desc, k.created_at desc
      limit 1),
    (select 'accepte' from public.contacts c
      where c.id = _contact and c.marketing_consent_at is not null and _channel in ('email', 'sms'))
  );
$$;
revoke all on function public._consent_channel(uuid, text) from public, anon, authenticated;

create or replace function public.contact_consent_state(_contact uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.contacts c where c.id = _contact and public.is_member(c.company_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'email',     public._consent_channel(_contact, 'email'),
    'sms',       public._consent_channel(_contact, 'sms'),
    'courrier',  public._consent_channel(_contact, 'courrier'),
    'telephone', public._consent_channel(_contact, 'telephone')
  );
end $$;
revoke all on function public.contact_consent_state(uuid) from public, anon;
grant execute on function public.contact_consent_state(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Portabilite / edition de la fiche RGPD : toutes les donnees d'un client
--    Lignes entieres (to_jsonb), seules les colonnes purement techniques sont retirees.
-- ---------------------------------------------------------------------
create or replace function public.contact_gdpr_export(_contact uuid, _purpose text default 'portabilite')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _c   public.contacts%rowtype;
  _out jsonb;
  _groups jsonb;
  _tech text[] := array['company_id', 'sign_token', 'token', 'created_by', 'uploaded_by', 'content_hash'];
begin
  select * into _c from public.contacts where id = _contact;
  if _c.id is null or not public.is_member(_c.company_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if _purpose not in ('portabilite', 'edition') then _purpose := 'portabilite'; end if;

  _out := jsonb_build_object(
    'generated_at', now(),
    'purpose', _purpose,
    'controller', (select jsonb_build_object('name', coalesce(co.legal_name, co.name), 'vat_number', co.vat_number,
                                             'address', concat_ws(' ', co.address, co.zip, co.city))
                     from public.companies co where co.id = _c.company_id),
    'contact', to_jsonb(_c) - _tech - array['my_ducati_data'],
    'consents', coalesce((select jsonb_agg(to_jsonb(k) - _tech order by k.declared_at desc)
                            from public.contact_consents k where k.contact_id = _contact), '[]'::jsonb),
    'consent_state', jsonb_build_object(
      'email', public._consent_channel(_contact, 'email'), 'sms', public._consent_channel(_contact, 'sms'),
      'courrier', public._consent_channel(_contact, 'courrier'), 'telephone', public._consent_channel(_contact, 'telephone')),
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object(
                             'vin', v.vin, 'plate', v.plate, 'brand', v.brand, 'model', v.model,
                             'from_date', o.from_date, 'to_date', o.to_date, 'is_current', o.is_current)
                           order by o.from_date desc nulls last)
                            from public.vehicle_owners o join public.vehicles v on v.id = o.vehicle_id
                           where o.contact_id = _contact), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(
                             (to_jsonb(d) - _tech) || jsonb_build_object('lines',
                               coalesce((select jsonb_agg(jsonb_build_object(
                                          'designation', l.designation, 'quantity', l.quantity,
                                          'unit_price_ht', l.unit_price_ht, 'vat_rate', l.vat_rate,
                                          'discount_pct', l.discount_pct, 'line_ttc', l.line_ttc) order by l.sort_order)
                                          from public.document_lines l where l.document_id = d.id), '[]'::jsonb))
                           order by d.issue_date desc)
                            from public.documents d where d.contact_id = _contact), '[]'::jsonb),
    'repair_orders', coalesce((select jsonb_agg(to_jsonb(r) - _tech order by r.created_at desc)
                                 from public.repair_orders r where r.contact_id = _contact), '[]'::jsonb),
    'workshop_appointments', coalesce((select jsonb_agg(to_jsonb(a) - _tech order by a.starts_at desc)
                                         from public.workshop_appointments a where a.contact_id = _contact), '[]'::jsonb),
    'communications', coalesce((select jsonb_agg(to_jsonb(m) - _tech order by m.occurred_at desc)
                                  from public.communications m where m.contact_id = _contact), '[]'::jsonb),
    'delivery_addresses', coalesce((select jsonb_agg(to_jsonb(x) - _tech)
                                      from public.delivery_addresses x where x.contact_id = _contact), '[]'::jsonb),
    'subcontacts', coalesce((select jsonb_agg(to_jsonb(x) - _tech)
                               from public.contact_subcontacts x where x.contact_id = _contact), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('file_name', a.file_name, 'folder', a.folder,
                                                                 'content_type', a.content_type, 'created_at', a.created_at)
                                              order by a.created_at desc)
                               from public.attachments a where a.entity_type = 'contact' and a.entity_id = _contact), '[]'::jsonb),
    'app_account', (select jsonb_build_object('first_portal_visit_at', ca.first_portal_visit_at,
                                              'last_portal_visit_at', ca.last_portal_visit_at)
                      from public.contact_accounts ca where ca.contact_id = _contact)
  );

  -- Groupes et campagnes (tables de la migration 20261118221000 / 222000) si elles existent deja.
  if to_regclass('public.contact_group_members') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('code', m.group_code,
                 'label', (select r.label from public.reference_values r
                            where r.company_id = m.company_id and r.table_key = 'contact_group' and r.code = m.group_code))), '[]'::jsonb)
                 from public.contact_group_members m where m.contact_id = $1$q$
      into _groups using _contact;
    _out := _out || jsonb_build_object('groups', coalesce(_groups, '[]'::jsonb));
  end if;
  if to_regclass('public.contact_group_sales') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('member_code', c.code,
                 'participation_rate', g.participation_rate)), '[]'::jsonb)
                 from public.contact_group_sales g join public.contacts c on c.id = g.member_id
                where g.contact_id = $1$q$
      into _groups using _contact;
    _out := _out || jsonb_build_object('group_sales', coalesce(_groups, '[]'::jsonb));
  end if;
  if to_regclass('public.marketing_campaign_recipients') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('campaign', mc.name, 'channel', mc.channel,
                 'mode', mc.mode, 'prepared_at', r.created_at, 'status', r.status, 'skip_reason', r.skip_reason)
                 order by r.created_at desc), '[]'::jsonb)
                 from public.marketing_campaign_recipients r join public.marketing_campaigns mc on mc.id = r.campaign_id
                where r.contact_id = $1$q$
      into _groups using _contact;
    _out := _out || jsonb_build_object('campaigns', coalesce(_groups, '[]'::jsonb));
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_c.company_id, auth.uid(), 'gdpr_export', 'contacts', _contact::text, 'screen',
          jsonb_build_object('purpose', _purpose, 'code', _c.code));
  return _out;
end $$;
revoke all on function public.contact_gdpr_export(uuid, text) from public, anon;
grant execute on function public.contact_gdpr_export(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Purge en deux phases
-- ---------------------------------------------------------------------
create table if not exists public.gdpr_purge_runs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  status           text not null default 'identifie' check (status in ('identifie', 'execute', 'abandonne')),
  reference_date   date not null default current_date,
  prospect_before  date not null,
  client_before    date not null,
  legal_before     date not null,
  candidates       int not null default 0,
  kept_open        int not null default 0,
  executed_count   int not null default 0,
  identified_by    uuid references auth.users(id) on delete set null default auth.uid(),
  identified_at    timestamptz not null default now(),
  executed_by      uuid references auth.users(id) on delete set null,
  executed_at      timestamptz,
  abandoned_at     timestamptz
);
create index if not exists idx_gdpr_purge_runs_company on public.gdpr_purge_runs(company_id, identified_at desc);
comment on table public.gdpr_purge_runs is
  'RGPD - Purge (G8) : une ligne par passage. identifie (phase 1, aucune fiche modifiee) -> execute (phase 2, confirmee) ou abandonne.';

create table if not exists public.gdpr_purge_items (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  run_id             uuid not null references public.gdpr_purge_runs(id) on delete cascade,
  contact_id         uuid references public.contacts(id) on delete set null,
  contact_code       text,
  reason             text not null check (reason in ('prospect', 'client_sans_facture')),
  last_activity_at   date,
  last_invoice_date  date,
  mode               text not null check (mode in ('complete', 'partielle')),
  kept_reason        text,
  outcome            text check (outcome is null or outcome in ('anonymise', 'exclu', 'garde_document_en_cours', 'plus_eligible')),
  executed_at        timestamptz
);
create index if not exists idx_gdpr_purge_items_run on public.gdpr_purge_items(run_id);
create index if not exists idx_gdpr_purge_items_contact on public.gdpr_purge_items(contact_id);
comment on table public.gdpr_purge_items is
  'Fiches identifiees par une purge RGPD. kept_reason non vide = gardee (document en cours, compte client...). '
  'mode complete = tout est efface ; partielle = facture de moins de legal_years ans : nom, adresse et TVA gardes.';

alter table public.gdpr_purge_runs enable row level security;
alter table public.gdpr_purge_items enable row level security;
revoke all on public.gdpr_purge_runs, public.gdpr_purge_items from anon;
revoke insert, update, delete on public.gdpr_purge_runs, public.gdpr_purge_items from authenticated;
grant select on public.gdpr_purge_runs, public.gdpr_purge_items to authenticated;
drop policy if exists gdpr_purge_runs_select on public.gdpr_purge_runs;
create policy gdpr_purge_runs_select on public.gdpr_purge_runs for select to authenticated
  using (public.is_admin(company_id));
drop policy if exists gdpr_purge_items_select on public.gdpr_purge_items;
create policy gdpr_purge_items_select on public.gdpr_purge_items for select to authenticated
  using (public.is_admin(company_id));

-- Reglages de la purge (Parametres -> Tables, cle gdpr_purge). Valeurs G8 par defaut.
create or replace function public._gdpr_purge_settings(_company uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'prospect_years', greatest(1, coalesce((select (r.extra->>'prospect_years')::int from public.reference_values r
                        where r.company_id = _company and r.table_key = 'gdpr_purge' and r.code = 'default' and r.is_active), 3)),
    'client_years',   greatest(1, coalesce((select (r.extra->>'client_years')::int from public.reference_values r
                        where r.company_id = _company and r.table_key = 'gdpr_purge' and r.code = 'default' and r.is_active), 5)),
    'legal_years',    greatest(1, coalesce((select (r.extra->>'legal_years')::int from public.reference_values r
                        where r.company_id = _company and r.table_key = 'gdpr_purge' and r.code = 'default' and r.is_active), 10))
  );
$$;
revoke all on function public._gdpr_purge_settings(uuid) from public, anon, authenticated;

-- « Document en cours » (G8 : la fiche est gardee). Renvoie la premiere raison trouvee, ou null.
create or replace function public._contact_open_business(_id uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _n bigint;
begin
  if exists (select 1 from public.contact_accounts where contact_id = _id) then return 'compte_client'; end if;
  if exists (select 1 from public.documents d where d.contact_id = _id and (
         d.status = 'brouillon'
      or (d.doc_type in ('DEV', 'RES', 'BC', 'BL') and d.status = 'validee')
      or (d.doc_type in ('FAC', 'TIK') and d.status not in ('annulee', 'avoir_emis', 'converti', 'brouillon')
          and d.total_ttc - d.paid_amount > 0.005))) then
    return 'document_en_cours';
  end if;
  if exists (select 1 from public.repair_orders r where r.contact_id = _id and r.status not in ('facture', 'annule')) then
    return 'or_en_cours';
  end if;
  if exists (select 1 from public.workshop_appointments a where a.contact_id = _id
              and a.starts_at > now() and a.status not in ('annule', 'termine')) then
    return 'rdv_a_venir';
  end if;
  if exists (select 1 from public.consignments g where g.depositor_id = _id and g.status = 'en_depot') then
    return 'depot_vente';
  end if;
  if exists (select 1 from public.part_order_allocations p where p.contact_id = _id and p.cancelled_at is null) then
    return 'commande_pieces';
  end if;
  if exists (select 1 from public.leads l where l.contact_id = _id and l.archived_at is null and l.stage not in ('gagne', 'perdu')) then
    return 'carte_crm_ouverte';
  end if;
  if to_regclass('public.stock_reservations') is not null then
    execute 'select count(*) from public.stock_reservations where contact_id = $1 and status = ''active''' into _n using _id;
    if _n > 0 then return 'reservation_atelier'; end if;
  end if;
  if to_regclass('public.accident_files') is not null then
    execute 'select count(*) from public.accident_files where contact_id = $1 and status <> ''clos''' into _n using _id;
    if _n > 0 then return 'dossier_accident'; end if;
  end if;
  return null;
end $$;
revoke all on function public._contact_open_business(uuid) from public, anon, authenticated;

-- Derniere activite d'une fiche (creation, document, echange, OR, RDV).
create or replace function public._contact_last_activity(_id uuid)
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(
    (select (c.created_at at time zone 'Europe/Brussels')::date from public.contacts c where c.id = _id),
    (select max(d.issue_date) from public.documents d where d.contact_id = _id),
    (select max((m.occurred_at at time zone 'Europe/Brussels')::date) from public.communications m where m.contact_id = _id),
    (select max((r.created_at at time zone 'Europe/Brussels')::date) from public.repair_orders r where r.contact_id = _id),
    (select max((a.starts_at at time zone 'Europe/Brussels')::date) from public.workshop_appointments a where a.contact_id = _id)
  );
$$;
revoke all on function public._contact_last_activity(uuid) from public, anon, authenticated;

create or replace function public._contact_last_invoice(_id uuid)
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select max(d.issue_date) from public.documents d
   where d.contact_id = _id and d.doc_type in ('FAC', 'TIK') and d.status not in ('brouillon', 'annulee');
$$;
revoke all on function public._contact_last_invoice(uuid) from public, anon, authenticated;

-- Eligibilite d'une fiche a la date de reference : 'prospect' | 'client_sans_facture' | null.
create or replace function public._gdpr_purge_reason(_id uuid, _prospect_before date, _client_before date)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _c public.contacts%rowtype; _inv date; _act date;
begin
  select * into _c from public.contacts where id = _id;
  if _c.id is null or _c.type in ('fournisseur', 'banque_leasing', 'employe') then return null; end if;
  -- Deja purgee : ne revient pas.
  if _c.notes like 'Donnees personnelles purgees (RGPD)%' then return null; end if;
  _inv := public._contact_last_invoice(_id);
  _act := public._contact_last_activity(_id);
  if _c.status = 'prospect' and _inv is null then
    if _act < _prospect_before then return 'prospect'; end if;
    return null;
  end if;
  -- Client : ni facture ni autre activite (echange, OR, RDV) depuis la date limite.
  if coalesce(_inv, _act) < _client_before and _act < _client_before then return 'client_sans_facture'; end if;
  return null;
end $$;
revoke all on function public._gdpr_purge_reason(uuid, date, date) from public, anon, authenticated;

-- PHASE 1 : identification. Ne modifie AUCUNE fiche. Admin.
create or replace function public.gdpr_purge_identify(_company uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _s jsonb := public._gdpr_purge_settings(_company);
  _run uuid;
  _pb date := (current_date - make_interval(years => (_s->>'prospect_years')::int))::date;
  _cb date := (current_date - make_interval(years => (_s->>'client_years')::int))::date;
  _lb date := (current_date - make_interval(years => (_s->>'legal_years')::int))::date;
  _r record;
  _reason text; _kept text; _inv date;
  _n int := 0; _k int := 0;
begin
  if auth.uid() is null or not public.is_admin(_company) then
    raise exception 'FORBIDDEN' using errcode = '42501', hint = 'La purge RGPD est reservee aux administrateurs.';
  end if;
  -- Une seule identification ouverte a la fois : l'ancienne est abandonnee.
  update public.gdpr_purge_runs set status = 'abandonne', abandoned_at = now()
   where company_id = _company and status = 'identifie';

  insert into public.gdpr_purge_runs (company_id, prospect_before, client_before, legal_before)
  values (_company, _pb, _cb, _lb) returning id into _run;

  for _r in
    select c.id, c.code from public.contacts c
     where c.company_id = _company and c.type not in ('fournisseur', 'banque_leasing', 'employe')
       and coalesce(c.notes, '') not like 'Donnees personnelles purgees (RGPD)%'
  loop
    _reason := public._gdpr_purge_reason(_r.id, _pb, _cb);
    continue when _reason is null;
    _kept := public._contact_open_business(_r.id);
    _inv := public._contact_last_invoice(_r.id);
    insert into public.gdpr_purge_items (company_id, run_id, contact_id, contact_code, reason, last_activity_at,
                                         last_invoice_date, mode, kept_reason)
    values (_company, _run, _r.id, _r.code, _reason, public._contact_last_activity(_r.id), _inv,
            case when _inv is not null and _inv >= _lb then 'partielle' else 'complete' end, _kept);
    _n := _n + 1;
    if _kept is not null then _k := _k + 1; end if;
  end loop;

  update public.gdpr_purge_runs set candidates = _n, kept_open = _k where id = _run;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'gdpr_purge_identify', 'gdpr_purge_runs', _run::text, 'screen',
          jsonb_build_object('candidates', _n, 'kept_open', _k, 'prospect_before', _pb, 'client_before', _cb, 'legal_before', _lb));
  return _run;
end $$;
revoke all on function public.gdpr_purge_identify(uuid) from public, anon;
grant execute on function public.gdpr_purge_identify(uuid) to authenticated;

-- Retire les donnees personnelles d'une trace (cles de contacts et des sous-objets).
create or replace function public._gdpr_redact(_j jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select case when _j is null then null else
    _j - array['first_name', 'last_name', 'company_name', 'contact_name', 'email', 'email_pro', 'phone', 'mobile', 'gsm',
               'phone_pro', 'mobile_pro', 'fax', 'address', 'street_number', 'address_complement', 'address_complement2',
               'po_box', 'zip', 'city', 'birth_date', 'birth_place', 'birth_name', 'birth_zip', 'national_id',
               'national_register', 'license_number', 'license_date', 'license_place', 'license_issued_by',
               'license_scan_path', 'national_id_scan_path', 'iban', 'bic', 'domiciliation', 'notes', 'watch_note',
               'vat_number', 'delivery_address', 'my_ducati_email', 'my_ducati_first_name', 'my_ducati_last_name',
               'my_ducati_phone', 'my_ducati_city', 'my_ducati_data', 'subject', 'body', 'name', 'role', 'note',
               'kept', 'absorbed', 'kept_after']
      || jsonb_build_object('gdpr_redacted', true)
  end;
$$;

-- Anonymisation d'une fiche (interne). _mode : complete | partielle.
create or replace function public._gdpr_anonymise_contact(_id uuid, _mode text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _stamp text := to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY');
  _code text;
begin
  select code into _code from public.contacts where id = _id;
  -- Les fiches liees (pro <-> prive) sont deliees d'abord : sinon le nom repris de la fiche
  -- privee serait recopie (vide) sur la fiche pro liee.
  delete from public.contact_links where contact_a = _id or contact_b = _id;

  update public.contacts set
    first_name   = case when _mode = 'complete' then null else first_name end,
    last_name    = case when _mode = 'complete' then 'ANONYMISE ' || coalesce(_code, '') else last_name end,
    company_name = case when _mode = 'complete' then null else company_name end,
    civility     = case when _mode = 'complete' then null else civility end,
    address      = case when _mode = 'complete' then null else address end,
    street_number = case when _mode = 'complete' then null else street_number end,
    address_complement = case when _mode = 'complete' then null else address_complement end,
    address_complement2 = case when _mode = 'complete' then null else address_complement2 end,
    po_box       = case when _mode = 'complete' then null else po_box end,
    zip          = case when _mode = 'complete' then null else zip end,
    city         = case when _mode = 'complete' then null else city end,
    vat_number   = case when _mode = 'complete' then null else vat_number end,
    email = null, email_pro = null, phone = null, mobile = null, gsm = null, phone_pro = null, mobile_pro = null, fax = null,
    contact_name = null, delivery_address = null,
    birth_date = null, birth_place = null,
    national_id = null, national_register = null,
    license_number = null, license_date = null, license_place = null, license_category = null,
    license_scan_path = null, national_id_scan_path = null,
    iban = null, bic = null, domiciliation = null,
    watch_note = null, interests = '{}', model_interests = '{}',
    marketing_consent_at = null, marketing_consent_source = null, marketing_opt_out = true,
    ducati_url = null, ducati_code = null,
    my_ducati_email = null, my_ducati_first_name = null, my_ducati_last_name = null, my_ducati_phone = null,
    my_ducati_city = null, my_ducati_data = null,
    is_active = false, is_vip = false,
    notes = 'Donnees personnelles purgees (RGPD) le ' || _stamp
            || case when _mode = 'partielle' then ' (nom, adresse et TVA gardes pour les factures)' else '' end
  where id = _id;

  -- Colonnes de la migration 20261118221000 (fiche G8), si elle est passee.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'birth_name') then
    execute 'update public.contacts set birth_name = null, birth_zip = null, license_issued_by = null where id = $1' using _id;
  end if;

  -- Sous-objets porteurs de donnees personnelles.
  delete from public.communications where contact_id = _id;
  delete from public.delivery_addresses where contact_id = _id;
  delete from public.contact_subcontacts where contact_id = _id;
  delete from public.contact_consents where contact_id = _id;
  delete from public.contact_merge_candidates where contact_id = _id or candidate_id = _id;
  delete from public.contact_invitations where contact_id = _id;
  if to_regclass('public.contact_group_members') is not null then
    execute 'delete from public.contact_group_members where contact_id = $1' using _id;
  end if;
  if to_regclass('public.contact_group_sales') is not null then
    execute 'delete from public.contact_group_sales where contact_id = $1 or member_id = $1' using _id;
  end if;
  if to_regclass('public.marketing_campaign_recipients') is not null then
    execute 'update public.marketing_campaign_recipients set address = null, rendered_subject = null, rendered_body = null where contact_id = $1' using _id;
  end if;

  -- Droit a l'effacement : les traces de la fiche et de ses sous-objets perdent leurs donnees
  -- personnelles (action, auteur et date restent).
  update public.events set old_data = public._gdpr_redact(old_data), new_data = public._gdpr_redact(new_data)
   where (entity_type = 'contacts' and entity_id = _id::text)
      or (entity_type in ('communications', 'delivery_addresses', 'contact_subcontacts', 'contact_consents',
                          'contact_group_members', 'contact_group_sales', 'contact_links')
          and (old_data->>'contact_id' = _id::text or new_data->>'contact_id' = _id::text
               or old_data->>'contact_a' = _id::text or old_data->>'contact_b' = _id::text));
end $$;
revoke all on function public._gdpr_anonymise_contact(uuid, text) from public, anon, authenticated;

-- PHASE 2 : confirmation. Admin. _excluded = fiches decochees a l'ecran (gardees).
-- Chaque fiche est re-verifiee (toujours eligible, aucun document en cours) au moment de purger.
create or replace function public.gdpr_purge_confirm(_run uuid, _excluded uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _r public.gdpr_purge_runs%rowtype;
  _i record;
  _kept text; _reason text;
  _done int := 0; _skipped int := 0;
begin
  select * into _r from public.gdpr_purge_runs where id = _run for update;
  if _r.id is null then raise exception 'PURGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if auth.uid() is null or not public.is_admin(_r.company_id) then
    raise exception 'FORBIDDEN' using errcode = '42501', hint = 'La purge RGPD est reservee aux administrateurs.';
  end if;
  if _r.status <> 'identifie' then raise exception 'PURGE_NOT_PENDING' using errcode = '22023'; end if;
  -- Une identification se confirme le jour meme (sinon on relance la phase 1).
  if _r.reference_date <> current_date then raise exception 'PURGE_STALE' using errcode = '22023'; end if;

  for _i in select * from public.gdpr_purge_items where run_id = _run and outcome is null loop
    if _i.contact_id is null then
      update public.gdpr_purge_items set outcome = 'plus_eligible', executed_at = now() where id = _i.id;
      _skipped := _skipped + 1; continue;
    end if;
    if _i.contact_id = any(coalesce(_excluded, '{}')) then
      update public.gdpr_purge_items set outcome = 'exclu', executed_at = now() where id = _i.id;
      _skipped := _skipped + 1; continue;
    end if;
    _kept := public._contact_open_business(_i.contact_id);
    if _kept is not null then
      update public.gdpr_purge_items set outcome = 'garde_document_en_cours', kept_reason = _kept, executed_at = now() where id = _i.id;
      _skipped := _skipped + 1; continue;
    end if;
    _reason := public._gdpr_purge_reason(_i.contact_id, _r.prospect_before, _r.client_before);
    if _reason is null then
      update public.gdpr_purge_items set outcome = 'plus_eligible', executed_at = now() where id = _i.id;
      _skipped := _skipped + 1; continue;
    end if;
    perform public._gdpr_anonymise_contact(_i.contact_id,
      case when public._contact_last_invoice(_i.contact_id) >= _r.legal_before then 'partielle' else 'complete' end);
    update public.gdpr_purge_items set outcome = 'anonymise', executed_at = now() where id = _i.id;
    _done := _done + 1;
  end loop;

  update public.gdpr_purge_runs set status = 'execute', executed_by = auth.uid(), executed_at = now(), executed_count = _done
   where id = _run;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_r.company_id, auth.uid(), 'gdpr_purge_confirm', 'gdpr_purge_runs', _run::text, 'screen',
          jsonb_build_object('anonymised', _done, 'skipped', _skipped,
                             'codes', (select coalesce(jsonb_agg(contact_code), '[]'::jsonb) from public.gdpr_purge_items
                                        where run_id = _run and outcome = 'anonymise')));
  return jsonb_build_object('anonymised', _done, 'skipped', _skipped);
end $$;
revoke all on function public.gdpr_purge_confirm(uuid, uuid[]) from public, anon;
grant execute on function public.gdpr_purge_confirm(uuid, uuid[]) to authenticated;

create or replace function public.gdpr_purge_abandon(_run uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _c uuid;
begin
  select company_id into _c from public.gdpr_purge_runs where id = _run and status = 'identifie';
  if _c is null then raise exception 'PURGE_NOT_PENDING' using errcode = '22023'; end if;
  if not public.is_admin(_c) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.gdpr_purge_runs set status = 'abandonne', abandoned_at = now() where id = _run;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_c, auth.uid(), 'gdpr_purge_abandon', 'gdpr_purge_runs', _run::text, 'screen', '{}'::jsonb);
end $$;
revoke all on function public.gdpr_purge_abandon(uuid) from public, anon;
grant execute on function public.gdpr_purge_abandon(uuid) to authenticated;

notify pgrst, 'reload schema';
