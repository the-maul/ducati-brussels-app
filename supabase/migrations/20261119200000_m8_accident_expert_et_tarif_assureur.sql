-- =====================================================================
-- M8 — OR accident : expert modifiable des deux cotes (Q51) et tarif de l'assureur applique (T4).
-- Lot « lot-accident-expert » (19/11/2026). Sources : docs/g8-inventaire/07-atelier.md §1 (onglet
-- Assurance), §12 (fiche assurance : « code tarif associe automatiquement aux O.R. assurance »),
-- a-trancher.md T4, T5, Q51 (decision client du 19/11).
--
-- 1. Q51 — expert et date de passage : UNE seule source, le dossier accident (`accident_files` :
--    expert_id, expert_name, expert_visit_date). Les colonnes de l'OR (`repair_orders.expert_name`,
--    `expert_date`) deviennent un MIROIR tenu par la base, dans les deux sens :
--    - saisie depuis l'OR ou depuis le dossier : fonction `accident_file_set_expert` (expert choisi
--      dans la table des experts, origine « OR » ou « dossier ») ;
--    - toute ecriture directe reste coherente : modifier l'expert du dossier met l'OR a jour ;
--      modifier l'expert / la date de l'OR met le dossier a jour (expert retrouve par son nom dans
--      la table des experts) ; un dossier cree pour un OR qui a deja un expert le reprend ;
--    - chaque changement est trace dans `events` (action `accident_expert_change`, ancien / nouveau,
--      origine « OR » ou « dossier »), en plus de l'audit ligne a ligne existant ;
--    - controle : l'expert est une fiche « expert » de la meme societe, le cabinet une fiche
--      « cabinet » de la meme societe.
-- 2. T4 — tarif de l'assureur : la fiche cabinet porte un vrai lien vers un tarif commun
--    (`insurance_parties.price_list_id`, meme moteur que les tarifs clients : price_lists /
--    price_list_rules, ex. « REMISE 15 % ») ; l'ancien texte `price_list` est rattache au tarif de
--    meme code / libelle et reste affiche. `repair_order_price_list(_or)` dit quel tarif s'applique
--    a un OR : celui du cabinet du dossier accident s'il en a un (il l'emporte sur celui du client,
--    voir « A trancher » T4), sinon celui du client. Le CALCUL des prix reste celui de l'ecran
--    (src/modules/sales/customer-pricing.ts, le moteur unique de la vente, de la caisse et de l'OR) :
--    aucun second moteur en base. `repair_orders.insurer_price_list_id` retient le tarif assureur
--    avec lequel les lignes ont ete calculees (l'OR re-tarife ses lignes quand il change).
--
-- Prerequis (appliques en production) : 20261103110000 (dossiers accident), 20261118130000
-- (garantie et accident : insurance_parties, colonnes assureur du dossier), 20261118190000
-- (tarifs clients partages : price_lists).
-- STRICTEMENT ADDITIVE ET IDEMPOTENTE. NE PAS APPLIQUER depuis un agent : Simon l'applique en bloc.
-- Essai a blanc : supabase/tests/m8_accident_expert_tarif_assureur.sql (transaction annulee).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. T4 : tarif de la fiche cabinet (lien vers un tarif commun)
-- ---------------------------------------------------------------------
alter table public.insurance_parties
  add column if not exists price_list_id uuid references public.price_lists(id) on delete set null;
create index if not exists idx_insurance_parties_price_list on public.insurance_parties(price_list_id)
  where price_list_id is not null;

comment on column public.insurance_parties.price_list_id is
  'T4 (G8 « code tarif associe automatiquement aux O.R. assurance ») : tarif commun applique aux lignes des OR accident de ce cabinet ; il l''emporte sur le tarif du client. Meme moteur que les tarifs clients.';
comment on column public.insurance_parties.price_list is
  'Code du tarif associe (texte repris de G8). Rattache a price_list_id (meme code ou meme libelle) ; recopie depuis le tarif choisi.';

-- Meme societe ; un expert n'a pas de tarif ; le texte suit le tarif choisi, et un ancien texte
-- retrouve son tarif par le code, puis par le libelle.
create or replace function public.insurance_parties_price_list_sync()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _code text;
begin
  if new.kind = 'expert' then
    new.price_list_id := null;
    return new;
  end if;
  if new.price_list_id is not null then
    select pl.code into _code from public.price_lists pl
     where pl.id = new.price_list_id and pl.company_id = new.company_id;
    if _code is null then
      raise exception 'Tarif de l''assureur introuvable dans cette societe.' using errcode = '23514';
    end if;
    -- Tarif change a l'ecran : le code s'affiche a la place de l'ancien texte.
    if tg_op = 'INSERT' or new.price_list_id is distinct from old.price_list_id or nullif(btrim(coalesce(new.price_list, '')), '') is null then
      new.price_list := _code;
    end if;
  elsif nullif(btrim(coalesce(new.price_list, '')), '') is not null
        and (tg_op = 'INSERT' or new.price_list is distinct from old.price_list or old.price_list_id is not null) then
    -- Ancien texte (ou texte modifie) : tarif de meme code, sinon de meme libelle.
    select pl.id into new.price_list_id
      from public.price_lists pl
     where pl.company_id = new.company_id
       and (upper(btrim(pl.code)) = upper(btrim(new.price_list)) or upper(btrim(coalesce(pl.label, ''))) = upper(btrim(new.price_list)))
     order by (upper(btrim(pl.code)) = upper(btrim(new.price_list))) desc, pl.created_at
     limit 1;
    -- Tarif retire volontairement (id efface, texte inchange) : on ne le remet pas.
    if tg_op = 'UPDATE' and old.price_list_id is not null and new.price_list is not distinct from old.price_list then
      new.price_list_id := null;
      new.price_list := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.insurance_parties_price_list_sync() from public, anon, authenticated;

drop trigger if exists trg_insurance_parties_price_list on public.insurance_parties;
create trigger trg_insurance_parties_price_list before insert or update of price_list, price_list_id, kind, company_id
  on public.insurance_parties for each row execute function public.insurance_parties_price_list_sync();

-- Reprise des fiches existantes (texte -> tarif de meme code / libelle).
update public.insurance_parties p
   set price_list_id = pl.id
  from public.price_lists pl
 where p.price_list_id is null and p.kind = 'cabinet'
   and nullif(btrim(coalesce(p.price_list, '')), '') is not null
   and pl.company_id = p.company_id
   and (upper(btrim(pl.code)) = upper(btrim(p.price_list)) or upper(btrim(coalesce(pl.label, ''))) = upper(btrim(p.price_list)));

-- Tarif assureur avec lequel les lignes de l'OR ont ete calculees (null = tarif du client).
alter table public.repair_orders
  add column if not exists insurer_price_list_id uuid references public.price_lists(id) on delete set null;
comment on column public.repair_orders.insurer_price_list_id is
  'T4 : tarif du cabinet d''assurance applique aux lignes de cet OR accident (null = tarif du client). Ecrit par l''ecran a l''enregistrement ; quand le tarif effectif change (cabinet choisi, change ou retire), l''OR re-tarife ses lignes.';

-- ---------------------------------------------------------------------
-- 2. T4 : quel tarif s'applique a un OR ? (le calcul reste celui de l'ecran)
-- ---------------------------------------------------------------------
create or replace function public.repair_order_price_list(_or uuid)
returns table (source text, price_list_id uuid, code text, label text, insurer_id uuid, insurer_name text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with o as (
    select r.id, r.company_id, r.contact_id from public.repair_orders r where r.id = _or
  ), ins as (
    -- OR accident : le dossier accident de l'OR, son cabinet, le tarif actif du cabinet.
    select 'assureur'::text as source, pl.id, pl.code, pl.label, p.id as insurer_id, p.name as insurer_name, 1 as prio
      from o
      join public.accident_files f on f.repair_order_id = o.id and f.company_id = o.company_id
      join public.insurance_parties p on p.id = f.insurer_id and p.company_id = o.company_id and p.kind = 'cabinet'
      join public.price_lists pl on pl.id = p.price_list_id and pl.company_id = o.company_id and pl.is_active
     order by f.created_at desc
     limit 1
  ), cli as (
    -- Sinon le tarif du client : sa fiche, puis l'ancien texte (meme code, puis meme libelle).
    select 'client'::text, pl.id, pl.code, pl.label, null::uuid, null::text, 2
      from o
      join public.contacts c on c.id = o.contact_id
      join public.price_lists pl on pl.company_id = o.company_id and pl.is_active
       and (pl.id = c.price_list_id
            or (c.price_list_id is null and nullif(btrim(coalesce(c.price_list, '')), '') is not null
                and (upper(btrim(pl.code)) = upper(btrim(c.price_list)) or upper(btrim(coalesce(pl.label, ''))) = upper(btrim(c.price_list)))))
     order by (pl.id = c.price_list_id) desc, (upper(btrim(pl.code)) = upper(btrim(coalesce(c.price_list, '')))) desc
     limit 1
  )
  select x.source, x.id, x.code, x.label, x.insurer_id, x.insurer_name
    from (select * from ins union all select * from cli) x
   order by x.prio
   limit 1;
$$;

comment on function public.repair_order_price_list(uuid) is
  'T4 : tarif commun qui s''applique aux lignes d''un OR. source = assureur (cabinet du dossier accident, prioritaire) ou client. Aucune ligne = prix catalogue. RLS des tables (security invoker).';
revoke all on function public.repair_order_price_list(uuid) from public, anon;
grant execute on function public.repair_order_price_list(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Q51 : expert et date de passage, une seule source (le dossier), editables des deux cotes
-- ---------------------------------------------------------------------
comment on column public.repair_orders.expert_name is
  'Expert de l''OR. OR accident avec dossier : MIROIR du dossier accident (source unique, Q51), tenu par la base dans les deux sens.';
comment on column public.repair_orders.expert_date is
  'Date de passage de l''expert. OR accident avec dossier : MIROIR de accident_files.expert_visit_date (Q51).';

-- Trace metier d'un changement d'expert / de date de passage (origine « OR » ou « dossier »).
create or replace function public._accident_expert_log(_company uuid, _file uuid, _old jsonb, _new jsonb, _origin text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'accident_expert_change', 'accident_files', _file::text,
          case when _origin = 'OR' then 'OR' else 'dossier' end, _old, _new);
end $$;
revoke all on function public._accident_expert_log(uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;

-- Dossier, avant ecriture : controles, nom / e-mail repris de la fiche expert, reprise de l'OR.
create or replace function public.accident_files_expert_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _p public.insurance_parties%rowtype; _ro public.repair_orders%rowtype;
begin
  if new.insurer_id is not null and (tg_op = 'INSERT' or new.insurer_id is distinct from old.insurer_id) then
    if not exists (select 1 from public.insurance_parties p where p.id = new.insurer_id and p.company_id = new.company_id and p.kind = 'cabinet') then
      raise exception 'Cabinet d''assurance introuvable dans cette societe.' using errcode = '23514';
    end if;
  end if;

  -- Dossier rattache a un OR qui a deja un expert / une date (saisis avant le dossier) : repris.
  -- Chaque valeur manquante du dossier est prise sur l'OR (le dossier garde les siennes).
  if new.repair_order_id is not null and (tg_op = 'INSERT' or new.repair_order_id is distinct from old.repair_order_id) then
    select * into _ro from public.repair_orders r where r.id = new.repair_order_id and r.company_id = new.company_id;
    if found then
      if new.expert_id is null and nullif(btrim(coalesce(new.expert_name, '')), '') is null then
        new.expert_name := nullif(btrim(coalesce(_ro.expert_name, '')), '');
      end if;
      if new.expert_visit_date is null then
        new.expert_visit_date := _ro.expert_date;
      end if;
    end if;
  end if;
  -- Nom d'expert ecrit en texte (ancien OR, ancien ecran) : rattache a sa fiche s'il y en a une.
  if new.expert_id is null and nullif(btrim(coalesce(new.expert_name, '')), '') is not null
     and (tg_op = 'INSERT' or new.expert_name is distinct from old.expert_name or new.repair_order_id is distinct from old.repair_order_id) then
    select p.id into new.expert_id from public.insurance_parties p
     where p.company_id = new.company_id and p.kind = 'expert' and upper(btrim(p.name)) = upper(btrim(new.expert_name))
     order by p.is_active desc, p.created_at limit 1;
  end if;

  if new.expert_id is not null and (tg_op = 'INSERT' or new.expert_id is distinct from old.expert_id) then
    select * into _p from public.insurance_parties p where p.id = new.expert_id;
    if not found or _p.company_id <> new.company_id or _p.kind <> 'expert' then
      raise exception 'Expert introuvable dans cette societe (fiche « expert » attendue).' using errcode = '23514';
    end if;
    new.expert_name := _p.name;
    new.expert_email := coalesce(nullif(btrim(coalesce(_p.email, '')), ''), new.expert_email);
  elsif tg_op = 'UPDATE' and new.expert_id is null and old.expert_id is not null
        and new.expert_name is not distinct from old.expert_name then
    -- Expert retire (« Aucun ») : son nom part avec lui.
    new.expert_name := null;
  end if;
  new.expert_name := nullif(btrim(coalesce(new.expert_name, '')), '');
  return new;
end $$;
revoke all on function public.accident_files_expert_before() from public, anon, authenticated;

drop trigger if exists trg_accident_files_expert_before on public.accident_files;
create trigger trg_accident_files_expert_before before insert or update on public.accident_files
  for each row execute function public.accident_files_expert_before();

-- Dossier, apres ecriture : l'OR suit (miroir) et le changement est trace avec son origine.
create or replace function public.accident_files_expert_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _origin text := coalesce(nullif(current_setting('app.accident_expert_origin', true), ''), 'dossier');
begin
  if tg_op = 'UPDATE' and (new.expert_id, new.expert_name, new.expert_visit_date)
       is not distinct from (old.expert_id, old.expert_name, old.expert_visit_date)
     and new.repair_order_id is not distinct from old.repair_order_id then
    return new;
  end if;

  if new.repair_order_id is not null then
    perform set_config('app.accident_expert_sync', 'on', true);
    update public.repair_orders r
       set expert_name = new.expert_name, expert_date = new.expert_visit_date
     where r.id = new.repair_order_id and r.company_id = new.company_id
       and (r.expert_name is distinct from new.expert_name or r.expert_date is distinct from new.expert_visit_date);
    perform set_config('app.accident_expert_sync', '', true);
  end if;

  if tg_op = 'UPDATE' and (new.expert_id, new.expert_name, new.expert_visit_date)
       is distinct from (old.expert_id, old.expert_name, old.expert_visit_date) then
    perform public._accident_expert_log(new.company_id, new.id,
      jsonb_build_object('expert_id', old.expert_id, 'expert_name', old.expert_name, 'expert_visit_date', old.expert_visit_date, 'repair_order_id', old.repair_order_id),
      jsonb_build_object('expert_id', new.expert_id, 'expert_name', new.expert_name, 'expert_visit_date', new.expert_visit_date, 'repair_order_id', new.repair_order_id),
      _origin);
  end if;
  return new;
end $$;
revoke all on function public.accident_files_expert_after() from public, anon, authenticated;

drop trigger if exists trg_accident_files_expert_after on public.accident_files;
create trigger trg_accident_files_expert_after after insert or update on public.accident_files
  for each row execute function public.accident_files_expert_after();

-- OR, apres ecriture de l'expert / de la date : le dossier (la source) suit, origine « OR ».
create or replace function public.repair_orders_expert_to_file()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _name text := nullif(btrim(coalesce(new.expert_name, '')), ''); _expert uuid;
begin
  if coalesce(current_setting('app.accident_expert_sync', true), '') = 'on' then return new; end if;
  if new.expert_name is not distinct from old.expert_name and new.expert_date is not distinct from old.expert_date then return new; end if;
  if not exists (select 1 from public.accident_files f where f.repair_order_id = new.id) then return new; end if;

  if _name is not null then
    select p.id into _expert from public.insurance_parties p
     where p.company_id = new.company_id and p.kind = 'expert' and upper(btrim(p.name)) = upper(_name)
     order by p.is_active desc, p.created_at limit 1;
  end if;

  perform set_config('app.accident_expert_origin', 'OR', true);
  perform set_config('app.accident_expert_sync', 'on', true);
  update public.accident_files f
     set expert_id = _expert,
         expert_name = case when _expert is null then _name else f.expert_name end,
         expert_visit_date = new.expert_date
   where f.repair_order_id = new.id and f.company_id = new.company_id;
  perform set_config('app.accident_expert_sync', '', true);
  perform set_config('app.accident_expert_origin', '', true);
  return new;
end $$;
revoke all on function public.repair_orders_expert_to_file() from public, anon, authenticated;

drop trigger if exists trg_ro_expert_to_file on public.repair_orders;
create trigger trg_ro_expert_to_file after update of expert_name, expert_date on public.repair_orders
  for each row execute function public.repair_orders_expert_to_file();

-- Saisie depuis l'ecran (OR ou dossier) : expert choisi dans la table des experts (ou aucun),
-- date de passage ; le dossier est ecrit, l'OR suit, la trace porte l'origine.
create or replace function public.accident_file_set_expert(_file uuid, _expert_id uuid, _visit_date date, _origin text default 'dossier')
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare f public.accident_files%rowtype;
begin
  select * into f from public.accident_files where id = _file;
  if not found then
    raise exception 'Dossier accident introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(f.company_id) then
    raise exception 'Acces refuse a la societe %', f.company_id using errcode = '42501';
  end if;
  if coalesce(_origin, '') not in ('OR', 'dossier') then
    raise exception 'Origine inconnue : % (OR ou dossier).', _origin using errcode = '22023';
  end if;
  perform set_config('app.accident_expert_origin', _origin, true);
  update public.accident_files
     set expert_id = _expert_id,
         expert_name = case when _expert_id is null then null else expert_name end,
         expert_visit_date = _visit_date
   where id = _file;
  perform set_config('app.accident_expert_origin', '', true);
end $$;

comment on function public.accident_file_set_expert(uuid, uuid, date, text) is
  'Q51 : expert (table des experts, null = aucun) et date de passage d''un dossier accident, saisis depuis l''OR (origine OR) ou le dossier (origine dossier). L''OR suit ; trace events accident_expert_change.';
revoke all on function public.accident_file_set_expert(uuid, uuid, date, text) from public, anon;
grant execute on function public.accident_file_set_expert(uuid, uuid, date, text) to authenticated;

-- Remise en coherence des dossiers deja lies a un OR (le dossier fait foi s'il a une valeur).
update public.repair_orders r
   set expert_name = f.expert_name, expert_date = f.expert_visit_date
  from public.accident_files f
 where f.repair_order_id = r.id and f.company_id = r.company_id
   and (f.expert_id is not null or f.expert_name is not null or f.expert_visit_date is not null)
   and (r.expert_name is distinct from f.expert_name or r.expert_date is distinct from f.expert_visit_date);
