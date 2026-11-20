-- =====================================================================
-- VP2 — Code-barres EAN interne « 3000… » créé d'office à la création d'un article (décision du
-- client, 20/11/2026 : « tout comme G8 »). ART001 B12
--
-- G8 : « Référence seule + Créer → l'article est créé, code barre interne 3000118912704 attribué ».
-- Format G8 relevé : 13 chiffres = « 3000 » + compteur sur 8 chiffres + clé de contrôle EAN-13
-- (3000 1189 1270 | 4 : la clé 4 est bien celle de l'EAN-13). Le DMS mettait la référence comme
-- code-barres.
--
-- 1. Série « EAN » dans document_sequences (par société) : préfixe 3000, sans séparateur, 8 chiffres,
--    jamais remise à zéro. Elle apparaît dans l'écran « Numérotation des documents » (aperçu sans la
--    clé, qui est ajoutée à la fin). Premier numéro : après le plus grand EAN interne 3000… déjà en
--    base pour la société (aucun aujourd'hui : 2 codes-barres en tout, ni l'un ni l'autre en 3000).
-- 2. public.ean13_check_digit(text) : clé de contrôle EAN-13 de 12 chiffres.
-- 3. public.next_internal_ean(company) : prochain EAN interne (12 chiffres de la série + clé) ;
--    saute un code déjà pris dans la société (code fournisseur saisi à la main, reprise…).
-- 4. public.article_assign_internal_ean(article) (écran) : « si vide » — l'article n'a encore aucun
--    code-barres → EAN interne créé, principal ; sinon rien (renvoie le code principal existant).
--    Appelée par l'écran juste après la création de l'article (createArticle), à la place de « la
--    référence comme code-barres ». Les imports (G8, catalogue, Shopify) n'appellent pas la fonction :
--    ils gardent leurs codes-barres.
--
-- Additive, rejouable. Essai à blanc : supabase/tests/vp2_ean_interne.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

create or replace function public.ean13_check_digit(_d12 text)
returns int language plpgsql immutable parallel safe set search_path = public, pg_temp as $fn$
declare s int := 0; i int;
begin
  if _d12 is null or _d12 !~ '^\d{12}$' then
    raise exception 'EAN-13 : 12 chiffres attendus (%).', coalesce(_d12, 'vide') using errcode = '22023';
  end if;
  for i in 1 .. 12 loop
    s := s + substr(_d12, i, 1)::int * case when i % 2 = 0 then 3 else 1 end;
  end loop;
  return (10 - s % 10) % 10;
end $fn$;
grant execute on function public.ean13_check_digit(text) to authenticated, service_role;

-- 1. La série EAN de chaque société (format G8), au-delà des EAN 3000… déjà présents.
insert into public.document_sequences (company_id, doc_type, prefix, separator, padding, next_value, reset_yearly, label)
select co.id, 'EAN', '3000', '', 8,
       greatest(1, coalesce((select max(substr(b.barcode, 5, 8)::bigint) + 1
                               from public.article_barcodes b join public.articles a on a.id = b.article_id
                              where a.company_id = co.id and b.barcode ~ '^3000\d{9}$'), 1)),
       false, 'Code-barres EAN interne des articles (3000 + 8 chiffres + clé, comme G8)'
  from public.companies co
on conflict (company_id, doc_type) do nothing;

create or replace function public.next_internal_ean(_company uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _raw text; _code text; _try int := 0;
begin
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  loop
    _try := _try + 1;
    _raw := public._next_document_number_unchecked(_company, 'EAN');
    if _raw !~ '^\d{12}$' then
      raise exception 'Série EAN mal réglée (« % ») : il faut 12 chiffres avant la clé (préfixe 3000, 8 chiffres, sans séparateur ni remise à zéro).', _raw
        using errcode = '22023', hint = 'ean_sequence_format';
    end if;
    _code := _raw || public.ean13_check_digit(_raw)::text;
    exit when not exists (select 1 from public.article_barcodes b join public.articles a on a.id = b.article_id
                           where a.company_id = _company and b.barcode = _code);
    if _try >= 50 then raise exception 'EAN interne : 50 codes de suite déjà pris, réglez le prochain numéro de la série EAN.'; end if;
  end loop;
  return _code;
end $fn$;
revoke all on function public.next_internal_ean(uuid) from public, anon;
grant execute on function public.next_internal_ean(uuid) to authenticated, service_role;

create or replace function public.article_assign_internal_ean(_article uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $fn$
declare a public.articles%rowtype; _code text;
begin
  select * into a from public.articles where id = _article for update;
  if a.id is null then raise exception 'Article introuvable' using errcode = 'P0002'; end if;
  if not public.is_member(a.company_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  -- « Si vide » : un code-barres existe déjà (saisi, fournisseur) → rien de créé.
  select b.barcode into _code from public.article_barcodes b where b.article_id = _article
   order by b.is_primary desc, b.created_at limit 1;
  if _code is not null then return _code; end if;
  -- Pas de code-barres pour une ligne de texte (F) ni la main-d'oeuvre (T).
  if a.mgmt_type::text in ('F', 'T') then return null; end if;
  _code := public.next_internal_ean(a.company_id);
  insert into public.article_barcodes (article_id, barcode, is_primary) values (_article, _code, true);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (a.company_id, auth.uid(), 'article_internal_ean', 'articles', _article::text,
          case when auth.uid() is null then 'system' else 'screen' end, null,
          jsonb_build_object('barcode', _code, 'reference', a.reference));
  return _code;
end $fn$;
revoke all on function public.article_assign_internal_ean(uuid) from public, anon;
grant execute on function public.article_assign_internal_ean(uuid) to authenticated, service_role;
comment on function public.article_assign_internal_ean(uuid) is
  'VP2 (20/11/2026, comme G8) : EAN interne 3000… + clé, créé à la création de l''article s''il n''a aucun code-barres.';
