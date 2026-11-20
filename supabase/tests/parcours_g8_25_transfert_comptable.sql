-- =====================================================================
-- Parcours G8 n° 25 — Transfert comptable (lot-verif-parcours, 20/11/2026, agent B2).
-- G8 : Compta › Lancement transfert → Valider : en base FACTICE, ÉCHEC d'écriture (« le fichier de destination
--      n'a pas pu être créé : \\TSCLIENT\C\WINBOOKS\EXPORT\ ») ; transfert n° 6 réussi vers un dossier du
--      serveur : ECRITURES.TXT + COMPTES.TXT au format EBP, historique (n°, période, fichier), colonnes
--      « Compta » / « Date transfert » des factures, « Annuler transfert comptable n° ».
-- DMS : Comptabilité → Transfert EBP (ebp-api.ts) : paramètres (accounting_transfer_settings), règles de comptes
--      (accounting_account_rules), comptes clients (accounting_create_third_accounts), aperçu (loadEbpSources +
--      buildEbpTransfer), lancement (record_accounting_transfer : historique + marquage, puis TÉLÉCHARGEMENT des
--      deux fichiers par le navigateur : pas de dossier réseau, donc pas l'échec G8), annulation
--      (cancel_accounting_transfer). Fonctions réservées à l'administrateur / comptable (20261118182000 et
--      20261118250000). La chaîne complète (vente → caisse → remise → Z → écritures → EBP, comptes et équilibre)
--      est dans parcours_g8_25b_chaine_caisse_compta.sql.
-- Contrôles :
--   1  administrateur : droit de transfert ; paramètres posés (format EBP, ECRITURES.TXT / COMPTES.TXT par défaut)
--   2  règlements G8 : ESP 530000 / CA, MAE 511300 / RC, VIR 511400 / RC (5 modes) ; 7 mouvements de caisse 01 à 07
--   3  facture + virement proposés au transfert
--   4  remise en banque APRÈS le Z : remise active sans sortie 01 (lue par le transfert dans cash_deposits,
--      correctif TS du 20/11, tests/export-ebp-remise-apres-z.test.ts)
--   5  comptes clients « création automatique » : 200000 + code (G8 : client 20 → 200020)
--   6  transfert : n° = précédent + 1, éléments, fichiers ECRITURES.TXT / COMPTES.TXT, facture « Compta » + date, events
--   7  le virement n'est plus proposé ; un second transfert du même document est refusé
--   8  annulation sans motif refusée ; avec motif : annulé, éléments libérés, Compta décoché, trace, de nouveau proposé
--   9  retransfert : n° suivant ; double annulation refusée
--  10  vendeur d'ItalTest : ni droit de transfert, ni historique, ni règlements à transférer, ni « Générer »,
--      ni registre TVA ; il garde les journaux de caisse
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
-- Vendeur d'essai dans ItalTest (utilisateur existant, vendeur d'ITALBIKE, non membre d'ItalTest) : role pose
-- dans la transaction annulee.
insert into public.user_roles (user_id, company_id, role)
select 'ea0e5718-a32d-423d-addd-e3112ec7b471', '5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'vendeur'
 where not exists (select 1 from public.user_roles where user_id = 'ea0e5718-a32d-423d-addd-e3112ec7b471' and company_id = '5593d97e-69ad-43dd-8237-4ab8aa4e5c08');

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _ctc uuid; _code text; _doc uuid; _pay uuid; _s uuid; _tik uuid; _dep uuid; _items jsonb; _total numeric;
  _r jsonb; _r2 jsonb; _tr uuid; _tno0 int; _st jsonb; _n int;
begin
  insert into _t(check_name, result) select 'admin : droit de transfert ; parametres poses (defauts EBP, ECRITURES.TXT / COMPTES.TXT)',
    case when public._accounting_can_transfer(_co)
          and exists (select 1 from public.accounting_transfer_settings where company_id = _co)
          and coalesce((select params->>'entriesFile' from public.accounting_transfer_settings where company_id = _co), 'ECRITURES.TXT') = 'ECRITURES.TXT'
          and coalesce((select params->>'accountsFile' from public.accounting_transfer_settings where company_id = _co), 'COMPTES.TXT') = 'COMPTES.TXT'
         then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'reglements G8 (ESP 530000/CA, MAE 511300/RC, VIR 511400/RC, 5 modes) ; mouvements 01 a 07',
    case when (select string_agg(key || ':' || account || ':' || journal, ',' order by key) from public.accounting_account_rules
                where company_id = _co and kind = 'payment' and key in ('ESP', 'MAE', 'VIR')) = 'ESP:530000:CA,MAE:511300:RC,VIR:511400:RC'
          and (select count(*) from public.accounting_account_rules where company_id = _co and kind = 'payment' and key in ('ESP','MAE','VIR','VID','VIC')) = 5
          and (select string_agg(key, ',' order by key) from public.accounting_account_rules where company_id = _co and kind = 'cash_movement') = '01,02,03,04,05,06,07'
         then 'ok' else 'KO' end;

  -- ------------------------------------------------ caisse d un autre essai : cloturee ici (transaction annulee)
  if exists (select 1 from public.cash_sessions where company_id = _co and status = 'closed' and closed_at >= now()) then
    raise exception 'ESSAI : une caisse vient d etre cloturee a l instant, relancez l essai.';
  end if;
  update public.cash_sessions set counted_cash = 0, variance_reason = 'ESSAI A BLANC (transaction annulee)', status = 'closed', closed_at = opened_at
   where company_id = _co and status = 'open';

  -- ------------------------------------------------ facture 121 + virement
  insert into public.contacts (company_id, civility, type, status, first_name, last_name) values (_co, 'Monsieur', 'particulier', 'client', 'ESSAI', 'TRANSFERT B2') returning id, code into _ctc, _code;
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode, contact_id)
  values (_co, null, 'brouillon', 'FAC', current_date, 100, 21, 121, 'ht', _ctc) returning id into _doc;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_doc, 'ESSAI transfert', 'article', 1, 100, 21, 0, 100, 121, 0);
  perform public.document_assign_number(_doc);
  insert into public.document_payments (document_id, method, amount, status) values (_doc, 'VIR', 121, 'recu') returning id into _pay;
  perform public.recompute_document_paid(_doc);
  insert into _t(check_name, result) select 'facture validee non transferee + virement proposes',
    case when (select not compta_transferred and date_transfert is null and number is not null from public.documents where id = _doc)
          and exists (select 1 from public.ebp_payments_to_transfer(_co, current_date, null) p where p.id = _pay and p.doc_type = 'FAC')
         then 'ok' else 'KO' end;

  -- ------------------------------------------------ remise en banque apres le Z (caisse fermee)
  insert into public.cash_sessions (company_id, opening_float, opened_by) values (_co, public.cash_drawer_balance(_co), auth.uid()) returning id into _s;
  insert into public.documents (company_id, number, status, doc_type, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, null, 'brouillon', 'TIK', current_date, 41.32, 8.68, 50, 'ttc') returning id into _tik;
  insert into public.document_lines (document_id, designation, line_type, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  values (_tik, 'ESSAI transfert', 'article', 1, 41.32, 21, 0, 41.32, 50, 0);
  perform public.document_assign_number(_tik);
  insert into public.document_payments (document_id, method, amount, status) values (_tik, 'ESP', 50, 'recu');
  update public.cash_sessions set status = 'closed', closed_at = now(), counted_cash = opening_float + 50, denominations = '{}'::jsonb where id = _s;
  select jsonb_agg(jsonb_build_object('type', c.source_type, 'id', c.source_id)), round(sum(c.amount), 2) into _items, _total
    from public.cash_deposit_candidates(_co, 'ESP', null, now(), false) c;
  _dep := public.cash_deposit_create(_co, 'ESP', 'remise', null, now(), current_date, _items, 50, '01', null);
  insert into _t(check_name, result) select 'remise apres le Z : active, 50 remis, sans sortie 01 (prise dans cash_deposits par le transfert)',
    case when (select status = 'active' and deposited_amount = 50 and session_id is null and deposit_date = current_date from public.cash_deposits where id = _dep)
          and not exists (select 1 from public.cash_movements where deposit_id = _dep)
          and not exists (select 1 from public.accounting_transfer_items where source_id = _dep and not cancelled)
         then 'ok' else 'KO' end;

  -- ------------------------------------------------ comptes clients : creation automatique (200000 + code)
  _n := public.accounting_create_third_accounts(_co, 'C', 'auto');
  insert into _t(check_name, result) select 'comptes clients automatiques : 200000 + code (client ' || _code || ')',
    case when exists (select 1 from public.accounting_third_accounts where company_id = _co and contact_id = _ctc and kind = 'C' and origin = 'auto'
                       and account = (200000 + _code::bigint)::text) then 'ok' else 'KO (' || _n || ' crees)' end;

  -- ------------------------------------------------ lancement du transfert (runTransfer)
  select coalesce(max(transfer_no), 0) into _tno0 from public.accounting_transfers where company_id = _co;
  _r := public.record_accounting_transfer(_co, jsonb_build_object(
    'mode', 'manual', 'period_from', current_date, 'period_to', current_date, 'entries_file', 'ECRITURES.TXT', 'accounts_file', 'COMPTES.TXT',
    'ecritures', '00001,...', 'comptes', '"' || (200000 + _code::bigint) || '"', 'pieces', 3, 'lines', 7, 'total_debit', 292, 'total_credit', 292,
    'items', jsonb_build_array(jsonb_build_object('kind', 'document', 'id', _doc, 'piece', 1), jsonb_build_object('kind', 'payment', 'id', _pay, 'piece', 2),
                               jsonb_build_object('kind', 'cash_movement', 'id', _dep, 'piece', 3))));
  _tr := (_r->>'id')::uuid;
  insert into _t(check_name, result) select 'transfert : n = precedent + 1, 3 elements, fichiers, facture Compta + date, events',
    case when (_r->>'transfer_no')::int = _tno0 + 1 and (_r->>'items')::int = 3
          and (select entries_file = 'ECRITURES.TXT' and accounts_file = 'COMPTES.TXT' and status = 'transfere' and period_from = current_date
                      and total_debit = 292 and created_by = auth.uid() from public.accounting_transfers where id = _tr)
          and (select compta_transferred and date_transfert = current_date from public.documents where id = _doc)
          and exists (select 1 from public.events where entity_id = _tr::text and action = 'accounting_transfer')
         then 'ok' else 'KO ' || _r::text end;
  insert into _t(check_name, result) select 'virement plus propose ; remise marquee',
    case when not exists (select 1 from public.ebp_payments_to_transfer(_co, current_date, null) p where p.id = _pay)
          and exists (select 1 from public.accounting_transfer_items where source_kind = 'cash_movement' and source_id = _dep and not cancelled)
         then 'ok' else 'KO' end;
  begin
    perform public.record_accounting_transfer(_co, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind', 'document', 'id', _doc))));
    insert into _t(check_name, result) values ('second transfert du meme document refuse', 'KO accepte');
  exception when unique_violation then insert into _t(check_name, result) values ('second transfert du meme document refuse', 'ok');
  end;

  -- ------------------------------------------------ annulation (G8 « Annuler transfert comptable n° »)
  begin
    perform public.cancel_accounting_transfer(_tr, '  ');
    insert into _t(check_name, result) values ('annulation sans motif refusee', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('annulation sans motif refusee', 'ok');
  end;
  perform public.cancel_accounting_transfer(_tr, 'ESSAI : mauvaise periode');
  insert into _t(check_name, result) select 'annulation : annule, elements liberes, Compta decoche, trace, virement de nouveau propose',
    case when (select status = 'annule' and cancel_reason = 'ESSAI : mauvaise periode' and cancelled_by = auth.uid() from public.accounting_transfers where id = _tr)
          and not exists (select 1 from public.accounting_transfer_items where transfer_id = _tr and not cancelled)
          and (select not compta_transferred and date_transfert is null from public.documents where id = _doc)
          and exists (select 1 from public.events where entity_id = _tr::text and action = 'accounting_transfer_cancel')
          and exists (select 1 from public.ebp_payments_to_transfer(_co, current_date, null) p where p.id = _pay)
         then 'ok' else 'KO' end;
  _r2 := public.record_accounting_transfer(_co, jsonb_build_object('period_to', current_date, 'items', jsonb_build_array(jsonb_build_object('kind', 'document', 'id', _doc))));
  insert into _t(check_name, result) select 'retransfert apres annulation : n suivant',
    case when (_r2->>'transfer_no')::int = _tno0 + 2 then 'ok' else 'KO' end;
  begin
    perform public.cancel_accounting_transfer(_tr, 'encore');
    insert into _t(check_name, result) values ('double annulation refusee', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('double annulation refusee', 'ok');
  end;
end $s$;

-- ------------------------------------------------ vendeur d ItalTest : compta reservee
select set_config('request.jwt.claims', '{"sub":"ea0e5718-a32d-423d-addd-e3112ec7b471","role":"authenticated"}', true);
do $s$
declare _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _ok text := 'ok';
begin
  if not public.is_member(_co) then _ok := 'KO vendeur non membre'; end if;
  if public._accounting_can_transfer(_co) then _ok := 'KO droit de transfert'; end if;
  if exists (select 1 from public.accounting_transfers where company_id = _co) then _ok := 'KO historique visible'; end if;
  begin
    perform public.ebp_payments_to_transfer(_co, current_date, null);
    _ok := 'KO reglements a transferer lisibles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_accounting_transfer(_co, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind', 'document', 'id', gen_random_uuid()))));
    _ok := 'KO transfert accepte';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.generate_accounting_entries(_co, current_date, current_date);
    _ok := 'KO Generer accepte';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.vat_register(_co, current_date, current_date);
    _ok := 'KO registre TVA lisible';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cash_journal_data(_co, current_date, current_date);
  exception when others then _ok := 'KO journaux de caisse refuses au vendeur';
  end;
  insert into _t(check_name, result) values ('vendeur : ni transfert, ni historique, ni Generer, ni registre TVA ; journaux de caisse ouverts', _ok);
end $s$;
select n, check_name, result from _t order by n;
