-- =====================================================================
-- PDV011 (03/11/2026) — essai a blanc de la migration 20261103220000_m6_z_avoirs.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261103150000_m6_caisse_audit.sql \
--      supabase/migrations/20261103160000_m6_tva_marge_a_la_vente.sql \
--      supabase/migrations/20261103170000_m6_caisse_legale.sql \
--      supabase/migrations/20261103180000_m6_facture_legale.sql \
--      supabase/migrations/20261103220000_m6_z_avoirs.sql \
--      supabase/tests/m6_z_avoirs.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Sans la migration 220000, les controles « ventes du Z », « CA net », « pas de ligne AVO » echouent
-- (preuve du constat). Joue le role d un administrateur (claims JWT simulees) dans ITALBIKE STORE :
--   - la session ouverte eventuelle est cloturee (dans la transaction annulee), une session d essai
--     s ouvre avec 50 EUR de fond ;
--   - ticket 100 EUR TTC (21 %), 60 EUR percus en especes ;
--   - avoir total du ticket dans la meme session : lettrage AVO 40 (ticket + / avoir -), remboursement
--     especes 60 ; le ticket passe en `avoir_emis` ;
--   - Z : ventes TIK 100, avoir -100, CA net 0, TVA 21 % a 0, encaissements sans ligne AVO,
--     especes 60 - 60 = 0, theorique = fond ; un acompte reporte (`transferred_from`) hors Z ;
--   - cloture : Z numerote, fige (v3), memes chiffres.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _sid uuid; _tik uuid; _avo uuid; _esp uuid; _x jsonb; _z jsonb; _leg jsonb; _pm jsonb; _s record;
begin
  -- ------------------------------------------------ session d essai (la vraie est cloturee puis tout est annule)
  -- Cloturee une minute plus tot : les reglements d essai (dates de now()) ne tombent pas dans sa periode figee.
  update public.cash_sessions set counted_cash = coalesce(expected_cash, 0), variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = now() - interval '1 minute'
   where company_id = _co and status = 'open';
  insert into public.cash_sessions (company_id, opened_by, opening_float, status)
  values (_co, auth.uid(), 50, 'open') returning id into _sid;

  -- ------------------------------------------------ ticket 100 EUR TTC, 60 EUR percus en especes
  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'TIK', 'brouillon', current_date, 82.64, 17.36, 100, 'ht') returning id into _tik;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_tik, 'TEST Z avoir', 1, 82.64, 21, 82.64, 100, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'TIK') where id = _tik;
  insert into public.document_payments (document_id, method, amount, status, note)
  values (_tik, 'ESP', 60, 'recu', 'TEST especes') returning id into _esp;
  perform public.recompute_document_paid(_tik);

  -- ------------------------------------------------ avoir total (generateCreditNote) : lettrage 40 + remboursement 60
  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode, source_document_id, cash_session_id)
  values (_co, 'AVO', 'brouillon', current_date, -82.64, -17.36, -100, 'ht', _tik, _sid) returning id into _avo;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_avo, 'TEST Z avoir', -1, 82.64, 21, -82.64, -100, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'AVO') where id = _avo;
  insert into public.document_payments (document_id, method, amount, status, note) values
    (_tik, 'AVO', 40, 'recu', 'TEST regle par avoir'),
    (_avo, 'AVO', -40, 'recu', 'TEST solde le ticket'),
    (_avo, 'ESP', -60, 'recu', 'TEST remboursement');
  update public.documents set status = 'avoir_emis' where id = _tik;
  perform public.recompute_document_paid(_tik);
  perform public.recompute_document_paid(_avo);

  -- Acompte reporte (`transferred_from`) : pas un nouvel encaissement, ni dans le Z ni dans l ancien Z horaire.
  insert into public.document_payments (document_id, method, amount, status, note, transferred_from)
  values (_tik, 'VIR', 25, 'recu', 'TEST acompte reporte', _esp);

  select * into _s from public.documents where id = _tik;
  insert into _t(check_name, result) values
    ('ticket rattache a la session', case when _s.cash_session_id = _sid then 'ok' else 'FAIL' end),
    ('ticket compense : statut avoir_emis fige', case when _s.status = 'avoir_emis' then 'ok' else 'FAIL ' || _s.status end),
    ('lettrage AVO rattache a la session (le Z doit l ecarter)', case when (select count(*) from public.document_payments where document_id in (_tik, _avo) and method = 'AVO' and cash_session_id = _sid) = 2 then 'ok' else 'FAIL' end),
    ('acompte reporte hors session', case when (select cash_session_id from public.document_payments where document_id = _tik and transferred_from = _esp) is null then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ rapport X (session ouverte)
  _x := public.cash_z_report_session(_sid);
  _pm := _x->'payments_by_method';
  insert into _t(check_name, result) values
    ('X : ventes du Z TIK 1 / 100', case when exists (select 1 from jsonb_array_elements(_x->'documents') e where e->>'doc_type' = 'TIK' and (e->>'count')::int = 1 and (e->>'total_ttc')::numeric = 100) then 'ok' else 'FAIL ' || (_x->'documents')::text end),
    ('X : avoir AVO 1 / -100', case when exists (select 1 from jsonb_array_elements(_x->'documents') e where e->>'doc_type' = 'AVO' and (e->>'count')::int = 1 and (e->>'total_ttc')::numeric = -100) then 'ok' else 'FAIL ' || (_x->'documents')::text end),
    ('X : nombre de tickets 1', case when (_x->>'ticket_count')::int = 1 then 'ok' else 'FAIL ' || (_x->>'ticket_count') end),
    ('X : CA net 100 - 100 = 0', case when (_x->>'net_sales_ttc')::numeric = 0 then 'ok' else 'FAIL ' || (_x->>'net_sales_ttc') end),
    ('X : remboursements -100', case when (_x->>'refunds_ttc')::numeric = -100 then 'ok' else 'FAIL ' || (_x->>'refunds_ttc') end),
    ('X : TVA 21 % compensee (base 0, TVA 0)', case when exists (select 1 from jsonb_array_elements(_x->'vat_breakdown') e where (e->>'vat_rate')::numeric = 21 and (e->>'base_ht')::numeric = 0 and (e->>'vat')::numeric = 0) then 'ok' else 'FAIL ' || (_x->'vat_breakdown')::text end),
    ('X : pas de ligne AVO dans les encaissements', case when not exists (select 1 from jsonb_array_elements(_pm) e where e->>'method' = 'AVO') then 'ok' else 'FAIL ' || _pm::text end),
    ('X : pas d acompte reporte (VIR) dans les encaissements', case when not exists (select 1 from jsonb_array_elements(_pm) e where e->>'method' = 'VIR') then 'ok' else 'FAIL ' || _pm::text end),
    ('X : especes ventes 60 / remboursements -60 / total 0', case when exists (select 1 from jsonb_array_elements(_pm) e where e->>'method' = 'ESP' and (e->>'sales')::numeric = 60 and (e->>'refunds')::numeric = -60 and (e->>'total')::numeric = 0) then 'ok' else 'FAIL ' || _pm::text end),
    ('X : especes theoriques = fond 50', case when (_x->>'expected_cash')::numeric = 50 then 'ok' else 'FAIL ' || (_x->>'expected_cash') end);

  -- ------------------------------------------------ ancien Z par plage horaire (repli de l ecran) : reglements du scenario seuls
  _leg := public.cash_z_report(_co, now(), now() + interval '1 second');
  insert into _t(check_name, result) values
    ('Z horaire : pas de ligne AVO', case when not exists (select 1 from jsonb_array_elements(_leg->'payments_by_method') e where e->>'method' = 'AVO') then 'ok' else 'FAIL ' || (_leg->'payments_by_method')::text end),
    ('Z horaire : pas d acompte reporte (VIR)', case when not exists (select 1 from jsonb_array_elements(_leg->'payments_by_method') e where e->>'method' = 'VIR') then 'ok' else 'FAIL ' || (_leg->'payments_by_method')::text end),
    ('Z horaire : ticket compense compte dans les documents', case when exists (select 1 from jsonb_array_elements(_leg->'documents') e where e->>'doc_type' = 'TIK' and (e->>'count')::int >= 1) then 'ok' else 'FAIL ' || (_leg->'documents')::text end);

  -- ------------------------------------------------ cloture : Z numerote et fige
  update public.cash_sessions set counted_cash = 50, status = 'closed' where id = _sid;
  select z_report into _z from public.cash_sessions where id = _sid;
  insert into _t(check_name, result) values
    ('Z : numero Z-AAAA-NNNNN', case when _z->>'number' ~ '^Z-\d{4}-\d{5}$' then 'ok' else 'FAIL ' || coalesce(_z->>'number', 'null') end),
    ('Z : version 3', case when (_z->>'version')::int = 3 then 'ok' else 'FAIL ' || coalesce(_z->>'version', 'null') end),
    ('Z : CA net 0', case when (_z->>'net_sales_ttc')::numeric = 0 then 'ok' else 'FAIL ' || (_z->>'net_sales_ttc') end),
    ('Z : ticket compte (TIK 100)', case when exists (select 1 from jsonb_array_elements(_z->'documents') e where e->>'doc_type' = 'TIK' and (e->>'total_ttc')::numeric = 100) then 'ok' else 'FAIL ' || (_z->'documents')::text end),
    ('Z : pas de ligne AVO', case when not exists (select 1 from jsonb_array_elements(_z->'payments_by_method') e where e->>'method' = 'AVO') then 'ok' else 'FAIL ' || (_z->'payments_by_method')::text end),
    ('Z : ecart 0 sans motif', case when (_z->>'variance')::numeric = 0 then 'ok' else 'FAIL ' || coalesce(_z->>'variance', 'null') end),
    ('Z fige = Z relu', case when public.cash_z_report_session(_sid) = _z then 'ok' else 'FAIL' end);
end $s$;

select n, check_name, result from _t order by n;
