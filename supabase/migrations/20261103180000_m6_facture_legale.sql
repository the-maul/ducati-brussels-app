-- M6 / M12 — Facture belge conforme (03/11/2026, VEN006, M12) : avoir, facture d acompte,
-- journal des ventes juste, UBL pret pour Peppol.
--
-- Etude : docs/etudes/2026-11-facturation-peppol-compta.md (§3 lignes 3, 9, 10 ; §4 ; point 7 bug avoir).
-- Decision du client (Simon, 03/11/2026) : « Integre deja tout ce que tu peux sans validation ».
--
-- Ce que pose cette migration :
--   1. BUG COMPTA : une facture annulee par un avoir sortait du journal des ventes, du registre TVA et
--      des ecritures (`status <> 'annulee'`) alors que l avoir negatif y restait : double deduction.
--      Desormais `generateCreditNote` passe la facture en `avoir_emis` (avoir total) ou la laisse telle
--      quelle (avoir partiel) ; la facture reste au facturier, l avoir la compense (AR 1 art. 12).
--      Donnees existantes corrigees (script idempotent, trace `events` action `credit_note_fix`).
--      Un avoir regle la facture (« reglement par avoir », mode `AVO`, jamais de tresorerie).
--      Garde-fou en base (`trg_documents_credit_keeps_invoice`) : tout autre chemin qui annulerait une
--      facture compensee par un avoir (remboursement Shopify) la passe en `avoir_emis`.
--   2. FACTURE D ACOMPTE `FAA-AAAA-NNNNN` (serie par societe) : TVA exigible a l encaissement
--      (CTVA art. 17 §1 al. 3 ; AR 1 art. 1 et 4) ; generee automatiquement des qu un acompte est
--      encaisse sur une RES / un BC / un devis pour une moto ou pour un client avec n° TVA
--      (`deposit_invoice_create`, declencheur jamais bloquant) ; sur demande sinon (bouton).
--      La facture finale reporte le reglement avec `deposit_invoice_id` : journal, registre TVA et
--      ecritures deduisent l acompte deja facture (`PrepaidAmount`, pas de TVA refacturee).
--   3. Rappel « a facturer avant le 15 du mois suivant » dans la cloche (`deposit_invoice_due`)
--      quand l automatisme n a pas pu jouer.
--   4. Fiche societe : n° BCE (`company_number`), RPM (`rpm`), adresse du comptable en copie
--      (`accountant_email`, vide par defaut). L export UBL exige le n° BCE et l identifiant Peppol `0208:`.
--   5. Compte 460000 « Acomptes recus sur commandes » + mapping `deposit` (avis CNC compte 46).
--
--   6. Seuls les documents VALIDES comptent : brouillons et documents annules exclus du journal des
--      ventes, du registre TVA et des ecritures (le registre TVA comptait les brouillons, M12 §7).
--
-- A APPLIQUER APRES 20261103160000_m6_tva_marge_a_la_vente.sql (lot TVA marge, ef3f953) : reprend sa
-- definition de `vat_register` (date de bascule, documents en marge exclus) et de
-- `generate_sales_entries` (compte « ventes marge » sans TVA), et redefinit `vo_margin_register`
-- pour qu une vente en marge compensee par un avoir (`avoir_emis`) reste au registre de la marge.
-- Ne touche pas a la caisse (`cash_*`, sessions, Z).
--
-- NON APPLIQUEE le 03/11/2026 (regle du lot : aucune migration en prod sans accord). Commande :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103180000_m6_facture_legale.sql
-- Essai a blanc : le meme fichier entoure de `begin;` / `rollback;`.

-- ---------------------------------------------------------------------
-- 1. Colonnes et series
-- ---------------------------------------------------------------------
alter table public.companies add column if not exists company_number text;
comment on column public.companies.company_number is 'N° BCE (10 chiffres, sans BE) : identifiant Peppol 0208 du vendeur, mention obligatoire (CSA art. 2:20).';
alter table public.companies add column if not exists rpm text;
comment on column public.companies.rpm is 'RPM et tribunal de l entreprise (ex. « RPM Brabant wallon ») : mention CSA art. 2:20 sur les factures.';
alter table public.companies add column if not exists accountant_email text;
comment on column public.companies.accountant_email is 'Adresse du comptable mise en copie des factures et avoirs envoyes par e-mail (vide = pas de copie).';

-- FAA → reglement d acompte qui l a declenchee (sur la RES / le BC / le devis).
alter table public.documents add column if not exists deposit_payment_id uuid references public.document_payments(id) on delete set null;
create index if not exists idx_documents_deposit_payment on public.documents(deposit_payment_id) where deposit_payment_id is not null;
comment on column public.documents.deposit_payment_id is 'Facture d acompte (FAA) : reglement d acompte facture.';

-- Reglement reporte sur la facture finale → facture d acompte deja emise (deduite, PrepaidAmount).
alter table public.document_payments add column if not exists deposit_invoice_id uuid references public.documents(id) on delete set null;
create index if not exists idx_docpay_deposit_invoice on public.document_payments(deposit_invoice_id) where deposit_invoice_id is not null;
comment on column public.document_payments.deposit_invoice_id is 'Acompte reporte depuis une RES / un BC : facture d acompte (FAA) qui le couvre, deduite de la facture finale.';

-- Serie FAA par societe (prefixe par defaut, reglable dans Parametres → Numerotation).
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, 'FAA', 'FAA', 'Facture d acompte' from public.companies c
on conflict (company_id, doc_type) do nothing;

-- Mode de reglement technique « AVO » : facture reglee par un avoir (lettrage, pas de tresorerie).
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select distinct rv.company_id, 'payment_method', 'AVO', 'Regle par avoir', 91, true, '{"visible_pos": false}'::jsonb
  from public.reference_values rv
 where rv.table_key = 'payment_method'
on conflict (company_id, table_key, code) do nothing;

-- Compte 46 « Acomptes recus sur commandes » (avis CNC) + mapping dimension `deposit`.
insert into public.chart_of_accounts (company_id, code, label, kind)
select c.id, '460000', 'Acomptes recus sur commandes', 'general' from public.companies c
on conflict (company_id, code) do nothing;
insert into public.account_mappings (company_id, dimension, match_key, account_code, journal_code)
select c.id, 'deposit', '*', '460000', 'VEN' from public.companies c
on conflict (company_id, dimension, match_key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Statut `avoir_emis` : fige comme `annulee` (le montant regle ne change plus le statut).
-- ---------------------------------------------------------------------
create or replace function public.recompute_document_paid(_document uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _paid numeric; _ttc numeric; _company uuid; _status text;
begin
  select company_id, total_ttc, status into _company, _ttc, _status from public.documents where id = _document;
  if _company is null then raise exception 'Document introuvable'; end if;
  if not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  select coalesce(sum(amount), 0) into _paid
    from public.document_payments where document_id = _document and status = 'recu';

  update public.documents
    set paid_amount = _paid,
        status = case
          when status in ('annulee', 'avoir_emis', 'converti') then status
          when _paid + 0.005 >= _ttc and _ttc > 0 then 'payee'
          when status = 'payee' and _paid + 0.005 < _ttc then 'validee'
          else status
        end
    where id = _document;
end $$;
grant execute on function public.recompute_document_paid(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Donnees existantes : facture `annulee` par un avoir valide → `avoir_emis` (idempotent, trace).
-- ---------------------------------------------------------------------
do $do$
declare r record; _n int := 0;
begin
  for r in
    select d.id, d.company_id, d.number, d.status, a.number as credit_number
      from public.documents d
      join lateral (
        select a.number from public.documents a
         where a.source_document_id = d.id and a.doc_type = 'AVO' and a.status not in ('brouillon', 'annulee')
         order by a.created_at desc limit 1
      ) a on true
     where d.doc_type in ('FAC', 'TIK') and d.status = 'annulee'
  loop
    update public.documents set status = 'avoir_emis' where id = r.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, null, 'credit_note_fix', 'documents', r.id::text, 'system',
            jsonb_build_object('status', 'annulee'),
            jsonb_build_object('status', 'avoir_emis', 'credit_note', r.credit_number,
                               'reason', 'Facture compensee par un avoir : elle reste au journal des ventes (migration 20261103180000)'));
    _n := _n + 1;
  end loop;
  raise notice 'Factures annulees par un avoir remises au journal (avoir_emis) : %', _n;
end $do$;

-- Garde-fou pour les autres chemins (remboursement Shopify `_shopify_order_apply`, anciens ecrans) :
-- une facture / un ticket qu un avoir valide compense ne passe plus jamais en `annulee`, mais en
-- `avoir_emis` (reste au journal des ventes), avec la meme trace que la correction ci-dessus.
create or replace function public.trg_documents_credit_keeps_invoice()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _credit text;
begin
  if new.status = 'annulee' and old.status is distinct from 'annulee' and new.doc_type in ('FAC', 'TIK', 'FAA') then
    select a.number into _credit from public.documents a
     where a.source_document_id = new.id and a.doc_type = 'AVO' and a.status not in ('brouillon', 'annulee')
     order by a.created_at desc limit 1;
    if found then
      new.status := 'avoir_emis';
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (new.company_id, auth.uid(), 'credit_note_fix', 'documents', new.id::text, 'system',
              jsonb_build_object('status', old.status),
              jsonb_build_object('status', 'avoir_emis', 'credit_note', _credit,
                                 'reason', 'Facture compensee par un avoir : elle reste au journal des ventes'));
    end if;
  end if;
  return new;
end $$;
revoke all on function public.trg_documents_credit_keeps_invoice() from public, anon, authenticated;
drop trigger if exists trg_documents_credit_keeps_invoice on public.documents;
create trigger trg_documents_credit_keeps_invoice
  before update of status on public.documents
  for each row execute function public.trg_documents_credit_keeps_invoice();

-- ---------------------------------------------------------------------
-- 4. Facture d acompte : creation (FAA), condition d automatisme, declencheur jamais bloquant.
-- ---------------------------------------------------------------------

-- L acompte doit-il etre facture automatiquement ? Moto sur le document (fiche ou ligne V/O/P/D)
-- ou client avec n° TVA (AR 1 art. 1 ; etude §3 ligne 9). Particulier sans moto : sur demande.
create or replace function public._deposit_invoice_required(_document uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.documents d
    left join public.contacts c on c.id = d.contact_id
    where d.id = _document
      and (d.vehicle_id is not null
           or nullif(btrim(coalesce(c.vat_number, '')), '') is not null
           or exists (select 1 from public.document_lines l join public.articles a on a.id = l.article_id
                       where l.document_id = d.id and a.mgmt_type in ('V', 'O', 'P', 'D')))
  );
$$;
revoke all on function public._deposit_invoice_required(uuid) from public, anon;
grant execute on function public._deposit_invoice_required(uuid) to authenticated, service_role;

-- Facture d acompte existante pour un reglement (null sinon).
create or replace function public._deposit_invoice_for_payment(_payment uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select f.id from public.documents f
   where f.deposit_payment_id = _payment and f.doc_type = 'FAA' and f.status not in ('brouillon', 'annulee')
   order by f.created_at desc limit 1;
$$;
revoke all on function public._deposit_invoice_for_payment(uuid) from public, anon;
grant execute on function public._deposit_invoice_for_payment(uuid) to authenticated, service_role;

-- Cree la facture d acompte d un reglement percu sur une RES / un BC / un devis.
-- Une ligne « Acompte sur commande n° … du … », TVA au taux principal du document (0 % si detaxe),
-- numero FAA de la societe, reglement recopie (la FAA est payee), filiation `source_document_id`.
create or replace function public.deposit_invoice_create(_payment uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.document_payments%rowtype;
  d public.documents%rowtype;
  _existing uuid;
  _rate numeric := 21;
  _ttc numeric; _ht numeric; _vat numeric;
  _number text; _faa uuid; _label text; _lang text;
begin
  select * into p from public.document_payments where id = _payment;
  if not found then raise exception 'Reglement introuvable' using errcode = 'P0002'; end if;
  select * into d from public.documents where id = p.document_id;
  if not public.is_member(d.company_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if d.doc_type not in ('RES', 'BC', 'DEV') then
    raise exception 'Une facture d acompte ne se fait que sur une reservation, un bon de commande ou un devis.' using errcode = '23514';
  end if;
  if d.status in ('brouillon', 'annulee', 'converti') or d.contact_id is null then
    raise exception 'Document ferme ou sans client : pas de facture d acompte.' using errcode = '23514';
  end if;
  if p.status <> 'recu' or p.amount <= 0 or p.from_financing then
    raise exception 'Seul un acompte percu du client se facture.' using errcode = '23514';
  end if;
  _existing := public._deposit_invoice_for_payment(_payment);
  if _existing is not null then return _existing; end if;

  -- Taux principal du document (base HT la plus elevee), 21 % a defaut ; detaxe → 0 %.
  if d.tax_exempt then
    _rate := 0;
  else
    select l.vat_rate into _rate from public.document_lines l
     where l.document_id = d.id and l.line_ht <> 0
     group by l.vat_rate order by sum(l.line_ht) desc limit 1;
    _rate := coalesce(_rate, 21);
  end if;
  _ttc := round(p.amount, 2);
  _ht := round(_ttc / (1 + _rate / 100), 2);
  _vat := round(_ttc - _ht, 2);
  _label := 'Acompte sur commande n° ' || coalesce(d.number, '—') || ' du ' || to_char(d.issue_date, 'DD/MM/YYYY');

  -- Meme ordre que l application : en-tete en brouillon sans numero → ligne → numero + statut
  -- (les garde-fous en base refusent une ligne sur un document deja valide et un document valide sans ligne).
  insert into public.documents (company_id, doc_type, number, status, contact_id, vehicle_id, issue_date, due_date,
                                total_ht, total_vat, total_ttc, paid_amount, notes, source_document_id, deposit_payment_id,
                                price_mode, tax_exempt, condition_reglement)
  -- Date d emission = aujourd hui ; la date de l encaissement (reglement recopie) est imprimee a cote (AR 1 art. 5 §1 5°).
  values (d.company_id, 'FAA', null, 'brouillon', d.contact_id, d.vehicle_id, public._brussels_today(), public._brussels_today(),
          _ht, _vat, _ttc, 0, null, d.id, p.id, d.price_mode, d.tax_exempt, null)
  returning id into _faa;

  insert into public.document_lines (document_id, designation, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order, line_type)
  values (_faa, _label, 1, _ht, _rate, 0, _ht, _ttc, 0, 'article');

  _number := public.next_document_number(d.company_id, 'FAA');
  update public.documents set status = 'validee', number = _number where id = _faa;

  -- Le reglement d acompte solde la facture d acompte (meme mode, meme date). Ce n est pas un nouvel
  -- encaissement : avec la caisse legale (20261103170000) il est marque `transferred_from` (hors Z,
  -- hors plafond especes, comme un acompte reporte) ; sans elle, insertion simple.
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'document_payments' and column_name = 'transferred_from') then
    execute 'insert into public.document_payments (document_id, method, amount, status, paid_at, note, from_financing, transferred_from)
             values ($1, $2, $3, ''recu'', $4, $5, false, $6)'
      using _faa, p.method, _ttc, p.paid_at, 'Acompte ' || coalesce(d.number, ''), p.id;
  else
    insert into public.document_payments (document_id, method, amount, status, paid_at, note, from_financing)
    values (_faa, p.method, _ttc, 'recu', p.paid_at, 'Acompte ' || coalesce(d.number, ''), false);
  end if;
  perform public.recompute_document_paid(_faa);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (d.company_id, auth.uid(), 'deposit_invoice', 'documents', _faa::text, 'screen',
          jsonb_build_object('number', _number, 'source', d.number, 'payment_id', p.id, 'amount', _ttc, 'vat_rate', _rate));
  return _faa;
end $$;
revoke all on function public.deposit_invoice_create(uuid) from public, anon;
grant execute on function public.deposit_invoice_create(uuid) to authenticated;

-- Automatisme : acompte percu (insert ou passage « recu ») → facture d acompte si la loi l impose.
-- Jamais bloquant : si la FAA ne peut pas etre creee (sequence, droits…), le reglement est garde et
-- la cloche rappellera « a facturer avant le 15 » (fonction _sales_deposit_invoice_alert).
create or replace function public.trg_deposit_invoice_auto()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _type text; _status text;
begin
  if new.status <> 'recu' or new.amount <= 0 or new.from_financing or new.deposit_invoice_id is not null then return null; end if;
  if tg_op = 'UPDATE' and old.status = 'recu' then return null; end if;
  if auth.uid() is null then return null; end if;   -- fonctions serveur : rien d automatique
  select doc_type, status into _type, _status from public.documents where id = new.document_id;
  if _type not in ('RES', 'BC', 'DEV') or _status in ('brouillon', 'annulee', 'converti') then return null; end if;
  if not public._deposit_invoice_required(new.document_id) then return null; end if;
  begin
    perform public.deposit_invoice_create(new.id);
  exception when others then
    raise warning 'trg_deposit_invoice_auto: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.trg_deposit_invoice_auto() from public, anon, authenticated;
drop trigger if exists trg_document_payments_deposit_invoice on public.document_payments;
create trigger trg_document_payments_deposit_invoice
  after insert or update of status on public.document_payments
  for each row execute function public.trg_deposit_invoice_auto();

-- ---------------------------------------------------------------------
-- 5. Journal des ventes, registre TVA, ecritures : FAC + TIK + AVO + FAA ; `annulee` seule exclue ;
--    acomptes deja factures (FAA) deduits de la facture finale.
-- ---------------------------------------------------------------------
drop function if exists public.sales_journal(uuid, date, date);
create function public.sales_journal(_company uuid, _from date, _to date)
returns table(document_id uuid, number text, doc_type text, status text, issue_date date, contact_id uuid,
  total_ht numeric, total_vat numeric, total_ttc numeric, paid_amount numeric,
  prepaid_ht numeric, prepaid_vat numeric, prepaid_ttc numeric, source_number text)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.number, d.doc_type, d.status, d.issue_date, d.contact_id, d.total_ht, d.total_vat, d.total_ttc, d.paid_amount,
         coalesce(pre.ht, 0), coalesce(pre.vat, 0), coalesce(pre.ttc, 0), s.number
  from public.documents d
  left join public.documents s on s.id = d.source_document_id
  left join lateral (
    select round(sum(a.total_ht), 2) as ht, round(sum(a.total_vat), 2) as vat, round(sum(a.total_ttc), 2) as ttc
    from public.document_payments p join public.documents a on a.id = p.deposit_invoice_id
    where p.document_id = d.id and d.doc_type = 'FAC' and a.doc_type = 'FAA'
  ) pre on true
  where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
    and d.doc_type in ('FAC', 'TIK', 'AVO', 'FAA') and d.status not in ('annulee', 'brouillon')
    and d.issue_date >= _from and d.issue_date <= _to
  order by d.issue_date, d.number;
$$;
grant execute on function public.sales_journal(uuid, date, date) to authenticated;

create or replace function public.vat_register(_company uuid, _from date, _to date)
returns table(vat_rate numeric, base_ht numeric, vat numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with cutoff as (select greatest(_from, public._accounting_cutover(_company)) as f),
  -- Meme base que 20261103160000 (date de bascule ; documents en marge exclus : registre de la marge).
  detailed as (   -- documents valides avec lignes : ventilation par taux de ligne (FAA comprises)
    select l.vat_rate as rate, sum(l.line_ht) as base, sum(l.line_ttc - l.line_ht) as vat
    from public.document_lines l
    join public.documents d on d.id = l.document_id, cutoff
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC', 'TIK', 'AVO', 'FAA') and d.status not in ('annulee', 'brouillon')
      and d.vat_scheme <> 'marge'
      and d.issue_date between cutoff.f and _to
    group by l.vat_rate
  ),
  prepaid as (    -- acomptes deja factures (FAA) repris par une facture finale de la periode : deduits
    select l.vat_rate as rate, -sum(l.line_ht) as base, -sum(l.line_ttc - l.line_ht) as vat
    from public.documents f
    join public.document_payments p on p.document_id = f.id and p.deposit_invoice_id is not null
    join public.documents a on a.id = p.deposit_invoice_id and a.doc_type = 'FAA'
    join public.document_lines l on l.document_id = a.id, cutoff
    where f.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and f.doc_type = 'FAC' and f.status not in ('annulee', 'brouillon') and f.vat_scheme <> 'marge'
      and f.issue_date between cutoff.f and _to
    group by l.vat_rate
  ),
  header_only as (   -- factures migrees (sans lignes) : taux effectif depuis l en-tete
    select case when abs(d.total_ht) > 0 then round(d.total_vat / d.total_ht * 100) else 0 end as rate,
           sum(d.total_ht) as base, sum(d.total_vat) as vat
    from public.documents d, cutoff
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.doc_type in ('FAC', 'TIK', 'AVO', 'FAA') and d.status not in ('annulee', 'brouillon')
      and d.vat_scheme <> 'marge'
      and d.issue_date between cutoff.f and _to
      and not exists (select 1 from public.document_lines l where l.document_id = d.id)
    group by 1
  )
  select rate, round(sum(base), 2), round(sum(vat), 2)
  from (select * from detailed union all select * from prepaid union all select * from header_only) u
  group by rate order by rate;
$$;
grant execute on function public.vat_register(uuid, date, date) to authenticated;

-- Ecritures de vente (documents valides seulement) : FAA = client / compte 46 (mapping `deposit`) / TVA ;
-- facture finale = vente complete puis contre-passation des acomptes factures (46 et TVA au debit,
-- client au credit) ; vente en marge = compte « ventes marge » TTC sans 451 (20261103160000).
create or replace function public.generate_sales_entries(_company uuid, _from date, _to date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d record; b record; _entry uuid; _ln int; _rev boolean;
  _cust_acct text; _cust_aux text;
  _sum_ht numeric; _sum_vat numeric; _res_ht numeric; _res_vat numeric; _count int := 0;
  _dep_acct text; _pre_ttc numeric; _marge_acct text;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  _cust_acct := coalesce(public.resolve_account(_company, 'customer_collective', '*'), '400000');
  _dep_acct := coalesce(public.resolve_account(_company, 'deposit', '*'), '460000');
  _marge_acct := coalesce(public.resolve_account(_company, 'sales_margin', '*'), '700200');

  for d in
    select doc.id, doc.doc_type, doc.number, doc.issue_date, doc.contact_id, doc.vat_scheme,
           abs(doc.total_ht) ht, abs(doc.total_vat) vat, abs(doc.total_ttc) ttc
    from public.documents doc
    where doc.company_id = _company and doc.doc_type in ('FAC', 'TIK', 'AVO', 'FAA')
      and doc.status not in ('annulee', 'brouillon') and doc.issue_date between _from and _to
      and not exists (select 1 from public.accounting_entries e
                      where e.company_id = _company and e.source = 'sales' and e.source_id = doc.id::text)
  loop
    if d.ttc = 0 then continue; end if;
    _rev := (d.doc_type = 'AVO');
    select coalesce(nullif(account_code, ''), _cust_acct) into _cust_aux from public.contacts where id = d.contact_id;
    _cust_aux := coalesce(_cust_aux, _cust_acct);

    insert into public.accounting_entries (company_id, journal_code, entry_date, doc_type, doc_number, source, source_id, label)
    values (_company, coalesce(public.resolve_journal(_company, 'sales', '*'), 'VEN'), d.issue_date, d.doc_type, d.number, 'sales', d.id::text,
            case when d.doc_type = 'FAA' then 'Acompte ' when d.vat_scheme = 'marge' then 'Vente marge ' else 'Vente ' end || coalesce(d.number, d.id::text))
    returning id into _entry;
    _ln := 0;

    insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, auxiliary_code, debit, credit, label)
    values (_entry, _ln, _cust_acct, public._account_label(_company, _cust_acct), _cust_aux,
            case when _rev then 0 else d.ttc end, case when _rev then d.ttc else 0 end, 'Client ' || coalesce(d.number, ''));
    _ln := _ln + 1;

    _sum_ht := 0; _sum_vat := 0;
    for b in
      select case when d.doc_type = 'FAA' then _dep_acct
                  when d.vat_scheme = 'marge' then _marge_acct
                  else coalesce(public.resolve_account(_company, 'sales', a.category_id::text), '700000') end as sales_acct,
             l.vat_rate as rate,
             round(sum(abs(l.line_ht)), 2) as ht,
             round(sum(abs(l.line_ttc - l.line_ht)), 2) as vat
      from public.document_lines l
      left join public.articles a on a.id = l.article_id
      where l.document_id = d.id
      group by 1, 2
    loop
      if b.ht <> 0 then
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, vat_rate, label)
        values (_entry, _ln, b.sales_acct, public._account_label(_company, b.sales_acct),
                case when _rev then b.ht else 0 end, case when _rev then 0 else b.ht end,
                case when d.vat_scheme = 'marge' then null else b.rate end,
                case when d.doc_type = 'FAA' then 'Acompte HT' when d.vat_scheme = 'marge' then 'Vente marge TTC (art. 58 §4)' else 'Vente HT' end);
        _ln := _ln + 1; _sum_ht := _sum_ht + b.ht;
      end if;
      if b.vat <> 0 then
        declare _vacct text := coalesce(public.resolve_account(_company, 'vat_collected', b.rate::text), '451000');
        begin
          insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, vat_rate, label)
          values (_entry, _ln, _vacct, public._account_label(_company, _vacct),
                  case when _rev then b.vat else 0 end, case when _rev then 0 else b.vat end, b.rate, 'TVA collectée');
          _ln := _ln + 1; _sum_vat := _sum_vat + b.vat;
        end;
      end if;
    end loop;

    _res_ht := round(d.ht - _sum_ht, 2);
    _res_vat := round(d.vat - _sum_vat, 2);
    if abs(_res_ht) >= 0.01 then
      declare _sa text := case when d.vat_scheme = 'marge' then _marge_acct else coalesce(public.resolve_account(_company, 'sales', '*'), '700000') end;
      begin
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
        values (_entry, _ln, _sa, public._account_label(_company, _sa),
                case when (_rev) = (_res_ht >= 0) then abs(_res_ht) else 0 end,
                case when (_rev) = (_res_ht >= 0) then 0 else abs(_res_ht) end, 'Port / remise / arrondi');
        _ln := _ln + 1;
      end;
    end if;
    if abs(_res_vat) >= 0.01 then
      declare _va text := coalesce(public.resolve_account(_company, 'vat_collected', '*'), '451000');
      begin
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
        values (_entry, _ln, _va, public._account_label(_company, _va),
                case when (_rev) = (_res_vat >= 0) then abs(_res_vat) else 0 end,
                case when (_rev) = (_res_vat >= 0) then 0 else abs(_res_vat) end, 'TVA — arrondi');
        _ln := _ln + 1;
      end;
    end if;

    -- Facture finale : contre-passation des acomptes deja factures (FAA reportees).
    if d.doc_type = 'FAC' then
      _pre_ttc := 0;
      for b in
        select a.number as faa_number, l.vat_rate as rate,
               round(sum(l.line_ht), 2) as ht, round(sum(l.line_ttc - l.line_ht), 2) as vat, round(sum(l.line_ttc), 2) as ttc
        from public.document_payments p
        join public.documents a on a.id = p.deposit_invoice_id and a.doc_type = 'FAA'
        join public.document_lines l on l.document_id = a.id
        where p.document_id = d.id
        group by a.number, l.vat_rate
      loop
        if b.ht <> 0 then
          insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, vat_rate, label)
          values (_entry, _ln, _dep_acct, public._account_label(_company, _dep_acct), b.ht, 0, b.rate, 'Acompte facturé ' || coalesce(b.faa_number, ''));
          _ln := _ln + 1;
        end if;
        if b.vat <> 0 then
          declare _vacct2 text := coalesce(public.resolve_account(_company, 'vat_collected', b.rate::text), '451000');
          begin
            insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, vat_rate, label)
            values (_entry, _ln, _vacct2, public._account_label(_company, _vacct2), b.vat, 0, b.rate, 'TVA déjà due sur acompte ' || coalesce(b.faa_number, ''));
            _ln := _ln + 1;
          end;
        end if;
        _pre_ttc := _pre_ttc + b.ttc;
      end loop;
      if _pre_ttc <> 0 then
        insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, auxiliary_code, debit, credit, label)
        values (_entry, _ln, _cust_acct, public._account_label(_company, _cust_acct), _cust_aux, 0, _pre_ttc, 'Acomptes déjà facturés');
        _ln := _ln + 1;
      end if;
    end if;
    _count := _count + 1;
  end loop;
  return _count;
end $$;
grant execute on function public.generate_sales_entries(uuid, date, date) to authenticated;

-- Ecritures de reglement : FAA comprises ; un reglement reporte deja facture en acompte (deposit_invoice_id)
-- et un reglement par avoir (mode AVO) ne passent pas en tresorerie.
create or replace function public.generate_payment_entries(_company uuid, _from date, _to date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; _entry uuid; _treas text; _journ text; _cust_acct text; _aux text; _amt numeric; _count int := 0;
begin
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;
  _cust_acct := coalesce(public.resolve_account(_company, 'customer_collective', '*'), '400000');

  for p in
    select pay.id, pay.method, pay.amount, pay.paid_at::date as pdate, doc.number, doc.contact_id
    from public.document_payments pay
    join public.documents doc on doc.id = pay.document_id
    where doc.company_id = _company and pay.status = 'recu'
      and doc.doc_type in ('FAC', 'TIK', 'AVO', 'FAA') and pay.amount <> 0
      and pay.deposit_invoice_id is null and pay.method <> 'AVO'
      and pay.paid_at::date between _from and _to
      and not exists (select 1 from public.accounting_entries e
                      where e.company_id = _company and e.source = 'payment' and e.source_id = pay.id::text)
  loop
    _treas := coalesce(public.resolve_account(_company, 'payment', p.method), public.resolve_account(_company, 'payment', '*'), '550000');
    _journ := coalesce(public.resolve_journal(_company, 'payment', p.method), public.resolve_journal(_company, 'payment', '*'), 'FIN');
    select coalesce(nullif(account_code, ''), _cust_acct) into _aux from public.contacts where id = p.contact_id;
    _aux := coalesce(_aux, _cust_acct);
    _amt := abs(p.amount);

    insert into public.accounting_entries (company_id, journal_code, entry_date, doc_type, doc_number, source, source_id, label)
    values (_company, _journ, p.pdate, 'RGT', p.number, 'payment', p.id::text, 'Règlement ' || coalesce(p.number, ''))
    returning id into _entry;

    insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, debit, credit, label)
    values (_entry, 0, _treas, public._account_label(_company, _treas),
            case when p.amount > 0 then _amt else 0 end, case when p.amount > 0 then 0 else _amt end, 'Trésorerie ' || p.method);
    insert into public.accounting_entry_lines (entry_id, line_no, account_code, account_label, auxiliary_code, debit, credit, label)
    values (_entry, 1, _cust_acct, public._account_label(_company, _cust_acct), _aux,
            case when p.amount > 0 then 0 else _amt end, case when p.amount > 0 then _amt else 0 end, 'Client ' || coalesce(p.number, ''));
    _count := _count + 1;
  end loop;
  return _count;
end $$;
grant execute on function public.generate_payment_entries(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 5 bis. Registre de la marge (20261103160000) : une vente en marge compensee par un avoir garde sa
--        place (statut `avoir_emis` desormais, `annulee` + avoir pour l historique), l avoir aussi ;
--        brouillons exclus. Definition reprise a l identique, seul le filtre de statut change.
-- ---------------------------------------------------------------------
drop function if exists public.vo_margin_register(uuid, date, date);
create function public.vo_margin_register(_company uuid, _from date, _to date)
returns table(
  sale_date date, doc_number text, doc_type text, document_id uuid, vehicle_id uuid, vin text,
  designation text, purchase_price numeric, sale_ttc numeric,
  margin numeric, vat_margin numeric, base_ht numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
  with rate as (select public._vat_margin_setting(_company, 'rate', '21')::numeric as r),
  sold as (
    select d.issue_date, d.number, d.doc_type, d.id as document_id, v.id as vehicle_id, v.vin, l.designation,
           case when count(*) over (partition by d.id) = 1
                then coalesce(d.margin_purchase_price, a.purchase_price, 0)
                else coalesce(a.purchase_price, 0) end as purchase_price,
           l.line_ttc as sale_ttc
    from public.document_lines l
    join public.documents d on d.id = l.document_id
    join public.articles a on a.id = l.article_id and a.mgmt_type = 'O'
    left join public.vehicles v on v.article_id = a.id
    where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
      and d.vat_scheme = 'marge'
      and l.quantity <> 0 and coalesce(l.line_type, 'article') not in ('texte', 'vide')
      and d.issue_date between _from and _to
      and (
        (d.doc_type in ('FAC', 'TIK') and (d.status in ('validee', 'payee', 'avoir_emis')
           or (d.status = 'annulee' and exists (select 1 from public.documents av
                 where av.source_document_id = d.id and av.doc_type = 'AVO' and av.status not in ('brouillon', 'annulee')))))
        or (d.doc_type = 'AVO' and d.status not in ('brouillon', 'annulee'))
      )
  )
  select s.issue_date, s.number, s.doc_type, s.document_id, s.vehicle_id, s.vin, s.designation,
         round(s.purchase_price, 2),
         round(s.sale_ttc, 2),
         round(sign(s.sale_ttc) * (abs(s.sale_ttc) - s.purchase_price), 2) as margin,
         round(case when sign(s.sale_ttc) * (abs(s.sale_ttc) - s.purchase_price) > 0
                    then (abs(s.sale_ttc) - s.purchase_price) * r.r / (100 + r.r) else 0 end, 2) as vat_margin,
         round(case when sign(s.sale_ttc) * (abs(s.sale_ttc) - s.purchase_price) > 0
                    then (abs(s.sale_ttc) - s.purchase_price) * 100 / (100 + r.r) else 0 end, 2) as base_ht
  from sold s, rate r
  order by s.issue_date, s.number;
$$;
revoke all on function public.vo_margin_register(uuid, date, date) from public, anon;
grant execute on function public.vo_margin_register(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Cloche : « facture d acompte a emettre avant le 15 du mois suivant » (automatisme non joue).
-- ---------------------------------------------------------------------
do $do$
declare _def text; _kinds text[];
begin
  select pg_get_constraintdef(c.oid) into _def from pg_constraint c
   where c.conrelid = 'public.team_notifications'::regclass and c.conname = 'team_notifications_kind_check';
  -- Types deja admis (contrainte si elle existe), types deja en base, types connus du code.
  select array_agg(distinct k order by k) into _kinds from (
    -- deux ecritures possibles de la contrainte : ARRAY['a'::text, ...] ou '{a,b}'::text[]
    select (regexp_matches(coalesce(_def, ''), '''([a-z_]+)''::text', 'g'))[1] as k
    union select btrim(unnest(string_to_array(substring(coalesce(_def, '') from '\{([^}]*)\}'), ',')), ' "')
    union select distinct kind from public.team_notifications
    union select 'signup' union select 'client_iban_changed' union select 'vehicle_declared'
    union select 'order_after_deposit' union select 'unpaid_balance' union select 'proposal_signed'
    union select 'web_order' union select 'maintenance_due'
    union select 'deposit_invoice_due') x where k is not null and k <> '';
  alter table public.team_notifications drop constraint if exists team_notifications_kind_check;
  execute format('alter table public.team_notifications add constraint team_notifications_kind_check '
                 'check (kind = any (%L::text[]))', _kinds);
end $do$;

create or replace function public.can_see_team_notification(_company uuid, _kind text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select case _kind
    when 'signup' then
         public.has_role(_company, 'admin') or public.has_role(_company, 'vendeur') or public.has_role(_company, 'marketing')
    when 'client_iban_changed' then
         public.has_role(_company, 'admin') or public.has_role(_company, 'comptable') or public.has_role(_company, 'vendeur')
    when 'vehicle_declared' then
         public.has_role(_company, 'admin') or public.has_role(_company, 'vendeur')
    when 'order_after_deposit' then public.has_role(_company, 'admin')
    when 'unpaid_balance' then public.has_role(_company, 'admin')
    when 'web_order' then
         public.has_role(_company, 'admin') or public.has_role(_company, 'vendeur')
    -- mission 07, carte 7 : entretien qui arrive ou depasse
    when 'maintenance_due' then
         public.has_role(_company, 'admin') or public.has_role(_company, 'vendeur')
         or public.has_role(_company, 'mecanicien') or public.has_role(_company, 'chef_atelier')
    -- Facture d acompte a emettre : administrateurs et comptable (+ le vendeur du document, target_user_id).
    when 'deposit_invoice_due' then public.has_role(_company, 'admin') or public.has_role(_company, 'comptable')
    else public.is_member(_company)
  end;
$fn$;
revoke all on function public.can_see_team_notification(uuid, text) from public, anon;
grant execute on function public.can_see_team_notification(uuid, text) to authenticated, service_role;

-- Une alerte par reglement d acompte non facture, des le 1er jour du mois suivant l encaissement.
create or replace function public._sales_deposit_invoice_alert(_payment uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.document_payments%rowtype; d public.documents%rowtype; _name text; _id uuid; _deadline date;
begin
  select * into p from public.document_payments where id = _payment;
  if not found or p.status <> 'recu' or p.amount <= 0 or p.from_financing then return false; end if;
  select * into d from public.documents where id = p.document_id;
  if d.doc_type not in ('RES', 'BC', 'DEV') or d.status in ('brouillon', 'annulee', 'converti') then return false; end if;
  if public._deposit_invoice_for_payment(_payment) is not null then return false; end if;
  if not public._deposit_invoice_required(d.id) then return false; end if;
  -- Delai legal : le 15 du mois qui suit l encaissement (AR 1 art. 4) ; rappel des le 1er.
  _deadline := (date_trunc('month', p.paid_at::date) + interval '1 month' + interval '14 days')::date;
  if public._brussels_today() < (date_trunc('month', p.paid_at::date) + interval '1 month')::date then return false; end if;
  select nullif(btrim(coalesce(nullif(btrim(c.company_name), ''),
           concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))), '')
    into _name from public.contacts c where c.id = d.contact_id;
  insert into public.team_notifications
    (company_id, kind, contact_id, document_id, target_user_id, title, payload, dedupe_key)
  values (d.company_id, 'deposit_invoice_due', d.contact_id, d.id, d.operator_user_id,
          left(coalesce(d.number, '—') || coalesce(' — ' || _name, ''), 200),
          jsonb_build_object('doc_type', d.doc_type, 'number', d.number, 'payment_id', p.id,
                             'amount', round(p.amount, 2), 'paid_at', p.paid_at::date, 'deadline', _deadline),
          p.id::text)
  on conflict (company_id, kind, dedupe_key) where dedupe_key is not null do nothing
  returning id into _id;
  return _id is not null;
end $$;
revoke all on function public._sales_deposit_invoice_alert(uuid) from public, anon, authenticated;

-- Alerte reglee des que la FAA existe ou que le document est converti / annule.
create or replace function public._sales_resolve_deposit_invoice_alerts()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare _n int;
begin
  update public.team_notifications n set resolved_at = now()
   where n.kind = 'deposit_invoice_due' and n.resolved_at is null
     and (public._deposit_invoice_for_payment((n.payload->>'payment_id')::uuid) is not null
          or exists (select 1 from public.documents d where d.id = n.document_id and d.status in ('annulee', 'converti'))
          or not exists (select 1 from public.document_payments p where p.id = (n.payload->>'payment_id')::uuid and p.status = 'recu'));
  get diagnostics _n = row_count;
  return _n;
end $$;
revoke all on function public._sales_resolve_deposit_invoice_alerts() from public, anon, authenticated;

create or replace function public._cron_sales_alerts()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  _dep int := 0;
  _unp int := 0;
  _res int := 0;
  _faa int := 0;
begin
  for r in select distinct n.document_id from public.team_notifications n
            where n.document_id is not null and n.resolved_at is null
              and n.kind in ('order_after_deposit', 'unpaid_balance') loop
    _res := _res + public._sales_resolve_alerts(r.document_id);
  end loop;
  for r in select d.id from public.documents d
            where d.doc_type in ('DEV', 'BC', 'RES') and d.status not in ('brouillon', 'annulee', 'converti')
              and exists (select 1 from public.document_payments p
                           where p.document_id = d.id and p.status = 'recu' and not p.from_financing and p.amount > 0) loop
    if public._sales_deposit_alert(r.id) then _dep := _dep + 1; end if;
  end loop;
  for r in select d.id from public.documents d
            where d.doc_type = 'FAC' and d.status not in ('brouillon', 'annulee', 'avoir_emis', 'converti')
              and d.due_date is not null and d.due_date < public._brussels_today()
              and d.total_ttc - coalesce(d.paid_amount, 0) > 0.005 loop
    if public._sales_unpaid_alert(r.id) then _unp := _unp + 1; end if;
  end loop;
  -- Factures d acompte a emettre (automatisme non joue) : rappel des le mois suivant l encaissement.
  _res := _res + public._sales_resolve_deposit_invoice_alerts();
  for r in select p.id from public.document_payments p
            join public.documents d on d.id = p.document_id
            where d.doc_type in ('DEV', 'BC', 'RES') and d.status not in ('brouillon', 'annulee', 'converti')
              and p.status = 'recu' and not p.from_financing and p.amount > 0
              and p.paid_at < date_trunc('month', public._brussels_today()::timestamp) loop
    if public._sales_deposit_invoice_alert(r.id) then _faa := _faa + 1; end if;
  end loop;
  return jsonb_build_object('order_after_deposit', _dep, 'unpaid_balance', _unp, 'deposit_invoice_due', _faa, 'resolved', _res);
end $$;
revoke all on function public._cron_sales_alerts() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Soldes a encaisser et alertes : une facture compensee par un avoir (`avoir_emis`) est reglee par
--    l avoir (reglement AVO, cf. write-api.ts) ; les fonctions existantes la voient donc a 0 du.
--    Rien a redefinir ici. Les statistiques M13 ignorent toujours les avoirs : voir la carte M12.
-- ---------------------------------------------------------------------
