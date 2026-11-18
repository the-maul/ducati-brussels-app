-- =====================================================================
-- M13 — Chiffres justes dans les statistiques et le tableau de bord (rattrapage G8, 18/11/2026).
-- Bloquant n° 8 de docs/g8-inventaire comparaison-ventes-caisse-compta.md (§6 « Justesse des chiffres »).
--
-- Avant :
--   * les AVOIRS n'etaient pas deduits (seuls FAC / TIK lus) : CA et marge surestimes ;
--   * les BROUILLONS etaient comptes (`status <> 'annulee'`) ;
--   * le tableau de bord ne comptait que les factures (`FAC`), pas les TICKETS de caisse ;
--   * les quantites etaient prises en valeur absolue (`abs(quantity)`) : un retour gonflait les ventes ;
--   * la marge d'une vente passee utilisait le PAMP d'aujourd'hui ;
--   * report_* laissaient passer un appel sans connexion (`auth.uid() is null or ...`).
--
-- Apres (meme regle partout, une seule fonction `_stats_is_sale`) :
--   * comptent les FAC, TIK et AVO valides (ni brouillon, ni annule) ; une facture compensee par un
--     avoir (`avoir_emis`) reste comptee et l'avoir negatif la compense (meme regle que le journal des
--     ventes, migration 20261103180000). Par prudence, une facture encore `annulee` avec un avoir valide
--     (donnees anterieures a 20261103180000) est aussi gardee, sinon l'avoir serait deduit deux fois ;
--   * la facture d'acompte (FAA) n'est PAS une vente : la facture finale porte la vente entiere ;
--   * quantites signees (avoir et retour en negatif) ;
--   * CA d'une ligne = HT de la ligne ramene au HT du document (remise globale repartie), le port est
--     une ligne a part : la somme des lignes = total HT des documents, quel que soit l'axe ;
--   * cout de la ligne fige a l'enregistrement : nouvelle colonne `document_lines.unit_cost` (PAMP de
--     l'article au moment ou la ligne est ecrite, B5). Les lignes anciennes (sans cout fige) gardent le
--     PAMP courant ; les factures reprises de G8 sans lignes gardent la marge G8 d'en-tete ;
--   * acces : membre de la societe ET role qui voit la page Rapports (grille signee M0-RBAC003 :
--     admin, comptable, vendeur, magasinier, chef d'atelier, marketing ; le mecanicien n'y a pas acces).
--     Le tableau de bord (`dashboard_kpis`) reste ouvert a tout membre (page ouverte a tous les roles).
--
-- Cessions internes : mouvements `cession` (ecran Stock, ORO) et, des que la migration du lot cessions
-- (20261118240000, documents `internal_cessions`) est posee, type / libelle / cout du document de cession
-- et sa main-d'oeuvre (`_stats_cession_facts`, PL/pgSQL : fonctionne avant comme apres cette migration).
--
-- Socle partage avec le module statistiques facon G8 (migration suivante 20261118181000) :
--   type `stats_fact`, `_stats_facts(societe, source, du, au)` (sources : sales, purchases, cessions,
--   moves), `_stats_keep` (filtres), `_stats_dim` (axes).
--
-- Idempotente. NON APPLIQUEE (Simon applique le bloc). A appliquer APRES 20261103180000 (statut
-- `avoir_emis`). Essai a blanc : supabase/tests/m13_statistiques_g8.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cout fige sur la ligne de document (B5)
-- ---------------------------------------------------------------------
alter table public.document_lines add column if not exists unit_cost numeric(14,4);
comment on column public.document_lines.unit_cost is
  'M13 : cout unitaire (PAMP de l article) fige quand la ligne est ecrite ; base de la marge des statistiques. Null = ligne anterieure (PAMP courant utilise).';

create or replace function public._document_line_unit_cost()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.unit_cost is null and new.article_id is not null then
    select a.pamp into new.unit_cost from public.articles a where a.id = new.article_id;
  end if;
  return new;
end $$;
revoke all on function public._document_line_unit_cost() from public, anon, authenticated;

drop trigger if exists trg_document_lines_unit_cost on public.document_lines;
create trigger trg_document_lines_unit_cost
  before insert or update of article_id on public.document_lines
  for each row execute function public._document_line_unit_cost();

-- ---------------------------------------------------------------------
-- 2. Qu'est-ce qu'une vente ? (une seule regle pour tous les chiffres)
-- ---------------------------------------------------------------------
create or replace function public._stats_is_sale(_id uuid, _type text, _status text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when _type = 'AVO' then _status not in ('brouillon', 'annulee')
    when _type in ('FAC', 'TIK') then
      _status not in ('brouillon', 'annulee')
      or (_status = 'annulee' and exists (
            select 1 from public.documents av
             where av.source_document_id = _id and av.doc_type = 'AVO'
               and av.status not in ('brouillon', 'annulee')))
    else false
  end;
$$;
revoke all on function public._stats_is_sale(uuid, text, text) from public, anon, authenticated;

-- Qui voit les statistiques : la grille signee (page Rapports). Admin compris.
create or replace function public._stats_can_read(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_roles ur
     where ur.user_id = auth.uid() and ur.company_id = _company
       and ur.role::text in ('admin', 'comptable', 'vendeur', 'magasinier', 'chef_atelier', 'marketing'));
$$;
revoke all on function public._stats_can_read(uuid) from public, anon;
grant execute on function public._stats_can_read(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Le fait statistique : une ligne de vente, d'achat, de cession ou de mouvement de stock
-- ---------------------------------------------------------------------
do $t$
begin
  if not exists (select 1 from pg_type where typname = 'stats_fact' and typnamespace = 'public'::regnamespace) then
    create type public.stats_fact as (
      source         text,     -- sales | purchases | cessions | moves
      document_id    uuid,
      doc_type       text,     -- FAC, TIK, AVO | REC | CES | type de mouvement
      issue_date     date,
      contact_id     uuid,     -- client (ventes) ou fournisseur (achats)
      contact_label  text,
      operator_label text,
      article_id     uuid,
      reference      text,
      designation    text,
      brand          text,
      family         text,     -- UID famille RR-SS-CC (articles.category_path)
      supplier_id    uuid,
      supplier_label text,
      mgmt_type      text,     -- type de gestion B1
      bin            text,
      line_kind      text,     -- article | labour | other | shipping | header (ventes) ; entree | sortie | cession (mouvements)
      cession_type   text,
      cession_label  text,
      qty            numeric,  -- signee (avoir / retour negatif)
      gross_ht       numeric,  -- quantite x prix unitaire, avant toute remise
      ca_ht          numeric,  -- net, remise globale repartie (achats : montant HT de l achat)
      cost           numeric   -- quantite x cout (PAMP fige, sinon PAMP courant)
    );
  end if;
end $t$;

-- Cessions internes (G8 « Cessions internes ») : sorties de stock en cession (ecran Stock -> Cessions,
-- pieces d'ORO, documents de cession) + main-d'oeuvre et frais imputes au cout de revient (ORO, documents).
-- Les documents de cession (`internal_cessions`, migration 20261118240000 du lot cessions) sont lus s'ils
-- existent : type et libelle du document, cout de la ligne (PAMP ou dernier prix d'achat selon le document).
-- PL/pgSQL : la branche qui lit ces tables n'est preparee que si elles existent (ordre d'application libre).
create or replace function public._stats_cession_facts(_company uuid, _from date, _to date)
returns setof public.stats_fact
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('public.internal_cession_lines') is null then
    return query
    select 'cessions'::text, null::uuid, 'CES'::text, (m.occurred_at at time zone 'Europe/Brussels')::date, null::uuid, null::text,
           p.full_name::text,
           m.article_id, a.reference::text, a.designation::text, a.brand::text, a.category_path::text,
           a.supplier_id, a.supplier_label::text, a.mgmt_type::text, a.bin_location::text,
           'article'::text,
           (case when m.origin = 'oro' then 'ORO' else coalesce(nullif(m.ref, ''), '') end)::text,
           (case when m.origin = 'oro' then 'ORO' else rv.label end)::text,
           (-m.qty_delta)::numeric, 0::numeric, 0::numeric,
           round(-m.qty_delta * coalesce(m.unit_cost, a.pamp, 0), 4)::numeric
      from public.stock_moves m
      join lateral (
        select a.reference, a.designation, a.brand, a.category_path, a.mgmt_type::text as mgmt_type, a.bin_location, a.pamp,
               sp.id as supplier_id,
               coalesce(sp.company_name, nullif(trim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')) as supplier_label
          from public.articles a
          left join public.contacts sp on sp.id = coalesce(a.main_supplier_id,
               (select s.supplier_id from public.article_suppliers s where s.article_id = a.id order by s.created_at limit 1))
         where a.id = m.article_id
      ) a on true
      left join public.profiles p on p.id = m.operator_id
      left join public.reference_values rv
        on rv.company_id = _company and rv.table_key = 'cession_type' and rv.code = m.ref and m.origin is distinct from 'oro'
     where m.company_id = _company and m.move_type = 'cession' and not m.is_reservation
       and m.occurred_at >= (_from::timestamp at time zone 'Europe/Brussels')
       and m.occurred_at <  ((_to + 1)::timestamp at time zone 'Europe/Brussels')
    union all
    select 'cessions'::text, o.id, 'CES'::text, (ol.created_at at time zone 'Europe/Brussels')::date, null::uuid, null::text, null::text,
           ol.article_id, a.reference::text, ol.designation::text, a.brand::text, a.category_path::text,
           a.supplier_id, a.supplier_label::text, a.mgmt_type::text, a.bin_location::text,
           (case when ol.kind = 'piece' then 'article' else 'labour' end)::text, 'ORO'::text, 'ORO'::text,
           ol.quantity::numeric, 0::numeric, 0::numeric, ol.line_cost::numeric
      from public.oro_lines ol
      join public.oro o on o.id = ol.oro_id
      left join lateral (
        select a.reference, a.designation, a.brand, a.category_path, a.mgmt_type::text as mgmt_type, a.bin_location, a.pamp,
               sp.id as supplier_id,
               coalesce(sp.company_name, nullif(trim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')) as supplier_label
          from public.articles a
          left join public.contacts sp on sp.id = coalesce(a.main_supplier_id,
               (select s.supplier_id from public.article_suppliers s where s.article_id = a.id order by s.created_at limit 1))
         where a.id = ol.article_id
      ) a on true
     where o.company_id = _company and ol.kind <> 'piece'
       and ol.created_at >= (_from::timestamp at time zone 'Europe/Brussels')
       and ol.created_at <  ((_to + 1)::timestamp at time zone 'Europe/Brussels');
  else
    return query
    -- pieces sorties en cession ; celles d'un document de cession prennent son type et son cout
    select 'cessions'::text, ic.id, 'CES'::text, (m.occurred_at at time zone 'Europe/Brussels')::date, ic.contact_id, null::text,
           coalesce(nullif(ic.operator_name, ''), p.full_name)::text,
           m.article_id, a.reference::text, a.designation::text, a.brand::text, a.category_path::text,
           a.supplier_id, a.supplier_label::text, a.mgmt_type::text, a.bin_location::text,
           'article'::text,
           (case when ic.id is not null then ic.cession_type
                 when m.origin = 'oro' then 'ORO' else coalesce(nullif(m.ref, ''), '') end)::text,
           (case when ic.id is not null then coalesce(ic.type_label, rv.label)
                 when m.origin = 'oro' then 'ORO' else rv.label end)::text,
           (-m.qty_delta)::numeric, 0::numeric, 0::numeric,
           (case when icl.id is not null then icl.line_cost
                 else round(-m.qty_delta * coalesce(m.unit_cost, a.pamp, 0), 4) end)::numeric
      from public.stock_moves m
      join lateral (
        select a.reference, a.designation, a.brand, a.category_path, a.mgmt_type::text as mgmt_type, a.bin_location, a.pamp,
               sp.id as supplier_id,
               coalesce(sp.company_name, nullif(trim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')) as supplier_label
          from public.articles a
          left join public.contacts sp on sp.id = coalesce(a.main_supplier_id,
               (select s.supplier_id from public.article_suppliers s where s.article_id = a.id order by s.created_at limit 1))
         where a.id = m.article_id
      ) a on true
      left join public.internal_cession_lines icl on icl.stock_move_id = m.id
      left join public.internal_cessions ic on ic.id = icl.cession_id
      left join public.profiles p on p.id = m.operator_id
      left join public.reference_values rv
        on rv.company_id = _company and rv.table_key = 'cession_type'
       and rv.code = coalesce(ic.cession_type, m.ref) and (ic.id is not null or m.origin is distinct from 'oro')
     where m.company_id = _company and m.move_type = 'cession' and not m.is_reservation
       and m.occurred_at >= (_from::timestamp at time zone 'Europe/Brussels')
       and m.occurred_at <  ((_to + 1)::timestamp at time zone 'Europe/Brussels')
    union all
    -- main-d'oeuvre et frais d'un ancien ORO
    select 'cessions'::text, o.id, 'CES'::text, (ol.created_at at time zone 'Europe/Brussels')::date, null::uuid, null::text, null::text,
           ol.article_id, a.reference::text, ol.designation::text, a.brand::text, a.category_path::text,
           a.supplier_id, a.supplier_label::text, a.mgmt_type::text, a.bin_location::text,
           (case when ol.kind = 'piece' then 'article' else 'labour' end)::text, 'ORO'::text, 'ORO'::text,
           ol.quantity::numeric, 0::numeric, 0::numeric, ol.line_cost::numeric
      from public.oro_lines ol
      join public.oro o on o.id = ol.oro_id
      left join lateral (
        select a.reference, a.designation, a.brand, a.category_path, a.mgmt_type::text as mgmt_type, a.bin_location, a.pamp,
               sp.id as supplier_id,
               coalesce(sp.company_name, nullif(trim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')) as supplier_label
          from public.articles a
          left join public.contacts sp on sp.id = coalesce(a.main_supplier_id,
               (select s.supplier_id from public.article_suppliers s where s.article_id = a.id order by s.created_at limit 1))
         where a.id = ol.article_id
      ) a on true
     where o.company_id = _company and ol.kind <> 'piece'
       and ol.created_at >= (_from::timestamp at time zone 'Europe/Brussels')
       and ol.created_at <  ((_to + 1)::timestamp at time zone 'Europe/Brussels')
    union all
    -- main-d'oeuvre et frais d'un document de cession valide (date de validation)
    select 'cessions'::text, ic.id, 'CES'::text, (ic.validated_at at time zone 'Europe/Brussels')::date, ic.contact_id, null::text,
           ic.operator_name::text,
           icl.article_id, coalesce(a.reference, icl.reference)::text, icl.designation::text, a.brand::text, a.category_path::text,
           a.supplier_id, a.supplier_label::text, a.mgmt_type::text, a.bin_location::text,
           (case when icl.kind = 'mo' then 'labour' else 'other' end)::text,
           ic.cession_type::text, coalesce(ic.type_label, rv.label)::text,
           icl.quantity::numeric, 0::numeric, 0::numeric, icl.line_cost::numeric
      from public.internal_cession_lines icl
      join public.internal_cessions ic on ic.id = icl.cession_id
      left join lateral (
        select a.reference, a.designation, a.brand, a.category_path, a.mgmt_type::text as mgmt_type, a.bin_location, a.pamp,
               sp.id as supplier_id,
               coalesce(sp.company_name, nullif(trim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')) as supplier_label
          from public.articles a
          left join public.contacts sp on sp.id = coalesce(a.main_supplier_id,
               (select s.supplier_id from public.article_suppliers s where s.article_id = a.id order by s.created_at limit 1))
         where a.id = icl.article_id
      ) a on true
      left join public.reference_values rv
        on rv.company_id = _company and rv.table_key = 'cession_type' and rv.code = ic.cession_type
     where ic.company_id = _company and icl.kind in ('mo', 'frais') and ic.status in ('valide', 'archive')
       and ic.validated_at >= (_from::timestamp at time zone 'Europe/Brussels')
       and ic.validated_at <  ((_to + 1)::timestamp at time zone 'Europe/Brussels');
  end if;
end $$;
revoke all on function public._stats_cession_facts(uuid, date, date) from public, anon, authenticated;

create or replace function public._stats_facts(_company uuid, _source text, _from date, _to date)
returns setof public.stats_fact
language sql stable security definer set search_path = public, pg_temp as $$
  with d as (
    select d.id, d.doc_type, d.issue_date, d.contact_id, d.total_ht,
           coalesce(d.shipping_ht, 0) as shipping_ht, d.marge,
           coalesce(nullif(trim(d.operator), ''), p.full_name) as operator_label,
           coalesce(c.company_name, nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
                    d.code_client_legacy) as contact_label,
           coalesce(s.lines_ht, 0) as lines_ht, coalesce(s.n, 0) as n_lines
      from public.documents d
      left join public.contacts c on c.id = d.contact_id
      left join public.profiles p on p.id = d.operator_user_id
      left join lateral (select sum(x.line_ht) as lines_ht, count(*) as n
                           from public.document_lines x where x.document_id = d.id) s on true
     where _source = 'sales' and d.company_id = _company and d.issue_date between _from and _to
       and public._stats_is_sale(d.id, d.doc_type, d.status)
  ),
  po as (
    select po.id, coalesce(po.receipt_date, po.created_at::date) as rdate, po.supplier_id,
           coalesce(po.global_discount_pct, 0) as gdisc, coalesce(po.shipping_ht, 0) as shipping_ht,
           coalesce(sc.company_name, nullif(trim(coalesce(sc.first_name, '') || ' ' || coalesce(sc.last_name, '')), '')) as supplier_label
      from public.purchase_orders po
      left join public.contacts sc on sc.id = po.supplier_id
     where _source = 'purchases' and po.company_id = _company and po.doc_type = 'REC'
       and po.status not in ('brouillon', 'annulee')
       and coalesce(po.receipt_date, po.created_at::date) between _from and _to
  )
  -- VENTES : lignes
  select 'sales'::text, d.id, d.doc_type::text, d.issue_date, d.contact_id, d.contact_label::text, d.operator_label::text,
         l.article_id, coalesce(a.reference, l.reference)::text, coalesce(a.designation, l.designation)::text,
         a.brand::text, a.category_path::text, a.supplier_id, a.supplier_label::text, a.mgmt_type::text, a.bin_location::text,
         (case when l.line_type = 'main_oeuvre' or a.mgmt_type = 'T' then 'labour'
               when l.article_id is not null then 'article' else 'other' end)::text,
         null::text, null::text,
         l.quantity::numeric,
         round(l.quantity * l.unit_price_ht, 4)::numeric,
         round(l.line_ht * case when d.lines_ht <> 0 then (d.total_ht - d.shipping_ht) / d.lines_ht else 1 end, 4)::numeric,
         (case when l.article_id is null or a.mgmt_type = 'F' then 0
               else round(coalesce(l.unit_cost, a.pamp, 0) * l.quantity, 4) end)::numeric
    from d
    join public.document_lines l on l.document_id = d.id
    left join lateral (
      select a.reference, a.designation, a.brand, a.category_path, a.mgmt_type::text as mgmt_type, a.bin_location, a.pamp,
             sp.id as supplier_id,
             coalesce(sp.company_name, nullif(trim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')) as supplier_label
        from public.articles a
        left join public.contacts sp on sp.id = coalesce(a.main_supplier_id,
             (select s.supplier_id from public.article_suppliers s where s.article_id = a.id order by s.created_at limit 1))
       where a.id = l.article_id
    ) a on true
   where coalesce(l.line_type, 'article') not in ('texte', 'vide')
     and (l.line_ht <> 0 or l.quantity <> 0)
  union all
  -- VENTES : port (une ligne par document)
  select 'sales', d.id, d.doc_type, d.issue_date, d.contact_id, d.contact_label, d.operator_label,
         null::uuid, null::text, null::text, null::text, null::text, null::uuid, null::text, null::text, null::text,
         'shipping'::text, null::text, null::text, 0::numeric, d.shipping_ht::numeric, d.shipping_ht::numeric, 0::numeric
    from d where d.n_lines > 0 and d.shipping_ht <> 0
  union all
  -- VENTES : document chiffre dont les lignes sont a 0 (ecart, rare)
  select 'sales', d.id, d.doc_type, d.issue_date, d.contact_id, d.contact_label, d.operator_label,
         null, null, null, null, null, null, null, null, null,
         'other', null, null, 0, (d.total_ht - d.shipping_ht)::numeric, (d.total_ht - d.shipping_ht)::numeric, 0
    from d where d.n_lines > 0 and d.lines_ht = 0 and d.total_ht - d.shipping_ht <> 0
  union all
  -- VENTES : facture reprise de G8 sans lignes (en-tete seul) : marge G8 importee
  select 'sales', d.id, d.doc_type, d.issue_date, d.contact_id, d.contact_label, d.operator_label,
         null, null, null, null, null, null, null, null, null,
         'header', null, null, 0, d.total_ht::numeric, d.total_ht::numeric, (d.total_ht - coalesce(d.marge, 0))::numeric
    from d where d.n_lines = 0
  union all
  -- ACHATS : lignes de reception (montant net de la remise globale)
  select 'purchases', po.id, 'REC', po.rdate, po.supplier_id, po.supplier_label::text, null::text,
         pl.article_id, coalesce(a.reference, pl.supplier_ref)::text, coalesce(a.designation, pl.designation)::text,
         a.brand::text, a.category_path::text, po.supplier_id, po.supplier_label::text, a.mgmt_type::text, a.bin_location::text,
         (case when pl.article_id is not null then 'article' else 'other' end)::text, null::text, null::text,
         pl.quantity::numeric, round(pl.quantity * pl.unit_price_ht, 4)::numeric,
         round(pl.line_ht * (1 - po.gdisc / 100), 4)::numeric, round(pl.line_ht * (1 - po.gdisc / 100), 4)::numeric
    from po
    join public.purchase_lines pl on pl.order_id = po.id
    left join lateral (
      select a.reference, a.designation, a.brand, a.category_path, a.mgmt_type::text as mgmt_type, a.bin_location, a.pamp,
             sp.id as supplier_id,
             coalesce(sp.company_name, nullif(trim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')) as supplier_label
        from public.articles a
        left join public.contacts sp on sp.id = coalesce(a.main_supplier_id,
             (select s.supplier_id from public.article_suppliers s where s.article_id = a.id order by s.created_at limit 1))
       where a.id = pl.article_id
    ) a on true
  union all
  select 'purchases', po.id, 'REC', po.rdate, po.supplier_id, po.supplier_label, null,
         null, null, null, null, null, po.supplier_id, po.supplier_label, null, null,
         'shipping', null, null, 0, po.shipping_ht::numeric, po.shipping_ht::numeric, po.shipping_ht::numeric
    from po where po.shipping_ht <> 0
  union all
  -- CESSIONS INTERNES (cadeau, demo, atelier, garantie, ORO, documents de cession)
  select * from public._stats_cession_facts(_company, _from, _to) where _source = 'cessions'
  union all
  -- MOUVEMENTS DE STOCK (entrees / sorties) : tableau de bord mois par mois, stock
  select 'moves', null::uuid, m.move_type::text, (m.occurred_at at time zone 'Europe/Brussels')::date, null::uuid, null::text,
         null::text,
         m.article_id, a.reference::text, a.designation::text, a.brand::text, a.category_path::text,
         a.supplier_id, a.supplier_label::text, a.mgmt_type::text, a.bin_location::text,
         m.move_type::text, null::text, null::text,
         m.qty_delta::numeric, 0::numeric, 0::numeric, round(m.qty_delta * coalesce(a.pamp, 0), 4)::numeric
    from public.stock_moves m
    join lateral (
      select a.reference, a.designation, a.brand, a.category_path, a.mgmt_type::text as mgmt_type, a.bin_location, a.pamp,
             sp.id as supplier_id,
             coalesce(sp.company_name, nullif(trim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')) as supplier_label
        from public.articles a
        left join public.contacts sp on sp.id = coalesce(a.main_supplier_id,
             (select s.supplier_id from public.article_suppliers s where s.article_id = a.id order by s.created_at limit 1))
       where a.id = m.article_id
    ) a on true
   where _source = 'moves' and m.company_id = _company and not m.is_reservation
     and m.occurred_at >= (_from::timestamp at time zone 'Europe/Brussels')
     and m.occurred_at <  ((_to + 1)::timestamp at time zone 'Europe/Brussels');
$$;
revoke all on function public._stats_facts(uuid, text, date, date) from public, anon, authenticated;
comment on function public._stats_facts(uuid, text, date, date) is
  'M13 : faits statistiques (ventes FAC/TIK/AVO valides, receptions, cessions, mouvements). Interne : appelee par les fonctions stats_* et report_* qui controlent l acces.';

-- Filtres de selection (G8 : famille, fournisseur, marque, reference, designation, casier, client,
-- operateur, type de cession, vehicules seuls / sauf vehicules, reprises exclues, type de document).
create or replace function public._stats_keep(f public.stats_fact, _f jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(
       (coalesce(_f->>'family', '') = '' or upper(f.family) = upper(_f->>'family') or upper(f.family) like upper(_f->>'family') || '-%')
   and (coalesce(_f->>'supplier_id', '') = '' or f.supplier_id::text = _f->>'supplier_id')
   and (coalesce(_f->>'brand', '') = '' or upper(trim(f.brand)) = upper(trim(_f->>'brand')))
   and (coalesce(_f->>'reference', '') = '' or f.reference ilike '%' || (_f->>'reference') || '%')
   and (coalesce(_f->>'designation', '') = '' or f.designation ilike '%' || (_f->>'designation') || '%')
   and (coalesce(_f->>'bin', '') = '' or f.bin ilike '%' || (_f->>'bin') || '%')
   and (coalesce(_f->>'article_id', '') = '' or f.article_id::text = _f->>'article_id')
   and (coalesce(_f->>'contact_id', '') = '' or f.contact_id::text = _f->>'contact_id')
   and (coalesce(_f->>'operator', '') = '' or f.operator_label = _f->>'operator')
   and (coalesce(_f->>'cession_type', '') = '' or f.cession_type = _f->>'cession_type')
   and (coalesce(_f->>'doc_type', '') = '' or f.doc_type = _f->>'doc_type')
   and (coalesce(_f->>'kind', '') = '' or f.line_kind = _f->>'kind')
   and (case coalesce(_f->>'vehicles', 'all')
          when 'only' then coalesce(f.mgmt_type, '') in ('V', 'O', 'P', 'D')
          when 'exclude' then coalesce(f.mgmt_type, '') not in ('V', 'O', 'P', 'D')
          else true end)
   and (coalesce((_f->>'exclude_reprises')::boolean, false) = false or coalesce(f.mgmt_type, '') <> 'R'),
  false);
$$;
revoke all on function public._stats_keep(public.stats_fact, jsonb) from public, anon, authenticated;

-- Axes de classement : cle (pour regrouper) et libelle. Cle vide = « sans » ; les cles en « # »
-- (port, facture sans detail, ligne libre, main-d oeuvre) sont traduites par l ecran.
create or replace function public._stats_dim(_dim text, f public.stats_fact, out key text, out label text)
language sql immutable set search_path = public, pg_temp as $$
  select k, l from (
    select
      case _dim
        when 'supplier'  then coalesce(f.supplier_id::text, '')
        when 'brand'     then coalesce(upper(nullif(trim(f.brand), '')), '')
        when 'rayon'     then case when f.family ~* '^[0-9A-Z]{1,2}-[0-9A-Z]{1,2}-[0-9A-Z]{1,2}$' then upper(split_part(f.family, '-', 1)) else '' end
        when 'sousrayon' then case when f.family ~* '^[0-9A-Z]{1,2}-[0-9A-Z]{1,2}-[0-9A-Z]{1,2}$' then upper(split_part(f.family, '-', 1) || '-' || split_part(f.family, '-', 2)) else '' end
        when 'categorie' then case when f.family ~* '^[0-9A-Z]{1,2}-[0-9A-Z]{1,2}-[0-9A-Z]{1,2}$' then upper(f.family) else '' end
        when 'client'    then coalesce(f.contact_id::text, case when f.contact_label is not null then '~' || f.contact_label end, '')
        when 'operator'  then coalesce(f.operator_label, '')
        when 'article'   then coalesce(f.article_id::text, '#' || f.line_kind)
        when 'month'     then to_char(f.issue_date, 'YYYY-MM')
        when 'day'       then to_char(f.issue_date, 'YYYY-MM-DD')
        when 'year'      then to_char(f.issue_date, 'YYYY')
        when 'doctype'   then coalesce(f.doc_type, '')
        when 'cession'   then coalesce(f.cession_type, '')
        else '' end as k,
      case _dim
        when 'supplier'  then f.supplier_label
        when 'brand'     then nullif(trim(f.brand), '')
        when 'client'    then f.contact_label
        when 'operator'  then f.operator_label
        when 'article'   then case when f.article_id is not null then trim(coalesce(f.reference, '') || ' ' || coalesce(f.designation, '')) else f.designation end
        when 'cession'   then coalesce(f.cession_label, f.cession_type)
        else null end as l
  ) x;
$$;
revoke all on function public._stats_dim(text, public.stats_fact) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Marge d'un document (B5) : lignes au cout fige, sinon marge G8 importee
-- ---------------------------------------------------------------------
create or replace function public._doc_margin(_doc uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select d.total_ht
            - sum(case when l.article_id is null or a.mgmt_type = 'F' then 0
                       else coalesce(l.unit_cost, a.pamp, 0) * l.quantity end)
       from public.documents d
       join public.document_lines l on l.document_id = d.id
       left join public.articles a on a.id = l.article_id
      where d.id = _doc
      group by d.total_ht),
    (select marge from public.documents where id = _doc),
    0);
$$;
revoke all on function public._doc_margin(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Tableau de bord du jour : tickets comptes, avoirs deduits, brouillons exclus
-- ---------------------------------------------------------------------
create or replace function public.dashboard_kpis(_company uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with sale as (
    select d.doc_type, d.issue_date, d.total_ttc
      from public.documents d
     where d.company_id = _company
       and d.issue_date >= date_trunc('month', current_date)::date
       and public._stats_is_sale(d.id, d.doc_type, d.status)
  )
  select jsonb_build_object(
    'revenue_today', coalesce((select sum(total_ttc) from sale where issue_date = current_date), 0),
    'revenue_month', coalesce((select sum(total_ttc) from sale), 0),
    'invoices_month', coalesce((select count(*) from sale where doc_type in ('FAC', 'TIK')), 0),
    'credit_notes_month', coalesce((select count(*) from sale where doc_type = 'AVO'), 0),
    'or_open', coalesce((select count(*) from public.repair_orders
      where company_id = _company and status not in ('facture', 'annule')), 0),
    'stock_value', coalesce((select sum(stock_value) from public.article_stock_list(_company)), 0),
    'vehicles_in_stock', coalesce((select count(*) from public.vehicles
      where company_id = _company and status in ('stock_vn', 'stock_vo', 'depot_vente', 'demo', 'courtoisie')), 0),
    'receivables', coalesce((select sum(total_ttc - paid_amount) from public.documents
      where company_id = _company and doc_type in ('FAC', 'TIK') and status not in ('brouillon', 'annulee')
        and total_ttc - paid_amount > 0.005), 0)
  )
  where public.is_member(_company);
$$;
revoke all on function public.dashboard_kpis(uuid) from public, anon;
grant execute on function public.dashboard_kpis(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Rapports existants (/reports) recables sur la meme regle
-- ---------------------------------------------------------------------
create or replace function public.monthly_revenue(_company uuid)
returns table(month text, revenue_ttc numeric, invoices int)
language sql stable security definer set search_path = public, pg_temp as $$
  select to_char(date_trunc('month', d.issue_date), 'YYYY-MM') as month,
         round(sum(d.total_ttc), 2),
         (count(*) filter (where d.doc_type in ('FAC', 'TIK')))::int
    from public.documents d
   where d.company_id = _company and public._stats_can_read(_company)
     and d.issue_date >= (date_trunc('month', current_date) - interval '11 months')
     and public._stats_is_sale(d.id, d.doc_type, d.status)
   group by 1 order by 1;
$$;
revoke all on function public.monthly_revenue(uuid) from public, anon;
grant execute on function public.monthly_revenue(uuid) to authenticated;

create or replace function public.top_articles(_company uuid, _from date, _to date, _limit int default 15)
returns table(article_id uuid, reference text, designation text, qty numeric, revenue_ht numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.article_id, max(f.reference), max(f.designation), round(sum(f.qty), 2), round(sum(f.ca_ht), 2)
    from public._stats_facts(_company, 'sales', _from, _to) f
   where public._stats_can_read(_company) and f.article_id is not null
   group by f.article_id
  having sum(f.ca_ht) <> 0 or sum(f.qty) <> 0
   order by sum(f.ca_ht) desc
   limit _limit;
$$;
revoke all on function public.top_articles(uuid, date, date, int) from public, anon;
grant execute on function public.top_articles(uuid, date, date, int) to authenticated;

-- Ventes par axe (ancien ecran) : marque / rayon / article (quantites) ; client / operateur / mois
-- (nombre de factures et tickets). Avoirs deduits, brouillons exclus.
create or replace function public.report_sales_by(_company uuid, _from date, _to date, _dim text)
returns table(label text, qty numeric, ca_ht numeric, margin numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
           case _dim
             when 'brand' then nullif(trim(f.brand), '')
             when 'category' then f.family
             when 'article' then case when f.article_id is not null then trim(coalesce(f.reference, '') || ' ' || coalesce(f.designation, '')) else f.designation end
             when 'client' then f.contact_label
             when 'operator' then f.operator_label
             else to_char(f.issue_date, 'YYYY-MM') end,
           case _dim when 'brand' then '(sans marque)' when 'category' then '(sans rayon)'
                     when 'client' then 'Comptoir' when 'operator' then '(n/a)' else '—' end) as label,
         case when _dim in ('brand', 'category', 'article')
              then round(sum(f.qty) filter (where f.line_kind in ('article', 'labour', 'other')), 2)
              else (count(distinct f.document_id) filter (where f.doc_type in ('FAC', 'TIK')))::numeric end,
         round(sum(f.ca_ht), 2),
         round(sum(f.ca_ht - f.cost), 2)
    from public._stats_facts(_company, 'sales', _from, _to) f
   where public._stats_can_read(_company)
     and (_dim not in ('brand', 'category', 'article') or f.line_kind in ('article', 'labour', 'other'))
   group by 1
   order by 3 desc;
$$;
revoke all on function public.report_sales_by(uuid, date, date, text) from public, anon;
grant execute on function public.report_sales_by(uuid, date, date, text) to authenticated;

create or replace function public.report_period_compare(_company uuid, _from date, _to date)
returns table(period text, ca_ht numeric, margin numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select 'N', round(coalesce(sum(f.ca_ht), 0), 2), round(coalesce(sum(f.ca_ht - f.cost), 0), 2)
    from public._stats_facts(_company, 'sales', _from, _to) f
   where public._stats_can_read(_company)
  union all
  select 'N-1', round(coalesce(sum(f.ca_ht), 0), 2), round(coalesce(sum(f.ca_ht - f.cost), 0), 2)
    from public._stats_facts(_company, 'sales', (_from - interval '1 year')::date, (_to - interval '1 year')::date) f
   where public._stats_can_read(_company);
$$;
revoke all on function public.report_period_compare(uuid, date, date) from public, anon;
grant execute on function public.report_period_compare(uuid, date, date) to authenticated;

-- Indicateurs : factures + tickets (avoirs non comptes comme ventes mais deduits du CA),
-- panier moyen TTC = CA TTC net / nombre de factures et tickets.
create or replace function public.report_indicators(_company uuid, _from date, _to date)
returns table(invoices bigint, ca_ht numeric, avg_basket numeric, margin numeric, margin_pct numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with docs as (
    select d.doc_type, d.total_ht, d.total_ttc
      from public.documents d
     where d.company_id = _company and public._stats_can_read(_company)
       and d.issue_date between _from and _to
       and public._stats_is_sale(d.id, d.doc_type, d.status)
  ),
  m as (
    select coalesce(sum(f.ca_ht - f.cost), 0) as marg
      from public._stats_facts(_company, 'sales', _from, _to) f
     where public._stats_can_read(_company)
  ),
  agg as (
    select count(*) filter (where doc_type in ('FAC', 'TIK')) as n,
           coalesce(sum(total_ht), 0) as ht, coalesce(sum(total_ttc), 0) as ttc
      from docs
  )
  select agg.n::bigint, round(agg.ht, 2),
         case when agg.n > 0 then round(agg.ttc / agg.n, 2) else 0 end,
         round(m.marg, 2),
         case when agg.ht <> 0 then round(100 * m.marg / agg.ht, 1) else 0 end
    from agg, m;
$$;
revoke all on function public.report_indicators(uuid, date, date) from public, anon;
grant execute on function public.report_indicators(uuid, date, date) to authenticated;

-- Taux de transformation : brouillons exclus, bon de commande (BC) ajoute.
create or replace function public.report_transformation(_company uuid, _from date, _to date)
returns table(doc_type text, created bigint, converted bigint, rate numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.doc_type, count(*)::bigint,
         count(*) filter (where d.status = 'converti')::bigint,
         case when count(*) > 0 then round(100.0 * count(*) filter (where d.status = 'converti') / count(*), 1) else 0 end
    from public.documents d
   where d.company_id = _company and public._stats_can_read(_company)
     and d.doc_type in ('DEV', 'BC', 'RES', 'BL') and d.status <> 'brouillon'
     and d.issue_date between _from and _to
   group by d.doc_type
   order by d.doc_type;
$$;
revoke all on function public.report_transformation(uuid, date, date) from public, anon;
grant execute on function public.report_transformation(uuid, date, date) to authenticated;
