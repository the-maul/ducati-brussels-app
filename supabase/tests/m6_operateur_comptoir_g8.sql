-- =====================================================================
-- Essai à blanc — Q63 (20/11/2026) : opérateur au comptoir comme G8 (migration 20261120150000,
-- rejouée par PRE_SQL). Société de test ItalTest, administrateur simon@themaul.be (relié à
-- l'opérateur SIMON par la migration), transaction annulée (rt.py). Chaque ligne doit valoir « ok ».
--   1. référentiel rempli : opérateurs G8 actifs (DOMENICO, JOHN, SIMON…), anciens désactivés ;
--   2. document sans opérateur choisi : l'opérateur relié à l'utilisateur connecté (SIMON), son nom ;
--   3. opérateur choisi (JOHN, sans compte) : nom JOHN imprimé, enregistré sur le document ;
--   4. opérateur désactivé ou d'une autre société : refusé ;
--   5. brouillon : l'opérateur se change (LUC) ;
--   6. plus aucun document avec un e-mail comme opérateur ;
--   7. utilisateur qui n'est pas opérateur : son nom, jamais son e-mail.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

insert into _t(check_name, result)
select '1 referentiel ItalTest : ' || string_agg(label, ' ' order by label) filter (where is_active),
  case when bool_or(label = 'DOMENICO' and is_active) and bool_or(label = 'JOHN' and is_active) and bool_or(label = 'SIMON' and is_active)
        and bool_or(label = 'MIKAEL' and not is_active) and bool_or(label = 'ADMINISTRATEUR' and not is_active) then 'ok' else 'FAIL' end
  from public.reference_values where company_id = '5593d97e-69ad-43dd-8237-4ab8aa4e5c08' and table_key = 'sales_operator';
insert into _t(check_name, result)
select '6 plus aucun e-mail comme operateur', case when count(*) = 0 then 'ok' else 'FAIL ' || count(*) end
  from public.documents where position('@' in coalesce(operator, '')) > 0;

select set_config('test.john', (select id::text from public.reference_values where company_id = '5593d97e-69ad-43dd-8237-4ab8aa4e5c08' and table_key = 'sales_operator' and code = 'JOHN'), true);
select set_config('test.luc', (select id::text from public.reference_values where company_id = '5593d97e-69ad-43dd-8237-4ab8aa4e5c08' and table_key = 'sales_operator' and code = 'LUC'), true);
select set_config('test.mikael', (select id::text from public.reference_values where company_id = '5593d97e-69ad-43dd-8237-4ab8aa4e5c08' and table_key = 'sales_operator' and code = 'MIKAEL'), true);
select set_config('test.other', (select id::text from public.reference_values where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and table_key = 'sales_operator' and code = 'JOHN'), true);

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _d uuid; r record; _hint text;
begin
  insert into public.documents (company_id, doc_type, status, issue_date) values (_co, 'DEV', 'brouillon', current_date) returning id into _d;
  select operator, operator_id, operator_user_id into r from public.documents where id = _d;
  insert into _t(check_name, result) values ('2 sans choix : operateur de l''utilisateur connecte (' || coalesce(r.operator, 'null') || ')',
    case when r.operator = 'SIMON' and r.operator_id is not null and r.operator_user_id = auth.uid() then 'ok' else 'FAIL' end);

  insert into public.documents (company_id, doc_type, status, issue_date, operator_id, operator)
  values (_co, 'TIK', 'brouillon', current_date, current_setting('test.john')::uuid, 'ignore@exemple.be') returning id into _d;
  select operator, operator_id, operator_user_id into r from public.documents where id = _d;
  insert into _t(check_name, result) values ('3 operateur choisi JOHN : nom enregistre',
    case when r.operator = 'JOHN' and r.operator_id = current_setting('test.john')::uuid and r.operator_user_id = auth.uid() then 'ok' else 'FAIL ' || coalesce(r.operator, 'null') end);

  begin
    insert into public.documents (company_id, doc_type, status, issue_date, operator_id) values (_co, 'TIK', 'brouillon', current_date, current_setting('test.mikael')::uuid);
    insert into _t(check_name, result) values ('4a operateur desactive : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _hint = pg_exception_hint;
    insert into _t(check_name, result) values ('4a operateur desactive : refuse', case when _hint = 'operator_unknown' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  begin
    insert into public.documents (company_id, doc_type, status, issue_date, operator_id) values (_co, 'TIK', 'brouillon', current_date, current_setting('test.other')::uuid);
    insert into _t(check_name, result) values ('4b operateur d''une autre societe : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _hint = pg_exception_hint;
    insert into _t(check_name, result) values ('4b operateur d''une autre societe : refuse', case when _hint = 'operator_unknown' then 'ok' else 'FAIL ' || sqlerrm end);
  end;

  update public.documents set operator_id = current_setting('test.luc')::uuid where id = _d;
  select operator into r from public.documents where id = _d;
  insert into _t(check_name, result) values ('5 brouillon : operateur change (LUC)', case when r.operator = 'LUC' then 'ok' else 'FAIL ' || r.operator end);
end $s$;

-- 7. Utilisateur non opérateur : on retire le lien SIMON ↔ compte, puis nouveau document.
reset role;
update public.reference_values set extra = extra - 'email' where company_id = '5593d97e-69ad-43dd-8237-4ab8aa4e5c08' and table_key = 'sales_operator';
set local role authenticated;
do $s$
declare _d uuid; r record;
begin
  insert into public.documents (company_id, doc_type, status, issue_date) values ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'DEV', 'brouillon', current_date) returning id into _d;
  select operator, operator_id into r from public.documents where id = _d;
  insert into _t(check_name, result) values ('7 non operateur : nom sans e-mail (' || coalesce(r.operator, 'null') || ')',
    case when r.operator is not null and position('@' in r.operator) = 0 and r.operator_id is null then 'ok' else 'FAIL' end);
end $s$;
