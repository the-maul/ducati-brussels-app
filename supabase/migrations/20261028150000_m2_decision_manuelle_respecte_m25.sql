-- M2 — La décision manuelle ne peut plus créer deux articles sur une même référence Ducati.
--
-- Constaté le 28/10/2026, en me trompant : article_links_decide a accepté 561 liens
-- vers des références du catalogue qui appartenaient déjà à un autre article, et le
-- nombre de références reliées à deux articles est passé de 91 à 578. Le rapprochement
-- automatique, lui, refuse ce cas (règle R4a) ; seule la décision manuelle ne le voyait pas.
-- L'écran Rapprochements aurait laissé n'importe qui faire la même chose en cliquant
-- « Accepter ».
--
-- Règle M-25 : une référence du catalogue Ducati = un article du DMS.
--
-- Exception conservée : la pièce d'occasion porte la même référence que la pièce neuve,
-- avec le suffixe OCC (12120471A et 12120471AOCC). Ce sont 91 paires aujourd'hui, et
-- c'est voulu : le catalogue décrit la même pièce, l'une est neuve, l'autre d'occasion.
create or replace function public._article_same_part_occasion(_a text, _b text)
returns boolean language sql immutable as $$
  select upper(regexp_replace(coalesce(_a, ''), '[^A-Za-z0-9]', '', 'g'))
       = upper(regexp_replace(regexp_replace(coalesce(_b, ''), 'OCC$', '', 'i'), '[^A-Za-z0-9]', '', 'g'))
      or upper(regexp_replace(regexp_replace(coalesce(_a, ''), 'OCC$', '', 'i'), '[^A-Za-z0-9]', '', 'g'))
       = upper(regexp_replace(coalesce(_b, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

comment on function public._article_same_part_occasion(text, text) is
  'Vrai si les deux références ne diffèrent que par le suffixe OCC (pièce neuve / pièce d''occasion).';

create or replace function public.article_links_decide(_company uuid, _ids uuid[], _decision text, _note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  other uuid;
  n_ok int := 0;
  skipped jsonb := '[]'::jsonb;
  old_shop public.shopify_links%rowtype;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if _decision not in ('lie', 'rejete') then
    raise exception 'Décision inconnue : %', _decision using errcode = '22023';
  end if;
  if coalesce(array_length(_ids, 1), 0) > 500 then
    raise exception 'Au plus 500 liens par envoi.' using errcode = '22023';
  end if;

  for r in
    select l.* from public.article_links l
     where l.company_id = _company and l.id = any (_ids)
     order by l.score desc
     for update
  loop
    if r.status = _decision then continue; end if;

    if _decision = 'lie' then
      -- l'article a déjà un lien « lié » de cette sorte
      select l2.id into other from public.article_links l2
       where l2.company_id = _company and l2.article_id = r.article_id and l2.target_kind = r.target_kind
         and l2.status = 'lie' and l2.id <> r.id limit 1;
      if other is not null then
        skipped := skipped || jsonb_build_object('id', r.id, 'reason', 'article_deja_relie');
        continue;
      end if;
      -- Regle M-25 : une reference du catalogue Ducati = un article. La cible ne peut pas
      -- etre deja portee par un autre article, sauf pour la paire neuf / occasion.
      if r.target_kind in ('ducati_part', 'ducati_product') then
        select l2.id into other from public.article_links l2
          join public.articles a2 on a2.id = l2.article_id
          join public.articles a1 on a1.id = r.article_id
         where l2.company_id = _company and l2.target_kind = r.target_kind and l2.target_ref = r.target_ref
           and l2.status = 'lie' and l2.article_id <> r.article_id
           and not public._article_same_part_occasion(a1.reference, a2.reference)
         limit 1;
        if other is not null then
          skipped := skipped || jsonb_build_object('id', r.id, 'reason', 'reference_deja_portee_par_un_autre_article');
          continue;
        end if;
      end if;

      if r.target_kind = 'shopify_variant' then
        if not exists (select 1 from public.shopify_products p where p.company_id = _company
                         and p.shopify_variant_id = r.target_ref and p.removed_at is null) then
          skipped := skipped || jsonb_build_object('id', r.id, 'reason', 'variante_absente');
          continue;
        end if;
        -- variante reliée à un autre article : seulement si cet article est remplacé (on passe à l'actuel)
        if exists (select 1 from public.article_links l2 join public.articles a2 on a2.id = l2.article_id
                    where l2.company_id = _company and l2.target_kind = 'shopify_variant' and l2.target_ref = r.target_ref
                      and l2.status = 'lie' and l2.article_id <> r.article_id and a2.superseded_by_id is null) then
          skipped := skipped || jsonb_build_object('id', r.id, 'reason', 'variante_deja_reliee');
          continue;
        end if;
      end if;

      if r.target_kind = 'shopify_variant' then
        -- la variante quitte l'article remplacé : son ancien lien est rejeté
        update public.article_links l2 set status = 'rejete', is_auto = false, decided_by = auth.uid(), decided_at = now(),
               decision_note = 'Article remplacé : relié à l''article actuel', updated_at = now()
         where l2.company_id = _company and l2.target_kind = 'shopify_variant' and l2.target_ref = r.target_ref
           and l2.status = 'lie' and l2.article_id <> r.article_id;
      end if;

      update public.article_links set status = 'lie', is_auto = false, decided_by = auth.uid(), decided_at = now(),
             decision_note = _note, updated_at = now()
       where id = r.id;

      if r.target_kind = 'shopify_variant' then
        select * into old_shop from public.shopify_links where company_id = _company and shopify_variant_id = r.target_ref;
        insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
        values (_company, r.target_ref, r.article_id, 'valide', null, auth.uid(), now())
        on conflict (company_id, shopify_variant_id) do update
          set article_id = excluded.article_id, status = 'valide', match_via = null,
              decided_by = excluded.decided_by, decided_at = now();
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, auth.uid(), 'shopify_link', 'shopify_links', r.target_ref, 'screen',
                case when old_shop.id is null then null else jsonb_build_object('status', old_shop.status, 'article_id', old_shop.article_id) end,
                jsonb_build_object('status', 'valide', 'article_id', r.article_id, 'via', 'rapprochement', 'method', r.method));
      end if;
    else
      update public.article_links set status = 'rejete', is_auto = false, decided_by = auth.uid(), decided_at = now(),
             decision_note = _note, updated_at = now()
       where id = r.id;
      -- un lien Shopify « relié » rejeté = variante déliée (elle ne sera plus reliée d'office)
      if r.target_kind = 'shopify_variant' and r.status = 'lie' then
        select * into old_shop from public.shopify_links where company_id = _company and shopify_variant_id = r.target_ref;
        if old_shop.id is not null and old_shop.article_id = r.article_id then
          update public.shopify_links set article_id = null, status = 'a_valider', match_via = null,
                 decided_by = auth.uid(), decided_at = now()
           where id = old_shop.id;
          insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
          values (_company, auth.uid(), 'shopify_unlink', 'shopify_links', r.target_ref, 'screen',
                  jsonb_build_object('status', old_shop.status, 'article_id', old_shop.article_id),
                  jsonb_build_object('status', 'a_valider', 'via', 'rapprochement'));
        end if;
      end if;
    end if;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), case when _decision = 'lie' then 'article_link_accept' else 'article_link_reject' end,
            'article_links', r.id::text, 'screen',
            jsonb_build_object('status', r.status, 'article_id', r.article_id, 'target_kind', r.target_kind,
                               'target_ref', r.target_ref, 'method', r.method, 'score', r.score),
            jsonb_build_object('status', _decision, 'note', _note));
    n_ok := n_ok + 1;
  end loop;
  return jsonb_build_object('done', n_ok, 'skipped', skipped);
end $$;

revoke all on function public.article_links_decide(uuid, uuid[], text, text) from public, anon;
grant execute on function public.article_links_decide(uuid, uuid[], text, text) to authenticated;
