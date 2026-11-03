-- M6 — Audit de la caisse du DMS (03/11/2026, PDV000) : garde-fous EN BASE.
--
-- Constats verifies en production (transactions annulees, administrateur simule) :
--   * un ticket valide se modifie, repasse en brouillon et se supprime depuis l application ;
--   * un reglement percu se modifie et se supprime ; son audit `events` n a pas de societe ;
--   * une session de caisse cloturee se rouvre ; deux sessions ouvertes a la fois sont possibles ;
--     un mouvement de fond de caisse s ajoute sur une session cloturee ;
--   * le journal Z (`cash_z_report`) oublie la TVA des ventes DU JOUR (`issue_date < _to::date`),
--     compte les brouillons et ignore les avoirs et les acomptes sur bon de commande.
--
-- Ce que pose cette migration :
--   1. `cash_z_report` corrige (ventes du jour, brouillons exclus, avoirs en negatif, acomptes RES et BC,
--      mouvements d especes a part, recapitulatif des documents) ;
--   2. une seule session de caisse ouverte par societe ; cloture definitive (qui, especes attendues,
--      journal Z fige dans `z_report`) ; aucune ecriture sur une session cloturee ;
--   3. un reglement percu date dans une session cloturee ne se cree, ne se modifie ni ne se supprime plus ;
--      audit des reglements avec la societe ;
--   4. un document valide cree dans le DMS (`imported_from` null) ne change plus de numero, de type,
--      de date, de client ni de montants, ne repasse pas en brouillon, ne se supprime pas (sauf devis :
--      purge, decision VTE-09) ; ses lignes ne bougent plus (montants, article, designation) ;
--   5. mode de reglement technique `ARR` « Arrondi especes » (arrondi legal a 5 cents, masque en caisse).
--
-- Les fonctions serveur (webhooks Shopify / Stripe, `auth.uid()` null) gardent la main : elles
-- inserent des factures deja validees puis leurs lignes, et des reglements dates de la commande.
-- Les documents repris de G8 (`imported_from` renseigne) ne sont pas concernes.
--
-- NON APPLIQUEE le 03/11/2026 (regle du lot : aucune migration en prod sans accord). Commande :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103150000_m6_caisse_audit.sql
-- Testee en production dans une transaction annulee (bloc DO qui leve une exception a la fin).

-- ---------------------------------------------------------------------
-- 5. Mode de reglement « ARR » (arrondi especes), par societe qui a des modes de reglement.
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select distinct rv.company_id, 'payment_method', 'ARR', 'Arrondi especes (5 cents)', 90, true, '{"visible_pos": false}'::jsonb
  from public.reference_values rv
 where rv.table_key = 'payment_method'
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Sessions de caisse : une seule ouverte par societe, cloture definitive et figee.
-- ---------------------------------------------------------------------
alter table public.cash_sessions
  add column if not exists closed_by     uuid references auth.users(id) on delete set null,
  add column if not exists expected_cash numeric(14,2),   -- especes theoriques a la cloture
  add column if not exists z_report      jsonb;           -- journal Z fige a la cloture

create unique index if not exists cash_sessions_one_open_per_company
  on public.cash_sessions (company_id) where status = 'open';

alter table public.cash_sessions drop constraint if exists cash_sessions_status_chk;
alter table public.cash_sessions add constraint cash_sessions_status_chk check (status in ('open', 'closed'));

alter table public.cash_movements drop constraint if exists cash_movements_kind_chk;
alter table public.cash_movements add constraint cash_movements_kind_chk check (kind in ('in', 'out'));
alter table public.cash_movements drop constraint if exists cash_movements_amount_chk;
alter table public.cash_movements add constraint cash_movements_amount_chk check (amount > 0);

-- Une date tombe-t-elle dans une session cloturee de la societe ? (periode figee par un journal Z)
create or replace function public._cash_period_closed(_company uuid, _at timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.cash_sessions s
     where s.company_id = _company and s.status = 'closed' and s.closed_at is not null
       and _at >= s.opened_at and _at <= s.closed_at
  );
$$;
revoke all on function public._cash_period_closed(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.cash_sessions_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _z jsonb; _esp numeric; _in numeric; _out numeric;
begin
  if tg_op = 'DELETE' then
    if old.status = 'closed' then
      raise exception 'Session de caisse cloturee le % : elle ne se supprime pas.', old.closed_at using errcode = '23514';
    end if;
    return old;
  end if;
  if old.status = 'closed' then
    raise exception 'Session de caisse cloturee le % : elle ne se modifie plus et ne se rouvre pas.', old.closed_at using errcode = '23514';
  end if;
  if new.status = 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
    new.closed_by := coalesce(new.closed_by, auth.uid());
    -- Journal Z fige et especes attendues (fond + ESP percu + entrees − sorties en especes).
    _z := public.cash_z_report(new.company_id, new.opened_at, new.closed_at);
    select coalesce(sum((p->>'total')::numeric), 0) into _esp
      from jsonb_array_elements(coalesce(_z->'payments_by_method', '[]'::jsonb)) p where p->>'method' = 'ESP';
    _in  := coalesce((_z->>'cash_in_esp')::numeric, 0);
    _out := coalesce((_z->>'cash_out_esp')::numeric, 0);
    new.expected_cash := round(new.opening_float + _esp + _in - _out, 2);
    new.z_report := _z;
  end if;
  return new;
end $$;
revoke all on function public.cash_sessions_guard() from public, anon, authenticated;
drop trigger if exists trg_cash_sessions_guard on public.cash_sessions;
create trigger trg_cash_sessions_guard before update or delete on public.cash_sessions
  for each row execute function public.cash_sessions_guard();

create or replace function public.cash_movements_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _sid uuid; _st text;
begin
  _sid := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  if _sid is not null then
    select status into _st from public.cash_sessions where id = _sid;
    if _st = 'closed' then
      raise exception 'Session de caisse cloturee : aucun mouvement de fond de caisse ne peut etre ajoute, modifie ou supprime.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and public._cash_period_closed(old.company_id, old.occurred_at) then
    raise exception 'Mouvement de fond de caisse dans une periode cloturee : il ne se modifie plus.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' and public._cash_period_closed(old.company_id, old.occurred_at) then
    raise exception 'Mouvement de fond de caisse dans une periode cloturee : il ne se supprime plus.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.cash_movements_guard() from public, anon, authenticated;
drop trigger if exists trg_cash_movements_guard on public.cash_movements;
create trigger trg_cash_movements_guard before insert or update or delete on public.cash_movements
  for each row execute function public.cash_movements_guard();

-- ---------------------------------------------------------------------
-- 1. Journal Z corrige.
-- ---------------------------------------------------------------------
create or replace function public.cash_z_report(_company uuid, _from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _result jsonb; _d_from date; _d_to date;
begin
  if not public.is_member(_company) then raise exception 'Acces refuse'; end if;
  -- Bornes en jours pour les documents (dates sans heure) : la borne haute est INCLUSE
  -- (avant : `issue_date < _to::date` oubliait les ventes du jour de la cloture).
  _d_from := _from::date;
  _d_to := (_to - interval '1 microsecond')::date;

  select jsonb_build_object(
    -- Reglements percus par mode, ventiles par nature de document (ventes, acomptes RES/BC, avoirs)
    'payments_by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'sales', sales, 'deposits', deposits, 'refunds', refunds, 'total', total) order by method)
      from (
        select p.method,
          sum(case when d.doc_type in ('FAC','TIK') then p.amount else 0 end) as sales,
          sum(case when d.doc_type in ('RES','BC') then p.amount else 0 end) as deposits,
          sum(case when d.doc_type = 'AVO' then p.amount else 0 end) as refunds,
          sum(p.amount) as total
        from public.document_payments p
        join public.documents d on d.id = p.document_id
        where d.company_id = _company and p.status = 'recu' and p.paid_at >= _from and p.paid_at < _to
        group by p.method
      ) m
    ), '[]'::jsonb),
    -- Ventilation TVA des ventes de la periode : FAC / TIK validees ou payees, avoirs en negatif,
    -- jamais un brouillon, jour de cloture compris.
    'vat_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('vat_rate', vat_rate, 'base_ht', base_ht, 'vat', vat) order by vat_rate)
      from (
        select l.vat_rate,
          round(sum(l.line_ht), 2) as base_ht,
          round(sum(l.line_ttc - l.line_ht), 2) as vat
        from public.document_lines l
        join public.documents d on d.id = l.document_id
        where d.company_id = _company and d.doc_type in ('FAC','TIK','AVO')
          and d.status in ('validee', 'payee', 'annulee')
          and d.issue_date >= _d_from and d.issue_date <= _d_to
        group by l.vat_rate
      ) v
    ), '[]'::jsonb),
    -- Documents de la periode (nombre et TTC par type), pour le recapitulatif du Z
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('doc_type', doc_type, 'count', n, 'total_ttc', ttc) order by doc_type)
      from (
        select d.doc_type, count(*) as n, round(sum(d.total_ttc), 2) as ttc
        from public.documents d
        where d.company_id = _company and d.doc_type in ('FAC','TIK','AVO')
          and d.status in ('validee', 'payee', 'annulee')
          and d.issue_date >= _d_from and d.issue_date <= _d_to
        group by d.doc_type
      ) x
    ), '[]'::jsonb),
    -- Mouvements de fond de caisse : tous modes (inchange) et especes seules (tiroir)
    'cash_in',  coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'in'  and occurred_at >= _from and occurred_at < _to), 0),
    'cash_out', coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'out' and occurred_at >= _from and occurred_at < _to), 0),
    'cash_in_esp',  coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'in'  and method = 'ESP' and occurred_at >= _from and occurred_at < _to), 0),
    'cash_out_esp', coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'out' and method = 'ESP' and occurred_at >= _from and occurred_at < _to), 0)
  ) into _result;

  return _result;
end $$;
grant execute on function public.cash_z_report(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Reglements : figes apres cloture de caisse, audites avec la societe.
-- ---------------------------------------------------------------------
create or replace function public.document_payments_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid;
begin
  -- Les fonctions serveur (Shopify, Stripe : auth.uid() null) datent les reglements de la commande.
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'recu' then
    select company_id into _company from public.documents where id = old.document_id;
    if public._cash_period_closed(_company, old.paid_at) then
      raise exception 'Reglement du % dans une caisse cloturee : il ne se modifie ni ne se supprime plus (passez un reglement inverse).', old.paid_at using errcode = '23514';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'recu' then
    select company_id into _company from public.documents where id = new.document_id;
    if public._cash_period_closed(_company, new.paid_at) then
      raise exception 'Reglement date du % dans une caisse cloturee : datez-le d aujourd hui.', new.paid_at using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.document_payments_guard() from public, anon, authenticated;
drop trigger if exists trg_document_payments_guard on public.document_payments;
create trigger trg_document_payments_guard before insert or update or delete on public.document_payments
  for each row execute function public.document_payments_guard();

-- Audit des reglements avec la societe du document (audit_row lisait company_id, absent ici).
create or replace function public.audit_payment_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid; did uuid;
begin
  did := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  select company_id into cid from public.documents where id = did;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
  values (
    cid, auth.uid(), lower(tg_op), tg_table_name,
    coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    'screen'
  );
  return coalesce(new, old);
end $$;
revoke all on function public.audit_payment_row() from public, anon, authenticated;
drop trigger if exists trg_docpay_audit on public.document_payments;
create trigger trg_docpay_audit after insert or update or delete on public.document_payments
  for each row execute function public.audit_payment_row();

-- ---------------------------------------------------------------------
-- 4. Documents valides figes (B7) : en-tete et lignes.
-- ---------------------------------------------------------------------
create or replace function public.documents_freeze_validated()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;      -- fonctions serveur
  if old.imported_from is not null then return coalesce(new, old); end if;  -- repris de G8
  if old.status = 'brouillon' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.doc_type = 'DEV' then return old; end if;                  -- purge des devis (VTE-09)
    raise exception 'Le document % est valide : il ne se supprime pas, il s annule par un avoir.', coalesce(old.number, old.id::text) using errcode = '23514';
  end if;
  if new.status = 'brouillon' then
    raise exception 'Le document % est valide : il ne repasse pas en brouillon.', old.number using errcode = '23514';
  end if;
  if new.number is distinct from old.number or new.doc_type is distinct from old.doc_type
     or new.company_id is distinct from old.company_id or new.issue_date is distinct from old.issue_date
     or new.contact_id is distinct from old.contact_id
     or new.total_ht is distinct from old.total_ht or new.total_vat is distinct from old.total_vat
     or new.total_ttc is distinct from old.total_ttc or new.tax_exempt is distinct from old.tax_exempt
     or new.global_discount_pct is distinct from old.global_discount_pct
     or new.global_discount_amount is distinct from old.global_discount_amount
     or new.shipping_ht is distinct from old.shipping_ht or new.shipping_taxed is distinct from old.shipping_taxed
     or new.shipping_vat_rate is distinct from old.shipping_vat_rate or new.forced_ttc is distinct from old.forced_ttc
     or new.price_mode is distinct from old.price_mode then
    raise exception 'Le document % est valide : numero, type, date, client et montants ne se modifient plus (B7).', old.number using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.documents_freeze_validated() from public, anon, authenticated;
drop trigger if exists trg_documents_freeze_validated on public.documents;
create trigger trg_documents_freeze_validated before update or delete on public.documents
  for each row execute function public.documents_freeze_validated();

create or replace function public.document_lines_freeze_validated()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _doc record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select status, imported_from, number into _doc from public.documents
   where id = case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  if _doc is null or _doc.imported_from is not null or _doc.status = 'brouillon' then return coalesce(new, old); end if;
  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'Le document % est valide : ses lignes ne s ajoutent ni ne se retirent plus (B7).', _doc.number using errcode = '23514';
  end if;
  if new.document_id is distinct from old.document_id or new.article_id is distinct from old.article_id
     or new.designation is distinct from old.designation or new.quantity is distinct from old.quantity
     or new.unit_price_ht is distinct from old.unit_price_ht or new.vat_rate is distinct from old.vat_rate
     or new.discount_pct is distinct from old.discount_pct or new.line_ht is distinct from old.line_ht
     or new.line_ttc is distinct from old.line_ttc or new.line_type is distinct from old.line_type then
    raise exception 'Le document % est valide : ses lignes ne se modifient plus (B7).', _doc.number using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.document_lines_freeze_validated() from public, anon, authenticated;
drop trigger if exists trg_document_lines_freeze_validated on public.document_lines;
create trigger trg_document_lines_freeze_validated before insert or update or delete on public.document_lines
  for each row execute function public.document_lines_freeze_validated();

comment on function public.cash_sessions_guard() is 'M6 PDV008 : cloture de caisse definitive (qui, especes attendues, Z fige) ; session cloturee intouchable.';
comment on function public.documents_freeze_validated() is 'M6 B7 : un document valide cree dans le DMS ne change plus de numero, date, client, montants ; ne se supprime pas (sauf devis).';
comment on function public.document_payments_guard() is 'M6 PDV008 : un reglement percu date dans une caisse cloturee est fige ; correction par reglement inverse.';
