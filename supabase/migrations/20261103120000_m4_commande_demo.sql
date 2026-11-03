-- =====================================================================
-- M4 / M8 — Commande DEMO / COURTOISIE / SHOWROOM envoyee a Ducati avec le classeur rempli,
-- et popup « pieces d'entretien manquantes » a la prise d'un RDV ou a l'ouverture d'un OR
-- (mission 09, cartes 3 et 6 ; decision de Simon du 30/10/2026 ; ACH003, ATE013).
--
-- Ne depend QUE des tables deja en production : excel_orders / excel_order_lines /
-- excel_catalog (migration 20260730160000 + 20260919220000), reference_values,
-- workshop_appointments, repair_orders, attachments, events. La table `supplier_baskets`
-- de l'agent « panier standard » (20261103100000) n'est pas requise : le panier demo EST le
-- classeur ouvert (`excel_orders`, kind = 'demo').
--
-- STRICTEMENT ADDITIVE : colonnes nullables ou avec defaut, une table, des fonctions.
--   1. excel_orders : type de panier, onglet choisi, motos de demo, commande passee
--      (date, operateur, mail conserve, classeur conserve), numero DCS saisi a la main.
--   2. Accessoires uniquement : une ligne dont la reference n'est pas dans le classeur
--      accessoires Ducati (excel_catalog) est refusee (trigger).
--   3. Lignes figees aussi quand la commande est « commandee ».
--   4. Reglages : adresse Ducati (cas.dwe@ducati.com), « urgente si RDV a moins de N jours ».
--   5. excel_order_mark_ordered : controles (minimum par onglet, accessoires, numero) → statut
--      « commandee », trace events ; excel_order_set_dcs_number.
--   6. workshop_appointments.reason_code : motif d'entretien du RDV.
--   7. workshop_parts_prompts : memoire des pieces deja proposees pour un OR / un RDV
--      (on ne redemande jamais les memes pieces) + workshop_parts_prompt_log.
--
-- NE PAS APPLIQUER depuis un agent. Essai a blanc :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f <ce fichier>
--   (entre begin; et rollback;). Application par le client :
--   npx supabase@2.117.0 db push --linked --project-ref ujmrosbgkvgvwfnuryna
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. En-tete : panier demo, onglet, motos, commande passee, mail, numero DCS
-- ---------------------------------------------------------------------
alter table public.excel_orders
  add column if not exists kind                   text not null default 'demo',
  add column if not exists tab                    text not null default 'demo',
  add column if not exists demo_motos             jsonb not null default '{}'::jsonb,
  add column if not exists ordered_at             timestamptz,
  add column if not exists ordered_by             uuid references auth.users(id) on delete set null,
  add column if not exists dcs_number             text,
  add column if not exists mail_to                text,
  add column if not exists mail_from              text,
  add column if not exists mail_subject           text,
  add column if not exists mail_sent_at           timestamptz,
  add column if not exists workbook_attachment_id uuid references public.attachments(id) on delete set null,
  add column if not exists workbook_path          text;

comment on column public.excel_orders.kind is 'Type de panier : demo (classeur Ducati Demo / Courtoisie / Showroom, accessoires uniquement).';
comment on column public.excel_orders.tab is 'Onglet choisi pour les ajouts (demo | courtoisie | showroom) ; chaque ligne garde son onglet.';
comment on column public.excel_orders.demo_motos is 'Motos de demo par onglet : {"demo":[{"model","orderNo","serial"}, ...4 max], "courtoisie":[...], "showroom":[...]} → cellules I3..O5 du classeur.';
comment on column public.excel_orders.dcs_number is 'Numero donne par le DCS Ducati, saisi a la main apres l''envoi du classeur (M-79).';
comment on column public.excel_orders.workbook_path is 'Classeur Ducati rempli, tel qu''envoye, conserve en GED (bucket ged).';

alter table public.excel_orders drop constraint if exists excel_orders_status_chk;
alter table public.excel_orders add constraint excel_orders_status_chk
  check (status in ('en_cours', 'telecharge', 'commandee', 'cloture', 'archive'));

alter table public.excel_orders drop constraint if exists excel_orders_tab_chk;
alter table public.excel_orders add constraint excel_orders_tab_chk
  check (tab in ('demo', 'courtoisie', 'showroom'));

alter table public.excel_orders drop constraint if exists excel_orders_kind_chk;
alter table public.excel_orders add constraint excel_orders_kind_chk
  check (kind in ('demo'));

-- ---------------------------------------------------------------------
-- 2. Accessoires uniquement : la reference doit figurer dans le classeur accessoires Ducati
-- ---------------------------------------------------------------------
create or replace function public.excel_order_lines_accessory_guard()
returns trigger
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare co uuid; what text;
begin
  select company_id into co from public.excel_orders where id = new.excel_order_id;
  if co is null then
    raise exception 'Commande Excel introuvable' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.excel_catalog c
     where c.company_id = co
       and upper(regexp_replace(c.reference, '\s', '', 'g')) = upper(regexp_replace(coalesce(new.reference, ''), '\s', '', 'g'))
  ) then
    -- Dire clairement ce que c'est : un vetement (catalogue Ducati « apparel ») ou une piece (article du DMS).
    select case
             when exists (select 1 from public.ducati_catalog_product_variants v
                            join public.ducati_catalog_products p on p.code = v.product_code
                           where p.kind = 'apparel'
                             and v.sku_norm = public.ducati_catalog_norm_ref(new.reference))
               then 'un vetement'
             when exists (select 1 from public.articles a
                           where a.company_id = co and a.reference = new.reference and a.mgmt_type::text in ('A', 'N'))
               then 'une piece detachee'
             else 'ni un accessoire ni une reference connue'
           end
      into what;
    raise exception 'Reference % refusee : c''est %. Seuls les accessoires du classeur Ducati entrent dans une commande demo / courtoisie.',
      new.reference, what using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.excel_order_lines_accessory_guard() from public, anon;

drop trigger if exists trg_excel_order_lines_accessory on public.excel_order_lines;
create trigger trg_excel_order_lines_accessory
  before insert or update of reference on public.excel_order_lines
  for each row execute function public.excel_order_lines_accessory_guard();

-- ---------------------------------------------------------------------
-- 3. Lignes figees : aussi apres « commandee »
-- ---------------------------------------------------------------------
create or replace function public.excel_order_lines_frozen_guard()
returns trigger
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare st text;
begin
  select status into st from public.excel_orders
   where id = coalesce(new.excel_order_id, old.excel_order_id);
  if st in ('commandee', 'cloture', 'archive') then
    raise exception 'Commande deja passee : lignes non modifiables' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- 4. Reglages (Parametres → Tables → Regles des types de commande)
--    excel.mail_to : adresse Ducati du classeur demo ; urgente.urgent_within_days : popup entretien.
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'order_threshold', d.code, d.label, d.sort_order, d.extra::jsonb
  from public.companies c
 cross join (values
   ('urgente', 'Commande urgente', 2, '{"min_ht":0,"surcharge_pct":12,"max_per_day":1}'),
   ('excel',   'Commande Excel',   4, '{"min_ht_per_tab":2000,"tabs":["demo","courtoisie","showroom"]}')
 ) as d(code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;

update public.reference_values
   set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('mail_to', 'cas.dwe@ducati.com')
 where table_key = 'order_threshold' and code = 'excel'
   and not (coalesce(extra, '{}'::jsonb) ? 'mail_to');

update public.reference_values
   set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('urgent_within_days', 5)
 where table_key = 'order_threshold' and code = 'urgente'
   and not (coalesce(extra, '{}'::jsonb) ? 'urgent_within_days');

-- ---------------------------------------------------------------------
-- 5. Commander : classeur rempli depose en GED par l'ecran, mail parti, statut « commandee »
-- ---------------------------------------------------------------------
create or replace function public.excel_order_mark_ordered(
  _order uuid, _attachment uuid, _workbook_path text,
  _mail_to text, _mail_from text default null, _mail_subject text default null)
returns public.excel_orders
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare r public.excel_orders; totals jsonb; th numeric; bad record; old_status text;
begin
  select * into r from public.excel_orders where id = _order for update;
  if not found or not public.is_member(r.company_id) then
    raise exception 'Commande Excel introuvable' using errcode = 'P0002';
  end if;
  if r.status not in ('en_cours', 'telecharge') then
    raise exception 'Commande deja passee' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.excel_order_lines where excel_order_id = _order and qty > 0) then
    raise exception 'Commande vide : ajoutez des accessoires' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(_mail_to, '')), '') is null then
    raise exception 'Adresse Ducati manquante (Parametres → Tables → Regles des types de commande, ligne excel)' using errcode = 'P0001';
  end if;
  if _attachment is null or not exists (
    select 1 from public.attachments a where a.id = _attachment and a.company_id = r.company_id
      and a.entity_type = 'excel_order' and a.entity_id = _order) then
    raise exception 'Classeur rempli manquant : il doit etre conserve avec la commande' using errcode = 'P0001';
  end if;

  -- Accessoires uniquement (le trigger refuse deja a l'ajout ; on reverifie au moment de commander).
  select l.reference into bad from public.excel_order_lines l
   where l.excel_order_id = _order and l.qty > 0
     and not exists (select 1 from public.excel_catalog c where c.company_id = r.company_id
                        and upper(regexp_replace(c.reference, '\s', '', 'g')) = upper(regexp_replace(l.reference, '\s', '', 'g')))
   limit 1;
  if found then
    raise exception 'Reference % : pas un accessoire du classeur Ducati' , bad.reference using errcode = 'P0001';
  end if;

  -- Minimum par onglet : chaque onglet qui a des lignes doit l'atteindre.
  th := public.excel_order_threshold(r.company_id);
  select s.tab, s.v into bad
    from (select l.tab, round(sum(l.price_dealer * l.qty), 2) as v
            from public.excel_order_lines l where l.excel_order_id = _order and l.qty > 0 group by l.tab) s
   where th > 0 and s.v < th
   order by s.tab limit 1;
  if found then
    raise exception 'Onglet % : % EUR, minimum % EUR par onglet', bad.tab, bad.v, th using errcode = 'P0001';
  end if;

  if r.number is null then
    r.number := public.next_document_number(r.company_id, 'CEX');
  end if;

  select jsonb_object_agg(s.tab, jsonb_build_object('lines', s.n, 'value', s.v, 'final', s.f, 'reached', s.v >= th))
    into totals
    from (select t.tab, count(l.id) as n,
                 round(coalesce(sum(l.price_dealer * l.qty), 0), 2) as v,
                 round(coalesce(sum(l.price_dealer * l.qty * (1 - l.extra_discount)), 0), 2) as f
            from (values ('demo'), ('courtoisie'), ('showroom')) t(tab)
            left join public.excel_order_lines l on l.excel_order_id = _order and l.tab = t.tab and l.qty > 0
           group by t.tab) s;
  totals := totals || jsonb_build_object('threshold', th);

  old_status := r.status;
  update public.excel_orders
     set status = 'commandee', number = r.number, ordered_at = now(), ordered_by = auth.uid(),
         tab_totals = totals, mail_to = btrim(_mail_to), mail_from = nullif(btrim(coalesce(_mail_from, '')), ''),
         mail_subject = _mail_subject, mail_sent_at = now(),
         workbook_attachment_id = _attachment, workbook_path = _workbook_path,
         downloaded_at = coalesce(downloaded_at, now())
   where id = _order
  returning * into r;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'excel_order_ordered', 'excel_orders', r.id::text, 'screen',
          jsonb_build_object('status', old_status),
          jsonb_build_object('status', 'commandee', 'number', r.number, 'kind', r.kind, 'mail_to', r.mail_to,
                             'mail_from', r.mail_from, 'mail_subject', r.mail_subject, 'workbook_path', _workbook_path,
                             'tab_totals', totals, 'demo_motos', r.demo_motos));
  return r;
end $$;

create or replace function public.excel_order_set_dcs_number(_order uuid, _number text)
returns public.excel_orders
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare r public.excel_orders; prev text;
begin
  select * into r from public.excel_orders where id = _order for update;
  if not found or not public.is_member(r.company_id) then
    raise exception 'Commande Excel introuvable' using errcode = 'P0002';
  end if;
  if r.status not in ('commandee', 'cloture', 'archive') then
    raise exception 'Le numero DCS se saisit une fois la commande passee' using errcode = 'P0001';
  end if;
  prev := r.dcs_number;
  update public.excel_orders set dcs_number = nullif(left(btrim(coalesce(_number, '')), 40), '')
   where id = _order returning * into r;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'excel_order_dcs_number', 'excel_orders', r.id::text, 'screen',
          jsonb_build_object('dcs_number', prev), jsonb_build_object('dcs_number', r.dcs_number));
  return r;
end $$;

revoke all on function public.excel_order_mark_ordered(uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.excel_order_set_dcs_number(uuid, text) from public, anon;
grant execute on function public.excel_order_mark_ordered(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.excel_order_set_dcs_number(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. RDV : motif d'entretien (meme table de reference que l'OR : workshop_reason)
-- ---------------------------------------------------------------------
alter table public.workshop_appointments add column if not exists reason_code text;
comment on column public.workshop_appointments.reason_code is
  'Motif du rendez-vous (reference_values, table_key = workshop_reason). Un motif entretien_* / vidange declenche le controle des pieces du kit.';

-- ---------------------------------------------------------------------
-- 7. Memoire du popup : pieces deja proposees pour un OR ou un RDV (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.workshop_parts_prompts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  appointment_id  uuid references public.workshop_appointments(id) on delete cascade,
  article_id      uuid references public.articles(id) on delete set null,
  reference       text not null,
  designation     text,
  qty_missing     numeric(14,3) not null default 0,
  decision        text not null check (decision in ('commande', 'ignore')),
  order_kind      text,                                   -- standard | urgente (si commande)
  part_order_id   uuid references public.part_orders(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (repair_order_id is not null or appointment_id is not null)
);
create index if not exists idx_wpp_or   on public.workshop_parts_prompts(repair_order_id);
create index if not exists idx_wpp_rdv  on public.workshop_parts_prompts(appointment_id);
create index if not exists idx_wpp_comp on public.workshop_parts_prompts(company_id);

alter table public.workshop_parts_prompts enable row level security;
drop policy if exists wpp_select on public.workshop_parts_prompts;
create policy wpp_select on public.workshop_parts_prompts for select to authenticated
  using (public.is_member(company_id));
drop policy if exists wpp_insert on public.workshop_parts_prompts;
create policy wpp_insert on public.workshop_parts_prompts for insert to authenticated
  with check (public.is_member(company_id));
-- Append-only : ni update ni delete depuis l'application.

/** Enregistre la decision du popup (une ligne par piece) + trace events. Retourne le nombre de lignes. */
create or replace function public.workshop_parts_prompt_log(
  _company uuid, _or uuid, _appointment uuid, _lines jsonb, _decision text,
  _kind text default null, _part_order uuid default null)
returns int
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare item jsonb; n int := 0;
begin
  if not public.is_member(_company) then
    raise exception 'Acces refuse a la societe %', _company using errcode = '42501';
  end if;
  if _or is null and _appointment is null then
    raise exception 'Indiquez un ordre de reparation ou un rendez-vous' using errcode = 'P0001';
  end if;
  if _decision not in ('commande', 'ignore') then
    raise exception 'Decision inconnue : %', _decision using errcode = 'P0001';
  end if;
  for item in select * from jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) loop
    insert into public.workshop_parts_prompts
      (company_id, repair_order_id, appointment_id, article_id, reference, designation, qty_missing,
       decision, order_kind, part_order_id, created_by)
    values (_company, _or, _appointment, nullif(item ->> 'article_id', '')::uuid,
            coalesce(item ->> 'reference', ''), item ->> 'designation',
            coalesce((item ->> 'qty_missing')::numeric, 0), _decision, _kind, _part_order, auth.uid());
    n := n + 1;
  end loop;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'workshop_parts_prompt',
          case when _or is not null then 'repair_orders' else 'workshop_appointments' end,
          coalesce(_or, _appointment)::text, 'screen', null,
          jsonb_build_object('decision', _decision, 'kind', _kind, 'part_order_id', _part_order, 'lines', _lines));
  return n;
end $$;

revoke all on function public.workshop_parts_prompt_log(uuid, uuid, uuid, jsonb, text, text, uuid) from public, anon;
grant execute on function public.workshop_parts_prompt_log(uuid, uuid, uuid, jsonb, text, text, uuid) to authenticated;
