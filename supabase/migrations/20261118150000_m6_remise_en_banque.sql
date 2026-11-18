-- M6 — Rattrapage G8 (18/11/2026, lot-g8-caisse) : remise en banque avec report du fond de caisse,
-- mouvements de fond de caisse types, banques. PDV009 (remises en banque), PDV007 (mouvements de fond de caisse).
--
-- SUPPOSE APPLIQUEES : 20261103150000_m6_caisse_audit.sql, 20261103170000_m6_caisse_legale.sql et
-- 20261103220000_m6_z_avoirs.sql (colonnes `cash_sessions.expected_cash`, `register_code`, `z_number`,
-- `document_payments.cash_session_id`, `reversal_of`, `transferred_from`, gardes des sessions et des
-- mouvements). Cette migration ne touche ni au Z, ni a sa numerotation, ni a ses gardes : elle s y ajoute.
--
-- G8 (inventaire du 18/11/2026, 06-ventes-caisse.md « Caisse en detail », parcours 22 et 23) :
--   * la caisse se cloture par la REMISE EN BANQUE, par mode de reglement (especes, carte, virement, Visa) :
--     periode depuis le dernier report, lignes selectionnables (report precedent, encaissements, mouvements
--     de caisse, reglements negatifs), montant remis -> nouveau fond de caisse (report + selection - remis),
--     banque (BIC / IBAN), commentaire, bordereau, archives (consulter, commenter, modifier, annuler),
--     « archiver sans remise » ;
--   * mouvements de fond de caisse types : 01 remise en banque, 02 encaissement depot-vente, 03 decaissement
--     depot-vente, 04 achat de consommables (TVA 21 %), 05 La Poste, 06 / 07 divers entree / sortie especes,
--     case « correction / ouverture fond de caisse » ; un compte comptable par type (Compta > Comptes
--     mouvements fond de caisse, vide dans la base FACTICE).
--
-- Modele DMS (le tiroir est un grand livre) :
--   especes du tiroir = reports non repris + encaissements ESP non remis + mouvements ESP non remis
--                       + ecarts d ouverture (fond saisi - fond attendu) + ecarts de cloture (compte - theorique).
--   Une remise CONSOMME des elements (lignes actives de `cash_deposit_lines`, un element ne se remet qu une
--   fois) et laisse un REPORT (`new_float` = selection - remis) repris par la remise suivante.
--   Remise d especes caisse OUVERTE : une sortie de type 01 est ajoutee a la session (le theorique du Z
--   reste juste) ; elle est liee a la remise (`cash_movements.deposit_id`) et n entre pas dans le grand livre.
--   Le fond propose a l ouverture d une caisse = especes du tiroir (`cash_drawer_balance`) ; l ecart entre
--   le fond saisi et le fond propose devient une ligne de la remise suivante (« ouverture fond de caisse »).
--   Rien n est modifie en silence : annulation et modification passent par des fonctions motivees, tracees
--   dans `events` ; les lignes d une remise annulee redeviennent disponibles.
--
-- NON APPLIQUEE (regle du lot : Simon passe les migrations en bloc). Essai a blanc :
--   supabase/tests/m6_remise_en_banque.sql (voir son en-tete).

-- ---------------------------------------------------------------------
-- 1. Types de mouvement de fond de caisse (Parametres > Tables > « Types de mouvement de caisse »).
--    extra : direction in | out | both, vat_rate (TVA comprise dans le montant), account (compte
--    comptable), system (masque a la saisie : la remise en banque le pose elle-meme).
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select c.id, 'cash_movement_type', d.code, d.label, d.sort_order, true, d.extra::jsonb
  from public.companies c
 cross join (values
   ('00', 'Correction / ouverture fond de caisse', 0, '{"direction":"both","vat_rate":0,"account":"","system":false}'),
   ('01', 'Remise en banque', 1, '{"direction":"both","vat_rate":0,"account":"","system":true}'),
   ('02', 'Encaissement dépôt-vente', 2, '{"direction":"in","vat_rate":0,"account":"","system":false}'),
   ('03', 'Décaissement dépôt-vente', 3, '{"direction":"out","vat_rate":0,"account":"","system":false}'),
   ('04', 'Achat de consommables', 4, '{"direction":"out","vat_rate":21,"account":"","system":false}'),
   ('05', 'La Poste', 5, '{"direction":"out","vat_rate":0,"account":"","system":false}'),
   ('06', 'Divers entrée espèces', 6, '{"direction":"in","vat_rate":0,"account":"","system":false}'),
   ('07', 'Divers sortie espèces', 7, '{"direction":"out","vat_rate":0,"account":"","system":false}')
 ) as d(code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;

-- Banques de remise (G8 : code, domiciliation, BIC, IBAN). Prechargee avec le compte de la fiche societe.
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select c.id, 'bank_account', '01', coalesce(nullif(btrim(c.name), ''), 'Banque') || ' - compte principal', 1, true,
       jsonb_build_object('iban', c.iban, 'bic', c.bic)
  from public.companies c
 where coalesce(btrim(c.iban), '') <> ''
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Remises en banque (bordereaux) et leurs lignes.
-- ---------------------------------------------------------------------
create table if not exists public.cash_deposits (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete restrict,
  number            int not null,                                  -- n° de remise, par societe et par mode
  method            text not null,                                 -- mode de reglement remis (ESP, MAE, VIR, VID...)
  kind              text not null default 'remise',                -- remise | archive (« archiver sans remise »)
  status            text not null default 'active',                -- active | annulee
  register_code     text not null default 'CAISSE-1',
  period_from       timestamptz,
  period_to         timestamptz not null,
  deposit_date      date not null default current_date,
  lines_total       numeric(14,2) not null,                        -- total des lignes selectionnees (report compris)
  deposited_amount  numeric(14,2) not null,                        -- montant remis en banque
  new_float         numeric(14,2),                                 -- nouveau fond de caisse reporte (especes)
  line_count        int not null default 0,
  bank_code         text,
  bank_label        text,
  bank_iban         text,
  bank_bic          text,
  comment           text,
  session_id        uuid references public.cash_sessions(id) on delete restrict,  -- caisse ouverte a la remise (especes)
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  amended_at        timestamptz,
  amended_by        uuid references auth.users(id) on delete set null,
  cancelled_at      timestamptz,
  cancelled_by      uuid references auth.users(id) on delete set null,
  cancel_reason     text,
  constraint cash_deposits_kind_chk check (kind in ('remise', 'archive')),
  constraint cash_deposits_status_chk check (status in ('active', 'annulee')),
  constraint cash_deposits_amount_chk check (deposited_amount >= 0),
  constraint cash_deposits_float_chk check (new_float is null or new_float >= 0),
  unique (company_id, method, number)
);
create index if not exists idx_cash_deposits_company on public.cash_deposits(company_id, method, created_at desc);

create table if not exists public.cash_deposit_lines (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  deposit_id       uuid not null references public.cash_deposits(id) on delete restrict,
  source_type      text not null,          -- report | payment | movement | opening_gap | closing_gap
  source_id        uuid not null,          -- remise reprise, reglement, mouvement ou session
  occurred_at      timestamptz not null,
  label            text,
  contact_label    text,
  document_number  text,
  amount           numeric(14,2) not null,
  active           boolean not null default true,   -- false quand la remise est annulee
  constraint cash_deposit_lines_type_chk check (source_type in ('report', 'payment', 'movement', 'opening_gap', 'closing_gap'))
);
create index if not exists idx_cash_deposit_lines_deposit on public.cash_deposit_lines(deposit_id);
-- Un element ne se remet qu une fois (tant que la remise qui le contient n est pas annulee).
create unique index if not exists cash_deposit_lines_once
  on public.cash_deposit_lines (source_type, source_id) where active;

-- Commentaires d une remise archivee (G8 : « ajouter ou modifier un commentaire ») : ajout seulement.
create table if not exists public.cash_deposit_comments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  deposit_id  uuid not null references public.cash_deposits(id) on delete restrict,
  body        text not null check (btrim(body) <> ''),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_cash_deposit_comments_deposit on public.cash_deposit_comments(deposit_id);

drop trigger if exists trg_cash_deposits_audit on public.cash_deposits;
create trigger trg_cash_deposits_audit after insert or update or delete on public.cash_deposits for each row execute function public.audit_row();
drop trigger if exists trg_cash_deposit_lines_audit on public.cash_deposit_lines;
create trigger trg_cash_deposit_lines_audit after insert or update or delete on public.cash_deposit_lines for each row execute function public.audit_row();
drop trigger if exists trg_cash_deposit_comments_audit on public.cash_deposit_comments;
create trigger trg_cash_deposit_comments_audit after insert or update or delete on public.cash_deposit_comments for each row execute function public.audit_row();

-- Lecture : membres de la societe. Ecriture des remises et des lignes : UNIQUEMENT par les fonctions
-- ci-dessous (security definer) ; aucune politique d ecriture directe. Commentaires : ajout par un role
-- qui ecrit sur la caisse, jamais modifies ni supprimes.
alter table public.cash_deposits enable row level security;
alter table public.cash_deposit_lines enable row level security;
alter table public.cash_deposit_comments enable row level security;
drop policy if exists cash_deposits_select on public.cash_deposits;
create policy cash_deposits_select on public.cash_deposits for select to authenticated using (public.is_member(company_id));
drop policy if exists cash_deposit_lines_select on public.cash_deposit_lines;
create policy cash_deposit_lines_select on public.cash_deposit_lines for select to authenticated using (public.is_member(company_id));
drop policy if exists cash_deposit_comments_select on public.cash_deposit_comments;
create policy cash_deposit_comments_select on public.cash_deposit_comments for select to authenticated using (public.is_member(company_id));
drop policy if exists cash_deposit_comments_insert on public.cash_deposit_comments;
create policy cash_deposit_comments_insert on public.cash_deposit_comments for insert to authenticated
  with check (public.can_write_table(company_id, 'cash_deposits') and created_by = auth.uid()
              and exists (select 1 from public.cash_deposits d where d.id = deposit_id and d.company_id = cash_deposit_comments.company_id));

insert into public.table_write_pages (table_name, page) values
  ('cash_deposits', '/pos'), ('cash_deposit_comments', '/pos')
on conflict (table_name, page) do nothing;

-- ---------------------------------------------------------------------
-- 3. Mouvements de fond de caisse : type, n°, TVA, compte, remise liee ; fond propose a l ouverture.
-- ---------------------------------------------------------------------
alter table public.cash_movements
  add column if not exists type_code    text,                 -- code du type (reference_values cash_movement_type)
  add column if not exists movement_no  int,                  -- n° du mouvement (G8 : « n° »), par societe
  add column if not exists vat_rate     numeric(5,2),         -- TVA comprise dans le montant (achat de consommables)
  add column if not exists vat_amount   numeric(14,2),
  add column if not exists account_code text,                 -- compte comptable du type au moment du mouvement
  add column if not exists deposit_id   uuid references public.cash_deposits(id) on delete restrict;
create index if not exists idx_cash_movements_deposit on public.cash_movements(deposit_id) where deposit_id is not null;
create unique index if not exists cash_movements_no_uq on public.cash_movements(company_id, movement_no) where movement_no is not null;

alter table public.cash_sessions
  add column if not exists proposed_float numeric(14,2);      -- fond attendu a l ouverture (especes du tiroir)

-- Saisie d un mouvement : numero, controle du type et du sens, TVA et compte du type.
create or replace function public.cash_movements_typed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _t record; _dir text; _rate numeric;
begin
  if tg_op = 'UPDATE' then
    -- Un mouvement lie a une remise appartient au bordereau : il ne se modifie pas.
    if old.deposit_id is not null and (new.amount is distinct from old.amount or new.kind is distinct from old.kind
       or new.method is distinct from old.method or new.deposit_id is distinct from old.deposit_id
       or new.type_code is distinct from old.type_code) then
      raise exception 'Mouvement de la remise en banque : il ne se modifie pas (annulez ou modifiez la remise).' using errcode = '23514';
    end if;
    if new.movement_no is distinct from old.movement_no then
      raise exception 'Le numero d un mouvement de caisse ne change pas.' using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.deposit_id is not null then
      raise exception 'Mouvement de la remise en banque : il ne se supprime pas.' using errcode = '23514';
    end if;
    return old;
  end if;

  -- INSERT
  perform pg_advisory_xact_lock(hashtext('cash_movements_no:' || new.company_id::text));
  select coalesce(max(movement_no), 0) + 1 into new.movement_no from public.cash_movements where company_id = new.company_id;
  if new.type_code is not null then
    select code, label, is_active, extra into _t from public.reference_values
     where company_id = new.company_id and table_key = 'cash_movement_type' and code = new.type_code;
    if _t is null or not _t.is_active then
      raise exception 'Type de mouvement de caisse inconnu ou inactif : %', new.type_code using errcode = '23514';
    end if;
    if coalesce((_t.extra->>'system')::boolean, false) and new.deposit_id is null then
      raise exception 'Le type « % » est pose par la remise en banque : passez par Caisse > Remises en banque.', _t.label using errcode = '23514';
    end if;
    _dir := coalesce(_t.extra->>'direction', 'both');
    if _dir in ('in', 'out') and new.kind <> _dir then
      raise exception 'Le type « % » est une % d argent.', _t.label, case when _dir = 'in' then 'entree' else 'sortie' end using errcode = '23514';
    end if;
    new.account_code := coalesce(nullif(btrim(new.account_code), ''), nullif(btrim(_t.extra->>'account'), ''));
    if new.vat_rate is null then
      _rate := nullif(_t.extra->>'vat_rate', '')::numeric;
      new.vat_rate := case when coalesce(_rate, 0) > 0 then _rate else null end;
    end if;
    if new.reason is null or btrim(new.reason) = '' then new.reason := _t.label; end if;
  end if;
  if coalesce(new.vat_rate, 0) > 0 then
    new.vat_amount := round(new.amount * new.vat_rate / (100 + new.vat_rate), 2);
  else
    new.vat_rate := null; new.vat_amount := null;
  end if;
  return new;
end $$;
revoke all on function public.cash_movements_typed() from public, anon, authenticated;
drop trigger if exists trg_cash_movements_typed on public.cash_movements;
create trigger trg_cash_movements_typed before insert or update or delete on public.cash_movements
  for each row execute function public.cash_movements_typed();

-- ---------------------------------------------------------------------
-- 4. Grand livre du tiroir, par mode : tous les elements, remis ou non.
-- ---------------------------------------------------------------------
create or replace function public._cash_deposit_pool(_company uuid, _method text)
returns table(source_type text, source_id uuid, occurred_at timestamptz, label text, contact_label text,
              document_number text, amount numeric, deposit_id uuid, deposit_number int)
language sql stable security definer set search_path = public, pg_temp as $$
  with items as (
    -- Reports des remises d especes actives (nouveau fond de caisse).
    select 'report'::text as source_type, d.id as source_id, d.created_at as occurred_at,
           'Report caisse du ' || to_char(d.deposit_date, 'DD/MM/YYYY') as label, null::text as contact_label,
           null::text as document_number, d.new_float as amount
      from public.cash_deposits d
     where d.company_id = _company and d.method = _method and _method = 'ESP'
       and d.status = 'active' and coalesce(d.new_float, 0) <> 0
    union all
    -- Reglements percus du mode (contre-passations et remboursements en negatif) ; jamais un acompte reporte.
    select 'payment', p.id, p.paid_at,
           coalesce(nullif(btrim(p.note), ''), doc.doc_type || ' ' || coalesce(doc.number, '')),
           coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.last_name, c.first_name)), '')),
           doc.number, p.amount
      from public.document_payments p
      join public.documents doc on doc.id = p.document_id
      left join public.contacts c on c.id = doc.contact_id
     where doc.company_id = _company and p.method = _method and p.status = 'recu' and p.transferred_from is null
    union all
    -- Mouvements de fond de caisse du mode, hors sorties posees par une remise active.
    select 'movement', m.id, m.occurred_at,
           coalesce(nullif(btrim(m.reason), ''), m.type_code),
           null, case when m.movement_no is null then null else 'MVT ' || m.movement_no end,
           case when m.kind = 'in' then m.amount else -m.amount end
      from public.cash_movements m
      left join public.cash_deposits md on md.id = m.deposit_id
     where m.company_id = _company and m.method = _method
       and (m.deposit_id is null or md.status = 'annulee')
    union all
    -- Ecart d ouverture : fond saisi - fond attendu (premiere ouverture : « ouverture fond de caisse »).
    select 'opening_gap', s.id, s.opened_at,
           'Ouverture fond de caisse du ' || to_char(s.opened_at at time zone 'Europe/Brussels', 'DD/MM/YYYY'),
           null, null, round(s.opening_float - s.proposed_float, 2)
      from public.cash_sessions s
     where s.company_id = _company and _method = 'ESP'
       and s.proposed_float is not null and round(s.opening_float - s.proposed_float, 2) <> 0
    union all
    -- Ecart de cloture : especes comptees - especes theoriques du Z.
    select 'closing_gap', s.id, s.closed_at,
           'Écart de clôture ' || coalesce(s.z_number, to_char(s.closed_at at time zone 'Europe/Brussels', 'DD/MM/YYYY')),
           null, s.z_number, round(s.counted_cash - s.expected_cash, 2)
      from public.cash_sessions s
     where s.company_id = _company and _method = 'ESP' and s.status = 'closed'
       and s.counted_cash is not null and s.expected_cash is not null and round(s.counted_cash - s.expected_cash, 2) <> 0
  )
  select i.source_type, i.source_id, i.occurred_at, i.label, i.contact_label, i.document_number, i.amount,
         l.deposit_id, d.number
    from items i
    left join public.cash_deposit_lines l on l.active and l.source_type = i.source_type and l.source_id = i.source_id
    left join public.cash_deposits d on d.id = l.deposit_id;
$$;
revoke all on function public._cash_deposit_pool(uuid, text) from public, anon, authenticated;

-- Elements proposes a la remise : non remis jusqu a la date de fin (le report toujours), et, sur demande,
-- les elements deja remis de la periode (G8 : « afficher les elements deja remis »).
create or replace function public.cash_deposit_candidates(_company uuid, _method text, _from timestamptz, _to timestamptz, _include_deposited boolean default false)
returns table(source_type text, source_id uuid, occurred_at timestamptz, label text, contact_label text,
              document_number text, amount numeric, deposit_id uuid, deposit_number int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then raise exception 'Acces refuse'; end if;
  return query
    select p.* from public._cash_deposit_pool(_company, _method) p
     where p.occurred_at <= coalesce(_to, now())
       and (
         (p.deposit_id is null and (p.source_type = 'report' or _from is null or p.occurred_at >= _from))
         or (_include_deposited and p.deposit_id is not null and (_from is null or p.occurred_at >= _from))
       )
     order by case when p.source_type = 'report' then 0 else 1 end, p.occurred_at, p.document_number;
end $$;
grant execute on function public.cash_deposit_candidates(uuid, text, timestamptz, timestamptz, boolean) to authenticated;

-- Especes du tiroir (somme des elements non remis) : fond propose a l ouverture de la caisse suivante.
create or replace function public.cash_drawer_balance(_company uuid)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then raise exception 'Acces refuse'; end if;
  return (select coalesce(round(sum(p.amount), 2), 0) from public._cash_deposit_pool(_company, 'ESP') p where p.deposit_id is null);
end $$;
grant execute on function public.cash_drawer_balance(uuid) to authenticated;

-- Ouverture d une caisse : le fond attendu est fige sur la session (l ecart devient une ligne de remise).
create or replace function public.cash_sessions_proposed_float()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.proposed_float := (select coalesce(round(sum(p.amount), 2), 0)
                           from public._cash_deposit_pool(new.company_id, 'ESP') p where p.deposit_id is null);
  return new;
end $$;
revoke all on function public.cash_sessions_proposed_float() from public, anon, authenticated;
drop trigger if exists trg_cash_sessions_proposed_float on public.cash_sessions;
create trigger trg_cash_sessions_proposed_float before insert on public.cash_sessions
  for each row execute function public.cash_sessions_proposed_float();

-- Session ouverte au moment de la migration (fond saisi a la main) : son fond devient l ouverture du tiroir.
update public.cash_sessions set proposed_float = 0 where status = 'open' and proposed_float is null;

-- ---------------------------------------------------------------------
-- 5. Creer une remise (ou archiver sans remise).
--    _items : [{"type": "payment", "id": "<uuid>"}, ...] (types de `cash_deposit_lines`).
--    _deposited : montant remis (especes ; les autres modes remettent toute la selection).
-- ---------------------------------------------------------------------
create or replace function public.cash_deposit_create(
  _company uuid, _method text, _kind text, _period_from timestamptz, _period_to timestamptz,
  _deposit_date date, _items jsonb, _deposited numeric, _bank_code text default null, _comment text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  _id uuid; _no int; _total numeric; _count int; _asked int; _taken int; _taken_no int; _dep numeric; _float numeric;
  _bcode text; _blabel text; _biban text; _bbic text; _sid uuid; _reg text;
begin
  if not public.can_write_table(_company, 'cash_deposits') then raise exception 'Acces refuse'; end if;
  if _kind not in ('remise', 'archive') then raise exception 'Type de remise inconnu : %', _kind using errcode = '23514'; end if;
  if _method in ('AVO', 'ARR') or not exists (
       select 1 from public.reference_values where company_id = _company and table_key = 'payment_method' and code = _method) then
    raise exception 'Mode de reglement inconnu pour une remise : %', _method using errcode = '23514';
  end if;
  if jsonb_typeof(_items) is distinct from 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'Selectionnez au moins une ligne a remettre.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('cash_deposit:' || _company::text || ':' || _method));

  -- Lignes demandees, retrouvees dans le grand livre du mode.
  with sel as (
    select distinct x->>'type' as t, (x->>'id')::uuid as i from jsonb_array_elements(_items) x
  ), found as (
    select p.* from public._cash_deposit_pool(_company, _method) p join sel on sel.t = p.source_type and sel.i = p.source_id
  )
  select (select count(*) from sel), count(*), count(*) filter (where found.deposit_id is not null),
         min(found.deposit_number) filter (where found.deposit_id is not null), round(coalesce(sum(found.amount), 0), 2)
    into _asked, _count, _taken, _taken_no, _total
    from found;
  if _count <> _asked then
    raise exception 'Ligne introuvable pour ce mode de reglement (% demandee(s), % trouvee(s)) : rechargez la liste.', _asked, _count using errcode = '23514';
  end if;
  if _taken > 0 then
    raise exception 'Ligne deja remise (remise n° %) : rechargez la liste.', _taken_no using errcode = '23514';
  end if;

  if _kind = 'archive' then
    _dep := 0;
  elsif _method = 'ESP' then
    _dep := round(coalesce(_deposited, 0), 2);
    if _dep < 0 then raise exception 'Le montant remis ne peut pas etre negatif.' using errcode = '23514'; end if;
    if _dep > _total then
      raise exception 'Montant remis (% EUR) superieur aux especes selectionnees (% EUR) : le nouveau fond de caisse serait negatif.', _dep, _total using errcode = '23514';
    end if;
  else
    _dep := _total;
    if _dep < 0 then raise exception 'Total negatif : une remise % ne peut pas etre negative (archivez sans remise).', _method using errcode = '23514'; end if;
  end if;
  _float := case when _method = 'ESP' then round(_total - _dep, 2) else null end;
  if _float < 0 then
    raise exception 'Les especes selectionnees sont negatives (% EUR) : ajoutez le report ou les encaissements de la periode.', _total using errcode = '23514';
  end if;

  select coalesce(max(number), 0) + 1 into _no from public.cash_deposits where company_id = _company and method = _method;
  if _bank_code is not null then
    select code, label, extra->>'iban', extra->>'bic' into _bcode, _blabel, _biban, _bbic from public.reference_values
     where company_id = _company and table_key = 'bank_account' and code = _bank_code;
    if _bcode is null then raise exception 'Banque inconnue : %', _bank_code using errcode = '23514'; end if;
  end if;
  select id, register_code into _sid, _reg from public.cash_sessions where company_id = _company and status = 'open' limit 1;

  insert into public.cash_deposits (company_id, number, method, kind, status, register_code, period_from, period_to, deposit_date,
         lines_total, deposited_amount, new_float, line_count, bank_code, bank_label, bank_iban, bank_bic, comment, session_id, created_by)
  values (_company, _no, _method, _kind, 'active', coalesce(_reg, 'CAISSE-1'),
          _period_from, coalesce(_period_to, now()), coalesce(_deposit_date, current_date),
          _total, _dep, _float, _count, _bcode, _blabel, _biban, _bbic,
          nullif(btrim(coalesce(_comment, '')), ''),
          case when _method = 'ESP' then _sid else null end, auth.uid())
  returning id into _id;

  insert into public.cash_deposit_lines (company_id, deposit_id, source_type, source_id, occurred_at, label, contact_label, document_number, amount)
  select _company, _id, p.source_type, p.source_id, p.occurred_at, p.label, p.contact_label, p.document_number, round(p.amount, 2)
    from public._cash_deposit_pool(_company, _method) p
    join (select distinct x->>'type' as t, (x->>'id')::uuid as i from jsonb_array_elements(_items) x) sel
      on sel.t = p.source_type and sel.i = p.source_id
   where p.deposit_id is null;

  -- Especes sorties du tiroir pendant une caisse ouverte : sortie de type 01 dans la session (Z juste).
  if _method = 'ESP' and _kind = 'remise' and _dep > 0 and _sid is not null then
    insert into public.cash_movements (company_id, session_id, kind, method, amount, reason, operator_id, type_code, deposit_id)
    values (_company, _sid, 'out', 'ESP', _dep, 'Remise en banque n° ' || _no, auth.uid(), '01', _id);
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, new_data, origin)
  values (_company, auth.uid(), 'cash_deposit_create', 'cash_deposit', _id::text,
          jsonb_build_object('number', _no, 'method', _method, 'kind', _kind, 'lines', _count, 'lines_total', _total,
                             'deposited', _dep, 'new_float', _float, 'session_id', _sid), 'screen');
  return _id;
end $$;
grant execute on function public.cash_deposit_create(uuid, text, text, timestamptz, timestamptz, date, jsonb, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Annuler une remise (motif obligatoire) : ses lignes redeviennent disponibles. Refuse si son report
--    a deja ete repris par une remise active (annuler d abord la plus recente). La sortie de type 01
--    est compensee par une entree tant que sa caisse est ouverte ; sinon elle rejoint le grand livre.
-- ---------------------------------------------------------------------
create or replace function public.cash_deposit_cancel(_deposit uuid, _reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _d public.cash_deposits; _next int; _net numeric; _sid uuid;
begin
  select * into _d from public.cash_deposits where id = _deposit for update;
  if _d.id is null then raise exception 'Remise introuvable'; end if;
  if not public.can_write_table(_d.company_id, 'cash_deposits') then raise exception 'Acces refuse'; end if;
  if coalesce(btrim(_reason), '') = '' then raise exception 'Annulation d une remise : le motif est obligatoire.' using errcode = '23514'; end if;
  if _d.status <> 'active' then raise exception 'Remise deja annulee.' using errcode = '23514'; end if;
  select d.number into _next from public.cash_deposit_lines l join public.cash_deposits d on d.id = l.deposit_id
   where l.active and l.source_type = 'report' and l.source_id = _d.id limit 1;
  if _next is not null then
    raise exception 'Le report de cette remise est repris par la remise n° % : annulez d abord celle-ci.', _next using errcode = '23514';
  end if;

  update public.cash_deposit_lines set active = false where deposit_id = _d.id and active;
  update public.cash_deposits set status = 'annulee', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason)
   where id = _d.id;

  -- Sorties posees par la remise dans une caisse encore ouverte : compensees dans cette caisse.
  for _sid, _net in
    select m.session_id, sum(case when m.kind = 'out' then m.amount else -m.amount end)
      from public.cash_movements m join public.cash_sessions s on s.id = m.session_id
     where m.deposit_id = _d.id and s.status = 'open'
     group by m.session_id
  loop
    if round(_net, 2) <> 0 then
      insert into public.cash_movements (company_id, session_id, kind, method, amount, reason, operator_id, type_code, deposit_id)
      values (_d.company_id, _sid, case when _net > 0 then 'in' else 'out' end, 'ESP', abs(round(_net, 2)),
              'Annulation de la remise en banque n° ' || _d.number, auth.uid(), '01', _d.id);
    end if;
  end loop;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
  values (_d.company_id, auth.uid(), 'cash_deposit_cancel', 'cash_deposit', _d.id::text,
          jsonb_build_object('status', _d.status, 'deposited', _d.deposited_amount, 'new_float', _d.new_float),
          jsonb_build_object('status', 'annulee', 'reason', btrim(_reason)), 'screen');
end $$;
grant execute on function public.cash_deposit_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Modifier une remise (motif obligatoire, ancien / nouveau dans `events`) : date, banque, montant remis.
--    Le montant d une remise d especes ne change plus si son report est repris, si une caisse a ete
--    ouverte depuis, ou si la caisse ou la remise a ete faite est cloturee.
-- ---------------------------------------------------------------------
create or replace function public.cash_deposit_amend(_deposit uuid, _deposited numeric, _deposit_date date, _bank_code text, _reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _d public.cash_deposits; _dep numeric; _float numeric; _delta numeric; _sid uuid;
        _bcode text; _blabel text; _biban text; _bbic text;
begin
  select * into _d from public.cash_deposits where id = _deposit for update;
  if _d.id is null then raise exception 'Remise introuvable'; end if;
  if not public.can_write_table(_d.company_id, 'cash_deposits') then raise exception 'Acces refuse'; end if;
  if coalesce(btrim(_reason), '') = '' then raise exception 'Modification d une remise : le motif est obligatoire.' using errcode = '23514'; end if;
  if _d.status <> 'active' then raise exception 'Remise annulee : elle ne se modifie plus.' using errcode = '23514'; end if;

  _dep := round(coalesce(_deposited, _d.deposited_amount), 2);
  if _d.kind = 'archive' then _dep := 0; end if;
  _float := _d.new_float;
  if _dep <> _d.deposited_amount then
    if _dep < 0 then raise exception 'Le montant remis ne peut pas etre negatif.' using errcode = '23514'; end if;
    if _d.method = 'ESP' then
      if _dep > _d.lines_total then
        raise exception 'Montant remis (% EUR) superieur aux especes de la remise (% EUR).', _dep, _d.lines_total using errcode = '23514';
      end if;
      if exists (select 1 from public.cash_deposit_lines where active and source_type = 'report' and source_id = _d.id) then
        raise exception 'Le report de cette remise est deja repris par une remise suivante : son montant ne change plus.' using errcode = '23514';
      end if;
      if exists (select 1 from public.cash_movements m join public.cash_sessions s on s.id = m.session_id
                  where m.deposit_id = _d.id and s.status = 'closed')
         or exists (select 1 from public.cash_sessions s where s.id = _d.session_id and s.status = 'closed') then
        raise exception 'La caisse de cette remise est cloturee : son montant ne change plus (annulez-la et refaites-la).' using errcode = '23514';
      end if;
      if exists (select 1 from public.cash_sessions s where s.company_id = _d.company_id and s.opened_at > _d.created_at
                    and s.id is distinct from _d.session_id) then
        raise exception 'Une caisse a ete ouverte depuis cette remise : son montant ne change plus (annulez-la et refaites-la).' using errcode = '23514';
      end if;
      _float := round(_d.lines_total - _dep, 2);
      _delta := round(_dep - _d.deposited_amount, 2);
      select id into _sid from public.cash_sessions where id = _d.session_id and status = 'open';
      if _sid is not null and _delta <> 0 then
        insert into public.cash_movements (company_id, session_id, kind, method, amount, reason, operator_id, type_code, deposit_id)
        values (_d.company_id, _sid, case when _delta > 0 then 'out' else 'in' end, 'ESP', abs(_delta),
                'Modification de la remise en banque n° ' || _d.number, auth.uid(), '01', _d.id);
      end if;
    end if;
  end if;
  if _bank_code is not null and _bank_code is distinct from _d.bank_code then
    select code, label, extra->>'iban', extra->>'bic' into _bcode, _blabel, _biban, _bbic from public.reference_values
     where company_id = _d.company_id and table_key = 'bank_account' and code = _bank_code;
    if _bcode is null then raise exception 'Banque inconnue : %', _bank_code using errcode = '23514'; end if;
  end if;

  update public.cash_deposits set
    deposited_amount = _dep, new_float = _float,
    deposit_date = coalesce(_deposit_date, deposit_date),
    bank_code  = coalesce(_bcode, bank_code), bank_label = case when _bcode is null then bank_label else _blabel end,
    bank_iban  = case when _bcode is null then bank_iban else _biban end,
    bank_bic   = case when _bcode is null then bank_bic else _bbic end,
    amended_at = now(), amended_by = auth.uid()
   where id = _d.id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
  values (_d.company_id, auth.uid(), 'cash_deposit_amend', 'cash_deposit', _d.id::text,
          jsonb_build_object('deposited', _d.deposited_amount, 'new_float', _d.new_float, 'deposit_date', _d.deposit_date, 'bank_code', _d.bank_code),
          jsonb_build_object('deposited', _dep, 'new_float', _float, 'deposit_date', coalesce(_deposit_date, _d.deposit_date),
                             'bank_code', coalesce(_bcode, _d.bank_code), 'reason', btrim(_reason)), 'screen');
end $$;
grant execute on function public.cash_deposit_amend(uuid, numeric, date, text, text) to authenticated;

comment on table public.cash_deposits is 'M6 PDV009 (rattrapage G8) : remises en banque par mode de reglement, report du fond de caisse ; ecriture par cash_deposit_create / _cancel / _amend seulement.';
comment on table public.cash_deposit_lines is 'M6 PDV009 : elements remis (report, reglement, mouvement, ecart) ; un element actif ne se remet qu une fois.';
comment on function public.cash_drawer_balance(uuid) is 'M6 PDV009 : especes du tiroir (reports non repris + elements especes non remis) ; fond propose a l ouverture.';
