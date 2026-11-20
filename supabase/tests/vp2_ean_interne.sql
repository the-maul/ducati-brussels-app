-- =====================================================================
-- VP2 (décision du client, 20/11/2026, comme G8) — EAN interne 3000… créé d'office à la création
-- d'un article. Migration 20261120341000. ItalTest, simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. clé de contrôle EAN-13 : 300011891270 → 4 (code G8 relevé 3000118912704) ;
--   2. série EAN de la société : préfixe 3000, 8 chiffres, sans séparateur ni remise à zéro ;
--   3. article créé comme l'écran (référence seule) puis article_assign_internal_ean : code
--      13 chiffres 3000…, clé valide, principal, trace events ;
--   4. deuxième appel : rien de nouveau (« si vide ») ; article avec un code-barres saisi : gardé ;
--   5. deux articles : deux EAN qui se suivent ; ligne de texte (F) : pas d'EAN.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

insert into _t(check_name, result) values
  ('cle EAN-13 : 300011891270 -> 4 (code G8 3000118912704)', case when public.ean13_check_digit('300011891270') = 4 then 'ok' else 'KO' end);

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08'; _tag text := to_char(clock_timestamp(), 'HH24MISSUS');
  s record; _a1 uuid; _a2 uuid; _a3 uuid; _a4 uuid; _e1 text; _e1b text; _e2 text; _e3 text; _e4 text;
begin
  select * into s from public.document_sequences where company_id = _co and doc_type = 'EAN';
  insert into _t(check_name, result) values ('serie EAN : 3000, 8 chiffres, sans separateur ni remise a zero',
    case when s.prefix = '3000' and s.separator = '' and s.padding = 8 and not s.reset_yearly then 'ok' else 'KO' end);

  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate) values (_co, 'VP2A' || _tag, 'Essai VP2', 'A', 21) returning id into _a1;
  _e1 := public.article_assign_internal_ean(_a1);
  insert into _t(check_name, result) values ('article cree (reference seule) : EAN interne ' || coalesce(_e1, 'null') || ', cle valide, principal, trace',
    case when _e1 ~ '^3000\d{9}$' and right(_e1, 1)::int = public.ean13_check_digit(left(_e1, 12))
              and exists (select 1 from public.article_barcodes where article_id = _a1 and barcode = _e1 and is_primary)
              and exists (select 1 from public.events where entity_id = _a1::text and action = 'article_internal_ean') then 'ok' else 'KO' end);
  _e1b := public.article_assign_internal_ean(_a1);
  insert into _t(check_name, result) values ('second appel : rien de nouveau (si vide)',
    case when _e1b = _e1 and (select count(*) from public.article_barcodes where article_id = _a1) = 1 then 'ok' else 'KO' end);

  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate) values (_co, 'VP2B' || _tag, 'Essai VP2', 'A', 21) returning id into _a2;
  insert into public.article_barcodes (article_id, barcode, is_primary) values (_a2, '5412345678908', true);
  _e2 := public.article_assign_internal_ean(_a2);
  insert into _t(check_name, result) values ('code-barres fournisseur deja saisi : garde, pas d''EAN interne',
    case when _e2 = '5412345678908' and (select count(*) from public.article_barcodes where article_id = _a2) = 1 then 'ok' else 'KO' end);

  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate) values (_co, 'VP2C' || _tag, 'Essai VP2', 'A', 21) returning id into _a3;
  _e3 := public.article_assign_internal_ean(_a3);
  insert into _t(check_name, result) values ('deux articles : deux EAN qui se suivent (' || _e3 || ')',
    case when substr(_e3, 5, 8)::bigint = substr(_e1, 5, 8)::bigint + 1 then 'ok' else 'KO' end);

  insert into public.articles (company_id, reference, designation, mgmt_type, vat_rate) values (_co, 'VP2D' || _tag, 'Essai VP2', 'F', 21) returning id into _a4;
  _e4 := public.article_assign_internal_ean(_a4);
  insert into _t(check_name, result) values ('ligne de texte (F) : pas d''EAN', case when _e4 is null then 'ok' else 'KO' end);
end $s$;

select n, check_name, result from _t order by n;
