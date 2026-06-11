-- =====================================================================
-- FIX M6 — Séquences de numérotation manquantes (BL, RES, AVO) + auto-création
-- de secours dans next_document_number. Sans ça, valider une réservation/BL ou
-- générer un avoir lève « Séquence introuvable » (les préfixes par défaut de
-- CLAUDE.md §4.3 n'étaient pas tous seedés). Idempotent.
-- =====================================================================

-- Seed des séquences manquantes pour les 2 sociétés (préfixes par défaut).
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, d.doc_type, d.prefix, d.label
from public.companies c
cross join (values
  ('BL',  'BL',  'Bon de livraison'),
  ('RES', 'RES', 'Réservation / commande client'),
  ('AVO', 'AVO', 'Avoir')
) as d(doc_type, prefix, label)
on conflict (company_id, doc_type) do nothing;

-- Auto-création de secours : si une séquence n'existe pas pour un type donné, on
-- la crée (préfixe = type en MAJUSCULES) au lieu d'échouer. Évite cette classe de
-- bug pour tout futur type de document. Reste pilotable ensuite via l'écran M0.
create or replace function public.next_document_number(_company uuid, _doc_type text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seq public.document_sequences%rowtype;
  y   int := extract(year from now())::int;
  n   bigint;
  num text;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company;
  end if;

  select * into seq from public.document_sequences
    where company_id = _company and doc_type = _doc_type
    for update;
  if not found then
    insert into public.document_sequences (company_id, doc_type, prefix, label)
      values (_company, _doc_type, upper(_doc_type), _doc_type)
      on conflict (company_id, doc_type) do nothing;
    select * into seq from public.document_sequences
      where company_id = _company and doc_type = _doc_type
      for update;
  end if;

  if seq.reset_yearly and (seq.current_year is distinct from y) then
    n := 1;
    update public.document_sequences
      set next_value = 2, current_year = y, updated_at = now()
      where id = seq.id;
  else
    n := seq.next_value;
    update public.document_sequences
      set next_value = next_value + 1, current_year = coalesce(current_year, y), updated_at = now()
      where id = seq.id;
  end if;

  num := lpad(n::text, seq.padding, '0');
  if seq.reset_yearly then
    return seq.prefix || seq.separator || y::text || seq.separator || num || coalesce(seq.suffix, '');
  else
    return seq.prefix || seq.separator || num || coalesce(seq.suffix, '');
  end if;
end $$;
grant execute on function public.next_document_number(uuid, text) to authenticated;
