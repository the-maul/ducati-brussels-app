-- =====================================================================
-- VP4 — Dépôt-vente : cession ouverte d'office à l'entrée, frais payés par le déposant (décision du
-- client, 20/11/2026 : « comme G8 ; les frais sont payés par le déposant, déduits du reversement,
-- hors coût de revient concession »). VEH009 B3
--
-- G8 : à l'entrée d'un dépôt-vente, une cession VO est ouverte d'office (5000014). Le DMS n'en
-- ouvrait pas (une cession ouverte à la main était archivée à la vente) et, si elle était validée,
-- son coût s'ajoutait au coût de revient de la moto comme pour une occasion de la concession.
--
-- 1. internal_cessions.consignment_id (nouvelle colonne, facultative) : la cession appartient à un
--    dépôt-vente. Posée par consignment_create, et d'office pour toute cession ouverte sur une moto
--    actuellement en dépôt (déclencheur trg_icession_ab_consignment). Pas de nouvelle politique RLS
--    (colonne d'une table déjà protégée).
-- 2. consignment_create (corps de production) : après le dépôt, cession ouverte d'office (type du
--    réglage consignment_settings.cession_type, 01 Cession VO par défaut ; réglage
--    auto_cession_on_entry = oui par défaut), déposant en client, origine « depot ». Un échec
--    n'empêche jamais l'entrée du dépôt (trace events cession_auto_echec).
-- 3. _vehicle_cost_recompute et validate_internal_cession : les cessions d'un dépôt-vente n'entrent PAS dans le coût de revient
--    de la moto (elle n'appartient pas à la concession).
-- 4. consignment_depot_costs(dépôt) : frais à charge du déposant = cessions VALIDÉES du dépôt,
--    valorisées au coût (cout, défaut : total de la cession + options) ou au prix de vente HT des
--    pièces (vente) — réglage consignment_settings.depot_costs_basis —, TVA de la commission
--    comprise (TTC, comme la ligne « Réparations » de la facture au déposant). Signale aussi les
--    cessions encore ouvertes avec des lignes (à valider avant la vente).
-- 5. consignment_sell : sans montant de réparations donné par l'écran, ces frais sont repris
--    d'office ; ils figurent sur la facture au déposant (ligne « Réparations / remise en état ») et
--    sont déduits du reversement (net = prix de vente − commission − frais − réparations, calcul
--    consignment_amounts inchangé) ; le décompte imprimé (printSettlementSheet) les montre.
--
-- Additive, rejouable. Essai à blanc : supabase/tests/vp4_depot_vente_frais_deposant.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

alter table public.internal_cessions
  add column if not exists consignment_id uuid references public.consignments(id) on delete set null;
create index if not exists idx_internal_cessions_consignment on public.internal_cessions(consignment_id) where consignment_id is not null;
comment on column public.internal_cessions.consignment_id is
  'VP4 (20/11/2026) : cession d''un dépôt-vente — frais à charge du déposant, hors coût de revient de la concession.';

-- Réglages par société (Paramètres → Tables → Réglages du dépôt-vente).
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select co.id, 'consignment_settings', x.code, x.label, x.so, jsonb_build_object('help', x.help)
  from public.companies co
  cross join (values
    ('auto_cession_on_entry', 'oui', 200, 'oui = une cession est ouverte d office a l entree du depot (comme G8) ; les frais y sont notes et payes par le deposant'),
    ('cession_type', '01', 210, 'Code du type de cession ouvert a l entree du depot (01 = Cession VO)'),
    ('depot_costs_basis', 'cout', 220, 'Frais de la cession deduits du reversement : cout (prix de revient des pieces et de la main-d oeuvre) ou vente (prix de vente HT des pieces) ; TVA de la commission ajoutee')
  ) as x(code, label, so, help)
on conflict (company_id, table_key, code) do nothing;

-- Toute cession ouverte sur une moto en dépôt appartient au dépôt.
create or replace function public._icession_link_consignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.consignment_id is null and new.vehicle_id is not null then
    select c.id into new.consignment_id from public.consignments c
     where c.vehicle_id = new.vehicle_id and c.company_id = new.company_id and c.status = 'en_depot'
     order by c.created_at desc limit 1;
  end if;
  return new;
end $fn$;
revoke all on function public._icession_link_consignment() from public, anon, authenticated;
drop trigger if exists trg_icession_ab_consignment on public.internal_cessions;
create trigger trg_icession_ab_consignment before insert on public.internal_cessions
  for each row execute function public._icession_link_consignment();

create or replace function public.consignment_depot_costs(_consignment uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare c public.consignments; _basis text; _rate numeric; _cost numeric; _sale numeric; _base numeric;
        _open int; _list jsonb;
begin
  select * into c from public.consignments where id = _consignment;
  if c.id is null then raise exception 'Depot-vente introuvable' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.is_member(c.company_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  _basis := case when lower(public._consignment_setting(c.company_id, 'depot_costs_basis', 'cout')) = 'vente' then 'vente' else 'cout' end;
  _rate := public._consignment_num(public._consignment_setting(c.company_id, 'commission_vat_rate', '21'), 21);
  select coalesce(sum(x.total_cost + x.options_amount), 0), coalesce(sum(x.total_sale_ht), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'number', x.number, 'status', x.status,
                                               'total_cost', x.total_cost + x.options_amount, 'total_sale_ht', x.total_sale_ht)
                            order by x.created_at), '[]'::jsonb)
    into _cost, _sale, _list
    from public.internal_cessions x
   where x.consignment_id = _consignment and x.validated_at is not null and x.status in ('valide', 'archive');
  select count(*) into _open from public.internal_cessions x
   where x.consignment_id = _consignment and x.status = 'ouvert'
     and exists (select 1 from public.internal_cession_lines l where l.cession_id = x.id and l.kind <> 'texte');
  _base := case when _basis = 'vente' then _sale else _cost end;
  return jsonb_build_object('basis', _basis, 'vat_rate', _rate, 'cost_ht', round(_cost, 2), 'sale_ht', round(_sale, 2),
                            'amount_ht', round(_base, 2), 'amount_ttc', round(_base * (100 + _rate) / 100, 2),
                            'open_with_lines', _open, 'cessions', _list);
end $fn$;
revoke all on function public.consignment_depot_costs(uuid) from public, anon;
grant execute on function public.consignment_depot_costs(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public._vehicle_cost_recompute(_vehicle uuid, _source text, _source_id uuid, _ref text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v record; _legacy numeric; _ces numeric; _new numeric;
begin
  select id, company_id, purchase_price, cost_price into v from public.vehicles where id = _vehicle;
  if v.id is null then return null; end if;
  select coalesce(sum(o.total_cost), 0) into _legacy from public.oro o where o.vehicle_id = _vehicle;
  select coalesce(sum(c.total_cost + c.options_amount), 0) into _ces
    from public.internal_cessions c
   where c.vehicle_id = _vehicle and c.accounted and c.validated_at is not null
     and c.consignment_id is null   -- VP4 : frais d'un dépôt-vente = à charge du déposant
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
end $function$;

CREATE OR REPLACE FUNCTION public.validate_internal_cession(_cession uuid, _options numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- VP4 : cession d'un depot-vente = frais du deposant, pas de cout de revient de la concession.
  if c.vehicle_id is not null and c.consignment_id is null then
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
end $function$;

CREATE OR REPLACE FUNCTION public.consignment_create(_company uuid, _data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _id uuid; _num text; _veh uuid; v public.vehicles; _art uuid; _mgmt text; _real numeric;
  _dep uuid := nullif(_data->>'depositor_id', '')::uuid;
  _vin text := upper(regexp_replace(coalesce(_data#>>'{vehicle,vin}', ''), '\s', '', 'g'));
  _sale numeric := public._consignment_num(_data->>'agreed_price', 0);
  _kind text := coalesce(nullif(_data->>'depositor_kind', ''), 'particulier');
  _police text := nullif(trim(coalesce(_data->>'police_book_number', '')), '');
begin
  perform public._consignment_guard_write(_company);
  if _dep is null or not exists (select 1 from public.contacts c where c.id = _dep and c.company_id = _company) then
    raise exception 'Choisissez le deposant (fiche client de la societe).' using errcode = '23514';
  end if;
  if _sale <= 0 then raise exception 'Indiquez le prix de vente TTC.' using errcode = '23514'; end if;

  -- La moto : fiche existante (choisie, ou retrouvee par son VIN), sinon creee.
  _veh := nullif(_data->>'vehicle_id', '')::uuid;
  if _veh is null and _vin <> '' then
    select x.id into _veh from public.vehicles x where x.company_id = _company and upper(x.vin) = _vin limit 1;
  end if;
  if _veh is null then
    if _vin = '' then raise exception 'Indiquez le VIN (n° de chassis) de la moto.' using errcode = '23514'; end if;
    insert into public.vehicles (company_id, vin, brand, model, model_year, plate, mileage, color,
                                 first_registration_date, status, display_price, created_by)
    values (_company, _vin, nullif(_data#>>'{vehicle,brand}', ''), nullif(_data#>>'{vehicle,model}', ''),
            nullif(_data#>>'{vehicle,model_year}', '')::int, nullif(upper(_data#>>'{vehicle,plate}'), ''),
            nullif(_data#>>'{vehicle,mileage}', '')::int, nullif(_data#>>'{vehicle,color}', ''),
            nullif(_data#>>'{vehicle,first_registration_date}', '')::date, 'depot_vente', _sale, auth.uid())
    returning id into _veh;
  end if;
  select * into v from public.vehicles where id = _veh for update;
  if v.id is null or v.company_id <> _company then raise exception 'Moto introuvable dans cette societe.' using errcode = 'P0002'; end if;
  if coalesce(nullif(regexp_replace(coalesce(v.vin, ''), '[^A-Za-z0-9]', '', 'g'), ''), '') = '' then
    raise exception 'La moto n a pas de VIN : completez sa fiche avant de la prendre en depot.' using errcode = '23514';
  end if;
  if public.vehicle_parc_kind(v.status) in ('en_stock', 'en_commande', 'reprise') then
    raise exception 'Cette moto appartient au stock de la concession (%) : elle ne peut pas etre prise en depot-vente.', v.status
      using errcode = '23514';
  end if;
  if exists (select 1 from public.consignments c where c.vehicle_id = _veh and c.status = 'en_depot') then
    raise exception 'Cette moto est deja en depot-vente.' using errcode = '23505';
  end if;

  _num := public._next_document_number_unchecked(_company, 'DEP');

  -- Fiche moto : statut depot-vente, prix affiche, reference = n° DEP si elle n'en a pas.
  update public.vehicles
     set status = 'depot_vente', display_price = _sale,
         reference = coalesce(nullif(btrim(reference), ''), _num),
         police_book_number = coalesce(_police, police_book_number),
         updated_at = now()
   where id = _veh;

  -- Proprietaire = deposant (B9) : il reste proprietaire jusqu'a la vente.
  if not exists (select 1 from public.vehicle_owners o where o.vehicle_id = _veh and o.contact_id = _dep and o.is_current) then
    update public.vehicle_owners set is_current = false, to_date = current_date where vehicle_id = _veh and is_current;
    insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current) values (_veh, _dep, current_date, true);
  end if;

  -- Article D (glossaire) : une moto d'une vente precedente garde un article O / P / V : il est
  -- detache (historique conserve) et un article D est cree. Entree en stock SANS valeur.
  select a.mgmt_type::text into _mgmt from public.articles a where a.id = v.article_id;
  if v.article_id is not null and _mgmt is distinct from 'D' then
    update public.vehicles set article_id = null where id = _veh;
  end if;
  _art := public.vehicle_ensure_article(_veh, 'D', null, true);
  select coalesce(s.real_qty, 0) into _real from public.article_stock(_art) s;
  if coalesce(_real, 0) <= 0 then
    perform public.record_stock_move(_art, 'entree'::public.stock_move_type, 1, null, false, null,
                                     'consignment', _num, 'Entree en depot-vente ' || _num || ' (sans valeur : la moto reste au deposant)');
  end if;

  insert into public.consignments (company_id, depositor_id, depositor_kind, article_id, vehicle_id, number,
         agreed_price, asked_price, min_price, commission_mode, commission_pct, commission_amount, deposit_fee,
         conditions, legal_mention, police_book_number, checklist, entry_date, notes, status, created_by)
  values (_company, _dep, _kind, _art, _veh, _num,
          _sale, public._consignment_num(_data->>'asked_price', 0), public._consignment_num(_data->>'min_price', 0),
          coalesce(nullif(_data->>'commission_mode', ''), public._consignment_setting(_company, 'commission_mode', 'ecart')),
          public._consignment_num(_data->>'commission_pct', public._consignment_num(public._consignment_setting(_company, 'commission_pct', '10'), 10)),
          case when coalesce(nullif(_data->>'commission_mode', ''), public._consignment_setting(_company, 'commission_mode', 'ecart')) = 'forfait'
               then public._consignment_num(_data->>'commission_amount', public._consignment_num(public._consignment_setting(_company, 'commission_fixed', '0'), 0)) end,
          public._consignment_num(_data->>'deposit_fee', public._consignment_num(public._consignment_setting(_company, 'deposit_fee', '0'), 0)),
          coalesce(nullif(_data->>'conditions', ''), public._consignment_setting(_company, 'conditions_' || _kind, null)),
          coalesce(nullif(_data->>'legal_mention', ''), public._consignment_setting(_company, 'legal_mention', null)),
          _police, coalesce(_data->'checklist', '{}'::jsonb),
          coalesce(nullif(_data->>'entry_date', '')::date, current_date), nullif(_data->>'notes', ''), 'en_depot', auth.uid())
  returning id into _id;

  -- VP4 (20/11/2026, comme G8) : cession ouverte d'office à l'entrée du dépôt. Les frais engagés
  -- sur la moto y sont notés ; payés par le déposant (déduits du reversement à la vente), jamais
  -- dans un coût de revient de la concession. Un échec n'empêche jamais l'entrée du dépôt (tracé).
  if public._consignment_truthy(public._consignment_setting(_company, 'auto_cession_on_entry', 'oui')) then
    begin
      insert into public.internal_cessions (company_id, cession_type, vehicle_id, contact_id, consignment_id, origin, work_description)
      values (_company, public._consignment_setting(_company, 'cession_type', '01'), _veh, _dep, _id, 'depot',
              'Frais sur la moto en dépôt-vente ' || _num || ' (à charge du déposant)');
    exception when others then
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
      values (_company, auth.uid(), 'cession_auto_echec', 'consignments', _id::text, 'system',
              jsonb_build_object('erreur', sqlerrm, 'number', _num));
    end;
  end if;

  -- N° livre de police : celui du registre des vehicules (inscription code 4 par son trigger) s'il existe.
  if _police is null and to_regclass('public.vehicle_register') is not null then
    execute 'select r.year::text || ''-'' || lpad(r.seq::text, 4, ''0'') from public.vehicle_register r
              where r.company_id = $1 and r.source = ''depot'' and r.source_id = $2 order by r.created_at desc limit 1'
      into _police using _company, _id;
    if _police is not null then
      update public.consignments set police_book_number = _police where id = _id;
      update public.vehicles set police_book_number = coalesce(police_book_number, _police) where id = _veh;
    end if;
  end if;

  perform public._consignment_event(_company, _id, 'consignment_create', null,
    jsonb_build_object('number', _num, 'vehicle_id', _veh, 'article_id', _art, 'depositor_id', _dep,
                       'agreed_price', _sale, 'asked_price', _data->>'asked_price', 'min_price', _data->>'min_price'));
  return _id;
end $function$;

CREATE OR REPLACE FUNCTION public.consignment_sell(_consignment uuid, _data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c public.consignments; v public.vehicles; a public.articles; dep_name text; m record;
  _buyer uuid := nullif(_data->>'buyer_id', '')::uuid;
  _sale numeric; _fees numeric; _repairs numeric; _rate numeric; _brate numeric;
  _want_buyer boolean; _want_comm boolean; _want_avo boolean; _receipt text;
  _sale_doc uuid; _sale_num text; _comm_doc uuid; _comm_num text; _avo_doc uuid; _avo_num text;
  _lines jsonb; _mention text; _label text; _rcpt uuid; _pay uuid;
begin
  select * into c from public.consignments where id = _consignment for update;
  if c.id is null then raise exception 'Depot-vente introuvable' using errcode = 'P0002'; end if;
  perform public._consignment_guard_write(c.company_id);
  if c.status <> 'en_depot' then
    raise exception 'Depot % deja % : il ne se vend plus (un second reglement est refuse).', c.number, c.status using errcode = '23514';
  end if;
  if _buyer is null or not exists (select 1 from public.contacts x where x.id = _buyer and x.company_id = c.company_id) then
    raise exception 'Choisissez l acquereur (fiche client de la societe).' using errcode = '23514';
  end if;
  if _buyer = c.depositor_id then raise exception 'L acquereur ne peut pas etre le deposant (utilisez le retour client).' using errcode = '23514'; end if;
  select * into v from public.vehicles where id = c.vehicle_id;
  select * into a from public.articles where id = c.article_id;
  if v.id is null or a.id is null then
    raise exception 'Depot % sans moto ni article D (ancien depot « simple ») : reprenez-le par une nouvelle fiche avec la moto.', c.number
      using errcode = '23514';
  end if;

  _sale := public._consignment_num(_data->>'sale_price', c.agreed_price);
  _fees := public._consignment_num(_data->>'fees', c.deposit_fee);
  -- VP4 : sans montant donné par l'écran, les frais de la cession du dépôt (à charge du déposant).
  _repairs := case when _data ? 'repairs' then public._consignment_num(_data->>'repairs', 0)
                   else coalesce((public.consignment_depot_costs(c.id)->>'amount_ttc')::numeric, 0) end;
  if _sale <= 0 then raise exception 'Prix de vente TTC obligatoire.' using errcode = '23514'; end if;
  if c.min_price > 0 and _sale < c.min_price and not coalesce((_data->>'force_below_min')::boolean, false) then
    raise exception 'Prix de vente % EUR sous le prix minimum de reserve % EUR : confirmez l accord du deposant.', _sale, c.min_price
      using errcode = '23514';
  end if;
  _rate := public._consignment_num(public._consignment_setting(c.company_id, 'commission_vat_rate', '21'), 21);
  select * into m from public.consignment_amounts(_sale, c.asked_price, c.commission_mode, c.commission_pct,
                                                  c.commission_amount, _fees, _repairs, _rate);
  if m.net < 0 then
    raise exception 'Commission, frais et reparations (% EUR) depassent le prix de vente (% EUR) : decompte negatif.', m.invoice_ttc, _sale
      using errcode = '23514';
  end if;

  _want_buyer := coalesce((_data->>'buyer_invoice')::boolean, public._consignment_truthy(public._consignment_setting(c.company_id, 'buyer_invoice', 'oui')));
  _want_comm := coalesce((_data->>'commission_invoice')::boolean, public._consignment_truthy(public._consignment_setting(c.company_id, 'commission_invoice', 'oui')));
  _want_avo := coalesce((_data->>'credit_note')::boolean, public._consignment_truthy(public._consignment_setting(c.company_id, 'auto_credit_note', 'non')));
  _receipt := nullif(trim(coalesce(_data->>'receipt_method', '')), '');
  _label := concat_ws(' ', v.brand, v.model) || ' — ' || coalesce(v.vin, '');
  select coalesce(nullif(btrim(x.company_name), ''), nullif(btrim(concat_ws(' ', x.first_name, x.last_name)), ''), '—')
    into dep_name from public.contacts x where x.id = c.depositor_id;

  -- (1) Facture a l'acheteur : la moto D, au taux du reglage (particulier / professionnel), mention.
  if _want_buyer then
    _brate := public._consignment_num(public._consignment_setting(c.company_id, 'buyer_vat_rate_' || c.depositor_kind,
                                       case when c.depositor_kind = 'professionnel' then '21' else '0' end), 0);
    _mention := replace(coalesce(public._consignment_setting(c.company_id, 'buyer_mention_' || c.depositor_kind, null), ''), '{numero}', c.number);
    select d.id, d.number into _sale_doc, _sale_num
      from public._consignment_make_document(c.company_id, 'FAC', _buyer, v.id,
             jsonb_build_array(public._consignment_line(a.id, 'Depot-vente ' || c.number || ' : ' || _label, a.reference, 1, _sale, _brate)),
             nullif(_mention, '')) d;
    -- Sortie du stock reel : le trigger passe la moto en « Vendu », l'acheteur devient proprietaire.
    perform public.record_stock_move(a.id, 'sortie'::public.stock_move_type, -1, null, false, null, 'sale', _sale_num,
                                     'Vente du depot-vente ' || c.number);
  else
    -- Parcours G8 sans facture : sortie de stock + acheteur proprietaire + encaissement 02.
    perform public.record_stock_move(a.id, 'sortie'::public.stock_move_type, -1, null, false, null, 'sale', c.number,
                                     'Vente du depot-vente ' || c.number || ' (sans facture acheteur)');
    update public.vehicle_owners set is_current = false, to_date = current_date
     where vehicle_id = v.id and is_current and contact_id is distinct from _buyer;
    insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current)
    select v.id, _buyer, current_date, true
     where not exists (select 1 from public.vehicle_owners o where o.vehicle_id = v.id and o.contact_id = _buyer and o.is_current);
    if _receipt is not null then
      _rcpt := public._consignment_cash_movement(c.company_id, 'in', _sale, _receipt,
                 'DEPOT VENTE ' || c.number || ' : encaissement', '02');
    end if;
  end if;

  -- (2) Facture au deposant : commission (+ frais, reparations), TVA comprise.
  if _want_comm and m.invoice_ttc > 0 then
    _lines := '[]'::jsonb;
    if m.commission_ttc > 0 then
      _lines := _lines || jsonb_build_array(public._consignment_line(null,
        'Commission sur la vente du depot-vente ' || c.number || ' (' || _label || ', vendu ' || to_char(_sale, 'FM999G999G990D00') || ' EUR TTC)',
        null, 1, m.commission_ttc, _rate));
    end if;
    if m.fees_ttc > 0 then
      _lines := _lines || jsonb_build_array(public._consignment_line(null, 'Frais de depot-vente ' || c.number, null, 1, m.fees_ttc, _rate));
    end if;
    if m.repairs_ttc > 0 then
      _lines := _lines || jsonb_build_array(public._consignment_line(null, 'Reparations / remise en etat de la moto ' || c.number, null, 1, m.repairs_ttc, _rate));
    end if;
    select d.id, d.number into _comm_doc, _comm_num
      from public._consignment_make_document(c.company_id, 'FAC', c.depositor_id, v.id, _lines,
             'Facture au deposant, depot-vente ' || c.number || '. Montant retenu sur le prix de vente.') d;
    if public._consignment_truthy(public._consignment_setting(c.company_id, 'commission_compensation', 'oui')) then
      insert into public.document_payments (document_id, method, amount, status, note)
      values (_comm_doc, 'DEP', (select total_ttc from public.documents where id = _comm_doc), 'recu',
              'Retenu sur le prix de vente du depot-vente ' || c.number);
      perform public.recompute_document_paid(_comm_doc);
    end if;
  end if;

  -- (3) Avoir au nom du deposant (parametre G8) : la dette envers lui, a rembourser au versement.
  if _want_avo and m.net > 0 then
    select d.id, d.number into _avo_doc, _avo_num
      from public._consignment_make_document(c.company_id, 'AVO', c.depositor_id, v.id,
             jsonb_build_array(public._consignment_line(null,
               'Reversement depot-vente ' || c.number || ' : prix de vente ' || to_char(_sale, 'FM999G999G990D00')
               || ' EUR - commission, frais et reparations ' || to_char(m.invoice_ttc, 'FM999G999G990D00') || ' EUR',
               null, -1, m.net, 0)),
             'Avoir au nom du deposant ' || dep_name || ' (depot-vente ' || c.number || ').') d;
  end if;

  update public.consignments set
    status = 'vendu', buyer_id = _buyer, sold_at = now(), sold_price = _sale,
    sold_commission = m.commission_ttc, sold_commission_ht = m.commission_ht, sold_commission_vat = m.commission_vat,
    sold_fees = m.fees_ttc, sold_repairs = m.repairs_ttc, sold_vat_rate = _rate,
    sold_invoice_ht = m.invoice_ht, sold_invoice_vat = m.invoice_vat, sold_reversal = m.net,
    sale_document_id = _sale_doc, commission_document_id = _comm_doc, credit_note_document_id = _avo_doc,
    receipt_cash_movement_id = _rcpt,
    expected_delivery_date = nullif(_data->>'expected_delivery_date', '')::date
  where id = c.id;

  perform public._consignment_event(c.company_id, c.id, 'consignment_sell',
    jsonb_build_object('status', c.status),
    jsonb_build_object('status', 'vendu', 'buyer_id', _buyer, 'sale_price', _sale, 'commission_ttc', m.commission_ttc,
                       'fees', m.fees_ttc, 'repairs', m.repairs_ttc, 'depot_costs', public.consignment_depot_costs(c.id), 'net', m.net, 'sale_document', _sale_num,
                       'commission_document', _comm_num, 'credit_note', _avo_num,
                       'below_min', (c.min_price > 0 and _sale < c.min_price)));

  return jsonb_build_object('sale_document_id', _sale_doc, 'sale_number', _sale_num,
    'commission_document_id', _comm_doc, 'commission_number', _comm_num,
    'credit_note_id', _avo_doc, 'credit_note_number', _avo_num,
    'sale_price', _sale, 'commission_ttc', m.commission_ttc, 'commission_ht', m.commission_ht, 'commission_vat', m.commission_vat,
    'fees', m.fees_ttc, 'repairs', m.repairs_ttc, 'invoice_ttc', m.invoice_ttc, 'invoice_vat', m.invoice_vat, 'net', m.net);
end $function$;
