-- =====================================================================
-- Rattrapage G8 (18/11/2026, lot parc) — affichettes et catalogue d'options par modele.
-- (docs/g8-inventaire/03-vehicules.md : « Edition d'affichette produit fini », « Catalogue d'options »)
--   1. poster_templates : modeles d'affichette (moto ou article) avec balises [REFERENCE] [MODELE]
--      [PRIXTTC] [KILOMETRAGE]... ; 1 ou 2 affichettes par page ; le PDF est fait a l'ecran.
--   2. vehicle_option_models / vehicle_options : catalogue d'options par modele (groupe, code,
--      libelle, prix d'achat HT, prix de vente TTC, infos) — repris dans la vente de moto neuve
--      (« PV vehicule + options »). Un modele peut etre relie a l'article V du modele.
-- Idempotente, non destructive ; RLS par societe ; trace par audit_row (B7).
-- Aucun prix d'article n'est modifie ici (B7) : les options sont un catalogue, la vente ecrit
-- des lignes de document comme toute autre ligne.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Modeles d'affichette
-- ---------------------------------------------------------------------
create table if not exists public.poster_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  kind        text not null default 'vehicle' check (kind in ('vehicle', 'article')),
  name        text not null,
  body        text not null,
  per_page    smallint not null default 1 check (per_page in (1, 2)),
  is_default  boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists uq_poster_templates_name on public.poster_templates (company_id, kind, lower(name));

drop trigger if exists trg_poster_templates_updated on public.poster_templates;
create trigger trg_poster_templates_updated before update on public.poster_templates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_poster_templates_audit on public.poster_templates;
create trigger trg_poster_templates_audit after insert or update or delete on public.poster_templates
  for each row execute function public.audit_row();

alter table public.poster_templates enable row level security;
drop policy if exists poster_templates_select on public.poster_templates;
create policy poster_templates_select on public.poster_templates for select to authenticated
  using (public.is_member(company_id));
drop policy if exists poster_templates_write on public.poster_templates;
create policy poster_templates_write on public.poster_templates for all to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur') or public.has_role(company_id, 'marketing'))
  with check (public.is_admin(company_id) or public.has_role(company_id, 'vendeur') or public.has_role(company_id, 'marketing'));

-- ---------------------------------------------------------------------
-- 2. Catalogue d'options par modele
-- ---------------------------------------------------------------------
create table if not exists public.vehicle_option_models (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  code        text not null,
  label       text not null,
  article_id  uuid references public.articles(id) on delete set null,   -- modele (article V), facultatif
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists uq_vehicle_option_models_code on public.vehicle_option_models (company_id, upper(code));
create index if not exists idx_vehicle_option_models_article on public.vehicle_option_models (article_id) where article_id is not null;

create table if not exists public.vehicle_options (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  model_id           uuid not null references public.vehicle_option_models(id) on delete cascade,
  group_code         text,
  code               text not null,
  label              text not null,
  purchase_price_ht  numeric(12,2) not null default 0 check (purchase_price_ht >= 0),
  sale_price_ttc     numeric(12,2) not null default 0 check (sale_price_ttc >= 0),
  vat_rate           numeric(5,2) not null default 21,
  info               text,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists uq_vehicle_options_code on public.vehicle_options (model_id, upper(code));
create index if not exists idx_vehicle_options_model on public.vehicle_options (model_id, sort_order);

-- La societe d'une option est celle de son modele.
create or replace function public._vehicle_option_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select m.company_id into new.company_id from public.vehicle_option_models m where m.id = new.model_id;
  if new.company_id is null then raise exception 'Modele introuvable' using errcode = 'P0002'; end if;
  return new;
end $$;
drop trigger if exists trg_vehicle_options_company on public.vehicle_options;
create trigger trg_vehicle_options_company before insert or update of model_id on public.vehicle_options
  for each row execute function public._vehicle_option_company();

do $$
declare tb text;
begin
  foreach tb in array array['vehicle_option_models', 'vehicle_options'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', tb);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.set_updated_at()', tb);
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$s', tb);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function public.audit_row()', tb);
    execute format('alter table public.%1$s enable row level security', tb);
    execute format('drop policy if exists %1$s_select on public.%1$s', tb);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member(company_id))', tb);
    execute format('drop policy if exists %1$s_write on public.%1$s', tb);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated '
                   'using (public.is_admin(company_id) or public.has_role(company_id, ''vendeur'')) '
                   'with check (public.is_admin(company_id) or public.has_role(company_id, ''vendeur''))', tb);
  end loop;
end $$;

/**
 * « Dupliquer » un modele du catalogue d'options (G8) : nouveau code + libelle, options recopiees.
 */
create or replace function public.vehicle_option_model_duplicate(_model uuid, _code text, _label text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.vehicle_option_models; nid uuid;
begin
  select * into m from public.vehicle_option_models where id = _model;
  if m.id is null then raise exception 'Modele introuvable' using errcode = 'P0002'; end if;
  if not (public.is_admin(m.company_id) or public.has_role(m.company_id, 'vendeur')) then
    raise exception 'Acces refuse' using errcode = '42501';
  end if;
  insert into public.vehicle_option_models (company_id, code, label, article_id)
  values (m.company_id, btrim(_code), coalesce(nullif(btrim(_label), ''), m.label), null)
  returning id into nid;
  insert into public.vehicle_options (company_id, model_id, group_code, code, label, purchase_price_ht, sale_price_ttc, vat_rate, info, sort_order)
  select m.company_id, nid, o.group_code, o.code, o.label, o.purchase_price_ht, o.sale_price_ttc, o.vat_rate, o.info, o.sort_order
    from public.vehicle_options o where o.model_id = m.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (m.company_id, auth.uid(), 'vehicle_option_model_duplicate', 'vehicle_option_models', nid::text, 'screen',
          jsonb_build_object('source', m.id, 'code', m.code), jsonb_build_object('code', _code, 'label', _label));
  return nid;
end $$;
revoke all on function public.vehicle_option_model_duplicate(uuid, text, text) from public, anon;
grant execute on function public.vehicle_option_model_duplicate(uuid, text, text) to authenticated;

comment on table public.poster_templates is 'Rattrapage G8 : modeles d''affichette (moto / article) a balises, 1 ou 2 par page.';
comment on table public.vehicle_option_models is 'Rattrapage G8 : catalogue d''options, les modeles.';
comment on table public.vehicle_options is 'Rattrapage G8 : catalogue d''options, les options d''un modele (PA HT, PV TTC).';
