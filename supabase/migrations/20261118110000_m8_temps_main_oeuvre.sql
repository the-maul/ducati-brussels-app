-- =====================================================================
-- M8 — Temps de main-d'oeuvre atelier (rattrapage G8 du 18/11/2026, lot « temps MO », B11).
-- Sources : docs/g8-inventaire/07-atelier.md §3, §4, §7, §8, §9 ; comparaison-atelier-parc.md §2, §9,
-- bloquants #5 et #15.
--
--  1. « Gestion du temps atelier » par ligne de main-d'oeuvre (G8) : mecanicien (code + nom),
--     heures facturees, heures passees, heures internes, heures garanties, date des travaux.
--     Regle : sur une ligne MO, la quantite EST le nombre d'heures facturees ; `billed_hours` non
--     vide = temps saisi / controle (il suit la quantite). Ligne couverte par la garantie (prix 0
--     pour le client, lot garantie 20261118130000) : sa quantite = ses heures garanties (le cout de
--     garantie = heures x taux MO garantie).
--  2. Lignes reecrites en une transaction (`repair_order_write_lines`) : les nouvelles colonnes
--     sont reprises du message ; une ligne du check-up qui ne les envoie pas garde celles de
--     l'ancienne ligne de meme `checkup_key`.
--  3. « Controle du temps atelier » avant facture : `repair_order_time_control` enregistre le
--     recapitulatif (par ligne MO) et recalcule quantites, montants et totaux de l'OR ;
--     `repair_order_time_summary` donne le temps pointe sur l'OR par mecanicien.
--  4. Facture d'OR UNIQUE et atomique : `documents.repair_order_id` porte l'OR facture ;
--     index unique partiel (une seule facture non annulee par OR) + garde avec verrou de l'OR
--     (deux facturations simultanees : la seconde est refusee) ; la validation de la facture passe
--     l'OR « facture » DANS LA MEME TRANSACTION (fini l'OR facturable deux fois si le 2e appel echoue).
--  5. Pointeuse : code mecano (`workshop_time_entries.mechanic_code`), taches improductives
--     (`kind = 'improductif'`, `task_code`) ; codes mecano et taches dans Parametres → Tables
--     (`reference_values` : `workshop_mechanic`, `workshop_task` — taches G8 prechargees).
--  6. Productivite complete (B11, G8 « Productivite atelier ») : `workshop_productivity_detail`
--     par jour et par mecanicien (presence, pointe, improductif, facture, a facturer, internes,
--     garanties, heures passees saisies). Ratios et cumuls : `src/modules/workshop/labour-time/rules.ts`.
--
-- Idempotente. NON APPLIQUEE (Simon applique en bloc). Essai a blanc : supabase/tests/m8_temps_mo.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Lignes de l'OR : temps de main-d'oeuvre
-- ---------------------------------------------------------------------
alter table public.repair_order_lines
  add column if not exists mechanic_code  text,
  add column if not exists mechanic_name  text,
  add column if not exists work_date      date,
  add column if not exists billed_hours   numeric(10,2),
  add column if not exists worked_hours   numeric(10,2),
  add column if not exists internal_hours numeric(10,2),
  add column if not exists warranty_hours numeric(10,2);

comment on column public.repair_order_lines.mechanic_code  is 'Code mecano (Parametres → Tables → Codes mecano) de la ligne de main-d''oeuvre (G8 « Gestion du temps atelier »).';
comment on column public.repair_order_lines.billed_hours   is 'Heures facturees ; sur une ligne MO elles valent la quantite. Vide = temps jamais saisi / controle.';
comment on column public.repair_order_lines.worked_hours   is 'Heures passees (rapprochement temps passe / facture, B11).';
comment on column public.repair_order_lines.internal_hours is 'Heures internes (cession interne) : jamais facturees au client.';
comment on column public.repair_order_lines.warranty_hours is 'Heures garanties : jamais facturees au client.';
comment on column public.repair_order_lines.work_date      is 'Date des travaux de la ligne MO.';

-- 1 bis. Pointeuse : code mecano, tache improductive (avant les fonctions qui les lisent)
alter table public.workshop_time_entries
  add column if not exists mechanic_code text,
  add column if not exists task_code     text;
comment on column public.workshop_time_entries.mechanic_code is 'Code mecano scanne / saisi a la pointeuse (reference_values workshop_mechanic).';
comment on column public.workshop_time_entries.task_code     is 'Tache improductive (kind = improductif) : reference_values workshop_task.';
create index if not exists idx_wte_open_code on public.workshop_time_entries(company_id, mechanic_code) where ended_at is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'repair_order_lines_hours_nonneg') then
    alter table public.repair_order_lines add constraint repair_order_lines_hours_nonneg check (
      coalesce(billed_hours, 0) >= 0 and coalesce(worked_hours, 0) >= 0
      and coalesce(internal_hours, 0) >= 0 and coalesce(warranty_hours, 0) >= 0
    ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Reecriture des lignes en une transaction (redefinition de 20261031110000 + temps MO)
-- ---------------------------------------------------------------------
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

  -- Une seule instruction : les anciennes lignes sont retirees (RETURNING) et le temps des lignes MO
  -- du check-up (les cartes ne renvoient pas ces colonnes) est repris par `checkup_key`.
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
     line_ht, line_ttc, sort_order, checkup_key, checkup_state, photo_path, proposal_line_id,
     mechanic_code, mechanic_name, work_date, billed_hours, worked_hours, internal_hours, warranty_hours)
  select _or,
         x.kind, x.article_id, x.designation, x.quantity, x.unit_price_ht, x.vat_rate, x.discount_pct, x.is_warranty,
         x.line_ht, x.line_ttc, x.sort_order, x.checkup_key, x.checkup_state, x.photo_path, x.proposal_line_id,
         case when x.kind = 'mo' then case when x.l ? 'mechanic_code' then nullif(x.l->>'mechanic_code', '') else o.mechanic_code end end,
         case when x.kind = 'mo' then case when x.l ? 'mechanic_name' then nullif(x.l->>'mechanic_name', '') else o.mechanic_name end end,
         case when x.kind = 'mo' then case when x.l ? 'work_date' then nullif(x.l->>'work_date', '')::date else o.work_date end end,
         -- Heures facturees = la quantite de la ligne MO, des que le temps a ete saisi (ligne en
         -- garantie : sa quantite porte les heures garanties, les heures facturees restent telles quelles).
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
-- 3. Controle du temps atelier (avant facture) et temps pointe de l'OR
-- ---------------------------------------------------------------------
-- _lines : [{ id, mechanic_code, mechanic_name, work_date, billed_hours, worked_hours,
--             internal_hours, warranty_hours }] — une entree par ligne MO de l'OR.
-- Regle G8 : des heures internes ou garanties sur une ligne → heures facturees remises a zero
-- (le temps facture se saisit sur une autre ligne MO). Quantite de la ligne = heures facturees.
create or replace function public.repair_order_time_control(_or uuid, _lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.repair_orders%rowtype;
  e jsonb;
  n integer := 0;
  _billed numeric; _internal numeric; _warranty numeric; _worked numeric; _qty numeric;
  _covered boolean;
  _ht numeric; _ttc numeric;
begin
  select * into r from public.repair_orders where id = _or for update;
  if not found then
    raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.can_write_table(r.company_id, 'repair_orders') then
    raise exception 'Acces refuse a la societe %', r.company_id using errcode = '42501';
  end if;
  if r.status in ('facture', 'annule') then
    raise exception 'OR % : le temps ne se controle plus (OR facture ou annule).', coalesce(r.number, r.id::text) using errcode = 'P0001';
  end if;

  for e in select * from jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) loop
    _billed   := greatest(coalesce(nullif(e->>'billed_hours', '')::numeric, 0), 0);
    _worked   := greatest(nullif(e->>'worked_hours', '')::numeric, 0);
    _internal := greatest(coalesce(nullif(e->>'internal_hours', '')::numeric, 0), 0);
    _warranty := greatest(coalesce(nullif(e->>'warranty_hours', '')::numeric, 0), 0);
    if _internal > 0 or _warranty > 0 then _billed := 0; end if;
    -- Ligne couverte par la garantie (meme regle que src/modules/workshop/warranty/rules.ts) :
    -- 0 pour le client, sa quantite = ses heures garanties.
    select (l.is_warranty and coalesce(r.warranty_status, '') <> 'refus_total' and not (coalesce(r.warranty_status, '') = 'refus_partiel' and coalesce(to_jsonb(l)->>'warranty_decision', '') = 'refuse')) into _covered
      from public.repair_order_lines l
     where l.id = nullif(e->>'id', '')::uuid and l.or_id = _or and l.kind = 'mo';
    if not found then continue; end if;
    _qty := round(case when _covered and _warranty > 0 then _warranty else _billed end, 2);
    update public.repair_order_lines l
       set mechanic_code  = nullif(btrim(coalesce(e->>'mechanic_code', '')), ''),
           mechanic_name  = nullif(btrim(coalesce(e->>'mechanic_name', '')), ''),
           work_date      = nullif(e->>'work_date', '')::date,
           billed_hours   = round(_billed, 2),
           worked_hours   = round(_worked, 2),
           internal_hours = round(_internal, 2),
           warranty_hours = round(_warranty, 2),
           quantity       = _qty,
           line_ht        = round(_qty * (case when _covered then 0 else l.unit_price_ht end) * (1 - coalesce(l.discount_pct, 0) / 100), 2),
           line_ttc       = round(round(_qty * (case when _covered then 0 else l.unit_price_ht end) * (1 - coalesce(l.discount_pct, 0) / 100), 2) * (1 + coalesce(l.vat_rate, 0) / 100), 2)
     where l.id = nullif(e->>'id', '')::uuid and l.or_id = _or and l.kind = 'mo';
    if found then n := n + 1; end if;
  end loop;

  -- Totaux de l'OR (les actions du check-up « OK » / « reportees » ne comptent pas).
  select coalesce(sum(l.line_ht), 0), coalesce(sum(l.line_ttc), 0) into _ht, _ttc
    from public.repair_order_lines l
   where l.or_id = _or and coalesce(to_jsonb(l)->>'checkup_state', '') not in ('ok', 'reporte');
  update public.repair_orders
     set total_ht = round(_ht, 2), total_ttc = round(_ttc, 2), total_vat = round(_ttc - _ht, 2)
   where id = _or;
  return n;
end $$;
revoke all on function public.repair_order_time_control(uuid, jsonb) from public, anon;
grant execute on function public.repair_order_time_control(uuid, jsonb) to authenticated;

-- Temps pointe sur l'OR (pointeuse, kind travail), par mecanicien, en heures.
create or replace function public.repair_order_time_summary(_or uuid)
returns table(mechanic_key text, mechanic_code text, mechanic_name text, pointed_h numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(btrim(e.mechanic_code), ''), nullif(btrim(e.mechanic_name), ''), e.mechanic_id::text, '') as mechanic_key,
         max(nullif(btrim(e.mechanic_code), '')) as mechanic_code,
         coalesce(max(rv.label), max(e.mechanic_name)) as mechanic_name,
         round(sum(coalesce(e.minutes, 0)) / 60.0, 2) as pointed_h
    from public.workshop_time_entries e
    join public.repair_orders o on o.id = e.or_id
    left join public.reference_values rv
      on rv.company_id = o.company_id and rv.table_key = 'workshop_mechanic' and rv.code = e.mechanic_code
   where e.or_id = _or and e.kind = 'travail' and e.minutes is not null
     and public.is_member(o.company_id)
   group by 1
   order by 1;
$$;
revoke all on function public.repair_order_time_summary(uuid) from public, anon;
grant execute on function public.repair_order_time_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Facture d'OR unique et atomique
-- ---------------------------------------------------------------------
alter table public.documents
  add column if not exists repair_order_id uuid references public.repair_orders(id) on delete set null;
create index if not exists idx_documents_repair_order on public.documents(repair_order_id) where repair_order_id is not null;

-- Factures d'OR deja emises (avant ce lot, le lien n'etait que repair_orders.invoice_document_id).
update public.documents d
   set repair_order_id = o.id
  from public.repair_orders o
 where o.invoice_document_id = d.id and d.repair_order_id is null and d.doc_type = 'FAC';

-- Une seule facture non annulee par OR (brouillon compris : deux en-tetes simultanes = refus).
do $$
begin
  if exists (
    select 1 from public.documents
     where doc_type = 'FAC' and repair_order_id is not null and status <> 'annulee'
     group by repair_order_id having count(*) > 1
  ) then
    raise notice 'Factures d''OR en double deja en base : index unique non pose, la garde par verrou reste active. Voir supabase/tests/m8_temps_mo.sql (requete des doublons).';
  else
    create unique index if not exists uq_documents_invoice_per_repair_order
      on public.documents(repair_order_id)
      where doc_type = 'FAC' and repair_order_id is not null and status <> 'annulee';
  end if;
end $$;

-- Garde : verrouille l'OR et refuse une 2e facture (ou un OR deja facture par une autre facture).
create or replace function public.trg_documents_repair_order_invoice_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _st text; _inv uuid; _num text; _other text;
begin
  if new.doc_type <> 'FAC' or new.repair_order_id is null or new.status = 'annulee' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.repair_order_id is not distinct from new.repair_order_id
     and old.doc_type = new.doc_type and old.status <> 'annulee' then
    return new;  -- meme facture, meme OR : rien a verifier (validation, paiement...)
  end if;
  select status, invoice_document_id, number into _st, _inv, _num
    from public.repair_orders where id = new.repair_order_id for update;
  if not found then return new; end if;
  select coalesce(d.number, 'brouillon') into _other
    from public.documents d
   where d.repair_order_id = new.repair_order_id and d.doc_type = 'FAC' and d.status <> 'annulee' and d.id <> new.id
   limit 1;
  if _other is not null then
    raise exception 'OR % deja facture (facture %) : une seule facture par OR.', coalesce(_num, new.repair_order_id::text), _other
      using errcode = '23505';
  end if;
  if _st = 'facture' and _inv is not null and _inv <> new.id then
    raise exception 'OR % deja facture : une seule facture par OR.', coalesce(_num, new.repair_order_id::text)
      using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function public.trg_documents_repair_order_invoice_guard() from public, anon, authenticated;
drop trigger if exists trg_documents_repair_order_invoice_guard on public.documents;
create trigger trg_documents_repair_order_invoice_guard
  before insert or update of repair_order_id, doc_type, status on public.documents
  for each row execute function public.trg_documents_repair_order_invoice_guard();

-- Facture validee → OR « facture » dans la meme transaction.
create or replace function public.trg_documents_repair_order_invoiced()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.doc_type = 'FAC' and new.repair_order_id is not null and new.status not in ('brouillon', 'annulee')
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.repair_order_id is distinct from new.repair_order_id) then
    update public.repair_orders
       set status = 'facture', invoice_document_id = new.id
     where id = new.repair_order_id
       and (status is distinct from 'facture' or invoice_document_id is distinct from new.id);
  end if;
  return null;
end $$;
revoke all on function public.trg_documents_repair_order_invoiced() from public, anon, authenticated;
drop trigger if exists trg_documents_repair_order_invoiced on public.documents;
create trigger trg_documents_repair_order_invoiced
  after insert or update of status, repair_order_id on public.documents
  for each row execute function public.trg_documents_repair_order_invoiced();

-- ---------------------------------------------------------------------
-- 5. Pointeuse : code mecano, taches improductives
-- ---------------------------------------------------------------------
-- (colonnes de la pointeuse posees en tete : section 1 bis, utilisees par les fonctions ci-dessus)

-- Taches improductives de G8, prechargees pour chaque societe (reglables dans Parametres → Tables).
insert into public.reference_values (company_id, table_key, code, label, sort_order)
select c.id, 'workshop_task', x.code, x.label, x.so
  from public.companies c
 cross join (values
   ('nettoyage_atelier', 'Nettoyage atelier', 1),
   ('nettoyage_motos', 'Nettoyage motos', 2),
   ('motos_expo', 'Entrée / sortie motos expo', 3)
 ) as x(code, label, so)
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 6. Productivite atelier (B11) : une ligne par jour et par mecanicien, en heures
-- ---------------------------------------------------------------------
create or replace function public.workshop_productivity_detail(_company uuid, _from date, _to date)
returns table(
  day date, mechanic_key text, mechanic_name text,
  presence_h numeric, pointed_h numeric, improductive_h numeric,
  billed_h numeric, to_bill_h numeric, internal_h numeric, warranty_h numeric, line_worked_h numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with te as (
    select (e.started_at at time zone 'Europe/Brussels')::date as day,
           coalesce(nullif(btrim(e.mechanic_code), ''), nullif(btrim(e.mechanic_name), ''), e.mechanic_id::text, '') as mkey,
           e.mechanic_name as mname, e.kind, coalesce(e.minutes, 0) / 60.0 as h
      from public.workshop_time_entries e
     where e.company_id = _company and public.is_member(_company) and e.minutes is not null
       and (e.started_at at time zone 'Europe/Brussels')::date between _from and _to
  ),
  li as (
    select coalesce(l.work_date,
                    case when o.status = 'facture' then d.issue_date end,
                    (o.created_at at time zone 'Europe/Brussels')::date) as day,
           coalesce(nullif(btrim(l.mechanic_code), ''), nullif(btrim(l.mechanic_name), ''), '') as mkey,
           l.mechanic_name as mname,
           o.status = 'facture' as invoiced,
           -- Ligne couverte par la garantie (refus total / ligne refusee = facturee au client).
           case when x_cov.covered then 0 else greatest(coalesce(l.quantity, 0), 0) end as billed,
           coalesce(l.internal_hours, 0) as internal,
           coalesce(l.warranty_hours, case when x_cov.covered then greatest(coalesce(l.quantity, 0), 0) else 0 end) as warranty,
           coalesce(l.worked_hours, 0) as worked
      from public.repair_order_lines l
      join public.repair_orders o on o.id = l.or_id
      left join public.documents d on d.id = o.invoice_document_id
      cross join lateral (select (l.is_warranty and coalesce(o.warranty_status, '') <> 'refus_total'
                                  and not (coalesce(o.warranty_status, '') = 'refus_partiel'
                                           and coalesce(to_jsonb(l)->>'warranty_decision', '') = 'refuse')) as covered) x_cov
     where o.company_id = _company and public.is_member(_company)
       and o.status <> 'annule' and l.kind = 'mo'
       and coalesce(to_jsonb(l)->>'checkup_state', '') not in ('ok', 'reporte')
  ),
  u as (
    select day, mkey, mname,
           case when kind = 'presence' then h else 0 end as presence,
           case when kind = 'travail' then h else 0 end as pointed,
           case when kind = 'improductif' then h else 0 end as improd,
           0::numeric as billed, 0::numeric as to_bill, 0::numeric as internal, 0::numeric as warranty, 0::numeric as lworked
      from te
    union all
    select day, mkey, mname, 0, 0, 0,
           case when invoiced then billed else 0 end,
           case when invoiced then 0 else billed end,
           internal, warranty, worked
      from li
     where day between _from and _to
  )
  select u.day, u.mkey,
         coalesce(max(rv.label), max(u.mname), nullif(u.mkey, ''), '') as mechanic_name,
         round(sum(u.presence), 2), round(sum(u.pointed), 2), round(sum(u.improd), 2),
         round(sum(u.billed), 2), round(sum(u.to_bill), 2), round(sum(u.internal), 2),
         round(sum(u.warranty), 2), round(sum(u.lworked), 2)
    from u
    left join public.reference_values rv
      on rv.company_id = _company and rv.table_key = 'workshop_mechanic' and rv.code = u.mkey
   group by u.day, u.mkey
   order by u.day, u.mkey;
$$;
revoke all on function public.workshop_productivity_detail(uuid, date, date) from public, anon;
grant execute on function public.workshop_productivity_detail(uuid, date, date) to authenticated;

comment on function public.workshop_productivity_detail(uuid, date, date) is
  'Productivite atelier G8 (B11) par jour et par mecanicien : presence, pointe, improductif, facture, a facturer, internes, garanties, heures passees saisies (heures).';
