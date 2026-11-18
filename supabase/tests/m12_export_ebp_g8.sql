-- =====================================================================
-- lot-g8-export-compta (18/11/2026) — essai a blanc de 20261118250000_m12_export_ebp_g8.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118250000_m12_export_ebp_g8.sql \
--      supabase/tests/m12_export_ebp_g8.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- (apres le bloc 20261103150000 -> 20261103250000 si celui-ci n est pas encore applique).
-- Joue un administrateur d ITALBIKE STORE (claims JWT simulees) :
--   - parametres et regles G8 poses (5 modes de reglement, 7 mouvements de caisse) ;
--   - facture validee + virement percu : le reglement est propose au transfert ;
--   - transfert n : facture et reglement marques, colonne Compta de la facture cochee ;
--   - second transfert du meme document refuse ; le reglement n est plus propose ;
--   - annulation sans motif refusee, avec motif : transfert annule, elements liberes, Compta decoche, trace ;
--   - un utilisateur sans role comptable / admin n a ni lecture ni droit de transfert.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _doc uuid; _pay uuid; _r jsonb; _r2 jsonb; _tr uuid; _n int; _ok boolean;
begin
  insert into _t(check_name, result) select 'role admin reconnu', case when public._accounting_can_transfer(_co) then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'parametres poses',
    case when exists (select 1 from public.accounting_transfer_settings where company_id = _co) then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'reglements G8 (5)',
    case when (select count(*) from public.accounting_account_rules where company_id = _co and kind = 'payment' and key in ('ESP','MAE','VIR','VID','VIC')) = 5 then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'especes 530000 / CA',
    case when exists (select 1 from public.accounting_account_rules where company_id = _co and kind = 'payment' and key = 'ESP' and account = '530000' and journal = 'CA') then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'mouvements de caisse G8 (7)',
    case when (select count(*) from public.accounting_account_rules where company_id = _co and kind = 'cash_movement') >= 7 then 'ok' else 'KO' end;

  -- Facture validee 121 EUR + virement percu
  insert into public.documents (company_id, doc_type, status, issue_date, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', current_date, 100, 21, 121, 'ht') returning id into _doc;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_doc, 'ESSAI EBP', 1, 100, 21, 100, 121, 0, 'article');
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'FAC') where id = _doc;
  insert into public.document_payments (document_id, method, amount, status, note)
  values (_doc, 'VIR', 121, 'recu', 'ESSAI EBP') returning id into _pay;

  insert into _t(check_name, result) select 'reglement propose',
    case when exists (select 1 from public.ebp_payments_to_transfer(_co, current_date, null) p where p.id = _pay) then 'ok' else 'KO' end;

  _r := public.record_accounting_transfer(_co, jsonb_build_object(
    'period_from', current_date, 'period_to', current_date, 'ecritures', '00001,...', 'comptes', '"411000000"', 'pieces', 2, 'lines', 4,
    'total_debit', 242, 'total_credit', 242,
    'items', jsonb_build_array(jsonb_build_object('kind', 'document', 'id', _doc, 'piece', 1), jsonb_build_object('kind', 'payment', 'id', _pay, 'piece', 2))));
  _tr := (_r->>'id')::uuid;
  insert into _t(check_name, result) select 'transfert numerote', case when (_r->>'transfer_no')::int >= 1 and (_r->>'items')::int = 2 then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'facture marquee Compta',
    case when (select compta_transferred and date_transfert = current_date from public.documents where id = _doc) then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'reglement plus propose',
    case when not exists (select 1 from public.ebp_payments_to_transfer(_co, current_date, null) p where p.id = _pay) then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'trace events transfert',
    case when exists (select 1 from public.events where entity_id = _tr::text and action = 'accounting_transfer') then 'ok' else 'KO' end;

  begin
    perform public.record_accounting_transfer(_co, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind', 'document', 'id', _doc))));
    insert into _t(check_name, result) values ('double transfert refuse', 'KO');
  exception when unique_violation then
    insert into _t(check_name, result) values ('double transfert refuse', 'ok');
  end;

  begin
    perform public.cancel_accounting_transfer(_tr, '  ');
    insert into _t(check_name, result) values ('annulation sans motif refusee', 'KO');
  exception when others then
    insert into _t(check_name, result) values ('annulation sans motif refusee', 'ok');
  end;

  perform public.cancel_accounting_transfer(_tr, 'ESSAI : mauvaise periode');
  insert into _t(check_name, result) select 'transfert annule',
    case when (select status = 'annule' and cancel_reason = 'ESSAI : mauvaise periode' and cancelled_by = auth.uid() from public.accounting_transfers where id = _tr) then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'elements liberes',
    case when not exists (select 1 from public.accounting_transfer_items where transfer_id = _tr and not cancelled) then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'Compta decoche',
    case when (select not compta_transferred and date_transfert is null from public.documents where id = _doc) then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'trace events annulation',
    case when exists (select 1 from public.events where entity_id = _tr::text and action = 'accounting_transfer_cancel') then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'reglement de nouveau propose',
    case when exists (select 1 from public.ebp_payments_to_transfer(_co, current_date, null) p where p.id = _pay) then 'ok' else 'KO' end;

  _r2 := public.record_accounting_transfer(_co, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind', 'document', 'id', _doc))));
  insert into _t(check_name, result) select 'retransfert apres annulation',
    case when (_r2->>'transfer_no')::int = (_r->>'transfer_no')::int + 1 then 'ok' else 'KO' end;

  begin
    perform public.cancel_accounting_transfer(_tr, 'encore');
    insert into _t(check_name, result) values ('double annulation refusee', 'KO');
  exception when others then
    insert into _t(check_name, result) values ('double annulation refusee', 'ok');
  end;

  _n := public.accounting_create_third_accounts(_co, 'C', 'auto');
  insert into _t(check_name, result) select 'creation automatique comptes clients (200000 + code)',
    case when not exists (select 1 from public.accounting_third_accounts a join public.contacts c on c.id = a.contact_id
                           where a.company_id = _co and a.origin = 'auto' and a.kind = 'C' and a.account <> (200000 + c.code::bigint)::text) then 'ok' else 'KO' end;
end $s$;

-- Utilisateur sans role dans la societe : ni lecture, ni transfert.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $s$
declare _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
begin
  insert into _t(check_name, result) select 'sans role : garde fermee', case when not public._accounting_can_transfer(_co) then 'ok' else 'KO' end;
  insert into _t(check_name, result) select 'sans role : historique invisible',
    case when not exists (select 1 from public.accounting_transfers where company_id = _co) then 'ok' else 'KO' end;
  begin
    perform public.record_accounting_transfer(_co, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind', 'document', 'id', gen_random_uuid()))));
    insert into _t(check_name, result) values ('sans role : transfert refuse', 'KO');
  exception when insufficient_privilege then
    insert into _t(check_name, result) values ('sans role : transfert refuse', 'ok');
  end;
end $s$;

select n, check_name, result from _t order by n;
