-- =====================================================================
-- Essai à blanc de 20261119210000_m4_minimax_nuit_manuel.sql (décision client Q52, 19/11/2026).
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   TESTS_DIR=supabase/tests PRE_SQL=supabase/migrations/20261119210000_m4_minimax_nuit_manuel.sql \
--     python rt.py m4_minimax_nuit_manuel.sql
-- Scenario (societe ITALBIKE) : nuit en mode manuel -> panier inchange, liste preparee ; liste lue
-- par l'ecran ; Ignorer -> pas reproposee la nuit suivante tant que le stock ne bouge pas, reproposee
-- apres un mouvement ; Ajouter -> au panier, sort de la liste, pas reproposee ; nuit en automatique ->
-- comportement d'avant (le panier se remplit). Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
-- Deux pieces stockees vertes (stock reel 3 a 6, sans reservation ni commande) : minimum 10, maximum 12.
insert into _ctx
select 'art' || row_number() over (order by x.article_id), x.article_id::text
  from (select m.article_id
          from public.stock_moves m
          join public.articles a on a.id = m.article_id and a.mgmt_type = 'A' and coalesce(a.is_active, true)
                                and coalesce(a.supplier_availability, '') not in ('red', 'yellow')
                                and a.superseded_by_id is null
         where m.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
         group by m.article_id
        having coalesce(sum(m.qty_delta) filter (where not m.is_reservation), 0) between 3 and 6
           and coalesce(sum(m.qty_delta) filter (where m.is_reservation), 0) = 0
           and public._basket_on_order_qty('3d9f0f13-a691-4d07-ad58-34590df86e33', m.article_id, null) = 0
           and public._workshop_missing_qty(m.article_id) = 0
         limit 2) x;
update public.articles set stock_min = 10, stock_max = 12 where id in (select v::uuid from _ctx where k like 'art%');
update public.companies set minimax_mode = 'manuel' where id = '3d9f0f13-a691-4d07-ad58-34590df86e33';

-- Photo du panier avant la nuit : nombre de lignes, quantite totale, derniere ligne.
insert into _ctx
select 'snap', count(*) || '/' || coalesce(sum(l.qty), 0) || '/' || coalesce(max(l.created_at)::text, '-')
  from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
 where b.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
insert into _ctx select 'baskets', count(*)::text from public.supplier_baskets where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';

insert into _t(check_name, result)
select 'preparation : 2 pieces, societe en proposition manuelle',
       case when (select count(*) from _ctx where k like 'art%') = 2 then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 1. nuit en mode manuel
select public._cron_basket_minimax();

insert into _t(check_name, result)
select 'nuit en manuel : panier inchange (lignes, quantites, aucun panier cree)',
       case when (select count(*) || '/' || coalesce(sum(l.qty), 0) || '/' || coalesce(max(l.created_at)::text, '-')
                    from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                   where b.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33') = (select v from _ctx where k = 'snap')
             and (select count(*)::text from public.supplier_baskets where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')
                 = (select v from _ctx where k = 'baskets')
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'nuit en manuel : liste preparee, les 2 pieces proposees a 12 - stock du minimax, evenement de synthese',
       case when (select count(*) from public.minimax_night_list l
                   where l.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and l.status = 'proposee'
                     and l.article_id in (select v::uuid from _ctx where k like 'art%')
                     and l.qty = 12 - public._minimax_stock(l.article_id)) = 2
             and exists (select 1 from public.events where action = 'minimax_night_list' and occurred_at = now()
                          and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and (new_data ->> 'proposed')::int >= 2)
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 2. le lendemain, a l'ecran (administrateur simule)
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
insert into _ctx select 'count', public.minimax_night_list_count('3d9f0f13-a691-4d07-ad58-34590df86e33')::text;
insert into _ctx select 'rows_art', count(*)::text from public.minimax_night_list_rows('3d9f0f13-a691-4d07-ad58-34590df86e33') r
 where r.article_id in (select v::uuid from _ctx where k like 'art%') and r.qty = 12 - r.minimax_stock;
reset role;
insert into _t(check_name, result)
select 'ecran : compteur et liste de la nuit (memes colonnes que la fenetre), 2 pieces',
       case when (select v::int from _ctx where k = 'count') >= 2 and (select v from _ctx where k = 'rows_art') = '2'
            then 'ok' else 'KO ' || (select v from _ctx where k = 'count') || ' / ' || (select v from _ctx where k = 'rows_art') end;

-- Ignorer la piece 1, Ajouter la piece 2.
insert into _ctx select 'q2', (12 - public._minimax_stock((select v::uuid from _ctx where k = 'art2')))::text;
set local role authenticated;
select public.minimax_proposal_ignore('3d9f0f13-a691-4d07-ad58-34590df86e33', array[(select v::uuid from _ctx where k = 'art1')], null);
select public.minimax_proposal_apply('3d9f0f13-a691-4d07-ad58-34590df86e33',
       jsonb_build_array(jsonb_build_object('article_id', (select v from _ctx where k = 'art2'),
                                            'qty', (select v::numeric from _ctx where k = 'q2'))), null);
reset role;
insert into _t(check_name, result)
select 'Ignorer : notee avec le dernier mouvement de stock ; Ajouter : au panier, sortie de la liste',
       case when exists (select 1 from public.minimax_night_list where article_id = (select v::uuid from _ctx where k = 'art1')
                          and status = 'ignoree' and last_move_id = public._minimax_last_move(article_id))
             and not exists (select 1 from public.minimax_night_list where article_id = (select v::uuid from _ctx where k = 'art2'))
             and exists (select 1 from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art2') and origin = 'minimax')
            then 'ok' else 'KO' end;

-- Nuit suivante, rien n'a bouge : ni la piece ignoree ni la piece au panier ne reviennent.
select public._cron_basket_minimax();
insert into _t(check_name, result)
select 'nuit suivante : piece ignoree pas reproposee (stock inchange), piece au panier pas reproposee',
       case when (select status from public.minimax_night_list where article_id = (select v::uuid from _ctx where k = 'art1')) = 'ignoree'
             and not exists (select 1 from public.minimax_night_list where article_id = (select v::uuid from _ctx where k = 'art2'))
            then 'ok' else 'KO' end;

-- Le stock de la piece ignoree bouge (vente de 1) : elle revient la nuit suivante.
set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'art1'), 'sortie', -1, null, false, null, 'sale', 'TIK-ESSAI-NUIT', null);
reset role;
insert into _t(check_name, result)
select 'vente en manuel : toujours rien d''automatique au panier pour la piece ignoree',
       case when not exists (select 1 from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art1'))
            then 'ok' else 'KO' end;
select public._cron_basket_minimax();
insert into _t(check_name, result)
select 'stock bouge : la piece ignoree est reproposee (12 - nouveau stock)',
       case when exists (select 1 from public.minimax_night_list where article_id = (select v::uuid from _ctx where k = 'art1')
                          and status = 'proposee' and qty = 12 - public._minimax_stock(article_id))
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 3. nuit en mode automatique : comme avant
update public.companies set minimax_mode = 'auto' where id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
insert into _ctx select 'list_auto', count(*) || '/' || coalesce(max(prepared_at)::text, '-') from public.minimax_night_list
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
select public._cron_basket_minimax();
insert into _t(check_name, result)
select 'nuit en automatique : le panier standard se remplit (piece 1 au besoin), evenement basket_fill_minimax',
       case when exists (select 1 from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                          where l.article_id = (select v::uuid from _ctx where k = 'art1') and l.origin = 'minimax'
                            and b.status = 'ouvert' and b.kind = 'standard'
                            and l.qty = 12 - public._minimax_stock(l.article_id))
             and exists (select 1 from public.events where action = 'basket_fill_minimax' and occurred_at = now()
                          and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'nuit en automatique : la liste de la nuit n''est pas touchee',
       case when (select count(*) || '/' || coalesce(max(prepared_at)::text, '-') from public.minimax_night_list
                   where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33') = (select v from _ctx where k = 'list_auto')
            then 'ok' else 'KO' end;

-- Etranger a la societe : liste refusee.
do $$
declare _a boolean := false;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
  begin
    perform public.minimax_night_list_count('3d9f0f13-a691-4d07-ad58-34590df86e33');
  exception when others then _a := sqlstate = '42501';
  end;
  insert into _t(check_name, result) values ('etranger a la societe : liste de la nuit refusee', case when _a then 'ok' else 'KO' end);
end $$;
