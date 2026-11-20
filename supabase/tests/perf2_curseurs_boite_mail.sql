-- =====================================================================
-- Perf 2 (20/11/2026) -- essai a blanc de 20261120110000_perf2_curseurs_boite_mail_sans_ecriture_vide.sql.
--   PRE_SQL=supabase/migrations/20261120110000_perf2_curseurs_boite_mail_sans_ecriture_vide.sql python rt.py perf2_curseurs_boite_mail.sql
-- Verifie : rien de change => aucune ecriture ni ligne events ; un curseur qui avance => la ligne
-- est mise a jour et l'audit trace ancien / nouveau comme avant ; droits inchanges.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

do $s$ declare mb record; ev0 bigint; ev1 bigint; up0 timestamptz; up1 timestamptz; t_in timestamptz; ok boolean; begin
  select * into mb from public.company_mailboxes order by created_at limit 1;
  if mb.id is null then
    insert into _t(check_name, result) values ('0 une boite existe', 'KO aucune boite');
    return;
  end if;
  select count(*) into ev0 from public.events where entity_type = 'company_mailboxes' and entity_id = mb.id::text;
  up0 := mb.updated_at;

  -- 1. aucun curseur ne bouge (null / memes valeurs)
  perform public.set_mailbox_cursors(mb.id, null, null);
  perform public.set_mailbox_cursors(mb.id, mb.inbound_last_check, mb.sent_last_check);
  select count(*) into ev1 from public.events where entity_type = 'company_mailboxes' and entity_id = mb.id::text;
  select updated_at into up1 from public.company_mailboxes where id = mb.id;
  insert into _t(check_name, result) values ('1 rien ne change : ni ecriture ni ligne events',
    case when ev1 = ev0 and up1 is not distinct from up0 then 'ok' else 'KO ' || (ev1 - ev0) end);

  -- 2. le curseur de reception avance
  t_in := coalesce(mb.inbound_last_check, now() - interval '1 day') + interval '1 minute';
  perform public.set_mailbox_cursors(mb.id, t_in, null);
  select count(*) into ev1 from public.events where entity_type = 'company_mailboxes' and entity_id = mb.id::text;
  select (inbound_last_check = t_in and sent_last_check is not distinct from mb.sent_last_check) into ok from public.company_mailboxes where id = mb.id;
  insert into _t(check_name, result) values ('2 curseur qui avance : mis a jour + 1 ligne events',
    case when ok and ev1 = ev0 + 1 then 'ok' else 'KO' end);
  insert into _t(check_name, result)
  select '3 audit : ancien / nouveau curseur traces',
    case when (e.old_data->>'inbound_last_check') is not distinct from (to_jsonb(mb)->>'inbound_last_check')
          and (e.new_data->>'inbound_last_check')::timestamptz = t_in then 'ok' else 'KO' end
    from public.events e where e.entity_type = 'company_mailboxes' and e.entity_id = mb.id::text
    order by e.id desc limit 1;
end $s$;

insert into _t(check_name, result)
select '4 droits inchanges (service_role oui, authenticated / anon non)',
  case when has_function_privilege('service_role', 'public.set_mailbox_cursors(uuid,timestamptz,timestamptz)', 'execute')
        and not has_function_privilege('authenticated', 'public.set_mailbox_cursors(uuid,timestamptz,timestamptz)', 'execute')
        and not has_function_privilege('anon', 'public.set_mailbox_cursors(uuid,timestamptz,timestamptz)', 'execute')
       then 'ok' else 'KO' end;
