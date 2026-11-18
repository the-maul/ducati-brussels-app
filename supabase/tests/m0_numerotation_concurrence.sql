-- =====================================================================
-- Lot « numerotation G8 » (18/11/2026) — continuite SOUS CONCURRENCE, dans les deux modes.
--
-- A JOUER SUR UNE BASE LOCALE (`supabase start`) OU UNE BRANCHE SUPABASE, JAMAIS EN PRODUCTION :
-- plusieurs sessions paralleles (extension dblink) doivent VALIDER leurs numeros pour que la
-- concurrence soit reelle ; le test laisse donc deux societes de test en base (« TEST CONCURRENCE … »).
-- Prerequis : migration 20261118260000 appliquee sur cette base, un utilisateur existant (UID
-- ci-dessous) et la chaine de connexion de la base elle-meme (ligne `test.conn`).
--   npx supabase db query --local -f supabase/tests/m0_numerotation_concurrence.sql
--
-- Scenario : 8 sessions en parallele (4 par societe), 60 operations chacune, chaque operation dans
-- sa propre transaction (COMMIT a chaque tour) :
--   - un tour sur deux : brouillon de facture / d avoir avec client et ligne, valide par
--     document_assign_number (numero + statut dans la meme transaction) ;
--   - sinon : numero de ticket / facture / avoir pris par next_document_number.
-- Societe A en compteur unique : les 240 numeros forment la suite 1..240 sans trou ni doublon.
-- Societe B en series separees : FAC, TIK et AVO forment chacune une suite continue sans doublon.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create extension if not exists dblink;

-- A ADAPTER : connexion de la base elle-meme (local : port 54322, mot de passe postgres).
select set_config('test.conn', 'host=127.0.0.1 port=54322 dbname=postgres user=postgres password=postgres', false);
select set_config('test.uid', 'd9409378-a554-4cb2-97d6-e0b84aba204e', false);

create table if not exists public._test_numbering_log (
  id serial primary key, company_id uuid not null, worker int not null, doc_type text not null, num text not null,
  logged_at timestamptz not null default clock_timestamp()
);
alter table public._test_numbering_log enable row level security;
drop policy if exists _test_numbering_log_all on public._test_numbering_log;
create policy _test_numbering_log_all on public._test_numbering_log for all to authenticated using (true) with check (true);
grant all on public._test_numbering_log to authenticated;
grant usage on sequence public._test_numbering_log_id_seq to authenticated;

-- Deux societes neuves (A : compteur unique ; B : series separees), l utilisateur y est admin.
do $s$
declare _a uuid; _b uuid; _ca uuid; _cb uuid; _tag text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
begin
  insert into public.companies (code, name, legal_name, country)
  values ('test-conc-a-' || _tag, 'TEST CONCURRENCE A ' || _tag, 'TEST CONCURRENCE A', 'BE') returning id into _a;
  insert into public.companies (code, name, legal_name, country)
  values ('test-conc-b-' || _tag, 'TEST CONCURRENCE B ' || _tag, 'TEST CONCURRENCE B', 'BE') returning id into _b;
  insert into public.user_roles (user_id, company_id, role)
  values (current_setting('test.uid')::uuid, _a, 'admin'), (current_setting('test.uid')::uuid, _b, 'admin');
  insert into public.contacts (company_id, type, company_name, country) values (_a, 'professionnel', 'TEST CLIENT A', 'BE') returning id into _ca;
  insert into public.contacts (company_id, type, company_name, country) values (_b, 'professionnel', 'TEST CLIENT B', 'BE') returning id into _cb;
  insert into public.numbering_settings (company_id, sales_mode) values (_a, 'single'), (_b, 'separate')
    on conflict (company_id) do update set sales_mode = excluded.sales_mode;
  perform set_config('test.a', _a::text, false);
  perform set_config('test.b', _b::text, false);
  perform set_config('test.ca', _ca::text, false);
  perform set_config('test.cb', _cb::text, false);
end $s$;

-- Lancement des 8 sessions
do $s$
declare _w int; _co uuid; _ct uuid; _conn text; _body text;
begin
  for _w in 1..8 loop
    _co := case when _w <= 4 then current_setting('test.a') else current_setting('test.b') end::uuid;
    _ct := case when _w <= 4 then current_setting('test.ca') else current_setting('test.cb') end::uuid;
    _conn := 'w' || _w;
    perform dblink_connect(_conn, current_setting('test.conn'));
    perform dblink_exec(_conn, format($q$select set_config('request.jwt.claims', '{"sub":"%s","role":"authenticated"}', false)$q$, current_setting('test.uid')));
    perform dblink_exec(_conn, 'set role authenticated');
    _body := format($w$
      do $x$
      declare i int; t text; d uuid; n text; types text[] := array['FAC', 'TIK', 'AVO'];
      begin
        for i in 1..60 loop
          if i %% 2 = 0 then
            t := case when i %% 4 = 0 then 'FAC' else 'AVO' end;
            insert into public.documents (company_id, doc_type, status, contact_id, issue_date, total_ht, total_vat, total_ttc)
            values (%1$L, t, 'brouillon', %2$L, current_date, 10, 2.1, 12.1) returning id into d;
            insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order)
            values (d, 'TEST concurrence', 1, 10, 21, 10, 12.1, 0);
            n := public.document_assign_number(d);
          else
            t := types[1 + ((i + %3$s) %% 3)];
            n := public.next_document_number(%1$L, t);
          end if;
          insert into public._test_numbering_log (company_id, worker, doc_type, num) values (%1$L, %3$s, t, n);
          commit;
        end loop;
      end $x$;
    $w$, _co, _ct, _w);
    perform dblink_send_query(_conn, _body);
  end loop;
end $s$;

-- Attente de la fin des 8 sessions (les erreurs eventuelles remontent ici)
do $s$
declare _w int; _busy boolean := true; _r record;
begin
  while _busy loop
    _busy := false;
    for _w in 1..8 loop
      if dblink_is_busy('w' || _w) = 1 then _busy := true; end if;
    end loop;
    if _busy then perform pg_sleep(0.2); end if;
  end loop;
  for _w in 1..8 loop
    for _r in select * from dblink_get_result('w' || _w) as x(res text) loop null; end loop;
    perform dblink_disconnect('w' || _w);
  end loop;
end $s$;

-- Verifications
with a as (
  select num::bigint as v from public._test_numbering_log where company_id = current_setting('test.a')::uuid
), b as (
  select doc_type, num from public._test_numbering_log where company_id = current_setting('test.b')::uuid
), b_series as (
  select doc_type, count(*) as nb, count(distinct num) as nd,
         min(right(num, 5)::int) as lo, max(right(num, 5)::int) as hi
    from b group by doc_type
)
select 1 as n, 'compteur unique : 240 numeros' as check_name, case when (select count(*) from a) = 240 then 'ok' else 'FAIL' end as result
union all
select 2, 'compteur unique : aucun doublon sous concurrence', case when (select count(distinct v) from a) = (select count(*) from a) then 'ok' else 'FAIL' end
union all
select 3, 'compteur unique : suite 1..240 sans trou', case when (select min(v) from a) = 1 and (select max(v) from a) = 240 then 'ok' else 'FAIL' end
union all
select 4, 'compteur unique : documents valides tous numerotes', case when not exists (
  select 1 from public.documents where company_id = current_setting('test.a')::uuid and status = 'validee' and number is null) then 'ok' else 'FAIL' end
union all
select 5, 'series separees : aucun doublon par serie', case when not exists (select 1 from b_series where nb <> nd) then 'ok' else 'FAIL' end
union all
select 6, 'series separees : chaque serie continue depuis 1', case when not exists (select 1 from b_series where lo <> 1 or hi <> nb) and (select count(*) from b_series) = 3 then 'ok' else 'FAIL' end
union all
select 7, 'series separees : compteur unique jamais utilise', case when not exists (
  select 1 from public.document_sequences where company_id = current_setting('test.b')::uuid and doc_type = 'VEN' and next_value > 1) then 'ok' else 'FAIL' end
order by 1;

-- Nettoyage du journal de test (les societes de test restent sur la base locale / la branche).
drop table if exists public._test_numbering_log;
