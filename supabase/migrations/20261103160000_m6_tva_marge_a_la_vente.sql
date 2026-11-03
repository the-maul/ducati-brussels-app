-- =====================================================================
-- M6 / M7 / M12 — TVA SUR LA MARGE A LA VENTE (B2, VEN005, VEN006, COM006 ; decision M-89 du
-- 03/11/2026, « OUI » de Simon). Loi belge : art. 58 §4 CTVA, AR n° 53.
--
-- Ce que la migration pose :
--   1. documents.vat_scheme ('normal' | 'marge') + documents.margin_purchase_price (prix de
--      reprise paye au particulier, fige a la vente) ; verrous : un document en marge ne porte
--      que des articles O (plus texte / vide), aucune TVA par ligne, prix de reprise obligatoire
--      sur une facture / un ticket ; un article O ne se vend jamais en regime normal.
--   2. Registre par vehicule `vo_margin_register` (ventes FAC / TIK et avoirs AVO en marge,
--      marge INDICATIVE), `vo_margin_purchases` (achats marge = motos O entrees en stock) et
--      `vo_margin_periods` = BASE GLOBALE PAR PERIODE DE DECLARATION (AR 53 art. 3) : ventes −
--      achats + report entrant ; marge negative reportee ; mois ou trimestre ; a partir de la
--      date de bascule comptable ; stock initial repris de G8 / Shopify exclu des achats ;
--      vue `v_vo_margin_declaration` pour la declaration.
--   3. Le registre TVA ordinaire (`vat_register`) exclut les documents en marge (ils ne vont pas
--      dans les grilles ordinaires) ; les ecritures de vente passent par le compte « ventes marge »
--      (`account_mappings.sales_margin`, 700200) sans TVA ; OD de fin de periode
--      `generate_margin_period_entries` : ventes marge / TVA sur marge (451090) = TVA due.
--   4. Reglages parametrables (Parametres → Tables → « TVA marge (occasions) »,
--      reference_values.vat_margin_settings) : taux, periode, grilles 00 / 03 / 54, code TVA et
--      journal Winbooks. A CONFIRMER PAR LE COMPTABLE.
--
-- Hors base fiscale (decision client) : les pieces et la main-d oeuvre de l ORO sont des achats
-- ordinaires a TVA deductible ; la rentabilite B3 (fiche VIN) ne change pas.
--
-- NON APPLIQUEE le 03/11/2026 (regle du lot : aucune migration en prod sans accord et backup).
-- Essai a blanc (transaction annulee) :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f <fichier .sql>
-- Application :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103160000_m6_tva_marge_a_la_vente.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colonnes du regime sur l en-tete du document
-- ---------------------------------------------------------------------
alter table public.documents add column if not exists vat_scheme text not null default 'normal';
alter table public.documents add column if not exists margin_purchase_price numeric(14,2);
alter table public.documents drop constraint if exists documents_vat_scheme_chk;
alter table public.documents add constraint documents_vat_scheme_chk check (vat_scheme in ('normal', 'marge'));
alter table public.documents drop constraint if exists documents_margin_purchase_price_chk;
alter table public.documents add constraint documents_margin_purchase_price_chk
  check (margin_purchase_price is null or margin_purchase_price >= 0);
create index if not exists idx_documents_marge on public.documents (company_id, issue_date) where vat_scheme = 'marge';

comment on column public.documents.vat_scheme is
  'M6 B2 : normal (TVA par ligne) | marge (occasion rachetee a un particulier, art. 58 §4 CTVA : aucune TVA sur le document).';
comment on column public.documents.margin_purchase_price is
  'M6 B2 : prix de reprise paye au particulier (seul, sans ORO), fige a la vente ; base du registre de la marge.';

-- ---------------------------------------------------------------------
-- 2. Verrous sur les lignes : en marge, uniquement des articles O, taux 0, TTC = HT
-- ---------------------------------------------------------------------
create or replace function public.document_lines_marge_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _scheme text; _mgmt text; _status text;
begin
  select d.vat_scheme, d.status into _scheme, _status from public.documents d where d.id = new.document_id;
  if _scheme is distinct from 'marge' then return new; end if;
  if coalesce(new.line_type, 'article') in ('texte', 'vide') or new.quantity = 0 then return new; end if;
  if new.article_id is null then
    raise exception 'Regime de la marge : la ligne « % » doit etre une moto d occasion (article de type O) ; les autres lignes se facturent a part.', new.designation
      using errcode = '23514';
  end if;
  select a.mgmt_type into _mgmt from public.articles a where a.id = new.article_id;
  if _mgmt is distinct from 'O' then
    raise exception 'Regime de la marge : la ligne « % » n est pas une moto d occasion de particulier (type %) ; facturez-la sur un document a part.', new.designation, coalesce(_mgmt, '?')
      using errcode = '23514';
  end if;
  -- Aucune TVA sur une ligne en marge, quoi que le poste ait envoye.
  new.vat_rate := 0;
  new.line_ttc := new.line_ht;
  return new;
end $$;
revoke all on function public.document_lines_marge_guard() from public, anon, authenticated;
drop trigger if exists trg_document_lines_marge_guard on public.document_lines;
create trigger trg_document_lines_marge_guard before insert or update on public.document_lines
  for each row execute function public.document_lines_marge_guard();

-- ---------------------------------------------------------------------
-- 3. Verrous sur l en-tete : a la validation, regime coherent, prix de reprise fige ;
--    apres validation, regime et prix de reprise figes (B7).
-- ---------------------------------------------------------------------
create or replace function public.documents_marge_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _bad text; _pp numeric; _missing int;
begin
  if new.imported_from is not null then return new; end if;   -- repris de G8
  -- Document deja valide : regime et prix de reprise ne bougent plus.
  if tg_op = 'UPDATE' and old.status not in ('brouillon') then
    if new.vat_scheme is distinct from old.vat_scheme or new.margin_purchase_price is distinct from old.margin_purchase_price then
      raise exception 'Le document % est valide : son regime de TVA et son prix de reprise ne se modifient plus (B7).', coalesce(old.number, old.id::text)
        using errcode = '23514';
    end if;
    return new;
  end if;
  -- Seul le passage brouillon → valide est controle (le brouillon reste libre).
  if new.status not in ('validee', 'payee') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('validee', 'payee') then return new; end if;

  if new.vat_scheme = 'normal' then
    -- Une moto O ne se vend jamais en regime normal (B2).
    select l.designation into _bad
      from public.document_lines l join public.articles a on a.id = l.article_id
      where l.document_id = new.id and a.mgmt_type = 'O' and l.quantity <> 0
        and coalesce(l.line_type, 'article') not in ('texte', 'vide')
      limit 1;
    if _bad is not null then
      raise exception 'La moto d occasion « % » est rachetee a un particulier : elle se vend sous le regime de la marge, sans TVA (B2).', _bad
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Regime de la marge : aucune TVA, pas de port, que des motos O.
  if new.total_vat <> 0 or new.shipping_ht <> 0 or new.tax_exempt then
    raise exception 'Regime de la marge : aucune TVA ni port sur le document % (total TVA %, port %).', coalesce(new.number, new.id::text), new.total_vat, new.shipping_ht
      using errcode = '23514';
  end if;
  select l.designation into _bad
    from public.document_lines l left join public.articles a on a.id = l.article_id
    where l.document_id = new.id and l.quantity <> 0 and coalesce(l.line_type, 'article') not in ('texte', 'vide')
      and (a.id is null or a.mgmt_type is distinct from 'O')
    limit 1;
  if _bad is not null then
    raise exception 'Regime de la marge : la ligne « % » n est pas une moto d occasion de particulier ; facturez-la sur un document a part.', _bad
      using errcode = '23514';
  end if;
  -- Prix de reprise fige a la vente effective (facture, ticket) ; un avoir reprend celui de sa facture.
  if new.doc_type in ('FAC', 'TIK') and (new.margin_purchase_price is null or new.margin_purchase_price <= 0) then
    select coalesce(sum(a.purchase_price * abs(l.quantity)), 0), count(*) filter (where coalesce(a.purchase_price, 0) <= 0)
      into _pp, _missing
      from public.document_lines l join public.articles a on a.id = l.article_id
      where l.document_id = new.id and a.mgmt_type = 'O' and l.quantity <> 0;
    if _missing > 0 or _pp <= 0 then
      raise exception 'Regime de la marge : prix de reprise inconnu pour une moto du document % ; enregistrez-le sur la reprise avant de facturer.', coalesce(new.number, new.id::text)
        using errcode = '23514';
    end if;
    new.margin_purchase_price := round(_pp, 2);
  end if;
  return new;
end $$;
revoke all on function public.documents_marge_guard() from public, anon, authenticated;
drop trigger if exists trg_documents_marge_guard on public.documents;
create trigger trg_documents_marge_guard
  before update of status, vat_scheme, margin_purchase_price on public.documents
  for each row execute function public.documents_marge_guard();

comment on function public.documents_marge_guard() is
  'M6 B2 (M-89) : a la validation, un document en marge ne porte que des motos O sans TVA ni port et fige le prix de reprise (FAC/TIK) ; une moto O ne se valide jamais en regime normal ; regime et prix figes apres validation.';

-- ---------------------------------------------------------------------
-- 4. Reglages parametrables (Parametres → Tables → « TVA marge (occasions) ») et comptes
-- ---------------------------------------------------------------------
do $$
declare _co record;
begin
  for _co in select id from public.companies loop
    insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra) values
      (_co.id, 'vat_margin_settings', 'rate',              '21',    1, true, '{"help":"Taux de TVA applique a la marge (TVA comprise dans la marge)"}'),
      (_co.id, 'vat_margin_settings', 'period',            'month', 2, true, '{"help":"Periode de declaration : month (mensuelle) ou quarter (trimestrielle)"}'),
      (_co.id, 'vat_margin_settings', 'grid_sales',        '00',    3, true, '{"help":"Grille des ventes sous regime particulier (prix de vente total) - a confirmer par le comptable"}'),
      (_co.id, 'vat_margin_settings', 'grid_base',         '03',    4, true, '{"help":"Grille de la base imposable (marge HTVA) - a confirmer par le comptable"}'),
      (_co.id, 'vat_margin_settings', 'grid_vat',          '54',    5, true, '{"help":"Grille de la TVA due - a confirmer par le comptable"}'),
      (_co.id, 'vat_margin_settings', 'winbooks_vat_code', 'MARGE', 6, true, '{"help":"Code TVA Winbooks de l OD de fin de periode - a confirmer par le comptable"}'),
      (_co.id, 'vat_margin_settings', 'winbooks_journal',  'OD',    7, true, '{"help":"Journal Winbooks de l OD de fin de periode"}')
    on conflict (company_id, table_key, code) do nothing;

    insert into public.chart_of_accounts (company_id, code, label, kind) values
      (_co.id, '700200', 'Ventes occasions — regime de la marge (TTC)', 'general')
    on conflict (company_id, code) do nothing;
    insert into public.account_mappings (company_id, dimension, match_key, account_code, journal_code) values
      (_co.id, 'sales_margin', '*', '700200', 'VEN'),
      (_co.id, 'vat_margin',   '*', '451090', null)
    on conflict (company_id, dimension, match_key) do nothing;
  end loop;
end $$;

-- Taux parametre (defaut 21) et periode parametree (defaut month) d une societe.
create or replace function public._vat_margin_setting(_company uuid, _code text, _default text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select nullif(replace(trim(label), ',', '.'), '') from public.reference_values
                   where company_id = _company and table_key = 'vat_margin_settings' and code = _code and is_active limit 1), _default);
$$;
revoke all on function public._vat_margin_setting(uuid, text, text) from public, anon;
grant execute on function public._vat_margin_setting(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Registre par vehicule : ventes et avoirs des documents en marge (marge INDICATIVE).
--    Une facture annulee par un avoir reste au registre (la vente ET l avoir y figurent, comme
--    au facturier) ; une facture annulee sans avoir n y est pas.
-- ---------------------------------------------------------------------
drop function if exists public.vo_margin_register(uuid, date, date);
create function public.vo_margin_register(_company uuid, _from date, _to date)
returns table(
  sale_date date, doc_number text, doc_type text, document_id uuid, vehicle_id uuid, vin text,
  designation text, purchase_price numeric, sale_ttc numeric,
  margin numeric, vat_margin numeric, base_ht numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
  with rate as (select public._vat_margin_setting(_company, 'rate', '21')::numeric as r),
  sold as (
    select d.issue_date, d.number, d.doc_type, d.id as document_id, v.id as vehicle_id, v.vin, l.designation,
           -- prix de reprise fige sur le document, reparti par ligne au prorata du prix si plusieurs motos
           case when count(*) over (partition by d.id) = 1
                then coalesce(d.margin_purchase_price, a.purchase_price, 0)
                else coalesce(a.purchase_price, 0) end as purchase_price,
           l.line_ttc as sale_ttc
    from public.document_lines l
    join public.documents d on d.id = l.document_id
    join public.articles a on a.id = l.article_id and a.mgmt_type = 'O'
    left join public.vehicles v on v.article_id = a.id
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.vat_scheme = 'marge'
      and l.quantity <> 0 and coalesce(l.line_type, 'article') not in ('texte', 'vide')
      and d.issue_date between _from and _to
      and (
        (d.doc_type in ('FAC', 'TIK') and (d.status in ('validee', 'payee')
           or (d.status = 'annulee' and exists (select 1 from public.documents av
                 where av.source_document_id = d.id and av.doc_type = 'AVO' and av.status <> 'brouillon'))))
        or (d.doc_type = 'AVO' and d.status <> 'brouillon')
      )
  )
  select s.issue_date, s.number, s.doc_type, s.document_id, s.vehicle_id, s.vin, s.designation,
         round(s.purchase_price, 2),
         round(s.sale_ttc, 2),
         round(sign(s.sale_ttc) * (abs(s.sale_ttc) - s.purchase_price), 2) as margin,
         round(case when sign(s.sale_ttc) * (abs(s.sale_ttc) - s.purchase_price) > 0
                    then (abs(s.sale_ttc) - s.purchase_price) * r.r / (100 + r.r) else 0 end, 2) as vat_margin,
         round(case when sign(s.sale_ttc) * (abs(s.sale_ttc) - s.purchase_price) > 0
                    then (abs(s.sale_ttc) - s.purchase_price) * 100 / (100 + r.r) else 0 end, 2) as base_ht
  from sold s, rate r
  order by s.issue_date, s.number;
$$;
revoke all on function public.vo_margin_register(uuid, date, date) from public, anon;
grant execute on function public.vo_margin_register(uuid, date, date) to authenticated;

create or replace function public.vo_margin_summary(_company uuid, _from date, _to date)
returns table(count_vo bigint, total_sale numeric, total_margin numeric, total_vat_margin numeric, total_base numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::bigint,
         coalesce(sum(sale_ttc), 0), coalesce(sum(margin), 0),
         coalesce(sum(vat_margin), 0), coalesce(sum(base_ht), 0)
  from public.vo_margin_register(_company, _from, _to);
$$;
revoke all on function public.vo_margin_summary(uuid, date, date) from public, anon;
grant execute on function public.vo_margin_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Achats sous regime de la marge : motos O avec prix de reprise, a la date de leur
--    PREMIERE entree en stock (validation de la reprise, origine 'reception'). Une entree de
--    retour (avoir) n est jamais un nouvel achat : seule la premiere entree compte.
--    Exclus : le stock initial repris a la migration (premiere entree d origine 'import' ou
--    'moto_parc', vehicule importe de G8 / Shopify) : ces motos ont ete achetees avant la
--    bascule, leur achat a deja ete deduit dans les declarations G8 (a confirmer par le
--    comptable). Constat du 03/11/2026 : 87 articles O, dont 84 issus de la migration.
-- ---------------------------------------------------------------------
create or replace function public.vo_margin_purchases(_company uuid, _from date, _to date)
returns table(purchase_date date, article_id uuid, reference text, vehicle_id uuid, vin text, designation text, purchase_price numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with first_entry as (
    select distinct on (sm.article_id) sm.article_id, sm.occurred_at::date as d, sm.origin
    from public.stock_moves sm
    join public.articles a on a.id = sm.article_id and a.mgmt_type = 'O' and a.company_id = _company
    where sm.qty_delta > 0 and not sm.is_reservation
    order by sm.article_id, sm.occurred_at, sm.id
  )
  select f.d as purchase_date, a.id, a.reference, v.id, v.vin, a.designation, round(a.purchase_price, 2)
  from first_entry f
  join public.articles a on a.id = f.article_id
  left join public.vehicles v on v.article_id = a.id
  where (auth.uid() is null or public.is_member(_company))
    and coalesce(a.purchase_price, 0) > 0
    and f.origin not in ('import', 'moto_parc')
    and v.imported_from is null
    and f.d between _from and _to
  order by 1, a.reference;
$$;
revoke all on function public.vo_margin_purchases(uuid, date, date) from public, anon;
grant execute on function public.vo_margin_purchases(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 7. BASE GLOBALE PAR PERIODE DE DECLARATION (AR 53 art. 3) : depuis la toute premiere operation
--    marge de la societe (pour porter le report), une ligne par periode entre _from et _to.
--    marge = ventes − achats + report entrant ; marge ≤ 0 → ni base ni TVA, report sortant = marge.
--    TVA comprise dans la marge : base = marge × 100 / (100 + taux), TVA = marge − base.
-- ---------------------------------------------------------------------
create or replace function public.vo_margin_periods(_company uuid, _from date, _to date, _granularity text default null)
returns table(
  period_key text, period_start date, period_end date, count_sales bigint, count_purchases bigint,
  sales numeric, purchases numeric, carried_in numeric, margin numeric, base_ht numeric, vat_due numeric, carried_out numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  _g text := coalesce(_granularity, public._vat_margin_setting(_company, 'period', 'month'));
  _rate numeric := public._vat_margin_setting(_company, 'rate', '21')::numeric;
  _first date; _p date; _end date; _carry numeric := 0; _f date;
  _sales numeric; _purch numeric; _cs bigint; _cp bigint; _m numeric;
  -- Date de bascule comptable (20260612310000) : seules les operations a partir de cette date
  -- entrent dans la declaration ; l historique G8 a deja ete declare.
  _cut date := public._accounting_cutover(_company);
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Acces refuse'; end if;
  if _g not in ('month', 'quarter') then _g := 'month'; end if;
  select least(
    (select min(sale_date) from public.vo_margin_register(_company, _cut, _to)),
    (select min(purchase_date) from public.vo_margin_purchases(_company, _cut, _to))
  ) into _first;
  if _first is null then return; end if;
  _p := date_trunc(_g, least(_first, greatest(_from, _cut)))::date;
  while _p <= _to loop
    _end := (_p + (case when _g = 'month' then interval '1 month' else interval '3 months' end))::date - 1;
    _f := greatest(_p, _cut);
    select coalesce(sum(r.sale_ttc), 0), count(*) into _sales, _cs from public.vo_margin_register(_company, _f, _end) r;
    select coalesce(sum(q.purchase_price), 0), count(*) into _purch, _cp from public.vo_margin_purchases(_company, _f, _end) q;
    _m := round(_sales - _purch + _carry, 2);
    if _end >= _from then
      period_key := case when _g = 'month' then to_char(_p, 'YYYY-MM') else to_char(_p, 'YYYY') || '-T' || to_char(_p, 'Q') end;
      period_start := _p; period_end := _end; count_sales := _cs; count_purchases := _cp;
      sales := round(_sales, 2); purchases := round(_purch, 2); carried_in := round(_carry, 2); margin := _m;
      if _m > 0 then
        base_ht := round(_m * 100 / (100 + _rate), 2); vat_due := round(_m - base_ht, 2); carried_out := 0;
      else
        base_ht := 0; vat_due := 0; carried_out := _m;
      end if;
      return next;
    end if;
    _carry := case when _m < 0 then _m else 0 end;
    _p := (_end + 1);
  end loop;
end $$;
revoke all on function public.vo_margin_periods(uuid, date, date, text) from public, anon;
grant execute on function public.vo_margin_periods(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Registre TVA ordinaire : les documents en marge n y entrent pas (ils vont dans le registre
--    de la marge et les grilles parametrees). Meme definition que la version en base
--    (20260612310000, date de bascule comprise), filtre `vat_scheme <> 'marge'` en plus.
-- ---------------------------------------------------------------------
create or replace function public.vat_register(_company uuid, _from date, _to date)
returns table(vat_rate numeric, base_ht numeric, vat numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with cutoff as (select greatest(_from, public._accounting_cutover(_company)) as f),
  detailed as (
    select l.vat_rate as rate, sum(l.line_ht) as base, sum(l.line_ttc - l.line_ht) as vat
    from public.document_lines l
    join public.documents d on d.id = l.document_id, cutoff
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC','TIK','AVO') and d.status <> 'annulee' and d.vat_scheme <> 'marge'
      and d.issue_date between cutoff.f and _to
    group by l.vat_rate
  ),
  header_only as (
    select case when abs(d.total_ht) > 0 then round(d.total_vat / d.total_ht * 100) else 0 end as rate,
           sum(d.total_ht) as base, sum(d.total_vat) as vat
    from public.documents d, cutoff
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC','TIK','AVO') and d.status <> 'annulee' and d.vat_scheme <> 'marge'
      and d.issue_date between cutoff.f and _to
      and not exists (select 1 from public.document_lines l where l.document_id = d.id)
    group by 1
  )
  select rate, round(sum(base), 2), round(sum(vat), 2)
  from (select * from detailed union all select * from header_only) u
  group by rate
  order by rate;
$$;
grant execute on function public.vat_register(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Ecritures de vente : un document en marge passe au compte « ventes marge » (TTC, sans 451).
--    Meme moteur qu avant (20260612130000), seul le compte de vente change pour vat_scheme = 'marge'.
-- ---------------------------------------------------------------------
create or replace function public.generate_sales_entries(_company uuid, _from date, _to date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d record; b record; _entry uuid; _ln int; _rev boolean;
  _cust_acct text; _cust_aux text;
  _sum_ht numeric; _sum_vat numeric; _res_ht numeric; _res_vat numeric; _count int := 0; _marge_acct text;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  _marge_acct := coalesce(public.resolve_account(_company, 'sales_margin', '*'), '700200');

  for d in
    select doc.id, doc.doc_type, doc.number, doc.issue_date, doc.contact_id, doc.vat_scheme,
           abs(doc.total_ht) ht, abs(doc.total_vat) vat, abs(doc.total_ttc) ttc
    from public.documents doc
    where doc.company_id = _company and doc.doc_type in ('FAC','TIK','AVO')
      and doc.status <> 'annulee' and doc.issue_date between _from and _to
      and not exists (select 1 from public.accounting_entries e
                      where e.company_id = _company and e.source = 'sales' and e.source_id = doc.id::text)
  loop
    if d.ttc = 0 then continue; end if;
    _rev := (d.doc_type = 'AVO');
    _cust_acct := coalesce(public.resolve_account(_company, 'customer_collective', '*'), '400000');
    select coalesce(nullif(account_code, ''), _cust_acct) into _cust_aux
      from public.contacts where id = d.contact_id;
    _cust_aux := coalesce(_cust_aux, _cust_acct);

    insert into public.accounting_entries (company_id, journal_code, entry_date, doc_type, doc_number, source, source_id, label)
    values (_company, coalesce(public.resolve_journal(_company,'sales','*'),'VEN'), d.issue_date, d.doc_type, d.number, 'sales', d.id::text,
            case when d.vat_scheme = 'marge' then 'Vente marge ' else 'Vente ' end || coalesce(d.number, d.id::text))
    returning id into _entry;
    _ln := 0;

    insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, auxiliary_code, debit, credit, label)
    values (_entry, _ln, _cust_acct, public._account_label(_company,_cust_acct), _cust_aux,
            case when _rev then 0 else d.ttc end, case when _rev then d.ttc else 0 end,
            'Client ' || coalesce(d.number,''));
    _ln := _ln + 1;

    _sum_ht := 0; _sum_vat := 0;
    for b in
      select case when d.vat_scheme = 'marge' then _marge_acct
                  else coalesce(public.resolve_account(_company,'sales', a.category_id::text), '700000') end as sales_acct,
             l.vat_rate as rate,
             round(sum(abs(l.line_ht)),2) as ht,
             round(sum(abs(l.line_ttc - l.line_ht)),2) as vat
      from public.document_lines l
      left join public.articles a on a.id = l.article_id
      where l.document_id = d.id
      group by 1, 2
    loop
      if b.ht <> 0 then
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, vat_rate, label)
        values (_entry, _ln, b.sales_acct, public._account_label(_company,b.sales_acct),
                case when _rev then b.ht else 0 end, case when _rev then 0 else b.ht end,
                case when d.vat_scheme = 'marge' then null else b.rate end,
                case when d.vat_scheme = 'marge' then 'Vente marge TTC (art. 58 §4)' else 'Vente HT' end);
        _ln := _ln + 1; _sum_ht := _sum_ht + b.ht;
      end if;
      if b.vat <> 0 then
        declare _vacct text := coalesce(public.resolve_account(_company,'vat_collected', b.rate::text), '451000');
        begin
          insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, vat_rate, label)
          values (_entry, _ln, _vacct, public._account_label(_company,_vacct),
                  case when _rev then b.vat else 0 end, case when _rev then 0 else b.vat end, b.rate, 'TVA collectée');
          _ln := _ln + 1; _sum_vat := _sum_vat + b.vat;
        end;
      end if;
    end loop;

    _res_ht := round(d.ht - _sum_ht, 2);
    _res_vat := round(d.vat - _sum_vat, 2);
    if abs(_res_ht) >= 0.01 then
      declare _sa text := case when d.vat_scheme = 'marge' then _marge_acct else coalesce(public.resolve_account(_company,'sales','*'),'700000') end;
      begin
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
        values (_entry, _ln, _sa, public._account_label(_company,_sa),
                case when (_rev) = (_res_ht >= 0) then abs(_res_ht) else 0 end,
                case when (_rev) = (_res_ht >= 0) then 0 else abs(_res_ht) end, 'Port / remise / arrondi');
        _ln := _ln + 1;
      end;
    end if;
    if abs(_res_vat) >= 0.01 then
      declare _va text := coalesce(public.resolve_account(_company,'vat_collected','*'),'451000');
      begin
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
        values (_entry, _ln, _va, public._account_label(_company,_va),
                case when (_rev) = (_res_vat >= 0) then abs(_res_vat) else 0 end,
                case when (_rev) = (_res_vat >= 0) then 0 else abs(_res_vat) end, 'TVA — arrondi');
      end;
    end if;
    _count := _count + 1;
  end loop;
  return _count;
end $$;
grant execute on function public.generate_sales_entries(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 10. OD de fin de periode : ventes marge / TVA sur marge = TVA due de chaque periode de la
--     plage (idempotente par periode ; source 'vat_margin', source_id = cle de periode).
--     A CONFIRMER PAR LE COMPTABLE (compte de contrepartie, journal, date).
-- ---------------------------------------------------------------------
create or replace function public.generate_margin_period_entries(_company uuid, _from date, _to date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; _entry uuid; _sales text; _vat text; _journ text; _count int := 0;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Acces refuse'; end if;
  _sales := coalesce(public.resolve_account(_company, 'sales_margin', '*'), '700200');
  _vat   := coalesce(public.resolve_account(_company, 'vat_margin', '*'), '451090');
  _journ := public._vat_margin_setting(_company, 'winbooks_journal', 'OD');
  for p in select * from public.vo_margin_periods(_company, _from, _to, null) loop
    if p.vat_due <= 0 then continue; end if;
    if exists (select 1 from public.accounting_entries e where e.company_id = _company and e.source = 'vat_margin' and e.source_id = p.period_key) then continue; end if;
    insert into public.accounting_entries (company_id, journal_code, entry_date, doc_type, doc_number, source, source_id, label)
    values (_company, _journ, p.period_end, 'OD', 'MARGE-' || p.period_key, 'vat_margin', p.period_key, 'TVA sur la marge ' || p.period_key)
    returning id into _entry;
    insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
    values (_entry, 0, _sales, public._account_label(_company, _sales), p.vat_due, 0, 'Ventes marge → TVA due ' || p.period_key);
    insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
    values (_entry, 1, _vat, public._account_label(_company, _vat), 0, p.vat_due, 'TVA sur marge ' || p.period_key);
    _count := _count + 1;
  end loop;
  return _count;
end $$;
revoke all on function public.generate_margin_period_entries(uuid, date, date) from public, anon;
grant execute on function public.generate_margin_period_entries(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Vue pour la declaration : une ligne par societe (dont l utilisateur est membre) et par
--     periode de declaration (reglage `period`), de la date de bascule au jour : ventes,
--     achats, report, base, TVA due et grilles parametrees (a confirmer par le comptable).
-- ---------------------------------------------------------------------
create or replace view public.v_vo_margin_declaration with (security_invoker = true) as
  select c.id as company_id, p.period_key, p.period_start, p.period_end,
         p.count_sales, p.count_purchases, p.sales, p.purchases, p.carried_in, p.margin,
         p.base_ht, p.vat_due, p.carried_out,
         public._vat_margin_setting(c.id, 'grid_sales', '00') as grid_sales,
         public._vat_margin_setting(c.id, 'grid_base', '03') as grid_base,
         public._vat_margin_setting(c.id, 'grid_vat', '54') as grid_vat
  from (select co.id from public.companies co where public.is_member(co.id)) c
  -- `vo_margin_periods` demarre d elle-meme a la date de bascule (pas de 1900 reel).
  cross join lateral public.vo_margin_periods(c.id, date '1900-01-01', current_date, null) p;
revoke all on public.v_vo_margin_declaration from anon;
grant select on public.v_vo_margin_declaration to authenticated;
comment on view public.v_vo_margin_declaration is
  'M12 B2 (M-89) : TVA sur la marge par periode de declaration (AR 53 art. 3), base globale, report de la marge negative. Grilles parametrables, a confirmer par le comptable.';
