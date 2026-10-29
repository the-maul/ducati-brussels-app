-- =====================================================================
-- M8 / M9 — Check-up a l'accueil, proposition d'intervention, accord client signe,
-- interventions reportees (ATE008, ATE009, decision client du 30/10/2026).
--
-- Parcours valide par Simon (30/10) :
--   accueil de la moto avec un MOTIF D'ENTREE → l'atelier fait un CHECK-UP (une carte par
--   action : etat OK / a faire / a prevoir, photo, temps, pieces, prix) → « Envoyer la
--   proposition » cree un devis « Proposition d'intervention » relie a l'OR, envoye par mail
--   et visible dans l'espace client → le client coche ce qu'il garde et SIGNE (nom tape a
--   distance, ou trace au doigt sur la tablette du comptoir) → le document passe accepte,
--   les lignes decochees deviennent des INTERVENTIONS REPORTEES, l'OR passe « signe » →
--   aucune intervention ne demarre sans accord trace (signature ou accord verbal note) →
--   a la facturation, le comptoir fixe une date pour les interventions reportees (+30 j).
--
-- STRICTEMENT ADDITIVE : colonnes nullables, une table, des fonctions. Aucune ligne
-- existante modifiee. Les ecritures passent par des fonctions SQL transactionnelles
-- (piege §7 de M08 : `writeLines` reecrivait les lignes en deux appels non atomiques).
--
-- NE PAS APPLIQUER depuis un agent. Essai a blanc :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f <ce fichier>
--   (entre begin; et rollback;). Application par le client :
--   npx supabase@2.117.0 db push --linked --project-ref ujmrosbgkvgvwfnuryna
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Motif d'entree de la moto : table de reference `workshop_reason`
--    (Parametres → Tables → Atelier), prechargee pour chaque societe.
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order)
select c.id, 'workshop_reason', v.code, v.label, v.sort
  from public.companies c
 cross join (values
   ('entretien_annuel', 'Entretien annuel', 10),
   ('entretien_1000',   'Entretien 1 000 km', 20),
   ('entretien_15000',  'Entretien 15 000 km', 30),
   ('entretien_30000',  'Entretien 30 000 km', 40),
   ('vidange',          'Vidange', 50),
   ('pneus',            'Pneus', 60),
   ('freins',           'Freins', 70),
   ('accident',         'Accident', 80),
   ('garantie',         'Garantie', 90),
   ('diagnostic',       'Diagnostic', 100),
   ('autre',            'Autre', 110)
 ) as v(code, label, sort)
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Ordre de reparation : motif, accord client, proposition reliee
-- ---------------------------------------------------------------------
alter table public.repair_orders
  add column if not exists reason_code          text,
  add column if not exists customer_approval    text,
  add column if not exists approval_at          timestamptz,
  add column if not exists approval_by          uuid references auth.users(id) on delete set null,
  add column if not exists approval_by_name     text,
  add column if not exists approval_channel     text,
  add column if not exists approval_note        text,
  add column if not exists proposal_document_id uuid references public.documents(id) on delete set null;

alter table public.repair_orders drop constraint if exists repair_orders_customer_approval_check;
alter table public.repair_orders
  add constraint repair_orders_customer_approval_check
  check (customer_approval is null or customer_approval in ('en_attente', 'signe', 'accord_verbal', 'refuse'));

comment on column public.repair_orders.reason_code is
  'Motif d''entree de la moto (reference_values, table_key = workshop_reason) : entretien_annuel, entretien_15000, pneus, freins…';
comment on column public.repair_orders.customer_approval is
  'Accord du client sur la proposition d''intervention : null = aucune proposition, en_attente, signe (signature electronique), accord_verbal (telephone, note par le vendeur), refuse. Regle M08 : aucune intervention du check-up ne demarre tant que l''accord est en attente.';
comment on column public.repair_orders.approval_channel is
  'Comment l''accord a ete obtenu : signature_distance, signature_comptoir, telephone, comptoir, mail.';

-- ---------------------------------------------------------------------
-- 3. Lignes de l'OR : etat du check-up, photo (GED), lien vers la proposition
--    Une CARTE du check-up = une ligne main-d'oeuvre (libelle, heures) + ses lignes
--    pieces, reunies par `checkup_key` (cle stable, posee par l'ecran).
-- ---------------------------------------------------------------------
alter table public.repair_order_lines
  add column if not exists checkup_key      text,
  add column if not exists checkup_state    text,
  add column if not exists photo_path       text,
  add column if not exists proposal_line_id uuid references public.document_lines(id) on delete set null;

alter table public.repair_order_lines drop constraint if exists repair_order_lines_checkup_state_check;
alter table public.repair_order_lines
  add constraint repair_order_lines_checkup_state_check
  check (checkup_state is null or checkup_state in ('ok', 'a_faire', 'a_prevoir', 'reporte'));

create index if not exists idx_rolines_proposal_line on public.repair_order_lines(proposal_line_id) where proposal_line_id is not null;

comment on column public.repair_order_lines.checkup_state is
  'Etat constate au check-up : ok (rien a faire), a_faire (urgent), a_prevoir (peut attendre), reporte (decoche par le client a la signature → deferred_interventions). null = ligne classique.';
comment on column public.repair_order_lines.photo_path is
  'Chemin dans le bucket ged de la photo prise sur cette action (pas de base64 en base).';

-- ---------------------------------------------------------------------
-- 4. Documents : proposition d'intervention reliee a l'OR, acceptation, jeton signe
-- ---------------------------------------------------------------------
alter table public.documents
  add column if not exists repair_order_id       uuid references public.repair_orders(id) on delete set null,
  add column if not exists doc_kind              text,
  add column if not exists accepted_at           timestamptz,
  add column if not exists accepted_signature_id uuid,
  add column if not exists sign_token            text,
  add column if not exists sign_token_expires_at timestamptz;

create unique index if not exists documents_sign_token_uniq on public.documents(sign_token) where sign_token is not null;
create index if not exists idx_documents_repair_order on public.documents(repair_order_id) where repair_order_id is not null;

comment on column public.documents.doc_kind is
  'Sous-type d''un document : proposition_intervention = devis issu du check-up atelier (ATE009), signe par le client.';
comment on column public.documents.sign_token is
  'Jeton du lien de signature /signer/<jeton> (64 hexa, duree limitee par sign_token_expires_at). Jamais devine : genere en base.';

alter table public.document_lines
  add column if not exists checkup_key text,
  add column if not exists accepted    boolean,
  add column if not exists photo_path  text;

comment on column public.document_lines.accepted is
  'Proposition d''intervention : true = gardee par le client a la signature, false = decochee (→ intervention reportee), null = pas encore decide.';

-- ---------------------------------------------------------------------
-- 5. Signatures : ce qu'on enregistre (deux modes)
-- ---------------------------------------------------------------------
alter table public.document_signatures
  add column if not exists mode               text,
  add column if not exists user_agent         text,
  add column if not exists accepted_text      text,
  add column if not exists accepted_text_hash text,
  add column if not exists signed_by          uuid references auth.users(id) on delete set null,
  add column if not exists kept_line_ids      uuid[];

alter table public.document_signatures drop constraint if exists document_signatures_mode_check;
alter table public.document_signatures
  add constraint document_signatures_mode_check check (mode is null or mode in ('distance', 'comptoir'));

comment on column public.document_signatures.mode is
  'distance = nom tape + « J''accepte et je signe » depuis le lien recu ; comptoir = trace au doigt sur la tablette (signature_data = image PNG).';
comment on column public.document_signatures.accepted_text_hash is
  'Empreinte SHA-256 du texte exact accepte (lignes gardees, total, phrase d''acceptation).';

-- ---------------------------------------------------------------------
-- 6. Interventions reportees (lues aussi par l'agent « relances marketing » :
--    garder EXACTEMENT ces colonnes)
-- ---------------------------------------------------------------------
create table if not exists public.deferred_interventions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  vehicle_id       uuid references public.vehicles(id) on delete set null,
  contact_id       uuid references public.contacts(id) on delete set null,
  repair_order_id  uuid references public.repair_orders(id) on delete set null,
  document_id      uuid references public.documents(id) on delete set null,
  document_line_id uuid references public.document_lines(id) on delete set null,
  label            text not null,
  amount_ttc       numeric(14,2) not null default 0,
  planned_date     date,
  status           text not null default 'a_planifier',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint deferred_interventions_status_check
    check (status in ('a_planifier', 'planifie', 'relance', 'fait', 'abandonne'))
);
create index if not exists idx_deferred_company_status on public.deferred_interventions(company_id, status);
create index if not exists idx_deferred_vehicle on public.deferred_interventions(vehicle_id);
create index if not exists idx_deferred_contact on public.deferred_interventions(contact_id);

comment on table public.deferred_interventions is
  'Interventions proposees au check-up et decochees par le client a la signature. a_planifier → planifie (date fixee au comptoir, +30 j par defaut) → relance (agent marketing) → fait / abandonne.';

drop trigger if exists trg_deferred_updated on public.deferred_interventions;
create trigger trg_deferred_updated before update on public.deferred_interventions
  for each row execute function public.set_updated_at();
drop trigger if exists trg_deferred_audit on public.deferred_interventions;
create trigger trg_deferred_audit after insert or update or delete on public.deferred_interventions
  for each row execute function public.audit_row();

alter table public.deferred_interventions enable row level security;
drop policy if exists deferred_all on public.deferred_interventions;
create policy deferred_all on public.deferred_interventions for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 7. Cloche : nouveau type d'alerte « proposition signee » (meme motif que 20260919265000)
-- ---------------------------------------------------------------------
do $do$
declare
  _def text;
  _kinds text[];
begin
  select pg_get_constraintdef(c.oid) into _def
    from pg_constraint c
   where c.conrelid = 'public.team_notifications'::regclass
     and c.conname = 'team_notifications_kind_check';
  select array_agg(distinct k order by k) into _kinds
    from (
      select (regexp_matches(coalesce(_def, ''), '''([a-z_]+)''', 'g'))[1] as k
      union select 'signup'
      union select 'proposal_signed'
    ) x;
  alter table public.team_notifications drop constraint if exists team_notifications_kind_check;
  execute format(
    'alter table public.team_notifications add constraint team_notifications_kind_check check (kind = any (%L::text[]))',
    _kinds);
end $do$;

-- ---------------------------------------------------------------------
-- 8. Lignes de l'OR reecrites EN UNE TRANSACTION (piege §7)
--    _lines : tableau JSON des lignes dans l'ordre d'affichage.
-- ---------------------------------------------------------------------
create or replace function public.repair_order_write_lines(_or uuid, _lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.repair_orders%rowtype;
  n integer := 0;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then
    raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(r.company_id) then
    raise exception 'Acces refuse a la societe %', r.company_id using errcode = '42501';
  end if;
  if r.status = 'facture' then
    raise exception 'OR facture : les lignes ne se modifient plus.' using errcode = 'P0001';
  end if;

  delete from public.repair_order_lines where or_id = _or;

  insert into public.repair_order_lines
    (or_id, kind, article_id, designation, quantity, unit_price_ht, vat_rate, discount_pct, is_warranty,
     line_ht, line_ttc, sort_order, checkup_key, checkup_state, photo_path, proposal_line_id)
  select _or,
         coalesce(l->>'kind', 'piece'),
         nullif(l->>'article_id', '')::uuid,
         coalesce(l->>'designation', ''),
         coalesce((l->>'quantity')::numeric, 1),
         coalesce((l->>'unit_price_ht')::numeric, 0),
         coalesce((l->>'vat_rate')::numeric, 21),
         coalesce((l->>'discount_pct')::numeric, 0),
         coalesce((l->>'is_warranty')::boolean, false),
         coalesce((l->>'line_ht')::numeric, 0),
         coalesce((l->>'line_ttc')::numeric, 0),
         (ord - 1)::int,
         nullif(l->>'checkup_key', ''),
         nullif(l->>'checkup_state', ''),
         nullif(l->>'photo_path', ''),
         nullif(l->>'proposal_line_id', '')::uuid
    from jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) with ordinality as x(l, ord);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.repair_order_write_lines(uuid, jsonb) from public, anon;
grant execute on function public.repair_order_write_lines(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Jeton de signature (64 hexa, aleatoire, duree limitee)
-- ---------------------------------------------------------------------
create or replace function public._proposal_new_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;
revoke all on function public._proposal_new_token() from public, anon, authenticated;

-- Totaux de la proposition recalcules sur les lignes gardees (accepted <> false).
create or replace function public._proposal_recompute_totals(_document uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _ht numeric; _ttc numeric;
begin
  select coalesce(sum(line_ht), 0), coalesce(sum(line_ttc), 0) into _ht, _ttc
    from public.document_lines where document_id = _document and accepted is distinct from false;
  update public.documents
     set total_ht = round(_ht, 2), total_ttc = round(_ttc, 2), total_vat = round(_ttc - _ht, 2)
   where id = _document;
end $$;
revoke all on function public._proposal_recompute_totals(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. « Envoyer la proposition » : devis « Proposition d'intervention » cree depuis l'OR
--     (lignes a_faire + a_prevoir), numerote DEV, relie a l'OR, jeton de signature.
--     Une proposition precedente non signee est annulee et remplacee.
-- ---------------------------------------------------------------------
create or replace function public.proposal_create_from_or(_or uuid, _days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.repair_orders%rowtype;
  did    uuid;
  num    text;
  tok    text;
  n      integer := 0;
  l      record;
  lid    uuid;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then
    raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(r.company_id) then
    raise exception 'Acces refuse a la societe %', r.company_id using errcode = '42501';
  end if;
  if r.contact_id is null then
    raise exception 'proposal: client requis' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.repair_order_lines
                  where or_id = _or and checkup_state in ('a_faire', 'a_prevoir')) then
    raise exception 'proposal: aucune action a proposer' using errcode = 'P0001';
  end if;

  -- Proposition precedente non signee : annulee (l'historique reste).
  update public.documents
     set status = 'annulee', sign_token = null, sign_token_expires_at = null
   where repair_order_id = _or and doc_kind = 'proposition_intervention'
     and accepted_at is null and status <> 'annulee';

  num := public.next_document_number(r.company_id, 'DEV');
  tok := public._proposal_new_token();

  insert into public.documents
    (company_id, doc_type, number, contact_id, vehicle_id, status, issue_date,
     notes, repair_order_id, doc_kind, sign_token, sign_token_expires_at, price_mode)
  values
    (r.company_id, 'DEV', num, r.contact_id, r.vehicle_id, 'validee', current_date,
     'Proposition d''intervention - OR ' || coalesce(r.number, ''), _or, 'proposition_intervention',
     tok, now() + make_interval(days => greatest(1, coalesce(_days, 30))), coalesce(r.price_mode, 'ttc'))
  returning id into did;

  for l in
    select * from public.repair_order_lines
     where or_id = _or and checkup_state in ('a_faire', 'a_prevoir')
     order by sort_order, created_at
  loop
    insert into public.document_lines
      (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate,
       discount_pct, line_ht, line_ttc, sort_order, checkup_key, photo_path)
    values
      (did,
       case when l.kind = 'piece' then l.article_id end,
       l.designation,
       (select a.reference from public.articles a where a.id = l.article_id),
       case when l.kind = 'mo' then 'main_oeuvre' when l.kind = 'texte' then 'texte' else 'article' end,
       case when l.kind = 'texte' then 0 else l.quantity end,
       case when l.is_warranty or l.kind = 'texte' then 0 else l.unit_price_ht end,
       l.vat_rate,
       case when l.kind = 'texte' then 0 else l.discount_pct end,
       l.line_ht, l.line_ttc, n, l.checkup_key, l.photo_path)
    returning id into lid;
    update public.repair_order_lines set proposal_line_id = lid where id = l.id;
    n := n + 1;
  end loop;

  perform public._proposal_recompute_totals(did);

  update public.repair_orders
     set proposal_document_id = did, customer_approval = 'en_attente',
         approval_at = null, approval_by = null, approval_by_name = null, approval_channel = null, approval_note = null
   where id = _or;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (r.company_id, auth.uid(), 'proposal_created', 'repair_order', _or::text, 'screen',
          jsonb_build_object('document_id', did, 'number', num, 'lines', n));

  return jsonb_build_object('document_id', did, 'number', num, 'token', tok, 'lines', n);
end $$;

revoke all on function public.proposal_create_from_or(uuid, integer) from public, anon;
grant execute on function public.proposal_create_from_or(uuid, integer) to authenticated;

-- Lien de signature d'une proposition (nouveau jeton si absent ou expire). Comptoir :
-- « Faire signer sur la tablette » ouvre /signer/<jeton>?mode=comptoir.
create or replace function public.proposal_sign_link(_document uuid, _days integer default 30)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare d public.documents%rowtype; tok text;
begin
  select * into d from public.documents where id = _document;
  if not found then raise exception 'Document introuvable.' using errcode = 'P0002'; end if;
  if not public.is_member(d.company_id) then
    raise exception 'Acces refuse a la societe %', d.company_id using errcode = '42501';
  end if;
  if d.doc_kind is distinct from 'proposition_intervention' then
    raise exception 'proposal: pas une proposition' using errcode = 'P0001';
  end if;
  if d.sign_token is null or d.sign_token_expires_at is null or d.sign_token_expires_at < now() then
    tok := public._proposal_new_token();
    update public.documents
       set sign_token = tok, sign_token_expires_at = now() + make_interval(days => greatest(1, coalesce(_days, 30)))
     where id = _document;
    return tok;
  end if;
  return d.sign_token;
end $$;

revoke all on function public.proposal_sign_link(uuid, integer) from public, anon;
grant execute on function public.proposal_sign_link(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Lecture d'une proposition par son jeton (fonction serveur proposal-sign, cle de
--     service SEULEMENT : jamais ouverte au navigateur).
-- ---------------------------------------------------------------------
create or replace function public.proposal_by_token(_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare d public.documents%rowtype; r jsonb;
begin
  if _token is null or length(_token) < 32 then return null; end if;
  select * into d from public.documents where sign_token = _token and doc_kind = 'proposition_intervention';
  if not found then return null; end if;

  select jsonb_build_object(
    'document_id', d.id, 'number', d.number, 'issue_date', d.issue_date, 'created_at', d.created_at,
    'status', case when d.status = 'annulee' then 'annulee'
                   when d.accepted_at is not null then 'accepte'
                   when d.sign_token_expires_at < now() then 'expire'
                   else 'en_attente' end,
    'accepted_at', d.accepted_at,
    'expires_at', d.sign_token_expires_at,
    'total_ht', d.total_ht, 'total_vat', d.total_vat, 'total_ttc', d.total_ttc,
    'notes', d.notes,
    'operator', d.operator,
    'company', (select jsonb_build_object(
        'id', co.id, 'name', co.name, 'legal_name', co.legal_name, 'address', co.address, 'zip', co.zip,
        'city', co.city, 'vat_number', co.vat_number, 'iban', co.iban, 'bic', co.bic,
        'invoice_footer', co.invoice_footer, 'cgv_text', co.cgv_text, 'logo_url', co.logo_url,
        'inbound_mailbox', co.inbound_mailbox)
      from public.companies co where co.id = d.company_id),
    'contact', (select jsonb_build_object(
        'id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'company_name', c.company_name,
        'email', c.email, 'locale', c.locale, 'address', c.address, 'street_number', c.street_number,
        'zip', c.zip, 'city', c.city, 'country', c.country, 'legacy_code', c.legacy_code)
      from public.contacts c where c.id = d.contact_id),
    'vehicle', (select jsonb_build_object(
        'id', v.id, 'brand', v.brand, 'model', v.model, 'vin', v.vin, 'plate', v.plate, 'mileage', v.mileage)
      from public.vehicles v where v.id = d.vehicle_id),
    'repair_order', (select jsonb_build_object('id', o.id, 'number', o.number, 'mileage', o.mileage, 'reason_code', o.reason_code)
      from public.repair_orders o where o.id = d.repair_order_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'line_type', l.line_type, 'reference', l.reference, 'designation', l.designation,
        'quantity', l.quantity, 'unit_price_ht', l.unit_price_ht, 'vat_rate', l.vat_rate,
        'discount_pct', l.discount_pct, 'line_ht', l.line_ht, 'line_ttc', l.line_ttc,
        'sort_order', l.sort_order, 'checkup_key', l.checkup_key, 'accepted', l.accepted,
        'photo_path', l.photo_path,
        'designation_i18n', (select a.designation_i18n from public.articles a where a.id = l.article_id))
        order by l.sort_order, l.created_at)
      from public.document_lines l where l.document_id = d.id), '[]'::jsonb),
    'signature', (select jsonb_build_object(
        'id', s.id, 'signer_name', s.signer_name, 'signed_at', s.signed_at, 'mode', s.mode,
        'signed_ip', s.signed_ip, 'accepted_text_hash', s.accepted_text_hash,
        'signature_data', case when s.mode = 'comptoir' then s.signature_data end)
      from public.document_signatures s where s.id = d.accepted_signature_id)
  ) into r;
  return r;
end $$;

revoke all on function public.proposal_by_token(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 12. Signature appliquee EN UNE TRANSACTION (fonction serveur, cle de service seulement)
--     _kept : identifiants des lignes gardees (une ligne gardee garde toute sa carte).
--     Resultat : document accepte (totaux sur les lignes gardees), signature enregistree,
--     lignes decochees → deferred_interventions (a_planifier) + lignes OR « reporte »,
--     OR customer_approval = signe, evenement, alerte cloche.
-- ---------------------------------------------------------------------
create or replace function public.proposal_apply_signature(
  _token text, _kept uuid[], _signer_name text, _mode text, _signature_data text,
  _ip text, _user_agent text, _accepted_text text, _signed_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d        public.documents%rowtype;
  o        public.repair_orders%rowtype;
  sid      uuid;
  hsh      text;
  kept_keys text[];
  kept_all uuid[];
  n_kept   integer := 0;
  n_def    integer := 0;
  def_ids  uuid[] := '{}';
  g        record;
  did      uuid;
  cemail   text;
  cloc     text;
  cname    text;
begin
  if _mode not in ('distance', 'comptoir') then
    raise exception 'proposal: mode inconnu' using errcode = 'P0001';
  end if;
  if coalesce(trim(_signer_name), '') = '' then
    raise exception 'proposal: nom du signataire requis' using errcode = 'P0001';
  end if;
  if _mode = 'comptoir' and coalesce(_signature_data, '') = '' then
    raise exception 'proposal: signature tracee requise' using errcode = 'P0001';
  end if;

  select * into d from public.documents
   where sign_token = _token and doc_kind = 'proposition_intervention' for update;
  if not found then raise exception 'proposal: lien inconnu' using errcode = 'P0002'; end if;
  if d.status = 'annulee' then raise exception 'proposal: proposition annulee' using errcode = 'P0001'; end if;
  if d.accepted_at is not null then raise exception 'proposal: deja signee' using errcode = 'P0001'; end if;
  if d.sign_token_expires_at is null or d.sign_token_expires_at < now() then
    raise exception 'proposal: lien expire' using errcode = 'P0001';
  end if;

  -- Une ligne gardee garde toute sa carte (meme checkup_key).
  select array_agg(distinct checkup_key) into kept_keys
    from public.document_lines
   where document_id = d.id and id = any(coalesce(_kept, '{}')) and checkup_key is not null;
  select array_agg(id) into kept_all
    from public.document_lines
   where document_id = d.id
     and (id = any(coalesce(_kept, '{}')) or (checkup_key is not null and checkup_key = any(coalesce(kept_keys, '{}'))));
  kept_all := coalesce(kept_all, '{}');

  update public.document_lines set accepted = (id = any(kept_all)) where document_id = d.id;
  select count(*) into n_kept from public.document_lines where document_id = d.id and accepted;

  -- Empreinte du texte accepte : SHA-256 (pgcrypto), sinon MD5.
  begin
    hsh := encode(extensions.digest(convert_to(coalesce(_accepted_text, ''), 'UTF8'), 'sha256'), 'hex');
  exception when undefined_function or invalid_schema_name then
    hsh := md5(coalesce(_accepted_text, ''));
  end;

  insert into public.document_signatures
    (company_id, document_id, repair_order_id, signer_name, signature_data, signed_at, signed_ip,
     mode, user_agent, accepted_text, accepted_text_hash, signed_by, kept_line_ids)
  values
    (d.company_id, d.id, d.repair_order_id, trim(_signer_name),
     case when _mode = 'comptoir' then _signature_data end, now(), _ip,
     _mode, left(_user_agent, 500), _accepted_text, hsh, _signed_by, kept_all)
  returning id into sid;

  update public.documents
     set accepted_at = now(), accepted_signature_id = sid
   where id = d.id;
  perform public._proposal_recompute_totals(d.id);

  -- Lignes decochees : une intervention reportee par carte (ou par ligne isolee).
  for g in
    select coalesce(l.checkup_key, l.id::text) as grp,
           (array_agg(l.id order by l.sort_order, l.created_at))[1] as head_id,
           (array_agg(l.designation order by l.sort_order, l.created_at))[1] as head_label,
           sum(l.line_ttc) as ttc
      from public.document_lines l
     where l.document_id = d.id and not coalesce(l.accepted, false)
     group by coalesce(l.checkup_key, l.id::text)
  loop
    insert into public.deferred_interventions
      (company_id, vehicle_id, contact_id, repair_order_id, document_id, document_line_id, label, amount_ttc, status)
    values
      (d.company_id, d.vehicle_id, d.contact_id, d.repair_order_id, d.id, g.head_id, g.head_label, round(coalesce(g.ttc, 0), 2), 'a_planifier')
    returning id into did;
    def_ids := def_ids || did;
    n_def := n_def + 1;
  end loop;

  -- L'OR : lignes reportees + accord signe.
  if d.repair_order_id is not null then
    update public.repair_order_lines rl
       set checkup_state = 'reporte'
      from public.document_lines dl
     where dl.id = rl.proposal_line_id and dl.document_id = d.id and not coalesce(dl.accepted, false);
    update public.repair_orders
       set customer_approval = 'signe', approval_at = now(), approval_by = _signed_by,
           approval_by_name = trim(_signer_name),
           approval_channel = case when _mode = 'comptoir' then 'signature_comptoir' else 'signature_distance' end,
           approval_note = null
     where id = d.repair_order_id
     returning * into o;
  end if;

  select c.email, c.locale, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))
    into cemail, cloc, cname
    from public.contacts c where c.id = d.contact_id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (d.company_id, _signed_by, 'proposal_signed', 'documents', d.id::text,
          case when _mode = 'comptoir' then 'screen' else 'api' end,
          jsonb_build_object('signature_id', sid, 'mode', _mode, 'signer_name', trim(_signer_name),
                             'kept', n_kept, 'deferred', n_def, 'repair_order_id', d.repair_order_id, 'hash', hsh));

  begin
    insert into public.team_notifications (company_id, kind, contact_id, document_id, title, payload)
    values (d.company_id, 'proposal_signed', d.contact_id, d.id,
            coalesce(nullif(cname, ''), 'Client') || ' - OR ' || coalesce(o.number, ''),
            jsonb_build_object('number', d.number, 'doc_type', 'DEV', 'kept', n_kept, 'deferred', n_def,
                               'mode', _mode, 'repair_order_id', d.repair_order_id, 'total_ttc', (select total_ttc from public.documents where id = d.id)));
  exception when others then
    raise warning 'proposal_apply_signature: alerte cloche impossible (%)', sqlerrm;
  end;

  return jsonb_build_object(
    'document_id', d.id, 'repair_order_id', d.repair_order_id, 'signature_id', sid,
    'signed_at', now(), 'hash', hsh, 'kept', n_kept, 'deferred', n_def, 'deferred_ids', to_jsonb(def_ids),
    'contact_email', cemail, 'locale', coalesce(cloc, 'fr'), 'contact_name', cname,
    'company_id', d.company_id, 'contact_id', d.contact_id, 'number', d.number, 'or_number', o.number);
end $$;

revoke all on function public.proposal_apply_signature(text, uuid[], text, text, text, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 13. Accord verbal (vendeur : qui, quand, canal, note) → trace dans events
-- ---------------------------------------------------------------------
create or replace function public.repair_order_verbal_approval(
  _or uuid, _by_name text, _at timestamptz, _channel text, _note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r public.repair_orders%rowtype;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
  if not public.is_member(r.company_id) then
    raise exception 'Acces refuse a la societe %', r.company_id using errcode = '42501';
  end if;
  if coalesce(trim(_by_name), '') = '' then
    raise exception 'approval: nom requis' using errcode = 'P0001';
  end if;
  if coalesce(_channel, '') not in ('telephone', 'comptoir', 'mail') then
    raise exception 'approval: canal inconnu' using errcode = 'P0001';
  end if;
  update public.repair_orders
     set customer_approval = 'accord_verbal', approval_at = coalesce(_at, now()), approval_by = auth.uid(),
         approval_by_name = trim(_by_name), approval_channel = _channel, approval_note = nullif(trim(_note), '')
   where id = _or;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'customer_approval_verbal', 'repair_order', _or::text, 'screen',
          jsonb_build_object('customer_approval', r.customer_approval),
          jsonb_build_object('customer_approval', 'accord_verbal', 'by_name', trim(_by_name),
                             'at', coalesce(_at, now()), 'channel', _channel, 'note', nullif(trim(_note), '')));
end $$;

revoke all on function public.repair_order_verbal_approval(uuid, text, timestamptz, text, text) from public, anon;
grant execute on function public.repair_order_verbal_approval(uuid, text, timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 14. Espace client : mes propositions d'intervention (lien signe, etat)
--     Un jeton expire d'une proposition encore ouverte est renouvele pour le client.
-- ---------------------------------------------------------------------
create or replace function public.portal_proposals()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;

  update public.documents d
     set sign_token = public._proposal_new_token(), sign_token_expires_at = now() + interval '30 days'
   where d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id
     and d.doc_kind = 'proposition_intervention' and d.status = 'validee' and d.accepted_at is null
     and (d.sign_token is null or d.sign_token_expires_at is null or d.sign_token_expires_at < now());

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'number', d.number, 'issue_date', d.issue_date, 'total_ttc', d.total_ttc,
      'status', case when d.accepted_at is not null then 'accepte' else 'en_attente' end,
      'accepted_at', d.accepted_at, 'token', d.sign_token,
      'or_number', (select o.number from public.repair_orders o where o.id = d.repair_order_id),
      'vehicle_label', case when d.vehicle_id is not null then public._portal_vehicle_label(d.vehicle_id) end
    ) order by d.issue_date desc, d.created_at desc), '[]'::jsonb)
  into _r
  from public.documents d
  where d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id
    and d.doc_kind = 'proposition_intervention' and d.status = 'validee';
  return _r;
end $$;

revoke all on function public.portal_proposals() from public, anon;
grant execute on function public.portal_proposals() to authenticated;
