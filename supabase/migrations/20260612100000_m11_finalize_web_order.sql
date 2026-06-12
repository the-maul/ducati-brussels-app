-- =====================================================================
-- M11/M6 — Finalisation d'une commande web payée (P0.1 « on ne simule plus »).
-- Appelée par l'Edge Function `stripe-webhook` (service role, sans JWT) après
-- vérification de la signature Stripe, OU par le marchand (bouton « marquer payée »).
--
-- Effets (idempotents) : commande → 'payee' ; génération d'une FACTURE (M6) avec
-- ventilation TVA par article ; conversion de la RÉSERVATION en SORTIE de stock réel
-- (append-only B4/B7) ; enregistrement du règlement. Le stock réel diminue, la facture
-- est liée à la commande. Re-rejouable sans effet de bord (retries Stripe).
--
-- Architecture : la logique métier vit dans cette RPC SECURITY DEFINER (testable par
-- POST/RPC direct sur la vraie DB) ; l'Edge Function ne fait que vérifier la signature
-- et appeler cette fonction.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Numérotation : helper INTERNE sans contrôle is_member, source unique du FORMAT
-- (préfixe/séparateur/padding/reset annuel paramétrés en M0). Le public
-- next_document_number garde le contrôle d'accès puis délègue ici. Permet aux
-- fonctions SECURITY DEFINER (webhook, sans JWT) de numéroter sans « Accès refusé ».
-- ---------------------------------------------------------------------
create or replace function public._next_document_number_unchecked(_company uuid, _doc_type text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seq public.document_sequences%rowtype;
  y   int := extract(year from now())::int;
  n   bigint;
  num text;
begin
  select * into seq from public.document_sequences
    where company_id = _company and doc_type = _doc_type
    for update;
  if not found then
    insert into public.document_sequences (company_id, doc_type, prefix, label)
      values (_company, _doc_type, upper(_doc_type), _doc_type)
      on conflict (company_id, doc_type) do nothing;
    select * into seq from public.document_sequences
      where company_id = _company and doc_type = _doc_type
      for update;
  end if;

  if seq.reset_yearly and (seq.current_year is distinct from y) then
    n := 1;
    update public.document_sequences set next_value = 2, current_year = y, updated_at = now() where id = seq.id;
  else
    n := seq.next_value;
    update public.document_sequences set next_value = next_value + 1, current_year = coalesce(current_year, y), updated_at = now() where id = seq.id;
  end if;

  num := lpad(n::text, seq.padding, '0');
  if seq.reset_yearly then
    return seq.prefix || seq.separator || y::text || seq.separator || num || coalesce(seq.suffix, '');
  else
    return seq.prefix || seq.separator || num || coalesce(seq.suffix, '');
  end if;
end $$;

-- Le public garde le garde-fou d'accès puis délègue le format au helper interne.
create or replace function public.next_document_number(_company uuid, _doc_type text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company;
  end if;
  return public._next_document_number_unchecked(_company, _doc_type);
end $$;
grant execute on function public.next_document_number(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- finalize_web_order : commande payée → facture + sortie de stock réel + règlement.
-- ---------------------------------------------------------------------
create or replace function public.finalize_web_order(_order uuid, _method text default 'CB')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o            public.web_orders%rowtype;
  _doc         uuid;
  _num         text;
  _l           record;
  _vat         numeric;
  _line_ht     numeric;
  _unit_ht     numeric;
  _tot_ht      numeric := 0;
  _tot_vat     numeric := 0;
  _tot_ttc     numeric := 0;
begin
  -- Verrou ligne : empêche le double traitement sous retries Stripe concurrents.
  select * into o from public.web_orders where id = _order for update;
  if not found then raise exception 'Commande web introuvable: %', _order; end if;

  -- Contrôle d'accès UNIQUEMENT pour un appel authentifié (marchand). Le webhook
  -- (service role, auth.uid() null) est autorisé à finaliser.
  if auth.uid() is not null and not public.is_member(o.company_id) then
    raise exception 'Accès refusé';
  end if;

  -- Idempotent : déjà finalisée → renvoyer la facture existante.
  if o.document_id is not null then return o.document_id; end if;
  if o.status = 'payee' then
    return (select document_id from public.web_orders where id = _order);
  end if;

  -- En-tête facture (numéro via le helper interne, format M0 par société).
  _num := public._next_document_number_unchecked(o.company_id, 'FAC');
  insert into public.documents (company_id, doc_type, number, status, issue_date, total_ht, total_vat, total_ttc, paid_amount, notes)
  values (o.company_id, 'FAC', _num, 'payee', current_date, 0, 0, 0, 0,
          'Commande e-shop ' || coalesce(o.number, _order::text))
  returning id into _doc;

  -- Lignes : prix client TTC → ventilation HT/TVA par taux de l'article (défaut 21).
  for _l in
    select wl.article_id, wl.designation, wl.quantity, wl.unit_price_ttc, wl.line_ttc,
           coalesce(a.vat_rate, 21) as vat_rate
    from public.web_order_lines wl
    left join public.articles a on a.id = wl.article_id
    where wl.order_id = _order
  loop
    _vat := _l.vat_rate;
    _line_ht := round(_l.line_ttc / (1 + _vat / 100.0), 2);
    _unit_ht := round(_l.unit_price_ttc / (1 + _vat / 100.0), 3);
    _tot_ht  := _tot_ht  + _line_ht;
    _tot_vat := _tot_vat + (_l.line_ttc - _line_ht);
    _tot_ttc := _tot_ttc + _l.line_ttc;

    insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, line_ht, line_ttc, sort_order)
    values (_doc, _l.article_id, _l.designation, _l.quantity, _unit_ht, _vat, _line_ht, _l.line_ttc, 0);

    -- Conversion de la réservation en sortie réelle (append-only B4/B7) :
    --  - libère la réservation posée à la commande (réservé −qty)
    --  - sort le stock réel (réel −qty)
    if _l.article_id is not null and _l.quantity > 0 then
      insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, origin, ref, note)
        values (o.company_id, _l.article_id, 'liberation', -abs(_l.quantity), true, 'eshop', coalesce(o.number, _order::text), 'Libération réservation (commande payée)');
      insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, origin, ref, note)
        values (o.company_id, _l.article_id, 'sortie', -abs(_l.quantity), false, 'eshop', coalesce(o.number, _order::text), 'Sortie e-shop (commande payée)');
    end if;
  end loop;

  -- Totaux figés (le TTC reste celui payé par le client).
  update public.documents set total_ht = _tot_ht, total_vat = _tot_vat, total_ttc = _tot_ttc, paid_amount = _tot_ttc where id = _doc;

  -- Règlement encaissé.
  insert into public.document_payments (document_id, method, amount, status, note)
    values (_doc, _method, _tot_ttc, 'recu', 'Paiement en ligne (Stripe)');

  -- Commande → payée + filiation facture.
  update public.web_orders set status = 'payee', document_id = _doc where id = _order;

  return _doc;
end $$;
-- Le webhook appelle via service_role ; le marchand via authenticated.
grant execute on function public.finalize_web_order(uuid, text) to authenticated, service_role;
