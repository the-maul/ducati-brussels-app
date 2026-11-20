-- =====================================================================
-- VP3 (décision du client, 20/11/2026, comme G8) — Référence de l'article d'occasion créé par la
-- reprise : OCC + 7 chiffres. Migration 20261120342000. ItalTest, simon@themaul.be, annulé (rt.py).
-- Contrôles :
--   1. série OCC au format G8 (préfixe OCC, sans séparateur, 7 chiffres, jamais remise à zéro) ;
--   2. prochaine référence = après la plus grande OCC + 7 chiffres déjà en base (OCC1260034 → OCC1260035) ;
--   3. deux appels : deux références qui se suivent ;
--   4. une référence déjà prise est sautée ;
--   5. validation de la reprise comme l'écran : article O « OCC… », dossier gardé en REP-, série REP
--      inchangée par la validation ;
--   6. références existantes non renumérotées (OCC-2026-…, REP-… restent) ;
--   7. hors société : refusé.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  s record; _max bigint; _r1 text; _r2 text; _r3 text; _rep0 bigint; _art uuid; _n_old int; _n_old2 int;
begin
  select * into s from public.document_sequences where company_id = _co and doc_type = 'OCC';
  select max(substr(reference, 4)::bigint) into _max from public.articles where company_id = _co and reference ~ '^OCC\d{7}$';
  select count(*) into _n_old from public.articles where company_id = _co and (reference like 'OCC-%' or reference like 'REP-%');
  insert into _t(check_name, result) values
    ('serie OCC au format G8 : OCC, sans separateur, 7 chiffres, jamais remise a zero',
     case when s.prefix = 'OCC' and s.separator = '' and s.padding = 7 and not s.reset_yearly then 'ok' else 'KO' end);

  _r1 := public.next_occ_reference(_co);
  _r2 := public.next_occ_reference(_co);
  insert into _t(check_name, result) values
    ('prochaine reference ' || _r1 || ' = apres la plus grande OCC + 7 chiffres en base (OCC' || coalesce(_max::text, '-') || ')',
     case when _r1 ~ '^OCC\d{7}$' and substr(_r1, 4)::bigint = greatest(coalesce(_max, 0) + 1, 1000000) then 'ok' else 'KO' end),
    ('deux references qui se suivent (' || _r2 || ')', case when substr(_r2, 4)::bigint = substr(_r1, 4)::bigint + 1 then 'ok' else 'KO' end);

  -- Une référence déjà prise est sautée.
  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate)
  values (_co, 'OCC' || lpad((substr(_r2, 4)::bigint + 1)::text, 7, '0'), 'Deja prise VP3', 'O', 0);
  _r3 := public.next_occ_reference(_co);
  insert into _t(check_name, result) values ('reference deja prise sautee (' || _r3 || ')',
    case when substr(_r3, 4)::bigint = substr(_r2, 4)::bigint + 2 then 'ok' else 'KO' end);

  -- Validation de la reprise comme l'écran (validate-api.ts) : REP pour le dossier, OCC pour l'article.
  select next_value into _rep0 from public.document_sequences where company_id = _co and doc_type = 'REP';
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, vat_rate, category_path)
  values (_co, public.next_occ_reference(_co), 'DUCATI MONSTER reprise VP3', 'O', 5000, 5000, 0, '08-01-01') returning id into _art;
  insert into _t(check_name, result) values ('validation de la reprise : article O « OCC + 7 chiffres », serie REP inchangee',
    case when (select reference from public.articles where id = _art) ~ '^OCC\d{7}$'
              and (select next_value from public.document_sequences where company_id = _co and doc_type = 'REP') = _rep0 then 'ok' else 'KO' end);

  select count(*) into _n_old2 from public.articles where company_id = _co and (reference like 'OCC-%' or reference like 'REP-%');
  insert into _t(check_name, result) values ('references existantes non renumerotees (' || _n_old || ' OCC- / REP-)',
    case when _n_old2 = _n_old then 'ok' else 'KO' end);

  begin
    perform public.next_occ_reference('00000000-0000-0000-0000-000000000001');
    insert into _t(check_name, result) values ('hors societe : refuse', 'KO accepte');
  exception when others then insert into _t(check_name, result) values ('hors societe : refuse', 'ok'); end;
end $s$;

select n, check_name, result from _t order by n;
