-- =====================================================================
-- M10/M8/M12 — Infrastructure NOTIFICATIONS (e-mail / SMS) : file d'envoi +
-- enfilage automatique (confirmation commande e-shop, relances factures, rappels
-- RDV atelier la veille) + dispatch via Edge Function (Resend/SMS). Dégradé propre
-- si les clés ne sont pas posées (statut 'skipped'). pg_cron + pg_net.
-- =====================================================================
create extension if not exists pg_net;

create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  channel      text not null default 'email',      -- email | sms
  to_address   text,
  subject      text,
  body         text,
  template     text,                                -- order_confirm | invoice_reminder | appointment_reminder | crm
  entity_type  text,
  entity_id    text,
  status       text not null default 'pending',     -- pending | sent | failed | skipped
  error        text,
  scheduled_at timestamptz not null default now(),
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_notif_status on public.notifications(status, scheduled_at);
create index if not exists idx_notif_company on public.notifications(company_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (public.is_member(company_id));
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated with check (public.is_member(company_id));

-- Enfiler une notification (idempotence légère via template+entity sur 7 jours).
create or replace function public.enqueue_notification(
  _company uuid, _channel text, _to text, _subject text, _body text,
  _template text default null, _entity_type text default null, _entity_id text default null
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare _id bigint;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  if _to is null or _to = '' then return null; end if;
  if _template is not null and _entity_id is not null and exists (
      select 1 from public.notifications where template = _template and entity_id = _entity_id
        and created_at > now() - interval '7 days') then
    return null;  -- déjà enfilé récemment
  end if;
  insert into public.notifications (company_id, channel, to_address, subject, body, template, entity_type, entity_id)
    values (_company, _channel, _to, _subject, _body, _template, _entity_type, _entity_id) returning id into _id;
  return _id;
end $$;
grant execute on function public.enqueue_notification(uuid, text, text, text, text, text, text, text) to authenticated, service_role;

-- Confirmation de commande e-shop : enfilée quand la commande passe 'payee'.
create or replace function public.trg_enqueue_order_confirm()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'payee' and old.status is distinct from 'payee' and coalesce(new.email,'') <> '' then
    perform public.enqueue_notification(new.company_id, 'email', new.email,
      'Confirmation de votre commande ' || coalesce(new.number,''),
      'Bonjour, nous confirmons le paiement de votre commande ' || coalesce(new.number,'') ||
      ' (' || to_char(new.total_ttc, 'FM999G999D00') || ' EUR). Merci !',
      'order_confirm', 'web_order', new.id::text);
  end if;
  return new;
end $$;
drop trigger if exists trg_weborders_confirm on public.web_orders;
create trigger trg_weborders_confirm after update on public.web_orders for each row execute function public.trg_enqueue_order_confirm();

-- Relances factures impayées échues (1 par facture / 7 jours).
create or replace function public._cron_invoice_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare d record; _n int := 0;
begin
  for d in
    select doc.id, doc.number, doc.company_id, doc.total_ttc - doc.paid_amount as due, c.email,
           coalesce(c.company_name, trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))) as name
    from public.documents doc join public.contacts c on c.id = doc.contact_id
    where doc.doc_type = 'FAC' and doc.status not in ('annulee','converti')
      and doc.total_ttc - doc.paid_amount > 0.005 and doc.due_date < current_date and coalesce(c.email,'') <> ''
  loop
    if public.enqueue_notification(d.company_id, 'email', d.email,
        'Relance facture ' || coalesce(d.number,''),
        'Bonjour ' || d.name || ', votre facture ' || coalesce(d.number,'') || ' d''un montant de ' ||
        to_char(d.due, 'FM999G999D00') || ' EUR est échue. Merci de procéder au règlement.',
        'invoice_reminder', 'document', d.id::text) is not null then
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end $$;

-- Rappels RDV atelier la veille (e-mail + SMS).
create or replace function public._cron_appointment_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; _n int := 0;
begin
  for a in
    select ap.id, ap.company_id, ap.starts_at, c.email, c.mobile, c.phone,
           coalesce(c.company_name, trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))) as name
    from public.workshop_appointments ap join public.contacts c on c.id = ap.contact_id
    where ap.status = 'prevu' and ap.starts_at::date = (current_date + 1)
  loop
    if coalesce(a.email,'') <> '' then
      perform public.enqueue_notification(a.company_id, 'email', a.email, 'Rappel de rendez-vous atelier',
        'Bonjour ' || a.name || ', nous vous rappelons votre rendez-vous atelier le ' || to_char(a.starts_at, 'DD/MM/YYYY à HH24:MI') || '.',
        'appointment_reminder', 'appointment', a.id::text);
      _n := _n + 1;
    end if;
    if coalesce(a.mobile, a.phone, '') <> '' then
      perform public.enqueue_notification(a.company_id, 'sms', coalesce(a.mobile, a.phone),
        null, 'Rappel RDV atelier le ' || to_char(a.starts_at, 'DD/MM à HH24:MI') || '. A bientot.',
        'appointment_reminder', 'appointment', a.id::text || '-sms');
    end if;
  end loop;
  return _n;
end $$;

-- ---------------------------------------------------------------------
-- Planification : enfilage quotidien + dispatch (appel Edge Function via pg_net).
-- La clé anon est publique ; l'Edge Function (verify_jwt=false) envoie via service role.
-- ---------------------------------------------------------------------
do $$
declare _anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbXJvc2Jna3ZndndmbnVyeW5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwODY0NTksImV4cCI6MjA5NjY2MjQ1OX0.NevyuBLj0byFJin_7RBoFGDZbCuLPLOpLRj-QDI4_vs';
begin
  perform cron.schedule('invoice-reminders', '0 7 * * *', $cron$ select public._cron_invoice_reminders(); $cron$);
  perform cron.schedule('appointment-reminders', '0 17 * * *', $cron$ select public._cron_appointment_reminders(); $cron$);
  perform cron.schedule('dispatch-notifications', '*/10 * * * *',
    format($cron$ select net.http_post('https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/dispatch-notifications',
      '{}'::jsonb, '{}'::jsonb, jsonb_build_object('Content-Type','application/json','apikey','%s','Authorization','Bearer %s')); $cron$, _anon, _anon));
exception when others then
  raise notice 'pg_cron/pg_net scheduling skipped: %', sqlerrm;
end $$;
