-- =====================================================================
-- M8 — Decisions du client du 18/11/2026 (lot « decisions atelier ») : Q42 km obligatoire,
-- Q43 statuts a la creation de l'OR depuis le RDV. ATE001 ATE002 ATE003.
--
-- Q42 — Km obligatoire, comme G8 :
--   * a la creation de l'OR (et des qu'une moto est rattachee a un OR qui n'en avait pas, ou
--     changee) : `repair_orders.mileage` obligatoire. Ensuite le km reste modifiable sans etre
--     redemande (une modification de l'OR qui ne touche pas a la moto ne controle plus rien) ;
--   * au RDV : obligatoire des qu'une moto est choisie (prise de RDV ou moto rattachee plus tard).
--     Un RDV sans moto connue (moto a creer) reste possible ; une demande de l'espace client
--     (statut « demande ») n'est pas bloquee : le km sera demande a la creation de l'OR.
--   * les fonctions serveur (auth.uid() null : imports G8, scripts) ne sont pas controlees.
--   Le km saisi alimente l'historique km de la moto comme avant (lecture des OR, inchangee).
--
-- Q43 — Statuts a la creation de l'OR depuis le RDV, comme G8 :
--   * l'OR nait « a faire », le RDV passe « receptionne » (statut `arrive`, moto deposee) : quand
--     un RDV recoit son OR (`or_id` pose), son statut s'aligne sur celui de l'OR
--     (`workshop_appointment_status_for_or`, deja utilisee par le suivi de l'OR) ;
--   * l'OR passe « en cours » quand le travail commence : premier pointage d'un mecanicien sur l'OR
--     (`workshop_time_entries`, kind travail) OU action explicite « Demarrer »
--     (`repair_order_start`). Le RDV suit (declencheur existant trg_repair_orders_sync_appointment).
--   * audit : la mise a jour de l'OR passe par trg_ro_audit (audit_row) + une ligne `events`
--     explicite `repair_order_work_started` (origine chrono ou ecran).
--
-- Additive, rejouable (create or replace, drop trigger if exists). Aucune donnee modifiee.
-- Ne redefinit aucune fonction existante. Essai a blanc : supabase/tests/m8_km_et_statuts_or_g8.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Q42 — km obligatoire a la creation de l'OR / au rattachement d'une moto
-- ---------------------------------------------------------------------
create or replace function public.repair_orders_mileage_required()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;              -- fonctions serveur, imports
  if new.vehicle_id is null then return new; end if;          -- OR sans moto : rien a relever
  if tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id then
    if new.mileage is null then
      raise exception 'Kilometrage obligatoire : saisissez le km de la moto (a la creation de l''OR et quand une moto est rattachee).'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.repair_orders_mileage_required() from public, anon, authenticated;
drop trigger if exists trg_repair_orders_mileage_required on public.repair_orders;
create trigger trg_repair_orders_mileage_required before insert or update of vehicle_id on public.repair_orders
  for each row execute function public.repair_orders_mileage_required();

create or replace function public.workshop_appointments_mileage_required()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if new.vehicle_id is null or new.status in ('demande', 'annule') then return new; end if;
  if tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id then
    if new.mileage is null then
      raise exception 'Kilometrage obligatoire des qu''une moto est choisie sur le rendez-vous.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.workshop_appointments_mileage_required() from public, anon, authenticated;
drop trigger if exists trg_appointments_mileage_required on public.workshop_appointments;
create trigger trg_appointments_mileage_required before insert or update of vehicle_id on public.workshop_appointments
  for each row execute function public.workshop_appointments_mileage_required();

-- ---------------------------------------------------------------------
-- 2. Q43 — le RDV qui recoit son OR prend le statut correspondant (OR a faire → receptionne)
-- ---------------------------------------------------------------------
create or replace function public.workshop_appointments_status_from_or()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _st text; _s text;
begin
  if new.or_id is null or (tg_op = 'UPDATE' and old.or_id is not distinct from new.or_id) then return new; end if;
  if new.status = 'annule' then return new; end if;
  select status into _st from public.repair_orders where id = new.or_id;
  _s := public.workshop_appointment_status_for_or(_st);
  if _s is not null then new.status := _s; end if;
  return new;
end $$;
revoke all on function public.workshop_appointments_status_from_or() from public, anon, authenticated;
drop trigger if exists trg_appointments_status_from_or on public.workshop_appointments;
create trigger trg_appointments_status_from_or before insert or update of or_id on public.workshop_appointments
  for each row execute function public.workshop_appointments_status_from_or();

-- ---------------------------------------------------------------------
-- 3. Q43 — l'OR passe « en cours » au premier pointage de travail
-- ---------------------------------------------------------------------
create or replace function public.workshop_time_entries_start_or()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.repair_orders%rowtype;
begin
  if new.kind <> 'travail' or new.or_id is null then return null; end if;
  select * into r from public.repair_orders where id = new.or_id;
  if not found or r.company_id <> new.company_id or r.status <> 'a_faire' then return null; end if;
  update public.repair_orders set status = 'en_cours' where id = r.id and status = 'a_faire';
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'repair_order_work_started', 'repair_orders', r.id::text, 'chrono',
          jsonb_build_object('status', r.status),
          jsonb_build_object('status', 'en_cours', 'time_entry_id', new.id, 'mechanic', coalesce(new.mechanic_name, new.mechanic_id::text)));
  return null;
end $$;
revoke all on function public.workshop_time_entries_start_or() from public, anon, authenticated;
drop trigger if exists trg_wte_start_or on public.workshop_time_entries;
create trigger trg_wte_start_or after insert on public.workshop_time_entries
  for each row execute function public.workshop_time_entries_start_or();

-- ---------------------------------------------------------------------
-- 4. Q43 — action explicite « Demarrer » (fiche OR)
-- ---------------------------------------------------------------------
create or replace function public.repair_order_start(_or uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.repair_orders%rowtype;
begin
  select * into r from public.repair_orders where id = _or for update;
  if not found then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
  if not public.is_member(r.company_id) then raise exception 'Acces refuse.' using errcode = '42501'; end if;
  if r.status = 'en_cours' then return r.status; end if;
  if r.status not in ('a_faire', 'attente_devis', 'attente_pieces') then
    raise exception 'OR % : il ne peut plus demarrer (statut %).', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;
  if coalesce(r.customer_approval, '') = 'en_attente' then
    raise exception 'OR % : accord du client en attente, le travail ne peut pas commencer.', coalesce(r.number, r.id::text) using errcode = '23514';
  end if;
  update public.repair_orders set status = 'en_cours' where id = r.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'repair_order_work_started', 'repair_orders', r.id::text, 'screen',
          jsonb_build_object('status', r.status), jsonb_build_object('status', 'en_cours'));
  return 'en_cours';
end $$;
revoke all on function public.repair_order_start(uuid) from public, anon;
grant execute on function public.repair_order_start(uuid) to authenticated;
