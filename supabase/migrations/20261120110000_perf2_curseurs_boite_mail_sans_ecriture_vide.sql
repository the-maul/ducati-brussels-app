-- =====================================================================
-- Perf 2 (20/11/2026) -- La releve Outlook n'ecrit plus rien quand rien n'a change.
--
-- Mesure (prod, 20/11) : la fonction Edge `outlook-poll` appelle `set_mailbox_cursors` toutes
-- les 5 minutes pour chaque boite ; quand aucun message n'est arrive, les deux curseurs sont
-- inchanges mais la ligne etait quand meme reecrite (updated_at = now()), et le declencheur
-- d'audit `trg_company_mailboxes_audit` ajoutait une ligne `events` (ligne complete avant/apres).
--   * 74 405 lignes `events` de ce type depuis le 14/09 (70 Mo), dont 7 898 la derniere semaine ;
--   * soit ~88 % des lignes `events` d'une semaine normale (8 060 sur ~9 100).
-- Apres : la ligne n'est mise a jour que si un curseur avance. Aucune information perdue :
-- les lignes evitees ne portaient aucun changement (seul updated_at differait). Quand un
-- curseur avance, l'audit continue de tracer ancien / nouveau comme avant (B7, regle 4).
-- Personne ne lit company_mailboxes.updated_at comme « derniere releve » (verifie : code et SQL).
-- Droits inchanges (create or replace conserve les GRANT : service_role seulement).
-- =====================================================================

create or replace function public.set_mailbox_cursors(_mailbox uuid, _in timestamptz, _sent timestamptz)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.company_mailboxes
     set inbound_last_check = coalesce(_in, inbound_last_check),
         sent_last_check    = coalesce(_sent, sent_last_check),
         updated_at         = now()
   where id = _mailbox
     and (coalesce(_in, inbound_last_check) is distinct from inbound_last_check
          or coalesce(_sent, sent_last_check) is distinct from sent_last_check);
$$;

comment on function public.set_mailbox_cursors(uuid, timestamptz, timestamptz) is
  'Avance les curseurs de releve d''une boite. N''ecrit rien (ni audit) si aucun curseur ne change (perf 2, 20/11/2026).';
