-- =====================================================================
-- VP7 (décision du client, 20/11/2026, comme G8) — Les cessions prennent le même compteur que les
-- OR. Migration 20261120343000. ItalTest, simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. réglage cession_settings.counter = OR posé pour la société ;
--   2. OR puis cession puis OR : trois numéros qui se suivent dans la série OR (comme G8 5000012,
--      5000013, 5000014) ; la série ORO ne bouge pas ;
--   3. les cessions existantes gardent leur n° (rien de renuméroté) ;
--   4. écran « Numérotation des documents » : libellés OR (compteur commun) et ORO (plus utilisée) ;
--   5. réglage counter = ORO : retour à la série propre.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _or0 bigint; _oro0 bigint; _pfx text; _n1 text; _n2 text; _n3 text; _ces uuid; _ces2 uuid; _before text[]; _after text[];
begin
  select array_agg(number order by id) into _before from public.internal_cessions where company_id = _co;
  select next_value, prefix into _or0, _pfx from public.document_sequences where company_id = _co and doc_type = 'OR';
  select next_value into _oro0 from public.document_sequences where company_id = _co and doc_type = 'ORO';
  insert into _t(check_name, result) values ('reglage cession_settings.counter = OR (comme G8)',
    case when (select label from public.reference_values where company_id = _co and table_key = 'cession_settings' and code = 'counter') = 'OR' then 'ok' else 'KO' end);

  _n1 := public.next_document_number(_co, 'OR');
  _ces := public.open_internal_cession(_co, '03', null, null, null, 'Essai VP7', null);
  select number into _n2 from public.internal_cessions where id = _ces;
  _n3 := public.next_document_number(_co, 'OR');
  insert into _t(check_name, result) values
    ('OR ' || _n1 || ' / cession ' || coalesce(_n2, 'null') || ' / OR ' || _n3 || ' : un seul compteur, numeros qui se suivent',
     case when _n2 like _pfx || '%' and right(_n1, 5)::int + 1 = right(_n2, 5)::int and right(_n2, 5)::int + 1 = right(_n3, 5)::int
               and (select next_value from public.document_sequences where company_id = _co and doc_type = 'OR') = _or0 + 3
          then 'ok' else 'KO' end),
    ('la serie ORO ne bouge plus',
     case when (select next_value from public.document_sequences where company_id = _co and doc_type = 'ORO') = _oro0 then 'ok' else 'KO' end);
  select array_agg(number order by id) into _after from public.internal_cessions where company_id = _co and id <> _ces;
  insert into _t(check_name, result) values ('cessions existantes : n° inchanges (rien renumerote)',
    case when _after is not distinct from _before then 'ok' else 'KO' end),
    ('ecran Numerotation : libelles OR (compteur commun) et ORO (plus utilisee)',
     case when (select label from public.document_sequences where company_id = _co and doc_type = 'OR') like '%cession%'
               and (select label from public.document_sequences where company_id = _co and doc_type = 'ORO') like '%plus utilis%' then 'ok' else 'KO' end);

  update public.reference_values set label = 'ORO' where company_id = _co and table_key = 'cession_settings' and code = 'counter';
  _ces2 := public.open_internal_cession(_co, '03', null, null, null, 'Essai VP7 ORO', null);
  insert into _t(check_name, result) values ('reglage counter = ORO : retour a la serie propre',
    case when (select next_value from public.document_sequences where company_id = _co and doc_type = 'ORO') = _oro0 + 1 then 'ok' else 'KO' end);
end $s$;

select n, check_name, result from _t order by n;
