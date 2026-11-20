-- =====================================================================
-- Perf 2 (20/11/2026) -- essai a blanc de 20261120114000_perf2_recherche_articles_trigramme.sql.
--   PRE_SQL=supabase/migrations/20261120114000_perf2_recherche_articles_trigramme.sql python rt.py perf2_recherche_articles_equivalence.sql
-- Verifie que la recherche d'article d'une ligne rend EXACTEMENT les memes lignes, dans le meme
-- ordre, que la version d'origine (texte de 20261103230000, reproduit ici) : ~40 recherches tirees
-- des vraies donnees (references, debuts de reference, mots de designation, ref. fournisseur,
-- plusieurs mots, majuscules, 2 lettres, caracteres speciaux, code-barres), chaque societe,
-- limites 20 et 50 ; index pose ; texte indexe = texte d'origine pour tous les articles.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

create function pg_temp.als_orig(_company uuid, _term text, _limit int default 20)
returns table (
  article_id uuid, reference text, designation text, supplier_ref text,
  bin_location text, sale_price_ht numeric, sale_price_ttc numeric, vat_rate numeric,
  mgmt_type text, is_library boolean, matched_barcode text,
  real_qty numeric, reserved_qty numeric, on_order_qty numeric, available_qty numeric, match_rank int
)
language plpgsql stable set search_path = public, pg_temp as $orig$

declare
  s     text := btrim(coalesce(_term, ''));
  lim   int  := least(greatest(coalesce(_limit, 20), 1), 50);
  k     text := regexp_replace(upper(coalesce(_term, '')), '[^A-Z0-9]', '', 'g');
  esc   text;
  words text[];
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if char_length(s) < 2 then
    return;
  end if;
  esc := replace(replace(replace(lower(s), '\', '\\'), '%', '\%'), '_', '\_');
  -- Chaque mot doit se retrouver quelque part (reference, designation FR, original, ref. fournisseur).
  words := array(
    select '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      from regexp_split_to_table(lower(s), '\s+') w
     where w <> ''
  );

  return query
  with bc as (
    select distinct on (b.article_id) b.article_id, b.barcode
      from public.article_barcodes b
      join public.articles a on a.id = b.article_id
     where a.company_id = _company and b.barcode = s
  ), cand as (
    select a.id, bc.barcode,
           case when bc.article_id is not null
                  or upper(a.reference) = upper(s)
                  or (char_length(k) >= 3 and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = k)
                  or upper(coalesce(a.supplier_ref, '')) = upper(s) then 0
                when lower(a.reference) like esc || '%' then 1
                when lower(a.designation) like esc || '%' then 2
                when ' ' || lower(a.designation) like '% ' || esc || '%' then 3
                else 4 end as rk
      from public.articles a
      left join bc on bc.article_id = a.id
     where a.company_id = _company
       and a.is_active
       and (bc.article_id is not null
            or lower(concat_ws(' ', a.reference, a.designation, a.supplier_ref, a.designation_source,
                               a.designation_i18n ->> 'fr')) like all (words))
     order by rk, a.reference
     limit 2000
  ), st as (
    select m.article_id,
           coalesce(sum(case when not m.is_reservation then m.qty_delta else 0 end), 0) as real_q,
           coalesce(sum(case when m.is_reservation then m.qty_delta else 0 end), 0) as res_q
      from public.stock_moves m
     where m.article_id in (select c.id from cand c)
     group by m.article_id
  ), ranked as (
    select c.id, c.barcode, c.rk,
           coalesce(st.real_q, 0) as real_q, coalesce(st.res_q, 0) as res_q
      from cand c
      left join st on st.article_id = c.id
      join public.articles a on a.id = c.id
     order by case when c.rk <= 1 then c.rk else 2 end,
              (coalesce(st.real_q, 0) - coalesce(st.res_q, 0) > 0) desc,
              c.rk,
              a.is_library,
              char_length(a.designation),
              a.reference
     limit lim
  )
  select a.id, a.reference, a.designation, a.supplier_ref, a.bin_location,
         a.sale_price_ht, a.sale_price_ttc, coalesce(a.vat_rate, 21), a.mgmt_type::text, a.is_library,
         r.barcode, r.real_q, r.res_q, oo.q, r.real_q - r.res_q + oo.q, r.rk
    from ranked r
    join public.articles a on a.id = r.id
   cross join lateral (select public._article_on_order_qty(a.id) as q) oo
   order by case when r.rk <= 1 then r.rk else 2 end,
            (r.real_q - r.res_q > 0) desc,
            r.rk,
            a.is_library,
            char_length(a.designation),
            a.reference;
end $orig$;

insert into _t(check_name, result)
select '1a index trigramme articles pose', case when count(*) = 1 then 'ok' else 'KO' end
  from pg_indexes where schemaname = 'public' and indexname = 'idx_articles_search_trgm';

insert into _t(check_name, result)
select '1b texte indexe = texte d''origine pour tous les articles (' || count(*) || ')',
  case when count(*) filter (where public._article_search_txt(a.reference, a.designation, a.supplier_ref, a.designation_source, a.designation_i18n ->> 'fr')
         is distinct from lower(concat_ws(' ', a.reference, a.designation, a.supplier_ref, a.designation_source, a.designation_i18n ->> 'fr'))) = 0
       then 'ok' else 'KO' end
  from public.articles a;

create temp table _q(q text) on commit drop;
insert into _q values ('huile'), ('HUILE moteur'), ('filtre air'), ('fi'), ('96481331'), ('9648'), ('%'), ('_'), ('a_b'),
  ('pneu'), ('kit'), ('zzzzqqq'), ('  bougie  '), ('o-ring'), ('jupe'), ('casque'), ('mo');
insert into _q select distinct reference from (select reference from public.articles where is_active order by md5(id::text) limit 5) s;
insert into _q select distinct left(reference, 5) from (select reference from public.articles where is_active and length(reference) > 6 order by md5(id::text) limit 4) s;
insert into _q select distinct lower(split_part(designation, ' ', 1)) from (select designation from public.articles where is_active and length(split_part(designation, ' ', 1)) >= 4 order by md5(id::text) limit 6) s;
insert into _q select distinct supplier_ref from (select supplier_ref from public.articles where is_active and length(supplier_ref) >= 4 order by md5(id::text) limit 3) s;
insert into _q select distinct split_part(designation, ' ', 1) || ' ' || split_part(designation, ' ', 2) from (select designation from public.articles where is_active and designation like '% %' order by md5(id::text) limit 3) s;
insert into _q select distinct barcode from (select b.barcode from public.article_barcodes b order by md5(b.barcode) limit 2) s;

do $s$ declare co record; qq record; _u uuid; bad int := 0; n int := 0; lim int; begin
  for co in select id from public.companies loop
    select ur.user_id into _u from public.user_roles ur where ur.company_id = co.id limit 1;
    if _u is null then continue; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
    for qq in select q from _q where q is not null loop
      foreach lim in array case when qq.q in ('huile', 'fi', 'kit') then array[20, 50] else array[20] end loop
        n := n + 1;
        if array(select to_jsonb(x) from public.article_line_search(co.id, qq.q, lim) x)
           is distinct from array(select to_jsonb(y) from pg_temp.als_orig(co.id, qq.q, lim) y) then
          bad := bad + 1; raise notice 'KO % %', co.id, qq.q;
        end if;
      end loop;
    end loop;
  end loop;
  insert into _t(check_name, result) values ('2 article_line_search = origine (' || n || ' cas, lignes et ordre)',
    case when bad = 0 and n > 0 then 'ok' else 'KO ' || bad end);
  perform set_config('request.jwt.claims', '', true);
end $s$;
