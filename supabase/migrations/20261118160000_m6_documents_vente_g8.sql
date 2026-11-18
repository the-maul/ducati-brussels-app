-- =====================================================================
-- M6 — Rattrapage G8 « documents de vente » (lot-g8-documents-vente, 18/11/2026).
-- Idempotente. NON APPLIQUEE : Simon la passe avec le bloc du 18/11.
--
-- 1. `document_sources` : filiation N → 1 entre documents. Une facture issue de plusieurs bons de
--    livraison (G8 « Generation des factures par B.L. client ») garde la liste de ses BL ; une
--    facture « refacturee » depuis un avoir garde l avoir. `documents.source_document_id` reste
--    la filiation 1 → 1 historique (conversion simple, avoir, facture d acompte).
-- 2. Serie `ACD` « Acompte direct » (G8 Ventes › Acompte direct : un acompte encaisse sans
--    document). La sequence se cree d office au premier numero (_next_document_number_unchecked) :
--    l insertion ici ne fait que poser le libelle lisible dans Parametres → Numerotation.
-- 3. `sales_document_list` : liste paginee cote serveur des documents de vente (G8 « Liste des
--    factures », « Rappel facture », « Documents clients ») : filtres exercice / n° / date /
--    montant / client / operateur / pro-public / transfert comptable, colonnes montant du, remise,
--    acompte, marge, % marge, reglements, TVA, statut de transfert ; totaux et panier moyen sur
--    TOUTE la selection (pas seulement la page affichee). Lecture seule.
--
-- Marge : `_doc_margin` (M13) = lignes au PAMP du jour, sinon marge G8 importee. Meme limite que
-- les rapports (PAMP d aujourd hui, pas celui du jour de la vente) : voir bible M06 §7.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Filiation N → 1
-- ---------------------------------------------------------------------
create table if not exists public.document_sources (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  document_id        uuid not null references public.documents(id) on delete cascade,
  source_document_id uuid not null references public.documents(id) on delete restrict,
  kind               text not null default 'bl_grouping' check (kind in ('bl_grouping', 'rebill', 'direct_deposit')),
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  unique (document_id, source_document_id)
);
comment on table public.document_sources is
  'Filiation N → 1 : documents d origine d un document (BL regroupes dans une facture, avoir refacture, acompte direct impute).';
create index if not exists idx_document_sources_doc on public.document_sources(document_id);
create index if not exists idx_document_sources_src on public.document_sources(source_document_id);

alter table public.document_sources enable row level security;
drop policy if exists document_sources_read on public.document_sources;
create policy document_sources_read on public.document_sources for select to authenticated
  using (public.is_member(company_id));
-- Ecriture : memes droits que les documents (grille M0, `can_write_table`). Jamais de mise a jour :
-- une filiation se pose, elle ne se reecrit pas (append-only, B7).
drop policy if exists document_sources_insert on public.document_sources;
create policy document_sources_insert on public.document_sources for insert to authenticated
  with check (
    public.can_write_table(company_id, 'documents')
    and exists (select 1 from public.documents d where d.id = document_id and d.company_id = document_sources.company_id)
    and exists (select 1 from public.documents s where s.id = source_document_id and s.company_id = document_sources.company_id)
  );
grant select, insert on public.document_sources to authenticated;

insert into public.table_write_pages (table_name, page)
select 'document_sources', p from (values ('/sales'), ('/pos')) v(p)
on conflict do nothing;

-- Trace dans `events` (append-only) : qui a relie quoi, quand.
create or replace function public.trg_document_sources_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (new.company_id, auth.uid(), 'document_source', 'documents', new.document_id::text, 'screen',
          jsonb_build_object('source_document_id', new.source_document_id, 'kind', new.kind));
  return null;
end $$;
revoke all on function public.trg_document_sources_event() from public, anon, authenticated;
drop trigger if exists trg_document_sources_event on public.document_sources;
create trigger trg_document_sources_event after insert on public.document_sources
  for each row execute function public.trg_document_sources_event();

-- ---------------------------------------------------------------------
-- 2. Serie « Acompte direct »
-- ---------------------------------------------------------------------
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, 'ACD', 'ACD', 'Acompte direct' from public.companies c
on conflict (company_id, doc_type) do nothing;

-- ---------------------------------------------------------------------
-- 3. Liste paginee des documents de vente
-- ---------------------------------------------------------------------
-- _filters (jsonb, toutes les cles facultatives) :
--   doc_types        text[]  types (defaut FAC, TIK, AVO, FAA)
--   include_drafts   bool    brouillons compris (defaut non)
--   statuses         text[]  restreint aux statuts donnes
--   date_from/date_to date   date du document (l exercice est traduit en dates par l ecran)
--   number_from/number_to text plage de numeros (comparaison du texte : meme serie)
--   amount_min/amount_max numeric  TTC
--   contact_id       uuid
--   operator_user_id uuid ; operator_text text (documents repris de G8)
--   client_kind      'pro' | 'public'
--   transfer         'done' | 'pending'  (transfert comptable)
--   search           text    n°, n° G8, nom ou code du client
--   sort             'date_desc' (defaut) | 'date_asc' | 'number_asc' | 'number_desc' | 'amount_desc'
-- Retour : { total, rows: [...], totals: {...} }.
create or replace function public.sales_document_list(
  _company uuid, _filters jsonb default '{}'::jsonb, _offset integer default 0, _limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  _types   text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(_filters->'doc_types') x), array['FAC','TIK','AVO','FAA']);
  _stat    text[] := (select array_agg(x) from jsonb_array_elements_text(_filters->'statuses') x);
  _drafts  boolean := coalesce((_filters->>'include_drafts')::boolean, false);
  _dfrom   date := nullif(_filters->>'date_from', '')::date;
  _dto     date := nullif(_filters->>'date_to', '')::date;
  _nfrom   text := nullif(_filters->>'number_from', '');
  _nto     text := nullif(_filters->>'number_to', '');
  _amin    numeric := nullif(_filters->>'amount_min', '')::numeric;
  _amax    numeric := nullif(_filters->>'amount_max', '')::numeric;
  _contact uuid := nullif(_filters->>'contact_id', '')::uuid;
  _opuser  uuid := nullif(_filters->>'operator_user_id', '')::uuid;
  _optext  text := nullif(_filters->>'operator_text', '');
  _kind    text := nullif(_filters->>'client_kind', '');
  _transf  text := nullif(_filters->>'transfer', '');
  _search  text := nullif(trim(coalesce(_filters->>'search', '')), '');
  _sort    text := coalesce(nullif(_filters->>'sort', ''), 'date_desc');
  _lim     integer := least(greatest(coalesce(_limit, 50), 1), 500);
  _off     integer := greatest(coalesce(_offset, 0), 0);
  _result  jsonb;
begin
  if not public.is_member(_company) then
    raise exception 'Acces refuse a la societe %', _company using errcode = '42501';
  end if;

  with base as (
    select d.*, c.type::text as contact_kind, c.code as contact_code, c.legacy_code as contact_legacy_code,
           case when c.id is null then null
                when c.type::text = 'particulier' and coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), '') <> ''
                  then trim(concat_ws(' ', c.first_name, c.last_name))
                else coalesce(nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), '—') end as contact_name
      from public.documents d
      left join public.contacts c on c.id = d.contact_id
     where d.company_id = _company
       and d.doc_type = any(_types)
       and (_drafts or d.status <> 'brouillon')
       and (_stat is null or d.status = any(_stat))
       and (_dfrom is null or d.issue_date >= _dfrom)
       and (_dto is null or d.issue_date <= _dto)
       and (_nfrom is null or coalesce(d.number, d.legacy_number) >= _nfrom)
       and (_nto is null or coalesce(d.number, d.legacy_number) <= _nto)
       and (_amin is null or d.total_ttc >= _amin)
       and (_amax is null or d.total_ttc <= _amax)
       and (_contact is null or d.contact_id = _contact)
       and (_opuser is null or d.operator_user_id = _opuser)
       and (_optext is null or d.operator ilike '%' || _optext || '%')
       and (_kind is null
            or (_kind = 'pro' and c.type::text = 'professionnel')
            or (_kind = 'public' and (c.id is null or c.type::text <> 'professionnel')))
       and (_transf is null or (_transf = 'done' and d.compta_transferred) or (_transf = 'pending' and not d.compta_transferred))
       and (_search is null
            or d.number ilike '%' || _search || '%'
            or d.legacy_number ilike '%' || _search || '%'
            or c.code ilike '%' || _search || '%'
            or c.legacy_code ilike '%' || _search || '%'
            or c.company_name ilike '%' || _search || '%'
            or concat_ws(' ', c.first_name, c.last_name) ilike '%' || _search || '%')
  ),
  calc as (
    select b.*,
           public._doc_margin(b.id) as margin,
           -- Remise : reprise G8 (remise_ttc) sinon remises de lignes + remise globale (HT).
           coalesce(b.remise_ttc,
             (select coalesce(sum(l.quantity * l.unit_price_ht * l.discount_pct / 100), 0)
                from public.document_lines l where l.document_id = b.id and l.line_type in ('article', 'main_oeuvre'))
             + case when b.global_discount_pct > 0
                    then (select coalesce(sum(l.line_ht), 0) from public.document_lines l where l.document_id = b.id) * b.global_discount_pct / 100
                    else b.global_discount_amount end) as discount,
           (select coalesce(sum(p.amount), 0) from public.document_payments p
             where p.document_id = b.id and p.status = 'recu' and coalesce(p.note, '') ilike 'acompte%') as deposit,
           case when b.doc_type = 'AVO' then 0 else greatest(b.total_ttc - b.paid_amount, 0) end as due
      from base b
  ),
  page as (
    select * from calc
     order by
       case when _sort = 'date_asc' then issue_date end asc,
       case when _sort = 'number_asc' then coalesce(number, legacy_number) end asc,
       case when _sort = 'number_desc' then coalesce(number, legacy_number) end desc,
       case when _sort = 'amount_desc' then total_ttc end desc,
       case when _sort = 'date_desc' then issue_date end desc,
       created_at desc
     offset _off limit _lim
  )
  select jsonb_build_object(
    'total', (select count(*) from calc),
    'totals', (select jsonb_build_object(
        'count', count(*),
        'sales_count', count(*) filter (where doc_type <> 'AVO'),
        'ht', round(coalesce(sum(total_ht), 0), 2),
        'vat', round(coalesce(sum(total_vat), 0), 2),
        'ttc', round(coalesce(sum(total_ttc), 0), 2),
        'sales_ht', round(coalesce(sum(total_ht) filter (where doc_type <> 'AVO'), 0), 2),
        'sales_ttc', round(coalesce(sum(total_ttc) filter (where doc_type <> 'AVO'), 0), 2),
        'due', round(coalesce(sum(due), 0), 2),
        'discount', round(coalesce(sum(discount), 0), 2),
        'deposit', round(coalesce(sum(deposit), 0), 2),
        'margin', round(coalesce(sum(margin), 0), 2)) from calc),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'doc_type', p.doc_type, 'number', p.number, 'legacy_number', p.legacy_number,
        'status', p.status, 'issue_date', p.issue_date, 'due_date', p.due_date, 'created_at', p.created_at,
        'contact_id', p.contact_id, 'contact_name', p.contact_name, 'contact_code', coalesce(p.contact_legacy_code, p.contact_code, p.code_client_legacy),
        'contact_kind', p.contact_kind, 'operator', p.operator, 'operator_user_id', p.operator_user_id,
        'total_ht', p.total_ht, 'total_vat', p.total_vat, 'total_ttc', p.total_ttc, 'paid_amount', p.paid_amount,
        'due', round(p.due, 2), 'discount', round(p.discount, 2), 'deposit', round(p.deposit, 2),
        'margin', round(p.margin, 2), 'tax_exempt', p.tax_exempt, 'condition_reglement', p.condition_reglement,
        'compta_transferred', p.compta_transferred, 'date_transfert', p.date_transfert, 'notes', p.notes,
        'source_document_id', p.source_document_id, 'vehicle_id', p.vehicle_id,
        'payments', (select coalesce(jsonb_agg(jsonb_build_object('method', x.method, 'amount', x.amount, 'status', x.status) order by x.paid_at), '[]'::jsonb)
                       from public.document_payments x where x.document_id = p.id and x.amount <> 0 and x.status in ('recu', 'attendu'))
      ) order by
        case when _sort = 'date_asc' then p.issue_date end asc,
        case when _sort = 'number_asc' then coalesce(p.number, p.legacy_number) end asc,
        case when _sort = 'number_desc' then coalesce(p.number, p.legacy_number) end desc,
        case when _sort = 'amount_desc' then p.total_ttc end desc,
        case when _sort = 'date_desc' then p.issue_date end desc,
        p.created_at desc) from page p), '[]'::jsonb)
  ) into _result;
  return _result;
end $$;
revoke all on function public.sales_document_list(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.sales_document_list(uuid, jsonb, integer, integer) to authenticated;
comment on function public.sales_document_list(uuid, jsonb, integer, integer) is
  'Liste paginee des documents de vente (G8 Liste des factures / Documents clients) : filtres, totaux et panier moyen sur toute la selection.';
