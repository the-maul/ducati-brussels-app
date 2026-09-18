-- =====================================================================
-- Carte « Invitation à rejoindre l'application sous chaque mail envoyé » (P-5, P-6).
--
-- BESOIN (retour de Simon, 19/09) : un client qui a un compte (par exemple via
-- une inscription) ne sait pas forcément que l'application existe. Le pied de mail
-- doit donc aussi s'adresser aux comptes JAMAIS venus sur leur espace.
--
-- CE QUE FAIT CETTE MIGRATION (STRICTEMENT ADDITIVE)
--   1. Deux colonnes nullables sur `contact_accounts` :
--        first_portal_visit_at : première ouverture de /mon-espace (jamais modifiée ensuite) ;
--        last_portal_visit_at  : dernière ouverture (mise à jour au plus toutes les 5 minutes).
--   2. Une fonction `portal_touch()` appelée par /mon-espace à l'ouverture. Même
--      protection que les autres portal_* : SECURITY DEFINER, le compte est retrouvé
--      par auth.uid() (via _portal_ctx : un compte désactivé n'est pas compté),
--      revoke all from public, anon ; grant execute to authenticated.
--
-- Lecture : le personnel lit ces colonnes par la politique existante
-- contact_accounts_member_read (fiche client : « Espace client : … ») ; la fonction
-- graph-send-email les lit avec la clé de service pour choisir le pied de mail.
-- Aucune donnée existante n'est modifiée.
-- =====================================================================

alter table public.contact_accounts
  add column if not exists first_portal_visit_at timestamptz,
  add column if not exists last_portal_visit_at timestamptz;

comment on column public.contact_accounts.first_portal_visit_at is
  'Première ouverture de l''espace client (/mon-espace). Vide = jamais venu : le pied de mail l''invite à se connecter (P-5).';
comment on column public.contact_accounts.last_portal_visit_at is
  'Dernière ouverture de l''espace client (/mon-espace), mise à jour au plus toutes les 5 minutes.';

create or replace function public.portal_touch()
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare _ctx record;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then return; end if;  -- pas un compte client (ou désactivé) : rien à retenir
  update public.contact_accounts ca
     set first_portal_visit_at = coalesce(ca.first_portal_visit_at, now()),
         last_portal_visit_at  = now()
   where ca.user_id = auth.uid()
     and ca.contact_id = _ctx.contact_id
     and (ca.last_portal_visit_at is null or ca.last_portal_visit_at < now() - interval '5 minutes');
end $$;

revoke all on function public.portal_touch() from public, anon;
grant execute on function public.portal_touch() to authenticated;
