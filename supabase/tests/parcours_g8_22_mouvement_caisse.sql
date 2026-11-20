-- =====================================================================
-- Parcours G8 n° 22 — Mouvement de fond de caisse (lot-verif-parcours, 20/11/2026, agent B2).
-- G8 : Facturation › Mouvement de caisse → type 04 « Achat de consommable » → mode Espèces → 10 €
--      → confirmation → sortie −10 € (TVA 21 % comprise : 8,26 + 1,74), mouvement numéroté, visible
--      dans la remise en banque (−10 €) et dans le journal « Mouvements de fonds de caisse ».
-- DMS : Caisse (/pos) › onglet Caisse › « Mouvements de fond de caisse » (MovementPanel, cash-screen.tsx)
--      → addTypedMovement (cash-deposit-api.ts) = INSERT cash_movements (company_id, session_id, kind,
--      amount, method, reason, operator_id, type_code) ; la base (trigger cash_movements_typed, migration
--      20261118150000) pose le n°, contrôle le sens du type, calcule la TVA comprise et reprend le compte.
--      Ouverture de caisse = openSession (INSERT cash_sessions), clôture = closeSession (UPDATE status closed).
-- Société de test ItalTest, utilisateur simon@themaul.be (admin). Transaction annulée (rt.py) : rien ne reste.
-- Une caisse ouverte par un autre essai / agent est clôturée DANS la transaction (annulée ensuite).
-- Contrôles :
--   1  fond proposé à l'ouverture = espèces du tiroir (B0)
--   2  mouvement 04 : n° = précédent + 1
--   3  sortie 10 € espèces, TVA 21 % comprise 1,74 (HT 8,26)
--   4  motif saisi gardé, compte du type repris (vide dans ItalTest comme dans G8 FACTICE)
--   5  opérateur = utilisateur connecté, rattaché à la session ouverte
--   6  trace events (insert cash_movements)
--   7  rapport X : sorties espèces 10, théorique = fond − 10
--   8  tiroir = B0 − 10
--   9  ligne de la remise en banque : −10 « MVT n »
--  10  journal des mouvements (cash_journal_data) : type, libellé du type, TVA 1,74
--  11  type 06 « divers entrée » : entrée, sans TVA, tiroir +20 ; type 05 La Poste : sortie sans TVA
--  12-16 refus : 04 en entrée, 01 à la main, type inconnu, montant 0, changement de n°
--  17  types non « système » proposés à l'écran = 00, 02 à 07 (01 réservé à la remise en banque)
--  18  après le Z : plus aucun mouvement dans la caisse clôturée
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _b0 numeric; _s uuid; _no0 int; _m public.cash_movements; _m6 public.cash_movements; _m5 public.cash_movements;
  _x jsonb; _j jsonb; _c record; _ok boolean; _err text; _types text;
begin
  -- ------------------------------------------------ caisse d un autre essai : cloturee ici (transaction annulee)
  if exists (select 1 from public.cash_sessions where company_id = _co and status = 'closed' and closed_at >= now()) then
    raise exception 'ESSAI : une caisse vient d etre cloturee a l instant, relancez l essai.';
  end if;
  update public.cash_sessions set counted_cash = 0, variance_reason = 'ESSAI A BLANC (transaction annulee)',
         status = 'closed', closed_at = opened_at
   where company_id = _co and status = 'open';

  -- ------------------------------------------------ ouverture (openSession) : fond = fond propose
  _b0 := public.cash_drawer_balance(_co);
  insert into public.cash_sessions (company_id, opening_float, opened_by, note)
  values (_co, _b0, auth.uid(), 'ESSAI parcours 22') returning id into _s;
  insert into _t(check_name, result) select 'ouverture : fond propose = especes du tiroir',
    case when (select proposed_float from public.cash_sessions where id = _s) = _b0 then 'ok' else 'KO' end;

  -- ------------------------------------------------ G8 : 04 achat de consommable, especes, 10 EUR
  select coalesce(max(movement_no), 0) into _no0 from public.cash_movements where company_id = _co;
  insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, operator_id, type_code)
  values (_co, _s, 'out', 10, 'ESP', 'TEST consommable', auth.uid(), '04') returning * into _m;

  insert into _t(check_name, result) values
    ('mouvement 04 : n = precedent + 1', case when _m.movement_no = _no0 + 1 then 'ok' else 'KO ' || coalesce(_m.movement_no::text, 'null') || ' (avant ' || _no0 || ')' end),
    ('sortie 10 EUR especes, TVA 21 % comprise 1,74 (HT 8,26)',
       case when _m.kind = 'out' and _m.amount = 10 and _m.method = 'ESP' and _m.vat_rate = 21 and _m.vat_amount = 1.74 and _m.amount - _m.vat_amount = 8.26
            then 'ok' else 'KO ' || _m.kind || ' ' || _m.amount || ' TVA ' || coalesce(_m.vat_rate::text, 'null') || '/' || coalesce(_m.vat_amount::text, 'null') end),
    ('motif garde, compte du type repris',
       case when _m.reason = 'TEST consommable'
             and _m.account_code is not distinct from (select nullif(btrim(extra->>'account'), '') from public.reference_values
                                                        where company_id = _co and table_key = 'cash_movement_type' and code = '04')
            then 'ok' else 'KO ' || coalesce(_m.reason, 'null') || ' / ' || coalesce(_m.account_code, 'null') end),
    ('operateur = utilisateur, session ouverte', case when _m.operator_id = auth.uid() and _m.session_id = _s then 'ok' else 'KO' end),
    ('trace events (insert cash_movements)', case when exists (select 1 from public.events where entity_type = 'cash_movements' and entity_id = _m.id::text and action = 'insert') then 'ok' else 'KO' end);

  _x := public.cash_z_report_session(_s);
  insert into _t(check_name, result) values
    ('rapport X : sorties especes 10, theorique = fond - 10',
       case when (_x->>'cash_out_esp')::numeric = 10 and (_x->>'expected_cash')::numeric = _b0 - 10 then 'ok'
            else 'KO sorties ' || (_x->>'cash_out_esp') || ' theorique ' || (_x->>'expected_cash') end),
    ('tiroir = B0 - 10', case when public.cash_drawer_balance(_co) = _b0 - 10 then 'ok' else 'KO ' || (public.cash_drawer_balance(_co) - _b0)::text end);

  select * into _c from public.cash_deposit_candidates(_co, 'ESP', null, now(), false) c where c.source_type = 'movement' and c.source_id = _m.id;
  insert into _t(check_name, result) values
    ('remise en banque : ligne -10 « MVT n »', case when _c.amount = -10 and _c.document_number = 'MVT ' || _m.movement_no then 'ok' else 'KO ' || coalesce(_c.amount::text, 'absente') end);

  _j := public.cash_journal_data(_co, current_date, current_date);
  insert into _t(check_name, result) values
    ('journal des mouvements : type 04, libelle du type, TVA 1,74',
       case when exists (select 1 from jsonb_array_elements(_j->'movements') e
                          where (e->>'id')::uuid = _m.id and e->>'type_code' = '04' and e->>'type_label' ilike 'Achat de consommable%'
                            and (e->>'vat_amount')::numeric = 1.74 and (e->>'movement_no')::int = _m.movement_no)
            then 'ok' else 'KO' end);

  -- ------------------------------------------------ autres types : 06 divers entree, 05 La Poste
  insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, operator_id, type_code)
  values (_co, _s, 'in', 20, 'ESP', '', auth.uid(), '06') returning * into _m6;
  insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, operator_id, type_code)
  values (_co, _s, 'out', 3, 'ESP', 'TEST timbres', auth.uid(), '05') returning * into _m5;
  insert into _t(check_name, result) values
    ('06 entree sans TVA (motif = libelle du type) ; 05 sortie sans TVA ; n suivants ; tiroir +20 -3',
       case when _m6.kind = 'in' and _m6.vat_amount is null and _m6.reason ilike 'Divers entr%'
             and _m5.vat_amount is null and _m6.movement_no = _m.movement_no + 1 and _m5.movement_no = _m.movement_no + 2
             and public.cash_drawer_balance(_co) = _b0 - 10 + 20 - 3
            then 'ok' else 'KO ' || coalesce(_m6.reason, 'null') || ' / ' || (public.cash_drawer_balance(_co) - _b0)::text end);

  -- ------------------------------------------------ refus
  begin
    insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, type_code) values (_co, _s, 'in', 5, 'ESP', 'TEST', '04');
    insert into _t(check_name, result) values ('04 (sortie) refuse en entree', 'KO accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('04 (sortie) refuse en entree (message clair)', case when _err like '%sortie d argent%' then 'ok' else 'KO ' || _err end);
  end;
  begin
    insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, type_code) values (_co, _s, 'out', 5, 'ESP', 'TEST', '01');
    insert into _t(check_name, result) values ('01 remise en banque refuse a la main', 'KO accepte');
  exception when others then
    get stacked diagnostics _err = message_text;
    insert into _t(check_name, result) values ('01 remise en banque refuse a la main (renvoi vers Remises en banque)', case when _err like '%Remises en banque%' then 'ok' else 'KO ' || _err end);
  end;
  begin
    insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, type_code) values (_co, _s, 'out', 5, 'ESP', 'TEST', '99');
    insert into _t(check_name, result) values ('type inconnu refuse', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('type inconnu refuse', 'ok');
  end;
  begin
    insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, type_code) values (_co, _s, 'out', 0, 'ESP', 'TEST', '04');
    insert into _t(check_name, result) values ('montant 0 refuse', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('montant 0 refuse', 'ok');
  end;
  begin
    update public.cash_movements set movement_no = movement_no + 1000 where id = _m.id;
    insert into _t(check_name, result) values ('n du mouvement non modifiable', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('n du mouvement non modifiable', 'ok');
  end;

  -- ------------------------------------------------ types proposes a l ecran (listMovementTypes, hors systeme)
  select string_agg(code, ',' order by sort_order) into _types from public.reference_values
   where company_id = _co and table_key = 'cash_movement_type' and is_active and coalesce((extra->>'system')::boolean, false) = false;
  insert into _t(check_name, result) values
    ('types proposes : 00, 02 a 07 (01 reserve a la remise)', case when _types = '00,02,03,04,05,06,07' then 'ok' else 'KO ' || coalesce(_types, 'aucun') end);

  -- ------------------------------------------------ apres le Z (closeSession) : caisse figee
  update public.cash_sessions set status = 'closed', closed_at = now(), counted_cash = _b0 + 7, denominations = '{}'::jsonb
   where id = _s and status = 'open';
  begin
    insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, type_code) values (_co, _s, 'out', 1, 'ESP', 'TEST', '07');
    insert into _t(check_name, result) values ('apres le Z : mouvement refuse dans la caisse cloturee', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('apres le Z : mouvement refuse dans la caisse cloturee', 'ok');
  end;
end $s$;
select n, check_name, result from _t order by n;
