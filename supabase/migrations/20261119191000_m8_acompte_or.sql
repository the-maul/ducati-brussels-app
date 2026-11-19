-- =====================================================================
-- M8 / M6 — Decision du client Q45 (18/11/2026, comme G8 « Saisie d'acompte » a la validation de
-- l'OR) : un ACOMPTE sur l'OR, avec LE MEME mecanisme que l'acompte de vente. ATE001 PDV010.
--
-- Pas de second systeme : l'acompte de l'OR est un reglement (`document_payments`) porte par un
-- document de vente « bon de commande » (BC) rattache a l'OR (`documents.repair_order_id`), un
-- seul par OR, numerote du n° de l'OR. Tout le reste est celui des ventes, inchange :
--   * encaissement : caisse (session ouverte, especes, plafond 3 000 EUR), garde-fous PDV010 ;
--   * facture d'acompte FAA legale : automatique (trg_deposit_invoice_auto, moto sur l'OR ou client
--     assujetti), sinon sur demande (deposit_invoice_create) ; rappel cloche « a facturer avant
--     le 15 » (deposit_invoice_due) ; le libelle de la FAA dit « Acompte sur commande n° OR-… » ;
--   * facture finale de l'OR : a la VALIDATION de la facture (FAC portant repair_order_id), les
--     acomptes percus sont REPORTES sur elle (`transferred_from` = reglement d'origine, A LA DATE DE
--     L'ENCAISSEMENT, `deposit_invoice_id` = la FAA) — exactement le report d'une conversion de
--     vente : pas un nouvel encaissement (hors Z, hors journaux, hors remise en banque), journal des
--     ventes / registre TVA / ecritures deduisent la FAA (PrepaidAmount). Le report reprend la date
--     d'origine : il passe le garde-fou « caisse cloturee » (20261119150000) meme si la journee de
--     l'acompte est close. Le BC passe « converti ».
--   * un reglement contre-passe (et sa contre-passation) n'est pas reporte ; un bon d'achat (BA)
--     non plus (le bon ne se consomme pas deux fois) : trace `events`.
--   * client de la facture different du client de l'acompte : pas de report (trace `events`),
--     l'acompte reste sur le BC (remboursement ou report a la main par la vente).
-- Audit : documents / reglements par leurs declencheurs d'audit + events explicites
-- (repair_order_deposit_document, repair_order_deposit_transferred, repair_order_deposit_not_transferred).
-- Additive, rejouable. Ne redefinit aucune fonction existante.
-- Essai a blanc : supabase/tests/m8_acompte_or.sql (acompte → FAA → caisse close → facture finale).
-- =====================================================================

-- Un seul BC d'acompte (non annule) par OR.
create unique index if not exists uq_documents_deposit_per_repair_order
  on public.documents (repair_order_id)
  where doc_type = 'BC' and repair_order_id is not null and status <> 'annulee';

-- ---------------------------------------------------------------------
-- 1. Le document qui porte l'acompte de l'OR (cree a la premiere saisie, puis retrouve)
-- ---------------------------------------------------------------------
create or replace function public.repair_order_deposit_document(_or uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.repair_orders%rowtype; _doc uuid; _number text;
begin
  select * into r from public.repair_orders where id = _or for update;
  if not found then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
  if not public.is_member(r.company_id) then raise exception 'Acces refuse.' using errcode = '42501'; end if;

  select d.id into _doc from public.documents d
   where d.repair_order_id = _or and d.doc_type = 'BC' and d.status <> 'annulee'
   order by d.created_at limit 1;
  if _doc is not null then return _doc; end if;

  if r.status in ('facture', 'annule') then
    raise exception 'OR % % : plus d''acompte possible.', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;
  if r.contact_id is null then
    raise exception 'Choisissez le client de l''OR avant d''encaisser un acompte.' using errcode = '23514';
  end if;

  -- Meme ordre que l'application : brouillon sans numero → ligne → numero + statut.
  insert into public.documents (company_id, doc_type, number, status, contact_id, vehicle_id, issue_date,
                                total_ht, total_vat, total_ttc, paid_amount, notes, price_mode, repair_order_id)
  values (r.company_id, 'BC', null, 'brouillon', r.contact_id, r.vehicle_id, public._brussels_today(),
          0, 0, 0, 0, 'Acompte sur l''ordre de reparation ' || coalesce(r.number, ''), 'ttc', r.id)
  returning id into _doc;
  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, discount_pct,
                                     line_ht, line_ttc, sort_order, line_type)
  values (_doc, 'Acompte sur l''ordre de reparation ' || coalesce(r.number, '') || ' (deduit de la facture de l''OR)',
          0, 0, 21, 0, 0, 0, 0, 'texte');
  -- Numero : celui de l'OR (le client le reconnait sur la facture d'acompte) ; repli sur la serie BC.
  _number := r.number;
  if _number is null or exists (select 1 from public.documents where company_id = r.company_id and number = _number) then
    _number := public.next_document_number(r.company_id, 'BC');
  end if;
  update public.documents set status = 'validee', number = _number where id = _doc;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (r.company_id, auth.uid(), 'repair_order_deposit_document', 'repair_orders', r.id::text, 'screen',
          jsonb_build_object('document_id', _doc, 'number', _number));
  return _doc;
end $$;
revoke all on function public.repair_order_deposit_document(uuid) from public, anon;
grant execute on function public.repair_order_deposit_document(uuid) to authenticated;

-- Acompte net d'OR (liste des OR, impression) : reglements percus du BC, contre-passations deduites.
create or replace function public.repair_order_deposits(_ors uuid[])
returns table(repair_order_id uuid, document_id uuid, number text, status text, amount numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.repair_order_id, d.id, d.number, d.status, round(coalesce(sum(p.amount) filter (where p.status = 'recu'), 0), 2)
    from public.documents d
    left join public.document_payments p on p.document_id = d.id
   where d.repair_order_id = any(_ors) and d.doc_type = 'BC' and d.status <> 'annulee'
     and public.is_member(d.company_id)
   group by d.repair_order_id, d.id, d.number, d.status;
$$;
revoke all on function public.repair_order_deposits(uuid[]) from public, anon;
grant execute on function public.repair_order_deposits(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Facture finale de l'OR validee : report des acomptes (meme report qu'une conversion de vente)
-- ---------------------------------------------------------------------
create or replace function public.trg_documents_repair_order_deposit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.documents%rowtype; p record; _n int := 0; _skipped jsonb := '[]'::jsonb; _total numeric := 0;
begin
  if new.doc_type <> 'FAC' or new.repair_order_id is null or new.status not in ('validee', 'payee') then return null; end if;
  if tg_op = 'UPDATE' and old.status not in ('brouillon') then return null; end if;
  select * into c from public.documents
   where repair_order_id = new.repair_order_id and doc_type = 'BC' and status not in ('annulee', 'converti')
   order by created_at limit 1 for update;
  if not found then return null; end if;

  if c.contact_id is distinct from new.contact_id then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
    values (new.company_id, auth.uid(), 'repair_order_deposit_not_transferred', 'documents', new.id::text, 'system',
            jsonb_build_object('reason', 'client_different', 'deposit_document_id', c.id, 'invoice_id', new.id));
    return null;
  end if;

  for p in
    select x.* from public.document_payments x
     where x.document_id = c.id and x.status = 'recu' and x.amount > 0 and x.reversal_of is null
       and not exists (select 1 from public.document_payments y where y.reversal_of = x.id)
     order by x.paid_at
  loop
    if p.method in ('BA', 'AVO') then
      _skipped := _skipped || jsonb_build_object('payment_id', p.id, 'method', p.method, 'amount', p.amount);
      continue;
    end if;
    insert into public.document_payments (document_id, method, amount, status, paid_at, note, from_financing,
                                          transferred_from, deposit_invoice_id)
    values (new.id, p.method, p.amount, 'recu', p.paid_at, 'Acompte reporte OR ' || coalesce(c.number, ''), coalesce(p.from_financing, false),
            p.id, coalesce(p.deposit_invoice_id, public._deposit_invoice_for_payment(p.id)));
    _n := _n + 1; _total := _total + p.amount;
  end loop;
  if _n > 0 then perform public.recompute_document_paid(new.id); end if;
  update public.documents set status = 'converti' where id = c.id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (new.company_id, auth.uid(), 'repair_order_deposit_transferred', 'documents', new.id::text, 'system',
          jsonb_build_object('deposit_document_id', c.id, 'repair_order_id', new.repair_order_id, 'payments', _n,
                             'amount', round(_total, 2), 'skipped', _skipped));
  return null;
end $$;
revoke all on function public.trg_documents_repair_order_deposit() from public, anon, authenticated;
drop trigger if exists trg_documents_repair_order_deposit on public.documents;
create trigger trg_documents_repair_order_deposit after insert or update of status on public.documents
  for each row execute function public.trg_documents_repair_order_deposit();
