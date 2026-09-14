-- =====================================================================
-- LOT 0 — Chantier « nouveau client » : fondations de données.
-- Réf. docs/plan-nouveau-client.md
--
--   1. BOÎTES MAIL MULTIPLES par société, avec un curseur de relève PAR BOÎTE.
--      Aujourd'hui `companies.inbound_mailbox` est une adresse unique et les deux
--      curseurs (`inbound_last_check`, `sent_last_check`) sont portés par la société.
--      Avec deux boîtes (générale + shop@), un curseur unique ferait sauter des mails :
--      la boîte relevée en second hériterait de l'horodatage de la première.
--      L'ancienne colonne est conservée et recopiée ici (aucune rupture).
--   2. ORIGINE d'une fiche contact : mail | web | comptoir | manuel | import_g8.
--      `imported_from` existe déjà mais dit « importé depuis », ce qui ne veut rien
--      dire pour une fiche créée au comptoir. Colonne distincte, rétro-remplie.
--   3. INVITATIONS à créer un compte client : jeton à usage unique et daté.
--
-- company_id + RLS (is_member) partout, audit (audit_row → events), updated_at.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Boîtes mail d'écoute
-- ---------------------------------------------------------------------
create table if not exists public.company_mailboxes (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  address            text not null,                    -- ex. info@ducatibxl.be
  purpose            text not null default 'general',  -- 'general' | 'shop' | ...
  is_active          boolean not null default true,
  inbound_last_check timestamptz,                      -- curseur dossier Boîte de réception
  sent_last_check    timestamptz,                      -- curseur dossier Éléments envoyés
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists uq_company_mailboxes_address
  on public.company_mailboxes(company_id, lower(address));
create index if not exists idx_company_mailboxes_company
  on public.company_mailboxes(company_id, is_active);

comment on table public.company_mailboxes is
  'Boîtes Outlook écoutées par la relève (outlook-poll). Un curseur par boîte et par dossier.';

-- Reprise de l'existant : la boîte déjà configurée devient la boîte « general ».
insert into public.company_mailboxes (company_id, address, purpose, inbound_last_check, sent_last_check)
select c.id, c.inbound_mailbox, 'general', c.inbound_last_check, c.sent_last_check
  from public.companies c
 where c.inbound_mailbox is not null
   and btrim(c.inbound_mailbox) <> ''
on conflict do nothing;

-- Curseurs par boîte (équivalent de set_mail_cursors, qui reste en place pour la société).
create or replace function public.set_mailbox_cursors(_mailbox uuid, _in timestamptz, _sent timestamptz)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.company_mailboxes
     set inbound_last_check = coalesce(_in, inbound_last_check),
         sent_last_check    = coalesce(_sent, sent_last_check),
         updated_at         = now()
   where id = _mailbox;
$$;
revoke execute on function public.set_mailbox_cursors(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.set_mailbox_cursors(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Origine d'une fiche contact
-- ---------------------------------------------------------------------
alter table public.contacts add column if not exists origin text;

do $$ begin
  alter table public.contacts add constraint contacts_origin_chk
    check (origin is null or origin in ('mail', 'web', 'comptoir', 'manuel', 'import_g8'));
exception when duplicate_object then null; end $$;

comment on column public.contacts.origin is
  'Canal d''arrivée de la fiche : mail | web | comptoir | manuel | import_g8. Voir docs/plan-nouveau-client.md';

-- Rétro-remplissage : tout ce qui vient de la reprise G8.
update public.contacts
   set origin = 'import_g8'
 where origin is null
   and imported_from = 'G8';

create index if not exists idx_contacts_origin on public.contacts(company_id, origin);

-- ---------------------------------------------------------------------
-- 3. Invitations à créer un compte client
-- ---------------------------------------------------------------------
create table if not exists public.contact_invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  token       text not null,                 -- lu uniquement par une RPC security definer (lot 2)
  email       text not null,                 -- adresse à laquelle l'invitation a été envoyée
  expires_at  timestamptz not null default (now() + interval '30 days'),
  used_at     timestamptz,                   -- non nul = jeton consommé, ne resert jamais
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists uq_contact_invitations_token
  on public.contact_invitations(token);
create index if not exists idx_contact_invitations_contact
  on public.contact_invitations(contact_id);
create index if not exists idx_contact_invitations_company
  on public.contact_invitations(company_id, used_at);

comment on table public.contact_invitations is
  'Jetons d''invitation à créer un compte client. Usage unique (used_at), expiration (expires_at).';

-- ---------------------------------------------------------------------
-- 4. updated_at + audit (B7)
-- ---------------------------------------------------------------------
drop trigger if exists trg_company_mailboxes_updated on public.company_mailboxes;
create trigger trg_company_mailboxes_updated before update on public.company_mailboxes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_company_mailboxes_audit on public.company_mailboxes;
create trigger trg_company_mailboxes_audit after insert or update or delete on public.company_mailboxes
  for each row execute function public.audit_row();

drop trigger if exists trg_contact_invitations_updated on public.contact_invitations;
create trigger trg_contact_invitations_updated before update on public.contact_invitations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_contact_invitations_audit on public.contact_invitations;
create trigger trg_contact_invitations_audit after insert or update or delete on public.contact_invitations
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- 5. RLS (is_member sur company_id)
-- ---------------------------------------------------------------------
alter table public.company_mailboxes   enable row level security;
alter table public.contact_invitations enable row level security;

drop policy if exists company_mailboxes_all on public.company_mailboxes;
create policy company_mailboxes_all on public.company_mailboxes for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

drop policy if exists contact_invitations_all on public.contact_invitations;
create policy contact_invitations_all on public.contact_invitations for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
