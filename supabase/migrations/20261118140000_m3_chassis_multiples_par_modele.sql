-- =====================================================================
-- Rattrapage G8 (18/11/2026, lot parc) — PRIORITE : plusieurs chassis du meme modele (moto neuve).
--
-- Constat (lecture du schema, comparaison-atelier-parc.md bloquant #3) :
--   l'index unique `uq_vehicles_article` (20260923150000) interdit a deux fiches moto de pointer
--   vers le meme article. Or la reception chassis (src/modules/purchases/write-api.ts) lie CHAQUE
--   chassis a l'article de la ligne, c'est-a-dire au modele (ex. DESERTX). Le 2e chassis du meme
--   modele etait donc refuse par la base APRES l'entree en stock (reception non atomique) :
--   stock du modele +1 sans fiche moto, reception interrompue.
--   Pire, le declencheur de synchronisation article <-> moto aurait detache le 1er chassis.
--
-- Logique G8 retenue (03-vehicules.md, parcours 14) : « produit fini » = MODELE (article de type V)
-- avec la LISTE DE SES CHASSIS (une fiche moto par moto physique) ; stock du modele = nombre de
-- chassis en stock (somme des mouvements : chaque chassis recu = une entree de 1, B4 / B7).
--
-- Ce que fait la migration (idempotente, non destructive : aucune ligne supprimee) :
--   1. remplace l'index unique par un controle : seul un article de type V (modele de moto neuve)
--      peut porter plusieurs chassis ; une occasion O / P, un depot D restent « un article = une moto » ;
--   2. synchronisation article <-> moto : un modele a plusieurs chassis n'a plus de « moto unique »
--      (articles.vehicle_id = null), et ne detache plus jamais un chassis ;
--   3. a la vente, la moto vendue est le chassis du document (documents.vehicle_id), sinon le plus
--      ancien chassis en stock ; le registre des vehicules utilise le meme chassis ;
--   4. vehicle_chassis_receive() : reception d'UN chassis en une transaction (fiche moto + entree
--      de stock de 1 au cout d'achat), utilisee par la reception (M4) et « Nouveau chassis » (M3) ;
--   5. controle de coherence : stock du modele = nombre de chassis en stock.
-- A appliquer APRES 20261103190000 (registre) si celle-ci est appliquee : la fonction
-- _vehicle_register_on_sale y est redefinie.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plusieurs chassis par modele : l'index unique devient un controle par type de gestion
-- ---------------------------------------------------------------------
drop index if exists public.uq_vehicles_article;
create index if not exists idx_vehicles_article on public.vehicles (article_id);

create or replace function public._vehicle_article_share_check()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a record;
begin
  if new.article_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.article_id is not distinct from new.article_id then return new; end if;
  if not exists (select 1 from public.vehicles w where w.article_id = new.article_id and w.id <> new.id) then
    return new;
  end if;
  select x.mgmt_type::text as mgmt, x.reference into a from public.articles x where x.id = new.article_id;
  if a.mgmt = 'V' then return new; end if;
  raise exception
    'L''article % (type %) represente deja une autre moto : seul un modele de moto neuve (type V) peut porter plusieurs chassis.',
    coalesce(a.reference, '?'), coalesce(a.mgmt, '?')
    using errcode = '23505';
end $$;

drop trigger if exists trg_vehicles_article_share_check on public.vehicles;
create trigger trg_vehicles_article_share_check
  before insert or update of article_id on public.vehicles
  for each row execute function public._vehicle_article_share_check();

-- ---------------------------------------------------------------------
-- 2. Synchronisation article <-> moto (remplace la version du 23/09)
-- ---------------------------------------------------------------------
-- articles.vehicle_id = « LA moto de cet article » : renseigne seulement quand l'article porte
-- une seule moto (occasion, depot, ou modele a un seul chassis). Un modele a plusieurs chassis
-- n'a pas de moto unique : vehicle_id = null. Les ecritures croisees se font sous un drapeau de
-- transaction pour que le declencheur d'en face ne defasse rien (jamais de boucle).
create or replace function public._sync_vehicle_article_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare only_one uuid; n int;
begin
  if coalesce(current_setting('dms.vehicle_link_sync', true), '') = 'on' then return new; end if;
  perform set_config('dms.vehicle_link_sync', 'on', true);
  begin
    if tg_table_name = 'vehicles' then
      -- ancien article quitte : il garde sa moto unique s'il lui en reste exactement une
      if tg_op = 'UPDATE' and old.article_id is not null and old.article_id is distinct from new.article_id then
        select count(*), (array_agg(w.id))[1] into n, only_one
          from public.vehicles w where w.article_id = old.article_id and w.id <> new.id;
        update public.articles set vehicle_id = case when n = 1 then only_one end
         where id = old.article_id and vehicle_id is distinct from (case when n = 1 then only_one end);
      end if;
      if new.article_id is not null then
        if exists (select 1 from public.vehicles w where w.article_id = new.article_id and w.id <> new.id) then
          -- plusieurs chassis du meme modele : pas de moto unique
          update public.articles set vehicle_id = null where id = new.article_id and vehicle_id is not null;
        else
          update public.articles set vehicle_id = new.id
           where id = new.article_id and vehicle_id is distinct from new.id;
        end if;
      end if;
    else
      if tg_op = 'UPDATE' and old.vehicle_id is not null and old.vehicle_id is distinct from new.vehicle_id
         and new.vehicle_id is not null then
        -- l'article est explicitement donne a une autre moto : l'ancienne est detachee
        update public.vehicles set article_id = null where id = old.vehicle_id and article_id = new.id;
      end if;
      if new.vehicle_id is not null then
        update public.vehicles set article_id = new.id
         where id = new.vehicle_id and article_id is distinct from new.id;
      end if;
    end if;
  exception when others then
    perform set_config('dms.vehicle_link_sync', '', true);
    raise;
  end;
  perform set_config('dms.vehicle_link_sync', '', true);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Quel chassis sort du stock a la vente ?
-- ---------------------------------------------------------------------
-- Un article = une moto : cette moto. Un modele a plusieurs chassis : la moto choisie sur le
-- document de vente (champ Vehicule, documents.vehicle_id) ; a defaut, le plus ancien chassis
-- encore en stock (premier entre, premier sorti) — trace dans events pour verification.
-- Le choix est memorise pour le mouvement (drapeau de transaction) : le registre des vehicules,
-- declenche juste apres sur le meme mouvement, retrouve le MEME chassis.
create or replace function public._moto_vehicle_for_move(_move_id bigint, _company uuid, _article uuid, _ref text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; vid uuid; dv uuid; memo text; how text := 'unique';
begin
  memo := nullif(current_setting('dms.moto_move_' || coalesce(_move_id, 0)::text, true), '');
  if memo is not null then return memo::uuid; end if;

  select count(*) into n from public.vehicles where article_id = _article and company_id = _company;
  if n = 0 then return null; end if;
  if n = 1 then
    select id into vid from public.vehicles where article_id = _article and company_id = _company;
  else
    select d.vehicle_id into dv from public.documents d
     where d.company_id = _company and d.number = _ref and d.vehicle_id is not null
     order by d.created_at desc limit 1;
    if dv is not null and exists (select 1 from public.vehicles w where w.id = dv and w.article_id = _article) then
      vid := dv; how := 'document';
    else
      select v.id into vid from public.vehicles v
       where v.article_id = _article and v.company_id = _company
         and public.vehicle_parc_kind(v.status) in ('en_stock', 'depot_vente')
       order by v.entry_date nulls last, v.created_at
       limit 1;
      how := 'plus_ancien_en_stock';
      if vid is not null then
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, auth.uid(), 'moto_chassis_choisi_auto', 'vehicles', vid::text, 'system', null,
                jsonb_build_object('article_id', _article, 'document', _ref, 'regle', how,
                                   'message', 'Aucune moto choisie sur le document : plus ancien chassis en stock.'));
      end if;
    end if;
  end if;
  if vid is not null and _move_id is not null then
    perform set_config('dms.moto_move_' || _move_id::text, vid::text, true);
  end if;
  return vid;
end $$;
revoke all on function public._moto_vehicle_for_move(bigint, uuid, uuid, text) from public, anon;

-- Vente : meme logique que le 23/09, le chassis vient de _moto_vehicle_for_move.
create or replace function public._moto_sortie_de_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.vehicles;
  vid uuid;
  doc record;
begin
  if new.is_reservation or new.move_type::text <> 'sortie' or new.qty_delta >= 0 then return new; end if;
  if coalesce(new.origin, '') not in ('sale', 'shopify', 'pos') then return new; end if;

  vid := public._moto_vehicle_for_move(new.id, new.company_id, new.article_id, new.ref);
  if vid is null then return new; end if;
  select * into v from public.vehicles where id = vid;
  if public.vehicle_parc_kind(v.status) = 'vendue' then return new; end if;

  select d.id, d.contact_id, d.issue_date, d.number into doc
    from public.documents d
   where d.company_id = new.company_id and d.number = new.ref
   order by d.created_at desc limit 1;

  update public.vehicles
     set status = 'vendu'::public.vehicle_status,
         sold_date = coalesce(doc.issue_date, current_date),
         display_price = null,
         updated_at = now()
   where id = v.id;

  if doc.contact_id is not null then
    update public.vehicle_owners
       set is_current = false, to_date = coalesce(doc.issue_date, current_date)
     where vehicle_id = v.id and is_current and contact_id is distinct from doc.contact_id;
    insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current)
    select v.id, doc.contact_id, coalesce(doc.issue_date, current_date), true
     where not exists (select 1 from public.vehicle_owners o
                        where o.vehicle_id = v.id and o.contact_id = doc.contact_id and o.is_current);
  end if;

  -- Retiree du site seulement quand il ne reste plus aucun chassis en stock sur l'article.
  if not exists (select 1 from public.vehicles w
                  where w.article_id = new.article_id and w.id <> v.id
                    and public.vehicle_parc_kind(w.status) in ('en_stock', 'depot_vente')) then
    update public.articles set publishable = false, updated_at = now()
     where id = new.article_id and publishable;
  end if;
  begin
    perform public._shopify_enqueue(new.company_id, new.article_id, 'moto_vendue');
  exception when undefined_function then null;
  end;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (new.company_id, new.operator_id, 'moto_vendue', 'vehicles', v.id::text, coalesce(new.origin, 'system'),
          jsonb_build_object('status', v.status::text, 'display_price', v.display_price),
          jsonb_build_object('status', 'vendu', 'document', doc.number, 'contact_id', doc.contact_id,
                             'article_id', new.article_id));
  return new;
end $$;

-- Registre des vehicules (20261103190000) : la sortie vise le meme chassis que la vente.
-- Sans la table du registre (migration non appliquee), la fonction n'est appelee par personne.
create or replace function public._vehicle_register_on_sale()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare vid uuid; doc record; line uuid;
begin
  if new.is_reservation or new.move_type::text <> 'sortie' or new.qty_delta >= 0 then return new; end if;
  if coalesce(new.origin, '') not in ('sale', 'shopify', 'pos') then return new; end if;
  vid := public._moto_vehicle_for_move(new.id, new.company_id, new.article_id, new.ref);
  if vid is null then return new; end if;
  select r.id into line from public.vehicle_register r
   where r.company_id = new.company_id and r.vehicle_id = vid and r.source in ('reprise', 'reception', 'depot', 'manuel')
     and r.left_at is null and r.rectified_by_id is null and not r.is_void
   order by r.entered_at desc, r.created_at desc limit 1;
  if line is null then return new; end if;
  select d.id, d.number, d.issue_date into doc from public.documents d
   where d.company_id = new.company_id and d.number = new.ref order by d.created_at desc limit 1;
  perform public._vehicle_register_exit_line(line, coalesce(doc.issue_date, new.occurred_at::date, current_date), doc.id, doc.number,
                                             case when doc.id is null then 'Vente ' || coalesce(new.ref, '') || ' : document a inscrire' end,
                                             new.operator_id, coalesce(new.origin, 'system'));
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. Reception d'un chassis en une transaction (M4 reception, M3 « Nouveau chassis »)
-- ---------------------------------------------------------------------
/**
 * Cree la fiche moto d'un chassis rattachee au MODELE (article V) et l'entree de stock de 1,
 * valorisee au cout d'achat (PAMP recalcule, B5), en une seule transaction : plus de stock sans
 * fiche ni de fiche sans stock. Refuse un VIN deja present dans la societe (B9).
 *  _chassis : { vin (obligatoire), brand, model, engine_number, color, model_year, power_cv,
 *               is_restricted, energy, antipollution, first_registration_date, mileage,
 *               gps_tracker_id, pin_tracker, tpms_av, tpms_ar, warranty_end, key_number,
 *               police_book_number, exposition_code, display_price }
 *  _origin  : 'reception' (M4) ou 'chassis_manuel' (fiche du modele).
 * Retourne l'id de la fiche moto.
 */
create or replace function public.vehicle_chassis_receive(
  _article uuid, _chassis jsonb, _unit_cost numeric default null,
  _origin text default 'chassis_manuel', _ref text default null, _bin text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.articles;
  c record;
  vin text;
  vid uuid;
  cost numeric;
begin
  select * into a from public.articles where id = _article;
  if a.id is null then raise exception 'Modele introuvable' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.is_member(a.company_id) then
    raise exception 'Acces refuse' using errcode = '42501';
  end if;
  if a.mgmt_type::text <> 'V' then
    raise exception 'Le modele % doit etre un article de type V (produit fini) pour recevoir des chassis (type actuel : %).',
      a.reference, a.mgmt_type using errcode = '22023';
  end if;

  select * into c from jsonb_to_record(coalesce(_chassis, '{}'::jsonb)) as x(
    vin text, brand text, model text, engine_number text, color text, model_year int, power_cv numeric,
    is_restricted boolean, energy text, antipollution text, first_registration_date date, mileage int,
    gps_tracker_id text, pin_tracker text, tpms_av text, tpms_ar text, warranty_end date, key_number text,
    police_book_number text, exposition_code text, display_price numeric);

  vin := nullif(upper(regexp_replace(coalesce(c.vin, ''), '[^A-Za-z0-9]', '', 'g')), '');
  if vin is null then
    raise exception 'Numero de chassis (VIN) obligatoire.' using errcode = '23502';
  end if;
  if exists (select 1 from public.vehicles w
              where w.company_id = a.company_id
                and upper(regexp_replace(coalesce(w.vin, ''), '[^A-Za-z0-9]', '', 'g')) = vin) then
    raise exception 'VIN_EXISTS: le chassis % existe deja dans le parc.', vin using errcode = '23505';
  end if;

  cost := coalesce(_unit_cost, a.purchase_price, 0);

  insert into public.vehicles (
    company_id, article_id, vin, reference, brand, model, engine_number, color, model_year, power_cv,
    is_restricted, energy, antipollution, first_registration_date, mileage, gps_tracker_id, pin_tracker,
    tpms_av, tpms_ar, warranty_end, key_number, police_book_number, exposition_code,
    purchase_price, cost_price, display_price, status, entry_date, created_by)
  values (
    a.company_id, a.id, vin, a.reference, coalesce(nullif(btrim(c.brand), ''), a.brand),
    coalesce(nullif(btrim(c.model), ''), a.designation), nullif(btrim(c.engine_number), ''),
    nullif(btrim(c.color), ''), c.model_year, c.power_cv, coalesce(c.is_restricted, false),
    nullif(btrim(c.energy), ''), nullif(btrim(c.antipollution), ''), c.first_registration_date, c.mileage,
    nullif(btrim(c.gps_tracker_id), ''), nullif(btrim(c.pin_tracker), ''), nullif(btrim(c.tpms_av), ''),
    nullif(btrim(c.tpms_ar), ''), c.warranty_end, nullif(btrim(c.key_number), ''),
    nullif(btrim(c.police_book_number), ''), nullif(btrim(c.exposition_code), ''),
    cost, cost, coalesce(c.display_price, nullif(a.sale_price_ttc, 0)), 'stock_vn', current_date, auth.uid())
  returning id into vid;

  perform public.record_stock_move(
    a.id, 'entree'::public.stock_move_type, 1, cost, false, _bin,
    coalesce(nullif(btrim(_origin), ''), 'chassis_manuel'), coalesce(_ref, vin), 'Chassis ' || vin);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (a.company_id, auth.uid(), 'chassis_recu', 'vehicles', vid::text,
          case when _origin = 'reception' then 'reception' else 'screen' end, null,
          jsonb_build_object('article_id', a.id, 'modele', a.reference, 'vin', vin, 'unit_cost', cost, 'ref', _ref));
  return vid;
end $$;
revoke all on function public.vehicle_chassis_receive(uuid, jsonb, numeric, text, text, text) from public, anon;
grant execute on function public.vehicle_chassis_receive(uuid, jsonb, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Controle de coherence (remplace la version du 23/09)
-- ---------------------------------------------------------------------
create or replace function public.vehicles_parc_check(_company uuid)
returns table (anomalie text, vehicle_id uuid, vin text, model text, statut text, detail text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  with per_article as (
    select v.article_id, count(*) as n_chassis,
           count(*) filter (where public.vehicle_needs_article(v.status)) as n_en_stock
      from public.vehicles v
     where v.company_id = _company and v.article_id is not null
     group by v.article_id
  )
  -- a) moto vendable sans article
  select 'moto_vendable_sans_article', v.id, v.vin, v.model, v.status::text,
         'Moto « ' || public.vehicle_parc_kind(v.status) || ' » sans article : elle ne peut pas être vendue ni publiée.'
    from public.vehicles v
   where v.company_id = _company and v.article_id is null and public.vehicle_needs_article(v.status)
  union all
  -- b) moto vendue encore publiée (article d'une seule moto)
  select 'moto_vendue_encore_publiee', v.id, v.vin, v.model, v.status::text,
         'Moto vendue dont l''article est encore « publiable » (référence ' || a.reference || ').'
    from public.vehicles v join public.articles a on a.id = v.article_id
    join per_article p on p.article_id = v.article_id and p.n_chassis = 1
   where v.company_id = _company and public.vehicle_parc_kind(v.status) = 'vendue' and a.publishable
  union all
  -- c) article d'une seule moto : stock = 1 tant qu'elle est en stock (B4, B7)
  select case when s.real_qty < 0 then 'stock_negatif' else 'stock_different_de_1' end,
         v.id, v.vin, v.model, v.status::text,
         'Stock réel de l''article ' || a.reference || ' = ' || s.real_qty::text || ' (attendu 1).'
    from public.vehicles v
    join public.articles a on a.id = v.article_id
    join per_article p on p.article_id = v.article_id and p.n_chassis = 1
   cross join lateral public.article_stock(a.id) s
   where v.company_id = _company and public.vehicle_needs_article(v.status) and coalesce(s.real_qty, 0) <> 1
  union all
  -- d) moto vendue avec du stock restant (article d'une seule moto)
  select 'moto_vendue_avec_stock', v.id, v.vin, v.model, v.status::text,
         'Moto vendue dont l''article ' || a.reference || ' a encore ' || s.real_qty::text || ' en stock.'
    from public.vehicles v
    join public.articles a on a.id = v.article_id
    join per_article p on p.article_id = v.article_id and p.n_chassis = 1
   cross join lateral public.article_stock(a.id) s
   where v.company_id = _company and public.vehicle_parc_kind(v.status) = 'vendue' and coalesce(s.real_qty, 0) > 0
  union all
  -- e) article de moto dont le type de gestion ne correspond plus au statut de parc
  select 'type_de_gestion_incoherent', v.id, v.vin, v.model, v.status::text,
         'Article ' || a.reference || ' de type ' || a.mgmt_type::text || ' pour une moto « ' ||
         public.vehicle_parc_kind(v.status) || ' ».'
    from public.vehicles v join public.articles a on a.id = v.article_id
   where v.company_id = _company
     and ((public.vehicle_parc_kind(v.status) = 'depot_vente' and a.mgmt_type::text <> 'D')
       or (public.vehicle_parc_kind(v.status) <> 'depot_vente' and a.mgmt_type::text = 'D'))
  union all
  -- f) modele a plusieurs chassis : stock du modele = nombre de chassis en stock (logique G8)
  select 'stock_modele_different_des_chassis', null::uuid, null::text, a.designation, null::text,
         'Modèle ' || a.reference || ' : stock réel ' || coalesce(s.real_qty, 0)::text || ', chassis en stock '
         || p.n_en_stock::text || ' (sur ' || p.n_chassis::text || ' chassis).'
    from per_article p
    join public.articles a on a.id = p.article_id
   cross join lateral public.article_stock(a.id) s
   where p.n_chassis > 1 and coalesce(s.real_qty, 0) <> p.n_en_stock
  limit 2000;
end $$;
revoke all on function public.vehicles_parc_check(uuid) from public, anon;
grant execute on function public.vehicles_parc_check(uuid) to authenticated;

comment on function public.vehicle_chassis_receive(uuid, jsonb, numeric, text, text, text) is
  'Rattrapage G8 (18/11/2026) : un chassis = une fiche moto rattachee au modele (article V) + entree de stock de 1, en une transaction.';
