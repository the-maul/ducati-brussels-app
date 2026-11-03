-- =====================================================================
-- Mission 09 — cartes 1, 2 et 4 : le PANIER de commande Ducati (standard / urgente),
-- le fichier ExportDucati conservé, le numéro DCS saisi après coup.
-- Décisions de Simon des 30/10 et 03/11/2026 (M-78, M-79, M-80).
--
-- 1. supplier_baskets : plusieurs paniers ouverts par société, chacun d'un type
--    ('standard' | 'urgente' | 'demo' — le démo est servi par un autre lot), un libellé,
--    un statut (ouvert → commandé → reçu, ou annulé), la date et l'opérateur de la
--    validation, le fichier généré (GED), le numéro de commande donné par le DCS
--    (vide à la validation, SAISI À LA MAIN après), le total HTVA et le supplément.
-- 2. supplier_basket_lines : article, quantité, origine ('minimax' | 'atelier' |
--    'comptoir' | 'site' | 'manuel'), référence d'origine, client (colonne G du fichier),
--    prix d'achat et prix de vente au moment de l'ajout, stock réel à l'ajout.
-- 3. Minimax automatique : basket_fill_minimax (bouton) + tâche pg_cron quotidienne
--    sur le panier standard ouvert le plus récent (créé s'il n'existe pas).
--    Quantité = greatest(stock_max, stock_min) − stock réel − déjà en commande.
-- 4. Alimentation : basket_add_lines(_company, _kind, _lines jsonb) — RÉUTILISABLE par
--    les autres lots (popup entretien, démo) ; basket_fill_from_part_orders (comptoir,
--    « Commandes de pièces à passer ») ; basket_fill_from_shopify (site).
-- 5. Règles à la validation (basket_order) : minimum du type (Paramètres → Tables →
--    Règles des types de commande : standard 250 € HTVA), urgente UNE par jour et sans
--    minimum, supplément du type figé sur le panier (urgente +12 %, M-78).
-- 6. Le stock ne bouge pas à la commande (B7) : il bougera à la réception.
--
-- Additif : 2 tables, 1 colonne (stock_max déjà présente : `if not exists`), 1 réglage
-- (urgente 10 % → 12 % là où la valeur par défaut n'avait pas été touchée), 14 fonctions,
-- 1 trigger de garde, 1 tâche pg_cron. Aucun mouvement de stock.
-- =====================================================================

-- ------------------------------------------------ 1. Colonne article (maximum du minimax)
alter table public.articles add column if not exists stock_max numeric(12,3) not null default 0;
comment on column public.articles.stock_max is
  'Stock maximum : quantité cible du réassort minimax (mission 09, carte 1). 0 = on remonte au minimum.';

-- ------------------------------------------------ 2. Urgente : +12 % (M-78) là où le défaut (10) n'a pas été modifié
-- Constat du 03/11 en base : les codes des règles sont en MAJUSCULES (URGENTE, STANDARD… — l'écran
-- Paramètres les écrit ainsi) alors que part_order_rules comparait au code de l'énum en minuscules :
-- aucune règle n'était trouvée (« aucune règle réglée »), donc ni minimum ni « une par jour ».
-- Correction : comparaison insensible à la casse (part_order_rules redéfinie plus bas) ; la mise à
-- jour et les lignes par défaut suivent la même règle.
update public.reference_values
   set extra = jsonb_set(coalesce(extra, '{}'::jsonb), '{surcharge_pct}', '12'::jsonb)
 where table_key = 'order_threshold' and upper(code) = 'URGENTE'
   and coalesce(public._jnum(extra, 'surcharge_pct'), 10) = 10;

insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'order_threshold', d.code, d.label, d.sort_order, d.extra::jsonb
  from public.companies c
 cross join (values
   ('standard','Commande standard (journalière)',1,'{"min_ht":250,"surcharge_pct":0}'),
   ('urgente','Commande urgente',2,'{"min_ht":0,"surcharge_pct":12,"max_per_day":1}'),
   ('accident','Commande accident',3,'{"min_ht":1500,"fallback":"standard"}'),
   ('excel','Commande Excel',4,'{"min_ht_per_tab":2000,"tabs":["demo","courtoisie","showroom"]}')
 ) as d(code, label, sort_order, extra)
 where not exists (select 1 from public.reference_values rv
                    where rv.company_id = c.id and rv.table_key = 'order_threshold' and upper(rv.code) = upper(d.code));

create or replace function public.part_order_rules(_company uuid)
returns table (
  code text, label text, sort_order int, is_active boolean, configured boolean,
  min_ht numeric, surcharge_pct numeric, max_per_day int, fallback text, min_ht_per_tab numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select k.code,
         coalesce(rv.label, k.code),
         coalesce(rv.sort_order, 100 + k.pos)::int,
         coalesce(rv.is_active, true),
         rv.id is not null,
         public._jnum(rv.extra, 'min_ht'),
         coalesce(public._jnum(rv.extra, 'surcharge_pct'), 0),
         public._jnum(rv.extra, 'max_per_day')::int,
         lower(nullif(trim(rv.extra ->> 'fallback'), '')),
         public._jnum(rv.extra, 'min_ht_per_tab')
    from (select e.enumlabel::text as code, e.enumsortorder::int as pos
            from pg_enum e where e.enumtypid = 'public.order_kind'::regtype) k
    left join lateral (
      select r.* from public.reference_values r
       where r.company_id = _company and r.table_key = 'order_threshold' and upper(r.code) = upper(k.code)
       order by (r.code = k.code) desc, r.updated_at desc limit 1
    ) rv on true
   order by 3, 1;
end $$;
revoke all on function public.part_order_rules(uuid) from public, anon;
grant execute on function public.part_order_rules(uuid) to authenticated;

-- ------------------------------------------------ 3. Tables
create table if not exists public.supplier_baskets (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  kind             text not null default 'standard' check (kind in ('standard', 'urgente', 'demo')),
  label            text not null default '',
  status           text not null default 'ouvert' check (status in ('ouvert', 'commande', 'recu', 'annule')),
  dcs_order_number text,
  ordered_at       timestamptz,
  ordered_by       uuid references auth.users(id) on delete set null,
  received_at      timestamptz,
  cancelled_at     timestamptz,
  file_path        text,
  file_attachment_id uuid references public.attachments(id) on delete set null,
  total_ht         numeric(14,2) not null default 0,
  surcharge_pct    numeric(6,2)  not null default 0,
  notes            text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.supplier_baskets is
  'Mission 09 : paniers de commande Ducati (standard / urgente / démo). Plusieurs paniers ouverts par société. '
  'Validation = basket_order (date, opérateur, fichier ExportDucati, statut « commandé ») ; numéro DCS saisi après coup.';
comment on column public.supplier_baskets.dcs_order_number is
  'Numéro donné par le DCS Ducati : vide à la validation, saisi à la main ensuite (basket_set_dcs_number).';
comment on column public.supplier_baskets.file_path is
  'Chemin du fichier ExportDucati.xls dans le bucket ged (conservé avec la commande, régénérable).';
create index if not exists idx_supplier_baskets_list on public.supplier_baskets (company_id, status, kind, ordered_at desc);

create table if not exists public.supplier_basket_lines (
  id              uuid primary key default gen_random_uuid(),
  basket_id       uuid not null references public.supplier_baskets(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete restrict,
  article_id      uuid not null references public.articles(id) on delete restrict,
  reference       text not null,
  designation     text not null default '',
  qty             numeric(14,3) not null check (qty > 0),
  origin          text not null default 'manuel' check (origin in ('minimax', 'atelier', 'comptoir', 'site', 'manuel')),
  origin_ref      text,
  origin_line_id  uuid,
  contact_id      uuid references public.contacts(id) on delete set null,
  purchase_price  numeric(14,3),
  sale_price_ht   numeric(14,3),
  in_stock_qty    numeric(14,3) not null default 0,
  sort_order      int not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
comment on table public.supplier_basket_lines is
  'Lignes d''un panier de commande Ducati : origine (minimax, atelier, comptoir, site, manuel), référence d''origine '
  '(n° d''OR, de commande de pièces, de commande du site), client (colonne G du fichier), prix et stock réel à l''ajout.';
create index if not exists idx_supplier_basket_lines_basket on public.supplier_basket_lines (basket_id, sort_order);
create index if not exists idx_supplier_basket_lines_article on public.supplier_basket_lines (article_id);
create index if not exists idx_supplier_basket_lines_origin on public.supplier_basket_lines (origin_line_id) where origin_line_id is not null;

drop trigger if exists trg_supplier_baskets_updated on public.supplier_baskets;
create trigger trg_supplier_baskets_updated before update on public.supplier_baskets
  for each row execute function public.set_updated_at();
drop trigger if exists trg_supplier_baskets_audit on public.supplier_baskets;
create trigger trg_supplier_baskets_audit after insert or update or delete on public.supplier_baskets
  for each row execute function public.audit_row();
drop trigger if exists trg_supplier_basket_lines_audit on public.supplier_basket_lines;
create trigger trg_supplier_basket_lines_audit after insert or update or delete on public.supplier_basket_lines
  for each row execute function public.audit_row();

-- ------------------------------------------------ 4. RLS : lecture et écriture par les membres de la société
alter table public.supplier_baskets enable row level security;
alter table public.supplier_basket_lines enable row level security;
revoke all on public.supplier_baskets, public.supplier_basket_lines from anon;
grant select, insert, update, delete on public.supplier_baskets, public.supplier_basket_lines to authenticated;

drop policy if exists supplier_baskets_select on public.supplier_baskets;
create policy supplier_baskets_select on public.supplier_baskets for select to authenticated
  using (public.is_member(company_id));
drop policy if exists supplier_baskets_insert on public.supplier_baskets;
create policy supplier_baskets_insert on public.supplier_baskets for insert to authenticated
  with check (public.is_member(company_id));
drop policy if exists supplier_baskets_update on public.supplier_baskets;
create policy supplier_baskets_update on public.supplier_baskets for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists supplier_baskets_delete on public.supplier_baskets;
create policy supplier_baskets_delete on public.supplier_baskets for delete to authenticated
  using (public.is_member(company_id));

drop policy if exists supplier_basket_lines_select on public.supplier_basket_lines;
create policy supplier_basket_lines_select on public.supplier_basket_lines for select to authenticated
  using (public.is_member(company_id));
drop policy if exists supplier_basket_lines_insert on public.supplier_basket_lines;
create policy supplier_basket_lines_insert on public.supplier_basket_lines for insert to authenticated
  with check (public.is_member(company_id));
drop policy if exists supplier_basket_lines_update on public.supplier_basket_lines;
create policy supplier_basket_lines_update on public.supplier_basket_lines for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists supplier_basket_lines_delete on public.supplier_basket_lines;
create policy supplier_basket_lines_delete on public.supplier_basket_lines for delete to authenticated
  using (public.is_member(company_id));

-- ------------------------------------------------ 5. Garde : ce qui ne se change que par les fonctions
-- Le statut, la date et l'opérateur de validation, le total, le supplément, le fichier ne
-- changent que par basket_order / basket_set_file / basket_cancel / basket_receive.
-- Un panier qui n'est plus ouvert ne reçoit ni ne perd de ligne, sauf par ces fonctions.
create or replace function public.supplier_baskets_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.basket_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'ouvert' or new.ordered_at is not null or new.ordered_by is not null
       or new.file_path is not null or new.file_attachment_id is not null
       or new.dcs_order_number is not null then
      raise exception 'Un panier se crée ouvert ; la validation passe par « Commander ».' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.ordered_at is distinct from old.ordered_at
     or new.ordered_by is distinct from old.ordered_by
     or new.received_at is distinct from old.received_at
     or new.cancelled_at is distinct from old.cancelled_at
     or new.file_path is distinct from old.file_path
     or new.file_attachment_id is distinct from old.file_attachment_id
     or new.dcs_order_number is distinct from old.dcs_order_number
     or new.total_ht is distinct from old.total_ht
     or new.surcharge_pct is distinct from old.surcharge_pct
     or new.kind is distinct from old.kind
     or new.company_id is distinct from old.company_id then
    raise exception 'Le statut, le fichier, le numéro DCS et les totaux d''un panier se changent par les boutons de l''écran (fonctions basket_*).'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.supplier_baskets_guard() from public, anon, authenticated;
drop trigger if exists trg_supplier_baskets_guard on public.supplier_baskets;
create trigger trg_supplier_baskets_guard before insert or update on public.supplier_baskets
  for each row execute function public.supplier_baskets_guard();

create or replace function public.supplier_basket_lines_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare b public.supplier_baskets%rowtype;
begin
  if coalesce(current_setting('app.basket_rpc', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  select * into b from public.supplier_baskets where id = coalesce(new.basket_id, old.basket_id);
  if not found then
    raise exception 'Panier introuvable.' using errcode = 'P0002';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Ce panier est déjà commandé : ses lignes ne se modifient plus.' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.company_id <> b.company_id then
      raise exception 'Société de la ligne différente de celle du panier.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.articles a where a.id = new.article_id and a.company_id = b.company_id) then
      raise exception 'Article introuvable dans cette société.' using errcode = 'P0002';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.supplier_basket_lines_guard() from public, anon, authenticated;
drop trigger if exists trg_supplier_basket_lines_guard on public.supplier_basket_lines;
create trigger trg_supplier_basket_lines_guard before insert or update or delete on public.supplier_basket_lines
  for each row execute function public.supplier_basket_lines_guard();

-- ------------------------------------------------ 6. Helpers internes (non appelables depuis le navigateur)

-- Stock réel d'un article (somme des mouvements hors réservation, B4).
create or replace function public._basket_real_qty(_article uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.real_qty from public.article_stock(_article) s), 0);
$$;
revoke all on function public._basket_real_qty(uuid) from public, anon, authenticated;

-- Déjà en commande pour un article : commandes fournisseur / commandes de pièces (calcul
-- existant _article_on_order_qty) + lignes des autres paniers en cours (ouverts ou commandés,
-- pas encore reçus). Le panier _exclude (celui qu'on remplit) n'est pas compté, ni ses lignes
-- minimax quand _origin_excluded les désigne.
create or replace function public._basket_on_order_qty(_company uuid, _article uuid, _exclude uuid default null)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public._article_on_order_qty(_article), 0)
       + coalesce((select sum(l.qty)
                     from public.supplier_basket_lines l
                     join public.supplier_baskets b on b.id = l.basket_id
                    where l.article_id = _article and b.company_id = _company
                      and b.status in ('ouvert', 'commande')
                      and (_exclude is null or b.id <> _exclude)), 0);
$$;
revoke all on function public._basket_on_order_qty(uuid, uuid, uuid) from public, anon, authenticated;

-- Quantité minimax : greatest(stock_max, stock_min) − stock réel − déjà en commande (jamais négatif).
create or replace function public._basket_minimax_qty(_stock_min numeric, _stock_max numeric, _real numeric, _on_order numeric)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select greatest(greatest(coalesce(_stock_max, 0), coalesce(_stock_min, 0)) - coalesce(_real, 0) - coalesce(_on_order, 0), 0);
$$;
revoke all on function public._basket_minimax_qty(numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- Nom du client pour la colonne G du fichier : NOM PRENOM en majuscules (société si personne morale).
create or replace function public._basket_contact_label(_contact uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select upper(coalesce(nullif(btrim(concat_ws(' ', c.last_name, c.first_name)), ''), nullif(btrim(c.company_name), '')))
    from public.contacts c where c.id = _contact;
$$;
revoke all on function public._basket_contact_label(uuid) from public, anon, authenticated;

-- Recalcule le total HTVA du panier : Σ qté × prix d'achat (PA, sinon PAMP, sinon PV HTVA).
create or replace function public._basket_refresh_total(_basket uuid)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare tot numeric;
begin
  select coalesce(sum(round(l.qty * coalesce(nullif(l.purchase_price, 0), nullif(l.sale_price_ht, 0), 0), 2)), 0)
    into tot from public.supplier_basket_lines l where l.basket_id = _basket;
  perform set_config('app.basket_rpc', 'on', true);
  update public.supplier_baskets set total_ht = tot where id = _basket;
  perform set_config('app.basket_rpc', 'off', true);
  return tot;
end $$;
revoke all on function public._basket_refresh_total(uuid) from public, anon, authenticated;

-- Panier ouvert le plus récent d'un type ; créé s'il n'existe pas. Pas de contrôle de
-- membre : réservé aux fonctions (basket_current le fait pour le navigateur, le cron s'en passe).
create or replace function public._basket_current(_company uuid, _kind text, _create boolean default true)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; lbl text;
begin
  if _kind not in ('standard', 'urgente', 'demo') then
    raise exception 'Type de panier inconnu : %', _kind using errcode = 'P0001';
  end if;
  select b.id into bid from public.supplier_baskets b
   where b.company_id = _company and b.kind = _kind and b.status = 'ouvert'
   order by b.created_at desc limit 1;
  if bid is not null or not _create then
    return bid;
  end if;
  lbl := case _kind when 'urgente' then 'Urgente du ' when 'demo' then 'Démo du ' else 'Standard du ' end
         || to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY');
  perform set_config('app.basket_rpc', 'on', true);
  insert into public.supplier_baskets (company_id, kind, label, created_by)
  values (_company, _kind, lbl, auth.uid()) returning id into bid;
  perform set_config('app.basket_rpc', 'off', true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'basket_open', 'supplier_baskets', bid::text,
          case when auth.uid() is null then 'system' else 'screen' end, null,
          jsonb_build_object('kind', _kind, 'label', lbl));
  return bid;
end $$;
revoke all on function public._basket_current(uuid, text, boolean) from public, anon, authenticated;

-- Ajoute des lignes à un panier OUVERT (interne, pas de contrôle de membre).
-- _lines = [{article_id, qty, origin, origin_ref, origin_line_id, contact_id}]
-- Une ligne de même article / origine / référence d'origine / client est CUMULÉE (qty += ),
-- sauf _replace = true (minimax : la quantité est recalculée, pas additionnée).
create or replace function public._basket_add_lines(_basket uuid, _lines jsonb, _replace boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b        public.supplier_baskets%rowtype;
  j        jsonb;
  aid      uuid;
  q        numeric;
  org      text;
  oref     text;
  olid     uuid;
  cid      uuid;
  a        public.articles%rowtype;
  existing uuid;
  n_add    int := 0;
  n_merge  int := 0;
  n_skip   int := 0;
  next_so  int;
  added    jsonb := '[]'::jsonb;
begin
  select * into b from public.supplier_baskets where id = _basket for update;
  if not found then
    raise exception 'Panier introuvable.' using errcode = 'P0002';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Ce panier est déjà commandé (%).', b.label using errcode = 'P0001';
  end if;
  if _lines is null or jsonb_typeof(_lines) <> 'array' then
    raise exception 'Lignes attendues sous forme de liste.' using errcode = 'P0001';
  end if;
  select coalesce(max(sort_order), -1) + 1 into next_so from public.supplier_basket_lines where basket_id = _basket;
  perform set_config('app.basket_rpc', 'on', true);
  for j in select * from jsonb_array_elements(_lines) loop
    aid  := nullif(j ->> 'article_id', '')::uuid;
    q    := coalesce(public._jnum(j, 'qty'), 0);
    -- Popup entretien (carte 3) : passe repair_order_id sans origine → origine « atelier », réf. = n° d'OR.
    org  := coalesce(nullif(btrim(j ->> 'origin'), ''),
                     case when nullif(j ->> 'repair_order_id', '') is not null then 'atelier' else 'manuel' end);
    oref := coalesce(nullif(btrim(j ->> 'origin_ref'), ''),
                     (select ro.number from public.repair_orders ro where ro.id = nullif(j ->> 'repair_order_id', '')::uuid));
    olid := nullif(j ->> 'origin_line_id', '')::uuid;
    cid  := nullif(j ->> 'contact_id', '')::uuid;
    if aid is null or q <= 0 then
      n_skip := n_skip + 1; continue;
    end if;
    if org not in ('minimax', 'atelier', 'comptoir', 'site', 'manuel') then
      raise exception 'Origine inconnue : %', org using errcode = 'P0001';
    end if;
    select * into a from public.articles where id = aid and company_id = b.company_id;
    if not found then
      raise exception 'Article introuvable dans cette société (%).', aid using errcode = 'P0002';
    end if;
    if cid is not null and not exists (select 1 from public.contacts c where c.id = cid and c.company_id = b.company_id) then
      cid := null;
    end if;
    select l.id into existing from public.supplier_basket_lines l
     where l.basket_id = _basket and l.article_id = aid and l.origin = org
       and l.origin_ref is not distinct from oref and l.contact_id is not distinct from cid
       and l.origin_line_id is not distinct from olid
     limit 1;
    if existing is not null then
      update public.supplier_basket_lines
         set qty = case when _replace then q else qty + q end
       where id = existing;
      n_merge := n_merge + 1;
    else
      insert into public.supplier_basket_lines (basket_id, company_id, article_id, reference, designation, qty, origin,
                                                origin_ref, origin_line_id, contact_id, purchase_price, sale_price_ht,
                                                in_stock_qty, sort_order, created_by)
      values (_basket, b.company_id, aid, a.reference, coalesce(a.designation, ''), q, org, oref, olid, cid,
              case when coalesce(a.purchase_price, 0) > 0 then a.purchase_price
                   when coalesce(a.pamp, 0) > 0 then a.pamp else null end,
              a.sale_price_ht, public._basket_real_qty(aid), next_so, auth.uid())
      returning id into existing;
      next_so := next_so + 1;
      n_add := n_add + 1;
    end if;
    added := added || jsonb_build_object('line_id', existing, 'article_id', aid, 'reference', a.reference, 'qty', q, 'origin', org);
  end loop;
  perform set_config('app.basket_rpc', 'off', true);
  perform public._basket_refresh_total(_basket);
  if n_add + n_merge > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (b.company_id, auth.uid(), 'basket_lines_add', 'supplier_baskets', _basket::text,
            case when auth.uid() is null then 'system' else 'screen' end, null,
            jsonb_build_object('added', n_add, 'merged', n_merge, 'skipped', n_skip, 'lines', added));
  end if;
  return jsonb_build_object('basket_id', _basket, 'added', n_add, 'merged', n_merge, 'skipped', n_skip);
end $$;
revoke all on function public._basket_add_lines(uuid, jsonb, boolean) from public, anon, authenticated;

-- Minimax (interne) : pièces stockées (type A) sous leur minimum (> 0).
create or replace function public._basket_fill_minimax(_basket uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b       public.supplier_baskets%rowtype;
  r       record;
  need    numeric;
  lines   jsonb := '[]'::jsonb;
  n_rm    int := 0;
  res     jsonb;
begin
  select * into b from public.supplier_baskets where id = _basket;
  if not found then
    raise exception 'Panier introuvable.' using errcode = 'P0002';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Ce panier est déjà commandé (%).', b.label using errcode = 'P0001';
  end if;
  for r in
    select a.id, a.stock_min, a.stock_max, public._basket_real_qty(a.id) as real_qty
      from public.articles a
     where a.company_id = b.company_id and a.mgmt_type = 'A' and coalesce(a.is_active, true)
       and coalesce(a.stock_min, 0) > 0
  loop
    if r.real_qty >= r.stock_min then
      continue;
    end if;
    -- déjà en commande : CMD / commandes de pièces / autres paniers + lignes NON minimax de ce panier
    need := public._basket_minimax_qty(r.stock_min, r.stock_max, r.real_qty,
              public._basket_on_order_qty(b.company_id, r.id, _basket)
              + coalesce((select sum(l.qty) from public.supplier_basket_lines l
                           where l.basket_id = _basket and l.article_id = r.id and l.origin <> 'minimax'), 0));
    if need > 0 then
      lines := lines || jsonb_build_object('article_id', r.id, 'qty', need, 'origin', 'minimax');
    end if;
  end loop;
  -- lignes minimax de ce panier dont le besoin a disparu
  perform set_config('app.basket_rpc', 'on', true);
  with keep as (select (x ->> 'article_id')::uuid as aid from jsonb_array_elements(lines) x)
  delete from public.supplier_basket_lines l
   where l.basket_id = _basket and l.origin = 'minimax'
     and l.article_id not in (select aid from keep);
  get diagnostics n_rm = row_count;
  perform set_config('app.basket_rpc', 'off', true);
  res := public._basket_add_lines(_basket, lines, true);
  return res || jsonb_build_object('removed', n_rm);
end $$;
revoke all on function public._basket_fill_minimax(uuid) from public, anon, authenticated;

-- ------------------------------------------------ 7. Fonctions appelables depuis l'écran

-- Panier ouvert le plus récent d'un type (créé si absent).
create or replace function public.basket_current(_company uuid, _kind text default 'standard')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return public._basket_current(_company, _kind, true);
end $$;
revoke all on function public.basket_current(uuid, text) from public, anon;
grant execute on function public.basket_current(uuid, text) to authenticated;

-- Nouveau panier (plusieurs paniers ouverts possibles).
create or replace function public.basket_open(_company uuid, _kind text default 'standard', _label text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; lbl text;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if _kind not in ('standard', 'urgente', 'demo') then
    raise exception 'Type de panier inconnu : %', _kind using errcode = 'P0001';
  end if;
  lbl := coalesce(nullif(btrim(coalesce(_label, '')), ''),
                  (case _kind when 'urgente' then 'Urgente du ' when 'demo' then 'Démo du ' else 'Standard du ' end)
                  || to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY'));
  perform set_config('app.basket_rpc', 'on', true);
  insert into public.supplier_baskets (company_id, kind, label, created_by)
  values (_company, _kind, lbl, auth.uid()) returning id into bid;
  perform set_config('app.basket_rpc', 'off', true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'basket_open', 'supplier_baskets', bid::text, 'screen', null,
          jsonb_build_object('kind', _kind, 'label', lbl));
  return bid;
end $$;
revoke all on function public.basket_open(uuid, text, text) from public, anon;
grant execute on function public.basket_open(uuid, text, text) to authenticated;

-- Ajoute des lignes au panier ouvert le plus récent du type (créé si absent). RÉUTILISABLE :
-- popup entretien (atelier), démo, écrans. _lines = [{article_id, qty, origin, origin_ref, contact_id}].
create or replace function public.basket_add_lines(_company uuid, _kind text, _lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  bid := public._basket_current(_company, coalesce(_kind, 'standard'), true);
  return public._basket_add_lines(bid, _lines, false);
end $$;
revoke all on function public.basket_add_lines(uuid, text, jsonb) from public, anon;
grant execute on function public.basket_add_lines(uuid, text, jsonb) to authenticated;

-- Même chose, mais dans UN panier précis (écran du panier : ligne manuelle).
create or replace function public.basket_add_lines_to(_basket uuid, _lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.supplier_baskets%rowtype;
begin
  select * into b from public.supplier_baskets where id = _basket;
  if not found or not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return public._basket_add_lines(_basket, _lines, false);
end $$;
revoke all on function public.basket_add_lines_to(uuid, jsonb) from public, anon;
grant execute on function public.basket_add_lines_to(uuid, jsonb) to authenticated;

-- Quantité d'une ligne (panier ouvert) ; 0 = suppression.
create or replace function public.basket_line_set_qty(_line uuid, _qty numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.supplier_basket_lines%rowtype; b public.supplier_baskets%rowtype;
begin
  select * into l from public.supplier_basket_lines where id = _line for update;
  if not found then
    raise exception 'Ligne introuvable.' using errcode = 'P0002';
  end if;
  select * into b from public.supplier_baskets where id = l.basket_id;
  if not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Ce panier est déjà commandé : ses lignes ne se modifient plus.' using errcode = 'P0001';
  end if;
  perform set_config('app.basket_rpc', 'on', true);
  if coalesce(_qty, 0) <= 0 then
    delete from public.supplier_basket_lines where id = _line;
  else
    update public.supplier_basket_lines set qty = _qty where id = _line;
  end if;
  perform set_config('app.basket_rpc', 'off', true);
  perform public._basket_refresh_total(l.basket_id);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (b.company_id, auth.uid(), case when coalesce(_qty, 0) <= 0 then 'basket_line_delete' else 'basket_line_qty' end,
          'supplier_baskets', b.id::text, 'screen',
          jsonb_build_object('line_id', l.id, 'reference', l.reference, 'qty', l.qty),
          jsonb_build_object('line_id', l.id, 'reference', l.reference, 'qty', coalesce(_qty, 0)));
end $$;
revoke all on function public.basket_line_set_qty(uuid, numeric) from public, anon;
grant execute on function public.basket_line_set_qty(uuid, numeric) to authenticated;

-- « Remplir depuis les minimums » (bouton).
create or replace function public.basket_fill_minimax(_company uuid, _basket uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; res jsonb;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  bid := coalesce(_basket, public._basket_current(_company, 'standard', true));
  if not exists (select 1 from public.supplier_baskets b where b.id = bid and b.company_id = _company) then
    raise exception 'Panier introuvable dans cette société.' using errcode = 'P0002';
  end if;
  res := public._basket_fill_minimax(bid);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'basket_fill_minimax', 'supplier_baskets', bid::text, 'screen', null, res);
  return res;
end $$;
revoke all on function public.basket_fill_minimax(uuid, uuid) from public, anon;
grant execute on function public.basket_fill_minimax(uuid, uuid) to authenticated;

-- « Enlever ce qui est déjà en stock » : retire les lignes dont le stock réel couvre la quantité.
create or replace function public.basket_remove_in_stock(_basket uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.supplier_baskets%rowtype; removed jsonb; n int;
begin
  select * into b from public.supplier_baskets where id = _basket for update;
  if not found or not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Ce panier est déjà commandé (%).', b.label using errcode = 'P0001';
  end if;
  perform set_config('app.basket_rpc', 'on', true);
  with gone as (
    delete from public.supplier_basket_lines l
     where l.basket_id = _basket and public._basket_real_qty(l.article_id) >= l.qty
    returning l.id, l.reference, l.qty
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object('line_id', id, 'reference', reference, 'qty', qty)), '[]'::jsonb)
    into n, removed from gone;
  perform set_config('app.basket_rpc', 'off', true);
  perform public._basket_refresh_total(_basket);
  if n > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (b.company_id, auth.uid(), 'basket_remove_in_stock', 'supplier_baskets', _basket::text, 'screen', null,
            jsonb_build_object('removed', n, 'lines', removed));
  end if;
  return jsonb_build_object('removed', n);
end $$;
revoke all on function public.basket_remove_in_stock(uuid) from public, anon;
grant execute on function public.basket_remove_in_stock(uuid) to authenticated;

-- Comptoir : pièces des commandes de pièces validées (en attente de paiement, payées, à envoyer)
-- pas encore commandées chez un fournisseur (pas de ligne de CMD) ni déjà dans un panier en cours.
-- Quantité client → ligne avec le client (colonne G) ; quantité magasin → ligne sans client.
-- Une pièce d'une commande URGENTE va dans le panier urgente, les autres dans le standard.
create or replace function public.basket_fill_from_part_orders(_company uuid, _line_ids uuid[], _basket uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r        record;
  std      jsonb := '[]'::jsonb;
  urg      jsonb := '[]'::jsonb;
  skipped  jsonb := '[]'::jsonb;
  out_std  jsonb := null;
  out_urg  jsonb := null;
  bid      uuid;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  for r in
    select l.id, l.reference, l.qty_client, l.qty_shop, l.article_id, l.purchase_line_id,
           o.number, o.contact_id, o.order_kind::text as kind, o.dispatch_status::text as st, o.company_id
      from public.part_order_lines l
      join public.part_orders o on o.id = l.order_id
     where l.id = any(coalesce(_line_ids, '{}'::uuid[]))
  loop
    if r.company_id <> _company then
      skipped := skipped || jsonb_build_object('line_id', r.id, 'reason', 'autre société'); continue;
    end if;
    if r.article_id is null then
      skipped := skipped || jsonb_build_object('line_id', r.id, 'reference', r.reference, 'reason', 'sans article'); continue;
    end if;
    if r.st not in ('en_attente_paiement', 'payee', 'a_envoyer') then
      skipped := skipped || jsonb_build_object('line_id', r.id, 'reference', r.reference, 'reason', 'commande non validée'); continue;
    end if;
    if r.purchase_line_id is not null then
      skipped := skipped || jsonb_build_object('line_id', r.id, 'reference', r.reference, 'reason', 'déjà dans une CMD'); continue;
    end if;
    if exists (select 1 from public.supplier_basket_lines x join public.supplier_baskets b on b.id = x.basket_id
                where x.origin_line_id = r.id and b.status in ('ouvert', 'commande')) then
      skipped := skipped || jsonb_build_object('line_id', r.id, 'reference', r.reference, 'reason', 'déjà dans un panier'); continue;
    end if;
    if coalesce(r.qty_client, 0) > 0 then
      if r.kind = 'urgente' then
        urg := urg || jsonb_build_object('article_id', r.article_id, 'qty', r.qty_client, 'origin', 'comptoir',
                                         'origin_ref', r.number, 'origin_line_id', r.id, 'contact_id', r.contact_id);
      else
        std := std || jsonb_build_object('article_id', r.article_id, 'qty', r.qty_client, 'origin', 'comptoir',
                                         'origin_ref', r.number, 'origin_line_id', r.id, 'contact_id', r.contact_id);
      end if;
    end if;
    if coalesce(r.qty_shop, 0) > 0 then
      if r.kind = 'urgente' then
        urg := urg || jsonb_build_object('article_id', r.article_id, 'qty', r.qty_shop, 'origin', 'comptoir',
                                         'origin_ref', r.number, 'origin_line_id', r.id);
      else
        std := std || jsonb_build_object('article_id', r.article_id, 'qty', r.qty_shop, 'origin', 'comptoir',
                                         'origin_ref', r.number, 'origin_line_id', r.id);
      end if;
    end if;
  end loop;
  if jsonb_array_length(std) > 0 then
    bid := coalesce(_basket, public._basket_current(_company, 'standard', true));
    out_std := public._basket_add_lines(bid, std, false);
  end if;
  if jsonb_array_length(urg) > 0 then
    bid := public._basket_current(_company, 'urgente', true);
    out_urg := public._basket_add_lines(bid, urg, false);
  end if;
  return jsonb_build_object('standard', out_std, 'urgente', out_urg, 'skipped', skipped);
end $$;
revoke all on function public.basket_fill_from_part_orders(uuid, uuid[], uuid) from public, anon;
grant execute on function public.basket_fill_from_part_orders(uuid, uuid[], uuid) to authenticated;

-- Site : lignes d'une commande Shopify importée dont le stock réel ne couvre pas la quantité.
-- Quantité mise au panier = quantité − stock réel (si positif) ; client = client de la commande.
create or replace function public.basket_fill_from_shopify(_company uuid, _shopify_order_id text, _basket uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o        public.shopify_orders%rowtype;
  r        record;
  lines    jsonb := '[]'::jsonb;
  skipped  jsonb := '[]'::jsonb;
  need     numeric;
  bid      uuid;
  res      jsonb;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select * into o from public.shopify_orders where company_id = _company and shopify_order_id = _shopify_order_id;
  if not found then
    raise exception 'Commande du site introuvable.' using errcode = 'P0002';
  end if;
  for r in
    select l.id, l.sku, l.title, l.quantity, l.article_id
      from public.shopify_order_lines l
     where l.company_id = _company and l.shopify_order_id = _shopify_order_id
  loop
    if r.article_id is null then
      skipped := skipped || jsonb_build_object('line_id', r.id, 'sku', r.sku, 'reason', 'sans article'); continue;
    end if;
    if exists (select 1 from public.supplier_basket_lines x join public.supplier_baskets b on b.id = x.basket_id
                where x.origin_line_id = r.id and b.status in ('ouvert', 'commande')) then
      skipped := skipped || jsonb_build_object('line_id', r.id, 'sku', r.sku, 'reason', 'déjà dans un panier'); continue;
    end if;
    need := r.quantity - greatest(public._basket_real_qty(r.article_id), 0);
    if need <= 0 then
      skipped := skipped || jsonb_build_object('line_id', r.id, 'sku', r.sku, 'reason', 'en stock'); continue;
    end if;
    lines := lines || jsonb_build_object('article_id', r.article_id, 'qty', need, 'origin', 'site',
                                         'origin_ref', o.order_name, 'origin_line_id', r.id, 'contact_id', o.contact_id);
  end loop;
  if jsonb_array_length(lines) = 0 then
    return jsonb_build_object('basket_id', null, 'added', 0, 'merged', 0, 'skipped', skipped);
  end if;
  bid := coalesce(_basket, public._basket_current(_company, 'standard', true));
  res := public._basket_add_lines(bid, lines, false);
  return res || jsonb_build_object('skipped', skipped);
end $$;
revoke all on function public.basket_fill_from_shopify(uuid, text, uuid) from public, anon;
grant execute on function public.basket_fill_from_shopify(uuid, text, uuid) to authenticated;

-- Lignes d'un panier avec l'article, le client (colonne G) et le stock réel d'aujourd'hui.
create or replace function public.basket_lines_detail(_basket uuid)
returns table (
  id uuid, article_id uuid, reference text, designation text, qty numeric, origin text, origin_ref text,
  origin_line_id uuid, contact_id uuid, contact_label text, purchase_price numeric, sale_price_ht numeric,
  in_stock_qty numeric, real_qty_now numeric, sort_order int, created_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b public.supplier_baskets%rowtype;
begin
  select sb.* into b from public.supplier_baskets sb where sb.id = _basket;
  if not found or not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select l.id, l.article_id, l.reference, l.designation, l.qty, l.origin, l.origin_ref, l.origin_line_id,
         l.contact_id, public._basket_contact_label(l.contact_id), l.purchase_price, l.sale_price_ht,
         l.in_stock_qty, public._basket_real_qty(l.article_id), l.sort_order, l.created_at
    from public.supplier_basket_lines l
   where l.basket_id = _basket
   order by l.sort_order, l.created_at;
end $$;
revoke all on function public.basket_lines_detail(uuid) from public, anon;
grant execute on function public.basket_lines_detail(uuid) to authenticated;

-- Diagnostic des règles d'un panier (n'écrit rien) :
-- { ok, kind, total_ht, line_count, min_ht, surcharge_pct, urgente_today, errors:[{code,message}], notices:[…] }
-- Règles lues dans Paramètres (part_order_rules) : standard → minimum ; urgente → une par jour, pas
-- de minimum, supplément ; demo → règle « excel » (pas de minimum par panier, le classeur a le sien).
create or replace function public.basket_check(_basket uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  b        public.supplier_baskets%rowtype;
  r        record;
  rule_code text;
  n_lines  int;
  n_nopa   int;
  total    numeric;
  n_today  int := 0;
  errs     jsonb := '[]'::jsonb;
  notes    jsonb := '[]'::jsonb;
  surch    numeric := 0;
  min_ht   numeric := null;
begin
  select * into b from public.supplier_baskets where id = _basket;
  if not found or not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select count(*),
         count(*) filter (where coalesce(l.purchase_price, 0) <= 0),
         coalesce(sum(round(l.qty * coalesce(nullif(l.purchase_price, 0), nullif(l.sale_price_ht, 0), 0), 2)), 0)
    into n_lines, n_nopa, total
    from public.supplier_basket_lines l where l.basket_id = _basket;
  if n_lines = 0 then
    errs := errs || jsonb_build_object('code', 'no_lines', 'message', 'Le panier ne contient aucune pièce.');
  end if;
  if n_nopa > 0 then
    notes := notes || jsonb_build_object('code', 'no_pa', 'count', n_nopa,
      'message', format('%s pièce(s) sans prix d''achat connu : comptées au prix de vente HTVA.', n_nopa));
  end if;
  rule_code := case b.kind when 'demo' then 'excel' else b.kind end;
  select * into r from public.part_order_rules(b.company_id) x where x.code = rule_code;
  if found and r.configured and r.is_active then
    surch := coalesce(r.surcharge_pct, 0);
    if b.kind <> 'demo' then
      min_ht := r.min_ht;
    end if;
    if min_ht is not null and min_ht > 0 and total < min_ht then
      errs := errs || jsonb_build_object('code', 'below_min', 'kind', b.kind, 'min', min_ht, 'total', total,
        'message', format('%s : minimum %s HTVA non atteint (total %s, il manque %s).',
                          r.label, public._eur_fr(min_ht), public._eur_fr(total), public._eur_fr(min_ht - total)));
    end if;
    if r.max_per_day is not null and r.max_per_day > 0 and b.status = 'ouvert' then
      select count(*) into n_today from public.supplier_baskets p
       where p.company_id = b.company_id and p.id <> b.id and p.kind = b.kind
         and p.status in ('commande', 'recu')
         and (p.ordered_at at time zone 'Europe/Brussels')::date = (now() at time zone 'Europe/Brussels')::date;
      if n_today >= r.max_per_day then
        errs := errs || jsonb_build_object('code', 'daily_limit', 'kind', b.kind, 'max', r.max_per_day,
          'message', format('%s : %s par jour au maximum, déjà commandée aujourd''hui.', r.label, r.max_per_day));
      end if;
    end if;
  elsif found and r.configured and not r.is_active then
    errs := errs || jsonb_build_object('code', 'kind_disabled', 'kind', b.kind,
      'message', format('Le type « %s » est désactivé dans Paramètres → Tables → Règles des types de commande.', r.label));
  else
    notes := notes || jsonb_build_object('code', 'no_rule', 'kind', b.kind,
      'message', format('Aucune règle réglée pour le type « %s » dans Paramètres : pas de minimum.', b.kind));
  end if;
  return jsonb_build_object(
    'ok', jsonb_array_length(errs) = 0, 'kind', b.kind, 'status', b.status, 'total_ht', total,
    'line_count', n_lines, 'min_ht', min_ht, 'surcharge_pct', surch, 'urgente_today', n_today,
    'errors', errs, 'notices', notes);
end $$;
revoke all on function public.basket_check(uuid) from public, anon;
grant execute on function public.basket_check(uuid) to authenticated;

-- « Commander » : règles contrôlées, date + opérateur, total et supplément figés, statut « commandé ».
-- Le fichier ExportDucati est généré par le navigateur puis déposé en GED (basket_set_file).
-- Le numéro DCS reste VIDE : il se saisit à la main après (basket_set_dcs_number). Aucun mouvement de stock.
create or replace function public.basket_order(_basket uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.supplier_baskets%rowtype; chk jsonb; msg text;
begin
  select * into b from public.supplier_baskets where id = _basket for update;
  if not found or not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Ce panier est déjà commandé (%).', b.label using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'Opérateur inconnu : connectez-vous pour commander.' using errcode = '42501';
  end if;
  -- Sérialise les validations d'une même société (règle « une urgente par jour »)
  perform pg_advisory_xact_lock(hashtext('basket_order:' || b.company_id::text));
  perform public._basket_refresh_total(_basket);
  chk := public.basket_check(_basket);
  if not (chk ->> 'ok')::boolean then
    select string_agg(e ->> 'message', ' ') into msg from jsonb_array_elements(chk -> 'errors') e;
    raise exception '%', msg using errcode = 'P0001', hint = 'basket_rules';
  end if;
  perform set_config('app.basket_rpc', 'on', true);
  update public.supplier_baskets
     set status = 'commande', ordered_at = now(), ordered_by = auth.uid(),
         surcharge_pct = coalesce((chk ->> 'surcharge_pct')::numeric, 0),
         total_ht = (chk ->> 'total_ht')::numeric,
         dcs_order_number = null
   where id = _basket
   returning * into b;
  perform set_config('app.basket_rpc', 'off', true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (b.company_id, auth.uid(), 'basket_order', 'supplier_baskets', _basket::text, 'screen',
          jsonb_build_object('status', 'ouvert'),
          jsonb_build_object('status', 'commande', 'kind', b.kind, 'label', b.label, 'total_ht', b.total_ht,
                             'surcharge_pct', b.surcharge_pct, 'line_count', chk -> 'line_count'));
  return to_jsonb(b);
end $$;
revoke all on function public.basket_order(uuid) from public, anon;
grant execute on function public.basket_order(uuid) to authenticated;

-- Fichier généré et déposé en GED (à la validation, et à chaque régénération).
create or replace function public.basket_set_file(_basket uuid, _path text, _attachment uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.supplier_baskets%rowtype;
begin
  select * into b from public.supplier_baskets where id = _basket for update;
  if not found or not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if b.status not in ('commande', 'recu') then
    raise exception 'Le fichier se conserve sur un panier commandé.' using errcode = 'P0001';
  end if;
  perform set_config('app.basket_rpc', 'on', true);
  update public.supplier_baskets set file_path = _path, file_attachment_id = _attachment where id = _basket;
  perform set_config('app.basket_rpc', 'off', true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (b.company_id, auth.uid(), 'basket_file', 'supplier_baskets', _basket::text, 'screen',
          jsonb_build_object('file_path', b.file_path), jsonb_build_object('file_path', _path, 'attachment_id', _attachment));
end $$;
revoke all on function public.basket_set_file(uuid, text, uuid) from public, anon;
grant execute on function public.basket_set_file(uuid, text, uuid) to authenticated;

-- Numéro de commande donné par le DCS, saisi à la main après la validation (M-79).
create or replace function public.basket_set_dcs_number(_basket uuid, _number text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.supplier_baskets%rowtype; n text;
begin
  select * into b from public.supplier_baskets where id = _basket for update;
  if not found or not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if b.status not in ('commande', 'recu') then
    raise exception 'Le numéro DCS se saisit après la validation du panier.' using errcode = 'P0001';
  end if;
  n := nullif(btrim(coalesce(_number, '')), '');
  if n is not distinct from b.dcs_order_number then
    return;
  end if;
  perform set_config('app.basket_rpc', 'on', true);
  update public.supplier_baskets set dcs_order_number = n where id = _basket;
  perform set_config('app.basket_rpc', 'off', true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (b.company_id, auth.uid(), 'basket_dcs_number', 'supplier_baskets', _basket::text, 'screen',
          jsonb_build_object('dcs_order_number', b.dcs_order_number), jsonb_build_object('dcs_order_number', n));
end $$;
revoke all on function public.basket_set_dcs_number(uuid, text) from public, anon;
grant execute on function public.basket_set_dcs_number(uuid, text) to authenticated;

-- Statut « reçu » (saisi à la main quand la commande Ducati est arrivée ; la réception M04 fait entrer le stock).
create or replace function public.basket_receive(_basket uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.supplier_baskets%rowtype;
begin
  select * into b from public.supplier_baskets where id = _basket for update;
  if not found or not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if b.status <> 'commande' then
    raise exception 'Seul un panier commandé peut passer « reçu ».' using errcode = 'P0001';
  end if;
  perform set_config('app.basket_rpc', 'on', true);
  update public.supplier_baskets set status = 'recu', received_at = now() where id = _basket;
  perform set_config('app.basket_rpc', 'off', true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (b.company_id, auth.uid(), 'basket_receive', 'supplier_baskets', _basket::text, 'screen',
          jsonb_build_object('status', 'commande'), jsonb_build_object('status', 'recu'));
end $$;
revoke all on function public.basket_receive(uuid) from public, anon;
grant execute on function public.basket_receive(uuid) to authenticated;

-- Annulation d'un panier ouvert (jamais supprimé : trace conservée).
create or replace function public.basket_cancel(_basket uuid, _reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.supplier_baskets%rowtype;
begin
  select * into b from public.supplier_baskets where id = _basket for update;
  if not found or not public.is_member(b.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Seul un panier ouvert peut être annulé.' using errcode = 'P0001';
  end if;
  perform set_config('app.basket_rpc', 'on', true);
  update public.supplier_baskets set status = 'annule', cancelled_at = now() where id = _basket;
  perform set_config('app.basket_rpc', 'off', true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (b.company_id, auth.uid(), 'basket_cancel', 'supplier_baskets', _basket::text, 'screen',
          jsonb_build_object('status', 'ouvert'), jsonb_build_object('status', 'annule', 'reason', _reason));
end $$;
revoke all on function public.basket_cancel(uuid, text) from public, anon;
grant execute on function public.basket_cancel(uuid, text) to authenticated;

-- ------------------------------------------------ 8. Minimax automatique (pg_cron, toutes les sociétés)
create or replace function public._cron_basket_minimax()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare _co record; bid uuid; res jsonb; _n int := 0;
begin
  for _co in select id from public.companies loop
    begin
      bid := public._basket_current(_co.id, 'standard', true);
      res := public._basket_fill_minimax(bid);
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_co.id, null, 'basket_fill_minimax', 'supplier_baskets', bid::text, 'system', null, res || jsonb_build_object('at', now()));
      _n := _n + 1;
    exception when others then
      raise notice 'basket minimax skipped for company %: %', _co.id, sqlerrm;
    end;
  end loop;
  return _n;
end $$;
revoke all on function public._cron_basket_minimax() from public, anon, authenticated;

do $$
begin
  perform cron.schedule('basket-minimax-daily', '0 4 * * *', $cron$ select public._cron_basket_minimax(); $cron$);
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
