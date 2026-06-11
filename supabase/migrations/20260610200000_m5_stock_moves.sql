-- =====================================================================
-- M5 (fondation) — MOUVEMENTS DE STOCK append-only (B5 PAMP, B7 traçabilité)
-- Le stock réel = SOMME des mouvements (jamais d'UPDATE direct). Le PAMP est
-- recalculé à chaque ENTRÉE valorisée. Sert de base au triple stock, au transfert
-- de stock au remplacement de référence, et aux décréments de vente (M6).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'stock_move_type') then
    create type public.stock_move_type as enum
      ('entree','sortie','reservation','liberation','inventaire','transfert','cession','correction');
  end if;
end $$;

create table if not exists public.stock_moves (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete restrict,
  article_id  uuid not null references public.articles(id) on delete restrict,
  move_type   public.stock_move_type not null,
  qty_delta   numeric(14,3) not null,          -- + entrée / - sortie ; réservations sur axe séparé
  is_reservation boolean not null default false, -- true = impacte le "réservé", pas le réel
  unit_cost   numeric(14,3),                   -- PAHT de l'entrée (pour le PAMP)
  bin_location text,                           -- casier concerné (multi-emplacements)
  origin      text not null default 'screen',  -- 'screen'|'import'|'reception'|'sale'|'inventory'|'replacement'
  ref         text,                            -- n° de document / référence d'origine
  note        text,
  operator_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_stockmoves_article on public.stock_moves(article_id);
create index if not exists idx_stockmoves_company on public.stock_moves(company_id);
create index if not exists idx_stockmoves_occurred on public.stock_moves(occurred_at desc);

-- Append-only : insert + select pour les membres ; update/delete révoqués.
alter table public.stock_moves enable row level security;
drop policy if exists stockmoves_select on public.stock_moves;
create policy stockmoves_select on public.stock_moves for select to authenticated using (public.is_member(company_id));
drop policy if exists stockmoves_insert on public.stock_moves;
create policy stockmoves_insert on public.stock_moves for insert to authenticated with check (public.is_member(company_id));
revoke update, delete on public.stock_moves from authenticated;

-- ---------------------------------------------------------------------
-- Stock réel / réservé / disponible d'un article (somme des mouvements, B4)
-- ---------------------------------------------------------------------
create or replace function public.article_stock(_article uuid)
returns table(real_qty numeric, reserved_qty numeric, available_qty numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    coalesce(sum(case when not is_reservation then qty_delta else 0 end), 0) as real_qty,
    coalesce(sum(case when is_reservation then qty_delta else 0 end), 0) as reserved_qty,
    coalesce(sum(case when not is_reservation then qty_delta else 0 end), 0)
      - coalesce(sum(case when is_reservation then qty_delta else 0 end), 0) as available_qty
  from public.stock_moves where article_id = _article;
$$;
grant execute on function public.article_stock(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Enregistrer un mouvement + recalculer le PAMP sur les entrées valorisées (B5)
-- ---------------------------------------------------------------------
create or replace function public.record_stock_move(
  _article uuid, _type public.stock_move_type, _qty numeric,
  _unit_cost numeric default null, _is_reservation boolean default false,
  _bin text default null, _origin text default 'screen', _ref text default null, _note text default null
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _company uuid;
  _old_real numeric;
  _old_pamp numeric;
  _move_id bigint;
begin
  select company_id, pamp into _company, _old_pamp from public.articles where id = _article;
  if _company is null then raise exception 'Article introuvable'; end if;
  if not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, unit_cost, bin_location, origin, ref, note, operator_id)
  values (_company, _article, _type, _qty, _is_reservation, _unit_cost, _bin, _origin, _ref, _note, auth.uid())
  returning id into _move_id;

  -- PAMP recalculé sur une ENTRÉE valorisée (qty>0, coût fourni)
  if not _is_reservation and _qty > 0 and _unit_cost is not null then
    select real_qty into _old_real from public.article_stock(_article);
    -- _old_real inclut déjà le mouvement courant → retirer _qty pour repartir de l'ancien stock
    _old_real := _old_real - _qty;
    if _old_real <= 0 then
      update public.articles set pamp = round(_unit_cost, 3) where id = _article;   -- repart du PA
    else
      update public.articles
        set pamp = round((coalesce(_old_pamp,0) * _old_real + _unit_cost * _qty) / (_old_real + _qty), 3)
        where id = _article;
    end if;
  end if;
  return _move_id;
end $$;
grant execute on function public.record_stock_move(uuid, public.stock_move_type, numeric, numeric, boolean, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Transfert de stock au remplacement de référence (ancienne → nouvelle) + PAMP
-- ---------------------------------------------------------------------
create or replace function public.transfer_stock_on_replace(_from uuid, _to uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _real numeric; _pamp numeric;
begin
  select real_qty into _real from public.article_stock(_from);
  select pamp into _pamp from public.articles where id = _from;
  if _real is null or _real = 0 then return; end if;
  -- sortie de l'ancienne, entrée valorisée dans la nouvelle (recalcule le PAMP cible)
  perform public.record_stock_move(_from, 'transfert', -_real, null, false, null, 'replacement', _to::text, 'Remplacement de référence');
  perform public.record_stock_move(_to,   'transfert',  _real, _pamp, false, null, 'replacement', _from::text, 'Remplacement de référence');
end $$;
grant execute on function public.transfer_stock_on_replace(uuid, uuid) to authenticated;
