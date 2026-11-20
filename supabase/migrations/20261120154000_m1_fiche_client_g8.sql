-- =====================================================================
-- M1 — Fiche client comme G8 (décision du client Q67, 20/11/2026). CON001 CLI-025 CLI-027 CLI-028 CLI-111
--
-- G8 : pour un particulier, Civilité, Nom et Prénom sont OBLIGATOIRES (« Validation fiche
-- client : compléter Civilité, Prénom, Nom ») et le nom / prénom sont mis en MAJUSCULES.
-- Pour une société, la raison sociale est obligatoire (en majuscules) ; la civilité ne s'applique
-- pas (elle porte la forme juridique, colonne legal_form).
--
-- Déclencheur trg_contacts_identity_g8 (BEFORE INSERT / UPDATE OF civility, first_name, last_name,
-- company_name, type) :
--   1. MAJUSCULES, toujours (écran, espace client, imports, fonctions) : first_name, last_name,
--      company_name = upper(...) — les accents sont gardés (é → É). Rien d'autre n'est touché.
--   2. CHAMPS OBLIGATOIRES, contrôlés sur les écritures des ÉCRANS (requête directe d'un utilisateur
--      connecté : current_user = authenticated, hors déclencheur imbriqué), à la création et à la
--      modification :
--        - particulier : civilité, nom et prénom ;
--        - professionnel, fournisseur, banque / leasing : raison sociale ;
--        - employé : rien de plus (inchangé).
--      À la modification, le contrôle ne joue que si l'identité change (civilité, nom, prénom,
--      raison sociale ou type) : les fiches existantes incomplètes ne sont PAS bloquées
--      rétroactivement (changement d'adresse, de statut, commentaire, fusion… passent) ; c'est
--      l'écran qui demande de compléter quand on ouvre la fiche pour la modifier.
--      Les fonctions serveur (inscription, espace client, prospect depuis un e-mail, fusion,
--      modification en cascade, imports G8, anonymisation RGPD) ne sont pas bloquées, ni l'import
--      de fichier de l'écran Migration (imported_from renseigné à la création).
--   Message clair en FR ; hint « contact_identity_required », detail = champs manquants
--   (civility, last_name, first_name, company_name) : l'écran le traduit en FR / NL / EN / IT.
--
-- Additive, rejouable. Données existantes : migration suivante (20261120155000).
-- Essai à blanc : supabase/tests/m1_fiche_client_g8.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

create or replace function public.contacts_identity_g8()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  missing text[] := '{}';
  screen boolean;
  identity_changed boolean;
begin
  -- 1. Majuscules (accents gardés).
  if new.first_name is not null then new.first_name := upper(new.first_name); end if;
  if new.last_name is not null then new.last_name := upper(new.last_name); end if;
  if new.company_name is not null then new.company_name := upper(new.company_name); end if;

  -- 2. Champs obligatoires : écritures directes des écrans seulement. La fonction est SECURITY
  --    INVOKER : sur une requête directe (PostgREST), current_user = authenticated ; dans une
  --    fonction serveur SECURITY DEFINER (inscription, fusion, cascade, prospect…), c'est son
  --    propriétaire. Les déclencheurs imbriqués (fiche liée) ne sont pas contrôlés.
  screen := current_user = 'authenticated' and auth.uid() is not null and pg_trigger_depth() = 1;
  if not screen then return new; end if;
  -- Import de fichier depuis l'écran Migration (imported_from renseigné) : fiches à compléter ensuite.
  if tg_op = 'INSERT' and new.imported_from is not null then return new; end if;

  if tg_op = 'UPDATE' then
    identity_changed := new.civility is distinct from old.civility
      or new.first_name is distinct from upper(old.first_name)
      or new.last_name is distinct from upper(old.last_name)
      or new.company_name is distinct from upper(old.company_name)
      or new.type is distinct from old.type;
    if not identity_changed then return new; end if;
  end if;

  if new.type = 'particulier' then
    if nullif(btrim(coalesce(new.civility, '')), '') is null then missing := missing || 'civility'::text; end if;
    if nullif(btrim(coalesce(new.last_name, '')), '') is null then missing := missing || 'last_name'::text; end if;
    if nullif(btrim(coalesce(new.first_name, '')), '') is null then missing := missing || 'first_name'::text; end if;
  elsif new.type in ('professionnel', 'fournisseur', 'banque_leasing') then
    if nullif(btrim(coalesce(new.company_name, '')), '') is null then missing := missing || 'company_name'::text; end if;
  end if;

  if array_length(missing, 1) > 0 then
    raise exception 'Fiche client : compléter %.',
      array_to_string(array(select case m when 'civility' then 'Civilité' when 'last_name' then 'Nom'
                                          when 'first_name' then 'Prénom' else 'Raison sociale' end
                              from unnest(missing) m), ', ')
      using errcode = '23514', hint = 'contact_identity_required', detail = array_to_string(missing, ',');
  end if;
  return new;
end $$;
revoke all on function public.contacts_identity_g8() from public, anon, authenticated;

drop trigger if exists trg_contacts_identity_g8 on public.contacts;
create trigger trg_contacts_identity_g8
  before insert or update of civility, first_name, last_name, company_name, type on public.contacts
  for each row execute function public.contacts_identity_g8();
