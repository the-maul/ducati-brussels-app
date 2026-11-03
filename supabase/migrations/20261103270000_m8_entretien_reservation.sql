-- =====================================================================
-- Mission 10 - cartes 1 et 6, debut de la carte 7 (03/11/2026, ATE015)
-- « L'entretien choisi suit la moto de l'OR, ses pieces sont reservees des le
--   rendez-vous et le manque part en commande. »
--
-- Decisions de Simon (03/11/2026) :
--   M-109 les entretiens sont ceux du manuel Ducati, avec les mots de l'atelier :
--         « Entretien annuel » = Annual Service (code `annual`),
--         « Entretien annuel + huile » = Oil Service (code `oil`),
--         « 1er entretien 1 000 km » (code `first_1000`). Les motifs « 15 000 km »
--         et « 30 000 km » (posters) sont retires de la liste (gardes inactifs pour
--         les anciens OR). « Entretien annuel + huile » = kit Annual Service + kit
--         Oil Service, une piece une seule fois (la plus grande quantite) : quand le
--         manuel met deja la vidange dans l'Annual Service, les deux motifs donnent
--         le meme kit (pas de double huile).
--   M-110 l'entretien choisi est UNE donnee de l'OR et du RDV : `service_code`
--         (annual / oil / first_1000 / desmo). Il vient du motif (Parametres ->
--         Tables -> Motifs d'entree, colonne « Entretien ») et pilote le kit, le
--         check-up, la picking list, le parcours technicien, la commande depuis
--         l'OR et le prochain entretien.
--   M-111 les pieces du kit de LA moto pour CET entretien sont RESERVEES des que le
--         RDV est pris (planning, telephone, comptoir ou espace client) : table
--         `stock_reservations` (etat) + mouvements append-only `reservation` /
--         `liberation` (origine `atelier`, ref = RDV ou n° d'OR) dans stock_moves
--         (B7). Disponible = reel - reserve (+ en commande, B4).
--         Ce qui manque part au panier Ducati (basket_add_lines, origine atelier,
--         client en colonne G) : urgente si le RDV est a moins de N jours (reglage
--         des commandes, 5 par defaut), standard sinon ; le panier reste a valider
--         par l'atelier (rien n'est envoye seul).
--   M-112 si la reservation fait passer une piece sous son minimum, la piece entre
--         tout de suite dans le panier standard ouvert, origine `minimax`, sans
--         attendre la nuit. Le minimax compte desormais les reservations :
--         stock du minimax = reel - reserve - manque des RDV (le manque est compte
--         une fois en besoin, une fois en commande : il s'annule).
--   M-113 cycle de vie : RDV annule (ou supprime) -> reservation liberee ; RDV
--         deplace -> reservation deplacee (date suivie, aucun mouvement) ; OR ouvert
--         depuis le RDV -> la reservation suit l'OR ; facture de l'OR -> la
--         reservation est liberee dans la meme transaction que la mise a jour de
--         l'OR et la FACTURE fait la seule sortie du stock reel (statut
--         « consommee » ; une piece reservee absente de la facture est liberee).
--         Une arrivee en stock (entree) re-reserve ce qui manquait.
--   Le comptoir est averti quand il vend une piece reservee pour un RDV
--   (article_reservations, ecran).
--
-- Suppose appliquees : 20261103150000 ... 20261103260000 (dont 200000 kits :
-- maintenance_service_kind_of, maintenance_kits.service_kind / source / service_km).
-- Additif, rejouable. Fonctions redefinies (meme signature) : _basket_fill_minimax,
-- _repair_order_service, picking_open_for_repair_order, repair_order_order_needs,
-- _vehicle_maintenance_recompute_core, portal_request_appointment (+ 1 parametre
-- optionnel, appel a 4 parametres inchange).
-- Regles pures miroir testees : src/modules/workshop/service-code.ts,
-- src/modules/workshop/reservations/rules.ts (tests/atelier-reservation.test.ts).
-- Essai a blanc : supabase/tests/m8_entretien_reservation.sql.
-- =====================================================================

do $$ begin
  if to_regprocedure('public.maintenance_service_kind_of(text)') is null then
    raise exception 'Appliquer d''abord 20261103200000_m8_kits_generation.sql (types d''entretien des kits).';
  end if;
  if to_regprocedure('public._basket_add_lines(uuid, jsonb, boolean)') is null then
    raise exception 'Appliquer d''abord 20261103100000_m4_paniers_de_commande.sql (paniers).';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. L'entretien choisi : colonne `service_code` sur l'OR et le RDV (M-110)
-- ---------------------------------------------------------------------
alter table public.repair_orders add column if not exists service_code text;
alter table public.workshop_appointments add column if not exists service_code text;
alter table public.repair_orders drop constraint if exists repair_orders_service_code_check;
alter table public.repair_orders add constraint repair_orders_service_code_check
  check (service_code is null or service_code in ('annual', 'oil', 'first_1000', 'desmo'));
alter table public.workshop_appointments drop constraint if exists workshop_appointments_service_code_check;
alter table public.workshop_appointments add constraint workshop_appointments_service_code_check
  check (service_code is null or service_code in ('annual', 'oil', 'first_1000', 'desmo'));
comment on column public.repair_orders.service_code is
  'Mission 10 carte 1 (M-110) : l''entretien choisi = l''echeance du manuel Ducati (annual = Annual Service / Entretien annuel, '
  'oil = Oil Service / Entretien annuel + huile, first_1000 = 1er entretien 1 000 km, desmo). Pose par le motif ; pilote kit, '
  'check-up, picking list, parcours, commande et prochain entretien.';
comment on column public.workshop_appointments.service_code is
  'Mission 10 (M-110) : l''entretien choisi du RDV (meme codes que repair_orders.service_code). Declenche la reservation des pieces du kit (M-111).';

-- Libelle de l'atelier (donnees en FR).
create or replace function public.workshop_service_label(_code text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case _code
    when 'annual'     then 'Entretien annuel (Annual Service)'
    when 'oil'        then 'Entretien annuel + huile (Oil Service)'
    when 'first_1000' then '1er entretien 1 000 km'
    when 'desmo'      then 'Desmo Service'
    else null end;
$$;
grant execute on function public.workshop_service_label(text) to authenticated, service_role;

-- Les kits a reunir pour un entretien (M-109) : annuel + huile = Annual Service + Oil Service.
create or replace function public.workshop_service_kit_codes(_code text)
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select case _code
    when 'annual'     then array['annual']
    when 'oil'        then array['annual', 'oil']
    when 'first_1000' then array['first_1000']
    when 'desmo'      then array['desmo']
    else array[]::text[] end;
$$;
grant execute on function public.workshop_service_kit_codes(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Motifs d'entree (Parametres -> Tables) : la liste de l'atelier (M-109)
--    extra.service_code = l'entretien que donne le motif (reglable sans migration).
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'workshop_reason', 'entretien_annuel_huile', 'Entretien annuel + huile', 15, '{"service_code": "oil"}'::jsonb
  from public.companies c
on conflict (company_id, table_key, code) do nothing;

update public.reference_values
   set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('service_code', 'annual')
 where table_key = 'workshop_reason' and code = 'entretien_annuel' and coalesce(extra ->> 'service_code', '') = '';
update public.reference_values
   set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('service_code', 'oil')
 where table_key = 'workshop_reason' and code = 'entretien_annuel_huile' and coalesce(extra ->> 'service_code', '') = '';
update public.reference_values
   set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('service_code', 'first_1000'),
       label = case when label = 'Entretien 1 000 km' then '1er entretien 1 000 km' else label end
 where table_key = 'workshop_reason' and code = 'entretien_1000';
-- Retires de la liste, gardes pour les anciens OR (15 000 km = Oil Service, 30 000 km = Desmo).
update public.reference_values
   set is_active = false,
       extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('service_code', case code when 'entretien_15000' then 'oil' else 'desmo' end)
 where table_key = 'workshop_reason' and code in ('entretien_15000', 'entretien_30000');

-- Motif -> entretien (reglage du motif, sinon la regle d'origine).
create or replace function public.workshop_service_for_reason(_company uuid, _reason text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select x.code from (
    select coalesce(
      (select nullif(btrim(rv.extra ->> 'service_code'), '') from public.reference_values rv
        where rv.company_id = _company and rv.table_key = 'workshop_reason' and rv.code = _reason limit 1),
      case _reason
        when 'entretien_annuel'       then 'annual'
        when 'entretien_annuel_huile' then 'oil'
        when 'entretien_1000'         then 'first_1000'
        when 'entretien_15000'        then 'oil'
        when 'entretien_30000'        then 'desmo'
        else null end) as code) x
   where x.code in ('annual', 'oil', 'first_1000', 'desmo');
$$;
revoke all on function public.workshop_service_for_reason(uuid, text) from public, anon;
grant execute on function public.workshop_service_for_reason(uuid, text) to authenticated, service_role;

-- Le motif pose l'entretien (a la creation, puis a chaque changement de motif), sauf choix explicite.
create or replace function public._trg_workshop_service_code()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _plan text;
begin
  if tg_op = 'INSERT' then
    if new.service_code is null then
      new.service_code := public.workshop_service_for_reason(new.company_id, new.reason_code);
      if new.service_code is null and tg_table_name = 'workshop_appointments' then
        -- RDV d'entretien cree depuis la fiche moto (maintenance_appointment_create) : code du plan.
        _plan := to_jsonb(new) ->> 'maintenance_service_code';
        new.service_code := (select k from (select public.maintenance_service_kind_of(_plan) as k) x
                              where x.k in ('annual', 'oil', 'first_1000', 'desmo'));
      end if;
    end if;
  elsif new.reason_code is distinct from old.reason_code and new.service_code is not distinct from old.service_code then
    new.service_code := public.workshop_service_for_reason(new.company_id, new.reason_code);
  end if;
  return new;
end $$;
revoke all on function public._trg_workshop_service_code() from public, anon, authenticated;

drop trigger if exists trg_repair_orders_service_code on public.repair_orders;
create trigger trg_repair_orders_service_code before insert or update of reason_code, service_code on public.repair_orders
  for each row execute function public._trg_workshop_service_code();
drop trigger if exists trg_appointments_service_code on public.workshop_appointments;
create trigger trg_appointments_service_code before insert or update of reason_code, service_code on public.workshop_appointments
  for each row execute function public._trg_workshop_service_code();

-- Reprise de l'existant (avant les declencheurs de reservation : aucun mouvement ici).
update public.repair_orders r set service_code = public.workshop_service_for_reason(r.company_id, r.reason_code)
 where r.service_code is null and r.reason_code is not null
   and public.workshop_service_for_reason(r.company_id, r.reason_code) is not null;
update public.workshop_appointments a
   set service_code = coalesce(public.workshop_service_for_reason(a.company_id, a.reason_code),
                               (select k from (select public.maintenance_service_kind_of(a.maintenance_service_code) as k) x
                                 where x.k in ('annual', 'oil', 'first_1000', 'desmo')))
 where a.service_code is null and (a.reason_code is not null or a.maintenance_service_code is not null);

-- ---------------------------------------------------------------------
-- 3. Le kit d'un entretien pour un modele-annee (M-109)
-- ---------------------------------------------------------------------
-- Le kit actif d'un TYPE d'entretien (sans controle de membre : fonctions internes et declencheurs,
-- y compris un RDV pris par le client depuis son espace).
create or replace function public._workshop_kit_for(_company uuid, _model_year text, _kind text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select k.id
    from public.maintenance_kits k
    join public.maintenance_kit_model_years y on y.kit_id = k.id
   where k.company_id = _company and y.model_year_id = _model_year and k.status = 'actif'
     and coalesce(k.service_kind, public.maintenance_service_kind_of(k.service_code)) = _kind
   order by (k.service_code = _kind) desc,
            case k.source when 'manuel' then 1 when 'plan' then 2 else 3 end,
            k.service_km nulls last, k.edited_at desc nulls last, k.version desc
   limit 1;
$$;
revoke all on function public._workshop_kit_for(uuid, text, text) from public, anon, authenticated;

-- Pieces de l'entretien : les kits reunis (annuel + huile = Annual + Oil), une piece une seule fois
-- (cle : article, sinon reference, sinon famille de consommable, sinon designation ; la plus grande
-- quantite gagne). Un consommable sans article prend l'article designe par l'atelier (maintenance_fluid_articles).
create or replace function public._workshop_service_kit_items(_company uuid, _model_year text, _service text)
returns table(kit_item_id uuid, kit_id uuid, service_kind text, family_code text, article_id uuid,
              reference text, designation text, quantity numeric, unit text, kind text, confidence text, sort_order integer)
language sql stable security definer set search_path = public, pg_temp as $$
  with kits as (
    select c.code, c.ord, public._workshop_kit_for(_company, _model_year, c.code) as kid
      from unnest(public.workshop_service_kit_codes(_service)) with ordinality as c(code, ord)
     where _company is not null and _model_year is not null
  ), items as (
    select i.id as iid, k.kid, k.code, k.ord, i.family_code,
           coalesce(i.article_id, fa.article_id) as aid,
           coalesce(nullif(btrim(i.reference), ''), a.reference) as ref,
           i.designation, i.quantity, i.unit, i.kind, i.confidence, i.sort_order,
           coalesce(coalesce(i.article_id, fa.article_id)::text,
                    nullif(upper(btrim(coalesce(i.reference, ''))), ''),
                    'fam:' || i.family_code,
                    'des:' || lower(btrim(i.designation))) as dkey
      from kits k
      join public.maintenance_kit_items i on i.kit_id = k.kid
      left join public.maintenance_fluid_articles fa
             on i.article_id is null and fa.company_id = _company and fa.family_code = i.family_code
      left join public.articles a on a.id = coalesce(i.article_id, fa.article_id)
     where k.kid is not null
  )
  select distinct on (items.dkey)
         items.iid, items.kid, items.code, items.family_code, items.aid, items.ref, items.designation,
         items.quantity, items.unit, items.kind, items.confidence, items.sort_order
    from items
   order by items.dkey, items.quantity desc, items.ord;
$$;
revoke all on function public._workshop_service_kit_items(uuid, text, text) from public, anon, authenticated;

-- Pour l'ecran (popup, check-up) : les pieces de l'entretien de LA moto, avec stock et prix.
create or replace function public.workshop_service_kit(_vehicle uuid, _service text)
returns table(kit_item_id uuid, kit_id uuid, service_kind text, article_id uuid, reference text, designation text,
              quantity numeric, unit text, kind text, confidence text, real_qty numeric, reserved_qty numeric,
              on_order_qty numeric, sale_price_ht numeric, sale_price_ttc numeric, vat_rate numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.vehicles%rowtype;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select k.kit_item_id, k.kit_id, k.service_kind, k.article_id, k.reference, k.designation, k.quantity, k.unit,
         k.kind, k.confidence, coalesce(st.real_qty, 0), coalesce(st.reserved_qty, 0),
         case when a.id is null then 0 else public.article_on_order_for(a.id, null, null) end,
         a.sale_price_ht, a.sale_price_ttc, a.vat_rate
    from public._workshop_service_kit_items(v.company_id, v.ducati_model_year_id, _service) k
    left join public.articles a on a.id = k.article_id
    left join lateral public.article_stock(k.article_id) st on a.id is not null
   order by k.sort_order, k.designation;
end $$;
revoke all on function public.workshop_service_kit(uuid, text) from public, anon;
grant execute on function public.workshop_service_kit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Reservations de stock de l'atelier (M-111) : l'etat, le stock est dans stock_moves
-- ---------------------------------------------------------------------
create table if not exists public.stock_reservations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  article_id       uuid not null references public.articles(id) on delete restrict,
  appointment_id   uuid references public.workshop_appointments(id) on delete set null,
  repair_order_id  uuid references public.repair_orders(id) on delete set null,
  contact_id       uuid references public.contacts(id) on delete set null,
  vehicle_id       uuid references public.vehicles(id) on delete set null,
  service_code     text,
  kit_item_id      uuid references public.maintenance_kit_items(id) on delete set null,
  reference        text,
  designation      text not null default '',
  qty_needed       numeric(14,3) not null default 0 check (qty_needed >= 0),
  qty_reserved     numeric(14,3) not null default 0 check (qty_reserved >= 0),  -- = somme de ses mouvements
  qty_to_order     numeric(14,3) not null default 0 check (qty_to_order >= 0),  -- mis au panier
  qty_consumed     numeric(14,3) not null default 0 check (qty_consumed >= 0),  -- sorti par la facture de l'OR
  basket_kind      text check (basket_kind is null or basket_kind in ('standard', 'urgente')),
  due_at           timestamptz,
  status           text not null default 'active' check (status in ('active', 'liberee', 'consommee')),
  release_reason   text,
  origin           text not null default 'atelier',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  released_at      timestamptz
);
comment on table public.stock_reservations is
  'Mission 10 carte 6 (M-111) : pieces reservees pour un RDV d''entretien puis pour son OR (une ligne par piece). '
  'Le stock est dans stock_moves (reservation / liberation, origine atelier). active / liberee / consommee (sortie par la facture). '
  'Ecrite uniquement par les fonctions _workshop_reservation*.';
create unique index if not exists uq_stock_res_appointment on public.stock_reservations (appointment_id, article_id)
  where status = 'active' and repair_order_id is null;
create unique index if not exists uq_stock_res_repair_order on public.stock_reservations (repair_order_id, article_id)
  where status = 'active' and repair_order_id is not null;
create index if not exists idx_stock_res_article_active on public.stock_reservations (article_id) where status = 'active';
create index if not exists idx_stock_res_company on public.stock_reservations (company_id, status, due_at);

drop trigger if exists trg_stock_reservations_updated on public.stock_reservations;
create trigger trg_stock_reservations_updated before update on public.stock_reservations
  for each row execute function public.set_updated_at();
drop trigger if exists trg_stock_reservations_audit on public.stock_reservations;
create trigger trg_stock_reservations_audit after insert or update or delete on public.stock_reservations
  for each row execute function public.audit_row();

alter table public.stock_reservations enable row level security;
revoke all on public.stock_reservations from anon;
revoke insert, update, delete on public.stock_reservations from authenticated;
grant select on public.stock_reservations to authenticated;
drop policy if exists stock_reservations_select on public.stock_reservations;
create policy stock_reservations_select on public.stock_reservations for select to authenticated
  using (public.is_member(company_id));

-- Mouvement de reservation / liberation. Ecrit directement (meme colonnes que record_stock_move) :
-- un RDV pris par le CLIENT depuis son espace n'est pas membre de la societe et record_stock_move le
-- refuserait. Pas d'effet sur le PAMP (reservation). Append-only (B7).
create or replace function public._stock_reservation_move(_company uuid, _article uuid, _qty numeric, _ref text, _note text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare _id bigint;
begin
  if coalesce(_qty, 0) = 0 then return null; end if;
  insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, unit_cost, bin_location,
                                  origin, ref, note, operator_id)
  values (_company, _article, (case when _qty > 0 then 'reservation' else 'liberation' end)::public.stock_move_type,
          _qty, true, null, null, 'atelier', _ref, _note, auth.uid())
  returning id into _id;
  return _id;
end $$;
revoke all on function public._stock_reservation_move(uuid, uuid, numeric, text, text) from public, anon, authenticated;

-- Reference lisible du titulaire : n° d'OR, sinon « RDV JJ/MM/AAAA HH:MI ».
create or replace function public._workshop_reservation_ref(_appointment uuid, _or uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select r.number from public.repair_orders r where r.id = _or),
    (select 'RDV ' || to_char(a.starts_at at time zone 'Europe/Brussels', 'DD/MM/YYYY HH24:MI')
       from public.workshop_appointments a where a.id = _appointment),
    'atelier');
$$;
revoke all on function public._workshop_reservation_ref(uuid, uuid) from public, anon, authenticated;

-- Manque des RDV pour un article (besoin non couvert par une reservation).
create or replace function public._workshop_missing_qty(_article uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(greatest(s.qty_needed - s.qty_reserved, 0)), 0)
    from public.stock_reservations s where s.article_id = _article and s.status = 'active';
$$;
revoke all on function public._workshop_missing_qty(uuid) from public, anon, authenticated;

-- Stock vu par le minimax (M-112) : reel - reserve - manque des RDV.
create or replace function public._minimax_stock(_article uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.real_qty - s.reserved_qty from public.article_stock(_article) s), 0)
       - public._workshop_missing_qty(_article);
$$;
revoke all on function public._minimax_stock(uuid) from public, anon, authenticated;

-- Quantite minimax d'un article pour un panier : 0 si le stock du minimax tient le minimum.
-- Deja en commande = CMD / commandes de pieces / autres paniers + lignes NON minimax de ce panier.
create or replace function public._basket_minimax_need(_company uuid, _basket uuid, _article uuid)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.articles%rowtype; proj numeric;
begin
  select * into a from public.articles where id = _article and company_id = _company;
  if not found or a.mgmt_type::text <> 'A' or not coalesce(a.is_active, true) or coalesce(a.stock_min, 0) <= 0 then
    return 0;
  end if;
  proj := public._minimax_stock(_article);
  if proj >= a.stock_min then
    return 0;
  end if;
  return public._basket_minimax_qty(a.stock_min, a.stock_max, proj,
           public._basket_on_order_qty(_company, _article, _basket)
           + coalesce((select sum(l.qty) from public.supplier_basket_lines l
                        where _basket is not null and l.basket_id = _basket and l.article_id = _article
                          and l.origin <> 'minimax'), 0));
end $$;
revoke all on function public._basket_minimax_need(uuid, uuid, uuid) from public, anon, authenticated;

-- Minimax (interne) redefini (meme signature) : meme regle, stock du minimax (M-112).
create or replace function public._basket_fill_minimax(_basket uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b       public.supplier_baskets%rowtype;
  r       record;
  need    numeric;
  lines   jsonb := '[]'::jsonb;
  n_rm    int := 0;
  res     jsonb;
begin
  select * into b from public.supplier_baskets where id = _basket;
  if not found then
    raise exception 'Panier introuvable.' using errcode = 'P0002';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Ce panier est déjà commandé (%).', b.label using errcode = 'P0001';
  end if;
  for r in
    select a.id from public.articles a
     where a.company_id = b.company_id and a.mgmt_type = 'A' and coalesce(a.is_active, true)
       and coalesce(a.stock_min, 0) > 0
  loop
    need := public._basket_minimax_need(b.company_id, _basket, r.id);
    if need > 0 then
      lines := lines || jsonb_build_object('article_id', r.id, 'qty', need, 'origin', 'minimax');
    end if;
  end loop;
  perform set_config('app.basket_rpc', 'on', true);
  with keep as (select (x ->> 'article_id')::uuid as aid from jsonb_array_elements(lines) x)
  delete from public.supplier_basket_lines l
   where l.basket_id = _basket and l.origin = 'minimax'
     and l.article_id not in (select aid from keep);
  get diagnostics n_rm = row_count;
  perform set_config('app.basket_rpc', 'off', true);
  res := public._basket_add_lines(_basket, lines, true);
  return res || jsonb_build_object('removed', n_rm);
end $$;
revoke all on function public._basket_fill_minimax(uuid) from public, anon, authenticated;

-- Apres une reservation : la piece passe-t-elle sous son minimum ? -> panier standard ouvert, origine minimax.
create or replace function public._workshop_minimax_after(_company uuid, _article uuid, _ref text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; need numeric;
begin
  bid := public._basket_current(_company, 'standard', false);
  need := public._basket_minimax_need(_company, bid, _article);
  if coalesce(need, 0) <= 0 then
    return 0;
  end if;
  if bid is null then
    bid := public._basket_current(_company, 'standard', true);
  end if;
  perform public._basket_add_lines(bid, jsonb_build_array(jsonb_build_object('article_id', _article, 'qty', need, 'origin', 'minimax')), true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'workshop_reservation_minimax', 'supplier_baskets', bid::text, 'system', null,
          jsonb_build_object('article_id', _article, 'qty', need, 'ref', _ref, 'minimax_stock', public._minimax_stock(_article)));
  return 1;
end $$;
revoke all on function public._workshop_minimax_after(uuid, uuid, text) from public, anon, authenticated;

-- Liberation d'une ligne (annulation, changement d'entretien, facture : _status = consommee).
create or replace function public._workshop_reservation_release(_id uuid, _reason text, _status text default 'liberee',
                                                               _consumed numeric default 0, _via text default 'system')
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.stock_reservations%rowtype; _ref text; _n int := 0;
begin
  select * into s from public.stock_reservations where id = _id for update;
  if not found or s.status <> 'active' then
    return 0;
  end if;
  _ref := public._workshop_reservation_ref(s.appointment_id, s.repair_order_id);
  if s.qty_reserved > 0 then
    perform public._stock_reservation_move(s.company_id, s.article_id, -s.qty_reserved, _ref,
      'Libération réservation atelier ' || _ref || case _reason
        when 'facture'          then ' (facturée : sortie par la facture)'
        when 'non_facturee'     then ' (absente de la facture)'
        when 'annulation'       then ' (RDV annulé)'
        when 'or_annule'        then ' (OR annulé)'
        when 'entretien_change' then ' (entretien changé)'
        when 'doublon_or'       then ' (déjà réservée par l''OR)'
        else '' end);
    _n := 1;
  end if;
  update public.stock_reservations
     set status = _status, qty_reserved = 0, qty_consumed = greatest(coalesce(_consumed, 0), 0),
         release_reason = _reason, released_at = now()
   where id = s.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (s.company_id, auth.uid(), 'workshop_reservation_release', 'stock_reservations', s.id::text,
          case when _via = 'screen' then 'screen' else 'system' end,
          jsonb_build_object('status', 'active', 'qty_reserved', s.qty_reserved),
          jsonb_build_object('status', _status, 'reason', _reason, 'qty', -s.qty_reserved, 'consumed', _consumed,
                             'article_id', s.article_id, 'ref', _ref, 'via', _via));
  return _n;
end $$;
revoke all on function public._workshop_reservation_release(uuid, text, text, numeric, text) from public, anon, authenticated;

-- Le coeur : aligne les reservations d'un RDV (sans OR) ou d'un OR sur le kit de son entretien.
--   besoin = kit de l'entretien pour le modele-annee de la moto (pieces stockees A avec article) ;
--   reserve = min(besoin, disponible + deja reserve par la ligne) ; manque -> panier (urgente si le RDV
--   est a moins de N jours ou si la moto est la, standard sinon) ; puis minimax (M-112).
--   RDV annule / termine, OR annule ou facture, entretien retire : tout est libere.
create or replace function public._workshop_reservations_sync(_appointment uuid, _or uuid, _via text default 'system')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a        public.workshop_appointments%rowtype;
  r        public.repair_orders%rowtype;
  s        public.stock_reservations%rowtype;
  d        record;
  st       record;
  _company uuid; _vehicle uuid; _contact uuid; _service text; _due timestamptz; _active boolean;
  _ref     text; _my text; _days numeric; _kind text; _bid uuid;
  _target  numeric; _delta numeric; _missing numeric; _add numeric;
  _wanted  uuid[] := '{}';
  _moves   int := 0; _basket int := 0; _minimax int := 0; _released int := 0;
begin
  if _or is not null then
    select * into r from public.repair_orders where id = _or;
    if not found then return jsonb_build_object('moves', 0); end if;
    perform pg_advisory_xact_lock(hashtext('workshop_res:or:' || _or::text));
    _company := r.company_id; _vehicle := r.vehicle_id; _contact := r.contact_id; _service := r.service_code;
    _active := r.status not in ('facture', 'annule');
    select min(x.starts_at) into _due from public.workshop_appointments x where x.or_id = _or;
  else
    select * into a from public.workshop_appointments where id = _appointment;
    if not found then return jsonb_build_object('moves', 0); end if;
    if a.or_id is not null then
      -- La reservation suit l'OR : c'est lui qui la porte desormais.
      return jsonb_build_object('moves', 0, 'skipped', 'follows_or');
    end if;
    perform pg_advisory_xact_lock(hashtext('workshop_res:rdv:' || _appointment::text));
    _company := a.company_id; _vehicle := a.vehicle_id; _contact := a.contact_id; _service := a.service_code;
    _due := a.starts_at;
    _active := a.status not in ('annule', 'termine');
  end if;
  _ref := public._workshop_reservation_ref(_appointment, _or);

  if _active and _vehicle is not null and _service is not null then
    select v.ducati_model_year_id into _my from public.vehicles v where v.id = _vehicle;
  end if;

  -- Type de panier pour le manque : meme regle que le popup (suggestedKind).
  select public._jnum(rv.extra, 'urgent_within_days') into _days
    from public.reference_values rv
   where rv.company_id = _company and rv.table_key = 'order_threshold' and rv.code = 'urgente' limit 1;
  _days := coalesce(_days, 5);
  _kind := case when _due is null then 'urgente'
                when ((_due at time zone 'Europe/Brussels')::date - (now() at time zone 'Europe/Brussels')::date) < _days then 'urgente'
                else 'standard' end;

  if _my is not null then
    for d in
      select k.article_id, max(k.quantity) as qty, min(k.reference) as ref, min(k.designation) as des,
             (array_agg(k.kit_item_id order by k.sort_order))[1] as kit_item
        from public._workshop_service_kit_items(_company, _my, _service) k
        join public.articles ar on ar.id = k.article_id and ar.company_id = _company
                               and ar.mgmt_type::text = 'A' and coalesce(ar.is_active, true)
       where k.article_id is not null and k.confidence <> 'absent' and k.quantity > 0
       group by k.article_id
    loop
      _wanted := _wanted || d.article_id;
      s := null;
      select * into s from public.stock_reservations x
       where x.status = 'active' and x.article_id = d.article_id
         and (case when _or is not null then x.repair_order_id = _or
                   else x.appointment_id = _appointment and x.repair_order_id is null end)
       for update;
      if s.id is null then
        insert into public.stock_reservations (company_id, article_id, appointment_id, repair_order_id, contact_id, vehicle_id,
                                               service_code, kit_item_id, reference, designation, qty_needed, due_at, created_by)
        values (_company, d.article_id, case when _or is null then _appointment end, _or, _contact, _vehicle,
                _service, d.kit_item, d.ref, coalesce(d.des, ''), d.qty, _due, auth.uid())
        returning * into s;
      end if;
      select * into st from public.article_stock(d.article_id);
      _target := least(d.qty, greatest(coalesce(st.real_qty, 0) - coalesce(st.reserved_qty, 0) + s.qty_reserved, 0));
      _delta := _target - s.qty_reserved;
      if _delta <> 0 then
        perform public._stock_reservation_move(_company, d.article_id, _delta, _ref,
          case when _delta > 0 then 'Réservation atelier ' || _ref || coalesce(' — ' || public.workshop_service_label(_service), '')
               else 'Libération partielle ' || _ref || ' (besoin réduit)' end);
        _moves := _moves + 1;
      end if;
      _missing := greatest(d.qty - _target, 0);
      _add := _missing - s.qty_to_order;
      if _add > 0 then
        _bid := public._basket_current(_company, _kind, true);
        perform public._basket_add_lines(_bid, jsonb_build_array(jsonb_build_object(
          'article_id', d.article_id, 'qty', _add, 'origin', 'atelier', 'origin_ref', _ref,
          'origin_line_id', s.id, 'contact_id', _contact)), false);
        _basket := _basket + 1;
      end if;
      update public.stock_reservations
         set qty_needed = d.qty, qty_reserved = _target,
             qty_to_order = qty_to_order + greatest(_add, 0),
             basket_kind = case when _add > 0 then _kind else basket_kind end,
             due_at = _due, contact_id = _contact, vehicle_id = _vehicle, service_code = _service,
             kit_item_id = coalesce(d.kit_item, kit_item_id), reference = coalesce(d.ref, reference),
             designation = coalesce(d.des, designation)
       where id = s.id;
      if _delta <> 0 or _add > 0 then
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, auth.uid(), 'workshop_reservation', 'stock_reservations', s.id::text,
                case when _via = 'screen' then 'screen' else 'system' end,
                jsonb_build_object('qty_reserved', s.qty_reserved, 'qty_to_order', s.qty_to_order),
                jsonb_build_object('article_id', d.article_id, 'ref', _ref, 'service_code', _service, 'qty_needed', d.qty,
                                   'qty_reserved', _target, 'move', _delta, 'to_basket', greatest(_add, 0),
                                   'basket_kind', case when _add > 0 then _kind end, 'contact_id', _contact, 'via', _via));
        _minimax := _minimax + public._workshop_minimax_after(_company, d.article_id, _ref);
      end if;
    end loop;
  end if;

  -- Ce qui n'est plus voulu (entretien change, moto changee, RDV annule...) est libere.
  for s in select * from public.stock_reservations x
            where x.status = 'active' and not (x.article_id = any (_wanted))
              and (case when _or is not null then x.repair_order_id = _or
                        else x.appointment_id = _appointment and x.repair_order_id is null end)
  loop
    _released := _released + public._workshop_reservation_release(s.id,
      case when not _active then case when _or is not null then 'or_annule' else 'annulation' end else 'entretien_change' end,
      'liberee', 0, _via);
  end loop;

  return jsonb_build_object('moves', _moves, 'basket_lines', _basket, 'minimax', _minimax, 'released', _released,
                            'service_code', _service, 'basket_kind', _kind, 'ref', _ref);
end $$;
revoke all on function public._workshop_reservations_sync(uuid, uuid, text) from public, anon, authenticated;

-- RDV -> OR : la reservation suit l'OR (aucun mouvement), l'entretien du RDV passe a l'OR s'il n'en a pas.
create or replace function public._workshop_reservations_follow_or(_appointment uuid, _or uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.stock_reservations%rowtype; a public.workshop_appointments%rowtype; _n int := 0; _num text;
begin
  select * into a from public.workshop_appointments where id = _appointment;
  select number into _num from public.repair_orders where id = _or;
  for s in select * from public.stock_reservations x
            where x.appointment_id = _appointment and x.repair_order_id is null and x.status = 'active' loop
    if exists (select 1 from public.stock_reservations y
                where y.repair_order_id = _or and y.article_id = s.article_id and y.status = 'active') then
      perform public._workshop_reservation_release(s.id, 'doublon_or');
    else
      update public.stock_reservations set repair_order_id = _or where id = s.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (s.company_id, auth.uid(), 'workshop_reservation_follow_or', 'stock_reservations', s.id::text, 'system',
              jsonb_build_object('appointment_id', _appointment),
              jsonb_build_object('repair_order_id', _or, 'or_number', _num, 'article_id', s.article_id, 'qty_reserved', s.qty_reserved));
      _n := _n + 1;
    end if;
  end loop;
  update public.repair_orders set service_code = a.service_code
   where id = _or and service_code is null and a.service_code is not null;
  return _n;
end $$;
revoke all on function public._workshop_reservations_follow_or(uuid, uuid) from public, anon, authenticated;

-- Facture de l'OR : la facture a fait la sortie du stock reel ; la reservation est liberee
-- (consommee a hauteur de la quantite facturee de la piece) : jamais de double sortie.
create or replace function public._workshop_reservations_invoice(_or uuid, _doc uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.stock_reservations%rowtype; _inv numeric; _used numeric; _n int := 0;
begin
  for s in select * from public.stock_reservations x where x.repair_order_id = _or and x.status = 'active' loop
    select coalesce(sum(dl.quantity), 0) into _inv
      from public.document_lines dl where _doc is not null and dl.document_id = _doc and dl.article_id = s.article_id;
    _used := least(s.qty_reserved, greatest(_inv, 0));
    perform public._workshop_reservation_release(s.id, case when _used > 0 then 'facture' else 'non_facturee' end,
                                                 case when _used > 0 then 'consommee' else 'liberee' end, _used);
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke all on function public._workshop_reservations_invoice(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Declencheurs : le RDV et l'OR pilotent la reservation, quel que soit l'ecran (M-111, M-113)
-- ---------------------------------------------------------------------
create or replace function public._trg_appointment_reservations()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    perform public._workshop_reservation_release(x.id, 'annulation')
       from public.stock_reservations x
      where x.appointment_id = old.id and x.repair_order_id is null and x.status = 'active';
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.service_code is not null and new.vehicle_id is not null and new.or_id is null then
      perform public._workshop_reservations_sync(new.id, null, 'rdv');
    end if;
    return new;
  end if;
  if new.or_id is not null and old.or_id is distinct from new.or_id then
    perform public._workshop_reservations_follow_or(new.id, new.or_id);
    return new;
  end if;
  if new.or_id is not null then
    return new;
  end if;
  if new.status is distinct from old.status or new.service_code is distinct from old.service_code
     or new.vehicle_id is distinct from old.vehicle_id or new.contact_id is distinct from old.contact_id then
    perform public._workshop_reservations_sync(new.id, null, 'rdv');
  elsif new.starts_at is distinct from old.starts_at then
    -- RDV deplace : la reservation suit la date, aucun mouvement.
    update public.stock_reservations set due_at = new.starts_at
     where appointment_id = new.id and repair_order_id is null and status = 'active';
    if found then
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (new.company_id, auth.uid(), 'workshop_reservation_moved', 'workshop_appointments', new.id::text, 'system',
              jsonb_build_object('starts_at', old.starts_at), jsonb_build_object('starts_at', new.starts_at));
    end if;
  end if;
  return new;
end $$;
revoke all on function public._trg_appointment_reservations() from public, anon, authenticated;

drop trigger if exists trg_appointments_reservations on public.workshop_appointments;
create trigger trg_appointments_reservations after insert or update on public.workshop_appointments
  for each row execute function public._trg_appointment_reservations();
drop trigger if exists trg_appointments_reservations_delete on public.workshop_appointments;
create trigger trg_appointments_reservations_delete before delete on public.workshop_appointments
  for each row execute function public._trg_appointment_reservations();

create or replace function public._trg_repair_order_reservations()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'facture' and old.status is distinct from 'facture' then
    perform public._workshop_reservations_invoice(new.id, new.invoice_document_id);
  elsif new.status = 'annule' and old.status is distinct from 'annule' then
    perform public._workshop_reservation_release(x.id, 'or_annule')
       from public.stock_reservations x where x.repair_order_id = new.id and x.status = 'active';
  elsif (new.service_code is distinct from old.service_code or new.vehicle_id is distinct from old.vehicle_id)
        and exists (select 1 from public.stock_reservations x where x.repair_order_id = new.id and x.status = 'active') then
    perform public._workshop_reservations_sync(null, new.id, 'or');
  end if;
  return new;
end $$;
revoke all on function public._trg_repair_order_reservations() from public, anon, authenticated;

drop trigger if exists trg_repair_orders_reservations on public.repair_orders;
create trigger trg_repair_orders_reservations after update of status, service_code, vehicle_id, invoice_document_id
  on public.repair_orders for each row execute function public._trg_repair_order_reservations();

-- Arrivee en stock (entree, reception, inventaire positif) : on re-reserve ce qui manquait, RDV le plus proche d'abord.
create or replace function public._trg_stock_entry_reservations()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare h record;
begin
  if new.is_reservation or coalesce(new.qty_delta, 0) <= 0 then
    return new;
  end if;
  if not exists (select 1 from public.stock_reservations x
                  where x.article_id = new.article_id and x.status = 'active' and x.qty_reserved < x.qty_needed) then
    return new;
  end if;
  for h in
    select x.appointment_id, x.repair_order_id, min(x.due_at) as due
      from public.stock_reservations x
     where x.article_id = new.article_id and x.status = 'active' and x.qty_reserved < x.qty_needed
     group by x.appointment_id, x.repair_order_id
     order by min(x.due_at) nulls first
  loop
    perform public._workshop_reservations_sync(case when h.repair_order_id is null then h.appointment_id end, h.repair_order_id, 'entree');
  end loop;
  return new;
end $$;
revoke all on function public._trg_stock_entry_reservations() from public, anon, authenticated;

drop trigger if exists trg_stock_moves_workshop_reservations on public.stock_moves;
create trigger trg_stock_moves_workshop_reservations after insert on public.stock_moves
  for each row execute function public._trg_stock_entry_reservations();

-- ---------------------------------------------------------------------
-- 6. Fonctions de l'ecran
-- ---------------------------------------------------------------------
-- « Reserver / mettre a jour » (bloc Pieces reservees du RDV ou de l'OR ; OR ouvert sans RDV).
create or replace function public.workshop_reservations_sync(_appointment uuid default null, _or uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid;
begin
  if (_appointment is null) = (_or is null) then
    raise exception 'Indiquez soit un rendez-vous, soit un ordre de réparation.' using errcode = 'P0001';
  end if;
  if _or is not null then
    select company_id into _company from public.repair_orders where id = _or;
  else
    select company_id into _company from public.workshop_appointments where id = _appointment;
  end if;
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return public._workshop_reservations_sync(_appointment, _or, 'screen');
end $$;
revoke all on function public.workshop_reservations_sync(uuid, uuid) from public, anon;
grant execute on function public.workshop_reservations_sync(uuid, uuid) to authenticated;

-- Le bloc « Pieces reservees » : une ligne par piece, statut reservee / a commander / commandee / recue.
create or replace function public.workshop_reservations_list(_appointment uuid default null, _or uuid default null)
returns table(id uuid, article_id uuid, reference text, designation text, service_code text,
              qty_needed numeric, qty_reserved numeric, qty_missing numeric, qty_to_order numeric, qty_consumed numeric,
              display_status text, status text, release_reason text, basket_id uuid, basket_label text,
              basket_kind text, basket_status text, bin_location text, due_at timestamptz,
              appointment_id uuid, repair_order_id uuid, on_or_lines boolean, real_qty numeric, available_qty numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _company uuid; _or_eff uuid := _or;
begin
  if _or is not null then
    select company_id into _company from public.repair_orders where repair_orders.id = _or;
  elsif _appointment is not null then
    select a.company_id, a.or_id into _company, _or_eff from public.workshop_appointments a where a.id = _appointment;
  end if;
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select s.id, s.article_id, coalesce(s.reference, ar.reference), coalesce(nullif(s.designation, ''), ar.designation),
         s.service_code, s.qty_needed, s.qty_reserved, greatest(s.qty_needed - s.qty_reserved, 0), s.qty_to_order,
         s.qty_consumed,
         case when s.status = 'consommee' then 'sortie'
              when s.status = 'liberee' then 'liberee'
              when s.qty_needed - s.qty_reserved <= 0 then 'reservee'
              when bk.status = 'recu' then 'recue'
              when bk.status = 'commande' then 'commandee'
              else 'a_commander' end,
         s.status, s.release_reason, bk.id, bk.label, bk.kind, bk.status,
         nullif(btrim(coalesce(ar.bin_location, '')), ''), s.due_at, s.appointment_id, s.repair_order_id,
         (s.repair_order_id is not null and exists (
            select 1 from public.repair_order_lines l where l.or_id = s.repair_order_id and l.article_id = s.article_id and l.kind = 'piece')),
         coalesce(st.real_qty, 0), coalesce(st.available_qty, 0)
    from public.stock_reservations s
    join public.articles ar on ar.id = s.article_id
    left join lateral (
      select b.id, b.label, b.kind, b.status
        from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
       where l.origin_line_id = s.id and b.status <> 'annule'
       order by l.created_at desc limit 1) bk on true
    left join lateral public.article_stock(s.article_id) st on true
   where s.company_id = _company
     and ((_or_eff is not null and s.repair_order_id = _or_eff)
          or (_appointment is not null and s.appointment_id = _appointment))
   order by (s.status = 'active') desc, coalesce(s.reference, ar.reference);
end $$;
revoke all on function public.workshop_reservations_list(uuid, uuid) from public, anon;
grant execute on function public.workshop_reservations_list(uuid, uuid) to authenticated;

-- Fiche article et comptoir : les reservations atelier en cours d'une piece (qui, pour quel RDV / OR, quand).
create or replace function public.article_reservations(_article uuid)
returns table(id uuid, appointment_id uuid, repair_order_id uuid, holder text, contact_id uuid, contact_name text,
              due_at timestamptz, qty_reserved numeric, qty_missing numeric, service_code text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _company uuid;
begin
  select company_id into _company from public.articles where articles.id = _article;
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select s.id, s.appointment_id, s.repair_order_id,
         public._workshop_reservation_ref(s.appointment_id, s.repair_order_id),
         s.contact_id,
         coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), nullif(btrim(c.company_name), '')),
         s.due_at, s.qty_reserved, greatest(s.qty_needed - s.qty_reserved, 0), s.service_code
    from public.stock_reservations s
    left join public.contacts c on c.id = s.contact_id
   where s.article_id = _article and s.status = 'active'
   order by s.due_at nulls last;
end $$;
revoke all on function public.article_reservations(uuid) from public, anon;
grant execute on function public.article_reservations(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Picking list et commande depuis l'OR : l'entretien de l'OR d'abord (M-110)
-- ---------------------------------------------------------------------
create or replace function public._repair_order_service(_or uuid)
returns table(model_year_id text, service_code text, service_label text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select x.model_year_id, x.service_code, x.service_label from (
    select 1 as prio, v.ducati_model_year_id as model_year_id, r.service_code as service_code,
           public.workshop_service_label(r.service_code) as service_label
      from public.repair_orders r
      join public.vehicles v on v.id = r.vehicle_id
     where r.id = _or and r.service_code is not null and v.ducati_model_year_id is not null
    union all
    select 2, j.model_year_id,
           coalesce(
             (select s.code from public.wsm_services s
                join public.wsm_manual_catalog_links l on l.manual_id = s.manual_id
               where l.model_year_id = j.model_year_id and l.status = 'lie'
                 and (lower(s.name) = lower(j.service_label) or lower(s.code) = lower(j.service_label))
               order by s.sort limit 1),
             (select s.code from public.wsm_services s
                join public.wsm_manual_catalog_links l on l.manual_id = s.manual_id
               where l.model_year_id = j.model_year_id and l.status = 'lie'
                 and lower(j.service_label) like '%' || lower(s.name) || '%'
               order by length(s.name) desc limit 1)),
           j.service_label
      from public.workshop_journeys j
     where j.or_id = _or and j.model_year_id is not null
  ) x
  order by x.prio
  limit 1;
$$;
revoke all on function public._repair_order_service(uuid) from public, anon;
grant execute on function public._repair_order_service(uuid) to authenticated;

-- Le type d'entretien (annual / oil / ...) d'un code d'echeance (manuel, plan ou OR).
create or replace function public._workshop_kind_of(_code text)
returns text language sql stable set search_path = public, pg_temp as $$
  select case when _code in ('annual', 'oil', 'first_1000', 'desmo') then _code
              else public.maintenance_service_kind_of(_code) end;
$$;
revoke all on function public._workshop_kind_of(text) from public, anon;
grant execute on function public._workshop_kind_of(text) to authenticated;

create or replace function public.picking_open_for_repair_order(_or uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r     public.repair_orders%rowtype;
  svc   record;
  pid   uuid;
  pst   text;
  _kind text;
  _kits uuid[];
  n_kit int := 0;
  n_or  int := 0;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then
    raise exception 'Ordre de réparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(r.company_id) then
    raise exception 'Accès refusé à la société %', r.company_id using errcode = '42501';
  end if;
  if r.status = 'annule' then
    raise exception 'OR annulé : rien à préparer.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('picking_or:' || _or::text));

  select * into svc from public._repair_order_service(_or);
  _kind := public._workshop_kind_of(svc.service_code);

  select id, status into pid, pst from public.picking_lists where repair_order_id = _or;
  if pid is null then
    insert into public.picking_lists (company_id, repair_order_id, service_label, created_by)
    values (r.company_id, _or, svc.service_label, auth.uid())
    returning id into pid;
    pst := 'en_cours';
  end if;
  if pst in ('annulee', 'livre') then
    return pid;
  end if;

  -- a) les pieces de l'entretien (kits reunis, M-109)
  if svc.model_year_id is not null and _kind is not null then
    insert into public.picking_list_items
      (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
       origin, kit_item_id, unit, sort_order)
    select r.company_id, pid, k.article_id,
           k.designation || case when k.kind = 'consommable' and k.unit is not null
                                 then ' (' || trim(to_char(k.quantity, 'FM9999990.999')) || ' ' || k.unit || ')'
                                 else '' end,
           k.reference, k.quantity, 0, 'a_preparer',
           'kit', k.kit_item_id, k.unit, k.sort_order
      from public._workshop_service_kit_items(r.company_id, svc.model_year_id, _kind) k
     where not exists (select 1 from public.picking_list_items x
                        where x.picking_id = pid
                          and (x.kit_item_id = k.kit_item_id
                               or (k.article_id is not null and x.article_id = k.article_id and x.removed_at is null)));
    get diagnostics n_kit = row_count;
    select array_agg(distinct k.kit_id) into _kits
      from public._workshop_service_kit_items(r.company_id, svc.model_year_id, _kind) k;
  end if;

  -- b) les pieces ajoutees par le technicien : lignes « piece » de l'OR
  insert into public.picking_list_items
    (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
     origin, sort_order)
  select r.company_id, pid, l.article_id, l.designation, a.reference, l.quantity, 0, 'a_preparer',
         'atelier', 1000 + l.sort_order
    from public.repair_order_lines l
    left join public.articles a on a.id = l.article_id
   where l.or_id = _or
     and l.kind = 'piece'
     and l.quantity > 0
     and not exists (
       select 1 from public.picking_list_items x
        where x.picking_id = pid
          and ((l.article_id is not null and x.article_id is not distinct from l.article_id)
               or (l.article_id is null and x.designation is not distinct from l.designation)));
  get diagnostics n_or = row_count;

  perform public._picking_refresh_status(pid);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'picking_open_for_repair_order', 'picking_lists', pid::text, 'screen', null,
          jsonb_build_object('or_id', _or, 'or_number', r.number, 'kit_ids', _kits,
                             'service_code', svc.service_code, 'service_label', svc.service_label,
                             'lines_kit', n_kit, 'lines_workshop', n_or));
  return pid;
end $$;

revoke all on function public.picking_open_for_repair_order(uuid) from public, anon;
grant execute on function public.picking_open_for_repair_order(uuid) to authenticated;

-- Ce qui manque pour l'OR (« Ajouter au panier standard », commande depuis l'OR) : meme signature.
-- Debut de la carte 7 : la reservation de CET OR compte comme disponible pour lui, et ses lignes de
-- panier (origine atelier) comptent « en commande » : une piece deja au panier n'est pas redemandee.
create or replace function public.repair_order_order_needs(_or uuid)
returns table(
  article_id uuid, reference text, designation text, mgmt_type text, origin text,
  qty_needed numeric, real_qty numeric, reserved_qty numeric, free_qty numeric,
  on_order_qty numeric, draft_qty numeric, missing_qty numeric,
  supplier_id uuid, supplier_name text, unit_price_ht numeric, vat_rate numeric, bin_location text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare r public.repair_orders%rowtype; svc record; _kind text;
begin
  select * into r from public.repair_orders where id = _or;
  if not found or not public.is_member(r.company_id) then
    return;
  end if;
  select * into svc from public._repair_order_service(_or);
  _kind := public._workshop_kind_of(svc.service_code);

  return query
  with wanted as (
    select k.article_id as aid, max(k.quantity) as qty, 'kit'::text as src
      from public._workshop_service_kit_items(r.company_id, svc.model_year_id, _kind) k
     where svc.model_year_id is not null and _kind is not null and k.article_id is not null
     group by k.article_id
    union all
    select l.article_id, sum(l.quantity), 'atelier'
      from public.repair_order_lines l
     where l.or_id = _or and l.kind = 'piece' and l.article_id is not null and l.quantity > 0
     group by l.article_id
  ), lines as (
    select wanted.aid, sum(wanted.qty) as qty,
           (array_agg(wanted.src order by wanted.src))[1] as src
      from wanted group by wanted.aid
  ), drafts as (
    select pl.article_id, sum(pl.qty_client) as q
      from public.part_order_lines pl
      join public.part_orders o on o.id = pl.order_id
     where o.company_id = r.company_id
       and o.dispatch_status = 'brouillon'
       and pl.article_id in (select lines.aid from lines)
       and ((r.contact_id is not null and o.contact_id = r.contact_id) or o.repair_order_id = _or)
     group by pl.article_id
  ), own_res as (
    select x.article_id, sum(x.qty_reserved) as q
      from public.stock_reservations x
     where x.repair_order_id = _or and x.status = 'active'
     group by x.article_id
  ), own_basket as (
    select l.article_id, sum(l.qty) as q
      from public.supplier_basket_lines l
      join public.supplier_baskets b on b.id = l.basket_id
     where b.company_id = r.company_id and b.status in ('ouvert', 'commande') and l.origin = 'atelier'
       and (l.origin_ref = r.number
            or l.origin_line_id in (select x.id from public.stock_reservations x where x.repair_order_id = _or))
     group by l.article_id
  ), calc as (
    select a.id as aid, a.reference as ref, a.designation as des, a.mgmt_type::text as mt, lines.src,
           lines.qty, st.real_qty as rq, st.reserved_qty as resq,
           st.real_qty - st.reserved_qty + coalesce(own_res.q, 0) as free,
           public.article_on_order_for(a.id, r.contact_id, null) + coalesce(own_basket.q, 0) as oo,
           coalesce(drafts.q, 0) as dq,
           a.main_supplier_id as sid,
           coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as sname,
           coalesce(a.sale_price_ht, 0) as pu,
           coalesce(a.vat_rate, 21) as vat,
           a.bin_location as bin
      from lines
      join public.articles a on a.id = lines.aid
      left join drafts on drafts.article_id = a.id
      left join own_res on own_res.article_id = a.id
      left join own_basket on own_basket.article_id = a.id
      left join public.contacts c on c.id = a.main_supplier_id
      cross join lateral public.article_stock(a.id) st
     where a.mgmt_type::text in ('A', 'N')
  )
  select calc.aid, calc.ref, calc.des, calc.mt, calc.src,
         calc.qty, calc.rq, calc.resq, calc.free, calc.oo, calc.dq,
         greatest(calc.qty - greatest(calc.free, 0) - calc.oo - calc.dq, 0),
         calc.sid, calc.sname, calc.pu, calc.vat, calc.bin
    from calc
   order by calc.ref;
end $$;

revoke all on function public.repair_order_order_needs(uuid) from public, anon;
grant execute on function public.repair_order_order_needs(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Prochain entretien : un OR facture avec un entretien choisi compte (M-110)
--    (fonction du 31/10 reprise telle quelle, seul le critere « OR du DMS » change)
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
       and (ro.service_code is not null
            or public.maintenance_label_is_service(ro.work_description)
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

-- ---------------------------------------------------------------------
-- 9. Espace client : le client choisit son entretien, le RDV reserve aussi (M-111)
--    Nouveau parametre optionnel p_service ('annual' | 'oil' | 'first_1000' | 'auto' = l'echeance
--    connue de la moto) ; l'appel a 4 parametres de l'ecran actuel reste valable.
-- ---------------------------------------------------------------------
drop function if exists public.portal_request_appointment(uuid, text, date, text);
create or replace function public.portal_request_appointment(
  p_vehicle_id uuid, p_reason text, p_date date, p_slot text, p_service text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _ctx record; _id uuid; _reason text; _open int; _service text; _code text;
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
  select count(*) into _open from public.workshop_appointments
  where contact_id = _ctx.contact_id and company_id = _ctx.company_id and status = 'demande';
  if _open >= 3 then raise exception 'portal: too many pending requests' using errcode = '54000'; end if;

  -- Entretien choisi par le client (ou l'echeance connue de sa moto) : il pose le motif de l'atelier.
  _service := case
    when p_service in ('annual', 'oil', 'first_1000') then p_service
    when p_service = 'auto' and p_vehicle_id is not null then
      (select d.kind from public.vehicle_maintenance_due d
        where d.vehicle_id = p_vehicle_id and d.is_current and d.kind in ('annual', 'oil', 'first_1000')
        order by d.due_date nulls last limit 1)
    else null end;
  if p_service = 'auto' and _service is null and p_vehicle_id is not null then
    _service := 'annual';
  end if;
  _code := case _service when 'annual' then 'entretien_annuel' when 'oil' then 'entretien_annuel_huile'
                         when 'first_1000' then 'entretien_1000' end;

  insert into public.workshop_appointments (
    company_id, contact_id, vehicle_id, starts_at, planned_minutes, work_description,
    status, notify_sms, source, requested_slot, reason_code, service_code)
  values (
    _ctx.company_id, _ctx.contact_id, p_vehicle_id,
    (p_date + case when p_slot = 'matin' then time '09:00' else time '14:00' end) at time zone 'Europe/Brussels',
    60, _reason, 'demande', false, 'portail', p_slot, _code, _service)
  returning id into _id;
  return _id;
end $$;
revoke all on function public.portal_request_appointment(uuid, text, date, text, text) from public, anon;
grant execute on function public.portal_request_appointment(uuid, text, date, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. RDV d'entretien deja planifies (a venir, sans OR) : leurs pieces sont reservees maintenant.
-- ---------------------------------------------------------------------
select public._workshop_reservations_sync(a.id, null, 'migration')
  from public.workshop_appointments a
 where a.service_code is not null and a.vehicle_id is not null and a.or_id is null
   and a.status not in ('annule', 'termine') and a.starts_at >= now() - interval '1 day';

notify pgrst, 'reload schema';
