-- M6 — Journal Z et avoirs (03/11/2026, PDV011). Suppose 20261103150000 a 20261103200000 APPLIQUEES
-- (en particulier 20261103170000_m6_caisse_legale.sql et 20261103180000_m6_facture_legale.sql).
--
-- Constat du lot facture legale (63c24be) :
--   * un ticket / une facture compense en totalite par un avoir passe en `avoir_emis` (il reste au
--     journal des ventes, l avoir negatif le compense) ; or `_cash_z_build` (Z par session) et
--     `cash_z_report` (ancien Z par plage horaire, repli de l ecran) ne comptaient que `validee`,
--     `payee` et `annulee` : le ticket sortait du Z, l avoir y restait (ventes 0 - avoir 100 = -100) ;
--   * le reglement de lettrage d un avoir (mode `AVO`, + sur la facture, - sur l avoir) apparaissait
--     dans les encaissements par mode pour un total nul : ce n est pas un encaissement.
--
-- Ce que pose cette migration (redefinit les deux fonctions, memes signatures, memes droits) :
--   1. `avoir_emis` compte comme un document valide dans les ventes du Z (documents, nombre de
--      tickets, TVA par taux, remises, CA net, lignes > 500 EUR TTC) : la vente reste dans le Z de sa
--      session, l avoir la compense dans la meme session ou dans une suivante (comme le journal des
--      ventes). `annulee` reste compte (aucun document valide ne sort du Z).
--   2. Le mode `AVO` (lettrage, jamais de tresorerie) est exclu des encaissements par mode et du
--      theorique especes.
--   3. Les reglements `transferred_from` (acompte reporte a la conversion, pas un nouvel encaissement)
--      restent exclus, desormais explicitement (le Z par session les excluait deja : ils n ont pas de
--      session ; l ancien Z par plage horaire les comptait).
-- Le JSON du Z passe en version 3. Les Z deja figes (`cash_sessions.z_report`) ne sont jamais
-- recalcules : seule la cloture suivante beneficie de la correction.
--
-- NON APPLIQUEE le 03/11/2026 (regle du lot : aucune migration en prod sans accord). Commande :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103220000_m6_z_avoirs.sql
-- Essai a blanc : migrations 150000, 160000, 170000, 180000 + celle-ci + scenario, entoures de
-- `begin;` / `rollback;` (ticket 100 EUR, avoir total : ventes 100 - avoir 100 = 0, pas de ligne AVO).

-- ---------------------------------------------------------------------
-- 1. Journal Z par session (X tant que la session est ouverte, Z fige a la cloture).
--    Reprend 20261103170000 §6 : statuts + `avoir_emis`, encaissements sans `AVO` ni acompte reporte.
-- ---------------------------------------------------------------------
create or replace function public._cash_z_build(_s public.cash_sessions, _closed_at timestamptz, _number text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _r jsonb; _co record; _esp numeric; _in numeric; _out numeric; _expected numeric;
begin
  select name, legal_name, vat_number, address, zip, city into _co from public.companies where id = _s.company_id;
  -- Especes theoriques : reglements ESP percus dans la session (jamais un lettrage AVO, jamais un acompte reporte).
  select coalesce(sum(p.amount), 0) into _esp from public.document_payments p
   where p.cash_session_id = _s.id and p.status = 'recu' and p.method = 'ESP'
     and p.transferred_from is null;
  select coalesce(sum(amount), 0) into _in  from public.cash_movements where session_id = _s.id and kind = 'in'  and method = 'ESP';
  select coalesce(sum(amount), 0) into _out from public.cash_movements where session_id = _s.id and kind = 'out' and method = 'ESP';
  _expected := round(_s.opening_float + _esp + _in - _out, 2);

  select jsonb_build_object(
    'version', 3,
    'number', _number,
    'register_code', _s.register_code,
    'company', jsonb_build_object('name', _co.name, 'legal_name', _co.legal_name, 'vat_number', _co.vat_number,
                                  'address', _co.address, 'zip', _co.zip, 'city', _co.city),
    'session_id', _s.id,
    'opened_at', _s.opened_at, 'closed_at', _closed_at,
    'opened_by', _s.opened_by, 'closed_by', case when _number is null then null else coalesce(_s.closed_by, auth.uid()) end,
    'opening_float', _s.opening_float,
    'expected_cash', _expected,
    'counted_cash', _s.counted_cash,
    'variance', case when _s.counted_cash is null then null else round(_s.counted_cash - _expected, 2) end,
    'variance_reason', _s.variance_reason,
    -- Documents de la session (nombre et TTC par type) : FAC, TIK, AVO valides, payes, compenses par un
    -- avoir (`avoir_emis`) ou annules.
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('doc_type', doc_type, 'count', n, 'total_ttc', ttc) order by doc_type)
      from (select d.doc_type, count(*) as n, round(sum(d.total_ttc), 2) as ttc
              from public.documents d
             where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')
             group by d.doc_type) x
    ), '[]'::jsonb),
    'ticket_count', (select count(*) from public.documents d where d.cash_session_id = _s.id and d.doc_type = 'TIK' and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')),
    -- Totaux par taux de TVA (base HT, TVA, TTC) des ventes de la session, avoirs en negatif.
    'vat_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('vat_rate', vat_rate, 'base_ht', base_ht, 'vat', vat, 'ttc', ttc) order by vat_rate)
      from (select l.vat_rate, round(sum(l.line_ht), 2) as base_ht, round(sum(l.line_ttc - l.line_ht), 2) as vat, round(sum(l.line_ttc), 2) as ttc
              from public.document_lines l join public.documents d on d.id = l.document_id
             where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')
             group by l.vat_rate) v
    ), '[]'::jsonb),
    -- Remises (HT) : remises de ligne + remises globales.
    'discounts_ht', coalesce((
      select round(sum(l.quantity * l.unit_price_ht * coalesce(l.discount_pct, 0) / 100), 2)
        from public.document_lines l join public.documents d on d.id = l.document_id
       where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')
    ), 0) + coalesce((
      select round(sum(case when d.global_discount_pct > 0 then (select sum(l.line_ht) from public.document_lines l where l.document_id = d.id) * d.global_discount_pct / 100
                            else d.global_discount_amount end), 2)
        from public.documents d
       where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')
    ), 0),
    -- Remboursements / avoirs (TTC, negatif) et chiffre d affaires net TVAC.
    'refunds_ttc', coalesce((select round(sum(d.total_ttc), 2) from public.documents d
                             where d.cash_session_id = _s.id and d.doc_type = 'AVO' and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')), 0),
    'net_sales_ttc', coalesce((select round(sum(d.total_ttc), 2) from public.documents d
                               where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')), 0),
    -- Lignes distinctes : toute livraison dont le prix unitaire depasse 500 EUR TTC (AR n. 1, art. 14 par. 2, 3.).
    'large_items', coalesce((
      select jsonb_agg(jsonb_build_object('number', d.number, 'doc_type', d.doc_type, 'issue_date', d.issue_date,
                                          'designation', l.designation, 'quantity', l.quantity, 'line_ttc', l.line_ttc)
                       order by d.number, l.sort_order)
        from public.document_lines l join public.documents d on d.id = l.document_id
       where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')
         and l.quantity <> 0 and abs(l.line_ttc / l.quantity) > 500
    ), '[]'::jsonb),
    -- Encaissements par mode (ventes FAC / TIK, acomptes RES / BC, avoirs AVO), libelle du mode.
    -- Hors lettrage facture / avoir (mode AVO) et hors acompte reporte (`transferred_from`).
    'payments_by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'label', label, 'sales', sales, 'deposits', deposits, 'refunds', refunds, 'total', total) order by method)
      from (select p.method,
                   coalesce((select rv.label from public.reference_values rv where rv.company_id = _s.company_id and rv.table_key = 'payment_method' and rv.code = p.method limit 1), p.method) as label,
                   sum(case when d.doc_type in ('FAC', 'TIK') then p.amount else 0 end) as sales,
                   sum(case when d.doc_type in ('RES', 'BC') then p.amount else 0 end) as deposits,
                   sum(case when d.doc_type = 'AVO' then p.amount else 0 end) as refunds,
                   sum(p.amount) as total
              from public.document_payments p join public.documents d on d.id = p.document_id
             where p.cash_session_id = _s.id and p.status = 'recu'
               and p.method <> 'AVO' and p.transferred_from is null
             group by p.method) m
    ), '[]'::jsonb),
    'cash_in_esp', _in, 'cash_out_esp', _out,
    'cash_in',  coalesce((select sum(amount) from public.cash_movements where session_id = _s.id and kind = 'in'), 0),
    'cash_out', coalesce((select sum(amount) from public.cash_movements where session_id = _s.id and kind = 'out'), 0),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object('occurred_at', m.occurred_at, 'kind', m.kind, 'method', m.method, 'amount', m.amount, 'reason', m.reason) order by m.occurred_at)
        from public.cash_movements m where m.session_id = _s.id
    ), '[]'::jsonb)
  ) into _r;
  return _r;
end $$;
revoke all on function public._cash_z_build(public.cash_sessions, timestamptz, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Ancien Z par plage horaire (repli de l ecran quand `cash_z_report_session` n existe pas encore,
--    sessions anterieures a la caisse legale). Reprend 20261103150000 §1 avec les memes regles.
-- ---------------------------------------------------------------------
create or replace function public.cash_z_report(_company uuid, _from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _result jsonb; _d_from date; _d_to date;
begin
  if not public.is_member(_company) then raise exception 'Acces refuse'; end if;
  -- Bornes en jours pour les documents (dates sans heure) : la borne haute est INCLUSE.
  _d_from := _from::date;
  _d_to := (_to - interval '1 microsecond')::date;

  select jsonb_build_object(
    -- Reglements percus par mode, ventiles par nature de document (ventes, acomptes RES/BC, avoirs),
    -- hors lettrage facture / avoir (mode AVO) et hors acompte reporte a la conversion.
    'payments_by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'sales', sales, 'deposits', deposits, 'refunds', refunds, 'total', total) order by method)
      from (
        select p.method,
          sum(case when d.doc_type in ('FAC','TIK') then p.amount else 0 end) as sales,
          sum(case when d.doc_type in ('RES','BC') then p.amount else 0 end) as deposits,
          sum(case when d.doc_type = 'AVO' then p.amount else 0 end) as refunds,
          sum(p.amount) as total
        from public.document_payments p
        join public.documents d on d.id = p.document_id
        where d.company_id = _company and p.status = 'recu' and p.paid_at >= _from and p.paid_at < _to
          and p.method <> 'AVO' and p.transferred_from is null
        group by p.method
      ) m
    ), '[]'::jsonb),
    -- Ventilation TVA des ventes de la periode : FAC / TIK validees, payees, compensees par un avoir ou
    -- annulees, avoirs en negatif, jamais un brouillon, jour de cloture compris.
    'vat_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('vat_rate', vat_rate, 'base_ht', base_ht, 'vat', vat) order by vat_rate)
      from (
        select l.vat_rate,
          round(sum(l.line_ht), 2) as base_ht,
          round(sum(l.line_ttc - l.line_ht), 2) as vat
        from public.document_lines l
        join public.documents d on d.id = l.document_id
        where d.company_id = _company and d.doc_type in ('FAC','TIK','AVO')
          and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')
          and d.issue_date >= _d_from and d.issue_date <= _d_to
        group by l.vat_rate
      ) v
    ), '[]'::jsonb),
    -- Documents de la periode (nombre et TTC par type), pour le recapitulatif du Z
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('doc_type', doc_type, 'count', n, 'total_ttc', ttc) order by doc_type)
      from (
        select d.doc_type, count(*) as n, round(sum(d.total_ttc), 2) as ttc
        from public.documents d
        where d.company_id = _company and d.doc_type in ('FAC','TIK','AVO')
          and d.status in ('validee', 'payee', 'avoir_emis', 'annulee')
          and d.issue_date >= _d_from and d.issue_date <= _d_to
        group by d.doc_type
      ) x
    ), '[]'::jsonb),
    -- Mouvements de fond de caisse : tous modes (inchange) et especes seules (tiroir)
    'cash_in',  coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'in'  and occurred_at >= _from and occurred_at < _to), 0),
    'cash_out', coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'out' and occurred_at >= _from and occurred_at < _to), 0),
    'cash_in_esp',  coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'in'  and method = 'ESP' and occurred_at >= _from and occurred_at < _to), 0),
    'cash_out_esp', coalesce((select sum(amount) from public.cash_movements where company_id = _company and kind = 'out' and method = 'ESP' and occurred_at >= _from and occurred_at < _to), 0)
  ) into _result;

  return _result;
end $$;
grant execute on function public.cash_z_report(uuid, timestamptz, timestamptz) to authenticated;

comment on function public._cash_z_build(public.cash_sessions, timestamptz, text) is
  'M6 PDV010 / PDV011 : journal Z d une session (v3) ; ventes valides y compris compensees par un avoir (avoir_emis), encaissements hors lettrage AVO et hors acompte reporte.';
