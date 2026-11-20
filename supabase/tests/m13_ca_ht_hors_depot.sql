-- =====================================================================
-- Essai à blanc — Q66 (20/11/2026) : CA HT du tableau de bord hors dépôt-vente et y compris
-- dépôt-vente (migration 20261120153000_m13_ca_ht_hors_depot.sql, rejouée par PRE_SQL).
-- Société de test ItalTest, administrateur simon@themaul.be, transaction annulée (rt.py).
-- Scénario : chiffres du tableau de bord relevés, puis vente d'un dépôt-vente (consignment_sell,
-- comme l'écran) : facture à l'acquéreur 7 000 TTC (moto D, TVA 0 %, déposant particulier) +
-- facture de commission au déposant 1 000 TTC (826,45 HT, vente normale du magasin). Écarts :
--   1. CA HT y compris dépôt-vente : + 7 826,45 (jour et mois) ;
--   2. CA HT (hors dépôt-vente) : + 826,45 (la commission reste du CA du magasin) ;
--   3. part dépôt-vente : + 7 000 = écart entre les deux chiffres ;
--   4. CA TTC (anciennes clés) : + 8 000, anciennes clés toujours présentes ;
--   5. un avoir de la vente de la moto déduit la part dépôt-vente (+ 0 après avoir) et laisse le CA hors dépôt intact.
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _tag text := to_char(clock_timestamp(), 'HH24MISSUS');
  _dep uuid; _buy uuid; _c uuid; _avo uuid; k0 jsonb; k1 jsonb; k2 jsonb; cs record; fs record;
  d numeric;
begin
  k0 := public.dashboard_kpis(_co);

  insert into public.contacts (company_id, type, status, civility, first_name, last_name, zip, city, country)
  values (_co, 'particulier', 'client', 'M', 'Marc', 'DEPOSANT Q66', '1180', 'Uccle', 'BE') returning id into _dep;
  insert into public.contacts (company_id, type, status, civility, first_name, last_name, zip, city, country)
  values (_co, 'particulier', 'prospect', 'M', 'Luc', 'ACQUEREUR Q66', '1000', 'Bruxelles', 'BE') returning id into _buy;

  _c := public.consignment_create(_co, jsonb_build_object('depositor_id', _dep, 'depositor_kind', 'particulier',
          'vehicle', jsonb_build_object('vin', 'ZDMQ66A' || _tag, 'brand', 'Ducati', 'model', 'Monster 937'),
          'asked_price', 6000, 'agreed_price', 7000, 'min_price', 6500, 'commission_mode', 'ecart', 'deposit_fee', 0));
  perform public.consignment_sell(_c, jsonb_build_object('buyer_id', _buy, 'sale_price', 7000, 'fees', 0, 'repairs', 0,
         'force_below_min', false, 'buyer_invoice', true, 'commission_invoice', true, 'credit_note', false, 'receipt_method', null));
  select * into cs from public.consignments where id = _c;
  select * into fs from public.documents where id = cs.sale_document_id;

  k1 := public.dashboard_kpis(_co);

  insert into _t(check_name, result) values
    ('nouvelles cles presentes (CA HT, CA HT y compris depot-vente, part depot, jour et mois)',
     case when k1 ?& array['revenue_ht_today', 'revenue_ht_month', 'revenue_ht_today_incl_consignment',
                           'revenue_ht_month_incl_consignment', 'consignment_ht_today', 'consignment_ht_month'] then 'ok' else 'KO ' || k1::text end),
    ('anciennes cles toujours presentes',
     case when k1 ?& array['revenue_today', 'revenue_month', 'invoices_month', 'credit_notes_month', 'or_open',
                           'stock_value', 'vehicles_in_stock', 'receivables'] then 'ok' else 'KO' end);

  d := (k1->>'revenue_ht_today_incl_consignment')::numeric - (k0->>'revenue_ht_today_incl_consignment')::numeric;
  insert into _t(check_name, result) values ('CA HT du jour y compris depot-vente : + 7 826,45',
    case when d = 7826.45 then 'ok' else 'KO ' || d end);
  d := (k1->>'revenue_ht_month_incl_consignment')::numeric - (k0->>'revenue_ht_month_incl_consignment')::numeric;
  insert into _t(check_name, result) values ('CA HT du mois y compris depot-vente : + 7 826,45',
    case when d = 7826.45 then 'ok' else 'KO ' || d end);
  d := (k1->>'revenue_ht_today')::numeric - (k0->>'revenue_ht_today')::numeric;
  insert into _t(check_name, result) values ('CA HT du jour hors depot-vente : + 826,45 (commission)',
    case when d = 826.45 then 'ok' else 'KO ' || d end);
  d := (k1->>'revenue_ht_month')::numeric - (k0->>'revenue_ht_month')::numeric;
  insert into _t(check_name, result) values ('CA HT du mois hors depot-vente : + 826,45 (commission)',
    case when d = 826.45 then 'ok' else 'KO ' || d end);
  insert into _t(check_name, result) values ('ecart des deux CA = part depot-vente (jour et mois)',
    case when (k1->>'revenue_ht_today_incl_consignment')::numeric - (k1->>'revenue_ht_today')::numeric = (k1->>'consignment_ht_today')::numeric
          and (k1->>'revenue_ht_month_incl_consignment')::numeric - (k1->>'revenue_ht_month')::numeric = (k1->>'consignment_ht_month')::numeric
          and (k1->>'consignment_ht_today')::numeric - (k0->>'consignment_ht_today')::numeric = 7000
         then 'ok' else 'KO ' || k1::text end);
  d := (k1->>'revenue_today')::numeric - (k0->>'revenue_today')::numeric;
  insert into _t(check_name, result) values ('CA TTC du jour (ancienne cle) : + 8 000',
    case when d = 8000 then 'ok' else 'KO ' || d end);
  insert into _t(check_name, result) values ('factures du mois : + 2',
    case when (k1->>'invoices_month')::int - (k0->>'invoices_month')::int = 2 then 'ok' else 'KO' end);

  -- Avoir de la facture acquereur (la moto D) : deduit la part depot-vente, CA hors depot intact.
  insert into public.documents (company_id, doc_type, status, contact_id, vehicle_id, issue_date, source_document_id, notes)
  values (_co, 'AVO', 'brouillon', fs.contact_id, fs.vehicle_id, current_date, fs.id, 'Essai Q66 avoir')
  returning id into _avo;
  insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity,
                                     unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
  select _avo, l.article_id, l.designation, l.reference, l.line_type, -l.quantity, l.unit_price_ht, l.vat_rate, 0,
         -l.line_ht, -l.line_ttc, l.sort_order
    from public.document_lines l where l.document_id = fs.id;
  update public.documents set total_ht = -fs.total_ht, total_vat = -fs.total_vat, total_ttc = -fs.total_ttc where id = _avo;
  update public.documents set status = 'validee', number = 'TESTQ66-AVO-' || _tag where id = _avo;

  k2 := public.dashboard_kpis(_co);
  insert into _t(check_name, result) values ('avoir de la moto : part depot-vente revenue au niveau d avant la vente',
    case when (k2->>'consignment_ht_today')::numeric = (k0->>'consignment_ht_today')::numeric then 'ok'
         else 'KO ' || (k2->>'consignment_ht_today') || ' / ' || (k0->>'consignment_ht_today') end);
  insert into _t(check_name, result) values ('avoir de la moto : CA HT hors depot-vente inchange (+ 826,45 depuis le debut)',
    case when (k2->>'revenue_ht_today')::numeric - (k0->>'revenue_ht_today')::numeric = 826.45 then 'ok'
         else 'KO ' || ((k2->>'revenue_ht_today')::numeric - (k0->>'revenue_ht_today')::numeric) end);
  insert into _t(check_name, result) values ('avoir compte dans les avoirs du mois',
    case when (k2->>'credit_notes_month')::int - (k1->>'credit_notes_month')::int = 1 then 'ok' else 'KO' end);
exception when others then
  insert into _t(check_name, result) values ('essai interrompu', 'KO ' || sqlerrm);
end $s$;
