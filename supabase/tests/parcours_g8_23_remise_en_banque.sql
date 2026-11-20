-- =====================================================================
-- Parcours G8 n° 23 — Clôture de caisse = remise en banque espèces (lot-verif-parcours, 20/11/2026, agent B2).
-- G8 : Journal de caisse › Édition des remises en banque → Espèces/Cash : report du dernier fond (350 €)
--      + factures en espèces + mouvement « test consommable » −10 € → montant espèces remis 267,64 →
--      nouveau fond de caisse 100 → Générer remise → confirmer → remise n° 1, la liste repart de
--      « REPORT CAISSE DU … : 100 € » ; même écran par mode (carte : toute la sélection, pas de fond).
-- Décision Q31 (a-trancher.md) : remise en banque G8 ET journal Z du DMS, sans blocage, dans les deux ordres.
-- DMS : Caisse (/pos) › Remises en banque (cash-deposits-screen.tsx) : listDepositCandidates
--      (cash_deposit_candidates, tout coché), montant remis ↔ nouveau fond (depositedFromNewFloat),
--      createDeposit = cash_deposit_create ; clôture Z = closeSession (UPDATE cash_sessions status closed) ;
--      ouverture suivante = openSession (fond proposé = cash_drawer_balance).
--      Seule différence avec le front : les heures (ouverture, règlements, mouvement, clôture) sont posées
--      dans le passé pour que S1 et S2 ne se chevauchent pas (dans une transaction, now() ne bouge pas).
-- Scénario (montants contrôlés en écart par rapport au tiroir B0 du départ) :
--   S1 : fond saisi = B0 + 350 (G8 : report 350 €) → ticket 24,20 € espèces → mouvement 04 −10 € →
--        REMISE AVANT LE Z avec nouveau fond 100 → Z sans écart (théorique 100) ;
--   S2 : fond proposé 100 → ticket 5 € espèces → Z (105) → REMISE APRÈS LE Z (nouveau fond 100) ;
--   remise carte (MAE) : toute la sélection, pas de fond.
-- Contrôles :
--   1  S1 : écart d'ouverture +350 proposé à la remise (« ouverture fond de caisse »)
--   2  sélection espèces = B0 + 350 + 24,20 − 10 (report, encaissement, mouvement −10)
--   3  remise n° = précédente + 1 (série par mode), nouveau fond 100, remis = sélection − 100, n lignes
--   4  banque 01 recopiée (libellé, IBAN), caisse ouverte rattachée, auteur
--   5  caisse ouverte : sortie 01 « Remise en banque n° » du montant remis dans S1
--   6  trace events cash_deposit_create (nouveau fond)
--   7  tiroir = 100 ; la liste suivante commence par « Report caisse du … » 100
--   8  ligne déjà remise refusée
--   9  montant remis > sélection refusé (fond négatif)
--  10  Z S1 : n° Z = suivant, théorique figé 100 = compté (aucun écart), sorties = 10 + remis
--  11  S2 : fond proposé = 100, aucun écart d'ouverture
--  12  Z S2 (105) puis remise APRÈS le Z : n° suivant, nouveau fond 100, aucun mouvement ajouté à la caisse fermée,
--      Z figé inchangé
--  13  tiroir = 100 après la seconde remise
--  14  remise carte : remis = toute la sélection, pas de fond, pas de mouvement, n° de la série carte
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _b0 numeric; _s1 uuid; _s2 uuid; _t1 uuid; _t2 uuid; _t3 uuid; _m uuid; _no_esp int; _no_mae int; _z0 text;
  _items jsonb; _total numeric; _cnt int; _d1 uuid; _d2 uuid; _dc uuid; _dep public.cash_deposits; _x jsonb; _zs1 jsonb;
  _err text; _first record; _sess public.cash_sessions;
  _u interval;  -- 1/180e de la fenetre de l essai (les deux caisses doivent avoir des heures distinctes)
begin
  -- ------------------------------------------------ caisse d un autre essai : cloturee ici (transaction annulee)
  if exists (select 1 from public.cash_sessions where company_id = _co and status = 'closed' and closed_at >= now()) then
    raise exception 'ESSAI : une caisse vient d etre cloturee a l instant, relancez l essai.';
  end if;
  update public.cash_sessions set counted_cash = 0, variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = opened_at
   where company_id = _co and status = 'open';
  -- Fenetre : les 3 dernieres heures, jamais dans une caisse deja cloturee (un reglement ne se date pas
  -- dans une caisse fermee). S1 = [-180u, -60u], S2 = [-50u, -30u], remises a l instant.
  _u := (now() - greatest(now() - interval '3 hours',
                          coalesce((select max(closed_at) from public.cash_sessions where company_id = _co and status = 'closed'), '-infinity')
                          + interval '1 millisecond')) / 180;
  if _u <= interval '0' then raise exception 'ESSAI : une caisse est cloturee a l instant meme, relancez l essai.'; end if;
  _b0 := public.cash_drawer_balance(_co);
  select coalesce(max(number), 0) into _no_esp from public.cash_deposits where company_id = _co and method = 'ESP';
  select coalesce(max(number), 0) into _no_mae from public.cash_deposits where company_id = _co and method = 'MAE';

  -- ------------------------------------------------ S1 : fond saisi = B0 + 350 (G8 : report 350)
  insert into public.cash_sessions (company_id, opening_float, opened_by, note, opened_at)
  values (_co, _b0 + 350, auth.uid(), 'ESSAI parcours 23', now() - 180 * _u) returning id into _s1;
  insert into _t(check_name, result) select 'S1 : ecart d ouverture +350 propose a la remise',
    case when exists (select 1 from public.cash_deposit_candidates(_co, 'ESP', null, now(), false) c
                       where c.source_type = 'opening_gap' and c.source_id = _s1 and c.amount = 350 and c.label like 'Ouverture fond de caisse%')
         then 'ok' else 'KO' end;

  -- Ticket 24,20 EUR (20 HT + 4,20 TVA) paye en especes, comme le comptoir (createDocument + addPayments).
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', current_date, 20, 4.20, 24.20, 'ttc') returning id into _t1;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_t1, 'ESSAI parcours 23', 'article', 2, 10, 21, 0, 20, 24.20, 0);
  perform public.document_assign_number(_t1);
  insert into public.document_payments (document_id, method, amount, status, paid_at) values (_t1, 'ESP', 24.20, 'recu', now() - 170 * _u);
  perform public.recompute_document_paid(_t1);
  -- Mouvement 04 (parcours 22)
  insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, operator_id, type_code, occurred_at)
  values (_co, _s1, 'out', 10, 'ESP', 'TEST consommable', auth.uid(), '04', now() - 160 * _u) returning id into _m;

  -- ------------------------------------------------ remise AVANT le Z : tout coche, nouveau fond 100
  select jsonb_agg(jsonb_build_object('type', c.source_type, 'id', c.source_id)), round(sum(c.amount), 2), count(*)
    into _items, _total, _cnt
    from public.cash_deposit_candidates(_co, 'ESP', null, now(), false) c;
  insert into _t(check_name, result) select 'selection especes = B0 + 350 + 24,20 - 10',
    case when _total = _b0 + 364.20 then 'ok' else 'KO ' || (_total - _b0)::text end;

  _d1 := public.cash_deposit_create(_co, 'ESP', 'remise', null, now(), current_date, _items, round(_total - 100, 2), '01', null);
  select * into _dep from public.cash_deposits where id = _d1;
  insert into _t(check_name, result) values
    ('remise : n = precedente + 1, nouveau fond 100, remis = selection - 100, toutes les lignes',
       case when _dep.number = _no_esp + 1 and _dep.new_float = 100 and _dep.deposited_amount = _total - 100
             and _dep.lines_total = _total and _dep.line_count = _cnt and _dep.kind = 'remise' and _dep.status = 'active'
            then 'ok' else 'KO n ' || _dep.number || ' fond ' || coalesce(_dep.new_float::text, 'null') || ' remis ' || _dep.deposited_amount end),
    ('remise : banque 01 recopiee, caisse ouverte rattachee, auteur',
       case when _dep.bank_code = '01' and _dep.bank_iban is not null and _dep.bank_label is not null and _dep.session_id = _s1 and _dep.created_by = auth.uid()
            then 'ok' else 'KO' end),
    ('caisse ouverte : sortie 01 du montant remis dans S1',
       case when exists (select 1 from public.cash_movements where deposit_id = _d1 and session_id = _s1 and kind = 'out' and type_code = '01'
                          and amount = _total - 100 and reason = 'Remise en banque n° ' || _dep.number) then 'ok' else 'KO' end),
    ('trace events cash_deposit_create (nouveau fond)',
       case when exists (select 1 from public.events where entity_type = 'cash_deposit' and entity_id = _d1::text and action = 'cash_deposit_create'
                          and (new_data->>'new_float')::numeric = 100) then 'ok' else 'KO' end);

  select * into _first from public.cash_deposit_candidates(_co, 'ESP', null, now(), false) c order by 1 limit 1;
  insert into _t(check_name, result) values
    ('tiroir = 100 ; la liste repart de « Report caisse du » 100',
       case when public.cash_drawer_balance(_co) = 100 and _first.source_type = 'report' and _first.source_id = _d1 and _first.amount = 100
             and _first.label = 'Report caisse du ' || to_char(current_date, 'DD/MM/YYYY')
            then 'ok' else 'KO tiroir ' || public.cash_drawer_balance(_co) || ' / ' || coalesce(_first.source_type, 'vide') end);
  begin
    perform public.cash_deposit_create(_co, 'ESP', 'remise', null, now(), current_date, _items, 0, null, null);
    insert into _t(check_name, result) values ('ligne deja remise refusee', 'KO accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('ligne deja remise refusee (message clair)', case when _err like '%deja remise%' then 'ok' else 'KO ' || _err end);
  end;
  begin
    perform public.cash_deposit_create(_co, 'ESP', 'remise', null, now(), current_date,
      jsonb_build_array(jsonb_build_object('type', 'report', 'id', _d1)), 150, null, null);
    insert into _t(check_name, result) values ('remis > selection refuse (fond negatif)', 'KO accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('remis > selection refuse (fond negatif)', case when _err like '%superieur%' then 'ok' else 'KO ' || _err end);
  end;

  -- ------------------------------------------------ Z de S1 (closeSession) : compte 100, aucun ecart
  _z0 := (select max(z_number) from public.cash_sessions where company_id = _co and z_number like 'TESTZ-%');
  update public.cash_sessions set status = 'closed', closed_at = now() - 60 * _u, counted_cash = 100, denominations = '{}'::jsonb
   where id = _s1 and status = 'open';
  select * into _sess from public.cash_sessions where id = _s1;
  _zs1 := _sess.z_report;
  insert into _t(check_name, result) values
    ('Z S1 : numerote, theorique fige 100 = compte (aucun ecart), sorties = 10 + remis',
       case when _sess.z_number is not null and _sess.z_number is distinct from _z0 and _sess.expected_cash = 100
             and (_zs1->>'variance')::numeric = 0 and (_zs1->>'cash_out_esp')::numeric = 10 + _dep.deposited_amount
             and _sess.z_number > coalesce(_z0, '')
            then 'ok' else 'KO ' || coalesce(_sess.z_number, 'sans n') || ' theorique ' || coalesce(_sess.expected_cash::text, 'null') end);

  -- ------------------------------------------------ S2 : fond propose 100
  insert into public.cash_sessions (company_id, opening_float, opened_by, note, opened_at)
  values (_co, 100, auth.uid(), 'ESSAI parcours 23 bis', now() - 50 * _u) returning id into _s2;
  insert into _t(check_name, result) select 'S2 : fond propose = 100 (report), aucun ecart d ouverture',
    case when (select proposed_float from public.cash_sessions where id = _s2) = 100
          and not exists (select 1 from public.cash_deposit_candidates(_co, 'ESP', null, now(), false) c where c.source_type = 'opening_gap' and c.source_id = _s2)
         then 'ok' else 'KO' end;

  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', current_date, 4.13, 0.87, 5, 'ttc') returning id into _t2;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_t2, 'ESSAI parcours 23 bis', 'article', 1, 4.13, 21, 0, 4.13, 5, 0);
  perform public.document_assign_number(_t2);
  insert into public.document_payments (document_id, method, amount, status, paid_at) values (_t2, 'ESP', 5, 'recu', now() - 40 * _u);
  perform public.recompute_document_paid(_t2);
  -- un ticket carte pour la remise carte
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', current_date, 24.79, 5.21, 30, 'ttc') returning id into _t3;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_t3, 'ESSAI parcours 23 carte', 'article', 1, 24.79, 21, 0, 24.79, 30, 0);
  perform public.document_assign_number(_t3);
  insert into public.document_payments (document_id, method, amount, status, paid_at) values (_t3, 'MAE', 30, 'recu', now() - 39 * _u);
  perform public.recompute_document_paid(_t3);

  -- Z de S2 d abord (Q31 : aucun ordre impose)
  update public.cash_sessions set status = 'closed', closed_at = now() - 30 * _u, counted_cash = 105, denominations = '{}'::jsonb
   where id = _s2 and status = 'open';
  select * into _sess from public.cash_sessions where id = _s2;

  -- Remise APRES le Z : report 100 + 5 especes -> remis 5, nouveau fond 100
  select jsonb_agg(jsonb_build_object('type', c.source_type, 'id', c.source_id)), round(sum(c.amount), 2)
    into _items, _total
    from public.cash_deposit_candidates(_co, 'ESP', null, now(), false) c;
  _d2 := public.cash_deposit_create(_co, 'ESP', 'remise', null, now(), current_date, _items, round(_total - 100, 2), '01', null);
  select * into _dep from public.cash_deposits where id = _d2;
  insert into _t(check_name, result) values
    ('remise apres le Z : n suivant, selection 105, remis 5, nouveau fond 100, sans caisse ni mouvement, Z S2 fige inchange',
       case when _sess.expected_cash = 105 and _total = 105 and _dep.number = _no_esp + 2 and _dep.deposited_amount = 5 and _dep.new_float = 100
             and _dep.session_id is null and not exists (select 1 from public.cash_movements where deposit_id = _d2)
             and (select z_report = _sess.z_report and expected_cash = 105 from public.cash_sessions where id = _s2)
            then 'ok' else 'KO selection ' || coalesce(_total::text, 'null') || ' n ' || coalesce(_dep.number::text, 'null') end),
    ('tiroir = 100 apres la seconde remise', case when public.cash_drawer_balance(_co) = 100 then 'ok' else 'KO ' || public.cash_drawer_balance(_co) end);

  -- ------------------------------------------------ remise carte (MAE) : toute la selection
  select jsonb_agg(jsonb_build_object('type', c.source_type, 'id', c.source_id)), round(sum(c.amount), 2)
    into _items, _total
    from public.cash_deposit_candidates(_co, 'MAE', null, now(), false) c;
  _dc := public.cash_deposit_create(_co, 'MAE', 'remise', null, now(), current_date, _items, 0, '01', null);
  select * into _dep from public.cash_deposits where id = _dc;
  insert into _t(check_name, result) values
    ('remise carte : remis = toute la selection (>= 30), pas de fond, pas de mouvement, n de la serie carte',
       case when _dep.deposited_amount = _total and _total >= 30 and _dep.new_float is null and _dep.number = _no_mae + 1
             and not exists (select 1 from public.cash_movements where deposit_id = _dc) then 'ok' else 'KO' end);
end $s$;
select n, check_name, result from _t order by n;
