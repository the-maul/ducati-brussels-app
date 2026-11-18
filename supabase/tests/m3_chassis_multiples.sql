-- =====================================================================
-- Rattrapage G8 (18/11/2026, lot parc) -- essai a blanc de 20261118140000_m3_chassis_multiples_par_modele.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118140000_m3_chassis_multiples_par_modele.sql \
--      supabase/tests/m3_chassis_multiples.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Scenario (societe ITALBIKE STORE, proprietaire de la base) :
--   modele V « ESSAI-DESERTX » -> 2 chassis recus -> stock du modele 2, 2 fiches moto, pas de
--   « moto unique » sur le modele ; un VIN en double est refuse ; une occasion O ne porte pas
--   2 motos ; facture avec la moto choisie -> CE chassis vendu, l'autre reste en stock, stock 1 ;
--   2e vente sans moto choisie -> le plus ancien chassis en stock ; controle de coherence muet.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;

insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');

with a as (
  insert into public.articles (company_id, reference, designation, brand, mgmt_type, purchase_price, sale_price_ttc, vat_rate)
  values ((select v::uuid from _ctx where k = 'company'), 'ESSAI-DESERTX-' || to_char(now(), 'HH24MISS'),
          'DESERT X essai', 'DUCATI', 'V', 12000, 16590, 21)
  returning id)
insert into _ctx select 'model', id::text from a;

-- 1. deux chassis du meme modele
insert into _ctx select 'ch1', public.vehicle_chassis_receive((select v::uuid from _ctx where k = 'model'),
  jsonb_build_object('vin', 'ZDMESSAICHASSIS01', 'color', 'BLANC'), 12000, 'reception', 'REC-ESSAI', null)::text;
insert into _ctx select 'ch2', public.vehicle_chassis_receive((select v::uuid from _ctx where k = 'model'),
  jsonb_build_object('vin', 'zdm-essai-chassis-02', 'color', 'ROUGE'), 12500, 'reception', 'REC-ESSAI', null)::text;

insert into _t(check_name, result)
select '2 chassis recus sur le meme modele : 2 fiches moto liees, stock du modele 2',
       case when (select count(*) from public.vehicles where article_id = (select v::uuid from _ctx where k = 'model')) = 2
             and (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'model'))) = 2
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'VIN normalise (ZDMESSAICHASSIS02), statut stock neuf, date d''entree, PA du chassis',
       case when vin = 'ZDMESSAICHASSIS02' and status::text = 'stock_vn' and entry_date = current_date and purchase_price = 12500
            then 'ok' else 'KO ' || coalesce(vin, '?') end
  from public.vehicles where id = (select v::uuid from _ctx where k = 'ch2');

insert into _t(check_name, result)
select 'modele a plusieurs chassis : pas de « moto unique » (articles.vehicle_id vide)',
       case when (select vehicle_id from public.articles where id = (select v::uuid from _ctx where k = 'model')) is null
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'PAMP du modele recalcule sur les 2 entrees (12 250)',
       case when (select pamp from public.articles where id = (select v::uuid from _ctx where k = 'model')) = 12250
            then 'ok' else 'KO ' || (select pamp::text from public.articles where id = (select v::uuid from _ctx where k = 'model')) end;

-- 2. VIN deja present : refuse, rien n'est ecrit
do $$
begin
  perform public.vehicle_chassis_receive((select v::uuid from _ctx where k = 'model'),
    jsonb_build_object('vin', 'ZDMESSAICHASSIS01'), 12000, 'reception', 'REC-ESSAI', null);
  insert into _t(check_name, result) values ('VIN en double refuse', 'KO : accepte');
exception when others then
  insert into _t(check_name, result) values ('VIN en double refuse',
    case when sqlerrm like 'VIN_EXISTS%' then 'ok' else 'KO ' || sqlerrm end);
end $$;
insert into _t(check_name, result)
select 'apres le refus : toujours 2 en stock',
       case when (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'model'))) = 2 then 'ok' else 'KO' end;

-- 3. une occasion O ne porte jamais deux motos
with a as (
  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate)
  values ((select v::uuid from _ctx where k = 'company'), 'ESSAI-OCC-' || to_char(now(), 'HH24MISS'), 'Occasion essai', 'O', 0)
  returning id)
insert into _ctx select 'occ', id::text from a;
insert into public.vehicles (company_id, article_id, vin, status)
values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'occ'), 'ZDMESSAIOCCASI01', 'stock_vo');
do $$
begin
  insert into public.vehicles (company_id, article_id, vin, status)
  values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'occ'), 'ZDMESSAIOCCASI02', 'stock_vo');
  insert into _t(check_name, result) values ('occasion O : 2e moto sur le meme article refusee', 'KO : acceptee');
exception when others then
  insert into _t(check_name, result) values ('occasion O : 2e moto sur le meme article refusee',
    case when sqlstate = '23505' then 'ok' else 'KO ' || sqlerrm end);
end $$;
insert into _t(check_name, result)
select 'occasion O a une moto : articles.vehicle_id renseigne',
       case when (select vehicle_id from public.articles where id = (select v::uuid from _ctx where k = 'occ')) is not null
            then 'ok' else 'KO' end;

-- 4. vente avec la moto choisie (le 2e chassis, recu en dernier)
with c as (select id from public.contacts where company_id = (select v::uuid from _ctx where k = 'company')
            and type <> 'fournisseur' order by created_at limit 1)
insert into _ctx select 'contact', id::text from c;
with d as (
  insert into public.documents (company_id, doc_type, number, contact_id, vehicle_id, status)
  values ((select v::uuid from _ctx where k = 'company'), 'FAC', 'FAC-ESSAI-CH-1', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'ch2'), 'validee')
  returning id)
insert into _ctx select 'doc1', id::text from d;
select public.record_stock_move((select v::uuid from _ctx where k = 'model'), 'sortie'::public.stock_move_type, -1, null, false,
                                null, 'sale', 'FAC-ESSAI-CH-1', 'essai');

insert into _t(check_name, result)
select 'vente : le chassis choisi sur la facture est vendu, l''autre reste en stock, stock 1',
       case when (select status::text from public.vehicles where id = (select v::uuid from _ctx where k = 'ch2')) = 'vendu'
             and (select status::text from public.vehicles where id = (select v::uuid from _ctx where k = 'ch1')) = 'stock_vn'
             and (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'model'))) = 1
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'vente : l''acheteur devient proprietaire du chassis vendu',
       case when exists (select 1 from public.vehicle_owners where vehicle_id = (select v::uuid from _ctx where k = 'ch2')
                          and contact_id = (select v::uuid from _ctx where k = 'contact') and is_current)
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'vente : le chassis encore en stock n''est jamais detache du modele',
       case when (select article_id from public.vehicles where id = (select v::uuid from _ctx where k = 'ch1'))
                 = (select v::uuid from _ctx where k = 'model') then 'ok' else 'KO' end;

-- 5. controle de coherence : stock du modele = chassis en stock
insert into _t(check_name, result)
select 'controle de coherence : rien a signaler sur le modele d''essai',
       case when not exists (select 1 from public.vehicles_parc_check((select v::uuid from _ctx where k = 'company')) c
                              where c.detail like '%' || (select reference from public.articles where id = (select v::uuid from _ctx where k = 'model')) || '%')
            then 'ok' else 'KO' end;

-- 6. vente sans moto choisie : le plus ancien chassis en stock (ici le dernier)
insert into public.documents (company_id, doc_type, number, contact_id, status)
values ((select v::uuid from _ctx where k = 'company'), 'FAC', 'FAC-ESSAI-CH-2', (select v::uuid from _ctx where k = 'contact'), 'validee');
select public.record_stock_move((select v::uuid from _ctx where k = 'model'), 'sortie'::public.stock_move_type, -1, null, false,
                                null, 'sale', 'FAC-ESSAI-CH-2', 'essai');
insert into _t(check_name, result)
select 'vente sans moto choisie : plus ancien chassis en stock vendu, trace « moto_chassis_choisi_auto »',
       case when (select status::text from public.vehicles where id = (select v::uuid from _ctx where k = 'ch1')) = 'vendu'
             and exists (select 1 from public.events where action = 'moto_chassis_choisi_auto'
                          and entity_id = (select v from _ctx where k = 'ch1'))
             and (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'model'))) = 0
            then 'ok' else 'KO' end;

select n, check_name, result from _t order by n;
