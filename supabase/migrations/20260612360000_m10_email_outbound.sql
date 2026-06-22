-- =====================================================================
-- M10 — Mails SORTANTS : journaliser aussi les mails ENVOYÉS depuis la boîte d'écoute
-- (dossier Sent Items) sur la fiche du destinataire (direction 'out'). + envoi depuis
-- l'app (graph-send-email) qui se journalise pareil. RPC d'ingestion généralisée.
-- =====================================================================
alter table public.companies add column if not exists sent_last_check timestamptz;

-- Ingestion généralisée (entrant ou sortant). _match_email = adresse à retrouver dans
-- les contacts (expéditeur pour 'in', destinataire pour 'out') ; _display_from = ce
-- qu'on affiche (expéditeur réel). Idempotent (external_id). Matched=false si inconnu.
create or replace function public.ingest_email(
  _company uuid, _direction text, _match_email text, _display_from text,
  _subject text, _body text, _received timestamptz, _external_id text
) returns table(contact_id uuid, communication_id uuid, matched boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare _cid uuid; _existing uuid; _commid uuid;
begin
  select id, c.contact_id into _existing, _cid from public.communications c
    where c.company_id = _company and c.external_id = _external_id limit 1;
  if _existing is not null then
    return query select _cid, _existing, (_cid is not null); return;
  end if;

  select id into _cid from public.contacts
   where company_id = _company and _match_email is not null
     and (lower(email) = lower(_match_email) or lower(email_pro) = lower(_match_email))
   order by created_at limit 1;
  if _cid is null then
    return query select null::uuid, null::uuid, false; return;
  end if;

  insert into public.communications (company_id, contact_id, channel, direction, subject, body, occurred_at, external_id, from_address)
    values (_company, _cid, 'email', coalesce(_direction,'in'), _subject, _body, coalesce(_received, now()), _external_id, _display_from)
    returning id into _commid;
  return query select _cid, _commid, true;
end $$;
grant execute on function public.ingest_email(uuid, text, text, text, text, text, timestamptz, text) to authenticated, service_role;

-- Met à jour les curseurs de relève (entrant / envoyé) ; null = inchangé.
create or replace function public.set_mail_cursors(_company uuid, _in timestamptz, _sent timestamptz)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.companies
    set inbound_last_check = coalesce(_in, inbound_last_check),
        sent_last_check    = coalesce(_sent, sent_last_check)
  where id = _company;
$$;
grant execute on function public.set_mail_cursors(uuid, timestamptz, timestamptz) to authenticated, service_role;
