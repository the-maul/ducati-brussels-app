-- =====================================================================
-- Mission 03 — carte « Le stock et le prix du DMS s'affichent en direct sur le site »
-- (décisions W-4 : le DMS fait foi ; W-7 : prix Shopify TVA comprise ; W-8 : le DMS écrit sur le site).
--
-- Principe :
--   1. un mouvement de stock (stock_moves), un changement de prix de vente ou de taux de TVA
--      (articles), une nouvelle liaison (shopify_links) ou le réglage d'arrondi de la société
--      AJOUTENT l'article RELIÉ dans la file shopify_sync_queue (une seule ligne par article :
--      dédoublonnage par contrainte unique, les motifs s'additionnent) ;
--   2. la fonction serveur shopify-push (pg_cron toutes les 3 min, en-tête x-cron-secret du coffre)
--      lit la file par lots, calcule stock disponible (réel − réservé, B4) et prix TTC, et écrit sur
--      Shopify ; chaque envoi est noté dans le journal shopify_sync_log (append-only).
--
-- MODE ESSAI (sécurité) — réglage société « Synchronisation Shopify » (shopify_sync_settings.mode) :
--   arrete  (DÉFAUT) : rien n'est écrit sur Shopify (la file se remplit, rien n'en sort) ;
--   essai            : seulement les articles choisis par un administrateur (shopify_sync_trial) ;
--   tous             : tous les articles reliés.
-- Aucune ligne de réglage = « arrete ».
--
-- Lecture seule du stock et des prix du DMS : aucun UPDATE sur articles, stock_moves, price_changes.
-- Additif uniquement : 4 tables, des fonctions, 4 déclencheurs AFTER (qui n'écrivent que dans la file),
-- une tâche pg_cron.
-- =====================================================================

-- 1. Réglage société
create table if not exists public.shopify_sync_settings (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  mode        text not null default 'arrete' check (mode in ('arrete', 'essai', 'tous')),
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- 2. Articles d'essai (choisis par un administrateur)
create table if not exists public.shopify_sync_trial (
  company_id  uuid not null references public.companies(id) on delete cascade,
  article_id  uuid not null references public.articles(id) on delete cascade,
  added_by    uuid references auth.users(id) on delete set null,
  added_at    timestamptz not null default now(),
  primary key (company_id, article_id)
);

-- 3. File d'attente : UNE ligne par article (dédoublonnage), supprimée une fois l'envoi réussi.
--    Ce n'est pas un journal (le journal est shopify_sync_log).
create table if not exists public.shopify_sync_queue (
  id               bigserial primary key,
  company_id       uuid not null references public.companies(id) on delete cascade,
  article_id       uuid not null references public.articles(id) on delete cascade,
  reasons          text[] not null default '{}',
  requested_at     timestamptz not null default now(),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  locked_at        timestamptz,
  last_error       text,
  unique (company_id, article_id)
);
create index if not exists idx_shopify_sync_queue_next on public.shopify_sync_queue (company_id, next_attempt_at);

-- 4. Journal des envois (append-only)
create table if not exists public.shopify_sync_log (
  id                  bigserial primary key,
  company_id          uuid not null references public.companies(id) on delete cascade,
  article_id          uuid references public.articles(id) on delete set null,
  shopify_product_id  text,
  shopify_variant_id  text,
  kind                text not null check (kind in ('stock_prix', 'publication', 'retrait', 'mise_a_jour')),
  status              text not null check (status in ('ok', 'deja_a_jour', 'erreur')),
  price_before        numeric(12,2),
  price_sent          numeric(12,2),
  qty_before          integer,
  qty_sent            integer,
  detail              text,
  actor_id            uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists idx_shopify_sync_log_company on public.shopify_sync_log (company_id, created_at desc);
create index if not exists idx_shopify_sync_log_article on public.shopify_sync_log (company_id, article_id, created_at desc);

-- 5. RLS : lecture administrateurs + vendeurs (file : administrateurs) ; aucune écriture directe.
alter table public.shopify_sync_settings enable row level security;
alter table public.shopify_sync_trial enable row level security;
alter table public.shopify_sync_queue enable row level security;
alter table public.shopify_sync_log enable row level security;
revoke all on public.shopify_sync_settings, public.shopify_sync_trial, public.shopify_sync_queue, public.shopify_sync_log from anon;
revoke insert, update, delete on public.shopify_sync_settings, public.shopify_sync_trial, public.shopify_sync_queue, public.shopify_sync_log from authenticated;
revoke update, delete on public.shopify_sync_log from service_role;

drop policy if exists shopify_sync_settings_select on public.shopify_sync_settings;
create policy shopify_sync_settings_select on public.shopify_sync_settings for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));
drop policy if exists shopify_sync_trial_select on public.shopify_sync_trial;
create policy shopify_sync_trial_select on public.shopify_sync_trial for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));
drop policy if exists shopify_sync_queue_select on public.shopify_sync_queue;
create policy shopify_sync_queue_select on public.shopify_sync_queue for select to authenticated
  using (public.is_admin(company_id));
drop policy if exists shopify_sync_log_select on public.shopify_sync_log;
create policy shopify_sync_log_select on public.shopify_sync_log for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));

-- 6. Mode courant (aucune ligne = arrêtée)
create or replace function public._shopify_sync_mode(_company uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select mode from public.shopify_sync_settings where company_id = _company), 'arrete');
$$;
revoke all on function public._shopify_sync_mode(uuid) from public, anon, authenticated;
grant execute on function public._shopify_sync_mode(uuid) to service_role;

-- 7. Mise en file (dédoublonnée) — seulement si l'article est RELIÉ à une variante Shopify.
create or replace function public._shopify_enqueue(_company uuid, _article uuid, _reason text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if _company is null or _article is null then return false; end if;
  if not exists (select 1 from public.shopify_links l
                  where l.company_id = _company and l.article_id = _article
                    and l.status in ('auto_exact', 'valide')) then
    return false;
  end if;
  insert into public.shopify_sync_queue as q (company_id, article_id, reasons, requested_at, next_attempt_at)
  values (_company, _article, array[_reason], now(), now())
  on conflict (company_id, article_id) do update
    set reasons = (select array_agg(distinct r order by r) from unnest(q.reasons || excluded.reasons) r),
        requested_at = now(),
        attempts = 0,
        next_attempt_at = now(),
        last_error = null;
  return true;
end $$;
revoke all on function public._shopify_enqueue(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public._shopify_enqueue(uuid, uuid, text) to service_role;

-- 8. Déclencheurs (AFTER, n'écrivent que dans la file ; une erreur ici ne bloque jamais le DMS)
create or replace function public.trg_shopify_enqueue_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public._shopify_enqueue(new.company_id, new.article_id, 'stock');
  exception when others then
    raise warning 'shopify enqueue (stock) : %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.trg_shopify_enqueue_stock() from public, anon, authenticated;

drop trigger if exists trg_stock_moves_shopify_enqueue on public.stock_moves;
create trigger trg_stock_moves_shopify_enqueue after insert on public.stock_moves
  for each row execute function public.trg_shopify_enqueue_stock();

create or replace function public.trg_shopify_enqueue_price()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.sale_price_ttc is distinct from old.sale_price_ttc
     or new.sale_price_ht is distinct from old.sale_price_ht
     or new.vat_rate is distinct from old.vat_rate then
    begin
      perform public._shopify_enqueue(new.company_id, new.id, 'prix');
    exception when others then
      raise warning 'shopify enqueue (prix) : %', sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function public.trg_shopify_enqueue_price() from public, anon, authenticated;

drop trigger if exists trg_articles_shopify_enqueue on public.articles;
create trigger trg_articles_shopify_enqueue after update of sale_price_ttc, sale_price_ht, vat_rate on public.articles
  for each row execute function public.trg_shopify_enqueue_price();

create or replace function public.trg_shopify_enqueue_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('auto_exact', 'valide') and new.article_id is not null
     and (tg_op = 'INSERT' or new.article_id is distinct from old.article_id or new.status is distinct from old.status) then
    begin
      perform public._shopify_enqueue(new.company_id, new.article_id, 'liaison');
    exception when others then
      raise warning 'shopify enqueue (liaison) : %', sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function public.trg_shopify_enqueue_link() from public, anon, authenticated;

drop trigger if exists trg_shopify_links_enqueue on public.shopify_links;
create trigger trg_shopify_links_enqueue after insert or update on public.shopify_links
  for each row execute function public.trg_shopify_enqueue_link();

create or replace function public.trg_shopify_enqueue_rounding()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.round_sale_prices_up is distinct from old.round_sale_prices_up then
    begin
      perform public._shopify_enqueue(new.id, l.article_id, 'arrondi')
         from (select distinct article_id from public.shopify_links
                where company_id = new.id and status in ('auto_exact', 'valide') and article_id is not null) l;
    exception when others then
      raise warning 'shopify enqueue (arrondi) : %', sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function public.trg_shopify_enqueue_rounding() from public, anon, authenticated;

drop trigger if exists trg_companies_shopify_enqueue on public.companies;
create trigger trg_companies_shopify_enqueue after update of round_sale_prices_up on public.companies
  for each row execute function public.trg_shopify_enqueue_rounding();

-- 9. Actions de l'écran (administrateurs), tracées dans events

-- Choisir le mode. Passer en « essai » ou « tous » met en file les articles concernés (premier envoi complet).
create or replace function public.shopify_sync_set_mode(_company uuid, _mode text)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_mode text;
  n        int := 0;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if _mode not in ('arrete', 'essai', 'tous') then
    raise exception 'Mode inconnu : %', _mode using errcode = '22023';
  end if;
  old_mode := public._shopify_sync_mode(_company);
  insert into public.shopify_sync_settings (company_id, mode, updated_by, updated_at)
  values (_company, _mode, auth.uid(), now())
  on conflict (company_id) do update set mode = excluded.mode, updated_by = excluded.updated_by, updated_at = now();

  if _mode <> 'arrete' and _mode is distinct from old_mode then
    select count(*) into n from (
      select public._shopify_enqueue(_company, l.article_id, 'mode') as queued
        from (select distinct article_id from public.shopify_links
               where company_id = _company and status in ('auto_exact', 'valide') and article_id is not null) l
       where _mode = 'tous'
          or exists (select 1 from public.shopify_sync_trial t where t.company_id = _company and t.article_id = l.article_id)
    ) x where x.queued;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'shopify_sync_mode', 'shopify_sync_settings', _company::text, 'screen',
          jsonb_build_object('mode', old_mode), jsonb_build_object('mode', _mode, 'queued', n));
  return n;
end $$;
revoke all on function public.shopify_sync_set_mode(uuid, text) from public, anon;
grant execute on function public.shopify_sync_set_mode(uuid, text) to authenticated;

-- Ajouter / retirer un article d'essai
create or replace function public.shopify_sync_trial_add(_company uuid, _article uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.articles where id = _article and company_id = _company) then
    raise exception 'Article introuvable dans cette société.' using errcode = 'P0002';
  end if;
  insert into public.shopify_sync_trial (company_id, article_id, added_by) values (_company, _article, auth.uid())
  on conflict do nothing;
  if found then
    perform public._shopify_enqueue(_company, _article, 'essai');
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'shopify_sync_trial_add', 'articles', _article::text, 'screen', null, null);
  end if;
end $$;
revoke all on function public.shopify_sync_trial_add(uuid, uuid) from public, anon;
grant execute on function public.shopify_sync_trial_add(uuid, uuid) to authenticated;

create or replace function public.shopify_sync_trial_remove(_company uuid, _article uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  delete from public.shopify_sync_trial where company_id = _company and article_id = _article;
  if found then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'shopify_sync_trial_remove', 'articles', _article::text, 'screen', null, null);
  end if;
end $$;
revoke all on function public.shopify_sync_trial_remove(uuid, uuid) from public, anon;
grant execute on function public.shopify_sync_trial_remove(uuid, uuid) to authenticated;

-- « Tout resynchroniser » : remet en file tous les articles reliés (le mode décide ensuite ce qui part).
create or replace function public.shopify_sync_resync_all(_company uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  select count(*) into n from (
    select public._shopify_enqueue(_company, l.article_id, 'resync') as queued
      from (select distinct article_id from public.shopify_links
             where company_id = _company and status in ('auto_exact', 'valide') and article_id is not null) l
  ) x where x.queued;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'shopify_sync_resync_all', 'shopify_sync_queue', _company::text, 'screen',
          null, jsonb_build_object('queued', n, 'mode', public._shopify_sync_mode(_company)));
  return n;
end $$;
revoke all on function public.shopify_sync_resync_all(uuid) from public, anon;
grant execute on function public.shopify_sync_resync_all(uuid) to authenticated;

-- État de la synchronisation pour l'écran (mode, file, dernier envoi, articles d'essai)
create or replace function public.shopify_sync_status(_company uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  select jsonb_build_object(
    'mode', public._shopify_sync_mode(_company),
    'mode_updated_at', (select updated_at from public.shopify_sync_settings where company_id = _company),
    'queue_pending', (select count(*) from public.shopify_sync_queue where company_id = _company),
    'queue_errors', (select count(*) from public.shopify_sync_queue where company_id = _company and last_error is not null),
    'linked', (select count(distinct article_id) from public.shopify_links
                where company_id = _company and status in ('auto_exact', 'valide') and article_id is not null),
    'last_ok_at', (select max(created_at) from public.shopify_sync_log where company_id = _company and status <> 'erreur'),
    'trial', coalesce((
      select jsonb_agg(jsonb_build_object(
               'article_id', t.article_id, 'reference', a.reference, 'designation', a.designation,
               'publishable', a.publishable,
               'linked', exists (select 1 from public.shopify_links l where l.company_id = _company
                                  and l.article_id = t.article_id and l.status in ('auto_exact', 'valide')),
               'added_at', t.added_at) order by a.reference)
        from public.shopify_sync_trial t join public.articles a on a.id = t.article_id
       where t.company_id = _company), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.shopify_sync_status(uuid) from public, anon;
grant execute on function public.shopify_sync_status(uuid) to authenticated;

-- 10. Fonctions internes de la fonction serveur shopify-push (clé de service uniquement)

-- Sociétés dont la file a du travail ET dont la synchronisation n'est pas arrêtée
create or replace function public._shopify_push_companies()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select s.company_id from public.shopify_sync_settings s
   where s.mode <> 'arrete'
     and exists (select 1 from public.shopify_sync_queue q where q.company_id = s.company_id and q.next_attempt_at <= now());
$$;
revoke all on function public._shopify_push_companies() from public, anon, authenticated;
grant execute on function public._shopify_push_companies() to service_role;

-- Prend un lot de la file (verrou 5 min) — seulement les articles autorisés par le mode.
-- _articles non vide = SIMULATION : lit ces articles sans toucher à la file ni au mode.
create or replace function public._shopify_push_claim(_company uuid, _limit integer, _articles uuid[] default null)
returns table (
  queue_id bigint, article_id uuid, reference text, mgmt_type text,
  shopify_product_id text, shopify_variant_id text,
  sale_price_ttc numeric, sale_price_ht numeric, vat_rate numeric, round_up boolean,
  real_qty numeric, reserved_qty numeric, requested_at timestamptz, reasons text[]
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m text := public._shopify_sync_mode(_company);
  ids bigint[];
begin
  if _articles is null then
    if m = 'arrete' then return; end if;
    -- Articles déliés entre-temps (ou variante retirée du site) : plus rien à envoyer.
    delete from public.shopify_sync_queue q
     where q.company_id = _company
       and not exists (select 1 from public.shopify_links l
                         join public.shopify_products p on p.company_id = l.company_id
                              and p.shopify_variant_id = l.shopify_variant_id and p.removed_at is null
                        where l.company_id = _company and l.article_id = q.article_id
                          and l.status in ('auto_exact', 'valide'));
    with c as (
      select q.id from public.shopify_sync_queue q
       where q.company_id = _company and q.next_attempt_at <= now()
         and (q.locked_at is null or q.locked_at < now() - interval '5 minutes')
         and (m = 'tous' or exists (select 1 from public.shopify_sync_trial t
                                     where t.company_id = _company and t.article_id = q.article_id))
       order by q.requested_at
       limit greatest(1, least(_limit, 250))
       for update skip locked
    ), u as (
      update public.shopify_sync_queue q set locked_at = now() from c where q.id = c.id
      returning q.id
    )
    select array_agg(u.id) into ids from u;
    if ids is null then return; end if;
  end if;

  return query
  select q.id, a.id, a.reference, a.mgmt_type::text,
         p.shopify_product_id, l.shopify_variant_id,
         a.sale_price_ttc, a.sale_price_ht, a.vat_rate, coalesce(c.round_sale_prices_up, true),
         coalesce(s.real_qty, 0), coalesce(s.reserved_qty, 0), q.requested_at, q.reasons
    from public.articles a
    join public.companies c on c.id = a.company_id
    join public.shopify_links l on l.company_id = _company and l.article_id = a.id and l.status in ('auto_exact', 'valide')
    join public.shopify_products p on p.company_id = _company and p.shopify_variant_id = l.shopify_variant_id and p.removed_at is null
    left join public.shopify_sync_queue q on q.company_id = _company and q.article_id = a.id
    left join lateral (
      select sum(case when not m2.is_reservation then m2.qty_delta else 0 end) as real_qty,
             sum(case when m2.is_reservation then m2.qty_delta else 0 end) as reserved_qty
        from public.stock_moves m2 where m2.article_id = a.id
    ) s on true
   where a.company_id = _company
     and (case when _articles is null then q.id = any(coalesce(ids, '{}')) else a.id = any(_articles) end);
end $$;
revoke all on function public._shopify_push_claim(uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public._shopify_push_claim(uuid, integer, uuid[]) to service_role;

-- Résultat d'un lot : journal + file (réussite = ligne retirée si rien de neuf n'est arrivé entre-temps ;
-- erreur = nouvel essai plus tard, 2, 4, 8… minutes, 60 min au plus).
-- _results = [{queue_id, article_id, product_id, variant_id, status, price_before, price_sent,
--              qty_before, qty_sent, detail, requested_at}]
create or replace function public._shopify_push_done(_company uuid, _results jsonb, _actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n_ok int; n_err int;
begin
  insert into public.shopify_sync_log (company_id, article_id, shopify_product_id, shopify_variant_id, kind, status,
                                       price_before, price_sent, qty_before, qty_sent, detail, actor_id)
  select _company, x.article_id, x.product_id, x.variant_id, 'stock_prix', x.status,
         x.price_before, x.price_sent, x.qty_before, x.qty_sent, left(x.detail, 1000), _actor
    from jsonb_to_recordset(coalesce(_results, '[]'::jsonb)) as x(
           queue_id bigint, article_id uuid, product_id text, variant_id text, status text,
           price_before numeric, price_sent numeric, qty_before int, qty_sent int, detail text, requested_at timestamptz)
   where x.status in ('ok', 'deja_a_jour', 'erreur')
     and exists (select 1 from public.articles a where a.id = x.article_id and a.company_id = _company);

  -- Instantané Shopify de l'écran : prix et stock tels qu'envoyés (données Shopify, pas le DMS).
  update public.shopify_products p
     set price = coalesce(x.price_sent, p.price), inventory_quantity = coalesce(x.qty_sent, p.inventory_quantity)
    from jsonb_to_recordset(coalesce(_results, '[]'::jsonb)) as x(variant_id text, status text, price_sent numeric, qty_sent int)
   where p.company_id = _company and p.shopify_variant_id = x.variant_id and x.status = 'ok';

  with r as (
    select * from jsonb_to_recordset(coalesce(_results, '[]'::jsonb))
      as x(queue_id bigint, status text, detail text, requested_at timestamptz)
  ), d as (
    delete from public.shopify_sync_queue q using r
     where q.id = r.queue_id and q.company_id = _company and r.status in ('ok', 'deja_a_jour')
       and q.requested_at <= r.requested_at
    returning q.id
  )
  select count(*) into n_ok from d;

  -- Réussite mais nouvelle demande arrivée pendant l'envoi : la ligne reste, déverrouillée.
  update public.shopify_sync_queue q set locked_at = null
    from jsonb_to_recordset(coalesce(_results, '[]'::jsonb)) as x(queue_id bigint, status text)
   where q.id = x.queue_id and q.company_id = _company and x.status in ('ok', 'deja_a_jour');

  with r as (
    select * from jsonb_to_recordset(coalesce(_results, '[]'::jsonb))
      as x(queue_id bigint, status text, detail text)
  ), u as (
    update public.shopify_sync_queue q
       set attempts = q.attempts + 1,
           next_attempt_at = now() + least(interval '60 minutes', interval '1 minute' * power(2, least(q.attempts + 1, 6))),
           locked_at = null,
           last_error = left(r.detail, 500)
      from r
     where q.id = r.queue_id and q.company_id = _company and r.status = 'erreur'
    returning q.id
  )
  select count(*) into n_err from u;

  return jsonb_build_object('done', n_ok, 'retry', n_err);
end $$;
revoke all on function public._shopify_push_done(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public._shopify_push_done(uuid, jsonb, uuid) to service_role;

-- 11. Tâche planifiée : toutes les 3 minutes, et SEULEMENT s'il y a du travail autorisé
--     (société en « essai » ou « tous » avec une file non vide). Aucun appel sinon.
select cron.schedule('shopify-push', '*/3 * * * *', $cron$
  select net.http_post(
    'https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/shopify-push',
    '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ))
  where exists (select 1 from public._shopify_push_companies());
$cron$);
