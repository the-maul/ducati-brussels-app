-- =====================================================================
-- M10 — La tâche devient un objet à part, rattaché à la demande.
-- Réf. docs/plan-nouveau-client.md (correction structurelle du 14/09).
--
-- CE QUI N'ALLAIT PAS
-- « Créer une tâche de suivi » créait une NOUVELLE DEMANDE. Chaque relance
-- dupliquait donc la carte du client, et le pipeline se remplissait de doublons.
--
-- LE MODÈLE CORRECT
-- Une demande = une carte = un client. Elle porte :
--   · UNE SEULE tâche ouverte à la fois (titre, échéance, personne assignée) ;
--   · l'historique des tâches faites, en liste chronologique ;
--   · les échanges avec le client et les documents (déjà en place).
-- On ne crée jamais une deuxième carte pour le même fil : on ferme la tâche
-- courante et on en ouvre une nouvelle SUR LA MÊME CARTE.
--
-- GARANTIE ANTI-DOUBLON : un index unique partiel interdit deux tâches ouvertes
-- sur une même demande. La base refuse le doublon, ce n'est pas qu'une règle d'écran.
--
-- La personne assignée n'est JAMAIS vide (contrainte NOT NULL). Quand c'est
-- l'automatisation qui ouvre la tâche, elle la confie au destinataire par défaut :
-- celui réglé dans Paramètres → Tables → `lead_task` / `default_assignee`, sinon
-- le plus ancien administrateur de la société.
--
-- L'échéance appartient désormais à la TÂCHE, plus à la demande. Les deux
-- déclencheurs posés plus tôt dans la journée sur `leads` et `communications`
-- sont donc supprimés : un échange avec le client ne doit pas déplacer en silence
-- la date d'une tâche décidée par un humain. `leads.due_at` et `leads.assigned_to`
-- restent alimentés, mais par recopie depuis la tâche ouverte, afin que la cloche,
-- la pastille du pipeline et la liste des retards continuent de fonctionner.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. La table
-- ---------------------------------------------------------------------
create table if not exists public.lead_tasks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  title       text not null,
  due_at      timestamptz not null,
  assigned_to uuid not null references auth.users(id) on delete restrict,
  done_at     timestamptz,
  done_by     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Une seule tâche OUVERTE par demande. C'est la garantie anti-doublon.
create unique index if not exists uq_lead_tasks_open
  on public.lead_tasks(lead_id) where done_at is null;
create index if not exists idx_lead_tasks_lead on public.lead_tasks(lead_id, created_at desc);
create index if not exists idx_lead_tasks_open_due
  on public.lead_tasks(company_id, due_at) where done_at is null;

comment on table public.lead_tasks is
  'Taches d''une demande. Une seule ouverte a la fois (uq_lead_tasks_open). Remplace la creation de nouvelles demandes, qui dupliquait les cartes.';

-- ---------------------------------------------------------------------
-- 2. Destinataire par défaut : la tâche n'est jamais sans responsable
-- ---------------------------------------------------------------------
create or replace function public.default_assignee(_company uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(
    -- 1) réglage explicite
    (select nullif(rv.extra->>'user_id', '')::uuid
       from public.reference_values rv
      where rv.company_id = _company and rv.table_key = 'lead_task'
        and rv.code = 'default_assignee' and rv.is_active),
    -- 2) à défaut, le plus ancien administrateur de la société
    (select ur.user_id from public.user_roles ur
      where ur.company_id = _company and ur.role = 'admin'
      order by ur.created_at limit 1)
  );
$fn$;
revoke execute on function public.default_assignee(uuid) from public, anon;
grant  execute on function public.default_assignee(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. La demande reflète sa tâche ouverte
-- ---------------------------------------------------------------------
create or replace function public.sync_lead_from_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _lead uuid; _due timestamptz; _who uuid;
begin
  _lead := coalesce(new.lead_id, old.lead_id);
  select t.due_at, t.assigned_to into _due, _who
    from public.lead_tasks t
   where t.lead_id = _lead and t.done_at is null
   limit 1;
  update public.leads l
     set due_at = _due, assigned_to = _who, updated_at = now()
   where l.id = _lead;
  return null;
end $fn$;

drop trigger if exists trg_lead_tasks_sync on public.lead_tasks;
create trigger trg_lead_tasks_sync after insert or update or delete on public.lead_tasks
  for each row execute function public.sync_lead_from_task();

drop trigger if exists trg_lead_tasks_updated on public.lead_tasks;
create trigger trg_lead_tasks_updated before update on public.lead_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists trg_lead_tasks_audit on public.lead_tasks;
create trigger trg_lead_tasks_audit after insert or update or delete on public.lead_tasks
  for each row execute function public.audit_row();

alter table public.lead_tasks enable row level security;
drop policy if exists lead_tasks_all on public.lead_tasks;
create policy lead_tasks_all on public.lead_tasks for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 4. L'échéance appartient à la tâche : on retire les déclencheurs de la journée
-- ---------------------------------------------------------------------
drop trigger if exists trg_comms_bump_lead_due on public.communications;
drop trigger if exists trg_leads_due on public.leads;

-- ---------------------------------------------------------------------
-- 5. Reprise : une tâche ouverte pour chaque demande en cours qui n'en a pas
-- ---------------------------------------------------------------------
insert into public.lead_tasks (company_id, lead_id, title, due_at, assigned_to)
select l.company_id, l.id, 'Recontacter le client',
       coalesce(l.due_at, now() + interval '2 days'),
       coalesce(l.assigned_to, public.default_assignee(l.company_id))
  from public.leads l
 where l.stage not in ('gagne', 'perdu')
   and public.default_assignee(l.company_id) is not null
   and not exists (select 1 from public.lead_tasks t where t.lead_id = l.id and t.done_at is null);
