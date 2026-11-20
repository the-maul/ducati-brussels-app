-- =====================================================================
-- Parcours G8 n° 24 — Journaux de caisse (lot-verif-parcours, 20/11/2026, agent B2).
-- G8 : Journal de caisse › Édition → cocher → Visualiser sélection : journal de caisse (situation par mode,
--      report, solde), journal des ventes (par facture, total, panier moyen), mouvements de fonds de caisse,
--      ventilation par taux de TVA, état des encaissements (par mode). Les brouillons n'y sont jamais.
-- DMS : Caisse › Journaux de caisse (cash-journals-screen.tsx) = getJournalData → cash_journal_data
--      (migration 20261118151000), journaux construits en TS (cash-journals.ts, testés par
--      tests/caisse-journaux.test.ts) ; rapport X / Z (cash_z_report_session) ; Comptabilité → journal des
--      ventes (sales_journal) et registre TVA (vat_register).
-- Scénario (rejoue le comptoir : en-tête brouillon, lignes, document_assign_number, règlements, recompute) :
--   caisse ouverte (fond = tiroir), ticket A 24,20 € espèces, ticket B 1,74 € espèces (arrondi légal :
--   ESP 1,75 + ARR −0,01, comme applyCashRounding), facture du comptoir 121 € carte (client), mouvement 04
--   −10 €, brouillon de 1 210 € rattaché à la caisse (ne doit apparaître nulle part).
-- Contrôles :
--   1  journal : les 3 documents validés présents, brouillon absent
--   2  journal : lignes des 3 documents (HT 121,44 / TTC 146,94), aucune ligne du brouillon
--   3  ventilation TVA (lignes du journal) : 21 % base 121,44, TVA 25,50
--   4  encaissements : ESP 24,20 + 1,75, ARR −0,01, MAE 121 ; total réglé = 146,94 = total facturé
--   5  mouvements : 04 −10 avec TVA 1,74 ; caisse du jour présente dans les sessions
--   6  rapport X : ventilation TVA = celle du journal ; brouillon exclu ; encaissements par mode
--   7  rapport X : théorique espèces = fond + 25,95 − 10 ; tiroir = B0 + 15,95
--   8  registre TVA (compta) : + 121,44 / + 25,50 au taux 21 % (brouillon sans effet)
--   9  journal des ventes (compta) : +3 documents, + 146,94 TTC, brouillon absent
--  10  Z figé = X au moment de la clôture (ventilation TVA, encaissements)
--  11  période inversée refusée ; période de plus de 13 mois refusée
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _b0 numeric; _s uuid; _ta uuid; _tb uuid; _fac uuid; _draft uuid; _ctc uuid; _ids uuid[];
  _j jsonb; _x jsonb; _z jsonb; _r record; _vat0_b numeric; _vat0_v numeric; _vat1_b numeric; _vat1_v numeric;
  _sj0_n int; _sj0_t numeric; _sj1_n int; _sj1_t numeric; _ok boolean; _txt text;
begin
  -- ------------------------------------------------ caisse d un autre essai : cloturee ici (transaction annulee)
  if exists (select 1 from public.cash_sessions where company_id = _co and status = 'closed' and closed_at >= now()) then
    raise exception 'ESSAI : une caisse vient d etre cloturee a l instant, relancez l essai.';
  end if;
  update public.cash_sessions set counted_cash = 0, variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = opened_at
   where company_id = _co and status = 'open';
  _b0 := public.cash_drawer_balance(_co);
  select coalesce(sum(base_ht) filter (where vat_rate = 21), 0), coalesce(sum(vat) filter (where vat_rate = 21), 0)
    into _vat0_b, _vat0_v from public.vat_register(_co, current_date, current_date);
  select count(*), coalesce(sum(total_ttc), 0) into _sj0_n, _sj0_t from public.sales_journal(_co, current_date, current_date);

  insert into public.cash_sessions (company_id, opening_float, opened_by, note)
  values (_co, _b0, auth.uid(), 'ESSAI parcours 24') returning id into _s;
  insert into public.contacts (company_id, civility, type, status, first_name, last_name)
  values (_co, 'Monsieur', 'particulier', 'client', 'ESSAI', 'JOURNAUX B2') returning id into _ctc;

  -- Ticket A : 2 x 10 HT, 21 % -> 24,20 especes
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', current_date, 20, 4.20, 24.20, 'ttc') returning id into _ta;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_ta, 'ESSAI journaux A', 'article', 2, 10, 21, 0, 20, 24.20, 0);
  perform public.document_assign_number(_ta);
  insert into public.document_payments (document_id, method, amount, status, given_amount) values (_ta, 'ESP', 24.20, 'recu', 30);
  perform public.recompute_document_paid(_ta);
  -- Ticket B : 1,44 HT -> 1,74 TTC ; especes arrondies a 1,75, ecart ARR -0,01
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', current_date, 1.44, 0.30, 1.74, 'ttc') returning id into _tb;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_tb, 'ESSAI journaux B', 'article', 1, 1.44, 21, 0, 1.44, 1.74, 0);
  perform public.document_assign_number(_tb);
  insert into public.document_payments (document_id, method, amount, status, note) values
    (_tb, 'ESP', 1.75, 'recu', null), (_tb, 'ARR', -0.01, 'recu', 'Arrondi especes (5 cents)');
  perform public.recompute_document_paid(_tb);
  -- Facture du comptoir 121 (client), rattachee a la caisse, payee par carte
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode, contact_id, cash_session_id)
  values (_co, null, 'brouillon', 'FAC', current_date, 100, 21, 121, 'ht', _ctc, _s) returning id into _fac;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_fac, 'ESSAI journaux facture', 'article', 1, 100, 21, 0, 100, 121, 0);
  perform public.document_assign_number(_fac);
  insert into public.document_payments (document_id, method, amount, status) values (_fac, 'MAE', 121, 'recu');
  perform public.recompute_document_paid(_fac);
  -- Mouvement 04 et brouillon rattache a la caisse
  insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, operator_id, type_code)
  values (_co, _s, 'out', 10, 'ESP', 'TEST consommable', auth.uid(), '04');
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode, cash_session_id)
  values (_co, null, 'brouillon', 'TIK', current_date, 1000, 210, 1210, 'ttc', _s) returning id into _draft;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_draft, 'ESSAI brouillon', 'article', 1, 1000, 21, 0, 1000, 1210, 0);
  _ids := array[_ta, _tb, _fac];

  -- ------------------------------------------------ journaux de la journee (cash_journal_data)
  _j := public.cash_journal_data(_co, current_date, current_date);
  insert into _t(check_name, result) values
    ('journal : 3 documents valides presents, brouillon absent',
       case when (select count(*) from jsonb_array_elements(_j->'documents') e where (e->>'id')::uuid = any(_ids)) = 3
             and not exists (select 1 from jsonb_array_elements(_j->'documents') e where (e->>'id')::uuid = _draft)
             and (select bool_and(e->>'number' is not null) from jsonb_array_elements(_j->'documents') e where (e->>'id')::uuid = any(_ids))
            then 'ok' else 'KO' end);
  select round(sum((e->>'line_ht')::numeric), 2) as ht, round(sum((e->>'line_ttc')::numeric), 2) as ttc into _r
    from jsonb_array_elements(_j->'lines') e where (e->>'document_id')::uuid = any(_ids);
  insert into _t(check_name, result) values
    ('journal des ventes : lignes HT 121,44 / TTC 146,94, aucune ligne du brouillon',
       case when _r.ht = 121.44 and _r.ttc = 146.94 and not exists (select 1 from jsonb_array_elements(_j->'lines') e where (e->>'document_id')::uuid = _draft)
            then 'ok' else 'KO ' || coalesce(_r.ht::text, 'null') || ' / ' || coalesce(_r.ttc::text, 'null') end);
  select string_agg(rate || ':' || ht || '/' || vat, ',' order by rate) into _txt from (
    select (e->>'vat_rate')::numeric as rate, round(sum((e->>'line_ht')::numeric), 2) as ht, round(sum((e->>'line_ttc')::numeric - (e->>'line_ht')::numeric), 2) as vat
      from jsonb_array_elements(_j->'lines') e where (e->>'document_id')::uuid = any(_ids) group by 1) v;
  insert into _t(check_name, result) values
    ('ventilation TVA : 21 % base 121,44 TVA 25,50', case when _txt = '21.00:121.44/25.50' or _txt = '21:121.44/25.50' then 'ok' else 'KO ' || coalesce(_txt, 'vide') end);
  select string_agg(m || ':' || a, ',' order by m) into _txt from (
    select e->>'method' as m, round(sum((e->>'amount')::numeric), 2) as a
      from jsonb_array_elements(_j->'payments') e where (e->>'document_id')::uuid = any(_ids) group by 1) p;
  insert into _t(check_name, result) values
    ('encaissements : ARR -0,01, ESP 25,95, MAE 121 (= 146,94 facture)', case when _txt = 'ARR:-0.01,ESP:25.95,MAE:121.00' then 'ok' else 'KO ' || coalesce(_txt, 'vide') end),
    ('mouvements : 04 -10 TVA 1,74 ; caisse du jour dans les sessions',
       case when exists (select 1 from jsonb_array_elements(_j->'movements') e where (e->>'session_id')::uuid = _s and e->>'type_code' = '04' and e->>'kind' = 'out'
                          and (e->>'amount')::numeric = 10 and (e->>'vat_amount')::numeric = 1.74)
             and exists (select 1 from jsonb_array_elements(_j->'sessions') e where (e->>'id')::uuid = _s and e->>'status' = 'open')
            then 'ok' else 'KO' end);

  -- ------------------------------------------------ rapport X de la caisse
  _x := public.cash_z_report_session(_s);
  select string_agg((e->>'vat_rate') || ':' || (e->>'base_ht') || '/' || (e->>'vat'), ',') into _txt from jsonb_array_elements(_x->'vat_breakdown') e;
  insert into _t(check_name, result) values
    ('X : ventilation TVA = journal (brouillon exclu), CA net 146,94',
       case when _txt in ('21.00:121.44/25.50', '21:121.44/25.50') and (_x->>'net_sales_ttc')::numeric = 146.94 then 'ok' else 'KO ' || coalesce(_txt, 'vide') || ' CA ' || (_x->>'net_sales_ttc') end);
  select string_agg((e->>'method') || ':' || round((e->>'total')::numeric, 2), ',' order by e->>'method') into _txt from jsonb_array_elements(_x->'payments_by_method') e;
  insert into _t(check_name, result) values
    ('X : encaissements par mode ARR -0,01 / ESP 25,95 / MAE 121', case when _txt = 'ARR:-0.01,ESP:25.95,MAE:121.00' then 'ok' else 'KO ' || coalesce(_txt, 'vide') end),
    ('X : theorique especes = fond + 25,95 - 10 ; tiroir = B0 + 15,95',
       case when (_x->>'expected_cash')::numeric = _b0 + 15.95 and public.cash_drawer_balance(_co) = _b0 + 15.95 then 'ok'
            else 'KO ' || ((_x->>'expected_cash')::numeric - _b0)::text || ' / ' || (public.cash_drawer_balance(_co) - _b0)::text end);

  -- ------------------------------------------------ comptabilite : registre TVA et journal des ventes
  select coalesce(sum(base_ht) filter (where vat_rate = 21), 0), coalesce(sum(vat) filter (where vat_rate = 21), 0)
    into _vat1_b, _vat1_v from public.vat_register(_co, current_date, current_date);
  select count(*), coalesce(sum(total_ttc), 0) into _sj1_n, _sj1_t from public.sales_journal(_co, current_date, current_date);
  insert into _t(check_name, result) values
    ('registre TVA : +121,44 base / +25,50 TVA a 21 % (brouillon sans effet)',
       case when _vat1_b - _vat0_b = 121.44 and _vat1_v - _vat0_v = 25.50 then 'ok' else 'KO ' || (_vat1_b - _vat0_b) || ' / ' || (_vat1_v - _vat0_v) end),
    ('journal des ventes compta : +3 documents, +146,94 TTC, brouillon absent',
       case when _sj1_n - _sj0_n = 3 and _sj1_t - _sj0_t = 146.94
             and not exists (select 1 from public.sales_journal(_co, current_date, current_date) x where x.document_id = _draft)
            then 'ok' else 'KO ' || (_sj1_n - _sj0_n) || ' / ' || (_sj1_t - _sj0_t) end);

  -- ------------------------------------------------ Z : fige = X a la cloture
  update public.cash_sessions set status = 'closed', closed_at = now(), counted_cash = _b0 + 15.95, denominations = '{}'::jsonb
   where id = _s and status = 'open';
  _z := public.cash_z_report_session(_s);
  insert into _t(check_name, result) values
    ('Z fige = X (ventilation TVA, encaissements, theorique) et numerote',
       case when _z->'vat_breakdown' = _x->'vat_breakdown' and _z->'payments_by_method' = _x->'payments_by_method'
             and (_z->>'expected_cash')::numeric = (_x->>'expected_cash')::numeric and _z->>'number' is not null then 'ok' else 'KO' end);

  begin
    perform public.cash_journal_data(_co, current_date, current_date - 1);
    insert into _t(check_name, result) values ('periode inversee refusee', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('periode inversee refusee', 'ok');
  end;
  begin
    perform public.cash_journal_data(_co, current_date - 500, current_date);
    insert into _t(check_name, result) values ('periode de plus de 13 mois refusee', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('periode de plus de 13 mois refusee', 'ok');
  end;
end $s$;
select n, check_name, result from _t order by n;
