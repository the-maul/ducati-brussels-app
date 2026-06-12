-- =====================================================================
-- M3/M5 — Automatisations pg_cron : copies datées du stock (B4) le 15 et en fin
-- de mois + alerte stock dormant (> 4 mois sans mouvement). Tout en SQL planifié.
-- =====================================================================
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- Copie datée du stock pour TOUTES les sociétés (kind 'copie', B4).
-- Interne (pas de contrôle is_member) : exécutée par le planificateur.
-- ---------------------------------------------------------------------
create or replace function public._cron_stock_copies()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare _co record; _snap uuid; _label text; _n int := 0;
begin
  _label := 'Copie auto ' || to_char(now(), 'YYYY-MM-DD');
  for _co in select id from public.companies loop
    insert into public.stock_snapshots (company_id, kind, label) values (_co.id, 'copie', _label) returning id into _snap;
    insert into public.stock_snapshot_lines (snapshot_id, article_id, qty, pamp)
      select _snap, s.article_id, s.real_qty, s.pamp from public.article_stock_list(_co.id) s where s.real_qty <> 0;
    _n := _n + 1;
  end loop;
  return _n;
end $$;

-- Déclenche une copie UNIQUEMENT le 15 du mois ou le dernier jour du mois (B4).
create or replace function public._cron_maybe_stock_copy()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if extract(day from now())::int = 15
     or (now() + interval '1 day')::date = date_trunc('month', now() + interval '1 month')::date then
    perform public._cron_stock_copies();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Stock dormant : articles stockés (type A) avec stock réel > 0 et aucun mouvement
-- depuis _months mois. Sert au dashboard (M3) et à l'alerte mensuelle.
-- ---------------------------------------------------------------------
create or replace function public.dormant_stock(_company uuid, _months int default 4)
returns table(article_id uuid, reference text, designation text, real_qty numeric, last_move timestamptz, value_pamp numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.reference, a.designation,
    coalesce(sum(case when not m.is_reservation then m.qty_delta else 0 end), 0) as real_qty,
    max(m.occurred_at) as last_move,
    round(coalesce(sum(case when not m.is_reservation then m.qty_delta else 0 end), 0) * a.pamp, 2) as value_pamp
  from public.articles a
  left join public.stock_moves m on m.article_id = a.id
  where a.company_id = _company and (auth.uid() is null or public.is_member(_company)) and a.mgmt_type = 'A'
  group by a.id, a.reference, a.designation, a.pamp
  having coalesce(sum(case when not m.is_reservation then m.qty_delta else 0 end), 0) > 0
     and (max(m.occurred_at) is null or max(m.occurred_at) < now() - make_interval(months => _months))
  order by max(m.occurred_at) nulls first;
$$;
grant execute on function public.dormant_stock(uuid, int) to authenticated;

-- Alerte mensuelle : trace dans events un résumé du stock dormant par société.
create or replace function public._cron_dormant_alert()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _co record; _cnt int; _val numeric;
begin
  for _co in select id from public.companies loop
    select count(*), coalesce(sum(value_pamp), 0) into _cnt, _val from public.dormant_stock(_co.id, 4);
    if _cnt > 0 then
      insert into public.events (company_id, entity_type, entity_id, action, origin, new_data)
      values (_co.id, 'stock_alert', _co.id::text, 'dormant_stock', 'system',
              jsonb_build_object('count', _cnt, 'value_pamp', _val, 'threshold_months', 4, 'at', now()));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Planification pg_cron (jobname = upsert). Heures UTC.
--   stock-copies-daily : tous les jours 22:30 → copie si 15 ou fin de mois.
--   dormant-stock-alert : le 1er du mois 05:00 → alerte stock dormant.
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.schedule('stock-copies-daily', '30 22 * * *', $cron$ select public._cron_maybe_stock_copy(); $cron$);
  perform cron.schedule('dormant-stock-alert', '0 5 1 * *', $cron$ select public._cron_dormant_alert(); $cron$);
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
