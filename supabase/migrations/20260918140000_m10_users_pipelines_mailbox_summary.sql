-- M0 / M10 — Retours client du 18/09 sur la carte CRM (chantier « nouveau client »).
--
--   1. Plusieurs CRM : chaque demande appartient à un pipeline. Seul « commercial »
--      existe aujourd'hui ; « atelier » viendra quand on y travaillera.
--   2. La boîte qui a reçu (ou envoyé) chaque échange est retenue : c'est elle qu'on
--      propose par défaut pour répondre.
--   3. Chaque échange est résumé en un paragraphe ajouté à la note de la demande.
--      L'ajout est idempotent : un échange ne peut être résumé qu'une fois.
--   4. Un compte de connexion peut être rattaché à une fiche client (portail).
--   5. Le responsable par défaut des nouvelles demandes se règle depuis l'écran
--      Utilisateurs, avec reprise optionnelle des tâches ouvertes de l'ancien.

-- ---------------------------------------------------------------- 1. Pipelines
alter table public.leads
  add column if not exists pipeline text not null default 'commercial';
comment on column public.leads.pipeline is
  'CRM auquel appartient la demande : commercial (aujourd''hui), atelier (plus tard).';
create index if not exists idx_leads_pipeline_active
  on public.leads(company_id, pipeline) where archived_at is null;

-- ------------------------------------------------ 2 et 3. Échanges : boîte, résumé
alter table public.communications
  add column if not exists mailbox text,
  add column if not exists summarized_at timestamptz;
comment on column public.communications.mailbox is
  'Boîte de la concession qui a reçu (entrant) ou envoyé (sortant) cet e-mail.';
comment on column public.communications.summarized_at is
  'Moment où l''échange a été résumé dans la note de la demande. Null = pas encore.';

-- Ajoute un paragraphe à la note d'une demande, UNE SEULE FOIS par échange.
-- Le verrou est la mise à jour conditionnelle de summarized_at : deux relèves
-- concurrentes ne peuvent pas ajouter deux fois le même paragraphe.
create or replace function public.append_lead_exchange_note(_comm uuid, _lead uuid, _text text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.communications set summarized_at = now()
   where id = _comm and summarized_at is null;
  if not found then return false; end if;
  if coalesce(trim(_text), '') = '' then return true; end if;
  update public.leads
     set notes = coalesce(nullif(notes, '') || E'\n\n', '') || _text,
         last_activity_at = now()
   where id = _lead;
  return true;
end $$;
revoke all on function public.append_lead_exchange_note(uuid, uuid, text) from public, anon, authenticated;

-- ------------------------------------------ 4. Compte client ↔ fiche client
create table if not exists public.contact_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  contact_id uuid not null unique references public.contacts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
comment on table public.contact_accounts is
  'Compte de connexion d''un CLIENT, rattaché à sa fiche. Un client n''a aucun rôle : '
  'il ne voit donc aucune donnée de la concession, seulement la sienne (portail).';
alter table public.contact_accounts enable row level security;
drop policy if exists contact_accounts_member_read on public.contact_accounts;
create policy contact_accounts_member_read on public.contact_accounts
  for select using (public.is_member(company_id) or user_id = auth.uid());
-- Écritures : uniquement côté serveur (clé de service), via l'écran Utilisateurs.

-- --------------------------------------- 5. Responsable par défaut des demandes
-- Réservé aux administrateurs de la société. Le responsable doit en être membre.
-- Si _transfer, les tâches OUVERTES de l'ancien responsable par défaut lui sont
-- réattribuées. Renvoie le nombre de tâches reprises.
create or replace function public.set_default_assignee(_company uuid, _user uuid, _transfer boolean default false)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _old uuid; _n integer := 0;
begin
  if auth.uid() is not null and not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs de la société.';
  end if;
  if not exists (select 1 from public.user_roles where company_id = _company and user_id = _user) then
    raise exception 'Cette personne n''est pas membre de la société.';
  end if;

  _old := public.default_assignee(_company);

  insert into public.reference_values (company_id, table_key, code, label, extra, is_active)
  values (_company, 'lead_task', 'default_assignee', 'Responsable par défaut des nouvelles demandes',
          jsonb_build_object('user_id', _user), true)
  on conflict (company_id, table_key, code)
  do update set extra = excluded.extra, is_active = true, updated_at = now();

  if _transfer and _old is not null and _old <> _user then
    update public.lead_tasks set assigned_to = _user, updated_at = now()
     where company_id = _company and done_at is null and assigned_to = _old;
    get diagnostics _n = row_count;
  end if;
  return _n;
end $$;
revoke all on function public.set_default_assignee(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_default_assignee(uuid, uuid, boolean) to authenticated;
