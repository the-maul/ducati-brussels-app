-- M6 — Caisse conforme au droit belge (03/11/2026, PDV010). Suppose 20261103150000_m6_caisse_audit.sql APPLIQUEE.
--
-- Ce que pose cette migration (etude docs/etudes/2026-11-caisse-legal-et-marche.md, section 1) :
--   1. Journal Z = journal des recettes (AR n. 1, art. 14 par. 2 et art. 15 par. 4 ; AR 13/12/2022) :
--      numero d ordre continu par societe et par caisse (sequence `Z` : Z-2026-00001), identification
--      de la caisse et de l etablissement, periode, totaux par taux de TVA, remises, remboursements,
--      CA net TVAC, encaissements par mode, lignes distinctes des ventes dont le prix unitaire depasse
--      500 EUR TTC, fond, especes theoriques / comptees / ecart avec motif obligatoire ; FIGE a la cloture
--      (`cash_sessions.z_report`), jamais recalcule. Le rapport X (session ouverte) n est pas numerote.
--   2. Ticket et reglement rattaches a la session de caisse (`documents.cash_session_id`,
--      `document_payments.cash_session_id`) ; un ticket ne se valide pas caisse fermee ; les especes ne
--      s encaissent pas caisse fermee ; le Z se calcule sur la session, plus sur une plage horaire.
--   3. Plafond legal des especes : 3 000 EUR par document (loi du 18/09/2017, art. 67), refus bloquant.
--   4. Un reglement ne se supprime jamais : contre-passation (reglement inverse, motif, auteur) ;
--      un reglement percu ne se modifie plus. L acompte reporte a la conversion (`transferred_from`)
--      n est pas un nouvel encaissement : hors caisse, hors plafond.
--   5. Facture obligatoire (AR n. 1, art. 1er par. 2, 1. et 9.) : un ticket qui contient un vehicule,
--      ou qui depasse 125 EUR TTC avec une piece / un accessoire / une prestation du vehicule, est refuse
--      (il faut un client et une facture). La qualification « du vehicule » vs « equipement du pilote »
--      se regle par famille d article (Parametres > Tables > Facture obligatoire par famille).
--
-- Les fonctions serveur (auth.uid() null : Shopify, Stripe) gardent la main. Rien n est applique
-- automatiquement : commande, apres accord et backup (regle 5.0), une fois 20261103150000 posee :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103170000_m6_caisse_legale.sql
-- Essai a blanc en production le 03/11/2026 (begin ; 20261103150000 + 20261103160000 + celle-ci ;
-- administrateur simule ; rollback) : ticket > 125 EUR avec piece R11 refuse, ticket 24,20 rattache a la
-- session, avoir du ticket sans client accepte, moto = 'vehicle', 3 500 EUR et 24,20 + 2 980 EUR en
-- especes refuses, suppression / modification d un percu refusees, contre-passation sans motif ou en
-- double refusee, ecart -5 EUR sans motif refuse, Z-2026-00001 fige (relu identique), reouverture
-- refusee, ticket et especes caisse fermee refuses, session suivante = Z-2026-00002. Rien conserve.

-- ---------------------------------------------------------------------
-- 1. Sequence du journal Z (par societe ; une seule caisse par societe aujourd hui).
-- ---------------------------------------------------------------------
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, 'Z', 'Z', 'Journal Z (cloture de caisse, journal des recettes)'
  from public.companies c
on conflict (company_id, doc_type) do nothing;

-- ---------------------------------------------------------------------
-- 2. Colonnes : caisse, numero de Z, motif d ecart ; rattachement des tickets et des reglements.
-- ---------------------------------------------------------------------
alter table public.cash_sessions
  add column if not exists register_code   text not null default 'CAISSE-1',   -- identification de la caisse
  add column if not exists z_number        text,                               -- numero d ordre du Z (cloture)
  add column if not exists variance_reason text;                               -- motif de l ecart de caisse
create unique index if not exists cash_sessions_z_number_uq
  on public.cash_sessions (company_id, z_number) where z_number is not null;

alter table public.documents
  add column if not exists cash_session_id uuid references public.cash_sessions(id) on delete restrict;
create index if not exists idx_documents_cash_session on public.documents(cash_session_id) where cash_session_id is not null;

alter table public.document_payments
  add column if not exists cash_session_id  uuid references public.cash_sessions(id) on delete restrict,
  add column if not exists reversal_of      uuid references public.document_payments(id) on delete restrict,  -- contre-passation
  add column if not exists transferred_from uuid references public.document_payments(id) on delete restrict;  -- acompte reporte
create index if not exists idx_docpay_cash_session on public.document_payments(cash_session_id) where cash_session_id is not null;
create unique index if not exists document_payments_reversal_uq on public.document_payments (reversal_of) where reversal_of is not null;

-- ---------------------------------------------------------------------
-- 3. Facture obligatoire par famille d article (reference_values, table `invoice_required_family`).
--    code = DEBUT du chemin de famille de l article (`articles.category_path`), insensible a la casse ;
--    le code le plus long qui correspond l emporte (« 03-02-02 » avant « 03 »,
--    « ACCESSOIRES ET EQUIPEMENTS/ACC AGV » avant « ACCESSOIRES ET EQUIPEMENTS »). Trois codages
--    coexistent en base au 03/11/2026 : rayons du tarif Ducati (R11 pieces, R12 accessoires, R13 / R15
--    vetements, R21 pneus...), familles G8 « RR-SS-CC » (01 motos, 02 pieces, 03 accessoires...) et
--    libelles « RAYON/SOUS-RAYON ».
--    extra.requires_invoice = true : piece / accessoire / prestation DU VEHICULE (AR n. 1, art. 1er par. 2, 9.) ;
--    false : equipement du pilote (casque, vetement, intercom), cadeaux, administratif.
--    Prechargement A VERIFIER AVEC DOMENICO (bible M06) ; famille absente de la table : ticket possible.
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select c.id, 'invoice_required_family', f.code, f.label, f.sort_order, true, jsonb_build_object('requires_invoice', f.req)
  from public.companies c
 cross join (values
   ('R11', 'Pieces Ducati', 10, true),
   ('R12', 'Accessoires Ducati (moto)', 20, true),
   ('R13', 'Vetements Ducati (equipement du pilote)', 30, false),
   ('R15', 'Vetements / merchandising Ducati (equipement du pilote)', 40, false),
   ('R16', 'Consommables et petites pieces Ducati', 50, true),
   ('R17', 'Pieces (autres fournisseurs)', 60, true),
   ('R18', 'Batteries', 70, true),
   ('R21', 'Pneumatiques', 80, true),
   ('01', 'Produits finis neufs (motos, scooters)', 90, true),
   ('02', 'Pieces de rechange', 100, true),
   ('03', 'Accessoires et equipements (par defaut : du vehicule)', 110, true),
   ('03-01', 'ACC SUOMY (casques : equipement du pilote)', 120, false),
   ('03-02-02', 'ACC DUCATI vetements (equipement du pilote)', 130, false),
   ('03-02-03', 'ACC DUCATI marchandising (cadeaux)', 140, false),
   ('03-05', 'ACC ALPINESTAR (vetements : equipement du pilote)', 150, false),
   ('03-12', 'ACC AGV (casques : equipement du pilote)', 160, false),
   ('03-18', 'ACC BELL (casques : equipement du pilote)', 170, false),
   ('03-25', 'ACC CARDO (intercoms : equipement du pilote)', 180, false),
   ('03-31', 'ACC SCORPION (casques : equipement du pilote)', 190, false),
   ('03-40', 'ACC IXON (vetements : equipement du pilote)', 200, false),
   ('03-56', 'ACC N COM (intercoms : equipement du pilote)', 210, false),
   ('03-69', 'ACC REVIT (vetements : equipement du pilote)', 220, false),
   ('03-83', 'ACC X-LITE (casques : equipement du pilote)', 230, false),
   ('03-91', 'ACC SENA (intercoms : equipement du pilote)', 240, false),
   ('03-96', 'ACC NOLAN (casques : equipement du pilote)', 250, false),
   ('04', 'Lubrifiants / nettoyants', 260, true),
   ('05', 'Main d oeuvre et forfaits (travaux)', 270, true),
   ('06', 'Depots-ventes', 280, true),
   ('07', 'Reprises occasions', 290, true),
   ('08', 'Occasions', 300, true),
   ('09', 'Pneumatiques', 310, true),
   ('10', 'Administratif', 320, false),
   ('11', 'Courtoisie / location', 330, false),
   ('99', 'Divers', 340, false),
   ('PIECES DE RECHANGE', 'Pieces de rechange (libelle)', 350, true),
   ('ACCESSOIRES ET EQUIPEMENTS', 'Accessoires et equipements (libelle)', 360, true),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC SUOMY', 'Casques SUOMY (libelle, equipement du pilote)', 370, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC ALPINESTAR', 'Vetements ALPINESTAR (libelle, equipement du pilote)', 380, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC AGV', 'Casques AGV (libelle, equipement du pilote)', 390, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC BELL', 'Casques BELL (libelle, equipement du pilote)', 400, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC CARDO', 'Intercoms CARDO (libelle, equipement du pilote)', 410, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC SCORPION', 'Casques SCORPION (libelle, equipement du pilote)', 420, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC IXON', 'Vetements IXON (libelle, equipement du pilote)', 430, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC N COM', 'Intercoms N COM (libelle, equipement du pilote)', 440, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC REVIT', 'Vetements REVIT (libelle, equipement du pilote)', 450, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC X-LITE', 'Casques X-LITE (libelle, equipement du pilote)', 460, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC SENA', 'Intercoms SENA (libelle, equipement du pilote)', 470, false),
   ('ACCESSOIRES ET EQUIPEMENTS/ACC NOLAN', 'Casques NOLAN (libelle, equipement du pilote)', 480, false)
 ) as f(code, label, sort_order, req)
on conflict (company_id, table_key, code) do nothing;

-- Une famille (debut de `category_path`) ou un type de gestion impose-t-il la facture ?
-- Main d oeuvre (type T) = travaux sur le vehicule. Famille inconnue : ticket possible.
create or replace function public._family_requires_invoice(_company uuid, _path text, _mgmt text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when _mgmt = 'T' then true
    when _path is null or btrim(_path) = '' then false
    else coalesce((
      select (rv.extra->>'requires_invoice')::boolean
        from public.reference_values rv
       where rv.company_id = _company and rv.table_key = 'invoice_required_family' and rv.is_active
         and btrim(rv.code) <> ''
         and left(upper(btrim(_path)), length(btrim(rv.code))) = upper(btrim(rv.code))
       order by length(btrim(rv.code)) desc
       limit 1
    ), false)
  end;
$$;
revoke all on function public._family_requires_invoice(uuid, text, text) from public, anon, authenticated;

-- Pourquoi un document doit etre une facture : 'vehicle' (moto, quel que soit le montant),
-- 'threshold' (> 125 EUR TTC avec une piece / un accessoire / une prestation du vehicule), sinon null.
-- Version interne : le TTC est passe par l appelant (le trigger de validation lit NEW.total_ttc).
create or replace function public._document_invoice_reason(_document uuid, _company uuid, _ttc numeric)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _vehicle boolean; _flagged boolean;
begin
  select exists (
    select 1 from public.document_lines l join public.articles a on a.id = l.article_id
     where l.document_id = _document and l.quantity > 0 and a.mgmt_type::text in ('V', 'O', 'P', 'D')
  ) into _vehicle;
  if _vehicle then return 'vehicle'; end if;
  if coalesce(_ttc, 0) <= 125 then return null; end if;
  select exists (
    select 1 from public.document_lines l join public.articles a on a.id = l.article_id
     where l.document_id = _document and l.quantity > 0
       and public._family_requires_invoice(_company, a.category_path, a.mgmt_type::text)
  ) into _flagged;
  return case when _flagged then 'threshold' else null end;
end $$;
revoke all on function public._document_invoice_reason(uuid, uuid, numeric) from public, anon, authenticated;

create or replace function public.document_invoice_required(_document uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _company uuid; _ttc numeric;
begin
  select company_id, total_ttc into _company, _ttc from public.documents where id = _document;
  if _company is null then return null; end if;
  if not public.is_member(_company) then raise exception 'Acces refuse'; end if;
  return public._document_invoice_reason(_document, _company, _ttc);
end $$;
grant execute on function public.document_invoice_required(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Documents : ticket rattache a la caisse ouverte a la validation ; facture obligatoire.
-- ---------------------------------------------------------------------
create or replace function public.documents_cash_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _sid uuid; _st text; _why text;
begin
  if auth.uid() is null then return new; end if;                        -- fonctions serveur
  if tg_op = 'UPDATE' and old.status <> 'brouillon' and new.cash_session_id is distinct from old.cash_session_id then
    raise exception 'Le document % est valide : sa session de caisse ne change plus.', old.number using errcode = '23514';
  end if;
  if not (new.status = 'validee' and (tg_op = 'INSERT' or old.status = 'brouillon')) then return new; end if;

  if new.doc_type = 'TIK' then
    if new.cash_session_id is null then
      select id into _sid from public.cash_sessions where company_id = new.company_id and status = 'open' limit 1;
      if _sid is null then
        raise exception 'Aucune caisse ouverte : ouvrez la caisse (Caisse > Caisse & cloture Z) avant d encaisser un ticket.' using errcode = '23514';
      end if;
      new.cash_session_id := _sid;
    end if;
    _why := public._document_invoice_reason(new.id, new.company_id, new.total_ttc);
    if _why = 'vehicle' then
      raise exception 'Vente d un vehicule : la loi impose une facture (AR n. 1, art. 1er, par. 2, 1.). Choisissez un client et emettez une facture.' using errcode = '23514';
    elsif _why = 'threshold' then
      raise exception 'Ticket de % EUR TTC avec une piece, un accessoire ou une prestation du vehicule : au-dela de 125 EUR, la loi impose une facture (AR n. 1, art. 1er, par. 2, 9.). Choisissez un client et emettez une facture.', new.total_ttc using errcode = '23514';
    end if;
  end if;

  if new.cash_session_id is not null then
    select status into _st from public.cash_sessions where id = new.cash_session_id;
    if _st is distinct from 'open' then
      raise exception 'Session de caisse cloturee : le document ne peut pas s y rattacher.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.documents_cash_guard() from public, anon, authenticated;
drop trigger if exists trg_documents_cash_guard on public.documents;
create trigger trg_documents_cash_guard before insert or update on public.documents
  for each row execute function public.documents_cash_guard();

-- ---------------------------------------------------------------------
-- 5. Reglements : rattaches a la caisse ouverte, especes seulement caisse ouverte, plafond 3 000 EUR,
--    jamais supprimes, percu immuable, contre-passation controlee.
-- ---------------------------------------------------------------------
create or replace function public.document_payments_cash_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _number text; _sid uuid; _st text; _esp numeric; _orig record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;        -- fonctions serveur
  if tg_op = 'DELETE' then
    -- Suppression en cascade d un brouillon / d un devis purge (le document n existe deja plus) et
    -- abandon d un reglement jamais percu (QR annule, `qr_payment_cancel`) : rien n est entre en caisse.
    if old.status <> 'recu' or not exists (select 1 from public.documents where id = old.document_id) then
      return old;
    end if;
    raise exception 'Un reglement percu ne se supprime pas : annulez-le par une contre-passation (reglement inverse motive).' using errcode = '23514';
  end if;
  select company_id, number into _company, _number from public.documents where id = new.document_id;

  if tg_op = 'UPDATE' then
    if old.status = 'recu' then
      raise exception 'Reglement percu sur % : il ne se modifie plus, il s annule par une contre-passation.', coalesce(_number, old.document_id::text) using errcode = '23514';
    end if;
    if new.amount is distinct from old.amount or new.method is distinct from old.method
       or new.document_id is distinct from old.document_id or new.reversal_of is distinct from old.reversal_of
       or new.transferred_from is distinct from old.transferred_from then
      raise exception 'Un reglement attendu ne change ni de montant, ni de mode, ni de document : annulez-le et ressaisissez-le.' using errcode = '23514';
    end if;
    if new.status not in ('attendu', 'recu', 'annule') then
      raise exception 'Statut de reglement inconnu : %', new.status using errcode = '23514';
    end if;
    if new.status = 'recu' and old.status = 'attendu' then
      -- « Marquer percu » : l argent entre aujourd hui, dans la caisse ouverte s il y en a une.
      new.paid_at := now();
      select id into _sid from public.cash_sessions where company_id = _company and status = 'open' limit 1;
      new.cash_session_id := _sid;
      if new.method = 'ESP' and _sid is null then
        raise exception 'Aucune caisse ouverte : les especes passent par le tiroir. Ouvrez la caisse avant d encaisser.' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- INSERT
  if new.status not in ('attendu', 'recu') then
    raise exception 'Statut de reglement inconnu : %', new.status using errcode = '23514';
  end if;
  if new.transferred_from is not null then
    -- Acompte reporte a la conversion : pas un nouvel encaissement (hors caisse, hors plafond).
    new.cash_session_id := null;
    return new;
  end if;
  if new.status = 'recu' then
    select id into _sid from public.cash_sessions where company_id = _company and status = 'open' limit 1;
    if new.cash_session_id is null then new.cash_session_id := _sid; end if;
    if new.cash_session_id is not null then
      select status into _st from public.cash_sessions where id = new.cash_session_id;
      if _st is distinct from 'open' then
        raise exception 'Session de caisse cloturee : le reglement ne peut pas s y rattacher.' using errcode = '23514';
      end if;
    end if;
    if new.method = 'ESP' and new.cash_session_id is null then
      raise exception 'Aucune caisse ouverte : les especes passent par le tiroir. Ouvrez la caisse avant d encaisser.' using errcode = '23514';
    end if;
    -- Plafond legal des especes (loi du 18/09/2017, art. 67) : 3 000 EUR par vente, acomptes compris.
    if new.method = 'ESP' and new.amount > 0 then
      select coalesce(sum(amount), 0) into _esp from public.document_payments
       where document_id = new.document_id and method = 'ESP' and status = 'recu';
      if _esp + new.amount > 3000 then
        raise exception 'Plafond legal des especes depasse : % EUR en especes sur ce document (maximum 3 000 EUR par vente, loi du 18/09/2017, art. 67). Encaissez le solde par carte ou virement.', round(_esp + new.amount, 2) using errcode = '23514';
      end if;
    end if;
  end if;
  if new.reversal_of is not null then
    select * into _orig from public.document_payments where id = new.reversal_of;
    if _orig is null or _orig.document_id <> new.document_id or _orig.status <> 'recu' then
      raise exception 'Contre-passation impossible : le reglement d origine doit etre un reglement percu du meme document.' using errcode = '23514';
    end if;
    if new.status <> 'recu' or round(new.amount, 2) <> round(-_orig.amount, 2) or new.method <> _orig.method then
      raise exception 'Contre-passation : meme mode et montant exactement inverse (% %).', -_orig.amount, _orig.method using errcode = '23514';
    end if;
    if coalesce(btrim(new.note), '') = '' then
      raise exception 'Contre-passation : le motif est obligatoire.' using errcode = '23514';
    end if;
    if exists (select 1 from public.document_payments where reversal_of = new.reversal_of) then
      raise exception 'Ce reglement est deja contre-passe.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.document_payments_cash_guard() from public, anon, authenticated;
drop trigger if exists trg_document_payments_cash_guard on public.document_payments;
create trigger trg_document_payments_cash_guard before insert or update or delete on public.document_payments
  for each row execute function public.document_payments_cash_guard();

-- ---------------------------------------------------------------------
-- 6. Journal Z par session (X tant que la session est ouverte, Z fige a la cloture).
-- ---------------------------------------------------------------------
create or replace function public._cash_z_build(_s public.cash_sessions, _closed_at timestamptz, _number text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _r jsonb; _co record; _esp numeric; _in numeric; _out numeric; _expected numeric;
begin
  select name, legal_name, vat_number, address, zip, city into _co from public.companies where id = _s.company_id;
  select coalesce(sum(p.amount), 0) into _esp from public.document_payments p
   where p.cash_session_id = _s.id and p.status = 'recu' and p.method = 'ESP';
  select coalesce(sum(amount), 0) into _in  from public.cash_movements where session_id = _s.id and kind = 'in'  and method = 'ESP';
  select coalesce(sum(amount), 0) into _out from public.cash_movements where session_id = _s.id and kind = 'out' and method = 'ESP';
  _expected := round(_s.opening_float + _esp + _in - _out, 2);

  select jsonb_build_object(
    'version', 2,
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
    -- Documents de la session (nombre et TTC par type) : FAC, TIK, AVO valides, payes ou annules par avoir.
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('doc_type', doc_type, 'count', n, 'total_ttc', ttc) order by doc_type)
      from (select d.doc_type, count(*) as n, round(sum(d.total_ttc), 2) as ttc
              from public.documents d
             where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'annulee')
             group by d.doc_type) x
    ), '[]'::jsonb),
    'ticket_count', (select count(*) from public.documents d where d.cash_session_id = _s.id and d.doc_type = 'TIK' and d.status in ('validee', 'payee', 'annulee')),
    -- Totaux par taux de TVA (base HT, TVA, TTC) des ventes de la session, avoirs en negatif.
    'vat_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('vat_rate', vat_rate, 'base_ht', base_ht, 'vat', vat, 'ttc', ttc) order by vat_rate)
      from (select l.vat_rate, round(sum(l.line_ht), 2) as base_ht, round(sum(l.line_ttc - l.line_ht), 2) as vat, round(sum(l.line_ttc), 2) as ttc
              from public.document_lines l join public.documents d on d.id = l.document_id
             where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'annulee')
             group by l.vat_rate) v
    ), '[]'::jsonb),
    -- Remises (HT) : remises de ligne + remises globales.
    'discounts_ht', coalesce((
      select round(sum(l.quantity * l.unit_price_ht * coalesce(l.discount_pct, 0) / 100), 2)
        from public.document_lines l join public.documents d on d.id = l.document_id
       where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'annulee')
    ), 0) + coalesce((
      select round(sum(case when d.global_discount_pct > 0 then (select sum(l.line_ht) from public.document_lines l where l.document_id = d.id) * d.global_discount_pct / 100
                            else d.global_discount_amount end), 2)
        from public.documents d
       where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'annulee')
    ), 0),
    -- Remboursements / avoirs (TTC, negatif) et chiffre d affaires net TVAC.
    'refunds_ttc', coalesce((select round(sum(d.total_ttc), 2) from public.documents d
                             where d.cash_session_id = _s.id and d.doc_type = 'AVO' and d.status in ('validee', 'payee', 'annulee')), 0),
    'net_sales_ttc', coalesce((select round(sum(d.total_ttc), 2) from public.documents d
                               where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'annulee')), 0),
    -- Lignes distinctes : toute livraison dont le prix unitaire depasse 500 EUR TTC (AR n. 1, art. 14 par. 2, 3.).
    'large_items', coalesce((
      select jsonb_agg(jsonb_build_object('number', d.number, 'doc_type', d.doc_type, 'issue_date', d.issue_date,
                                          'designation', l.designation, 'quantity', l.quantity, 'line_ttc', l.line_ttc)
                       order by d.number, l.sort_order)
        from public.document_lines l join public.documents d on d.id = l.document_id
       where d.cash_session_id = _s.id and d.doc_type in ('FAC', 'TIK', 'AVO') and d.status in ('validee', 'payee', 'annulee')
         and l.quantity <> 0 and abs(l.line_ttc / l.quantity) > 500
    ), '[]'::jsonb),
    -- Encaissements par mode (ventes FAC / TIK, acomptes RES / BC, avoirs AVO), libelle du mode.
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

-- Rapport X (session ouverte, recalcule) ou Z fige (session cloturee : le JSON de la cloture, jamais recalcule).
create or replace function public.cash_z_report_session(_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _s public.cash_sessions;
begin
  select * into _s from public.cash_sessions where id = _session;
  if _s.id is null then raise exception 'Session de caisse introuvable'; end if;
  if not public.is_member(_s.company_id) then raise exception 'Acces refuse'; end if;
  if _s.status = 'closed' and _s.z_report is not null then return _s.z_report; end if;
  return public._cash_z_build(_s, now(), null);
end $$;
grant execute on function public.cash_z_report_session(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Cloture : numero de Z, especes attendues, motif d ecart obligatoire, Z fige (remplace la version
--    de 20261103150000, qui calculait le Z sur la plage horaire).
-- ---------------------------------------------------------------------
create or replace function public.cash_sessions_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _z jsonb;
begin
  if tg_op = 'DELETE' then
    if old.status = 'closed' then
      raise exception 'Session de caisse cloturee le % : elle ne se supprime pas.', old.closed_at using errcode = '23514';
    end if;
    return old;
  end if;
  if old.status = 'closed' then
    raise exception 'Session de caisse cloturee le % (journal %) : elle ne se modifie plus et ne se rouvre pas.', old.closed_at, old.z_number using errcode = '23514';
  end if;
  if new.register_code is distinct from old.register_code then
    raise exception 'La caisse d une session ne change pas.' using errcode = '23514';
  end if;
  if new.status = 'closed' then
    if new.counted_cash is null then
      raise exception 'Cloture : comptez les especes du tiroir avant de cloturer.' using errcode = '23514';
    end if;
    new.closed_at := coalesce(new.closed_at, now());
    new.closed_by := coalesce(new.closed_by, auth.uid());
    new.z_number  := public.next_document_number(new.company_id, 'Z');
    _z := public._cash_z_build(new, new.closed_at, new.z_number);
    new.expected_cash := (_z->>'expected_cash')::numeric;
    if round(new.counted_cash - new.expected_cash, 2) <> 0 and coalesce(btrim(new.variance_reason), '') = '' then
      raise exception 'Ecart de caisse de % EUR (theorique % EUR, compte % EUR) : indiquez le motif de l ecart avant de cloturer.',
        round(new.counted_cash - new.expected_cash, 2), new.expected_cash, new.counted_cash using errcode = '23514';
    end if;
    new.z_report := _z;
  end if;
  return new;
end $$;
revoke all on function public.cash_sessions_guard() from public, anon, authenticated;
drop trigger if exists trg_cash_sessions_guard on public.cash_sessions;
create trigger trg_cash_sessions_guard before update or delete on public.cash_sessions
  for each row execute function public.cash_sessions_guard();

-- ---------------------------------------------------------------------
-- 8. Avoir d un ticket anonyme (remboursement au comptoir) : sans client, comme le ticket.
--    Reprend `documents_require_client_and_lines` de 20261031130000 (appliquee en production) en
--    ajoutant la seule exception de l avoir d un ticket.
-- ---------------------------------------------------------------------
create or replace function public.documents_require_client_and_lines()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare nb int; _src text;
begin
  if new.status not in ('validee', 'payee') then return new; end if;
  if new.imported_from is not null then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('validee', 'payee') and new.contact_id is not distinct from old.contact_id then
    return new;
  end if;
  if new.contact_id is null and new.doc_type <> 'TIK' then
    select doc_type into _src from public.documents where id = new.source_document_id;
    if not (new.doc_type = 'AVO' and _src = 'TIK') then
      raise exception 'Choisissez un client avant de valider ce % (un brouillon peut rester sans client).', new.doc_type
        using errcode = '23514';
    end if;
  end if;
  select count(*) into nb from public.document_lines l where l.document_id = new.id and l.line_type <> 'vide';
  if nb = 0 then
    raise exception 'Aucune ligne sur ce % : ajoutez au moins une ligne avant de valider.', new.doc_type
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.documents_require_client_and_lines() from public, anon, authenticated;

comment on column public.cash_sessions.z_number is 'M6 PDV010 : numero d ordre continu du journal Z (sequence Z par societe), pris a la cloture.';
comment on column public.cash_sessions.z_report is 'M6 PDV010 : journal Z fige a la cloture (journal des recettes, AR n. 1 art. 14) ; jamais recalcule.';
comment on column public.documents.cash_session_id is 'M6 PDV010 : session de caisse du ticket / de la facture comptoir (obligatoire pour un TIK).';
comment on column public.document_payments.reversal_of is 'M6 PDV010 : contre-passation du reglement vise (montant inverse, motif dans note).';
comment on column public.document_payments.transferred_from is 'M6 PDV010 : acompte reporte a la conversion (pas un nouvel encaissement).';
comment on function public.cash_z_report_session(uuid) is 'M6 PDV010 : rapport X (session ouverte) ou journal Z fige (session cloturee).';
comment on function public.document_invoice_required(uuid) is 'M6 PDV010 : facture obligatoire (vehicule ; > 125 EUR TTC avec piece / accessoire / prestation du vehicule).';
