-- =====================================================================
-- M8 — Page OR (retours client du 03/11/2026, ATE001b, mission 10)
--
--   1. Operateur de l'OR = un membre de l'equipe : colonne repair_orders.operator_id
--      (le texte `operator` est garde : ancien OR, impression, repli avant migration).
--   2. Types de reparation reglables : Parametres → Tables → « Types de reparation »
--      (reference_values, table_key = workshop_repair_type), precharges pour chaque societe.
--      repair_orders.repair_type garde le CODE choisi (ancien texte libre affiche tel quel).
--   3. Recherche d'article des lignes (OR, check-up, ventes, caisse) : article_line_search
--      — reference exacte d'abord, puis designation (tous les mots, debut de mot), articles
--      en stock avant les autres, catalogue (librairie) apres, prix TTC renvoye pour en
--      deduire le HT quand seul le TTC est connu (81 089 articles sur 93 784 au 03/11).
--
-- Le lien OR → dossier accident existe deja (accident_files.repair_order_id, 20261103110000).
-- Additif uniquement : 1 colonne, 1 index, 1 trigger, 1 fonction, 11 lignes de parametres
-- par societe. Aucune donnee existante modifiee.
--
-- Essai a blanc (begin / rollback) : voir docs/bible/missions/mission-10-atelier-bout-en-bout.md.
-- Application (apres backup et go) :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103230000_m8_page_or.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Operateur = membre de l'equipe
-- ---------------------------------------------------------------------
alter table public.repair_orders
  add column if not exists operator_id uuid references auth.users(id) on delete set null;

create index if not exists idx_repair_orders_operator on public.repair_orders(operator_id);

comment on column public.repair_orders.operator_id is
  'Membre de l''equipe qui a l''OR a son nom (par defaut l''utilisateur connecte a la creation). Le texte `operator` garde son nom (ancien OR, impression).';

-- Garde : l'operateur doit etre membre de la societe de l'OR.
create or replace function public.repair_orders_operator_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.operator_id is not null
     and (tg_op = 'INSERT' or new.operator_id is distinct from old.operator_id)
     and not exists (select 1 from public.user_roles ur
                      where ur.user_id = new.operator_id and ur.company_id = new.company_id) then
    raise exception 'L''operateur choisi n''est pas membre de la societe.' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.repair_orders_operator_guard() from public, anon, authenticated;

drop trigger if exists trg_repair_orders_operator_guard on public.repair_orders;
create trigger trg_repair_orders_operator_guard before insert or update of operator_id on public.repair_orders
  for each row execute function public.repair_orders_operator_guard();

-- ---------------------------------------------------------------------
-- 2. Types de reparation (Parametres → Tables → Atelier)
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order)
select c.id, 'workshop_repair_type', v.code, v.label, v.sort
  from public.companies c
 cross join (values
   ('entretien',        'Entretien', 10),
   ('reparation',       'Réparation', 20),
   ('garantie_ducati',  'Garantie Ducati', 30),
   ('garantie_magasin', 'Garantie magasin', 40),
   ('accident',         'Accident / carrosserie', 50),
   ('pneus',            'Pneus', 60),
   ('diagnostic',       'Diagnostic', 70),
   ('pdi',              'Préparation moto neuve (PDI)', 80),
   ('oro',              'Remise en état occasion (ORO)', 90),
   ('accessoires',      'Accessoires / montage', 100),
   ('autre',            'Autre', 110)
 ) as v(code, label, sort)
on conflict (company_id, table_key, code) do nothing;

comment on column public.repair_orders.repair_type is
  'Type de reparation : code de reference_values (table_key = workshop_repair_type) ; ancien OR = texte libre affiche tel quel.';

-- ---------------------------------------------------------------------
-- 3. Recherche d'article d'une ligne (OR, check-up, ventes, caisse)
-- ---------------------------------------------------------------------
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
end $$;

revoke all on function public.article_line_search(uuid, text, int) from public, anon;
grant execute on function public.article_line_search(uuid, text, int) to authenticated;

comment on function public.article_line_search(uuid, text, int) is
  'Recherche d''article d''une ligne (OR, check-up, ventes, caisse) : reference / code-barres exact, debut de reference, puis designation (tous les mots) ; en stock d''abord, catalogue apres ; PV HT et TTC (le HT se deduit du TTC quand il manque).';
