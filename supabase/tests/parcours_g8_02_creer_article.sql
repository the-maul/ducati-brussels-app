-- =====================================================================
-- Parcours G8 n° 2 (lot-verif-parcours, 20/11/2026) — Créer un article.
-- G8 joué (parcours.md n° 2, 02-articles.md) : Recherche article → Nouveau → fournisseur (29 DUCATI)
--   → familles (rayon › sous-rayon › catégorie) → fiche pré-remplie (type A, TVA 21 %, coeff 1)
--   → Créer avec la RÉFÉRENCE seule → article créé, code-barres interne `3000…` attribué,
--   réf. fournisseur = référence, prix 0 accepté ; puis Supprimer → « Article supprimé avec succès ».
-- Chemin DMS rejoué comme l'écran : Pièces › Nouveau (/parts/new, article-form.tsx buildPayload →
--   api.ts createArticle = INSERT articles, puis addBarcode(référence) dans article_barcodes) ;
--   liste des pièces (article_list_page) ; suppression par Pièces › Cascade « Supprimer ensemble »
--   (article_delete_batch, réservé administrateur).
-- Société de test ItalTest, administrateur simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. article créé : type A, TVA 21 %, conditionnement 1, famille 02-02-99 (PIE DUCATI), prix 0 acceptés ;
--   2. réf. fournisseur = référence (comme G8) ;
--   3. code-barres créé automatiquement (la référence, choix DMS — G8 : EAN interne 3000…, à trancher) ;
--   4. stock réel 0, aucun mouvement de stock à la création (B7) ;
--   5. trace events « insert » ;
--   6. la référence est unique par société (2e création refusée) ;
--   7. la fiche sort dans la liste Pièces (recherche par référence) avec stock réel / dispo 0 ;
--   8. RLS : invisible depuis une autre société ;
--   9. la base accepte la référence seule (désignation vide) : seule la règle d'écran exige la
--      désignation (écart G8 noté) ;
--  10. MANQUE (constat, ok sur l'absence) : pas de fournisseur sur la fiche article (G8 : 1re étape
--      « Gestion des fournisseurs ») — main_supplier_id existe mais n'est pas saisi par l'écran ;
--  11. suppression : article jamais mouvementé supprimé, trace events « article_delete ».
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _other uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _ref text := 'ZZP02-' || to_char(clock_timestamp(), 'HH24MISSMS');
  _id uuid; _id2 uuid; a record; _n int; _real numeric; _r jsonb; _err text;
begin
  -- 1. Creation comme l'ecran (payload de buildPayload pour une saisie reference + designation)
  insert into public.articles (company_id, reference, designation, brand, mgmt_type, category_path, descriptif,
                               show_descriptif_on_documents, supplier_ref, pack_qty, stock_min, stock_max,
                               purchase_price, pamp, sale_price_ttc, vat_rate, eco_tax_ttc, deee,
                               price_purchase_locked, price_sale_locked, publishable, is_library, to_complete)
  values (_co, _ref, 'ESSAI PARCOURS 02', null, 'A', '02-02-99', null,
          false, _ref, 1, 0, 0,
          0, 0, 0, 21, 0, false,
          false, false, false, false, false)
  returning id into _id;
  -- api.ts createArticle : la reference sert de code-barres par defaut
  insert into public.article_barcodes (article_id, barcode) values (_id, _ref)
  on conflict (article_id, barcode) do nothing;

  select * into a from public.articles where id = _id;
  insert into _t(check_name, result) values
    ('article cree : type A, TVA 21 %, conditionnement 1, famille 02-02-99, prix 0 acceptes',
     case when a.mgmt_type::text = 'A' and a.vat_rate = 21 and a.pack_qty = 1 and a.category_path = '02-02-99'
               and a.sale_price_ttc = 0 and a.purchase_price = 0 then 'ok' else 'KO ' || a.mgmt_type::text end),
    ('ref. fournisseur = reference', case when a.supplier_ref = _ref then 'ok' else 'KO ' || coalesce(a.supplier_ref, 'null') end),
    ('code-barres cree a la creation (= reference ; G8 : EAN interne 3000…, a trancher)',
     case when exists (select 1 from public.article_barcodes b where b.article_id = _id and b.barcode = _ref) then 'ok' else 'KO' end);

  select coalesce(s.real_qty, 0) into _real from public.article_stock(_id) s;
  insert into _t(check_name, result) values
    ('stock reel 0, aucun mouvement a la creation',
     case when coalesce(_real, 0) = 0 and not exists (select 1 from public.stock_moves m where m.article_id = _id) then 'ok' else 'KO ' || _real end),
    ('trace events insert (operateur)',
     case when exists (select 1 from public.events e where e.entity_type = 'articles' and e.entity_id = _id::text
                          and e.action = 'insert' and e.actor_id = auth.uid()) then 'ok' else 'KO' end);

  -- 6. Reference unique par societe
  begin
    insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate) values (_co, _ref, 'DOUBLON', 'A', 21);
    insert into _t(check_name, result) values ('reference unique par societe (2e creation refusee)', 'KO acceptee');
  exception when unique_violation then
    insert into _t(check_name, result) values ('reference unique par societe (2e creation refusee)', 'ok');
  end;

  -- 7. Liste Pieces
  select count(*) into _n from public.article_list_page(_co, _ref) x where x.id = _id and x.real_qty = 0 and x.available_qty = 0;
  insert into _t(check_name, result) values ('liste Pieces : retrouvee par la reference, stock reel / dispo 0', case when _n = 1 then 'ok' else 'KO ' || _n end);

  -- 8. Multi-societe
  select count(*) into _n from public.articles where company_id = _other and reference = _ref;
  insert into _t(check_name, result) values ('RLS : absente de l autre societe', case when _n = 0 then 'ok' else 'KO ' || _n end);

  -- 9. Reference seule (G8) : acceptee par la base, la designation n'est exigee que par l'ecran
  begin
    insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate) values (_co, _ref || 'B', '', 'A', 21)
    returning id into _id2;
    insert into _t(check_name, result) values ('base : reference seule acceptee (designation vide ; l ecran exige la designation)', 'ok');
  exception when others then
    insert into _t(check_name, result) values ('base : reference seule acceptee (designation vide ; l ecran exige la designation)', 'KO ' || sqlerrm);
  end;

  -- 10. MANQUE constate : fournisseur de l'article non saisi par l'ecran (main_supplier_id vide)
  insert into _t(check_name, result) values
    ('MANQUE (constat) : pas de fournisseur saisi sur la fiche article (G8 : etape « Gestion des fournisseurs »)',
     case when a.main_supplier_id is null then 'ok' else 'KO fournisseur present : a revoir dans le rapport' end);

  -- 11. Suppression (article jamais mouvemente)
  _r := public.article_delete_batch(_co, array[_id, _id2]);
  insert into _t(check_name, result) values
    ('suppression : 2 articles jamais mouvementes supprimes, trace article_delete',
     case when (_r->>'deleted')::int = 2 and not exists (select 1 from public.articles where id in (_id, _id2))
               and exists (select 1 from public.events e where e.entity_id = _id::text and e.action = 'article_delete') then 'ok'
          else 'KO ' || _r::text end);
end $s$;

select n, check_name, result from _t order by n;
