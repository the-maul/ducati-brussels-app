-- =====================================================================
-- M8 — Chantier C1 (23/11/2026) : DOSSIER ATELIER EN 4 ETAPES. ATE-02 ATE-03 ATE-06. B8.
--
-- Demande du client : « une moto, elle se reserve, elle rentre, elle se paie et elle sort ».
-- L'etape du dossier se CALCULE depuis les statuts existants (regle pure
-- src/modules/workshop/dossier/rules.ts) : aucun nouveau statut d'OR ni de RDV. Cette migration
-- n'ajoute que ce qui n'existait nulle part :
--
--  1. `repair_orders.planned_minutes` : le temps prevu du RDV recopie sur l'OR (ATE-03), quand le
--     RDV est relie a l'OR puis a chaque changement du temps prevu tant que l'OR n'est pas clos.
--  2. « Attente pieces » automatique (ATE-02), sans toucher aux statuts G8 :
--       - l'OR nait TOUJOURS « a faire » et le RDV passe « receptionne » (decision Q43, comme G8) ;
--       - une fois l'entree de la moto terminee (photos faites ou remises a plus tard), un OR « a faire »
--         que personne n'a encore pointe passe « Attente pieces » des qu'une piece reservee manque ;
--       - il revient « a faire » quand tout est couvert, SEULEMENT si c'est ce mecanisme qui l'y
--         avait mis (`parts_wait_auto`) : un « Attente pieces » pose a la main, ou un OR deja
--         commence, n'est jamais change.
--  3. `repair_order_handovers` : la remise de la moto au client (etape visible « sortie »), tracee.
--     Une ligne par OR. Les OR deja factures sont repris comme « sortis » (origine `reprise`).
--
-- RLS : lecture par les membres de la societe, ecriture uniquement par les fonctions.
-- Additive, rejouable. Essai a blanc : supabase/tests/m8_dossier_atelier.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Temps prevu du RDV sur l'OR (ATE-03)
-- ---------------------------------------------------------------------
alter table public.repair_orders add column if not exists planned_minutes integer;
do $$ begin
  alter table public.repair_orders add constraint repair_orders_planned_minutes_chk
    check (planned_minutes is null or planned_minutes >= 0) not valid;
exception when duplicate_object then null; end $$;

create or replace function public.workshop_appointments_planned_to_or()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.or_id is null or new.planned_minutes is null then return new; end if;
  update public.repair_orders
     set planned_minutes = new.planned_minutes
   where id = new.or_id
     and status not in ('facture', 'annule')
     and planned_minutes is distinct from new.planned_minutes;
  return new;
end $$;
revoke all on function public.workshop_appointments_planned_to_or() from public, anon, authenticated;

drop trigger if exists trg_appointments_planned_to_or on public.workshop_appointments;
create trigger trg_appointments_planned_to_or
  after insert or update of or_id, planned_minutes on public.workshop_appointments
  for each row execute function public.workshop_appointments_planned_to_or();

-- ---------------------------------------------------------------------
-- 2. « Attente pieces » automatique (ATE-02)
-- ---------------------------------------------------------------------
alter table public.repair_orders add column if not exists parts_wait_auto boolean not null default false;

-- Tout changement de statut qui ne vient pas de ce mecanisme lui retire la main.
create or replace function public.repair_orders_parts_wait_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status and new.parts_wait_auto is not distinct from old.parts_wait_auto then
    new.parts_wait_auto := false;
  end if;
  return new;
end $$;
revoke all on function public.repair_orders_parts_wait_guard() from public, anon, authenticated;

drop trigger if exists trg_repair_orders_parts_wait_guard on public.repair_orders;
create trigger trg_repair_orders_parts_wait_guard
  before update of status on public.repair_orders
  for each row execute function public.repair_orders_parts_wait_guard();

create or replace function public._workshop_or_parts_wait_sync(_or uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  _missing boolean;
  _worked boolean;
begin
  if _or is null then return; end if;
  select id, company_id, status, parts_wait_auto into r from public.repair_orders where id = _or;
  if not found or r.status not in ('a_faire', 'attente_pieces') then return; end if;
  if r.status = 'attente_pieces' and not r.parts_wait_auto then return; end if;

  select exists (select 1 from public.workshop_time_entries e where e.or_id = _or and e.kind = 'travail') into _worked;
  if _worked then return; end if;

  select exists (
    select 1 from public.stock_reservations x
     where x.repair_order_id = _or and x.status = 'active'
       and coalesce(x.qty_needed, 0) - coalesce(x.qty_consumed, 0) - coalesce(x.qty_reserved, 0) > 0.0005
  ) into _missing;

  -- Q43 : a sa naissance l'OR reste « a faire » ; le manque ne compte qu'une fois la moto entree.
  if r.status = 'a_faire' and _missing and exists (
    select 1 from public.repair_order_receptions x where x.or_id = _or and x.status in ('complete', 'plus_tard')
  ) then
    update public.repair_orders set status = 'attente_pieces', parts_wait_auto = true where id = _or;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, auth.uid(), 'workshop_or_parts_wait_auto', 'repair_orders', _or::text, 'system',
            jsonb_build_object('status', 'a_faire'), jsonb_build_object('status', 'attente_pieces'));
  elsif r.status = 'attente_pieces' and not _missing then
    update public.repair_orders set status = 'a_faire', parts_wait_auto = false where id = _or;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, auth.uid(), 'workshop_or_parts_wait_auto', 'repair_orders', _or::text, 'system',
            jsonb_build_object('status', 'attente_pieces'), jsonb_build_object('status', 'a_faire'));
  end if;
end $$;
revoke all on function public._workshop_or_parts_wait_sync(uuid) from public, anon, authenticated;

create or replace function public._trg_reservation_parts_wait()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op <> 'INSERT' then perform public._workshop_or_parts_wait_sync(old.repair_order_id); end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.repair_order_id is distinct from old.repair_order_id) then
    perform public._workshop_or_parts_wait_sync(new.repair_order_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public._trg_reservation_parts_wait() from public, anon, authenticated;

drop trigger if exists trg_stock_reservations_parts_wait on public.stock_reservations;
create trigger trg_stock_reservations_parts_wait
  after insert or delete or update of qty_needed, qty_reserved, qty_consumed, status, repair_order_id
  on public.stock_reservations
  for each row execute function public._trg_reservation_parts_wait();

create or replace function public._trg_reception_parts_wait()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('complete', 'plus_tard') then
    perform public._workshop_or_parts_wait_sync(new.or_id);
  end if;
  return new;
end $$;
revoke all on function public._trg_reception_parts_wait() from public, anon, authenticated;

drop trigger if exists trg_reception_parts_wait on public.repair_order_receptions;
create trigger trg_reception_parts_wait
  after insert or update of status on public.repair_order_receptions
  for each row execute function public._trg_reception_parts_wait();

-- ---------------------------------------------------------------------
-- 3. Remise de la moto au client (ATE-06, etape « sortie »)
-- ---------------------------------------------------------------------
create table if not exists public.repair_order_handovers (
  or_id uuid primary key references public.repair_orders(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  handed_over_at timestamptz not null default now(),
  handed_over_by uuid,
  handed_over_by_name text,
  note text,
  origin text not null default 'dossier' check (origin in ('dossier', 'reprise'))
);
create index if not exists idx_repair_order_handovers_company on public.repair_order_handovers (company_id);

alter table public.repair_order_handovers enable row level security;
drop policy if exists ror_handovers_select on public.repair_order_handovers;
create policy ror_handovers_select on public.repair_order_handovers for select to authenticated
  using (company_id in (select public.rls_member_companies()));
revoke insert, update, delete on public.repair_order_handovers from anon, authenticated;
grant select on public.repair_order_handovers to authenticated;

-- Les OR deja factures sont sortis : pas de fausse « remise a faire » sur l'historique.
insert into public.repair_order_handovers (or_id, company_id, handed_over_at, origin)
select r.id, r.company_id, coalesce(r.updated_at, r.created_at, now()), 'reprise'
  from public.repair_orders r
 where r.status = 'facture'
on conflict (or_id) do nothing;

create or replace function public.repair_order_handover_set(_or uuid, _note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype;
  _at timestamptz;
begin
  r := public._ror_reception_or(_or);
  if r.status <> 'facture' then
    raise exception 'OR % : la moto sort une fois l''OR facture.', coalesce(r.number, r.id::text) using errcode = '23514';
  end if;
  select handed_over_at into _at from public.repair_order_handovers where or_id = _or;
  if found then
    return jsonb_build_object('status', 'already', 'handed_over_at', _at);
  end if;
  insert into public.repair_order_handovers (or_id, company_id, handed_over_by, handed_over_by_name, note)
  values (_or, r.company_id, auth.uid(), public._current_user_name(), nullif(btrim(coalesce(_note, '')), ''))
  returning handed_over_at into _at;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (r.company_id, auth.uid(), 'workshop_or_handed_over', 'repair_orders', _or::text, 'screen',
          jsonb_build_object('handed_over_at', _at, 'note', nullif(btrim(coalesce(_note, '')), '')));
  return jsonb_build_object('status', 'done', 'handed_over_at', _at);
end $$;
revoke all on function public.repair_order_handover_set(uuid, text) from public, anon;
grant execute on function public.repair_order_handover_set(uuid, text) to authenticated;

-- « Revenir » : une remise cochee par erreur s'annule, avec sa trace.
create or replace function public.repair_order_handover_undo(_or uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype;
  h public.repair_order_handovers%rowtype;
begin
  r := public._ror_reception_or(_or);
  select * into h from public.repair_order_handovers where or_id = _or;
  if not found then return jsonb_build_object('status', 'none'); end if;
  delete from public.repair_order_handovers where or_id = _or;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data)
  values (r.company_id, auth.uid(), 'workshop_or_handover_undone', 'repair_orders', _or::text, 'screen',
          jsonb_build_object('handed_over_at', h.handed_over_at, 'by', h.handed_over_by_name, 'origin', h.origin));
  return jsonb_build_object('status', 'undone');
end $$;
revoke all on function public.repair_order_handover_undo(uuid) from public, anon;
grant execute on function public.repair_order_handover_undo(uuid) to authenticated;

select public.rls_perf_rewrite_all();
