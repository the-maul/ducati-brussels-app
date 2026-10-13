-- M1 — Reprise G8 : les GSM rangés dans « téléphone », corrigés en une fois.
--
-- À la reprise de G8, des milliers de numéros de GSM ont atterri dans le champ
-- « téléphone fixe ». Conséquence concrète : aucun SMS ne peut partir vers ces
-- clients. Un écran permettait de les reprendre un par un ; ce n'est pas un
-- travail à faire à la main, c'est un défaut d'import à corriger.
--
-- Règle appliquée, identique à celle du bouton existant
-- (contact_use_phone_as_mobile) : fiche active, aucun mobile renseigné, et le
-- numéro de téléphone est reconnu comme un GSM belge par contact_be_gsm.
-- Le téléphone n'est PAS effacé : on ne fait que remplir le mobile manquant.
-- Chaque correction laisse une trace dans `events`, comme une correction
-- manuelle (B7 : rien ne change en silence).
do $$
declare _n int;
begin
  with cand as (
    select c.id, c.company_id, c.phone, public.contact_be_gsm(c.phone) as gsm
      from public.contacts c
     where c.is_active
       and nullif(btrim(coalesce(c.mobile, '')), '') is null
       and c.phone is not null
       and public.contact_be_gsm(c.phone) is not null
  ),
  upd as (
    update public.contacts c
       set mobile = cand.gsm
      from cand
     where c.id = cand.id
     returning c.id, c.company_id, cand.phone, cand.gsm
  )
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  select upd.company_id, null, 'phone_to_mobile', 'contacts', upd.id::text, 'import',
         jsonb_build_object('phone', upd.phone, 'mobile', null),
         jsonb_build_object('phone', upd.phone, 'mobile', upd.gsm)
    from upd;
  get diagnostics _n = row_count;
  raise notice 'GSM repris depuis le telephone : %', _n;
end $$;
