-- =====================================================================
-- Mission 03 — carte « Une vente sur le site crée la vente et la sortie de stock dans le DMS »
-- Décisions : W-4 (le DMS fait foi ; une vente Shopify crée la vente et la sortie de stock),
-- W-7 (prix Shopify TVA comprise ; frais de port en LIGNE À PART), D3 (client retrouvé par
-- e-mail, jamais de fusion automatique), D2 (une facture fait passer la fiche en « client »).
--
-- Flux : Shopify (webhook signé, ou rattrapage planifié toutes les 15 min) → fonction serveur
-- shopify-orders (calcule les lignes : règles pures testées dans _shared/shopify-order.ts) →
-- _shopify_order_apply (ICI, une seule transaction) :
--   - commande payée pas encore importée : client retrouvé par e-mail (minuscules) ou créé
--     (particulier, statut client, origine web, imported_from « shopify ») ; FACTURE validée
--     (FAC, numéro de la société, département E-shop via imported_from = 'shopify') ; une ligne par
--     article ; produit non relié = ligne libre avec son montant, SANS article (« à relier ») ;
--     frais de port = ligne à part ; sortie de stock réel par record_stock_move (append-only, B7) ;
--     règlement REÇU (Shopify Payments / PayPal / virement selon la passerelle) ; cloche
--     « Nouvelle commande web » (vendeurs + administrateurs) ; trace events ;
--   - commande déjà importée : lignes « à relier » dont le produit est maintenant relié → article
--     posé sur la ligne + sortie de stock ; remboursements Shopify → un AVOIR par remboursement
--     (lignes en négatif, réintégration du stock si Shopify a remis l'article en stock, règlement
--     négatif), facture passée « annulée » si tout est remboursé (même flux que « Générer un avoir »).
-- Idempotence : une ligne par (société, id de commande Shopify), verrouillée pendant le traitement ;
-- une facture par commande ; un avoir par id de remboursement Shopify.
--
-- Réglage société « Import des commandes du site » : ARRÊTÉ par défaut (aucune ligne = arrêté).
-- Une fois Actif, seules les commandes passées après l'activation sont importées.
-- Tâche planifiée shopify-orders-catchup (*/15) : n'appelle la fonction serveur que si au moins
-- une société a l'import Actif ; en-tête x-cron-secret lu dans le coffre Vault (jamais écrit ici).
--
-- Additif : 4 tables, 1 moyen de règlement « Shopify Payments » (Paramètres → Tables, masqué en
-- caisse), 1 type de cloche, 6 fonctions, 1 tâche planifiée. Aucune donnée existante modifiée.
-- =====================================================================

-- ------------------------------------------------ 1. Réglage société
create table if not exists public.shopify_order_settings (
  company_id      uuid primary key references public.companies(id) on delete cascade,
  import_enabled  boolean not null default false,
  enabled_at      timestamptz,
  last_catchup_at timestamptz,
  last_catchup    jsonb,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null
);
comment on table public.shopify_order_settings is
  'Mission 03 : « Import des commandes du site » (Arrêté / Actif). Pas de ligne = Arrêté. '
  'enabled_at = début de l''import : les commandes plus anciennes ne sont jamais importées.';

-- ------------------------------------------------ 2. Commandes reçues
create table if not exists public.shopify_orders (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  shopify_order_id   text not null,               -- gid://shopify/Order/…
  order_name         text,                        -- « #1216 »
  shopify_created_at timestamptz,
  email              text,
  total_ttc          numeric(14,2),
  currency           text,
  financial_status   text,                        -- PAID, PENDING, REFUNDED… (Shopify)
  cancelled_at       timestamptz,
  import_status      text not null default 'en_attente'
                     check (import_status in ('importee', 'a_relier', 'erreur', 'en_attente', 'annulee', 'ignoree')),
  needs_check        boolean not null default false,
  check_reason       text,
  error_message      text,
  attempts           integer not null default 0,
  document_id        uuid references public.documents(id) on delete set null,
  contact_id         uuid references public.contacts(id) on delete set null,
  contact_created    boolean not null default false,
  warnings           jsonb,
  first_via          text,
  last_via           text,
  imported_at        timestamptz,
  last_attempt_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, shopify_order_id)
);
create index if not exists idx_shopify_orders_list on public.shopify_orders (company_id, shopify_created_at desc);
comment on table public.shopify_orders is
  'Mission 03 : commandes du site Shopify reçues (webhook ou rattrapage) et leur import dans le DMS. '
  'importee / a_relier (des produits sans article) / erreur (Réessayer) / en_attente (pas encore payée) / '
  'annulee (annulée avant paiement) / ignoree (commande de test). Écrite uniquement par les fonctions _shopify_*.';

create table if not exists public.shopify_order_lines (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  shopify_order_id text not null,
  shopify_line_id  text not null,                 -- gid://shopify/LineItem/…
  variant_id       text,
  sku              text,
  title            text,
  quantity         numeric(14,3) not null,
  document_line_id uuid references public.document_lines(id) on delete set null,
  article_id       uuid references public.articles(id) on delete set null,
  linked_at        timestamptz,                   -- article posé (à l'import ou relié après coup)
  stock_moved      boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (company_id, shopify_line_id)
);
create index if not exists idx_shopify_order_lines_order on public.shopify_order_lines (company_id, shopify_order_id);

create table if not exists public.shopify_order_refunds (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  shopify_order_id  text not null,
  shopify_refund_id text not null,
  credit_note_id    uuid references public.documents(id) on delete set null,  -- null = remboursement à 0 € (à vérifier)
  amount            numeric(14,2) not null default 0,
  created_at        timestamptz not null default now(),
  unique (company_id, shopify_refund_id)
);
create index if not exists idx_shopify_order_refunds_order on public.shopify_order_refunds (company_id, shopify_order_id);

-- Liens pour PostgREST (écran : commande → remboursements, lignes)
do $$ begin
  alter table public.shopify_order_refunds
    add constraint shopify_order_refunds_order_fk foreign key (company_id, shopify_order_id)
    references public.shopify_orders (company_id, shopify_order_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.shopify_order_lines
    add constraint shopify_order_lines_order_fk foreign key (company_id, shopify_order_id)
    references public.shopify_orders (company_id, shopify_order_id) on delete cascade;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------ 3. RLS : lecture vendeurs + administrateurs, aucune écriture directe
alter table public.shopify_order_settings enable row level security;
alter table public.shopify_orders enable row level security;
alter table public.shopify_order_lines enable row level security;
alter table public.shopify_order_refunds enable row level security;
revoke all on public.shopify_order_settings, public.shopify_orders, public.shopify_order_lines, public.shopify_order_refunds from anon;
revoke insert, update, delete on public.shopify_order_settings, public.shopify_orders, public.shopify_order_lines, public.shopify_order_refunds from authenticated;
grant select on public.shopify_order_settings, public.shopify_orders, public.shopify_order_lines, public.shopify_order_refunds to authenticated;

drop policy if exists shopify_order_settings_select on public.shopify_order_settings;
create policy shopify_order_settings_select on public.shopify_order_settings for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));
drop policy if exists shopify_orders_select on public.shopify_orders;
create policy shopify_orders_select on public.shopify_orders for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));
drop policy if exists shopify_order_lines_select on public.shopify_order_lines;
create policy shopify_order_lines_select on public.shopify_order_lines for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));
drop policy if exists shopify_order_refunds_select on public.shopify_order_refunds;
create policy shopify_order_refunds_select on public.shopify_order_refunds for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));

-- ------------------------------------------------ 4. Moyen de règlement « Shopify Payments » (masqué en caisse)
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select c.id, 'payment_method', 'SHOP', 'Shopify Payments', 95, true, '{"visible_pos": false}'::jsonb
  from public.companies c
on conflict (company_id, table_key, code) do nothing;

-- ------------------------------------------------ 5. Cloche : type « web_order » (vendeurs + administrateurs)
do $do$
declare _def text; _kinds text[];
begin
  select pg_get_constraintdef(c.oid) into _def from pg_constraint c
   where c.conrelid = 'public.team_notifications'::regclass and c.conname = 'team_notifications_kind_check';
  -- Types existants relus en place (forme « '{a,b}'::text[] » ou « 'a'::text, 'b'::text »),
  -- plus ceux connus à ce jour, plus le nouveau.
  select array_agg(distinct k order by k) into _kinds from (
    select btrim(unnest(string_to_array(substring(coalesce(_def, '') from '\{([^}]*)\}'), ','))) as k
    union select (regexp_matches(coalesce(_def, ''), '''([a-z_]+)''::text', 'g'))[1]
    union select unnest(array['signup', 'client_iban_changed', 'vehicle_declared', 'order_after_deposit', 'unpaid_balance'])
    union select 'web_order') x
   where k is not null and k <> '';
  alter table public.team_notifications drop constraint if exists team_notifications_kind_check;
  execute format('alter table public.team_notifications add constraint team_notifications_kind_check '
                 'check (kind = any (%L::text[]))', _kinds);
end $do$;

create or replace function public.can_see_team_notification(_company uuid, _kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case _kind
    when 'signup' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'vendeur')
      or public.has_role(_company, 'marketing')
    when 'client_iban_changed' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'comptable')
      or public.has_role(_company, 'vendeur')
    when 'vehicle_declared' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'vendeur')
    -- Mission 05, carte 10 : admins ici ; le vendeur du document par la politique
    -- team_notifications_target_read (target_user_id).
    when 'order_after_deposit' then public.has_role(_company, 'admin')
    when 'unpaid_balance' then public.has_role(_company, 'admin')
    -- Mission 03 : « Nouvelle commande web » → vendeurs + administrateurs.
    when 'web_order' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'vendeur')
    else public.is_member(_company)
  end;
$fn$;
comment on function public.can_see_team_notification(uuid, text) is
  'Décision N-1 : alerte « inscription » visible des rôles admin, vendeur, marketing. '
  'Mission 04 : « IBAN modifié par le client » → admin, comptable, vendeur ; '
  '« moto déclarée par un client » → admin, vendeur. '
  'Mission 05 carte 10 : « pièces à commander après acompte » et « solde impayé » → admin '
  '(+ le vendeur du document, politique team_notifications_target_read). '
  'Mission 03 : « Nouvelle commande web » → admin, vendeur.';
revoke all on function public.can_see_team_notification(uuid, text) from public, anon;
grant execute on function public.can_see_team_notification(uuid, text) to authenticated, service_role;

-- ------------------------------------------------ 6. Réglage « Import des commandes du site » (administrateurs)
create or replace function public.shopify_orders_set_import(_company uuid, _enabled boolean)
returns public.shopify_order_settings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_s public.shopify_order_settings%rowtype;
  new_s public.shopify_order_settings%rowtype;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  select * into old_s from public.shopify_order_settings where company_id = _company;
  insert into public.shopify_order_settings (company_id, import_enabled, enabled_at, updated_at, updated_by)
  values (_company, _enabled, case when _enabled then now() end, now(), auth.uid())
  on conflict (company_id) do update
    set import_enabled = excluded.import_enabled,
        -- nouvelle activation : on repart de maintenant (rien d'antérieur n'est importé)
        enabled_at = case when excluded.import_enabled and not shopify_order_settings.import_enabled then now()
                          else shopify_order_settings.enabled_at end,
        last_catchup_at = case when excluded.import_enabled and not shopify_order_settings.import_enabled then null
                               else shopify_order_settings.last_catchup_at end,
        updated_at = now(), updated_by = auth.uid()
  returning * into new_s;
  if coalesce(old_s.import_enabled, false) is distinct from _enabled then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'shopify_orders_import_setting', 'shopify_order_settings', _company::text, 'screen',
            jsonb_build_object('import_enabled', coalesce(old_s.import_enabled, false)),
            jsonb_build_object('import_enabled', _enabled, 'enabled_at', new_s.enabled_at));
  end if;
  return new_s;
end $$;
revoke all on function public.shopify_orders_set_import(uuid, boolean) from public, anon;
grant execute on function public.shopify_orders_set_import(uuid, boolean) to authenticated;

-- ------------------------------------------------ 7. Import d'une commande (clé de service uniquement)
create or replace function public._shopify_order_apply(_company uuid, _payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o          jsonb := _payload->'order';
  _oid       text := _payload->'order'->>'id';
  _via       text := coalesce(_payload->>'via', 'api');
  _decision  text := coalesce(_payload->>'decision', 'wait_payment');
  so         public.shopify_orders%rowtype;
  cust       jsonb := coalesce(_payload->'customer', '{}'::jsonb);
  sale       jsonb := coalesce(_payload->'sale', '{}'::jsonb);
  _email     text;
  _contact   uuid;
  _cstatus   public.contact_status;
  _same      int := 0;
  _created   boolean := false;
  _doc       uuid;
  _num       text;
  _odate     date;
  _l         jsonb;
  _i         int;
  _line_id   uuid;
  _item      jsonb;
  _paid      numeric := 0;
  _ttc       numeric;
  _unlinked  int;
  _cname     text;
  _c         jsonb;
  _avo       uuid;
  _avo_num   text;
  _rdate     date;
  _r         record;
  _art       uuid;
  _refunded  numeric;
  _new_status text;
  _relinked  int := 0;
  _credits   int := 0;
begin
  if _oid is null or _oid = '' then
    raise exception 'Commande Shopify sans identifiant.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.shopify_order_settings s where s.company_id = _company and s.import_enabled) then
    raise exception 'Import des commandes du site arrêté pour cette société.' using errcode = '55000';
  end if;

  insert into public.shopify_orders (company_id, shopify_order_id, order_name, shopify_created_at, email, total_ttc,
                                     currency, financial_status, cancelled_at, first_via, last_via)
  values (_company, _oid, o->>'name', (o->>'created_at')::timestamptz, lower(nullif(btrim(o->>'email'), '')),
          (o->>'total')::numeric, o->>'currency', o->>'financial_status', (o->>'cancelled_at')::timestamptz, _via, _via)
  on conflict (company_id, shopify_order_id) do nothing;

  -- Verrou : deux webhooks (ou webhook + rattrapage) simultanés ne créent jamais deux factures.
  select * into so from public.shopify_orders where company_id = _company and shopify_order_id = _oid for update;

  update public.shopify_orders
     set order_name = coalesce(o->>'name', order_name), email = coalesce(lower(nullif(btrim(o->>'email'), '')), email),
         total_ttc = coalesce((o->>'total')::numeric, total_ttc), currency = coalesce(o->>'currency', currency),
         financial_status = o->>'financial_status', cancelled_at = (o->>'cancelled_at')::timestamptz,
         last_via = _via, last_attempt_at = now(), attempts = attempts + 1, updated_at = now()
   where id = so.id;

  -- ============ A. Première importation
  if so.document_id is null then
    if _decision <> 'import' then
      _new_status := case _decision when 'cancelled_before_import' then 'annulee'
                                    when 'test_order' then 'ignoree' else 'en_attente' end;
      update public.shopify_orders set import_status = _new_status, error_message = null where id = so.id;
      if so.import_status is distinct from _new_status then
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, null, 'shopify_order_status', 'shopify_orders', so.id::text, 'api',
                jsonb_build_object('import_status', so.import_status),
                jsonb_build_object('import_status', _new_status, 'order', o->>'name', 'financial_status', o->>'financial_status', 'via', _via));
      end if;
      return jsonb_build_object('status', _new_status);
    end if;

    -- A1. Client : retrouvé par e-mail (minuscules), sinon créé. Jamais de fusion (D3).
    _email := lower(nullif(btrim(cust->>'email'), ''));
    if _email is not null then
      select count(*) into _same from public.contacts c
       where c.company_id = _company and lower(c.email) = _email and c.type <> 'fournisseur' and c.is_active;
      select c.id, c.status into _contact, _cstatus from public.contacts c
       where c.company_id = _company and lower(c.email) = _email and c.type <> 'fournisseur' and c.is_active
       order by (c.status <> 'prospect') desc, c.created_at asc
       limit 1;
      if _contact is null then
        insert into public.contacts (company_id, type, first_name, last_name, company_name, email, phone, address, zip,
                                     city, country, status, origin, imported_from, external_ref, notes)
        values (_company, 'particulier', nullif(cust->>'firstName', ''), nullif(cust->>'lastName', ''),
                nullif(cust->>'companyName', ''), _email, nullif(cust->>'phone', ''), nullif(cust->>'address', ''),
                nullif(cust->>'zip', ''), nullif(cust->>'city', ''), coalesce(nullif(cust->>'country', ''), 'BE'),
                'client', 'web', 'shopify', nullif(cust->>'shopifyCustomerId', ''),
                'Fiche créée par une commande du site Shopify ' || coalesce(o->>'name', ''))
        returning id into _contact;
        _created := true;
      elsif _cstatus = 'prospect' then
        -- D2 : une fiche avec une facture est « client » (tracé par l'audit de contacts).
        update public.contacts set status = 'client' where id = _contact;
      end if;
    end if;
    select nullif(btrim(coalesce(nullif(btrim(c.company_name), ''),
             concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))), '')
      into _cname from public.contacts c where c.id = _contact;
    _cname := coalesce(_cname, nullif(btrim(concat_ws(' ', cust->>'firstName', cust->>'lastName')), ''), _email);

    -- A2. Facture validée (département E-shop : imported_from = 'shopify')
    _odate := coalesce(((o->>'created_at')::timestamptz at time zone 'Europe/Brussels')::date, current_date);
    _ttc := coalesce((sale->>'totalTtc')::numeric, 0);
    _num := public._next_document_number_unchecked(_company, 'FAC');
    insert into public.documents (company_id, doc_type, number, contact_id, status, issue_date, due_date, notes,
                                  total_ht, total_vat, total_ttc, paid_amount, price_mode, tax_exempt,
                                  shipping_ht, forced_ttc, imported_from, operator)
    values (_company, 'FAC', _num, _contact, 'validee', _odate, _odate,
            'Commande du site Shopify ' || coalesce(o->>'name', ''),
            coalesce((sale->>'totalHt')::numeric, 0), coalesce((sale->>'totalVat')::numeric, 0), _ttc, 0, 'ttc', false,
            0, nullif(sale->>'forcedTtc', '')::numeric, 'shopify', 'Site Shopify')
    returning id into _doc;

    -- A3. Lignes + sortie de stock réel (B4, B7)
    _i := 0;
    for _l in select * from jsonb_array_elements(coalesce(sale->'lines', '[]'::jsonb)) loop
      insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity,
                                         unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
      values (_doc, nullif(_l->>'articleId', '')::uuid, coalesce(_l->>'designation', '—'), nullif(_l->>'reference', ''),
              'article', (_l->>'quantity')::numeric, (_l->>'unitPriceHt')::numeric, (_l->>'vatRate')::numeric,
              coalesce((_l->>'discountPct')::numeric, 0), (_l->>'lineHt')::numeric, (_l->>'lineTtc')::numeric, _i)
      returning id into _line_id;
      _i := _i + 1;
      if _l->>'kind' = 'item' and nullif(_l->>'shopifyLineId', '') is not null then
        select x into _item from jsonb_array_elements(coalesce(_payload->'items', '[]'::jsonb)) x
         where x->>'line_id' = _l->>'shopifyLineId' limit 1;
        insert into public.shopify_order_lines (company_id, shopify_order_id, shopify_line_id, variant_id, sku, title,
                                                quantity, document_line_id, article_id, linked_at, stock_moved)
        values (_company, _oid, _l->>'shopifyLineId', coalesce(_item->>'variant_id', _l->>'variantId'), _item->>'sku',
                coalesce(_item->>'title', _l->>'designation'), (_l->>'quantity')::numeric, _line_id,
                nullif(_l->>'articleId', '')::uuid,
                case when nullif(_l->>'articleId', '') is not null then now() end,
                nullif(_l->>'articleId', '') is not null and (_l->>'quantity')::numeric > 0)
        on conflict (company_id, shopify_line_id) do nothing;
        if nullif(_l->>'articleId', '') is not null and (_l->>'quantity')::numeric > 0 then
          perform public.record_stock_move((_l->>'articleId')::uuid, 'sortie', -abs((_l->>'quantity')::numeric),
                                           null, false, null, 'shopify', _num, 'Commande site ' || coalesce(o->>'name', ''));
        end if;
      end if;
    end loop;

    -- A4. Règlement reçu
    for _l in select * from jsonb_array_elements(coalesce(sale->'payments', '[]'::jsonb)) loop
      if abs(coalesce((_l->>'amount')::numeric, 0)) > 0.004 then
        insert into public.document_payments (document_id, method, amount, status, note, paid_at, received_at)
        values (_doc, coalesce(nullif(_l->>'method', ''), 'SHOP'), (_l->>'amount')::numeric, 'recu', _l->>'note',
                coalesce((o->>'created_at')::timestamptz, now()), now());
        _paid := _paid + (_l->>'amount')::numeric;
      end if;
    end loop;
    update public.documents
       set paid_amount = _paid,
           status = case when _paid + 0.005 >= total_ttc and total_ttc > 0 then 'payee' else status end
     where id = _doc;

    select count(*) into _unlinked from jsonb_array_elements(coalesce(sale->'lines', '[]'::jsonb)) x
     where x->>'kind' = 'item' and nullif(x->>'articleId', '') is null;

    update public.shopify_orders
       set document_id = _doc, contact_id = _contact, contact_created = _created, imported_at = now(),
           warnings = case when jsonb_array_length(coalesce(sale->'warnings', '[]'::jsonb)) > 0 or _same > 1
                           then coalesce(sale->'warnings', '[]'::jsonb)
                                || case when _same > 1 then jsonb_build_array('same_email_contacts:' || _same) else '[]'::jsonb end end
     where id = so.id;
    so.document_id := _doc;

    -- A5. Cloche « Nouvelle commande web » (une seule par commande)
    insert into public.team_notifications (company_id, kind, contact_id, document_id, title, origin, payload, dedupe_key)
    values (_company, 'web_order', _contact, _doc,
            left(coalesce(o->>'name', '') || coalesce(' — ' || _cname, ''), 200), 'web',
            jsonb_build_object('order_name', o->>'name', 'number', _num, 'total_ttc', _ttc, 'unlinked', _unlinked),
            _oid)
    on conflict (company_id, kind, dedupe_key) where dedupe_key is not null do nothing;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, null, 'shopify_order_import', 'shopify_orders', so.id::text, 'api', null,
            jsonb_build_object('order', o->>'name', 'shopify_order_id', _oid, 'document_id', _doc, 'number', _num,
                               'contact_id', _contact, 'contact_created', _created, 'contacts_same_email', _same,
                               'total_ttc', _ttc, 'lines', jsonb_array_length(coalesce(sale->'lines', '[]'::jsonb)),
                               'unlinked', _unlinked, 'warnings', sale->'warnings', 'via', _via));

  -- ============ B. Déjà importée : relier après coup les lignes « à relier »
  else
    for _r in
      select l.id, l.shopify_line_id, l.document_line_id, l.quantity
        from public.shopify_order_lines l
       where l.company_id = _company and l.shopify_order_id = _oid and l.article_id is null and l.document_line_id is not null
    loop
      select nullif(x->>'article_id', '')::uuid into _art
        from jsonb_array_elements(coalesce(_payload->'items', '[]'::jsonb)) x
       where x->>'line_id' = _r.shopify_line_id limit 1;
      if _art is null or not exists (select 1 from public.articles a where a.id = _art and a.company_id = _company) then
        continue;
      end if;
      update public.document_lines d
         set article_id = _art, reference = coalesce((select a.reference from public.articles a where a.id = _art), d.reference)
       where d.id = _r.document_line_id;
      if _r.quantity > 0 then
        perform public.record_stock_move(_art, 'sortie', -abs(_r.quantity), null, false, null, 'shopify',
                                         (select number from public.documents where id = so.document_id),
                                         'Commande site ' || coalesce(o->>'name', '') || ' (produit relié après coup)');
      end if;
      update public.shopify_order_lines set article_id = _art, linked_at = now(), stock_moved = _r.quantity > 0 where id = _r.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, null, 'shopify_order_relink', 'shopify_orders', so.id::text, 'api', null,
              jsonb_build_object('order', o->>'name', 'shopify_line_id', _r.shopify_line_id, 'article_id', _art,
                                 'document_id', so.document_id, 'quantity', _r.quantity, 'via', _via));
      _relinked := _relinked + 1;
    end loop;
  end if;

  -- ============ C. Remboursements Shopify → avoirs (un par remboursement)
  for _c in select * from jsonb_array_elements(coalesce(_payload->'credits', '[]'::jsonb)) loop
    if exists (select 1 from public.shopify_order_refunds r where r.company_id = _company and r.shopify_refund_id = _c->>'refund_id') then
      continue;
    end if;
    _rdate := coalesce(((_c->>'created_at')::timestamptz at time zone 'Europe/Brussels')::date, current_date);
    _avo_num := public._next_document_number_unchecked(_company, 'AVO');
    insert into public.documents (company_id, doc_type, number, contact_id, status, issue_date, notes,
                                  total_ht, total_vat, total_ttc, paid_amount, price_mode, source_document_id,
                                  imported_from, operator)
    select _company, 'AVO', _avo_num, d.contact_id, 'validee', _rdate,
           'Remboursement de la commande du site Shopify ' || coalesce(o->>'name', ''),
           (_c->>'totalHt')::numeric, (_c->>'totalVat')::numeric, (_c->>'totalTtc')::numeric, 0, 'ttc', d.id,
           'shopify', 'Site Shopify'
      from public.documents d where d.id = so.document_id
    returning id into _avo;
    _i := 0;
    for _l in select * from jsonb_array_elements(coalesce(_c->'lines', '[]'::jsonb)) loop
      insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity,
                                         unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
      values (_avo, nullif(_l->>'articleId', '')::uuid, coalesce(_l->>'designation', '—'), nullif(_l->>'reference', ''),
              'article', (_l->>'quantity')::numeric, (_l->>'unitPriceHt')::numeric, (_l->>'vatRate')::numeric,
              coalesce((_l->>'discountPct')::numeric, 0), (_l->>'lineHt')::numeric, (_l->>'lineTtc')::numeric, _i);
      _i := _i + 1;
      -- Réintégration seulement si Shopify a remis l'article en stock.
      if (_l->>'restock')::boolean and nullif(_l->>'articleId', '') is not null then
        perform public.record_stock_move((_l->>'articleId')::uuid, 'entree', abs((_l->>'quantity')::numeric),
                                         null, false, null, 'shopify', _avo_num,
                                         'Remboursement site ' || coalesce(o->>'name', '') || ' / réintégration');
      end if;
    end loop;
    if coalesce((_c->>'refundAmount')::numeric, 0) > 0.004 then
      insert into public.document_payments (document_id, method, amount, status, note, paid_at, received_at)
      values (_avo, coalesce(nullif(_c->>'method', ''), 'SHOP'), -abs((_c->>'refundAmount')::numeric), 'recu',
              'Remboursement ' || coalesce(o->>'name', ''), coalesce((_c->>'created_at')::timestamptz, now()), now());
      update public.documents set paid_amount = -abs((_c->>'refundAmount')::numeric) where id = _avo;
    end if;
    insert into public.shopify_order_refunds (company_id, shopify_order_id, shopify_refund_id, credit_note_id, amount)
    values (_company, _oid, _c->>'refund_id', _avo, coalesce((_c->>'refundAmount')::numeric, 0));
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, null, 'shopify_refund_credit', 'shopify_orders', so.id::text, 'api', null,
            jsonb_build_object('order', o->>'name', 'shopify_refund_id', _c->>'refund_id', 'credit_note_id', _avo,
                               'number', _avo_num, 'amount', _c->>'refundAmount', 'via', _via));
    _credits := _credits + 1;
  end loop;

  -- Remboursements à 0 € (retour ou modification sans argent rendu) : pas d'avoir, à vérifier.
  for _l in select * from jsonb_array_elements(coalesce(_payload->'zero_refunds', '[]'::jsonb)) loop
    insert into public.shopify_order_refunds (company_id, shopify_order_id, shopify_refund_id, credit_note_id, amount)
    values (_company, _oid, _l #>> '{}', null, 0)
    on conflict (company_id, shopify_refund_id) do nothing;
    if found then
      update public.shopify_orders set needs_check = true,
             check_reason = 'Remboursement à 0 € sur le site : vérifier le stock et la facture.' where id = so.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, null, 'shopify_refund_zero', 'shopify_orders', so.id::text, 'api', null,
              jsonb_build_object('order', o->>'name', 'shopify_refund_id', _l #>> '{}', 'via', _via));
    end if;
  end loop;

  -- Tout remboursé : la facture est annulée par ses avoirs (comme « Générer un avoir »).
  select coalesce(sum(r.amount), 0) into _refunded from public.shopify_order_refunds r
   where r.company_id = _company and r.shopify_order_id = _oid;
  if _credits > 0 and _refunded > 0 then
    update public.documents set status = 'annulee'
     where id = so.document_id and status <> 'annulee' and _refunded + 0.005 >= total_ttc;
  end if;

  -- Annulée sur le site après import sans remboursement : à vérifier.
  if (o->>'cancelled_at') is not null and _refunded <= 0.004 then
    update public.shopify_orders set needs_check = true,
           check_reason = 'Commande annulée sur le site sans remboursement : vérifier la facture.'
     where id = so.id and not needs_check;
  end if;

  -- Statut final
  _new_status := case when exists (select 1 from public.shopify_order_lines l
                                     where l.company_id = _company and l.shopify_order_id = _oid and l.article_id is null)
                      then 'a_relier' else 'importee' end;
  update public.shopify_orders set import_status = _new_status, error_message = null where id = so.id;
  return jsonb_build_object('status', _new_status, 'document_id', so.document_id, 'relinked', _relinked, 'credits', _credits);
end $$;
revoke all on function public._shopify_order_apply(uuid, jsonb) from public, anon, authenticated;
grant execute on function public._shopify_order_apply(uuid, jsonb) to service_role;

-- ------------------------------------------------ 8. Erreur d'import (bouton Réessayer)
create or replace function public._shopify_order_mark_error(_company uuid, _order_id text, _order_name text,
  _created_at timestamptz, _total numeric, _email text, _via text, _message text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare _id uuid;
begin
  if not exists (select 1 from public.shopify_order_settings s where s.company_id = _company and s.import_enabled) then
    return;
  end if;
  insert into public.shopify_orders (company_id, shopify_order_id, order_name, shopify_created_at, total_ttc, email,
                                     import_status, first_via, last_via)
  values (_company, _order_id, _order_name, _created_at, _total, lower(nullif(btrim(_email), '')), 'erreur', _via, _via)
  on conflict (company_id, shopify_order_id) do nothing;
  update public.shopify_orders
     set import_status = case when document_id is null then 'erreur' else import_status end,
         error_message = left(_message, 500), last_via = _via, last_attempt_at = now(), updated_at = now(),
         attempts = attempts + 1
   where company_id = _company and shopify_order_id = _order_id
  returning id into _id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, null, 'shopify_order_error', 'shopify_orders', _id::text, 'api', null,
          jsonb_build_object('order', _order_name, 'shopify_order_id', _order_id, 'message', left(_message, 500), 'via', _via));
end $$;
revoke all on function public._shopify_order_mark_error(uuid, text, text, timestamptz, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public._shopify_order_mark_error(uuid, text, text, timestamptz, numeric, text, text, text) to service_role;

-- ------------------------------------------------ 9. Fin d'un rattrapage
create or replace function public._shopify_orders_catchup_done(_company uuid, _at timestamptz, _stats jsonb)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.shopify_order_settings
     set last_catchup_at = _at, last_catchup = coalesce(_stats, '{}'::jsonb) || jsonb_build_object('at', _at)
   where company_id = _company and import_enabled;
$$;
revoke all on function public._shopify_orders_catchup_done(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public._shopify_orders_catchup_done(uuid, timestamptz, jsonb) to service_role;

-- ------------------------------------------------ 10. Rattrapage planifié (toutes les 15 min)
-- N'appelle la fonction serveur que si une société a l'import Actif (livré Arrêté : aucun appel).
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and length(decrypted_secret) >= 32) then
    raise exception 'Secret Vault « cron_secret » absent : requis pour la tâche shopify-orders-catchup.';
  end if;
end $$;

select cron.schedule('shopify-orders-catchup', '*/15 * * * *', $cron$
  select net.http_post(
    'https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/shopify-orders',
    '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ), 120000)
  where exists (select 1 from public.shopify_order_settings where import_enabled);
$cron$);
