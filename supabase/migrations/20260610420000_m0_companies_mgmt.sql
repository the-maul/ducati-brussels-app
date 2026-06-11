-- =====================================================================
-- M0 — Gestion des sociétés (écran Paramètres → Sociétés). Création d'une société
-- avec tout le plumbing : rôle admin au créateur, copie des séquences de
-- numérotation et des référentiels (reference_values) depuis une société modèle.
-- Réservé aux administrateurs. company_id + RLS déjà en place sur `companies`.
-- =====================================================================

create or replace function public.create_company(
  _code text, _name text, _legal_name text default null, _vat text default null,
  _address text default null, _zip text default null, _city text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare _new uuid; _template uuid;
begin
  -- Autorisé seulement si l'utilisateur est admin d'au moins une société.
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Réservé aux administrateurs';
  end if;

  insert into public.companies (code, name, legal_name, vat_number, address, zip, city)
  values (_code, _name, coalesce(_legal_name, _name), _vat, _address, _zip, _city)
  returning id into _new;

  -- Rôle admin au créateur
  insert into public.user_roles (user_id, company_id, role) values (auth.uid(), _new, 'admin')
  on conflict do nothing;

  -- Société modèle = la plus ancienne (pour copier séquences + référentiels)
  select id into _template from public.companies where id <> _new order by created_at limit 1;
  if _template is not null then
    insert into public.document_sequences (company_id, doc_type, prefix, separator, padding, reset_yearly, suffix, label)
      select _new, doc_type, prefix, separator, padding, reset_yearly, suffix, label
      from public.document_sequences where company_id = _template
      on conflict (company_id, doc_type) do nothing;
    insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
      select _new, table_key, code, label, sort_order, is_active, extra
      from public.reference_values where company_id = _template
      on conflict (company_id, table_key, code) do nothing;
  end if;

  return _new;
end $$;
grant execute on function public.create_company(text, text, text, text, text, text, text) to authenticated;
