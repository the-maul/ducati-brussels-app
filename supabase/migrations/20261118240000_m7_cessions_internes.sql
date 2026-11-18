-- =====================================================================
-- M7 — Cessions internes / O.R.O en DOCUMENT (rattrapage G8, 18/11/2026, lot-g8-cessions).
-- G8 (Atelier › Cessions internes/O.R.O) : un document multi-lignes, rattache a une moto
-- (n° de serie), type de cession parametrable (comptabilisee ou non, compte, journal), lignes
-- pieces valorisees au PAMP (ou au dernier prix d'achat) TVA 0, main-d'oeuvre en heures
-- internes (mecanicien, heures internes / passees) ; a la validation : sortie de stock des
-- pieces, fenetre « prix de revient » et mise a jour du cout de revient de la moto (B3).
-- Ouverture automatique d'une cession VO a la validation d'une reprise, archivage
-- automatique a la vente de la moto (reglages). Listes : par rayon, detaillees, archives.
--
-- DECISION SIMON (18/11/2026) : cout des pieces AU PAMP PAR DEFAUT, possibilite de choisir le
-- DERNIER PRIX D'ACHAT (reglage societe `cession_settings.cost_basis`, et par document).
--
-- Invariants : company_id + RLS partout ; stock uniquement via record_stock_move (B7) ;
-- cout de revient de la moto recalcule par une seule fonction, historique append-only
-- (`vehicle_cost_changes`) + `events` ; document fige apres validation.
-- Idempotente. NON APPLIQUEE (Simon la passe en bloc). Essai a blanc :
-- supabase/tests/m7_cessions_internes.sql.
-- Les anciennes lignes d'ORO de la reprise (`oro_lines`) restent lues et comptees.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Reglages (Parametres → Tables → « Cessions internes — reglages ») et types de cession
--    code = reglage, libelle = valeur (meme principe que `vat_margin_settings`).
-- ---------------------------------------------------------------------
do $$
declare _co record;
begin
  for _co in select id from public.companies loop
    insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra) values
      (_co.id, 'cession_settings', 'cost_basis',            'pamp', 1, true, '{"help":"Valorisation des pieces : pamp (prix d achat moyen pondere, defaut) ou pa (dernier prix d achat). Modifiable sur chaque cession."}'),
      (_co.id, 'cession_settings', 'auto_archive_on_sale',  'oui',  2, true, '{"help":"oui = les cessions d une moto sont archivees automatiquement a sa vente"}'),
      (_co.id, 'cession_settings', 'auto_open_on_reprise',  'oui',  3, true, '{"help":"oui = une cession est ouverte automatiquement a la validation d une reprise"}'),
      (_co.id, 'cession_settings', 'reprise_cession_type',  '01',   4, true, '{"help":"Code du type de cession ouvert automatiquement a la reprise (01 = Cession VO)"}'),
      (_co.id, 'cession_settings', 'internal_hourly_rate',  '0',    5, true, '{"help":"Cout horaire interne de la main-d oeuvre (EUR HT) quand la ligne n a pas d article de main-d oeuvre"}')
    on conflict (company_id, table_key, code) do nothing;
  end loop;
end $$;

-- Compte et journal par type de cession (G8 « Types de cessions » : code, libelle, compte, journal,
-- valorisation). Vides : a remplir par le comptable. Les valeurs deja saisies ne sont pas touchees.
update public.reference_values
   set extra = extra || jsonb_build_object('account', '', 'journal', '')
 where table_key = 'cession_type' and not (extra ? 'account');

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.internal_cessions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete restrict,
  number                text,
  cession_type          text not null,                 -- code reference_values.cession_type
  type_label            text,                          -- instantane du libelle
  accounted             boolean not null default true, -- comptabilisee : s'impute au cout de revient
  account               text,                          -- compte de cession (instantane)
  journal               text,                          -- journal (instantane)
  vehicle_id            uuid references public.vehicles(id) on delete set null,
  oro_id                uuid references public.oro(id) on delete set null,      -- dossier de reprise d'origine
  contact_id            uuid references public.contacts(id) on delete set null, -- client / ancien proprietaire
  operator_id           uuid references auth.users(id) on delete set null,
  operator_name         text,
  work_description      text,
  internal_note         text,
  cost_basis            text not null check (cost_basis in ('pamp', 'pa')),
  status                text not null default 'ouvert' check (status in ('ouvert', 'valide', 'archive', 'annule')),
  status_before_archive text check (status_before_archive in ('ouvert', 'valide')),
  origin                text not null default 'screen', -- screen | reprise
  total_cost            numeric(14,2) not null default 0,
  total_pamp            numeric(14,2) not null default 0,
  total_pa              numeric(14,2) not null default 0,
  total_sale_ht         numeric(14,2) not null default 0,
  options_amount        numeric(14,2) not null default 0,
  cost_before           numeric(14,2),
  cost_after            numeric(14,2),
  validated_at          timestamptz,
  validated_by          uuid references auth.users(id) on delete set null,
  archived_at           timestamptz,
  archived_by           uuid references auth.users(id) on delete set null,
  archive_reason        text,                          -- vente | manuel
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null,
  updated_at            timestamptz not null default now()
);
create index if not exists idx_icession_company on public.internal_cessions(company_id, status, created_at desc);
create index if not exists idx_icession_vehicle on public.internal_cessions(vehicle_id);
create unique index if not exists uq_icession_number on public.internal_cessions(company_id, number) where number is not null;

create table if not exists public.internal_cession_lines (
  id             uuid primary key default gen_random_uuid(),
  cession_id     uuid not null references public.internal_cessions(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete restrict,
  sort_order     int not null default 0,
  kind           text not null default 'piece' check (kind in ('piece', 'mo', 'frais', 'texte')),
  article_id     uuid references public.articles(id) on delete set null,
  reference      text,
  designation    text not null,
  quantity       numeric(14,3) not null default 1,  -- MO : heures internes (valorisees)
  hours_spent    numeric(10,2),                     -- MO : heures passees (productivite, B11)
  mechanic_id    uuid references auth.users(id) on delete set null,
  mechanic_name  text,
  work_date      date,
  unit_pamp      numeric(14,3),
  unit_pa        numeric(14,3),
  unit_sale_ht   numeric(14,3),
  unit_cost      numeric(14,3) not null default 0,  -- = PAMP ou PA selon la valorisation du document
  cost_locked    boolean not null default false,    -- cout saisi (MO sans article, frais) : jamais revalorise
  line_cost      numeric(14,2) not null default 0,
  line_sale_ht   numeric(14,2) not null default 0,
  vat_rate       numeric(5,2) not null default 0,   -- TVA 0 : une cession ne se facture pas
  stock_move_id  bigint,
  created_at     timestamptz not null default now()
);
create index if not exists idx_icession_lines on public.internal_cession_lines(cession_id, sort_order);
create index if not exists idx_icession_lines_article on public.internal_cession_lines(article_id);

-- Historique APPEND-ONLY du cout de revient d'une moto (B3, B7) : ancien, delta, nouveau, source.
create table if not exists public.vehicle_cost_changes (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete restrict,
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_id    uuid references auth.users(id) on delete set null,
  source      text not null,          -- cession | oro | vehicule
  source_id   uuid,
  source_ref  text,
  old_cost    numeric(14,2),
  delta       numeric(14,2),
  new_cost    numeric(14,2) not null,
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists idx_vcc_vehicle on public.vehicle_cost_changes(vehicle_id, occurred_at desc);

-- Pointeuse : un pointage de travail peut viser une cession (G8 : « scan code-barre OR / cession »).
alter table public.workshop_time_entries
  add column if not exists cession_id uuid references public.internal_cessions(id) on delete set null;
create index if not exists idx_wte_cession on public.workshop_time_entries(cession_id) where cession_id is not null;

-- ---------------------------------------------------------------------
-- 2. RLS + audit
-- ---------------------------------------------------------------------
alter table public.internal_cessions      enable row level security;
alter table public.internal_cession_lines enable row level security;
alter table public.vehicle_cost_changes   enable row level security;

drop policy if exists icession_select on public.internal_cessions;
create policy icession_select on public.internal_cessions for select to authenticated using (public.is_member(company_id));
drop policy if exists icession_insert on public.internal_cessions;
create policy icession_insert on public.internal_cessions for insert to authenticated with check (public.is_member(company_id));
drop policy if exists icession_update on public.internal_cessions;
create policy icession_update on public.internal_cessions for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
-- Pas de suppression : une cession ouverte s'annule (son numero reste trace).
revoke delete on public.internal_cessions from authenticated;

drop policy if exists icession_lines_all on public.internal_cession_lines;
create policy icession_lines_all on public.internal_cession_lines for all to authenticated
  using (exists (select 1 from public.internal_cessions c where c.id = cession_id and public.is_member(c.company_id)))
  with check (exists (select 1 from public.internal_cessions c where c.id = cession_id and public.is_member(c.company_id)));

drop policy if exists vcc_select on public.vehicle_cost_changes;
create policy vcc_select on public.vehicle_cost_changes for select to authenticated using (public.is_member(company_id));
revoke insert, update, delete on public.vehicle_cost_changes from authenticated;

drop trigger if exists trg_icession_audit on public.internal_cessions;
create trigger trg_icession_audit after insert or update or delete on public.internal_cessions
  for each row execute function public.audit_row();
drop trigger if exists trg_icession_lines_audit on public.internal_cession_lines;
create trigger trg_icession_lines_audit after insert or update or delete on public.internal_cession_lines
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- 3. Fonctions de base (internes : pas d'EXECUTE pour les roles applicatifs)
-- ---------------------------------------------------------------------
create or replace function public._cession_setting(_company uuid, _code text, _default text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select nullif(trim(r.label), '') from public.reference_values r
                    where r.company_id = _company and r.table_key = 'cession_settings'
                      and r.code = _code and r.is_active
                    limit 1), _default);
$$;

create or replace function public._cession_truthy(_v text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select lower(trim(coalesce(_v, ''))) in ('oui', 'o', 'true', 'vrai', '1', 'yes', 'y', 'ja', 'si', 'on');
$$;

-- Cout unitaire selon la valorisation : PAMP (repli PA si pas de PAMP) ou dernier PA (repli PAMP).
create or replace function public._cession_unit_cost(_basis text, _pamp numeric, _pa numeric)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select round(case when _basis = 'pa'
                    then coalesce(nullif(_pa, 0), nullif(_pamp, 0), 0)
                    else coalesce(nullif(_pamp, 0), nullif(_pa, 0), 0) end, 3);
$$;

-- Dernier prix d'achat = cout unitaire de la derniere entree valorisee (reception) ; repli : PA de la fiche.
create or replace function public.article_last_purchase_price(_article uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select m.unit_cost from public.stock_moves m
      where m.article_id = _article and not m.is_reservation and m.qty_delta > 0
        and m.move_type = 'entree' and m.unit_cost is not null and m.unit_cost > 0
      order by m.occurred_at desc, m.id desc limit 1),
    (select nullif(a.purchase_price, 0) from public.articles a where a.id = _article),
    0);
$$;

-- PAMP, dernier PA et PV HT d'un article (valeurs d'une ligne de cession).
create or replace function public._cession_article_values(_article uuid,
  out pamp numeric, out pa numeric, out sale_ht numeric, out reference text, out designation text, out mgmt text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  select coalesce(a.pamp, 0),
         public.article_last_purchase_price(a.id),
         round(coalesce(nullif(a.sale_price_ht, 0),
                        coalesce(a.sale_price_ttc, 0) / (1 + coalesce(a.vat_rate, 21) / 100.0)), 3),
         a.reference, a.designation, a.mgmt_type::text
    into pamp, pa, sale_ht, reference, designation, mgmt
    from public.articles a where a.id = _article;
end $$;

-- Cout de revient de la moto = prix d'achat / reprise + anciennes lignes d'ORO + cessions
-- comptabilisees validees (total + options). Seul chemin d'ecriture de vehicles.cost_price
-- pour une moto qui a un dossier de reprise ou une cession ; trace append-only + events.
create or replace function public._vehicle_cost_recompute(_vehicle uuid, _source text, _source_id uuid, _ref text)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare v record; _legacy numeric; _ces numeric; _new numeric;
begin
  select id, company_id, purchase_price, cost_price into v from public.vehicles where id = _vehicle;
  if v.id is null then return null; end if;
  select coalesce(sum(o.total_cost), 0) into _legacy from public.oro o where o.vehicle_id = _vehicle;
  select coalesce(sum(c.total_cost + c.options_amount), 0) into _ces
    from public.internal_cessions c
   where c.vehicle_id = _vehicle and c.accounted and c.validated_at is not null
     and c.status in ('valide', 'archive');
  _new := round(coalesce(v.purchase_price, 0) + _legacy + _ces, 2);
  if v.cost_price is distinct from _new then
    update public.vehicles set cost_price = _new, updated_at = now() where id = _vehicle;
    insert into public.vehicle_cost_changes (company_id, vehicle_id, actor_id, source, source_id, source_ref,
                                             old_cost, delta, new_cost, detail)
    values (v.company_id, _vehicle, auth.uid(), _source, _source_id, _ref, v.cost_price,
            _new - coalesce(v.cost_price, 0), _new,
            jsonb_build_object('purchase_price', v.purchase_price, 'oro', _legacy, 'cessions', _ces));
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (v.company_id, auth.uid(), 'cout_de_revient', 'vehicles', _vehicle::text, 'system',
            jsonb_build_object('cost_price', v.cost_price),
            jsonb_build_object('cost_price', _new, 'source', _source, 'ref', _ref));
  end if;
  return _new;
end $$;

revoke all on function public._cession_setting(uuid, text, text) from public, anon, authenticated;
revoke all on function public._cession_truthy(text) from public, anon;
revoke all on function public._cession_unit_cost(text, numeric, numeric) from public, anon;
revoke all on function public._cession_article_values(uuid) from public, anon, authenticated;
revoke all on function public._vehicle_cost_recompute(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.article_last_purchase_price(uuid) from public, anon;
grant execute on function public.article_last_purchase_price(uuid) to authenticated;

-- L'ancien calcul de l'ORO de reprise passe par le meme calcul (les cessions sont comptees).
create or replace function public.recompute_oro_and_vehicle(_oro uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _vehicle uuid; _number text;
begin
  select company_id, vehicle_id, number into _company, _vehicle, _number from public.oro where id = _oro;
  if _company is null or not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  update public.oro set total_cost = coalesce((select sum(line_cost) from public.oro_lines where oro_id = _oro), 0) where id = _oro;
  if _vehicle is not null then
    perform public._vehicle_cost_recompute(_vehicle, 'oro', _oro, _number);
  end if;
end $$;
grant execute on function public.recompute_oro_and_vehicle(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Garde-fous du document (triggers)
--    `dms.cession_fn` = '1' uniquement pendant les fonctions de cette migration.
-- ---------------------------------------------------------------------
create or replace function public._icession_before_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; _snap boolean; _fn boolean := coalesce(current_setting('dms.cession_fn', true), '') = '1';
begin
  if tg_op = 'INSERT' then _snap := true; else _snap := new.cession_type is distinct from old.cession_type; end if;
  if _snap then
    select rv.label, coalesce((rv.extra->>'accounted')::boolean, true) as acc,
           nullif(rv.extra->>'account', '') as acct, nullif(rv.extra->>'journal', '') as jr
      into r
      from public.reference_values rv
     where rv.company_id = new.company_id and rv.table_key = 'cession_type' and rv.code = new.cession_type
     limit 1;
    if r.label is null then raise exception 'Type de cession inconnu : %', new.cession_type; end if;
    new.type_label := r.label; new.accounted := r.acc; new.account := r.acct; new.journal := r.jr;
  end if;

  if tg_op = 'INSERT' then
    new.cost_basis := coalesce(new.cost_basis,
      case when lower(public._cession_setting(new.company_id, 'cost_basis', 'pamp')) = 'pa' then 'pa' else 'pamp' end);
    if new.number is null then new.number := public.next_document_number(new.company_id, 'ORO'); end if;
    new.status := 'ouvert'; new.status_before_archive := null;
    new.total_cost := 0; new.total_pamp := 0; new.total_pa := 0; new.total_sale_ht := 0;
    new.cost_before := null; new.cost_after := null;
    new.validated_at := null; new.validated_by := null; new.archived_at := null; new.archived_by := null;
    new.archive_reason := null; new.cancelled_at := null;
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  if not _fn then
    if old.status <> 'ouvert' then
      raise exception 'La cession % est figée (%) : passer par ses actions.', old.number, old.status using errcode = '42501';
    end if;
    if new.status is distinct from old.status or new.number is distinct from old.number
       or new.company_id is distinct from old.company_id or new.cost_basis is distinct from old.cost_basis
       or new.total_cost is distinct from old.total_cost or new.validated_at is distinct from old.validated_at
       or new.archived_at is distinct from old.archived_at or new.cost_after is distinct from old.cost_after then
      raise exception 'Statut, numéro, valorisation et totaux d''une cession passent par ses actions.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public._icession_before_write() from public, anon, authenticated;

drop trigger if exists trg_icession_before_write on public.internal_cessions;
create trigger trg_icession_before_write before insert or update on public.internal_cessions
  for each row execute function public._icession_before_write();

create or replace function public._icession_line_before_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _st text; _co uuid; _head uuid; _old_move bigint; _fn boolean := coalesce(current_setting('dms.cession_fn', true), '') = '1';
begin
  if tg_op = 'DELETE' then _head := old.cession_id; else _head := new.cession_id; end if;
  if tg_op = 'UPDATE' then _old_move := old.stock_move_id; end if;
  select c.status, c.company_id into _st, _co from public.internal_cessions c where c.id = _head;
  if not _fn and _st is distinct from 'ouvert' then
    raise exception 'Cession figée (%) : ses lignes ne se modifient plus.', coalesce(_st, '?') using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if not _fn and new.stock_move_id is distinct from _old_move then
    raise exception 'Le mouvement de stock d''une ligne est posé à la validation.' using errcode = '42501';
  end if;
  new.company_id   := _co;
  new.quantity     := coalesce(new.quantity, 0);
  new.unit_cost    := round(coalesce(new.unit_cost, 0), 3);
  new.line_cost    := round(new.quantity * new.unit_cost, 2);
  new.line_sale_ht := round(new.quantity * coalesce(new.unit_sale_ht, 0), 2);
  new.vat_rate     := 0;
  return new;
end $$;
revoke all on function public._icession_line_before_write() from public, anon, authenticated;

drop trigger if exists trg_icession_line_before_write on public.internal_cession_lines;
create trigger trg_icession_line_before_write before insert or update or delete on public.internal_cession_lines
  for each row execute function public._icession_line_before_write();

-- ---------------------------------------------------------------------
-- 5. Actions du document (RPC)
-- ---------------------------------------------------------------------
-- Ouvre une cession (n° ORO, type, moto, operateur, travaux). Client = dernier proprietaire connu de la moto.
create or replace function public.open_internal_cession(
  _company uuid, _type text, _vehicle uuid default null, _operator_id uuid default null,
  _operator_name text default null, _work text default null, _cost_basis text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _id uuid; _contact uuid; _oro uuid;
begin
  if not public.is_member(_company) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if _vehicle is not null then
    if not exists (select 1 from public.vehicles v where v.id = _vehicle and v.company_id = _company) then
      raise exception 'Moto introuvable dans cette société';
    end if;
    select o.contact_id into _contact from public.vehicle_owners o where o.vehicle_id = _vehicle
     order by o.is_current desc, o.created_at desc limit 1;
    select o.id into _oro from public.oro o where o.vehicle_id = _vehicle order by o.created_at desc limit 1;
  end if;
  insert into public.internal_cessions (company_id, cession_type, vehicle_id, oro_id, contact_id,
                                        operator_id, operator_name, work_description, cost_basis, origin)
  values (_company, _type, _vehicle, _oro, _contact, _operator_id, nullif(trim(_operator_name), ''),
          nullif(trim(_work), ''), case when _cost_basis in ('pamp', 'pa') then _cost_basis end, 'screen')
  returning id into _id;
  return _id;
end $$;

-- Ajoute une ligne. Piece / MO avec article : valorisee selon le document (PAMP ou PA), PV HT note.
-- MO sans article : cout horaire saisi (ou reglage `internal_hourly_rate`). Frais : cout saisi.
create or replace function public.add_internal_cession_line(
  _cession uuid, _kind text, _article uuid default null, _designation text default null,
  _quantity numeric default 1, _hours_spent numeric default null, _mechanic_id uuid default null,
  _mechanic_name text default null, _unit_cost numeric default null, _work_date date default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.internal_cessions; _id uuid; _sort int; _cost numeric; _locked boolean := false;
  _pamp numeric; _pa numeric; _sale numeric; _ref text; _des text; _mgmt text; _rate numeric;
begin
  select * into c from public.internal_cessions where id = _cession;
  if c.id is null then raise exception 'Cession introuvable'; end if;
  if not public.is_member(c.company_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if c.status <> 'ouvert' then raise exception 'Cession % figée (%)', c.number, c.status; end if;
  if _kind not in ('piece', 'mo', 'frais', 'texte') then raise exception 'Type de ligne inconnu : %', _kind; end if;
  if _kind = 'piece' and _article is null then raise exception 'Une ligne pièce vise un article.'; end if;
  if coalesce(_quantity, 0) < 0 or coalesce(_hours_spent, 0) < 0 or coalesce(_unit_cost, 0) < 0 then
    raise exception 'Quantité, heures et coût sont positifs.';
  end if;

  if _article is not null then
    if not exists (select 1 from public.articles x where x.id = _article and x.company_id = c.company_id) then
      raise exception 'Article introuvable dans cette société';
    end if;
    select v.pamp, v.pa, v.sale_ht, v.reference, v.designation, v.mgmt
      into _pamp, _pa, _sale, _ref, _des, _mgmt
      from public._cession_article_values(_article) v;
  end if;

  begin
    _rate := replace(public._cession_setting(c.company_id, 'internal_hourly_rate', '0'), ',', '.')::numeric;
  exception when others then _rate := 0;
  end;

  if _kind = 'texte' then
    _cost := 0; _locked := true;
  elsif _article is not null and _kind in ('piece', 'mo') then
    _cost := public._cession_unit_cost(c.cost_basis, _pamp, _pa);
    if _kind = 'mo' and (coalesce(_cost, 0) = 0 or _unit_cost is not null) then
      -- article de MO sans cout connu (ou cout horaire saisi) : cout horaire interne, fige
      _cost := coalesce(_unit_cost, _rate, 0);
      _locked := true;
    end if;
  elsif _kind = 'mo' then
    _cost := coalesce(_unit_cost, _rate, 0); _locked := true;
  else
    _cost := coalesce(_unit_cost, 0); _locked := true;
  end if;

  select coalesce(max(sort_order), 0) + 1 into _sort from public.internal_cession_lines where cession_id = _cession;
  insert into public.internal_cession_lines (cession_id, company_id, sort_order, kind, article_id, reference, designation,
    quantity, hours_spent, mechanic_id, mechanic_name, work_date, unit_pamp, unit_pa, unit_sale_ht, unit_cost, cost_locked)
  values (_cession, c.company_id, _sort, _kind, _article, _ref,
          coalesce(nullif(trim(_designation), ''), _des, '—'),
          case when _kind = 'texte' then 0 else coalesce(_quantity, 1) end,
          case when _kind = 'mo' then _hours_spent end, _mechanic_id, nullif(trim(_mechanic_name), ''),
          coalesce(_work_date, case when _kind = 'mo' then current_date end),
          _pamp, _pa, _sale, _cost, _locked)
  returning id into _id;
  return _id;
end $$;

-- Change la valorisation d'une cession ouverte (PAMP / dernier PA) et revalorise ses lignes d'article.
create or replace function public.set_internal_cession_cost_basis(_cession uuid, _basis text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.internal_cessions; l record; a record; _prev text := coalesce(current_setting('dms.cession_fn', true), '');
begin
  if _basis not in ('pamp', 'pa') then raise exception 'Valorisation inconnue : %', _basis; end if;
  select * into c from public.internal_cessions where id = _cession for update;
  if c.id is null then raise exception 'Cession introuvable'; end if;
  if not public.is_member(c.company_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if c.status <> 'ouvert' then raise exception 'Cession % figée (%)', c.number, c.status; end if;
  perform set_config('dms.cession_fn', '1', true);
  update public.internal_cessions set cost_basis = _basis where id = _cession;
  for l in select id, article_id from public.internal_cession_lines
            where cession_id = _cession and article_id is not null and not cost_locked loop
    select * into a from public._cession_article_values(l.article_id);
    update public.internal_cession_lines
       set unit_pamp = a.pamp, unit_pa = a.pa, unit_sale_ht = a.sale_ht,
           unit_cost = public._cession_unit_cost(_basis, a.pamp, a.pa)
     where id = l.id;
  end loop;
  perform set_config('dms.cession_fn', _prev, true);
end $$;

-- Validation : revalorise (valeurs du jour), sort les pieces stockees du stock (B7), fige les
-- totaux et met a jour le cout de revient de la moto (cessions comptabilisees). Renvoie la fenetre.
create or replace function public.validate_internal_cession(_cession uuid, _options numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.internal_cessions; l record; a record; _mid bigint;
  _old numeric; _new numeric; _n int; _prev text := coalesce(current_setting('dms.cession_fn', true), '');
begin
  select * into c from public.internal_cessions where id = _cession for update;
  if c.id is null then raise exception 'Cession introuvable'; end if;
  if not public.is_member(c.company_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if c.status <> 'ouvert' then raise exception 'Cession % déjà %', c.number, c.status; end if;
  if coalesce(_options, 0) < 0 then raise exception 'Le montant des options est positif.'; end if;
  select count(*) into _n from public.internal_cession_lines where cession_id = _cession and kind <> 'texte';
  if _n = 0 then raise exception 'Une cession sans ligne ne se valide pas.'; end if;

  perform set_config('dms.cession_fn', '1', true);

  for l in select id, article_id from public.internal_cession_lines
            where cession_id = _cession and article_id is not null and not cost_locked loop
    select * into a from public._cession_article_values(l.article_id);
    update public.internal_cession_lines
       set unit_pamp = a.pamp, unit_pa = a.pa, unit_sale_ht = a.sale_ht,
           unit_cost = public._cession_unit_cost(c.cost_basis, a.pamp, a.pa)
     where id = l.id;
  end loop;

  -- Sortie de stock des pieces stockees (type A) : mouvement « cession », jamais une vente.
  for l in select li.id, li.article_id, li.quantity
             from public.internal_cession_lines li join public.articles ar on ar.id = li.article_id
            where li.cession_id = _cession and li.kind = 'piece' and ar.mgmt_type::text = 'A'
              and li.quantity > 0 and li.stock_move_id is null loop
    _mid := public.record_stock_move(l.article_id, 'cession', -abs(l.quantity), null, false, null, 'cession',
              c.number, left('Cession interne ' || coalesce(c.number, '') || ' - ' || coalesce(c.type_label, ''), 200));
    update public.internal_cession_lines set stock_move_id = _mid where id = l.id;
  end loop;

  update public.internal_cessions x set
    total_cost    = s.cost, total_pamp = s.pamp, total_pa = s.pa, total_sale_ht = s.sale,
    options_amount = round(coalesce(_options, 0), 2),
    status = 'valide', validated_at = now(), validated_by = auth.uid()
  from (select coalesce(sum(line_cost), 0) as cost,
               coalesce(sum(round(quantity * coalesce(case when cost_locked then unit_cost end, unit_pamp, unit_cost), 2)), 0) as pamp,
               coalesce(sum(round(quantity * coalesce(case when cost_locked then unit_cost end, unit_pa, unit_cost), 2)), 0) as pa,
               coalesce(sum(line_sale_ht), 0) as sale
          from public.internal_cession_lines where cession_id = _cession) s
  where x.id = _cession;

  if c.vehicle_id is not null then
    select cost_price into _old from public.vehicles where id = c.vehicle_id;
    _new := public._vehicle_cost_recompute(c.vehicle_id, 'cession', _cession, c.number);
    update public.internal_cessions set cost_before = _old, cost_after = _new where id = _cession;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  select c.company_id, auth.uid(), 'cession_validee', 'internal_cessions', _cession::text, 'screen',
         jsonb_build_object('status', 'ouvert', 'cost_price', _old),
         jsonb_build_object('status', 'valide', 'number', x.number, 'total_cost', x.total_cost,
                            'options', x.options_amount, 'accounted', x.accounted, 'cost_basis', x.cost_basis,
                            'cost_price', _new)
    from public.internal_cessions x where x.id = _cession;

  perform set_config('dms.cession_fn', _prev, true);
  return (select jsonb_build_object('number', x.number, 'total_cost', x.total_cost, 'total_pamp', x.total_pamp,
                                    'total_pa', x.total_pa, 'total_sale_ht', x.total_sale_ht,
                                    'options', x.options_amount, 'accounted', x.accounted,
                                    'cost_before', x.cost_before, 'cost_after', x.cost_after)
            from public.internal_cessions x where x.id = _cession);
end $$;

-- Archivage manuel / desarchivage / annulation d'une cession ouverte.
create or replace function public._icession_set_status(_cession uuid, _action text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.internal_cessions; _to text; _prev text := coalesce(current_setting('dms.cession_fn', true), '');
begin
  select * into c from public.internal_cessions where id = _cession for update;
  if c.id is null then raise exception 'Cession introuvable'; end if;
  if not public.is_member(c.company_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  perform set_config('dms.cession_fn', '1', true);
  if _action = 'archive' then
    if c.status not in ('ouvert', 'valide') then raise exception 'Cession % : %, archivage impossible', c.number, c.status; end if;
    _to := 'archive';
    update public.internal_cessions set status_before_archive = c.status, status = 'archive',
           archived_at = now(), archived_by = auth.uid(), archive_reason = 'manuel' where id = _cession;
  elsif _action = 'unarchive' then
    if c.status <> 'archive' then raise exception 'Cession % non archivée', c.number; end if;
    _to := coalesce(c.status_before_archive, case when c.validated_at is null then 'ouvert' else 'valide' end);
    update public.internal_cessions set status = _to, status_before_archive = null,
           archived_at = null, archived_by = null, archive_reason = null where id = _cession;
  elsif _action = 'cancel' then
    if c.status <> 'ouvert' then raise exception 'Seule une cession ouverte s''annule (%).', c.status; end if;
    _to := 'annule';
    update public.internal_cessions set status = 'annule', cancelled_at = now() where id = _cession;
  else
    raise exception 'Action inconnue : %', _action;
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (c.company_id, auth.uid(), 'cession_' || _action, 'internal_cessions', _cession::text, 'screen',
          jsonb_build_object('status', c.status), jsonb_build_object('status', _to, 'number', c.number));
  perform set_config('dms.cession_fn', _prev, true);
end $$;
revoke all on function public._icession_set_status(uuid, text) from public, anon, authenticated;

create or replace function public.archive_internal_cession(_cession uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  select public._icession_set_status(_cession, 'archive');
$$;
create or replace function public.unarchive_internal_cession(_cession uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  select public._icession_set_status(_cession, 'unarchive');
$$;
create or replace function public.cancel_internal_cession(_cession uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  select public._icession_set_status(_cession, 'cancel');
$$;

-- Fenetre « prix de revient » (avant validation) : composantes du cout de la moto.
create or replace function public.internal_cession_cost_context(_cession uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.internal_cessions; v record; _legacy numeric := 0; _others numeric := 0; _vat numeric;
begin
  select * into c from public.internal_cessions where id = _cession;
  if c.id is null then raise exception 'Cession introuvable'; end if;
  if not public.is_member(c.company_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if c.vehicle_id is not null then
    select x.purchase_price, x.cost_price, x.display_price, x.article_id into v from public.vehicles x where x.id = c.vehicle_id;
    select coalesce(sum(o.total_cost), 0) into _legacy from public.oro o where o.vehicle_id = c.vehicle_id;
    select coalesce(sum(o.total_cost + o.options_amount), 0) into _others from public.internal_cessions o
     where o.vehicle_id = c.vehicle_id and o.id <> c.id and o.accounted and o.validated_at is not null
       and o.status in ('valide', 'archive');
    select ar.vat_rate into _vat from public.articles ar where ar.id = v.article_id;
  end if;
  return jsonb_build_object(
    'purchase_price', coalesce(v.purchase_price, 0), 'cost_price', v.cost_price, 'legacy_oro', _legacy,
    'other_cessions', _others, 'sale_price_ttc', v.display_price, 'vat_rate', _vat,
    'current_cost', (select coalesce(sum(line_cost), 0) from public.internal_cession_lines where cession_id = c.id),
    'current_sale_ht', (select coalesce(sum(line_sale_ht), 0) from public.internal_cession_lines where cession_id = c.id),
    'accounted', c.accounted);
end $$;

-- Lignes de cessions sur une periode (listes « par rayon » et « detaillees »).
create or replace function public.internal_cession_report(
  _company uuid, _from date, _to date, _type text default null, _include_open boolean default false)
returns table (
  cession_id uuid, number text, cession_type text, type_label text, accounted boolean, status text,
  cession_date date, vehicle_id uuid, vin text, plate text, vehicle_label text, contact_name text,
  line_id uuid, kind text, article_id uuid, reference text, designation text, category_path text,
  quantity numeric, hours_spent numeric, mechanic_name text,
  amount_pamp numeric, amount_pa numeric, amount_sale_ht numeric, amount_cost numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return query
  select c.id, c.number, c.cession_type, c.type_label, c.accounted, c.status,
         coalesce(c.validated_at, c.created_at)::date,
         v.id, v.vin, v.plate, nullif(trim(concat_ws(' ', v.brand, v.model)), ''),
         nullif(trim(coalesce(ct.company_name, concat_ws(' ', ct.first_name, ct.last_name))), ''),
         l.id, l.kind, l.article_id, l.reference, l.designation, ar.category_path,
         l.quantity, l.hours_spent, l.mechanic_name,
         round(l.quantity * coalesce(case when l.cost_locked then l.unit_cost end, l.unit_pamp, l.unit_cost), 2),
         round(l.quantity * coalesce(case when l.cost_locked then l.unit_cost end, l.unit_pa, l.unit_cost), 2),
         l.line_sale_ht, l.line_cost
    from public.internal_cessions c
    join public.internal_cession_lines l on l.cession_id = c.id and l.kind <> 'texte'
    left join public.vehicles v on v.id = c.vehicle_id
    left join public.contacts ct on ct.id = c.contact_id
    left join public.articles ar on ar.id = l.article_id
   where c.company_id = _company
     and coalesce(c.validated_at, c.created_at)::date between coalesce(_from, '1900-01-01'::date) and coalesce(_to, '2999-12-31'::date)
     and (_type is null or c.cession_type = _type)
     and (c.status in ('valide', 'archive') and c.validated_at is not null
          or (_include_open and c.status = 'ouvert'))
   order by coalesce(c.validated_at, c.created_at) desc, c.number, l.sort_order
   limit 20000;
end $$;

-- Temps pointes sur une cession, par mecanicien (heures passees de la MO, B11).
create or replace function public.cession_worked_minutes(_cession uuid)
returns table (mechanic_id uuid, mechanic_name text, minutes numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _co uuid;
begin
  select company_id into _co from public.internal_cessions where id = _cession;
  if _co is null or not public.is_member(_co) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return query
  select e.mechanic_id, max(e.mechanic_name), coalesce(sum(e.minutes), 0)
    from public.workshop_time_entries e
   where e.cession_id = _cession and e.kind = 'travail' and e.minutes is not null
   group by e.mechanic_id;
end $$;

revoke all on function public.open_internal_cession(uuid, text, uuid, uuid, text, text, text) from public, anon;
revoke all on function public.add_internal_cession_line(uuid, text, uuid, text, numeric, numeric, uuid, text, numeric, date) from public, anon;
revoke all on function public.set_internal_cession_cost_basis(uuid, text) from public, anon;
revoke all on function public.validate_internal_cession(uuid, numeric) from public, anon;
revoke all on function public.archive_internal_cession(uuid) from public, anon;
revoke all on function public.unarchive_internal_cession(uuid) from public, anon;
revoke all on function public.cancel_internal_cession(uuid) from public, anon;
revoke all on function public.internal_cession_cost_context(uuid) from public, anon;
revoke all on function public.internal_cession_report(uuid, date, date, text, boolean) from public, anon;
revoke all on function public.cession_worked_minutes(uuid) from public, anon;
grant execute on function public.open_internal_cession(uuid, text, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.add_internal_cession_line(uuid, text, uuid, text, numeric, numeric, uuid, text, numeric, date) to authenticated;
grant execute on function public.set_internal_cession_cost_basis(uuid, text) to authenticated;
grant execute on function public.validate_internal_cession(uuid, numeric) to authenticated;
grant execute on function public.archive_internal_cession(uuid) to authenticated;
grant execute on function public.unarchive_internal_cession(uuid) to authenticated;
grant execute on function public.cancel_internal_cession(uuid) to authenticated;
grant execute on function public.internal_cession_cost_context(uuid) to authenticated;
grant execute on function public.internal_cession_report(uuid, date, date, text, boolean) to authenticated;
grant execute on function public.cession_worked_minutes(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Automatismes sur la moto : cession VO a la reprise, archivage a la vente, cout de revient
-- ---------------------------------------------------------------------
create or replace function public._cession_on_vehicle_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _prev text := coalesce(current_setting('dms.cession_fn', true), ''); _contact uuid; _oro uuid;
begin
  -- 1) Reprise validee (« Demande de reprise » → stock occasion) : cession VO ouverte d'office (G8).
  if new.status::text = 'stock_vo' and old.status::text = 'repris'
     and public._cession_truthy(public._cession_setting(new.company_id, 'auto_open_on_reprise', 'oui'))
     and not exists (select 1 from public.internal_cessions c
                      where c.vehicle_id = new.id and c.origin = 'reprise' and c.status <> 'annule') then
    begin
      select o.id into _oro from public.oro o where o.vehicle_id = new.id order by o.created_at desc limit 1;
      select vo.contact_id into _contact from public.vehicle_owners vo where vo.vehicle_id = new.id
       order by vo.created_at desc limit 1;
      insert into public.internal_cessions (company_id, cession_type, vehicle_id, oro_id, contact_id, origin, work_description)
      values (new.company_id, public._cession_setting(new.company_id, 'reprise_cession_type', '01'), new.id, _oro, _contact,
              'reprise', 'Remise en état');
    exception when others then
      -- Jamais bloquer la validation de la reprise : l'echec est trace, la cession s'ouvre a la main.
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
      values (new.company_id, auth.uid(), 'cession_auto_echec', 'vehicles', new.id::text, 'system',
              jsonb_build_object('erreur', sqlerrm));
    end;
  end if;

  -- 2) Moto vendue : archivage automatique de ses cessions (reglage `auto_archive_on_sale`).
  if public.vehicle_parc_kind(new.status) = 'vendue' and public.vehicle_parc_kind(old.status) <> 'vendue'
     and public._cession_truthy(public._cession_setting(new.company_id, 'auto_archive_on_sale', 'oui')) then
    perform set_config('dms.cession_fn', '1', true);
    update public.internal_cessions
       set status_before_archive = status, status = 'archive', archived_at = now(), archived_by = auth.uid(),
           archive_reason = 'vente'
     where vehicle_id = new.id and status in ('ouvert', 'valide');
    perform set_config('dms.cession_fn', _prev, true);
  end if;

  -- 3) Prix d'achat change ou moto entree en stock occasion : cout de revient recalcule (la validation
  --    de la reprise ecrit cost_price = prix de reprise : les cessions deja validees sont rajoutees).
  if (new.purchase_price is distinct from old.purchase_price
      or (new.status::text = 'stock_vo' and old.status::text <> 'stock_vo'))
     and (exists (select 1 from public.oro o where o.vehicle_id = new.id)
          or exists (select 1 from public.internal_cessions c where c.vehicle_id = new.id and c.validated_at is not null)) then
    perform public._vehicle_cost_recompute(new.id, 'vehicule', null, null);
  end if;
  return null;
end $$;
revoke all on function public._cession_on_vehicle_change() from public, anon, authenticated;

drop trigger if exists trg_cession_vehicle_change on public.vehicles;
create trigger trg_cession_vehicle_change
  after update of status, purchase_price on public.vehicles
  for each row execute function public._cession_on_vehicle_change();

comment on table public.internal_cessions is
  'M7 (G8 Cessions internes / O.R.O, 18/11/2026) : document multi-lignes rattache a une moto, valorise au PAMP (defaut) ou au dernier PA ; validation = sortie de stock + cout de revient (vehicle_cost_changes).';
comment on table public.vehicle_cost_changes is
  'Historique append-only du cout de revient d''une moto (B3) : ecrit uniquement par _vehicle_cost_recompute.';
