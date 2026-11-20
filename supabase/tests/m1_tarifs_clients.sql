-- =====================================================================
-- Rattrapage G8 du 18/11/2026 (lot « regles client ») — essai a blanc des migrations
-- 20261118190000_m1_tarifs_clients_partages.sql et 20261118190100_m1_reprise_tarif_15_et_cases_g8.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118190000_m1_tarifs_clients_partages.sql \
--      supabase/migrations/20261118190100_m1_reprise_tarif_15_et_cases_g8.sql \
--      supabase/tests/m1_tarifs_clients.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue le role d un administrateur (claims JWT simulees) dans ITALBIKE STORE :
--   - tarif commun TEST + tarif de base, lignes (reference, famille, tout), controles (paliers,
--     remise > 100 %, boucle de tarifs de base, autre societe) ;
--   - client de test rattache au tarif ; client bloque : facture refusee a la validation, devis
--     accepte ; encours reel (brouillons exclus) ;
--   - reprise G8 : tarif 15 = REMISE 15 % sur tout le catalogue, rattache aux clients G8 254, 3241,
--     6101, 6460 (« introuvable » = a verifier) ; cases a surveiller / bloque et categories.
-- Chaque ligne du resultat doit valoir « ok » (les lignes « info » donnent des chiffres).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  _base uuid; _pl uuid; _c uuid; _art uuid; _doc uuid; _dev uuid; _ok boolean; _msg text; _bal numeric; _code text;
begin
  -- ------------------------------------------------ tarifs
  insert into public.price_lists (company_id, code, label, show_discount) values (_co, 'TEST-BASE', 'Base essai', false) returning id into _base;
  insert into public.price_lists (company_id, code, label, base_list_id, is_promo) values (_co, 'TEST-15', 'Remise essai', _base, true) returning id into _pl;
  select id into _art from public.articles where company_id = _co and is_active order by created_at limit 1;
  insert into public.price_list_rules (company_id, price_list_id, scope, kind, tiers)
  values (_co, _pl, 'all', 'discount', '[{"min_qty": 1, "value": 15}, {"min_qty": 10, "value": 20}]');
  insert into public.price_list_rules (company_id, price_list_id, scope, article_id, kind, tiers, date_from, date_to)
  values (_co, _pl, 'reference', _art, 'net', '[{"min_qty": 1, "value": 9.9}]', current_date, current_date + 30);
  insert into public.price_list_rules (company_id, price_list_id, scope, family_code, kind, tiers)
  values (_co, _base, 'family', ' R12 ', 'coefficient', '[{"min_qty": 1, "value": 1.8}]');
  insert into _t(check_name, result) values
    ('tarifs crees (2) avec 3 lignes', case when (select count(*) from public.price_list_rules where price_list_id in (_pl, _base)) = 3 then 'ok' else 'FAIL' end),
    ('famille nettoyee (R12)', case when exists (select 1 from public.price_list_rules where price_list_id = _base and family_code = 'R12') then 'ok' else 'FAIL' end),
    ('trace events des tarifs', case when exists (select 1 from public.events where entity_type = 'price_lists' and entity_id::text = _pl::text) then 'ok' else 'info : pas de trace (audit_row ?)' end);

  _ok := false; begin
    insert into public.price_list_rules (company_id, price_list_id, scope, kind, tiers)
    values (_co, _pl, 'all', 'discount', '[{"min_qty":1,"value":1},{"min_qty":2,"value":2},{"min_qty":3,"value":3},{"min_qty":4,"value":4},{"min_qty":5,"value":5}]');
  exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('5 paliers refuses (4 au plus)', case when _ok then 'ok' else 'FAIL' end);
  _ok := false; begin
    insert into public.price_list_rules (company_id, price_list_id, scope, kind, tiers) values (_co, _pl, 'all', 'discount', '[{"min_qty":1,"value":120}]');
  exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('remise > 100 % refusee', case when _ok then 'ok' else 'FAIL' end);
  _ok := false; begin
    insert into public.price_list_rules (company_id, price_list_id, scope, kind, tiers) values (_co, _pl, 'reference', 'discount', '[{"min_qty":1,"value":5}]');
  exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('ligne par reference sans article refusee', case when _ok then 'ok' else 'FAIL' end);
  _ok := false; begin
    update public.price_lists set base_list_id = _pl where id = _base;
  exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('boucle de tarifs de base refusee', case when _ok then 'ok' else 'FAIL' end);
  _ok := false; begin
    insert into public.price_lists (company_id, code) values (_co, ' test-15 ');
  exception when others then _ok := true; end;
  insert into _t(check_name, result) values ('code de tarif unique (casse / espaces)', case when _ok then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ client de test : tarif, blocage, encours
  insert into public.contacts (company_id, type, status, civility, last_name, first_name, price_list_id, credit_limit, credit_limit_blocking)
  values (_co, 'particulier', 'client', 'Monsieur', 'ESSAI TARIF', 'G8', _pl, 100, true) returning id into _c;
  insert into _t(check_name, result) values ('client rattache au tarif', case when (select price_list_id from public.contacts where id = _c) = _pl then 'ok' else 'FAIL' end);

  -- brouillon : jamais compte dans l encours
  insert into public.documents (company_id, doc_type, status, issue_date, contact_id, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'FAC', 'brouillon', current_date, _c, 100, 21, 121, 'ttc') returning id into _doc;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_doc, 'TEST tarif client', 1, 100, 21, 100, 121, 0, 'article');
  _bal := public.contact_open_balance(_c);
  insert into _t(check_name, result) values ('encours : brouillon exclu (0)', case when _bal = 0 then 'ok' else 'FAIL ' || _bal end);

  update public.contacts set is_blocked = true where id = _c;
  _ok := false; _msg := null; begin
    update public.documents set status = 'validee', number = public.next_document_number(_co, 'FAC') where id = _doc;
  exception when others then _ok := true; _msg := sqlerrm; end;
  insert into _t(check_name, result) values ('client bloque : facture refusee a la validation', case when _ok and _msg ilike '%bloque%' then 'ok' else 'FAIL ' || coalesce(_msg, 'validee') end);

  insert into public.documents (company_id, doc_type, status, issue_date, contact_id, total_ht, total_vat, total_ttc, price_mode)
  values (_co, 'DEV', 'brouillon', current_date, _c, 100, 21, 121, 'ttc') returning id into _dev;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order, line_type)
  values (_dev, 'TEST devis client bloque', 1, 100, 21, 100, 121, 0, 'article');
  _ok := true; _msg := null; begin
    update public.documents set status = 'validee', number = public.next_document_number(_co, 'DEV') where id = _dev;
  exception when others then _ok := false; _msg := sqlerrm; end;
  insert into _t(check_name, result) values ('client bloque : devis accepte', case when _ok then 'ok' else 'FAIL ' || _msg end);

  update public.contacts set is_blocked = false where id = _c;
  update public.documents set status = 'validee', number = public.next_document_number(_co, 'FAC') where id = _doc;
  _bal := public.contact_open_balance(_c);
  insert into _t(check_name, result) values
    ('client debloque : facture validee', case when (select status from public.documents where id = _doc) = 'validee' then 'ok' else 'FAIL' end),
    ('encours reel 121 (facture validee non reglee)', case when _bal = 121 then 'ok' else 'FAIL ' || _bal end),
    ('encours hors document en cours (exclusion)', case when public.contact_open_balance(_c, _doc) = 0 then 'ok' else 'FAIL' end);

  -- ------------------------------------------------ reprise G8 (migration 20261118190100)
  select id into _pl from public.price_lists where company_id = _co and code = '15';
  insert into _t(check_name, result) values
    ('tarif 15 = REMISE 15 % cree', case when _pl is not null and (select label from public.price_lists where id = _pl) = 'REMISE 15 %' then 'ok' else 'FAIL' end),
    ('tarif 15 : 15 % sur tout le catalogue, remise affichee',
      case when exists (select 1 from public.price_list_rules r join public.price_lists l on l.id = r.price_list_id
                         where r.price_list_id = _pl and r.scope = 'all' and r.kind = 'discount' and r.tiers = '[{"min_qty": 1, "value": 15}]'::jsonb and l.show_discount)
           then 'ok' else 'FAIL' end);
  foreach _code in array array['254', '3241', '6101', '6460'] loop
    insert into _t(check_name, result)
    select 'client G8 ' || _code || ' rattache au tarif 15',
           case when exists (select 1 from public.contacts c where c.company_id = _co and c.type <> 'fournisseur'
                               and (c.legacy_code = _code or (c.legacy_code is null and c.code = _code)) and c.price_list_id = _pl)
                then 'ok'
                when not exists (select 1 from public.contacts c where c.company_id = _co and c.type <> 'fournisseur'
                               and (c.legacy_code = _code or c.code = _code))
                then 'INTROUVABLE (a signaler)'
                else 'FAIL' end;
  end loop;
  insert into _t(check_name, result)
  select 'info : clients G8 a surveiller (9 dans G8)', count(*)::text from public.contacts where company_id = _co and imported_from = 'G8' and type <> 'fournisseur' and is_watch
  union all
  select 'info : clients G8 bloques (14 dans G8)', count(*)::text from public.contacts where company_id = _co and imported_from = 'G8' and type <> 'fournisseur' and is_blocked
  union all
  select 'info : categorie ' || coalesce(nullif(btrim(category), ''), '(vide)') || ' (G8 : GENERAL 5 099, INTERNET 450, vide 2 434)', count(*)::text
    from public.contacts where company_id = _co and imported_from = 'G8' and type <> 'fournisseur' group by 1;
end $s$;

select n, check_name, result from _t order by n;
