-- =====================================================================
-- Parcours G8 n° 21 — Copie de stock datée « hors inventaire » (lot-verif-parcours, 20/11/2026)
-- G8 : Stock › Gestion d'arrêté › Génération de l'arrêté → « Aucune méthode d'inventaire n'a été
--      définie. Souhaitez-vous générer une copie de stock hors inventaire ? » → Génération d'une copie
--      du stock à la date du jour → Générer → confirmer (≈ 30 s en FACTICE) ; photo consultable ensuite
--      dans Édition du stock › onglets « Copie de stock » / « Stock à une date » (triple stock, B4).
-- DMS : Stock › Édition du stock (/stock/edition, edition-screen.tsx) › onglet Copie de stock →
--      « Nouvelle copie » = generatePhoto(company, 'copie') → RPC generate_stock_snapshot(_co, '', 'copie')
--      (_stock_photo : une ligne par article à stock réel non nul, avec son PAMP) ; liste des copies
--      stock_snapshot_summaries ; lecture stock_edition(_co, 'copie', {snapshot_id}) et
--      stock_edition(_co, 'date', {at}). Copies automatiques : tâche pg_cron stock-copies-daily.
-- Contrôles :
--   0. tâche planifiée des copies automatiques (15 et fin de mois) présente et active
--   1. copie générée à la demande, hors inventaire (aucune session), datée, libellé « Copie de stock du … »
--      — DURÉE MESURÉE (sur tout le stock d'ItalTest)
--   2. la copie contient tous les articles à stock non nul (même nombre que le stock réel) et l'article
--      de l'essai avec sa quantité 3 et son PAMP 0,75
--   3. la copie ne crée aucun mouvement de stock (le stock réel ne bouge pas)
--   4. consultable : liste des copies (date, auteur, lignes, quantité, valeur)
--   5. consultable : onglet Copie de stock (quantité 3, valeur 2,25) — DURÉE MESURÉE
--   6. photo figée : après une vente (réel 2), la copie montre toujours 3
--   7. onglet Stock à une date : avant la création de l'article 0, maintenant 2
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- 0. lu par le propriétaire (cron.job n'est pas lisible par un utilisateur de l'application)
insert into _t(check_name, result)
select 'copies automatiques : tache pg_cron stock-copies-daily presente et active',
       case when exists (select 1 from cron.job where jobname = 'stock-copies-daily' and active) then 'ok' else 'KO' end;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _co  uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _me  uuid := 'd9409378-a554-4cb2-97d6-e0b84aba204e';
  _ref text := 'PG8-21-' || upper(substr(md5(random()::text), 1, 6));
  _a uuid; _snap uuid; _s public.stock_snapshots%rowtype; _t0 timestamptz; _ms_copy int; _ms_ed int;
  _moves bigint; _levels bigint; _lines bigint; _sum record; _ed record;
begin
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, vat_rate)
  values (_co, _ref, 'Essai parcours 21', 'A', 0.75, 0.75, 21) returning id into _a;
  perform public.record_stock_move(_a, 'entree', 3, 0.75, false, null, 'screen', 'ESSAI', 'stock de depart');
  select count(*) into _moves from public.stock_moves where company_id = _co;
  select count(*) into _levels from (select m.article_id from public.stock_moves m where m.company_id = _co and not m.is_reservation
                                     group by m.article_id having sum(m.qty_delta) <> 0) x;

  -- 1. Nouvelle copie (bouton de l'onglet Copie de stock)
  _t0 := clock_timestamp();
  _snap := public.generate_stock_snapshot(_co, '', 'copie');
  _ms_copy := (extract(epoch from clock_timestamp() - _t0) * 1000)::int;
  select * into _s from public.stock_snapshots where id = _snap;
  insert into _t(check_name, result) values ('copie hors inventaire generee a la demande, datee, auteur, sans session — duree ' || _ms_copy || ' ms',
    case when _s.kind = 'copie' and _s.origin = 'manuel' and _s.session_id is null and _s.created_by = _me and _s.status = 'actif'
          and _s.label = 'Copie de stock du ' || to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY HH24:MI')
          and _ms_copy < 90000 then 'ok' else 'KO ' || coalesce(_s.label, '-') end);

  -- 2. Contenu
  select count(*) into _lines from public.stock_snapshot_lines where snapshot_id = _snap;
  insert into _t(check_name, result) values ('la copie contient les ' || _levels || ' articles a stock non nul, dont l''article de l''essai (3 au PAMP 0,75)',
    case when _lines = _levels and _lines > 1000
          and (select qty from public.stock_snapshot_lines where snapshot_id = _snap and article_id = _a) = 3
          and (select pamp from public.stock_snapshot_lines where snapshot_id = _snap and article_id = _a) = 0.75 then 'ok'
         else 'KO ' || _lines || ' lignes / ' || _levels end);

  -- 3. Aucun mouvement
  insert into _t(check_name, result) values ('la copie ne cree aucun mouvement de stock (reel de l''article = 3)',
    case when (select count(*) from public.stock_moves where company_id = _co) = _moves
          and (select real_qty from public.article_stock(_a)) = 3 then 'ok' else 'KO' end);

  -- 4. Liste des copies
  select * into _sum from public.stock_snapshot_summaries(_co, 200) x where x.id = _snap;
  insert into _t(check_name, result) values ('liste des copies : date, auteur, nombre de lignes, quantite et valeur totales',
    case when _sum.kind = 'copie' and _sum.created_by_name is not null and _sum.line_count = _lines and _sum.total_qty <> 0
          and _sum.total_value = (select round(sum(qty * pamp), 2) from public.stock_snapshot_lines where snapshot_id = _snap) then 'ok'
         else 'KO' end);

  -- 5. Onglet Copie de stock
  _t0 := clock_timestamp();
  select * into _ed from public.stock_edition(_co, 'copie', jsonb_build_object('snapshot_id', _snap, 'search', _ref), 1000, 0) e where e.article_id = _a;
  _ms_ed := (extract(epoch from clock_timestamp() - _t0) * 1000)::int;
  insert into _t(check_name, result) values ('onglet Copie de stock : quantite 3, PAMP 0,75, valeur 2,25 — duree ' || _ms_ed || ' ms',
    case when _ed.ref_qty = 3 and _ed.ref_pamp = 0.75 and _ed.ref_value = 2.25 and _ms_ed < 90000 then 'ok'
         else 'KO ' || coalesce(_ed.ref_qty::text, 'absent') end);

  -- 6. Photo figée après une vente
  perform public.record_stock_move(_a, 'sortie', -1, null, false, null, 'sale', 'ESSAI-VENTE', null);
  select * into _ed from public.stock_edition(_co, 'copie', jsonb_build_object('snapshot_id', _snap, 'search', _ref), 1000, 0) e where e.article_id = _a;
  insert into _t(check_name, result) values ('photo figee : apres une vente le reel vaut 2, la copie montre toujours 3',
    case when _ed.ref_qty = 3 and _ed.real_qty = 2 then 'ok' else 'KO ' || coalesce(_ed.ref_qty::text, '-') || ' / ' || coalesce(_ed.real_qty::text, '-') end);

  -- 7. Stock à une date (dans une seule transaction now() est figé : « avant » = now() - 1 s)
  insert into _t(check_name, result) values ('onglet Stock a une date : 0 avant la creation de l''article, 2 maintenant',
    case when (select e.ref_qty from public.stock_edition(_co, 'date', jsonb_build_object('search', _ref, 'zero', 'inclus',
                 'at', (now() - interval '1 second')::text), 10, 0) e where e.article_id = _a) = 0
          and (select e.ref_qty from public.stock_edition(_co, 'date', jsonb_build_object('search', _ref, 'zero', 'inclus',
                 'at', now()::text), 10, 0) e where e.article_id = _a) = 2 then 'ok' else 'KO' end);
end $s$;
select n, check_name, result from _t order by n;
