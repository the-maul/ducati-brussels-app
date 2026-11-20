-- =====================================================================
-- Rattrapage G8 (18/11/2026) -- essai a blanc de la migration 20261118240000_m7_cessions_internes.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118240000_m7_cessions_internes.sql \
--      supabase/tests/m7_cessions_internes.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Scenario, administrateur simule d'ITALBIKE STORE, donnees d'essai creees dans la transaction :
--   piece d'essai recue 2 fois (1,00 puis 0,50 : PAMP 0,75, dernier PA 0,50), moto reprise a
--   5 000 EUR, article de MO a cout 28,20. Cession VO au PAMP : 1 piece + 1 h interne = 28,95,
--   prix de revient 5 000 -> 5 028,95 (le parcours G8 n° 10). Bascule au dernier PA : 28,70.
--   Validation : sortie de stock, historique append-only, document fige. Reprise validee ->
--   cession VO ouverte d'office ; moto vendue -> cessions archivees ; desarchiver.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');
-- Reglage de depart connu (PAMP, archivage et ouverture auto actives)
update public.reference_values set label = 'pamp'
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and table_key = 'cession_settings' and code = 'cost_basis';
-- Type 03 « Besoin atelier » non comptabilise (valeur G8 d'origine) : en production ce reglage est
-- modifiable par le client (il y vaut actuellement « comptabilisee »), le test pose donc sa valeur.
update public.reference_values set extra = extra || '{"accounted":false}'::jsonb
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and table_key = 'cession_type' and code = '03';

with a as (
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ttc, vat_rate, category_path)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-CES-PIECE', 'Piece essai cession', 'A', 0.50, 0, 2.11, 21, '03-01-01')
  returning id)
insert into _ctx select 'piece', id::text from a;
with a as (
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ttc, vat_rate)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-CES-MO', 'MO atelier essai', 'T', 28.20, 28.20, 76.80, 21)
  returning id)
insert into _ctx select 'mo', id::text from a;
with v as (
  insert into public.vehicles (company_id, vin, brand, model, status, purchase_price, cost_price, display_price)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ZDMESSAICESSION01', 'Ducati', 'Monster essai', 'stock_vo', 5000, 5000, 5000)
  returning id)
insert into _ctx select 'vehicle', id::text from v;
with v as (
  insert into public.vehicles (company_id, vin, brand, model, status, purchase_price, cost_price)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ZDMESSAICESSION02', 'Ducati', 'Scrambler essai', 'repris', 4000, 4000)
  returning id)
insert into _ctx select 'reprise', id::text from v;

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

-- Deux receptions : 4 a 1,00 puis 4 a 0,50 -> PAMP 0,75, dernier PA 0,50.
select public.record_stock_move((select v::uuid from _ctx where k = 'piece'), 'entree', 4, 1.00, false, null, 'reception', 'ESSAI-REC-1', null);
select public.record_stock_move((select v::uuid from _ctx where k = 'piece'), 'entree', 4, 0.50, false, null, 'reception', 'ESSAI-REC-2', null);
insert into _t(check_name, result)
select 'preparation : PAMP 0,75 et dernier prix d''achat 0,50',
       case when (select pamp from public.articles where id = (select v::uuid from _ctx where k = 'piece')) = 0.75
             and public.article_last_purchase_price((select v::uuid from _ctx where k = 'piece')) = 0.50
            then 'ok' else 'KO' end;

-- Cession VO sur la moto, valorisee au PAMP (reglage par defaut).
insert into _ctx select 'ces', public.open_internal_cession('3d9f0f13-a691-4d07-ad58-34590df86e33', '01',
  (select v::uuid from _ctx where k = 'vehicle'), null, 'Chef atelier', 'Remise en etat')::text;
insert into _t(check_name, result)
select 'ouverture : numero au compteur des OR (VP7, comme G8), type « Cession VO » comptabilisee, valorisation PAMP, statut ouvert',
       case when c.number like (select prefix from public.document_sequences where company_id = c.company_id and doc_type = 'OR') || '%' and c.type_label = 'Cession VO' and c.accounted and c.cost_basis = 'pamp' and c.status = 'ouvert'
            then 'ok' else 'KO ' || coalesce(c.number, '') || ' ' || coalesce(c.cost_basis, '') end
  from public.internal_cessions c where c.id = (select v::uuid from _ctx where k = 'ces');

select public.add_internal_cession_line((select v::uuid from _ctx where k = 'ces'), 'piece', (select v::uuid from _ctx where k = 'piece'), null, 1);
select public.add_internal_cession_line((select v::uuid from _ctx where k = 'ces'), 'mo', (select v::uuid from _ctx where k = 'mo'), 'Remise en etat',
  1, 1.5, 'd9409378-a554-4cb2-97d6-e0b84aba204e', 'Jeremy');
insert into _t(check_name, result)
select 'lignes au PAMP : piece 0,75 + MO 1 h interne 28,20 = 28,95, TVA 0, heures passees 1,5 notees',
       case when (select sum(line_cost) from public.internal_cession_lines where cession_id = (select v::uuid from _ctx where k = 'ces')) = 28.95
             and (select bool_and(vat_rate = 0) from public.internal_cession_lines where cession_id = (select v::uuid from _ctx where k = 'ces'))
             and (select hours_spent from public.internal_cession_lines where cession_id = (select v::uuid from _ctx where k = 'ces') and kind = 'mo') = 1.5
            then 'ok' else 'KO ' || (select sum(line_cost)::text from public.internal_cession_lines where cession_id = (select v::uuid from _ctx where k = 'ces')) end;

-- Bascule au dernier prix d'achat puis retour au PAMP.
select public.set_internal_cession_cost_basis((select v::uuid from _ctx where k = 'ces'), 'pa');
insert into _t(check_name, result)
select 'dernier PA : piece 0,50 + MO 28,20 = 28,70',
       case when (select sum(line_cost) from public.internal_cession_lines where cession_id = (select v::uuid from _ctx where k = 'ces')) = 28.70
            then 'ok' else 'KO ' || (select sum(line_cost)::text from public.internal_cession_lines where cession_id = (select v::uuid from _ctx where k = 'ces')) end;
select public.set_internal_cession_cost_basis((select v::uuid from _ctx where k = 'ces'), 'pamp');

-- Garde-fous : statut et totaux ne s'ecrivent pas a la main.
do $$ begin
  update public.internal_cessions set status = 'valide' where id = (select v::uuid from _ctx where k = 'ces');
  insert into _t(check_name, result) values ('garde-fou : statut non modifiable a la main', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('garde-fou : statut non modifiable a la main', 'ok');
end $$;

-- Fenetre prix de revient avant validation.
insert into _t(check_name, result)
select 'fenetre : prix d''achat 5 000, cession actuelle 28,95, autres cessions 0',
       case when (x->>'purchase_price')::numeric = 5000 and (x->>'current_cost')::numeric = 28.95
             and (x->>'other_cessions')::numeric = 0 and (x->>'accounted')::boolean
            then 'ok' else 'KO ' || x::text end
  from (select public.internal_cession_cost_context((select v::uuid from _ctx where k = 'ces')) as x) s;

-- Validation.
insert into _ctx select 'stock_before', real_qty::text from public.article_stock((select v::uuid from _ctx where k = 'piece'));
insert into _ctx select 'val', public.validate_internal_cession((select v::uuid from _ctx where k = 'ces'), 0)::text;
insert into _t(check_name, result)
select 'validation : prix de revient 5 000 -> 5 028,95 (parcours G8 n° 10)',
       case when (select cost_price from public.vehicles where id = (select v::uuid from _ctx where k = 'vehicle')) = 5028.95
             and ((select v from _ctx where k = 'val')::jsonb->>'cost_before')::numeric = 5000
             and ((select v from _ctx where k = 'val')::jsonb->>'cost_after')::numeric = 5028.95
            then 'ok' else 'KO ' || (select v from _ctx where k = 'val') end;
insert into _t(check_name, result)
select 'B7 : la piece sort du stock (8 -> 7) par un mouvement « cession » au n° de la cession',
       case when (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'piece'))) = (select v::numeric from _ctx where k = 'stock_before') - 1
             and exists (select 1 from public.stock_moves m join public.internal_cessions c on c.number = m.ref
                          where m.article_id = (select v::uuid from _ctx where k = 'piece') and m.move_type = 'cession'
                            and m.origin = 'cession' and c.id = (select v::uuid from _ctx where k = 'ces'))
             and not exists (select 1 from public.stock_moves where article_id = (select v::uuid from _ctx where k = 'mo'))
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'B3 : historique append-only du cout de revient (5 000 -> 5 028,95) + event',
       case when exists (select 1 from public.vehicle_cost_changes h
                          where h.vehicle_id = (select v::uuid from _ctx where k = 'vehicle') and h.source = 'cession'
                            and h.old_cost = 5000 and h.new_cost = 5028.95 and h.delta = 28.95)
             and exists (select 1 from public.events e where e.action = 'cession_validee'
                          and e.entity_id = (select v from _ctx where k = 'ces'))
            then 'ok' else 'KO' end;
do $$ begin
  delete from public.vehicle_cost_changes where vehicle_id = (select v::uuid from _ctx where k = 'vehicle');
  insert into _t(check_name, result) values ('append-only : historique du cout non effacable', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('append-only : historique du cout non effacable', 'ok');
end $$;
do $$ begin
  insert into public.internal_cession_lines (cession_id, company_id, kind, designation, quantity, unit_cost)
  values ((select v::uuid from _ctx where k = 'ces'), '3d9f0f13-a691-4d07-ad58-34590df86e33', 'frais', 'Ajout tardif', 1, 10);
  insert into _t(check_name, result) values ('document fige : plus de ligne apres validation', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('document fige : plus de ligne apres validation', 'ok');
end $$;

-- Deuxieme cession (frais, au dernier PA) : « autres cessions » = 28,95 dans la fenetre.
insert into _ctx select 'ces2', public.open_internal_cession('3d9f0f13-a691-4d07-ad58-34590df86e33', '01',
  (select v::uuid from _ctx where k = 'vehicle'), null, null, 'Pneus', 'pa')::text;
select public.add_internal_cession_line((select v::uuid from _ctx where k = 'ces2'), 'frais', null, 'Transport', 1, null, null, null, 50);
insert into _t(check_name, result)
select 'deuxieme cession : valorisation PA choisie, autres cessions 28,95',
       case when (select cost_basis from public.internal_cessions where id = (select v::uuid from _ctx where k = 'ces2')) = 'pa'
             and (public.internal_cession_cost_context((select v::uuid from _ctx where k = 'ces2'))->>'other_cessions')::numeric = 28.95
            then 'ok' else 'KO' end;
select public.validate_internal_cession((select v::uuid from _ctx where k = 'ces2'), 100);
insert into _t(check_name, result)
select 'options : 5 028,95 + 50 + 100 d''options = 5 178,95',
       case when (select cost_price from public.vehicles where id = (select v::uuid from _ctx where k = 'vehicle')) = 5178.95
            then 'ok' else 'KO ' || (select cost_price::text from public.vehicles where id = (select v::uuid from _ctx where k = 'vehicle')) end;

-- Cession non comptabilisee (03 Besoin atelier) : aucun effet sur le cout de revient.
insert into _ctx select 'ces3', public.open_internal_cession('3d9f0f13-a691-4d07-ad58-34590df86e33', '03',
  (select v::uuid from _ctx where k = 'vehicle'))::text;
select public.add_internal_cession_line((select v::uuid from _ctx where k = 'ces3'), 'piece', (select v::uuid from _ctx where k = 'piece'), null, 2);
select public.validate_internal_cession((select v::uuid from _ctx where k = 'ces3'));
insert into _t(check_name, result)
select 'non comptabilisee : stock sorti, cout de revient inchange',
       case when (select cost_price from public.vehicles where id = (select v::uuid from _ctx where k = 'vehicle')) = 5178.95
             and (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'piece'))) = (select v::numeric from _ctx where k = 'stock_before') - 3
            then 'ok' else 'KO' end;

-- Liste par periode.
insert into _t(check_name, result)
select 'liste detaillee : 4 lignes chiffrees, montants PAMP et PV HT',
       case when count(*) = 4 and sum(amount_pamp) filter (where reference = 'ESSAI-CES-PIECE') = 2.25
             and sum(amount_sale_ht) filter (where reference = 'ESSAI-CES-PIECE') > 0
            then 'ok' else 'KO ' || count(*)::text end
  from public.internal_cession_report('3d9f0f13-a691-4d07-ad58-34590df86e33', current_date, current_date)
 where vin = 'ZDMESSAICESSION01';

-- Reprise validee (repris -> stock_vo) : cession VO ouverte d'office.
update public.vehicles set status = 'stock_vo' where id = (select v::uuid from _ctx where k = 'reprise');
insert into _t(check_name, result)
select 'reprise validee : cession VO ouverte automatiquement (origine reprise)',
       case when exists (select 1 from public.internal_cessions where vehicle_id = (select v::uuid from _ctx where k = 'reprise')
                          and origin = 'reprise' and cession_type = '01' and status = 'ouvert')
            then 'ok' else 'KO ' || coalesce((select new_data::text from public.events where action = 'cession_auto_echec'
                                               and entity_id = (select v from _ctx where k = 'reprise') limit 1), '') end;

-- Anciennes lignes d'ORO de la reprise : toujours comptees ; une ecriture directe du prix d'achat
-- (validation de reprise : cost_price = prix de reprise) est recalculee avec l'ORO et les cessions.
with o as (
  insert into public.oro (company_id, number, vehicle_id) values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'REP-ESSAI', (select v::uuid from _ctx where k = 'reprise'))
  returning id)
insert into _ctx select 'oro', id::text from o;
insert into public.oro_lines (oro_id, kind, designation, quantity, unit_cost, line_cost)
values ((select v::uuid from _ctx where k = 'oro'), 'frais', 'Ancienne ligne', 1, 100, 100);
select public.recompute_oro_and_vehicle((select v::uuid from _ctx where k = 'oro'));
update public.vehicles set purchase_price = 4200, cost_price = 4200 where id = (select v::uuid from _ctx where k = 'reprise');
insert into _t(check_name, result)
select 'ancien ORO compte (4 000 + 100), prix d''achat reecrit 4 200 -> cout recalcule 4 300',
       case when (select cost_price from public.vehicles where id = (select v::uuid from _ctx where k = 'reprise')) = 4300
             and exists (select 1 from public.vehicle_cost_changes where vehicle_id = (select v::uuid from _ctx where k = 'reprise') and source = 'oro' and new_cost = 4100)
            then 'ok' else 'KO ' || (select cost_price::text from public.vehicles where id = (select v::uuid from _ctx where k = 'reprise')) end;

-- Moto vendue : cessions archivees ; desarchiver rend le statut precedent.
update public.vehicles set status = 'vendu' where id = (select v::uuid from _ctx where k = 'vehicle');
insert into _t(check_name, result)
select 'vente : les 3 cessions de la moto sont archivees (motif vente), cout inchange',
       case when (select count(*) from public.internal_cessions where vehicle_id = (select v::uuid from _ctx where k = 'vehicle')
                   and status = 'archive' and archive_reason = 'vente') = 3
             and (select cost_price from public.vehicles where id = (select v::uuid from _ctx where k = 'vehicle')) = 5178.95
            then 'ok' else 'KO' end;
select public.unarchive_internal_cession((select v::uuid from _ctx where k = 'ces'));
insert into _t(check_name, result)
select 'desarchiver : la cession revient « validee »',
       case when (select status from public.internal_cessions where id = (select v::uuid from _ctx where k = 'ces')) = 'valide'
            then 'ok' else 'KO' end;

-- Annulation d'une cession ouverte.
insert into _ctx select 'ces4', public.open_internal_cession('3d9f0f13-a691-4d07-ad58-34590df86e33', '07', null)::text;
select public.cancel_internal_cession((select v::uuid from _ctx where k = 'ces4'));
insert into _t(check_name, result)
select 'annulation : cession ouverte annulee, numero conserve',
       case when (select status from public.internal_cessions where id = (select v::uuid from _ctx where k = 'ces4')) = 'annule'
             and (select number from public.internal_cessions where id = (select v::uuid from _ctx where k = 'ces4')) is not null
            then 'ok' else 'KO' end;

reset role;
select n, check_name, result from _t order by n;
