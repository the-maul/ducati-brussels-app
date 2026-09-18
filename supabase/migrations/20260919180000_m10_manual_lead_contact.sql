-- M10 — Une carte créée à la main est reliée à une fiche client (onglet Échanges, réponse par mail).
--
-- Deux fonctions, strictement additives :
--
-- 1. crm_create_manual_lead : création manuelle d'une carte, en UNE transaction.
--    L'e-mail décide (D3) :
--      - une fiche de la société porte cet e-mail  → la carte y est reliée ;
--        si cette fiche a déjà une carte OUVERTE dans ce CRM, on n'en crée pas
--        une deuxième (C-2) : on renvoie la carte existante (existing = true) ;
--      - aucune fiche                               → fiche prospect créée
--        (origine « manuel »), rapprochements proposés (jamais de fusion auto) ;
--      - pas d'e-mail                               → carte sans fiche (l'écran prévient).
--    La carte entre avec sa tâche « Recontacter le client » à J+2, confiée au
--    responsable par défaut (C-1, C-5).
--
-- 2. crm_link_lead_contact : relie une carte existante sans fiche à une fiche
--    choisie, ou crée la fiche à partir des infos de la carte (même règle e-mail).
--    Renvoie aussi une éventuelle autre carte ouverte de ce client, pour le signaler.

create or replace function public.crm_create_manual_lead(
  _company uuid,
  _pipeline text,
  _name text,
  _email text default null,
  _phone text default null,
  _vehicle_interest text default null,
  _source text default null,
  _estimated_value numeric default null
)
returns table(lead_id uuid, contact_id uuid, contact_created boolean, existing boolean)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  _mail  text := nullif(lower(btrim(coalesce(_email, ''))), '');
  _tel   text := nullif(btrim(coalesce(_phone, '')), '');
  _label text := nullif(btrim(coalesce(_name, '')), '');
  _pipe  text := coalesce(nullif(btrim(coalesce(_pipeline, '')), ''), 'commercial');
  _cid   uuid;
  _lid   uuid;
  _new_c boolean := false;
  _first text;
  _last  text;
  _owner uuid;
begin
  if not public.is_member(_company) then
    raise exception 'crm_create_manual_lead: acces refuse' using errcode = '42501';
  end if;
  if _label is null then
    raise exception 'crm_create_manual_lead: nom manquant' using errcode = '22023';
  end if;

  if _mail is not null then
    -- Fiche existante avec cet e-mail : on garde une fiche active de préférence.
    select c.id into _cid
      from public.contacts c
     where c.company_id = _company
       and (public.contact_norm_txt(c.email) = public.contact_norm_txt(_mail)
         or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_mail))
     order by c.is_active desc, c.created_at
     limit 1;

    if _cid is not null then
      -- Jamais de carte en double pour un même client dans un même CRM.
      select l.id into _lid
        from public.leads l
       where l.company_id = _company and l.contact_id = _cid and l.pipeline = _pipe
         and l.archived_at is null and l.stage not in ('gagne', 'perdu')
       order by l.created_at
       limit 1;
      if _lid is not null then
        return query select _lid, _cid, false, true;
        return;
      end if;
    else
      -- Prénom = tout sauf le dernier mot ; nom = le dernier mot.
      _last  := regexp_replace(_label, '^.*\s', '');
      _first := nullif(btrim(left(_label, length(_label) - length(_last))), '');
      insert into public.contacts (company_id, type, status, origin, is_active,
                                   first_name, last_name, email, mobile, country)
      values (_company, 'particulier'::contact_type, 'prospect'::contact_status, 'manuel', true,
              _first, _last, _mail, _tel, 'BE')
      returning id into _cid;
      _new_c := true;

      -- D3 : ressemblances proposées, jamais fusionnées automatiquement.
      insert into public.contact_merge_candidates (company_id, contact_id, candidate_id, reason)
      select _company, _cid, m.contact_id, m.reason
        from public.contacts_match_candidates(_company, _mail, _label, null, _tel, _cid) m
       where not exists (select 1 from public.contact_merge_candidates x
                          where x.contact_id = _cid and x.candidate_id = m.contact_id);
    end if;
  end if;

  insert into public.leads (company_id, pipeline, contact_id, name, email, phone,
                            vehicle_interest, source, estimated_value, stage)
  values (_company, _pipe, _cid, _label, _mail, _tel,
          nullif(btrim(coalesce(_vehicle_interest, '')), ''),
          nullif(btrim(coalesce(_source, '')), ''),
          _estimated_value, 'nouveau')
  returning id into _lid;

  _owner := public.default_assignee(_company);
  if _owner is not null then
    insert into public.lead_tasks (company_id, lead_id, title, due_at, assigned_to, created_by)
    values (_company, _lid, 'Recontacter le client', now() + interval '2 days', _owner, auth.uid());
  end if;

  return query select _lid, _cid, _new_c, false;
end $function$;

revoke all on function public.crm_create_manual_lead(uuid, text, text, text, text, text, text, numeric) from public, anon;
grant execute on function public.crm_create_manual_lead(uuid, text, text, text, text, text, text, numeric) to authenticated;


create or replace function public.crm_link_lead_contact(_lead uuid, _contact uuid default null)
returns table(contact_id uuid, contact_created boolean, other_open_lead uuid)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  _l     public.leads%rowtype;
  _cid   uuid := _contact;
  _new_c boolean := false;
  _mail  text;
  _label text;
  _first text;
  _last  text;
  _other uuid;
begin
  select * into _l from public.leads where id = _lead;
  if not found or not public.is_member(_l.company_id) then
    raise exception 'crm_link_lead_contact: acces refuse' using errcode = '42501';
  end if;
  if _l.contact_id is not null then
    raise exception 'crm_link_lead_contact: carte deja reliee a une fiche' using errcode = '22023';
  end if;

  if _cid is not null then
    if not exists (select 1 from public.contacts c where c.id = _cid and c.company_id = _l.company_id) then
      raise exception 'crm_link_lead_contact: fiche introuvable dans cette societe' using errcode = '22023';
    end if;
  else
    _mail  := nullif(lower(btrim(coalesce(_l.email, ''))), '');
    _label := nullif(btrim(coalesce(_l.name, '')), '');
    -- D3 : si une fiche porte déjà l'e-mail de la carte, c'est elle.
    if _mail is not null then
      select c.id into _cid
        from public.contacts c
       where c.company_id = _l.company_id
         and (public.contact_norm_txt(c.email) = public.contact_norm_txt(_mail)
           or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_mail))
       order by c.is_active desc, c.created_at
       limit 1;
    end if;
    if _cid is null then
      if _label is null then
        raise exception 'crm_link_lead_contact: nom manquant' using errcode = '22023';
      end if;
      _last  := regexp_replace(_label, '^.*\s', '');
      _first := nullif(btrim(left(_label, length(_label) - length(_last))), '');
      insert into public.contacts (company_id, type, status, origin, is_active,
                                   first_name, last_name, email, mobile, country)
      values (_l.company_id, 'particulier'::contact_type, 'prospect'::contact_status, 'manuel', true,
              _first, _last, _mail, nullif(btrim(coalesce(_l.phone, '')), ''), 'BE')
      returning id into _cid;
      _new_c := true;

      insert into public.contact_merge_candidates (company_id, contact_id, candidate_id, reason)
      select _l.company_id, _cid, m.contact_id, m.reason
        from public.contacts_match_candidates(_l.company_id, _mail, _label, null,
                                              nullif(btrim(coalesce(_l.phone, '')), ''), _cid) m
       where not exists (select 1 from public.contact_merge_candidates x
                          where x.contact_id = _cid and x.candidate_id = m.contact_id);
    end if;
  end if;

  update public.leads set contact_id = _cid where id = _lead;

  -- Autre carte ouverte du même client dans ce CRM : l'écran le signale.
  select l.id into _other
    from public.leads l
   where l.company_id = _l.company_id and l.contact_id = _cid and l.id <> _lead
     and l.pipeline = _l.pipeline and l.archived_at is null
     and l.stage not in ('gagne', 'perdu')
   order by l.created_at
   limit 1;

  return query select _cid, _new_c, _other;
end $function$;

revoke all on function public.crm_link_lead_contact(uuid, uuid) from public, anon;
grant execute on function public.crm_link_lead_contact(uuid, uuid) to authenticated;
