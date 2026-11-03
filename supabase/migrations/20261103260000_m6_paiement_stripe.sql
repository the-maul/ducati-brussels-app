-- =====================================================================
-- Mission 12, carte P3 (synthese caisse du 03/11/2026) -- PDV040 « QR Stripe sans supplement »
-- Etude : docs/etudes/2026-11-paiements-comptoir.md, paragraphes 3.1, 3.4 et 5.
-- Decision Simon et Domenico du 03/11/2026 : QR de paiement SANS SUPPLEMENT, frais absorbes par le
-- magasin (art. VII.30 par. 3 CDE : aucun supplement selon le moyen de paiement). Le « +5 % » du
-- 30/07 (P-2) est abandonne.
--
-- Le vendeur lance depuis le panneau de reglement (comptoir ou document) « Payer par QR (Bancontact /
-- carte) » : la fonction Edge `stripe-checkout` cree un reglement ATTENDU mode `STRIPE` puis une
-- session Stripe Checkout du MONTANT EXACT (reste a payer ou acompte) ; le QR (lien de la session)
-- s affiche, et sur l ecran client s il est appaire (mode « qr », migration 20261103240000).
-- La fonction Edge `stripe-webhook` (signature verifiee) passe le reglement a `recu` sur
-- `checkout.session.completed` / `payment_intent.succeeded`, a `annule` sur `checkout.session.expired`.
-- Confirmation uniforme (etude par. 5) : un reglement `attendu` -> `recu` par une fonction serveur,
-- trace `events`. Idempotent : un evenement Stripe n est traite qu une fois (`stripe_events`).
-- Les frais Stripe sont notes a part (`document_payments.stripe_fee`) pour la compta : jamais
-- factures au client, jamais ajoutes au montant.
--
-- Ce que pose cette migration (additif, rien n est supprime) :
--   1. `document_payments` : colonnes de reference Stripe (session, paiement, lien, expiration, canal,
--      mode test / reel, frais, moyen utilise, demandeur).
--   2. Moyen de reglement `STRIPE` « QR Bancontact / carte (Stripe) » par societe (non propose en
--      saisie manuelle : il ne se confirme que par le webhook).
--   3. `stripe_settings` : reglage par societe (active oui / non, moyens proposes, mode test / reel,
--      duree du QR au comptoir). Pas de ligne = desactive (ferme par defaut).
--   4. `stripe_events` : evenements Stripe deja traites (idempotence).
--   5. Garde : un reglement `STRIPE` ne se cree, ne se modifie et ne se confirme jamais depuis
--      l application (seulement par les fonctions serveur, cle de service).
--   6. Fonctions serveur (cle de service seulement) : _stripe_payment_begin / _attach / _abort /
--      _cancel / _settle / _expire ; reglage : stripe_settings_get (membre) / stripe_settings_set (admin).
--   7. `document_payments` publie en Realtime (statut en direct dans le panneau ; RLS inchangee).
--
-- Independante de 20261103150000 / 170000 / 180000 (non appliquees au 03/11) : le rattachement a la
-- session de caisse ouverte (colonne `cash_session_id`) et l ecran client generalise (colonne
-- `counter_displays.mode`) sont utilises s ils existent, ignores sinon.
--
-- NON APPLIQUEE. Essai a blanc (begin; / rollback;) :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f <fichier.sql>
-- Application (par le client, apres backup, regle 5.0) :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103260000_m6_paiement_stripe.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colonnes de reference Stripe sur le reglement
-- ---------------------------------------------------------------------
alter table public.document_payments
  add column if not exists stripe_session_id     text,          -- cs_test_... / cs_live_...
  add column if not exists stripe_payment_intent text,          -- pi_...
  add column if not exists stripe_url            text,          -- lien de la page Checkout (le QR)
  add column if not exists stripe_expires_at     timestamptz,   -- fin de validite du lien
  add column if not exists stripe_channel        text,          -- comptoir (QR, 30 min) | distance (lien, 24 h)
  add column if not exists stripe_livemode       boolean,       -- false = mode test Stripe
  add column if not exists stripe_fee            numeric(14,2), -- frais Stripe (a charge du magasin, compta)
  add column if not exists stripe_method_type    text,          -- bancontact | card | ...
  add column if not exists requested_by          uuid references auth.users(id) on delete set null;

create unique index if not exists document_payments_stripe_session_uq
  on public.document_payments (stripe_session_id) where stripe_session_id is not null;

do $$ begin
  alter table public.document_payments
    add constraint document_payments_stripe_channel_chk check (stripe_channel is null or stripe_channel in ('comptoir', 'distance'));
exception when duplicate_object then null; end $$;

comment on column public.document_payments.stripe_session_id is 'PDV040 : session Stripe Checkout du reglement STRIPE (unique).';
comment on column public.document_payments.stripe_fee is 'PDV040 : frais preleves par Stripe (EUR), a charge du magasin. Jamais factures au client.';
comment on column public.document_payments.stripe_channel is 'PDV040 : comptoir (QR a l ecran, 30 min) ou distance (lien par mail / SMS, 24 h).';

-- ---------------------------------------------------------------------
-- 2. Moyen de reglement « QR Bancontact / carte (Stripe) »
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select c.id, 'payment_method', 'STRIPE', 'QR Bancontact / carte (Stripe)', 21, true,
       jsonb_build_object('visible_pos', false, 'server_only', true)
  from public.companies c
 where not exists (select 1 from public.reference_values r
                    where r.company_id = c.id and r.table_key = 'payment_method' and r.code = 'STRIPE');

-- ---------------------------------------------------------------------
-- 3. Reglage par societe
-- ---------------------------------------------------------------------
create table if not exists public.stripe_settings (
  company_id      uuid primary key references public.companies(id) on delete cascade,
  enabled         boolean not null default false,
  methods         text[]  not null default array['bancontact', 'card'],
  mode            text    not null default 'test' check (mode in ('test', 'live')),
  counter_minutes integer not null default 30 check (counter_minutes between 30 and 1440),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  constraint stripe_settings_methods_chk check (
    cardinality(methods) between 1 and 3 and methods <@ array['bancontact', 'card', 'wero']
  )
);
comment on table public.stripe_settings is
  'PDV040 : paiement par QR Stripe par societe. Pas de ligne = desactive. mode = test (cle sk_test_) ou live '
  '(cle sk_live_) : la cle posee doit correspondre, sinon rien ne part. Aucun supplement (art. VII.30 par. 3 CDE).';

drop trigger if exists trg_stripe_settings_updated on public.stripe_settings;
create trigger trg_stripe_settings_updated before update on public.stripe_settings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_stripe_settings_audit on public.stripe_settings;
create trigger trg_stripe_settings_audit after insert or update or delete on public.stripe_settings
  for each row execute function public.audit_row();

alter table public.stripe_settings enable row level security;
revoke all on public.stripe_settings from anon;
revoke insert, update, delete on public.stripe_settings from authenticated;
grant select on public.stripe_settings to authenticated;
drop policy if exists stripe_settings_select on public.stripe_settings;
create policy stripe_settings_select on public.stripe_settings for select to authenticated
  using (public.is_member(company_id));

create or replace function public.stripe_settings_get(_company uuid)
returns table (enabled boolean, methods text[], mode text, counter_minutes integer, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(s.enabled, false), coalesce(s.methods, array['bancontact', 'card']),
         coalesce(s.mode, 'test'), coalesce(s.counter_minutes, 30), s.updated_at
    from (select 1) x
    left join public.stripe_settings s on s.company_id = _company
   where auth.uid() is null or public.is_member(_company);
$fn$;

create or replace function public.stripe_settings_set(_company uuid, _enabled boolean, _methods text[], _mode text, _counter_minutes integer)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare old_s public.stripe_settings%rowtype; m text[];
begin
  if not public.is_admin(_company) then
    raise exception 'Réglage réservé aux administrateurs.' using errcode = '42501';
  end if;
  if _mode not in ('test', 'live') then raise exception 'Mode inconnu : %', _mode using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into m from unnest(coalesce(_methods, '{}')) x;
  if cardinality(m) = 0 then raise exception 'Choisissez au moins un moyen de paiement.' using errcode = '22023'; end if;
  if not (m <@ array['bancontact', 'card', 'wero']) then
    raise exception 'Moyen de paiement inconnu.' using errcode = '22023';
  end if;
  if coalesce(_counter_minutes, 30) not between 30 and 1440 then
    raise exception 'Durée du QR entre 30 et 1440 minutes (limites Stripe).' using errcode = '22023';
  end if;
  select * into old_s from public.stripe_settings where company_id = _company;
  insert into public.stripe_settings (company_id, enabled, methods, mode, counter_minutes, updated_at, updated_by)
  values (_company, coalesce(_enabled, false), m, _mode, coalesce(_counter_minutes, 30), now(), auth.uid())
  on conflict (company_id) do update
     set enabled = excluded.enabled, methods = excluded.methods, mode = excluded.mode,
         counter_minutes = excluded.counter_minutes, updated_at = now(), updated_by = auth.uid();
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'stripe_settings_changed', 'stripe_settings', _company::text, 'screen',
          case when old_s.company_id is null then null
               else jsonb_build_object('enabled', old_s.enabled, 'methods', old_s.methods, 'mode', old_s.mode, 'counter_minutes', old_s.counter_minutes) end,
          jsonb_build_object('enabled', coalesce(_enabled, false), 'methods', m, 'mode', _mode, 'counter_minutes', coalesce(_counter_minutes, 30)));
end $fn$;

revoke all on function public.stripe_settings_get(uuid) from public, anon;
revoke all on function public.stripe_settings_set(uuid, boolean, text[], text, integer) from public, anon;
grant execute on function public.stripe_settings_get(uuid) to authenticated, service_role;
grant execute on function public.stripe_settings_set(uuid, boolean, text[], text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Evenements Stripe deja traites (idempotence du webhook)
-- ---------------------------------------------------------------------
create table if not exists public.stripe_events (
  event_id    text primary key,                      -- evt_...
  company_id  uuid not null references public.companies(id) on delete cascade,
  event_type  text not null,
  payment_id  uuid references public.document_payments(id) on delete set null,
  result      text not null,
  received_at timestamptz not null default now()
);
create index if not exists idx_stripe_events_payment on public.stripe_events(payment_id);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon;
revoke insert, update, delete on public.stripe_events from authenticated;
grant select on public.stripe_events to authenticated;
drop policy if exists stripe_events_select on public.stripe_events;
create policy stripe_events_select on public.stripe_events for select to authenticated
  using (public.is_member(company_id));
comment on table public.stripe_events is 'PDV040 : evenements Stripe traites par stripe-webhook (un evenement = une fois). Ecriture : cle de service.';

-- ---------------------------------------------------------------------
-- 5. Garde : un reglement STRIPE ne se touche que cote serveur
-- ---------------------------------------------------------------------
create or replace function public.document_payments_stripe_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if auth.uid() is null then return coalesce(new, old); end if;   -- fonctions serveur (cle de service)
  -- Un paiement Stripe EN ATTENTE n existe que s il a ete lance par stripe-checkout (session reliee) ;
  -- seul le webhook (ou « Annuler le QR », qui expire la session chez Stripe) le fait changer d etat.
  -- Les lignes derivees d un paiement Stripe percu (contre-passation, acompte reporte, facture
  -- d acompte) restent possibles : elles sont `recu` et suivent les regles des autres moyens.
  if tg_op = 'INSERT' and new.method = 'STRIPE' and new.status <> 'recu' then
    raise exception 'Un paiement Stripe se lance par « Payer par QR (Bancontact / carte) » : il ne se saisit pas à la main.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and ((old.method = 'STRIPE' and old.status = 'attendu')
                           or (new.method = 'STRIPE' and old.method is distinct from 'STRIPE')) then
    raise exception 'Un paiement Stripe se confirme automatiquement (Stripe) : il ne se modifie pas à la main. Pour l abandonner : « Annuler le QR ».' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' and old.method = 'STRIPE' and old.status = 'attendu'
     and exists (select 1 from public.documents where id = old.document_id) then
    raise exception 'Un paiement Stripe en attente ne se supprime pas : « Annuler le QR ».' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $fn$;
revoke all on function public.document_payments_stripe_guard() from public, anon, authenticated;
drop trigger if exists trg_document_payments_stripe_guard on public.document_payments;
create trigger trg_document_payments_stripe_guard before insert or update or delete on public.document_payments
  for each row execute function public.document_payments_stripe_guard();

-- ---------------------------------------------------------------------
-- 6. Fonctions serveur (cle de service ; jamais ouvertes a l application)
-- ---------------------------------------------------------------------

-- Membre actif d une societe (equivalent de is_member pour un utilisateur donne).
create or replace function public._stripe_actor_ok(_actor uuid, _company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select _actor is not null and exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
     where ur.user_id = _actor and ur.company_id = _company and p.is_active);
$fn$;

-- Regle du document (meme calcul que recompute_document_paid, sans le controle de session).
create or replace function public._stripe_recompute_paid(_document uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _paid numeric; _ttc numeric;
begin
  select total_ttc into _ttc from public.documents where id = _document;
  select coalesce(sum(amount), 0) into _paid from public.document_payments where document_id = _document and status = 'recu';
  update public.documents
     set paid_amount = _paid,
         status = case
           when status in ('annulee', 'avoir_emis', 'converti') then status
           when _paid + 0.005 >= _ttc and _ttc > 0 then 'payee'
           when status = 'payee' and _paid + 0.005 < _ttc then 'validee'
           else status
         end
   where id = _document;
end $fn$;

-- Ecran client generalise (20261103240000) : QR -> merci / accueil, si la colonne existe.
create or replace function public._stripe_counter_display(_company uuid, _payment uuid, _mode text, _amount numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'counter_displays' and column_name = 'mode') then
    return;
  end if;
  execute $q$
    update public.counter_displays
       set mode = $3,
           payload = case when $3 = 'merci' then jsonb_build_object('amount', $4) else '{}'::jsonb end
     where company_id = $1 and payload #>> '{qr,payment_id}' = $2::text
  $q$ using _company, _payment, _mode, _amount;
end $fn$;

-- 6.1 Lancer : controles + reglement attendu. Rend ce qu il faut pour creer la session Stripe.
create or replace function public._stripe_payment_begin(_actor uuid, _document uuid, _amount numeric, _channel text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d    public.documents%rowtype;
  s    record;
  amt  numeric := round(coalesce(_amount, 0), 2);
  pend numeric;
  rest numeric;
  pid  uuid;
begin
  if _channel not in ('comptoir', 'distance') then raise exception 'Canal inconnu.' using errcode = '22023'; end if;
  select * into d from public.documents where id = _document for update;
  if not found then raise exception 'Document introuvable.' using errcode = 'P0002'; end if;
  if not public._stripe_actor_ok(_actor, d.company_id) then
    raise exception 'Accès refusé à la société %', d.company_id using errcode = '42501';
  end if;
  select * into s from public.stripe_settings where company_id = d.company_id;
  if s.company_id is null or not s.enabled then
    raise exception 'Le paiement par QR Stripe est désactivé (Paramètres → Paiement Stripe).' using errcode = 'P0001';
  end if;
  if d.status in ('brouillon', 'annulee', 'converti', 'avoir_emis') or d.doc_type in ('AVO', 'FAA') then
    raise exception 'Ce document ne peut pas recevoir de paiement.' using errcode = 'P0001';
  end if;
  if amt < 0.50 then raise exception 'Montant minimum Stripe : 0,50 €.' using errcode = 'P0001'; end if;
  rest := round(d.total_ttc - coalesce(d.paid_amount, 0), 2);
  select coalesce(sum(amount), 0) into pend from public.document_payments
   where document_id = _document and method = 'STRIPE' and status = 'attendu';
  if amt > rest - pend + 0.005 then
    if pend > 0 then
      raise exception 'Un paiement Stripe de % € est déjà en attente sur ce document : annulez-le avant d en lancer un autre (reste à payer % €).', pend, rest
        using errcode = 'P0001';
    end if;
    raise exception 'Le montant (%) dépasse ce qui reste à payer (%).', amt, rest using errcode = 'P0001';
  end if;

  -- Aucun supplement : le reglement attendu porte le montant exact demande au client.
  insert into public.document_payments (document_id, method, amount, status, note, stripe_channel, requested_by)
  values (_document, 'STRIPE', amt, 'attendu',
          case when _channel = 'comptoir' then 'QR Stripe au comptoir' else 'Lien de paiement Stripe (à distance)' end,
          _channel, _actor)
  returning id into pid;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (d.company_id, _actor, 'stripe_payment_requested', 'documents', d.id::text, 'screen',
          jsonb_build_object('payment_id', pid, 'amount', amt, 'method', 'STRIPE', 'channel', _channel, 'mode', s.mode));

  return jsonb_build_object(
    'payment_id', pid, 'company_id', d.company_id, 'document_id', d.id, 'document_number', d.number,
    'doc_type', d.doc_type, 'amount', amt, 'channel', _channel,
    'methods', to_jsonb(s.methods), 'mode', s.mode, 'counter_minutes', s.counter_minutes);
end $fn$;

-- 6.2 Session creee chez Stripe : on garde la reference et le lien.
create or replace function public._stripe_payment_attach(_payment uuid, _session_id text, _url text, _expires_at timestamptz, _livemode boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare n int;
begin
  update public.document_payments
     set stripe_session_id = _session_id, stripe_url = _url, stripe_expires_at = _expires_at, stripe_livemode = _livemode
   where id = _payment and method = 'STRIPE' and status = 'attendu' and stripe_session_id is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Règlement Stripe introuvable ou déjà relié.' using errcode = 'P0002'; end if;
end $fn$;

-- 6.3 La creation chez Stripe a echoue : le reglement attendu est annule (rien n a ete demande au client).
create or replace function public._stripe_payment_abort(_payment uuid, _reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare p public.document_payments%rowtype; d public.documents%rowtype;
begin
  select * into p from public.document_payments where id = _payment for update;
  if not found or p.method <> 'STRIPE' or p.status <> 'attendu' or p.stripe_session_id is not null then return; end if;
  select * into d from public.documents where id = p.document_id;
  update public.document_payments set status = 'annule', note = left('Stripe : ' || coalesce(_reason, 'erreur'), 300) where id = _payment;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (d.company_id, p.requested_by, 'stripe_payment_failed_to_start', 'documents', d.id::text, 'api',
          jsonb_build_object('payment_id', _payment, 'amount', p.amount, 'reason', left(coalesce(_reason, ''), 300)));
end $fn$;

-- 6.4 Le vendeur abandonne le QR (la session a ete expiree chez Stripe juste avant).
create or replace function public._stripe_payment_cancel(_actor uuid, _payment uuid, _reason text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare p public.document_payments%rowtype; d public.documents%rowtype;
begin
  select * into p from public.document_payments where id = _payment for update;
  if not found or p.method <> 'STRIPE' then raise exception 'Règlement Stripe introuvable.' using errcode = 'P0002'; end if;
  select * into d from public.documents where id = p.document_id;
  if not public._stripe_actor_ok(_actor, d.company_id) then
    raise exception 'Accès refusé à la société %', d.company_id using errcode = '42501';
  end if;
  if p.status <> 'attendu' then return p.status; end if;
  update public.document_payments
     set status = 'annule', note = left('Annulé : ' || coalesce(nullif(btrim(_reason), ''), 'abandon au comptoir'), 300)
   where id = _payment;
  perform public._stripe_counter_display(d.company_id, _payment, 'accueil', null);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (d.company_id, _actor, 'stripe_payment_cancelled', 'documents', d.id::text, 'screen',
          jsonb_build_object('payment_id', _payment, 'status', 'attendu'),
          jsonb_build_object('payment_id', _payment, 'status', 'annule', 'amount', p.amount, 'reason', _reason));
  return 'annule';
end $fn$;

-- 6.5 Paiement confirme par Stripe (webhook signe) : attendu -> recu. Idempotent.
--     Resultats : received | duplicate (evenement deja vu) | already (deja recu, frais completes
--     au besoin) | unknown (reglement introuvable).
create or replace function public._stripe_payment_settle(
  _event_id text, _event_type text, _payment uuid, _session_id text, _payment_intent text,
  _amount_cents bigint, _fee_cents bigint, _method_type text, _livemode boolean)
returns text
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  p    public.document_payments%rowtype;
  d    public.documents%rowtype;
  amt  numeric;
  fee  numeric := case when _fee_cents is null then null else round(_fee_cents / 100.0, 2) end;
  res  text;
  sid  uuid;
begin
  select * into p from public.document_payments
   where method = 'STRIPE' and (id = _payment or (_session_id is not null and stripe_session_id = _session_id))
   order by (id = _payment) desc limit 1
   for update;
  if not found then return 'unknown'; end if;
  select * into d from public.documents where id = p.document_id;

  insert into public.stripe_events (event_id, company_id, event_type, payment_id, result)
  values (_event_id, d.company_id, _event_type, p.id, 'pending')
  on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;

  amt := case when _amount_cents is null then p.amount else round(_amount_cents / 100.0, 2) end;

  if p.status = 'recu' then
    -- Deuxieme evenement du meme paiement (session terminee puis paiement reussi) : rien ne change,
    -- sauf les frais s ils n etaient pas encore connus.
    if p.stripe_fee is null and fee is not null then
      update public.document_payments set stripe_fee = fee where id = p.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
      values (d.company_id, null, 'stripe_fee_recorded', 'documents', d.id::text, 'api',
              jsonb_build_object('payment_id', p.id, 'fee', fee, 'event', _event_id));
    end if;
    res := 'already';
  else
    -- attendu (cas normal) ou annule (QR abandonne mais paye quand meme) : l argent est arrive.
    update public.document_payments
       set status = 'recu', amount = amt, paid_at = now(), received_at = now(),
           stripe_session_id = coalesce(stripe_session_id, _session_id),
           stripe_payment_intent = coalesce(_payment_intent, stripe_payment_intent),
           stripe_fee = coalesce(fee, stripe_fee),
           stripe_method_type = coalesce(_method_type, stripe_method_type),
           stripe_livemode = coalesce(_livemode, stripe_livemode)
     where id = p.id;
    -- Comptoir : rattache a la caisse ouverte (journal Z par mode), si la caisse legale est posee.
    if p.stripe_channel = 'comptoir' and exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'document_payments' and column_name = 'cash_session_id') then
      execute 'select id from public.cash_sessions where company_id = $1 and status = ''open'' limit 1' into sid using d.company_id;
      if sid is not null then
        execute 'update public.document_payments set cash_session_id = $1 where id = $2' using sid, p.id;
      end if;
    end if;
    perform public._stripe_recompute_paid(d.id);
    perform public._stripe_counter_display(d.company_id, p.id, 'merci', amt);
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (d.company_id, null, 'stripe_payment_received', 'documents', d.id::text, 'api',
            jsonb_build_object('payment_id', p.id, 'status', p.status, 'amount', p.amount),
            jsonb_build_object('payment_id', p.id, 'status', 'recu', 'amount', amt, 'fee', fee,
                               'method_type', _method_type, 'livemode', _livemode, 'session', _session_id,
                               'payment_intent', _payment_intent, 'event', _event_id, 'event_type', _event_type,
                               'paid_after_cancel', p.status = 'annule',
                               'amount_mismatch', amt is distinct from p.amount));
    res := 'received';
  end if;
  update public.stripe_events set result = res where event_id = _event_id;
  return res;
end $fn$;

-- 6.6 Session expiree (ou paiement differe echoue) : attendu -> annule. Idempotent.
--     Resultats : cancelled | duplicate | already | unknown.
create or replace function public._stripe_payment_expire(_event_id text, _event_type text, _payment uuid, _session_id text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare p public.document_payments%rowtype; d public.documents%rowtype; res text;
begin
  select * into p from public.document_payments
   where method = 'STRIPE' and (id = _payment or (_session_id is not null and stripe_session_id = _session_id))
   order by (id = _payment) desc limit 1
   for update;
  if not found then return 'unknown'; end if;
  select * into d from public.documents where id = p.document_id;

  insert into public.stripe_events (event_id, company_id, event_type, payment_id, result)
  values (_event_id, d.company_id, _event_type, p.id, 'pending')
  on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;

  if p.status <> 'attendu' then
    res := 'already';   -- deja recu (jamais annule apres paiement) ou deja annule
  else
    update public.document_payments
       set status = 'annule',
           note = case when _event_type = 'checkout.session.expired' then 'Lien Stripe expiré sans paiement'
                       else 'Paiement Stripe refusé' end
     where id = p.id;
    perform public._stripe_counter_display(d.company_id, p.id, 'accueil', null);
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (d.company_id, null, 'stripe_payment_expired', 'documents', d.id::text, 'api',
            jsonb_build_object('payment_id', p.id, 'status', 'attendu'),
            jsonb_build_object('payment_id', p.id, 'status', 'annule', 'amount', p.amount, 'event', _event_id, 'event_type', _event_type));
    res := 'cancelled';
  end if;
  update public.stripe_events set result = res where event_id = _event_id;
  return res;
end $fn$;

revoke all on function public._stripe_actor_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function public._stripe_recompute_paid(uuid) from public, anon, authenticated;
revoke all on function public._stripe_counter_display(uuid, uuid, text, numeric) from public, anon, authenticated;
revoke all on function public._stripe_payment_begin(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public._stripe_payment_attach(uuid, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public._stripe_payment_abort(uuid, text) from public, anon, authenticated;
revoke all on function public._stripe_payment_cancel(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public._stripe_payment_settle(text, text, uuid, text, text, bigint, bigint, text, boolean) from public, anon, authenticated;
revoke all on function public._stripe_payment_expire(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public._stripe_payment_begin(uuid, uuid, numeric, text) to service_role;
grant execute on function public._stripe_payment_attach(uuid, text, text, timestamptz, boolean) to service_role;
grant execute on function public._stripe_payment_abort(uuid, text) to service_role;
grant execute on function public._stripe_payment_cancel(uuid, uuid, text) to service_role;
grant execute on function public._stripe_payment_settle(text, text, uuid, text, text, bigint, bigint, text, boolean) to service_role;
grant execute on function public._stripe_payment_expire(text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 7. Statut en direct : document_payments en Realtime (la RLS docpay_all filtre par societe)
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.document_payments;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
