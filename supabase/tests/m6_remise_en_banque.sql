-- =====================================================================
-- PDV009 / PDV008 (18/11/2026, rattrapage G8) — essai a blanc des migrations
-- 20261118150000_m6_remise_en_banque.sql et 20261118151000_m6_journaux_caisse.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations du bloc caisse comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261103150000_m6_caisse_audit.sql \
--      supabase/migrations/20261103160000_m6_tva_marge_a_la_vente.sql \
--      supabase/migrations/20261103170000_m6_caisse_legale.sql \
--      supabase/migrations/20261103180000_m6_facture_legale.sql \
--      supabase/migrations/20261103220000_m6_z_avoirs.sql \
--      supabase/migrations/20261118150000_m6_remise_en_banque.sql \
--      supabase/migrations/20261118151000_m6_journaux_caisse.sql \
--      supabase/tests/m6_remise_en_banque.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue le role d un administrateur (claims JWT simulees) dans ITALBIKE STORE. Les montants sont
-- verifies en ECART par rapport aux especes du tiroir au depart (B0), pour ne pas dependre des donnees.
-- Scenario (decision Q31 : remise G8 + Z, aucun blocage) :
--   S1 : fond = fond propose (pas d ecart), ticket 100 especes, achat de consommables 10 (TVA 21 %),
--        refus du type 01 a la main et d un sens contraire au type ;
--        REMISE AVANT LE Z (50) : sortie 01 dans la session, theorique du Z juste, ligne non remisable deux fois ;
--        cloture Z sans ecart ; ANNULATION DE LA REMISE APRES LE Z : aucune ecriture dans la caisse fermee,
--        lignes de nouveau disponibles, tiroir juste ;
--   archive sans remise (tout passe en report) ; S2 ouverte avec 5 de plus (ecart d ouverture) ;
--   remise qui reprend le report, annulation de la plus ancienne refusee (message), correction du montant
--   caisse ouverte (sortie ajoutee) ; remise carte (toute la selection, pas de fond) ; journaux sans brouillon.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _b0 numeric; _s1 uuid; _s2 uuid; _tik uuid; _tik2 uuid; _draft uuid; _d1 uuid; _d2 uuid; _d3 uuid; _dc uuid;
  _items jsonb; _x jsonb; _m record; _dep record; _err text; _n int; _j jsonb;
  _u interval;  -- 1/180e de la fenetre de l essai (1 minute quand la fenetre fait 3 heures)
begin
  -- ------------------------------------------------ caisse reelle eventuelle cloturee (transaction annulee)
  update public.cash_sessions set counted_cash = coalesce(expected_cash, 0), variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = greatest(opened_at, now() - interval '4 hours')
   where company_id = _co and status = 'open';
  -- Fenetre de l essai : les 3 dernieres heures, mais jamais dans une caisse reelle deja cloturee
  -- (le garde-fou refuse a raison un reglement date dans une journee fermee). Si la caisse du jour
  -- vient d etre cloturee, la fenetre commence juste apres sa cloture et le scenario s y resserre
  -- (memes etapes, dans le meme ordre).
  _u := (now() - greatest(now() - interval '3 hours',
                          coalesce((select max(closed_at) from public.cash_sessions
                                     where company_id = _co and status = 'closed'), '-infinity')
                          + interval '1 millisecond')) / 180;
  if _u <= interval '0' then
    raise exception 'ESSAI : une caisse reelle est cloturee a l instant meme, relancez l essai.';
  end if;
  _b0 := public.cash_drawer_balance(_co);

  -- ------------------------------------------------ S1 : fond = fond propose
  insert into public.cash_sessions (company_id, opened_by, opening_float, status, opened_at)
  values (_co, auth.uid(), _b0, 'open', now() - 180 * _u) returning id into _s1;
  insert into _t(check_name, result) values
    ('S1 : fond propose = especes du tiroir', case when (select proposed_float from public.cash_sessions where id = _s1) = _b0 then 'ok' else 'FAIL' end);

  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'TIK', 'brouillon', current_date, 82.64, 17.36, 100, 'ht') returning id into _tik;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_tik, 'TEST remise en banque', 1, 82.64, 21, 82.64, 100, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'TIK') where id = _tik;
  insert into public.document_payments (document_id, method, amount, status, note, paid_at)
  values (_tik, 'ESP', 100, 'recu', 'TEST especes', now() - 170 * _u);
  perform public.recompute_document_paid(_tik);

  -- Mouvement type 04 : sortie, TVA 21 % comprise, numero.
  insert into public.cash_movements (company_id, session_id, kind, method, amount, reason, type_code, occurred_at)
  values (_co, _s1, 'out', 'ESP', 10, 'TEST consommable', '04', now() - 160 * _u);
  select * into _m from public.cash_movements where session_id = _s1 and type_code = '04';
  insert into _t(check_name, result) values
    ('mouvement 04 : TVA 21 % comprise = 1,74', case when _m.vat_amount = 1.74 and _m.vat_rate = 21 then 'ok' else 'FAIL ' || coalesce(_m.vat_amount::text, 'null') end),
    ('mouvement 04 : numero pose', case when _m.movement_no is not null then 'ok' else 'FAIL' end);
  begin
    insert into public.cash_movements (company_id, session_id, kind, method, amount, reason, type_code) values (_co, _s1, 'out', 'ESP', 5, 'TEST', '01');
    insert into _t(check_name, result) values ('type 01 refuse a la main', 'FAIL accepte');
  exception when others then insert into _t(check_name, result) values ('type 01 refuse a la main', 'ok');
  end;
  begin
    insert into public.cash_movements (company_id, session_id, kind, method, amount, reason, type_code) values (_co, _s1, 'out', 'ESP', 5, 'TEST', '02');
    insert into _t(check_name, result) values ('type 02 (entree) refuse en sortie', 'FAIL accepte');
  exception when others then insert into _t(check_name, result) values ('type 02 (entree) refuse en sortie', 'ok');
  end;
  insert into _t(check_name, result) values
    ('tiroir = B0 + 100 - 10', case when public.cash_drawer_balance(_co) = _b0 + 90 then 'ok' else 'FAIL ' || (public.cash_drawer_balance(_co) - _b0)::text end);

  -- ------------------------------------------------ remise AVANT le Z : 50 remis, sortie 01 dans S1
  select jsonb_agg(jsonb_build_object('type', c.source_type, 'id', c.source_id)) into _items
    from public.cash_deposit_candidates(_co, 'ESP', null, now() + interval '1 day', false) c;
  _d1 := public.cash_deposit_create(_co, 'ESP', 'remise', null, now(), current_date, _items, 50, null, 'TEST remise avant Z');
  select * into _dep from public.cash_deposits where id = _d1;
  _x := public.cash_z_report_session(_s1);
  insert into _t(check_name, result) values
    ('remise avant Z : nouveau fond = selection - remis', case when _dep.new_float = _b0 + 40 and _dep.session_id = _s1 then 'ok' else 'FAIL ' || coalesce(_dep.new_float::text, 'null') end),
    ('remise avant Z : sortie 01 de 50 dans S1', case when exists (select 1 from public.cash_movements where deposit_id = _d1 and session_id = _s1 and kind = 'out' and amount = 50 and type_code = '01') then 'ok' else 'FAIL' end),
    ('remise avant Z : theorique X = fond + 100 - 10 - 50', case when (_x->>'expected_cash')::numeric = _b0 + 40 then 'ok' else 'FAIL ' || (_x->>'expected_cash') end),
    ('remise avant Z : tiroir = nouveau fond', case when public.cash_drawer_balance(_co) = _b0 + 40 then 'ok' else 'FAIL' end);
  begin
    perform public.cash_deposit_create(_co, 'ESP', 'remise', null, now(), current_date, _items, 0, null, null);
    insert into _t(check_name, result) values ('ligne deja remise refusee', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('ligne deja remise refusee (message clair)', case when _err like '%deja remise%' then 'ok' else 'FAIL ' || _err end);
  end;
  begin
    update public.cash_movements set amount = 1 where deposit_id = _d1;
    insert into _t(check_name, result) values ('sortie de remise non modifiable', 'FAIL accepte');
  exception when others then insert into _t(check_name, result) values ('sortie de remise non modifiable', 'ok');
  end;

  -- ------------------------------------------------ Z de S1 sans ecart, puis annulation de la remise APRES le Z
  update public.cash_sessions set counted_cash = _b0 + 40, status = 'closed', closed_at = now() - 60 * _u where id = _s1;
  insert into _t(check_name, result) values
    ('Z S1 : theorique fige = compte (aucun ecart)', case when (select expected_cash from public.cash_sessions where id = _s1) = _b0 + 40 then 'ok' else 'FAIL' end);
  perform public.cash_deposit_cancel(_d1, 'TEST annulation apres Z');
  insert into _t(check_name, result) values
    ('annulation apres Z : aucun mouvement ajoute dans la caisse fermee', case when (select count(*) from public.cash_movements where deposit_id = _d1) = 1 then 'ok' else 'FAIL' end),
    ('annulation apres Z : lignes de nouveau disponibles', case when (select count(*) from public.cash_deposit_candidates(_co, 'ESP', null, now() + interval '1 day', false) c where c.source_type = 'payment') >= 1 then 'ok' else 'FAIL' end),
    ('annulation apres Z : tiroir = compte du Z', case when public.cash_drawer_balance(_co) = _b0 + 40 then 'ok' else 'FAIL ' || (public.cash_drawer_balance(_co) - _b0)::text end),
    ('annulation tracee dans events', case when exists (select 1 from public.events where entity_type = 'cash_deposit' and entity_id = _d1::text and action = 'cash_deposit_cancel') then 'ok' else 'FAIL' end);
  begin
    perform public.cash_deposit_cancel(_d1, 'encore');
    insert into _t(check_name, result) values ('double annulation refusee', 'FAIL accepte');
  exception when others then insert into _t(check_name, result) values ('double annulation refusee', 'ok');
  end;

  -- ------------------------------------------------ archive sans remise : tout passe en report
  select jsonb_agg(jsonb_build_object('type', c.source_type, 'id', c.source_id)) into _items
    from public.cash_deposit_candidates(_co, 'ESP', null, now() + interval '1 day', false) c;
  _d2 := public.cash_deposit_create(_co, 'ESP', 'archive', null, now(), current_date, _items, 999, null, null);
  insert into _t(check_name, result) values
    ('archive sans remise : rien de remis, report = tiroir', case when (select deposited_amount = 0 and new_float = _b0 + 40 from public.cash_deposits where id = _d2) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ S2 : 5 de plus que le fond propose (ecart d ouverture)
  insert into public.cash_sessions (company_id, opened_by, opening_float, status, opened_at)
  values (_co, auth.uid(), _b0 + 45, 'open', now() - 30 * _u) returning id into _s2;
  insert into _t(check_name, result) values
    ('S2 : fond propose = report', case when (select proposed_float from public.cash_sessions where id = _s2) = _b0 + 40 then 'ok' else 'FAIL' end),
    ('S2 : ecart d ouverture +5 dans les lignes', case when exists (select 1 from public.cash_deposit_candidates(_co, 'ESP', null, now() + interval '1 day', false) c where c.source_type = 'opening_gap' and c.source_id = _s2 and c.amount = 5) then 'ok' else 'FAIL' end),
    ('S2 : tiroir = fond saisi', case when public.cash_drawer_balance(_co) = _b0 + 45 then 'ok' else 'FAIL' end);

  -- Remise qui reprend le report, montant 0 (correction ensuite) ; la plus ancienne ne s annule plus.
  select jsonb_agg(jsonb_build_object('type', c.source_type, 'id', c.source_id)) into _items
    from public.cash_deposit_candidates(_co, 'ESP', null, now() + interval '1 day', false) c;
  _d3 := public.cash_deposit_create(_co, 'ESP', 'remise', null, now(), current_date, _items, 0, null, null);
  begin
    perform public.cash_deposit_cancel(_d2, 'TEST');
    insert into _t(check_name, result) values ('annuler une remise dont le report est repris : refus', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('annuler une remise dont le report est repris : refus avec la sortie', case when _err like '%annulez d abord%' then 'ok' else 'FAIL ' || _err end);
  end;
  perform public.cash_deposit_amend(_d3, 10, current_date, null, 'TEST 10 EUR partis a la banque');
  _x := public.cash_z_report_session(_s2);
  insert into _t(check_name, result) values
    ('correction caisse ouverte : sortie 10 ajoutee a S2', case when exists (select 1 from public.cash_movements where deposit_id = _d3 and session_id = _s2 and kind = 'out' and amount = 10) then 'ok' else 'FAIL' end),
    ('correction : theorique X de S2 = fond - 10', case when (_x->>'expected_cash')::numeric = _b0 + 35 then 'ok' else 'FAIL ' || (_x->>'expected_cash') end),
    ('correction : nouveau fond = tiroir', case when (select new_float from public.cash_deposits where id = _d3) = _b0 + 35 and public.cash_drawer_balance(_co) = _b0 + 35 then 'ok' else 'FAIL' end),
    ('correction tracee (ancien / nouveau, motif)', case when exists (select 1 from public.events where entity_id = _d3::text and action = 'cash_deposit_amend' and new_data->>'reason' like 'TEST%') then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ remise carte : toute la selection, pas de fond
  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'TIK', 'brouillon', current_date, 24.79, 5.21, 30, 'ht') returning id into _tik2;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_tik2, 'TEST carte', 1, 24.79, 21, 24.79, 30, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'TIK') where id = _tik2;
  insert into public.document_payments (document_id, method, amount, status, note, paid_at)
  values (_tik2, 'MAE', 30, 'recu', 'TEST carte', now() - 20 * _u);
  select jsonb_agg(jsonb_build_object('type', c.source_type, 'id', c.source_id)) into _items
    from public.cash_deposit_candidates(_co, 'MAE', now() - 60 * _u, now() + interval '1 day', false) c;
  _dc := public.cash_deposit_create(_co, 'MAE', 'remise', null, now(), current_date, _items, 0, null, null);
  insert into _t(check_name, result) values
    ('remise carte : remis = selection, pas de fond, pas de mouvement', case when (select deposited_amount >= 30 and new_float is null from public.cash_deposits where id = _dc)
       and not exists (select 1 from public.cash_movements where deposit_id = _dc) then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ journaux : brouillon exclu, mouvements et remises presents
  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'TIK', 'brouillon', current_date, 1000, 210, 1210, 'ht') returning id into _draft;
  _j := public.cash_journal_data(_co, current_date - 1, current_date);
  insert into _t(check_name, result) values
    ('journaux : brouillon exclu', case when not exists (select 1 from jsonb_array_elements(_j->'documents') e where (e->>'id')::uuid = _draft) then 'ok' else 'FAIL' end),
    ('journaux : ticket valide present', case when exists (select 1 from jsonb_array_elements(_j->'documents') e where (e->>'id')::uuid = _tik) then 'ok' else 'FAIL' end),
    ('journaux : mouvement 04 avec TVA', case when exists (select 1 from jsonb_array_elements(_j->'movements') e where e->>'type_code' = '04' and (e->>'vat_amount')::numeric = 1.74) then 'ok' else 'FAIL' end),
    ('journaux : remises de la periode', case when (select count(*) from jsonb_array_elements(_j->'deposits') e where (e->>'id')::uuid in (_d1, _d2, _d3, _dc)) = 4 then 'ok' else 'FAIL' end);
  begin
    perform public.cash_journal_data(_co, current_date, current_date - 1);
    insert into _t(check_name, result) values ('journaux : periode inversee refusee', 'FAIL accepte');
  exception when others then insert into _t(check_name, result) values ('journaux : periode inversee refusee', 'ok');
  end;
end $s$;

select n, check_name, result from _t order by n;
