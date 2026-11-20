-- =====================================================================
-- Parcours G8 n° 6 — Avoir total depuis la facture (lot-verif-parcours, 20/11/2026),
-- et numérotation G8 « un seul compteur ticket + facture + avoir » (décision Q29 : les deux au choix).
-- G8 : Rappel Facture › 22701457 › Générer avoir → confirmation → AVOIR 22701458 ; la facture affiche
--      le règlement « COMPENSE AVOIR » et un dû nul ; stock +1 (Historique mouvements : « Avoir »).
--      Numérotation : EXPRESS 22701456 → FACTURE 22701457 → AVOIR 22701458 (un seul compteur).
-- DMS : fiche document → « Générer un avoir » → `generateCreditNote` (write-api.ts) : `createDocument`
--       AVO (lignes en négatif, filiation `source_document_id`) → `document_assign_number` →
--       `record_stock_move` (entrée +1, réf. = n° de l'AVOIR depuis le correctif du 20/11, facture en note)
--       → lettrage : règlement « AVO » sur la facture et son inverse sur l'avoir (`addPayments` →
--       `recompute_document_paid`) → facture « avoir_emis » (elle reste au journal des ventes).
--       Numérotation : Paramètres → Numérotation (`set_sales_numbering_mode`, migration 20261118260000).
-- Société ItalTest, utilisateur simon@themaul.be (admin). Transaction annulée : rien ne reste en base.
-- Partie A : mode en vigueur dans ItalTest (séries séparées attendues) : facture → avoir total.
-- Partie B : ItalTest passée en compteur unique DANS l'essai (changement direct du réglage, permis ici :
--            tout est annulé ; l'écran refuse à raison le changement en cours d'exercice, contrôle 13) :
--            ticket → facture → avoir = trois numéros consécutifs du compteur VEN.
-- Contrôles :
--   A1 facture due 1,74 ; A2 n° de l'avoir = suivant de la série ; A3 totaux de l'avoir −1,44 / −0,30 / −1,74 ;
--   A4 filiation avoir → facture ; A5 facture « avoir_emis », réglée par avoir 1,74, dû 0 ; A6 lettrage sans
--   trésorerie (mode AVO, +1,74 / −1,74, tiroir inchangé) ; A7 stock 4 → 5 ; A8 mouvement entrée +1, réf. = n°
--   de l'avoir, facture en note, opérateur ; A9 PAMP inchangé ; A10 facture ET avoir au journal des ventes,
--   la facture n'est plus due chez les débiteurs ; A11 trace du statut avoir_emis ; A12 un second avoir n'est
--   plus possible (statut clos) ;
--   B13 changement de mode refusé en cours d'exercice (règle légale) ; B14 mode « compteur unique » actif ;
--   B15 ticket, facture, avoir : trois numéros consécutifs du compteur VEN ; B16 séries TIK / FAC / AVO
--   inchangées ; B17 stock du ticket et de la facture −2, avoir +1.
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- Numéro que la base donnera au prochain document du type (même règle que _next_document_number_unchecked).
create or replace function pg_temp.b1_next_number(_co uuid, _type text) returns text language plpgsql as $f$
declare _key text := _type; s public.document_sequences%rowtype; n bigint;
        y int := extract(year from (now() at time zone 'Europe/Brussels'))::int;
begin
  if _type in ('FAC', 'TIK', 'AVO')
     and coalesce((select sales_mode from public.numbering_settings where company_id = _co), 'separate') = 'single' then
    _key := 'VEN';
  end if;
  select * into s from public.document_sequences where company_id = _co and doc_type = _key;
  if not found then return null; end if;
  n := case when s.reset_yearly and s.current_year is distinct from y then 1 else s.next_value end;
  return s.prefix || s.separator || case when s.reset_yearly then y::text || s.separator else '' end
      || case when length(n::text) >= s.padding then n::text else lpad(n::text, s.padding, '0') end || coalesce(s.suffix, '');
end $f$;
grant execute on function pg_temp.b1_next_number(uuid, text) to authenticated;

-- Facture validée d'une ligne (createDocument FAC) : renvoie l'id. Mêmes écritures que le front.
create or replace function pg_temp.b1_invoice(_co uuid, _cli uuid, _art uuid) returns uuid language plpgsql as $f$
declare _doc uuid; _num text;
begin
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc)
  values (_co, null, 'brouillon', null, 'FAC', _cli, null, (now() at time zone 'Europe/Brussels')::date, null, null,
          1.44, 0.30, 1.74, 'ttc', false, 0, 0, 0, true, 21, null)
  returning id into _doc;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _doc, _art, a.designation, a.reference, 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0 from public.articles a where a.id = _art;
  _num := public.document_assign_number(_doc);
  perform public.record_stock_move(_art, 'sortie', -1, null, false, null, 'sale', _num, null);
  return _doc;
end $f$;
grant execute on function pg_temp.b1_invoice(uuid, uuid, uuid) to authenticated;

-- Avoir total d'une facture non payée (generateCreditNote, write-api.ts) : renvoie l'id de l'avoir.
create or replace function pg_temp.b1_credit_note(_inv uuid) returns uuid language plpgsql as $f$
declare d record; _avo uuid; _num text; l record;
begin
  select * into d from public.documents where id = _inv;
  insert into public.documents (company_id, number, status, source_document_id, doc_type, contact_id, vehicle_id, issue_date, due_date, notes,
                                total_ht, total_vat, total_ttc, price_mode, tax_exempt, global_discount_pct, global_discount_amount,
                                shipping_ht, shipping_taxed, shipping_vat_rate, forced_ttc, cash_session_id)
  values (d.company_id, null, 'brouillon', _inv, 'AVO', d.contact_id, d.vehicle_id, (now() at time zone 'Europe/Brussels')::date, null, d.notes,
          -d.total_ht, -d.total_vat, -d.total_ttc, d.price_mode, d.tax_exempt, d.global_discount_pct, d.global_discount_amount,
          d.shipping_ht, d.shipping_taxed, d.shipping_vat_rate, d.forced_ttc, null)
  returning id into _avo;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _avo, article_id, designation, reference, line_type, -quantity, unit_price_ht, vat_rate, discount_pct, -line_ht, -line_ttc, sort_order
    from public.document_lines where document_id = _inv;
  _num := public.document_assign_number(_avo);
  for l in select * from public.document_lines where document_id = _inv and line_type = 'article' and article_id is not null and quantity > 0 loop
    perform public.record_stock_move(l.article_id, 'entree', l.quantity, null, false, null, 'sale', _num, trim('Avoir / réintégration ' || coalesce(d.number, '')));
  end loop;
  -- Lettrage : facture impayée → le dû est soldé par l'avoir, rien n'est remboursé.
  insert into public.document_payments (document_id, method, amount, status, note, from_financing)
  values (_inv, 'AVO', d.total_ttc - d.paid_amount, 'recu', trim('Réglé par avoir ' || _num), false);
  perform public.recompute_document_paid(_inv);
  insert into public.document_payments (document_id, method, amount, status, note, from_financing)
  values (_avo, 'AVO', -(d.total_ttc - d.paid_amount), 'recu', trim('Solde la facture ' || coalesce(d.number, '')), false);
  perform public.recompute_document_paid(_avo);
  update public.documents set status = 'avoir_emis' where id = _inv;
  return _avo;
end $f$;
grant execute on function pg_temp.b1_credit_note(uuid) to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

-- ===================================================== Partie A : mode en vigueur (séries séparées)
do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _uid uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _today date := (now() at time zone 'Europe/Brussels')::date;
  _cli uuid; _art uuid; _inv uuid; _avo uuid; _exp text; _d record; _a record; _m record; _st record; _drawer0 numeric; _err text; _mode text;
begin
  insert into public.contacts (company_id, civility, type, last_name, first_name) values (_co, 'Monsieur', 'particulier', 'ESSAI B1', 'Avoir') returning id into _cli;
  insert into public.articles (company_id, reference, designation, mgmt_type, sale_price_ht, sale_price_ttc, vat_rate)
  values (_co, 'ESSAIB1-06-' || substr(md5(random()::text), 1, 6), 'ESSAI B1 manchon caoutchouc', 'A', 1.44, 1.74, 21) returning id into _art;
  perform public.record_stock_move(_art, 'entree', 5, 0.80, false, null, 'reception', 'ESSAI-B1', 'stock de depart de l essai');
  perform set_config('b1.cli', _cli::text, true);
  perform set_config('b1.art', _art::text, true);
  _drawer0 := public.cash_drawer_balance(_co);

  _inv := pg_temp.b1_invoice(_co, _cli, _art);
  select * into _d from public.documents where id = _inv;
  insert into _t(check_name, result) values ('A1 facture ' || _d.number || ' validee, due 1,74',
    case when _d.status = 'validee' and _d.total_ttc - _d.paid_amount = 1.74 then 'ok' else 'KO ' || _d.status end);

  _exp := pg_temp.b1_next_number(_co, 'AVO');
  _avo := pg_temp.b1_credit_note(_inv);
  select * into _a from public.documents where id = _avo;
  select * into _d from public.documents where id = _inv;
  insert into _t(check_name, result) values
    ('A2 numero de l avoir = suivant de la serie (' || coalesce(_exp, '?') || ')', case when _a.number = _exp then 'ok' else 'KO ' || coalesce(_a.number, 'null') end),
    ('A3 totaux de l avoir -1,44 / -0,30 / -1,74', case when _a.total_ht = -1.44 and _a.total_vat = -0.30 and _a.total_ttc = -1.74 and _a.doc_type = 'AVO' then 'ok' else 'KO ' || _a.total_ttc end),
    ('A4 filiation avoir -> facture', case when _a.source_document_id = _inv and _a.contact_id = _cli then 'ok' else 'KO' end),
    ('A5 facture compensee par l avoir : avoir_emis, reglee 1,74, du 0',
      case when _d.status = 'avoir_emis' and _d.paid_amount = 1.74 and _d.total_ttc - _d.paid_amount = 0 then 'ok' else 'KO ' || _d.status || ' ' || _d.paid_amount end),
    ('A6 lettrage sans tresorerie (AVO +1,74 / -1,74, tiroir inchange)',
      case when (select count(*) from public.document_payments where method = 'AVO' and ((document_id = _inv and amount = 1.74) or (document_id = _avo and amount = -1.74))) = 2
             and not exists (select 1 from public.document_payments where document_id in (_inv, _avo) and method <> 'AVO')
             and public.cash_drawer_balance(_co) = _drawer0 then 'ok' else 'KO' end);

  select * into _st from public.article_stock(_art);
  select * into _m from public.stock_moves where article_id = _art and move_type = 'entree' and origin = 'sale';
  insert into _t(check_name, result) values
    ('A7 stock reel 4 -> 5 (reintegration)', case when _st.real_qty = 5 then 'ok' else 'KO ' || _st.real_qty end),
    ('A8 mouvement : entree +1, ref = n de l avoir, facture en note, operateur',
      case when _m.qty_delta = 1 and not _m.is_reservation and _m.ref = _a.number and _m.note like '%' || _d.number and _m.operator_id = _uid
             and (select sum(qty_delta) from public.stock_moves where article_id = _art and not is_reservation and id < _m.id) = 4
           then 'ok' else 'KO ' || coalesce(_m.ref, 'aucun mouvement') end),
    ('A9 PAMP inchange (0,80)', case when (select pamp from public.articles where id = _art) = 0.80 then 'ok' else 'KO' end),
    ('A10 facture ET avoir au journal des ventes, plus rien du chez les debiteurs',
      case when (select count(*) from public.sales_journal(_co, _today, _today) j where j.document_id in (_inv, _avo)) = 2
             and not exists (select 1 from public.debtors_detailed(_co, null, null, _today + 60, _cli) x where x.document_id = _inv and x.amount_due > 0)
           then 'ok' else 'KO' end),
    ('A11 trace events du passage en avoir_emis',
      case when exists (select 1 from public.events where entity_type = 'documents' and entity_id = _inv::text and action = 'update'
                          and new_data->>'status' = 'avoir_emis' and actor_id = _uid) then 'ok' else 'KO' end),
    ('A12 un second avoir n est plus possible (facture close)',
      case when _d.status in ('brouillon', 'annulee', 'converti', 'avoir_emis') then 'ok' else 'KO' end);

  -- Règle légale du changement de mode (rule 3 de la migration) : refusé dès qu'un document est numéroté.
  _mode := coalesce((select sales_mode from public.numbering_settings where company_id = _co), 'separate');
  if _mode = 'separate' then
    begin
      perform public.set_sales_numbering_mode(_co, 'single', false);
      _err := null;
    exception when others then _err := sqlerrm;
    end;
    insert into _t(check_name, result) values ('B13 passage au compteur unique refuse en cours d exercice (ecran)',
      case when _err ilike '%Changement refus%' then 'ok' else 'KO ' || coalesce(_err, 'accepte') end);
  else
    insert into _t(check_name, result) values ('B13 ItalTest deja en compteur unique (controle du refus sans objet)', 'ok');
  end if;
end $s$;

-- ===================================================== Partie B : compteur unique (façon G8), réglage changé dans l'essai
reset role;
update public.numbering_settings set sales_mode = 'single', next_sales_mode = null, next_sales_mode_year = null
 where company_id = '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _today date := (now() at time zone 'Europe/Brussels')::date;
  _cli uuid := current_setting('b1.cli')::uuid; _art uuid := current_setting('b1.art')::uuid;
  _sess uuid; _tik uuid; _inv uuid; _avo uuid; _exp text; _n1 text; _n2 text; _n3 text; _seqs text; _seqs2 text; _r0 numeric; _r1 numeric;
  _v record;
begin
  insert into _t(check_name, result) values ('B14 mode compteur unique actif (numbering_overview)',
    case when public.numbering_overview(_co)->>'sales_mode' = 'single' then 'ok' else 'KO ' || (public.numbering_overview(_co)->>'sales_mode') end);
  select string_agg(doc_type || '=' || next_value || '/' || coalesce(current_year::text, '-'), ',' order by doc_type) into _seqs
    from public.document_sequences where company_id = _co and doc_type in ('TIK', 'FAC', 'AVO');
  select real_qty into _r0 from public.article_stock(_art);
  select * into _v from public.document_sequences where company_id = _co and doc_type = 'VEN';

  select id into _sess from public.cash_sessions where company_id = _co and status = 'open' order by opened_at desc limit 1;
  if _sess is null then
    insert into public.cash_sessions (company_id, opening_float, opened_by, note)
    values (_co, 100, auth.uid(), 'ESSAI parcours G8 06 (transaction annulee)') returning id into _sess;
  end if;

  _exp := pg_temp.b1_next_number(_co, 'TIK');
  -- Ticket Express (createDocument TIK, rattaché à la session par la base)
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', _today, 1.44, 0.30, 1.74, 'ttc') returning id into _tik;
  insert into public.document_lines (document_id, article_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_tik, _art, 'ESSAI B1 manchon caoutchouc', 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0);
  _n1 := public.document_assign_number(_tik);
  perform public.record_stock_move(_art, 'sortie', -1, null, false, null, 'sale', _n1, null);
  insert into public.document_payments (document_id, method, amount, status, given_amount, from_financing)
  values (_tik, 'ESP', 1.75, 'recu', 2.00, false), (_tik, 'ARR', -0.01, 'recu', null, false);
  perform public.recompute_document_paid(_tik);
  -- Facture puis avoir total
  _inv := pg_temp.b1_invoice(_co, _cli, _art);
  _avo := pg_temp.b1_credit_note(_inv);
  select number into _n2 from public.documents where id = _inv;
  select number into _n3 from public.documents where id = _avo;

  insert into _t(check_name, result) values
    ('B15 ticket ' || coalesce(_n1, '?') || ' -> facture ' || coalesce(_n2, '?') || ' -> avoir ' || coalesce(_n3, '?') || ' : un seul compteur',
      case when _n1 = _exp
             and _n2 = _v.prefix || lpad(((case when _v.reset_yearly and _v.current_year is distinct from extract(year from (now() at time zone 'Europe/Brussels'))::int then 1 else _v.next_value end) + 1)::text, _v.padding, '0')
             and _n3 = _v.prefix || lpad(((case when _v.reset_yearly and _v.current_year is distinct from extract(year from (now() at time zone 'Europe/Brussels'))::int then 1 else _v.next_value end) + 2)::text, _v.padding, '0')
           then 'ok' else 'KO attendu ' || coalesce(_exp, '?') || ' puis +1, +2' end);
  select string_agg(doc_type || '=' || next_value || '/' || coalesce(current_year::text, '-'), ',' order by doc_type) into _seqs2
    from public.document_sequences where company_id = _co and doc_type in ('TIK', 'FAC', 'AVO');
  insert into _t(check_name, result) values ('B16 series TIK / FAC / AVO inchangees en mode compteur unique',
    case when _seqs2 = _seqs then 'ok' else 'KO ' || _seqs || ' -> ' || _seqs2 end);
  select real_qty into _r1 from public.article_stock(_art);
  insert into _t(check_name, result) values ('B17 stock : ticket -1, facture -1, avoir +1',
    case when _r1 = _r0 - 1 then 'ok' else 'KO ' || _r0 || ' -> ' || _r1 end);
end $s$;

select n, check_name, result from _t order by n;
