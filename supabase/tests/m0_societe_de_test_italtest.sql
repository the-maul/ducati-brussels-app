-- =====================================================================
-- M0 COM005 (19/11/2026) — essai a blanc de 20261119160000_m0_societe_de_test_italtest.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119160000_m0_societe_de_test_italtest.sql \
--      supabase/tests/m0_societe_de_test_italtest.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Duree : ~60 s (copie complete d ITALBIKE STORE en un appel). Le rafraichissement est essaye
-- dans m0_societe_de_test_rafraichir.sql (source reduite) et m0_societe_de_test_etapes_8s.sql
-- (duree des appels de l ecran sur les vraies donnees) : la passerelle de l API coupe a ~100 s.
-- Controle :
--   A. copie complete : pour chaque table copiee, meme nombre de lignes que la source ;
--   B. recablage : aucune ligne d ItalTest ne pointe vers une autre societe ni vers une ligne absente ;
--      fournisseur d article, detenteur de moto, articles des versions de kits retrouves ;
--   C. aucun envoi possible : contacts neutralises, notifications « skipped », reglements d envoi
--      forces a l arret, Stripe et boites Outlook refuses, numerotations TEST remises a 1 ;
--   D. refus : societe non marquee test, utilisateur non administrateur, marquage immuable ;
--   E. stock d ItalTest = stock d ITALBIKE (echantillon de 300 articles + totaux) ;
--   F. ITALBIKE STORE n a pas bouge.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
-- L essai cree SA societe de test (« ItalTest essai ») : il ne depend pas de l ItalTest reelle
-- (qui existe en production depuis le 19/11 : la reprendre serait un rafraichissement, purge
-- comprise, trop long pour un seul appel de l API).
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _ctx to authenticated;

-- ------------------------------------------------ photo d ITALBIKE STORE avant tout
insert into _ctx
select 'src_before', (select count(*) from public.articles where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text || '/'
                  || (select count(*) from public.contacts where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text || '/'
                  || (select count(*) from public.vehicles where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text || '/'
                  || (select count(*) from public.stock_moves where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text || '/'
                  || (select coalesce(sum(qty_delta), 0) from public.stock_moves where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text || '/'
                  || (select coalesce(sum(next_value), 0) from public.document_sequences where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text || '/'
                  || (select count(*) from public.documents where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33')::text;

-- ------------------------------------------------ copie complete (chemin SQL, tout d un coup)
do $s$
declare _src uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _r jsonb; _t0 timestamptz := clock_timestamp();
begin
  _r := public.admin_clone_company_for_test(_src, 'ItalTest essai');
  insert into _ctx values ('tgt', _r ->> 'company_id'), ('clone_s', round(extract(epoch from clock_timestamp() - _t0))::text);
  insert into _t(check_name, result) values
    ('copie complete en un appel (' || round(extract(epoch from clock_timestamp() - _t0)) || ' s) : statut pret',
     case when _r ->> 'status' = 'pret' then 'ok' else 'KO ' || left(_r::text, 400) end);
end $s$;

-- ------------------------------------------------ A. copie complete, table par table
do $s$
declare
  _src uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _tgt uuid := (select v::uuid from _ctx where k = 'tgt');
  r record; _a bigint; _b bigint; _bad text := ''; _ntab int := 0; _filter text;
begin
  for r in select * from public._tc_spec() x where to_regclass('public.' || quote_ident(x.tbl)) is not null order by x.ord loop
    if r.parent_tbl is null then
      _filter := 's.company_id = $1';
    else
      _filter := format('exists (select 1 from public.%I p where p.id = s.%I and p.company_id = $1)', r.parent_tbl, r.parent_col);
    end if;
    if r.extra is not null then _filter := _filter || ' and (' || r.extra || ')'; end if;
    execute format('select count(*) from public.%I s where %s', r.tbl, _filter) into _a using _src;
    execute format('select count(*) from public.%I s where %s', r.tbl, _filter) into _b using _tgt;
    _ntab := _ntab + 1;
    if _a <> _b then _bad := _bad || format('%s %s/%s ; ', r.tbl, _a, _b); end if;
  end loop;
  insert into _t(check_name, result) values
    ('A1 ' || _ntab || ' tables copiees : meme nombre de lignes que la source', case when _bad = '' then 'ok' else 'KO ' || left(_bad, 600) end),
    ('A2 articles copies (>= 90 000)', case when (select count(*) from public.articles where company_id = _tgt) >= 90000 then 'ok'
                                         else 'KO ' || (select count(*) from public.articles where company_id = _tgt) end),
    ('A3 aucun historique copie (documents, caisses, events hors trace, reglements, OR)',
     case when not exists (select 1 from public.documents where company_id = _tgt)
           and not exists (select 1 from public.cash_sessions where company_id = _tgt)
           and not exists (select 1 from public.repair_orders where company_id = _tgt)
           and not exists (select 1 from public.price_changes where company_id = _tgt)
           and not exists (select 1 from public.communications where company_id = _tgt)
           and (select count(*) from public.events where company_id = _tgt) = 1
           and not exists (select 1 from public.stock_moves where company_id = _tgt and origin is distinct from 'ouverture_societe_test')
          then 'ok' else 'KO' end),
    ('A4 caisse fermee : aucune session de caisse ouverte', case when not exists (select 1 from public.cash_sessions where company_id = _tgt and status = 'open') then 'ok' else 'KO' end),
    ('A5 inventaire : aucune table « a classer »',
     case when not exists (select 1 from public.admin_test_company_inventory() where decision = 'a classer') then 'ok'
          else 'KO ' || (select string_agg(tbl, ', ') from public.admin_test_company_inventory() where decision = 'a classer') end),
    ('A6 societe marquee test, la source non', case when public.is_test_company(_tgt) and not public.is_test_company(_src) then 'ok' else 'KO' end),
    ('A7 les administrateurs de la source sont admin d ItalTest (aucun compte cree)',
     case when (select count(*) from public.user_roles where company_id = _tgt and role = 'admin'
                  and user_id in (select user_id from public.user_roles where company_id = _src and role = 'admin'))
             = (select count(distinct user_id) from public.user_roles where company_id = _src and role = 'admin')
           and (select count(*) from public.user_roles where company_id = _tgt) = (select count(distinct user_id) from public.user_roles where company_id = _src and role = 'admin')
          then 'ok' else 'KO' end),
    ('A8 fiche societe : nom de la societe de test, sans boite mail, sans Peppol, sans comptable',
     case when exists (select 1 from public.companies where id = _tgt and name = 'ItalTest essai' and inbound_mailbox is null
                         and peppol_id is null and accountant_email is null and sepa_creditor_id is null) then 'ok' else 'KO' end);
end $s$;

-- ------------------------------------------------ B. recablage des liens
do $s$
declare
  _tgt uuid := (select v::uuid from _ctx where k = 'tgt');
  r record; _n bigint; _bad text := ''; _nfk int := 0; _scope text;
begin
  for r in
    select x.tbl, x.parent_col, x.parent_tbl, a.attname::text as col, k.confrelid::regclass::text as p, af.attname::text as pcol,
           exists (select 1 from pg_attribute z where z.attrelid = k.confrelid and z.attname = 'company_id' and not z.attisdropped) as p_company
      from public._tc_spec() x
      join pg_constraint k on k.conrelid = to_regclass('public.' || quote_ident(x.tbl)) and k.contype = 'f' and array_length(k.conkey, 1) = 1
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
     where a.attname <> 'company_id' and (select relnamespace from pg_class where oid = k.confrelid) = 'public'::regnamespace
  loop
    _scope := case when r.parent_tbl is null then 'a.company_id = $1'
                   else format('exists (select 1 from public.%I pp where pp.id = a.%I and pp.company_id = $1)', r.parent_tbl, r.parent_col) end;
    _nfk := _nfk + 1;
    -- lien pendant (le mode replica ne controle pas les cles)
    execute format('select count(*) from public.%I a where %s and a.%I is not null and not exists (select 1 from %s b where b.%I = a.%I)',
                   r.tbl, _scope, r.col, r.p, r.pcol, r.col) into _n using _tgt;
    if _n > 0 then _bad := _bad || format('%s.%s pendant x%s ; ', r.tbl, r.col, _n); end if;
    if r.p_company then
      execute format('select count(*) from public.%I a join %s b on b.%I = a.%I where %s and b.company_id is distinct from $1',
                     r.tbl, r.p, r.pcol, r.col, _scope) into _n using _tgt;
      if _n > 0 then _bad := _bad || format('%s.%s vers une autre societe x%s ; ', r.tbl, r.col, _n); end if;
    end if;
  end loop;
  insert into _t(check_name, result) values
    ('B1 ' || _nfk || ' liens controles : aucun lien pendant, aucun lien vers une autre societe', case when _bad = '' then 'ok' else 'KO ' || left(_bad, 600) end);

  insert into _t(check_name, result) values
    ('B2 fournisseur principal des articles : la copie du meme fournisseur',
     case when not exists (
       select 1 from public.test_company_id_map m
         join public.articles s on s.id = m.old_id
         join public.articles t on t.id = m.new_id
         left join public.contacts cs on cs.id = s.main_supplier_id
         left join public.contacts ct on ct.id = t.main_supplier_id
        where m.target_company_id = _tgt and m.tbl = 'articles'
          and ((cs.id is null) <> (ct.id is null) or coalesce(cs.code, '') <> coalesce(ct.code, '') or coalesce(cs.last_name, '') <> coalesce(ct.last_name, '')))
     then 'ok' else 'KO' end),
    ('B3 detenteur et article de chaque moto : les copies correspondantes',
     case when not exists (
       select 1 from public.test_company_id_map m
         join public.vehicles s on s.id = m.old_id
         join public.vehicles t on t.id = m.new_id
        where m.target_company_id = _tgt and m.tbl = 'vehicles'
          and (t.vin is distinct from s.vin
               or t.holder_contact_id is distinct from public._tc_map(_tgt, s.holder_contact_id)
               or t.article_id is distinct from public._tc_map(_tgt, s.article_id)))
     then 'ok' else 'KO' end),
    ('B4 versions de kits : chaque article cite est un article d ItalTest',
     case when not exists (
       select 1 from public.maintenance_kit_versions v, jsonb_array_elements(case when jsonb_typeof(v.items) = 'array' then v.items else '[]'::jsonb end) e
        where v.company_id = _tgt and jsonb_typeof(e) = 'object' and nullif(e ->> 'article_id', '') is not null
          and not exists (select 1 from public.articles a where a.id = (e ->> 'article_id')::uuid and a.company_id = _tgt))
     then 'ok' else 'KO' end),
    ('B5 nouveaux identifiants : aucun id source reutilise',
     case when not exists (select 1 from public.articles a where a.company_id = _tgt and exists (select 1 from public.test_company_id_map m where m.target_company_id = _tgt and m.old_id = a.id))
     then 'ok' else 'KO' end);
end $s$;

-- ------------------------------------------------ C. aucun envoi possible
do $s$
declare
  _src uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _tgt uuid := (select v::uuid from _ctx where k = 'tgt');
  _id bigint; _st text; _st2 text; _err text; _p jsonb;
begin
  insert into _t(check_name, result) values
    ('C1 contacts : tout e-mail present est test+<id>@invalid.local',
     case when not exists (select 1 from public.contacts where company_id = _tgt and (
                (email is not null and email not like 'test+%@invalid.local')
             or (email_pro is not null and email_pro not like 'test+%@invalid.local')
             or (my_ducati_email is not null and my_ducati_email not like 'test+%@invalid.local')))
           and (select count(*) from public.contacts where company_id = _tgt and email like 'test+%@invalid.local')
             = (select count(*) from public.contacts where company_id = _src and nullif(btrim(email), '') is not null)
          then 'ok' else 'KO' end),
    ('C2 contacts : tout telephone present est un numero +00 (non attribuable)',
     case when not exists (select 1 from public.contacts where company_id = _tgt and (
                (phone is not null and phone not like '+00%') or (mobile is not null and mobile not like '+00%')
             or (gsm is not null and gsm not like '+00%') or (phone_pro is not null and phone_pro not like '+00%')
             or (mobile_pro is not null and mobile_pro not like '+00%') or (fax is not null and fax not like '+00%')
             or (my_ducati_phone is not null and my_ducati_phone not like '+00%')))
          then 'ok' else 'KO' end),
    ('C3 aucune adresse ni aucun numero reel ne subsiste (contacts, interlocuteurs, marchands, assureurs)',
     case when not exists (select lower(email) from public.contacts where company_id = _tgt and email is not null
                           intersect select lower(email) from public.contacts where company_id = _src and email is not null)
           and not exists (select mobile from public.contacts where company_id = _tgt and mobile is not null
                           intersect select mobile from public.contacts where company_id = _src and nullif(mobile, '') is not null)
           and not exists (select 1 from public.contact_subcontacts x join public.contacts c on c.id = x.contact_id
                            where c.company_id = _tgt and ((x.email is not null and x.email not like 'test+%') or (x.phone is not null and x.phone not like '+00%')))
           and not exists (select 1 from public.tradein_partners where company_id = _tgt and ((email is not null and email not like 'test+%')
                            or (phone is not null and phone not like '+00%') or coalesce(jsonb_array_length(case when jsonb_typeof(extra_contacts) = 'array' then extra_contacts end), 0) > 0))
           and not exists (select 1 from public.insurance_parties where company_id = _tgt and ((email is not null and email not like 'test+%') or (phone is not null and phone not like '+00%')))
           and not exists (select 1 from public.contacts where company_id = _tgt and (my_ducati_data is not null or license_scan_path is not null or national_id_scan_path is not null))
          then 'ok' else 'KO' end),
    ('C4 contacts copies : tous en opposition marketing', case when not exists (select 1 from public.contacts where company_id = _tgt and not coalesce(marketing_opt_out, false)) then 'ok' else 'KO' end),
    ('C5 numerotations : prefixe TEST, compteur remis a 1',
     case when not exists (select 1 from public.document_sequences where company_id = _tgt and (prefix not like 'TEST%' or next_value <> 1))
           and (select count(*) from public.document_sequences where company_id = _tgt) = (select count(*) from public.document_sequences where company_id = _src)
          then 'ok' else 'KO' end),
    ('C6 aucune donnee Shopify, Stripe, boite mail, compte client, mandat SEPA, piece GED',
     case when not exists (select 1 from public.shopify_links where company_id = _tgt) and not exists (select 1 from public.shopify_products where company_id = _tgt)
           and not exists (select 1 from public.article_links where company_id = _tgt and target_kind = 'shopify_variant')
           and not exists (select 1 from public.company_mailboxes where company_id = _tgt) and not exists (select 1 from public.contact_accounts where company_id = _tgt)
           and not exists (select 1 from public.sepa_mandates where company_id = _tgt) and not exists (select 1 from public.attachments where company_id = _tgt)
          then 'ok' else 'KO' end);

  -- file des notifications (rappels RDV, relances factures, SMS)
  _id := public.enqueue_notification(_tgt, 'email', 'client.reel@example.com', 'Rappel', 'corps', null, null, null);
  select status into _st from public.notifications where id = _id;
  update public.notifications set status = 'pending' where id = _id;
  select status into _st2 from public.notifications where id = _id;
  insert into _t(check_name, result) values
    ('C7 notification d ItalTest : enregistree « skipped », jamais « pending » (meme remise a pending)',
     case when _st = 'skipped' and _st2 = 'skipped' then 'ok' else 'KO ' || coalesce(_st, 'null') || '/' || coalesce(_st2, 'null') end);
  _id := public.enqueue_notification(_tgt, 'sms', '+32470000000', null, 'sms', null, null, null);
  insert into _t(check_name, result) values
    ('C8 SMS d ItalTest : « skipped »', case when (select status from public.notifications where id = _id) = 'skipped' then 'ok' else 'KO' end);
  _id := public.enqueue_notification(_src, 'email', 'client.reel@example.com', 'Rappel', 'corps', null, null, null);
  insert into _t(check_name, result) values
    ('C9 temoin : une notification d ITALBIKE STORE reste « pending » (garde-fou cible)',
     case when (select status from public.notifications where id = _id) = 'pending' then 'ok' else 'KO' end);

  -- reglements d envoi : forces a l arret meme si on tente de les ouvrir
  insert into public.followup_settings (company_id, mode, test_recipient) values (_tgt, 'actif', 'a@b.be')
    on conflict (company_id) do update set mode = 'actif', test_recipient = 'a@b.be';
  insert into public.receivable_settings (company_id, dunning_mode, dunning_test_recipient) values (_tgt, 'test', 'a@b.be')
    on conflict (company_id) do update set dunning_mode = 'test', dunning_test_recipient = 'a@b.be';
  if to_regclass('public.sms_settings') is not null then
    execute $q$insert into public.sms_settings (company_id, mode, test_recipient) values ($1, 'actif', '+32470000000')
              on conflict (company_id) do update set mode = 'actif', test_recipient = '+32470000000'$q$ using _tgt;
    execute 'select mode from public.sms_settings where company_id = $1' into _st using _tgt;
    insert into _t(check_name, result) values ('C16 SMS (Brevo) : mode « arrete » force', case when _st = 'arrete' then 'ok' else 'KO ' || coalesce(_st, 'null') end);
  end if;
  if to_regclass('public.automation_switches') is not null then
    execute $q$insert into public.automation_switches (company_id, key, mode) values ($1, 'appointment_reminder_mail', 'actif')
              on conflict (company_id, key) do update set mode = 'actif'$q$ using _tgt;
    execute $q$select mode from public.automation_switches where company_id = $1 and key = 'appointment_reminder_mail'$q$ into _st using _tgt;
    insert into _t(check_name, result) values ('C17 interrupteurs de mise en production : « arrete » force', case when _st = 'arrete' then 'ok' else 'KO ' || coalesce(_st, 'null') end);
    execute $q$insert into public.automation_settings (company_id, sender_mailbox, mail_test_recipient) values ($1, 'info@ducatibxl.be', 'a@b.be')
              on conflict (company_id) do update set sender_mailbox = 'info@ducatibxl.be', mail_test_recipient = 'a@b.be'$q$ using _tgt;
    execute $q$select coalesce(sender_mailbox, '') || coalesce(mail_test_recipient, '') from public.automation_settings where company_id = $1$q$ into _st using _tgt;
    insert into _t(check_name, result) values ('C18 mails automatiques : ni boite d envoi ni adresse de test', case when _st = '' then 'ok' else 'KO ' || _st end);
  end if;
  insert into public.shopify_sync_settings (company_id, mode) values (_tgt, 'tous')
    on conflict (company_id) do update set mode = 'tous';
  insert into public.shopify_order_settings (company_id, import_enabled) values (_tgt, true)
    on conflict (company_id) do update set import_enabled = true;
  insert into public.accounting_transfer_settings (company_id, params) values (_tgt, '{"auto": {"frequency": "daily", "sendEmail": true, "email": "compta@example.com"}}')
    on conflict (company_id) do update set params = excluded.params;
  select params into _p from public.accounting_transfer_settings where company_id = _tgt;
  insert into _t(check_name, result) values
    ('C10 relances d entretien : mode « arrete » force', case when (select mode from public.followup_settings where company_id = _tgt) = 'arrete'
                                                              and (select test_recipient from public.followup_settings where company_id = _tgt) is null then 'ok' else 'KO' end),
    ('C11 relances d impayes : mode « arrete » force', case when (select dunning_mode from public.receivable_settings where company_id = _tgt) = 'arrete' then 'ok' else 'KO' end),
    ('C12 Shopify : synchronisation « arrete » et import des commandes coupe, absent de la file d envoi',
     case when (select mode from public.shopify_sync_settings where company_id = _tgt) = 'arrete'
           and (select import_enabled from public.shopify_order_settings where company_id = _tgt) = false
           and not exists (select 1 from public._shopify_push_companies() c where c = _tgt) then 'ok' else 'KO' end),
    ('C13 transfert comptable automatique : « off », pas d envoi par e-mail',
     case when _p #>> '{auto,frequency}' = 'off' and (_p #>> '{auto,sendEmail}')::boolean = false and coalesce(_p #>> '{auto,email}', '') = '' then 'ok' else 'KO ' || _p::text end);

  begin
    insert into public.stripe_settings (company_id) values (_tgt);
    _err := 'accepte';
  exception when others then _err := sqlstate;
  end;
  insert into _t(check_name, result) values ('C14 Stripe : reglage refuse en societe de test', case when _err = '42501' then 'ok' else 'KO ' || _err end);
  begin
    insert into public.company_mailboxes (company_id, address) values (_tgt, 'atelier@ducatibxl.be');
    _err := 'accepte';
  exception when others then _err := sqlstate;
  end;
  insert into _t(check_name, result) values ('C15 boite Outlook : refusee en societe de test', case when _err = '42501' then 'ok' else 'KO ' || _err end);
end $s$;

-- ------------------------------------------------ E. stock d ItalTest = stock d ITALBIKE
do $s$
declare _src uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _tgt uuid := (select v::uuid from _ctx where k = 'tgt'); _bad int;
begin
  select count(*) into _bad from (
    select a.id,
           (select coalesce(sum(m.qty_delta), 0) from public.stock_moves m where m.article_id = a.id and not m.is_reservation) as q_src,
           (select coalesce(sum(m.qty_delta), 0) from public.stock_moves m where m.article_id = public._tc_map(_tgt, a.id) and not m.is_reservation) as q_tgt
      from public.articles a
     where a.company_id = _src and exists (select 1 from public.stock_moves m where m.article_id = a.id)
     order by md5(a.id::text) limit 300) x
   where x.q_src <> x.q_tgt;
  insert into _t(check_name, result) values
    ('E1 echantillon de 300 articles mouvementes : stock reel identique', case when _bad = 0 then 'ok' else 'KO ' || _bad end),
    ('E2 totaux : quantite et valeur PAMP du stock identiques',
     case when (select coalesce(sum(real_qty), 0) from public._stock_levels(_src)) = (select coalesce(sum(real_qty), 0) from public._stock_levels(_tgt))
           and (select count(*) from public._stock_levels(_src)) = (select count(*) from public._stock_levels(_tgt))
           and (select coalesce(sum(real_qty * coalesce(pamp, 0)), 0) from public._stock_levels(_src)) = (select coalesce(sum(real_qty * coalesce(pamp, 0)), 0) from public._stock_levels(_tgt))
          then 'ok' else 'KO' end),
    ('E3 stock d ouverture : un seul mouvement par article, append-only (aucun champ stock)',
     case when not exists (select 1 from public.stock_moves where company_id = _tgt group by article_id having count(*) > 1) then 'ok' else 'KO' end);
end $s$;

-- ------------------------------------------------ D. refus
do $s$
declare _src uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _tgt uuid := (select v::uuid from _ctx where k = 'tgt'); _err text; _r jsonb;
begin
  begin perform public.admin_test_company_step(_src, 2000); _err := 'accepte'; exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('D1 rafraichir/purger ITALBIKE STORE (non marquee test) : refuse', case when _err = '42501' then 'ok' else 'KO ' || _err end);
  begin perform public._tc_run(_src, clock_timestamp() + interval '2 seconds'); _err := 'accepte'; exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('D2 machine de purge appelee directement sur ITALBIKE STORE : refus', case when _err = '42501' then 'ok' else 'KO ' || _err end);
  begin insert into public.test_companies (company_id, source_company_id) values (_src, _tgt); _err := 'accepte'; exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('D3 marquer ITALBIKE STORE « test » : refuse', case when _err = '42501' then 'ok' else 'KO ' || _err end);
  begin delete from public.test_companies where company_id = _tgt; _err := 'accepte'; exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('D4 retirer la marque test d ItalTest : refuse', case when _err = '42501' then 'ok' else 'KO ' || _err end);
  begin update public.test_companies set source_company_id = _tgt where company_id = _tgt; _err := 'accepte'; exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('D5 modifier le marquage : refuse', case when _err in ('42501', '23514') then 'ok' else 'KO ' || _err end);
  begin perform public.admin_test_company_start(_tgt, 'ItalTest bis'); _err := 'accepte'; exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('D6 copier depuis une societe de test : refuse', case when _err = '42501' then 'ok' else 'KO ' || _err end);

end $s$;

-- utilisateur non administrateur (mecanicien) : refus
select set_config('request.jwt.claims', '{"sub":"088da12b-d29d-452c-9b05-f245362d43a4","role":"authenticated"}', true);
set local role authenticated;
do $s$
declare _err text; _tgt uuid := (select v::uuid from _ctx where k = 'tgt');
begin
  begin perform public.admin_test_company_start('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ItalTest essai'); _err := 'accepte'; exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('D8 non administrateur : lancer la copie refuse', case when _err = '42501' then 'ok' else 'KO ' || _err end);
  begin perform public.admin_test_company_step(_tgt, 1000); _err := 'accepte'; exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('D9 non administrateur : faire avancer la copie refuse', case when _err = '42501' then 'ok' else 'KO ' || _err end);
  begin insert into public.test_companies (company_id, source_company_id) values (gen_random_uuid(), gen_random_uuid()); _err := 'accepte'; exception when others then _err := sqlstate; end;
  insert into _t(check_name, result) values ('D10 ecrire le marquage depuis l application : refuse', case when _err = '42501' then 'ok' else 'KO ' || _err end);
end $s$;
reset role;

-- ------------------------------------------------ F. ITALBIKE STORE n a pas bouge
do $s$
declare _src uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33'; _now text;
begin
  _now := (select count(*) from public.articles where company_id = _src)::text || '/'
       || (select count(*) from public.contacts where company_id = _src)::text || '/'
       || (select count(*) from public.vehicles where company_id = _src)::text || '/'
       || (select count(*) from public.stock_moves where company_id = _src)::text || '/'
       || (select coalesce(sum(qty_delta), 0) from public.stock_moves where company_id = _src)::text || '/'
       || (select coalesce(sum(next_value), 0) from public.document_sequences where company_id = _src)::text || '/'
       || (select count(*) from public.documents where company_id = _src)::text;
  insert into _t(check_name, result) values
    ('F1 ITALBIKE STORE inchangee (articles, contacts, motos, mouvements, stock, numerotations, documents)',
     case when _now = (select v from _ctx where k = 'src_before') then 'ok' else 'KO ' || _now || ' vs ' || (select v from _ctx where k = 'src_before') end);
end $s$;

select n, check_name, result from _t order by n;
