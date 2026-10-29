-- M2 — Grille des classes de remise fournisseur (prix d'achat depuis le tarif Ducati).
--
-- Decision client du 29/10/2026 (mission 06). Les fichiers de tarif Ducati
-- (ListPrice PARTS / ACCESSORIES / APPAREL) donnent pour chaque reference un
-- prix catalogue HT (« Prix au detail », range dans articles.ppc_ht) et une
-- « Classe de remise » (une lettre : A, B, C, ...). Le prix d'achat ne figure
-- dans aucun fichier : il se deduit de la grille « classe -> pourcentage »,
-- negociee avec Ducati, qui n'etait jusqu'ici que dans G8.
--
--   prix d'achat HT = prix catalogue HT x (1 - remise % / 100), arrondi au centime
--
-- La grille vit ici, par societe, et se modifie dans l'ecran Import tarif
-- (bloc « Classes de remise (achat) », accessible depuis Parametres).
-- Elle est prechargee avec la grille G8 pour chaque societe existante.

-- 1. La lettre de classe sur l'article (le tarif la donne, on la garde).
alter table public.articles add column if not exists discount_group text;

comment on column public.articles.discount_group is
  'Classe de remise du tarif fournisseur (lettre Ducati). Sert a calculer le prix d''achat via supplier_discount_classes.';

-- 2. La grille.
create table if not exists public.supplier_discount_classes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  -- Nom du fournisseur ('Ducati'...). NULL = vaut pour tous les fournisseurs.
  supplier_name text,
  -- La classe, en majuscules. '' = « sans classe » (ligne du tarif sans lettre).
  code          text not null default '',
  -- Remise en pourcentage sur le prix catalogue HT (0..100).
  discount_pct  numeric(6,2) not null default 0,
  -- Une classe inactive ne calcule aucun prix d'achat (anomalie a l'import).
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint supplier_discount_classes_pct_ck check (discount_pct >= 0 and discount_pct <= 100),
  constraint supplier_discount_classes_code_ck check (code = upper(code))
);

-- Unicite : une seule ligne par societe / fournisseur / classe. NULL n'etant pas
-- comparable dans une contrainte unique classique, on passe par un index sur
-- coalesce(supplier_name, '').
create unique index if not exists supplier_discount_classes_unique
  on public.supplier_discount_classes (company_id, coalesce(supplier_name, ''), code);

create index if not exists idx_supplier_discount_classes_company
  on public.supplier_discount_classes (company_id);

alter table public.supplier_discount_classes enable row level security;

drop policy if exists "supplier_discount_classes_lecture" on public.supplier_discount_classes;
create policy "supplier_discount_classes_lecture" on public.supplier_discount_classes
  for select using (public.is_member(company_id));

drop policy if exists "supplier_discount_classes_ecriture" on public.supplier_discount_classes;
create policy "supplier_discount_classes_ecriture" on public.supplier_discount_classes
  for all using (public.is_admin(company_id)) with check (public.is_admin(company_id));

comment on table public.supplier_discount_classes is
  'Grille des classes de remise fournisseur : classe -> remise % sur le prix catalogue HT. Prix d''achat = ppc_ht x (1 - remise/100). NULL en fournisseur = tous.';

-- updated_at tenu a jour.
create or replace function public.supplier_discount_classes_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_supplier_discount_classes_touch on public.supplier_discount_classes;
create trigger trg_supplier_discount_classes_touch
  before update on public.supplier_discount_classes
  for each row execute function public.supplier_discount_classes_touch();

-- 3. Prechargement : la grille G8 pour CHAQUE societe existante (idempotent :
--    une ligne deja presente n'est pas touchee, pour ne pas ecraser un reglage).
--    EB, J, O, V, Z sont a 0 % et inactives : G8 ne leur donnait pas de remise,
--    l'import signalera ces lignes au lieu de calculer un prix d'achat faux.
insert into public.supplier_discount_classes (company_id, supplier_name, code, discount_pct, is_active)
select c.id, null, g.code, g.pct, g.actif
  from public.companies c
  cross join (values
    ('A',  25, true),
    ('B',  35, true),
    ('C',  45, true),
    ('D',  10, true),
    ('E',  50, true),
    ('H',  30, true),
    ('I',  35, true),
    ('L',  20, true),
    ('M',  40, true),
    ('N',  30, true),
    ('P',  30, true),
    ('Q',  30, true),
    ('R',  45, true),
    ('S',  60, true),
    ('T',  30, true),
    ('W',   5, true),
    ('X',  30, true),
    ('Y',  25, true),
    ('',   25, true),
    ('EB',  0, false),
    ('J',   0, false),
    ('O',   0, false),
    ('V',   0, false),
    ('Z',   0, false)
  ) as g(code, pct, actif)
on conflict (company_id, coalesce(supplier_name, ''), code) do nothing;
