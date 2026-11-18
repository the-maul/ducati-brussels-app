-- =====================================================================
-- Rattrapage G8 (18/11/2026, lot parc) — « Reference a remplacer -> nouvelle reference ·
-- Modifier les forfaits » de G8 (02-articles.md, Nomenclatures) : remplacer une piece dans TOUS
-- les kits d'un coup.
-- Reutilise les kits existants (aucune nouvelle notion de kit) :
--   - kits d'entretien `maintenance_kit_items` (20260923161000) : version +1, instantane
--     `maintenance_kit_versions`, comme une modification a l'ecran ;
--   - forfaits / nomenclatures d'article `article_kit_items` (20260610120000).
-- Une ligne qui porte DEJA la nouvelle piece est fusionnee (quantites additionnees), jamais
-- doublee. _apply = false : apercu, rien n'est ecrit. Trace `events` (B7).
-- Les kits d'entretien archives ne sont pas touches (on ne reecrit pas l'historique).
-- A appliquer apres 20260923161000 (tables des kits) ; idempotente.
-- =====================================================================

create or replace function public.kits_replace_article(_company uuid, _old uuid, _new uuid, _apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.articles;
  n public.articles;
  r record;
  keep uuid;
  mk int := 0; mk_merged int := 0; fk int := 0; fk_merged int := 0;
  kits_touched uuid[] := '{}';
begin
  if auth.uid() is not null and not (public.is_admin(_company) or public.has_role(_company, 'chef_atelier')
                                     or public.has_role(_company, 'magasinier')) then
    raise exception 'Reserve a l''administrateur, au chef d''atelier et au magasinier.' using errcode = '42501';
  end if;
  select * into o from public.articles where id = _old and company_id = _company;
  select * into n from public.articles where id = _new and company_id = _company;
  if o.id is null or n.id is null then raise exception 'Reference introuvable.' using errcode = 'P0002'; end if;
  if o.id = n.id then raise exception 'La nouvelle reference est la meme que l''ancienne.' using errcode = '22023'; end if;

  -- 1. Kits d'entretien actifs
  if to_regclass('public.maintenance_kit_items') is not null then
    if n.mgmt_type::text not in ('A', 'M', 'N') and exists (
         select 1 from public.maintenance_kit_items i join public.maintenance_kits k on k.id = i.kit_id
          where k.company_id = _company and k.status = 'actif' and i.article_id = _old) then
      raise exception 'Seules les pieces et les composants de kit (types A, M, N) entrent dans un kit d''entretien (nouvelle reference : type %).', n.mgmt_type
        using errcode = '22023';
    end if;
    for r in
      select i.id, i.kit_id, i.quantity
        from public.maintenance_kit_items i join public.maintenance_kits k on k.id = i.kit_id
       where k.company_id = _company and k.status = 'actif' and i.article_id = _old
       order by i.kit_id
    loop
      mk := mk + 1;
      select x.id into keep from public.maintenance_kit_items x where x.kit_id = r.kit_id and x.article_id = _new limit 1;
      if keep is not null then mk_merged := mk_merged + 1; end if;
      if _apply then
        if keep is not null then
          update public.maintenance_kit_items set quantity = quantity + r.quantity where id = keep;
          delete from public.maintenance_kit_items where id = r.id;
        else
          update public.maintenance_kit_items
             set article_id = n.id, reference = n.reference, designation = coalesce(nullif(n.designation, ''), designation),
                 confidence = 'sur'
           where id = r.id;
        end if;
        if not (r.kit_id = any(kits_touched)) then
          kits_touched := kits_touched || r.kit_id;
          update public.maintenance_kits
             set version = version + 1, edited_at = now(), edited_by = auth.uid(), updated_at = now()
           where id = r.kit_id;
          perform public._maintenance_kit_snapshot(r.kit_id, 'remplacement ' || o.reference || ' -> ' || n.reference);
        end if;
      end if;
    end loop;
  end if;

  -- 2. Forfaits / nomenclatures d'article
  for r in
    select i.id, i.kit_id, i.quantity
      from public.article_kit_items i join public.articles p on p.id = i.kit_id
     where p.company_id = _company and i.component_id = _old
     order by i.kit_id
  loop
    fk := fk + 1;
    select x.id into keep from public.article_kit_items x where x.kit_id = r.kit_id and x.component_id = _new limit 1;
    if keep is not null then fk_merged := fk_merged + 1; end if;
    if _apply then
      if keep is not null then
        update public.article_kit_items set quantity = quantity + r.quantity where id = keep;
        delete from public.article_kit_items where id = r.id;
      else
        update public.article_kit_items set component_id = n.id where id = r.id;
      end if;
    end if;
  end loop;

  if _apply and (mk + fk) > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'kits_replace_article', 'articles', o.id::text, 'screen',
            jsonb_build_object('article_id', o.id, 'reference', o.reference),
            jsonb_build_object('article_id', n.id, 'reference', n.reference, 'kits_entretien', mk, 'fusionnes_entretien', mk_merged,
                               'forfaits', fk, 'fusionnes_forfaits', fk_merged));
  end if;

  return jsonb_build_object('applique', _apply, 'kits_entretien', mk, 'fusionnes_entretien', mk_merged,
                            'forfaits', fk, 'fusionnes_forfaits', fk_merged,
                            'ancienne', o.reference, 'nouvelle', n.reference);
end $$;
revoke all on function public.kits_replace_article(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.kits_replace_article(uuid, uuid, uuid, boolean) to authenticated;

comment on function public.kits_replace_article(uuid, uuid, uuid, boolean) is
  'Rattrapage G8 : remplace une piece dans tous les kits d''entretien actifs et tous les forfaits (fusion si deja presente). _apply=false : apercu.';
