-- =====================================================================
-- Correctif (lot-verif-parcours, 20/11/2026) — libellé du mouvement de réajustement du stock réel
-- Parcours G8 n° 13 (Stock › Gestion du stock réel › Réajustement « annule et remplace »).
-- Quoi : stock_readjust écrivait « Réajustement annule remplace » (code du mode dont on remplaçait
--        juste les « _ ») dans la note du mouvement, lue dans l'historique des mouvements (colonne
--        Méthode de G8). Le libellé devient celui de G8 : « Réajustement annule et remplace »,
--        « Réajustement cumul », « Réajustement par casier / <casier> ».
-- Pourquoi : traçabilité lisible (B7) ; l'essai supabase/tests/parcours_g8_13_reajustement_stock.sql
--        contrôle le libellé.
-- Seule la note par défaut change : calcul, mouvement (record_stock_move, append-only), droits et
-- valeur de retour sont identiques à 20261118210000_m5_inventaire_guide.sql. Idempotente.
-- =====================================================================
create or replace function public.stock_readjust(_article uuid, _counted numeric, _mode text, _bin text default null::text, _ref text default null::text, _note text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare _a public.articles; _real numeric; _bin_q numeric; _multi boolean; _delta numeric; _b text := nullif(btrim(coalesce(_bin, '')), '');
begin
  if _mode not in ('annule_remplace', 'cumul', 'casier') then raise exception 'Mode inconnu : %', _mode; end if;
  if _counted is null then raise exception 'Quantité obligatoire'; end if;
  select * into _a from public.articles where id = _article;
  if _a.id is null or not public.can_write_table(_a.company_id, 'inventory_sessions') then raise exception 'Accès refusé'; end if;
  if not public._is_stocked_type(_a.mgmt_type::text) then raise exception 'Article non stocké (type %)', _a.mgmt_type; end if;
  if _mode = 'casier' and _b is null then raise exception 'Casier obligatoire en mode casier'; end if;
  perform pg_advisory_xact_lock(hashtext('stock:' || _article::text));
  select coalesce(sum(qty_delta), 0) into _real from public.stock_moves where article_id = _article and not is_reservation;
  if _mode = 'annule_remplace' then
    _delta := _counted - _real;
  elsif _mode = 'cumul' then
    _delta := _counted;
  else
    _multi := nullif(btrim(coalesce(_a.bin_location2, '')), '') is not null
           or (select count(*) from public.article_bins ab where ab.article_id = _article
                 and ab.bin_location is distinct from _a.bin_location) > 0;
    if _multi then
      select coalesce(sum(qty_delta), 0) into _bin_q from public.stock_moves
       where article_id = _article and not is_reservation and coalesce(bin_location, '') = _b;
      _delta := _counted - _bin_q;
    else
      _delta := _counted - _real;
    end if;
  end if;
  if _delta <> 0 then
    perform public.record_stock_move(_article, 'inventaire', _delta, null, false, _b, 'inventory', _ref,
      coalesce(nullif(btrim(coalesce(_note, '')), ''),
               case _mode when 'annule_remplace' then 'Réajustement annule et remplace'
                          when 'cumul' then 'Réajustement cumul'
                          else 'Réajustement par casier' end
               || coalesce(' / ' || _b, '')));
  end if;
  return jsonb_build_object('old', _real, 'new', _real + _delta, 'delta', _delta);
end $function$;

grant execute on function public.stock_readjust(uuid, numeric, text, text, text, text) to authenticated;
