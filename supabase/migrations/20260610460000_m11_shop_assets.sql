-- =====================================================================
-- M11 — Constructeur de site (suite) : bucket PUBLIC `shop-assets` pour les images
-- du site (logo, hero, galeries) servies sur la vitrine publique sans authentification.
-- Lecture publique automatique (bucket public) ; écriture réservée aux membres.
-- =====================================================================

insert into storage.buckets (id, name, public) values ('shop-assets', 'shop-assets', true)
on conflict (id) do update set public = true;

drop policy if exists shopassets_write on storage.objects;
create policy shopassets_write on storage.objects for insert to authenticated
  with check (bucket_id = 'shop-assets' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists shopassets_update on storage.objects;
create policy shopassets_update on storage.objects for update to authenticated
  using (bucket_id = 'shop-assets' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists shopassets_delete on storage.objects;
create policy shopassets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'shop-assets' and public.is_member(((storage.foldername(name))[1])::uuid));
