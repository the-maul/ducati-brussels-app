-- =====================================================================
-- Mission 02 — carte « Règles des 4 types de commande réglables dans Paramètres »
--
-- Les règles des types de commande de pièces vivent dans reference_values
-- (table_key = 'order_threshold', une ligne par type, réglable dans
-- Paramètres → Tables → « Règles des types de commande »). Aucune valeur en dur :
--   extra.min_ht          minimum HTVA de la commande (standard 250, accident 1500)
--   extra.surcharge_pct   supplément facturé au client (urgente 10)
--   extra.max_per_day     nombre maximum de commandes validées par jour et par société (urgente 1)
--   extra.fallback        type vers lequel la commande repasse si le minimum n'est pas atteint (accident → standard)
--   extra.min_ht_per_tab  minimum HTVA par onglet du classeur (excel 2000)
-- La liste des types reste extensible : nouvelle valeur de l'énum order_kind
-- (alter type … add value, migration dédiée) + une ligne dans Paramètres.
--
-- Contrôle CÔTÉ SERVEUR :
--   part_order_rules(_company)       règles de chaque type (lecture, pour l'écran)
--   part_order_check_rules(_order)   diagnostic sans rien écrire (erreurs / avis)
--   part_order_validate(_order)      brouillon → en attente de paiement, refusé si une règle bloque
-- Additif uniquement : 2 colonnes, 4 fonctions, lignes de réglage insérées si absentes.
-- =====================================================================

-- 1. Date et auteur de la validation (sert au « une urgente par jour »)
alter table public.part_orders add column if not exists validated_at timestamptz;
alter table public.part_orders add column if not exists validated_by uuid references auth.users(id) on delete set null;
create index if not exists idx_part_orders_validated on public.part_orders(company_id, order_kind, validated_at);

-- 2. Réglages par défaut pour toute société qui n'en a pas encore (aucune ligne existante modifiée)
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'order_threshold', d.code, d.label, d.sort_order, d.extra::jsonb
from public.companies c
cross join (values
  ('standard','Commande standard (journalière)',1,'{"min_ht":250,"surcharge_pct":0}'),
  ('urgente','Commande urgente',2,'{"min_ht":0,"surcharge_pct":10,"max_per_day":1}'),
  ('accident','Commande accident',3,'{"min_ht":1500,"fallback":"standard"}'),
  ('excel','Commande Excel',4,'{"min_ht_per_tab":2000,"tabs":["demo","courtoisie","showroom"]}')
) as d(code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;

-- 3. Helpers internes (non appelables depuis le navigateur)
create or replace function public._eur_fr(_n numeric)
returns text language sql immutable set search_path = public, pg_temp as $$
  select replace(replace(to_char(coalesce(_n, 0), 'FM999G999G990D00'), ',', ' '), '.', ',') || ' €'
$$;

create or replace function public._jnum(_j jsonb, _k text)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(_j -> _k) = 'number' then (_j ->> _k)::numeric
              when (_j ->> _k) ~ '^\s*-?[0-9]+([.,][0-9]+)?\s*$' then replace(trim(_j ->> _k), ',', '.')::numeric
              else null end
$$;

revoke all on function public._eur_fr(numeric) from public, anon, authenticated;
revoke all on function public._jnum(jsonb, text) from public, anon, authenticated;

-- 4. Règles de chaque type (types de l'énum + lignes de Paramètres)
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
         nullif(trim(rv.extra ->> 'fallback'), ''),
         public._jnum(rv.extra, 'min_ht_per_tab')
    from (select e.enumlabel::text as code, e.enumsortorder::int as pos
            from pg_enum e where e.enumtypid = 'public.order_kind'::regtype) k
    left join public.reference_values rv
      on rv.company_id = _company and rv.table_key = 'order_threshold' and rv.code = k.code
   order by 3, 1;
end $$;

revoke all on function public.part_order_rules(uuid) from public, anon;
grant execute on function public.part_order_rules(uuid) to authenticated;

-- 5. Diagnostic des règles d'une commande (n'écrit rien)
--    Retour : { ok, kind, effective_kind, total_ht, surcharge_pct, errors:[{code,message}], notices:[…] }
create or replace function public.part_order_check_rules(_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  o        public.part_orders%rowtype;
  r        record;
  eff      text;
  total    numeric := 0;
  n_lines  int := 0;
  n_excel  int := 0;
  n_today  int;
  last_num text;
  errs     jsonb := '[]'::jsonb;
  notes    jsonb := '[]'::jsonb;
  tb       record;
  tab_name text;
begin
  select * into o from public.part_orders where id = _order_id;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(o.company_id) then
    raise exception 'Accès refusé à la société %', o.company_id using errcode = '42501';
  end if;

  eff := o.order_kind::text;

  select count(*), coalesce(sum(round((coalesce(l.qty_client, 0) + coalesce(l.qty_shop, 0)) * coalesce(l.unit_price_ht, 0), 2)), 0)
    into n_lines, total
    from public.part_order_lines l where l.order_id = o.id;

  select count(*) into n_excel
    from public.excel_order_lines l join public.excel_orders e on e.id = l.excel_order_id
   where e.part_order_id = o.id and l.qty > 0;

  if eff = 'excel' and n_excel > 0 then
    select coalesce(sum(round(l.price_dealer * l.qty * (1 - coalesce(l.extra_discount, 0)), 2)), 0) + total
      into total
      from public.excel_order_lines l join public.excel_orders e on e.id = l.excel_order_id
     where e.part_order_id = o.id;
  end if;

  if n_lines = 0 and n_excel = 0 then
    errs := errs || jsonb_build_object('code', 'no_lines', 'message', 'La commande ne contient aucune pièce.');
  end if;

  select * into r from public.part_order_rules(o.company_id) x where x.code = eff;

  if not found or not r.configured then
    notes := notes || jsonb_build_object('code', 'no_rule',
      'message', format('Aucune règle réglée pour le type « %s » dans Paramètres : pas de minimum.', eff));
  elsif not r.is_active then
    errs := errs || jsonb_build_object('code', 'kind_disabled',
      'message', format('Le type « %s » est désactivé dans Paramètres → Tables → Règles des types de commande.', r.label));
  else
    -- Repli (accident sous son minimum → standard)
    if r.fallback is not null and r.fallback <> eff and r.min_ht is not null and total < r.min_ht then
      if exists (select 1 from pg_enum e where e.enumtypid = 'public.order_kind'::regtype and e.enumlabel = r.fallback) then
        notes := notes || jsonb_build_object('code', 'fallback', 'from', eff, 'to', r.fallback,
          'message', format('%s sous %s HTVA (total %s) : elle repasse en %s.',
                            r.label, public._eur_fr(r.min_ht), public._eur_fr(total), r.fallback));
        eff := r.fallback;
        select * into r from public.part_order_rules(o.company_id) x where x.code = eff;
      end if;
    end if;

    if r.code is not null and r.is_active then
      -- Minimum de la commande
      if r.min_ht is not null and r.min_ht > 0 and total < r.min_ht then
        errs := errs || jsonb_build_object('code', 'below_min', 'kind', eff, 'min', r.min_ht, 'total', total,
          'message', format('%s : minimum %s HTVA non atteint (total %s, il manque %s).',
                            r.label, public._eur_fr(r.min_ht), public._eur_fr(total), public._eur_fr(r.min_ht - total)));
      end if;

      -- Minimum par onglet du classeur
      if r.min_ht_per_tab is not null and r.min_ht_per_tab > 0 then
        for tb in
          select l.tab, sum(round(l.price_dealer * l.qty * (1 - coalesce(l.extra_discount, 0)), 2)) as tab_total
            from public.excel_order_lines l join public.excel_orders e on e.id = l.excel_order_id
           where e.part_order_id = o.id and l.qty > 0
           group by l.tab order by l.tab
        loop
          if tb.tab_total < r.min_ht_per_tab then
            tab_name := initcap(tb.tab);
            errs := errs || jsonb_build_object('code', 'below_min_tab', 'tab', tb.tab, 'min', r.min_ht_per_tab, 'total', tb.tab_total,
              'message', format('%s, onglet %s : minimum %s HTVA non atteint (total %s, il manque %s).',
                                r.label, tab_name, public._eur_fr(r.min_ht_per_tab), public._eur_fr(tb.tab_total),
                                public._eur_fr(r.min_ht_per_tab - tb.tab_total)));
          end if;
        end loop;
      end if;

      -- Nombre maximum par jour (contrôlé à la validation seulement)
      if r.max_per_day is not null and r.max_per_day > 0 and o.dispatch_status = 'brouillon' then
        select count(*), max(p.number) into n_today, last_num
          from public.part_orders p
         where p.company_id = o.company_id and p.id <> o.id
           and p.order_kind::text = eff
           and p.dispatch_status not in ('brouillon', 'annulee')
           and (p.validated_at at time zone 'Europe/Brussels')::date = (now() at time zone 'Europe/Brussels')::date;
        if n_today >= r.max_per_day then
          errs := errs || jsonb_build_object('code', 'daily_limit', 'kind', eff, 'max', r.max_per_day,
            'message', format('%s : %s par jour au maximum, déjà validée aujourd’hui (%s).',
                              r.label, r.max_per_day, coalesce(last_num, 'sans numéro')));
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(errs) = 0,
    'kind', o.order_kind::text,
    'effective_kind', eff,
    'total_ht', total,
    'surcharge_pct', coalesce(case when r.code is not null and r.is_active then r.surcharge_pct end, 0),
    'errors', errs,
    'notices', notes
  );
end $$;

revoke all on function public.part_order_check_rules(uuid) from public, anon;
grant execute on function public.part_order_check_rules(uuid) to authenticated;

-- 6. Validation : brouillon → en attente de paiement (refusée si une règle bloque)
create or replace function public.part_order_validate(_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o     public.part_orders%rowtype;
  chk   jsonb;
  msg   text;
  surch numeric;
  ttc   numeric;
begin
  select * into o from public.part_orders where id = _order_id for update;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(o.company_id) then
    raise exception 'Accès refusé à la société %', o.company_id using errcode = '42501';
  end if;
  if o.dispatch_status <> 'brouillon' then
    raise exception 'Cette commande est déjà validée.' using errcode = 'P0001';
  end if;

  -- Sérialise les validations d'une même société (règle « n par jour »)
  perform pg_advisory_xact_lock(hashtext('part_order_validate:' || o.company_id::text));

  chk := public.part_order_check_rules(_order_id);
  if not (chk ->> 'ok')::boolean then
    select string_agg(e ->> 'message', ' ') into msg from jsonb_array_elements(chk -> 'errors') e;
    raise exception '%', msg using errcode = 'P0001', hint = 'part_order_rules';
  end if;

  surch := coalesce((chk ->> 'surcharge_pct')::numeric, 0);
  select round(coalesce(sum(l.line_ht * (1 + l.vat_rate / 100)), 0) * (1 + surch / 100), 2) into ttc
    from public.part_order_lines l where l.order_id = o.id;

  update public.part_orders set
    order_kind      = (chk ->> 'effective_kind')::public.order_kind,
    surcharge_pct   = surch,
    total_ht        = (chk ->> 'total_ht')::numeric,
    total_ttc       = coalesce(ttc, 0),
    number          = coalesce(number, public._next_document_number_unchecked(o.company_id, 'CDP')),
    validated_at    = now(),
    validated_by    = auth.uid(),
    dispatch_status = 'en_attente_paiement'
  where id = o.id;

  return chk;
end $$;

revoke all on function public.part_order_validate(uuid) from public, anon;
grant execute on function public.part_order_validate(uuid) to authenticated;

-- Libellé de la séquence des commandes de pièces (préfixe modifiable dans Numérotation des documents)
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, 'CDP', 'CDP', 'Commande de pièces'
from public.companies c
on conflict (company_id, doc_type) do nothing;
