-- =====================================================================
-- M0 — Tables de paramètres / référentiels G8 (écran « Tables de données »)
-- Approche générique : une table `reference_values` discriminée par `table_key`,
-- + colonnes spécifiques en JSONB (`extra`). CRUD générique côté UI.
-- Couvre : TVA, modes/conditions de règlement, civilités, marques, types de cession,
-- couleurs, tailles, pays, natures/catégories produit fini, financement, assurances, expo…
-- =====================================================================

create table if not exists public.reference_values (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  table_key   text not null,                 -- ex. 'vat_rate', 'payment_method', 'civility'…
  code        text not null,
  label       text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  extra       jsonb not null default '{}'::jsonb,  -- colonnes spécifiques (taux, compte, flags…)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, table_key, code)
);
create index if not exists idx_refvalues_company_table on public.reference_values(company_id, table_key);

drop trigger if exists trg_refvalues_updated on public.reference_values;
create trigger trg_refvalues_updated before update on public.reference_values
  for each row execute function public.set_updated_at();
drop trigger if exists trg_refvalues_audit on public.reference_values;
create trigger trg_refvalues_audit after insert or update or delete on public.reference_values
  for each row execute function public.audit_row();

alter table public.reference_values enable row level security;
drop policy if exists refvalues_select on public.reference_values;
create policy refvalues_select on public.reference_values for select to authenticated using (public.is_member(company_id));
drop policy if exists refvalues_write on public.reference_values;
create policy refvalues_write on public.reference_values for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- ---------------------------------------------------------------------
-- Seed des valeurs standard G8 (depuis les captures) pour les 2 sociétés
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, d.table_key, d.code, d.label, d.sort_order, d.extra::jsonb
from public.companies c
cross join (values
  -- Taux de TVA
  ('vat_rate','01','TVA 21% BELGE STD',1,'{"rate":21,"regime":"standard"}'),
  ('vat_rate','02','TVA 6% BELGE',2,'{"rate":6,"regime":"standard"}'),
  ('vat_rate','03','TVA 0% BELGE',3,'{"rate":0,"regime":"exempt"}'),
  ('vat_rate','04','TVA 0% INTRACOM',4,'{"rate":0,"regime":"intracom"}'),
  ('vat_rate','05','TVA 0% EXPORT',5,'{"rate":0,"regime":"export"}'),
  ('vat_rate','06','TVA MARGE VO',6,'{"rate":21,"regime":"marge"}'),
  -- Modes de règlement
  ('payment_method','ESP','Espèces',1,'{"visible_pos":true}'),
  ('payment_method','MAE','Maestro / Débit',2,'{"visible_pos":true}'),
  ('payment_method','VIR','Virement',3,'{"visible_pos":true}'),
  ('payment_method','VID','Visa/Mastercard Débit',4,'{"visible_pos":true}'),
  ('payment_method','VIC','Visa/Mastercard Crédit',5,'{"visible_pos":true}'),
  ('payment_method','CHQC','Chèque cadeau',6,'{"visible_pos":true}'),
  ('payment_method','PPL','PayPal',7,'{"visible_pos":true}'),
  ('payment_method','REP','Reprise moto',8,'{"visible_pos":true}'),
  -- Conditions de règlement
  ('payment_term','COMPTANT','Au grand comptant',1,'{"days":0,"eom":false,"lcr":false}'),
  ('payment_term','30N','30 jours net',2,'{"days":30,"eom":false,"lcr":false}'),
  ('payment_term','30FM','30 jours fin de mois',3,'{"days":30,"eom":true,"lcr":false}'),
  ('payment_term','60N','60 jours net',4,'{"days":60,"eom":false,"lcr":false}'),
  ('payment_term','60FM','60 jours fin de mois',5,'{"days":60,"eom":true,"lcr":false}'),
  -- Civilités (flag professionnel)
  ('civility','MR','Monsieur',1,'{"professional":false,"default":true}'),
  ('civility','MME','Madame',2,'{"professional":false}'),
  ('civility','SRL','SRL',10,'{"professional":true}'),
  ('civility','SA','SA',11,'{"professional":true}'),
  ('civility','SPRL','SPRL',12,'{"professional":true}'),
  ('civility','SCRL','SCRL',13,'{"professional":true}'),
  ('civility','ASBL','ASBL',14,'{"professional":true}'),
  ('civility','BV','BV',15,'{"professional":true}'),
  -- Marques (typées)
  ('brand','DUCATI','Ducati',1,'{"kind":"produit_fini"}'),
  ('brand','APRILIA','Aprilia',2,'{"kind":"produit_fini"}'),
  ('brand','BMW','BMW',3,'{"kind":"produit_fini"}'),
  ('brand','HONDA','Honda',4,'{"kind":"produit_fini"}'),
  ('brand','KTM','KTM',5,'{"kind":"produit_fini"}'),
  ('brand','YAMAHA','Yamaha',6,'{"kind":"produit_fini"}'),
  ('brand','PIRELLI','Pirelli',20,'{"kind":"pneu"}'),
  ('brand','METZELER','Metzeler',21,'{"kind":"pneu"}'),
  ('brand','RIZOMA','Rizoma',30,'{"kind":"piece"}'),
  -- Types de cession interne
  ('cession_type','01','Cession VO',1,'{"accounted":true}'),
  ('cession_type','02','Cession VN démo',2,'{"accounted":true}'),
  ('cession_type','03','Besoin atelier',3,'{"accounted":false}'),
  ('cession_type','04','Vol / Casse',4,'{"accounted":true}'),
  ('cession_type','05','Garantie fournisseur',5,'{"accounted":true}'),
  ('cession_type','06','Garantie magasin/atelier',6,'{"accounted":true}'),
  ('cession_type','07','Geste commercial',7,'{"accounted":true}'),
  -- Catégorie client
  ('client_category','01','Général',1,'{}'),
  ('client_category','99','Internet',2,'{}'),
  -- Catégories produit fini (gammes Ducati)
  ('product_category','PANIGALE','Panigale',1,'{}'),
  ('product_category','MONSTER','Monster',2,'{}'),
  ('product_category','MULTISTRADA','Multistrada',3,'{}'),
  ('product_category','STREETFIGHTER','Streetfighter',4,'{}'),
  ('product_category','SCRAMBLER','Scrambler',5,'{}'),
  ('product_category','DIAVEL','Diavel',6,'{}'),
  ('product_category','HYPERMOTARD','Hypermotard',7,'{}'),
  ('product_category','DESERTX','DesertX',8,'{}'),
  ('product_category','SUPERSPORT','SuperSport',9,'{}'),
  -- Pays
  ('country','BE','Belgique',1,'{"default":true}'),
  ('country','FR','France',2,'{}'),
  ('country','NL','Pays-Bas',3,'{}'),
  ('country','LU','Luxembourg',4,'{}'),
  -- Couleurs / tailles (exemples, extensibles)
  ('color','NOIR','Noir',1,'{}'),
  ('color','ROUGE','Rouge',2,'{}'),
  ('color','BLANC','Blanc',3,'{}'),
  ('size','S','S',1,'{}'),
  ('size','M','M',2,'{}'),
  ('size','L','L',3,'{}'),
  ('size','XL','XL',4,'{}')
) as d(table_key, code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;
