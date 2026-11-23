-- =====================================================================
-- M4 — C2 : CLIENT PREVENU A RECEPTION COMPLETE (INV003, PIE-01, 23/11/2026)
-- Quand TOUTES les pieces d'une commande de pieces client sont recues, le DMS prepare le mail au client
-- dans la file existante (`notifications`, envoi par Outlook via dispatch-notifications).
--
-- GARDE-FOUS
--   - Nouvel interrupteur `parts_received_mail` dans la fenetre « Mise en production » : ARRETE par
--     defaut. Tant qu'il est arrete, RIEN n'est mis en file : l'ecran propose « Client prevenu » a
--     cocher, comme aujourd'hui.
--   - Societe de test (ItalTest) : jamais rien en file (controle ici, puis trigger de `notifications`,
--     puis mail_dispatch_claim, puis la fonction Edge).
--   - Mode test : la file envoie a l'adresse de test (mail_dispatch_claim) ; le client n'est PAS compte
--     comme prevenu.
--   - Refus de contact par mail : rien en file. Une seule notification par commande.
--   - Une erreur ici ne bloque JAMAIS la reception (trace `events`).
--
-- Idempotente. NON APPLIQUEE. Suppose 20261123110000 et 20261119220000 appliquees.
-- =====================================================================
set local lock_timeout = '45s';

-- 1. Interrupteur (arrete par defaut : automation_default_mode ne le liste pas parmi les actifs)
alter table public.automation_switches drop constraint if exists automation_switches_key_check;
alter table public.automation_switches add constraint automation_switches_key_check
  check (key = any (array['appointment_reminder_mail', 'invoice_reminder_auto', 'order_confirm_mail', 'parts_received_mail',
                          'portal_invite', 'outlook_poll', 'prospect_classify', 'exchange_summary']));

create or replace function public._mail_switch_key(_template text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case _template
    when 'invoice_reminder'     then 'invoice_reminder_auto'
    when 'appointment_reminder' then 'appointment_reminder_mail'
    when 'order_confirm'        then 'order_confirm_mail'
    when 'parts_received'       then 'parts_received_mail'
  end;
$$;

-- 2. La fenetre « Mise en production » connait ce nouvel element
do $m$
declare d text;
begin
  d := pg_get_functiondef('public.production_overview(uuid, boolean)'::regprocedure);
  if position('parts_received_mail' in d) = 0 then
    if position($x$('order_confirm_mail', 'order_confirm')) v(k, tpl)$x$ in d) = 0 then
      raise exception 'production_overview : repere introuvable';
    end if;
    d := replace(d, $x$('order_confirm_mail', 'order_confirm')) v(k, tpl)$x$,
                    $x$('order_confirm_mail', 'order_confirm'), ('parts_received_mail', 'parts_received')) v(k, tpl)$x$);
    execute d;
  end if;

  d := pg_get_functiondef('public.production_apply(uuid, text[], text)'::regprocedure);
  if position('parts_received_mail' in d) = 0 then
    if position($x$'order_confirm_mail', 'portal_invite', 'sms'$x$ in d) = 0
       or position($x$elsif _k in ('invoice_reminder_auto', 'appointment_reminder_mail', 'order_confirm_mail', 'portal_invite',$x$ in d) = 0 then
      raise exception 'production_apply : repere introuvable';
    end if;
    d := replace(d, $x$'order_confirm_mail', 'portal_invite', 'sms'$x$,
                    $x$'order_confirm_mail', 'parts_received_mail', 'portal_invite', 'sms'$x$);
    d := replace(d, $x$elsif _k in ('invoice_reminder_auto', 'appointment_reminder_mail', 'order_confirm_mail', 'portal_invite',$x$,
                    $x$elsif _k in ('invoice_reminder_auto', 'appointment_reminder_mail', 'order_confirm_mail', 'parts_received_mail', 'portal_invite',$x$);
    execute d;
  end if;
end $m$;

-- 3. Une seule notification par commande de pieces
create unique index if not exists uq_notif_parts_received on public.notifications (template, entity_id)
  where template = 'parts_received' and status <> 'cancelled';

-- 4. Texte du mail, dans la langue de la fiche client (« Bonjour Jean », VP1)
create or replace function public._parts_received_text(_locale text, _first_name text, _number text, _shop text,
                                                       out subject text, out body text)
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare _n text := nullif(btrim(coalesce(_first_name, '')), ''); _no text := coalesce(_number, ''); _s text := coalesce(_shop, '');
begin
  case lower(left(coalesce(_locale, 'fr'), 2))
    when 'nl' then
      subject := 'Uw onderdelen zijn aangekomen';
      body := 'Beste' || coalesce(' ' || _n, '') || ', de onderdelen van uw bestelling ' || _no
              || ' zijn aangekomen. U kunt ze ophalen bij ' || _s || '.';
    when 'en' then
      subject := 'Your parts have arrived';
      body := 'Hello' || coalesce(' ' || _n, '') || ', the parts of your order ' || _no
              || ' have arrived. You can collect them at ' || _s || '.';
    when 'it' then
      subject := 'I suoi ricambi sono arrivati';
      body := 'Buongiorno' || coalesce(' ' || _n, '') || ', i ricambi del suo ordine ' || _no
              || ' sono arrivati. Può ritirarli presso ' || _s || '.';
    else
      subject := 'Vos pièces sont arrivées';
      body := 'Bonjour' || coalesce(' ' || _n, '') || ', les pièces de votre commande ' || _no
              || ' sont arrivées. Vous pouvez venir les chercher chez ' || _s || '.';
  end case;
end $fn$;
revoke all on function public._parts_received_text(text, text, text, text) from public, anon, authenticated;

-- 5. Preparer la notification d'une commande (renvoie ce qui a ete decide, pour la trace et les essais)
create or replace function public._part_order_notify_received(_order uuid, _receipt uuid default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  o     public.part_orders%rowtype;
  c     public.contacts%rowtype;
  _mode text;
  _to   text;
  _shop text;
  _txt  record;
  _nb   integer;
  _ok   integer;
  _id   bigint;
begin
  select * into o from public.part_orders where id = _order;
  if not found or o.dispatch_status::text in ('brouillon', 'annulee') then return 'not_open'; end if;
  if public._sms_is_test_company(o.company_id) then return 'test_company'; end if;
  if o.contact_id is null then return 'no_contact'; end if;

  select count(*), count(*) filter (where coalesce(s.rcv, 0) >= r.qty_needed)
    into _nb, _ok
    from public._part_path_rows(o.company_id, 'part_order', o.id, false, 2000) r
    left join lateral (select sum((e ->> 'received')::numeric) as rcv from jsonb_array_elements(r.supplies) e) s on true;
  if _nb = 0 or _ok < _nb then return 'incomplete'; end if;

  if exists (select 1 from public.purchase_customer_notices n where n.source_kind = 'part_order' and n.source_id = o.id) then
    return 'already_informed';
  end if;

  _mode := public.automation_mode(o.company_id, 'parts_received_mail');
  if _mode = 'arrete' then return 'off'; end if;

  select * into c from public.contacts where id = o.contact_id;
  _to := lower(coalesce(nullif(btrim(c.email), ''), nullif(btrim(c.email_pro), '')));
  if _to is null then return 'no_email'; end if;
  if public._consent_channel(c.id, 'email') = 'refuse' then return 'consent_refused'; end if;

  select name into _shop from public.companies where id = o.company_id;
  select * into _txt from public._parts_received_text(
    to_jsonb(c) ->> 'locale',
    public.name_title_case(coalesce(nullif(btrim(c.first_name), ''), nullif(btrim(c.company_name), ''))),
    o.number, _shop);

  insert into public.notifications (company_id, channel, to_address, subject, body, template, entity_type, entity_id, contact_id, locale)
  values (o.company_id, 'email', _to, _txt.subject, _txt.body, 'parts_received', 'part_orders', o.id::text, c.id,
          coalesce(to_jsonb(c) ->> 'locale', 'fr'))
  on conflict (template, entity_id) where template = 'parts_received' and status <> 'cancelled' do nothing
  returning id into _id;
  if _id is null then return 'already_queued'; end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (o.company_id, auth.uid(), 'parts_received_notice', 'part_orders', o.id::text, 'system', null,
          jsonb_build_object('number', o.number, 'receipt_id', _receipt, 'notification_id', _id, 'mode', _mode));
  return 'queued';
end $fn$;
revoke all on function public._part_order_notify_received(uuid, uuid) from public, anon, authenticated;

-- 6. Apres la validation d'une reception
create or replace function public._part_path_after_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare r record;
begin
  begin
    perform public._part_receipt_allocate(new.id);
    for r in
      select distinct pl.order_id
        from public.purchase_lines rl
        join public.part_order_lines pl on pl.purchase_line_id = rl.source_line_id
       where rl.order_id = new.id and rl.source_line_id is not null
      union
      select distinct pl.order_id
        from public.part_receipt_allocations a
        join public.supplier_basket_lines bl on a.supply_kind = 'basket' and bl.id = a.supply_line_id
        join public.part_order_lines pl on pl.id = bl.origin_line_id
       where a.receipt_id = new.id
      union
      select distinct pl.order_id
        from public.part_receipt_allocations a
        join public.excel_order_lines xl on a.supply_kind = 'excel' and xl.id = a.supply_line_id
        join public.part_order_lines pl on pl.id = xl.part_order_line_id
       where a.receipt_id = new.id
    loop
      perform public._part_order_notify_received(r.order_id, new.id);
    end loop;
  exception when others then
    -- Le suivi ne doit jamais empecher d'entrer une reception en stock.
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (new.company_id, auth.uid(), 'part_path_error', 'purchase_orders', new.id::text, 'system', null,
            jsonb_build_object('message', left(sqlerrm, 300), 'state', sqlstate));
  end;
  return null;
end $fn$;
revoke all on function public._part_path_after_receipt() from public, anon, authenticated;

drop trigger if exists trg_porders_part_path on public.purchase_orders;
create trigger trg_porders_part_path
  after update of status on public.purchase_orders
  for each row
  when (new.doc_type = 'REC' and new.status = 'recue' and old.status is distinct from 'recue')
  execute function public._part_path_after_receipt();
