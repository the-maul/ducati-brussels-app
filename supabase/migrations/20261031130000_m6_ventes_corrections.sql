-- M6 — Audit du parcours de vente (31/10/2026, VEN001) : garde-fou EN BASE.
--
-- L'écran refuse désormais de valider un document sans client ou sans ligne (write-api.ts,
-- document-editor.tsx). Cette migration pose la même règle côté base pour que rien ne puisse
-- la contourner (autre écran, fonction, appel direct) :
--   * un document créé dans l'application (imported_from null) ne peut être « validée » ou
--     « payée » sans client, sauf un ticket de caisse (TIK, vente comptoir anonyme) ;
--   * un document validé doit avoir au moins une ligne (hors lignes vides).
-- Les documents repris de G8 (imported_from renseigné) ne sont pas concernés : ils portent
-- code_client_legacy et souvent aucune ligne.
--
-- NON APPLIQUÉE le 31/10/2026 (règle du lot : aucune migration en prod sans accord). Commande :
--   npx supabase@2.117.0 db push --linked --project-ref ujmrosbgkvgvwfnuryna
-- ou, pour ce seul fichier :
--   npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261031130000_m6_ventes_corrections.sql

create or replace function public.documents_require_client_and_lines()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare nb int;
begin
  -- Seules les écritures qui posent ou gardent un statut validé sont contrôlées.
  if new.status not in ('validee', 'payee') then return new; end if;
  if new.imported_from is not null then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('validee', 'payee') and new.contact_id is not distinct from old.contact_id then
    return new; -- déjà validé, client inchangé : rien à revérifier (règlement, conversion, annulation)
  end if;

  if new.contact_id is null and new.doc_type <> 'TIK' then
    raise exception 'Choisissez un client avant de valider ce % (un brouillon peut rester sans client).', new.doc_type
      using errcode = '23514';
  end if;

  select count(*) into nb from public.document_lines l where l.document_id = new.id and l.line_type <> 'vide';
  if nb = 0 then
    raise exception 'Aucune ligne sur ce % : ajoutez au moins une ligne avant de valider.', new.doc_type
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.documents_require_client_and_lines() from public, anon, authenticated;

-- Déclencheur sur UPDATE seulement : l'application pose l'en-tête en brouillon, puis les lignes,
-- puis passe le statut à « validée » (write-api.ts depuis le 31/10). Les fonctions SQL serveur
-- (_shopify_order_apply, finalize_web_order) insèrent l'en-tête déjà validé avec ses lignes dans
-- la même transaction : elles ne passent pas par cet UPDATE et ne sont pas touchées.
drop trigger if exists trg_documents_require_client_and_lines on public.documents;
create trigger trg_documents_require_client_and_lines
  before update of status, contact_id on public.documents
  for each row execute function public.documents_require_client_and_lines();

comment on function public.documents_require_client_and_lines() is
  'M6 VEN001 : un document validé créé dans le DMS a un client (sauf TIK) et au moins une ligne. Documents G8 exclus.';
