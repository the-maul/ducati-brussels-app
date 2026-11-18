-- =====================================================================
-- M2 — Rattrapage G8 (18/11/2026) : fiche article.
-- Source : docs/g8-inventaire/02-articles.md (fiche « Création / Modification / Suppression
-- fiche article ») et comparaison-clients-articles-stock-achats.md §2.
--
-- Ajoute ce qui manquait par rapport à G8 :
--   1. Colonnes de la fiche : URL fournisseur (« Associer une URL »), verrou de la désignation
--      contre la mise à jour tarif, « Vente bloquée en caisse », « Hors remise pied de page »,
--      date et état du remplacement (liaison / redirection). Les années Du/Au (migration
--      20260720130000, jamais appliquée au 18/09) sont reposées ici, sans effet si elles existent.
--   2. price_changes trace aussi le PPC HT / TTC (le PPC devient modifiable en masse :
--      « aligner PPC sur PV ») — règle 3 / B7 : aucun prix ne change sans trace.
--   3. Équivalences (table + équivalences d'équivalences).
--   4. Lectures de la fiche : mouvements avec ancien / nouveau stock réel et arrêté,
--      documents de l'article, en cours fournisseur.
--   5. Mise en librairie / librairie → article (avec trace events).
--
-- Idempotente. NON APPLIQUÉE (Simon passe les migrations en bloc). Suppose 20261118210000
-- (inventaire guidé : stock_snapshot_adjustments, reintegrated_at, status) appliquée avant.
-- Essai à blanc : supabase/tests/m2_g8_articles.sql.
-- =====================================================================

-- ------------------------------------------------ 1. Colonnes de la fiche
alter table public.articles add column if not exists supplier_url        text;
alter table public.articles add column if not exists designation_locked  boolean not null default false;
alter table public.articles add column if not exists sale_blocked_pos    boolean not null default false;
alter table public.articles add column if not exists no_footer_discount  boolean not null default false;
alter table public.articles add column if not exists superseded_at       timestamptz;
alter table public.articles add column if not exists replacement_mode    text not null default 'redirection';
alter table public.articles add column if not exists year_from           smallint;
alter table public.articles add column if not exists year_to             smallint;

comment on column public.articles.supplier_url is 'G8 « Associer une URL » : page de l''article chez le fournisseur.';
comment on column public.articles.designation_locked is 'G8 cadenas de la désignation : la mise à jour tarif ne la remplace pas.';
comment on column public.articles.sale_blocked_pos is 'G8 « Vente bloquée en caisse » : la caisse refuse l''article.';
comment on column public.articles.no_footer_discount is 'G8 « Hors remise pied de page » : la remise globale du document ne s''applique pas à cette ligne.';
comment on column public.articles.superseded_at is 'Date du remplacement (superseded_by_id posé), écrite par trigger.';
comment on column public.articles.replacement_mode is 'G8 état du remplacement : redirection (l''ancienne référence renvoie vers la nouvelle) ou liaison (les deux restent consultables, la nouvelle est proposée).';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'articles_replacement_mode_chk') then
    alter table public.articles add constraint articles_replacement_mode_chk
      check (replacement_mode in ('redirection', 'liaison'));
  end if;
end $$;

-- Date du remplacement tenue par la base (l'écran, l'import et la fusion posent superseded_by_id).
create or replace function public.articles_superseded_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.superseded_by_id is not null and new.superseded_at is null then new.superseded_at := now(); end if;
  elsif new.superseded_by_id is distinct from old.superseded_by_id then
    new.superseded_at := case when new.superseded_by_id is null then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists trg_articles_superseded_at on public.articles;
create trigger trg_articles_superseded_at before insert or update of superseded_by_id on public.articles
  for each row execute function public.articles_superseded_at();

-- ------------------------------------------------ 2. PPC tracé dans price_changes
alter table public.price_changes add column if not exists old_ppc_ht  numeric(14,3);
alter table public.price_changes add column if not exists new_ppc_ht  numeric(14,3);
alter table public.price_changes add column if not exists old_ppc_ttc numeric(14,2);
alter table public.price_changes add column if not exists new_ppc_ttc numeric(14,2);

create or replace function public.trace_price_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.purchase_price  is distinct from old.purchase_price
     or new.sale_price_ht  is distinct from old.sale_price_ht
     or new.sale_price_ttc is distinct from old.sale_price_ttc
     or new.coefficient    is distinct from old.coefficient
     or new.ppc_ht         is distinct from old.ppc_ht
     or new.ppc_ttc        is distinct from old.ppc_ttc then
    insert into public.price_changes (
      company_id, article_id,
      old_purchase, new_purchase, old_sale_ht, new_sale_ht,
      old_sale_ttc, new_sale_ttc, old_coef, new_coef,
      old_ppc_ht, new_ppc_ht, old_ppc_ttc, new_ppc_ttc,
      origin, operator_id)
    values (
      new.company_id, new.id,
      old.purchase_price, new.purchase_price, old.sale_price_ht, new.sale_price_ht,
      old.sale_price_ttc, new.sale_price_ttc, old.coefficient, new.coefficient,
      old.ppc_ht, new.ppc_ht, old.ppc_ttc, new.ppc_ttc,
      coalesce(nullif(current_setting('app.price_change_origin', true), ''), 'screen'),
      auth.uid());
  end if;
  return new;
end $$;

-- ------------------------------------------------ helpers
-- Nom affichable d'un contact (fournisseur, client).
create or replace function public._g8_contact_name(_contact uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.last_name, c.first_name)), ''))
    from public.contacts c where c.id = _contact;
$$;
revoke all on function public._g8_contact_name(uuid) from public, anon;
grant execute on function public._g8_contact_name(uuid) to authenticated, service_role;

-- Quantité en commande fournisseur non encore reçue (commandes CMD validées sans réception
-- « reçue » qui les solde) : la colonne « Cde fournisseur » de G8.
create or replace function public._g8_supplier_on_order(_article uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(pl.quantity), 0)
    from public.purchase_lines pl
    join public.purchase_orders o on o.id = pl.order_id
   where pl.article_id = _article
     and o.doc_type = 'CMD' and o.status = 'validee'
     and not exists (select 1 from public.purchase_orders r
                      where r.source_order_id = o.id and r.doc_type = 'REC' and r.status = 'recue');
$$;
revoke all on function public._g8_supplier_on_order(uuid) from public, anon;
grant execute on function public._g8_supplier_on_order(uuid) to authenticated, service_role;

-- ------------------------------------------------ 3. Équivalences
-- Une paire par ligne, rangée (plus petit id, plus grand id) : A ≡ B se lit dans les deux sens.
create table if not exists public.article_equivalences (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  article_id    uuid not null references public.articles(id) on delete cascade,
  equivalent_id uuid not null references public.articles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  constraint article_equivalences_distinct check (article_id <> equivalent_id),
  constraint article_equivalences_ordered check (article_id < equivalent_id),
  constraint article_equivalences_pair unique (article_id, equivalent_id)
);
create index if not exists idx_article_equivalences_eq on public.article_equivalences(equivalent_id);
create index if not exists idx_article_equivalences_company on public.article_equivalences(company_id);

alter table public.article_equivalences enable row level security;
drop policy if exists article_equivalences_select on public.article_equivalences;
create policy article_equivalences_select on public.article_equivalences for select to authenticated
  using (public.is_member(company_id));
drop policy if exists article_equivalences_insert on public.article_equivalences;
create policy article_equivalences_insert on public.article_equivalences for insert to authenticated
  with check (public.can_write_table(company_id, 'articles'));
drop policy if exists article_equivalences_delete on public.article_equivalences;
create policy article_equivalences_delete on public.article_equivalences for delete to authenticated
  using (public.can_write_table(company_id, 'articles'));

-- Ajoute / retire une équivalence (trace events). Même société obligatoire.
create or replace function public.article_equivalence_set(_a uuid, _b uuid, _on boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _co uuid; _co2 uuid; _lo uuid; _hi uuid; _n int;
begin
  if _a is null or _b is null or _a = _b then raise exception 'Deux articles différents sont nécessaires'; end if;
  select company_id into _co from public.articles where id = _a;
  select company_id into _co2 from public.articles where id = _b;
  if _co is null or _co2 is null then raise exception 'Article introuvable'; end if;
  if _co <> _co2 then raise exception 'Les deux articles doivent appartenir à la même société'; end if;
  if auth.uid() is not null and not public.can_write_table(_co, 'articles') then raise exception 'Accès refusé'; end if;
  _lo := least(_a, _b); _hi := greatest(_a, _b);
  if _on then
    insert into public.article_equivalences (company_id, article_id, equivalent_id)
    values (_co, _lo, _hi) on conflict (article_id, equivalent_id) do nothing;
  else
    delete from public.article_equivalences where article_id = _lo and equivalent_id = _hi;
  end if;
  get diagnostics _n = row_count;
  if _n > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_co, auth.uid(), case when _on then 'article_equivalence_add' else 'article_equivalence_remove' end,
            'article', _a, 'screen', null, jsonb_build_object('equivalent_id', _b));
  end if;
end $$;
revoke all on function public.article_equivalence_set(uuid, uuid, boolean) from public, anon;
grant execute on function public.article_equivalence_set(uuid, uuid, boolean) to authenticated, service_role;

-- Liste des équivalences d'un article : niveau 1 = équivalence directe, niveau 2+ =
-- équivalence d'équivalence (G8 filtre « Équivalences d'équivalence »). Profondeur ≤ 5, sans boucle.
create or replace function public.article_equivalents(_article uuid)
returns table (
  article_id uuid, reference text, designation text, supplier_name text, brand text,
  purchase_price numeric, sale_price_ht numeric, sale_price_ttc numeric,
  real_qty numeric, reserved_qty numeric, supplier_order_qty numeric,
  level int, via_reference text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive edges as (
    select e.article_id as a, e.equivalent_id as b from public.article_equivalences e
    union all
    select e.equivalent_id, e.article_id from public.article_equivalences e
  ),
  walk as (
    select e.b as id, 1 as level, array[_article, e.b] as path, _article as via
      from edges e where e.a = _article
    union all
    select e.b, w.level + 1, w.path || e.b, w.id
      from walk w join edges e on e.a = w.id
     where w.level < 5 and not e.b = any(w.path)
  ),
  best as (
    select distinct on (id) id, level, via from walk order by id, level
  )
  select a.id, a.reference, a.designation, public._g8_contact_name(a.main_supplier_id), a.brand,
         a.purchase_price, a.sale_price_ht, a.sale_price_ttc,
         s.real_qty, s.reserved_qty, public._g8_supplier_on_order(a.id),
         b.level, case when b.level > 1 then v.reference end
    from best b
    join public.articles a on a.id = b.id
    left join public.articles v on v.id = b.via
    cross join lateral public.article_stock(a.id) s
   where exists (select 1 from public.articles o where o.id = _article and public.is_member(o.company_id))
   order by b.level, a.reference;
$$;
revoke all on function public.article_equivalents(uuid) from public, anon;
grant execute on function public.article_equivalents(uuid) to authenticated, service_role;

-- ------------------------------------------------ 4a. Mouvements : ancien / nouveau stock réel et arrêté
-- Une ligne par mouvement de stock ET par réajustement de l'arrêté (G8 montre les deux dans
-- l'onglet Mouvements). Stock réel : somme courante des mouvements (hors réservations).
-- Stock arrêté : quantité de l'article dans le dernier arrêté actif (stock_snapshots kind
-- 'arrete', modèle de 20261118210000 : lignes + stock_snapshot_adjustments) pris avant la ligne ;
-- après la réintégration (reintegrated_at) l'arrêté est soldé (0) et le mouvement de
-- réintégration porte le « mouvement arrêté ».
-- _supplier_only : seulement les réceptions du fournisseur principal de l'article (G8).
-- Suppose 20261118210000 (inventaire guidé) appliquée avant.
create or replace function public.article_moves_detail(
  _article uuid, _from date default null, _to date default null, _supplier_only boolean default false
)
returns table (
  row_kind text, move_id bigint, occurred_at timestamptz, move_type text, origin text, ref text, note text,
  is_reservation boolean, qty_delta numeric, unit_cost numeric,
  real_before numeric, real_after numeric,
  frozen_before numeric, frozen_delta numeric, frozen_after numeric,
  operator_name text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with art as (
    select a.id, a.company_id, a.main_supplier_id from public.articles a
     where a.id = _article and public.is_member(a.company_id)
  ),
  ev as (
    select 'move'::text as row_kind, sm.id as seq_id, sm.occurred_at, sm.move_type::text as move_type, sm.origin, sm.ref, sm.note,
           sm.is_reservation, sm.qty_delta, sm.unit_cost, sm.operator_id,
           case when sm.is_reservation then 0 else sm.qty_delta end as real_delta, null::uuid as adj_snapshot, 0::numeric as adj_delta
      from public.stock_moves sm join art on art.id = sm.article_id
    union all
    select 'arrete', ad.id, ad.occurred_at, 'arrete_' || ad.mode, ad.origin, ad.snapshot_id::text, ad.note,
           false, 0::numeric, null::numeric, ad.operator_id, 0::numeric, ad.snapshot_id, ad.delta
      from public.stock_snapshot_adjustments ad join art on art.id = ad.article_id
  ),
  r as (
    select ev.*,
           sum(ev.real_delta) over (order by ev.occurred_at, ev.row_kind desc, ev.seq_id rows between unbounded preceding and current row) as real_after
      from ev
  ),
  f as (
    select r.*, sn.id as snap_id, sn.reintegrated_at,
           -- quantité de l'arrêté (lignes + réajustements faits jusqu'à cette ligne comprise)
           coalesce((select sum(l.qty) from public.stock_snapshot_lines l where l.snapshot_id = sn.id and l.article_id = _article), 0)
           + coalesce((select sum(ad.delta) from public.stock_snapshot_adjustments ad
                        where ad.snapshot_id = sn.id and ad.article_id = _article
                          and (ad.occurred_at, ad.id) <= (r.occurred_at, case when r.row_kind = 'arrete' then r.seq_id else 9223372036854775807 end)), 0)
             as snap_qty
      from r
      left join lateral (
        select s.id, s.reintegrated_at from public.stock_snapshots s, art
         where s.company_id = art.company_id and s.kind = 'arrete' and s.status = 'actif' and s.created_at <= r.occurred_at
         order by s.created_at desc limit 1
      ) sn on true
  ),
  g as (
    select f.*,
           case when f.snap_id is null then 0
                when f.reintegrated_at is not null and f.reintegrated_at <= f.occurred_at then 0
                else f.snap_qty end as frozen_after,
           case when f.row_kind = 'arrete' and f.adj_snapshot = f.snap_id then f.adj_delta
                when f.row_kind = 'move' and f.origin = 'inventory' and f.reintegrated_at is not null and f.reintegrated_at = f.occurred_at
                  then -f.snap_qty
                else 0 end as frozen_delta
      from f
  )
  select g.row_kind, g.seq_id, g.occurred_at, g.move_type, g.origin, g.ref, g.note, g.is_reservation,
         g.qty_delta, g.unit_cost,
         g.real_after - g.real_delta, g.real_after,
         g.frozen_after - g.frozen_delta, g.frozen_delta, g.frozen_after,
         (select p.full_name from public.profiles p where p.id = g.operator_id)
    from g
   where (_from is null or g.occurred_at >= _from::timestamptz)
     and (_to is null or g.occurred_at < (_to + 1)::timestamptz)
     and (not coalesce(_supplier_only, false) or (
           g.row_kind = 'move' and g.origin = 'reception' and exists (
             select 1 from public.purchase_orders o, art
              where o.number = g.ref and o.company_id = art.company_id
                and o.supplier_id is not distinct from art.main_supplier_id)))
   order by g.occurred_at desc, g.row_kind, g.seq_id desc
   limit 2000;
$$;
revoke all on function public.article_moves_detail(uuid, date, date, boolean) from public, anon;
grant execute on function public.article_moves_detail(uuid, date, date, boolean) to authenticated, service_role;

-- ------------------------------------------------ 4b. Documents de l'article
-- Tous les documents qui contiennent l'article (G8 « Documents article ») :
--   facture (FAC, TIK, AVO, FAA), livraison (BL), reservation (RES), proforma (DEV, BC),
--   reparation (OR), commande (CMD fournisseur), reception (REC), cession (mouvements de
--   cession), proposition (commandes de pièces).
-- Marge = HT de la ligne − quantité × PAMP courant de l'article (indicatif, ventes seulement).
create or replace function public.article_documents(
  _article uuid, _kinds text[] default null, _from date default null, _to date default null,
  _supplier_only boolean default false
)
returns table (
  kind text, doc_id uuid, doc_type text, number text, doc_date date, status text,
  third_party text, quantity numeric, unit_price_ht numeric, discount_pct numeric,
  line_ht numeric, line_ttc numeric, margin numeric, operator_name text, route text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with art as (
    select a.id, a.company_id, a.pamp, a.main_supplier_id from public.articles a
     where a.id = _article and public.is_member(a.company_id)
  ),
  doc_rows as (
    -- ventes
    select case when d.doc_type in ('FAC', 'TIK', 'AVO', 'FAA') then 'facture'
                when d.doc_type = 'BL' then 'livraison'
                when d.doc_type = 'RES' then 'reservation'
                else 'proforma' end as kind,
           d.id, d.doc_type, coalesce(d.number, d.legacy_number) as number, d.issue_date as doc_date, d.status,
           public._g8_contact_name(d.contact_id) as third_party,
           l.quantity, l.unit_price_ht, l.discount_pct, l.line_ht, l.line_ttc,
           round(l.line_ht - l.quantity * art.pamp, 2) as margin,
           coalesce(d.operator, (select p.full_name from public.profiles p where p.id = d.operator_user_id)) as operator_name,
           '/sales/' || d.id::text as route, null::uuid as supplier_id
      from public.document_lines l
      join public.documents d on d.id = l.document_id
      join art on art.id = l.article_id
    union all
    -- ordres de réparation
    select 'reparation', o.id, 'OR', o.number, o.created_at::date, o.status,
           public._g8_contact_name(o.contact_id),
           l.quantity, l.unit_price_ht, l.discount_pct, l.line_ht, l.line_ttc,
           round(l.line_ht - l.quantity * art.pamp, 2), o.operator,
           '/workshop/' || o.id::text, null::uuid
      from public.repair_order_lines l
      join public.repair_orders o on o.id = l.or_id
      join art on art.id = l.article_id
    union all
    -- commandes et réceptions fournisseur
    select case when o.doc_type = 'CMD' then 'commande' else 'reception' end, o.id, o.doc_type, o.number,
           coalesce(o.order_date, o.receipt_date, o.created_at::date), o.status,
           public._g8_contact_name(o.supplier_id),
           l.quantity, l.unit_price_ht, l.discount_pct, l.line_ht, round(l.line_ht * (1 + l.vat_rate / 100), 2),
           null::numeric, null::text, '/purchases/' || o.id::text, o.supplier_id
      from public.purchase_lines l
      join public.purchase_orders o on o.id = l.order_id
      join art on art.id = l.article_id
    union all
    -- commandes de pièces (propositions de commande)
    select 'proposition', o.id, 'CDP', o.number, coalesce(o.validated_at, o.created_at)::date, o.dispatch_status::text,
           public._g8_contact_name(o.contact_id),
           l.qty_client + l.qty_shop, l.unit_price_ht, 0::numeric, l.line_ht, round(l.line_ht * (1 + l.vat_rate / 100), 2),
           null::numeric, null::text, '/orders/' || o.id::text, l.supplier_id
      from public.part_order_lines l
      join public.part_orders o on o.id = l.order_id
      join art on art.id = l.article_id
    union all
    -- cessions internes (sorties valorisées non facturées)
    select 'cession', null::uuid, 'CES', m.ref, m.occurred_at::date, m.move_type::text,
           m.note, -m.qty_delta, art.pamp, 0::numeric, round(-m.qty_delta * art.pamp, 2), round(-m.qty_delta * art.pamp, 2),
           null::numeric, (select p.full_name from public.profiles p where p.id = m.operator_id), null::text, null::uuid
      from public.stock_moves m join art on art.id = m.article_id
     where m.move_type = 'cession'
  )
  select r.kind, r.id, r.doc_type, r.number, r.doc_date, r.status, r.third_party,
         r.quantity, r.unit_price_ht, r.discount_pct, r.line_ht, r.line_ttc, r.margin, r.operator_name, r.route
    from doc_rows r, art
   where (_kinds is null or cardinality(_kinds) = 0 or r.kind = any(_kinds))
     and (_from is null or r.doc_date >= _from)
     and (_to is null or r.doc_date <= _to)
     and (not coalesce(_supplier_only, false) or r.supplier_id is not distinct from art.main_supplier_id)
   order by r.doc_date desc nulls last, r.number desc nulls last
   limit 2000;
$$;
revoke all on function public.article_documents(uuid, text[], date, date, boolean) from public, anon;
grant execute on function public.article_documents(uuid, text[], date, date, boolean) to authenticated, service_role;

-- ------------------------------------------------ 4c. En cours fournisseur
-- Commandes fournisseur (CMD non soldée par une réception « reçue ») et commandes de pièces
-- validées non encore reçues qui contiennent l'article.
create or replace function public.article_supplier_open_orders(_article uuid)
returns table (
  supplier_id uuid, supplier_name text, doc_id uuid, doc_type text, number text,
  doc_date date, status text, quantity numeric, route text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with art as (
    select a.id from public.articles a where a.id = _article and public.is_member(a.company_id)
  )
  select o.supplier_id, public._g8_contact_name(o.supplier_id), o.id, 'CMD', o.number,
         coalesce(o.order_date, o.created_at::date), o.status, l.quantity, '/purchases/' || o.id::text
    from public.purchase_lines l
    join public.purchase_orders o on o.id = l.order_id
    join art on art.id = l.article_id
   where o.doc_type = 'CMD' and o.status in ('brouillon', 'validee')
     and not exists (select 1 from public.purchase_orders r
                      where r.source_order_id = o.id and r.doc_type = 'REC' and r.status = 'recue')
  union all
  select l.supplier_id, public._g8_contact_name(l.supplier_id), o.id, 'CDP', o.number,
         coalesce(o.validated_at, o.created_at)::date, o.dispatch_status::text, l.qty_client + l.qty_shop,
         '/orders/' || o.id::text
    from public.part_order_lines l
    join public.part_orders o on o.id = l.order_id
    join art on art.id = l.article_id
   where o.dispatch_status::text not in ('brouillon', 'annulee', 'recue', 'livree', 'terminee')
     and l.purchase_line_id is null
   order by 6 desc nulls last;
$$;
revoke all on function public.article_supplier_open_orders(uuid) from public, anon;
grant execute on function public.article_supplier_open_orders(uuid) to authenticated, service_role;

-- ------------------------------------------------ 5. Mise en librairie / librairie → article
-- G8 « Mise en librairie » : l'article sort du fichier stocké vers le catalogue non stocké.
-- Refusée tant que l'article a du stock réel (il disparaîtrait de la valorisation).
-- Retour : {"done": n, "refused_stock": n, "unchanged": n}.
create or replace function public.article_set_library(_ids uuid[], _to_library boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _r record; _done int := 0; _refused int := 0; _same int := 0; _real numeric;
begin
  if coalesce(cardinality(_ids), 0) > 1000 then raise exception 'Au plus 1 000 articles par appel'; end if;
  for _r in select a.id, a.company_id, a.is_library from public.articles a where a.id = any(_ids) loop
    if auth.uid() is not null and not public.can_write_table(_r.company_id, 'articles') then
      raise exception 'Accès refusé';
    end if;
    if _r.is_library = _to_library then _same := _same + 1; continue; end if;
    if _to_library then
      select real_qty into _real from public.article_stock(_r.id);
      if coalesce(_real, 0) <> 0 then _refused := _refused + 1; continue; end if;
    end if;
    update public.articles set is_library = _to_library, updated_at = now() where id = _r.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_r.company_id, auth.uid(), case when _to_library then 'article_library_in' else 'article_library_out' end,
            'article', _r.id, 'screen', jsonb_build_object('is_library', _r.is_library), jsonb_build_object('is_library', _to_library));
    _done := _done + 1;
  end loop;
  return jsonb_build_object('done', _done, 'refused_stock', _refused, 'unchanged', _same);
end $$;
revoke all on function public.article_set_library(uuid[], boolean) from public, anon;
grant execute on function public.article_set_library(uuid[], boolean) to authenticated, service_role;
