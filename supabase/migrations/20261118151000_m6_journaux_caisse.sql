-- M6 — Rattrapage G8 (18/11/2026, lot-g8-caisse) : donnees des journaux de caisse (Journal de caisse >
-- Edition, 26 journaux G8 ; comparaison-ventes-caisse-compta.md §3.1). PDV008 (journaux de caisse).
--
-- Une seule lecture par periode, en JSON : documents de vente, lignes, reglements percus, mouvements de
-- fond de caisse, sessions et remises en banque. Les journaux (liste des factures, etats et recapitulatifs
-- des encaissements, journal de caisse par mode, journal des ventes, ventilations par operateur / client /
-- famille / taux de TVA, mouvements de fonds, historique des reports, detail des ventes d une reference,
-- port par facture) se calculent dans l application (src/modules/sales/cash-journals.ts, teste).
--
-- Documents retenus = ceux du journal des ventes legal (20261103180000) : FAC, TIK, AVO, FAA, jamais un
-- brouillon ni un document annule. Reglements : percus, hors lettrage d avoir (AVO) et hors acompte reporte.
-- Suppose 20261103150000, 20261103170000, 20261103180000, 20261103220000 et 20261118150000 appliquees.
-- NON APPLIQUEE (Simon passe les migrations en bloc).

create or replace function public.cash_journal_data(_company uuid, _from date, _to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _r jsonb; _t0 timestamptz; _t1 timestamptz;
begin
  if not public.is_member(_company) then raise exception 'Acces refuse'; end if;
  if _from is null or _to is null or _to < _from then raise exception 'Periode invalide' using errcode = '22023'; end if;
  if _to - _from > 400 then raise exception 'Periode trop longue (13 mois au plus).' using errcode = '22023'; end if;
  _t0 := (_from::timestamp at time zone 'Europe/Brussels');
  _t1 := ((_to + 1)::timestamp at time zone 'Europe/Brussels');

  with docs as (
    select d.* from public.documents d
     where d.company_id = _company and d.doc_type in ('FAC', 'TIK', 'AVO', 'FAA')
       and d.status not in ('brouillon', 'annulee')
       and d.issue_date >= _from and d.issue_date <= _to
  )
  select jsonb_build_object(
    'from', _from, 'to', _to,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'number', d.number, 'doc_type', d.doc_type, 'status', d.status, 'issue_date', d.issue_date,
        'created_at', d.created_at, 'contact_id', d.contact_id,
        'contact_label', coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.last_name, c.first_name)), '')),
        'contact_code', c.code,
        'operator', coalesce(nullif(btrim(pr.full_name), ''), nullif(btrim(d.operator), '')),
        'total_ht', d.total_ht, 'total_vat', d.total_vat, 'total_ttc', d.total_ttc, 'paid_amount', d.paid_amount,
        'shipping_ht', d.shipping_ht, 'shipping_vat_rate', d.shipping_vat_rate, 'shipping_taxed', d.shipping_taxed,
        'legacy_margin', d.marge, 'cash_session_id', d.cash_session_id
      ) order by d.issue_date, d.number)
        from docs d
        left join public.contacts c on c.id = d.contact_id
        left join public.profiles pr on pr.id = d.operator_user_id
    ), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'document_id', l.document_id, 'article_id', l.article_id,
        'reference', coalesce(nullif(btrim(l.reference), ''), a.reference), 'designation', l.designation,
        'line_type', l.line_type, 'quantity', l.quantity, 'vat_rate', l.vat_rate, 'line_ht', l.line_ht, 'line_ttc', l.line_ttc,
        'unit_cost', case when a.id is null then null else coalesce(nullif(a.pamp, 0), a.purchase_price) end,
        'family', a.category_path
      ) order by l.document_id, l.sort_order)
        from public.document_lines l
        join docs d on d.id = l.document_id
        left join public.articles a on a.id = l.article_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'document_id', p.document_id, 'document_number', doc.number, 'doc_type', doc.doc_type,
        'contact_label', coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.last_name, c.first_name)), '')),
        'method', p.method, 'amount', p.amount, 'paid_at', p.paid_at, 'note', p.note,
        'cash_session_id', p.cash_session_id, 'reversal_of', p.reversal_of
      ) order by p.paid_at)
        from public.document_payments p
        join public.documents doc on doc.id = p.document_id
        left join public.contacts c on c.id = doc.contact_id
       where doc.company_id = _company and p.status = 'recu' and p.method <> 'AVO' and p.transferred_from is null
         and p.paid_at >= _t0 and p.paid_at < _t1
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'movement_no', m.movement_no, 'occurred_at', m.occurred_at, 'kind', m.kind, 'method', m.method,
        'amount', m.amount, 'reason', m.reason, 'type_code', m.type_code,
        'type_label', (select rv.label from public.reference_values rv where rv.company_id = _company and rv.table_key = 'cash_movement_type' and rv.code = m.type_code limit 1),
        'vat_rate', m.vat_rate, 'vat_amount', m.vat_amount, 'account_code', m.account_code,
        'deposit_id', m.deposit_id, 'session_id', m.session_id
      ) order by m.occurred_at)
        from public.cash_movements m
       where m.company_id = _company and m.occurred_at >= _t0 and m.occurred_at < _t1
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'register_code', s.register_code, 'z_number', s.z_number, 'status', s.status,
        'opened_at', s.opened_at, 'closed_at', s.closed_at, 'opening_float', s.opening_float,
        'proposed_float', s.proposed_float, 'expected_cash', s.expected_cash, 'counted_cash', s.counted_cash
      ) order by s.opened_at)
        from public.cash_sessions s
       where s.company_id = _company and s.opened_at < _t1 and (s.closed_at is null or s.closed_at >= _t0)
    ), '[]'::jsonb),
    -- Remises : celles de la periode et, par mode, la derniere remise active d avant (report d ouverture).
    'deposits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'number', x.number, 'method', x.method, 'kind', x.kind, 'status', x.status,
        'deposit_date', x.deposit_date, 'created_at', x.created_at, 'period_from', x.period_from, 'period_to', x.period_to,
        'lines_total', x.lines_total, 'deposited_amount', x.deposited_amount, 'new_float', x.new_float,
        'line_count', x.line_count, 'bank_label', x.bank_label, 'comment', x.comment, 'cancel_reason', x.cancel_reason
      ) order by x.created_at)
        from public.cash_deposits x
       where x.company_id = _company and x.created_at < _t1
         and (x.created_at >= _t0
              or x.id in (select distinct on (y.method) y.id from public.cash_deposits y
                           where y.company_id = _company and y.status = 'active' and y.created_at < _t0
                           order by y.method, y.created_at desc))
    ), '[]'::jsonb),
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object('code', rv.code, 'label', rv.label) order by rv.sort_order, rv.code)
        from public.reference_values rv where rv.company_id = _company and rv.table_key = 'payment_method'
    ), '[]'::jsonb)
  ) into _r;
  return _r;
end $$;
grant execute on function public.cash_journal_data(uuid, date, date) to authenticated;

comment on function public.cash_journal_data(uuid, date, date) is
  'M6 PDV008 (rattrapage G8) : donnees des journaux de caisse d une periode (sans brouillon ni document annule).';
