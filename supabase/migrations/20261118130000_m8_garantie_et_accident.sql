-- =====================================================================
-- M8 — Rattrapage G8 (18/11/2026) : OR GARANTIE (B10) et OR ACCIDENT cote assureur.
-- Lot « lot-g8-garantie-accident ». Sources : docs/g8-inventaire/07-atelier.md §1, §11, §12, §15,
-- 04-fournisseurs-achats.md (Historique garantie), 02-articles.md (fiche fournisseur › Garantie),
-- parcours 18 et 19 ; comparaison-atelier-parc.md §4, §5, bloquants #8 et #13.
--
-- 1. OR garantie
--    - type de cession garantie sur l'OR (`warranty_cession_code` = code de la table « Types de
--      cession interne » : 05 garantie fournisseur, 06 garantie magasin / atelier, 07 geste
--      commercial) + commentaire de la demande (« Demande de garantie pour le chassis … ») ;
--    - par ligne : `is_warranty` (existant, la ligne « G » a 0 € pour le client) + decision de la
--      ligne en cas de REFUS PARTIEL (`warranty_decision` accepte / refuse : une ligne refusee est
--      re-routee vers le client, facturee a son prix) ; un REFUS TOTAL re-route toutes les lignes ;
--    - imputation a la FACTURATION de l'OR (declencheur, meme transaction que le passage
--      « facture ») : chaque ligne couverte garde son cout (pieces : PAMP x qte, et PA x qte ;
--      main-d'oeuvre : heures x taux MO garantie) et sa valeur au prix de vente ;
--    - taux MO garantie : Parametres → Tables → « Garantie atelier », code `mo`
--      (`hourly_rate_ht`, precharge 46,94 € HT = MO_ATELIER GARANTIE releve dans G8, A CONFIRMER).
-- 2. Retours / remboursements constructeur (`warranty_returns`) : une ligne par piece prise en
--    charge en « garantie fournisseur » (05), creee a l'imputation (etat « attente remboursement »),
--    suivie par fournisseur et en historique global (remboursé, échangé, attente remboursement,
--    attente échange ; prise en charge, reception, facture d'achat, BL, PAUHT, n° ticket, montant).
--    Vue `warranty_lines_v` (liste « Garanties ») et fonction `warranty_stats_by_client`
--    (« Garanties / CA »).
-- 3. OR accident : fichier des cabinets d'assurance et des experts (`insurance_parties` : fiche
--    complete, compte comptable, tarif) ; sur le DOSSIER ACCIDENT existant (`accident_files`, un
--    par OR accident — on ne le dedouble pas) : cabinet, expert, date de passage, franchise en
--    montant ou en %, valeur venale, cote, demarrage des travaux accepte (qui, quand).
--
-- NON TRANCHE (rapport du lot, « A trancher ») : le statut comptable de la cession 05
-- « garantie fournisseur » (G8 : non comptabilisee ; DMS : comptabilisee). Cette migration ne
-- touche PAS a la colonne `accounted` des types de cession et ne passe aucune ecriture comptable.
--
-- Prerequis : 20261031110000 (check-up, fonction repair_order_write_lines), 20261103110000
-- (dossiers accident) et 20261118110000 (temps MO : colonnes reprises par repair_order_write_lines)
-- — anterieures, donc appliquees avant par `db push`.
-- STRICTEMENT ADDITIVE ET IDEMPOTENTE. NE PAS APPLIQUER depuis un agent : Simon l'applique en bloc.
-- Essai a blanc : supabase/tests/m8_garantie_et_accident.sql (dans une transaction annulee).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. OR garantie : en-tete et lignes
-- ---------------------------------------------------------------------
alter table public.repair_orders
  add column if not exists warranty_cession_code text,
  add column if not exists warranty_note         text,
  add column if not exists warranty_imputed_at   timestamptz;

comment on column public.repair_orders.warranty_cession_code is
  'Type de cession garantie de l''OR (reference_values cession_type : 05 garantie fournisseur, 06 garantie magasin / atelier, 07 geste commercial). G8 : onglet Garantie › Cession.';
comment on column public.repair_orders.warranty_note is
  'Commentaire de la demande de garantie (pre-rempli « Demande de garantie pour le chassis … immat … », comme G8).';
comment on column public.repair_orders.warranty_imputed_at is
  'Imputation garantie faite (a la facturation de l''OR) : couts figes sur les lignes couvertes.';

create index if not exists idx_ro_warranty on public.repair_orders(company_id, warranty_status)
  where warranty_status <> 'aucune' or warranty_cession_code is not null;

alter table public.repair_order_lines
  add column if not exists warranty_decision text,
  add column if not exists warranty_cost_ht  numeric(14,2),
  add column if not exists warranty_pa_ht    numeric(14,2),
  add column if not exists warranty_sale_ht  numeric(14,2);

alter table public.repair_order_lines drop constraint if exists repair_order_lines_warranty_decision_check;
alter table public.repair_order_lines
  add constraint repair_order_lines_warranty_decision_check
  check (warranty_decision is null or warranty_decision in ('accepte', 'refuse'));

comment on column public.repair_order_lines.warranty_decision is
  'Refus partiel (B10) : accepte = reste en garantie ; refuse = re-routee vers le client (facturee a son prix). Null = suit la decision de l''OR.';
comment on column public.repair_order_lines.warranty_cost_ht is
  'Cout fige a l''imputation : piece = PAMP x quantite ; main-d''oeuvre = heures x taux MO garantie.';
comment on column public.repair_order_lines.warranty_pa_ht is
  'Piece : dernier prix d''achat x quantite (PAHT) ; main-d''oeuvre : = warranty_cost_ht.';
comment on column public.repair_order_lines.warranty_sale_ht is
  'Valeur au prix de vente HT (ce que le client aurait paye), remise deduite.';

-- Les lignes de l'OR sont reecrites en une transaction : la decision de ligne y entre.
-- Fusion avec le lot « temps MO » (20261118110000, pose AVANT celle-ci) : la fonction garde aussi
-- le temps de main-d'oeuvre (mecanicien, heures facturees / passees / internes / garanties, date)
-- et reprend celui des cartes du check-up par `checkup_key` (sinon il serait perdu a chaque
-- enregistrement).
create or replace function public.repair_order_write_lines(_or uuid, _lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.repair_orders%rowtype;
  n integer := 0;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then
    raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(r.company_id) then
    raise exception 'Acces refuse a la societe %', r.company_id using errcode = '42501';
  end if;
  if r.status = 'facture' then
    raise exception 'OR facture : les lignes ne se modifient plus.' using errcode = 'P0001';
  end if;

  with old as (
    delete from public.repair_order_lines where or_id = _or
    returning kind, checkup_key, sort_order, mechanic_code, mechanic_name, work_date,
              billed_hours, worked_hours, internal_hours, warranty_hours
  ), old_time as (
    select distinct on (checkup_key) checkup_key, mechanic_code, mechanic_name, work_date,
           billed_hours, worked_hours, internal_hours, warranty_hours
      from old
     where kind = 'mo' and checkup_key is not null
     order by checkup_key, sort_order
  )
  insert into public.repair_order_lines
    (or_id, kind, article_id, designation, quantity, unit_price_ht, vat_rate, discount_pct, is_warranty,
     line_ht, line_ttc, sort_order, checkup_key, checkup_state, photo_path, proposal_line_id, warranty_decision,
     mechanic_code, mechanic_name, work_date, billed_hours, worked_hours, internal_hours, warranty_hours)
  select _or,
         x.kind, x.article_id, x.designation, x.quantity, x.unit_price_ht, x.vat_rate, x.discount_pct, x.is_warranty,
         x.line_ht, x.line_ttc, x.sort_order, x.checkup_key, x.checkup_state, x.photo_path, x.proposal_line_id,
         case when x.is_warranty and x.l->>'warranty_decision' in ('accepte', 'refuse')
              then x.l->>'warranty_decision' end,
         case when x.kind = 'mo' then case when x.l ? 'mechanic_code' then nullif(x.l->>'mechanic_code', '') else o.mechanic_code end end,
         case when x.kind = 'mo' then case when x.l ? 'mechanic_name' then nullif(x.l->>'mechanic_name', '') else o.mechanic_name end end,
         case when x.kind = 'mo' then case when x.l ? 'work_date' then nullif(x.l->>'work_date', '')::date else o.work_date end end,
         case when x.kind = 'mo'
               and (case when x.l ? 'billed_hours' then nullif(x.l->>'billed_hours', '')::numeric else o.billed_hours end) is not null
              then case when x.is_warranty
                        then (case when x.l ? 'billed_hours' then nullif(x.l->>'billed_hours', '')::numeric else o.billed_hours end)
                        else x.quantity end end,
         case when x.kind = 'mo' then case when x.l ? 'worked_hours' then nullif(x.l->>'worked_hours', '')::numeric else o.worked_hours end end,
         case when x.kind = 'mo' then case when x.l ? 'internal_hours' then nullif(x.l->>'internal_hours', '')::numeric else o.internal_hours end end,
         case when x.kind = 'mo' then case when x.l ? 'warranty_hours' then nullif(x.l->>'warranty_hours', '')::numeric else o.warranty_hours end end
    from (
      select l,
             coalesce(l->>'kind', 'piece') as kind,
             nullif(l->>'article_id', '')::uuid as article_id,
             coalesce(l->>'designation', '') as designation,
             coalesce((l->>'quantity')::numeric, 1) as quantity,
             coalesce((l->>'unit_price_ht')::numeric, 0) as unit_price_ht,
             coalesce((l->>'vat_rate')::numeric, 21) as vat_rate,
             coalesce((l->>'discount_pct')::numeric, 0) as discount_pct,
             coalesce((l->>'is_warranty')::boolean, false) as is_warranty,
             coalesce((l->>'line_ht')::numeric, 0) as line_ht,
             coalesce((l->>'line_ttc')::numeric, 0) as line_ttc,
             (ord - 1)::int as sort_order,
             nullif(l->>'checkup_key', '') as checkup_key,
             nullif(l->>'checkup_state', '') as checkup_state,
             nullif(l->>'photo_path', '') as photo_path,
             nullif(l->>'proposal_line_id', '')::uuid as proposal_line_id
        from jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) with ordinality as e(l, ord)
    ) x
    left join old_time o on o.checkup_key = x.checkup_key and x.kind = 'mo'
   order by x.sort_order;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.repair_order_write_lines(uuid, jsonb) from public, anon;
grant execute on function public.repair_order_write_lines(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Parametres : taux MO garantie, types de cession garantie (sans toucher a « comptabilisee »)
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'workshop_warranty', 'mo', 'Main-d''oeuvre garantie (taux horaire HT)', 10,
       '{"hourly_rate_ht": 46.94}'::jsonb
  from public.companies c
on conflict (company_id, table_key, code) do nothing;

-- Types de cession garantie de G8 : crees seulement s'ils manquent (le reglage « comptabilisee »
-- d'une ligne existante n'est jamais modifie — voir « A trancher »).
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'cession_type', v.code, v.label, v.sort_order, v.extra::jsonb
  from public.companies c
 cross join (values
   ('05', 'Garantie fournisseur', 5, '{"accounted":true}'),
   ('06', 'Garantie magasin/atelier', 6, '{"accounted":true}'),
   ('07', 'Geste commercial', 7, '{"accounted":true}')
 ) as v(code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Retours / remboursements constructeur (fiche fournisseur › Garantie, Appros › Historique garantie)
-- ---------------------------------------------------------------------
create table if not exists public.warranty_returns (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete restrict,
  supplier_id             uuid references public.contacts(id) on delete set null,
  contact_id              uuid references public.contacts(id) on delete set null,
  vehicle_id              uuid references public.vehicles(id) on delete set null,
  repair_order_id         uuid references public.repair_orders(id) on delete set null,
  repair_order_line_id    uuid references public.repair_order_lines(id) on delete set null,
  article_id              uuid references public.articles(id) on delete set null,
  reference               text,
  designation             text not null,
  quantity                numeric(14,3) not null default 1,
  unit_cost_ht            numeric(14,3) not null default 0,
  amount_ht               numeric(14,2) not null default 0,
  status                  text not null default 'attente_remboursement',
  taken_at                date,
  received_at             date,
  settled_at              date,
  purchase_invoice_number text,
  purchase_invoice_date   date,
  delivery_note_number    text,
  delivery_note_date      date,
  ticket_number           text,
  notes                   text,
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint warranty_returns_status_check
    check (status in ('attente_remboursement', 'attente_echange', 'rembourse', 'echange'))
);
create index if not exists idx_warranty_returns_company on public.warranty_returns(company_id, status);
create index if not exists idx_warranty_returns_supplier on public.warranty_returns(supplier_id);
create index if not exists idx_warranty_returns_or on public.warranty_returns(repair_order_id);
create unique index if not exists uq_warranty_returns_line on public.warranty_returns(repair_order_line_id)
  where repair_order_line_id is not null;

comment on table public.warranty_returns is
  'Suivi des retours / remboursements constructeur (G8 : fiche fournisseur › Garantie, Appros › Historique garantie). Une ligne par piece en garantie fournisseur ; etats attente_remboursement / attente_echange / rembourse / echange.';
comment on column public.warranty_returns.taken_at is 'Date de prise en charge (facturation de l''OR garantie).';
comment on column public.warranty_returns.received_at is 'Date de reception de la piece (retour fournisseur / arrivee).';
comment on column public.warranty_returns.settled_at is 'Date de reception de la garantie (remboursement ou echange recu).';
comment on column public.warranty_returns.unit_cost_ht is 'PAUHT : prix d''achat unitaire HT de la piece.';

drop trigger if exists trg_warranty_returns_updated on public.warranty_returns;
create trigger trg_warranty_returns_updated before update on public.warranty_returns
  for each row execute function public.set_updated_at();
drop trigger if exists trg_warranty_returns_audit on public.warranty_returns;
create trigger trg_warranty_returns_audit after insert or update or delete on public.warranty_returns
  for each row execute function public.audit_row();

alter table public.warranty_returns enable row level security;
drop policy if exists warranty_returns_select on public.warranty_returns;
create policy warranty_returns_select on public.warranty_returns for select to authenticated
  using (public.is_member(company_id));
drop policy if exists warranty_returns_write on public.warranty_returns;
create policy warranty_returns_write on public.warranty_returns for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 4. Imputation garantie a la facturation de l'OR (meme transaction que le passage « facture »)
-- ---------------------------------------------------------------------
create or replace function public.repair_order_impute_warranty(_or uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.repair_orders%rowtype;
  rate numeric;
  n integer := 0;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then return 0; end if;
  if r.warranty_imputed_at is not null then return 0; end if;

  -- Taux MO garantie (Parametres → Tables → Garantie atelier, code mo) ; 0 / vide = prix de la ligne.
  select nullif((v.extra->>'hourly_rate_ht')::numeric, 0) into rate
    from public.reference_values v
   where v.company_id = r.company_id and v.table_key = 'workshop_warranty' and v.code = 'mo' and v.is_active
   limit 1;

  -- Lignes couvertes : en garantie, facturables (pas « OK » / « reportee » du check-up),
  -- ni refus total, ni refusees ligne par ligne en refus partiel.
  update public.repair_order_lines l
     set warranty_cost_ht = case
           when l.kind = 'mo' then round(l.quantity * coalesce(rate, l.unit_price_ht), 2)
           else round(l.quantity * coalesce(a.pamp, 0), 2) end,
         warranty_pa_ht = case
           when l.kind = 'mo' then round(l.quantity * coalesce(rate, l.unit_price_ht), 2)
           else round(l.quantity * coalesce(nullif(a.purchase_price, 0), a.pamp, 0), 2) end,
         warranty_sale_ht = round(l.quantity * l.unit_price_ht * (1 - coalesce(l.discount_pct, 0) / 100), 2)
    from public.repair_order_lines l2
    left join public.articles a on a.id = l2.article_id
   where l.id = l2.id
     and l.or_id = _or
     and l.is_warranty
     and l.kind in ('piece', 'mo')
     and coalesce(l.checkup_state, '') not in ('ok', 'reporte')
     and r.warranty_status <> 'refus_total'
     and not (r.warranty_status = 'refus_partiel' and coalesce(l.warranty_decision, '') = 'refuse');
  get diagnostics n = row_count;

  -- Garantie fournisseur (05) : une ligne de suivi par piece couverte, a rembourser par le fournisseur.
  if r.warranty_cession_code = '05' then
    insert into public.warranty_returns
      (company_id, supplier_id, contact_id, vehicle_id, repair_order_id, repair_order_line_id, article_id,
       reference, designation, quantity, unit_cost_ht, amount_ht, status, taken_at, ticket_number, created_by)
    select r.company_id, a.main_supplier_id, r.contact_id, r.vehicle_id, r.id, l.id, l.article_id,
           a.reference, l.designation, l.quantity,
           coalesce(nullif(a.purchase_price, 0), a.pamp, 0),
           coalesce(l.warranty_pa_ht, 0),
           'attente_remboursement', current_date, r.number, auth.uid()
      from public.repair_order_lines l
      left join public.articles a on a.id = l.article_id
     where l.or_id = _or and l.kind = 'piece' and l.warranty_cost_ht is not null
    on conflict (repair_order_line_id) where repair_order_line_id is not null do nothing;
  end if;

  update public.repair_orders set warranty_imputed_at = now() where id = _or;
  return n;
end $$;

revoke all on function public.repair_order_impute_warranty(uuid) from public, anon, authenticated;

create or replace function public.trg_repair_order_impute_warranty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'facture' and coalesce(old.status, '') <> 'facture' and new.warranty_imputed_at is null then
    perform public.repair_order_impute_warranty(new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_ro_impute_warranty on public.repair_orders;
create trigger trg_ro_impute_warranty after update of status on public.repair_orders
  for each row execute function public.trg_repair_order_impute_warranty();

-- ---------------------------------------------------------------------
-- 5. Liste « Garanties » (G8 › Liste des cessions › Garanties) et « Garanties / CA »
-- ---------------------------------------------------------------------
create or replace view public.warranty_lines_v
with (security_invoker = true) as
select l.id                      as line_id,
       o.id                      as repair_order_id,
       o.company_id,
       o.number                  as or_number,
       o.warranty_cession_code,
       o.warranty_status,
       coalesce(o.warranty_imputed_at, o.created_at)::date as imputed_on,
       o.contact_id,
       c.code                    as client_code,
       coalesce(nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.last_name, c.first_name)), '')) as client_name,
       o.vehicle_id,
       v.vin,
       v.plate,
       trim(concat_ws(' ', v.brand, v.model)) as vehicle_label,
       o.mileage,
       l.kind,
       l.article_id,
       a.reference,
       l.designation,
       l.quantity,
       case when l.kind = 'mo' then l.quantity else 0 end                 as labour_hours,
       case when l.kind = 'piece' then coalesce(l.warranty_cost_ht, 0) else 0 end as parts_cost_ht,
       case when l.kind = 'piece' then coalesce(l.warranty_pa_ht, 0) else 0 end   as parts_pa_ht,
       case when l.kind = 'mo' then coalesce(l.warranty_cost_ht, 0) else 0 end    as labour_cost_ht,
       coalesce(l.warranty_cost_ht, 0)  as cost_ht,
       coalesce(l.warranty_sale_ht, 0)  as sale_ht
  from public.repair_order_lines l
  join public.repair_orders o on o.id = l.or_id
  left join public.contacts c on c.id = o.contact_id
  left join public.vehicles v on v.id = o.vehicle_id
  left join public.articles a on a.id = l.article_id
 where l.warranty_cost_ht is not null
   and o.status <> 'annule';

comment on view public.warranty_lines_v is
  'Lignes imputees en garantie (a la facturation de l''OR) : temps MO, achat pieces (PAMP / PA), cout MO, valeur PV. RLS des tables (security_invoker).';

grant select on public.warranty_lines_v to authenticated;

create or replace function public.warranty_stats_by_client(_company uuid, _from date, _to date)
returns table (
  contact_id uuid, client_code text, client_name text, revenue_ht numeric,
  warranty_pamp_ht numeric, warranty_pa_ht numeric, warranty_sale_ht numeric, warranty_lines integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with w as (
    select w.contact_id, sum(w.cost_ht) as pamp, sum(case when w.kind = 'piece' then w.parts_pa_ht else w.labour_cost_ht end) as pa,
           sum(w.sale_ht) as sale, count(*)::int as n
      from public.warranty_lines_v w
     where w.company_id = _company and w.imputed_on between _from and _to
     group by w.contact_id
  ), ca as (
    select d.contact_id, sum(d.total_ht) as revenue
      from public.documents d
     where d.company_id = _company and d.doc_type = 'FAC' and d.status <> 'annulee'
       and d.issue_date between _from and _to
       and d.contact_id in (select w.contact_id from w)
     group by d.contact_id
  )
  select w.contact_id, c.code,
         coalesce(nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.last_name, c.first_name)), '')),
         coalesce(ca.revenue, 0), coalesce(w.pamp, 0), coalesce(w.pa, 0), coalesce(w.sale, 0), w.n
    from w
    left join ca on ca.contact_id is not distinct from w.contact_id
    left join public.contacts c on c.id = w.contact_id
   order by coalesce(w.pamp, 0) desc;
$$;

revoke all on function public.warranty_stats_by_client(uuid, date, date) from public, anon;
grant execute on function public.warranty_stats_by_client(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Fichier des cabinets d'assurance et des experts (G8 : « Fiche assurance »)
-- ---------------------------------------------------------------------
create table if not exists public.insurance_parties (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  kind               text not null default 'cabinet',
  code               text,
  name               text not null,
  address            text,
  postal_code        text,
  city               text,
  country            text default 'BE',
  phone              text,
  phone2             text,
  fax                text,
  email              text,
  company_number     text,
  vat_number         text,
  contact_name       text,
  comments           text,
  accounting_account text,
  price_list         text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint insurance_parties_kind_check check (kind in ('cabinet', 'expert'))
);
create index if not exists idx_insurance_parties_company on public.insurance_parties(company_id, kind, name);
create unique index if not exists uq_insurance_parties_code on public.insurance_parties(company_id, kind, code)
  where code is not null and code <> '';

comment on table public.insurance_parties is
  'Cabinets d''assurance et experts (G8 : Fiche assurance) : coordonnees, n° d''entreprise (SIRET en France), TVA, contact, compte comptable, tarif associe aux OR assurance.';
comment on column public.insurance_parties.price_list is
  'Tarif associe aux OR assurance (meme notion que contacts.price_list : grille nommee, affichee sur l''OR ; pas de calcul de prix automatique dans le DMS a ce jour).';

drop trigger if exists trg_insurance_parties_updated on public.insurance_parties;
create trigger trg_insurance_parties_updated before update on public.insurance_parties
  for each row execute function public.set_updated_at();
drop trigger if exists trg_insurance_parties_audit on public.insurance_parties;
create trigger trg_insurance_parties_audit after insert or update or delete on public.insurance_parties
  for each row execute function public.audit_row();

alter table public.insurance_parties enable row level security;
drop policy if exists insurance_parties_select on public.insurance_parties;
create policy insurance_parties_select on public.insurance_parties for select to authenticated
  using (public.is_member(company_id));
drop policy if exists insurance_parties_write on public.insurance_parties;
create policy insurance_parties_write on public.insurance_parties for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 7. Dossier accident : le volet assureur (onglet « Assurance » de l'OR G8)
-- ---------------------------------------------------------------------
alter table public.accident_files
  add column if not exists insurer_id             uuid references public.insurance_parties(id) on delete set null,
  add column if not exists expert_id              uuid references public.insurance_parties(id) on delete set null,
  add column if not exists expert_visit_date      date,
  add column if not exists deductible_kind        text not null default 'montant',
  add column if not exists deductible_value       numeric(14,2),
  add column if not exists market_value           numeric(14,2),
  add column if not exists argus_value            numeric(14,2),
  add column if not exists work_start_accepted    boolean not null default false,
  add column if not exists work_start_accepted_at timestamptz,
  add column if not exists work_start_accepted_by uuid references auth.users(id) on delete set null;

alter table public.accident_files drop constraint if exists accident_files_deductible_kind_check;
alter table public.accident_files
  add constraint accident_files_deductible_kind_check
  check (deductible_kind in ('montant', 'pourcentage')
         and (deductible_value is null or deductible_value >= 0)
         and (deductible_kind <> 'pourcentage' or deductible_value is null or deductible_value <= 100));

create index if not exists idx_accident_files_insurer on public.accident_files(insurer_id);
create index if not exists idx_accident_files_expert on public.accident_files(expert_id);

comment on column public.accident_files.deductible_kind is 'Franchise a percevoir : en montant (€) ou en pourcentage du montant de l''OR.';
comment on column public.accident_files.market_value is 'Valeur venale de la moto (G8 : Valeur venale).';
comment on column public.accident_files.argus_value is 'Cote de la moto (G8 : Cote vente Argus).';
comment on column public.accident_files.work_start_accepted is 'Demarrage des travaux accepte par l''assureur / l''expert (G8 : Accepter demarrage des travaux).';
