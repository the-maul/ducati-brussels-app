-- =====================================================================
-- M4 — Rattrapage G8 (18/11/2026) : documents d'achat écrits par le serveur, en UNE transaction.
--
-- G8 (04-fournisseurs-achats.md, parcours 11, 12, 26) : commande → réception avec « Rappel cde »
-- (une ou plusieurs commandes), quantités reçues, réception partielle (le reliquat reste en
-- commande), brouillon validé plus tard, n° facture / BL + dates, port, « Infos commandes client »
-- à la réception, proposition de commande (Stock / Dépannage / Garantie), regroupement des
-- commandes d'un fournisseur, rétrocession (retour fournisseur), historique des envois.
--
-- Ce que fait cette migration (additive, idempotente) :
--  1. colonnes : purchase_lines.source_line_id (ligne de commande reçue / ligne de proposition
--     commandée), contact_id + origine (pour qui, d'où vient la ligne), chassis (brouillon),
--     landed_unit_cost (coût unitaire entré en stock) ; purchase_orders.order_type
--     (stock / depannage / garantie), operator_id, validated_at / validated_by, spread_costs
--     (port et remise globale répartis dans le PAMP), merged_into_id ; deux nouveaux types de
--     document : PCF (proposition de commande fournisseur) et RTF (rétrocession) + leurs séquences ;
--     statuts partielle (commande reçue en partie), soldee (reliquat abandonné), transformee
--     (proposition passée en commande).
--  2. gardes : le statut, le n° et le type d'un document d'achat, et les lignes d'un document
--     validé, ne changent QUE par les fonctions ci-dessous (règle 4 : aucun UPDATE silencieux).
--  3. purchase_doc_save(...) : enregistre un brouillon ou VALIDE un document (nouveau ou brouillon
--     existant) en une seule transaction : n°, lignes, échéances, totaux, et pour une réception :
--     entrées de stock (record_stock_move, PAMP), prix d'achat (record_price_change, origine
--     reception), fiche moto (VIN unique), étiquettes en file (B12), statut des commandes rappelées
--     (validee → partielle → recue) ; pour une rétrocession : sorties de stock « retour fournisseur ».
--     Une erreur au milieu = rien n'est écrit (bloquant critique n° 1 de la comparaison).
--  4. lectures : lignes de commande restant à recevoir (rappel), suivi d'une commande (reçu,
--     reste, réceptions), « Infos commandes client » d'une réception ; écritures : client informé
--     (append-only), envoi d'une commande (date et heure, canal), solde du reliquat, regroupement,
--     ajout à une proposition, proposition → commande.
--  5. article_on_order_for redéfinie (même signature) : une ligne de commande compte son RESTE
--     (commandé − reçu), commandes « validee » ET « partielle » ; purchase_order_destinations
--     redéfinie : « Pour qui ? » aussi sur une réception reliée ligne à ligne.
--
-- NON APPLIQUÉE. Essai à blanc : supabase/tests/m4_achats_g8.sql (transaction annulée).
-- =====================================================================

-- ------------------------------------------------ 1. Colonnes
-- Conditions d'achat de la fiche fournisseur (G8 « Informations commandes ») : lues par la saisie et la
-- proposition. Le minimum en quantité existe déjà (supplier_order_min_qty, 20260612270000).
alter table public.contacts add column if not exists supplier_vat_regime text;
alter table public.contacts add column if not exists supplier_shipping_fixed numeric(14,2);
alter table public.contacts add column if not exists supplier_shipping_vat_rate numeric(6,2);
alter table public.contacts add column if not exists supplier_rush_discount_pct numeric(6,2);
alter table public.contacts add column if not exists supplier_website text;
alter table public.contacts add column if not exists supplier_b2b_url text;
alter table public.contacts add column if not exists supplier_order_footer text;
do $$ begin
  alter table public.contacts add constraint contacts_supplier_vat_regime_chk
    check (supplier_vat_regime is null or supplier_vat_regime in ('with_vat', 'cee', 'outside_cee'));
exception when duplicate_object then null; end $$;
comment on column public.contacts.supplier_vat_regime is 'Régime TVA d''achat par défaut : with_vat (avec TVA), cee (CEE sans TVA), outside_cee (hors CEE sans TVA).';
comment on column public.contacts.supplier_shipping_fixed is 'Frais de port fixe HT proposés sur ses réceptions.';
comment on column public.contacts.supplier_rush_discount_pct is 'Remise dépannage % : remise de ligne par défaut d''une commande de type dépannage.';
comment on column public.contacts.supplier_order_footer is 'Texte imprimé en bas des commandes à ce fournisseur (G8 « expression bas de commande »).';

alter table public.purchase_lines add column if not exists source_line_id uuid
  references public.purchase_lines(id) on delete set null;
alter table public.purchase_lines add column if not exists contact_id uuid
  references public.contacts(id) on delete set null;
alter table public.purchase_lines add column if not exists origin_kind text;
alter table public.purchase_lines add column if not exists origin_id uuid;
alter table public.purchase_lines add column if not exists origin_ref text;
alter table public.purchase_lines add column if not exists chassis jsonb;
alter table public.purchase_lines add column if not exists landed_unit_cost numeric(14,3);
create index if not exists idx_plines_source_line on public.purchase_lines(source_line_id) where source_line_id is not null;

comment on column public.purchase_lines.source_line_id is
  'Réception : ligne de commande (CMD) reçue. Commande : ligne de proposition (PCF) commandée. Posé par purchase_doc_save.';
comment on column public.purchase_lines.landed_unit_cost is
  'Coût unitaire entré en stock à la réception (PA net, remise globale et port répartis si spread_costs) : base du PAMP.';

alter table public.purchase_orders add column if not exists order_type text;
alter table public.purchase_orders add column if not exists operator_id uuid references auth.users(id) on delete set null;
alter table public.purchase_orders add column if not exists validated_at timestamptz;
alter table public.purchase_orders add column if not exists validated_by uuid references auth.users(id) on delete set null;
alter table public.purchase_orders add column if not exists spread_costs boolean not null default true;
alter table public.purchase_orders add column if not exists merged_into_id uuid references public.purchase_orders(id) on delete set null;
create index if not exists idx_porders_supplier_status on public.purchase_orders(company_id, supplier_id, doc_type, status);

comment on column public.purchase_orders.order_type is 'Type de commande G8 : stock / depannage / garantie.';
comment on column public.purchase_orders.spread_costs is
  'Réception : répartir le port et la remise globale dans le coût d''entrée (PAMP), au prorata du HT net des lignes.';

do $$ begin
  alter table public.purchase_orders add constraint purchase_orders_order_type_chk
    check (order_type is null or order_type in ('stock', 'depannage', 'garantie'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.purchase_orders add constraint purchase_orders_doc_type_chk
    check (doc_type in ('CMD', 'REC', 'PCF', 'RTF')) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.purchase_orders add constraint purchase_orders_status_chk
    check (status in ('brouillon', 'validee', 'partielle', 'recue', 'soldee', 'transformee', 'annulee')) not valid;
exception when duplicate_object then null; end $$;

-- Séquences des deux nouveaux documents (modifiables dans Paramètres → Numérotation).
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, d.doc_type, d.prefix, d.label
  from public.companies c
 cross join (values
   ('PCF', 'PCF', 'Proposition de commande fournisseur'),
   ('RTF', 'RTF', 'Rétrocession (retour fournisseur)')
 ) as d(doc_type, prefix, label)
on conflict (company_id, doc_type) do nothing;

-- Envois d'une commande (G8 « Historique commande » : date et heure d'envoi, plusieurs envois possibles).
create table if not exists public.purchase_order_sends (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete restrict,
  order_id    uuid not null references public.purchase_orders(id) on delete cascade,
  channel     text not null default 'autre',   -- mail | dcs | b2b | telephone | papier | autre
  note        text,
  sent_at     timestamptz not null default now(),
  sent_by     uuid references auth.users(id) on delete set null
);
create index if not exists idx_porder_sends_order on public.purchase_order_sends(order_id, sent_at desc);
create index if not exists idx_porder_sends_company on public.purchase_order_sends(company_id, sent_at desc);
alter table public.purchase_order_sends enable row level security;
drop policy if exists porder_sends_select on public.purchase_order_sends;
create policy porder_sends_select on public.purchase_order_sends for select to authenticated using (public.is_member(company_id));
revoke insert, update, delete on public.purchase_order_sends from authenticated, anon;

-- Clients prévenus de l'arrivée d'une pièce (G8 « Infos commandes client » → client informé). Append-only.
create table if not exists public.purchase_customer_notices (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete restrict,
  receipt_id  uuid not null references public.purchase_orders(id) on delete cascade,
  article_id  uuid references public.articles(id) on delete set null,
  source_kind text not null,                   -- part_order | document | repair_order
  source_id   uuid not null,
  contact_id  uuid references public.contacts(id) on delete set null,
  channel     text not null default 'telephone', -- telephone | sms | email | comptoir | autre
  note        text,
  informed_at timestamptz not null default now(),
  informed_by uuid references auth.users(id) on delete set null
);
create index if not exists idx_pcust_notices_receipt on public.purchase_customer_notices(receipt_id);
create index if not exists idx_pcust_notices_source on public.purchase_customer_notices(source_kind, source_id);
alter table public.purchase_customer_notices enable row level security;
drop policy if exists pcust_notices_select on public.purchase_customer_notices;
create policy pcust_notices_select on public.purchase_customer_notices for select to authenticated using (public.is_member(company_id));
revoke insert, update, delete on public.purchase_customer_notices from authenticated, anon;

-- ------------------------------------------------ 2. Gardes (seules les fonctions changent statut, n°, lignes validées)
create or replace function public.purchase_orders_g8_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Fonctions d'achat (GUC transaction-local), clé de service ou tâche serveur : laissé passer.
  if auth.uid() is null
     or coalesce(current_setting('app.purchase_rpc', true), '') = 'on'
     or coalesce(current_setting('app.supplier_order_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'brouillon' or new.number is not null then
      raise exception 'Un document d''achat se valide par l''écran (Valider), pas directement.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.number is distinct from old.number
     or new.doc_type is distinct from old.doc_type
     or new.validated_at is distinct from old.validated_at
     or new.merged_into_id is distinct from old.merged_into_id then
    raise exception 'Le statut, le numéro et le type d''un document d''achat changent par l''écran (Valider, Solder, Regrouper).'
      using errcode = '42501';
  end if;
  if old.status <> 'brouillon'
     and (new.total_ht is distinct from old.total_ht or new.total_vat is distinct from old.total_vat
          or new.total_ttc is distinct from old.total_ttc or new.shipping_ht is distinct from old.shipping_ht
          or new.global_discount_pct is distinct from old.global_discount_pct or new.vat_regime is distinct from old.vat_regime) then
    raise exception 'Document d''achat validé : montants figés.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.purchase_orders_g8_guard() from public, anon, authenticated;
drop trigger if exists trg_porders_g8_guard on public.purchase_orders;
create trigger trg_porders_g8_guard before insert or update on public.purchase_orders
  for each row execute function public.purchase_orders_g8_guard();

create or replace function public.purchase_lines_g8_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare st text;
begin
  if auth.uid() is null
     or coalesce(current_setting('app.purchase_rpc', true), '') = 'on'
     or coalesce(current_setting('app.supplier_order_rpc', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  select o.status into st from public.purchase_orders o where o.id = coalesce(new.order_id, old.order_id);
  if st is null or st = 'brouillon' then
    return coalesce(new, old);
  end if;
  -- Maintenance des liens (article supprimé / fusionné) : seul article_id change.
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'article_id') = (to_jsonb(old) - 'article_id') then
    return new;
  end if;
  raise exception 'Les lignes d''un document d''achat validé sont figées.' using errcode = '42501';
end $$;
revoke all on function public.purchase_lines_g8_guard() from public, anon, authenticated;
drop trigger if exists trg_plines_g8_guard on public.purchase_lines;
create trigger trg_plines_g8_guard before insert or update or delete on public.purchase_lines
  for each row execute function public.purchase_lines_g8_guard();

-- ------------------------------------------------ 3. Quantité reçue d'une ligne de commande
create or replace function public._purchase_line_received(_line uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(r.quantity), 0)
    from public.purchase_lines r
    join public.purchase_orders o on o.id = r.order_id
   where r.source_line_id = _line and o.doc_type = 'REC' and o.status = 'recue';
$$;
revoke all on function public._purchase_line_received(uuid) from public, anon, authenticated;

-- Statut d'une commande d'après ses reliquats (validee / partielle / recue). Ne touche pas soldee / annulee.
create or replace function public._purchase_order_refresh_status(_order uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.purchase_orders%rowtype; any_rec boolean; all_done boolean; nst text;
begin
  select * into o from public.purchase_orders where id = _order for update;
  if not found or o.doc_type <> 'CMD' or o.status not in ('validee', 'partielle', 'recue') then
    return o.status;
  end if;
  select coalesce(bool_or(public._purchase_line_received(l.id) > 0), false),
         coalesce(bool_and(public._purchase_line_received(l.id) >= l.quantity or l.quantity <= 0), true)
    into any_rec, all_done
    from public.purchase_lines l where l.order_id = o.id;
  nst := case when all_done and any_rec then 'recue' when any_rec then 'partielle' else 'validee' end;
  if nst is distinct from o.status then
    perform set_config('app.purchase_rpc', 'on', true);
    update public.purchase_orders set status = nst where id = o.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (o.company_id, auth.uid(), 'status_change', 'purchase_orders', o.id::text, 'screen',
            jsonb_build_object('status', o.status, 'number', o.number),
            jsonb_build_object('status', nst, 'number', o.number));
  end if;
  return nst;
end $$;
revoke all on function public._purchase_order_refresh_status(uuid) from public, anon, authenticated;

-- ------------------------------------------------ 4. Totaux (même calcul que computePurchaseTotals, write-api.ts)
create or replace function public._purchase_recompute_totals(_order uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.purchase_orders%rowtype; lht numeric; lvat numeric; disc numeric; nht numeric; nvat numeric; svat numeric;
begin
  select * into o from public.purchase_orders where id = _order;
  select coalesce(sum(round(l.quantity * l.unit_price_ht * (1 - coalesce(l.discount_pct, 0) / 100), 3)), 0),
         coalesce(sum(case when o.vat_regime = 'with_vat'
                           then round(l.quantity * l.unit_price_ht * (1 - coalesce(l.discount_pct, 0) / 100), 3) * coalesce(l.vat_rate, 0) / 100
                           else 0 end), 0)
    into lht, lvat
    from public.purchase_lines l where l.order_id = _order;
  disc := case when coalesce(o.global_discount_pct, 0) > 0 then lht * o.global_discount_pct / 100 else 0 end;
  nht := lht - disc;
  nvat := case when lht > 0 then lvat * nht / lht else 0 end;
  svat := case when o.vat_regime = 'with_vat' and o.shipping_taxed and coalesce(o.shipping_ht, 0) > 0
               then o.shipping_ht * coalesce(o.shipping_vat_rate, 21) / 100 else 0 end;
  perform set_config('app.purchase_rpc', 'on', true);
  update public.purchase_orders
     set total_ht = round(nht + coalesce(o.shipping_ht, 0), 2),
         total_vat = round(nvat + svat, 2),
         total_ttc = round(nht + coalesce(o.shipping_ht, 0), 2) + round(nvat + svat, 2)
   where id = _order;
end $$;
revoke all on function public._purchase_recompute_totals(uuid) from public, anon, authenticated;

-- ------------------------------------------------ 5. Enregistrer / valider un document d'achat (atomique)
-- _header : { doc_type, supplier_id, vat_regime, order_type, supplier_invoice_no, supplier_bl_no, intranet_no,
--             invoice_date, bl_date, receipt_date, order_date, expected_date, shipping_ht, shipping_taxed,
--             shipping_vat_rate, global_discount_pct, spread_costs, notes }
-- _lines  : [{ article_id, designation, supplier_ref, quantity, unit_price_ht, discount_pct, vat_rate, sale_price_ttc,
--              bin_location, labels, source_line_id, contact_id, origin_kind, origin_id, origin_ref, chassis }]
-- _schedules : [{ seq_no, due_date, amount, note }]
create or replace function public.purchase_doc_save(
  _company uuid, _id uuid, _header jsonb, _lines jsonb, _schedules jsonb default '[]'::jsonb, _validate boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o        public.purchase_orders%rowtype;
  dt       text := upper(coalesce(nullif(btrim(_header->>'doc_type'), ''), 'REC'));
  sup      uuid := nullif(_header->>'supplier_id', '')::uuid;
  l        jsonb;
  k        int := 0;
  lid      uuid;
  src      record;
  num      text;
  warnings jsonb := '[]'::jsonb;
  touched  uuid[] := '{}';
  pcfs     uuid[] := '{}';
  r        record;
  updated  jsonb := '[]'::jsonb;
  basis    numeric;
  gd       numeric;
  ship     numeric;
  unit_net numeric;
  landed   numeric;
  ch       jsonb;
  _vin     text;
  st_new   text;
  today    date := (now() at time zone 'Europe/Brussels')::date;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if dt not in ('CMD', 'REC', 'PCF', 'RTF') then
    raise exception 'Type de document d''achat inconnu : %.', dt using errcode = 'P0001';
  end if;
  if sup is not null and not exists (select 1 from public.contacts s where s.id = sup and s.company_id = _company and s.type = 'fournisseur') then
    raise exception 'Fournisseur introuvable dans cette société.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Lignes invalides.' using errcode = 'P0001';
  end if;
  if coalesce(_header->>'order_type', '') <> '' and _header->>'order_type' not in ('stock', 'depannage', 'garantie') then
    raise exception 'Type de commande inconnu (stock, dépannage, garantie).' using errcode = 'P0001';
  end if;

  perform set_config('app.purchase_rpc', 'on', true);

  -- En-tête : nouveau brouillon, ou brouillon existant verrouillé
  if _id is not null then
    select * into o from public.purchase_orders where id = _id for update;
    if not found or o.company_id <> _company then
      raise exception 'Document introuvable.' using errcode = 'P0002';
    end if;
    if o.status <> 'brouillon' then
      raise exception 'Document % déjà validé : il ne se modifie plus.', coalesce(o.number, '') using errcode = 'P0001';
    end if;
  else
    insert into public.purchase_orders (company_id, doc_type, status, operator_id)
    values (_company, dt, 'brouillon', auth.uid())
    returning * into o;
  end if;

  update public.purchase_orders set
    doc_type = dt,
    supplier_id = sup,
    vat_regime = coalesce(nullif(_header->>'vat_regime', ''), 'with_vat'),
    order_type = nullif(_header->>'order_type', ''),
    supplier_invoice_no = nullif(btrim(coalesce(_header->>'supplier_invoice_no', '')), ''),
    supplier_bl_no = nullif(btrim(coalesce(_header->>'supplier_bl_no', '')), ''),
    intranet_no = nullif(btrim(coalesce(_header->>'intranet_no', '')), ''),
    invoice_date = nullif(_header->>'invoice_date', '')::date,
    bl_date = nullif(_header->>'bl_date', '')::date,
    receipt_date = coalesce(nullif(_header->>'receipt_date', '')::date, case when dt = 'REC' then today end),
    order_date = coalesce(nullif(_header->>'order_date', '')::date, case when dt in ('CMD', 'PCF') then today end),
    expected_date = nullif(_header->>'expected_date', '')::date,
    shipping_ht = coalesce(nullif(_header->>'shipping_ht', '')::numeric, 0),
    shipping_taxed = coalesce((_header->>'shipping_taxed')::boolean, true),
    shipping_vat_rate = coalesce(nullif(_header->>'shipping_vat_rate', '')::numeric, 21),
    global_discount_pct = coalesce(nullif(_header->>'global_discount_pct', '')::numeric, 0),
    spread_costs = coalesce((_header->>'spread_costs')::boolean, true),
    notes = nullif(btrim(coalesce(_header->>'notes', '')), ''),
    operator_id = coalesce(operator_id, auth.uid())
  where id = o.id
  returning * into o;

  if o.vat_regime not in ('with_vat', 'cee', 'outside_cee') then
    raise exception 'Régime TVA inconnu.' using errcode = 'P0001';
  end if;

  -- Lignes : un brouillon se réécrit entièrement
  delete from public.purchase_lines where order_id = o.id;
  for l in select value from jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) loop
    if coalesce((l->>'quantity')::numeric, 0) < 0 then
      raise exception 'Quantité négative interdite (une rétrocession se saisit en positif).' using errcode = 'P0001';
    end if;
    if nullif(l->>'article_id', '') is not null and not exists (
         select 1 from public.articles a where a.id = (l->>'article_id')::uuid and a.company_id = _company) then
      raise exception 'Article introuvable dans cette société.' using errcode = 'P0002';
    end if;
    if nullif(l->>'source_line_id', '') is not null then
      select pl.id, po.doc_type, po.status, po.supplier_id, po.company_id, po.number
        into src
        from public.purchase_lines pl join public.purchase_orders po on po.id = pl.order_id
       where pl.id = (l->>'source_line_id')::uuid;
      if not found or src.company_id <> _company then
        raise exception 'Ligne d''origine introuvable.' using errcode = 'P0002';
      end if;
      if dt = 'REC' and not (src.doc_type = 'CMD' and src.status in ('validee', 'partielle')) then
        raise exception 'La commande % n''est plus à recevoir.', coalesce(src.number, '') using errcode = 'P0001';
      end if;
      if dt = 'CMD' and not (src.doc_type = 'PCF' and src.status = 'validee') then
        raise exception 'La proposition % n''est plus à commander.', coalesce(src.number, '') using errcode = 'P0001';
      end if;
      if dt = 'RTF' and src.doc_type <> 'REC' then
        raise exception 'Une rétrocession ne reprend qu''une ligne de réception.' using errcode = 'P0001';
      end if;
      if dt = 'PCF' then
        raise exception 'Une proposition ne reprend pas d''autre document.' using errcode = 'P0001';
      end if;
      if sup is not null and src.supplier_id is distinct from sup then
        raise exception 'La ligne reprise vient d''un autre fournisseur (%).', coalesce(src.number, '') using errcode = 'P0001';
      end if;
    end if;
    insert into public.purchase_lines (order_id, article_id, designation, supplier_ref, quantity, unit_price_ht, discount_pct,
                                       vat_rate, sale_price_ttc, bin_location, labels, line_ht, sort_order,
                                       source_line_id, contact_id, origin_kind, origin_id, origin_ref, chassis)
    values (o.id, nullif(l->>'article_id', '')::uuid,
            coalesce(nullif(btrim(l->>'designation'), ''), '—'),
            nullif(btrim(coalesce(l->>'supplier_ref', '')), ''),
            coalesce((l->>'quantity')::numeric, 0),
            coalesce(nullif(l->>'unit_price_ht', '')::numeric, 0),
            coalesce(nullif(l->>'discount_pct', '')::numeric, 0),
            coalesce(nullif(l->>'vat_rate', '')::numeric, 21),
            nullif(l->>'sale_price_ttc', '')::numeric,
            nullif(btrim(coalesce(l->>'bin_location', '')), ''),
            greatest(coalesce(nullif(l->>'labels', '')::int, 0), 0),
            round(coalesce((l->>'quantity')::numeric, 0) * coalesce(nullif(l->>'unit_price_ht', '')::numeric, 0)
                  * (1 - coalesce(nullif(l->>'discount_pct', '')::numeric, 0) / 100), 3),
            k,
            nullif(l->>'source_line_id', '')::uuid,
            nullif(l->>'contact_id', '')::uuid,
            nullif(l->>'origin_kind', ''), nullif(l->>'origin_id', '')::uuid, nullif(l->>'origin_ref', ''),
            case when jsonb_typeof(l->'chassis') = 'object' and coalesce(btrim(l->'chassis'->>'vin'), '') <> '' then l->'chassis' end);
    k := k + 1;
  end loop;

  -- Échéances (réécrites)
  delete from public.purchase_schedules where order_id = o.id;
  insert into public.purchase_schedules (order_id, company_id, seq_no, due_date, amount, note)
  select o.id, _company, coalesce(nullif(s->>'seq_no', '')::int, row_number() over ())::int,
         nullif(s->>'due_date', '')::date, coalesce(nullif(s->>'amount', '')::numeric, 0), nullif(s->>'note', '')
    from jsonb_array_elements(coalesce(_schedules, '[]'::jsonb)) s
   where coalesce(nullif(s->>'amount', '')::numeric, 0) <> 0 or nullif(s->>'due_date', '') is not null;

  perform public._purchase_recompute_totals(o.id);

  if not coalesce(_validate, false) then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'purchase_draft_saved', 'purchase_orders', o.id::text, 'screen', null,
            jsonb_build_object('doc_type', dt, 'supplier_id', sup, 'lines', k));
    return jsonb_build_object('id', o.id, 'number', null, 'status', 'brouillon', 'doc_type', dt, 'warnings', warnings);
  end if;

  -- ---------------------------------------------- Validation
  if sup is null then
    raise exception 'Choisissez le fournisseur avant de valider.' using errcode = 'P0001';
  end if;
  if k = 0 then
    raise exception 'Ajoutez au moins une ligne.' using errcode = 'P0001';
  end if;
  if dt = 'REC' and not exists (select 1 from public.purchase_lines where order_id = o.id and quantity > 0) then
    raise exception 'Aucune quantité reçue.' using errcode = 'P0001';
  end if;

  num := public._next_document_number_unchecked(_company, dt);
  st_new := case when dt = 'REC' then 'recue' else 'validee' end;
  update public.purchase_orders
     set number = num, status = st_new, validated_at = now(), validated_by = auth.uid()
   where id = o.id
  returning * into o;

  if dt = 'REC' then
    -- Base de répartition : HT net des lignes stockées (article + quantité > 0)
    gd := case when o.spread_costs then coalesce(o.global_discount_pct, 0) else 0 end;
    ship := case when o.spread_costs then coalesce(o.shipping_ht, 0) else 0 end;
    select coalesce(sum(pl.quantity * pl.unit_price_ht * (1 - pl.discount_pct / 100)), 0) into basis
      from public.purchase_lines pl join public.articles a on a.id = pl.article_id
     where pl.order_id = o.id and pl.quantity > 0 and a.mgmt_type::text not in ('M', 'F', 'T');

    for r in
      select pl.*, a.mgmt_type::text as mt, a.price_purchase_locked as pa_locked, a.purchase_price as cur_pa
        from public.purchase_lines pl
        left join public.articles a on a.id = pl.article_id
       where pl.order_id = o.id
       order by pl.sort_order
    loop
      if r.source_line_id is not null then
        select po.id into lid from public.purchase_lines pl2 join public.purchase_orders po on po.id = pl2.order_id
         where pl2.id = r.source_line_id;
        if not (lid = any(touched)) then touched := touched || lid; end if;
        if public._purchase_line_received(r.source_line_id) > (select quantity from public.purchase_lines where id = r.source_line_id) then
          warnings := warnings || jsonb_build_object('kind', 'over_received', 'designation', r.designation);
        end if;
      end if;
      if r.article_id is null or r.quantity <= 0 then
        continue;
      end if;
      unit_net := round(r.unit_price_ht * (1 - coalesce(r.discount_pct, 0) / 100), 3);
      -- Prix d'achat de la fiche (G8 « PA mis à jour »), sauf cadenas
      if unit_net > 0 and not coalesce(r.pa_locked, false) and r.cur_pa is distinct from unit_net then
        perform public.record_price_change(r.article_id, unit_net, null, null, null, 'reception');
      end if;
      update public.articles
         set last_purchased_at = now(), main_supplier_id = coalesce(main_supplier_id, sup)
       where id = r.article_id;
      if r.mt in ('M', 'F', 'T') then
        continue;   -- non stocké, texte, main d'oeuvre : pas de mouvement (B1)
      end if;
      landed := round(
        (r.quantity * unit_net * (1 - gd / 100)
         + case when basis > 0 then ship * (r.quantity * r.unit_price_ht * (1 - r.discount_pct / 100)) / basis else 0 end)
        / r.quantity, 3);
      update public.purchase_lines set landed_unit_cost = landed where id = r.id;
      perform public.record_stock_move(r.article_id, 'entree', r.quantity, landed, false, r.bin_location, 'reception', num,
                                       'Réception ' || num || coalesce(' — facture ' || o.supplier_invoice_no, ''));
      if coalesce(r.labels, 0) > 0 then
        insert into public.label_queue (company_id, article_id, qty, with_barcode, with_price, operator_id)
        values (_company, r.article_id, r.labels, true, true, auth.uid());
      end if;
      -- Réception châssis → fiche véhicule (B9), VIN unique dans la société
      ch := r.chassis;
      _vin := upper(btrim(coalesce(ch->>'vin', '')));
      if _vin <> '' then
        if exists (select 1 from public.vehicles v where v.company_id = _company and upper(btrim(v.vin)) = _vin) then
          raise exception 'Le châssis % existe déjà dans le parc : réception annulée.', _vin using errcode = '23505';
        end if;
        if r.mt <> 'V' then
          warnings := warnings || jsonb_build_object('kind', 'chassis_not_v', 'designation', r.designation);
        end if;
        insert into public.vehicles (company_id, article_id, vin, brand, model, engine_number, power_cv, is_restricted, energy,
                                     antipollution, color, first_registration_date, mileage, model_year, gps_tracker_id,
                                     pin_tracker, tpms_av, tpms_ar, warranty_end, purchase_price, cost_price, display_price,
                                     purchase_invoice_number, status)
        values (_company, r.article_id, _vin, nullif(ch->>'brand', ''), coalesce(nullif(ch->>'model', ''), r.designation),
                nullif(ch->>'engine_number', ''), nullif(ch->>'power_cv', '')::numeric,
                coalesce((ch->>'is_restricted')::boolean, false), nullif(ch->>'energy', ''), nullif(ch->>'antipollution', ''),
                nullif(ch->>'color', ''), nullif(ch->>'first_registration_date', '')::date, nullif(ch->>'mileage', '')::numeric,
                nullif(ch->>'model_year', '')::int, nullif(ch->>'gps_tracker_id', ''), nullif(ch->>'pin_tracker', ''),
                nullif(ch->>'tpms_av', ''), nullif(ch->>'tpms_ar', ''), nullif(ch->>'warranty_end', '')::date,
                landed, landed, r.sale_price_ttc, o.supplier_invoice_no, 'stock_vn');
      end if;
    end loop;

    -- Une seule commande rappelée : lien d'en-tête (« Pour qui ? », compatibilité)
    if array_length(touched, 1) = 1 then
      update public.purchase_orders set source_order_id = touched[1] where id = o.id;
    end if;
    foreach lid in array touched loop
      updated := updated || jsonb_build_object('id', lid,
        'number', (select number from public.purchase_orders where id = lid),
        'status', public._purchase_order_refresh_status(lid));
    end loop;

  elsif dt = 'RTF' then
    for r in
      select pl.*, a.mgmt_type::text as mt from public.purchase_lines pl
        join public.articles a on a.id = pl.article_id
       where pl.order_id = o.id and pl.quantity > 0
       order by pl.sort_order
    loop
      if r.mt in ('M', 'F', 'T') then continue; end if;
      perform public.record_stock_move(r.article_id, 'sortie', -r.quantity, null, false, r.bin_location, 'retour_fournisseur', num,
                                       'Rétrocession ' || num || ' (retour fournisseur)');
    end loop;

  elsif dt = 'CMD' then
    -- Lignes reprises d'une proposition : la proposition est transformée
    select coalesce(array_agg(distinct pl2.order_id), '{}') into pcfs
      from public.purchase_lines pl join public.purchase_lines pl2 on pl2.id = pl.source_line_id
     where pl.order_id = o.id;
    foreach lid in array pcfs loop
      update public.purchase_orders set status = 'transformee' where id = lid and status = 'validee';
      continue when not found;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, auth.uid(), 'status_change', 'purchase_orders', lid::text, 'screen',
              jsonb_build_object('status', 'validee'), jsonb_build_object('status', 'transformee', 'order', num));
      updated := updated || jsonb_build_object('id', lid, 'status', 'transformee');
    end loop;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'purchase_validated', 'purchase_orders', o.id::text, 'screen',
          jsonb_build_object('status', 'brouillon'),
          jsonb_build_object('status', st_new, 'number', num, 'doc_type', dt, 'supplier_id', sup,
                             'total_ht', o.total_ht, 'lines', k, 'orders', updated, 'warnings', warnings));

  return jsonb_build_object('id', o.id, 'number', num, 'status', st_new, 'doc_type', dt,
                            'warnings', warnings, 'orders', updated);
end $$;
revoke all on function public.purchase_doc_save(uuid, uuid, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.purchase_doc_save(uuid, uuid, jsonb, jsonb, jsonb, boolean) to authenticated;

-- Supprimer un brouillon (jamais un document validé)
create or replace function public.purchase_draft_delete(_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.purchase_orders%rowtype;
begin
  select * into o from public.purchase_orders where id = _id for update;
  if not found or not public.is_member(o.company_id) then
    raise exception 'Document introuvable.' using errcode = 'P0002';
  end if;
  if o.status <> 'brouillon' then
    raise exception 'Seul un brouillon se supprime.' using errcode = 'P0001';
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (o.company_id, auth.uid(), 'purchase_draft_deleted', 'purchase_orders', o.id::text, 'screen', to_jsonb(o), null);
  perform set_config('app.purchase_rpc', 'on', true);
  delete from public.purchase_orders where id = o.id;
end $$;
revoke all on function public.purchase_draft_delete(uuid) from public, anon;
grant execute on function public.purchase_draft_delete(uuid) to authenticated;

-- ------------------------------------------------ 6. Rappel : lignes restant à recevoir (CMD) ou à commander (PCF)
create or replace function public.purchase_open_lines(_company uuid, _supplier uuid, _doc_type text default 'CMD', _order uuid default null)
returns table (
  order_id uuid, order_number text, order_date date, order_type text, order_status text, dcs_kind text,
  line_id uuid, article_id uuid, reference text, designation text, supplier_ref text,
  quantity numeric, received numeric, remaining numeric, unit_price_ht numeric, discount_pct numeric,
  vat_rate numeric, sale_price_ttc numeric, bin_location text, pack_qty numeric, mgmt_type text,
  contact_id uuid, contact_name text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select o.id, o.number, o.order_date, o.order_type, o.status, o.dcs_kind,
         l.id, l.article_id, a.reference, l.designation, l.supplier_ref,
         l.quantity,
         case when o.doc_type = 'CMD' then public._purchase_line_received(l.id)
              else coalesce((select sum(x.quantity) from public.purchase_lines x join public.purchase_orders xo on xo.id = x.order_id
                              where x.source_line_id = l.id and xo.doc_type = 'CMD' and xo.status not in ('brouillon', 'annulee')), 0) end,
         greatest(l.quantity - case when o.doc_type = 'CMD' then public._purchase_line_received(l.id)
              else coalesce((select sum(x.quantity) from public.purchase_lines x join public.purchase_orders xo on xo.id = x.order_id
                              where x.source_line_id = l.id and xo.doc_type = 'CMD' and xo.status not in ('brouillon', 'annulee')), 0) end, 0),
         l.unit_price_ht, l.discount_pct, l.vat_rate, l.sale_price_ttc,
         coalesce(l.bin_location, a.bin_location), a.pack_qty, a.mgmt_type::text,
         l.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''))
    from public.purchase_orders o
    join public.purchase_lines l on l.order_id = o.id
    left join public.articles a on a.id = l.article_id
    left join public.contacts c on c.id = l.contact_id
   where o.company_id = _company
     and (_supplier is null or o.supplier_id = _supplier)
     and (_order is null or o.id = _order)
     and o.doc_type = upper(coalesce(_doc_type, 'CMD'))
     and ((o.doc_type = 'CMD' and o.status in ('validee', 'partielle'))
          or (o.doc_type = 'PCF' and o.status = 'validee'))
   order by o.order_date nulls last, o.number, l.sort_order;
end $$;
revoke all on function public.purchase_open_lines(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.purchase_open_lines(uuid, uuid, text, uuid) to authenticated;

-- Suivi d'une commande : reçu / reste par ligne, réceptions, envois
create or replace function public.purchase_order_follow(_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o public.purchase_orders%rowtype;
begin
  select * into o from public.purchase_orders where id = _order;
  if not found or not public.is_member(o.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id, 'quantity', l.quantity,
                         'received', public._purchase_line_received(l.id),
                         'remaining', greatest(l.quantity - public._purchase_line_received(l.id), 0)) order by l.sort_order)
                        from public.purchase_lines l where l.order_id = o.id), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'date', r.receipt_date,
                            'invoice_no', r.supplier_invoice_no, 'status', r.status) order by r.receipt_date, r.number)
                           from public.purchase_orders r
                          where r.doc_type = 'REC' and r.status <> 'annulee'
                            and exists (select 1 from public.purchase_lines rl join public.purchase_lines cl on cl.id = rl.source_line_id
                                         where rl.order_id = r.id and cl.order_id = o.id)), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'status', c.status) order by c.number)
                         from public.purchase_orders c
                        where c.id <> o.id
                          and exists (select 1 from public.purchase_lines rl join public.purchase_lines cl on cl.id = rl.source_line_id
                                       where rl.order_id = o.id and cl.order_id = c.id)), '[]'::jsonb),
    'sends', coalesce((select jsonb_agg(jsonb_build_object('sent_at', s.sent_at, 'channel', s.channel, 'note', s.note,
                         'sent_by', (select p.full_name from public.profiles p where p.id = s.sent_by)) order by s.sent_at desc)
                        from public.purchase_order_sends s where s.order_id = o.id), '[]'::jsonb),
    'merged', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'number', m.number))
                         from public.purchase_orders m where m.merged_into_id = o.id), '[]'::jsonb)
  );
end $$;
revoke all on function public.purchase_order_follow(uuid) from public, anon;
grant execute on function public.purchase_order_follow(uuid) to authenticated;

-- ------------------------------------------------ 7. Solder le reliquat (le fournisseur ne livrera pas le reste)
create or replace function public.purchase_order_close_remainder(_order uuid, _note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.purchase_orders%rowtype;
begin
  select * into o from public.purchase_orders where id = _order for update;
  if not found or not public.is_member(o.company_id) then
    raise exception 'Document introuvable.' using errcode = 'P0002';
  end if;
  if o.doc_type <> 'CMD' or o.status not in ('validee', 'partielle') then
    raise exception 'Seule une commande validée ou reçue en partie se solde.' using errcode = 'P0001';
  end if;
  perform set_config('app.purchase_rpc', 'on', true);
  update public.purchase_orders set status = 'soldee' where id = o.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (o.company_id, auth.uid(), 'status_change', 'purchase_orders', o.id::text, 'screen',
          jsonb_build_object('status', o.status, 'number', o.number),
          jsonb_build_object('status', 'soldee', 'number', o.number, 'note', nullif(btrim(coalesce(_note, '')), '')));
end $$;
revoke all on function public.purchase_order_close_remainder(uuid, text) from public, anon;
grant execute on function public.purchase_order_close_remainder(uuid, text) to authenticated;

-- ------------------------------------------------ 8. Envoi d'une commande (date, heure, canal)
create or replace function public.purchase_order_log_send(_order uuid, _channel text, _note text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.purchase_orders%rowtype; sid bigint;
begin
  select * into o from public.purchase_orders where id = _order;
  if not found or not public.is_member(o.company_id) then
    raise exception 'Document introuvable.' using errcode = 'P0002';
  end if;
  if o.doc_type not in ('CMD', 'PCF') or o.status in ('brouillon', 'annulee') then
    raise exception 'Seule une commande validée s''envoie.' using errcode = 'P0001';
  end if;
  if coalesce(_channel, '') not in ('mail', 'dcs', 'b2b', 'telephone', 'papier', 'autre') then
    raise exception 'Canal d''envoi inconnu.' using errcode = 'P0001';
  end if;
  insert into public.purchase_order_sends (company_id, order_id, channel, note, sent_by)
  values (o.company_id, o.id, _channel, nullif(btrim(coalesce(_note, '')), ''), auth.uid())
  returning id into sid;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (o.company_id, auth.uid(), 'purchase_order_sent', 'purchase_orders', o.id::text, 'screen', null,
          jsonb_build_object('number', o.number, 'channel', _channel, 'note', nullif(btrim(coalesce(_note, '')), '')));
  return sid;
end $$;
revoke all on function public.purchase_order_log_send(uuid, text, text) from public, anon;
grant execute on function public.purchase_order_log_send(uuid, text, text) to authenticated;

-- ------------------------------------------------ 9. Regroupement des commandes d'un fournisseur
-- Toutes du même fournisseur, même type (CMD ou PCF), même statut (brouillon ou validee), même fichier DCS,
-- rien de reçu. Les lignes rejoignent la plus ancienne ; les autres passent « annulee » avec le lien.
create or replace function public.purchase_orders_merge(_company uuid, _ids uuid[], _note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; nsup int; ntype int; nst int; ndcs int; target public.purchase_orders%rowtype; m record; _off int;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  perform 1 from public.purchase_orders where id = any(_ids) for update;
  select count(*), count(distinct supplier_id), count(distinct doc_type), count(distinct status), count(distinct coalesce(dcs_kind, '-'))
    into n, nsup, ntype, nst, ndcs
    from public.purchase_orders where id = any(_ids) and company_id = _company;
  if n < 2 or n <> (select count(distinct u) from unnest(_ids) u) then
    raise exception 'Cochez au moins deux commandes de la société.' using errcode = 'P0001';
  end if;
  if nsup <> 1 or exists (select 1 from public.purchase_orders where id = any(_ids) and supplier_id is null) then
    raise exception 'Les commandes à regrouper doivent avoir le même fournisseur.' using errcode = 'P0001';
  end if;
  if ntype <> 1 or nst <> 1 or ndcs <> 1 then
    raise exception 'Les commandes à regrouper doivent être du même type, du même statut et du même fichier DCS.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.purchase_orders where id = any(_ids)
              and (doc_type not in ('CMD', 'PCF') or status not in ('brouillon', 'validee'))) then
    raise exception 'Seules des commandes ou propositions en brouillon ou validées (rien de reçu) se regroupent.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.purchase_lines l where l.order_id = any(_ids) and public._purchase_line_received(l.id) > 0) then
    raise exception 'Une des commandes est déjà reçue en partie.' using errcode = 'P0001';
  end if;

  select * into target from public.purchase_orders where id = any(_ids) order by created_at, number limit 1;
  perform set_config('app.purchase_rpc', 'on', true);
  for m in select * from public.purchase_orders where id = any(_ids) and id <> target.id order by created_at loop
    select coalesce(max(sort_order), -1) + 1 into _off from public.purchase_lines where order_id = target.id;
    update public.purchase_lines set order_id = target.id, sort_order = sort_order + _off where order_id = m.id;
    update public.purchase_orders
       set status = 'annulee', merged_into_id = target.id,
           notes = btrim(concat_ws(' — ', notes, 'Regroupée dans ' || coalesce(target.number, 'le brouillon')))
     where id = m.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'purchase_merged', 'purchase_orders', m.id::text, 'screen',
            jsonb_build_object('status', m.status, 'number', m.number),
            jsonb_build_object('status', 'annulee', 'merged_into', target.id, 'merged_into_number', target.number));
  end loop;
  perform public._purchase_recompute_totals(target.id);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'purchase_merge_target', 'purchase_orders', target.id::text, 'screen', null,
          jsonb_build_object('number', target.number, 'merged', to_jsonb(_ids), 'note', nullif(btrim(coalesce(_note, '')), '')));
  return jsonb_build_object('id', target.id, 'number', target.number, 'merged', n - 1);
end $$;
revoke all on function public.purchase_orders_merge(uuid, uuid[], text) from public, anon;
grant execute on function public.purchase_orders_merge(uuid, uuid[], text) to authenticated;

-- ------------------------------------------------ 10. Mise en proposition de commande (article, vente, OR)
-- _items : [{ article_id, qty, supplier_id?, contact_id?, designation? }]. Une proposition (PCF) en brouillon
-- par fournisseur et par type est complétée (ou créée). Quantité arrondie au conditionnement d'achat (INV009).
-- Type dépannage : remise dépannage du fournisseur en remise de ligne.
create or replace function public.purchase_proposal_add(
  _company uuid, _order_type text, _items jsonb, _origin_kind text default 'article', _origin_id uuid default null,
  _origin_ref text default null, _note text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare it jsonb; a public.articles%rowtype; s uuid; pcf uuid; q numeric; pk numeric; disc numeric; res jsonb := '[]'::jsonb; k int;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if coalesce(_order_type, '') not in ('stock', 'depannage', 'garantie') then
    raise exception 'Type de commande inconnu (stock, dépannage, garantie).' using errcode = 'P0001';
  end if;
  if coalesce(_origin_kind, '') not in ('article', 'document', 'repair_order', 'reorder') then
    raise exception 'Origine inconnue.' using errcode = 'P0001';
  end if;
  perform set_config('app.purchase_rpc', 'on', true);
  for it in select value from jsonb_array_elements(coalesce(_items, '[]'::jsonb)) loop
    select * into a from public.articles where id = nullif(it->>'article_id', '')::uuid and company_id = _company;
    if not found then
      raise exception 'Article introuvable dans cette société.' using errcode = 'P0002';
    end if;
    q := coalesce(nullif(it->>'qty', '')::numeric, 0);
    if q <= 0 then continue; end if;
    pk := coalesce(a.pack_qty, 0);
    if pk > 1 then q := ceil(q / pk) * pk; end if;
    s := coalesce(nullif(it->>'supplier_id', '')::uuid, a.main_supplier_id);
    if s is null then
      raise exception 'L''article % n''a pas de fournisseur : choisissez-le.', a.reference using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.contacts c where c.id = s and c.company_id = _company and c.type = 'fournisseur') then
      raise exception 'Fournisseur introuvable dans cette société.' using errcode = 'P0002';
    end if;
    select o.id into pcf from public.purchase_orders o
     where o.company_id = _company and o.doc_type = 'PCF' and o.status = 'brouillon'
       and o.supplier_id = s and o.order_type = _order_type
     order by o.created_at desc limit 1;
    if pcf is null then
      insert into public.purchase_orders (company_id, doc_type, status, supplier_id, order_type, order_date, operator_id, vat_regime, notes)
      select _company, 'PCF', 'brouillon', s, _order_type, (now() at time zone 'Europe/Brussels')::date, auth.uid(),
             coalesce(c.supplier_vat_regime, 'with_vat'), nullif(btrim(coalesce(_note, '')), '')
        from public.contacts c where c.id = s
      returning id into pcf;
    end if;
    select case when _order_type = 'depannage' then coalesce(c.supplier_rush_discount_pct, 0) else 0 end into disc
      from public.contacts c where c.id = s;
    select coalesce(max(sort_order), -1) + 1 into k from public.purchase_lines where order_id = pcf;
    insert into public.purchase_lines (order_id, article_id, designation, supplier_ref, quantity, unit_price_ht, discount_pct,
                                       vat_rate, sale_price_ttc, bin_location, line_ht, sort_order,
                                       contact_id, origin_kind, origin_id, origin_ref)
    values (pcf, a.id, btrim(concat_ws(' ', a.reference, coalesce(nullif(btrim(it->>'designation'), ''), a.designation))),
            coalesce(nullif(btrim(a.supplier_ref), ''), a.reference), q,
            case when coalesce(a.purchase_price, 0) > 0 then a.purchase_price else coalesce(a.pamp, 0) end,
            disc, coalesce(a.vat_rate, 21), a.sale_price_ttc, a.bin_location,
            round(q * (case when coalesce(a.purchase_price, 0) > 0 then a.purchase_price else coalesce(a.pamp, 0) end) * (1 - disc / 100), 3),
            k, nullif(it->>'contact_id', '')::uuid, _origin_kind, _origin_id, _origin_ref);
    perform public._purchase_recompute_totals(pcf);
    res := res || jsonb_build_object('proposal_id', pcf, 'article_id', a.id, 'qty', q, 'supplier_id', s);
    pcf := null;
  end loop;
  if jsonb_array_length(res) = 0 then
    raise exception 'Aucune quantité à proposer.' using errcode = 'P0001';
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'purchase_proposal_add', coalesce(_origin_kind, 'article'), coalesce(_origin_id::text, ''), 'screen', null,
          jsonb_build_object('order_type', _order_type, 'origin_ref', _origin_ref, 'items', res));
  return jsonb_build_object('items', res);
end $$;
revoke all on function public.purchase_proposal_add(uuid, text, jsonb, text, uuid, text, text) from public, anon;
grant execute on function public.purchase_proposal_add(uuid, text, jsonb, text, uuid, text, text) to authenticated;

-- Proposition validée → commande en brouillon (lignes reliées ; la proposition est « transformée » à la validation de la commande)
create or replace function public.purchase_proposal_to_order(_proposal uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.purchase_orders%rowtype; cmd uuid;
begin
  select * into p from public.purchase_orders where id = _proposal;
  if not found or not public.is_member(p.company_id) then
    raise exception 'Document introuvable.' using errcode = 'P0002';
  end if;
  if p.doc_type <> 'PCF' or p.status <> 'validee' then
    raise exception 'Seule une proposition validée passe en commande.' using errcode = 'P0001';
  end if;
  perform set_config('app.purchase_rpc', 'on', true);
  insert into public.purchase_orders (company_id, doc_type, status, supplier_id, order_type, order_date, operator_id, vat_regime,
                                      shipping_ht, shipping_taxed, shipping_vat_rate, notes)
  values (p.company_id, 'CMD', 'brouillon', p.supplier_id, p.order_type, (now() at time zone 'Europe/Brussels')::date, auth.uid(),
          p.vat_regime, p.shipping_ht, p.shipping_taxed, p.shipping_vat_rate, p.notes)
  returning id into cmd;
  insert into public.purchase_lines (order_id, article_id, designation, supplier_ref, quantity, unit_price_ht, discount_pct, vat_rate,
                                     sale_price_ttc, bin_location, labels, line_ht, sort_order, source_line_id, contact_id,
                                     origin_kind, origin_id, origin_ref)
  select cmd, l.article_id, l.designation, l.supplier_ref, l.quantity, l.unit_price_ht, l.discount_pct, l.vat_rate,
         l.sale_price_ttc, l.bin_location, l.labels, l.line_ht, l.sort_order, l.id, l.contact_id, l.origin_kind, l.origin_id, l.origin_ref
    from public.purchase_lines l where l.order_id = p.id;
  perform public._purchase_recompute_totals(cmd);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (p.company_id, auth.uid(), 'purchase_proposal_to_order', 'purchase_orders', p.id::text, 'screen', null,
          jsonb_build_object('proposal', p.number, 'order_draft', cmd));
  return cmd;
end $$;
revoke all on function public.purchase_proposal_to_order(uuid) from public, anon;
grant execute on function public.purchase_proposal_to_order(uuid) to authenticated;

-- ------------------------------------------------ 11. « Infos commandes client » d'une réception
-- Pour chaque article reçu : les clients qui l'attendent.
--   part_order   : commandes de pièces reliées à la ligne de commande reçue (commandée pour eux),
--                  ou validées et pas encore passées chez un fournisseur ;
--   document     : réservations / bons de commande validés (non transformés) qui contiennent l'article ;
--   repair_order : OR ouverts (ni facturés ni annulés) qui contiennent l'article.
create or replace function public.receipt_customer_infos(_receipt uuid)
returns table (
  receipt_line_id uuid, article_id uuid, reference text, designation text, qty_received numeric, bin_location text,
  source_kind text, source_id uuid, source_number text, source_type text, source_status text, source_date date,
  contact_id uuid, contact_name text, contact_phone text, qty_needed numeric, ordered_for boolean,
  informed_at timestamptz, informed_channel text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p public.purchase_orders%rowtype;
begin
  select * into p from public.purchase_orders where id = _receipt;
  if not found or not public.is_member(p.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  with rl as (
    select l.id, l.article_id, a.reference, coalesce(nullif(btrim(a.designation), ''), l.designation) as des,
           l.quantity, coalesce(l.bin_location, a.bin_location) as bin, l.source_line_id
      from public.purchase_lines l join public.articles a on a.id = l.article_id
     where l.order_id = p.id and l.quantity > 0
  ), src as (
    -- commandes de pièces
    select rl.id as rlid, 'part_order'::text as kind, o.id as sid, o.number as snum, o.order_kind::text as stype,
           o.dispatch_status::text as sst, coalesce(o.validated_at, o.created_at)::date as sdate, o.contact_id as cid,
           (pl.qty_client + pl.qty_shop) as qn, (pl.purchase_line_id is not null and pl.purchase_line_id = rl.source_line_id) as ofor
      from rl
      join public.part_order_lines pl on pl.article_id = rl.article_id
      join public.part_orders o on o.id = pl.order_id
     where o.company_id = p.company_id
       and o.dispatch_status::text <> 'annulee'
       and ((pl.purchase_line_id is not null and pl.purchase_line_id = rl.source_line_id)
            or (pl.purchase_line_id is null and o.dispatch_status::text in ('en_attente_paiement', 'payee', 'a_envoyer')))
    union all
    -- réservations / bons de commande en attente
    select rl.id, 'document', d.id, d.number, d.doc_type::text, d.status::text, d.issue_date, d.contact_id,
           sum(dl.quantity), false
      from rl
      join public.document_lines dl on dl.article_id = rl.article_id
      join public.documents d on d.id = dl.document_id
     where d.company_id = p.company_id and d.doc_type::text in ('RES', 'BC')
       and d.status::text not in ('brouillon', 'annulee', 'converti')
     group by rl.id, d.id, d.number, d.doc_type, d.status, d.issue_date, d.contact_id
    union all
    -- OR ouverts
    select rl.id, 'repair_order', ro.id, ro.number, 'OR', ro.status::text, ro.created_at::date, ro.contact_id,
           sum(rol.quantity), false
      from rl
      join public.repair_order_lines rol on rol.article_id = rl.article_id
      join public.repair_orders ro on ro.id = rol.or_id
     where ro.company_id = p.company_id and ro.status::text not in ('facture', 'annule')
     group by rl.id, ro.id, ro.number, ro.status, ro.created_at, ro.contact_id
  )
  select rl.id, rl.article_id, rl.reference, rl.des, rl.quantity, rl.bin,
         src.kind, src.sid, src.snum, src.stype, src.sst, src.sdate, src.cid,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         coalesce(nullif(btrim(c.gsm), ''), nullif(btrim(c.mobile), ''), nullif(btrim(c.phone), '')),
         src.qn, src.ofor,
         n.informed_at, n.channel
    from rl
    join src on src.rlid = rl.id
    left join public.contacts c on c.id = src.cid
    left join lateral (
      select x.informed_at, x.channel from public.purchase_customer_notices x
       where x.source_kind = src.kind and x.source_id = src.sid
         and (x.article_id is null or x.article_id = rl.article_id)
       order by x.informed_at desc limit 1
    ) n on true
   order by rl.reference, src.ofor desc, src.sdate;
end $$;
revoke all on function public.receipt_customer_infos(uuid) from public, anon;
grant execute on function public.receipt_customer_infos(uuid) to authenticated;

create or replace function public.receipt_customer_informed(
  _receipt uuid, _article uuid, _source_kind text, _source_id uuid, _contact uuid, _channel text, _note text default null
)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.purchase_orders%rowtype; nid bigint;
begin
  select * into p from public.purchase_orders where id = _receipt;
  if not found or not public.is_member(p.company_id) or p.doc_type <> 'REC' then
    raise exception 'Réception introuvable.' using errcode = 'P0002';
  end if;
  if coalesce(_source_kind, '') not in ('part_order', 'document', 'repair_order') then
    raise exception 'Document client inconnu.' using errcode = 'P0001';
  end if;
  if coalesce(_channel, '') not in ('telephone', 'sms', 'email', 'comptoir', 'autre') then
    raise exception 'Moyen inconnu.' using errcode = 'P0001';
  end if;
  if _contact is not null and not exists (select 1 from public.contacts c where c.id = _contact and c.company_id = p.company_id) then
    raise exception 'Client introuvable dans cette société.' using errcode = 'P0002';
  end if;
  insert into public.purchase_customer_notices (company_id, receipt_id, article_id, source_kind, source_id, contact_id, channel, note, informed_by)
  values (p.company_id, p.id, _article, _source_kind, _source_id, _contact, _channel, nullif(btrim(coalesce(_note, '')), ''), auth.uid())
  returning id into nid;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (p.company_id, auth.uid(), 'customer_informed_arrival', 'contacts', coalesce(_contact::text, ''), 'screen', null,
          jsonb_build_object('receipt', p.number, 'article_id', _article, 'source_kind', _source_kind, 'source_id', _source_id,
                             'channel', _channel));
  return nid;
end $$;
revoke all on function public.receipt_customer_informed(uuid, uuid, text, uuid, uuid, text, text) from public, anon;
grant execute on function public.receipt_customer_informed(uuid, uuid, text, uuid, uuid, text, text) to authenticated;

-- ------------------------------------------------ 12. « En commande » = reste à recevoir
-- Même signature et même règle client que 20260919370000. Changements :
--   a. une ligne de CMD (validee OU partielle) compte son RESTE = commandé − reçu (réceptions reliées
--      ligne à ligne), moins ce qui reste des pièces de commandes de pièces reliées (servies en premier) ;
--   b. une pièce de commande de pièces ne compte plus quand sa ligne de CMD est entièrement reçue
--      (ou, ancien chemin, quand une REC reçue est reliée à toute la CMD) ou que la CMD est soldée.
create or replace function public.article_on_order_for(_article uuid, _contact uuid default null, _document uuid default null)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  with po as (
    select l.qty_client, l.qty_shop, o.contact_id, o.source_document_id,
           coalesce((select sum(a.qty) from public.part_order_allocations a
                      where a.part_order_line_id = l.id and a.cancelled_at is null), 0) as alloc_all,
           coalesce((select sum(a.qty) from public.part_order_allocations a
                      where a.part_order_line_id = l.id and a.cancelled_at is null
                        and ((_contact is not null and a.contact_id = _contact)
                             or (_document is not null and a.document_id = _document))), 0) as alloc_mine
      from public.part_order_lines l
      join public.part_orders o on o.id = l.order_id
     where l.article_id = _article
       and o.dispatch_status not in ('brouillon', 'annulee')
       and not exists (
         select 1
           from public.purchase_lines pl
           join public.purchase_orders c on c.id = pl.order_id
          where pl.id = l.purchase_line_id
            and (c.status in ('recue', 'soldee', 'annulee')
                 or public._purchase_line_received(pl.id) >= pl.quantity
                 or exists (select 1 from public.purchase_orders r
                             where r.source_order_id = c.id and r.doc_type = 'REC' and r.status = 'recue'
                               and not exists (select 1 from public.purchase_lines rl where rl.order_id = r.id and rl.source_line_id is not null))))
  )
  select
    -- 1. commandes fournisseur pour le stock : reste à recevoir, hors pièces encore attendues par une commande de pièces
    coalesce((
      select sum(greatest(
               greatest(pl.quantity - public._purchase_line_received(pl.id), 0)
               - greatest(coalesce((
                   select sum(x.qty_client + x.qty_shop)
                     from public.part_order_lines x
                     join public.part_orders xo on xo.id = x.order_id
                    where x.purchase_line_id = pl.id
                      and xo.dispatch_status not in ('brouillon', 'annulee')), 0) - public._purchase_line_received(pl.id), 0),
               0))
        from public.purchase_lines pl
        join public.purchase_orders o on o.id = pl.order_id
       where pl.article_id = _article
         and o.doc_type = 'CMD'
         and o.status in ('validee', 'partielle')
         and not exists (
           select 1 from public.purchase_orders r
            where r.source_order_id = o.id and r.doc_type = 'REC' and r.status = 'recue'
              and not exists (select 1 from public.purchase_lines rl where rl.order_id = r.id and rl.source_line_id is not null))), 0)
    -- 2. quantité magasin non associée à un client
    + coalesce((select sum(greatest(po.qty_shop - po.alloc_all, 0)) from po), 0)
    -- 3. quantité client des commandes de CE client (contact ou document)
    + coalesce((select sum(po.qty_client) from po
                 where (_contact is not null and po.contact_id = _contact)
                    or (_document is not null and po.source_document_id = _document)), 0)
    -- 4. quantité magasin associée à ce client
    + coalesce((select sum(least(po.alloc_mine, po.qty_shop)) from po), 0);
$$;
revoke all on function public.article_on_order_for(uuid, uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------ 13. « Pour qui ? » sur une réception reliée ligne à ligne
-- Même signature que 20260919370000. CMD : ses lignes. REC : les lignes de commande qu'elle reçoit
-- (source_line_id), sinon l'ancien lien d'en-tête source_order_id. purchase_line_id = ligne du document affiché.
create or replace function public.purchase_order_destinations(_order uuid)
returns table (
  purchase_line_id uuid, part_order_line_id uuid, part_order_id uuid, part_order_number text,
  order_kind text, dispatch_status text, contact_id uuid, contact_name text,
  source_document_id uuid, source_document_number text, qty_client numeric, qty_shop numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p public.purchase_orders%rowtype;
begin
  select * into p from public.purchase_orders where id = _order;
  if not found or not public.is_member(p.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  with map as (
    -- (ligne affichée, ligne de commande)
    select pl.id as shown, pl.id as cmd_line, pl.sort_order as so
      from public.purchase_lines pl where p.doc_type = 'CMD' and pl.order_id = p.id
    union all
    select rl.id, rl.source_line_id, rl.sort_order
      from public.purchase_lines rl where p.doc_type = 'REC' and rl.order_id = p.id and rl.source_line_id is not null
    union all
    select pl.id, pl.id, pl.sort_order
      from public.purchase_lines pl
     where p.doc_type = 'REC' and p.source_order_id is not null and pl.order_id = p.source_order_id
       and not exists (select 1 from public.purchase_lines rl where rl.order_id = p.id and rl.source_line_id is not null)
  )
  select map.shown, l.id, o.id, o.number, o.order_kind::text, o.dispatch_status::text, o.contact_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         o.source_document_id, d.number, l.qty_client, l.qty_shop
    from map
    join public.part_order_lines l on l.purchase_line_id = map.cmd_line
    join public.part_orders o on o.id = l.order_id
    left join public.contacts c on c.id = o.contact_id
    left join public.documents d on d.id = o.source_document_id
   where o.company_id = p.company_id
   order by map.so, o.number;
end $$;
revoke all on function public.purchase_order_destinations(uuid) from public, anon;
grant execute on function public.purchase_order_destinations(uuid) to authenticated;
