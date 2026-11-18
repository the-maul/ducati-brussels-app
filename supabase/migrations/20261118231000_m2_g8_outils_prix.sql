-- =====================================================================
-- M2 — Rattrapage G8 (18/11/2026) : outils de prix et modification en cascade.
-- Source : docs/g8-inventaire/02-articles.md, sous-menus de Fichiers › Articles :
--   « Paramétrage des arrondis » (Fournisseur × Rayon × Sous-rayon × Catégorie → arrondi par
--   tranche de prix), « Paramétrage PV selon PPC », « Recalcul PA/PV » (5 tranches, taux ou
--   coefficient), « Modification cascade Art/Lib » (filtres dont « inutilisé depuis N mois »,
--   24 actions, supprimer ensemble, envoyer en librairie / librairie vers article).
--
-- Règle 3 / B7 : aucun prix n'est écrit sans trace. Toutes les écritures de prix de ce fichier
-- passent par un UPDATE de articles avec l'origine posée dans `app.price_change_origin` :
-- le trigger trace_price_change écrit la ligne append-only de price_changes.
-- Les autres changements de masse laissent une ligne `events` par article (ancien / nouveau).
--
-- Idempotente. NON APPLIQUÉE. Suppose 20261118230000 appliquée avant.
-- =====================================================================

-- ------------------------------------------------ 1. Arrondis par famille × tranche
-- Une règle = (fournisseur facultatif, famille facultative en préfixe « RR », « RR-SS » ou
-- « RR-SS-CC ») + tranche de PV TTC (jusqu'à up_to ; 0 = sans limite) + pas d'arrondi.
-- La règle la plus précise gagne (fournisseur + famille la plus longue), puis la tranche.
create table if not exists public.price_rounding_rules (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  supplier_id     uuid references public.contacts(id) on delete cascade,
  category_prefix text,
  up_to           numeric(14,2) not null default 0,
  step            numeric(14,2) not null,
  mode            text not null default 'up',
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint price_rounding_rules_step_chk check (step > 0),
  constraint price_rounding_rules_mode_chk check (mode in ('up', 'nearest')),
  constraint price_rounding_rules_upto_chk check (up_to >= 0),
  constraint price_rounding_rules_prefix_chk check (category_prefix is null or category_prefix ~ '^[0-9A-Za-z]{1,4}(-[0-9A-Za-z]{1,4}){0,2}$')
);
create index if not exists idx_price_rounding_rules_company on public.price_rounding_rules(company_id);

alter table public.price_rounding_rules enable row level security;
drop policy if exists price_rounding_rules_select on public.price_rounding_rules;
create policy price_rounding_rules_select on public.price_rounding_rules for select to authenticated
  using (public.is_member(company_id));
drop policy if exists price_rounding_rules_write on public.price_rounding_rules;
create policy price_rounding_rules_write on public.price_rounding_rules for all to authenticated
  using (public.can_write_table(company_id, 'articles')) with check (public.can_write_table(company_id, 'articles'));

drop trigger if exists trg_price_rounding_rules_updated on public.price_rounding_rules;
create trigger trg_price_rounding_rules_updated before update on public.price_rounding_rules
  for each row execute function public.set_updated_at();
drop trigger if exists trg_price_rounding_rules_audit on public.price_rounding_rules;
create trigger trg_price_rounding_rules_audit after insert or update or delete on public.price_rounding_rules
  for each row execute function public.audit_row();

-- ------------------------------------------------ 2. Sélection d'articles (cascade, outils de prix)
-- Filtres (jsonb, clés facultatives) :
--   supplier_id, brand, file ('article' | 'library' | 'all'), vat_rate, rayon, sous_rayon,
--   categorie, year, reference, designation, bin, supplier_ref, mgmt_type,
--   pv_ppc ('below' | 'equal' | 'above' | 'no_ppc'), stock ('pos' | 'neg' | 'zero' | 'nonzero'),
--   unused_months (int), stock_min ('set' | 'unset' | 'below'), stock_max ('set' | 'unset' | 'above'),
--   eco (true), pa_from / pa_to (tranche de PA), refs (liste de références exactes : microfiche,
--   fichier), include_inactive (true).
create or replace function public._g8_article_match(a public.articles, _f jsonb)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _real numeric; _last timestamptz; _cat text[];
begin
  if not coalesce((_f->>'include_inactive')::boolean, false) and not a.is_active then return false; end if;
  if _f ? 'supplier_id' and nullif(_f->>'supplier_id', '') is not null
     and a.main_supplier_id is distinct from (_f->>'supplier_id')::uuid then return false; end if;
  if nullif(_f->>'brand', '') is not null and coalesce(lower(a.brand), '') <> lower(_f->>'brand') then return false; end if;
  if _f->>'file' = 'article' and a.is_library then return false; end if;
  if _f->>'file' = 'library' and not a.is_library then return false; end if;
  if nullif(_f->>'vat_rate', '') is not null and a.vat_rate <> (_f->>'vat_rate')::numeric then return false; end if;
  if nullif(_f->>'mgmt_type', '') is not null and a.mgmt_type::text <> _f->>'mgmt_type' then return false; end if;
  _cat := string_to_array(coalesce(a.category_path, ''), '-');
  if nullif(_f->>'rayon', '') is not null and coalesce(_cat[1], '') <> _f->>'rayon' then return false; end if;
  if nullif(_f->>'sous_rayon', '') is not null and coalesce(_cat[2], '') <> _f->>'sous_rayon' then return false; end if;
  if nullif(_f->>'categorie', '') is not null and coalesce(_cat[3], '') <> _f->>'categorie' then return false; end if;
  if nullif(_f->>'year', '') is not null then
    if a.year_from is null and a.year_to is null then return false; end if;
    if (_f->>'year')::int < coalesce(least(a.year_from, a.year_to), 0)
       or (_f->>'year')::int > coalesce(greatest(a.year_from, a.year_to), 9999) then return false; end if;
  end if;
  if nullif(_f->>'reference', '') is not null and a.reference not ilike '%' || (_f->>'reference') || '%' then return false; end if;
  if nullif(_f->>'designation', '') is not null and a.designation not ilike '%' || (_f->>'designation') || '%' then return false; end if;
  if nullif(_f->>'bin', '') is not null
     and coalesce(a.bin_location, '') not ilike (_f->>'bin') || '%'
     and coalesce(a.bin_location2, '') not ilike (_f->>'bin') || '%' then return false; end if;
  if nullif(_f->>'supplier_ref', '') is not null and coalesce(a.supplier_ref, '') not ilike '%' || (_f->>'supplier_ref') || '%' then return false; end if;
  if _f ? 'refs' and jsonb_typeof(_f->'refs') = 'array' and jsonb_array_length(_f->'refs') > 0
     and not exists (select 1 from jsonb_array_elements_text(_f->'refs') r where upper(trim(r)) = upper(a.reference)) then return false; end if;
  if nullif(_f->>'pa_from', '') is not null and a.purchase_price < (_f->>'pa_from')::numeric then return false; end if;
  if nullif(_f->>'pa_to', '') is not null and a.purchase_price > (_f->>'pa_to')::numeric then return false; end if;
  case _f->>'pv_ppc'
    when 'no_ppc' then if coalesce(a.ppc_ttc, 0) > 0 then return false; end if;
    when 'below' then if not (coalesce(a.ppc_ttc, 0) > 0 and a.sale_price_ttc < a.ppc_ttc) then return false; end if;
    when 'equal' then if not (coalesce(a.ppc_ttc, 0) > 0 and a.sale_price_ttc = a.ppc_ttc) then return false; end if;
    when 'above' then if not (coalesce(a.ppc_ttc, 0) > 0 and a.sale_price_ttc > a.ppc_ttc) then return false; end if;
    else null;
  end case;
  if coalesce((_f->>'eco')::boolean, false) and coalesce(a.eco_tax_ttc, 0) <= 0 then return false; end if;
  if _f->>'stock_min' = 'set' and coalesce(a.stock_min, 0) <= 0 then return false; end if;
  if _f->>'stock_min' = 'unset' and coalesce(a.stock_min, 0) > 0 then return false; end if;
  if _f->>'stock_max' = 'set' and coalesce(a.stock_max, 0) <= 0 then return false; end if;
  if _f->>'stock_max' = 'unset' and coalesce(a.stock_max, 0) > 0 then return false; end if;
  if nullif(_f->>'stock', '') is not null or _f->>'stock_min' = 'below' or _f->>'stock_max' = 'above' then
    select coalesce(sum(m.qty_delta), 0) into _real from public.stock_moves m
     where m.article_id = a.id and not m.is_reservation;
    if _f->>'stock' = 'pos' and _real <= 0 then return false; end if;
    if _f->>'stock' = 'neg' and _real >= 0 then return false; end if;
    if _f->>'stock' = 'zero' and _real <> 0 then return false; end if;
    if _f->>'stock' = 'nonzero' and _real = 0 then return false; end if;
    if _f->>'stock_min' = 'below' and not (coalesce(a.stock_min, 0) > 0 and _real < a.stock_min) then return false; end if;
    if _f->>'stock_max' = 'above' and not (coalesce(a.stock_max, 0) > 0 and _real > a.stock_max) then return false; end if;
  end if;
  -- « Inutilisé depuis N mois » : ni mouvement de stock, ni ligne de document, ni création récente.
  if nullif(_f->>'unused_months', '') is not null and (_f->>'unused_months')::int > 0 then
    _last := greatest(
      a.created_at, a.last_sold_at, a.last_purchased_at,
      (select max(m.occurred_at) from public.stock_moves m where m.article_id = a.id),
      (select max(l.created_at) from public.document_lines l where l.article_id = a.id),
      (select max(l.created_at) from public.repair_order_lines l where l.article_id = a.id),
      (select max(l.created_at) from public.purchase_lines l where l.article_id = a.id));
    if _last >= now() - make_interval(months => (_f->>'unused_months')::int) then return false; end if;
  end if;
  return true;
end $$;
revoke all on function public._g8_article_match(public.articles, jsonb) from public, anon, authenticated;
grant execute on function public._g8_article_match(public.articles, jsonb) to service_role;

-- Une page de la sélection, avec le total exact (pagination côté base : PostgREST coupe à 1 000 lignes).
create or replace function public.article_select_page(_company uuid, _f jsonb default '{}'::jsonb, _limit int default 200, _offset int default 0)
returns table (
  id uuid, reference text, designation text, supplier_id uuid, supplier_name text, supplier_ref text,
  brand text, category_path text, mgmt_type text, is_library boolean, vat_rate numeric,
  purchase_price numeric, pamp numeric, coefficient numeric, sale_price_ht numeric, sale_price_ttc numeric,
  ppc_ht numeric, ppc_ttc numeric, eco_tax_ttc numeric,
  descriptif text, show_descriptif_on_documents boolean, bin_location text,
  color text, size text, pack_qty numeric, weight_volume_length numeric, measure_unit text,
  stock_min numeric, stock_max numeric, real_qty numeric,
  price_purchase_locked boolean, price_sale_locked boolean, designation_locked boolean,
  total bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then return; end if;
  return query
  with sel as (
    select a.* from public.articles a
     where a.company_id = _company and public._g8_article_match(a, coalesce(_f, '{}'::jsonb))
  ),
  tot as (select count(*)::bigint as n from sel),
  page as (
    select * from sel order by sel.reference
     limit least(greatest(coalesce(_limit, 200), 1), 1000) offset greatest(coalesce(_offset, 0), 0)
  )
  select p.id, p.reference, p.designation, p.main_supplier_id, public._g8_contact_name(p.main_supplier_id), p.supplier_ref,
         p.brand, p.category_path, p.mgmt_type::text, p.is_library, p.vat_rate,
         p.purchase_price, p.pamp, p.coefficient, p.sale_price_ht, p.sale_price_ttc,
         p.ppc_ht, p.ppc_ttc, p.eco_tax_ttc,
         p.descriptif, p.show_descriptif_on_documents, p.bin_location,
         p.color, p.size, p.pack_qty, p.weight_volume_length, p.measure_unit,
         p.stock_min, p.stock_max,
         (select coalesce(sum(m.qty_delta), 0) from public.stock_moves m where m.article_id = p.id and not m.is_reservation),
         p.price_purchase_locked, p.price_sale_locked, p.designation_locked,
         tot.n
    from page p cross join tot
   order by p.reference;
end $$;
revoke all on function public.article_select_page(uuid, jsonb, int, int) from public, anon;
grant execute on function public.article_select_page(uuid, jsonb, int, int) to authenticated, service_role;

-- Tous les id de la sélection en UNE valeur (un tableau n'est pas coupé par max_rows).
-- Plafond 20 000 : au-delà, affiner les filtres.
create or replace function public.article_select_ids(_company uuid, _f jsonb default '{}'::jsonb)
returns uuid[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _ids uuid[];
begin
  if not public.is_member(_company) then return array[]::uuid[]; end if;
  select coalesce(array_agg(x.id order by x.reference), array[]::uuid[]) into _ids from (
    select a.id, a.reference from public.articles a
     where a.company_id = _company and public._g8_article_match(a, coalesce(_f, '{}'::jsonb))
     order by a.reference limit 20000
  ) x;
  return _ids;
end $$;
revoke all on function public.article_select_ids(uuid, jsonb) from public, anon;
grant execute on function public.article_select_ids(uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------ 3. Écriture de prix par lots (tracée)
-- _rows : [{"id": uuid, "purchase": n?, "sale_ht": n?, "sale_ttc": n?, "coef": n?, "ppc_ht": n?, "ppc_ttc": n?}]
-- Un champ absent n'est pas touché. Verrous G8 respectés : un PA verrouillé n'est pas écrit,
-- un PV verrouillé (HT, TTC, coefficient) non plus — la ligne est comptée « verrouillée ».
-- Retour : {"done": n, "locked": n, "missing": n}.
create or replace function public.article_price_batch(_company uuid, _rows jsonb, _origin text default 'cascade')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _r record; _a public.articles; _done int := 0; _locked int := 0; _missing int := 0;
  _pa numeric; _ht numeric; _ttc numeric; _coef numeric; _ppch numeric; _ppct numeric; _touch boolean;
begin
  if auth.uid() is not null and not public.can_write_table(_company, 'articles') then raise exception 'Accès refusé'; end if;
  if jsonb_typeof(_rows) <> 'array' then raise exception 'Liste de prix attendue'; end if;
  if jsonb_array_length(_rows) > 1000 then raise exception 'Au plus 1 000 articles par appel'; end if;
  perform set_config('app.price_change_origin', coalesce(nullif(_origin, ''), 'cascade'), true);
  for _r in select * from jsonb_to_recordset(_rows) as x(id uuid, purchase numeric, sale_ht numeric, sale_ttc numeric, coef numeric, ppc_ht numeric, ppc_ttc numeric) loop
    select * into _a from public.articles where id = _r.id and company_id = _company;
    if not found then _missing := _missing + 1; continue; end if;
    _pa := _r.purchase; _ht := _r.sale_ht; _ttc := _r.sale_ttc; _coef := _r.coef; _ppch := _r.ppc_ht; _ppct := _r.ppc_ttc;
    _touch := false;
    if _pa is not null and _a.price_purchase_locked then _pa := null; _touch := true; end if;
    if (_ht is not null or _ttc is not null or _coef is not null) and _a.price_sale_locked then
      _ht := null; _ttc := null; _coef := null; _touch := true;
    end if;
    if _pa is null and _ht is null and _ttc is null and _coef is null and _ppch is null and _ppct is null then
      if _touch then _locked := _locked + 1; end if;
      continue;
    end if;
    update public.articles set
      purchase_price = coalesce(_pa, purchase_price),
      sale_price_ht  = coalesce(_ht, sale_price_ht),
      sale_price_ttc = coalesce(_ttc, sale_price_ttc),
      coefficient    = coalesce(_coef, coefficient),
      ppc_ht         = coalesce(_ppch, ppc_ht),
      ppc_ttc        = coalesce(_ppct, ppc_ttc),
      updated_at     = now()
     where id = _a.id;
    _done := _done + 1;
    if _touch then _locked := _locked + 1; end if;
  end loop;
  return jsonb_build_object('done', _done, 'locked', _locked, 'missing', _missing);
end $$;
revoke all on function public.article_price_batch(uuid, jsonb, text) from public, anon;
grant execute on function public.article_price_batch(uuid, jsonb, text) to authenticated, service_role;

-- ------------------------------------------------ 4. Modification en cascade (actions G8)
-- _action (G8, 24 actions moins « nomenclature », qui relève du lot kits) :
--   doc_visible_on / doc_visible_off · pv_from_ppc · ppc_from_pv ·
--   lock_designation / unlock_designation · lock_purchase / unlock_purchase · lock_sale / unlock_sale ·
--   set_bin · set_pack_qty · set_color · set_descriptif · set_family · set_container ·
--   set_supplier · set_brand · set_stock_min_max · set_price · set_size · set_vat · set_mgmt_type
--   + pv_pct · pa_pct · coef (recalcul, déjà présents dans le DMS).
-- _value : {"value": …} ou champs propres à l'action (voir le code de l'écran).
-- Prix : écrits avec l'origine « cascade » (price_changes). Autres champs : une ligne events
-- par article (action article_cascade, ancien / nouveau).
-- Retour : {"done": n, "skipped": n}.
create or replace function public.article_cascade_apply(_company uuid, _ids uuid[], _action text, _value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _a public.articles; _done int := 0; _skip int := 0; _v jsonb := coalesce(_value, '{}'::jsonb);
  _txt text := nullif(trim(_v->>'value'), ''); _num numeric; _old jsonb; _new jsonb;
  _vf numeric; _ht numeric; _ttc numeric; _pa numeric; _min numeric; _max numeric; _sup uuid;
begin
  if auth.uid() is not null and not public.can_write_table(_company, 'articles') then raise exception 'Accès refusé'; end if;
  if coalesce(cardinality(_ids), 0) > 1000 then raise exception 'Au plus 1 000 articles par appel'; end if;
  perform set_config('app.price_change_origin', 'cascade', true);
  if _action in ('pv_pct', 'pa_pct', 'coef', 'set_price', 'set_pack_qty', 'set_vat') then
    _num := nullif(replace(coalesce(_v->>'value', ''), ',', '.'), '')::numeric;
    if _num is null then raise exception 'Valeur numérique attendue'; end if;
  end if;
  if _action = 'set_supplier' then
    _sup := nullif(_v->>'value', '')::uuid;
    if _sup is not null and not exists (select 1 from public.contacts c where c.id = _sup and c.company_id = _company) then
      raise exception 'Fournisseur introuvable';
    end if;
  end if;
  if _action = 'set_family' and _txt is not null and _txt !~ '^[0-9A-Za-z]{1,4}(-[0-9A-Za-z]{1,4}){0,2}$' then
    raise exception 'Famille invalide (attendu RR-SS-CC)';
  end if;
  if _action = 'set_mgmt_type' and _txt is null then raise exception 'Type de gestion attendu'; end if;

  for _a in select * from public.articles where id = any(_ids) and company_id = _company loop
    _old := null; _new := null;
    _vf := 1 + coalesce(_a.vat_rate, 21) / 100;
    case _action
      when 'doc_visible_on', 'doc_visible_off' then
        _old := jsonb_build_object('show_descriptif_on_documents', _a.show_descriptif_on_documents);
        update public.articles set show_descriptif_on_documents = (_action = 'doc_visible_on'), updated_at = now() where id = _a.id;
        _new := jsonb_build_object('show_descriptif_on_documents', _action = 'doc_visible_on');
      when 'pv_from_ppc' then
        if coalesce(_a.ppc_ttc, 0) <= 0 or _a.price_sale_locked then _skip := _skip + 1; continue; end if;
        update public.articles set sale_price_ttc = _a.ppc_ttc,
          sale_price_ht = coalesce(_a.ppc_ht, round(_a.ppc_ttc / _vf, 3)),
          coefficient = case when _a.purchase_price > 0 then round(coalesce(_a.ppc_ht, _a.ppc_ttc / _vf) / _a.purchase_price, 4) else _a.coefficient end,
          updated_at = now() where id = _a.id;
      when 'ppc_from_pv' then
        if coalesce(_a.sale_price_ttc, 0) <= 0 then _skip := _skip + 1; continue; end if;
        update public.articles set ppc_ttc = _a.sale_price_ttc,
          ppc_ht = coalesce(_a.sale_price_ht, round(_a.sale_price_ttc / _vf, 3)), updated_at = now() where id = _a.id;
      when 'lock_designation', 'unlock_designation' then
        _old := jsonb_build_object('designation_locked', _a.designation_locked);
        update public.articles set designation_locked = (_action = 'lock_designation'), updated_at = now() where id = _a.id;
        _new := jsonb_build_object('designation_locked', _action = 'lock_designation');
      when 'lock_purchase', 'unlock_purchase' then
        _old := jsonb_build_object('price_purchase_locked', _a.price_purchase_locked);
        update public.articles set price_purchase_locked = (_action = 'lock_purchase'), updated_at = now() where id = _a.id;
        _new := jsonb_build_object('price_purchase_locked', _action = 'lock_purchase');
      when 'lock_sale', 'unlock_sale' then
        _old := jsonb_build_object('price_sale_locked', _a.price_sale_locked);
        update public.articles set price_sale_locked = (_action = 'lock_sale'), updated_at = now() where id = _a.id;
        _new := jsonb_build_object('price_sale_locked', _action = 'lock_sale');
      when 'set_bin' then
        _old := jsonb_build_object('bin_location', _a.bin_location);
        update public.articles set bin_location = left(_txt, 12), updated_at = now() where id = _a.id;
        _new := jsonb_build_object('bin_location', left(_txt, 12));
      when 'set_pack_qty' then
        if _num <= 0 then raise exception 'Conditionnement > 0 attendu'; end if;
        _old := jsonb_build_object('pack_qty', _a.pack_qty);
        update public.articles set pack_qty = _num, updated_at = now() where id = _a.id;
        _new := jsonb_build_object('pack_qty', _num);
      when 'set_color' then
        _old := jsonb_build_object('color', _a.color);
        update public.articles set color = _txt, updated_at = now() where id = _a.id;
        _new := jsonb_build_object('color', _txt);
      when 'set_size' then
        _old := jsonb_build_object('size', _a.size);
        update public.articles set size = _txt, updated_at = now() where id = _a.id;
        _new := jsonb_build_object('size', _txt);
      when 'set_brand' then
        _old := jsonb_build_object('brand', _a.brand);
        update public.articles set brand = _txt, updated_at = now() where id = _a.id;
        _new := jsonb_build_object('brand', _txt);
      when 'set_descriptif' then
        _old := jsonb_build_object('descriptif', _a.descriptif);
        update public.articles set descriptif = nullif(_v->>'value', ''), updated_at = now() where id = _a.id;
        _new := jsonb_build_object('descriptif', nullif(_v->>'value', ''));
      when 'set_family' then
        _old := jsonb_build_object('category_path', _a.category_path);
        update public.articles set category_path = _txt, updated_at = now() where id = _a.id;
        _new := jsonb_build_object('category_path', _txt);
      when 'set_container' then
        _old := jsonb_build_object('weight_volume_length', _a.weight_volume_length, 'measure_unit', _a.measure_unit);
        update public.articles set
          weight_volume_length = nullif(replace(coalesce(_v->>'qty', ''), ',', '.'), '')::numeric,
          measure_unit = nullif(_v->>'unit', ''), updated_at = now() where id = _a.id;
        _new := jsonb_build_object('weight_volume_length', nullif(replace(coalesce(_v->>'qty', ''), ',', '.'), '')::numeric, 'measure_unit', nullif(_v->>'unit', ''));
      when 'set_supplier' then
        _old := jsonb_build_object('main_supplier_id', _a.main_supplier_id);
        update public.articles set main_supplier_id = _sup, updated_at = now() where id = _a.id;
        _new := jsonb_build_object('main_supplier_id', _sup);
      when 'set_stock_min_max' then
        _min := nullif(replace(coalesce(_v->>'min', ''), ',', '.'), '')::numeric;
        _max := nullif(replace(coalesce(_v->>'max', ''), ',', '.'), '')::numeric;
        if _min is null and _max is null then raise exception 'Stock mini ou maxi attendu'; end if;
        _old := jsonb_build_object('stock_min', _a.stock_min, 'stock_max', _a.stock_max);
        update public.articles set stock_min = coalesce(_min, stock_min), stock_max = coalesce(_max, stock_max), updated_at = now() where id = _a.id;
        _new := jsonb_build_object('stock_min', coalesce(_min, _a.stock_min), 'stock_max', coalesce(_max, _a.stock_max));
      when 'set_vat' then
        _old := jsonb_build_object('vat_rate', _a.vat_rate);
        update public.articles set vat_rate = _num, updated_at = now() where id = _a.id;
        _new := jsonb_build_object('vat_rate', _num);
      when 'set_mgmt_type' then
        _old := jsonb_build_object('mgmt_type', _a.mgmt_type);
        update public.articles set mgmt_type = _txt::public.article_mgmt_type, updated_at = now() where id = _a.id;
        _new := jsonb_build_object('mgmt_type', _txt);
      when 'set_price' then
        if _a.price_sale_locked or _num < 0 then _skip := _skip + 1; continue; end if;
        _ht := round(_num / _vf, 3);
        update public.articles set sale_price_ttc = round(_num, 2), sale_price_ht = _ht,
          coefficient = case when _a.purchase_price > 0 then round(_ht / _a.purchase_price, 4) else _a.coefficient end,
          updated_at = now() where id = _a.id;
      when 'pv_pct' then
        if _a.price_sale_locked then _skip := _skip + 1; continue; end if;
        _ttc := round(_a.sale_price_ttc * (1 + _num / 100), 2);
        update public.articles set sale_price_ttc = _ttc, sale_price_ht = round(_ttc / _vf, 3), updated_at = now() where id = _a.id;
      when 'pa_pct' then
        if _a.price_purchase_locked then _skip := _skip + 1; continue; end if;
        _pa := round(_a.purchase_price * (1 + _num / 100), 4);
        update public.articles set purchase_price = _pa, updated_at = now() where id = _a.id;
      when 'coef' then
        if _a.price_sale_locked or _a.purchase_price <= 0 then _skip := _skip + 1; continue; end if;
        _ht := round(_a.purchase_price * _num, 3);
        update public.articles set coefficient = round(_num, 4), sale_price_ht = _ht, sale_price_ttc = round(_ht * _vf, 2), updated_at = now() where id = _a.id;
      else
        raise exception 'Action inconnue : %', _action;
    end case;
    if _new is not null then
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, auth.uid(), 'article_cascade', 'article', _a.id, 'cascade',
              _old || jsonb_build_object('action', _action), _new);
    end if;
    _done := _done + 1;
  end loop;
  return jsonb_build_object('done', _done, 'skipped', _skip);
end $$;
revoke all on function public.article_cascade_apply(uuid, uuid[], text, jsonb) from public, anon;
grant execute on function public.article_cascade_apply(uuid, uuid[], text, jsonb) to authenticated, service_role;

-- ------------------------------------------------ 5. Supprimer ensemble (administrateur)
-- Un article jamais utilisé (aucun mouvement, aucune ligne de document) est supprimé ; un
-- article qui a un historique n'est pas supprimé (il casserait les documents et B7) : il est
-- désactivé et compté à part. Trace events dans les deux cas.
-- Retour : {"deleted": n, "deactivated": n}.
create or replace function public.article_delete_batch(_company uuid, _ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _a record; _del int := 0; _off int := 0;
begin
  if auth.uid() is not null and not public.is_admin(_company) then raise exception 'Réservé à l''administrateur'; end if;
  if coalesce(cardinality(_ids), 0) > 500 then raise exception 'Au plus 500 articles par appel'; end if;
  for _a in select id, reference, designation, is_active from public.articles where id = any(_ids) and company_id = _company loop
    begin
      if exists (select 1 from public.stock_moves m where m.article_id = _a.id) then
        raise foreign_key_violation;
      end if;
      delete from public.articles where id = _a.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, auth.uid(), 'article_delete', 'article', _a.id, 'cascade',
              jsonb_build_object('reference', _a.reference, 'designation', _a.designation), null);
      _del := _del + 1;
    exception when foreign_key_violation then
      if _a.is_active then
        update public.articles set is_active = false, updated_at = now() where id = _a.id;
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, auth.uid(), 'article_deactivate', 'article', _a.id, 'cascade',
                jsonb_build_object('is_active', true), jsonb_build_object('is_active', false, 'reason', 'historique'));
      end if;
      _off := _off + 1;
    end;
  end loop;
  return jsonb_build_object('deleted', _del, 'deactivated', _off);
end $$;
revoke all on function public.article_delete_batch(uuid, uuid[]) from public, anon;
grant execute on function public.article_delete_batch(uuid, uuid[]) to authenticated, service_role;
