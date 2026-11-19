-- =====================================================================
-- M0 COM005 (19/11/2026) — essai a blanc : DUREE DES APPELS DE L ECRAN sur les vraies donnees
-- (20261119160000_m0_societe_de_test_italtest.sql). Les requetes de l application sont coupees a
-- 8 s : chaque appel admin_test_company_step(_, 4000) doit rester nettement en dessous.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119160000_m0_societe_de_test_italtest.sql \
--      supabase/tests/m0_societe_de_test_etapes_8s.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Duree : ~90 s (copie complete d ITALBIKE STORE, puis 35 s de rafraichissement depuis l ecran :
-- controle des liens et purge des ~280 000 lignes copiees, les etapes les plus lourdes).
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _ctx to authenticated;

do $s$
declare _r jsonb;
begin
  _r := public.admin_clone_company_for_test('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ItalTest');
  insert into _ctx values ('tgt', _r ->> 'company_id');
  insert into _t(check_name, result) values ('1 copie complete prete', case when _r ->> 'status' = 'pret' then 'ok' else 'KO ' || left(_r::text, 300) end);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare
  _tgt uuid; _r jsonb; _calls int := 0; _t0 timestamptz; _d numeric; _max numeric := 0; _maxphase text;
  _start timestamptz := clock_timestamp(); _phases text := '';
begin
  _tgt := public.admin_test_company_start('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ItalTest');
  loop
    _t0 := clock_timestamp();
    _r := public.admin_test_company_step(_tgt, 4000);
    _d := extract(epoch from clock_timestamp() - _t0);
    if _d > _max then _max := _d; _maxphase := _r ->> 'phase'; end if;
    _calls := _calls + 1;
    if position(coalesce(_r ->> 'phase', '?') in _phases) = 0 then _phases := _phases || (_r ->> 'phase') || ' '; end if;
    exit when _r ->> 'status' in ('pret', 'erreur') or clock_timestamp() - _start > interval '35 seconds';
  end loop;
  insert into _t(check_name, result) values
    ('2 ' || _calls || ' appels de 4 s (etapes vues : ' || _phases || ') sans erreur',
     case when _r ->> 'status' <> 'erreur' then 'ok' else 'KO ' || left(_r::text, 300) end),
    ('3 appel le plus long : ' || round(_max, 1) || ' s (etape ' || coalesce(_maxphase, '?') || '), sous la limite de 8 s',
     case when _max < 7 then 'ok' else 'KO' end),
    ('4 lot le plus long : ' || coalesce(_r #>> '{progress,max_batch_ms}', '?') || ' ms (' || coalesce(_r #>> '{progress,max_batch_at}', '?') || ')',
     case when coalesce((_r #>> '{progress,max_batch_ms}')::numeric, 0) < 4000 then 'ok' else 'KO' end);
end $s$;
reset role;

select n, check_name, result from _t order by n;
