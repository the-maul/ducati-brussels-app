-- =====================================================================
-- M12 — RATTRAPAGE G8 « ENCAISSEMENTS » (18/11/2026), 3/5 : CLIENTS DEBITEURS / CREDITEURS
-- Ref. G8 : Encaissements > Liste des clients debiteurs (client ; echeances du ... jusqu au ... ;
-- etablie a la date du ... ; case clients avec encaissements a echeances ; tri alphabetique / code
-- client / date de facture / compte comptable ; cases Clients debiteurs / Clients crediteurs ;
-- colonnes Code client, Client, N° facture, Date facture, Date echeance, Montant TTC, Solde, Derniere
-- relance envoyee, Date relance, Compte comptable ; total ; Regulariser ; Exporter).
-- Comparaison section 2 : `debtors_list` (20260612190000) ne compte que les FAC, INCLUT LES
-- BROUILLONS et ne connait ni les crediteurs, ni la derniere relance, ni le compte comptable.
-- `debtors_list` reste en place (ecran Cloture d exercice) ; cette fonction est la liste detaillee.
--
-- « Etablie a la date du » (_as_of) : le reste du est recalcule A CETTE DATE = TTC - reglements
-- percus jusqu a cette date (paid_at) ; document emis apres la date : exclu. Document sans aucune
-- ligne de reglement (repris de G8) : on se fie a `paid_amount`.
--
-- Idempotente. NON APPLIQUEE. Suppose 20261118170000 et 20261118171000 posees.
-- =====================================================================

create or replace function public.debtors_detailed(
  _company uuid, _due_from date default null, _due_to date default null, _as_of date default current_date,
  _contact uuid default null, _side text default 'debit', _only_scheduled boolean default false
) returns table(
  contact_id uuid, contact_code text, contact_name text, accounting_account text, email text,
  document_id uuid, doc_type text, number text, issue_date date, due_date date,
  total_ttc numeric, amount_due numeric, scheduled numeric,
  last_code text, last_label text, last_date timestamptz, last_media text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with base as (
    select d.id, d.contact_id, d.doc_type, d.number, d.issue_date, coalesce(d.due_date, d.issue_date) as due_date, d.total_ttc,
           case when exists (select 1 from public.document_payments p0 where p0.document_id = d.id)
                then round(d.total_ttc - coalesce((select sum(p.amount) from public.document_payments p
                                                    where p.document_id = d.id and p.status = 'recu'
                                                      and p.paid_at::date <= coalesce(_as_of, current_date)), 0), 2)
                else round(d.total_ttc - d.paid_amount, 2) end as due,
           coalesce((select sum(p.amount) from public.document_payments p where p.document_id = d.id and p.status = 'attendu'), 0) as scheduled
      from public.documents d
     where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
       and d.doc_type in ('FAC', 'FAA', 'TIK', 'AVO')
       and d.status not in ('brouillon', 'annulee', 'converti')
       and d.contact_id is not null
       and d.issue_date <= coalesce(_as_of, current_date)
       and (_contact is null or d.contact_id = _contact)
       and (_due_from is null or coalesce(d.due_date, d.issue_date) >= _due_from)
       and (_due_to is null or coalesce(d.due_date, d.issue_date) <= _due_to)
  )
  select c.id, c.code::text,
         coalesce(nullif(btrim(c.company_name), ''), btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))),
         c.accounting_account::text,
         coalesce(nullif(btrim(c.email), ''), nullif(btrim(c.email_pro), '')),
         b.id, b.doc_type, b.number, b.issue_date, b.due_date, b.total_ttc, b.due, b.scheduled,
         l.template_code, l.template_label, l.sent_at, l.media
    from base b
    join public.contacts c on c.id = b.contact_id
    left join lateral (
      select dl.template_code, dl.template_label, dl.sent_at, dl.media
        from public.dunning_letters dl where dl.document_id = b.id
       order by dl.sent_at desc limit 1
    ) l on true
   where case when coalesce(_side, 'debit') = 'credit' then b.due < -0.005 else b.due > 0.005 end
     and (not coalesce(_only_scheduled, false) or b.scheduled > 0.005)
   order by 3, b.issue_date, b.number;
$$;
revoke all on function public.debtors_detailed(uuid, date, date, date, uuid, text, boolean) from public, anon;
grant execute on function public.debtors_detailed(uuid, date, date, date, uuid, text, boolean) to authenticated;
