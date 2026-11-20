-- =====================================================================
-- VP7 — Les cessions internes prennent le même compteur que les OR, comme G8 (décision du client,
-- 20/11/2026 : « tout comme G8 »). ATE089 B3
--
-- G8 : OR et cessions partagent un compteur (OR 5000012, cession 5000013, OR 5000014…). Le DMS
-- numérotait les cessions dans une série propre « ORO » (ORO-AAAA-NNNNN).
--
-- 1. _icession_before_write (corps de production, seule la série change) : une nouvelle cession
--    prend son n° dans la série « OR » de la société (OR-AAAA-NNNNN : le préfixe, le format et le
--    prochain numéro se règlent dans « Numérotation des documents », ligne « Ordre de réparation »).
--    Réglage par société cession_settings.counter (Paramètres → Tables) : OR (défaut) ou ORO pour
--    revenir à la série propre.
-- 2. Écran « Numérotation des documents » : libellés des séries OR et ORO mis à jour (la série
--    ORO n'est plus utilisée par les nouvelles cessions ; elle reste affichée, son compteur gardé).
--    Les cessions existantes gardent leur n° (ORO-2026-00001…) : rien n'est renuméroté.
--
-- Additive, rejouable. Essai à blanc : supabase/tests/vp7_cessions_compteur_or.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

-- Réglage par société (comme les autres réglages des cessions).
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select co.id, 'cession_settings', 'counter', 'OR', 60,
       jsonb_build_object('help', 'Compteur des cessions : OR = meme compteur que les ordres de reparation (comme G8), ORO = serie propre')
  from public.companies co
on conflict (company_id, table_key, code) do nothing;

CREATE OR REPLACE FUNCTION public._icession_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r record; _snap boolean; _fn boolean := coalesce(current_setting('dms.cession_fn', true), '') = '1';
begin
  if tg_op = 'INSERT' then _snap := true; else _snap := new.cession_type is distinct from old.cession_type; end if;
  if _snap then
    select rv.label, coalesce((rv.extra->>'accounted')::boolean, true) as acc,
           nullif(rv.extra->>'account', '') as acct, nullif(rv.extra->>'journal', '') as jr
      into r
      from public.reference_values rv
     where rv.company_id = new.company_id and rv.table_key = 'cession_type' and rv.code = new.cession_type
     limit 1;
    if r.label is null then raise exception 'Type de cession inconnu : %', new.cession_type; end if;
    new.type_label := r.label; new.accounted := r.acc; new.account := r.acct; new.journal := r.jr;
  end if;

  if tg_op = 'INSERT' then
    new.cost_basis := coalesce(new.cost_basis,
      case when lower(public._cession_setting(new.company_id, 'cost_basis', 'pamp')) = 'pa' then 'pa' else 'pamp' end);
    if new.number is null then
      -- VP7 (20/11/2026, comme G8) : même compteur que les OR (réglage cession_settings.counter, OR par défaut).
      new.number := public.next_document_number(new.company_id,
        case when upper(public._cession_setting(new.company_id, 'counter', 'OR')) = 'ORO' then 'ORO' else 'OR' end);
    end if;
    new.status := 'ouvert'; new.status_before_archive := null;
    new.total_cost := 0; new.total_pamp := 0; new.total_pa := 0; new.total_sale_ht := 0;
    new.cost_before := null; new.cost_after := null;
    new.validated_at := null; new.validated_by := null; new.archived_at := null; new.archived_by := null;
    new.archive_reason := null; new.cancelled_at := null;
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  if not _fn then
    if old.status <> 'ouvert' then
      raise exception 'La cession % est figée (%) : passer par ses actions.', old.number, old.status using errcode = '42501';
    end if;
    if new.status is distinct from old.status or new.number is distinct from old.number
       or new.company_id is distinct from old.company_id or new.cost_basis is distinct from old.cost_basis
       or new.total_cost is distinct from old.total_cost or new.validated_at is distinct from old.validated_at
       or new.archived_at is distinct from old.archived_at or new.cost_after is distinct from old.cost_after then
      raise exception 'Statut, numéro, valorisation et totaux d''une cession passent par ses actions.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $function$;

-- Libellés de l'écran « Numérotation des documents » (le libellé n'est qu'une explication).
update public.document_sequences set label = 'Ordre de réparation et cession interne (compteur commun, comme G8)'
 where doc_type = 'OR' and label = 'Ordre de réparation';
update public.document_sequences set label = 'Remise en état occasion (ancienne série des cessions, plus utilisée)'
 where doc_type = 'ORO' and label = 'Remise en état occasion';
