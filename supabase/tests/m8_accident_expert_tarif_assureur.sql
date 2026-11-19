-- =====================================================================
-- Lot accident-expert (19/11/2026) -- essai a blanc de 20261119200000_m8_accident_expert_et_tarif_assureur.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119200000_m8_accident_expert_et_tarif_assureur.sql \
--      supabase/tests/m8_accident_expert_tarif_assureur.sql; echo "rollback;") > t.sql
-- Prerequis en base : 20261103110000, 20261118130000, 20261118190000.
-- Scenario, administrateur simule d'ITALBIKE STORE :
--   Q51 : expert choisi depuis l'OR -> dossier a jour (et OR miroir), puis change depuis le dossier
--   -> OR a jour ; ecriture directe de l'OR -> dossier a jour (expert retrouve dans la table) ;
--   ecriture directe du dossier -> OR a jour ; trace events avec ancien / nouveau et origine
--   « OR » / « dossier » ; dossier cree apres l'OR -> reprend l'expert de l'OR ; expert d'un
--   autre type refuse ; non-membre refuse ; « Aucun » vide les deux cotes.
--   T4 : fiche cabinet avec un tarif (texte rattache au tarif de meme code) ; l'OR accident de ce
--   cabinet prend le tarif de l'assureur au lieu de celui du client ; sans tarif assureur, celui du
--   client ; lignes ecrites avec le prix du tarif assureur (calcule par l'ecran, moteur unique) et
--   tarif applique retenu sur l'OR.
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
insert into _ctx select 'p1', a.id::text from public.articles a
 where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.mgmt_type = 'A' order by a.reference limit 1;
-- Societe d'essai (annulee au rollback) : controle « meme societe » meme avec une seule societe en base.
with c as (insert into public.companies (code, name) values ('ESSAI-ACC', 'Societe essai accident') returning id)
insert into _ctx select 'other_company', id::text from c;

-- Un tarif de l'autre societe (pour le controle « meme societe »).
with l as (insert into public.price_lists (company_id, code) select v::uuid, 'ESSAI-AUTRE' from _ctx where k = 'other_company' returning id)
insert into _ctx select 'list_other', id::text from l;

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

-- Tarifs : celui du client (REMISE 10 %) et celui de l'assureur (REMISE 25 %), meme moteur.
with l as (insert into public.price_lists (company_id, code, label) values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-CLI', 'REMISE 10 % essai') returning id)
insert into _ctx select 'list_client', id::text from l;
with l as (insert into public.price_lists (company_id, code, label) values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-ASSU', 'TARIF ASSUREUR essai') returning id)
insert into _ctx select 'list_insurer', id::text from l;
insert into public.price_list_rules (company_id, price_list_id, scope, kind, tiers)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'list_client'), 'all', 'discount', '[{"min_qty":1,"value":10}]'),
       ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'list_insurer'), 'all', 'discount', '[{"min_qty":1,"value":25}]');
update public.contacts set price_list_id = (select v::uuid from _ctx where k = 'list_client')
 where id = (select v::uuid from _ctx where k = 'contact');

-- Fiche cabinet : le tarif ecrit en texte (comme repris de G8) est rattache au tarif de meme code.
with p as (
  insert into public.insurance_parties (company_id, kind, code, name, price_list)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'cabinet', 'ESSAI-AT', 'ASSURTEST essai', 'essai-assu')
  returning id)
insert into _ctx select 'insurer', id::text from p;
with p as (insert into public.insurance_parties (company_id, kind, name, email) values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'expert', 'Expert Essai A', 'a@example.com') returning id)
insert into _ctx select 'expert_a', id::text from p;
with p as (insert into public.insurance_parties (company_id, kind, name, email) values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'expert', 'Expert Essai B', 'b@example.com') returning id)
insert into _ctx select 'expert_b', id::text from p;

insert into _t(check_name, result)
select 'T4 fiche cabinet : le texte « essai-assu » est rattache au tarif ESSAI-ASSU',
       case when (select price_list_id from public.insurance_parties where id = (select v::uuid from _ctx where k = 'insurer'))
                 = (select v::uuid from _ctx where k = 'list_insurer') then 'ok' else 'KO' end;

-- OR accident et son dossier (cabinet choisi).
with o as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, repair_type)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'OR-ESSAI-ACC', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 20000, 'a_faire', 'accident')
  returning id)
insert into _ctx select 'or', id::text from o;
with f as (
  insert into public.accident_files (company_id, vehicle_id, contact_id, repair_order_id, insurer_id)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'vehicle'), (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'insurer'))
  returning id)
insert into _ctx select 'file', id::text from f;

-- ------------------------------------------------------------ 2. T4 : tarif de l'OR accident
insert into _t(check_name, result)
select 'T4 OR accident : le tarif de l''assureur l''emporte sur celui du client',
       case when (select row(source, code)::text from public.repair_order_price_list((select v::uuid from _ctx where k = 'or')))
                 = '(assureur,ESSAI-ASSU)' then 'ok' else 'KO' end;

-- Lignes ecrites avec le prix du tarif assureur (pose par l'ecran : 100 € catalogue, remise 25 %),
-- tarif applique retenu sur l'OR.
select public.repair_order_write_lines((select v::uuid from _ctx where k = 'or'), jsonb_build_array(
  jsonb_build_object('kind', 'piece', 'article_id', (select v from _ctx where k = 'p1'), 'designation', 'Carenage',
                     'quantity', 1, 'unit_price_ht', 100, 'discount_pct', 25, 'vat_rate', 21, 'line_ht', 75, 'line_ttc', 90.75),
  jsonb_build_object('kind', 'mo', 'designation', 'Main-d''oeuvre carrosserie', 'quantity', 2, 'unit_price_ht', 109.74,
                     'discount_pct', 25, 'vat_rate', 21, 'line_ht', 164.61, 'line_ttc', 199.18)
));
update public.repair_orders set insurer_price_list_id = (select v::uuid from _ctx where k = 'list_insurer')
 where id = (select v::uuid from _ctx where k = 'or');

insert into _t(check_name, result)
select 'T4 prix des lignes : pieces et MO a la remise de l''assureur (25 %), tarif retenu sur l''OR',
       case when (select count(*) from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or') and discount_pct = 25) = 2
             and (select sum(line_ht) from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or')) = 239.61
             and (select insurer_price_list_id from public.repair_orders where id = (select v::uuid from _ctx where k = 'or'))
                 = (select v::uuid from _ctx where k = 'list_insurer')
            then 'ok' else 'KO' end;

-- Tarif retire de la fiche cabinet : l'OR retombe sur le tarif du client.
update public.insurance_parties set price_list_id = null where id = (select v::uuid from _ctx where k = 'insurer');
insert into _t(check_name, result)
select 'T4 cabinet sans tarif : l''OR prend le tarif du client (texte efface, tarif non remis)',
       case when (select row(source, code)::text from public.repair_order_price_list((select v::uuid from _ctx where k = 'or'))) = '(client,ESSAI-CLI)'
             and (select price_list from public.insurance_parties where id = (select v::uuid from _ctx where k = 'insurer')) is null
            then 'ok' else 'KO' end;
update public.insurance_parties set price_list_id = (select v::uuid from _ctx where k = 'list_insurer') where id = (select v::uuid from _ctx where k = 'insurer');
insert into _t(check_name, result)
select 'T4 tarif choisi a l''ecran : le code s''affiche sur la fiche',
       case when (select price_list from public.insurance_parties where id = (select v::uuid from _ctx where k = 'insurer')) = 'ESSAI-ASSU'
            then 'ok' else 'KO' end;

do $$
begin
  begin
    update public.insurance_parties set price_list_id = (select v::uuid from _ctx where k = 'list_other')
     where id = (select v::uuid from _ctx where k = 'insurer');
    insert into _t(check_name, result) values ('T4 tarif d''une autre societe refuse', 'KO');
  exception when check_violation then
    insert into _t(check_name, result) values ('T4 tarif d''une autre societe refuse', 'ok');
  end;
end $$;

-- ------------------------------------------------------------ 3. Q51 : expert des deux cotes
-- a. Depuis l'OR : expert A, passage le 20/11.
select public.accident_file_set_expert((select v::uuid from _ctx where k = 'file'), (select v::uuid from _ctx where k = 'expert_a'), date '2026-11-20', 'OR');
insert into _t(check_name, result)
select 'Q51 expert choisi depuis l''OR : dossier a jour (fiche, nom, e-mail, passage) et OR miroir',
       case when (select row(expert_id::text, expert_name, expert_email, expert_visit_date)::text from public.accident_files where id = (select v::uuid from _ctx where k = 'file'))
                 = row((select v from _ctx where k = 'expert_a'), 'Expert Essai A', 'a@example.com', date '2026-11-20')::text
             and (select row(expert_name, expert_date)::text from public.repair_orders where id = (select v::uuid from _ctx where k = 'or'))
                 = '("Expert Essai A",2026-11-20)'
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'Q51 trace : origine « OR », ancien vide, nouveau expert A',
       case when exists (select 1 from public.events where action = 'accident_expert_change' and entity_id = (select v from _ctx where k = 'file')
                           and origin = 'OR' and old_data->>'expert_id' is null and new_data->>'expert_id' = (select v from _ctx where k = 'expert_a'))
            then 'ok' else 'KO' end;

-- b. Depuis le dossier : expert B, passage le 22/11.
select public.accident_file_set_expert((select v::uuid from _ctx where k = 'file'), (select v::uuid from _ctx where k = 'expert_b'), date '2026-11-22', 'dossier');
insert into _t(check_name, result)
select 'Q51 expert change depuis le dossier : OR a jour',
       case when (select row(expert_name, expert_date)::text from public.repair_orders where id = (select v::uuid from _ctx where k = 'or'))
                 = '("Expert Essai B",2026-11-22)' then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'Q51 trace : origine « dossier », ancien A (20/11), nouveau B (22/11)',
       case when exists (select 1 from public.events where action = 'accident_expert_change' and entity_id = (select v from _ctx where k = 'file')
                           and origin = 'dossier' and old_data->>'expert_name' = 'Expert Essai A' and old_data->>'expert_visit_date' = '2026-11-20'
                           and new_data->>'expert_name' = 'Expert Essai B' and new_data->>'expert_visit_date' = '2026-11-22')
            then 'ok' else 'KO' end;

-- c. Ecriture directe de l'OR (ancien chemin) : le dossier suit, l'expert est retrouve dans la table.
update public.repair_orders set expert_name = 'expert essai a', expert_date = date '2026-11-25'
 where id = (select v::uuid from _ctx where k = 'or');
insert into _t(check_name, result)
select 'Q51 OR modifie directement : dossier a jour (fiche A retrouvee, passage 25/11), nom de l''OR normalise',
       case when (select row(expert_id::text, expert_visit_date)::text from public.accident_files where id = (select v::uuid from _ctx where k = 'file'))
                 = row((select v from _ctx where k = 'expert_a'), date '2026-11-25')::text
             and (select expert_name from public.repair_orders where id = (select v::uuid from _ctx where k = 'or')) = 'Expert Essai A'
             and exists (select 1 from public.events where action = 'accident_expert_change' and entity_id = (select v from _ctx where k = 'file')
                           and origin = 'OR' and new_data->>'expert_visit_date' = '2026-11-25')
            then 'ok' else 'KO' end;

-- d. Ecriture directe du dossier : l'OR suit.
update public.accident_files set expert_visit_date = date '2026-11-26' where id = (select v::uuid from _ctx where k = 'file');
insert into _t(check_name, result)
select 'Q51 dossier modifie directement : OR a jour, trace origine « dossier »',
       case when (select expert_date from public.repair_orders where id = (select v::uuid from _ctx where k = 'or')) = date '2026-11-26'
             and exists (select 1 from public.events where action = 'accident_expert_change' and entity_id = (select v from _ctx where k = 'file')
                           and origin = 'dossier' and new_data->>'expert_visit_date' = '2026-11-26')
            then 'ok' else 'KO' end;

-- e. Un cabinet n'est pas un expert.
do $$
begin
  begin
    perform public.accident_file_set_expert((select v::uuid from _ctx where k = 'file'), (select v::uuid from _ctx where k = 'insurer'), null, 'OR');
    insert into _t(check_name, result) values ('Q51 controle : une fiche cabinet choisie comme expert est refusee', 'KO');
  exception when check_violation then
    insert into _t(check_name, result) values ('Q51 controle : une fiche cabinet choisie comme expert est refusee', 'ok');
  end;
end $$;

-- f. Dossier cree apres l'OR : il reprend l'expert et la date de l'OR.
with o as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, repair_type, expert_name, expert_date)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'OR-ESSAI-ACC2', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 20000, 'a_faire', 'accident', 'Expert Essai B', date '2026-11-28')
  returning id)
insert into _ctx select 'or2', id::text from o;
with f as (
  insert into public.accident_files (company_id, vehicle_id, contact_id, repair_order_id)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'vehicle'), (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'or2'))
  returning id)
insert into _ctx select 'file2', id::text from f;
insert into _t(check_name, result)
select 'Q51 dossier ouvert apres l''OR : expert B (fiche retrouvee) et passage 28/11 repris',
       case when (select row(expert_id::text, expert_visit_date)::text from public.accident_files where id = (select v::uuid from _ctx where k = 'file2'))
                 = row((select v from _ctx where k = 'expert_b'), date '2026-11-28')::text then 'ok' else 'KO' end;

-- g. « Aucun » depuis l'OR : les deux cotes sont vides.
select public.accident_file_set_expert((select v::uuid from _ctx where k = 'file'), null, null, 'OR');
insert into _t(check_name, result)
select 'Q51 expert retire (Aucun) : dossier et OR vides',
       case when (select row(expert_id, expert_name, expert_visit_date)::text from public.accident_files where id = (select v::uuid from _ctx where k = 'file')) = '(,,)'
             and (select row(expert_name, expert_date)::text from public.repair_orders where id = (select v::uuid from _ctx where k = 'or')) = '(,)'
            then 'ok' else 'KO' end;

-- h. Utilisateur qui n'est pas membre de la societe : refuse.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.accident_file_set_expert((select v::uuid from _ctx where k = 'file'), null, null, 'OR');
    insert into _t(check_name, result) values ('Q51 non-membre : saisie refusee', 'KO');
  exception when insufficient_privilege or no_data_found or sqlstate 'P0002' then
    insert into _t(check_name, result) values ('Q51 non-membre : saisie refusee', 'ok');
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);

do $$
begin
  begin
    perform public.accident_file_set_expert((select v::uuid from _ctx where k = 'file'), null, null, 'API');
    insert into _t(check_name, result) values ('Q51 origine inconnue refusee', 'KO');
  exception when invalid_parameter_value then
    insert into _t(check_name, result) values ('Q51 origine inconnue refusee', 'ok');
  end;
end $$;

reset role;
select n, check_name, result from _t order by n;
