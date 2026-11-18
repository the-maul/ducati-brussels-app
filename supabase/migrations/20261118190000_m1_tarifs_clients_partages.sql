-- =====================================================================
-- M1 / M6 — Rattrapage G8 du 18/11/2026 (lot « regles client »)
--
-- 1. TARIFS CLIENTS COMMUNS (G8 : Fichiers > Clients > Ajout/Modif/Suppr Tarif client) :
--    un tarif nomme (code, libelle, ex. « 15 = REMISE 15 % ») partage par plusieurs clients,
--    avec un tarif de base (« dependances tarifaires » : ce que le tarif ne precise pas est pris
--    dans sa base), une promotion, « afficher la remise », et des lignes par references /
--    fournisseurs / familles / marques (ou tout le catalogue), 4 paliers de quantite, coefficient
--    (PA x coef = PV HT), remise % ou prix net, dates de debut / fin.
--    Le calcul du prix est fait par l'application (src/modules/sales/customer-pricing.ts, teste) ;
--    la base ne fait que stocker et controler.
-- 2. contacts.price_list_id : le tarif du client ; contacts.credit_limit_blocking : l'encours
--    autorise bloque la vente a credit au-dela (sinon simple alerte).
-- 3. CLIENT BLOQUE (G8 : « Client bloque ») : la validation d'une vente (FAC, TIK, RES, BL, BC)
--    pour un client bloque est refusee par la base (trigger), pas seulement par l'ecran.
--    Un devis / proforma reste possible ; un avoir aussi.
-- 4. contact_open_balance : encours reel du client (FAC / TIK / FAA valides, hors brouillons,
--    hors documents compenses par un avoir), pour l'alerte et le blocage d'encours.
--
-- Idempotente. A appliquer apres le bloc du 03/11 (aucune dependance stricte : seules les tables
-- contacts, documents, articles, companies et les fonctions is_member / audit_row / set_updated_at
-- sont utilisees, toutes en production depuis juin 2026).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tarifs communs
-- ---------------------------------------------------------------------
create table if not exists public.price_lists (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  code          text not null,
  label         text,
  base_list_id  uuid references public.price_lists(id) on delete set null,
  is_promo      boolean not null default false,
  show_discount boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  constraint price_lists_code_not_blank check (length(btrim(code)) > 0),
  constraint price_lists_not_own_base check (base_list_id is null or base_list_id <> id)
);
create unique index if not exists price_lists_company_code_uq on public.price_lists (company_id, lower(btrim(code)));
create index if not exists price_lists_company_idx on public.price_lists (company_id);

comment on table public.price_lists is 'M1 (G8 Tarif client) : tarif nomme partage par plusieurs clients ; base_list_id = tarif de base (dependance tarifaire).';
comment on column public.price_lists.show_discount is 'G8 « Afficher la remise » : la remise apparait sur la ligne (PU catalogue + remise %) au lieu d un prix net.';
comment on column public.price_lists.is_promo is 'G8 « Promotion » : tarif promotionnel (badge a la vente).';

create table if not exists public.price_list_rules (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  price_list_id  uuid not null references public.price_lists(id) on delete cascade,
  scope          text not null default 'all',
  article_id     uuid references public.articles(id) on delete cascade,
  supplier_id    uuid references public.contacts(id) on delete cascade,
  family_code    text,
  brand          text,
  kind           text not null default 'discount',
  tiers          jsonb not null default '[{"min_qty": 1, "value": 0}]'::jsonb,
  date_from      date,
  date_to        date,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  constraint price_list_rules_scope_ck check (scope in ('all', 'reference', 'supplier', 'family', 'brand')),
  constraint price_list_rules_kind_ck check (kind in ('discount', 'coefficient', 'net')),
  constraint price_list_rules_tiers_ck check (case when jsonb_typeof(tiers) = 'array' then jsonb_array_length(tiers) between 1 and 4 else false end),
  constraint price_list_rules_dates_ck check (date_from is null or date_to is null or date_to >= date_from),
  constraint price_list_rules_reference_ck check ((scope = 'reference') = (article_id is not null)),
  constraint price_list_rules_supplier_ck check ((scope = 'supplier') = (supplier_id is not null)),
  constraint price_list_rules_family_ck check ((scope = 'family') = (nullif(btrim(coalesce(family_code, '')), '') is not null)),
  constraint price_list_rules_brand_ck check ((scope = 'brand') = (nullif(btrim(coalesce(brand, '')), '') is not null))
);
create index if not exists price_list_rules_list_idx on public.price_list_rules (price_list_id);
create index if not exists price_list_rules_list_article_idx on public.price_list_rules (price_list_id, article_id);
create index if not exists price_list_rules_company_idx on public.price_list_rules (company_id);

comment on table public.price_list_rules is 'M1 (G8 grille du tarif client) : portee reference / fournisseur / famille (debut du chemin de famille) / marque / tout ; kind discount (remise %), coefficient (PA x coef = PV HT), net (PV HT fixe) ; tiers = 1 a 4 paliers {min_qty, value} ; dates de validite.';

-- Controles : meme societe partout, tarif de base sans boucle, paliers bien formes.
create or replace function public.price_lists_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _cur uuid; _co uuid; _n int := 0;
begin
  if new.base_list_id is not null then
    select company_id into _co from public.price_lists where id = new.base_list_id;
    if _co is null or _co <> new.company_id then
      raise exception 'Tarif de base introuvable dans cette societe.' using errcode = '23514';
    end if;
    _cur := new.base_list_id;
    while _cur is not null and _n < 20 loop
      if _cur = new.id then
        raise exception 'Tarif de base : le tarif % depend deja de celui-ci (boucle).', new.code using errcode = '23514';
      end if;
      select base_list_id into _cur from public.price_lists where id = _cur;
      _n := _n + 1;
    end loop;
  end if;
  new.code := btrim(new.code);
  return new;
end $$;
revoke all on function public.price_lists_guard() from public, anon, authenticated;

drop trigger if exists trg_price_lists_guard on public.price_lists;
create trigger trg_price_lists_guard before insert or update on public.price_lists
  for each row execute function public.price_lists_guard();

create or replace function public.price_list_rules_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _co uuid; _t jsonb;
begin
  select company_id into _co from public.price_lists where id = new.price_list_id;
  if _co is null or _co <> new.company_id then
    raise exception 'Ligne de tarif : tarif introuvable dans cette societe.' using errcode = '23514';
  end if;
  if new.article_id is not null and not exists (select 1 from public.articles a where a.id = new.article_id and a.company_id = new.company_id) then
    raise exception 'Ligne de tarif : article introuvable dans cette societe.' using errcode = '23514';
  end if;
  if new.supplier_id is not null and not exists (select 1 from public.contacts c where c.id = new.supplier_id and c.company_id = new.company_id) then
    raise exception 'Ligne de tarif : fournisseur introuvable dans cette societe.' using errcode = '23514';
  end if;
  for _t in select * from jsonb_array_elements(new.tiers) loop
    if coalesce(jsonb_typeof(_t -> 'min_qty'), '') <> 'number' or coalesce(jsonb_typeof(_t -> 'value'), '') <> 'number'
       or (_t ->> 'min_qty')::numeric <= 0 or (_t ->> 'value')::numeric < 0 then
      raise exception 'Ligne de tarif : chaque palier a une quantite minimum > 0 et une valeur >= 0.' using errcode = '23514';
    end if;
    if new.kind = 'discount' and (_t ->> 'value')::numeric > 100 then
      raise exception 'Ligne de tarif : une remise ne depasse pas 100 %%.' using errcode = '23514';
    end if;
  end loop;
  new.family_code := nullif(btrim(coalesce(new.family_code, '')), '');
  new.brand := nullif(btrim(coalesce(new.brand, '')), '');
  return new;
end $$;
revoke all on function public.price_list_rules_guard() from public, anon, authenticated;

drop trigger if exists trg_price_list_rules_guard on public.price_list_rules;
create trigger trg_price_list_rules_guard before insert or update on public.price_list_rules
  for each row execute function public.price_list_rules_guard();

drop trigger if exists trg_price_lists_updated on public.price_lists;
create trigger trg_price_lists_updated before update on public.price_lists
  for each row execute function public.set_updated_at();
drop trigger if exists trg_price_list_rules_updated on public.price_list_rules;
create trigger trg_price_list_rules_updated before update on public.price_list_rules
  for each row execute function public.set_updated_at();

-- Trace (events) de toute creation / modification / suppression de tarif (regle 4).
drop trigger if exists trg_price_lists_audit on public.price_lists;
create trigger trg_price_lists_audit after insert or update or delete on public.price_lists
  for each row execute function public.audit_row();
drop trigger if exists trg_price_list_rules_audit on public.price_list_rules;
create trigger trg_price_list_rules_audit after insert or update or delete on public.price_list_rules
  for each row execute function public.audit_row();

alter table public.price_lists enable row level security;
alter table public.price_list_rules enable row level security;
drop policy if exists price_lists_select on public.price_lists;
create policy price_lists_select on public.price_lists for select to authenticated using (public.is_member(company_id));
drop policy if exists price_lists_write on public.price_lists;
create policy price_lists_write on public.price_lists for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists price_list_rules_select on public.price_list_rules;
create policy price_list_rules_select on public.price_list_rules for select to authenticated using (public.is_member(company_id));
drop policy if exists price_list_rules_write on public.price_list_rules;
create policy price_list_rules_write on public.price_list_rules for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

grant select, insert, update, delete on public.price_lists, public.price_list_rules to authenticated;
revoke all on public.price_lists, public.price_list_rules from anon;

-- ---------------------------------------------------------------------
-- 2. Fiche client : tarif et encours bloquant
-- ---------------------------------------------------------------------
alter table public.contacts add column if not exists price_list_id uuid references public.price_lists(id) on delete set null;
alter table public.contacts add column if not exists credit_limit_blocking boolean not null default false;
create index if not exists contacts_price_list_idx on public.contacts (price_list_id) where price_list_id is not null;
comment on column public.contacts.price_list_id is 'M1 (G8 « Tarif ») : tarif commun du client (price_lists). L ancienne colonne texte price_list (reprise G8) sert de repli : meme code ou meme libelle.';
comment on column public.contacts.credit_limit_blocking is 'M1 (G8 « Encours autorise », cadenas) : au-dela de credit_limit, une facture / un BL a credit est refuse a l ecran ; sinon simple alerte.';

create or replace function public.contacts_price_list_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.price_list_id is not null and not exists (
    select 1 from public.price_lists p where p.id = new.price_list_id and p.company_id = new.company_id
  ) then
    raise exception 'Tarif client introuvable dans cette societe.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.contacts_price_list_guard() from public, anon, authenticated;
drop trigger if exists trg_contacts_price_list_guard on public.contacts;
create trigger trg_contacts_price_list_guard before insert or update of price_list_id on public.contacts
  for each row execute function public.contacts_price_list_guard();

-- ---------------------------------------------------------------------
-- 3. Client bloque : vente refusee par la base
-- ---------------------------------------------------------------------
create or replace function public.documents_blocked_client_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _blocked boolean; _name text;
begin
  -- Imports, fonctions serveur (commandes du site, taches planifiees) : non concernes.
  if auth.uid() is null or new.imported_from is not null or new.contact_id is null then return new; end if;
  if new.status not in ('validee', 'payee') then return new; end if;
  -- Seul le passage brouillon -> valide (ou une creation directement validee) est controle.
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'brouillon' then return new; end if;
  if new.doc_type not in ('FAC', 'TIK', 'RES', 'BL', 'BC') then return new; end if;
  select c.is_blocked, coalesce(nullif(btrim(c.company_name), ''), btrim(concat_ws(' ', c.last_name, c.first_name)))
    into _blocked, _name
    from public.contacts c where c.id = new.contact_id;
  if coalesce(_blocked, false) then
    raise exception 'Client bloque (%) : la vente est refusee. Debloquez le client sur sa fiche pour continuer (un devis reste possible).', _name
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.documents_blocked_client_guard() from public, anon, authenticated;
drop trigger if exists trg_documents_blocked_client_guard on public.documents;
create trigger trg_documents_blocked_client_guard before insert or update of status on public.documents
  for each row execute function public.documents_blocked_client_guard();

-- ---------------------------------------------------------------------
-- 4. Encours reel du client
-- ---------------------------------------------------------------------
create or replace function public.contact_open_balance(_contact uuid, _exclude uuid default null)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _co uuid; _due numeric;
begin
  select company_id into _co from public.contacts where id = _contact;
  if _co is null then return 0; end if;
  if auth.uid() is not null and not public.is_member(_co) then raise exception 'Acces refuse'; end if;
  select coalesce(sum(greatest(d.total_ttc - d.paid_amount, 0)), 0) into _due
    from public.documents d
   where d.contact_id = _contact and d.company_id = _co
     and d.doc_type in ('FAC', 'TIK', 'FAA')
     and d.status in ('validee', 'payee')
     and (_exclude is null or d.id <> _exclude);
  return round(_due, 2);
end $$;
revoke all on function public.contact_open_balance(uuid, uuid) from public, anon;
grant execute on function public.contact_open_balance(uuid, uuid) to authenticated, service_role;
comment on function public.contact_open_balance(uuid, uuid) is 'M1 : reste du par le client sur ses factures / tickets / factures d acompte valides (hors brouillons, hors documents compenses par un avoir).';

notify pgrst, 'reload schema';
