-- =====================================================================
-- VP3 — Référence de l'article d'occasion : « OCC » + 7 chiffres comme G8 (décision du client,
-- 20/11/2026 : « tout comme G8 »). B3 VEH004
--
-- G8 : l'occasion reprise reçoit la référence OCC1000000, OCC1000001… Le DMS donnait à l'article
-- occasion (O / P) créé à la validation de la reprise le n° du dossier de reprise (REP-AAAA-NNNNN).
-- La série « OCC » existait (OCC-AAAA-NNNNN, deux essais en 2026) mais aucun écran ne l'utilisait.
--
-- 1. Série OCC de chaque société mise au format G8 : préfixe OCC, sans séparateur, 7 chiffres,
--    jamais remise à zéro. Prochain numéro = après la plus grande référence OCC + 7 chiffres déjà
--    en base pour la société (reprise G8 : OCC1260034 chez ITALBIKE STORE → OCC1260035), au moins
--    OCC1000000. Les références existantes ne sont PAS renumérotées (OCC-2026-00001/2, REP-…,
--    OCC1741… gardent leur valeur). Changement tracé par le garde de la série (events
--    numbering_format_change / numbering_next_value_sql).
-- 2. public.next_occ_reference(company) : prochaine référence OCC libre (saute une référence déjà
--    prise par un article de la société). Appelée par l'écran à la validation de la reprise
--    (validate-api.ts validateReprise) pour l'article occasion ; la fiche moto reçoit la même
--    référence si elle n'en a pas. Le dossier de reprise garde son n° REP- (référence de reprise,
--    type R, glossaire).
--
-- Additive, rejouable. Essai à blanc : supabase/tests/vp3_reference_occ.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

-- 1. Série OCC au format G8 (une ligne par société ; créée si absente).
insert into public.document_sequences (company_id, doc_type, prefix, separator, padding, next_value, reset_yearly, label)
select co.id, 'OCC', 'OCC', '', 7, 1000000, false, 'Référence d''occasion (OCC + 7 chiffres, comme G8)'
  from public.companies co
on conflict (company_id, doc_type) do nothing;

update public.document_sequences s
   set prefix = 'OCC', separator = '', padding = 7, reset_yearly = false, suffix = null,
       label = 'Référence d''occasion (OCC + 7 chiffres, comme G8)',
       next_value = greatest(
         case when s.prefix = 'OCC' and s.separator = '' and s.padding = 7 and not s.reset_yearly then s.next_value else 0 end,
         1000000,
         coalesce((select max(substr(a.reference, 4)::bigint) + 1 from public.articles a
                    where a.company_id = s.company_id and a.reference ~ '^OCC\d{7}$'), 0))
 where s.doc_type = 'OCC'
   and (s.prefix is distinct from 'OCC' or s.separator is distinct from '' or s.padding <> 7 or s.reset_yearly
        or s.next_value < greatest(1000000, coalesce((select max(substr(a.reference, 4)::bigint) + 1 from public.articles a
                                                       where a.company_id = s.company_id and a.reference ~ '^OCC\d{7}$'), 0)));

-- 2. Prochaine référence OCC libre.
create or replace function public.next_occ_reference(_company uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $fn$
declare _ref text; _try int := 0;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  loop
    _try := _try + 1;
    _ref := public._next_document_number_unchecked(_company, 'OCC');
    exit when not exists (select 1 from public.articles a where a.company_id = _company and upper(a.reference) = upper(_ref));
    if _try >= 50 then
      raise exception 'Référence OCC : 50 références de suite déjà prises, réglez le prochain numéro de la série OCC.';
    end if;
  end loop;
  return _ref;
end $fn$;
revoke all on function public.next_occ_reference(uuid) from public, anon;
grant execute on function public.next_occ_reference(uuid) to authenticated, service_role;
comment on function public.next_occ_reference(uuid) is
  'VP3 (20/11/2026, comme G8) : référence de l''article occasion créé par la reprise, OCC + 7 chiffres.';
