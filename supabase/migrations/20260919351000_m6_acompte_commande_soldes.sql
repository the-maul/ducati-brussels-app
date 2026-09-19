-- =====================================================================
-- Mission 05 — carte 10 « Commander les pièces dès l'acompte et ne laisser aucun
-- solde impayé ». Domenico (vidéo G8, 8:19) : « mettre en place une règle pour que le
-- bon de commande soit toujours lancé une fois qu'il y a un acompte versé, et ne pas
-- laisser traîner des factures à payer ou des soldes ».
-- Décisions du 19/09 : acompte versé = acompte ENCAISSÉ (au moins une partie) ;
-- alerte = vendeur du document (opérateur) + administrateurs.
--
-- 1. Cloche (4 étapes de M00 §4) — deux types :
--    - 'order_after_deposit' : acompte encaissé sur un devis / proforma, bon de commande
--      ou réservation qui a des pièces manquantes pas encore commandées (calcul de la
--      carte 3 de la mission 02 : _document_order_needs). Créée au règlement (déclencheur
--      sur document_payments), puis RAPPEL QUOTIDIEN (tâche planifiée) tant que ce n'est
--      pas fait : au plus une alerte par document et par jour (clé anti-doublon).
--    - 'unpaid_balance' : facture dont l'échéance est dépassée avec un reste à payer par
--      le client (financement accepté déduit). UNE SEULE FOIS par document et par
--      échéance (clé anti-doublon « document:échéance »), jamais de rappel répété.
--    Une alerte devient « réglée » (resolved_at) dès que les pièces sont commandées ou
--    que le reste à payer est soldé ; la cloche ne montre que les alertes non réglées.
--    Visibilité : le vendeur du document (target_user_id = documents.operator_user_id,
--    nouvelle politique de lecture) + les administrateurs (can_see_team_notification).
--    Aucun e-mail, aucun SMS (table team_notifications, pas la file notifications).
-- 2. Soldes à encaisser : sales_open_balances(_company, _operator) — documents ouverts
--    (FAC, TIK, BC, RES, BL ; ni brouillon, ni annulé, ni converti) dont le reste à payer
--    par le client est > 0, même calcul que src/modules/sales/balance.ts (documentBalance).
-- 3. Tâche planifiée pg_cron « sales-alerts » (06:00 UTC chaque jour) : fonction SQL
--    _cron_sales_alerts(), aucun appel HTTP, donc aucun secret.
--
-- Additif : 5 colonnes nullables sur team_notifications, 1 index unique partiel,
-- contrainte de type élargie (types existants relus en place), 1 politique de lecture
-- ajoutée, can_see_team_notification complétée (cas existants recopiés), 8 fonctions,
-- 2 déclencheurs, 1 tâche planifiée. Aucune donnée existante modifiée.
-- =====================================================================

-- ------------------------------------------------ 1. Colonnes des alertes liées à un document
alter table public.team_notifications add column if not exists document_id uuid
  references public.documents(id) on delete cascade;
alter table public.team_notifications add column if not exists target_user_id uuid
  references auth.users(id) on delete set null;
alter table public.team_notifications add column if not exists payload jsonb;
alter table public.team_notifications add column if not exists dedupe_key text;
alter table public.team_notifications add column if not exists resolved_at timestamptz;

comment on column public.team_notifications.document_id is 'Document de vente concerné (alertes order_after_deposit / unpaid_balance).';
comment on column public.team_notifications.target_user_id is 'Destinataire nominatif (vendeur du document) ; les administrateurs voient aussi l''alerte.';
comment on column public.team_notifications.payload is 'Détails affichés (nombre de pièces, montant, échéance), mis en forme par l''écran.';
comment on column public.team_notifications.dedupe_key is 'Clé anti-doublon : une seule alerte par (société, type, clé).';
comment on column public.team_notifications.resolved_at is 'Alerte réglée (pièces commandées, solde payé) : plus affichée.';

create unique index if not exists uq_team_notifications_dedupe
  on public.team_notifications (company_id, kind, dedupe_key) where dedupe_key is not null;
create index if not exists idx_team_notifications_document
  on public.team_notifications (document_id) where document_id is not null and resolved_at is null;
create index if not exists idx_team_notifications_target
  on public.team_notifications (target_user_id, created_at desc) where target_user_id is not null;

-- ------------------------------------------------ 2. Cloche : nouveaux types (étape 1)
do $do$
declare _def text; _kinds text[];
begin
  select pg_get_constraintdef(c.oid) into _def from pg_constraint c
   where c.conrelid = 'public.team_notifications'::regclass and c.conname = 'team_notifications_kind_check';
  select array_agg(distinct k order by k) into _kinds from (
    select (regexp_matches(coalesce(_def, ''), '''([a-z_]+)''', 'g'))[1] as k
    union select 'signup' union select 'client_iban_changed' union select 'vehicle_declared'
    union select 'order_after_deposit' union select 'unpaid_balance') x;
  alter table public.team_notifications drop constraint if exists team_notifications_kind_check;
  execute format('alter table public.team_notifications add constraint team_notifications_kind_check '
                 'check (kind = any (%L::text[]))', _kinds);
end $do$;

-- ------------------------------------------------ 3. Cloche : visibilité (étape 2)
create or replace function public.can_see_team_notification(_company uuid, _kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case _kind
    when 'signup' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'vendeur')
      or public.has_role(_company, 'marketing')
    when 'client_iban_changed' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'comptable')
      or public.has_role(_company, 'vendeur')
    when 'vehicle_declared' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'vendeur')
    -- Mission 05, carte 10 : admins ici ; le vendeur du document par la politique
    -- team_notifications_target_read (target_user_id).
    when 'order_after_deposit' then public.has_role(_company, 'admin')
    when 'unpaid_balance' then public.has_role(_company, 'admin')
    else public.is_member(_company)
  end;
$fn$;
comment on function public.can_see_team_notification(uuid, text) is
  'Décision N-1 : alerte « inscription » visible des rôles admin, vendeur, marketing. '
  'Mission 04 : « IBAN modifié par le client » → admin, comptable, vendeur ; '
  '« moto déclarée par un client » → admin, vendeur. '
  'Mission 05 carte 10 : « pièces à commander après acompte » et « solde impayé » → admin '
  '(+ le vendeur du document, politique team_notifications_target_read).';
revoke all on function public.can_see_team_notification(uuid, text) from public, anon;
grant execute on function public.can_see_team_notification(uuid, text) to authenticated, service_role;

drop policy if exists team_notifications_target_read on public.team_notifications;
create policy team_notifications_target_read on public.team_notifications
  for select to authenticated
  using (target_user_id = auth.uid() and public.is_member(company_id));

-- ------------------------------------------------ 4. Reste à payer d'un document (= balance.ts)
create or replace function public._sales_doc_balance(_document uuid)
returns table (ttc numeric, paid numeric, paid_by_org numeric, financed numeric,
               financing_pending numeric, to_receive_from_org numeric, client_due numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with d as (select * from public.documents where id = _document),
  p as (
    select count(*) as n,
           coalesce(sum(amount) filter (where status = 'recu'), 0) as recu,
           coalesce(sum(amount) filter (where status = 'recu' and from_financing), 0) as recu_org
      from public.document_payments where document_id = _document
  ),
  b as (
    select d.total_ttc as ttc,
           case when p.n > 0 then p.recu else coalesce(d.paid_amount, 0) end as paid,
           case when p.n > 0 then p.recu_org else 0 end as paid_by_org,
           case when d.financing_status = 'accepte' then coalesce(d.financing_amount, 0) else 0 end as financed,
           case when d.financing_status = 'demande' then coalesce(d.financing_amount, 0) else 0 end as pending
      from d cross join p
  ),
  c as (
    select b.*, least(greatest(b.financed - b.paid_by_org, 0), greatest(b.ttc - b.paid, 0)) as to_org from b
  )
  select round(c.ttc, 2), round(c.paid, 2), round(c.paid_by_org, 2), round(c.financed, 2), round(c.pending, 2),
         round(c.to_org, 2), round(greatest(c.ttc - c.paid - c.to_org, 0), 2)
    from c;
$$;
revoke all on function public._sales_doc_balance(uuid) from public, anon, authenticated;

-- ------------------------------------------------ 5. Acompte ENCAISSÉ (règlement reçu du client)
create or replace function public._sales_deposit_received(_document uuid)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0) from public.document_payments
   where document_id = _document and status = 'recu' and not from_financing and amount > 0;
$$;
revoke all on function public._sales_deposit_received(uuid) from public, anon, authenticated;

-- Date du jour à Bruxelles (clé anti-doublon du rappel quotidien)
create or replace function public._brussels_today()
returns date
language sql stable set search_path = public, pg_temp as $$
  select (now() at time zone 'Europe/Brussels')::date;
$$;
revoke all on function public._brussels_today() from public, anon, authenticated;

-- ------------------------------------------------ 6. Alerte « pièces à commander après acompte » (étape 3)
-- Retourne true si une alerte a été créée (au plus une par document et par jour).
create or replace function public._sales_deposit_alert(_document uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.documents%rowtype;
  _dep numeric;
  _cnt int;
  _qty numeric;
  _name text;
  _id uuid;
begin
  select * into d from public.documents where id = _document;
  if not found or d.doc_type not in ('DEV', 'BC', 'RES')
     or d.status in ('brouillon', 'annulee', 'converti') then
    return false;
  end if;
  _dep := public._sales_deposit_received(d.id);
  if _dep <= 0 then
    return false;  -- pas d'acompte encaissé : rien (un règlement « attendu » ne compte pas)
  end if;
  select count(*), coalesce(sum(n.missing_qty), 0) into _cnt, _qty
    from public._document_order_needs(d.id) n where n.missing_qty > 0;
  if _cnt = 0 then
    return false;
  end if;
  select nullif(btrim(coalesce(nullif(btrim(c.company_name), ''),
           concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))), '')
    into _name from public.contacts c where c.id = d.contact_id;
  insert into public.team_notifications
    (company_id, kind, contact_id, document_id, target_user_id, title, payload, dedupe_key)
  values (d.company_id, 'order_after_deposit', d.contact_id, d.id, d.operator_user_id,
          left(coalesce(d.number, '—') || coalesce(' — ' || _name, ''), 200),
          jsonb_build_object('doc_type', d.doc_type, 'number', d.number, 'missing_lines', _cnt,
                             'missing_qty', _qty, 'deposit', round(_dep, 2)),
          d.id::text || ':' || public._brussels_today()::text)
  on conflict (company_id, kind, dedupe_key) where dedupe_key is not null do nothing
  returning id into _id;
  return _id is not null;
end $$;
revoke all on function public._sales_deposit_alert(uuid) from public, anon, authenticated;

-- ------------------------------------------------ 7. Alerte « solde impayé » d'une facture échue
-- Une seule fois par document et par échéance. Retourne true si une alerte a été créée.
create or replace function public._sales_unpaid_alert(_document uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.documents%rowtype;
  b record;
  _name text;
  _id uuid;
begin
  select * into d from public.documents where id = _document;
  if not found or d.doc_type <> 'FAC' or d.status in ('brouillon', 'annulee', 'converti')
     or d.due_date is null or d.due_date >= public._brussels_today() then
    return false;
  end if;
  select * into b from public._sales_doc_balance(d.id);
  if coalesce(b.client_due, 0) <= 0.005 then
    return false;
  end if;
  select nullif(btrim(coalesce(nullif(btrim(c.company_name), ''),
           concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))), '')
    into _name from public.contacts c where c.id = d.contact_id;
  insert into public.team_notifications
    (company_id, kind, contact_id, document_id, target_user_id, title, payload, dedupe_key)
  values (d.company_id, 'unpaid_balance', d.contact_id, d.id, d.operator_user_id,
          left(coalesce(d.number, '—') || coalesce(' — ' || _name, ''), 200),
          jsonb_build_object('doc_type', d.doc_type, 'number', d.number, 'due_date', d.due_date,
                             'client_due', b.client_due, 'ttc', b.ttc),
          d.id::text || ':' || d.due_date::text)
  on conflict (company_id, kind, dedupe_key) where dedupe_key is not null do nothing
  returning id into _id;
  return _id is not null;
end $$;
revoke all on function public._sales_unpaid_alert(uuid) from public, anon, authenticated;

-- ------------------------------------------------ 8. Alertes réglées (pièces commandées, solde payé)
create or replace function public._sales_resolve_alerts(_document uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.documents%rowtype;
  _open boolean;
  _missing int := 0;
  _due numeric := 0;
  _n int := 0;
  _k int;
begin
  select * into d from public.documents where id = _document;
  _open := found and d.status not in ('brouillon', 'annulee', 'converti');
  if exists (select 1 from public.team_notifications
              where document_id = _document and kind = 'order_after_deposit' and resolved_at is null) then
    if _open then
      select count(*) into _missing from public._document_order_needs(_document) n where n.missing_qty > 0;
    end if;
    if not _open or _missing = 0 then
      update public.team_notifications set resolved_at = now()
       where document_id = _document and kind = 'order_after_deposit' and resolved_at is null;
      get diagnostics _k = row_count; _n := _n + _k;
    end if;
  end if;
  if exists (select 1 from public.team_notifications
              where document_id = _document and kind = 'unpaid_balance' and resolved_at is null) then
    if _open then
      select coalesce(b.client_due, 0) into _due from public._sales_doc_balance(_document) b;
    end if;
    if not _open or _due <= 0.005 then
      update public.team_notifications set resolved_at = now()
       where document_id = _document and kind = 'unpaid_balance' and resolved_at is null;
      get diagnostics _k = row_count; _n := _n + _k;
    end if;
  end if;
  return _n;
end $$;
revoke all on function public._sales_resolve_alerts(uuid) from public, anon, authenticated;

-- ------------------------------------------------ 9. Déclencheurs (jamais bloquants)
-- Règlement enregistré ou passé « reçu » → alerte si acompte encaissé et pièces manquantes ;
-- dans tous les cas, alertes réglées si le solde est payé.
create or replace function public.trg_sales_payment_alerts()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare _doc uuid := coalesce(new.document_id, old.document_id);
begin
  begin
    if tg_op <> 'DELETE' and new.status = 'recu' then
      perform public._sales_deposit_alert(_doc);
    end if;
    perform public._sales_resolve_alerts(_doc);
  exception when others then
    -- Un règlement n'est JAMAIS refusé à cause d'une alerte interne.
    raise warning 'trg_sales_payment_alerts: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.trg_sales_payment_alerts() from public, anon, authenticated;

drop trigger if exists trg_document_payments_alerts on public.document_payments;
create trigger trg_document_payments_alerts
  after insert or update of status, amount, from_financing or delete on public.document_payments
  for each row execute function public.trg_sales_payment_alerts();

-- Pièce ajoutée / modifiée / retirée sur une commande liée à un document → alerte réglée si tout est commandé.
create or replace function public.trg_part_order_lines_resolve_alerts()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare _src uuid; _doc uuid;
begin
  begin
    select o.source_document_id into _src from public.part_orders o
     where o.id = coalesce(new.order_id, old.order_id);
    if _src is not null then
      -- le document d'origine et les documents qui en sont issus (DEV → BC → RES)
      for _doc in
        with recursive down(id, depth) as (
          select _src, 0
          union all
          select dd.id, down.depth + 1 from public.documents dd join down on dd.source_document_id = down.id
           where down.depth < 10)
        select id from down
      loop
        perform public._sales_resolve_alerts(_doc);
      end loop;
    end if;
  exception when others then
    raise warning 'trg_part_order_lines_resolve_alerts: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.trg_part_order_lines_resolve_alerts() from public, anon, authenticated;

drop trigger if exists trg_part_order_lines_resolve_alerts on public.part_order_lines;
create trigger trg_part_order_lines_resolve_alerts
  after insert or update or delete on public.part_order_lines
  for each row execute function public.trg_part_order_lines_resolve_alerts();

-- ------------------------------------------------ 10. Tâche quotidienne (rappel + échéances)
create or replace function public._cron_sales_alerts()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  _dep int := 0;
  _unp int := 0;
  _res int := 0;
begin
  -- Alertes non réglées : pièces commandées ou solde payé depuis ?
  for r in select distinct n.document_id from public.team_notifications n
            where n.document_id is not null and n.resolved_at is null
              and n.kind in ('order_after_deposit', 'unpaid_balance') loop
    _res := _res + public._sales_resolve_alerts(r.document_id);
  end loop;
  -- Rappel quotidien : acompte encaissé, pièces manquantes pas encore commandées.
  for r in select d.id from public.documents d
            where d.doc_type in ('DEV', 'BC', 'RES') and d.status not in ('brouillon', 'annulee', 'converti')
              and exists (select 1 from public.document_payments p
                           where p.document_id = d.id and p.status = 'recu' and not p.from_financing and p.amount > 0) loop
    if public._sales_deposit_alert(r.id) then _dep := _dep + 1; end if;
  end loop;
  -- Factures échues avec un reste à payer (une seule fois par document et par échéance).
  for r in select d.id from public.documents d
            where d.doc_type = 'FAC' and d.status not in ('brouillon', 'annulee', 'converti')
              and d.due_date is not null and d.due_date < public._brussels_today()
              and d.total_ttc - coalesce(d.paid_amount, 0) > 0.005 loop
    if public._sales_unpaid_alert(r.id) then _unp := _unp + 1; end if;
  end loop;
  return jsonb_build_object('order_after_deposit', _dep, 'unpaid_balance', _unp, 'resolved', _res);
end $$;
revoke all on function public._cron_sales_alerts() from public, anon, authenticated;

do $do$
begin
  perform cron.schedule('sales-alerts', '0 6 * * *', $cron$ select public._cron_sales_alerts(); $cron$);
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $do$;

-- ------------------------------------------------ 11. Soldes à encaisser (écran Ventes)
create or replace function public.sales_open_balances(_company uuid, _operator uuid default null)
returns table (
  id uuid, doc_type text, number text, status text, issue_date date, due_date date,
  contact_id uuid, contact_name text, operator_user_id uuid, operator_name text,
  ttc numeric, paid numeric, to_receive_from_org numeric, financing_pending numeric,
  client_due numeric, overdue boolean, days_overdue int, age_days int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _today date := public._brussels_today();
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select d.id, d.doc_type, d.number, d.status, d.issue_date, d.due_date,
         d.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         d.operator_user_id,
         coalesce(nullif(btrim(pr.full_name), ''), pr.email, nullif(btrim(d.operator), '')),
         b.ttc, b.paid, b.to_receive_from_org, b.financing_pending, b.client_due,
         (d.due_date is not null and d.due_date < _today),
         case when d.due_date is not null and d.due_date < _today then (_today - d.due_date) else 0 end,
         (_today - d.issue_date)
    from public.documents d
    left join public.contacts c on c.id = d.contact_id
    left join public.profiles pr on pr.id = d.operator_user_id
    cross join lateral public._sales_doc_balance(d.id) b
   where d.company_id = _company
     and d.doc_type in ('FAC', 'TIK', 'BC', 'RES', 'BL')
     and d.status not in ('brouillon', 'annulee', 'converti')
     and d.total_ttc > 0.005
     -- pré-filtre : paid_amount = Σ règlements reçus (recompute_document_paid), reste ≤ TTC − réglé
     and d.total_ttc - coalesce(d.paid_amount, 0) > 0.005
     and (_operator is null or d.operator_user_id = _operator)
     and b.client_due > 0.005
   order by (d.due_date is not null and d.due_date < _today) desc,
            d.due_date nulls last, d.issue_date, d.number;
end $$;
revoke all on function public.sales_open_balances(uuid, uuid) from public, anon;
grant execute on function public.sales_open_balances(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
