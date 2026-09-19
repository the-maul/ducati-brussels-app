-- =====================================================================
-- Mission 02, carte 9 — « Paiement par QR code sur un 2e écran au comptoir »
-- Étape 1 de la décision P-2 : QR de virement SEPA (EPC069-12), gratuit.
--
-- Le vendeur lance, depuis un document de vente, un règlement ATTENDU (moyen « VIRQR »,
-- communication structurée belge ou libre) ; l'écran client (/ecran-client, session équipe)
-- affiche le QR ; le vendeur confirme « Paiement reçu » (pas de flux bancaire) : le règlement
-- passe à « recu » (date, qui), le réglé du document est recalculé, l'écran dit merci.
--
-- Additif : 3 colonnes sur document_payments, 1 table counter_displays (un écran par
-- utilisateur et par société, RLS), 1 moyen de règlement « Virement QR » par société
-- (paramétrage, pas une donnée de test), 6 fonctions. Traces : trigger d'audit existant sur
-- document_payments + une ligne explicite dans events (avec company_id) par action.
-- =====================================================================

-- 1. Règlement : qui l'a confirmé, quand, avec quelle communication
alter table public.document_payments
  add column if not exists received_at  timestamptz,
  add column if not exists received_by  uuid references auth.users(id) on delete set null,
  add column if not exists qr_reference text;

-- 2. Moyen de règlement « Virement QR » (reste modifiable dans Paramètres → Tables)
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select c.id, 'payment_method', 'VIRQR', 'Virement QR', 20, true, jsonb_build_object('visible_pos', false)
  from public.companies c
 where not exists (select 1 from public.reference_values r
                    where r.company_id = c.id and r.table_key = 'payment_method' and r.code = 'VIRQR');

-- 3. Écran client : ce qu'affiche l'écran tourné vers le client, par vendeur
create table if not exists public.counter_displays (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  payment_id  uuid references public.document_payments(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (company_id, user_id)
);
alter table public.counter_displays enable row level security;
drop policy if exists counter_displays_select on public.counter_displays;
create policy counter_displays_select on public.counter_displays for select to authenticated
  using (user_id = auth.uid() and public.is_member(company_id));
-- Aucune écriture directe : uniquement par les fonctions ci-dessous.

do $$ begin
  alter publication supabase_realtime add table public.counter_displays;
exception when duplicate_object then null; end $$;

-- Contrôle d'une communication structurée belge (+++XXX/XXXX/XXXXX+++, modulo 97, 97 si 0)
create or replace function public.be_structured_ref_ok(_ref text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select _ref ~ '^\+\+\+\d{3}/\d{4}/\d{5}\+\+\+$'
     and (case when (substr(d, 1, 10)::bigint % 97) = 0 then 97 else (substr(d, 1, 10)::bigint % 97) end)
         = substr(d, 11, 2)::int
    from (select regexp_replace(_ref, '\D', '', 'g') as d) x
$$;

-- 4. Lancer un paiement par QR : règlement attendu + affichage sur l'écran client du vendeur
create or replace function public.qr_payment_start(_document uuid, _amount numeric, _reference text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d    public.documents%rowtype;
  amt  numeric := round(coalesce(_amount, 0), 2);
  ref  text := btrim(regexp_replace(coalesce(_reference, ''), '\s+', ' ', 'g'));
  iban text;
  pid  uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into d from public.documents where id = _document for update;
  if not found then raise exception 'Document introuvable.' using errcode = 'P0002'; end if;
  if not public.is_member(d.company_id) then
    raise exception 'Accès refusé à la société %', d.company_id using errcode = '42501';
  end if;
  if d.status in ('brouillon', 'annulee', 'converti') or d.doc_type = 'AVO' then
    raise exception 'Ce document ne peut pas recevoir de paiement.' using errcode = 'P0001';
  end if;
  if amt <= 0 then raise exception 'Indiquez un montant.' using errcode = 'P0001'; end if;
  if amt > d.total_ttc - coalesce(d.paid_amount, 0) + 0.005 then
    raise exception 'Le montant (%) dépasse ce qui reste à payer (%).', amt, round(d.total_ttc - coalesce(d.paid_amount, 0), 2)
      using errcode = 'P0001';
  end if;
  select c.iban into iban from public.companies c where c.id = d.company_id;
  if coalesce(btrim(iban), '') = '' then
    raise exception 'IBAN de la société manquant (Paramètres → Sociétés).' using errcode = 'P0001';
  end if;
  if ref = '' then raise exception 'Communication manquante.' using errcode = 'P0001'; end if;
  if left(ref, 3) = '+++' then
    if not public.be_structured_ref_ok(ref) then
      raise exception 'Communication structurée invalide.' using errcode = 'P0001';
    end if;
  elsif length(ref) > 140 then
    raise exception 'Communication trop longue (140 caractères au plus).' using errcode = 'P0001';
  end if;

  insert into public.document_payments (document_id, method, amount, status, note, qr_reference)
  values (_document, 'VIRQR', amt, 'attendu', ref, ref)
  returning id into pid;

  insert into public.counter_displays (company_id, user_id, payment_id, updated_at)
  values (d.company_id, auth.uid(), pid, now())
  on conflict (company_id, user_id) do update set payment_id = excluded.payment_id, updated_at = now();

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, new_data, origin)
  values (d.company_id, auth.uid(), 'qr_payment_requested', 'documents', d.id,
          jsonb_build_object('payment_id', pid, 'amount', amt, 'method', 'VIRQR', 'reference', ref), 'screen');
  return pid;
end $$;

-- Garde commune : le règlement QR, son document, et le droit d'y toucher
create or replace function public.qr_payment_lock(_payment uuid)
returns public.documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.document_payments%rowtype; d public.documents%rowtype;
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into p from public.document_payments where id = _payment for update;
  if not found then raise exception 'Règlement introuvable.' using errcode = 'P0002'; end if;
  select * into d from public.documents where id = p.document_id;
  if not public.is_member(d.company_id) then
    raise exception 'Accès refusé à la société %', d.company_id using errcode = '42501';
  end if;
  if p.method <> 'VIRQR' or p.status <> 'attendu' then
    raise exception 'Ce règlement n''est pas un paiement QR en attente.' using errcode = 'P0001';
  end if;
  return d;
end $$;

-- 5. « Paiement reçu » : règlement perçu (date, qui), réglé recalculé, écran client prévenu
create or replace function public.qr_payment_confirm(_payment uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.documents%rowtype;
begin
  d := public.qr_payment_lock(_payment);
  update public.document_payments
     set status = 'recu', paid_at = now(), received_at = now(), received_by = auth.uid()
   where id = _payment;
  perform public.recompute_document_paid(d.id);
  update public.counter_displays set updated_at = now() where payment_id = _payment;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, new_data, origin)
  values (d.company_id, auth.uid(), 'qr_payment_received', 'documents', d.id,
          jsonb_build_object('payment_id', _payment,
                             'amount', (select amount from public.document_payments where id = _payment)), 'screen');
end $$;

-- 6. Abandon d'un paiement QR non reçu (le client paie autrement) : le règlement attendu est retiré
create or replace function public.qr_payment_cancel(_payment uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.documents%rowtype; amt numeric;
begin
  d := public.qr_payment_lock(_payment);
  select amount into amt from public.document_payments where id = _payment;
  delete from public.document_payments where id = _payment;  -- écran : payment_id → null (clé étrangère)
  perform public.recompute_document_paid(d.id);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, origin)
  values (d.company_id, auth.uid(), 'qr_payment_cancelled', 'documents', d.id,
          jsonb_build_object('payment_id', _payment, 'amount', amt), 'screen');
end $$;

-- 7. Réafficher un paiement QR en attente, ou remettre l'écran à l'accueil (_payment null)
create or replace function public.counter_display_show(_company uuid, _payment uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if _payment is not null and not exists (
    select 1 from public.document_payments p join public.documents d on d.id = p.document_id
     where p.id = _payment and d.company_id = _company and p.method = 'VIRQR'
  ) then
    raise exception 'Règlement introuvable dans cette société.' using errcode = 'P0002';
  end if;
  insert into public.counter_displays (company_id, user_id, payment_id, updated_at)
  values (_company, auth.uid(), _payment, now())
  on conflict (company_id, user_id) do update set payment_id = excluded.payment_id, updated_at = now();
end $$;

-- 8. Ce que montre l'écran client : uniquement le nom du client, le montant, le bénéficiaire
create or replace function public.counter_display_current(_company uuid)
returns table (
  payment_id uuid, status text, amount numeric, reference text, document_number text,
  customer_name text, beneficiary text, iban text, bic text, received_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select p.id, p.status, p.amount, p.qr_reference, d.number,
         nullif(coalesce(nullif(btrim(ct.company_name), ''), btrim(concat_ws(' ', ct.first_name, ct.last_name))), ''),
         coalesce(nullif(btrim(co.legal_name), ''), co.name), co.iban, co.bic, p.received_at, cd.updated_at
    from public.counter_displays cd
    join public.companies co on co.id = cd.company_id
    left join public.document_payments p on p.id = cd.payment_id
    left join public.documents d on d.id = p.document_id
    left join public.contacts ct on ct.id = d.contact_id
   where cd.company_id = _company and cd.user_id = auth.uid();
end $$;

revoke all on function public.be_structured_ref_ok(text) from public, anon;
revoke all on function public.qr_payment_start(uuid, numeric, text) from public, anon;
revoke all on function public.qr_payment_lock(uuid) from public, anon, authenticated;
revoke all on function public.qr_payment_confirm(uuid) from public, anon;
revoke all on function public.qr_payment_cancel(uuid) from public, anon;
revoke all on function public.counter_display_show(uuid, uuid) from public, anon;
revoke all on function public.counter_display_current(uuid) from public, anon;
grant execute on function public.be_structured_ref_ok(text) to authenticated;
grant execute on function public.qr_payment_start(uuid, numeric, text) to authenticated;
grant execute on function public.qr_payment_confirm(uuid) to authenticated;
grant execute on function public.qr_payment_cancel(uuid) to authenticated;
grant execute on function public.counter_display_show(uuid, uuid) to authenticated;
grant execute on function public.counter_display_current(uuid) to authenticated;

notify pgrst, 'reload schema';
