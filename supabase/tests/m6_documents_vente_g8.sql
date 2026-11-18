-- =====================================================================
-- Rattrapage G8 « documents de vente » (18/11/2026) — essai a blanc de la migration
-- 20261118160000_m6_documents_vente_g8.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118160000_m6_documents_vente_g8.sql \
--      supabase/tests/m6_documents_vente_g8.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue le role d un administrateur (claims JWT simulees) dans ITALBIKE STORE :
--   - deux factures (121 et 60,50 TTC, l une avec 21 percus), un avoir de 60,50 sur la seconde,
--     un BL et un brouillon ; marquees d un repere de recherche unique ;
--   - `sales_document_list` : total, pagination, totaux (avoir deduit, du, panier moyen sur les
--     seules ventes), brouillon et BL exclus, filtre montant, tri par numero, recherche ;
--   - `document_sources` : la facture regroupe le BL (lecture + evenement), une mise a jour est refusee ;
--   - serie ACD « Acompte direct » posee.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _cl uuid; _f1 uuid; _f2 uuid; _avo uuid; _bl uuid; _dr uuid;
  _tag text := 'ESSAIG8' || to_char(clock_timestamp(), 'HH24MISSMS');
  _r jsonb; _tot jsonb; _n int;
begin
  select id into _cl from public.contacts where company_id = _co limit 1;
  -- Les especes passent par le tiroir : sans caisse reelle ouverte (cloturee le soir, pas encore
  -- rouverte), l essai ouvre la sienne, maintenant (transaction annulee). Une caisse ouverte est reprise.
  if not exists (select 1 from public.cash_sessions where company_id = _co and status = 'open') then
    insert into public.cash_sessions (company_id, opened_by, opening_float, status, opened_at, note)
    values (_co, auth.uid(), 0, 'open', now(), 'ESSAI A BLANC (transaction annulee)');
  end if;

  -- ------------------------------------------------ documents d essai (notes = repere de recherche)
  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode, contact_id, notes, legacy_number)
  values (_co, 'FAC', 'brouillon', current_date, 100, 21, 121, 'ttc', _cl, 'essai', _tag || '-1') returning id into _f1;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_f1, 'ESSAI G8 1', 1, 100, 21, 100, 121, 0, 'article');
  update public.documents set status = 'validee' where id = _f1;
  insert into public.document_payments (document_id, method, amount, status, note) values (_f1, 'ESP', 21, 'recu', 'ESSAI');
  perform public.recompute_document_paid(_f1);

  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode, contact_id, legacy_number)
  values (_co, 'FAC', 'brouillon', current_date, 50, 10.5, 60.5, 'ttc', _cl, _tag || '-2') returning id into _f2;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_f2, 'ESSAI G8 2', 1, 50, 21, 50, 60.5, 0, 'article');
  update public.documents set status = 'validee' where id = _f2;

  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode, contact_id, source_document_id, legacy_number)
  values (_co, 'AVO', 'brouillon', current_date, -50, -10.5, -60.5, 'ttc', _cl, _f2, _tag || '-3') returning id into _avo;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_avo, 'ESSAI G8 2', -1, 50, 21, -50, -60.5, 0, 'article');
  update public.documents set status = 'validee' where id = _avo;

  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode, contact_id, legacy_number)
  values (_co, 'BL', 'brouillon', current_date, 10, 2.1, 12.1, 'ttc', _cl, _tag || '-4') returning id into _bl;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_bl, 'ESSAI G8 BL', 1, 10, 21, 10, 12.1, 0, 'article');
  update public.documents set status = 'validee' where id = _bl;

  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode, contact_id, legacy_number)
  values (_co, 'FAC', 'brouillon', current_date, 999, 0, 999, 'ttc', _cl, _tag || '-5') returning id into _dr;

  -- ------------------------------------------------ liste des factures
  _r := public.sales_document_list(_co, jsonb_build_object('search', _tag), 0, 2);
  _tot := _r->'totals';
  insert into _t(check_name, result) values
    ('total = 3 (FAC, FAC, AVO ; ni BL ni brouillon)', case when (_r->>'total')::int = 3 then 'ok' else 'KO ' || (_r->>'total') end),
    ('pagination : 2 lignes', case when jsonb_array_length(_r->'rows') = 2 then 'ok' else 'KO' end),
    ('TTC net = 121 (avoir deduit)', case when (_tot->>'ttc')::numeric = 121 then 'ok' else 'KO ' || (_tot->>'ttc') end),
    ('ventes = 2, TTC ventes = 181,50', case when (_tot->>'sales_count')::int = 2 and (_tot->>'sales_ttc')::numeric = 181.5 then 'ok' else 'KO ' || _tot::text end),
    ('du = 100 + 60,50', case when (_tot->>'due')::numeric = 160.5 then 'ok' else 'KO ' || (_tot->>'due') end);

  _r := public.sales_document_list(_co, jsonb_build_object('search', _tag, 'include_drafts', true, 'doc_types', jsonb_build_array('FAC')), 0, 50);
  insert into _t(check_name, result) values
    ('brouillons sur demande', case when (_r->>'total')::int = 3 then 'ok' else 'KO ' || (_r->>'total') end);

  _r := public.sales_document_list(_co, jsonb_build_object('search', _tag, 'amount_min', 100, 'sort', 'number_asc'), 0, 50);
  insert into _t(check_name, result) values
    ('filtre montant >= 100', case when (_r->>'total')::int = 1 and _r->'rows'->0->>'id' = _f1::text then 'ok' else 'KO ' || (_r->>'total') end),
    ('reglements de la ligne', case when jsonb_array_length(_r->'rows'->0->'payments') = 1 then 'ok' else 'KO' end),
    ('marge calculee', case when (_r->'rows'->0->>'margin') is not null then 'ok' else 'KO' end);

  _r := public.sales_document_list(_co, jsonb_build_object('search', _tag, 'doc_types', jsonb_build_array('BL')), 0, 50);
  insert into _t(check_name, result) values
    ('onglet livraisons : le BL', case when (_r->>'total')::int = 1 then 'ok' else 'KO' end);

  -- ------------------------------------------------ filiation N → 1
  insert into public.document_sources (company_id, document_id, source_document_id, kind) values (_co, _f1, _bl, 'bl_grouping');
  select count(*) into _n from public.document_sources where document_id = _f1 and source_document_id = _bl;
  insert into _t(check_name, result) values ('filiation lisible', case when _n = 1 then 'ok' else 'KO' end);
  select count(*) into _n from public.events where action = 'document_source' and entity_id = _f1::text;
  insert into _t(check_name, result) values ('filiation tracee dans events', case when _n = 1 then 'ok' else 'KO' end);
  begin
    update public.document_sources set kind = 'rebill' where document_id = _f1;
    get diagnostics _n = row_count;
  exception when insufficient_privilege then _n := 0;
  end;
  insert into _t(check_name, result) values ('filiation jamais reecrite (aucun UPDATE autorise)', case when _n = 0 then 'ok' else 'KO' end);
end $s$;

reset role;
-- ------------------------------------------------ serie ACD
insert into _t(check_name, result)
select 'serie ACD posee', case when exists (select 1 from public.document_sequences
  where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and doc_type = 'ACD' and label = 'Acompte direct') then 'ok' else 'KO' end;
select n, check_name, result from _t order by n;
