-- =====================================================================
-- M3 — Registre des vehicules a moteur (« registre des garagistes »), VEH010.
-- AR n° 1 du 29/12/1992, art. 28 (version en vigueur au 10/01/2026) ;
-- circulaire 2018/C/47 du 19/04/2018 (remplace la circulaire AFER 16/2004).
-- Etude : docs/etudes/2026-11-caisse-legal-et-marche.md, lignes L16 et C10.
-- Decision du client (Simon, 03/11/2026) : « integre deja tout ce que tu peux sans validation ».
--
-- CE QUE DIT LA LOI (sources dans docs/bible/modules/M03-vehicules.md §4, registre des vehicules) :
--   * tout assujetti qui, de facon reguliere, livre des vehicules a moteur, preste des services
--     sur ces vehicules (sauf lavage) ou s'entremet dans la livraison de VO tient, PAR SIEGE
--     D'EXPLOITATION, un registre des vehicules qui entrent dans ses installations ;
--   * a l'ENTREE : numero d'ordre continu (au moins 4 positions, 0001 → 9999), date d'entree,
--     plaque (a defaut le numero de chassis), numero TVA UE du donneur d'ordre le cas echeant,
--     code de nature de l'operation ;
--   * a la SORTIE : date de sortie ; au plus tard A LA FIN DU MOIS QUI SUIT la sortie : reference
--     de la facture (ou du document), ou le motif de l'absence de document ;
--   * forme papier ou numerique sans formalite, a condition de garantir l'INTEGRITE (rien n'est
--     efface ni ecrase, une correction reste lisible) et la lisibilite jusqu'a la fin de la
--     conservation (art. 60 CTVA : 10 ans depuis le 01/01/2023 ; les guides de 2018 disent encore
--     7 ans, on garde tout de toute facon) ; registre au siege ;
--   * cyclomoteurs de classe A et B et speed pedelecs : tolerance, pas d'inscription ;
--     les motos du garage lui-meme (demonstration, courtoisie) ne sont pas inscrites ;
--   * sanction : amende de 1 500 a 5 000 EUR (art. 70 §4 CTVA, AR n° 44).
--   Codes de nature de l'operation (« code fixe par le Ministre », art. 28 §2 1°) repris de la
--   circulaire 2018/C/47 (p. 12-14) par le lot precedent ; NON relus sur le texte officiel le
--   03/11 (circulaire introuvable en ligne) : extra.verified = false, a confirmer par le comptable :
--     1 = reparation, entretien, montage, transformation (hors garantie) ;
--     2 = idem, entierement sous garantie ;  3 = etablissement d'un devis ;
--     4 = livraison d'un vehicule d'occasion (vente VO, intermediaire).
--   Le DMS ajoute un code INTERNE « VN » (livraison d'un vehicule neuf, art. 28 §1 1°) qui
--   n'est pas dans la circulaire : a confirmer avec le comptable (modifiable dans Parametres →
--   Tables → « Registre des vehicules : natures d'operation »).
--
-- CONCEPTION (B7, append-only) :
--   * une ligne par entree ; la sortie et la reference de facture COMPLETENT la ligne (champs
--     vides → remplis, jamais ecrases) ; toute autre correction = LIGNE DE RECTIFICATION qui
--     porte un nouveau numero et pointe l'ancienne (`rectifies_id`), l'ancienne restant lisible
--     (`rectified_by_id`). Aucun UPDATE libre, aucun DELETE : garde par trigger + droits revoques.
--   * numero d'ordre continu par societe et par annee (verrou consultatif), affiche AAAA-0001.
--   * alimente par DECLENCHEURS : ouverture d'un OR (entree, code 1 ou 2), facturation / annulation
--     de l'OR (sortie) ; validation d'une reprise (entree code 4, source reprise) ; reception d'une
--     moto neuve (entree VN, source reception) ; depot-vente (entree code 4, source depot) ;
--     vente de la moto (sortie + facture, via stock_moves comme _moto_sortie_de_stock) ;
--     restitution d'un depot-vente (sortie sans document, motif).
--   * `invoice_due_by` = dernier jour du mois qui suit la sortie (alerte dans la cloche).
--   * reprise d'historique : `vehicle_register_backfill(_company, _from)` idempotente, lignes
--     marquees `is_backfill`, numerotees dans l'ordre chronologique.
--
-- NE PAS APPLIQUER depuis un agent. Essai a blanc (entre begin; et rollback;) :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f <ce fichier>
-- Application par le client : npx supabase@2.117.0 db push --linked --project-ref ujmrosbgkvgvwfnuryna
-- Puis, une fois, par societe : select public.vehicle_register_backfill('<company_id>');
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Natures d'operation (table de reference par societe, codes de la circulaire + VN interne)
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'vehicle_register_nature', x.code, x.label, x.sort_order, x.extra
  from public.companies c
  cross join (values
    ('1',  'Reparation, entretien, montage, transformation (hors garantie)', 10, '{"official": true, "verified": false, "source": "circulaire 2018/C/47"}'::jsonb),
    ('2',  'Reparation, entretien, montage, transformation entierement sous garantie', 20, '{"official": true, "verified": false, "source": "circulaire 2018/C/47"}'::jsonb),
    ('3',  'Etablissement d''un devis', 30, '{"official": true, "verified": false, "source": "circulaire 2018/C/47"}'::jsonb),
    ('4',  'Livraison d''un vehicule d''occasion (vente VO, reprise, depot-vente, intermediaire)', 40, '{"official": true, "verified": false, "source": "circulaire 2018/C/47"}'::jsonb),
    ('VN', 'Livraison d''un vehicule neuf (art. 28 §1 1° - code interne, a confirmer avec le comptable)', 50, '{"official": false, "verified": false, "source": "DMS"}'::jsonb)
  ) as x(code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 2. La table du registre (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.vehicle_register (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete restrict,
  establishment       text not null,
  year                int  not null,
  seq                 int  not null,
  entered_at          date not null,
  vehicle_id          uuid references public.vehicles(id) on delete set null,
  vin                 text,
  plate               text,
  contact_id          uuid references public.contacts(id) on delete set null,
  principal_vat       text,
  nature_code         text not null,
  source              text not null,
  source_id           uuid,
  left_at             date,
  invoice_document_id uuid references public.documents(id) on delete set null,
  invoice_ref         text,
  no_document_reason  text,
  invoice_due_by      date,
  is_backfill         boolean not null default false,
  is_void             boolean not null default false,
  rectifies_id        uuid references public.vehicle_register(id) on delete restrict,
  rectified_by_id     uuid references public.vehicle_register(id) on delete restrict,
  note                text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint vehicle_register_source_check check (source in ('or', 'reprise', 'reception', 'depot', 'manuel')),
  constraint vehicle_register_seq_check check (seq >= 1),
  constraint vehicle_register_ident_check check (vin is not null or plate is not null),
  constraint vehicle_register_exit_check check (left_at is null or left_at >= entered_at),
  constraint vehicle_register_seq_unique unique (company_id, year, seq)
);
create index if not exists idx_vehicle_register_company_year on public.vehicle_register(company_id, year, seq);
create index if not exists idx_vehicle_register_vehicle on public.vehicle_register(vehicle_id);
create index if not exists idx_vehicle_register_source on public.vehicle_register(company_id, source, source_id);
create index if not exists idx_vehicle_register_open on public.vehicle_register(company_id) where left_at is null and rectified_by_id is null and not is_void;
create index if not exists idx_vehicle_register_due on public.vehicle_register(company_id, invoice_due_by)
  where left_at is not null and invoice_document_id is null and invoice_ref is null and no_document_reason is null;

comment on table public.vehicle_register is
  'Registre des vehicules a moteur (AR n° 1 art. 28, circulaire 2018/C/47) : une ligne par entree d''un vehicule dans l''etablissement, completee par la date de sortie et la reference de la facture (au plus tard fin du mois suivant). Append-only : corrections par ligne de rectification (B7).';
comment on column public.vehicle_register.seq is 'Numero d''ordre continu par societe et par annee ; affiche AAAA-0001 (au moins 4 positions, circulaire 2018/C/47).';
comment on column public.vehicle_register.establishment is 'Siege d''exploitation (un registre par siege) : adresse de la societe au moment de l''inscription.';
comment on column public.vehicle_register.principal_vat is 'Numero de TVA UE du donneur d''ordre etabli dans un autre Etat membre (code pays inclus), le cas echeant.';
comment on column public.vehicle_register.nature_code is 'Code de nature de l''operation : reference_values table_key = vehicle_register_nature (1, 2, 3, 4 de la circulaire ; VN interne).';
comment on column public.vehicle_register.source is 'Ce qui a inscrit la ligne : or (ordre de reparation), reprise (M7), reception (moto neuve, M4), depot (depot-vente), manuel (administrateur).';
comment on column public.vehicle_register.invoice_due_by is 'Date limite pour inscrire la reference de la facture : dernier jour du mois qui suit la sortie.';
comment on column public.vehicle_register.no_document_reason is 'Motif de l''absence de facture ou de document (restitution, garantie constructeur, annulation...).';
comment on column public.vehicle_register.rectifies_id is 'Ligne de rectification : ligne qu''elle corrige (l''ancienne reste lisible, barree).';
comment on column public.vehicle_register.is_void is 'Rectification qui ANNULE une inscription faite par erreur (la ligne annulee reste lisible).';

drop trigger if exists trg_vehicle_register_audit on public.vehicle_register;
create trigger trg_vehicle_register_audit after insert or update or delete on public.vehicle_register
  for each row execute function public.audit_row();

alter table public.vehicle_register enable row level security;
drop policy if exists vehicle_register_select on public.vehicle_register;
create policy vehicle_register_select on public.vehicle_register for select to authenticated
  using (public.is_member(company_id));
-- Ecriture UNIQUEMENT par les fonctions (security definer) : aucun droit direct.
revoke insert, update, delete on public.vehicle_register from authenticated, anon;

-- ---------------------------------------------------------------------
-- 3. Date limite de facturation : fin du mois qui suit la sortie
-- ---------------------------------------------------------------------
create or replace function public.vehicle_register_due_by(_left_at date)
returns date language sql immutable as $$
  select case when _left_at is null then null
              else (date_trunc('month', _left_at::timestamp) + interval '2 months' - interval '1 day')::date end;
$$;
grant execute on function public.vehicle_register_due_by(date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Garde append-only : seuls les champs vides de sortie se remplissent, le reste est fige
-- ---------------------------------------------------------------------
create or replace function public._vehicle_register_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Registre des vehicules : une inscription ne se supprime jamais (rectifiez-la)';
  end if;
  if tg_op = 'INSERT' then
    new.invoice_due_by := public.vehicle_register_due_by(new.left_at);
    new.vin := nullif(upper(regexp_replace(coalesce(new.vin, ''), '[^A-Za-z0-9]', '', 'g')), '');
    new.plate := nullif(upper(trim(coalesce(new.plate, ''))), '');
    return new;
  end if;
  -- UPDATE : champs figes
  if new.company_id is distinct from old.company_id or new.establishment is distinct from old.establishment
     or new.year is distinct from old.year or new.seq is distinct from old.seq
     or new.entered_at is distinct from old.entered_at or new.vehicle_id is distinct from old.vehicle_id
     or new.vin is distinct from old.vin or new.plate is distinct from old.plate
     or new.contact_id is distinct from old.contact_id or new.principal_vat is distinct from old.principal_vat
     or new.nature_code is distinct from old.nature_code or new.source is distinct from old.source
     or new.source_id is distinct from old.source_id or new.is_backfill is distinct from old.is_backfill
     or new.is_void is distinct from old.is_void or new.rectifies_id is distinct from old.rectifies_id
     or new.note is distinct from old.note or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Registre des vehicules : une inscription ne se modifie pas, ajoutez une ligne de rectification (B7)';
  end if;
  -- Champs de sortie : vide → rempli seulement
  if (old.left_at is not null and new.left_at is distinct from old.left_at)
     or (old.invoice_document_id is not null and new.invoice_document_id is distinct from old.invoice_document_id)
     or (old.invoice_ref is not null and new.invoice_ref is distinct from old.invoice_ref)
     or (old.no_document_reason is not null and new.no_document_reason is distinct from old.no_document_reason)
     or (old.rectified_by_id is not null and new.rectified_by_id is distinct from old.rectified_by_id) then
    raise exception 'Registre des vehicules : la sortie inscrite ne s''efface pas, ajoutez une ligne de rectification (B7)';
  end if;
  new.invoice_due_by := public.vehicle_register_due_by(new.left_at);
  return new;
end $$;

drop trigger if exists trg_vehicle_register_guard on public.vehicle_register;
create trigger trg_vehicle_register_guard before insert or update or delete on public.vehicle_register
  for each row execute function public._vehicle_register_guard();

-- ---------------------------------------------------------------------
-- 5. Outils internes : siege, numero d'ordre, inscription, sortie
-- ---------------------------------------------------------------------
create or replace function public._vehicle_register_establishment(_company uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(concat_ws(', ', nullif(trim(c.address), ''), nullif(trim(concat_ws(' ', c.zip, c.city)), '')), ''), c.name)
    from public.companies c where c.id = _company;
$$;

-- Numero d'ordre continu par societe et par annee (verrou consultatif de transaction).
create or replace function public._vehicle_register_next_seq(_company uuid, _year int)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('vehicle_register:' || _company::text || ':' || _year::text));
  select coalesce(max(seq), 0) + 1 into n from public.vehicle_register where company_id = _company and year = _year;
  return n;
end $$;

-- Ligne ouverte (non rectifiee, non annulee) d'une source donnee.
create or replace function public._vehicle_register_open_line(_company uuid, _source text, _source_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select r.id from public.vehicle_register r
   where r.company_id = _company and r.source = _source and r.source_id = _source_id
     and r.rectified_by_id is null and not r.is_void
   order by r.created_at desc limit 1;
$$;

-- La moto est-elle DEJA dans les installations a cette date au titre du stock (reception, reprise,
-- depot-vente, ligne manuelle) ? Un OR interne sur une moto du stock (preparation, PDI) ne fait pas
-- une seconde entree : elle est deja inscrite.
create or replace function public._vehicle_register_in_stock(_company uuid, _vehicle uuid, _at date)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.vehicle_register r
     where r.company_id = _company and r.vehicle_id = _vehicle and r.source in ('reception', 'reprise', 'depot', 'manuel')
       and r.rectified_by_id is null and not r.is_void
       and r.entered_at <= _at and (r.left_at is null or r.left_at >= _at));
$$;

-- Inscription d'une ENTREE. Idempotente par (source, source_id) : renvoie la ligne existante.
create or replace function public._vehicle_register_insert(
  _company uuid, _entered_at date, _vehicle uuid, _vin text, _plate text, _contact uuid,
  _nature text, _source text, _source_id uuid, _note text default null,
  _backfill boolean default false, _actor uuid default null, _origin text default 'system'
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record; c record; existing uuid; _id uuid; _year int; _seq int; _vat text;
  _vin2 text := _vin; _plate2 text := _plate; _contact2 uuid := _contact;
begin
  if _source_id is not null then
    existing := public._vehicle_register_open_line(_company, _source, _source_id);
    if existing is not null then return existing; end if;
  end if;
  if _vehicle is not null then
    select vin, plate, id into v from public.vehicles where id = _vehicle;
    _vin2 := coalesce(_vin2, v.vin);
    _plate2 := coalesce(_plate2, v.plate);
    if _contact2 is null then
      select o.contact_id into _contact2 from public.vehicle_owners o
       where o.vehicle_id = _vehicle and o.is_current order by o.from_date desc limit 1;
    end if;
  end if;
  if nullif(regexp_replace(coalesce(_vin2, ''), '[^A-Za-z0-9]', '', 'g'), '') is null and nullif(trim(coalesce(_plate2, '')), '') is null then
    -- Rien pour identifier la moto (moto du site sans VIN, M-40) : on n'inscrit pas, la fiche sera completee.
    return null;
  end if;
  if _contact2 is not null then
    select vat_number, country into c from public.contacts where id = _contact2;
    if c.vat_number is not null and upper(coalesce(c.country, 'BE')) <> 'BE' then _vat := c.vat_number; end if;
  end if;
  _year := extract(year from _entered_at)::int;
  _seq := public._vehicle_register_next_seq(_company, _year);
  insert into public.vehicle_register (company_id, establishment, year, seq, entered_at, vehicle_id, vin, plate,
                                       contact_id, principal_vat, nature_code, source, source_id, note, is_backfill, created_by)
  values (_company, public._vehicle_register_establishment(_company), _year, _seq, _entered_at, _vehicle, _vin2, _plate2,
          _contact2, _vat, _nature, _source, _source_id, _note, _backfill, coalesce(_actor, auth.uid()))
  returning id into _id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, coalesce(_actor, auth.uid()), 'vehicle_register_entry', 'vehicle_register', _id::text, _origin,
          jsonb_build_object('year', _year, 'seq', _seq, 'entered_at', _entered_at, 'vehicle_id', _vehicle,
                             'vin', _vin2, 'plate', _plate2, 'nature_code', _nature, 'source', _source,
                             'source_id', _source_id, 'backfill', _backfill));
  return _id;
end $$;

-- Inscription d'une SORTIE sur une ligne (date + facture ou motif). Complete sans ecraser.
create or replace function public._vehicle_register_exit_line(
  _line uuid, _left_at date, _invoice_document uuid, _invoice_ref text, _reason text,
  _actor uuid default null, _origin text default 'system'
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.vehicle_register; _ref text := _invoice_ref; _doc uuid := _invoice_document;
begin
  select * into r from public.vehicle_register where id = _line;
  if r.id is null then raise exception 'Registre des vehicules : ligne introuvable'; end if;
  if _doc is not null and _ref is null then
    select d.number into _ref from public.documents d where d.id = _doc;
  end if;
  if r.left_at is not null and _left_at is distinct from r.left_at then
    -- La sortie est deja inscrite : on ne la deplace pas (rectification necessaire).
    _left_at := r.left_at;
  end if;
  if r.invoice_document_id is not null then _doc := r.invoice_document_id; end if;
  if r.invoice_ref is not null then _ref := r.invoice_ref; end if;
  update public.vehicle_register
     set left_at = coalesce(r.left_at, greatest(_left_at, r.entered_at)),
         invoice_document_id = coalesce(r.invoice_document_id, _doc),
         invoice_ref = coalesce(r.invoice_ref, _ref),
         no_document_reason = coalesce(r.no_document_reason, case when _ref is null and _doc is null then _reason end)
   where id = _line;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, coalesce(_actor, auth.uid()), 'vehicle_register_exit', 'vehicle_register', _line::text, _origin,
          jsonb_build_object('left_at', r.left_at, 'invoice_ref', r.invoice_ref, 'no_document_reason', r.no_document_reason),
          jsonb_build_object('left_at', coalesce(r.left_at, _left_at), 'invoice_document_id', _doc, 'invoice_ref', _ref, 'no_document_reason', _reason));
end $$;

-- Sortie par source (OR, reprise, reception, depot) : trouve la ligne ouverte et la complete.
create or replace function public._vehicle_register_exit(
  _company uuid, _source text, _source_id uuid, _left_at date, _invoice_document uuid, _invoice_ref text, _reason text,
  _actor uuid default null, _origin text default 'system'
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare line uuid;
begin
  line := public._vehicle_register_open_line(_company, _source, _source_id);
  if line is null then return; end if;
  perform public._vehicle_register_exit_line(line, _left_at, _invoice_document, _invoice_ref, _reason, _actor, _origin);
end $$;

-- ---------------------------------------------------------------------
-- 6. Declencheurs : ordre de reparation (entree a l'ouverture, sortie a la facture / annulation)
-- ---------------------------------------------------------------------
create or replace function public._vehicle_register_on_repair_order()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare doc record; _nature text;
begin
  if tg_op = 'INSERT' then
    if new.vehicle_id is null then return new; end if;
    if public._vehicle_register_in_stock(new.company_id, new.vehicle_id, coalesce(new.created_at::date, current_date)) then return new; end if;
    _nature := case when new.warranty_status = 'accepte' then '2' else '1' end;
    perform public._vehicle_register_insert(new.company_id, coalesce(new.created_at::date, current_date), new.vehicle_id,
                                            null, null, new.contact_id, _nature, 'or', new.id,
                                            'OR ' || coalesce(new.number, ''), false, null, 'screen');
    return new;
  end if;
  -- OR qui recoit sa moto apres coup (moto choisie plus tard)
  if old.vehicle_id is null and new.vehicle_id is not null and new.status not in ('facture', 'annule')
     and not public._vehicle_register_in_stock(new.company_id, new.vehicle_id, coalesce(new.created_at::date, current_date)) then
    perform public._vehicle_register_insert(new.company_id, coalesce(new.created_at::date, current_date), new.vehicle_id,
                                            null, null, new.contact_id, case when new.warranty_status = 'accepte' then '2' else '1' end,
                                            'or', new.id, 'OR ' || coalesce(new.number, ''), false, null, 'screen');
  end if;
  if new.status = 'facture' and (old.status is distinct from 'facture' or old.invoice_document_id is distinct from new.invoice_document_id)
     and new.invoice_document_id is not null then
    select d.number, d.issue_date into doc from public.documents d where d.id = new.invoice_document_id;
    perform public._vehicle_register_exit(new.company_id, 'or', new.id, coalesce(doc.issue_date, current_date),
                                          new.invoice_document_id, doc.number, null, null, 'screen');
  elsif new.status = 'annule' and old.status is distinct from 'annule' then
    perform public._vehicle_register_exit(new.company_id, 'or', new.id, current_date, null, null,
                                          'OR ' || coalesce(new.number, '') || ' annule : aucun document', null, 'screen');
  end if;
  return new;
end $$;

drop trigger if exists trg_vehicle_register_repair_orders on public.repair_orders;
create trigger trg_vehicle_register_repair_orders
  after insert or update of status, invoice_document_id, vehicle_id on public.repair_orders
  for each row execute function public._vehicle_register_on_repair_order();

-- ---------------------------------------------------------------------
-- 7. Reprise (M7) : la moto entre a la VALIDATION de la reprise (reception + entree en stock
--    occasion) : la fiche passe de « Demande de reprise » a « En stock (occasion) » avec son
--    article (validateReprise). Signal pris sur `vehicles`, present en production quel que soit
--    l'etat des colonnes de workflow de `oro` (validated_at / cancelled_at non appliquees au 03/11).
-- ---------------------------------------------------------------------
create or replace function public._vehicle_register_on_vehicle_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _oro record; _contact uuid;
begin
  if old.status::text = 'repris' and new.status::text = 'stock_vo' and new.article_id is not null then
    select o.id, o.number into _oro from public.oro o where o.vehicle_id = new.id order by o.created_at desc limit 1;
    -- Vendeur de la moto = premier proprietaire enregistre par la reprise (B9).
    select o.contact_id into _contact from public.vehicle_owners o
     where o.vehicle_id = new.id order by o.from_date, o.created_at limit 1;
    perform public._vehicle_register_insert(new.company_id, current_date, new.id, null, null, _contact, '4', 'reprise',
                                            coalesce(_oro.id, new.id), 'Reprise ' || coalesce(_oro.number, ''), false, null, 'screen');
  elsif old.status::text = 'stock_vo' and new.status::text = 'repris' then
    select o.id, o.number into _oro from public.oro o where o.vehicle_id = new.id order by o.created_at desc limit 1;
    perform public._vehicle_register_exit(new.company_id, 'reprise', coalesce(_oro.id, new.id), current_date, null, null,
                                          'Reprise ' || coalesce(_oro.number, '') || ' annulee : moto rendue, aucun document', null, 'screen');
  end if;
  return new;
end $$;

drop trigger if exists trg_vehicle_register_vehicles_update on public.vehicles;
create trigger trg_vehicle_register_vehicles_update
  after update of status, article_id on public.vehicles
  for each row execute function public._vehicle_register_on_vehicle_update();

-- ---------------------------------------------------------------------
-- 8. Reception d'une moto neuve (M4) : fiche creee en stock neuf avec son article
-- ---------------------------------------------------------------------
create or replace function public._vehicle_register_on_vehicle_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status::text = 'stock_vn' and new.article_id is not null then
    perform public._vehicle_register_insert(new.company_id, coalesce(new.entry_date, new.created_at::date, current_date), new.id,
                                            null, null, null, 'VN', 'reception', new.id, 'Reception moto neuve', false, null, 'screen');
  end if;
  return new;
end $$;

drop trigger if exists trg_vehicle_register_vehicles on public.vehicles;
create trigger trg_vehicle_register_vehicles
  after insert on public.vehicles
  for each row execute function public._vehicle_register_on_vehicle_insert();

-- ---------------------------------------------------------------------
-- 9. Depot-vente : entree au depot, sortie a la vente (facture) ou a la restitution
-- ---------------------------------------------------------------------
create or replace function public._vehicle_register_on_consignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare doc record;
begin
  if tg_op = 'INSERT' then
    if new.vehicle_id is not null then
      perform public._vehicle_register_insert(new.company_id, coalesce(new.created_at::date, current_date), new.vehicle_id,
                                              null, null, new.depositor_id, '4', 'depot', new.id,
                                              'Depot-vente ' || coalesce(new.number, ''), false, null, 'screen');
    end if;
    return new;
  end if;
  if old.vehicle_id is null and new.vehicle_id is not null and new.status = 'en_depot' then
    perform public._vehicle_register_insert(new.company_id, coalesce(new.created_at::date, current_date), new.vehicle_id,
                                            null, null, new.depositor_id, '4', 'depot', new.id,
                                            'Depot-vente ' || coalesce(new.number, ''), false, null, 'screen');
  end if;
  if new.status = 'vendu' and old.status is distinct from 'vendu' then
    if new.sale_document_id is not null then
      select d.number, d.issue_date into doc from public.documents d where d.id = new.sale_document_id;
    end if;
    perform public._vehicle_register_exit(new.company_id, 'depot', new.id, coalesce(doc.issue_date, new.sold_at::date, current_date),
                                          new.sale_document_id, doc.number,
                                          case when new.sale_document_id is null then 'Depot-vente vendu : facture a inscrire' end, null, 'screen');
  elsif new.status = 'restitue' and old.status is distinct from 'restitue' then
    perform public._vehicle_register_exit(new.company_id, 'depot', new.id, current_date, null, null,
                                          'Restitution au deposant : aucune vente, aucun document', null, 'screen');
  end if;
  return new;
end $$;

drop trigger if exists trg_vehicle_register_consignments on public.consignments;
create trigger trg_vehicle_register_consignments
  after insert or update of status, vehicle_id, sale_document_id on public.consignments
  for each row execute function public._vehicle_register_on_consignment();

-- ---------------------------------------------------------------------
-- 10. Vente de la moto : sortie + reference de la facture (meme chemin que _moto_sortie_de_stock)
-- ---------------------------------------------------------------------
create or replace function public._vehicle_register_on_sale()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v record; doc record; line uuid;
begin
  if new.is_reservation or new.move_type::text <> 'sortie' or new.qty_delta >= 0 then return new; end if;
  if coalesce(new.origin, '') not in ('sale', 'shopify', 'pos') then return new; end if;
  select id into v from public.vehicles where article_id = new.article_id and company_id = new.company_id;
  if v.id is null then return new; end if;
  select r.id into line from public.vehicle_register r
   where r.company_id = new.company_id and r.vehicle_id = v.id and r.source in ('reprise', 'reception', 'depot', 'manuel')
     and r.left_at is null and r.rectified_by_id is null and not r.is_void
   order by r.entered_at desc, r.created_at desc limit 1;
  if line is null then return new; end if;
  select d.id, d.number, d.issue_date into doc from public.documents d
   where d.company_id = new.company_id and d.number = new.ref order by d.created_at desc limit 1;
  perform public._vehicle_register_exit_line(line, coalesce(doc.issue_date, new.occurred_at::date, current_date), doc.id, doc.number,
                                             case when doc.id is null then 'Vente ' || coalesce(new.ref, '') || ' : document a inscrire' end,
                                             new.operator_id, coalesce(new.origin, 'system'));
  return new;
end $$;

drop trigger if exists trg_vehicle_register_sale on public.stock_moves;
create trigger trg_vehicle_register_sale
  after insert on public.stock_moves
  for each row execute function public._vehicle_register_on_sale();

-- ---------------------------------------------------------------------
-- 11. Fonctions d'ecran : ligne manuelle (admin), sortie, rectification (admin)
-- ---------------------------------------------------------------------
create or replace function public.vehicle_register_add_manual(
  _company uuid, _entered_at date, _vehicle uuid default null, _vin text default null, _plate text default null,
  _contact uuid default null, _nature text default '1', _note text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _id uuid;
begin
  if auth.uid() is null or not public.is_admin(_company) then raise exception 'Acces refuse : administrateur requis'; end if;
  if not exists (select 1 from public.reference_values rv where rv.company_id = _company and rv.table_key = 'vehicle_register_nature' and rv.code = _nature and rv.is_active) then
    raise exception 'Nature d''operation inconnue : %', _nature;
  end if;
  _id := public._vehicle_register_insert(_company, _entered_at, _vehicle, _vin, _plate, _contact, _nature, 'manuel', null, _note, false, auth.uid(), 'screen');
  if _id is null then raise exception 'Plaque ou numero de chassis obligatoire'; end if;
  return _id;
end $$;
revoke all on function public.vehicle_register_add_manual(uuid, date, uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.vehicle_register_add_manual(uuid, date, uuid, text, text, uuid, text, text) to authenticated;

create or replace function public.vehicle_register_set_exit(
  _line uuid, _left_at date, _invoice_document uuid default null, _invoice_ref text default null, _reason text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid;
begin
  select company_id into _company from public.vehicle_register where id = _line;
  if _company is null then raise exception 'Ligne introuvable'; end if;
  if auth.uid() is null or not public.is_member(_company) then raise exception 'Acces refuse'; end if;
  if _invoice_document is null and nullif(trim(coalesce(_invoice_ref, '')), '') is null and nullif(trim(coalesce(_reason, '')), '') is null then
    raise exception 'Indiquez la reference de la facture ou le motif de l''absence de document';
  end if;
  perform public._vehicle_register_exit_line(_line, _left_at, _invoice_document, nullif(trim(coalesce(_invoice_ref, '')), ''),
                                             nullif(trim(coalesce(_reason, '')), ''), auth.uid(), 'screen');
end $$;
revoke all on function public.vehicle_register_set_exit(uuid, date, uuid, text, text) from public, anon;
grant execute on function public.vehicle_register_set_exit(uuid, date, uuid, text, text) to authenticated;

-- Rectification : nouvelle ligne (nouveau numero) qui reprend l'ancienne avec les corrections ;
-- l'ancienne est marquee rectifiee et reste lisible. _void = true annule une inscription erronee.
create or replace function public.vehicle_register_rectify(
  _line uuid, _entered_at date default null, _vin text default null, _plate text default null, _nature text default null,
  _left_at date default null, _invoice_ref text default null, _reason text default null, _note text default null,
  _void boolean default false
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.vehicle_register; _id uuid; _year int; _seq int; _ent date;
begin
  select * into r from public.vehicle_register where id = _line;
  if r.id is null then raise exception 'Ligne introuvable'; end if;
  if auth.uid() is null or not public.is_admin(r.company_id) then raise exception 'Acces refuse : administrateur requis'; end if;
  if r.rectified_by_id is not null then raise exception 'Cette ligne est deja rectifiee'; end if;
  if _nature is not null and not exists (select 1 from public.reference_values rv where rv.company_id = r.company_id and rv.table_key = 'vehicle_register_nature' and rv.code = _nature) then
    raise exception 'Nature d''operation inconnue : %', _nature;
  end if;
  _ent := coalesce(_entered_at, r.entered_at);
  _year := extract(year from _ent)::int;
  _seq := public._vehicle_register_next_seq(r.company_id, _year);
  insert into public.vehicle_register (company_id, establishment, year, seq, entered_at, vehicle_id, vin, plate, contact_id, principal_vat,
                                       nature_code, source, source_id, left_at, invoice_document_id, invoice_ref, no_document_reason,
                                       is_backfill, is_void, rectifies_id, note, created_by)
  values (r.company_id, r.establishment, _year, _seq, _ent, r.vehicle_id, coalesce(_vin, r.vin), coalesce(_plate, r.plate),
          r.contact_id, r.principal_vat, coalesce(_nature, r.nature_code), r.source, r.source_id,
          coalesce(_left_at, r.left_at), case when _invoice_ref is null then r.invoice_document_id end,
          coalesce(nullif(trim(coalesce(_invoice_ref, '')), ''), r.invoice_ref), coalesce(nullif(trim(coalesce(_reason, '')), ''), r.no_document_reason),
          r.is_backfill, _void, r.id, coalesce(_note, 'Rectification de ' || r.year || '-' || lpad(r.seq::text, 4, '0')), auth.uid())
  returning id into _id;
  update public.vehicle_register set rectified_by_id = _id where id = r.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'vehicle_register_rectify', 'vehicle_register', _id::text, 'screen',
          to_jsonb(r), jsonb_build_object('rectifies', r.id, 'year', _year, 'seq', _seq, 'void', _void, 'note', _note));
  return _id;
end $$;
revoke all on function public.vehicle_register_rectify(uuid, date, text, text, text, date, text, text, text, boolean) from public, anon;
grant execute on function public.vehicle_register_rectify(uuid, date, text, text, text, date, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 12. Lecture : liste enrichie (annee / mois / filtre), compteur pour la cloche
-- ---------------------------------------------------------------------
create or replace function public.vehicle_register_list(
  _company uuid, _year int default null, _month int default null, _filter text default 'all', _vehicle uuid default null
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x.year desc, x.seq desc), '[]'::jsonb)
  from (
    select r.id, r.year, r.seq, r.year || '-' || lpad(r.seq::text, 4, '0') as number, r.establishment, r.entered_at,
           r.vehicle_id, r.vin, r.plate, r.contact_id, r.principal_vat, r.nature_code,
           coalesce(rv.label, r.nature_code) as nature_label, r.source, r.source_id, r.left_at,
           r.invoice_document_id, r.invoice_ref, r.no_document_reason, r.invoice_due_by, r.is_backfill, r.is_void,
           r.rectifies_id, r.rectified_by_id, r.note, r.created_at,
           trim(concat_ws(' ', v.brand, v.model)) as vehicle_label,
           coalesce(nullif(c.company_name, ''), trim(concat_ws(' ', c.first_name, c.last_name))) as contact_name,
           case when r.rectified_by_id is not null then 'rectifiee'
                when r.is_void then 'annulee'
                when r.left_at is null then 'en_cours'
                when r.invoice_document_id is not null or r.invoice_ref is not null or r.no_document_reason is not null then 'close'
                when r.invoice_due_by < current_date then 'en_retard'
                else 'a_facturer' end as state
      from public.vehicle_register r
      left join public.vehicles v on v.id = r.vehicle_id
      left join public.contacts c on c.id = r.contact_id
      left join public.reference_values rv on rv.company_id = r.company_id and rv.table_key = 'vehicle_register_nature' and rv.code = r.nature_code
     where r.company_id = _company
       and (_vehicle is null or r.vehicle_id = _vehicle)
       and (_year is null or r.year = _year)
       and (_month is null or extract(month from r.entered_at)::int = _month)
  ) x
  where public.is_member(_company)
    and (_filter = 'all'
         or (_filter = 'open' and x.state = 'en_cours')
         or (_filter = 'to_invoice' and x.state in ('a_facturer', 'en_retard'))
         or (_filter = 'overdue' and x.state = 'en_retard')
         or (_filter = 'closed' and x.state = 'close'));
$$;
revoke all on function public.vehicle_register_list(uuid, int, int, text, uuid) from public, anon;
grant execute on function public.vehicle_register_list(uuid, int, int, text, uuid) to authenticated;

-- Compteur de la cloche : sorties sans reference de facture, dont celles en retard.
create or replace function public.vehicle_register_pending(_company uuid)
returns table(to_invoice int, overdue int, due_this_month int, next_due date) language sql stable security definer set search_path = public, pg_temp as $$
  -- due_this_month : a inscrire AVANT LA FIN DU MOIS EN COURS (sorties du mois precedent).
  select count(*) filter (where r.invoice_due_by >= current_date)::int,
         count(*) filter (where r.invoice_due_by < current_date)::int,
         count(*) filter (where r.invoice_due_by >= current_date
                            and r.invoice_due_by <= (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date)::int,
         min(r.invoice_due_by)
    from public.vehicle_register r
   where r.company_id = _company and public.is_member(_company)
     and r.left_at is not null and r.rectified_by_id is null and not r.is_void
     and r.invoice_document_id is null and r.invoice_ref is null and r.no_document_reason is null;
$$;
revoke all on function public.vehicle_register_pending(uuid) from public, anon;
grant execute on function public.vehicle_register_pending(uuid) to authenticated;

-- Annees presentes dans le registre (pour le selecteur).
create or replace function public.vehicle_register_years(_company uuid)
returns int[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct r.year order by r.year desc), '{}'::int[])
    from public.vehicle_register r where r.company_id = _company and public.is_member(_company);
$$;
revoke all on function public.vehicle_register_years(uuid) from public, anon;
grant execute on function public.vehicle_register_years(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 13. Reprise de l'historique (idempotente) : OR, reprises, receptions, depots existants,
--     avec leur date reelle, numerotes dans l'ordre chronologique, marques is_backfill.
--     _from : on ne reprend pas les entrees anterieures (defaut : 1er janvier de l'annee en cours).
-- ---------------------------------------------------------------------
create or replace function public.vehicle_register_backfill(_company uuid, _from date default date_trunc('year', current_date)::date)
returns table(inserted int, skipped int) language plpgsql security definer set search_path = public, pg_temp as $$
declare ev record; _id uuid; _ins int := 0; _skip int := 0; doc record;
begin
  if auth.uid() is not null and not public.is_admin(_company) then raise exception 'Acces refuse : administrateur requis'; end if;
  for ev in
    with candidates as (
      -- Ordres de reparation
      select ro.created_at::date as entered_at, ro.created_at as sort_at, 'or'::text as source, ro.id as source_id, ro.vehicle_id,
             ro.contact_id, case when ro.warranty_status = 'accepte' then '2' else '1' end as nature,
             'OR ' || coalesce(ro.number, '') as note,
             case when ro.status = 'facture' then coalesce(d.issue_date, ro.updated_at::date)
                  when ro.status = 'annule' then ro.updated_at::date end as left_at,
             case when ro.status = 'facture' then ro.invoice_document_id end as invoice_document_id,
             case when ro.status = 'facture' then d.number end as invoice_ref,
             case when ro.status = 'facture' and d.number is null then 'OR facture : reference a inscrire'
                  when ro.status = 'annule' then 'OR annule : aucun document' end as reason
        from public.repair_orders ro
        left join public.documents d on d.id = ro.invoice_document_id
       where ro.company_id = _company and ro.vehicle_id is not null
      union all
      -- Reprises validees (moto avec article occasion et dossier de reprise) : entree = premiere
      -- entree en stock de l'article, a defaut la creation de la fiche.
      select coalesce(se.occurred_at::date, v.entry_date, v.created_at::date), coalesce(se.occurred_at, v.entry_date::timestamptz, v.created_at),
             'reprise', o.id, v.id,
             (select ow.contact_id from public.vehicle_owners ow where ow.vehicle_id = v.id order by ow.from_date, ow.created_at limit 1),
             '4', 'Reprise ' || coalesce(o.number, ''),
             case when v.status::text in ('vendu', 'livre') then coalesce(v.sold_date, sd.issue_date) end,
             case when v.status::text in ('vendu', 'livre') then sd.id end,
             case when v.status::text in ('vendu', 'livre') then sd.number end,
             case when v.status::text in ('vendu', 'livre') and sd.number is null then 'Moto vendue : reference a inscrire' end
        from public.vehicles v
        join public.articles a on a.id = v.article_id
        join lateral (select o.id, o.number from public.oro o where o.vehicle_id = v.id order by o.created_at desc limit 1) o on true
        left join lateral (select m.occurred_at from public.stock_moves m
                            where m.article_id = v.article_id and m.move_type::text = 'entree' and not m.is_reservation
                            order by m.occurred_at limit 1) se on true
        left join lateral (
          select d.id, d.number, d.issue_date from public.documents d
           where d.company_id = v.company_id and d.doc_type in ('FAC', 'TIK') and d.status <> 'annulee'
             and (d.vehicle_id = v.id or exists (select 1 from public.document_lines l where l.document_id = d.id and l.article_id = v.article_id))
           order by d.issue_date desc, d.created_at desc limit 1) sd on true
       where v.company_id = _company and a.mgmt_type in ('O', 'P') and v.status::text <> 'repris'
      union all
      -- Motos neuves ou d'occasion entrees en stock sans reprise (reception M4, import G8, site)
      select coalesce(v.entry_date, v.created_at::date), coalesce(v.entry_date::timestamptz, v.created_at), 'reception', v.id, v.id,
             null::uuid, case when a.mgmt_type = 'V' then 'VN' else '4' end,
             case when a.mgmt_type = 'V' then 'Reception moto neuve' else 'Entree en stock occasion' end,
             case when v.status::text in ('vendu', 'livre') then coalesce(v.sold_date, sd.issue_date) end,
             case when v.status::text in ('vendu', 'livre') then sd.id end,
             case when v.status::text in ('vendu', 'livre') then sd.number end,
             case when v.status::text in ('vendu', 'livre') and sd.number is null then 'Moto vendue : reference a inscrire' end
        from public.vehicles v
        join public.articles a on a.id = v.article_id
        left join lateral (
          select d.id, d.number, d.issue_date from public.documents d
           where d.company_id = v.company_id and d.doc_type in ('FAC', 'TIK') and d.status <> 'annulee'
             and (d.vehicle_id = v.id or exists (select 1 from public.document_lines l where l.document_id = d.id and l.article_id = v.article_id))
           order by d.issue_date desc, d.created_at desc limit 1) sd on true
       where v.company_id = _company and a.mgmt_type in ('V', 'O', 'P')
         and v.status::text not in ('repris', 'en_commande', 'courtoisie', 'demo')
         and not exists (select 1 from public.oro o where o.vehicle_id = v.id)
         and not exists (select 1 from public.consignments cs where cs.vehicle_id = v.id)
      union all
      -- Depots-vente
      select cs.created_at::date, cs.created_at, 'depot', cs.id, cs.vehicle_id, cs.depositor_id, '4',
             'Depot-vente ' || coalesce(cs.number, ''),
             case when cs.status = 'vendu' then coalesce(d.issue_date, cs.sold_at::date) when cs.status = 'restitue' then cs.created_at::date end,
             case when cs.status = 'vendu' then cs.sale_document_id end,
             case when cs.status = 'vendu' then d.number end,
             case when cs.status = 'vendu' and d.number is null then 'Depot-vente vendu : facture a inscrire'
                  when cs.status = 'restitue' then 'Restitution au deposant : aucun document' end
        from public.consignments cs
        left join public.documents d on d.id = cs.sale_document_id
       where cs.company_id = _company and cs.vehicle_id is not null
    )
    select * from candidates c where c.entered_at >= _from order by c.sort_at, c.source_id
  loop
    if public._vehicle_register_open_line(_company, ev.source, ev.source_id) is not null
       or exists (select 1 from public.vehicle_register r where r.company_id = _company and r.source = ev.source and r.source_id = ev.source_id) then
      _skip := _skip + 1; continue;
    end if;
    -- OR interne sur une moto deja inscrite au titre du stock : pas de seconde entree (comme le declencheur).
    if ev.source = 'or' and public._vehicle_register_in_stock(_company, ev.vehicle_id, ev.entered_at) then
      _skip := _skip + 1; continue;
    end if;
    _id := public._vehicle_register_insert(_company, ev.entered_at, ev.vehicle_id, null, null, ev.contact_id, ev.nature,
                                           ev.source, ev.source_id, ev.note || ' (reprise d''historique)', true, auth.uid(), 'import');
    if _id is null then _skip := _skip + 1; continue; end if;
    _ins := _ins + 1;
    if ev.left_at is not null then
      perform public._vehicle_register_exit_line(_id, ev.left_at, ev.invoice_document_id, ev.invoice_ref, ev.reason, auth.uid(), 'import');
    end if;
  end loop;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'vehicle_register_backfill', 'vehicle_register', _company::text, 'import',
          jsonb_build_object('from', _from, 'inserted', _ins, 'skipped', _skip));
  return query select _ins, _skip;
end $$;
revoke all on function public.vehicle_register_backfill(uuid, date) from public, anon;
grant execute on function public.vehicle_register_backfill(uuid, date) to authenticated, service_role;
