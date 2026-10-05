-- M1 — Le client doit voir TOUTES ses factures, y compris celles portées par
-- sa fiche liée. Retour de Simon du 05/10 : « dans l'app du client, il ne voit
-- pas ses factures présentes dans le DMS. Prends AGM, tu verras des factures
-- liées ». Cas réel : AGM FISC a 4 factures sur sa propre fiche et 13 sur la
-- fiche privée qui lui est liée ; le portail n'en montrait que 4.
-- Règle : le portail regarde la fiche du compte ET les fiches directement
-- liées (contact_links), rien de plus — pas de chaînage de liens.

create or replace function public._portal_contact_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select array_agg(distinct id) from (
    select ctx.contact_id as id from public._portal_ctx() ctx
    union
    select case when l.contact_a = ctx.contact_id then l.contact_b else l.contact_a end
      from public._portal_ctx() ctx
      join public.contact_links l
        on (l.contact_a = ctx.contact_id or l.contact_b = ctx.contact_id)
       and l.company_id = ctx.company_id
  ) s where s.id is not null;
$$;

grant execute on function public._portal_contact_ids() to authenticated, service_role;

-- Une facture est visible par le client si elle est AU NOM d'une de ses fiches
-- (la sienne ou une fiche liee), OU si elle concerne une moto qu'il possede
-- aujourd'hui et qu'elle a ete emise depuis qu'il la possede.
-- Cas reel : la facture d'achat de la moto est au nom de l'organisme de
-- financement (CBC BANQUE) ; le client ne la voyait nulle part.
-- La borne sur from_date evite de montrer l'historique du proprietaire precedent.
create or replace function public._portal_doc_visible(_doc_id uuid, _vehicle_id uuid, _contact_id uuid, _issue_date date, _ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select _contact_id = any(_ids)
      or (_vehicle_id is not null and exists (
            select 1 from public.vehicle_owners vo
            where vo.vehicle_id = _vehicle_id and vo.contact_id = any(_ids) and vo.is_current
              and (vo.from_date is null or _issue_date is null or _issue_date >= vo.from_date)
          ));
$$;

grant execute on function public._portal_doc_visible(uuid, uuid, uuid, date, uuid[]) to authenticated, service_role;

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
  from public.documents d
  join public.contacts c on c.id = d.contact_id
  where d.company_id = _ctx.company_id
    and public._portal_doc_visible(d.id, d.vehicle_id, d.contact_id, d.issue_date, _ids)
    and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee');
  return _r;
end $function$;

-- Même périmètre pour le détail : sinon la facture s'affiche dans la liste mais
-- « introuvable » au clic.
create or replace function public.portal_invoice(p_document_id uuid)
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
  if not exists (
    select 1 from public.documents d
    where d.id = p_document_id and d.company_id = _ctx.company_id
      and public._portal_doc_visible(d.id, d.vehicle_id, d.contact_id, d.issue_date, _ids)
      and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee')
  ) then
    raise exception 'portal: invoice not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'id', d.id, 'doc_type', d.doc_type, 'number', coalesce(d.number, d.legacy_number),
    'issue_date', d.issue_date, 'due_date', d.due_date, 'status', d.status,
    'total_ht', d.total_ht, 'total_vat', d.total_vat, 'total_ttc', d.total_ttc,
    'paid_amount', d.paid_amount, 'tax_exempt', d.tax_exempt,
    'imported', d.imported_from is not null,
    'pdf_path', public._portal_invoice_pdf(d.id, _ctx.company_id),
    'vehicle', case when v.id is not null then jsonb_build_object(
      'brand', v.brand, 'model', v.model, 'vin', v.vin, 'plate', v.plate) end,
    'company', jsonb_build_object(
      'name', co.name, 'legal_name', co.legal_name, 'vat_number', co.vat_number,
      'address', co.address, 'zip', co.zip, 'city', co.city, 'country', co.country,
      'iban', co.iban, 'bic', co.bic, 'invoice_footer', co.invoice_footer),
    'customer', jsonb_build_object(
      'first_name', c.first_name, 'last_name', c.last_name, 'company_name', c.company_name,
      'address', c.address, 'street_number', c.street_number, 'zip', c.zip, 'city', c.city,
      'country', c.country, 'vat_number', c.vat_number),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reference', l.reference, 'designation', l.designation, 'quantity', l.quantity,
        'unit_price_ht', l.unit_price_ht, 'vat_rate', l.vat_rate, 'discount_pct', l.discount_pct,
        'line_ht', l.line_ht, 'line_ttc', l.line_ttc) order by l.sort_order, l.created_at)
      from public.document_lines l where l.document_id = d.id), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'method', pm.method, 'amount', pm.amount, 'paid_at', pm.paid_at, 'status', pm.status)
        order by pm.paid_at)
      from public.document_payments pm where pm.document_id = d.id), '[]'::jsonb)
  ) into _r
  from public.documents d
  join public.companies co on co.id = d.company_id
  join public.contacts c on c.id = d.contact_id
  left join public.vehicles v on v.id = d.vehicle_id and v.company_id = d.company_id
  where d.id = p_document_id;
  return _r;
end $function$;

-- Le compteur de l'accueil compte le meme perimetre que la liste.
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
  -- Compteur sur la fiche du compte ET ses fiches liees (cf. portal_invoices).
  select count(*) into _ni from public.documents d
  where d.company_id = _ctx.company_id
    and public._portal_doc_visible(d.id, d.vehicle_id, d.contact_id, d.issue_date, public._portal_contact_ids())
    and d.doc_type in ('FAC', 'AVO', 'TIK') and d.status in ('validee', 'payee', 'annulee');

  return jsonb_build_object(
    'first_name', _c.first_name, 'last_name', _c.last_name, 'company_name', _c.company_name,
    'steps', _steps, 'steps_done', _done, 'steps_total', _total,
    'progress', case when _total = 0 then 100 else round(100.0 * _done / _total) end,
    'vehicles_count', _nv, 'invoices_count', _ni, 'pending_requests', _pending,
    'next_appointment', _next);
end $function$;
