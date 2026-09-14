-- =====================================================================
-- LOT 1 — Un prospect arrive avec sa première tâche : « Recontacter le client ».
-- Réf. docs/plan-nouveau-client.md
--
-- La migration précédente a fait de la tâche un objet à part (`lead_tasks`) et a
-- retiré le déclencheur qui posait une échéance sur la demande elle-même. Sans le
-- présent correctif, une demande créée depuis un mail n'aurait plus AUCUNE tâche :
-- elle n'apparaîtrait donc ni dans la cloche ni dans les retards.
--
-- La tâche initiale est confiée au destinataire par défaut de la société, jamais
-- à personne. Échéance à 2 jours, conformément à la demande du client.
-- Si la société n'a aucun administrateur, aucune tâche n'est créée plutôt que de
-- violer la contrainte : la demande reste visible, sans échéance.
-- =====================================================================

create or replace function public.create_prospect_from_email(
  _company     uuid,
  _email       text,
  _subject     text,
  _body        text,
  _received    timestamptz,
  _external_id text,
  _extract     jsonb
)
returns table(contact_id uuid, lead_id uuid, communication_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  _cid    uuid;
  _lid    uuid;
  _commid uuid;
  _existing_comm uuid;
  _is_pro boolean := coalesce((_extract->>'is_professional')::boolean, false);
  _relay  boolean := coalesce((_extract->>'sender_is_relay')::boolean, false);
  _cmail  text := nullif(btrim(coalesce(_extract->>'contact_email', '')), '');
  _first  text := nullif(btrim(coalesce(_extract->>'first_name', '')), '');
  _last   text := nullif(btrim(coalesce(_extract->>'last_name', '')), '');
  _co     text := nullif(btrim(coalesce(_extract->>'company_name', '')), '');
  _vat    text := nullif(btrim(coalesce(_extract->>'vat_number', '')), '');
  _phone  text := nullif(btrim(coalesce(_extract->>'phone', '')), '');
  _city   text := nullif(btrim(coalesce(_extract->>'city', '')), '');
  _zip    text := nullif(btrim(coalesce(_extract->>'zip', '')), '');
  -- NOT NULL avec defaut 'BE' : on ne passe jamais NULL ici.
  _country text := coalesce(nullif(btrim(coalesce(_extract->>'country', '')), ''), 'BE');
  _vref   text := nullif(btrim(coalesce(_extract->>'vehicle_ref', '')), '');
  _interest text := nullif(btrim(coalesce(_extract->>'interest', '')), '');
  _summary  text := nullif(btrim(coalesce(_extract->>'request_summary', '')), '');
  _channel text;
  _fiche_email text;
  _label  text;
  _notes  text;
  _owner  uuid;
begin
  if _email is null or btrim(_email) = '' then
    raise exception 'create_prospect_from_email: adresse e-mail de l''expediteur manquante';
  end if;

  _channel := case when _relay then 'web' else 'mail' end;
  _fiche_email := coalesce(_cmail, case when _relay then null else _email end);

  select c.id, c.contact_id into _existing_comm, _cid
    from public.communications c
   where c.company_id = _company and c.external_id = _external_id
   limit 1;
  if _existing_comm is not null then
    select l.id into _lid from public.leads l where l.contact_id = _cid order by l.created_at limit 1;
    return query select _cid, _lid, _existing_comm, false;
    return;
  end if;

  if _fiche_email is not null then
    select id into _cid from public.contacts
     where company_id = _company
       and (lower(email) = lower(_fiche_email) or lower(email_pro) = lower(_fiche_email))
     order by created_at limit 1;
  end if;

  if _cid is null then
    insert into public.contacts (
      company_id, type, status, origin, is_active,
      first_name, last_name, company_name, vat_number,
      email, email_pro, mobile, city, zip, country, notes
    ) values (
      _company,
      case when _is_pro then 'professionnel'::contact_type else 'particulier'::contact_type end,
      'prospect'::contact_status,
      _channel,
      true,
      _first, _last, _co, _vat,
      case when _is_pro then null else _fiche_email end,
      case when _is_pro then _fiche_email else null end,
      _phone, _city, _zip, _country,
      _summary
    )
    returning id into _cid;

    insert into public.contact_merge_candidates (company_id, contact_id, candidate_id, reason)
    select _company, _cid, m.contact_id, m.reason
      from public.contacts_match_candidates(
             _company, _fiche_email,
             nullif(btrim(coalesce(_first,'') || ' ' || coalesce(_last,'')), ''),
             _co, _phone, _cid) m
     where not exists (
             select 1 from public.contact_merge_candidates x
              where x.contact_id = _cid and x.candidate_id = m.contact_id);
  end if;

  insert into public.communications (
    company_id, contact_id, channel, direction, subject, body,
    occurred_at, external_id, from_address
  ) values (
    _company, _cid, 'email', 'in', _subject, _body,
    coalesce(_received, now()), _external_id, _email
  )
  returning id into _commid;

  _label := coalesce(
    nullif(btrim(coalesce(_co, '')), ''),
    nullif(btrim(coalesce(_first, '') || ' ' || coalesce(_last, '')), ''),
    _fiche_email, _email);

  _notes := concat_ws(E'\n',
    _summary,
    case when _vref is not null then 'Moto / châssis cité : ' || _vref end,
    case when _vat is not null then 'TVA : ' || _vat end,
    case when _city is not null or _zip is not null then 'Localité : ' || concat_ws(' ', _zip, _city) end,
    'Reçu le ' || to_char(coalesce(_received, now()), 'DD/MM/YYYY à HH24:MI')
      || ' par ' || case when _relay then 'le formulaire du site' else 'e-mail direct' end
      || ' (' || _email || ')');

  -- Une demande déjà ouverte pour ce client ? On ne crée PAS une deuxième carte :
  -- le mail vient s'ajouter à son fil, et sa tâche en cours reste la référence.
  select l.id into _lid
    from public.leads l
   where l.company_id = _company and l.contact_id = _cid
     and l.stage not in ('gagne', 'perdu')
   order by l.created_at
   limit 1;

  if _lid is null then
    insert into public.leads (
      company_id, contact_id, name, email, phone,
      vehicle_interest, source, stage, notes
    ) values (
      _company, _cid, _label, _fiche_email, _phone,
      coalesce(_interest, _vref),
      upper(_channel),
      'nouveau',
      _notes
    )
    returning id into _lid;

    -- Première tâche, jamais sans responsable ni sans échéance.
    _owner := public.default_assignee(_company);
    if _owner is not null then
      insert into public.lead_tasks (company_id, lead_id, title, due_at, assigned_to)
      values (_company, _lid, 'Recontacter le client', now() + interval '2 days', _owner);
    end if;
  end if;

  return query select _cid, _lid, _commid, true;
end $fn$;
revoke execute on function public.create_prospect_from_email(uuid, text, text, text, timestamptz, text, jsonb) from public, anon;
grant  execute on function public.create_prospect_from_email(uuid, text, text, text, timestamptz, text, jsonb) to service_role;
