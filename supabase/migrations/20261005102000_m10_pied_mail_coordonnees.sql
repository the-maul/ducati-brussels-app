-- =====================================================================
-- M10 — Pied de mail : coordonnées du magasin lues en base (retour client du 21/09,
-- carte « Invitation à rejoindre l'application sous chaque mail envoyé »).
--
-- Le client demande que l'invitation ajoutée à chaque e-mail dise que l'espace client
-- donne accès aux factures, au suivi des interventions atelier et au contact direct
-- avec l'équipe, et qu'elle porte l'adresse postale et le téléphone du magasin :
--   « Chaussée de Bruxelles 688, 1410 Waterloo / +32 2 385 32 82 | ducatibruxelles.be ».
--
-- Le texte est dans `supabase/functions/_shared/mail-message.ts` (footerHtml).
-- Les COORDONNÉES, elles, ne sont PAS écrites dans le code : le pied de mail lit les
-- colonnes `mail_signature_*` de la fiche société (décision M-51), déjà remplies le
-- 21/09 pour la signature. Les corriger ici suffit, rien à redéployer ensuite.
--
-- Cette migration ne fait qu'une correction de forme sur la ligne d'adresse :
-- « Chaussée De Bruxelles » → « Chaussée de Bruxelles » (le client écrit « de »).
-- Rien d'autre n'est touché ; aucune valeur n'est écrasée si elle a été modifiée
-- entre-temps (le WHERE porte sur la valeur exacte attendue).
-- =====================================================================

-- Rejouable : la deuxième exécution ne corrige rien et n'écrit aucune trace.
with corrige as (
  update public.companies c
     set mail_signature_address = replace(c.mail_signature_address, 'Chaussée De ', 'Chaussée de '),
         updated_at = now()
   where c.mail_signature_address like '%Chaussée De %'
  returning c.id, c.mail_signature_address as apres,
            replace(c.mail_signature_address, 'Chaussée de ', 'Chaussée De ') as avant
)
-- Trace (B7) : qui/quoi/quand, comme les autres écritures de la signature.
insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
select co.id, null, 'company_mail_signature_update', 'companies', co.id::text, 'system',
       jsonb_build_object('mail_signature_address', co.avant),
       jsonb_build_object('mail_signature_address', co.apres,
                          'reason', 'retour client 21/09 : casse de la ligne d''adresse')
  from corrige co;
