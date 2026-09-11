-- M1 — Code client auto-incrémenté, détection de doublons, suppression sûre.
--
-- 1. `code` etait alimente uniquement par la reprise G8 : toute fiche creee depuis
--    l'application (y compris via createLinkedContact) restait sans code et
--    s'affichait « — » dans la liste. Un trigger l'attribue desormais a l'insertion.
-- 2. Detection de doublons stricte (nom + ville + telephone + e-mail) appelee avant
--    creation : alerte non bloquante cote UI, l'utilisateur confirme ou renonce.
-- 3. Suppression physique autorisee uniquement pour une fiche vierge (aucune ligne
--    metier rattachee). Sinon l'appelant doit archiver (regle 4 : audit preserve,
--    le trigger audit_row() trace de toute facon le DELETE).

create extension if not exists unaccent;

-- ---------------------------------------------------------------------
-- 1. Code client auto-incremente, par societe (numerotation par societe, COM005)
-- ---------------------------------------------------------------------

-- Prochain code libre = max des codes purement numeriques de la societe + 1.
-- Verrou transactionnel par societe : deux creations simultanees ne peuvent pas
-- obtenir le meme numero.
create or replace function public.next_contact_code(_company uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  _next bigint;
begin
  perform pg_advisory_xact_lock(hashtext('contact_code:' || _company::text));
  -- Borne a 9 chiffres : `code` est un champ texte libre (reprise G8), et un
  -- code a 20 chiffres ferait deborder le cast en bigint, ce qui bloquerait
  -- TOUTE creation de contact pour la societe.
  select coalesce(max(code::bigint), 0) + 1
    into _next
    from public.contacts
   where company_id = _company
     and code ~ '^[0-9]{1,9}$';
  return _next::text;
end;
$fn$;

create or replace function public.set_contact_code()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := public.next_contact_code(new.company_id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_contacts_code on public.contacts;
create trigger trg_contacts_code before insert on public.contacts
  for each row execute function public.set_contact_code();

-- Rattrape les fiches deja creees sans code (les doublons prives constates en
-- production). En UN SEUL UPDATE ensembliste : la version en boucle faisait un
-- UPDATE audite par ligne, soit des milliers d'ecritures dans une transaction
-- unique, avec un risque de timeout lors du passage manuel du script.
with base as (
  select company_id, coalesce(max(code::bigint), 0) as maxc
    from public.contacts
   where code ~ '^[0-9]{1,9}$'
   group by company_id
),
todo as (
  select c.id,
         c.company_id,
         row_number() over (partition by c.company_id order by c.created_at, c.id) as rn
    from public.contacts c
   where c.code is null or btrim(c.code) = ''
)
update public.contacts c
   set code = (coalesce(b.maxc, 0) + t.rn)::text
  from todo t
  left join base b on b.company_id = t.company_id
 where c.id = t.id;

-- ---------------------------------------------------------------------
-- 2. Detection de doublons — stricte : nom + ville + telephone + e-mail
-- ---------------------------------------------------------------------

-- Normalisations : casse/accents/espaces ignores pour le texte, chiffres seuls
-- pour le telephone (0484/714943 == +32 484 71 49 43). NULL et '' equivalents.
create or replace function public.contact_norm_txt(_v text)
returns text language sql immutable
set search_path = public, extensions, pg_temp
as $fn$
  select btrim(lower(unaccent(coalesce(_v, ''))));
$fn$;

create or replace function public.contact_norm_phone(_v text)
returns text language sql immutable
set search_path = public, extensions, pg_temp
as $fn$
  select regexp_replace(coalesce(_v, ''), '[^0-9]', '', 'g');
$fn$;

-- Renvoie les fiches strictement identiques sur les 4 criteres.
create or replace function public.contacts_find_duplicates(
  _company uuid,
  _name    text,
  _city    text,
  _phone   text,
  _email   text,
  _exclude uuid default null
)
returns setof public.contacts
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
  select c.*
    from public.contacts c
   -- Garde RLS : security definer contourne les policies, on verifie l'appartenance.
   where public.is_member(_company)
     and c.company_id = _company
     and c.is_active
     and (_exclude is null or c.id <> _exclude)
     and public.contact_norm_txt(
           coalesce(
             nullif(c.company_name, ''),
             btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))
           )
         ) = public.contact_norm_txt(_name)
     and public.contact_norm_txt(c.city) = public.contact_norm_txt(_city)
     -- On compare a CHACUN des trois numeros, pas au premier renseigne : les fiches
     -- reprises du CSV G8 ont leur numero dans `phone` (fixe), alors que le
     -- formulaire n'alimente que mobile/gsm. Un coalesce les rendait indetectables.
     and public.contact_norm_phone(_phone) in (
           public.contact_norm_phone(c.mobile),
           public.contact_norm_phone(c.phone),
           public.contact_norm_phone(c.gsm)
         )
     and public.contact_norm_txt(c.email) = public.contact_norm_txt(_email)
   order by c.created_at
   limit 20;
$fn$;

-- ---------------------------------------------------------------------
-- 3. Suppression sure
-- ---------------------------------------------------------------------

-- Recense les lignes metier rattachees a une fiche, en suivant les cles etrangeres
-- reelles declarees vers public.contacts (voir le detail dans le corps).
create or replace function public.contact_dependencies(_id uuid)
returns table (table_name text, n bigint)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  _r record;
  _n bigint;
begin
  -- Garde RLS : security definer contourne les policies.
  if not exists (
    select 1 from public.contacts c where c.id = _id and public.is_member(c.company_id)
  ) then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;

  -- On enumere les VRAIES cles etrangeres vers public.contacts, pas les colonnes
  -- qui s'appellent 'contact_id' : plusieurs tables referencent un contact sous un
  -- autre nom (articles.main_supplier_id, purchases.supplier_id,
  -- consignments.depositor_id, orders_parts.supplier_id...). Un filtre sur le nom
  -- de colonne les manquerait et une fiche fournisseur passerait pour vierge : le
  -- DELETE mettrait alors silencieusement a NULL ses references (ON DELETE SET NULL).
  -- ATTENTION : on ne peut PAS ignorer les FK ON DELETE CASCADE en bloc. Six tables
  -- metier cascadent depuis contacts et disparaitraient sans un mot : sepa_mandates
  -- (mandats de domiciliation, piece legale), communications (journal CRM),
  -- delivery_addresses, client_price_rules, customer_price_rules, contact_subcontacts.
  -- Seule contact_links est purement technique : c'est la seule exclusion legitime.
  for _r in
    select con.conrelid::regclass::text as tname,
           att.attname                  as cname
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid
       and att.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'public.contacts'::regclass
       and con.conrelid <> 'public.contact_links'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', _r.tname, _r.cname)
      into _n using _id;
    if _n > 0 then
      table_name := _r.tname || '.' || _r.cname;
      n := _n;
      return next;
    end if;
  end loop;
end;
$fn$;

-- Supprime la fiche si et seulement si elle est vierge. Sinon : exception claire,
-- l'UI bascule alors sur l'archivage.
create or replace function public.contact_delete_safe(_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  _deps text;
begin
  -- Garde RLS : security definer contourne les policies. La policy contacts_delete
  -- exige is_admin (et non is_member) : on reproduit EXACTEMENT ce niveau, sinon
  -- cette fonction ouvrirait la suppression physique a tout membre de la societe.
  if not exists (
    select 1 from public.contacts c where c.id = _id and public.is_admin(c.company_id)
  ) then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;

  select string_agg(table_name || ' (' || n || ')', ', ')
    into _deps
    from public.contact_dependencies(_id);

  if _deps is not null then
    raise exception 'CONTACT_HAS_DEPENDENCIES: %', _deps
      using errcode = 'foreign_key_violation';
  end if;

  delete from public.contacts where id = _id;
end;
$fn$;

-- ---------------------------------------------------------------------
-- 4. Civilite : nettoyage des valeurs heritees a tort
-- ---------------------------------------------------------------------

-- `civility` sert de forme juridique (SPRL, SA…) sur une fiche pro et de civilite
-- (M./Mme) sur une fiche privee. createLinkedContact recopiait la valeur de la
-- source sans tenir compte du changement de type : d'ou « SPRL » en civilite de
-- particuliers. On vide ces valeurs aberrantes ; le code cesse l'heritage.
update public.contacts
   set civility = null
 where type = 'particulier'
   and civility is not null
   and btrim(civility) <> ''
   and lower(btrim(civility)) not in (
     'm', 'm.', 'mr', 'monsieur', 'mme', 'madame', 'mlle', 'mademoiselle', 'autre'
   );

-- Harmonise les abreviations existantes sur les 3 valeurs du menu deroulant.
update public.contacts
   set civility = case
     when lower(btrim(civility)) in ('m', 'm.', 'mr', 'monsieur') then 'Monsieur'
     when lower(btrim(civility)) in ('mme', 'madame', 'mlle', 'mademoiselle') then 'Madame'
     else civility
   end
 where type = 'particulier'
   and civility is not null;

-- ---------------------------------------------------------------------
-- 5. Recherche : indexer aussi le nouveau `code`
-- ---------------------------------------------------------------------

-- Les codes attribues par le trigger seraient introuvables : le haystack de
-- contacts_search indexait `legacy_code` (reprise G8) mais pas `code`.
create or replace function public._contact_haystack(c public.contacts)
returns text language sql stable set search_path = public, extensions, pg_temp as $fn$
  select lower(unaccent(concat_ws(' ',
    c.last_name, c.first_name, c.company_name, c.city, c.email, c.email_pro,
    c.vat_number, c.legacy_code, c.code, c.phone, c.mobile)));
$fn$;

-- ---------------------------------------------------------------------
-- 6. Droits d'execution (convention du projet : authenticated + service_role)
-- ---------------------------------------------------------------------

-- next_contact_code est SECURITY DEFINER et n'a pas de garde d'appartenance :
-- elle ne doit etre appelable que par le trigger, jamais depuis PostgREST.
revoke all on function public.next_contact_code(uuid) from public, anon, authenticated;
revoke all on function public.set_contact_code() from public, anon, authenticated;

grant execute on function public.contacts_find_duplicates(uuid, text, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.contact_dependencies(uuid) to authenticated, service_role;
grant execute on function public.contact_delete_safe(uuid) to authenticated, service_role;
grant execute on function public.contact_norm_txt(text) to authenticated, service_role;
grant execute on function public.contact_norm_phone(text) to authenticated, service_role;

notify pgrst, 'reload schema';
