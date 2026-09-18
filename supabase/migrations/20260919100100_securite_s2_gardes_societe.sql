-- LOT SÉCURITÉ S2 — Contrôle de société dans les fonctions qui n'en avaient pas.
-- Réf. docs/bible/securite-lot-S.md §S2.
--
-- Constat (test du 19/09 en transaction annulée, utilisateur connecté SANS rôle) : ces
-- fonctions renvoyaient les données de n'importe quelle société à qui connaissait l'UUID :
--   contact_encours (plafond de crédit et impayés d'un client), article_stock,
--   or_worked_minutes, resolve_customer_price (conditions tarifaires), default_assignee ;
-- et transfer_stock_on_replace n'était protégée qu'indirectement (par record_stock_move).
--
-- Garde maison : (auth.uid() is null or public.is_member(<société>)).
--   - auth.uid() nul = appel par la clé de service, par pg_cron ou par une autre fonction
--     serveur. Depuis S1, anon ne peut plus appeler ces fonctions : cette branche n'est donc
--     plus atteignable depuis le navigateur.
--   - Sinon l'appelant doit être membre (actif, depuis S3) de la société concernée.
--
-- Comportement pour un non-membre : lecture → aucune ligne / zéro / null (comme une ligne
-- filtrée par la RLS) ; écriture → exception « Accès refusé ».
--
-- NON APPLIQUÉE. Suppose S1 appliquée avant (droits par défaut des nouvelles fonctions).

-- 1. Encours client (M06/M12) : aucune ligne si la fiche n'est pas de la société de l'appelant.
--    Le front (src/modules/sales/api.ts) traite déjà « pas de ligne » comme des zéros.
create or replace function public.contact_encours(_contact uuid)
returns table(authorized numeric, current_due numeric, available numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select x.authorized, x.current_due, x.authorized - x.current_due
    from (
      select coalesce(c.credit_limit, 0) as authorized,
             coalesce((select sum(d.total_ttc - d.paid_amount)
                         from public.documents d
                        where d.contact_id = _contact and d.doc_type = 'FAC' and d.status <> 'annulee'
                          and d.total_ttc - d.paid_amount > 0), 0) as current_due
        from public.contacts c
       where c.id = _contact
         and (auth.uid() is null or public.is_member(c.company_id))
    ) x;
$$;

-- 2. Stock d'un article : zéros pour un article d'une autre société.
--    Appelée aussi par record_stock_move, record_inventory_count, enqueue_label,
--    transfer_stock_on_replace : ces fonctions vérifient déjà la société, le résultat
--    pour un membre est inchangé.
create or replace function public.article_stock(_article uuid)
returns table(real_qty numeric, reserved_qty numeric, available_qty numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(sum(case when not is_reservation then qty_delta else 0 end), 0) as real_qty,
    coalesce(sum(case when is_reservation then qty_delta else 0 end), 0) as reserved_qty,
    coalesce(sum(case when not is_reservation then qty_delta else 0 end), 0)
      - coalesce(sum(case when is_reservation then qty_delta else 0 end), 0) as available_qty
  from public.stock_moves
  where article_id = _article
    and (auth.uid() is null
         or exists (select 1 from public.articles a
                     where a.id = _article and public.is_member(a.company_id)));
$$;

-- 3. Minutes travaillées sur un OR : 0 pour un OR d'une autre société.
create or replace function public.or_worked_minutes(_or uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(minutes), 0) from public.workshop_time_entries
   where or_id = _or and kind = 'travail' and minutes is not null
     and (auth.uid() is null
          or exists (select 1 from public.repair_orders ro
                      where ro.id = _or and public.is_member(ro.company_id)));
$$;

-- 4. Responsable par défaut des demandes CRM : null pour une autre société.
--    Appelée aussi par create_prospect_from_email (clé de service : auth.uid() nul) et
--    set_default_assignee (admin de la société) : inchangé pour eux.
create or replace function public.default_assignee(_company uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select nullif(rv.extra->>'user_id', '')::uuid
       from public.reference_values rv
      where rv.company_id = _company and rv.table_key = 'lead_task'
        and rv.code = 'default_assignee' and rv.is_active),
    (select ur.user_id from public.user_roles ur
      where ur.company_id = _company and ur.role = 'admin'
      order by ur.created_at limit 1)
  )
  where auth.uid() is null or public.is_member(_company);
$$;

-- 5. Remplacement de référence : les deux articles doivent être de la même société, et
--    l'appelant doit en être membre. Article inconnu : rien à faire (comme avant).
create or replace function public.transfer_stock_on_replace(_from uuid, _to uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _real numeric; _pamp numeric; _co_from uuid; _co_to uuid;
begin
  select company_id into _co_from from public.articles where id = _from;
  select company_id into _co_to from public.articles where id = _to;
  if _co_from is null or _co_to is null then return; end if;
  if _co_from <> _co_to then
    raise exception 'Les deux articles doivent appartenir à la même société';
  end if;
  if auth.uid() is not null and not public.is_member(_co_from) then
    raise exception 'Accès refusé';
  end if;

  select real_qty into _real from public.article_stock(_from);
  select pamp into _pamp from public.articles where id = _from;
  if _real is null or _real = 0 then return; end if;
  -- sortie de l'ancienne, entrée valorisée dans la nouvelle (recalcule le PAMP cible)
  perform public.record_stock_move(_from, 'transfert', -_real, null, false, null, 'replacement', _to::text, 'Remplacement de référence');
  perform public.record_stock_move(_to,   'transfert',  _real, _pamp, false, null, 'replacement', _from::text, 'Remplacement de référence');
end $$;

-- 6. Prix client (conditions tarifaires) : la fonction d'origine est conservée telle quelle
--    sous un nom interne, et une enveloppe vérifie la société. On évite ainsi de recopier
--    60 lignes de calcul (risque d'erreur de recopie).
alter function public.resolve_customer_price(uuid, uuid, uuid, numeric)
  rename to _resolve_customer_price_unchecked;
revoke execute on function public._resolve_customer_price_unchecked(uuid, uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public._resolve_customer_price_unchecked(uuid, uuid, uuid, numeric)
  to service_role;

create function public.resolve_customer_price(_company uuid, _contact uuid, _article uuid, _qty numeric default 1)
returns table(unit_price_ht numeric, unit_price_ttc numeric, rule_kind text, discount_pct numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'Accès refusé';
  end if;
  return query select * from public._resolve_customer_price_unchecked(_company, _contact, _article, _qty);
end $$;
revoke execute on function public.resolve_customer_price(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.resolve_customer_price(uuid, uuid, uuid, numeric) to authenticated, service_role;

-- Les CREATE OR REPLACE ci-dessus conservent les droits posés par S1 (anon exclu).

-- Recharger le cache de PostgREST (resolve_customer_price recréée).
notify pgrst, 'reload schema';
