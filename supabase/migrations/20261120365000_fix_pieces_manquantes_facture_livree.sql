-- =====================================================================
-- Constat du 20/11/2026 (test OR TESTOR-2026-00001 -> facture TESTFAC-2026-00006, ItalTest) :
-- la facture validee affichait « 2 piece(s) manquante(s) pour ce client, pas encore commandee(s) »
-- alors que le filtre et l'huile etaient montes et factures.
--
-- Cause : _document_order_needs RENDAIT au stock ce que le document avait deja sorti (facture /
-- ticket / BL valides) puis comparait le besoin a ce stock « d'avant ». Sur un stock a 0, la facture
-- sort 1 filtre (reel -1) : stock d'avant = 0 -> 1 manquant, alors que la piece est deja servie au
-- client (le stock negatif releve du reassort, pas d'une commande client).
--
-- Regle (comme G8 : ce qui est facture/livre est servi) : la quantite deja SORTIE par le document
-- est deduite du besoin ; le libre est le stock reel moins les reservations des AUTRES documents
-- (la reservation du document lui est toujours rendue). Sans sortie propre (devis, commande,
-- reservation, facture brouillon) : resultat identique a avant.
--   manquant = max(besoin - deja_sorti - max(libre, 0) - en_commande - brouillons, 0)
-- Miroir TS : src/modules/orders/from-document.ts (missingQty, deliveredQty) ;
-- tests : tests/orders-from-document.test.ts, supabase/tests/m6_pieces_manquantes_facture_livree.sql.
-- Meme signature, rejouable. Redefinit : _document_order_needs (20260919350000).
-- =====================================================================

create or replace function public._document_order_needs(_document uuid)
returns table(article_id uuid, reference text, designation text, mgmt_type text, line_ids uuid[],
              qty_needed numeric, real_qty numeric, reserved_qty numeric, free_qty numeric,
              on_order_qty numeric, draft_qty numeric, missing_qty numeric, supplier_id uuid,
              supplier_name text, unit_price_ht numeric, vat_rate numeric, bin_location text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d public.documents%rowtype;
begin
  select * into d from public.documents where id = _document;
  if not found then
    return;
  end if;
  return query
  with lines as (
    select l.article_id,
           array_agg(l.id order by l.sort_order) as line_ids,
           sum(l.quantity) as qty,
           sum(l.line_ht) as ht,
           max(l.vat_rate) as vat,
           (array_agg(l.designation order by l.sort_order))[1] as des
      from public.document_lines l
     where l.document_id = d.id
       and coalesce(l.line_type, 'article') = 'article'
       and l.article_id is not null
       and l.quantity > 0
     group by l.article_id
  ), own as (
    -- Ce que le document a lui-meme reserve (RES / BL) ou sorti (FAC / TIK / BL).
    select m.article_id,
           coalesce(sum(m.qty_delta) filter (where m.is_reservation), 0) as own_reserved,
           coalesce(sum(m.qty_delta) filter (where not m.is_reservation), 0) as own_real
      from public.stock_moves m
     where d.number is not null and m.ref = d.number and m.company_id = d.company_id
       and m.article_id in (select lines.article_id from lines)
     group by m.article_id
  ), chain as (
    select c.document_id from public._document_chain(d.id) c
  ), drafts as (
    select pl.article_id, sum(pl.qty_client) as q
      from public.part_order_lines pl
      join public.part_orders o on o.id = pl.order_id
     where o.company_id = d.company_id
       and o.dispatch_status = 'brouillon'
       and pl.article_id in (select lines.article_id from lines)
       and ((d.contact_id is not null and o.contact_id = d.contact_id)
            or o.source_document_id in (select chain.document_id from chain))
     group by pl.article_id
  ), calc as (
    select a.id as aid, a.reference as ref, coalesce(nullif(btrim(a.designation), ''), lines.des) as des,
           a.mgmt_type::text as mt, lines.line_ids as lids, lines.qty,
           st.real_qty as rq, st.reserved_qty as resq,
           st.real_qty - (st.reserved_qty - coalesce(own.own_reserved, 0)) as free,
           least(greatest(-coalesce(own.own_real, 0), 0), greatest(lines.qty, 0)) as delivered,
           public.article_on_order_for(a.id, d.contact_id, d.id) as oo,
           coalesce(drafts.q, 0) as dq,
           a.main_supplier_id as sid,
           coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as sname,
           case when lines.qty > 0 then round(lines.ht / lines.qty, 3) else 0 end as pu,
           coalesce(lines.vat, a.vat_rate, 21) as vat,
           a.bin_location as bin
      from lines
      join public.articles a on a.id = lines.article_id
      left join own on own.article_id = a.id
      left join drafts on drafts.article_id = a.id
      left join public.contacts c on c.id = a.main_supplier_id
      cross join lateral public.article_stock(a.id) st
     where a.mgmt_type::text in ('A', 'N')
  )
  select calc.aid, calc.ref, calc.des, calc.mt, calc.lids,
         calc.qty, calc.rq, calc.resq, calc.free, calc.oo, calc.dq,
         greatest(calc.qty - calc.delivered - greatest(calc.free, 0) - calc.oo - calc.dq, 0),
         calc.sid, calc.sname, calc.pu, calc.vat, calc.bin
    from calc
   order by calc.ref;
end $$;

revoke all on function public._document_order_needs(uuid) from public, anon, authenticated;

comment on function public._document_order_needs(uuid) is
  'Pieces d''un document a commander pour le client : besoin - deja sorti par le document - libre (reel - reservations des autres documents) - en commande - brouillons. Constat du 20/11/2026 : une facture validee ne reclame plus les pieces qu''elle a servies.';
