-- Correctif 19/11/2026 : filiation des documents de vente (BL regroupes dans une facture, avoir
-- refacture, acompte impute) - table document_sources (20261118160000).
-- La politique d'insertion comparait « s.id = source_document_id » dans une sous-requete sur
-- documents : la table documents ayant elle-meme une colonne source_document_id, la reference non
-- qualifiee visait documents.source_document_id et la condition etait toujours fausse. Toute
-- insertion depuis l'ecran etait refusee (« new row violates row-level security policy »).
-- Meme regle, colonnes qualifiees par le nom de la table. Idempotent.

drop policy if exists document_sources_insert on public.document_sources;
create policy document_sources_insert on public.document_sources for insert to authenticated
  with check (
    public.can_write_table(document_sources.company_id, 'documents')
    and exists (select 1 from public.documents d
                 where d.id = document_sources.document_id and d.company_id = document_sources.company_id)
    and exists (select 1 from public.documents s
                 where s.id = document_sources.source_document_id and s.company_id = document_sources.company_id)
  );
