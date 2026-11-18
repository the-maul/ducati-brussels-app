-- =====================================================================
-- M0 — Numerotation des documents : deux modes au choix par societe (rattrapage G8, 18/11/2026).
--
-- Sources : docs/g8-inventaire/09-parametres.md (« Gestion chronos »), parcours.md (« Numerotation
-- G8 observee »), comparaison-ventes-caisse-compta.md §5 et bloquant n° 5.
-- Decision de Simon (18/11/2026) : proposer les DEUX modes, par societe, dans Parametres → Numerotation :
--   - « separe » (comportement du DMS jusqu ici) : FAC / TIK / AVO ont chacune leur serie
--     (prefixe, format, remise a zero annuelle) ;
--   - « unique » (facon G8) : facture, ticket et avoir prennent le numero d UN SEUL compteur
--     (serie `VEN`, ex. 22701456 → 22701457 → 22701458), au format reglable comme les autres.
--
-- Regles legales belges tenues ici (AR n° 1 TVA art. 5 : numero unique, suite continue, par serie) :
--   1. chaque serie est continue, sans trou ni doublon : le numero est pris sous verrou de ligne
--      (`for update`) ; `document_assign_number` prend le numero ET valide le brouillon dans la
--      MEME transaction (si la validation est refusee, le numero n est pas consomme) ;
--   2. le numero est attribue a la validation, jamais au brouillon ;
--   3. changement de mode autorise seulement en debut d exercice (aucun document de vente numerote
--      dans l annee civile en cours) ou programme pour le 1er janvier suivant ; sinon refus clair.
--      Chaque changement (immediat, programme, applique) est trace dans `events` ;
--   4. prochain numero reglable VERS LE HAUT seulement, par un administrateur ou le comptable, avec
--      un motif obligatoire, trace dans `events` (ex. reprendre le compteur G8 22701462 au demarrage) ;
--      plus aucune modification directe de `next_value` / `current_year` par l API ;
--   5. une serie ne se supprime plus par l API ; deux series d une societe ne peuvent pas porter le
--      meme prefixe ; un numero de document est unique par societe (index pose s il n y a pas deja
--      de doublon en base — sinon un avis le signale, rien n est modifie) ;
--   6. un numero plus long que la longueur demandee n est plus tronque (lpad tronquait : 100000 en
--      5 positions donnait 10000, un doublon).
--   7. l annee de numerotation est l annee civile a Bruxelles (et non en UTC : la nuit du 31/12
--      a 23 h, le DMS passait deja en annee suivante).
--
-- Ne touche a AUCUN numero deja emis et ne purge rien. Le trou FAC-2026-00002 a 00004 (factures
-- supprimees en SQL le 12/06/2026) reste en l etat : proces-verbal a faire par le comptable (bible M00).
--
-- NON APPLIQUEE (regle du lot : Simon applique les migrations en bloc). Essais a blanc :
--   supabase/tests/m0_numerotation_deux_modes.sql (transaction annulee) et
--   supabase/tests/m0_numerotation_concurrence.sql (base locale ou branche, jamais la production).
-- Idempotente : rejouable sans effet de bord.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reglage par societe : mode de numerotation des ventes
-- ---------------------------------------------------------------------
create table if not exists public.numbering_settings (
  company_id            uuid primary key references public.companies(id) on delete cascade,
  sales_mode            text not null default 'separate',
  next_sales_mode       text,
  next_sales_mode_year  int,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id) on delete set null,
  constraint numbering_settings_mode_check check (sales_mode in ('separate', 'single')),
  constraint numbering_settings_next_mode_check check (next_sales_mode is null or next_sales_mode in ('separate', 'single')),
  constraint numbering_settings_next_pair_check check ((next_sales_mode is null) = (next_sales_mode_year is null))
);
comment on table public.numbering_settings is 'M0 : mode de numerotation des ventes par societe (separate = series FAC / TIK / AVO ; single = compteur unique VEN facon G8). Ecrit uniquement par set_sales_numbering_mode (trace events).';
comment on column public.numbering_settings.next_sales_mode is 'Changement de mode programme : s applique au premier numero pris a partir du 1er janvier de next_sales_mode_year.';

alter table public.numbering_settings enable row level security;
drop policy if exists numbering_settings_select on public.numbering_settings;
create policy numbering_settings_select on public.numbering_settings
  for select to authenticated using (public.is_member(company_id));
-- Pas de policy d ecriture : tout passe par set_sales_numbering_mode (SECURITY DEFINER, trace).
grant select on public.numbering_settings to authenticated;
revoke insert, update, delete on public.numbering_settings from authenticated, anon;

insert into public.numbering_settings (company_id)
select c.id from public.companies c
on conflict (company_id) do nothing;

-- Date du dernier numero REELLEMENT emis par la serie (pas un reglage) : sert a la regle d exercice.
alter table public.document_sequences add column if not exists last_issued_at timestamptz;
comment on column public.document_sequences.last_issued_at is 'Date du dernier numero emis par cette serie (ecrit par la numerotation seulement) : un changement de mode est refuse si une serie de vente a emis un numero dans l annee.';

-- Serie du compteur unique (format G8 par defaut : 8 chiffres, sans prefixe ni remise a zero).
insert into public.document_sequences (company_id, doc_type, prefix, separator, padding, reset_yearly, label)
select c.id, 'VEN', '', '', 8, false, 'Compteur unique des ventes (facture, ticket et avoir, facon G8)'
  from public.companies c
on conflict (company_id, doc_type) do nothing;

-- ---------------------------------------------------------------------
-- 2. Aides : annee de numerotation (Bruxelles), types partages, documents deja numerotes
-- ---------------------------------------------------------------------
create or replace function public._numbering_year()
returns int language sql stable set search_path = public, pg_temp as $$
  select extract(year from (now() at time zone 'Europe/Brussels'))::int;
$$;

create or replace function public._numbering_shared_types()
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select array['FAC', 'TIK', 'AVO']::text[];
$$;

-- Nombre de documents de vente (facture, ticket, avoir) deja numerotes dans l annee, plus les
-- series concernees deja entamees cette annee (numero pris, meme si le document a disparu).
create or replace function public._sales_numbered_this_year(_company uuid, _year int)
returns int language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _n int; _s int;
begin
  select count(*) into _n from public.documents
   where company_id = _company and doc_type = any (public._numbering_shared_types())
     and number is not null and issue_date >= make_date(_year, 1, 1);
  select count(*) into _s from public.document_sequences
   where company_id = _company and doc_type = any (public._numbering_shared_types() || 'VEN'::text)
     and ((last_issued_at at time zone 'Europe/Brussels') >= make_date(_year, 1, 1)
          or (reset_yearly and current_year = _year and next_value > 1));
  return _n + _s;
end $$;

-- Mode en vigueur ; applique le changement programme des que son annee est atteinte (trace).
create or replace function public._sales_numbering_mode(_company uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.numbering_settings%rowtype; y int := public._numbering_year();
begin
  select * into s from public.numbering_settings where company_id = _company;
  if not found then return 'separate'; end if;
  if s.next_sales_mode is not null and s.next_sales_mode_year <= y then
    select * into s from public.numbering_settings where company_id = _company for update;
    if s.next_sales_mode is not null and s.next_sales_mode_year <= y then
      update public.numbering_settings
         set sales_mode = s.next_sales_mode, next_sales_mode = null, next_sales_mode_year = null, updated_at = now()
       where company_id = _company;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
      values (_company, auth.uid(), 'numbering_mode_applied', 'numbering_settings', _company::text,
              jsonb_build_object('sales_mode', s.sales_mode),
              jsonb_build_object('sales_mode', s.next_sales_mode, 'from_year', s.next_sales_mode_year), 'system');
      return s.next_sales_mode;
    end if;
  end if;
  return s.sales_mode;
end $$;

-- ---------------------------------------------------------------------
-- 3. Prise du numero : meme signature, meme verrou, redirection vers VEN en mode compteur unique
-- ---------------------------------------------------------------------
create or replace function public._next_document_number_unchecked(_company uuid, _doc_type text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seq  public.document_sequences%rowtype;
  y    int := public._numbering_year();
  n    bigint;
  _key text := _doc_type;
begin
  if _doc_type = any (public._numbering_shared_types()) and public._sales_numbering_mode(_company) = 'single' then
    _key := 'VEN';
  end if;

  -- Autorise le declencheur de garde a laisser passer l increment (fonction interne uniquement).
  perform set_config('dms.numbering_internal', 'on', true);

  select * into seq from public.document_sequences
    where company_id = _company and doc_type = _key
    for update;
  if not found then
    if _key = 'VEN' then
      insert into public.document_sequences (company_id, doc_type, prefix, separator, padding, reset_yearly, label)
        values (_company, 'VEN', '', '', 8, false, 'Compteur unique des ventes (facture, ticket et avoir, facon G8)')
        on conflict (company_id, doc_type) do nothing;
    else
      insert into public.document_sequences (company_id, doc_type, prefix, label)
        values (_company, _key, upper(_key), _key)
        on conflict (company_id, doc_type) do nothing;
    end if;
    select * into seq from public.document_sequences
      where company_id = _company and doc_type = _key
      for update;
  end if;

  if seq.reset_yearly and (seq.current_year is distinct from y) then
    n := 1;
    update public.document_sequences set next_value = 2, current_year = y, last_issued_at = now(), updated_at = now() where id = seq.id;
  else
    n := seq.next_value;
    update public.document_sequences set next_value = next_value + 1, current_year = coalesce(current_year, y), last_issued_at = now(), updated_at = now() where id = seq.id;
  end if;

  perform set_config('dms.numbering_internal', 'off', true);

  -- Format historique conserve a l identique (prefixe + separateur + annee + separateur + numero),
  -- sans troncature : un compteur qui depasse la longueur garde tous ses chiffres.
  if seq.reset_yearly then
    return seq.prefix || seq.separator || y::text || seq.separator
        || case when length(n::text) >= seq.padding then n::text else lpad(n::text, seq.padding, '0') end
        || coalesce(seq.suffix, '');
  else
    return seq.prefix || seq.separator
        || case when length(n::text) >= seq.padding then n::text else lpad(n::text, seq.padding, '0') end
        || coalesce(seq.suffix, '');
  end if;
end $$;
-- Fonction interne : reste fermee aux comptes connectes (lot S1).
revoke execute on function public._next_document_number_unchecked(uuid, text) from public, anon, authenticated;

create or replace function public.next_document_number(_company uuid, _doc_type text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company;
  end if;
  return public._next_document_number_unchecked(_company, _doc_type);
end $$;
grant execute on function public.next_document_number(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Validation atomique d un brouillon : numero + statut dans la meme transaction
-- ---------------------------------------------------------------------
create or replace function public.document_assign_number(_document uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare d record; _num text; _ok boolean := true;
begin
  select id, company_id, doc_type, status, number into d from public.documents where id = _document for update;
  if not found then raise exception 'Document introuvable.'; end if;
  if not public.is_member(d.company_id) then raise exception 'Accès refusé à la société %', d.company_id; end if;
  -- Droits par role (migration 20261013140000) quand elle est posee : meme regle que l ecriture directe.
  if to_regprocedure('public.can_write_table(uuid,text)') is not null then
    execute 'select public.can_write_table($1, $2)' into _ok using d.company_id, 'documents';
    if not coalesce(_ok, false) then raise exception 'Votre rôle ne permet pas de valider ce document.'; end if;
  end if;
  if d.number is not null then return d.number; end if;          -- deja numerote : rien de plus
  if d.status <> 'brouillon' then
    raise exception 'Seul un brouillon prend un numéro (statut actuel : %).', d.status;
  end if;
  _num := public._next_document_number_unchecked(d.company_id, d.doc_type);
  -- Si un declencheur refuse la validation (client, lignes, caisse...), toute la transaction est
  -- annulee : le numero n est pas consomme, la serie reste continue.
  update public.documents set status = 'validee', number = _num where id = _document;
  return _num;
end $$;
revoke execute on function public.document_assign_number(uuid) from public, anon;
grant execute on function public.document_assign_number(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Changement de mode (admin ou comptable), refuse en cours d exercice, trace
-- ---------------------------------------------------------------------
create or replace function public._can_manage_numbering(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin(_company) or public.has_role(_company, 'comptable');
$$;

create or replace function public.set_sales_numbering_mode(_company uuid, _mode text, _from_next_year boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.numbering_settings%rowtype; y int := public._numbering_year(); _used int; _current text;
begin
  if not public._can_manage_numbering(_company) then
    raise exception 'Réservé à un administrateur ou au comptable de la société.';
  end if;
  if _mode not in ('separate', 'single') then raise exception 'Mode inconnu : %', _mode; end if;

  insert into public.numbering_settings (company_id) values (_company) on conflict (company_id) do nothing;
  _current := public._sales_numbering_mode(_company);              -- applique un changement echu
  select * into s from public.numbering_settings where company_id = _company for update;

  if _from_next_year then
    if _mode = _current then
      update public.numbering_settings set next_sales_mode = null, next_sales_mode_year = null,
             updated_at = now(), updated_by = auth.uid() where company_id = _company;
    else
      update public.numbering_settings set next_sales_mode = _mode, next_sales_mode_year = y + 1,
             updated_at = now(), updated_by = auth.uid() where company_id = _company;
    end if;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
    values (_company, auth.uid(), 'numbering_mode_scheduled', 'numbering_settings', _company::text,
            jsonb_build_object('sales_mode', _current, 'next_sales_mode', s.next_sales_mode, 'next_sales_mode_year', s.next_sales_mode_year),
            jsonb_build_object('next_sales_mode', case when _mode = _current then null else _mode end,
                               'next_sales_mode_year', case when _mode = _current then null else y + 1 end), 'screen');
    return jsonb_build_object('sales_mode', _current, 'next_sales_mode', case when _mode = _current then null else _mode end,
                              'next_sales_mode_year', case when _mode = _current then null else y + 1 end);
  end if;

  if _mode = _current then
    return jsonb_build_object('sales_mode', _current, 'next_sales_mode', s.next_sales_mode, 'next_sales_mode_year', s.next_sales_mode_year);
  end if;

  _used := public._sales_numbered_this_year(_company, y);
  if _used > 0 then
    raise exception 'Changement refusé : des factures, tickets ou avoirs sont déjà numérotés en % (% trouvé(s)). Une série doit rester continue sur tout l exercice : programmez le changement pour le 1er janvier %.', y, _used, y + 1
      using errcode = '23514';
  end if;

  if _mode = 'single' then
    insert into public.document_sequences (company_id, doc_type, prefix, separator, padding, reset_yearly, label)
    values (_company, 'VEN', '', '', 8, false, 'Compteur unique des ventes (facture, ticket et avoir, facon G8)')
    on conflict (company_id, doc_type) do nothing;
  end if;

  update public.numbering_settings set sales_mode = _mode, next_sales_mode = null, next_sales_mode_year = null,
         updated_at = now(), updated_by = auth.uid() where company_id = _company;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
  values (_company, auth.uid(), 'numbering_mode_change', 'numbering_settings', _company::text,
          jsonb_build_object('sales_mode', _current), jsonb_build_object('sales_mode', _mode, 'year', y), 'screen');
  return jsonb_build_object('sales_mode', _mode, 'next_sales_mode', null, 'next_sales_mode_year', null);
end $$;
revoke execute on function public.set_sales_numbering_mode(uuid, text, boolean) from public, anon;
grant execute on function public.set_sales_numbering_mode(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Reglage du prochain numero : vers le haut seulement, admin ou comptable, motif, trace
-- ---------------------------------------------------------------------
create or replace function public.set_sequence_next_value(_sequence uuid, _next bigint, _reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare seq public.document_sequences%rowtype; y int := public._numbering_year(); _effective bigint;
begin
  select * into seq from public.document_sequences where id = _sequence for update;
  if not found then raise exception 'Série introuvable.'; end if;
  if not public._can_manage_numbering(seq.company_id) then
    raise exception 'Réservé à un administrateur ou au comptable de la société.';
  end if;
  if coalesce(length(trim(_reason)), 0) < 5 then
    raise exception 'Indiquez le motif du réglage (au moins 5 caractères) : il est conservé pour le comptable.';
  end if;
  _effective := case when seq.reset_yearly and seq.current_year is distinct from y then 1 else seq.next_value end;
  if _next is null or _next <= _effective then
    raise exception 'Le prochain numéro ne peut que monter : il doit être supérieur à % (sinon un numéro déjà émis pourrait revenir).', _effective
      using errcode = '23514';
  end if;
  if _next > 999999999999 then raise exception 'Numéro trop grand.'; end if;

  perform set_config('dms.numbering_internal', 'on', true);
  update public.document_sequences set next_value = _next, current_year = y, updated_at = now() where id = seq.id;
  perform set_config('dms.numbering_internal', 'off', true);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
  values (seq.company_id, auth.uid(), 'numbering_next_value_change', 'document_sequences', seq.id::text,
          jsonb_build_object('doc_type', seq.doc_type, 'next_value', _effective, 'current_year', seq.current_year),
          jsonb_build_object('doc_type', seq.doc_type, 'next_value', _next, 'current_year', y,
                             'skipped', _next - _effective, 'reason', trim(_reason)), 'screen');
  return jsonb_build_object('doc_type', seq.doc_type, 'next_value', _next, 'skipped', _next - _effective);
end $$;
revoke execute on function public.set_sequence_next_value(uuid, bigint, text) from public, anon;
grant execute on function public.set_sequence_next_value(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Garde sur document_sequences : compteur intouchable par l API, prefixes distincts, format trace
-- ---------------------------------------------------------------------
create or replace function public.document_sequences_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _internal boolean := coalesce(current_setting('dms.numbering_internal', true), 'off') = 'on';
begin
  if (new.next_value is distinct from old.next_value or new.current_year is distinct from old.current_year
      or new.last_issued_at is distinct from old.last_issued_at or new.company_id is distinct from old.company_id or new.doc_type is distinct from old.doc_type)
     and not _internal then
    if auth.uid() is not null then
      raise exception 'Le prochain numéro ne se modifie pas directement : utilisez « Régler le prochain numéro » (administrateur ou comptable, motif tracé).'
        using errcode = '42501';
    end if;
    -- Console SQL / cle de service : permis (reprise, purge validee par le comptable) mais trace.
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
    values (new.company_id, null, 'numbering_next_value_sql', 'document_sequences', new.id::text,
            jsonb_build_object('doc_type', old.doc_type, 'next_value', old.next_value, 'current_year', old.current_year),
            jsonb_build_object('doc_type', new.doc_type, 'next_value', new.next_value, 'current_year', new.current_year), 'system');
  end if;

  if upper(coalesce(new.prefix, '')) is distinct from upper(coalesce(old.prefix, ''))
     and exists (select 1 from public.document_sequences o
                  where o.company_id = new.company_id and o.id <> new.id
                    and upper(coalesce(o.prefix, '')) = upper(coalesce(new.prefix, ''))) then
    raise exception 'Le préfixe « % » est déjà utilisé par une autre série de cette société : deux séries ne peuvent pas partager un préfixe (risque de doublon).', new.prefix
      using errcode = '23505';
  end if;

  if new.prefix is distinct from old.prefix or new.separator is distinct from old.separator
     or new.padding is distinct from old.padding or new.reset_yearly is distinct from old.reset_yearly
     or new.suffix is distinct from old.suffix or new.label is distinct from old.label then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
    values (new.company_id, auth.uid(), 'numbering_format_change', 'document_sequences', new.id::text,
            jsonb_build_object('doc_type', old.doc_type, 'prefix', old.prefix, 'separator', old.separator, 'padding', old.padding,
                               'reset_yearly', old.reset_yearly, 'suffix', old.suffix, 'label', old.label),
            jsonb_build_object('doc_type', new.doc_type, 'prefix', new.prefix, 'separator', new.separator, 'padding', new.padding,
                               'reset_yearly', new.reset_yearly, 'suffix', new.suffix, 'label', new.label),
            case when auth.uid() is null then 'system' else 'screen' end);
  end if;
  return new;
end $$;

drop trigger if exists trg_document_sequences_guard on public.document_sequences;
create trigger trg_document_sequences_guard before update on public.document_sequences
  for each row execute function public.document_sequences_guard();

alter table public.document_sequences drop constraint if exists document_sequences_padding_check;
alter table public.document_sequences add constraint document_sequences_padding_check check (padding between 1 and 12) not valid;

-- Une serie ne se supprime plus par l API (sa recreation repartirait de 1 : doublons).
drop policy if exists docseq_admin on public.document_sequences;
drop policy if exists docseq_admin_insert on public.document_sequences;
create policy docseq_admin_insert on public.document_sequences
  for insert to authenticated with check (public.is_admin(company_id));
drop policy if exists docseq_admin_update on public.document_sequences;
create policy docseq_admin_update on public.document_sequences
  for update to authenticated using (public.is_admin(company_id)) with check (public.is_admin(company_id));
revoke delete on public.document_sequences from authenticated, anon;

-- ---------------------------------------------------------------------
-- 8. Unicite du numero par societe (filet de securite) — sans toucher aux donnees existantes
-- ---------------------------------------------------------------------
do $do$
declare _dups int;
begin
  if to_regclass('public.documents_company_number_uq') is not null then return; end if;
  select count(*) into _dups from (
    select 1 from public.documents where number is not null group by company_id, number having count(*) > 1
  ) x;
  if _dups = 0 then
    create unique index documents_company_number_uq on public.documents (company_id, number) where number is not null;
  else
    raise notice 'Numerotation : % numero(s) de document en double deja en base ; index d unicite NON pose, rien n est modifie. A examiner avec le comptable.', _dups;
  end if;
end $do$;

-- ---------------------------------------------------------------------
-- 9. Vue d ensemble pour l ecran (mode, droits, regle d exercice, autres compteurs)
-- ---------------------------------------------------------------------
create or replace function public.numbering_overview(_company uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.numbering_settings%rowtype; y int := public._numbering_year(); _used int; _mode text; _police text;
begin
  if not public.is_member(_company) then raise exception 'Accès refusé à la société %', _company; end if;
  select * into s from public.numbering_settings where company_id = _company;
  _mode := coalesce(case when s.next_sales_mode is not null and s.next_sales_mode_year <= y then s.next_sales_mode end, s.sales_mode, 'separate');
  _used := public._sales_numbered_this_year(_company, y);
  if to_regclass('public.vehicle_register') is not null then
    execute 'select $2::text || ''-'' || lpad((coalesce(max(seq), 0) + 1)::text, 4, ''0'') from public.vehicle_register where company_id = $1 and year = $2'
      into _police using _company, y;
  end if;
  return jsonb_build_object(
    'sales_mode', _mode,
    'next_sales_mode', case when s.next_sales_mode_year > y then s.next_sales_mode end,
    'next_sales_mode_year', case when s.next_sales_mode_year > y then s.next_sales_mode_year end,
    'year', y,
    'numbered_this_year', _used,
    'can_change_now', _used = 0,
    'can_manage', public._can_manage_numbering(_company),
    'shared_types', to_jsonb(public._numbering_shared_types()),
    'police_register_next', _police
  );
end $$;
revoke execute on function public.numbering_overview(uuid) from public, anon;
grant execute on function public.numbering_overview(uuid) to authenticated;

-- Aides internes : fermees aux comptes connectes.
revoke execute on function public._sales_numbering_mode(uuid) from public, anon, authenticated;
revoke execute on function public._sales_numbered_this_year(uuid, int) from public, anon, authenticated;
revoke execute on function public._can_manage_numbering(uuid) from public, anon, authenticated;
revoke execute on function public.document_sequences_guard() from public, anon, authenticated;
