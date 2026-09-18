-- =====================================================================
-- Mission 02 — carte « Suivre l'état d'une commande : en attente de paiement,
-- payée, à envoyer, envoyée »
--
-- Cycle de vie (process-commandes-pieces.md §1.5) :
--   brouillon → en_attente_paiement → payee → a_envoyer → envoyee
--   annulee possible depuis tout état non terminé.
-- Le statut ne change QUE par part_order_transition() (fonction SQL) :
--   - une garde (trigger) refuse tout UPDATE du statut et des champs de suivi
--     venant directement du navigateur ;
--   - chaque changement est écrit dans part_order_status_history (append-only :
--     qui, quand, ancien → nouveau, note) et dans events (B7).
-- Les règles des types (carte « Règles des 4 types ») sont recontrôlées à la
-- validation et à l'envoi.
-- Additif uniquement : 1 table, 2 colonnes, fonctions, 1 trigger.
-- =====================================================================

-- 1. Suivi de paiement / d'envoi
alter table public.part_orders add column if not exists sent_at timestamptz;
alter table public.part_orders add column if not exists status_changed_at timestamptz;

-- 2. Historique des états (append-only)
create table if not exists public.part_order_status_history (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete restrict,
  order_id    uuid not null references public.part_orders(id) on delete cascade,
  from_status public.order_dispatch_status,
  to_status   public.order_dispatch_status not null,
  changed_by  uuid references auth.users(id) on delete set null,
  changed_at  timestamptz not null default now(),
  note        text
);
create index if not exists idx_part_order_status_history_order
  on public.part_order_status_history(order_id, changed_at);

alter table public.part_order_status_history enable row level security;
drop policy if exists part_order_status_history_select on public.part_order_status_history;
create policy part_order_status_history_select on public.part_order_status_history
  for select to authenticated using (public.is_member(company_id));
-- Aucune policy d'écriture : seules les fonctions ci-dessous (SECURITY DEFINER) écrivent.
revoke insert, update, delete on public.part_order_status_history from anon, authenticated;

-- 3. Garde : pas de changement de statut hors fonction
create or replace function public.part_orders_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.part_order_rpc', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.dispatch_status <> 'brouillon' or new.number is not null or new.validated_at is not null
       or new.paid or new.paid_at is not null or new.sent_at is not null then
      raise exception 'Une commande de pièces se crée en brouillon ; son état change ensuite par les boutons de l’écran.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.dispatch_status is distinct from old.dispatch_status
     or new.number is distinct from old.number
     or new.validated_at is distinct from old.validated_at
     or new.validated_by is distinct from old.validated_by
     or new.paid is distinct from old.paid
     or new.paid_at is distinct from old.paid_at
     or new.payment_method is distinct from old.payment_method
     or new.sent_at is distinct from old.sent_at
     or new.status_changed_at is distinct from old.status_changed_at then
    raise exception 'L’état d’une commande ne se modifie que par les boutons de l’écran (fonction part_order_transition).'
      using errcode = '42501';
  end if;

  if old.dispatch_status <> 'brouillon' and (
       new.order_kind is distinct from old.order_kind
       or new.total_ht is distinct from old.total_ht
       or new.total_ttc is distinct from old.total_ttc
       or new.surcharge_pct is distinct from old.surcharge_pct
       or new.company_id is distinct from old.company_id) then
    raise exception 'Commande déjà validée : type et montants ne se modifient plus.' using errcode = '42501';
  end if;

  return new;
end $$;

revoke all on function public.part_orders_guard() from public, anon, authenticated;

drop trigger if exists trg_part_orders_guard on public.part_orders;
create trigger trg_part_orders_guard before insert or update on public.part_orders
  for each row execute function public.part_orders_guard();

-- 4. Transition d'état (seul chemin d'écriture du statut)
create or replace function public.part_order_transition(
  _order_id uuid,
  _to public.order_dispatch_status,
  _payment_method text default null,
  _note text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o       public.part_orders%rowtype;
  chk     jsonb := null;
  msg     text;
  surch   numeric;
  ttc     numeric;
  allowed boolean;
begin
  select * into o from public.part_orders where id = _order_id for update;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(o.company_id) then
    raise exception 'Accès refusé à la société %', o.company_id using errcode = '42501';
  end if;

  allowed := case o.dispatch_status
    when 'brouillon'           then _to in ('en_attente_paiement', 'annulee')
    when 'en_attente_paiement' then _to in ('payee', 'annulee')
    when 'payee'               then _to in ('a_envoyer', 'annulee')
    when 'a_envoyer'           then _to in ('envoyee', 'annulee')
    else false
  end;
  if not allowed then
    raise exception 'Passage impossible de « % » à « % ».', o.dispatch_status, _to using errcode = 'P0001';
  end if;

  -- Annuler une commande déjà payée : administrateur ou comptable
  if _to = 'annulee' and o.dispatch_status in ('payee', 'a_envoyer')
     and not (public.has_role(o.company_id, 'admin') or public.has_role(o.company_id, 'comptable')) then
    raise exception 'Seul un administrateur ou le comptable peut annuler une commande déjà payée.' using errcode = '42501';
  end if;

  if _to = 'payee' and nullif(trim(coalesce(_payment_method, o.payment_method, '')), '') is null then
    raise exception 'Indiquez le moyen de paiement.' using errcode = 'P0001';
  end if;

  -- Contrôle des règles du type à la validation et à l'envoi
  if _to in ('en_attente_paiement', 'envoyee') then
    if _to = 'en_attente_paiement' then
      perform pg_advisory_xact_lock(hashtext('part_order_validate:' || o.company_id::text));
    end if;
    chk := public.part_order_check_rules(_order_id);
    if not (chk ->> 'ok')::boolean then
      select string_agg(e ->> 'message', ' ') into msg from jsonb_array_elements(chk -> 'errors') e;
      raise exception '%', msg using errcode = 'P0001', hint = 'part_order_rules';
    end if;
  end if;

  perform set_config('app.part_order_rpc', 'on', true);

  if _to = 'en_attente_paiement' then
    surch := coalesce((chk ->> 'surcharge_pct')::numeric, 0);
    select round(coalesce(sum(l.line_ht * (1 + l.vat_rate / 100)), 0) * (1 + surch / 100), 2) into ttc
      from public.part_order_lines l where l.order_id = o.id;
    update public.part_orders set
      order_kind    = (chk ->> 'effective_kind')::public.order_kind,
      surcharge_pct = surch,
      total_ht      = (chk ->> 'total_ht')::numeric,
      total_ttc     = coalesce(ttc, 0),
      number        = coalesce(number, public._next_document_number_unchecked(o.company_id, 'CDP')),
      validated_at  = now(),
      validated_by  = auth.uid()
    where id = o.id;
  elsif _to = 'payee' then
    update public.part_orders set
      paid = true, paid_at = now(),
      payment_method = coalesce(nullif(trim(_payment_method), ''), payment_method)
    where id = o.id;
  elsif _to = 'envoyee' then
    update public.part_orders set sent_at = now() where id = o.id;
  end if;

  update public.part_orders set dispatch_status = _to, status_changed_at = now() where id = o.id;

  insert into public.part_order_status_history (company_id, order_id, from_status, to_status, changed_by, note)
  values (o.company_id, o.id, o.dispatch_status, _to, auth.uid(), nullif(trim(_note), ''));

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (o.company_id, auth.uid(), 'status_change', 'part_orders', o.id::text, 'screen',
          jsonb_build_object('dispatch_status', o.dispatch_status),
          jsonb_build_object('dispatch_status', _to, 'note', nullif(trim(_note), ''),
                             'payment_method', _payment_method, 'rules', chk));

  perform set_config('app.part_order_rpc', 'off', true);

  return coalesce(chk, '{}'::jsonb) || jsonb_build_object('from', o.dispatch_status, 'to', _to);
end $$;

revoke all on function public.part_order_transition(uuid, public.order_dispatch_status, text, text) from public, anon;
grant execute on function public.part_order_transition(uuid, public.order_dispatch_status, text, text) to authenticated;

-- 5. La validation de la carte « Règles » passe désormais par la transition (historique + garde)
create or replace function public.part_order_validate(_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public.part_order_transition(_order_id, 'en_attente_paiement');
end $$;

revoke all on function public.part_order_validate(uuid) from public, anon;
grant execute on function public.part_order_validate(uuid) to authenticated;

-- 6. Historique lisible (avec le nom de l'auteur)
create or replace function public.part_order_history(_order_id uuid)
returns table (changed_at timestamptz, from_status text, to_status text, changed_by uuid, changed_by_name text, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid;
begin
  select company_id into cid from public.part_orders where id = _order_id;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select h.changed_at, h.from_status::text, h.to_status::text, h.changed_by,
         coalesce(nullif(p.full_name, ''), p.email), h.note
    from public.part_order_status_history h
    left join public.profiles p on p.id = h.changed_by
   where h.order_id = _order_id
   order by h.changed_at, h.id;
end $$;

revoke all on function public.part_order_history(uuid) from public, anon;
grant execute on function public.part_order_history(uuid) to authenticated;
