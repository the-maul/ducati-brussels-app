-- =====================================================================
-- Perf 2 (20/11/2026) -- Recherche d'article d'une ligne (OR, documents de vente, caisse) :
-- index trigramme (pg_trgm).
--
-- Mesure avant (prod, admin ITALBIKE) : article_line_search « huile » 279 ms, « filtre air »
-- 270 ms, « 96481331 » 206 ms, a chaque frappe : le texte recherche (reference, designation,
-- ref. fournisseur, designation d'origine, designation FR) est recalcule pour les ~94 000
-- articles de la societe.
-- Apres : index GIN trigramme sur ce meme texte (`_article_search_txt`, IMMUTABLE, meme
-- expression que dans la fonction). La fonction est reprise mot pour mot de la migration
-- 20261103230000 (identique a la prod, verifie le 20/11) ; seule difference : quand la recherche
-- contient un mot de 3 lettres ou plus, un pre-filtre indexe sur le plus long de ces mots, deja
-- exige par la regle « chaque mot doit se retrouver » -- le resultat est donc identique (essai
-- supabase/tests/perf2_recherche_articles_equivalence.sql). Code-barres : inchange (union).
-- Droits inchanges. A appliquer a un moment calme : l'index se construit sur ~166 000 articles
-- (bloque les ecritures sur articles le temps de la construction, quelques dizaines de secondes).
-- pg_trgm : cree par 20261120111000 (repris ici, idempotent).
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

create or replace function public._article_search_txt(
  _reference text, _designation text, _supplier_ref text, _designation_source text, _designation_fr text)
returns text
language sql
immutable
parallel safe
as $f$
  select lower(concat_ws(' ', _reference, _designation, _supplier_ref, _designation_source, _designation_fr));
$f$;

revoke all on function public._article_search_txt(text, text, text, text, text) from public, anon;
grant execute on function public._article_search_txt(text, text, text, text, text) to authenticated, service_role;

create index if not exists idx_articles_search_trgm on public.articles using gin (
  public._article_search_txt(reference, designation, supplier_ref, designation_source, designation_i18n ->> 'fr') extensions.gin_trgm_ops);

create or replace function public.article_line_search(_company uuid, _term text, _limit int default 20)
returns table (
  article_id uuid, reference text, designation text, supplier_ref text,
  bin_location text, sale_price_ht numeric, sale_price_ttc numeric, vat_rate numeric,
  mgmt_type text, is_library boolean, matched_barcode text,
  real_qty numeric, reserved_qty numeric, on_order_qty numeric, available_qty numeric, match_rank int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$

declare
  s     text := btrim(coalesce(_term, ''));
  lim   int  := least(greatest(coalesce(_limit, 20), 1), 50);
  k     text := regexp_replace(upper(coalesce(_term, '')), '[^A-Z0-9]', '', 'g');
  esc   text;
  words text[];
  pre   text;
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

  -- Perf 2 (20/11/2026) : mot le plus long (3 lettres et plus) pour l'index trigramme.
  select '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%' into pre
    from regexp_split_to_table(lower(s), '\s+') w
   where char_length(w) >= 3
   order by char_length(w) desc, w
   limit 1;

  if pre is null then
    -- Requete d'origine, mot pour mot.
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
  else
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
       -- Perf 2 : pre-filtre indexe (trigramme) sur le mot le plus long, deja exige ci-dessus.
       and a.id in (select x.id from public.articles x
                     where x.company_id = _company
                       and public._article_search_txt(x.reference, x.designation, x.supplier_ref, x.designation_source,
                                                      x.designation_i18n ->> 'fr') like pre
                    union all
                    select bc.article_id from bc)
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
  end if;
end $$;

revoke all on function public.article_line_search(uuid, text, int) from public, anon;
grant execute on function public.article_line_search(uuid, text, int) to authenticated;

analyze public.articles;
