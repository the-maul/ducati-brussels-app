-- M12 — Rattrapage G8 (18/11/2026, lot-g8-export-compta) : export comptable au format « EBP » identique
-- à G8 (ECRITURES.TXT + COMPTES.TXT), paramétrage des comptes façon G8, historique et annulation des
-- transferts, marquage « transféré », transfert automatique planifié (désactivé par défaut).
-- Réf. docs/g8-inventaire/export-comptable-g8.md, 08-compta-stats.md, 09-parametres.md (Utilitaires >
-- Comptabilité), comparaison-ventes-caisse-compta.md §4 et bloquant n° 2. Exigences COM000, COM001.
--
-- Décision de Simon (18/11/2026) : tant que Falco n'est pas branché, l'export EBP est LA voie officielle
-- vers le comptable, actif par défaut, avec les options de G8. L'UBL reste un simple téléchargement.
--
-- Contenu :
--   1. accounting_transfer_settings  : paramètres du transfert (G8 « Paramètres transfert comptable »,
--      7 onglets), un jeu par société, en jsonb (défauts G8 côté code : parseEbpSettings) ;
--   2. accounting_account_rules      : G8 « Gestion des comptes » (ventes, achats, cessions, TVA,
--      règlements, mouvements de fond de caisse) ; règlements et mouvements G8 posés par défaut ;
--   3. accounting_third_accounts     : comptes clients (2000xx / 201xxx) et fournisseurs (40100xxx) ;
--   4. accounting_transfers          : historique (n°, date, période, fichiers, annulé) ;
--   5. accounting_transfer_items     : ce que chaque transfert a emporté (document, règlement, mouvement,
--      achat, cession, commission de dépôt-vente) ; un élément ne part qu'une fois (index unique partiel),
--      une annulation le rend de nouveau transférable ;
--   6. fonctions : record_accounting_transfer, cancel_accounting_transfer (comptable / admin, motif
--      obligatoire, tracé dans events), ebp_payments_to_transfer, accounting_create_third_accounts ;
--   7. tâche planifiée « accounting-auto-transfer » (posée seulement si pg_cron et le secret Vault
--      « cron_secret » existent ; ne fait rien tant que la fréquence est « off », la valeur par défaut).
--
-- Accès : rôle comptable ou administrateur de la société (grille des droits, page Comptabilité),
-- ou la clé de service (tâche planifiée). Lecture comprise : les fichiers contiennent noms et adresses.
-- Le plan de comptes proposé est celui de G8 : À TRANCHER AVEC LE COMPTABLE (tout est modifiable).
--
-- Prérequis : 20261103170000_m6_caisse_legale.sql (document_payments.status / transferred_from).
-- Idempotente. NON APPLIQUÉE (Simon passe les migrations en bloc). Essai à blanc :
-- supabase/tests/m12_export_ebp_g8.sql.

-- ---------------------------------------------------------------------
-- 0. Garde : comptable ou administrateur de la société, ou clé de service
-- ---------------------------------------------------------------------
create or replace function public._accounting_can_transfer(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when auth.uid() is null then
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    else public.has_role(_company, 'comptable') or public.has_role(_company, 'admin')
  end;
$$;
revoke all on function public._accounting_can_transfer(uuid) from public, anon;
grant execute on function public._accounting_can_transfer(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Paramètres du transfert
-- ---------------------------------------------------------------------
create table if not exists public.accounting_transfer_settings (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  params      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------------
-- 2. Règles de comptes (G8 « Gestion des comptes »)
-- ---------------------------------------------------------------------
create table if not exists public.accounting_account_rules (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  kind               text not null check (kind in ('sales', 'purchase', 'cession', 'vat', 'payment', 'cash_movement')),
  key                text,            -- référence article / code du mode / code du type de mouvement / taux
  family             text,            -- famille (catégorie d'article)
  vat_rate           numeric(5,2),
  tax_exempt         boolean,         -- détaxe (null = indifférent)
  demo               boolean,         -- véhicule de démo (null = indifférent)
  customer_category  text,
  account            text not null default '',
  account2           text,            -- ventes : rétrocession · TVA : occasion · achats : export · mouvements : TVA
  account3           text,            -- TVA : TVA achat · achats : achat rétro
  country            text,            -- TVA : pays (ventes internet)
  journal            text,
  label              text,
  mode_label         text,            -- règlements : ESP / CAR / VIR · mouvements : bank / deposit / generic
  is_active          boolean not null default true,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_acct_rules_company on public.accounting_account_rules(company_id, kind, sort_order);

-- ---------------------------------------------------------------------
-- 3. Comptes clients / fournisseurs
-- ---------------------------------------------------------------------
create table if not exists public.accounting_third_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  kind        text not null default 'C' check (kind in ('C', 'F')),
  account     text not null,
  label       text,
  origin      text not null default 'manual' check (origin in ('manual', 'auto', 'contact', 'g8')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, contact_id, kind)
);
create index if not exists idx_third_accounts_account on public.accounting_third_accounts(company_id, kind, account);

-- ---------------------------------------------------------------------
-- 4. Historique des transferts
-- ---------------------------------------------------------------------
create table if not exists public.accounting_transfers (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  transfer_no    int not null,
  format         text not null default 'ebp',
  mode           text not null default 'manual' check (mode in ('manual', 'auto')),
  period_from    date,
  period_to      date,
  number_from    text,
  number_to      text,
  options        jsonb not null default '{}'::jsonb,
  file_dir       text,
  entries_file   text not null default 'ECRITURES.TXT',
  accounts_file  text not null default 'COMPTES.TXT',
  ecritures      text not null default '',
  comptes        text not null default '',
  pieces         int not null default 0,
  lines          int not null default 0,
  total_debit    numeric(14,2) not null default 0,
  total_credit   numeric(14,2) not null default 0,
  status         text not null default 'transfere' check (status in ('transfere', 'annule')),
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  cancelled_at   timestamptz,
  cancelled_by   uuid references auth.users(id) on delete set null,
  cancel_reason  text,
  unique (company_id, transfer_no)
);
create index if not exists idx_acct_transfers_company on public.accounting_transfers(company_id, created_at desc);

create table if not exists public.accounting_transfer_items (
  id           bigint generated always as identity primary key,
  transfer_id  uuid not null references public.accounting_transfers(id) on delete restrict,
  company_id   uuid not null references public.companies(id) on delete restrict,
  source_kind  text not null check (source_kind in ('document', 'payment', 'cash_movement', 'purchase', 'cession', 'consignment')),
  source_id    uuid not null,
  piece_no     int,
  cancelled    boolean not null default false
);
create index if not exists idx_acct_items_transfer on public.accounting_transfer_items(transfer_id);
-- Un document ne part qu'une fois (tant que son transfert n'est pas annulé).
create unique index if not exists uq_acct_items_active on public.accounting_transfer_items(company_id, source_kind, source_id) where not cancelled;

-- ---------------------------------------------------------------------
-- RLS : comptable / admin de la société. Transferts et éléments : écriture par les fonctions seulement.
-- ---------------------------------------------------------------------
alter table public.accounting_transfer_settings enable row level security;
alter table public.accounting_account_rules enable row level security;
alter table public.accounting_third_accounts enable row level security;
alter table public.accounting_transfers enable row level security;
alter table public.accounting_transfer_items enable row level security;

drop policy if exists acct_settings_rw on public.accounting_transfer_settings;
create policy acct_settings_rw on public.accounting_transfer_settings for all to authenticated
  using (public._accounting_can_transfer(company_id)) with check (public._accounting_can_transfer(company_id));
drop policy if exists acct_rules_rw on public.accounting_account_rules;
create policy acct_rules_rw on public.accounting_account_rules for all to authenticated
  using (public._accounting_can_transfer(company_id)) with check (public._accounting_can_transfer(company_id));
drop policy if exists acct_third_rw on public.accounting_third_accounts;
create policy acct_third_rw on public.accounting_third_accounts for all to authenticated
  using (public._accounting_can_transfer(company_id)) with check (public._accounting_can_transfer(company_id));
drop policy if exists acct_transfers_read on public.accounting_transfers;
create policy acct_transfers_read on public.accounting_transfers for select to authenticated
  using (public._accounting_can_transfer(company_id));
drop policy if exists acct_items_read on public.accounting_transfer_items;
create policy acct_items_read on public.accounting_transfer_items for select to authenticated
  using (public._accounting_can_transfer(company_id));

revoke all on public.accounting_transfers, public.accounting_transfer_items from anon;
revoke insert, update, delete on public.accounting_transfers, public.accounting_transfer_items from authenticated;
grant select on public.accounting_transfers, public.accounting_transfer_items to authenticated;
revoke all on public.accounting_transfer_settings, public.accounting_account_rules, public.accounting_third_accounts from anon;
grant select, insert, update, delete on public.accounting_transfer_settings, public.accounting_account_rules, public.accounting_third_accounts to authenticated;

-- Audit (B7, règle 4) : qui, quoi, quand, ancien / nouveau.
drop trigger if exists trg_acct_settings_audit on public.accounting_transfer_settings;
create trigger trg_acct_settings_audit after insert or update or delete on public.accounting_transfer_settings for each row execute function public.audit_row();
drop trigger if exists trg_acct_rules_audit on public.accounting_account_rules;
create trigger trg_acct_rules_audit after insert or update or delete on public.accounting_account_rules for each row execute function public.audit_row();
drop trigger if exists trg_acct_third_audit on public.accounting_third_accounts;
create trigger trg_acct_third_audit after insert or update or delete on public.accounting_third_accounts for each row execute function public.audit_row();
drop trigger if exists trg_acct_transfers_audit on public.accounting_transfers;
create trigger trg_acct_transfers_audit after insert or update or delete on public.accounting_transfers for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- 5. Enregistrer un transfert (après génération des fichiers)
--    _t = { mode, period_from, period_to, number_from, number_to, options, file_dir, entries_file,
--           accounts_file, ecritures, comptes, pieces, lines, total_debit, total_credit,
--           items: [{ kind, id, piece }] }
-- ---------------------------------------------------------------------
create or replace function public.record_accounting_transfer(_company uuid, _t jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _id uuid; _no int; _it jsonb; _n int := 0; _today date := current_date;
begin
  if not public._accounting_can_transfer(_company) then
    raise exception 'Transfert comptable reserve au comptable ou a l administrateur.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(_t->'items', 'null'::jsonb)) <> 'array' or jsonb_array_length(_t->'items') = 0 then
    raise exception 'Rien a transferer.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('accounting_transfer:' || _company::text));
  select coalesce(max(transfer_no), 0) + 1 into _no from public.accounting_transfers where company_id = _company;

  insert into public.accounting_transfers (company_id, transfer_no, format, mode, period_from, period_to, number_from, number_to,
    options, file_dir, entries_file, accounts_file, ecritures, comptes, pieces, lines, total_debit, total_credit, created_by)
  values (_company, _no, 'ebp', coalesce(nullif(_t->>'mode', ''), 'manual'),
    nullif(_t->>'period_from', '')::date, nullif(_t->>'period_to', '')::date, nullif(_t->>'number_from', ''), nullif(_t->>'number_to', ''),
    coalesce(_t->'options', '{}'::jsonb), nullif(_t->>'file_dir', ''),
    coalesce(nullif(_t->>'entries_file', ''), 'ECRITURES.TXT'), coalesce(nullif(_t->>'accounts_file', ''), 'COMPTES.TXT'),
    coalesce(_t->>'ecritures', ''), coalesce(_t->>'comptes', ''), coalesce((_t->>'pieces')::int, 0), coalesce((_t->>'lines')::int, 0),
    coalesce((_t->>'total_debit')::numeric, 0), coalesce((_t->>'total_credit')::numeric, 0), auth.uid())
  returning id into _id;

  for _it in select * from jsonb_array_elements(_t->'items') loop
    begin
      insert into public.accounting_transfer_items (transfer_id, company_id, source_kind, source_id, piece_no)
      values (_id, _company, _it->>'kind', (_it->>'id')::uuid, nullif(_it->>'piece', '')::int);
    exception when unique_violation then
      raise exception 'Deja transfere (% %) : relancez l apercu.', _it->>'kind', _it->>'id' using errcode = '23505';
    end;
    _n := _n + 1;
  end loop;

  -- Colonnes « Compta » / « Date transfert » des factures (G8). Miroir : la référence reste
  -- accounting_transfer_items ; un verrou d'un autre lot sur les documents validés ne bloque pas le transfert.
  begin
    update public.documents d set compta_transferred = true, date_transfert = _today
     where d.company_id = _company and d.id in (
       select i.source_id from public.accounting_transfer_items i where i.transfer_id = _id and i.source_kind = 'document');
  exception when others then
    raise notice 'Marquage Compta des documents ignore : %', sqlerrm;
  end;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'accounting_transfer', 'accounting_transfers', _id::text,
          case when coalesce(_t->>'mode', 'manual') = 'auto' then 'system' else 'screen' end,
          jsonb_build_object('transfer_no', _no, 'items', _n, 'period_from', _t->>'period_from', 'period_to', _t->>'period_to'));
  return jsonb_build_object('id', _id, 'transfer_no', _no, 'items', _n);
end $$;
revoke all on function public.record_accounting_transfer(uuid, jsonb) from public, anon;
grant execute on function public.record_accounting_transfer(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Annuler un transfert (G8 Utilitaires > Comptabilité « Annuler transfert comptable n° ») :
--    réservé au comptable / admin, motif obligatoire, tracé ; les éléments redeviennent transférables.
-- ---------------------------------------------------------------------
create or replace function public.cancel_accounting_transfer(_transfer uuid, _reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _tr public.accounting_transfers%rowtype;
begin
  select * into _tr from public.accounting_transfers where id = _transfer for update;
  if not found then raise exception 'Transfert introuvable.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_role(_tr.company_id, 'comptable') or public.has_role(_tr.company_id, 'admin')) then
    raise exception 'Annulation reservee au comptable ou a l administrateur.' using errcode = '42501';
  end if;
  if _tr.status = 'annule' then raise exception 'Transfert deja annule.' using errcode = '23514'; end if;
  if coalesce(btrim(_reason), '') = '' then raise exception 'Le motif est obligatoire.' using errcode = '23514'; end if;

  update public.accounting_transfers
     set status = 'annule', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason)
   where id = _transfer;
  update public.accounting_transfer_items set cancelled = true where transfer_id = _transfer;

  begin
    update public.documents d set compta_transferred = false, date_transfert = null
     where d.company_id = _tr.company_id
       and d.id in (select i.source_id from public.accounting_transfer_items i where i.transfer_id = _transfer and i.source_kind = 'document')
       and not exists (select 1 from public.accounting_transfer_items j
                        where j.source_kind = 'document' and j.source_id = d.id and not j.cancelled);
  exception when others then
    raise notice 'Marquage Compta des documents ignore : %', sqlerrm;
  end;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_tr.company_id, auth.uid(), 'accounting_transfer_cancel', 'accounting_transfers', _transfer::text, 'screen',
          jsonb_build_object('status', _tr.status, 'transfer_no', _tr.transfer_no),
          jsonb_build_object('status', 'annule', 'reason', btrim(_reason)));
end $$;
revoke all on function public.cancel_accounting_transfer(uuid, text) from public, anon;
grant execute on function public.cancel_accounting_transfer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Règlements à transférer (perçus, non transférés, jusqu'à la date de fin, depuis la date de bascule).
--    Hors lettrage par avoir (AVO) et acomptes reportés (transferred_from). Plage de numéros : _doc_ids.
-- ---------------------------------------------------------------------
create or replace function public.ebp_payments_to_transfer(_company uuid, _to date, _doc_ids uuid[] default null)
returns table (id uuid, document_id uuid, method text, amount numeric, paid_date date, doc_number text, doc_type text,
               contact_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._accounting_can_transfer(_company) then
    raise exception 'Transfert comptable reserve au comptable ou a l administrateur.' using errcode = '42501';
  end if;
  return query
    select p.id, p.document_id, p.method, p.amount,
           coalesce(p.received_at, p.paid_at)::date, d.number, d.doc_type, d.contact_id, p.paid_at
      from public.document_payments p
      join public.documents d on d.id = p.document_id
      join public.companies c on c.id = d.company_id
     where d.company_id = _company
       and p.status = 'recu'
       and p.transferred_from is null
       and p.method <> 'AVO'
       and coalesce(p.received_at, p.paid_at)::date >= coalesce(c.accounting_start_date, '1900-01-01'::date)
       and (case when _doc_ids is null then coalesce(p.received_at, p.paid_at)::date <= _to else p.document_id = any(_doc_ids) end)
       and not exists (select 1 from public.accounting_transfer_items i
                        where i.company_id = _company and i.source_kind = 'payment' and i.source_id = p.id and not i.cancelled)
     order by p.paid_at, p.id;
end $$;
revoke all on function public.ebp_payments_to_transfer(uuid, date, uuid[]) from public, anon;
grant execute on function public.ebp_payments_to_transfer(uuid, date, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Comptes clients / fournisseurs (G8 « Création automatique · Mettre à jour · Récupérer depuis client »)
--    _mode : 'auto'   → crée les comptes manquants : base + code (client 20 → 200020, fournisseur 101 → 40100101)
--            'refresh'→ met à jour l'intitulé depuis la fiche
--            'from_contact' → reprend le compte saisi sur la fiche (contacts.accounting_account)
-- ---------------------------------------------------------------------
create or replace function public.accounting_create_third_accounts(_company uuid, _kind text, _mode text, _base bigint default null, _width int default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare _n int := 0; _b bigint; _w int;
begin
  if auth.uid() is null or not (public.has_role(_company, 'comptable') or public.has_role(_company, 'admin')) then
    raise exception 'Reserve au comptable ou a l administrateur.' using errcode = '42501';
  end if;
  if _kind not in ('C', 'F') or _mode not in ('auto', 'refresh', 'from_contact') then
    raise exception 'Parametres invalides.' using errcode = '22023';
  end if;
  _b := coalesce(_base, case when _kind = 'C' then 200000 else 40100000 end);
  _w := coalesce(_width, case when _kind = 'C' then 6 else 8 end);

  if _mode = 'auto' then
    insert into public.accounting_third_accounts (company_id, contact_id, kind, account, label, origin)
    select _company, c.id, _kind, (_b + c.code::bigint)::text,
           upper(coalesce(nullif(c.company_name, ''), btrim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, '')))), 'auto'
      from public.contacts c
     where c.company_id = _company
       and c.code ~ '^[0-9]{1,9}$'
       and length((_b + c.code::bigint)::text) = _w
       and ((_kind = 'F' and c.type::text = 'fournisseur') or (_kind = 'C' and c.type::text <> 'fournisseur'))
       and not exists (select 1 from public.accounting_third_accounts a where a.company_id = _company and a.contact_id = c.id and a.kind = _kind);
    get diagnostics _n = row_count;
  elsif _mode = 'refresh' then
    update public.accounting_third_accounts a
       set label = upper(coalesce(nullif(c.company_name, ''), btrim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, '')))), updated_at = now()
      from public.contacts c
     where a.company_id = _company and a.kind = _kind and c.id = a.contact_id
       and a.label is distinct from upper(coalesce(nullif(c.company_name, ''), btrim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))));
    get diagnostics _n = row_count;
  else
    insert into public.accounting_third_accounts (company_id, contact_id, kind, account, label, origin)
    select _company, c.id, _kind, btrim(c.accounting_account),
           upper(coalesce(nullif(c.company_name, ''), btrim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, '')))), 'contact'
      from public.contacts c
     where c.company_id = _company and coalesce(btrim(c.accounting_account), '') <> ''
       and ((_kind = 'F' and c.type::text = 'fournisseur') or (_kind = 'C' and c.type::text <> 'fournisseur'))
    on conflict (company_id, contact_id, kind) do update set account = excluded.account, origin = 'contact', updated_at = now()
      where public.accounting_third_accounts.account is distinct from excluded.account;
    get diagnostics _n = row_count;
  end if;
  return _n;
end $$;
revoke all on function public.accounting_create_third_accounts(uuid, text, text, bigint, int) from public, anon;
grant execute on function public.accounting_create_third_accounts(uuid, text, text, bigint, int) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Valeurs par défaut G8 pour chaque société (comptes vides là où G8 les a vides). Rien n'est écrasé.
-- ---------------------------------------------------------------------
insert into public.accounting_transfer_settings (company_id, params)
select c.id, '{}'::jsonb from public.companies c
on conflict (company_id) do nothing;

insert into public.accounting_account_rules (company_id, kind, key, account, journal, mode_label, label, sort_order)
select c.id, 'payment', d.key, d.account, d.journal, d.mode_label, d.label, d.sort_order
  from public.companies c
 cross join (values
   ('ESP', '530000', 'CA', 'ESP', 'Espèces', 1),
   ('MAE', '511300', 'RC', 'CAR', 'Carte débit', 2),
   ('VIR', '511400', 'RC', 'VIR', 'Virement', 3),
   ('VID', '',       'RC', 'CAR', 'Visa / Mastercard débit (vide dans G8)', 4),
   ('VIC', '',       'RC', 'CAR', 'Visa / Mastercard crédit (vide dans G8)', 5)
 ) as d(key, account, journal, mode_label, label, sort_order)
 where not exists (select 1 from public.accounting_account_rules r where r.company_id = c.id and r.kind = 'payment' and r.key = d.key);

insert into public.accounting_account_rules (company_id, kind, key, account, account2, vat_rate, mode_label, label, sort_order)
select c.id, 'cash_movement', d.key, '', '', d.vat_rate, d.style, d.label, d.sort_order
  from public.companies c
 cross join (values
   ('01', 'REMISE EN BANQUE', 'bank', 0, 1),
   ('02', 'ENCAISSEMENT DEPOT VTE', 'deposit', 0, 2),
   ('03', 'DECAISSEMENT DEPOT VTE', 'deposit', 0, 3),
   ('04', 'ACHAT DE CONSOM.', 'generic', 21, 4),
   ('05', 'LA POSTE', 'generic', 0, 5),
   ('06', 'DIVERS ENTREE ESPECES', 'generic', 0, 6),
   ('07', 'DIVERS SORTIE ESPECES', 'generic', 0, 7)
 ) as d(key, label, style, vat_rate, sort_order)
 where not exists (select 1 from public.accounting_account_rules r where r.company_id = c.id and r.kind = 'cash_movement' and r.key = d.key);

-- ---------------------------------------------------------------------
-- 10. Transfert automatique planifié (G8 : tous les soirs / semaines / 15 jours / mois). La tâche tourne
--     chaque soir et ne fait rien pour une société dont la fréquence est « off » (valeur par défaut).
--     Posée seulement si pg_cron, pg_net et le secret Vault « cron_secret » existent (lot sécurité S5).
-- ---------------------------------------------------------------------
do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from pg_namespace where nspname = 'net')
     and exists (select 1 from pg_namespace where nspname = 'vault')
     and exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and length(decrypted_secret) >= 32) then
    perform cron.schedule('accounting-auto-transfer', '30 23 * * *', $job$
      select net.http_post(
        'https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/accounting-auto-transfer',
        '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ));
    $job$);
  else
    raise notice 'accounting-auto-transfer non planifie : pg_cron / pg_net / secret Vault cron_secret absent.';
  end if;
exception when others then
  raise notice 'accounting-auto-transfer non planifie : %', sqlerrm;
end $cron$;
