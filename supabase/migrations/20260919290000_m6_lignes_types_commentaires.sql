-- =====================================================================
-- Mission 05 — carte 5 « Lignes de main d'œuvre, lignes vides et commentaires types ».
--
--   1. Type de ligne sur document_lines : article (défaut, toutes les lignes existantes),
--      main_oeuvre (article de type T, quantité décimale en heures), texte (commentaire
--      multi-lignes, sans montant), vide (ligne blanche de séparation, sans montant).
--      Contrôle en base : une ligne texte ou vide ne porte aucun montant.
--   2. Traçabilité des lignes (règle 4, B7) : toute insertion / modification / suppression
--      d'une ligne de document écrit dans events (entité = le document).
--      Jusqu'ici seul l'en-tête `documents` était audité.
--   3. Commentaires types par société (table document_comment_templates : nom court +
--      texte, actif, ordre), gérés dans Paramètres, rappelés dans un document puis
--      modifiables. Table livrée VIDE : l'équipe saisit ses commentaires (aucune donnée
--      réelle, aucun IBAN, pré-remplie ici).
--
-- Additif uniquement : 1 colonne, 2 contraintes, 1 table (RLS), 1 fonction, 3 triggers.
-- =====================================================================

-- 1. Type de ligne
alter table public.document_lines
  add column if not exists line_type text not null default 'article';

comment on column public.document_lines.line_type is
  'article | main_oeuvre (article de type T, heures décimales) | texte (commentaire, sans montant) | vide (ligne blanche, sans montant)';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'document_lines_line_type_chk') then
    alter table public.document_lines
      add constraint document_lines_line_type_chk
      check (line_type in ('article', 'main_oeuvre', 'texte', 'vide'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'document_lines_no_amount_chk') then
    alter table public.document_lines
      add constraint document_lines_no_amount_chk
      check (line_type not in ('texte', 'vide') or (coalesce(line_ht, 0) = 0 and coalesce(line_ttc, 0) = 0));
  end if;
end $$;

-- 2. Audit des lignes de document (entité = le document, company_id du document)
create or replace function public.audit_document_line()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  did uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  cid uuid;
begin
  select d.company_id into cid from public.documents d where d.id = did;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (cid, auth.uid(), 'line_' || lower(tg_op), 'documents', did::text, 'screen',
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

revoke all on function public.audit_document_line() from public, anon, authenticated;

drop trigger if exists trg_document_lines_audit on public.document_lines;
create trigger trg_document_lines_audit after insert or update or delete on public.document_lines
  for each row execute function public.audit_document_line();

-- 3. Commentaires types (par société)
create table if not exists public.document_comment_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  body        text not null,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint document_comment_templates_name_chk check (char_length(btrim(name)) between 1 and 60),
  constraint document_comment_templates_body_chk check (char_length(btrim(body)) between 1 and 4000),
  constraint document_comment_templates_name_key unique (company_id, name)
);

comment on table public.document_comment_templates is
  'Commentaires types rappelés dans un document de vente (mission 05, carte 5). Nom court + texte, par société.';

create index if not exists idx_doc_comment_templates_company
  on public.document_comment_templates(company_id, is_active, sort_order);

alter table public.document_comment_templates enable row level security;

drop policy if exists doc_comment_templates_select on public.document_comment_templates;
create policy doc_comment_templates_select on public.document_comment_templates
  for select to authenticated using (public.is_member(company_id));

drop policy if exists doc_comment_templates_insert on public.document_comment_templates;
create policy doc_comment_templates_insert on public.document_comment_templates
  for insert to authenticated with check (public.is_member(company_id));

drop policy if exists doc_comment_templates_update on public.document_comment_templates;
create policy doc_comment_templates_update on public.document_comment_templates
  for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Supprimer est réservé à l'administrateur ; les autres désactivent (is_active = false).
drop policy if exists doc_comment_templates_delete on public.document_comment_templates;
create policy doc_comment_templates_delete on public.document_comment_templates
  for delete to authenticated using (public.is_admin(company_id));

revoke all on table public.document_comment_templates from anon;
grant select, insert, update, delete on table public.document_comment_templates to authenticated;

drop trigger if exists trg_doc_comment_templates_updated on public.document_comment_templates;
create trigger trg_doc_comment_templates_updated before update on public.document_comment_templates
  for each row execute function public.set_updated_at();

drop trigger if exists trg_doc_comment_templates_audit on public.document_comment_templates;
create trigger trg_doc_comment_templates_audit after insert or update or delete on public.document_comment_templates
  for each row execute function public.audit_row();
