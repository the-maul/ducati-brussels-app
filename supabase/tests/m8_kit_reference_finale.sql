-- =====================================================================
-- Essai a blanc de 20261123116000_m8_kit_reference_finale.sql, DANS UNE TRANSACTION ANNULEE.
-- Moto reelle ZDMM502AA9B018417 (lecture seule), kit « annual ». Chaque ligne doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _kit on commit drop as
select k.* from public.vehicles v
cross join lateral public._workshop_service_kit_items(v.company_id, v.ducati_model_year_id::text, 'annual') k
where v.id = 'a1331aec-96c4-4c84-aada-1f4f3eeb8119';

insert into _t(check_name, result)
select 'le kit garde des lignes', case when (select count(*) from _kit) >= 3 then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'le filtre passe a la derniere reference 44440031C',
  case when exists (select 1 from _kit where reference = '44440031C') then 'ok'
       else 'KO ' || (select string_agg(reference, ', ') from _kit) end;
insert into _t(check_name, result)
select 'l''ancienne reference 44440035A a disparu',
  case when not exists (select 1 from _kit where reference = '44440035A') then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'article et reference de la ligne concordent',
  case when not exists (select 1 from _kit k join public.articles a on a.id = k.article_id where a.reference <> k.reference) then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'aucune ligne du kit sur une reference remplacee quand une suivante existe',
  case when not exists (
    select 1 from _kit k join public.articles a on a.id = k.article_id
     join public.articles f on f.id = public.article_final_replacement(a.id)
    where f.id <> a.id and coalesce(f.is_active, true) and f.mgmt_type = a.mgmt_type) then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'une seule ligne par article',
  case when (select count(*) from _kit where article_id is not null) = (select count(distinct article_id) from _kit where article_id is not null) then 'ok' else 'KO' end;
