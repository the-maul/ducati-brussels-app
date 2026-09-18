-- M10 — Échanges en attente de résumé dans la note de leur demande.
--
-- Retenus : e-mails, appels et SMS (pas les notes internes, qui sont déjà écrites
-- par un humain) ; rattachés à une demande OUVERTE et non archivée ; postérieurs à
-- la création de la demande — le mail qui a créé la demande est déjà résumé dans la
-- note d'origine — et datant de moins de dix jours, pour ne pas réécrire l'historique.
-- Réservé à la clé de service (appelé par la fonction summarize-exchange).

create or replace function public.pending_exchange_summaries(_limit integer default 5)
returns table (
  communication_id uuid, lead_id uuid, lead_name text, lead_notes text,
  channel text, direction text, subject text, body text,
  occurred_at timestamptz, mailbox text, from_address text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id, l.id, l.name, l.notes,
         m.channel, m.direction, m.subject, m.body,
         m.occurred_at, m.mailbox, m.from_address
    from public.communications m
    join lateral (
      select l2.* from public.leads l2
       where l2.archived_at is null
         and l2.stage in ('nouveau', 'contacte', 'qualifie', 'proposition')
         and (l2.id = m.lead_id or (m.lead_id is null and l2.contact_id = m.contact_id))
       order by (l2.id = m.lead_id) desc, l2.created_at desc
       limit 1
    ) l on true
   where m.summarized_at is null
     and m.channel in ('email', 'call', 'sms')
     and m.occurred_at > l.created_at
     and m.occurred_at > now() - interval '10 days'
   order by m.occurred_at
   limit greatest(1, least(_limit, 20));
$$;
revoke all on function public.pending_exchange_summaries(integer) from public, anon, authenticated;

-- Un même envoi peut être relevé dans deux boîtes (copie dans chaque dossier
-- « Éléments envoyés ») : deux lignes, même heure, même objet. Résumer l'une
-- marque aussi ses copies, sinon la note recevrait deux paragraphes identiques.
create or replace function public.append_lead_exchange_note(_comm uuid, _lead uuid, _text text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _m public.communications%rowtype;
begin
  update public.communications set summarized_at = now()
   where id = _comm and summarized_at is null
   returning * into _m;
  if not found then return false; end if;

  update public.communications set summarized_at = now()
   where summarized_at is null and id <> _m.id
     and contact_id is not distinct from _m.contact_id
     and channel = _m.channel and direction = _m.direction
     and date_trunc('second', occurred_at) = date_trunc('second', _m.occurred_at)
     and coalesce(subject, '') = coalesce(_m.subject, '');

  if coalesce(trim(_text), '') = '' then return true; end if;
  update public.leads
     set notes = coalesce(nullif(notes, '') || E'\n\n', '') || _text,
         last_activity_at = now()
   where id = _lead;
  return true;
end $$;
revoke all on function public.append_lead_exchange_note(uuid, uuid, text) from public, anon, authenticated;
