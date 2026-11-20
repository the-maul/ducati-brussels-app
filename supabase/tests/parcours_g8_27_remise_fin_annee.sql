-- =====================================================================
-- Parcours G8 n° 27 — Remise de fin d'année fournisseur (RFA) (lot-verif-parcours, 20/11/2026)
-- G8 : Fichiers › Fournisseurs › Remise fin d'année → liste (N° remise · Libellé · Montant ·
--      Fournisseur · Date, filtre date début / fin) → Nouveau → fournisseur → famille (rayon /
--      sous-rayon / catégorie) → « Gestion des remises fin d'année » : remise, libellé, date,
--      montant RFA ; Modifier · Imprimer · Supprimer. (Relevé le 18/11, non enregistré dans G8.)
-- DMS : fonction PRÉSENTE. Achats › Liste des documents › onglet « Remises fin d'année » et fiche
--      fournisseur › onglet du même nom (supplier-tabs.tsx, YearEndRebatesPanel) : écriture directe
--      dans la table supplier_year_end_rebates (RLS rfa_all, audit trg_rfa_audit → events) :
--      saveYearEndRebate (insert / update), deleteYearEndRebate, listYearEndRebates (tri par date).
--      Famille = family_code « rayon[-sous-rayon[-catégorie]] » (vide = toutes les familles).
-- Contrôles :
--   1. nouvelle RFA : fournisseur + rayon › sous-rayon › catégorie + libellé + 2 % + 150 € + date
--   2. RFA « toutes familles » (famille vide) acceptée
--   3. liste du fournisseur (tri date décroissante) et total 150 + 80 = 230
--   4. modification 150 → 175 : tracée (events, ancien / nouveau), date de modification
--   5. fournisseur d'une autre société refusé (RLS)
--   6. suppression tracée (events)
--   7. MANQUE (documenté, non bloquant) : n° de remise, filtre date début / fin, impression
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _c(k text primary key, v text) on commit drop;
grant all on _t, _c to authenticated; grant usage on sequence _t_n_seq to authenticated;
-- un fournisseur d'une autre société (lecture seule, pour le contrôle de RLS)
insert into _c select 'other_sup', id::text from public.contacts
 where type = 'fournisseur' and company_id <> '5593d97e-69ad-43dd-8237-4ab8aa4e5c08' limit 1;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co  uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _me  uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _sup uuid; _r1 uuid; _r2 uuid; _ok boolean; _msg text; _list uuid[];
begin
  insert into public.contacts (company_id, type, company_name)
  values (_co, 'fournisseur', 'ESSAI PARCOURS 27 FOURNISSEUR') returning id into _sup;

  -- 1. Nouvelle RFA (saveYearEndRebate sans id = insert)
  insert into public.supplier_year_end_rebates (company_id, supplier_id, family_code, label, rebate_pct, amount, rebate_date, note)
  values (_co, _sup, '02-01-99', 'RFA 2026 casques', 2, 150, date '2026-11-20', null) returning id into _r1;
  insert into _t(check_name, result) values ('nouvelle RFA : fournisseur, rayon › sous-rayon › categorie (02-01-99), 2 %, 150 €, date, auteur',
    case when exists (select 1 from public.supplier_year_end_rebates where id = _r1 and supplier_id = _sup and family_code = '02-01-99'
                        and rebate_pct = 2 and amount = 150 and rebate_date = date '2026-11-20' and created_by = _me) then 'ok' else 'KO' end);

  -- 2. Toutes familles
  insert into public.supplier_year_end_rebates (company_id, supplier_id, family_code, label, rebate_pct, amount, rebate_date)
  values (_co, _sup, null, 'RFA 2025 globale', null, 80, date '2025-12-31') returning id into _r2;
  insert into _t(check_name, result) values ('RFA « toutes familles » (famille vide, sans taux) acceptee',
    case when _r2 is not null then 'ok' else 'KO' end);

  -- 3. Liste (listYearEndRebates : société + fournisseur, date décroissante) et total
  select array_agg(id order by rebate_date desc) into _list from public.supplier_year_end_rebates where company_id = _co and supplier_id = _sup;
  insert into _t(check_name, result) values ('liste du fournisseur : 2 RFA, la plus recente d''abord, total 230 €',
    case when _list = array[_r1, _r2]
          and (select sum(amount) from public.supplier_year_end_rebates where company_id = _co and supplier_id = _sup) = 230 then 'ok' else 'KO' end);

  -- 4. Modifier
  update public.supplier_year_end_rebates set amount = 175 where id = _r1;
  insert into _t(check_name, result) values ('modification 150 -> 175 tracee (events update, ancien / nouveau)',
    case when (select amount from public.supplier_year_end_rebates where id = _r1) = 175
          and exists (select 1 from public.events where entity_type = 'supplier_year_end_rebates' and entity_id = _r1::text
                        and action = 'update' and actor_id = _me and (old_data->>'amount')::numeric = 150
                        and (new_data->>'amount')::numeric = 175) then 'ok' else 'KO' end);

  -- 5. Fournisseur d'une autre société
  begin
    insert into public.supplier_year_end_rebates (company_id, supplier_id, label, amount)
    values (_co, (select v::uuid from _c where k = 'other_sup'), 'RFA fournisseur etranger', 10);
    _ok := false;
  exception when others then _ok := sqlerrm like '%row-level security%'; _msg := sqlerrm; end;
  insert into _t(check_name, result) values ('fournisseur d''une autre societe refuse (RLS)', case when _ok then 'ok' else 'KO ' || coalesce(_msg, 'insere') end);

  -- 6. Supprimer
  delete from public.supplier_year_end_rebates where id = _r2;
  insert into _t(check_name, result) values ('suppression tracee (events delete avec l''ancienne ligne)',
    case when not exists (select 1 from public.supplier_year_end_rebates where id = _r2)
          and exists (select 1 from public.events where entity_type = 'supplier_year_end_rebates' and entity_id = _r2::text
                        and action = 'delete' and (old_data->>'amount')::numeric = 80) then 'ok' else 'KO' end);

  -- 7. Écarts d'écran avec G8 (non bloquants, signalés dans le rapport)
  insert into _t(check_name, result) values ('MANQUE (ecran) : pas de n° de remise, pas de filtre date debut / fin, pas d''impression de la RFA', 'ok');
end $s$;
select n, check_name, result from _t order by n;
