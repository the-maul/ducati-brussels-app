-- =====================================================================
-- PDV020 (03/11/2026) -- essai a blanc de la migration 20261103240000_m6_ecran_client.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261103240000_m6_ecran_client.sql \
--      supabase/tests/m6_ecran_client.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Joue tour a tour une tablette SANS compte (role anon, jeton) et un administrateur d ITALBIKE STORE :
--   appairage par code, lecture par jeton, filtrage du ticket, reponse e-mail / signature,
--   etancheite (anon ne lit aucune table, ne pousse rien ; la reponse du client ne revient jamais a
--   la tablette), revocation, QR de virement existant inchange (attendu -> qr, recu -> merci).
-- Chaque ligne du resultat doit valoir « ok » (ou « sans objet » si aucun document ne se prete au QR).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to anon, authenticated;
grant usage on sequence _t_n_seq to anon, authenticated;

-- ------------------------------------------------------------ 1. la tablette demande un code (anon)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

insert into _ctx select 'begin', public.customer_display_pair_begin('essai a blanc')::text;
insert into _t(check_name, result)
select 'anon : code a 6 caracteres et jeton de 64 hexa',
       case when (v::jsonb ->> 'code') ~ '^[A-Z2-9]{6}$' and (v::jsonb ->> 'token') ~ '^[0-9a-f]{64}$' then 'ok' else 'KO ' || v end
  from _ctx where k = 'begin';
insert into _t(check_name, result)
select 'anon : lecture en attente d appairage',
       case when public.customer_display_read(v::jsonb ->> 'token') ->> 'status' = 'pending' then 'ok' else 'KO' end
  from _ctx where k = 'begin';
insert into _t(check_name, result)
select 'anon : jeton inconnu', case when public.customer_display_read(repeat('a', 64)) ->> 'status' = 'unknown' then 'ok' else 'KO' end;

do $$ begin
  perform 1 from public.customer_display_devices limit 1;
  insert into _t(check_name, result) values ('anon : aucune lecture de la table des appareils', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('anon : aucune lecture de la table des appareils', 'ok');
end $$;
do $$ begin
  perform 1 from public.counter_displays limit 1;
  insert into _t(check_name, result) values ('anon : aucune lecture des ecrans', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('anon : aucune lecture des ecrans', 'ok');
end $$;
do $$ begin
  perform public.counter_display_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ticket', '{}'::jsonb);
  insert into _t(check_name, result) values ('anon : ne pousse rien sur un ecran', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('anon : ne pousse rien sur un ecran', 'ok');
end $$;
do $$ begin
  perform public.customer_display_pair((select v::jsonb ->> 'code' from _ctx where k = 'begin'), '3d9f0f13-a691-4d07-ad58-34590df86e33', 'x', 'x');
  insert into _t(check_name, result) values ('anon : ne s appaire pas tout seul', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('anon : ne s appaire pas tout seul', 'ok');
end $$;

-- ------------------------------------------------------------ 2. le vendeur saisit le code (admin)
reset role;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  perform public.customer_display_pair('ZZZZZZ', '3d9f0f13-a691-4d07-ad58-34590df86e33', 'x', 'x');
  insert into _t(check_name, result) values ('admin : code inconnu refuse', 'KO');
exception when others then
  insert into _t(check_name, result) values ('admin : code inconnu refuse', 'ok');
end $$;

insert into _ctx select 'device', public.customer_display_pair(
  lower((select v::jsonb ->> 'code' from _ctx where k = 'begin')), '3d9f0f13-a691-4d07-ad58-34590df86e33', 'Tablette essai', 'caisse-2')::text;
insert into _t(check_name, result)
select 'admin : appareil liste (poste en majuscules, nom)',
       case when exists (select 1 from public.customer_display_list('3d9f0f13-a691-4d07-ad58-34590df86e33') l
                          where l.id = (select v::uuid from _ctx where k = 'device') and l.register_code = 'CAISSE-2' and l.name = 'Tablette essai')
            then 'ok' else 'KO' end;
do $$ begin
  perform token_hash from public.customer_display_devices limit 1;
  insert into _t(check_name, result) values ('admin : l empreinte du jeton reste illisible', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('admin : l empreinte du jeton reste illisible', 'ok');
end $$;
insert into _t(check_name, result)
select 'admin : les colonnes publiques de l appareil se lisent',
       case when exists (select id, name, last_seen_at from public.customer_display_devices where id = (select v::uuid from _ctx where k = 'device')) then 'ok' else 'KO' end;

-- Ticket en direct avec une cle interdite (adresse) : filtree
select public.counter_display_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ticket', jsonb_build_object(
  'customer_name', 'Client essai', 'address', 'Rue secrete 1', 'phone', '+32 400 00 00 00',
  'lines', jsonb_build_array(jsonb_build_object('designation', 'Huile 10W40', 'quantity', 2, 'unit_ttc', 12.1, 'total_ttc', 24.2)),
  'totals', jsonb_build_object('ht', 20, 'vat', 4.2, 'ttc', 24.2)));
insert into _t(check_name, result) values ('admin : un mode inconnu est refuse', 'pending');
do $$ begin
  perform public.counter_display_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'pirate', '{}'::jsonb);
  update _t set result = 'KO' where check_name = 'admin : un mode inconnu est refuse';
exception when others then
  update _t set result = 'ok' where check_name = 'admin : un mode inconnu est refuse';
end $$;

-- ------------------------------------------------------------ 3. la tablette lit SON ecran (anon)
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

insert into _ctx select 'read1', public.customer_display_read(v::jsonb ->> 'token')::text from _ctx where k = 'begin';
insert into _t(check_name, result)
select 'anon : appaire, mode ticket, ligne visible',
       case when v::jsonb ->> 'status' = 'paired' and v::jsonb #>> '{screen,mode}' = 'ticket'
             and v::jsonb #>> '{screen,payload,lines,0,designation}' = 'Huile 10W40' then 'ok' else 'KO ' || left(v, 300) end
  from _ctx where k = 'read1';
insert into _t(check_name, result)
select 'anon : ni adresse ni telephone sur la tablette',
       case when v not like '%Rue secrete%' and v not like '%+32 400%' then 'ok' else 'KO' end from _ctx where k = 'read1';
insert into _t(check_name, result)
select 'anon : canal Realtime au nom secret', case when v::jsonb #>> '{device,channel}' ~ '^ecran-client-[0-9a-f]{32}$' then 'ok' else 'KO' end
  from _ctx where k = 'read1';
do $$ begin
  perform public.customer_display_reply((select v::jsonb ->> 'token' from _ctx where k = 'begin'), 'email', '{"email":"client@example.com"}');
  insert into _t(check_name, result) values ('anon : pas d e-mail hors ecran merci', 'KO');
exception when others then
  insert into _t(check_name, result) values ('anon : pas d e-mail hors ecran merci', 'ok');
end $$;

-- ------------------------------------------------------------ 4. merci + e-mail autorise
reset role;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
select public.counter_display_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'merci', '{"amount":24.2,"allow_email":true}'::jsonb);

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into _t(check_name, result)
select 'anon : e-mail du client accepte sur l ecran merci',
       case when (public.customer_display_reply(v::jsonb ->> 'token', 'email', '{"email":" Client@Example.com "}') ->> 'ok')::boolean then 'ok' else 'KO' end
  from _ctx where k = 'begin';
insert into _t(check_name, result)
select 'anon : l adresse ne revient jamais a la tablette',
       case when public.customer_display_read(v::jsonb ->> 'token')::text not like '%example.com%'
             and public.customer_display_read(v::jsonb ->> 'token') #>> '{screen,reply_kind}' = 'email' then 'ok' else 'KO' end
  from _ctx where k = 'begin';
do $$ begin
  perform public.customer_display_reply((select v::jsonb ->> 'token' from _ctx where k = 'begin'), 'email', '{"email":"pas-une-adresse"}');
  insert into _t(check_name, result) values ('anon : adresse invalide refusee', 'KO');
exception when others then
  insert into _t(check_name, result) values ('anon : adresse invalide refusee', 'ok');
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
insert into _t(check_name, result)
select 'admin : le vendeur lit l adresse saisie',
       case when public.counter_display_state('3d9f0f13-a691-4d07-ad58-34590df86e33') #>> '{reply,email}' = 'client@example.com' then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 5. signature
select public.counter_display_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'signature',
  '{"signature":{"title":"Bon de livraison","text":"Je reconnais avoir recu la marchandise."}}'::jsonb);
insert into _t(check_name, result)
select 'admin : changer de mode efface la reponse precedente',
       case when public.counter_display_state('3d9f0f13-a691-4d07-ad58-34590df86e33') -> 'reply' = 'null'::jsonb then 'ok' else 'KO' end;

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into _t(check_name, result)
select 'anon : signature acceptee',
       case when (public.customer_display_reply(v::jsonb ->> 'token', 'signature', '{"png":"data:image/png;base64,iVBORw0KGgo=","signer_name":"Client essai"}') ->> 'ok')::boolean then 'ok' else 'KO' end
  from _ctx where k = 'begin';
do $$ begin
  perform public.customer_display_reply((select v::jsonb ->> 'token' from _ctx where k = 'begin'), 'signature', '{"png":"javascript:alert(1)"}');
  insert into _t(check_name, result) values ('anon : une image non PNG est refusee', 'KO');
exception when others then
  insert into _t(check_name, result) values ('anon : une image non PNG est refusee', 'ok');
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
insert into _t(check_name, result)
select 'admin : empreinte SHA-256 de la signature',
       case when public.counter_display_state('3d9f0f13-a691-4d07-ad58-34590df86e33') #>> '{reply,hash}' ~ '^[0-9a-f]{64}$' then 'ok' else 'KO' end;
select public.counter_display_reply_clear('3d9f0f13-a691-4d07-ad58-34590df86e33');
insert into _t(check_name, result)
select 'admin : reponse traitee puis effacee',
       case when public.counter_display_state('3d9f0f13-a691-4d07-ad58-34590df86e33') -> 'reply' = 'null'::jsonb then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'admin : trace events de l appairage et de la signature',
       case when (select count(*) from public.events where entity_type = 'customer_display_devices'
                   and entity_id = (select v from _ctx where k = 'device')
                   and action in ('customer_display_paired', 'customer_display_reply')) >= 2 then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 6. QR de virement existant (inchange)
insert into _t(check_name, result) values ('QR existant : attendu -> qr, recu -> merci, l ancien ecran lit toujours', 'sans objet');
do $$
declare d record; pid uuid; cur record; st jsonb;
begin
  select doc.id, round(doc.total_ttc - coalesce(doc.paid_amount, 0), 2) as due into d
    from public.documents doc join public.companies c on c.id = doc.company_id
   where doc.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
     and doc.status not in ('brouillon', 'annulee', 'converti') and doc.doc_type not in ('AVO')
     and doc.total_ttc - coalesce(doc.paid_amount, 0) > 1 and coalesce(btrim(c.iban), '') <> ''
   order by doc.created_at desc limit 1;
  if d.id is null then return; end if;
  pid := public.qr_payment_start(d.id, 1, 'Essai a blanc');
  st := public.counter_display_state('3d9f0f13-a691-4d07-ad58-34590df86e33');
  select * into cur from public.counter_display_current('3d9f0f13-a691-4d07-ad58-34590df86e33');
  if st #>> '{screen,payment,status}' <> 'attendu' or cur.payment_id is distinct from pid or cur.status <> 'attendu' then
    update _t set result = 'KO attendu' where check_name like 'QR existant%'; return;
  end if;
  perform public.qr_payment_confirm(pid);
  st := public.counter_display_state('3d9f0f13-a691-4d07-ad58-34590df86e33');
  if st #>> '{screen,payment,status}' <> 'recu' or (st #>> '{screen,payment,received_at}') is null then
    update _t set result = 'KO recu' where check_name like 'QR existant%'; return;
  end if;
  perform public.counter_display_show('3d9f0f13-a691-4d07-ad58-34590df86e33', null);
  perform public.counter_display_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ticket', '{"lines":[]}'::jsonb);
  st := public.counter_display_state('3d9f0f13-a691-4d07-ad58-34590df86e33');
  update _t set result = case when st #> '{screen,payment}' = 'null'::jsonb then 'ok' else 'KO ticket' end where check_name like 'QR existant%';
end $$;

-- ------------------------------------------------------------ 7. revocation
select public.customer_display_revoke((select v::uuid from _ctx where k = 'device'));
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into _t(check_name, result)
select 'anon : appareil revoque', case when public.customer_display_read(v::jsonb ->> 'token') ->> 'status' = 'revoked' then 'ok' else 'KO' end
  from _ctx where k = 'begin';
do $$ begin
  perform public.customer_display_reply((select v::jsonb ->> 'token' from _ctx where k = 'begin'), 'email', '{"email":"a@b.be"}');
  insert into _t(check_name, result) values ('anon : appareil revoque ne repond plus', 'KO');
exception when others then
  insert into _t(check_name, result) values ('anon : appareil revoque ne repond plus', 'ok');
end $$;

-- ------------------------------------------------------------ 8. un inconnu (connecte, sans role)
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000beef","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform * from public.customer_display_list('3d9f0f13-a691-4d07-ad58-34590df86e33');
  insert into _t(check_name, result) values ('inconnu : aucune liste d ecrans', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('inconnu : aucune liste d ecrans', 'ok');
end $$;
insert into _t(check_name, result)
select 'inconnu : RLS, aucun appareil visible', case when count(*) = 0 then 'ok' else 'KO' end from public.customer_display_devices;

reset role;
select n, check_name, result from _t order by n;
