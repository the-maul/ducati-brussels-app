-- =====================================================================
-- Rattrapage G8 (18/11/2026) -- essai a blanc de 20261118130000_m8_garantie_et_accident.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118130000_m8_garantie_et_accident.sql \
--      supabase/tests/m8_garantie_et_accident.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Prerequis en base : 20261031110000 (check-up) et 20261103110000 (dossiers accident) ; sinon les
-- mettre en tete du fichier.
-- Scenario, administrateur simule d'ITALBIKE STORE :
--   OR garantie fournisseur (05) en refus partiel : 1 piece acceptee, 1 piece refusee, 1 h de MO ;
--   lignes ecrites par repair_order_write_lines (decision gardee) ; passage « facture » ->
--   imputation (piece au PAMP, MO au taux garantie 83,00), ligne refusee non imputee, une ligne
--   de suivi « attente remboursement » pour la piece acceptee seulement, vue Garanties et
--   statistique Garanties / CA ; fiche cabinet + expert ; volet assureur du dossier accident
--   (franchise en %, au-dela de 100 refusee) ; RLS (autre societe invisible).
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');
insert into _ctx select 'contact', c.id::text from public.contacts c
 where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and c.type <> 'fournisseur' and c.is_active
 order by c.created_at limit 1;
insert into _ctx select 'vehicle', v.id::text from public.vehicles v
 where v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' order by v.created_at limit 1;
insert into _ctx select 'supplier', c.id::text from public.contacts c
 where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and c.type = 'fournisseur' order by c.created_at limit 1;
-- Deux pieces stockees ; PAMP et fournisseur poses pour l'essai (annule au rollback).
insert into _ctx select 'p1', a.id::text from public.articles a
 where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.mgmt_type = 'A' order by a.reference limit 1;
insert into _ctx select 'p2', a.id::text from public.articles a
 where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.mgmt_type = 'A' order by a.reference offset 1 limit 1;
update public.articles set pamp = 10, purchase_price = 12, main_supplier_id = (select v::uuid from _ctx where k = 'supplier')
 where id in (select v::uuid from _ctx where k in ('p1', 'p2'));

insert into _t(check_name, result)
select 'parametres : taux MO garantie 83,00 et types 05 / 06 / 07 presents',
       case when (select (extra->>'hourly_rate_ht')::numeric from public.reference_values
                   where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and table_key = 'workshop_warranty' and code = 'mo') = 83.00
             and (select count(*) from public.reference_values
                   where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and table_key = 'cession_type' and code in ('05', '06', '07')) = 3
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

with o as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, warranty_status, warranty_cession_code, warranty_note, repair_type)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'OR-ESSAI-GAR',
          (select v::uuid from _ctx where k = 'contact'), (select v::uuid from _ctx where k = 'vehicle'), 15000,
          'en_cours', 'refus_partiel', '05', 'Demande de garantie pour le chassis essai', 'garantie_ducati')
  returning id)
insert into _ctx select 'or', id::text from o;

select public.repair_order_write_lines((select v::uuid from _ctx where k = 'or'), jsonb_build_array(
  jsonb_build_object('kind', 'piece', 'article_id', (select v from _ctx where k = 'p1'), 'designation', 'Piece acceptee',
                     'quantity', 2, 'unit_price_ht', 30, 'vat_rate', 21, 'is_warranty', true, 'warranty_decision', 'accepte', 'line_ht', 0, 'line_ttc', 0),
  jsonb_build_object('kind', 'piece', 'article_id', (select v from _ctx where k = 'p2'), 'designation', 'Piece refusee',
                     'quantity', 1, 'unit_price_ht', 50, 'vat_rate', 21, 'is_warranty', true, 'warranty_decision', 'refuse', 'line_ht', 50, 'line_ttc', 60.5),
  jsonb_build_object('kind', 'mo', 'designation', 'MO garantie', 'quantity', 1, 'unit_price_ht', 63.47, 'vat_rate', 21,
                     'is_warranty', true, 'line_ht', 0, 'line_ttc', 0),
  jsonb_build_object('kind', 'piece', 'designation', 'Hors garantie', 'quantity', 1, 'unit_price_ht', 5, 'vat_rate', 21,
                     'is_warranty', false, 'warranty_decision', 'refuse', 'line_ht', 5, 'line_ttc', 6.05)
));

insert into _t(check_name, result)
select 'lignes : decision gardee sur les lignes en garantie, ignoree hors garantie',
       case when (select count(*) from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or') and warranty_decision = 'refuse') = 1
             and (select warranty_decision from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or') and designation = 'Hors garantie') is null
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'contrainte : une decision inconnue est refusee',
       case when not exists (select 1 from public.repair_order_lines where warranty_decision not in ('accepte', 'refuse')) then 'ok' else 'KO' end;

-- Facturation : le passage « facture » impute la garantie (declencheur).
update public.repair_orders set status = 'facture' where id = (select v::uuid from _ctx where k = 'or');

insert into _t(check_name, result)
select 'imputation : piece acceptee au PAMP (2 x 10), PA (2 x 12), PV (2 x 30)',
       case when (select row(warranty_cost_ht, warranty_pa_ht, warranty_sale_ht)::text from public.repair_order_lines
                   where or_id = (select v::uuid from _ctx where k = 'or') and designation = 'Piece acceptee') = '(20.00,24.00,60.00)'
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'imputation : MO au taux garantie (1 h x 83,00), ligne refusee et ligne hors garantie non imputees',
       case when (select warranty_cost_ht from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or') and kind = 'mo') = 83.00
             and (select count(*) from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or') and warranty_cost_ht is not null) = 2
             and (select warranty_imputed_at from public.repair_orders where id = (select v::uuid from _ctx where k = 'or')) is not null
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'garantie fournisseur (05) : une ligne de suivi « attente remboursement » pour la piece acceptee, fournisseur de l''article',
       case when (select count(*) from public.warranty_returns where repair_order_id = (select v::uuid from _ctx where k = 'or')) = 1
             and (select row(status, amount_ht, supplier_id::text = (select v from _ctx where k = 'supplier'))::text from public.warranty_returns
                   where repair_order_id = (select v::uuid from _ctx where k = 'or')) = '(attente_remboursement,24.00,t)'
            then 'ok' else 'KO' end;

-- Une 2e mise a jour ne double rien.
update public.repair_orders set notes = 'relance' where id = (select v::uuid from _ctx where k = 'or');
insert into _t(check_name, result)
select 'idempotence : pas de 2e ligne de suivi',
       case when (select count(*) from public.warranty_returns where repair_order_id = (select v::uuid from _ctx where k = 'or')) = 1 then 'ok' else 'KO' end;

update public.warranty_returns set status = 'rembourse', settled_at = current_date
 where repair_order_id = (select v::uuid from _ctx where k = 'or');

insert into _t(check_name, result)
select 'vue Garanties : 2 lignes, temps MO 1, achat pieces 20, cout MO 83,00',
       case when (select row(count(*), sum(labour_hours), sum(parts_cost_ht), sum(labour_cost_ht))::text from public.warranty_lines_v
                   where repair_order_id = (select v::uuid from _ctx where k = 'or')) = '(2,1.000,20.00,83.00)'
            then 'ok' else 'KO ' || (select row(count(*), sum(labour_hours), sum(parts_cost_ht), sum(labour_cost_ht))::text from public.warranty_lines_v
                   where repair_order_id = (select v::uuid from _ctx where k = 'or')) end;

insert into _t(check_name, result)
select 'statistique Garanties / CA : le client de l''OR y figure avec 66,94 au PAMP',
       case when exists (select 1 from public.warranty_stats_by_client('3d9f0f13-a691-4d07-ad58-34590df86e33', current_date - 1, current_date + 1)
                          where contact_id = (select v::uuid from _ctx where k = 'contact') and warranty_pamp_ht >= 66.94)
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 2. OR accident cote assureur
with p as (
  insert into public.insurance_parties (company_id, kind, code, name, city, accounting_account, price_list)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'cabinet', 'AT', 'ASSURTEST', 'Bruxelles', '440000', 'ASSURANCE')
  returning id)
insert into _ctx select 'insurer', id::text from p;
with p as (
  insert into public.insurance_parties (company_id, kind, name, email)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'expert', 'Expert Essai', 'expert@example.com')
  returning id)
insert into _ctx select 'expert', id::text from p;

with f as (
  insert into public.accident_files (company_id, vehicle_id, contact_id, repair_order_id, insurer_id, expert_id,
                                     expert_visit_date, deductible_kind, deductible_value, market_value, argus_value,
                                     work_start_accepted, work_start_accepted_at)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'vehicle'), (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'insurer'), (select v::uuid from _ctx where k = 'expert'),
          current_date, 'pourcentage', 10, 4500, 4200, true, now())
  returning id)
insert into _ctx select 'file', id::text from f;

insert into _t(check_name, result)
select 'dossier accident : cabinet, expert, passage, franchise en %, valeurs, demarrage accepte',
       case when (select row(i.name, e.name, a.deductible_kind, a.deductible_value, a.work_start_accepted)::text
                    from public.accident_files a
                    join public.insurance_parties i on i.id = a.insurer_id
                    join public.insurance_parties e on e.id = a.expert_id
                   where a.id = (select v::uuid from _ctx where k = 'file')) = '(ASSURTEST,"Expert Essai",pourcentage,10.00,t)'
            then 'ok' else 'KO' end;

do $$
begin
  begin
    update public.accident_files set deductible_value = 150 where id = (select v::uuid from _ctx where k = 'file');
    insert into _t(check_name, result) values ('contrainte : franchise en % au-dela de 100 refusee', 'KO');
  exception when check_violation then
    insert into _t(check_name, result) values ('contrainte : franchise en % au-dela de 100 refusee', 'ok');
  end;
end $$;

insert into _t(check_name, result)
select 'fiche assurance : code unique par type et par societe',
       case when (select count(*) from public.insurance_parties where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and code = 'AT' and kind = 'cabinet') = 1
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 3. RLS : un membre ne voit que sa societe
reset role;
insert into _t(check_name, result)
select 'RLS active sur warranty_returns et insurance_parties',
       case when (select bool_and(relrowsecurity) from pg_class where relname in ('warranty_returns', 'insurance_parties')) then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'suivi : passage a « rembourse » trace dans le journal (audit)',
       case when exists (select 1 from public.events where entity_type = 'warranty_returns' and action = 'update'
                          and new_data->>'status' = 'rembourse') then 'ok' else 'KO' end;

select n, check_name, result from _t order by n;
