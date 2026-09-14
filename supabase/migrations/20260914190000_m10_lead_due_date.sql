-- =====================================================================
-- M10 — Délai de traitement d'une demande (échéance sur la tâche CRM).
-- Réf. docs/plan-nouveau-client.md (retour client du 14/09).
--
-- Une tâche CRM n'avait aucune date : rien ne disait quand elle devenait urgente,
-- ni si personne ne l'avait traitée. On ajoute une échéance, repoussée à CHAQUE
-- échange avec le client, dans un sens comme dans l'autre.
--
--   `due_at`           : date limite de traitement.
--   `last_activity_at` : dernier échange connu.
--
-- Le délai est PARAMÉTRABLE (règle CLAUDE.md §10, pas de seuil en dur) :
-- Paramètres → Tables → `lead_sla`, champ `hours` (48 h par défaut).
--
-- Deux déclencheurs :
--   1. à la création d'une tâche, quelle qu'en soit l'origine (mail, site,
--      saisie manuelle), l'échéance est posée si elle n'a pas été fournie ;
--   2. à chaque communication journalisée sur le client (mail entrant OU
--      sortant), l'échéance de ses tâches ouvertes repart pour un tour.
-- Les tâches gagnées ou perdues ne sont jamais touchées.
-- =====================================================================

alter table public.leads add column if not exists due_at           timestamptz;
alter table public.leads add column if not exists last_activity_at timestamptz;

comment on column public.leads.due_at is
  'Date limite de traitement. Repoussee a chaque echange (voir trigger trg_comms_bump_lead_due).';

create index if not exists idx_leads_due
  on public.leads(company_id, due_at)
  where stage not in ('gagne', 'perdu');

-- ---------------------------------------------------------------------
-- Délai paramétrable, par société
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'lead_sla', 'default', 'Délai de traitement d''une demande (heures)', 1,
       '{"hours":48}'::jsonb
  from public.companies c
on conflict (company_id, table_key, code) do nothing;

create or replace function public.lead_sla_hours(_company uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select nullif(extra->>'hours', '')::int
       from public.reference_values
      where company_id = _company and table_key = 'lead_sla' and code = 'default' and is_active),
    48);
$fn$;
revoke execute on function public.lead_sla_hours(uuid) from public, anon;
grant  execute on function public.lead_sla_hours(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Toute nouvelle tâche reçoit une échéance
-- ---------------------------------------------------------------------
create or replace function public.set_lead_due_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.due_at is null and coalesce(new.stage, 'nouveau') not in ('gagne', 'perdu') then
    new.due_at := now() + make_interval(hours => public.lead_sla_hours(new.company_id));
  end if;
  if new.last_activity_at is null then
    new.last_activity_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists trg_leads_due on public.leads;
create trigger trg_leads_due before insert on public.leads
  for each row execute function public.set_lead_due_at();

-- ---------------------------------------------------------------------
-- 2. Chaque échange repousse l'échéance des tâches ouvertes du client
-- ---------------------------------------------------------------------
create or replace function public.bump_lead_due_on_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _h int;
begin
  if new.contact_id is null then return new; end if;
  _h := public.lead_sla_hours(new.company_id);
  update public.leads l
     set last_activity_at = coalesce(new.occurred_at, now()),
         due_at           = coalesce(new.occurred_at, now()) + make_interval(hours => _h),
         updated_at       = now()
   where l.company_id = new.company_id
     and l.contact_id = new.contact_id
     and l.stage not in ('gagne', 'perdu');
  return new;
end $fn$;

drop trigger if exists trg_comms_bump_lead_due on public.communications;
create trigger trg_comms_bump_lead_due after insert on public.communications
  for each row execute function public.bump_lead_due_on_activity();

-- ---------------------------------------------------------------------
-- Reprise de l'existant : les tâches ouvertes sans échéance en reçoivent une,
-- calculée depuis leur dernière modification connue.
-- ---------------------------------------------------------------------
update public.leads l
   set due_at = coalesce(l.updated_at, l.created_at)
                + make_interval(hours => public.lead_sla_hours(l.company_id)),
       last_activity_at = coalesce(l.last_activity_at, l.updated_at, l.created_at)
 where l.due_at is null
   and l.stage not in ('gagne', 'perdu');
