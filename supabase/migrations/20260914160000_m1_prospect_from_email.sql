-- =====================================================================
-- LOT 1 — Chantier « nouveau client » : création d'un prospect depuis un mail.
-- Réf. docs/plan-nouveau-client.md
--
-- Aujourd'hui `ingest_email` renvoie `matched = false` sur un expéditeur inconnu
-- et ne crée rien : le prospect est perdu. On ajoute ici tout le côté base.
-- L'analyse du mail (est-ce un prospect ? quelles données ?) est faite par Claude
-- dans la fonction Edge `classify-prospect-email` ; cette migration ne fait que
-- persister son verdict, de façon idempotente.
--
--   1. contacts_match_candidates : recherche SOUPLE de fiches ressemblantes.
--      contacts_find_duplicates exige nom + ville + téléphone + e-mail TOUS les
--      quatre identiques. Sur un mail entrant on n'a ni ville ni téléphone :
--      cette fonction ne peut donc pas servir ici.
--   2. contact_merge_candidates : les rapprochements proposés, validés à la main.
--      Décision client D3 : jamais de fusion automatique.
--   3. create_prospect_from_email : fiche + lead + journal, en une transaction.
--   4. log_ignored_email : trace des mails écartés (fournisseur, newsletter…),
--      pour qu'aucun mail ne disparaisse sans laisser de trace.
--
-- company_id + RLS (is_member) partout, audit (audit_row → events), updated_at.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Recherche souple de fiches ressemblantes
-- ---------------------------------------------------------------------
-- Renvoie les fiches actives qui ressemblent à ce qu'on vient de recevoir, avec
-- le motif du rapprochement. Volontairement large : c'est un humain qui tranche.
create or replace function public.contacts_match_candidates(
  _company      uuid,
  _email        text,
  _name         text default null,   -- « prénom nom » tel qu'extrait du mail
  _company_name text default null,
  _phone        text default null,
  _exclude      uuid default null
)
returns table(contact_id uuid, reason text, display text)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
  select c.id,
         case
           when public.contact_norm_txt(c.email) = public.contact_norm_txt(_email)
             or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_email) then 'email'
           when _company_name is not null and _company_name <> ''
            and public.contact_norm_txt(c.company_name) = public.contact_norm_txt(_company_name) then 'societe'
           when _phone is not null and _phone <> ''
            and public.contact_norm_phone(_phone) in (
                  public.contact_norm_phone(c.mobile),
                  public.contact_norm_phone(c.phone),
                  public.contact_norm_phone(c.gsm)) then 'telephone'
           else 'nom'
         end as reason,
         btrim(coalesce(nullif(c.company_name, ''),
                        btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')))) as display
    from public.contacts c
   where c.company_id = _company
     and c.is_active
     and (_exclude is null or c.id <> _exclude)
     and (
          -- même adresse e-mail (principale ou professionnelle)
          (_email is not null and _email <> '' and (
              public.contact_norm_txt(c.email)     = public.contact_norm_txt(_email)
           or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_email)))
          -- même nom complet
       or (_name is not null and _name <> ''
           and public.contact_norm_txt(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')))
               = public.contact_norm_txt(_name))
          -- même société
       or (_company_name is not null and _company_name <> ''
           and public.contact_norm_txt(c.company_name) = public.contact_norm_txt(_company_name))
          -- même téléphone
       or (_phone is not null and _phone <> ''
           and public.contact_norm_phone(_phone) in (
                 public.contact_norm_phone(c.mobile),
                 public.contact_norm_phone(c.phone),
                 public.contact_norm_phone(c.gsm)))
     )
   order by c.created_at
   limit 20;
$fn$;
revoke execute on function public.contacts_match_candidates(uuid, text, text, text, text, uuid) from public, anon;
grant  execute on function public.contacts_match_candidates(uuid, text, text, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Rapprochements proposés (jamais appliqués automatiquement — décision D3)
-- ---------------------------------------------------------------------
create table if not exists public.contact_merge_candidates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  contact_id   uuid not null references public.contacts(id) on delete cascade,  -- la fiche nouvellement créée
  candidate_id uuid not null references public.contacts(id) on delete cascade,  -- la fiche qui lui ressemble
  reason       text not null,                    -- 'email' | 'nom' | 'societe' | 'telephone'
  resolution   text,                             -- null = à traiter | 'fusionne' | 'ignore'
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists uq_merge_candidates_pair
  on public.contact_merge_candidates(contact_id, candidate_id);
create index if not exists idx_merge_candidates_todo
  on public.contact_merge_candidates(company_id, resolution)
  where resolution is null;

comment on table public.contact_merge_candidates is
  'Rapprochements proposes entre une fiche creee automatiquement et une fiche existante. Validation manuelle obligatoire (decision client D3, 14/09/2026).';

-- ---------------------------------------------------------------------
-- 3. Création d'un prospect à partir d'un mail
-- ---------------------------------------------------------------------
-- Idempotent sur _external_id (identifiant du message Graph) : rejouer la relève
-- ne crée pas de doublon. Renvoie ce qui a été créé, ou l'existant.
--
-- _extract = objet JSON produit par l'analyse du mail :
--   { first_name, last_name, company_name, vat_number, phone, is_professional,
--     request_summary, interest }
create or replace function public.create_prospect_from_email(
  _company     uuid,
  _email       text,
  _subject     text,
  _body        text,
  _received    timestamptz,
  _external_id text,
  _extract     jsonb
)
returns table(contact_id uuid, lead_id uuid, communication_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  _cid    uuid;
  _lid    uuid;
  _commid uuid;
  _existing_comm uuid;
  _is_pro boolean := coalesce((_extract->>'is_professional')::boolean, false);
  _first  text := nullif(btrim(coalesce(_extract->>'first_name', '')), '');
  _last   text := nullif(btrim(coalesce(_extract->>'last_name', '')), '');
  _co     text := nullif(btrim(coalesce(_extract->>'company_name', '')), '');
  _phone  text := nullif(btrim(coalesce(_extract->>'phone', '')), '');
  _label  text;
begin
  if _email is null or btrim(_email) = '' then
    raise exception 'create_prospect_from_email: adresse e-mail manquante';
  end if;

  -- Idempotence : ce message a-t-il deja ete traite ?
  select c.id, c.contact_id into _existing_comm, _cid
    from public.communications c
   where c.company_id = _company and c.external_id = _external_id
   limit 1;
  if _existing_comm is not null then
    select l.id into _lid from public.leads l where l.contact_id = _cid order by l.created_at limit 1;
    return query select _cid, _lid, _existing_comm, false;
    return;
  end if;

  -- Garde-fou : si une fiche porte deja cette adresse, on ne cree rien de neuf.
  select id into _cid from public.contacts
   where company_id = _company
     and (lower(email) = lower(_email) or lower(email_pro) = lower(_email))
   order by created_at limit 1;

  if _cid is null then
    insert into public.contacts (
      company_id, type, status, origin, is_active,
      first_name, last_name, company_name, email, email_pro, mobile, notes
    ) values (
      _company,
      case when _is_pro then 'professionnel'::contact_type else 'particulier'::contact_type end,
      'prospect'::contact_status,
      'mail',
      true,
      _first,
      _last,
      _co,
      case when _is_pro then null else _email end,
      case when _is_pro then _email else null end,
      _phone,
      nullif(btrim(coalesce(_extract->>'request_summary', '')), '')
    )
    returning id into _cid;

    -- Rapprochements proposes (jamais appliques : decision D3).
    -- Pas de `on conflict (contact_id, ...)` ici : `contact_id` est AUSSI une colonne
    -- de sortie de cette fonction, donc une variable PL/pgSQL. Postgres ne sait pas
    -- laquelle viser dans la clause de conflit et refuse (42702). Un garde
    -- `not exists` entierement qualifie donne la meme idempotence sans ambiguite.
    insert into public.contact_merge_candidates (company_id, contact_id, candidate_id, reason)
    select _company, _cid, m.contact_id, m.reason
      from public.contacts_match_candidates(
             _company, _email,
             nullif(btrim(coalesce(_first,'') || ' ' || coalesce(_last,'')), ''),
             _co, _phone, _cid) m
     where not exists (
             select 1 from public.contact_merge_candidates x
              where x.contact_id = _cid and x.candidate_id = m.contact_id);
  end if;

  -- Journal du mail sur la fiche.
  insert into public.communications (
    company_id, contact_id, channel, direction, subject, body,
    occurred_at, external_id, from_address
  ) values (
    _company, _cid, 'email', 'in', _subject, _body,
    coalesce(_received, now()), _external_id, _email
  )
  returning id into _commid;

  -- Tache CRM : un lead a traiter.
  _label := coalesce(
    nullif(btrim(coalesce(_co, '')), ''),
    nullif(btrim(coalesce(_first, '') || ' ' || coalesce(_last, '')), ''),
    _email);

  insert into public.leads (
    company_id, contact_id, name, email, phone,
    vehicle_interest, source, stage, notes
  ) values (
    _company, _cid, _label, _email, _phone,
    nullif(btrim(coalesce(_extract->>'interest', '')), ''),
    'mail',
    'nouveau',
    nullif(btrim(coalesce(_extract->>'request_summary', '')), '')
  )
  returning id into _lid;

  return query select _cid, _lid, _commid, true;
end $fn$;
revoke execute on function public.create_prospect_from_email(uuid, text, text, text, timestamptz, text, jsonb) from public, anon;
grant  execute on function public.create_prospect_from_email(uuid, text, text, text, timestamptz, text, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 4. Trace des mails écartés
-- ---------------------------------------------------------------------
-- Un mail analysé et jugé « pas un prospect » laisse quand même une trace, sans
-- fiche client : `communications` accepte un contact_id nul. Idempotent lui aussi.
create or replace function public.log_ignored_email(
  _company     uuid,
  _email       text,
  _subject     text,
  _received    timestamptz,
  _external_id text,
  _verdict     text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _id uuid;
begin
  select id into _id from public.communications
   where company_id = _company and external_id = _external_id limit 1;
  if _id is not null then return _id; end if;

  insert into public.communications (
    company_id, contact_id, channel, direction, subject, body,
    occurred_at, external_id, from_address
  ) values (
    _company, null, 'email', 'in', _subject,
    'Mail ecarte par l''analyse : ' || coalesce(_verdict, 'non precise'),
    coalesce(_received, now()), _external_id, _email
  )
  returning id into _id;
  return _id;
end $fn$;
revoke execute on function public.log_ignored_email(uuid, text, text, timestamptz, text, text) from public, anon;
grant  execute on function public.log_ignored_email(uuid, text, text, timestamptz, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 5. updated_at + audit (B7) + RLS
-- ---------------------------------------------------------------------
drop trigger if exists trg_merge_candidates_updated on public.contact_merge_candidates;
create trigger trg_merge_candidates_updated before update on public.contact_merge_candidates
  for each row execute function public.set_updated_at();

drop trigger if exists trg_merge_candidates_audit on public.contact_merge_candidates;
create trigger trg_merge_candidates_audit after insert or update or delete on public.contact_merge_candidates
  for each row execute function public.audit_row();

alter table public.contact_merge_candidates enable row level security;

drop policy if exists contact_merge_candidates_all on public.contact_merge_candidates;
create policy contact_merge_candidates_all on public.contact_merge_candidates for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
