-- =====================================================================
-- M8 / M1 — Decision du client Q48 (18/11/2026) : taux horaire atelier comme G8. ATE001 TAR001.
--
--   * taux STANDARD = 109,74 EUR HT (132,79 TTC), comme « MO ATELIER 1/2/3 » de la vraie base G8 ;
--   * taux VIP = 90,00 EUR HT (108,90 TTC) pour les clients VIP.
--
-- Source UNIQUE du taux standard (inchangee) : Parametres -> Tables -> Frais de devis atelier,
-- ligne DIAGNOSTIC, `extra.hourly_rate_ht` (repli : prix de l'article MO de type T, a 0). Lue par
-- l'OR (ligne MO sans prix), les forfaits / kits inseres, le check-up, les plans d'entretien.
--   1. BUG corrige : la ligne a ete saisie avec le code « DIAGNOSTIC » (majuscules) alors que la
--      lecture cherchait « diagnostic » : le taux saisi le 05/10 (90) n'etait JAMAIS lu (taux 0).
--      `maintenance_hourly_rate_ht` lit desormais le code sans tenir compte de la casse (meme
--      correction cote ecran : quote-fees.ts).
--   2. Le taux passe a 109,74 HT (seulement si la valeur est encore 90 ou vide : une autre valeur
--      saisie par le client n'est pas ecrasee) ; le forfait DIAGNOSTIC suit le taux horaire (frais =
--      taux x heures plafonnees, ce n'est pas un forfait fixe) : son `amount_ht` affiche est aligne.
--      Trace : audit_row de reference_values + events `workshop_hourly_rate_g8`.
--   3. Taux VIP = le MOTEUR DE TARIFS EXISTANT (tarifs communs, lot regles client) : un tarif client
--      « VIP » dont l'unique ligne fixe le prix NET de l'article MO a 90,00 HT. Un client a qui l'on
--      donne ce tarif (fiche client -> Tarif) paie la MO 90,00 HT sur ses OR (lignes MO saisies,
--      forfaits et kits inseres, check-up). Aucun second mecanisme de tarifs.
-- Additive, rejouable (aucune ligne doublee). Essai a blanc : supabase/tests/m8_taux_et_kit_rdv.sql.
-- =====================================================================

-- 1. Lecture du taux : code de la ligne sans tenir compte de la casse (meme signature, meme corps sinon).
create or replace function public.maintenance_hourly_rate_ht(_company uuid)
returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  select public._dc_num(rv.extra -> 'hourly_rate_ht') into v
    from public.reference_values rv
   where rv.company_id = _company and rv.table_key = 'workshop_quote_fee' and lower(btrim(rv.code)) = 'diagnostic'
     and coalesce(rv.is_active, true)
   order by rv.created_at
   limit 1;
  if v is null or v <= 0 then
    select a.sale_price_ht into v from public.articles a
     where a.company_id = _company and a.reference = 'MO' and a.mgmt_type = 'T'
     order by a.created_at limit 1;
  end if;
  return case when v is null or v <= 0 then null else v end;
end $$;
revoke all on function public.maintenance_hourly_rate_ht(uuid) from public, anon;
grant execute on function public.maintenance_hourly_rate_ht(uuid) to authenticated;

-- 2. Taux standard 109,74 HT (G8 « MO ATELIER 1/2/3 »).
do $$
declare r record; _new jsonb;
begin
  for r in
    select v.* from public.reference_values v
     where v.table_key = 'workshop_quote_fee' and lower(btrim(v.code)) = 'diagnostic'
       and coalesce(nullif(v.extra ->> 'hourly_rate_ht', '')::numeric, 0) in (0, 90)
  loop
    _new := coalesce(r.extra, '{}'::jsonb) || jsonb_build_object('hourly_rate_ht', 109.74, 'amount_ht', 109.74,
              'source', 'G8 vraie base : MO ATELIER 1/2/3 (decision Q48 du 18/11/2026)');
    update public.reference_values set extra = _new where id = r.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, null, 'workshop_hourly_rate_g8', 'reference_values', r.id::text, 'migration',
            jsonb_build_object('hourly_rate_ht', r.extra -> 'hourly_rate_ht', 'amount_ht', r.extra -> 'amount_ht'),
            jsonb_build_object('hourly_rate_ht', 109.74, 'amount_ht', 109.74));
  end loop;
end $$;

-- 3. Tarif client « VIP » : prix net de la MO 90,00 HT (moteur de tarifs existant).
do $$
declare c record; _list uuid;
begin
  for c in
    select a.company_id, (array_agg(a.id order by a.created_at))[1] as mo_id
      from public.articles a where a.reference = 'MO' and a.mgmt_type = 'T' group by a.company_id
  loop
    select id into _list from public.price_lists where company_id = c.company_id and lower(btrim(code)) = 'vip';
    if _list is null then
      insert into public.price_lists (company_id, code, label, show_discount, is_active)
      values (c.company_id, 'VIP', 'VIP (main d''oeuvre 90,00 HT)', false, true) returning id into _list;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
      values (c.company_id, null, 'price_list_vip_g8', 'price_lists', _list::text, 'migration',
              jsonb_build_object('code', 'VIP', 'mo_net_ht', 90.00, 'source', 'decision Q48 du 18/11/2026'));
    end if;
    if not exists (select 1 from public.price_list_rules where price_list_id = _list and article_id = c.mo_id) then
      insert into public.price_list_rules (company_id, price_list_id, scope, article_id, kind, tiers, note)
      values (c.company_id, _list, 'reference', c.mo_id, 'net', '[{"min_qty": 1, "value": 90.00}]'::jsonb,
              'Decision Q48 (18/11/2026) : taux horaire VIP 90,00 HT (108,90 TTC) ; le taux standard est 109,74 HT.');
    end if;
  end loop;
end $$;
