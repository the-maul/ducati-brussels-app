-- =====================================================================
-- M8 — Total de l'OR = total de la facture, au centime (lot parcours-fix, 20/11/2026).
--
-- Constat du test du 20/11 : OR TESTOR-2026-00001 = 113,26 EUR TTC, facture TESTFAC-2026-00006 =
-- 113,24 EUR TTC pour les memes lignes. L'OR additionnait les TTC ARRONDIS ligne par ligne
-- (33,00 + 13,00 + 4,01 + 13,66 + 49,59) ; la facture (src/modules/sales/write-api.ts,
-- computeTotals) additionne les HT puis calcule la TVA sur le total (93,592 HT -> 93,59 ;
-- TVA 19,654 -> 19,65 ; TTC 113,24), comme le pied de facture G8 (base HT par taux, TVA par taux).
-- Regle alignee sur la facture : total HT = somme des HT non arrondis, TVA = somme des HT x taux,
-- chacun arrondi au centime, TTC = HT + TVA. Les montants de ligne (line_ht / line_ttc) ne changent pas.
-- Miroir TS : computeRoTotals (src/modules/workshop/write-api.ts), tests/workshop-totals.test.ts.
-- Redefinit (meme signature) : _repair_order_totals_refresh, repair_order_time_control.
-- Essai a blanc : supabase/tests/m8_total_or_comme_facture.sql.
-- =====================================================================

create or replace function public._repair_order_totals_refresh(_or uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _ht numeric; _vat numeric;
begin
  -- HT non arrondi d'une ligne ; une ligne a 0 (garantie couverte, texte) reste a 0.
  select coalesce(sum(x.ht), 0), coalesce(sum(x.ht * coalesce(x.vat_rate, 0) / 100), 0) into _ht, _vat
    from (select case when coalesce(l.line_ht, 0) = 0 then 0
                      else coalesce(l.quantity, 0) * coalesce(l.unit_price_ht, 0) * (1 - coalesce(l.discount_pct, 0) / 100) end as ht,
                 l.vat_rate
            from public.repair_order_lines l
           where l.or_id = _or and coalesce(l.checkup_state, '') not in ('ok', 'reporte')) x;
  update public.repair_orders
     set total_ht = round(_ht, 2), total_vat = round(_vat, 2), total_ttc = round(_ht, 2) + round(_vat, 2)
   where id = _or;
end $$;
revoke all on function public._repair_order_totals_refresh(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.repair_order_time_control(_or uuid, _lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r public.repair_orders%rowtype;
  e jsonb;
  n integer := 0;
  _billed numeric; _internal numeric; _warranty numeric; _worked numeric; _qty numeric;
  _covered boolean;
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

  -- Totaux de l'OR : meme regle que la facture (lot parcours-fix, 20/11/2026).
  perform public._repair_order_totals_refresh(_or);
  return n;
end $function$
;
revoke all on function public.repair_order_time_control(uuid, jsonb) from public, anon;
grant execute on function public.repair_order_time_control(uuid, jsonb) to authenticated;
