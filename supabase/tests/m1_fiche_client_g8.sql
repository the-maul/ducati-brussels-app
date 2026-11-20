-- =====================================================================
-- Essai à blanc — Q67 (20/11/2026) : fiche client comme G8 (migrations 20261120154000 et
-- 20261120155000, rejouées par PRE_SQL). Société de test ItalTest, administrateur
-- simon@themaul.be, transaction annulée (rt.py). Chaque ligne du résultat doit valoir « ok ».
--   1-4. création d'un particulier refusée sans civilité / sans prénom / sans nom ; acceptée complète,
--        nom et prénom en MAJUSCULES, accents gardés ;
--   5-6. société : raison sociale obligatoire, mise en majuscules ;
--   7-8. fiche existante incomplète : modification de l'adresse acceptée (pas de blocage
--        rétroactif), modification du nom refusée tant que la fiche n'est pas complétée ;
--   9.   écriture hors écran (fonction serveur, import) : fiche incomplète acceptée ;
--   10-13. données existantes : plus aucun nom / prénom / raison sociale en minuscules, archive
--        des anciennes valeurs, accents gardés, un seul event de synthèse par société.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

-- Fiche existante incomplète (comme une fiche G8 sans civilité ni prénom), écrite hors écran.
do $s$
declare _old uuid;
begin
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'particulier', null, 'ancienne q67', 'BE') returning id into _old;
  perform set_config('test.old', _old::text, true);
  insert into _t(check_name, result) values ('9 hors ecran : fiche incomplete acceptee, en majuscules',
    case when (select last_name from public.contacts where id = _old) = 'ANCIENNE Q67' then 'ok' else 'FAIL' end);
end $s$;

-- Données existantes (migration 20261120155000 passée en PRE_SQL).
insert into _t(check_name, result)
select '10 plus aucun nom / prenom / raison sociale en minuscules',
  case when count(*) = 0 then 'ok' else 'FAIL ' || count(*) end
  from public.contacts ct
 where ct.company_id in ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', '3d9f0f13-a691-4d07-ad58-34590df86e33')
   and (ct.first_name is distinct from upper(ct.first_name) or ct.last_name is distinct from upper(ct.last_name)
     or ct.company_name is distinct from upper(ct.company_name));
insert into _t(check_name, result)
select '11 archive : anciennes valeurs gardees (' || count(*) || ' fiches)',
  case when count(*) > 0 and bool_and(a.first_name is distinct from c.first_name or a.last_name is distinct from c.last_name
                                      or a.company_name is distinct from c.company_name) then 'ok' else 'FAIL' end
  from public.contacts_names_archive_20261120 a join public.contacts c on c.id = a.contact_id;
insert into _t(check_name, result)
select '12 accents gardes (' || count(*) || ' fiches accentuees)',
  case when count(*) > 0
        and count(*) filter (where c.last_name ~ '[éèêëàâäçôöùûüïî]' or c.first_name ~ '[éèêëàâäçôöùûüïî]') = 0
        and count(*) filter (where c.last_name ~ '[ÉÈÊËÀÂÄÇÔÖÙÛÜÏÎ]' or c.first_name ~ '[ÉÈÊËÀÂÄÇÔÖÙÛÜÏÎ]') = count(*) then 'ok' else 'FAIL' end
  from public.contacts_names_archive_20261120 a join public.contacts c on c.id = a.contact_id
 where a.last_name ~ '[éèêëàâäçôöùûüïî]' or a.first_name ~ '[éèêëàâäçôöùûüïî]';
insert into _t(check_name, result)
select '13 un seul event de synthese par societe (' || count(*) || ')',
  case when count(*) = count(distinct company_id) and count(*) >= 1 then 'ok' else 'FAIL' end
  from public.events where action = 'contacts_names_uppercase';

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _id uuid; _hint text; _det text; r record;
  _old uuid := current_setting('test.old')::uuid;
begin
  begin
    insert into public.contacts (company_id, type, first_name, last_name, country) values (_co, 'particulier', 'Éloïse', 'Q67 essai', 'BE');
    insert into _t(check_name, result) values ('1 particulier sans civilite : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _hint = pg_exception_hint, _det = pg_exception_detail;
    insert into _t(check_name, result) values ('1 particulier sans civilite : refuse',
      case when _hint = 'contact_identity_required' and _det = 'civility' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  begin
    insert into public.contacts (company_id, type, civility, first_name, last_name, country) values (_co, 'particulier', 'Madame', '  ', 'Q67 essai', 'BE');
    insert into _t(check_name, result) values ('2 particulier sans prenom : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _hint = pg_exception_hint, _det = pg_exception_detail;
    insert into _t(check_name, result) values ('2 particulier sans prenom : refuse',
      case when _hint = 'contact_identity_required' and _det = 'first_name' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  begin
    insert into public.contacts (company_id, type, civility, first_name, country) values (_co, 'particulier', 'Madame', 'Éloïse', 'BE');
    insert into _t(check_name, result) values ('3 particulier sans nom : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _hint = pg_exception_hint;
    insert into _t(check_name, result) values ('3 particulier sans nom : refuse',
      case when _hint = 'contact_identity_required' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  insert into public.contacts (company_id, type, civility, first_name, last_name, country)
  values (_co, 'particulier', 'Madame', 'Éloïse', 'de la Fontaine q67', 'BE') returning id into _id;
  select first_name, last_name into r from public.contacts where id = _id;
  insert into _t(check_name, result) values ('4 particulier complet : accepte, MAJUSCULES, accents gardes',
    case when r.first_name = 'ÉLOÏSE' and r.last_name = 'DE LA FONTAINE Q67' then 'ok' else 'FAIL ' || r.first_name || ' ' || r.last_name end);

  begin
    insert into public.contacts (company_id, type, last_name, country) values (_co, 'professionnel', 'Gérant', 'BE');
    insert into _t(check_name, result) values ('5 societe sans raison sociale : refusee', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _hint = pg_exception_hint, _det = pg_exception_detail;
    insert into _t(check_name, result) values ('5 societe sans raison sociale : refusee',
      case when _hint = 'contact_identity_required' and _det = 'company_name' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
  insert into public.contacts (company_id, type, company_name, country) values (_co, 'professionnel', 'motos réunies q67 srl', 'BE') returning id into _id;
  insert into _t(check_name, result) values ('6 societe : raison sociale en majuscules, sans civilite',
    case when (select company_name from public.contacts where id = _id) = 'MOTOS RÉUNIES Q67 SRL' then 'ok' else 'FAIL' end);

  -- L'écran renvoie toute la fiche : identité inchangée, adresse modifiée.
  update public.contacts set city = 'IXELLES', zip = '1050', last_name = 'ANCIENNE Q67', first_name = null, civility = null where id = _old;
  insert into _t(check_name, result) values ('7 fiche incomplete : modification de l''adresse acceptee',
    case when (select city from public.contacts where id = _old) = 'IXELLES' then 'ok' else 'FAIL' end);
  begin
    update public.contacts set last_name = 'NOUVEAU NOM Q67' where id = _old;
    insert into _t(check_name, result) values ('8 fiche incomplete : changement du nom refuse (completer)', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _hint = pg_exception_hint, _det = pg_exception_detail;
    insert into _t(check_name, result) values ('8 fiche incomplete : changement du nom refuse (completer)',
      case when _hint = 'contact_identity_required' and _det = 'civility,first_name' then 'ok' else 'FAIL ' || sqlerrm end);
  end;
end $s$;
