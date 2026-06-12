-- =====================================================================
-- M8 — Atelier (parité G8) : checklist d'OPÉRATIONS atelier réutilisable (cochables
-- sur un OR), TÂCHES hors-facturation (productivité B11), planning TAUX DE CHARGE %.
-- =====================================================================

-- Référentiel des opérations atelier (table de données G8, ~42 opérations).
create table if not exists public.workshop_operations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null,
  label       text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  unique (company_id, code)
);
alter table public.workshop_operations enable row level security;
drop policy if exists wops_all on public.workshop_operations;
create policy wops_all on public.workshop_operations for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Checklist d'opérations cochées sur un OR.
create table if not exists public.repair_order_operations (
  id           uuid primary key default gen_random_uuid(),
  or_id        uuid not null references public.repair_orders(id) on delete cascade,
  operation_id uuid not null references public.workshop_operations(id) on delete cascade,
  done         boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (or_id, operation_id)
);
alter table public.repair_order_operations enable row level security;
drop policy if exists roops_all on public.repair_order_operations;
create policy roops_all on public.repair_order_operations for all to authenticated
  using (exists (select 1 from public.repair_orders o where o.id = or_id and public.is_member(o.company_id)))
  with check (exists (select 1 from public.repair_orders o where o.id = or_id and public.is_member(o.company_id)));

-- Tâches hors-facturation (temps improductif, productivité B11).
create table if not exists public.workshop_tasks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  mechanic    text,
  task_type   text not null,                 -- nettoyage | formation | maintenance | reception | autre
  minutes     int not null default 0,
  occurred_at timestamptz not null default now(),
  notes       text
);
create index if not exists idx_wtasks_company on public.workshop_tasks(company_id, occurred_at);
alter table public.workshop_tasks enable row level security;
drop policy if exists wtasks_all on public.workshop_tasks;
create policy wtasks_all on public.workshop_tasks for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Planning : taux de charge % par jour = RDV planifiés / capacité (slots/jour).
create or replace function public.workshop_load(_company uuid, _from date, _to date, _capacity int default 8)
returns table(day date, appointments bigint, load_pct numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select ap.starts_at::date as day, count(*)::bigint,
         round(100.0 * count(*) / greatest(_capacity,1), 0) as load_pct
  from public.workshop_appointments ap
  where ap.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and ap.status <> 'annule' and ap.starts_at::date between _from and _to
  group by ap.starts_at::date
  order by ap.starts_at::date;
$$;
grant execute on function public.workshop_load(uuid, date, date, int) to authenticated;

-- Seed du référentiel d'opérations pour chaque société (idempotent).
do $$
declare _co record;
begin
  for _co in select id from public.companies loop
    insert into public.workshop_operations (company_id, code, label, sort_order)
    select _co.id, x.code, x.label, x.so from (values
      ('VIDANGE','Vidange / échange huile moteur',1),
      ('FILTRE_HUILE','Remplacement filtre à huile',2),
      ('FILTRE_AIR','Remplacement filtre à air',3),
      ('BOUGIES','Remplacement bougies',4),
      ('COURROIE','Courroie de transmission / distribution',5),
      ('FREIN_AV','Plaquettes de frein avant',6),
      ('FREIN_AR','Plaquettes de frein arrière',7),
      ('DISQUES','Disques de frein',8),
      ('LIQUIDE_FREIN','Purge liquide de frein',9),
      ('PNEU_AV','Pneu avant',10),
      ('PNEU_AR','Pneu arrière',11),
      ('CHAINE','Kit chaîne (chaîne + pignons)',12),
      ('EMBRAYAGE','Embrayage',13),
      ('DIRECTION','Roulements de direction',14),
      ('SUSPENSION','Réglage / révision suspension',15),
      ('ECLAIRAGE','Éclairage / signalisation',16),
      ('BATTERIE','Batterie',17),
      ('DIAGNOSTIC','Diagnostic électronique',18),
      ('CONTROLE','Contrôle général / sécurité',19),
      ('LAVAGE','Lavage / préparation',20)
    ) as x(code,label,so)
    on conflict (company_id, code) do nothing;
  end loop;
end $$;
