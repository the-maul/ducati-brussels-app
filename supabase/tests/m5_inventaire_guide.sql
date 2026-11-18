-- =====================================================================
-- Rattrapage G8 stock (18/11/2026) -- essai a blanc des migrations
--   20261118210000_m5_inventaire_guide.sql
--   20261118211000_m5_editions_stock.sql
--   20261118212000_m5_etiquetage.sql
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118210000_m5_inventaire_guide.sql \
--      supabase/migrations/20261118211000_m5_editions_stock.sql \
--      supabase/migrations/20261118212000_m5_etiquetage.sql \
--      supabase/tests/m5_inventaire_guide.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Scenario, administrateur simule d'ITALBIKE STORE : inventaire magasin ouvert avec edition des
-- ecarts (check-list, ordre impose, retour arriere de la remise a zero), comptage de l'arrete dans
-- les 3 modes (B6), une vente pendant le comptage, reintegration unique et juste (B4), reajustement
-- du stock reel, remise a zero (confirmation forte), editions (reel, copie, date, invendus, rupture),
-- etiquettes en attente cumulees (B12), copies automatiques idempotentes, append-only (B7).
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire)
insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');
-- art1 : piece A avec du stock reel > 0 ; art0 : piece A sans aucun mouvement.
insert into _ctx
select 'art1', m.article_id::text from public.stock_moves m join public.articles a on a.id = m.article_id and a.mgmt_type = 'A'
 where m.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
 group by m.article_id having sum(m.qty_delta) filter (where not m.is_reservation) between 2 and 50 limit 1;
insert into _ctx
select 'art0', a.id::text from public.articles a
 where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.mgmt_type = 'A' and a.is_active and not a.is_library
   and not exists (select 1 from public.stock_moves m where m.article_id = a.id) limit 1;
insert into _ctx select 'real1', coalesce(sum(qty_delta), 0)::text from public.stock_moves
 where article_id = (select v::uuid from _ctx where k = 'art1') and not is_reservation;
-- Aucun inventaire en cours au depart.
update public.inventory_sessions set status = 'cloture', closed_at = now()
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and status = 'en_cours';

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

-- ------------------------------------------------------------ 1. demarrage et check-list
insert into _ctx select 'session', public.inventory_start('3d9f0f13-a691-4d07-ad58-34590df86e33', true, false, true, true, 'Essai')::text;
insert into _t(check_name, result)
select '8 methodes : magasin ouvert + ecarts = 13 etapes, la premiere est Debut',
       case when (select count(*) from public.inventory_session_steps((select v::uuid from _ctx where k = 'session'))) = 13
             and (select step_code from public.inventory_session_steps((select v::uuid from _ctx where k = 'session')) where is_next) = 'debut'
            then 'ok' else 'KO' end;

do $$ begin
  perform public.inventory_start('3d9f0f13-a691-4d07-ad58-34590df86e33', false, false, false, true, null);
  insert into _t(check_name, result) values ('un seul inventaire en cours par societe', 'KO');
exception when others then
  insert into _t(check_name, result) values ('un seul inventaire en cours par societe', case when sqlerrm like '%déjà en cours%' then 'ok' else 'KO ' || sqlerrm end);
end $$;

select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'debut');
do $$ begin
  perform public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'comptage');
  insert into _t(check_name, result) values ('ordre des etapes impose', 'KO');
exception when others then
  insert into _t(check_name, result) values ('ordre des etapes impose', case when sqlerrm like 'Étape attendue%' then 'ok' else 'KO ' || sqlerrm end);
end $$;

select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'sauvegarde');
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'generation_arrete');
insert into _ctx select 'snap', snapshot_id::text from public.inventory_sessions where id = (select v::uuid from _ctx where k = 'session');
insert into _t(check_name, result)
select 'B4 : arrete date avec le stock reel de art1, sauvegarde = copie non vide',
       case when (select qty from public.stock_snapshot_lines where snapshot_id = (select v::uuid from _ctx where k = 'snap')
                   and article_id = (select v::uuid from _ctx where k = 'art1')) = (select v::numeric from _ctx where k = 'real1')
             and (select count(*) from public.stock_snapshots s where s.session_id = (select v::uuid from _ctx where k = 'session') and s.kind = 'copie') = 1
             and (select count(*) from public.stock_snapshot_lines l join public.stock_snapshots s on s.id = l.snapshot_id
                   where s.session_id = (select v::uuid from _ctx where k = 'session') and s.kind = 'copie') > 0
            then 'ok' else 'KO' end;

select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'raz_stock_reel');
insert into _t(check_name, result)
select 'remise a zero du reel : art1 a 0, mouvement trace (origine inventory, ref session)',
       case when (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'art1'))) = 0
             and exists (select 1 from public.stock_moves where article_id = (select v::uuid from _ctx where k = 'art1')
                          and origin = 'inventory' and ref = (select v from _ctx where k = 'session') and operator_id is not null)
            then 'ok' else 'KO' end;
select public.inventory_step_rollback((select v::uuid from _ctx where k = 'session'));
insert into _t(check_name, result)
select 'retour arriere : la remise a zero est compensee, art1 retrouve son stock',
       case when (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'art1'))) = (select v::numeric from _ctx where k = 'real1')
             and (select step_code from public.inventory_session_steps((select v::uuid from _ctx where k = 'session')) where is_next) = 'raz_stock_reel'
            then 'ok' else 'KO' end;
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'raz_stock_reel');
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'edition_arrete_initial');
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'comptage');

-- ------------------------------------------------------------ 2. comptage sur l'arrete (B6)
insert into _t(check_name, result)
select 'liste de comptage : un article jamais mouvemente se trouve (portee tous)',
       case when exists (select 1 from public.inventory_count_list('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'snap'),
                          'tous', (select reference from public.articles where id = (select v::uuid from _ctx where k = 'art0')), null, 50, 0)
                          where article_id = (select v::uuid from _ctx where k = 'art0'))
            then 'ok' else 'KO' end;
select public.snapshot_adjust((select v::uuid from _ctx where k = 'snap'), (select v::uuid from _ctx where k = 'art1'), 7, 'annule_remplace');
select public.snapshot_adjust((select v::uuid from _ctx where k = 'snap'), (select v::uuid from _ctx where k = 'art0'), 2, 'casier', 'Z1');
select public.snapshot_adjust((select v::uuid from _ctx where k = 'snap'), (select v::uuid from _ctx where k = 'art0'), 3, 'casier', 'Z2');
insert into _t(check_name, result)
select 'B6 casier : recompter Z1 remplace Z1 seulement (2+3 puis 1+3 = 4)',
       case when (public.snapshot_adjust((select v::uuid from _ctx where k = 'snap'), (select v::uuid from _ctx where k = 'art0'), 1, 'casier', 'Z1') ->> 'new')::numeric = 4
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'B6 cumul : la saisie s''ajoute aux comptages cumul (2 puis 2 = 4) ; annule et remplace remet a 9',
       case when (public.snapshot_adjust((select v::uuid from _ctx where k = 'snap'), (select v::uuid from _ctx where k = 'art1'), 2, 'cumul') ->> 'new')::numeric = 2
             and (public.snapshot_adjust((select v::uuid from _ctx where k = 'snap'), (select v::uuid from _ctx where k = 'art1'), 2, 'cumul') ->> 'new')::numeric = 4
             and (public.snapshot_adjust((select v::uuid from _ctx where k = 'snap'), (select v::uuid from _ctx where k = 'art1'), 9, 'annule_remplace') ->> 'new')::numeric = 9
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'B7 : chaque reajustement de l''arrete est une ligne ajoutee (ancien, nouveau, operateur)',
       case when (select count(*) from public.stock_snapshot_adjustments where snapshot_id = (select v::uuid from _ctx where k = 'snap')) = 7
             and not exists (select 1 from public.stock_snapshot_adjustments where snapshot_id = (select v::uuid from _ctx where k = 'snap')
                              and (operator_id is null or new_qty - old_qty <> delta))
            then 'ok' else 'KO' end;
do $$ begin
  update public.stock_snapshot_adjustments set new_qty = 0 where snapshot_id = (select v::uuid from _ctx where k = 'snap');
  insert into _t(check_name, result) values ('B7 : reajustements de l''arrete non modifiables', 'KO');
exception when others then
  insert into _t(check_name, result) values ('B7 : reajustements de l''arrete non modifiables', 'ok');
end $$;
do $$ begin
  update public.stock_snapshot_lines set qty = 0 where snapshot_id = (select v::uuid from _ctx where k = 'snap');
  insert into _t(check_name, result) values ('B4 : la photo (arrete) n''est pas modifiable directement', 'KO');
exception when others then
  insert into _t(check_name, result) values ('B4 : la photo (arrete) n''est pas modifiable directement', 'ok');
end $$;

-- Une vente pendant le comptage (magasin ouvert).
select public.record_stock_move((select v::uuid from _ctx where k = 'art1'), 'sortie', -1, null, false, null, 'sale', 'ESSAI', 'vente pendant le comptage');

select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'reajustement_arrete');
insert into _t(check_name, result)
select 'ecarts : art1 compte 9 contre theorique, art0 compte 4 contre 0',
       case when (select gap_qty from public.inventory_session_gaps((select v::uuid from _ctx where k = 'session')) where article_id = (select v::uuid from _ctx where k = 'art1'))
                 = 9 - (select v::numeric from _ctx where k = 'real1')
             and (select gap_qty from public.inventory_session_gaps((select v::uuid from _ctx where k = 'session')) where article_id = (select v::uuid from _ctx where k = 'art0')) = 4
            then 'ok' else 'KO' end;
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'edition_ecarts');
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'edition_arrete_final');
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'sauvegarde_finale');
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'reintegration');
insert into _t(check_name, result)
select 'B4 reintegration : reel = arrete compte + vente pendant le comptage (art1 9 - 1 = 8, art0 4)',
       case when (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'art1'))) = 8
             and (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'art0'))) = 4
            then 'ok' else 'KO ' || (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'art1'))) end;
do $$ begin
  perform public.inventory_step_rollback((select v::uuid from _ctx where k = 'session'));
  insert into _t(check_name, result) values ('reintegration unique : pas de retour arriere', 'KO');
exception when others then
  insert into _t(check_name, result) values ('reintegration unique : pas de retour arriere', case when sqlerrm like '%définitive%' then 'ok' else 'KO ' || sqlerrm end);
end $$;
do $$ begin
  perform public.snapshot_adjust((select v::uuid from _ctx where k = 'snap'), (select v::uuid from _ctx where k = 'art1'), 1, 'annule_remplace');
  insert into _t(check_name, result) values ('arrete reintegre : plus de reajustement', 'KO');
exception when others then
  insert into _t(check_name, result) values ('arrete reintegre : plus de reajustement', case when sqlerrm like '%déjà réintégré%' then 'ok' else 'KO ' || sqlerrm end);
end $$;
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'copie_stock');
select public.inventory_step_validate((select v::uuid from _ctx where k = 'session'), 'fin');
insert into _t(check_name, result)
select 'fin : inventaire cloture, 13 etapes datees avec operateur',
       case when (select status from public.inventory_sessions where id = (select v::uuid from _ctx where k = 'session')) = 'cloture'
             and (select count(*) from public.inventory_session_steps((select v::uuid from _ctx where k = 'session')) where validated and operator_name is not null and validated_at is not null) = 13
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 3. stock reel hors inventaire
insert into _t(check_name, result)
select 'B6 reel : annule et remplace 10 (ancien 8), puis cumul +2 = 12',
       case when (public.stock_readjust((select v::uuid from _ctx where k = 'art1'), 10, 'annule_remplace') ->> 'old')::numeric = 8
             and (public.stock_readjust((select v::uuid from _ctx where k = 'art1'), 2, 'cumul') ->> 'new')::numeric = 12
             and (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'art1'))) = 12
            then 'ok' else 'KO' end;
do $$ begin
  perform public.stock_reset_real('3d9f0f13-a691-4d07-ad58-34590df86e33', 'negatifs', true, 'oui');
  insert into _t(check_name, result) values ('remise a zero : refusee sans la phrase de confirmation', 'KO');
exception when others then
  insert into _t(check_name, result) values ('remise a zero : refusee sans la phrase de confirmation', case when sqlerrm like 'Confirmation manquante%' then 'ok' else 'KO ' || sqlerrm end);
end $$;
select public.record_stock_move((select v::uuid from _ctx where k = 'art0'), 'sortie', -9, null, false, null, 'sale', 'ESSAI', 'pour un negatif');
select public.stock_reset_real('3d9f0f13-a691-4d07-ad58-34590df86e33', 'negatifs', true, 'REMISE A ZERO');
insert into _t(check_name, result)
select 'remise a zero des negatifs : art0 (-5) a 0, art1 (12) intact, copie prise avant',
       case when (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'art0'))) = 0
             and (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'art1'))) = 12
             and exists (select 1 from public.stock_snapshots where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and label like 'Copie avant remise à zéro%')
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 4. editions
insert into _t(check_name, result)
select 'edition stock reel : art1 a 12, valeur = 12 x PAMP, totaux de selection',
       case when exists (select 1 from public.stock_edition('3d9f0f13-a691-4d07-ad58-34590df86e33', 'reel',
                           jsonb_build_object('search', (select reference from public.articles where id = (select v::uuid from _ctx where k = 'art1'))), 1000, 0) e
                          where e.article_id = (select v::uuid from _ctx where k = 'art1') and e.real_qty = 12
                            and e.stock_value = round(12 * e.pamp, 2) and e.total_count >= 1)
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'edition copie de stock : la sauvegarde de debut d''inventaire se relit',
       case when exists (select 1 from public.stock_edition('3d9f0f13-a691-4d07-ad58-34590df86e33', 'copie',
                           jsonb_build_object('snapshot_id', (select id from public.stock_snapshots where session_id = (select v::uuid from _ctx where k = 'session')
                                                                and kind = 'copie' order by created_at limit 1)), 1000, 0) e
                          where e.article_id = (select v::uuid from _ctx where k = 'art1') and e.ref_qty = (select v::numeric from _ctx where k = 'real1'))
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'edition stock a une date (maintenant) = stock reel',
       case when (select e.ref_qty from public.stock_edition('3d9f0f13-a691-4d07-ad58-34590df86e33', 'date',
                    jsonb_build_object('search', (select reference from public.articles where id = (select v::uuid from _ctx where k = 'art1')), 'at', now()), 1000, 0) e
                   where e.article_id = (select v::uuid from _ctx where k = 'art1')) = 12
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'editions invendus, rupture, depreciation, ecart : s''executent',
       case when (select count(*) from public.stock_edition('3d9f0f13-a691-4d07-ad58-34590df86e33', 'invendus', '{}'::jsonb, 10, 0)) >= 0
             and (select count(*) from public.stock_edition('3d9f0f13-a691-4d07-ad58-34590df86e33', 'rupture', '{}'::jsonb, 10, 0)) >= 0
             and (select count(*) from public.stock_edition('3d9f0f13-a691-4d07-ad58-34590df86e33', 'depreciation', '{}'::jsonb, 10, 0)) >= 0
             and (select count(*) from public.stock_edition('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ecart',
                    jsonb_build_object('snapshot_id', (select v from _ctx where k = 'snap')), 1000, 0) where article_id = (select v::uuid from _ctx where k = 'art0')) = 1
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 5. etiquettes (B12)
select public.enqueue_labels('3d9f0f13-a691-4d07-ad58-34590df86e33', jsonb_build_array(jsonb_build_object('article_id', (select v from _ctx where k = 'art1'))), null, 'reference');
select public.enqueue_labels('3d9f0f13-a691-4d07-ad58-34590df86e33', jsonb_build_array(jsonb_build_object('article_id', (select v from _ctx where k = 'art1'), 'qty', 2)), null, 'reajustement');
insert into _t(check_name, result)
select 'B12 : quantite par defaut = stock reel (12), file cumulee par poste (12 + 2 = 14)',
       case when (select qty from public.label_queue_pending('3d9f0f13-a691-4d07-ad58-34590df86e33') where article_id = (select v::uuid from _ctx where k = 'art1')) = 14
            then 'ok' else 'KO' end;
select public.label_queue_done('3d9f0f13-a691-4d07-ad58-34590df86e33',
  (select ids from public.label_queue_pending('3d9f0f13-a691-4d07-ad58-34590df86e33') where article_id = (select v::uuid from _ctx where k = 'art1')), 'imprime');
insert into _t(check_name, result)
select 'B12 : imprimees = sorties de la file (heure et auteur notes)',
       case when not exists (select 1 from public.label_queue_pending('3d9f0f13-a691-4d07-ad58-34590df86e33') where article_id = (select v::uuid from _ctx where k = 'art1'))
             and not exists (select 1 from public.label_queue where article_id = (select v::uuid from _ctx where k = 'art1') and printed and (printed_at is null or printed_by is null))
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'etiquetage par reference : l''article est propose avec son stock reel',
       case when (select real_qty from public.label_candidates('3d9f0f13-a691-4d07-ad58-34590df86e33', 'reference',
                    jsonb_build_object('search', (select reference from public.articles where id = (select v::uuid from _ctx where k = 'art1'))), 50, 0)
                   where article_id = (select v::uuid from _ctx where k = 'art1')) = 12
            then 'ok' else 'KO' end;

reset role;
-- ------------------------------------------------------------ 6. copies automatiques (pg_cron, sans utilisateur)
select set_config('request.jwt.claims', '', true);
insert into _ctx select 'cron1', public._cron_stock_copies()::text;
insert into _t(check_name, result)
select 'B4 : copie automatique non vide sans utilisateur connecte, une seule par jour',
       case when (select v::int from _ctx where k = 'cron1') >= 1
             and public._cron_stock_copies() = 0
             and (select count(*) from public.stock_snapshot_lines l join public.stock_snapshots s on s.id = l.snapshot_id
                   where s.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and s.origin = 'auto'
                     and s.created_at >= now() - interval '1 minute') > 0
            then 'ok' else 'KO' end;

select n, check_name, result from _t order by n;
