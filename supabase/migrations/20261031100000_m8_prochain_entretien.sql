-- =====================================================================
-- Mission 07, cartes 4 et 5 — « Prochain entretien de chaque moto » (M8 + M3, ATE014).
-- Décision du client du 30/10/2026 (Simon) : chaque moto a UNE date de prochain entretien
-- connue, avec sa source, pour les relances marketing (M10) et l'accueil atelier (M8).
--
-- Sources, par ordre de confiance (décision M-73) :
--   1. or_dms      : le dernier OR facturé du DMS dont une ligne est un entretien ;
--   2. invoice_g8  : les factures G8 relues (documents / document_lines, 89 853 lignes) ;
--   3. client      : ce que le client déclare (espace client, borne, inscription) ;
--   4. dcs_extract : l'extract DCS « ENTRETIEN EN RETARD 180 JOURS + 6 MOIS A VENIR » ;
--   5. plan        : aucun entretien connu, seulement une date de départ (garantie / mise en circulation).
-- Règle Ducati lue dans l'extract (M-74) : prochain = dernier entretien + 12 mois ;
-- premier entretien = 6 mois après le début de garantie ou 1 000 km ; au premier atteint (M-16).
-- Entre les sources 1 à 4, c'est le dernier entretien LE PLUS RÉCENT qui gagne ; à date égale,
-- l'ordre de confiance. Le plan (5) ne sert que si rien n'est connu.
--
-- Objets :
--   * vehicles : last_service_at, last_service_km, last_service_where, declared_km, declared_km_at ;
--   * vehicle_maintenance_due : une ligne courante par moto et par type d'échéance (historique conservé) ;
--   * dcs_maintenance_imports : dépôt de l'extract DCS (fichier, ligne, VIN, date, type), relançable ;
--   * maintenance_label_is_service(text) : reconnaît un entretien dans un libellé de facture ;
--   * vehicle_maintenance_recompute(_company, _vehicle) + _batch : pose la ligne courante ;
--   * vehicles_maintenance_upcoming(_company, _days) : motos à relancer (signature figée pour M10) ;
--   * dcs_maintenance_import(_company, _file, _rows, _apply) : import de l'extract (écran et script) ;
--   * espace client : portal_vehicle_service_declare, portal_declaration_service_set, portal_vehicle enrichi.
--
-- Non destructive : create if not exists / add column if not exists. NON APPLIQUÉE le 31/10/2026 :
-- essai à blanc en transaction annulée seulement.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ce que le client déclare, sur la moto
-- ---------------------------------------------------------------------
alter table public.vehicles
  add column if not exists last_service_at    date,
  add column if not exists last_service_km    integer,
  add column if not exists last_service_where text,
  add column if not exists declared_km        integer,
  add column if not exists declared_km_at     timestamptz;

comment on column public.vehicles.last_service_at is 'Mission 07 carte 5 : date du dernier entretien déclaré par le client (espace client, borne, fiche).';
comment on column public.vehicles.last_service_km is 'Mission 07 carte 5 : km au dernier entretien déclaré.';
comment on column public.vehicles.last_service_where is 'Mission 07 carte 5 : ici (chez nous) ou ailleurs.';
comment on column public.vehicles.declared_km is 'Mission 07 carte 5 : kilométrage actuel déclaré par le client (distinct de mileage, le km constaté par la concession).';
comment on column public.vehicles.declared_km_at is 'Mission 07 carte 5 : date de la déclaration du km.';

alter table public.vehicles drop constraint if exists vehicles_last_service_where_chk;
alter table public.vehicles add constraint vehicles_last_service_where_chk
  check (last_service_where is null or last_service_where in ('ici', 'ailleurs'));

-- Déjà en base (types.ts) mais absentes du dépôt : on les documente ici pour que le dépôt les connaisse.
alter table public.contact_declared_vehicles
  add column if not exists mileage_km    integer,
  add column if not exists last_services jsonb not null default '[]'::jsonb;
comment on column public.contact_declared_vehicles.mileage_km is 'Km actuel déclaré avec la moto (inscription, borne, espace client).';
comment on column public.contact_declared_vehicles.last_services is 'Derniers entretiens déclarés : [{"date":"AAAA-MM-JJ","km":12000,"where":"ici"|"ailleurs"}]. Recopiés sur la moto au rattachement.';

-- ---------------------------------------------------------------------
-- 2. Échéances d'entretien par moto
-- ---------------------------------------------------------------------
create table if not exists public.vehicle_maintenance_due (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  -- first_1000 (premier entretien), oil (vidange), annual (annuel), km (échéance kilométrique seule)
  kind            text not null check (kind in ('first_1000', 'oil', 'annual', 'km')),
  due_date        date,
  due_km          integer,
  source          text not null check (source in ('or_dms', 'invoice_g8', 'client', 'dcs_extract', 'plan')),
  source_ref      text,
  last_service_at date,
  last_service_km integer,
  computed_at     timestamptz not null default now(),
  is_current      boolean not null default true,
  created_at      timestamptz not null default now(),
  check (due_date is not null or due_km is not null)
);
comment on table public.vehicle_maintenance_due is
  'Mission 07 carte 4 : prochain entretien de chaque moto, avec sa source. Une seule ligne courante par moto et par kind ; les anciennes restent (is_current = false).';
comment on column public.vehicle_maintenance_due.source_ref is 'Référence lisible de la source : OR-…, FAC-…, « déclaré par le client le … », « extract DCS du … ligne n », « garantie du … ».';

create unique index if not exists uq_vmd_current on public.vehicle_maintenance_due(vehicle_id, kind) where is_current;
create index if not exists idx_vmd_company_due on public.vehicle_maintenance_due(company_id, due_date) where is_current;
create index if not exists idx_vmd_vehicle on public.vehicle_maintenance_due(vehicle_id, computed_at desc);

drop trigger if exists trg_vmd_audit on public.vehicle_maintenance_due;
create trigger trg_vmd_audit after insert or update or delete on public.vehicle_maintenance_due
  for each row execute function public.audit_row();

alter table public.vehicle_maintenance_due enable row level security;
drop policy if exists vmd_select on public.vehicle_maintenance_due;
create policy vmd_select on public.vehicle_maintenance_due for select to authenticated
  using (public.is_member(company_id));
drop policy if exists vmd_write on public.vehicle_maintenance_due;
create policy vmd_write on public.vehicle_maintenance_due for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- ---------------------------------------------------------------------
-- 3. Dépôt de l'extract DCS (relançable : un VIN + date + type n'entre qu'une fois)
-- ---------------------------------------------------------------------
create table if not exists public.dcs_maintenance_imports (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  file_name        text not null,
  row_no           integer,
  vin              text not null,
  vehicle_id       uuid references public.vehicles(id) on delete set null,
  warranty_start   date,
  planned_date     date not null,
  maintenance_type text not null,
  days_before      integer,
  dealer           text,
  imported_at      timestamptz not null default now(),
  imported_by      uuid references auth.users(id) on delete set null,
  unique (company_id, vin, planned_date, maintenance_type)
);
comment on table public.dcs_maintenance_imports is
  'Mission 07 carte 4 : lignes de l''extract DCS « ENTRETIEN EN RETARD 180 JOURS + 6 MOIS A VENIR » (feuille Export). Source dcs_extract du prochain entretien.';
create index if not exists idx_dcs_imports_vehicle on public.dcs_maintenance_imports(vehicle_id, planned_date desc);
create index if not exists idx_dcs_imports_file on public.dcs_maintenance_imports(company_id, imported_at desc);

alter table public.dcs_maintenance_imports enable row level security;
drop policy if exists dcs_imports_select on public.dcs_maintenance_imports;
create policy dcs_imports_select on public.dcs_maintenance_imports for select to authenticated
  using (public.is_member(company_id));
drop policy if exists dcs_imports_write on public.dcs_maintenance_imports;
create policy dcs_imports_write on public.dcs_maintenance_imports for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- ---------------------------------------------------------------------
-- 4. Reconnaître un entretien dans un libellé de facture
--    Miroir de isServiceLabel (src/modules/workshop/maintenance-due.ts). Vérifié sur les libellés
--    réels G8 : « VIDANGE », « ENTRETIEN SF V2 », « RODAGE 1000 KM » oui ; « BOUCHON VIDANGE HUILE »,
--    « KIT DE REVISION DE PIVOTS », « SERVICE BOOKLET », « T-SHIRT DESMO » non (pièces, merchandising).
-- ---------------------------------------------------------------------
create or replace function public.maintenance_label_is_service(_label text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select _label is not null
     and _label ~* '(\m(entretien|vidange|r[eéÉ]vision|service|rodage|annual|annuel|desmo)\M|\m1[ .]?000 ?km|\m(7|12|15|24|30|36)[ .]?000\M)'
     and _label !~* '(\m(bouchon|vis|kit|jeu|groupe|soupape|booklet|tasses?|t-?shirt|veste|manuel|embl[eè]me|d[eé]calcomanie|pantalon|polo|sweat|boots?|collection|pivots?|silenc\w*|meccano|casque|gants?|autocollant|joint|filtre|durite|[eé]trier)\M|\mbot\.)';
$$;
grant execute on function public.maintenance_label_is_service(text) to authenticated, service_role;

-- Type d'échéance d'après le type DCS.
create or replace function public._maintenance_dcs_kind(_type text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when coalesce(_type, '') ~* '(1[ .]?000|600 ?mi|first)' then 'first_1000'
    when coalesce(_type, '') ~* '(annual|annuel|temporel)' then 'annual'
    when coalesce(_type, '') ~* '(oil|vidange)' then 'oil'
    else 'annual' end;
$$;
revoke all on function public._maintenance_dcs_kind(text) from public, anon, authenticated;

-- Intervalle km de la vidange d'après le plan d'entretien de la moto (null si inconnu : rien n'est inventé).
create or replace function public._maintenance_plan_km_interval(_vehicle uuid)
returns integer language sql stable set search_path = public, pg_temp as $$
  select min(i.km_interval)
    from public.vehicles v
    join public.maintenance_plan_catalog_links l on l.model_year_id = v.ducati_model_year_id and l.status = 'lie'
    join public.maintenance_plans p on p.id = l.plan_id and p.usage = coalesce(v.maintenance_usage, 'route')
    join public.maintenance_plan_services s on s.plan_id = p.id
    join public.maintenance_service_intervals i on i.service_id = s.id and i.status = 'en_vigueur'
   where v.id = _vehicle
     and (s.code ilike '%oil%' or s.name ilike '%oil%' or s.name ilike '%vidange%')
     and i.km_interval is not null and i.km_interval > 0;
$$;
revoke all on function public._maintenance_plan_km_interval(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Le calcul : une ligne courante par moto
-- ---------------------------------------------------------------------
create or replace function public._vehicle_maintenance_recompute_core(_vehicle uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v           public.vehicles%rowtype;
  -- candidat « dernier entretien » retenu (source, date, km, référence)
  _c_source   text; _c_date date; _c_km integer; _c_ref text;
  _kind       text;
  _due        date;
  _due_km     integer;
  _km_int     integer;
  _start      date;
  _start_ref  text;
  _dcs        record;
  _today      date := current_date;
  _cur        record;
  _n          integer;
  _changed    boolean := false;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found then return null; end if;

  _km_int := public._maintenance_plan_km_interval(v.id);

  -- Candidats « dernier entretien » (sources 1 à 4) : le plus récent gagne, puis l'ordre de confiance.
  with cands as (
    -- 1. OR facturé du DMS : une ligne (ou les travaux) qui est un entretien.
    select 1 as rank, 'or_dms'::text as source,
           coalesce(d.issue_date, ro.updated_at::date) as last_date, ro.mileage::integer as last_km,
           'OR ' || coalesce(ro.number, left(ro.id::text, 8)) as ref
      from public.repair_orders ro
      left join public.documents d on d.id = ro.invoice_document_id
     where ro.vehicle_id = v.id and ro.status = 'facture'
       and (public.maintenance_label_is_service(ro.work_description)
            or exists (select 1 from public.repair_order_lines l where l.or_id = ro.id and public.maintenance_label_is_service(l.designation)))
    union all
    -- 2. Factures (G8 relues ou DMS) rattachées à la moto, avec une ligne d'entretien.
    select case when d.imported_from is not null then 2 else 1 end,
           case when d.imported_from is not null then 'invoice_g8' else 'or_dms' end,
           d.issue_date, null::integer,
           'FAC ' || coalesce(d.number, d.legacy_number, left(d.id::text, 8))
      from public.documents d
     where d.vehicle_id = v.id and d.doc_type = 'FAC' and d.status not in ('brouillon', 'annulee')
       and d.issue_date is not null
       and exists (select 1 from public.document_lines dl where dl.document_id = d.id and public.maintenance_label_is_service(dl.designation))
    union all
    -- 3. Déclaré par le client (espace client, borne, fiche).
    select 3, 'client', v.last_service_at, v.last_service_km,
           case v.last_service_where when 'ici' then 'déclaré par le client (chez nous)'
                                     when 'ailleurs' then 'déclaré par le client (ailleurs)'
                                     else 'déclaré par le client' end
     where v.last_service_at is not null
    union all
    -- 4. Extract DCS : la date planifiée est la vérité ; le dernier entretien s'en déduit (− 12 ou − 6 mois).
    select 4, 'dcs_extract',
           (i.planned_date - case when public._maintenance_dcs_kind(i.maintenance_type) = 'first_1000'
                                  then interval '6 months' else interval '12 months' end)::date,
           null::integer,
           'extract DCS du ' || to_char(i.imported_at at time zone 'Europe/Brussels', 'DD/MM/YYYY') || ' (ligne ' || coalesce(i.row_no::text, '?') || ')'
      from public.dcs_maintenance_imports i
     where i.company_id = v.company_id and i.vin = public.vin_normalize(v.vin)
  )
  select source, last_date, last_km, ref into _c_source, _c_date, _c_km, _c_ref
    from cands where last_date is not null order by last_date desc, rank limit 1;

  if _c_source is not null then
    if _c_source = 'dcs_extract' then
      -- La ligne DCS la plus récente pour cette moto : type et date planifiée.
      select i.planned_date, i.maintenance_type into _dcs
        from public.dcs_maintenance_imports i
       where i.company_id = v.company_id and i.vin = public.vin_normalize(v.vin)
       order by i.planned_date desc, i.imported_at desc limit 1;
      _kind := public._maintenance_dcs_kind(_dcs.maintenance_type);
      _due := _dcs.planned_date;
      _due_km := case when _kind = 'first_1000' then 1000 end;
    else
      _kind := 'annual';
      _due := (_c_date + interval '12 months')::date;
      _due_km := case when _c_km is not null and _km_int is not null then _c_km + _km_int end;
    end if;
  else
    -- 5. Plan seul : date de départ (garantie, puis mise en circulation) → 6 mois, puis tous les 12 mois,
    --    en gardant une fenêtre de retard de 180 jours (celle de l'extract DCS).
    _start := v.warranty_start; _start_ref := 'garantie du ';
    if _start is null then
      select i.warranty_start into _start from public.dcs_maintenance_imports i
       where i.company_id = v.company_id and i.vin = public.vin_normalize(v.vin) and i.warranty_start is not null
       order by i.imported_at desc limit 1;
    end if;
    if _start is null then _start := v.first_registration_date; _start_ref := 'mise en circulation du '; end if;
    if _start is null then
      update public.vehicle_maintenance_due set is_current = false where vehicle_id = v.id and is_current;
      return jsonb_build_object('vehicle_id', v.id, 'kind', null, 'source', null, 'changed', false);
    end if;
    _c_ref := _start_ref || to_char(_start, 'DD/MM/YYYY');
    _due := (_start + interval '6 months')::date;
    _kind := 'first_1000'; _due_km := 1000;
    _n := 0;
    while _today - _due > 180 and _n < 80 loop
      _n := _n + 1;
      _due := (_start + interval '6 months' + (_n * interval '12 months'))::date;
      _kind := 'annual'; _due_km := null;
    end loop;
  end if;

  -- Ligne courante : inchangée → on date seulement le calcul ; sinon nouvelle ligne, l'ancienne garde l'historique.
  select * into _cur from public.vehicle_maintenance_due
   where vehicle_id = v.id and is_current and kind = _kind;
  if found and _cur.due_date is not distinct from _due and _cur.due_km is not distinct from _due_km
     and _cur.source = coalesce(_c_source, 'plan') and _cur.source_ref is not distinct from _c_ref then
    update public.vehicle_maintenance_due
       set computed_at = now(), last_service_at = _c_date, last_service_km = _c_km
     where id = _cur.id;
  else
    update public.vehicle_maintenance_due set is_current = false where vehicle_id = v.id and is_current;
    insert into public.vehicle_maintenance_due
      (company_id, vehicle_id, kind, due_date, due_km, source, source_ref, last_service_at, last_service_km)
    values (v.company_id, v.id, _kind, _due, _due_km, coalesce(_c_source, 'plan'), _c_ref, _c_date, _c_km);
    _changed := true;
  end if;
  -- Les lignes courantes d'un autre type sont closes (une seule échéance principale par moto).
  update public.vehicle_maintenance_due set is_current = false
   where vehicle_id = v.id and is_current and kind <> _kind;

  return jsonb_build_object('vehicle_id', v.id, 'kind', _kind, 'due_date', _due, 'due_km', _due_km,
                            'source', coalesce(_c_source, 'plan'), 'changed', _changed);
end $fn$;
revoke all on function public._vehicle_maintenance_recompute_core(uuid) from public, anon, authenticated;

-- Appel depuis l'application (bouton « Recalculer ») ou la clé de service.
create or replace function public.vehicle_maintenance_recompute(_company uuid, _vehicle uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if not exists (select 1 from public.vehicles where id = _vehicle and company_id = _company) then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return public._vehicle_maintenance_recompute_core(_vehicle);
end $fn$;
revoke all on function public.vehicle_maintenance_recompute(uuid, uuid) from public, anon;
grant execute on function public.vehicle_maintenance_recompute(uuid, uuid) to authenticated, service_role;

-- Reprise par lots (3 364 motos) : les motos après _after, _limit à la fois. Renvoie le dernier id traité.
create or replace function public.vehicle_maintenance_recompute_batch(_company uuid, _after uuid default null, _limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _v record; _last uuid; _done int := 0; _with int := 0; _r jsonb; _by jsonb := '{}'::jsonb; _src text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_admin(_company) or public.has_role(_company, 'chef_atelier')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  for _v in
    select id from public.vehicles
     where company_id = _company and (_after is null or id > _after)
     order by id limit greatest(1, least(coalesce(_limit, 200), 1000))
  loop
    _r := public._vehicle_maintenance_recompute_core(_v.id);
    _done := _done + 1; _last := _v.id;
    _src := _r ->> 'source';
    if _src is not null then
      _with := _with + 1;
      _by := _by || jsonb_build_object(_src, coalesce((_by ->> _src)::int, 0) + 1);
    end if;
  end loop;
  return jsonb_build_object('done', _done, 'last_id', _last, 'with_due', _with, 'by_source', _by);
end $fn$;
revoke all on function public.vehicle_maintenance_recompute_batch(uuid, uuid, integer) from public, anon;
grant execute on function public.vehicle_maintenance_recompute_batch(uuid, uuid, integer) to authenticated, service_role;

-- Échéance courante d'une moto en JSON (fiche, espace client).
create or replace function public._vehicle_maintenance_due_json(_vehicle uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'kind', d.kind, 'due_date', d.due_date, 'due_km', d.due_km, 'source', d.source,
           'source_ref', d.source_ref, 'last_service_at', d.last_service_at, 'last_service_km', d.last_service_km,
           'computed_at', d.computed_at,
           'days_left', case when d.due_date is not null then d.due_date - current_date end)
    from public.vehicle_maintenance_due d
   where d.vehicle_id = _vehicle and d.is_current
   order by d.due_date nulls last limit 1;
$$;
revoke all on function public._vehicle_maintenance_due_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Motos à relancer / à accueillir : échéance dans N jours ou dépassée, avec le propriétaire courant.
--    SIGNATURE ET COLONNES FIGÉES (lues par la page Relances, M10) :
--    vehicle_id, vin, model_label, contact_id, contact_name, email, phone, locale, kind, due_date, due_km, days_left, source
-- ---------------------------------------------------------------------
create or replace function public.vehicles_maintenance_upcoming(_company uuid, _days integer default 30)
returns table (
  vehicle_id uuid, vin text, model_label text, contact_id uuid, contact_name text, email text, phone text,
  locale text, kind text, due_date date, due_km integer, days_left integer, source text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select distinct on (v.id)
         v.id,
         v.vin,
         nullif(concat_ws(' ', v.brand, v.model, v.model_year::text), '') as model_label,
         c.id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as contact_name,
         coalesce(nullif(btrim(c.email), ''), nullif(btrim(c.email_pro), '')) as email,
         coalesce(nullif(btrim(c.mobile), ''), nullif(btrim(c.gsm), ''), nullif(btrim(c.phone), ''),
                  nullif(btrim(c.mobile_pro), ''), nullif(btrim(c.phone_pro), '')) as phone,
         -- La colonne contacts.locale vient d'une migration qui peut ne pas être appliquée : lecture tolérante.
         coalesce(to_jsonb(c) ->> 'locale', 'fr') as locale,
         d.kind,
         d.due_date,
         d.due_km,
         case when d.due_date is not null then (d.due_date - current_date)::integer
              else 0 end as days_left,
         d.source
    from public.vehicle_maintenance_due d
    join public.vehicles v on v.id = d.vehicle_id
    left join public.vehicle_owners vo on vo.vehicle_id = v.id and vo.is_current
    left join public.contacts c on c.id = vo.contact_id
   where d.company_id = _company and d.is_current
     and v.is_active
     and (
          (d.due_date is not null and d.due_date <= current_date + greatest(0, coalesce(_days, 30)))
          -- Échéance kilométrique atteinte d'après le km connu (déclaré ou constaté) : M-16, premier atteint.
          or (d.due_km is not null and greatest(coalesce(v.declared_km, 0), coalesce(v.mileage, 0)) >= d.due_km)
         )
   order by v.id, d.due_date nulls last, vo.from_date desc;
end $fn$;
revoke all on function public.vehicles_maintenance_upcoming(uuid, integer) from public, anon;
grant execute on function public.vehicles_maintenance_upcoming(uuid, integer) to authenticated, service_role;
comment on function public.vehicles_maintenance_upcoming(uuid, integer) is
  'Mission 07 carte 4 : motos dont le prochain entretien tombe dans _days jours ou est dépassé (days_left négatif), avec le propriétaire courant. Signature figée (M10 Relances).';

-- ---------------------------------------------------------------------
-- 7. Import de l'extract DCS (écran « Importer l'extract DCS » et script tools/migration/import_dcs_entretiens.py)
--    _rows : [{row, vin, warranty_start, planned_date, maintenance_type, days_before, dealer}]
--    _apply = false : rapport seulement, rien n'est écrit.
-- ---------------------------------------------------------------------
create or replace function public.dcs_maintenance_import(_company uuid, _file text, _rows jsonb, _apply boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _r jsonb; _vin text; _planned date; _type text; _wstart date; _vid uuid;
  _n int := 0; _known int := 0; _inserted int := 0; _dup int := 0; _bad int := 0;
  _unknown jsonb := '[]'::jsonb; _vehicles uuid[] := '{}'; _emails int := 0; _recomputed int := 0;
  _res jsonb; _rec jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_admin(_company) or public.has_role(_company, 'chef_atelier')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if _rows is null or jsonb_typeof(_rows) <> 'array' then
    raise exception 'DCS_ROWS_INVALID' using errcode = '22023';
  end if;

  for _r in select * from jsonb_array_elements(_rows) loop
    _n := _n + 1;
    _vin := public.vin_normalize(_r ->> 'vin');
    _planned := nullif(_r ->> 'planned_date', '')::date;
    _type := coalesce(nullif(btrim(_r ->> 'maintenance_type'), ''), 'Annual Service');
    _wstart := nullif(_r ->> 'warranty_start', '')::date;
    if _vin is null or length(_vin) <> 17 or _planned is null then _bad := _bad + 1; continue; end if;

    select v.id into _vid from public.vehicles v
     where v.company_id = _company and public.vin_normalize(v.vin) = _vin
     order by v.is_active desc, v.updated_at desc limit 1;
    if _vid is null then
      if not (_unknown ? _vin) then _unknown := _unknown || to_jsonb(_vin); end if;
    else
      _known := _known + 1;
      if not (_vid = any(_vehicles)) then _vehicles := _vehicles || _vid; end if;
    end if;

    if exists (select 1 from public.dcs_maintenance_imports i
                where i.company_id = _company and i.vin = _vin and i.planned_date = _planned
                  and lower(i.maintenance_type) = lower(_type)) then
      _dup := _dup + 1;
      continue;
    end if;
    _inserted := _inserted + 1;
    if _apply then
      insert into public.dcs_maintenance_imports
        (company_id, file_name, row_no, vin, vehicle_id, warranty_start, planned_date, maintenance_type, days_before, dealer, imported_by)
      values (_company, coalesce(_file, 'extract DCS'), nullif(_r ->> 'row', '')::int, _vin, _vid, _wstart, _planned, _type,
              nullif(_r ->> 'days_before', '')::int, nullif(btrim(_r ->> 'dealer'), ''), auth.uid())
      on conflict (company_id, vin, planned_date, maintenance_type) do nothing;
      -- Début de garantie : seul un champ vide est rempli (jamais écrasé).
      if _vid is not null and _wstart is not null then
        update public.vehicles set warranty_start = _wstart where id = _vid and warranty_start is null;
      end if;
    end if;
  end loop;

  -- Propriétaires courants joignables par e-mail parmi les motos connues.
  select count(distinct c.id) into _emails
    from public.vehicle_owners vo join public.contacts c on c.id = vo.contact_id
   where vo.is_current and vo.vehicle_id = any(_vehicles) and coalesce(nullif(c.email, ''), nullif(c.email_pro, '')) is not null;

  if _apply then
    for _vid in select unnest(_vehicles) loop
      _rec := public._vehicle_maintenance_recompute_core(_vid);
      _recomputed := _recomputed + 1;
    end loop;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'dcs_maintenance_imported', 'dcs_maintenance_imports', coalesce(_file, 'extract DCS'), 'import', null,
            jsonb_build_object('rows', _n, 'known', _known, 'unknown', jsonb_array_length(_unknown), 'inserted', _inserted,
                               'duplicates', _dup, 'invalid', _bad, 'recomputed', _recomputed));
  end if;

  _res := jsonb_build_object(
    'rows', _n, 'known', _known, 'unknown_vins', _unknown, 'unknown', jsonb_array_length(_unknown),
    'inserted', _inserted, 'duplicates', _dup, 'invalid', _bad, 'vehicles', coalesce(array_length(_vehicles, 1), 0),
    'owners_with_email', _emails, 'recomputed', _recomputed, 'applied', _apply);
  return _res;
end $fn$;
revoke all on function public.dcs_maintenance_import(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.dcs_maintenance_import(uuid, text, jsonb, boolean) to authenticated, service_role;

-- Fichiers déjà importés (pour l'écran) : un résumé par fichier.
create or replace function public.dcs_maintenance_import_files(_company uuid)
returns table (file_name text, imported_at timestamptz, rows_count bigint, known_count bigint, next_min date, next_max date)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.file_name, max(i.imported_at), count(*), count(i.vehicle_id), min(i.planned_date), max(i.planned_date)
    from public.dcs_maintenance_imports i
   where i.company_id = _company and public.is_member(_company)
   group by i.file_name
   order by max(i.imported_at) desc;
$$;
revoke all on function public.dcs_maintenance_import_files(uuid) from public, anon;
grant execute on function public.dcs_maintenance_import_files(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Déclencheurs : la ligne courante suit la moto, l'OR facturé et la moto déclarée
-- ---------------------------------------------------------------------
create or replace function public._trg_vehicle_maintenance_recompute()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform public._vehicle_maintenance_recompute_core(new.id);
  return new;
end $fn$;
drop trigger if exists trg_vehicles_maintenance_due on public.vehicles;
create trigger trg_vehicles_maintenance_due
  after insert or update of last_service_at, last_service_km, last_service_where, declared_km, warranty_start,
                            first_registration_date, mileage, ducati_model_year_id, maintenance_usage, vin
  on public.vehicles
  for each row execute function public._trg_vehicle_maintenance_recompute();

create or replace function public._trg_repair_order_maintenance_recompute()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.vehicle_id is not null and new.status = 'facture' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public._vehicle_maintenance_recompute_core(new.vehicle_id);
  end if;
  return new;
end $fn$;
drop trigger if exists trg_repair_orders_maintenance_due on public.repair_orders;
create trigger trg_repair_orders_maintenance_due
  after insert or update of status on public.repair_orders
  for each row execute function public._trg_repair_order_maintenance_recompute();

-- Moto déclarée rattachée ou créée (écran, ou validée d'office M-63) : km et dernier entretien déclarés
-- recopiés sur la moto, seulement dans les champs vides. La mise à jour de la moto déclenche le recalcul.
create or replace function public._trg_declared_vehicle_service_copy()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _s jsonb;
begin
  if new.vehicle_id is null or (tg_op = 'UPDATE' and old.vehicle_id is not distinct from new.vehicle_id) then
    return new;
  end if;
  _s := case when jsonb_typeof(new.last_services) = 'array' and jsonb_array_length(new.last_services) > 0
             then new.last_services -> 0 else '{}'::jsonb end;
  update public.vehicles v
     set declared_km    = coalesce(v.declared_km, new.mileage_km),
         declared_km_at = case when v.declared_km is null and new.mileage_km is not null then now() else v.declared_km_at end,
         last_service_at    = coalesce(v.last_service_at, nullif(_s ->> 'date', '')::date),
         last_service_km    = coalesce(v.last_service_km, nullif(_s ->> 'km', '')::int),
         last_service_where = coalesce(v.last_service_where,
                                       case when (_s ->> 'where') in ('ici', 'ailleurs') then _s ->> 'where' end)
   where v.id = new.vehicle_id
     and (new.mileage_km is not null or _s <> '{}'::jsonb);
  return new;
end $fn$;
drop trigger if exists trg_declared_vehicle_service_copy on public.contact_declared_vehicles;
create trigger trg_declared_vehicle_service_copy
  after insert or update of vehicle_id on public.contact_declared_vehicles
  for each row execute function public._trg_declared_vehicle_service_copy();

-- ---------------------------------------------------------------------
-- 9. Espace client : « Mes motos » demande le km actuel et le dernier entretien
-- ---------------------------------------------------------------------
create or replace function public.portal_vehicle_service_declare(
  p_vehicle_id uuid, p_km integer default null, p_last_service_at date default null,
  p_last_service_km integer default null, p_where text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _ctx record; _old jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  if p_vehicle_id is null or not public._portal_owns_vehicle(_ctx.contact_id, _ctx.company_id, p_vehicle_id) then
    raise exception 'portal: vehicle not found' using errcode = 'P0002';
  end if;
  if p_km is not null and (p_km < 0 or p_km > 999999) then raise exception 'portal: invalid km' using errcode = '22023'; end if;
  if p_last_service_km is not null and (p_last_service_km < 0 or p_last_service_km > 999999) then raise exception 'portal: invalid km' using errcode = '22023'; end if;
  if p_last_service_at is not null and p_last_service_at > current_date then raise exception 'portal: date in the future' using errcode = '22023'; end if;
  if p_where is not null and p_where not in ('ici', 'ailleurs') then raise exception 'portal: invalid where' using errcode = '22023'; end if;
  if p_km is null and p_last_service_at is null and p_last_service_km is null and p_where is null then
    return public._vehicle_maintenance_due_json(p_vehicle_id);
  end if;

  select jsonb_build_object('declared_km', v.declared_km, 'last_service_at', v.last_service_at,
                            'last_service_km', v.last_service_km, 'last_service_where', v.last_service_where)
    into _old from public.vehicles v where v.id = p_vehicle_id;

  update public.vehicles v
     set declared_km        = coalesce(p_km, v.declared_km),
         declared_km_at     = case when p_km is not null then now() else v.declared_km_at end,
         last_service_at    = coalesce(p_last_service_at, v.last_service_at),
         last_service_km    = coalesce(p_last_service_km, v.last_service_km),
         last_service_where = coalesce(p_where, v.last_service_where)
   where v.id = p_vehicle_id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_ctx.company_id, auth.uid(), 'portal_vehicle_service_declared', 'vehicles', p_vehicle_id::text, 'portal', _old,
          jsonb_build_object('contact_id', _ctx.contact_id, 'declared_km', p_km, 'last_service_at', p_last_service_at,
                             'last_service_km', p_last_service_km, 'last_service_where', p_where));
  return public._vehicle_maintenance_due_json(p_vehicle_id);
end $fn$;
revoke all on function public.portal_vehicle_service_declare(uuid, integer, date, integer, text) from public, anon;
grant execute on function public.portal_vehicle_service_declare(uuid, integer, date, integer, text) to authenticated;

-- « Ajouter ma moto » : km et dernier entretien déclarés avec la moto (recopiés à la validation).
create or replace function public.portal_declaration_service_set(p_declaration_id uuid, p_mileage_km integer default null, p_last_services jsonb default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _ctx record;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  if p_mileage_km is not null and (p_mileage_km < 0 or p_mileage_km > 999999) then raise exception 'portal: invalid km' using errcode = '22023'; end if;
  if p_last_services is not null and jsonb_typeof(p_last_services) <> 'array' then raise exception 'portal: invalid services' using errcode = '22023'; end if;
  update public.contact_declared_vehicles d
     set mileage_km = coalesce(p_mileage_km, d.mileage_km),
         last_services = coalesce(p_last_services, d.last_services)
   where d.id = p_declaration_id and d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id;
  if not found then raise exception 'portal: declaration not found' using errcode = 'P0002'; end if;
end $fn$;
revoke all on function public.portal_declaration_service_set(uuid, integer, jsonb) from public, anon;
grant execute on function public.portal_declaration_service_set(uuid, integer, jsonb) to authenticated;

-- portal_vehicle : même liste blanche qu'au 05/10 (migration 20261005130000) + le prochain entretien et
-- ce que le client a déclaré. Copie conforme, seuls les champs maintenance_due / declared_* / last_service_* sont ajoutés.
create or replace function public.portal_vehicle(p_vehicle_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
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
    -- Mission 07 cartes 4 et 5 : prochain entretien et déclaration du client.
    'declared_km', v.declared_km, 'declared_km_at', v.declared_km_at,
    'last_service_at', v.last_service_at, 'last_service_km', v.last_service_km, 'last_service_where', v.last_service_where,
    'maintenance_due', public._vehicle_maintenance_due_json(v.id),
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
    -- Documents et photos : uniquement ceux déposés par le client, non supprimés.
    'files', public._portal_files(_ctx.contact_id, 'vehicle', v.id),
    'no_back', public._portal_no_back(_ctx.contact_id, 'vehicle', v.id),
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
end $fn$;
revoke all on function public.portal_vehicle(uuid) from public, anon;
grant execute on function public.portal_vehicle(uuid) to authenticated;
