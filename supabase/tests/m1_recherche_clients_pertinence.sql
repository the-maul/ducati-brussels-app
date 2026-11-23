-- =====================================================================
-- Essai a blanc de 20261123114000_m1_recherche_clients_pertinence.sql, DANS UNE TRANSACTION ANNULEE.
-- Fiches d'essai dans ItalTest. Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated;
grant usage on sequence _t_n_seq to authenticated;

insert into public.contacts (company_id, type, last_name, first_name, city, email)
values ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'particulier', 'ZQXTEST', 'Éloïse', 'Bruxelles', null),
       ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'particulier', 'AZQXTESTA', 'Marc', 'Namur', null),
       ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'particulier', 'BOULANGER', 'Paul', 'Liège', 'zqxtest@exemple.test');

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

insert into _t(check_name, result)
select 'memes fiches que la recherche actuelle (des)',
  case when (select count(*) from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'des', '', 20000, 0))
          = (select public.contacts_search_count('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'des', '')) then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'des : les DESOUTER passent avant les noms qui contiennent seulement ces lettres',
  case when (select count(*) from (select last_name from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'des', '', 3, 0)) x
              where lower(x.last_name) like 'des%') = 3 then 'ok'
       else 'KO ' || (select string_agg(coalesce(last_name, company_name), ', ') from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'des', '', 3, 0)) end;

insert into _t(check_name, result)
select 'desouter : les 3 fiches, dans les premieres',
  case when (select count(*) from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'desouter', '', 8, 0)) = 3 then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'domenico desouter : les 2 fiches de Domenico en tete, dans les deux ordres',
  case when (select count(*) from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'domenico desouter', '', 2, 0) x where lower(x.first_name) = 'domenico') = 2
        and (select count(*) from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'desouter domenico', '', 2, 0) x where lower(x.first_name) = 'domenico') = 2
       then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'mot entier avant debut de mot, puis e-mail en dernier',
  case when (select string_agg(last_name, '>' ) from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'zqxtest', '', 5, 0))
          = 'ZQXTEST>AZQXTESTA>BOULANGER' then 'ok'
       else 'KO ' || (select string_agg(last_name, '>') from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'zqxtest', '', 5, 0)) end;

insert into _t(check_name, result)
select 'accents ignores (eloise trouve Éloïse)',
  case when (select last_name from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'eloise zqxtest', '', 1, 0)) = 'ZQXTEST' then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'limite et decalage respectes',
  case when (select count(*) from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'des', '', 5, 2)) = 5 then 'ok' else 'KO' end;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e0e0","role":"authenticated"}', true);
set local role authenticated;
insert into _t(check_name, result)
select 'non-membre de la societe : aucune fiche',
  case when (select count(*) from public.contacts_search_best('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'desouter', '', 8, 0)) = 0 then 'ok' else 'KO' end;
reset role;
