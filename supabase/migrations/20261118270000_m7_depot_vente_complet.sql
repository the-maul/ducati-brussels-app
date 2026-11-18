-- =====================================================================
-- M7 — DEPOT-VENTE COMPLET (rattrapage G8, 18/11/2026, lot-g8-depot-vente). VEN007, VEN008.
--
-- G8 (inventaire du 18/11/2026 : 03-vehicules.md « Creation / Vente d'un depot-vente »,
-- 09-parametres.md « Reprise / depot-vente », 06-ventes-caisse.md mouvements 02 / 03,
-- 08-compta-stats.md « Depots ventes », parcours 15 et 16) :
--   * fiche de depot : moto + VIN, deposant, prix demande, prix de vente TTC, prix minimum de
--     reserve, conditions, mention legale, frais de depot, n° livre de police, pro / particulier,
--     n° DEP automatique ;
--   * liste des depots (en cours / vendus / rendus), filtres n°, reference, immatriculation ;
--     voir les reparations ; retour client ; vendre ;
--   * vente : acquereur, commission (dont TVA), date de livraison prevue, encaissement ;
--     avoir automatique au nom du deposant (parametre) ;
--   * compta : compte d'entree depot-vente (classe 4), TVA commission, journal des commissions.
--
-- DECISION SIMON (18/11/2026) — parcours complet sur un seul ecran « Depot-vente » :
--   1. entree : fiche + n° DEP (sequence `DEP`, ecran Numerotation) + document imprimable +
--      check-list des documents remis ;
--   2. liste (en cours / vendus / rendus), filtres, reparations liees ;
--   3. vente : facture a l'acheteur, facture au deposant (commission + frais + reparations, TVA 21 %),
--      decompte, versement (mouvement de caisse « decaissement depot » ou virement), avoir option ;
--   4. retour client : moto rendue, sortie du parc, trace ;
--   5. ecritures exposees au lot export comptable (vue `consignment_accounting_entries`).
--
-- INVARIANT (glossaire, type D) : la moto N'ENTRE PAS en valorisation de stock. Elle entre en
-- stock (1 exemplaire, quantite seulement) SANS cout ; un garde-fou refuse desormais toute entree
-- valorisee d'un article D (B5 / B7) et `stock_value_owned` l'exclut deja.
--
-- Tout ce qui ecrit passe par des fonctions SQL TRANSACTIONNELLES (security definer, droit
-- d'ecriture de la rubrique Reprises), tracees dans `events` ; les documents de vente sont crees
-- comme le fait l'ecran (en-tete brouillon -> lignes -> numero + « validee » -> stock), donc avec
-- tous les garde-fous des triggers existants (client, lignes, caisse, regime de la marge).
--
-- SUPPOSE APPLIQUEES : 20260612230000 (consignments), 20260923150000 (article D des motos),
-- 20261013140000 (droits par role). TOLERE l'absence de : 20261103190000 (registre / livre de
-- police), 20261118150000 (mouvements de caisse types, lot caisse) : colonnes lues dynamiquement.
-- Idempotente. NON APPLIQUEE (Simon la passe en bloc). Essai a blanc :
-- supabase/tests/m7_depot_vente_complet.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Numerotation : sequence DEP par societe (ecran Parametres > Numerotation des documents)
-- ---------------------------------------------------------------------
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, 'DEP', 'DEP', 'Depot-vente (fiche de depot d un vehicule confie)' from public.companies c
on conflict (company_id, doc_type) do nothing;

-- ---------------------------------------------------------------------
-- 1. Reglages (Parametres > Tables > « Depot-vente — reglages ») : code = reglage, libelle = valeur
--    (meme principe que `vat_margin_settings` et `cession_settings`). Les valeurs deja saisies ne
--    sont jamais ecrasees.
-- ---------------------------------------------------------------------
do $$
declare _co record;
begin
  for _co in select id from public.companies loop
    insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra) values
      (_co.id, 'consignment_settings', 'commission_mode', 'ecart', 1, true,
       '{"help":"Calcul de la commission : ecart (prix de vente - prix demande, defaut), pourcentage (du prix de vente TTC) ou forfait. Modifiable sur chaque depot."}'),
      (_co.id, 'consignment_settings', 'commission_pct', '10', 2, true,
       '{"help":"Pourcentage de commission par defaut (mode pourcentage), sur le prix de vente TTC"}'),
      (_co.id, 'consignment_settings', 'commission_fixed', '0', 3, true,
       '{"help":"Commission forfaitaire par defaut, EUR TVA comprise (mode forfait)"}'),
      (_co.id, 'consignment_settings', 'commission_vat_rate', '21', 4, true,
       '{"help":"Taux de TVA de la facture au deposant (commission, frais, reparations). G8 : 21 %."}'),
      (_co.id, 'consignment_settings', 'deposit_fee', '0', 5, true,
       '{"help":"Frais de depot-vente par defaut, EUR TVA comprise, deduits du reversement"}'),
      (_co.id, 'consignment_settings', 'buyer_invoice', 'oui', 6, true,
       '{"help":"oui = la vente fait une facture a l acheteur (defaut). non = comme le parcours G8 teste : simple encaissement (mouvement 02), sans facture."}'),
      (_co.id, 'consignment_settings', 'buyer_vat_rate_particulier', '0', 7, true,
       '{"help":"TVA de la facture acheteur quand le deposant est un particulier (moto d un non-assujetti vendue pour son compte). A valider par le comptable."}'),
      (_co.id, 'consignment_settings', 'buyer_vat_rate_professionnel', '21', 8, true,
       '{"help":"TVA de la facture acheteur quand le deposant est un professionnel assujetti. A valider par le comptable."}'),
      (_co.id, 'consignment_settings', 'buyer_mention_particulier',
       'Vente pour compte du deposant, depot-vente {numero}. Vehicule d occasion appartenant a un particulier non assujetti : pas de TVA sur le prix du vehicule.', 9, true,
       '{"help":"Mention imprimee sur la facture acheteur (deposant particulier). {numero} = n° DEP. A valider par le comptable."}'),
      (_co.id, 'consignment_settings', 'buyer_mention_professionnel',
       'Vente pour compte du deposant, depot-vente {numero}.', 10, true,
       '{"help":"Mention imprimee sur la facture acheteur (deposant professionnel). {numero} = n° DEP."}'),
      (_co.id, 'consignment_settings', 'commission_invoice', 'oui', 11, true,
       '{"help":"oui = facture au deposant (commission + frais + reparations, TVA) a chaque vente"}'),
      (_co.id, 'consignment_settings', 'commission_compensation', 'oui', 12, true,
       '{"help":"oui = la facture au deposant est reglee par retenue sur le prix de vente (mode DEP, pas de tresorerie)"}'),
      (_co.id, 'consignment_settings', 'auto_credit_note', 'non', 13, true,
       '{"help":"oui = avoir automatique au nom du deposant pour le reversement (parametre G8, coche chez ITALBIKE). Le versement rembourse alors cet avoir."}'),
      (_co.id, 'consignment_settings', 'distinguish_pro', 'oui', 14, true,
       '{"help":"oui = distinguer depots de professionnels et de particuliers (conditions et TVA differentes)"}'),
      (_co.id, 'consignment_settings', 'conditions_particulier',
       'Le vehicule reste la propriete du deposant jusqu a sa vente. Le deposant garantit etre proprietaire du vehicule et qu il est libre de tout gage. La concession s engage a ne pas vendre en dessous du prix minimum convenu sans accord du deposant. A la vente, le prix de vente diminue de la commission, des frais et des reparations acceptees est reverse au deposant.', 15, true,
       '{"help":"Conditions imprimees sur le document de depot (particulier)"}'),
      (_co.id, 'consignment_settings', 'conditions_professionnel',
       'Le vehicule reste la propriete du deposant jusqu a sa vente. A la vente, le deposant facture le vehicule a la concession ou la concession facture pour son compte selon les conditions convenues ; la commission, les frais et les reparations acceptees sont factures au deposant.', 16, true,
       '{"help":"Conditions imprimees sur le document de depot (professionnel)"}'),
      (_co.id, 'consignment_settings', 'legal_mention',
       'Document de depot-vente etabli en deux exemplaires. Le deposant declare avoir pris connaissance des conditions ci-dessus et les accepter.', 17, true,
       '{"help":"Mention legale imprimee au pied du document de depot"}')
    on conflict (company_id, table_key, code) do nothing;
  end loop;
end $$;

-- Mode de reglement technique « DEP » : facture au deposant reglee par retenue sur le prix de vente
-- (compensation, pas de tresorerie ; compte = compte d'entree depot, classe 4).
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select distinct rv.company_id, 'payment_method', 'DEP', 'Retenu sur depot-vente', 92, true, '{"visible_pos": false}'::jsonb
  from public.reference_values rv
 where rv.table_key = 'payment_method'
on conflict (company_id, table_key, code) do nothing;

-- Comptes (plan comptable + correspondances, ecran Comptabilite). A CONFIRMER PAR LE COMPTABLE.
--   489100 : sommes dues aux deposants (G8 « compte entree depot vente », classe 4) ;
--   700900 : commissions et frais de depot-vente (G8 « journal des commissions »).
insert into public.chart_of_accounts (company_id, code, label, kind)
select c.id, d.code, d.label, 'general' from public.companies c
 cross join (values ('489100', 'Depots-vente : sommes dues aux deposants'),
                    ('700900', 'Commissions et frais sur depots-vente')) as d(code, label)
on conflict (company_id, code) do nothing;
insert into public.account_mappings (company_id, dimension, match_key, account_code, journal_code)
select c.id, d.dimension, d.match_key, d.account_code, d.journal_code from public.companies c
 cross join (values
   ('consignment', 'deposit',    '489100', 'VEN'),
   ('consignment', 'commission', '700900', 'VEN'),
   ('consignment', 'fees',       '700900', 'VEN'),
   ('consignment', 'repairs',    '700000', 'VEN'),
   ('consignment', 'return_fee', '700900', 'VEN'),
   ('payment',     'DEP',        '489100', 'OD')
 ) as d(dimension, match_key, account_code, journal_code)
on conflict (company_id, dimension, match_key) do nothing;

-- Mouvements de caisse types du lot caisse (02 encaissement / 03 decaissement depot-vente) :
-- leur compte vide est complete par le compte d'entree depot. Sans le lot caisse : aucun effet.
update public.reference_values
   set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('account', '489100')
 where table_key = 'cash_movement_type' and code in ('02', '03')
   and coalesce(extra->>'account', '') = '';

-- ---------------------------------------------------------------------
-- 2. La fiche de depot : colonnes G8
-- ---------------------------------------------------------------------
alter table public.consignments
  add column if not exists depositor_kind        text not null default 'particulier',  -- particulier | professionnel
  add column if not exists asked_price           numeric(14,2) not null default 0,     -- prix demande par le deposant (net attendu, TTC)
  add column if not exists min_price             numeric(14,2) not null default 0,     -- prix de vente minimum de reserve
  add column if not exists commission_mode       text not null default 'ecart',        -- ecart | pourcentage | forfait
  add column if not exists deposit_fee           numeric(14,2) not null default 0,     -- frais de depot (TTC)
  add column if not exists conditions            text,
  add column if not exists legal_mention         text,
  add column if not exists police_book_number    text,                                 -- n° livre de police / registre
  add column if not exists checklist             jsonb not null default '{}'::jsonb,   -- documents remis (cles de la fiche de reprise)
  add column if not exists entry_date            date not null default current_date,
  add column if not exists expected_delivery_date date,
  add column if not exists buyer_id              uuid references public.contacts(id) on delete set null,
  add column if not exists sold_price            numeric(14,2),                        -- prix de vente reel TTC
  add column if not exists sold_commission_ht    numeric(14,2),
  add column if not exists sold_commission_vat   numeric(14,2),
  add column if not exists sold_fees             numeric(14,2),                        -- frais (TTC)
  add column if not exists sold_repairs          numeric(14,2),                        -- reparations a charge du deposant (TTC)
  add column if not exists sold_vat_rate         numeric(5,2),                         -- taux de la facture au deposant
  add column if not exists sold_invoice_ht       numeric(14,2),
  add column if not exists sold_invoice_vat      numeric(14,2),
  add column if not exists commission_document_id uuid references public.documents(id) on delete set null,
  add column if not exists credit_note_document_id uuid references public.documents(id) on delete set null,
  add column if not exists receipt_cash_movement_id uuid references public.cash_movements(id) on delete set null,
  add column if not exists payout_at             timestamptz,
  add column if not exists payout_method         text,
  add column if not exists payout_amount         numeric(14,2),
  add column if not exists payout_reference      text,
  add column if not exists payout_cash_movement_id uuid references public.cash_movements(id) on delete set null,
  add column if not exists payout_payment_id     uuid references public.document_payments(id) on delete set null,
  add column if not exists returned_at           timestamptz,
  add column if not exists return_reason         text,
  add column if not exists return_fee            numeric(14,2),
  add column if not exists return_document_id    uuid references public.documents(id) on delete set null,
  add column if not exists created_by            uuid references auth.users(id) on delete set null,
  add column if not exists updated_at            timestamptz not null default now();

-- Prix demande des depots existants (ecran « simple ») : le prix convenu servait de prix de vente.
update public.consignments set asked_price = agreed_price where asked_price = 0 and agreed_price > 0 and status = 'en_depot';

do $$ begin
  alter table public.consignments add constraint consignments_status_chk check (status in ('en_depot', 'vendu', 'restitue'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.consignments add constraint consignments_kind_chk check (depositor_kind in ('particulier', 'professionnel'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.consignments add constraint consignments_mode_chk check (commission_mode in ('ecart', 'pourcentage', 'forfait'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.consignments add constraint consignments_amounts_chk
    check (agreed_price >= 0 and asked_price >= 0 and min_price >= 0 and deposit_fee >= 0 and commission_pct >= 0);
exception when duplicate_object then null; end $$;
-- N° unique par societe. Les anciens n° saisis a la main en double (ecran « simple ») bloqueraient
-- l'index : ils sont signales et l'index attend leur correction (aucune donnee n'est modifiee).
do $$ begin
  if exists (select 1 from public.consignments where number is not null group by company_id, number having count(*) > 1) then
    raise notice 'Depots-vente : n° saisis en double, index consignments_number_uq NON cree (corriger puis rejouer la migration).';
  else
    create unique index if not exists consignments_number_uq on public.consignments(company_id, number) where number is not null;
  end if;
end $$;
-- Une moto n'est confiee qu'une fois a la fois.
create unique index if not exists consignments_vehicle_active_uq on public.consignments(vehicle_id) where status = 'en_depot' and vehicle_id is not null;
create index if not exists idx_consignments_vehicle on public.consignments(vehicle_id);
create index if not exists idx_consignments_buyer on public.consignments(buyer_id);

drop trigger if exists trg_consignments_updated on public.consignments;
create trigger trg_consignments_updated before update on public.consignments for each row execute function public.set_updated_at();

-- Droits : lecture membre ; ecriture = rubrique Reprises (vendeur) ou administrateur. L'ecran
-- n'ecrit plus directement : tout passe par les fonctions ci-dessous.
insert into public.table_write_pages (table_name, page) values ('consignments', '/tradein')
on conflict (table_name, page) do nothing;
drop policy if exists consignments_all on public.consignments;
drop policy if exists consignments_read on public.consignments;
drop policy if exists consignments_write on public.consignments;
create policy consignments_read on public.consignments for select to authenticated using (public.is_member(company_id));
create policy consignments_write on public.consignments for all to authenticated
  using (public.can_write_table(company_id, 'consignments')) with check (public.can_write_table(company_id, 'consignments'));

comment on table public.consignments is
  'M7 depot-vente (type D, G8 « Fiche depot vente ») : moto confiee, hors valorisation de stock ; vente = facture acheteur + facture au deposant (commission/frais/reparations) + decompte + versement ; retour client. Ecriture par fonctions consignment_*.';

-- ---------------------------------------------------------------------
-- 3. Garde-fou de l'invariant D : aucune entree valorisee d'un article de depot-vente
-- ---------------------------------------------------------------------
create or replace function public._stock_moves_consignment_unvalued()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.unit_cost is not null and new.unit_cost <> 0
     and exists (select 1 from public.articles a where a.id = new.article_id and a.mgmt_type::text = 'D') then
    raise exception 'Depot-vente (type D) : la moto appartient au deposant, elle n entre pas en valorisation de stock (mouvement sans cout).'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public._stock_moves_consignment_unvalued() from public, anon, authenticated;
drop trigger if exists trg_stock_moves_consignment_unvalued on public.stock_moves;
create trigger trg_stock_moves_consignment_unvalued before insert on public.stock_moves
  for each row execute function public._stock_moves_consignment_unvalued();

-- ---------------------------------------------------------------------
-- 4. Fonctions de base (internes)
-- ---------------------------------------------------------------------
create or replace function public._consignment_setting(_company uuid, _code text, _default text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select nullif(trim(r.label), '') from public.reference_values r
                    where r.company_id = _company and r.table_key = 'consignment_settings'
                      and r.code = _code and r.is_active limit 1), _default);
$$;
create or replace function public._consignment_truthy(_v text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select lower(trim(coalesce(_v, ''))) in ('oui', 'o', 'true', 'vrai', '1', 'yes', 'y', 'ja', 'si', 'on');
$$;
create or replace function public._consignment_num(_v text, _default numeric)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
begin
  return coalesce(nullif(replace(trim(coalesce(_v, '')), ',', '.'), '')::numeric, _default);
exception when others then return _default;
end $$;
create or replace function public._consignment_account(_company uuid, _key text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select m.account_code from public.account_mappings m
   where m.company_id = _company and m.dimension = 'consignment' and m.match_key in (_key, '*')
   order by (m.match_key = _key) desc limit 1;
$$;
revoke all on function public._consignment_setting(uuid, text, text) from public, anon;
revoke all on function public._consignment_account(uuid, text) from public, anon;
grant execute on function public._consignment_setting(uuid, text, text) to authenticated;
-- Lu par la vue des ecritures (security invoker) : execution ouverte aux membres connectes.
grant execute on function public._consignment_account(uuid, text) to authenticated;

/**
 * Decompte d'une vente (meme calcul que `src/modules/tradein/consignment-rules.ts`, teste dans
 * tests/depot-vente.test.ts). Montants TTC ; HT = TTC × 100 / (100 + taux), arrondi au cent,
 * TVA = TTC − HT (la TVA est COMPRISE dans la commission, G8 « commission … dont TVA »).
 *   commission : ecart = max(prix de vente − prix demande, 0) ; pourcentage = PV × % ; forfait.
 *   facture au deposant = commission + frais + reparations ; net au deposant = PV − facture.
 */
create or replace function public.consignment_amounts(
  _sale numeric, _asked numeric, _mode text, _pct numeric, _fixed numeric,
  _fees numeric, _repairs numeric, _rate numeric)
returns table(commission_ttc numeric, commission_ht numeric, commission_vat numeric,
              fees_ttc numeric, fees_ht numeric, repairs_ttc numeric, repairs_ht numeric,
              invoice_ttc numeric, invoice_ht numeric, invoice_vat numeric, net numeric)
language plpgsql immutable set search_path = public, pg_temp as $$
declare _c numeric; _f numeric; _r numeric; _ch numeric; _fh numeric; _rh numeric; _k numeric;
begin
  _k := 100 + coalesce(_rate, 0);
  _c := round(greatest(case coalesce(_mode, 'ecart')
                         when 'pourcentage' then coalesce(_sale, 0) * coalesce(_pct, 0) / 100
                         when 'forfait'     then coalesce(_fixed, 0)
                         else coalesce(_sale, 0) - coalesce(_asked, 0) end, 0), 2);
  _f := round(greatest(coalesce(_fees, 0), 0), 2);
  _r := round(greatest(coalesce(_repairs, 0), 0), 2);
  _ch := round(_c * 100 / _k, 2); _fh := round(_f * 100 / _k, 2); _rh := round(_r * 100 / _k, 2);
  return query select _c, _ch, _c - _ch, _f, _fh, _r, _rh,
                      _c + _f + _r, _ch + _fh + _rh, (_c + _f + _r) - (_ch + _fh + _rh),
                      round(coalesce(_sale, 0), 2) - (_c + _f + _r);
end $$;
grant execute on function public.consignment_amounts(numeric, numeric, text, numeric, numeric, numeric, numeric, numeric) to authenticated;

create or replace function public._consignment_guard_write(_company uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.can_write_table(_company, 'consignments') then
    raise exception 'Acces refuse : le depot-vente se gere depuis la rubrique Reprises (vendeur ou administrateur).' using errcode = '42501';
  end if;
end $$;
revoke all on function public._consignment_guard_write(uuid) from public, anon, authenticated;

create or replace function public._consignment_event(_company uuid, _id uuid, _action text, _old jsonb, _new jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), _action, 'consignments', _id::text, 'screen', _old, _new);
$$;
revoke all on function public._consignment_event(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;

/**
 * Cree un document de vente valide comme l'ecran (en-tete brouillon -> lignes -> numero + statut
 * « validee ») : tous les triggers de controle s'appliquent. _lines = tableau jsonb
 * {article_id, designation, reference, quantity, unit_price_ht, vat_rate, line_ht, line_ttc}.
 */
create or replace function public._consignment_make_document(
  _company uuid, _type text, _contact uuid, _vehicle uuid, _lines jsonb, _notes text, _source uuid default null)
returns table(id uuid, number text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare _doc uuid; _num text; _l jsonb; _i int := 0; _ht numeric := 0; _ttc numeric := 0;
begin
  for _l in select * from jsonb_array_elements(_lines) loop
    _ht := _ht + (_l->>'line_ht')::numeric;
    _ttc := _ttc + (_l->>'line_ttc')::numeric;
  end loop;
  insert into public.documents (company_id, doc_type, contact_id, vehicle_id, issue_date, status, number,
                                total_ht, total_vat, total_ttc, price_mode, notes, source_document_id, operator_user_id)
  values (_company, _type, _contact, _vehicle, current_date, 'brouillon', null,
          round(_ht, 2), round(_ttc - _ht, 2), round(_ttc, 2), 'ttc', _notes, _source, auth.uid())
  returning documents.id into _doc;
  for _l in select * from jsonb_array_elements(_lines) loop
    insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity,
                                       unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
    values (_doc, nullif(_l->>'article_id', '')::uuid, _l->>'designation', nullif(_l->>'reference', ''), 'article',
            (_l->>'quantity')::numeric, (_l->>'unit_price_ht')::numeric, (_l->>'vat_rate')::numeric, 0,
            (_l->>'line_ht')::numeric, (_l->>'line_ttc')::numeric, _i);
    _i := _i + 1;
  end loop;
  _num := public._next_document_number_unchecked(_company, _type);
  update public.documents d set status = 'validee', number = _num where d.id = _doc;
  return query select _doc, _num;
end $$;
revoke all on function public._consignment_make_document(uuid, text, uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;

-- Une ligne de document TTC au taux donne (HT arrondi au cent, TTC exact).
create or replace function public._consignment_line(_article uuid, _designation text, _reference text, _qty numeric, _ttc numeric, _rate numeric)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object('article_id', _article, 'designation', _designation, 'reference', _reference,
                            'quantity', _qty,
                            'unit_price_ht', round(_ttc * 100 / (100 + coalesce(_rate, 0)), 2),
                            'vat_rate', coalesce(_rate, 0),
                            'line_ht', round(_qty * round(_ttc * 100 / (100 + coalesce(_rate, 0)), 2), 2),
                            'line_ttc', round(_qty * _ttc, 2));
$$;

-- Mouvement de caisse (type 02 / 03 du lot caisse si la colonne existe, sinon mouvement simple).
create or replace function public._consignment_cash_movement(_company uuid, _kind text, _amount numeric, _method text, _reason text, _type text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _sid uuid; _id uuid; _typed boolean;
begin
  select s.id into _sid from public.cash_sessions s where s.company_id = _company and s.status = 'open' limit 1;
  if _method = 'ESP' and _sid is null then
    raise exception 'Aucune caisse ouverte : les especes passent par le tiroir. Ouvrez la caisse (Caisse > Caisse & cloture Z) ou choisissez le virement.'
      using errcode = '23514';
  end if;
  _typed := exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'cash_movements' and column_name = 'type_code')
        and exists (select 1 from public.reference_values r
                     where r.company_id = _company and r.table_key = 'cash_movement_type' and r.code = _type and r.is_active);
  if _typed then
    execute 'insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, operator_id, type_code)
             values ($1, $2, $3, $4, $5, $6, $7, $8) returning id'
      into _id using _company, _sid, _kind, round(_amount, 2), _method, _reason, auth.uid(), _type;
  else
    insert into public.cash_movements (company_id, session_id, kind, amount, method, reason, operator_id)
    values (_company, _sid, _kind, round(_amount, 2), _method, _reason, auth.uid())
    returning id into _id;
  end if;
  return _id;
end $$;
revoke all on function public._consignment_cash_movement(uuid, text, numeric, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Entree : fiche de depot (moto existante ou nouvelle), n° DEP, article D sans valeur
-- ---------------------------------------------------------------------
/**
 * _data : depositor_id (obligatoire), depositor_kind, vehicle_id OU vehicle {vin, brand, model,
 * model_year, plate, mileage, color, first_registration_date}, asked_price, agreed_price (prix de
 * vente TTC), min_price, commission_mode, commission_pct, commission_amount, deposit_fee,
 * conditions, legal_mention, police_book_number, checklist, entry_date, notes.
 */
create or replace function public.consignment_create(_company uuid, _data jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _id uuid; _num text; _veh uuid; v public.vehicles; _art uuid; _mgmt text; _real numeric;
  _dep uuid := nullif(_data->>'depositor_id', '')::uuid;
  _vin text := upper(regexp_replace(coalesce(_data#>>'{vehicle,vin}', ''), '\s', '', 'g'));
  _sale numeric := public._consignment_num(_data->>'agreed_price', 0);
  _kind text := coalesce(nullif(_data->>'depositor_kind', ''), 'particulier');
  _police text := nullif(trim(coalesce(_data->>'police_book_number', '')), '');
begin
  perform public._consignment_guard_write(_company);
  if _dep is null or not exists (select 1 from public.contacts c where c.id = _dep and c.company_id = _company) then
    raise exception 'Choisissez le deposant (fiche client de la societe).' using errcode = '23514';
  end if;
  if _sale <= 0 then raise exception 'Indiquez le prix de vente TTC.' using errcode = '23514'; end if;

  -- La moto : fiche existante (choisie, ou retrouvee par son VIN), sinon creee.
  _veh := nullif(_data->>'vehicle_id', '')::uuid;
  if _veh is null and _vin <> '' then
    select x.id into _veh from public.vehicles x where x.company_id = _company and upper(x.vin) = _vin limit 1;
  end if;
  if _veh is null then
    if _vin = '' then raise exception 'Indiquez le VIN (n° de chassis) de la moto.' using errcode = '23514'; end if;
    insert into public.vehicles (company_id, vin, brand, model, model_year, plate, mileage, color,
                                 first_registration_date, status, display_price, created_by)
    values (_company, _vin, nullif(_data#>>'{vehicle,brand}', ''), nullif(_data#>>'{vehicle,model}', ''),
            nullif(_data#>>'{vehicle,model_year}', '')::int, nullif(upper(_data#>>'{vehicle,plate}'), ''),
            nullif(_data#>>'{vehicle,mileage}', '')::int, nullif(_data#>>'{vehicle,color}', ''),
            nullif(_data#>>'{vehicle,first_registration_date}', '')::date, 'depot_vente', _sale, auth.uid())
    returning id into _veh;
  end if;
  select * into v from public.vehicles where id = _veh for update;
  if v.id is null or v.company_id <> _company then raise exception 'Moto introuvable dans cette societe.' using errcode = 'P0002'; end if;
  if coalesce(nullif(regexp_replace(coalesce(v.vin, ''), '[^A-Za-z0-9]', '', 'g'), ''), '') = '' then
    raise exception 'La moto n a pas de VIN : completez sa fiche avant de la prendre en depot.' using errcode = '23514';
  end if;
  if public.vehicle_parc_kind(v.status) in ('en_stock', 'en_commande', 'reprise') then
    raise exception 'Cette moto appartient au stock de la concession (%) : elle ne peut pas etre prise en depot-vente.', v.status
      using errcode = '23514';
  end if;
  if exists (select 1 from public.consignments c where c.vehicle_id = _veh and c.status = 'en_depot') then
    raise exception 'Cette moto est deja en depot-vente.' using errcode = '23505';
  end if;

  _num := public._next_document_number_unchecked(_company, 'DEP');

  -- Fiche moto : statut depot-vente, prix affiche, reference = n° DEP si elle n'en a pas.
  update public.vehicles
     set status = 'depot_vente', display_price = _sale,
         reference = coalesce(nullif(btrim(reference), ''), _num),
         police_book_number = coalesce(_police, police_book_number),
         updated_at = now()
   where id = _veh;

  -- Proprietaire = deposant (B9) : il reste proprietaire jusqu'a la vente.
  if not exists (select 1 from public.vehicle_owners o where o.vehicle_id = _veh and o.contact_id = _dep and o.is_current) then
    update public.vehicle_owners set is_current = false, to_date = current_date where vehicle_id = _veh and is_current;
    insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current) values (_veh, _dep, current_date, true);
  end if;

  -- Article D (glossaire) : une moto d'une vente precedente garde un article O / P / V : il est
  -- detache (historique conserve) et un article D est cree. Entree en stock SANS valeur.
  select a.mgmt_type::text into _mgmt from public.articles a where a.id = v.article_id;
  if v.article_id is not null and _mgmt is distinct from 'D' then
    update public.vehicles set article_id = null where id = _veh;
  end if;
  _art := public.vehicle_ensure_article(_veh, 'D', null, true);
  select coalesce(s.real_qty, 0) into _real from public.article_stock(_art) s;
  if coalesce(_real, 0) <= 0 then
    perform public.record_stock_move(_art, 'entree'::public.stock_move_type, 1, null, false, null,
                                     'consignment', _num, 'Entree en depot-vente ' || _num || ' (sans valeur : la moto reste au deposant)');
  end if;

  insert into public.consignments (company_id, depositor_id, depositor_kind, article_id, vehicle_id, number,
         agreed_price, asked_price, min_price, commission_mode, commission_pct, commission_amount, deposit_fee,
         conditions, legal_mention, police_book_number, checklist, entry_date, notes, status, created_by)
  values (_company, _dep, _kind, _art, _veh, _num,
          _sale, public._consignment_num(_data->>'asked_price', 0), public._consignment_num(_data->>'min_price', 0),
          coalesce(nullif(_data->>'commission_mode', ''), public._consignment_setting(_company, 'commission_mode', 'ecart')),
          public._consignment_num(_data->>'commission_pct', public._consignment_num(public._consignment_setting(_company, 'commission_pct', '10'), 10)),
          case when coalesce(nullif(_data->>'commission_mode', ''), public._consignment_setting(_company, 'commission_mode', 'ecart')) = 'forfait'
               then public._consignment_num(_data->>'commission_amount', public._consignment_num(public._consignment_setting(_company, 'commission_fixed', '0'), 0)) end,
          public._consignment_num(_data->>'deposit_fee', public._consignment_num(public._consignment_setting(_company, 'deposit_fee', '0'), 0)),
          coalesce(nullif(_data->>'conditions', ''), public._consignment_setting(_company, 'conditions_' || _kind, null)),
          coalesce(nullif(_data->>'legal_mention', ''), public._consignment_setting(_company, 'legal_mention', null)),
          _police, coalesce(_data->'checklist', '{}'::jsonb),
          coalesce(nullif(_data->>'entry_date', '')::date, current_date), nullif(_data->>'notes', ''), 'en_depot', auth.uid())
  returning id into _id;

  -- N° livre de police : celui du registre des vehicules (inscription code 4 par son trigger) s'il existe.
  if _police is null and to_regclass('public.vehicle_register') is not null then
    execute 'select r.year::text || ''-'' || lpad(r.seq::text, 4, ''0'') from public.vehicle_register r
              where r.company_id = $1 and r.source = ''depot'' and r.source_id = $2 order by r.created_at desc limit 1'
      into _police using _company, _id;
    if _police is not null then
      update public.consignments set police_book_number = _police where id = _id;
      update public.vehicles set police_book_number = coalesce(police_book_number, _police) where id = _veh;
    end if;
  end if;

  perform public._consignment_event(_company, _id, 'consignment_create', null,
    jsonb_build_object('number', _num, 'vehicle_id', _veh, 'article_id', _art, 'depositor_id', _dep,
                       'agreed_price', _sale, 'asked_price', _data->>'asked_price', 'min_price', _data->>'min_price'));
  return _id;
end $$;
revoke all on function public.consignment_create(uuid, jsonb) from public, anon;
grant execute on function public.consignment_create(uuid, jsonb) to authenticated;

/** Modification de la fiche tant que la moto est en depot (prix, conditions, check-list…). Tracee. */
create or replace function public.consignment_update(_consignment uuid, _data jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.consignments; n public.consignments;
begin
  select * into c from public.consignments where id = _consignment for update;
  if c.id is null then raise exception 'Depot-vente introuvable' using errcode = 'P0002'; end if;
  perform public._consignment_guard_write(c.company_id);
  if c.status <> 'en_depot' then raise exception 'Depot % % : la fiche ne se modifie plus.', c.number, c.status using errcode = '23514'; end if;
  n := c;
  if _data ? 'depositor_kind'   then n.depositor_kind := coalesce(nullif(_data->>'depositor_kind', ''), c.depositor_kind); end if;
  if _data ? 'agreed_price'     then n.agreed_price := public._consignment_num(_data->>'agreed_price', c.agreed_price); end if;
  if _data ? 'asked_price'      then n.asked_price := public._consignment_num(_data->>'asked_price', c.asked_price); end if;
  if _data ? 'min_price'        then n.min_price := public._consignment_num(_data->>'min_price', c.min_price); end if;
  if _data ? 'commission_mode'  then n.commission_mode := coalesce(nullif(_data->>'commission_mode', ''), c.commission_mode); end if;
  if _data ? 'commission_pct'   then n.commission_pct := public._consignment_num(_data->>'commission_pct', c.commission_pct); end if;
  if _data ? 'commission_amount' then n.commission_amount := public._consignment_num(_data->>'commission_amount', null); end if;
  if _data ? 'deposit_fee'      then n.deposit_fee := public._consignment_num(_data->>'deposit_fee', c.deposit_fee); end if;
  if _data ? 'conditions'       then n.conditions := nullif(_data->>'conditions', ''); end if;
  if _data ? 'legal_mention'    then n.legal_mention := nullif(_data->>'legal_mention', ''); end if;
  if _data ? 'police_book_number' then n.police_book_number := nullif(trim(_data->>'police_book_number'), ''); end if;
  if _data ? 'checklist'        then n.checklist := coalesce(_data->'checklist', '{}'::jsonb); end if;
  if _data ? 'entry_date'       then n.entry_date := coalesce(nullif(_data->>'entry_date', '')::date, c.entry_date); end if;
  if _data ? 'notes'            then n.notes := nullif(_data->>'notes', ''); end if;
  if n.agreed_price <= 0 then raise exception 'Indiquez le prix de vente TTC.' using errcode = '23514'; end if;

  update public.consignments set
    depositor_kind = n.depositor_kind, agreed_price = n.agreed_price, asked_price = n.asked_price, min_price = n.min_price,
    commission_mode = n.commission_mode, commission_pct = n.commission_pct, commission_amount = n.commission_amount,
    deposit_fee = n.deposit_fee, conditions = n.conditions, legal_mention = n.legal_mention,
    police_book_number = n.police_book_number, checklist = n.checklist, entry_date = n.entry_date, notes = n.notes
  where id = c.id;
  if n.agreed_price is distinct from c.agreed_price and c.vehicle_id is not null then
    update public.vehicles set display_price = n.agreed_price, updated_at = now() where id = c.vehicle_id;
  end if;
  perform public._consignment_event(c.company_id, c.id, 'consignment_update', to_jsonb(c), to_jsonb(n));
end $$;
revoke all on function public.consignment_update(uuid, jsonb) from public, anon;
grant execute on function public.consignment_update(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Vente : facture acheteur + facture au deposant + avoir (option) + decompte, en une transaction
-- ---------------------------------------------------------------------
/**
 * _data : buyer_id (obligatoire), sale_price (TTC, defaut = prix de vente de la fiche), fees (defaut =
 * frais de depot), repairs (TTC, defaut 0), expected_delivery_date, force_below_min (bool),
 * buyer_invoice / commission_invoice / credit_note (bool, defaut = reglages), receipt_method (sans
 * facture acheteur : mode de l'encaissement 02, ex. VIR / ESP / CB ; vide = pas d'encaissement).
 * Retour : jsonb avec documents et montants du decompte.
 */
create or replace function public.consignment_sell(_consignment uuid, _data jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.consignments; v public.vehicles; a public.articles; dep_name text; m record;
  _buyer uuid := nullif(_data->>'buyer_id', '')::uuid;
  _sale numeric; _fees numeric; _repairs numeric; _rate numeric; _brate numeric;
  _want_buyer boolean; _want_comm boolean; _want_avo boolean; _receipt text;
  _sale_doc uuid; _sale_num text; _comm_doc uuid; _comm_num text; _avo_doc uuid; _avo_num text;
  _lines jsonb; _mention text; _label text; _rcpt uuid; _pay uuid;
begin
  select * into c from public.consignments where id = _consignment for update;
  if c.id is null then raise exception 'Depot-vente introuvable' using errcode = 'P0002'; end if;
  perform public._consignment_guard_write(c.company_id);
  if c.status <> 'en_depot' then
    raise exception 'Depot % deja % : il ne se vend plus (un second reglement est refuse).', c.number, c.status using errcode = '23514';
  end if;
  if _buyer is null or not exists (select 1 from public.contacts x where x.id = _buyer and x.company_id = c.company_id) then
    raise exception 'Choisissez l acquereur (fiche client de la societe).' using errcode = '23514';
  end if;
  if _buyer = c.depositor_id then raise exception 'L acquereur ne peut pas etre le deposant (utilisez le retour client).' using errcode = '23514'; end if;
  select * into v from public.vehicles where id = c.vehicle_id;
  select * into a from public.articles where id = c.article_id;
  if v.id is null or a.id is null then
    raise exception 'Depot % sans moto ni article D (ancien depot « simple ») : reprenez-le par une nouvelle fiche avec la moto.', c.number
      using errcode = '23514';
  end if;

  _sale := public._consignment_num(_data->>'sale_price', c.agreed_price);
  _fees := public._consignment_num(_data->>'fees', c.deposit_fee);
  _repairs := public._consignment_num(_data->>'repairs', 0);
  if _sale <= 0 then raise exception 'Prix de vente TTC obligatoire.' using errcode = '23514'; end if;
  if c.min_price > 0 and _sale < c.min_price and not coalesce((_data->>'force_below_min')::boolean, false) then
    raise exception 'Prix de vente % EUR sous le prix minimum de reserve % EUR : confirmez l accord du deposant.', _sale, c.min_price
      using errcode = '23514';
  end if;
  _rate := public._consignment_num(public._consignment_setting(c.company_id, 'commission_vat_rate', '21'), 21);
  select * into m from public.consignment_amounts(_sale, c.asked_price, c.commission_mode, c.commission_pct,
                                                  c.commission_amount, _fees, _repairs, _rate);
  if m.net < 0 then
    raise exception 'Commission, frais et reparations (% EUR) depassent le prix de vente (% EUR) : decompte negatif.', m.invoice_ttc, _sale
      using errcode = '23514';
  end if;

  _want_buyer := coalesce((_data->>'buyer_invoice')::boolean, public._consignment_truthy(public._consignment_setting(c.company_id, 'buyer_invoice', 'oui')));
  _want_comm := coalesce((_data->>'commission_invoice')::boolean, public._consignment_truthy(public._consignment_setting(c.company_id, 'commission_invoice', 'oui')));
  _want_avo := coalesce((_data->>'credit_note')::boolean, public._consignment_truthy(public._consignment_setting(c.company_id, 'auto_credit_note', 'non')));
  _receipt := nullif(trim(coalesce(_data->>'receipt_method', '')), '');
  _label := concat_ws(' ', v.brand, v.model) || ' — ' || coalesce(v.vin, '');
  select coalesce(nullif(btrim(x.company_name), ''), nullif(btrim(concat_ws(' ', x.first_name, x.last_name)), ''), '—')
    into dep_name from public.contacts x where x.id = c.depositor_id;

  -- (1) Facture a l'acheteur : la moto D, au taux du reglage (particulier / professionnel), mention.
  if _want_buyer then
    _brate := public._consignment_num(public._consignment_setting(c.company_id, 'buyer_vat_rate_' || c.depositor_kind,
                                       case when c.depositor_kind = 'professionnel' then '21' else '0' end), 0);
    _mention := replace(coalesce(public._consignment_setting(c.company_id, 'buyer_mention_' || c.depositor_kind, null), ''), '{numero}', c.number);
    select d.id, d.number into _sale_doc, _sale_num
      from public._consignment_make_document(c.company_id, 'FAC', _buyer, v.id,
             jsonb_build_array(public._consignment_line(a.id, 'Depot-vente ' || c.number || ' : ' || _label, a.reference, 1, _sale, _brate)),
             nullif(_mention, '')) d;
    -- Sortie du stock reel : le trigger passe la moto en « Vendu », l'acheteur devient proprietaire.
    perform public.record_stock_move(a.id, 'sortie'::public.stock_move_type, -1, null, false, null, 'sale', _sale_num,
                                     'Vente du depot-vente ' || c.number);
  else
    -- Parcours G8 sans facture : sortie de stock + acheteur proprietaire + encaissement 02.
    perform public.record_stock_move(a.id, 'sortie'::public.stock_move_type, -1, null, false, null, 'sale', c.number,
                                     'Vente du depot-vente ' || c.number || ' (sans facture acheteur)');
    update public.vehicle_owners set is_current = false, to_date = current_date
     where vehicle_id = v.id and is_current and contact_id is distinct from _buyer;
    insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current)
    select v.id, _buyer, current_date, true
     where not exists (select 1 from public.vehicle_owners o where o.vehicle_id = v.id and o.contact_id = _buyer and o.is_current);
    if _receipt is not null then
      _rcpt := public._consignment_cash_movement(c.company_id, 'in', _sale, _receipt,
                 'DEPOT VENTE ' || c.number || ' : encaissement', '02');
    end if;
  end if;

  -- (2) Facture au deposant : commission (+ frais, reparations), TVA comprise.
  if _want_comm and m.invoice_ttc > 0 then
    _lines := '[]'::jsonb;
    if m.commission_ttc > 0 then
      _lines := _lines || jsonb_build_array(public._consignment_line(null,
        'Commission sur la vente du depot-vente ' || c.number || ' (' || _label || ', vendu ' || to_char(_sale, 'FM999G999G990D00') || ' EUR TTC)',
        null, 1, m.commission_ttc, _rate));
    end if;
    if m.fees_ttc > 0 then
      _lines := _lines || jsonb_build_array(public._consignment_line(null, 'Frais de depot-vente ' || c.number, null, 1, m.fees_ttc, _rate));
    end if;
    if m.repairs_ttc > 0 then
      _lines := _lines || jsonb_build_array(public._consignment_line(null, 'Reparations / remise en etat de la moto ' || c.number, null, 1, m.repairs_ttc, _rate));
    end if;
    select d.id, d.number into _comm_doc, _comm_num
      from public._consignment_make_document(c.company_id, 'FAC', c.depositor_id, v.id, _lines,
             'Facture au deposant, depot-vente ' || c.number || '. Montant retenu sur le prix de vente.') d;
    if public._consignment_truthy(public._consignment_setting(c.company_id, 'commission_compensation', 'oui')) then
      insert into public.document_payments (document_id, method, amount, status, note)
      values (_comm_doc, 'DEP', (select total_ttc from public.documents where id = _comm_doc), 'recu',
              'Retenu sur le prix de vente du depot-vente ' || c.number);
      perform public.recompute_document_paid(_comm_doc);
    end if;
  end if;

  -- (3) Avoir au nom du deposant (parametre G8) : la dette envers lui, a rembourser au versement.
  if _want_avo and m.net > 0 then
    select d.id, d.number into _avo_doc, _avo_num
      from public._consignment_make_document(c.company_id, 'AVO', c.depositor_id, v.id,
             jsonb_build_array(public._consignment_line(null,
               'Reversement depot-vente ' || c.number || ' : prix de vente ' || to_char(_sale, 'FM999G999G990D00')
               || ' EUR - commission, frais et reparations ' || to_char(m.invoice_ttc, 'FM999G999G990D00') || ' EUR',
               null, -1, m.net, 0)),
             'Avoir au nom du deposant ' || dep_name || ' (depot-vente ' || c.number || ').') d;
  end if;

  update public.consignments set
    status = 'vendu', buyer_id = _buyer, sold_at = now(), sold_price = _sale,
    sold_commission = m.commission_ttc, sold_commission_ht = m.commission_ht, sold_commission_vat = m.commission_vat,
    sold_fees = m.fees_ttc, sold_repairs = m.repairs_ttc, sold_vat_rate = _rate,
    sold_invoice_ht = m.invoice_ht, sold_invoice_vat = m.invoice_vat, sold_reversal = m.net,
    sale_document_id = _sale_doc, commission_document_id = _comm_doc, credit_note_document_id = _avo_doc,
    receipt_cash_movement_id = _rcpt,
    expected_delivery_date = nullif(_data->>'expected_delivery_date', '')::date
  where id = c.id;

  perform public._consignment_event(c.company_id, c.id, 'consignment_sell',
    jsonb_build_object('status', c.status),
    jsonb_build_object('status', 'vendu', 'buyer_id', _buyer, 'sale_price', _sale, 'commission_ttc', m.commission_ttc,
                       'fees', m.fees_ttc, 'repairs', m.repairs_ttc, 'net', m.net, 'sale_document', _sale_num,
                       'commission_document', _comm_num, 'credit_note', _avo_num,
                       'below_min', (c.min_price > 0 and _sale < c.min_price)));

  return jsonb_build_object('sale_document_id', _sale_doc, 'sale_number', _sale_num,
    'commission_document_id', _comm_doc, 'commission_number', _comm_num,
    'credit_note_id', _avo_doc, 'credit_note_number', _avo_num,
    'sale_price', _sale, 'commission_ttc', m.commission_ttc, 'commission_ht', m.commission_ht, 'commission_vat', m.commission_vat,
    'fees', m.fees_ttc, 'repairs', m.repairs_ttc, 'invoice_ttc', m.invoice_ttc, 'invoice_vat', m.invoice_vat, 'net', m.net);
end $$;
revoke all on function public.consignment_sell(uuid, jsonb) from public, anon;
grant execute on function public.consignment_sell(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Versement au deposant : decaissement (mouvement 03) ou remboursement de l'avoir ; une seule fois
-- ---------------------------------------------------------------------
create or replace function public.consignment_pay_depositor(_consignment uuid, _method text, _reference text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.consignments; _mv uuid; _pay uuid; _m text := upper(trim(coalesce(_method, '')));
begin
  select * into c from public.consignments where id = _consignment for update;
  if c.id is null then raise exception 'Depot-vente introuvable' using errcode = 'P0002'; end if;
  perform public._consignment_guard_write(c.company_id);
  if c.status <> 'vendu' then raise exception 'Depot % : versement possible apres la vente seulement.', c.number using errcode = '23514'; end if;
  if c.payout_at is not null then raise exception 'Depot % : le deposant a deja ete paye le %.', c.number, to_char(c.payout_at, 'DD/MM/YYYY') using errcode = '23514'; end if;
  if _m = '' then raise exception 'Choisissez le mode de versement (virement, especes…).' using errcode = '23514'; end if;
  if coalesce(c.sold_reversal, 0) <= 0 then raise exception 'Rien a reverser au deposant.' using errcode = '23514'; end if;

  if c.credit_note_document_id is not null then
    -- Avoir au deposant : le versement est le remboursement de l'avoir (reglement negatif, comme un avoir client).
    insert into public.document_payments (document_id, method, amount, status, note)
    values (c.credit_note_document_id, _m, -c.sold_reversal, 'recu',
            'Versement au deposant, depot-vente ' || c.number || coalesce(' — ' || nullif(trim(_reference), ''), ''))
    returning id into _pay;
    perform public.recompute_document_paid(c.credit_note_document_id);
  else
    _mv := public._consignment_cash_movement(c.company_id, 'out', c.sold_reversal, _m,
             'DEPOT VENTE ' || c.number || ' : versement au deposant' || coalesce(' — ' || nullif(trim(_reference), ''), ''), '03');
  end if;

  update public.consignments set payout_at = now(), payout_method = _m, payout_amount = c.sold_reversal,
         payout_reference = nullif(trim(_reference), ''), payout_cash_movement_id = _mv, payout_payment_id = _pay
   where id = c.id;
  perform public._consignment_event(c.company_id, c.id, 'consignment_payout', null,
    jsonb_build_object('method', _m, 'amount', c.sold_reversal, 'reference', _reference, 'cash_movement_id', _mv, 'payment_id', _pay));
end $$;
revoke all on function public.consignment_pay_depositor(uuid, text, text) from public, anon;
grant execute on function public.consignment_pay_depositor(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Retour client : la moto est rendue au deposant (frais eventuels factures), sortie du parc
-- ---------------------------------------------------------------------
create or replace function public.consignment_return(_consignment uuid, _reason text, _fee numeric default 0)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.consignments; v public.vehicles; _rate numeric; _doc uuid; _num text; _real numeric;
begin
  select * into c from public.consignments where id = _consignment for update;
  if c.id is null then raise exception 'Depot-vente introuvable' using errcode = 'P0002'; end if;
  perform public._consignment_guard_write(c.company_id);
  if c.status <> 'en_depot' then raise exception 'Depot % deja % : retour impossible.', c.number, c.status using errcode = '23514'; end if;
  if coalesce(btrim(_reason), '') = '' then raise exception 'Le motif du retour est obligatoire.' using errcode = '23514'; end if;
  if coalesce(_fee, 0) < 0 then raise exception 'Frais de retour negatifs.' using errcode = '23514'; end if;

  -- Frais de retour factures au deposant (TVA du reglage).
  if coalesce(_fee, 0) > 0 then
    _rate := public._consignment_num(public._consignment_setting(c.company_id, 'commission_vat_rate', '21'), 21);
    select d.id, d.number into _doc, _num
      from public._consignment_make_document(c.company_id, 'FAC', c.depositor_id, c.vehicle_id,
             jsonb_build_array(public._consignment_line(null, 'Frais de depot-vente ' || c.number || ' (moto rendue au deposant)', null, 1, round(_fee, 2), _rate)),
             'Retour du depot-vente ' || c.number || ' : ' || btrim(_reason)) d;
  end if;

  -- Sortie du stock (quantite seulement, jamais de valeur) : origine « depot_retour », pas une vente.
  if c.article_id is not null then
    select coalesce(s.real_qty, 0) into _real from public.article_stock(c.article_id) s;
    if coalesce(_real, 0) > 0 then
      perform public.record_stock_move(c.article_id, 'sortie'::public.stock_move_type, -_real, null, false, null,
                                       'depot_retour', c.number, 'Retour au deposant du depot-vente ' || c.number || ' : ' || btrim(_reason));
    end if;
    update public.articles set publishable = false, updated_at = now() where id = c.article_id and publishable;
  end if;
  -- La moto redevient une moto de client (decision M-12 : statut « Vendu » sans article), le deposant
  -- reste proprietaire ; l'article D est detache (historique conserve).
  if c.vehicle_id is not null then
    select * into v from public.vehicles where id = c.vehicle_id;
    update public.vehicles set status = 'vendu'::public.vehicle_status, display_price = null, article_id = null, updated_at = now()
     where id = c.vehicle_id;
  end if;

  update public.consignments set status = 'restitue', returned_at = now(), return_reason = btrim(_reason),
         return_fee = nullif(round(coalesce(_fee, 0), 2), 0), return_document_id = _doc
   where id = c.id;
  perform public._consignment_event(c.company_id, c.id, 'consignment_return',
    jsonb_build_object('status', c.status, 'vehicle_status', v.status::text),
    jsonb_build_object('status', 'restitue', 'reason', btrim(_reason), 'fee', _fee, 'document', _num));
  return jsonb_build_object('document_id', _doc, 'document_number', _num);
end $$;
revoke all on function public.consignment_return(uuid, text, numeric) from public, anon;
grant execute on function public.consignment_return(uuid, text, numeric) to authenticated;

-- L'ancien reglement « simple » : refuse un second reglement et l'appel sans connexion.
create or replace function public.settle_consignment(_consignment uuid, _sale_price_ttc numeric, _sale_document uuid default null)
returns table(commission numeric, reversal numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _pct numeric; _fix numeric; _comm numeric; _rev numeric; _st text;
begin
  select company_id, commission_pct, commission_amount, status into _company, _pct, _fix, _st
    from public.consignments where id = _consignment for update;
  if _company is null then raise exception 'Depot-vente introuvable'; end if;
  perform public._consignment_guard_write(_company);
  if _st <> 'en_depot' then raise exception 'Depot-vente deja %.', _st using errcode = '23514'; end if;
  _comm := coalesce(_fix, round(_sale_price_ttc * coalesce(_pct, 0) / 100.0, 2));
  _rev  := round(_sale_price_ttc - _comm, 2);
  update public.consignments
    set status = 'vendu', sale_document_id = _sale_document, sold_commission = _comm, sold_reversal = _rev,
        sold_price = _sale_price_ttc, sold_at = now()
    where id = _consignment;
  return query select _comm, _rev;
end $$;
revoke all on function public.settle_consignment(uuid, numeric, uuid) from public, anon;
grant execute on function public.settle_consignment(uuid, numeric, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. Ecritures prevues pour l'export comptable (lot export : a brancher, cette migration n'exporte rien)
--    Le compte d'entree depot (classe 4) remplace le compte de ventes 70 pour la moto vendue pour
--    compte ; la facture au deposant porte la commission (70) et sa TVA (compte TVA collectee
--    habituel) ; la retenue (mode DEP) et le versement soldent le compte d'entree depot.
--    Contrepartie client (400000) et TVA : celles de l'export des ventes / reglements existant.
-- ---------------------------------------------------------------------
create or replace view public.consignment_accounting_entries
with (security_invoker = true) as
with c as (
  select cs.*, public._consignment_account(cs.company_id, 'deposit') as acc_deposit
    from public.consignments cs where cs.status in ('vendu', 'restitue')
)
-- Vente a l'acheteur : HT de la moto au credit du compte d'entree depot (au lieu de 70).
select c.company_id, c.id as consignment_id, c.number as consignment_number, d.issue_date as entry_date,
       'vente_acheteur'::text as step, d.id as document_id, d.number as document_number,
       c.acc_deposit as account_code, 0::numeric as debit, d.total_ht as credit,
       'Depot-vente ' || c.number || ' : prix de vente HT pour compte du deposant (remplace le compte de ventes)' as label
  from c join public.documents d on d.id = c.sale_document_id
union all
-- Encaissement sans facture (mouvement 02, parcours G8) : prix encaisse au credit du compte d'entree depot.
select c.company_id, c.id, c.number, m.occurred_at::date, 'encaissement_depot', null, null,
       c.acc_deposit, 0, m.amount, 'Depot-vente ' || c.number || ' : encaissement sans facture (mouvement 02)'
  from c join public.cash_movements m on m.id = c.receipt_cash_movement_id
union all
-- Facture au deposant : commission, frais, reparations HT (la TVA suit l'export des ventes).
select c.company_id, c.id, c.number, d.issue_date, 'commission', d.id, d.number,
       public._consignment_account(c.company_id, 'commission'), 0, coalesce(c.sold_commission_ht, 0),
       'Depot-vente ' || c.number || ' : commission HT (TVA ' || coalesce(c.sold_commission_vat, 0)::text || ')'
  from c join public.documents d on d.id = c.commission_document_id where coalesce(c.sold_commission_ht, 0) <> 0
union all
select c.company_id, c.id, c.number, d.issue_date, 'frais', d.id, d.number,
       public._consignment_account(c.company_id, 'fees'), 0,
       round(coalesce(c.sold_fees, 0) * 100 / (100 + coalesce(c.sold_vat_rate, 21)), 2),
       'Depot-vente ' || c.number || ' : frais HT'
  from c join public.documents d on d.id = c.commission_document_id where coalesce(c.sold_fees, 0) <> 0
union all
select c.company_id, c.id, c.number, d.issue_date, 'reparations', d.id, d.number,
       public._consignment_account(c.company_id, 'repairs'), 0,
       round(coalesce(c.sold_repairs, 0) * 100 / (100 + coalesce(c.sold_vat_rate, 21)), 2),
       'Depot-vente ' || c.number || ' : reparations HT'
  from c join public.documents d on d.id = c.commission_document_id where coalesce(c.sold_repairs, 0) <> 0
union all
-- Retenue : la facture au deposant est soldee par le compte d'entree depot (reglement DEP).
select c.company_id, c.id, c.number, p.paid_at::date, 'retenue', d.id, d.number,
       c.acc_deposit, p.amount, 0, 'Depot-vente ' || c.number || ' : facture au deposant retenue sur le prix de vente'
  from c join public.documents d on d.id = c.commission_document_id
  join public.document_payments p on p.document_id = d.id and p.method = 'DEP' and p.status = 'recu'
union all
-- Avoir au deposant : la dette envers lui, au debit du compte d'entree depot (au lieu de 70).
select c.company_id, c.id, c.number, d.issue_date, 'avoir_deposant', d.id, d.number,
       c.acc_deposit, -d.total_ht, 0, 'Depot-vente ' || c.number || ' : avoir au deposant (remplace le compte de ventes)'
  from c join public.documents d on d.id = c.credit_note_document_id
union all
-- Versement sans avoir (mouvement 03) : le net reverse solde le compte d'entree depot.
select c.company_id, c.id, c.number, m.occurred_at::date, 'versement', null, null,
       c.acc_deposit, m.amount, 0, 'Depot-vente ' || c.number || ' : versement au deposant (' || m.method || ')'
  from c join public.cash_movements m on m.id = c.payout_cash_movement_id
union all
-- Retour : frais factures au deposant.
select c.company_id, c.id, c.number, d.issue_date, 'frais_retour', d.id, d.number,
       public._consignment_account(c.company_id, 'return_fee'), 0, d.total_ht,
       'Depot-vente ' || c.number || ' : frais de retour HT'
  from c join public.documents d on d.id = c.return_document_id;

grant select on public.consignment_accounting_entries to authenticated;
comment on view public.consignment_accounting_entries is
  'M7/M12 (18/11/2026) : ecritures prevues des depots-vente pour le lot export comptable (compte d entree depot classe 4, commission, TVA commission via l export des ventes). Comptes : account_mappings dimension consignment. Rien n est exporte par cette vue.';
comment on function public.consignment_sell(uuid, jsonb) is
  'M7 VEN008 (18/11/2026) : vente d un depot-vente en une transaction : facture acheteur (FAC, moto D), facture au deposant (commission + frais + reparations, TVA), avoir option, decompte.';
