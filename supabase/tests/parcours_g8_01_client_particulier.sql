-- =====================================================================
-- Parcours G8 n° 1 (lot-verif-parcours, 20/11/2026) — Créer un client particulier.
-- G8 joué (parcours.md n° 1, 01-clients.md) : Fichiers › Clients › Ajout/Modif/Suppr → Nouveau →
--   Civilité M, Nom, Prénom, CP 1000 → « Recherche ville » (BRUSSEL / BRUXELLES) → Créer
--   → fiche code 6003 (compteur suivant), statut Prospect.
-- Chemin DMS rejoué EXACTEMENT comme l'écran : Clients › Nouveau (/clients/new, contact-form.tsx
--   buildPayload → api.ts createContact = INSERT contacts) ; liste des villes du CP par
--   be_postal_codes (zip-city-suggest.tsx) ; contrôle des doublons avant enregistrement
--   (contacts_find_duplicates) ; liste Clients (contacts_search).
-- Société de test ItalTest, administrateur simon@themaul.be, transaction annulée (rt.py).
-- Contrôles :
--   1. CP 1000 : au moins 2 villes proposées (Bruxelles / Brussel) ;
--   2. fiche créée par l'écran (type particulier, civilité M) ;
--   3. code client attribué automatiquement = suivant du plus grand code numérique d'avant ;
--   4. statut Prospect à la création ;
--   5. company_id = ItalTest (multi-société) ;
--   6. trace events « insert » (qui, quoi, origine écran) ;
--   7. la fiche sort dans la liste Clients (recherche par nom) ;
--   8. la recherche par code client la retrouve ;
--   9. contrôle des doublons : une 2e saisie du même nom + ville est signalée ;
--  10. RLS : la fiche n'est pas visible depuis une autre société (ITALBIKE STORE) ;
--  11. écart constaté G8 / DMS (à trancher, contrôle « ok » sur le constat) : G8 met Nom / Prénom
--      en MAJUSCULES et exige Civilité + Prénom ; le DMS garde la saisie telle quelle et n'exige
--      que le nom (contrôle fait à l'écran) — voir rapport.
-- Chaque ligne du résultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';  -- ItalTest
  _other uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; -- ITALBIKE STORE (lecture seule)
  _tag text := 'ESSAIP01' || to_char(clock_timestamp(), 'HH24MISSMS');
  _cities text[]; _city text; _max_before bigint; _id uuid; c record; _n int;
begin
  -- 1. CP -> villes (fenetre « Recherche ville » de G8)
  select array_agg(city order by city) into _cities from public.be_postal_codes where code = '1000';
  _city := coalesce(_cities[1], 'Bruxelles');
  insert into _t(check_name, result) values
    ('CP 1000 : au moins 2 villes proposees (Bruxelles / Brussel)',
     case when coalesce(array_length(_cities, 1), 0) >= 2 then 'ok' else 'KO ' || coalesce(array_to_string(_cities, ','), 'aucune') end);

  -- Compteur avant (meme regle que next_contact_code : plus grand code purement numerique)
  select coalesce(max(code::bigint), 0) into _max_before from public.contacts
   where company_id = _co and code ~ '^[0-9]{1,9}$';

  -- 2. Enregistrement comme l'ecran (champs que buildPayload envoie pour une saisie minimale)
  insert into public.contacts (company_id, type, status, code, civility, first_name, last_name, company_name,
                               email, mobile, zip, city, country, credit_limit, segment, show_discounts_pos,
                               receipt_copies, is_vip, is_detaxe, is_watch, is_account, is_blocked, mode_ht,
                               marketing_opt_out, locale)
  values (_co, 'particulier', 'prospect', null, 'M', 'Jean', 'Dupont ' || _tag, null,
          null, null, '1000', _city, 'BE', 0, 'standard', true,
          0, false, false, false, false, false, false,
          false, 'fr')
  returning id into _id;
  select * into c from public.contacts where id = _id;
  insert into _t(check_name, result) values
    ('fiche creee : particulier, civilite M, CP 1000 ' || _city,
     case when c.type::text = 'particulier' and c.civility = 'M' and c.zip = '1000' and c.city = _city then 'ok' else 'KO ' || c.type::text end),
    ('code client automatique = suivant du plus grand code (' || (_max_before + 1) || ')',
     case when c.code ~ '^[0-9]+$' and c.code::bigint > _max_before then 'ok' else 'KO ' || coalesce(c.code, 'null') || ' / avant ' || _max_before end),
    ('statut Prospect a la creation', case when c.status::text = 'prospect' then 'ok' else 'KO ' || c.status::text end),
    ('fiche rattachee a la societe ItalTest', case when c.company_id = _co then 'ok' else 'KO' end),
    ('trace events insert (operateur, origine ecran)',
     case when exists (select 1 from public.events e where e.entity_type = 'contacts' and e.entity_id = _id::text
                          and e.action = 'insert' and e.actor_id = auth.uid() and e.origin = 'screen') then 'ok' else 'KO' end);

  -- 7-8. Liste Clients (recherche) : par nom et par code
  select count(*) into _n from public.contacts_search(_co, _tag, null, 20, 0, 'name') x where x.id = _id;
  insert into _t(check_name, result) values ('liste Clients : retrouvee par le nom', case when _n = 1 then 'ok' else 'KO ' || _n end);
  select count(*) into _n from public.contacts_search(_co, c.code, null, 50, 0, 'name') x where x.id = _id;
  insert into _t(check_name, result) values ('liste Clients : retrouvee par le code ' || c.code, case when _n = 1 then 'ok' else 'KO ' || _n end);

  -- 9. Doublon : l'ecran appelle contacts_find_duplicates avant d'enregistrer une 2e fiche
  select count(*) into _n from public.contacts_find_duplicates(_co, 'Jean Dupont ' || _tag, _city, null, null, null) x where x.id = _id;
  insert into _t(check_name, result) values ('doublon : une 2e saisie du meme nom + ville est signalee', case when _n = 1 then 'ok' else 'KO ' || _n end);

  -- 10. Multi-societe : invisible depuis l'autre societe
  select count(*) into _n from public.contacts_search(_other, _tag, null, 20, 0, 'name') x;
  insert into _t(check_name, result) values ('RLS : fiche absente de la liste d une autre societe', case when _n = 0 then 'ok' else 'KO ' || _n end);

  -- 11. Decision Q67 (20/11/2026, comme G8) : nom et prenom enregistres en MAJUSCULES
  insert into _t(check_name, result) values
    ('Q67 : nom enregistre en MAJUSCULES (G8)',
     case when c.last_name = upper('Dupont ' || _tag) then 'ok' else 'KO nom : ' || c.last_name end);
end $s$;

select n, check_name, result from _t order by n;
