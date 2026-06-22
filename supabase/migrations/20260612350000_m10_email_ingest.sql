-- =====================================================================
-- M10 — Connexion Outlook (Microsoft Graph) : une boîte « d'écoute » par société.
-- À chaque relève (pg_cron toutes les 5 min, Edge Function outlook-poll) : pour chaque
-- nouveau mail, on cherche l'expéditeur dans les contacts ; si trouvé, on journalise
-- le mail dans son historique (communications, direction 'in') et les PHOTOS jointes
-- vont dans Documents & Photos (GED). Idempotent par identifiant de message Graph.
-- =====================================================================

alter table public.companies
  add column if not exists inbound_mailbox    text,        -- adresse Outlook écoutée (ex. info@ducatibxl.be)
  add column if not exists inbound_last_check timestamptz; -- dernier mail relevé (curseur)

alter table public.communications
  add column if not exists external_id  text,   -- id du message Graph (idempotence)
  add column if not exists from_address text;
create unique index if not exists uq_comms_external on public.communications(company_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------
-- Ingestion d'un mail entrant : matche le contact par e-mail (insensible casse),
-- journalise la communication. Retourne le contact + la communication pour permettre
-- d'y rattacher les pièces jointes. Idempotent (external_id).
-- ---------------------------------------------------------------------
create or replace function public.ingest_inbound_email(
  _company uuid, _from text, _subject text, _body text, _received timestamptz, _external_id text
) returns table(contact_id uuid, communication_id uuid, matched boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare _cid uuid; _existing uuid; _commid uuid;
begin
  -- idempotence
  select id, c.contact_id into _existing, _cid from public.communications c
    where c.company_id = _company and c.external_id = _external_id limit 1;
  if _existing is not null then
    return query select _cid, _existing, (_cid is not null); return;
  end if;

  -- match contact (e-mail principal ou pro), insensible à la casse
  select id into _cid from public.contacts
   where company_id = _company and _from is not null
     and (lower(email) = lower(_from) or lower(email_pro) = lower(_from))
   order by created_at limit 1;
  if _cid is null then
    return query select null::uuid, null::uuid, false; return;  -- inconnu → pas de journalisation
  end if;

  insert into public.communications (company_id, contact_id, channel, direction, subject, body, occurred_at, external_id, from_address)
    values (_company, _cid, 'email', 'in', _subject, _body, coalesce(_received, now()), _external_id, _from)
    returning id into _commid;
  return query select _cid, _commid, true;
end $$;
grant execute on function public.ingest_inbound_email(uuid, text, text, text, timestamptz, text) to authenticated, service_role;

-- Met à jour le curseur de relève (dernier mail traité) — appelé par l'Edge Function.
create or replace function public.set_inbound_cursor(_company uuid, _ts timestamptz)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.companies set inbound_last_check = _ts where id = _company;
$$;
grant execute on function public.set_inbound_cursor(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- pg_cron : relève toutes les 5 min (appel Edge Function via pg_net, clé anon publique).
-- ---------------------------------------------------------------------
do $$
declare _anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbXJvc2Jna3ZndndmbnVyeW5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwODY0NTksImV4cCI6MjA5NjY2MjQ1OX0.NevyuBLj0byFJin_7RBoFGDZbCuLPLOpLRj-QDI4_vs';
begin
  perform cron.schedule('outlook-poll', '*/5 * * * *',
    format($cron$ select net.http_post('https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/outlook-poll',
      '{}'::jsonb, '{}'::jsonb, jsonb_build_object('Content-Type','application/json','apikey','%s','Authorization','Bearer %s')); $cron$, _anon, _anon));
exception when others then raise notice 'cron outlook-poll skipped: %', sqlerrm;
end $$;
