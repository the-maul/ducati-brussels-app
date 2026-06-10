-- =====================================================================
-- M0 — Bootstrap du premier administrateur
-- À la création d'un profil, si l'e-mail correspond à l'admin de référence,
-- on lui attribue automatiquement le rôle admin sur TOUTES les sociétés.
-- Permet d'amorcer le système sans inscription ouverte : l'admin crée ensuite
-- les comptes du personnel depuis l'écran Paramètres > Utilisateurs.
-- =====================================================================

create or replace function public.grant_bootstrap_admin()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is not null and lower(new.email) = lower('simon@themaul.be') then
    insert into public.user_roles (user_id, company_id, role)
      select new.id, c.id, 'admin'::public.app_role from public.companies c
    on conflict do nothing;

    update public.profiles
      set default_company_id = (select id from public.companies order by code limit 1)
      where id = new.id and default_company_id is null;
  end if;
  return new;
end $$;

drop trigger if exists trg_bootstrap_admin on public.profiles;
create trigger trg_bootstrap_admin after insert on public.profiles
  for each row execute function public.grant_bootstrap_admin();

-- Si le profil admin existe déjà (créé avant ce trigger), on l'amorce aussi.
do $$
declare p record;
begin
  for p in select id, email from public.profiles where lower(email) = lower('simon@themaul.be') loop
    insert into public.user_roles (user_id, company_id, role)
      select p.id, c.id, 'admin'::public.app_role from public.companies c
    on conflict do nothing;
  end loop;
end $$;
