-- =====================================================================
-- Mission 05 — carte 1 « Créer un proforma, une réservation, un bon de commande
-- ou une facture ».
--
--   1. Opérateur du document = utilisateur connecté, écrit par le serveur à la
--      création (colonne documents.operator_user_id + nom affiché dans
--      documents.operator, déjà imprimé). Les documents repris de G8
--      (imported_from renseigné) gardent leur texte `operator` d'origine.
--      L'identifiant de l'opérateur ne se modifie plus ensuite.
--   2. Nouveau type de document « Bon de commande » (doc_type = 'BC') :
--      séquence par société, préfixe BC-, gérable dans Paramètres → Numérotation.
--      La chaîne DEV → BC → RES/BL/FAC est portée par l'application
--      (src/modules/sales/write-api.ts, CONVERSIONS) ; un BC ne bouge pas le stock.
--   3. Libellé de la séquence DEV aligné sur l'écran : « Devis / proforma ».
--
-- Traçabilité : l'insertion d'un document est déjà tracée dans events par
-- trg_documents_audit (audit_row), opérateur compris.
-- Additif uniquement : 1 colonne, 1 index, 1 fonction, 1 trigger, 1 ligne de
-- séquence par société. Aucune suppression.
-- =====================================================================

-- 1. Colonne opérateur (utilisateur)
alter table public.documents
  add column if not exists operator_user_id uuid references auth.users(id) on delete set null;

comment on column public.documents.operator_user_id is
  'Utilisateur connecté qui a créé le document (écrit par trg_documents_operator). Le nom affiché est dans operator.';

create index if not exists idx_documents_operator_user on public.documents(operator_user_id);

-- 2. Opérateur écrit par le serveur (non falsifiable depuis le navigateur)
create or replace function public.documents_set_operator()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  nm  text;
begin
  if tg_op = 'UPDATE' then
    -- l'opérateur d'un document ne change pas après sa création
    new.operator_user_id := old.operator_user_id;
    return new;
  end if;

  -- documents repris (G8, imports) ou écrits sans utilisateur (tâches planifiées) :
  -- on garde le texte operator fourni
  if new.imported_from is not null or uid is null then
    return new;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''))
    into nm
    from public.profiles p
   where p.id = uid;

  new.operator_user_id := uid;
  new.operator := coalesce(nm, new.operator);
  return new;
end $$;

revoke all on function public.documents_set_operator() from public, anon, authenticated;

drop trigger if exists trg_documents_operator on public.documents;
create trigger trg_documents_operator before insert or update of operator_user_id on public.documents
  for each row execute function public.documents_set_operator();

-- 3. Séquence « Bon de commande » par société (préfixe BC-)
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, 'BC', 'BC', 'Bon de commande (commande ferme signée par le client)'
  from public.companies c
on conflict (company_id, doc_type) do nothing;

-- 4. Libellé de la séquence des devis (seulement s'il n'a pas été personnalisé)
update public.document_sequences
   set label = 'Devis / proforma'
 where doc_type = 'DEV'
   and label in ('DEV', 'Devis');
