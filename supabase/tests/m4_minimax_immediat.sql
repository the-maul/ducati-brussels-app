-- =====================================================================
-- Essai à blanc de 20261119130000_m4_minimax_immediat.sql (réassort minimax immédiat, 18/11/2026).
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   python runtests.py --pre=supabase/migrations/20261119130000_m4_minimax_immediat.sql m4_minimax_immediat.sql
-- Scenario (societe ITALBIKE, administrateur simule, ventes passees par record_stock_move comme l'ecran) :
--   vente qui fait passer une piece sous son minimum -> ligne minimax au panier standard, tout de suite ;
--   deuxieme vente -> meme ligne, quantite portee au besoin (pas de doublon) ; entree -> ligne retiree ;
--   BL (reservation) puis facture (sortie) puis liberation -> la ligne revient au besoin (pas de double) ;
--   piece rouge -> rien ; erreur dans le panier -> la vente passe, erreur tracee ; mode manuel -> rien
--   d'automatique, proposition, Ajouter, Ignorer ; atelier en manuel -> rien ; autre societe -> son panier ;
--   remplacement -> minimum / maximum / conditionnement sur la nouvelle reference, trace ; rattrapage.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');

-- Rattrapage de la migration (meme transaction) : traces datees de now().
insert into _t(check_name, result)
select 'rattrapage : ' || count(*) filter (where action = 'article_minimax_transfer') || ' ancienne(s) reference(s), '
       || count(*) filter (where action = 'article_minimax_received') || ' nouvelle(s) reference(s) mise(s) a jour',
       'ok'
  from public.events where action in ('article_minimax_transfer', 'article_minimax_received') and occurred_at = now();

insert into _t(check_name, result)
select 'rattrapage idempotent : plus aucune ancienne reference avec minimum / maximum ni conditionnement a reporter',
       case when count(*) = 0 then 'ok' else 'KO ' || count(*) end
  from public.articles s
 where s.superseded_by_id is not null
   and public.article_final_replacement(s.id) <> s.id
   and ((coalesce(s.stock_min, 0) > 0 or coalesce(s.stock_max, 0) > 0)
        or (coalesce(s.pack_qty, 0) > 1
            and (select coalesce(t.pack_qty, 0) from public.articles t where t.id = public.article_final_replacement(s.id)) <= 1));

-- Trois pieces stockees vertes (stock reel 3 a 6, aucune reservation, rien en commande).
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
         limit 4) x;
-- X : minimum 3, maximum 8 ; Y : rouge (fin de serie) minimum 50 ; W (mode manuel) et Z (erreur forcee) :
-- minimum pose plus bas, apres le passage de la tache de nuit.
update public.articles set stock_min = 3, stock_max = 8 where id = (select v::uuid from _ctx where k = 'art1');
update public.articles set stock_min = 50, stock_max = 60, supplier_availability = 'red' where id = (select v::uuid from _ctx where k = 'art2');
insert into _ctx select 'real1', (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'art1')))::text;

insert into _t(check_name, result)
select 'preparation : 4 pieces, reglage auto par defaut',
       case when (select count(*) from _ctx where k like 'art%') = 4
             and (select minimax_mode from public.companies where id = '3d9f0f13-a691-4d07-ad58-34590df86e33') = 'auto'
            then 'ok' else 'KO ' || (select count(*) from _ctx where k like 'art%') end;

-- ------------------------------------------------------------ 1. administrateur simule : ventes au comptoir
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

-- Vente : reel -> 2 (< 3) => ligne minimax = 8 - 2 = 6.
select public.record_stock_move((select v::uuid from _ctx where k = 'art1'), 'sortie', -((select v::numeric from _ctx where k = 'real1') - 2),
                                null, false, null, 'sale', 'TIK-ESSAI-1', null);

reset role;
insert into _t(check_name, result)
select 'vente sous le minimum : ligne minimax 6 au panier standard ouvert, tout de suite',
       case when count(*) = 1 and sum(l.qty) = 6 and bool_and(b.kind = 'standard' and b.status = 'ouvert') then 'ok'
            else 'KO ' || count(*) || ' / ' || coalesce(sum(l.qty)::text, '-') end
  from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
 where l.article_id = (select v::uuid from _ctx where k = 'art1') and l.origin = 'minimax';
insert into _ctx select 'basket', l.basket_id::text from public.supplier_basket_lines l
 where l.article_id = (select v::uuid from _ctx where k = 'art1') and l.origin = 'minimax' limit 1;

insert into _t(check_name, result)
select 'trace : evenement minimax_immediate_add avec la reference du ticket',
       case when exists (select 1 from public.events where action = 'minimax_immediate_add' and occurred_at = now()
                          and new_data ->> 'article_id' = (select v from _ctx where k = 'art1')
                          and new_data ->> 'ref' = 'TIK-ESSAI-1' and (new_data ->> 'qty')::numeric = 6)
            then 'ok' else 'KO' end;

set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'art1'), 'sortie', -1, null, false, null, 'sale', 'TIK-ESSAI-2', null);
reset role;
insert into _t(check_name, result)
select 'deuxieme vente : une seule ligne, portee a 7 (pas de doublon)',
       case when count(*) = 1 and sum(qty) = 7 then 'ok' else 'KO ' || count(*) || ' / ' || coalesce(sum(qty)::text, '-') end
  from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art1') and origin = 'minimax';

insert into _t(check_name, result)
select 'nuit (filet) : meme quantite, rien de retire',
       case when (public._basket_fill_minimax((select v::uuid from _ctx where k = 'basket')) ->> 'removed')::int = 0
             and (select sum(qty) from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art1') and origin = 'minimax') = 7
            then 'ok' else 'KO' end;

-- W et Z : minimum 10, maximum 12 (apres la nuit, pour que seules les ventes les touchent).
update public.articles set stock_min = 10, stock_max = 12 where id = (select v::uuid from _ctx where k = 'art3');
update public.articles set stock_min = 10, stock_max = 12 where id = (select v::uuid from _ctx where k = 'art4');

-- Entree +5 : reel 6 >= 3 -> plus de besoin -> ligne retiree.
set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'art1'), 'entree', 5, null, false, null, 'reception', 'REC-ESSAI', null);
reset role;
insert into _t(check_name, result)
select 'entree au-dessus du minimum : ligne minimax retiree du panier ouvert',
       case when not exists (select 1 from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art1') and origin = 'minimax')
             and exists (select 1 from public.events where action = 'minimax_immediate_reduce' and occurred_at = now()
                          and new_data ->> 'article_id' = (select v from _ctx where k = 'art1'))
            then 'ok' else 'KO' end;

-- BL : reservation 4 (stock du minimax 2) -> 6 ; facture : sortie 4 puis liberation 4 -> 6 (pas 10).
set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'art1'), 'reservation', 4, null, true, null, 'sale', 'BL-ESSAI', null);
reset role;
insert into _t(check_name, result)
select 'BL (reservation) sous le minimum : ligne 6',
       case when sum(qty) = 6 then 'ok' else 'KO ' || coalesce(sum(qty)::text, '-') end
  from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art1') and origin = 'minimax';
set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'art1'), 'sortie', -4, null, false, null, 'sale', 'FAC-ESSAI', null);
select public.record_stock_move((select v::uuid from _ctx where k = 'art1'), 'liberation', -4, null, true, null, 'sale', 'BL-ESSAI', 'Libération réservation');
reset role;
insert into _t(check_name, result)
select 'facture du BL (sortie puis liberation) : ligne revenue au besoin reel 6, pas commandee deux fois',
       case when count(*) = 1 and sum(qty) = 6 and public._minimax_stock((select v::uuid from _ctx where k = 'art1')) = 2 then 'ok'
            else 'KO ' || count(*) || ' / ' || coalesce(sum(qty)::text, '-') end
  from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art1') and origin = 'minimax';

-- Piece rouge : jamais au panier.
set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'art2'), 'sortie', -1, null, false, null, 'sale', 'TIK-ESSAI-3', null);
reset role;
insert into _t(check_name, result)
select 'piece fin de serie (rouge) : rien au panier, pas d''erreur',
       case when not exists (select 1 from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art2'))
             and not exists (select 1 from public.events where action = 'minimax_immediate_error' and occurred_at = now()
                              and new_data ->> 'article_id' = (select v from _ctx where k = 'art2'))
            then 'ok' else 'KO' end;

-- Erreur dans le panier : la vente passe quand meme, l'erreur est tracee.
-- Erreur forcee sur Z : une garde de test refuse toute ligne de panier de Z.
create or replace function public._test_minimax_boom() returns trigger language plpgsql as $$
begin
  if new.article_id = (select v::uuid from _ctx where k = 'art4') then
    raise exception 'panne simulee du panier';
  end if;
  return new;
end $$;
create trigger trg_test_minimax_boom before insert on public.supplier_basket_lines
  for each row execute function public._test_minimax_boom();

set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'art4'), 'sortie', -1, null, false, null, 'sale', 'TIK-ESSAI-4', null);
reset role;
insert into _t(check_name, result)
select 'panne du panier : la vente est enregistree, erreur tracee (minimax_immediate_error)',
       case when exists (select 1 from public.stock_moves where article_id = (select v::uuid from _ctx where k = 'art4') and ref = 'TIK-ESSAI-4')
             and exists (select 1 from public.events where action = 'minimax_immediate_error' and occurred_at = now()
                          and new_data ->> 'article_id' = (select v from _ctx where k = 'art4')
                          and new_data ->> 'error' like '%panne simulee%')
             and not exists (select 1 from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art4'))
            then 'ok' else 'KO' end;
drop trigger trg_test_minimax_boom on public.supplier_basket_lines;

-- ------------------------------------------------------------ 2. mode « proposition manuelle »
set local role authenticated;
select public.minimax_mode_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'manuel');
select public.record_stock_move((select v::uuid from _ctx where k = 'art3'), 'sortie', -1, null, false, null, 'sale', 'TIK-ESSAI-5', null);
reset role;
insert into _t(check_name, result)
select 'manuel : reglage trace, rien d''automatique au panier',
       case when (select minimax_mode from public.companies where id = '3d9f0f13-a691-4d07-ad58-34590df86e33') = 'manuel'
             and exists (select 1 from public.events where action = 'minimax_mode_set' and occurred_at = now() and new_data ->> 'minimax_mode' = 'manuel')
             and not exists (select 1 from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art3'))
            then 'ok' else 'KO' end;

set local role authenticated;
insert into _ctx
select 'prop_qty', p.qty::text from public.minimax_proposal('3d9f0f13-a691-4d07-ad58-34590df86e33',
       array[(select v::uuid from _ctx where k = 'art3'), (select v::uuid from _ctx where k = 'art1')]) p;
reset role;
insert into _t(check_name, result)
select 'proposition : seule la piece W (sous son minimum, pas couverte) est proposee, quantite = maximum - stock',
       case when (select count(*) from _ctx where k = 'prop_qty') = 1
             and (select v::numeric from _ctx where k = 'prop_qty')
                 = 12 - public._minimax_stock((select v::uuid from _ctx where k = 'art3'))
            then 'ok' else 'KO ' || coalesce((select string_agg(v, ',') from _ctx where k = 'prop_qty'), 'aucune') end;

set local role authenticated;
select public.minimax_proposal_apply('3d9f0f13-a691-4d07-ad58-34590df86e33',
       jsonb_build_array(jsonb_build_object('article_id', (select v from _ctx where k = 'art3'), 'qty', (select v::numeric from _ctx where k = 'prop_qty'))),
       'TIK-ESSAI-5');
select public.minimax_proposal_ignore('3d9f0f13-a691-4d07-ad58-34590df86e33', array[(select v::uuid from _ctx where k = 'art3')], 'TIK-ESSAI-6');
reset role;
insert into _t(check_name, result)
select 'Ajouter : ligne minimax au panier, plus rien a proposer ensuite ; Ignorer trace',
       case when (select sum(qty) from public.supplier_basket_lines where article_id = (select v::uuid from _ctx where k = 'art3') and origin = 'minimax')
                 = (select v::numeric from _ctx where k = 'prop_qty')
             and not exists (select 1 from public.minimax_proposal('3d9f0f13-a691-4d07-ad58-34590df86e33', array[(select v::uuid from _ctx where k = 'art3')]))
             and exists (select 1 from public.events where action = 'minimax_proposal_added' and occurred_at = now())
             and exists (select 1 from public.events where action = 'minimax_proposal_ignored' and occurred_at = now())
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'atelier en mode manuel : rien d''automatique non plus',
       case when public._workshop_minimax_after('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'art1')) = 0
            then 'ok' else 'KO' end;

-- Utilisateur etranger a la societe : reglage et proposition refuses.
do $$
declare _a boolean := false; _b boolean := false;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
  begin
    perform public.minimax_mode_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'auto');
  exception when others then _a := sqlstate = '42501';
  end;
  begin
    perform public.minimax_proposal('3d9f0f13-a691-4d07-ad58-34590df86e33', array[]::uuid[]);
  exception when others then _b := sqlstate = '42501';
  end;
  perform set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
  insert into _t(check_name, result) values ('etranger a la societe : reglage et proposition refuses', case when _a and _b then 'ok' else 'KO' end);
end $$;

update public.companies set minimax_mode = 'auto' where id = '3d9f0f13-a691-4d07-ad58-34590df86e33';

-- ------------------------------------------------------------ 3. multi-societe (tache systeme : sans utilisateur)
select set_config('request.jwt.claims', '', true);
with c as (insert into public.companies (code, name) values ('ZZMMX', 'Societe essai minimax') returning id)
insert into _ctx select 'company2', id::text from c;
with a as (
  insert into public.articles (company_id, reference, designation, mgmt_type, stock_min, stock_max)
  values ((select v::uuid from _ctx where k = 'company2'), 'ZZ-MMX-B', 'Piece essai autre societe', 'A', 2, 5)
  returning id)
insert into _ctx select 'artB', id::text from a;
select public.record_stock_move((select v::uuid from _ctx where k = 'artB'), 'entree', 3, null, false, null, 'reception', 'REC-B', null);
select public.record_stock_move((select v::uuid from _ctx where k = 'artB'), 'sortie', -2, null, false, null, 'sale', 'TIK-B', null);
insert into _t(check_name, result)
select 'autre societe : son propre panier standard (5 - 1 = 4), rien chez ITALBIKE',
       case when count(*) = 1 and sum(l.qty) = 4 and bool_and(b.company_id = (select v::uuid from _ctx where k = 'company2'))
            then 'ok' else 'KO ' || count(*) end
  from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
 where l.article_id = (select v::uuid from _ctx where k = 'artB');

-- ------------------------------------------------------------ 4. remplacement de reference
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
insert into public.articles (company_id, reference, designation, mgmt_type, stock_min, stock_max, pack_qty) values
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ZZ-MMX-OLD1', 'Ancienne 1', 'A', 2, 5, 4),
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ZZ-MMX-NEW1', 'Nouvelle 1', 'A', 0, 0, 1),
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ZZ-MMX-OLD2', 'Ancienne 2', 'A', 3, 6, 1),
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ZZ-MMX-NEW2', 'Nouvelle 2 (a deja son minimax)', 'A', 1, 2, 2),
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ZZ-MMX-OLD3', 'Ancienne 3', 'A', 4, 9, 1),
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ZZ-MMX-MID3', 'Intermediaire 3', 'A', 0, 0, 1),
  ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ZZ-MMX-END3', 'Finale 3', 'A', 0, 0, 1);
update public.articles set superseded_by_id = (select id from public.articles where reference = 'ZZ-MMX-END3' and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')
 where reference = 'ZZ-MMX-MID3' and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';

set local role authenticated;
update public.articles set superseded_by_id = (select id from public.articles where reference = 'ZZ-MMX-NEW1' and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')
 where reference = 'ZZ-MMX-OLD1' and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
update public.articles set superseded_by_id = (select id from public.articles where reference = 'ZZ-MMX-NEW2' and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')
 where reference = 'ZZ-MMX-OLD2' and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
update public.articles set superseded_by_id = (select id from public.articles where reference = 'ZZ-MMX-MID3' and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')
 where reference = 'ZZ-MMX-OLD3' and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
reset role;

insert into _t(check_name, result)
select 'remplacement : minimum 2 / maximum 5 et conditionnement 4 passent sur la nouvelle, l''ancienne a 0',
       case when n.stock_min = 2 and n.stock_max = 5 and n.pack_qty = 4 and o.stock_min = 0 and o.stock_max = 0 and o.pack_qty = 4
            then 'ok' else 'KO ' || n.stock_min || '/' || n.stock_max || '/' || n.pack_qty || ' ; ' || o.stock_min || '/' || o.stock_max end
  from public.articles n, public.articles o
 where n.reference = 'ZZ-MMX-NEW1' and o.reference = 'ZZ-MMX-OLD1'
   and n.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and o.company_id = n.company_id;

insert into _t(check_name, result)
select 'remplacement : trace sur l''ancienne (valeurs d''avant) et sur la nouvelle',
       case when exists (select 1 from public.events e join public.articles o on o.id::text = e.entity_id
                          where e.action = 'article_minimax_transfer' and o.reference = 'ZZ-MMX-OLD1'
                            and (e.old_data ->> 'stock_min')::numeric = 2 and (e.old_data ->> 'stock_max')::numeric = 5
                            and (e.new_data ->> 'minimax_moved')::boolean)
             and exists (select 1 from public.events e join public.articles n on n.id::text = e.entity_id
                          where e.action = 'article_minimax_received' and n.reference = 'ZZ-MMX-NEW1')
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'remplacement : la nouvelle garde son propre minimax (1 / 2, conditionnement 2), l''ancienne passe a 0',
       case when n.stock_min = 1 and n.stock_max = 2 and n.pack_qty = 2 and o.stock_min = 0 and o.stock_max = 0
            then 'ok' else 'KO ' || n.stock_min || '/' || n.stock_max || ' ; ' || o.stock_min end
  from public.articles n, public.articles o
 where n.reference = 'ZZ-MMX-NEW2' and o.reference = 'ZZ-MMX-OLD2'
   and n.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and o.company_id = n.company_id;

insert into _t(check_name, result)
select 'chaine de remplacements : le minimax va au bout de la chaine (4 / 9), pas a l''intermediaire',
       case when e.stock_min = 4 and e.stock_max = 9 and m.stock_min = 0 and o.stock_min = 0
            then 'ok' else 'KO ' || e.stock_min || ' / ' || m.stock_min end
  from public.articles e, public.articles m, public.articles o
 where e.reference = 'ZZ-MMX-END3' and m.reference = 'ZZ-MMX-MID3' and o.reference = 'ZZ-MMX-OLD3'
   and e.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and m.company_id = e.company_id and o.company_id = e.company_id;

insert into _t(check_name, result)
select 'remplacement rejoue (meme cible) : rien ne bouge, pas de nouvelle trace',
       case when public._article_minimax_transfer((select id from public.articles where reference = 'ZZ-MMX-OLD1'
                                                     and company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')) = 0
            then 'ok' else 'KO' end;
