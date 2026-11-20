-- =====================================================================
-- Parcours G8 n° 25 (bis) — Chaîne complète caisse → comptabilité (lot-verif-parcours, 20/11/2026, agent B2).
-- Demande de Simon : vente comptoir → ticket → règlement → mouvement de caisse → remise en banque → Z →
-- journaux → génération des écritures → export comptable EBP, avec contrôle des montants, de la TVA, des
-- comptes (paramétrage d'ItalTest) et de l'équilibre débit = crédit.
-- G8 de référence : parcours 4 (Express 1,74 € espèces), 22 (04 achat consommable 10 €), 23 (remise, nouveau
-- fond 100), 24 (journaux), 25 + export-comptable-g8.md (ECRITURES.TXT : VE / RC / CA, client de passage
-- 411000000, ventes 707000, TVA 445000, espèces 530000 / CA, carte 511300 / RC, mouvements 530000).
-- DMS, rejoué comme le front :
--   caisse      openSession (INSERT cash_sessions), addTypedMovement, cash_deposit_create, closeSession ;
--   ventes      createDocument (en-tête brouillon sans n°, lignes, document_invoice_required,
--               document_assign_number, record_stock_move « sale ») puis addPayments (+ arrondi ARR) et
--               recompute_document_paid ;
--   journaux    cash_journal_data, cash_z_report_session ;
--   compta      Comptabilité → Générer (generate_accounting_entries, plan PCMN de account_mappings) ;
--               Transfert EBP (ebp-api.ts) : loadEbpSources lit documents / ebp_payments_to_transfer /
--               cash_movements, buildEbpTransfer (TS) met en forme, record_accounting_transfer enregistre.
--               La mise en forme TS est couverte par tests/export-ebp-g8.test.ts ; ICI la résolution des
--               comptes (ebp-sources.ts : resolveCustomerThird / resolveSalesAccount / resolveVatAccount /
--               resolvePayment / buildMovement) est rejouée en SQL avec les règles et paramètres d'ItalTest,
--               puis on contrôle comptes, montants, équilibre et l'enregistrement du transfert.
-- Contrôles (montants en écart quand d'autres essais / agents travaillent dans ItalTest) :
--   1  article d'essai : stock 5 → vente de 2 : mouvement « sale » réf. = n° du ticket, réel 5 → 3, opérateur
--   2  ticket A numéroté, rattaché à la caisse, payé (24,20 espèces, monnaie rendue sur 30)
--   3  ticket B 1,74 : espèces arrondies 1,75 + ARR −0,01, soldé
--   4  facture du comptoir 121 (client) payée carte, soldée
--   5  mouvement 04 : −10, TVA 1,74, n°
--   6  remise en banque : nouveau fond 100, sortie 01 dans la caisse ouverte
--   7  Z : théorique 100 = compté, ventilation TVA 21 % 121,44 / 25,50, encaissements par mode
--   8  journaux : documents (sans brouillon), encaissements, mouvements 04 et 01, remise
--   9  écritures (Générer) : 3 pièces de vente + 4 règlements, chaque pièce équilibrée, brouillon exclu
--  10  écritures : comptes 400000 / 700000 / 451000, espèces 570000, carte / arrondi 550000 (account_mappings)
--  11  écritures : 2e génération = aucune pièce de plus pour ces documents (idempotent)
--  12  EBP : sources proposées = 3 documents, 4 règlements, 2 mouvements ; brouillon exclu
--  13  EBP : chaque pièce équilibrée ; total débit = total crédit
--  14  EBP : ticket → 411000000 CLIENT DIVERS D / 707000 C / 445000 C, journal VE, n° externe sans séparateur
--  15  EBP : facture → client « 411 + code » (aucun compte auxiliaire) ; client de passage et client soldés
--  16  EBP : ventes 707000 = 121,44 ; TVA 445000 = 25,50 = registre TVA de la période (écart)
--  17  EBP : espèces 530000 / CA, carte 511300 / RC ; arrondi ARR sans règle → 511200 / RC (à trancher)
--  18  EBP : 04 → 530000 C 10, 530000 D 8,26, TVA 1,74 sur compte VIDE (comme G8 FACTICE) ; 01 remise → 530000 / 530000
--  19  transfert enregistré : n° = précédent + 1, éléments, totaux, documents « Compta » cochés + date, events
--  20  après transfert : rien de ces éléments n'est plus proposé
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ebp(piece int, src_kind text, src_id uuid, journal text, account text, side text, amount numeric, label text) on commit drop;
grant all on _t, _ebp to authenticated; grant usage on sequence _t_n_seq to authenticated;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _b0 numeric; _s uuid; _art uuid; _ctc uuid; _code text; _ta uuid; _tb uuid; _fac uuid; _draft uuid; _ids uuid[];
  _num text; _mv public.cash_movements; _items jsonb; _total numeric; _dep public.cash_deposits; _m01 public.cash_movements;
  _sess public.cash_sessions; _j jsonb; _txt text; _r record; _n int; _n2 int; _ok boolean;
  _vat0 numeric; _vat1 numeric; _pays uuid[]; _movs uuid[];
  -- parametres EBP (defauts G8 de ebp-sources.ts, surcharges par accounting_transfer_settings)
  _st jsonb; _sales_acct text; _vat_acct text; _def_cust text; _def_label text; _jve text; _jrc text; _jca text;
  _pay_acct text; _mvt_acct text; _otf_prefix text; _otf_pad int;
  _piece int := 0; _d record; _p record; _m record; _third text; _acct text; _jr text; _ml text; _rate numeric;
  _tr jsonb; _tno0 int; _td numeric; _tc numeric; _did uuid;
begin
  -- ------------------------------------------------ caisse d un autre essai : cloturee ici (transaction annulee)
  if exists (select 1 from public.cash_sessions where company_id = _co and status = 'closed' and closed_at >= now()) then
    raise exception 'ESSAI : une caisse vient d etre cloturee a l instant, relancez l essai.';
  end if;
  update public.cash_sessions set counted_cash = 0, variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = opened_at
   where company_id = _co and status = 'open';
  _b0 := public.cash_drawer_balance(_co);
  select coalesce(sum(vat) filter (where vat_rate = 21), 0) into _vat0 from public.vat_register(_co, current_date, current_date);

  -- ------------------------------------------------ donnees d essai : article stocke (5 en stock), client
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ttc, vat_rate)
  values (_co, 'ZZB2-CHAINE', 'ESSAI chaine caisse compta', 'A', 5, 5, 12.10, 21) returning id into _art;
  perform public.record_stock_move(_art, 'entree', 5, 5, false, null, 'screen', null, 'essai stock initial');
  insert into public.contacts (company_id, civility, type, status, first_name, last_name)
  values (_co, 'Monsieur', 'particulier', 'client', 'ESSAI', 'CHAINE B2') returning id, code into _ctc, _code;

  -- ------------------------------------------------ 1. caisse : fond = tiroir + 350 (G8 : report 350)
  insert into public.cash_sessions (company_id, opening_float, opened_by, note)
  values (_co, _b0 + 350, auth.uid(), 'ESSAI chaine caisse compta') returning id into _s;

  -- ------------------------------------------------ 2. vente comptoir : ticket A, 2 x article (10 HT) = 24,20
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', current_date, 20, 4.20, 24.20, 'ttc') returning id into _ta;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_ta, _art, 'ESSAI chaine caisse compta', 'ZZB2-CHAINE', 'article', 2, 10, 21, 0, 20, 24.20, 0);
  if public.document_invoice_required(_ta) is not null then raise exception 'ESSAI : facture exigee pour le ticket A'; end if;
  _num := public.document_assign_number(_ta);
  perform public.record_stock_move(_art, 'sortie', -2, null, false, null, 'sale', _num, null);
  insert into public.document_payments (document_id, method, amount, status, given_amount) values (_ta, 'ESP', 24.20, 'recu', 30);
  perform public.recompute_document_paid(_ta);
  select * into _r from public.article_moves_detail(_art) order by occurred_at desc, move_id desc limit 1;
  insert into _t(check_name, result) values
    ('stock : vente de 2, origine sale, ref = n du ticket, reel 5 -> 3, operateur',
       case when exists (select 1 from public.stock_moves where article_id = _art and origin = 'sale' and ref = _num and qty_delta = -2 and operator_id = auth.uid())
             and _r.real_before = 5 and _r.real_after = 3 then 'ok' else 'KO ' || coalesce(_r.real_before::text, '?') || ' -> ' || coalesce(_r.real_after::text, '?') end),
    ('ticket A : numerote, rattache a la caisse, paye 24,20',
       case when (select number is not null and status in ('validee', 'payee') and cash_session_id = _s and paid_amount = 24.20 from public.documents where id = _ta)
            then 'ok' else 'KO ' || (select status || ' ' || coalesce(paid_amount::text, 'null') from public.documents where id = _ta) end);

  -- ticket B 1,74 (G8 parcours 4) : especes arrondies 1,75, ecart ARR -0,01 (applyCashRounding)
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', current_date, 1.44, 0.30, 1.74, 'ttc') returning id into _tb;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_tb, 'ESSAI chaine ticket B', 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0);
  perform public.document_assign_number(_tb);
  insert into public.document_payments (document_id, method, amount, status, note) values
    (_tb, 'ESP', 1.75, 'recu', null), (_tb, 'ARR', -0.01, 'recu', 'Arrondi especes (5 cents)');
  perform public.recompute_document_paid(_tb);
  insert into _t(check_name, result) values
    ('ticket B 1,74 : especes 1,75 + ARR -0,01, solde',
       case when (select paid_amount = 1.74 and number is not null from public.documents where id = _tb) then 'ok'
            else 'KO ' || (select coalesce(paid_amount::text, 'null') from public.documents where id = _tb) end);

  -- facture du comptoir 121 au client, rattachee a la caisse, payee par carte
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode, contact_id, cash_session_id)
  values (_co, null, 'brouillon', 'FAC', current_date, 100, 21, 121, 'ht', _ctc, _s) returning id into _fac;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_fac, 'ESSAI chaine facture', 'article', 1, 100, 21, 0, 100, 121, 0);
  perform public.document_assign_number(_fac);
  insert into public.document_payments (document_id, method, amount, status) values (_fac, 'MAE', 121, 'recu');
  perform public.recompute_document_paid(_fac);
  insert into _t(check_name, result) values
    ('facture 121 : numerotee, payee carte, soldee',
       case when (select number is not null and paid_amount = 121 from public.documents where id = _fac) then 'ok' else 'KO' end);
  -- brouillon (ne doit aller nulle part)
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode, cash_session_id)
  values (_co, null, 'brouillon', 'TIK', current_date, 1000, 210, 1210, 'ttc', _s) returning id into _draft;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_draft, 'ESSAI brouillon', 'article', 1, 1000, 21, 0, 1000, 1210, 0);
  _ids := array[_ta, _tb, _fac];

  -- ------------------------------------------------ 3. mouvement de caisse 04 (parcours 22)
  insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, operator_id, type_code)
  values (_co, _s, 'out', 10, 'ESP', 'TEST consommable', auth.uid(), '04') returning * into _mv;
  insert into _t(check_name, result) values
    ('mouvement 04 : -10, TVA 1,74, numero', case when _mv.vat_amount = 1.74 and _mv.movement_no is not null then 'ok' else 'KO' end);

  -- ------------------------------------------------ 4. remise en banque (caisse ouverte), nouveau fond 100
  select jsonb_agg(jsonb_build_object('type', c.source_type, 'id', c.source_id)), round(sum(c.amount), 2) into _items, _total
    from public.cash_deposit_candidates(_co, 'ESP', null, now(), false) c;
  _did := public.cash_deposit_create(_co, 'ESP', 'remise', null, now(), current_date, _items, round(_total - 100, 2), '01', null);
  select * into _dep from public.cash_deposits where id = _did;
  select * into _m01 from public.cash_movements where deposit_id = _dep.id;
  insert into _t(check_name, result) values
    ('remise : selection = B0 + 350 + 25,95 - 10, nouveau fond 100, sortie 01 dans la caisse',
       case when _total = _b0 + 365.95 and _dep.new_float = 100 and _m01.session_id = _s and _m01.amount = _total - 100 and _m01.type_code = '01'
            then 'ok' else 'KO selection ' || (_total - _b0) end);

  -- ------------------------------------------------ 5. Z (closeSession) : compte 100
  update public.cash_sessions set status = 'closed', closed_at = now(), counted_cash = 100, denominations = '{}'::jsonb
   where id = _s and status = 'open';
  select * into _sess from public.cash_sessions where id = _s;
  select string_agg((e->>'method') || ':' || round((e->>'total')::numeric, 2), ',' order by e->>'method') into _txt
    from jsonb_array_elements(_sess.z_report->'payments_by_method') e;
  insert into _t(check_name, result) values
    ('Z : theorique 100 = compte, TVA 21 % 121,44 / 25,50, encaissements ARR / ESP / MAE',
       case when _sess.expected_cash = 100 and (_sess.z_report->>'variance')::numeric = 0
             and exists (select 1 from jsonb_array_elements(_sess.z_report->'vat_breakdown') e where (e->>'vat_rate')::numeric = 21 and (e->>'base_ht')::numeric = 121.44 and (e->>'vat')::numeric = 25.50)
             and _txt = 'ARR:-0.01,ESP:25.95,MAE:121.00'
            then 'ok' else 'KO theorique ' || coalesce(_sess.expected_cash::text, 'null') || ' ' || coalesce(_txt, '') end);

  -- ------------------------------------------------ 6. journaux de la journee
  _j := public.cash_journal_data(_co, current_date, current_date);
  insert into _t(check_name, result) values
    ('journaux : 3 documents sans brouillon, 4 encaissements, mouvements 04 et 01, remise',
       case when (select count(*) from jsonb_array_elements(_j->'documents') e where (e->>'id')::uuid = any(_ids)) = 3
             and not exists (select 1 from jsonb_array_elements(_j->'documents') e where (e->>'id')::uuid = _draft)
             and (select count(*) from jsonb_array_elements(_j->'payments') e where (e->>'document_id')::uuid = any(_ids)) = 4
             and (select count(*) from jsonb_array_elements(_j->'movements') e where (e->>'id')::uuid in (_mv.id, _m01.id)) = 2
             and exists (select 1 from jsonb_array_elements(_j->'deposits') e where (e->>'id')::uuid = _dep.id and (e->>'new_float')::numeric = 100)
            then 'ok' else 'KO' end);

  -- ------------------------------------------------ 7. Comptabilite → Generer (moteur PCMN account_mappings)
  perform public.generate_accounting_entries(_co, current_date, current_date);
  select array_agg(p.id) into _pays from public.document_payments p where p.document_id = any(_ids);
  select count(*) filter (where e.source = 'sales'), count(*) filter (where e.source = 'payment') into _n, _n2
    from public.accounting_entries e
   where e.company_id = _co and ((e.source = 'sales' and e.source_id = any(select unnest(_ids)::text))
                              or (e.source = 'payment' and e.source_id = any(select unnest(_pays)::text)));
  select bool_and(abs(dd - cc) < 0.005) into _ok from (
    select e.id, sum(l.debit) dd, sum(l.credit) cc from public.accounting_entries e join public.accounting_entry_lines l on l.entry_id = e.id
     where e.company_id = _co and (e.source_id = any(select unnest(_ids)::text) or e.source_id = any(select unnest(_pays)::text)) group by e.id) x;
  insert into _t(check_name, result) values
    ('ecritures : 3 ventes + 4 reglements, chaque piece equilibree, brouillon exclu',
       case when _n = 3 and _n2 = 4 and _ok
             and not exists (select 1 from public.accounting_entries where company_id = _co and source_id = _draft::text)
            then 'ok' else 'KO ventes ' || _n || ' reglements ' || _n2 || ' equilibre ' || coalesce(_ok::text, 'null') end);
  select string_agg(x, ',' order by x) into _txt from (
    select distinct e.source || ':' || l.account_code || ':' || case when l.debit > 0 then 'D' else 'C' end as x
      from public.accounting_entries e join public.accounting_entry_lines l on l.entry_id = e.id
     where e.company_id = _co and (e.source_id = any(select unnest(_ids)::text) or e.source_id = any(select unnest(_pays)::text))) y;
  insert into _t(check_name, result) values
    ('ecritures : comptes (plan PCMN account_mappings d ItalTest)',
       case when _txt = 'payment:400000:C,payment:400000:D,payment:550000:C,payment:550000:D,payment:570000:D,sales:400000:D,sales:451000:C,sales:700000:C'
            then 'ok' else 'KO ' || coalesce(_txt, 'vide') end);
  perform public.generate_accounting_entries(_co, current_date, current_date);
  insert into _t(check_name, result) select 'ecritures : 2e generation sans doublon',
    case when (select count(*) from public.accounting_entries e where e.company_id = _co
                and (e.source_id = any(select unnest(_ids)::text) or e.source_id = any(select unnest(_pays)::text))) = 7 then 'ok' else 'KO' end;

  -- ------------------------------------------------ 8. Transfert EBP : sources (loadEbpSources)
  _st := coalesce((select params from public.accounting_transfer_settings where company_id = _co), '{}'::jsonb);
  _sales_acct := coalesce(_st#>>'{sales,salesAccount}', '707000');
  _vat_acct   := coalesce(_st#>>'{sales,vatAccount}', '445000');
  _def_cust   := coalesce(_st#>>'{sales,defaultCustomerAccount}', '411000000');
  _def_label  := coalesce(_st#>>'{sales,defaultCustomerLabel}', 'CLIENT DIVERS');
  _jve        := coalesce(_st#>>'{sales,journal}', 'VE');
  _jrc        := coalesce(_st#>>'{payments,journal}', 'RC');
  _jca        := coalesce(_st#>>'{payments,cashJournal}', 'CA');
  _pay_acct   := coalesce(_st#>>'{payments,paymentAccount}', '511200');
  _mvt_acct   := coalesce(_st#>>'{payments,cashMovementAccount}', '530000');
  _otf_prefix := coalesce(_st#>>'{sales,onTheFlyPrefix}', '411');
  _otf_pad    := coalesce((_st#>>'{sales,onTheFlyPad}')::int, 5);

  select array_agg(m.id) into _movs from public.cash_movements m
   where m.company_id = _co and m.occurred_at >= (select coalesce(accounting_start_date, '1900-01-01') from public.companies where id = _co)
     and m.occurred_at <= (current_date::text || 'T23:59:59.999')::timestamptz
     and not exists (select 1 from public.accounting_transfer_items i where i.company_id = _co and i.source_kind = 'cash_movement' and i.source_id = m.id and not i.cancelled);
  insert into _t(check_name, result) values
    ('EBP : sources = 3 documents, 4 reglements, mouvements 04 et 01 ; brouillon exclu',
       case when (select count(*) from public.documents d where d.id = any(_ids) and d.doc_type in ('FAC','TIK','AVO','FAA') and d.status not in ('brouillon','annulee')
                    and d.issue_date = current_date and not d.compta_transferred) = 3
             and (select count(*) from public.ebp_payments_to_transfer(_co, current_date, null) p where p.id = any(_pays) and p.method <> 'AVO') = 4
             and _mv.id = any(_movs) and _m01.id = any(_movs)
             and (select status from public.documents where id = _draft) = 'brouillon'
            then 'ok' else 'KO' end);

  -- ---- pieces de vente (buildSaleDoc) : client TTC au debit, ventes HT et TVA au credit
  for _d in select d.*, c.code as ccode, nullif(btrim(c.accounting_account), '') as cacct
              from public.documents d left join public.contacts c on c.id = d.contact_id
             where d.id = any(_ids) order by d.issue_date, d.number loop
    _piece := _piece + 1;
    _third := case when _d.contact_id is null then _def_cust
                   else coalesce((select account from public.accounting_third_accounts where company_id = _co and contact_id = _d.contact_id and kind = 'C'),
                                 _d.cacct,
                                 case when coalesce(_d.ccode, '') = '' then null when length(_d.ccode) >= _otf_pad then _otf_prefix || _d.ccode else _otf_prefix || lpad(_d.ccode, _otf_pad, '0') end,
                                 _def_cust) end;
    insert into _ebp values (_piece, 'document', _d.id, _jve, _third, 'D', _d.total_ttc, _d.number);
    insert into _ebp
    select _piece, 'document', _d.id, _jve, acct, 'C', sum(amt), _d.number from (
      select coalesce((select r.account from public.accounting_account_rules r where r.company_id = _co and r.kind = 'sales' and r.is_active
                         and r.key is null and r.family is null and (r.vat_rate is null or r.vat_rate = l.vat_rate)
                         and r.tax_exempt is null and r.demo is null and r.customer_category is null
                       order by (r.vat_rate is not null) desc, r.sort_order limit 1),
                      nullif(btrim(a.sales_account), ''), _sales_acct) as acct, l.line_ht as amt
        from public.document_lines l left join public.articles a on a.id = l.article_id
       where l.document_id = _d.id and coalesce(l.line_type, 'article') not in ('texte', 'vide')) x group by acct;
    insert into _ebp
    select _piece, 'document', _d.id, _jve, acct, 'C', sum(amt), _d.number from (
      select coalesce((select r.account from public.accounting_account_rules r where r.company_id = _co and r.kind = 'vat' and r.is_active and r.country is null
                         and (r.vat_rate = l.vat_rate or (r.vat_rate is null and r.key = l.vat_rate::text)) limit 1), _vat_acct) as acct,
             l.line_ttc - l.line_ht as amt
        from public.document_lines l where l.document_id = _d.id and coalesce(l.line_type, 'article') not in ('texte', 'vide') and l.line_ttc <> l.line_ht) x group by acct;
  end loop;

  -- ---- reglements (buildPayment) : tresorerie / client
  for _p in select p.*, d.contact_id as ctc, c.code as ccode, nullif(btrim(c.accounting_account), '') as cacct, d.number as dnum
              from public.ebp_payments_to_transfer(_co, current_date, null) p
              left join public.documents d on d.id = p.document_id left join public.contacts c on c.id = d.contact_id
             where p.id = any(_pays) order by p.created_at, p.id loop
    _piece := _piece + 1;
    select coalesce(r.account, ''), coalesce(nullif(r.journal, ''), case when _p.method = 'ESP' then _jca else _jrc end) into _acct, _jr
      from public.accounting_account_rules r where r.company_id = _co and r.kind = 'payment' and r.is_active and upper(r.key) = upper(_p.method) limit 1;
    if not found then
      _acct := case _p.method when 'ESP' then '530000' when 'MAE' then '511300' when 'VIR' then '511400' when 'VID' then '' when 'VIC' then '' else _pay_acct end;
      _jr := case _p.method when 'ESP' then 'CA' when 'MAE' then 'RC' when 'VIR' then 'RC' when 'VID' then 'RC' when 'VIC' then 'RC'
                            else case when _p.method = 'ESP' then _jca else _jrc end end;
    end if;
    _third := case when _p.ctc is null then _def_cust
                   else coalesce((select account from public.accounting_third_accounts where company_id = _co and contact_id = _p.ctc and kind = 'C'),
                                 _p.cacct,
                                 case when coalesce(_p.ccode, '') = '' then null when length(_p.ccode) >= _otf_pad then _otf_prefix || _p.ccode else _otf_prefix || lpad(_p.ccode, _otf_pad, '0') end,
                                 _def_cust) end;
    insert into _ebp values
      (_piece, 'payment', _p.id, _jr, _acct, case when _p.amount < 0 then 'C' else 'D' end, abs(_p.amount), _p.method || ' ' || _p.dnum),
      (_piece, 'payment', _p.id, _jr, _third, case when _p.amount < 0 then 'D' else 'C' end, abs(_p.amount), _p.method || ' ' || _p.dnum);
  end loop;

  -- ---- mouvements de caisse (buildMovement) : sortie = credit du mode, debit du compte du type (HT) + TVA
  for _m in select m.* from public.cash_movements m where m.id in (_mv.id, _m01.id) order by m.occurred_at, m.movement_no loop
    _piece := _piece + 1;
    select coalesce(nullif(r.account, ''), _mvt_acct), coalesce(r.account2, ''), coalesce(r.label, _m.type_code) into _acct, _ml, _txt
      from public.accounting_account_rules r where r.company_id = _co and r.kind = 'cash_movement' and r.is_active and r.key = _m.type_code limit 1;
    if not found then _acct := _mvt_acct; _ml := ''; _txt := _m.type_code; end if;
    if _acct = _mvt_acct and _m.account_code is not null then _acct := _m.account_code; end if;
    insert into _ebp values
      (_piece, 'cash_movement', _m.id, _jrc, '530000', case when _m.kind = 'in' then 'D' else 'C' end, _m.amount, _txt),
      (_piece, 'cash_movement', _m.id, _jrc, _acct, case when _m.kind = 'in' then 'C' else 'D' end, _m.amount - coalesce(_m.vat_amount, 0), _txt);
    if coalesce(_m.vat_amount, 0) <> 0 and _m.kind = 'out' then
      insert into _ebp values (_piece, 'cash_movement', _m.id, _jrc, _ml, 'D', _m.vat_amount, _txt);
    end if;
  end loop;
  -- le compte du mode especes des mouvements vient de resolvePayment('ESP')
  update _ebp set account = coalesce((select nullif(r.account, '') from public.accounting_account_rules r where r.company_id = _co and r.kind = 'payment' and r.key = 'ESP'), '530000')
   where src_kind = 'cash_movement' and account = '530000' and side = case when (select kind from public.cash_movements where id = src_id) = 'in' then 'D' else 'C' end;

  -- ---- controles de l export
  select round(sum(amount) filter (where side = 'D'), 2), round(sum(amount) filter (where side = 'C'), 2) into _td, _tc from _ebp;
  insert into _t(check_name, result) values
    ('EBP : chaque piece equilibree, total debit = total credit',
       case when not exists (select piece from _ebp group by piece having round(sum(case when side = 'D' then amount else -amount end), 2) <> 0)
             and _td = _tc and _piece = 9 then 'ok' else 'KO D ' || _td || ' C ' || _tc || ' pieces ' || _piece end);
  insert into _t(check_name, result) values
    ('EBP : tickets -> 411000000 (' || _def_label || ') D / 707000 C / 445000 C, journal VE',
       case when (select string_agg(account || side || amount, ',' order by side desc, account) from _ebp where src_id = _ta) = '411000000D24.20,445000C4.20,707000C20.00'
             and (select string_agg(account || side || amount, ',' order by side desc, account) from _ebp where src_id = _tb) = '411000000D1.74,445000C0.30,707000C1.44'
             and (select bool_and(journal = 'VE') from _ebp where src_kind = 'document') and _def_label = 'CLIENT DIVERS'
            then 'ok' else 'KO ' || coalesce((select string_agg(account || side || amount, ',' order by side desc, account) from _ebp where src_id = _ta), 'vide') end);
  insert into _t(check_name, result) values
    ('EBP : facture -> client 411 + code (' || _otf_prefix || lpad(_code, _otf_pad, '0') || '), client de passage et client soldes',
       case when exists (select 1 from _ebp where src_id = _fac and side = 'D' and account = _otf_prefix || lpad(_code, _otf_pad, '0') and amount = 121)
             and (select round(sum(case when side = 'D' then amount else -amount end), 2) from _ebp where account = '411000000') = 0
             and (select round(sum(case when side = 'D' then amount else -amount end), 2) from _ebp where account = _otf_prefix || lpad(_code, _otf_pad, '0')) = 0
            then 'ok' else 'KO' end);
  select coalesce(sum(vat) filter (where vat_rate = 21), 0) into _vat1 from public.vat_register(_co, current_date, current_date);
  insert into _t(check_name, result) values
    ('EBP : ventes 707000 = 121,44 ; TVA 445000 = 25,50 = ecart du registre TVA',
       case when (select sum(amount) from _ebp where account = '707000' and side = 'C') = 121.44
             and (select sum(amount) from _ebp where account = '445000' and side = 'C') = 25.50 and _vat1 - _vat0 = 25.50
            then 'ok' else 'KO' end);
  insert into _t(check_name, result) values
    ('EBP : especes 530000 / CA, carte 511300 / RC, arrondi ARR sans regle -> ' || _pay_acct || ' / RC (a trancher)',
       case when (select count(*) from _ebp e join public.document_payments p on p.id = e.src_id where p.method = 'ESP' and e.account = '530000' and e.side = 'D' and e.journal = 'CA') = 2
             and exists (select 1 from _ebp e join public.document_payments p on p.id = e.src_id where p.method = 'MAE' and e.account = '511300' and e.side = 'D' and e.amount = 121 and e.journal = 'RC')
             and exists (select 1 from _ebp e join public.document_payments p on p.id = e.src_id where p.method = 'ARR' and e.account = _pay_acct and e.side = 'C' and e.amount = 0.01 and e.journal = 'RC')
            then 'ok' else 'KO' end);
  insert into _t(check_name, result) values
    ('EBP : 04 -> 530000 C 10 / 530000 D 8,26 / TVA 1,74 sur compte vide (G8 FACTICE) ; 01 remise -> 530000 C / 530000 D',
       case when (select string_agg(coalesce(nullif(account, ''), '(vide)') || side || amount, ',' order by side desc, amount desc) from _ebp where src_id = _mv.id) = '530000D8.26,(vide)D1.74,530000C10.00'
             and (select string_agg(account || side, ',' order by side desc) from _ebp where src_id = _m01.id) = '530000D,530000C'
             and (select bool_and(journal = 'RC') from _ebp where src_kind = 'cash_movement')
            then 'ok' else 'KO ' || coalesce((select string_agg(coalesce(nullif(account, ''), '(vide)') || side || amount, ',' order by side desc, amount desc) from _ebp where src_id = _mv.id), 'vide') end);

  -- ------------------------------------------------ 9. Lancement du transfert (runTransfer → record_accounting_transfer)
  select coalesce(max(transfer_no), 0) into _tno0 from public.accounting_transfers where company_id = _co;
  _tr := public.record_accounting_transfer(_co, jsonb_build_object(
    'mode', 'manual', 'period_from', current_date, 'period_to', current_date, 'entries_file', 'ECRITURES.TXT', 'accounts_file', 'COMPTES.TXT',
    'ecritures', '(essai)', 'comptes', '(essai)', 'pieces', _piece, 'lines', (select count(*) from _ebp), 'total_debit', _td, 'total_credit', _tc,
    'items', (select jsonb_agg(jsonb_build_object('kind', src_kind, 'id', src_id, 'piece', piece)) from (select distinct piece, src_kind, src_id from _ebp) x)));
  insert into _t(check_name, result) values
    ('transfert : n = precedent + 1, 9 elements, totaux, documents Compta coches + date, events',
       case when (_tr->>'transfer_no')::int = _tno0 + 1 and (_tr->>'items')::int = 9
             and (select total_debit = _td and total_credit = _tc and pieces = 9 and status = 'transfere' from public.accounting_transfers where id = (_tr->>'id')::uuid)
             and (select bool_and(compta_transferred and date_transfert = current_date) from public.documents where id = any(_ids))
             and exists (select 1 from public.events where entity_id = _tr->>'id' and action = 'accounting_transfer')
            then 'ok' else 'KO ' || _tr::text end),
    ('apres transfert : reglements, documents et mouvements plus proposes',
       case when not exists (select 1 from public.ebp_payments_to_transfer(_co, current_date, null) p where p.id = any(_pays))
             and not exists (select 1 from public.documents where id = any(_ids) and not compta_transferred)
             and (select count(*) from public.accounting_transfer_items i where i.source_kind = 'cash_movement' and i.source_id in (_mv.id, _m01.id) and not i.cancelled) = 2
            then 'ok' else 'KO' end);
end $s$;
select n, check_name, result from _t order by n;
