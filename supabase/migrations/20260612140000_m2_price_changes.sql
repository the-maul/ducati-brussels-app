-- =====================================================================
-- M2 — `price_changes` append-only (B5/B7) : tracer TOUTE modification de prix.
-- Règle 3 CLAUDE.md : pas d'UPDATE silencieux sur les prix. À la différence du
-- stock (somme de mouvements), un article PORTE son prix courant (comme le PAMP) ;
-- on garde donc le champ + un HISTORIQUE append-only de chaque changement, capturé
-- par TRIGGER (impossible à contourner — cascade, fiche, import, API : tout est tracé).
-- =====================================================================

create table if not exists public.price_changes (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies(id) on delete restrict,
  article_id   uuid not null references public.articles(id) on delete restrict,
  old_purchase numeric(14,4), new_purchase numeric(14,4),   -- PA
  old_sale_ht  numeric(14,3), new_sale_ht  numeric(14,3),   -- PV HT
  old_sale_ttc numeric(14,2), new_sale_ttc numeric(14,2),   -- PV TTC
  old_coef     numeric(14,4), new_coef     numeric(14,4),   -- coefficient
  origin       text not null default 'screen',              -- screen | cascade | import | reception | api
  operator_id  uuid references auth.users(id) on delete set null,
  occurred_at  timestamptz not null default now()
);
create index if not exists idx_pricechanges_article on public.price_changes(article_id, occurred_at desc);
create index if not exists idx_pricechanges_company on public.price_changes(company_id);

-- Append-only : insert + select pour les membres ; update/delete révoqués (comme stock_moves).
alter table public.price_changes enable row level security;
drop policy if exists pricechanges_select on public.price_changes;
create policy pricechanges_select on public.price_changes for select to authenticated using (public.is_member(company_id));
drop policy if exists pricechanges_insert on public.price_changes;
create policy pricechanges_insert on public.price_changes for insert to authenticated with check (public.is_member(company_id));
revoke update, delete on public.price_changes from authenticated;

-- ---------------------------------------------------------------------
-- Trigger : sur tout changement d'un prix de l'article, écrit une ligne tracée.
-- SECURITY DEFINER (insert même sous RLS). Origine lue depuis un GUC transaction-local
-- (`app.price_change_origin`) posé par record_price_change ; sinon 'screen'.
-- ---------------------------------------------------------------------
create or replace function public.trace_price_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.purchase_price  is distinct from old.purchase_price
     or new.sale_price_ht  is distinct from old.sale_price_ht
     or new.sale_price_ttc is distinct from old.sale_price_ttc
     or new.coefficient    is distinct from old.coefficient then
    insert into public.price_changes (
      company_id, article_id,
      old_purchase, new_purchase, old_sale_ht, new_sale_ht,
      old_sale_ttc, new_sale_ttc, old_coef, new_coef, origin, operator_id)
    values (
      new.company_id, new.id,
      old.purchase_price, new.purchase_price, old.sale_price_ht, new.sale_price_ht,
      old.sale_price_ttc, new.sale_price_ttc, old.coefficient, new.coefficient,
      coalesce(nullif(current_setting('app.price_change_origin', true), ''), 'screen'),
      auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_articles_price_change on public.articles;
create trigger trg_articles_price_change after update on public.articles
  for each row execute function public.trace_price_change();

-- ---------------------------------------------------------------------
-- record_price_change : modifie les prix d'un article en taguant l'ORIGINE
-- (le trigger trace alors avec cette origine). N'écrit que les champs fournis.
-- ---------------------------------------------------------------------
create or replace function public.record_price_change(
  _article uuid, _purchase numeric default null, _sale_ht numeric default null,
  _sale_ttc numeric default null, _coef numeric default null, _origin text default 'screen'
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid;
begin
  select company_id into _company from public.articles where id = _article;
  if _company is null then raise exception 'Article introuvable'; end if;
  if auth.uid() is not null and not public.is_member(_company) then raise exception 'Accès refusé'; end if;

  perform set_config('app.price_change_origin', coalesce(_origin, 'screen'), true); -- transaction-local
  update public.articles set
    purchase_price = coalesce(_purchase, purchase_price),
    sale_price_ht  = coalesce(_sale_ht,  sale_price_ht),
    sale_price_ttc = coalesce(_sale_ttc, sale_price_ttc),
    coefficient    = coalesce(_coef,     coefficient)
  where id = _article;
end $$;
grant execute on function public.record_price_change(uuid, numeric, numeric, numeric, numeric, text) to authenticated, service_role;
