-- M1 — Correctif de performance du portail client.
-- La visibilité « facture d'une moto que je possède » était testée ligne par
-- ligne par une fonction : plus aucun index n'était utilisable et portal_home
-- mettait 14 s (> 8 s de délai PostgREST) → l'accueil du portail tournait sans
-- fin. On réécrit le périmètre en deux requêtes indexées réunies par UNION.

-- documents.vehicle_id n'était pas indexé : la branche « factures de ma moto »
-- parcourait toute la table.
create index if not exists idx_documents_vehicle
  on public.documents (vehicle_id) where vehicle_id is not null;

-- Les identifiants des factures visibles par le client, en deux requêtes
-- indexées : à son nom (ou au nom d'une fiche liée), ou concernant une moto
-- qu'il possède aujourd'hui et émises depuis qu'il la possède.
create or replace function public._portal_visible_documents(_ids uuid[], _company uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id from public.documents d
   where d.company_id = _company and d.contact_id = any(_ids)
     and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee')
  union
  select d.id from public.documents d
    join public.vehicle_owners vo
      on vo.vehicle_id = d.vehicle_id and vo.is_current and vo.contact_id = any(_ids)
   where d.company_id = _company
     and (vo.from_date is null or d.issue_date is null or d.issue_date >= vo.from_date)
     and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee');
$$;

grant execute on function public._portal_visible_documents(uuid[], uuid) to authenticated, service_role;

create or replace function public.portal_invoices()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare _ctx record; _ids uuid[]; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  _ids := public._portal_contact_ids();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'doc_type', d.doc_type, 'number', coalesce(d.number, d.legacy_number),
      'issue_date', d.issue_date, 'due_date', d.due_date, 'status', d.status,
      'total_ttc', d.total_ttc, 'paid_amount', d.paid_amount,
      'vehicle_label', case when d.vehicle_id is not null then public._portal_vehicle_label(d.vehicle_id) end,
      'imported', d.imported_from is not null,
      -- Nom du titulaire quand la facture vient d'une AUTRE fiche que celle du
      -- compte : le client comprend pourquoi elle est dans sa liste.
      'on_behalf', case when d.contact_id <> _ctx.contact_id then
        coalesce(nullif(c.company_name, ''),
                 nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '')) end,
      'pdf_path', public._portal_invoice_pdf(d.id, _ctx.company_id)
    ) order by d.issue_date desc, d.created_at desc), '[]'::jsonb)
  into _r
  from public._portal_visible_documents(_ids, _ctx.company_id) vis
  join public.documents d on d.id = vis.id
  join public.contacts c on c.id = d.contact_id;
  return _r;
end $function$;

-- Le compteur de l'accueil : c'est lui qui depassait le delai.
create or replace function public.portal_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _ctx record; _c record; _steps jsonb := '[]'::jsonb; _v record; _done int := 0; _total int := 0;
  _next jsonb; _pending int; _nv int; _ni int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select * into _c from public.contacts where id = _ctx.contact_id;

  _steps := _steps || jsonb_build_object('key', 'coordonnees', 'done',
    coalesce(_c.mobile, _c.phone) is not null and _c.address is not null and _c.zip is not null and _c.city is not null);
  _steps := _steps || jsonb_build_object('key', 'avatar', 'done',
    public._portal_last_upload(_ctx.contact_id, _ctx.contact_id, 'avatar') is not null);
  _steps := _steps || jsonb_build_object('key', 'preferences', 'done', _c.contact_preference is not null);
  _steps := _steps || jsonb_build_object('key', 'permis', 'done',
    public._portal_doc_complete(_ctx.contact_id, 'contact', _ctx.contact_id, 'permis'));
  -- Retour Simon 05/10 : la carte d'identité, au même rang que le permis.
  _steps := _steps || jsonb_build_object('key', 'carte_identite', 'done',
    public._portal_doc_complete(_ctx.contact_id, 'contact', _ctx.contact_id, 'carte_identite'));
  if _c.type = 'professionnel' then
    _steps := _steps || jsonb_build_object('key', 'societe', 'done', _c.company_name is not null and _c.vat_number is not null);
  end if;
  for _v in
    select v.id, public._portal_vehicle_label(v.id) as label
    from public.vehicle_owners vo join public.vehicles v on v.id = vo.vehicle_id
    where vo.contact_id = _ctx.contact_id and vo.is_current and v.company_id = _ctx.company_id
    order by vo.from_date desc limit 5
  loop
    _steps := _steps
      || jsonb_build_object('key', 'vehicle_photo', 'vehicle_id', _v.id, 'vehicle_label', _v.label, 'done',
           public._portal_last_upload(_ctx.contact_id, _v.id, 'vehicle_photo') is not null)
      || jsonb_build_object('key', 'carte_grise', 'vehicle_id', _v.id, 'vehicle_label', _v.label, 'done',
           public._portal_doc_complete(_ctx.contact_id, 'vehicle', _v.id, 'carte_grise'))
      || jsonb_build_object('key', 'assurance', 'vehicle_id', _v.id, 'vehicle_label', _v.label, 'done',
           public._portal_doc_complete(_ctx.contact_id, 'vehicle', _v.id, 'assurance'));
  end loop;
  select count(*), count(*) filter (where (s->>'done')::boolean) into _total, _done from jsonb_array_elements(_steps) s;

  select jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'status', a.status,
           'work_description', a.work_description,
           'vehicle_label', case when a.vehicle_id is not null then public._portal_vehicle_label(a.vehicle_id) end)
    into _next
  from public.workshop_appointments a
  where a.contact_id = _ctx.contact_id and a.company_id = _ctx.company_id
    and a.status in ('prevu', 'arrive', 'en_cours', 'demande') and a.starts_at >= now() - interval '12 hours'
  order by a.starts_at limit 1;
  select count(*) into _pending from public.workshop_appointments
  where contact_id = _ctx.contact_id and company_id = _ctx.company_id and status = 'demande';
  select count(*) into _nv from public.vehicle_owners vo join public.vehicles v on v.id = vo.vehicle_id
  where vo.contact_id = _ctx.contact_id and vo.is_current and v.company_id = _ctx.company_id;
  -- Meme perimetre que la liste, mais par requetes indexees (cf. 20261005171000).
  select count(*) into _ni
    from public._portal_visible_documents(public._portal_contact_ids(), _ctx.company_id);

  return jsonb_build_object(
    'first_name', _c.first_name, 'last_name', _c.last_name, 'company_name', _c.company_name,
    'steps', _steps, 'steps_done', _done, 'steps_total', _total,
    'progress', case when _total = 0 then 100 else round(100.0 * _done / _total) end,
    'vehicles_count', _nv, 'invoices_count', _ni, 'pending_requests', _pending,
    'next_appointment', _next);
end $function$;
