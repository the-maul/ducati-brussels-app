-- =====================================================================
-- Lot B du parcours mecanicien (19/11/2026) -- essai a blanc de 20261119250000_m8_pieces_sans_clic.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119250000_m8_pieces_sans_clic.sql \
--      supabase/tests/m8_pieces_sans_clic.sql; echo "rollback;") > t.sql
-- Scenario, administrateur simule d'ITALBIKE STORE, mode « veille » a 16 h, urgente sous 5 jours :
--   RDV d'entretien dans 2 jours -> pieces en stock reservees, manque au panier URGENTE, piece
--   « remplacee » sans stock : le RDV passe quand meme (pas au panier, « manquante ») ; pas de
--   picking aujourd'hui, picking creee par la tache de la veille (16 h 30), sans mouvement de stock ;
--   tache relancee -> pas de doublon ; second RDV dans 10 jours -> panier standard, « commander en
--   urgente » bascule la ligne ; RDV avance -> le reste bascule seul ; panier urgente annule ->
--   piece « manquante », « commander en urgente » la recommande ; OR ne du RDV -> la MEME picking
--   list suit l'OR, completee (pas dupliquee) ; reception de la piece commandee -> reservee pour
--   l'OR ; RDV annule -> picking annulee ; facture -> B7, la somme des mouvements revient a 0.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
insert into _ctx values
  ('my', 'essai-lotb-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS')),
  -- « aujourd'hui » a Bruxelles et ses dates
  ('today', ((now() at time zone 'Europe/Brussels')::date)::text);
insert into public.ducati_catalog_model_years (id, model_id, code, year, name)
select (select v from _ctx where k = 'my'), my.model_id, 'EB', my.year, 'ESSAI LOT B (transaction annulee)'
  from public.ducati_catalog_model_years my where my.id = '21110';
insert into _ctx select 'contact', c.id::text from public.contacts c
 where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and c.type <> 'fournisseur' and c.is_active
 order by c.created_at limit 1;
with v as (
  insert into public.vehicles (company_id, brand, model, status, ducati_model_year_id, holder_contact_id, notes)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'DUCATI', 'ESSAI LOT B', 'vendu',
          (select v from _ctx where k = 'my'), (select v::uuid from _ctx where k = 'contact'), 'ESSAI A BLANC (transaction annulee)')
  returning id)
insert into _ctx select 'vehicle', id::text from v;
-- filtre 44440312B (stock large) ; « missing » : piece stockee sans aucun mouvement (stock 0) ;
-- « yellow » : autre piece sans mouvement, remplacee chez Ducati ; « extra » : piece ajoutee sur l'OR.
insert into _ctx select 'filter', a.id::text from public.articles a
 where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.reference = '44440312B' limit 1;
insert into _ctx
select x.k, x.id::text from (
  select a.id, row_number() over (order by a.reference) as rn
    from public.articles a
   where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.mgmt_type = 'A' and coalesce(a.is_active, true)
     and a.reference <> '44440312B'
     and not exists (select 1 from public.stock_moves m where m.article_id = a.id)
     and not exists (select 1 from public.stock_reservations s where s.article_id = a.id)
   limit 3) y
cross join lateral (select case y.rn when 1 then 'missing' when 2 then 'yellow' else 'extra' end as k, y.id) x;
update public.articles set supplier_availability = 'green', stock_min = 0 where id = (select v::uuid from _ctx where k = 'missing');
update public.articles set supplier_availability = 'yellow', stock_min = 0 where id = (select v::uuid from _ctx where k = 'yellow');
update public.articles set supplier_availability = 'green', stock_min = 0 where id = (select v::uuid from _ctx where k = 'extra');
update public.articles set stock_min = 0 where id = (select v::uuid from _ctx where k = 'filter');
-- Reglages du lot : veille a 16 h, urgente sous 5 jours.
insert into public.workshop_planning_settings (company_id, picking_auto_mode, picking_eve_hour)
values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'veille', 16)
on conflict (company_id) do update set picking_auto_mode = 'veille', picking_eve_hour = 16;
-- Q58 (20/11) : ce scenario raisonne en veille CALENDAIRE (RDV de demain) ; la veille ouvree a son essai
-- (m8_picking_veille_ouvree.sql). Sans la migration Q58, la colonne n'existe pas : rien a faire.
do $q58$ begin
  update public.workshop_planning_settings set picking_eve_basis = 'calendaire' where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
exception when undefined_column then null;
end $q58$;
update public.reference_values set extra = coalesce(extra, '{}'::jsonb) || '{"urgent_within_days": 5}'::jsonb
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and table_key = 'order_threshold' and code = 'urgente';

-- Kit Annual Service de l'essai : filtre 1, missing 2, yellow 1.
with k as (
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label,
                                       content_hash, service_kind, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'essai_lotb', 'Essai lot B', 'annual_service', 'Annual Service', 'essai-lotb', 'annual', 'manuel')
  returning id)
insert into _ctx select 'kit', id::text from k;
insert into public.maintenance_kit_model_years (kit_id, model_year_id)
select (select v::uuid from _ctx where k = 'kit'), (select v from _ctx where k = 'my');
insert into public.maintenance_kit_items (company_id, kit_id, article_id, reference, designation, quantity, kind, confidence, sort_order)
select '3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'kit'), a.id, a.reference, a.designation,
       case when a.id = (select v::uuid from _ctx where k = 'missing') then 2 else 1 end, 'piece', 'sur', 1
  from public.articles a where a.id in (select v::uuid from _ctx where k in ('filter', 'missing', 'yellow'));

insert into _t(check_name, result)
select 'preparation : moto, client, filtre, 3 pieces sans stock, kit',
       case when (select count(*) from _ctx where k in ('vehicle', 'contact', 'filter', 'missing', 'yellow', 'extra', 'kit')) = 7 then 'ok'
            else 'KO ' || (select string_agg(k, ',') from _ctx) end;
-- Aucun panier ouvert de l'essai au depart.
insert into _ctx select 'moves0', count(*)::text from public.stock_moves;

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

insert into _t(check_name, result)
select 'reglages : veille, 16 h, urgente sous 5 jours',
       case when public.workshop_parts_settings('3d9f0f13-a691-4d07-ad58-34590df86e33') @> '{"mode": "veille", "eve_hour": 16, "urgent_days": 5}'::jsonb
            then 'ok' else 'KO ' || public.workshop_parts_settings('3d9f0f13-a691-4d07-ad58-34590df86e33')::text end;

insert into _ctx select 'set1', public.workshop_parts_settings_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'veille', 16, 5)::text;
insert into _t(check_name, result)
select 'reglages : enregistres par l''administrateur, seuil dans le reglage des commandes, trace events',
       case when (select v from _ctx where k = 'set1')::jsonb ->> 'mode' = 'veille'
             and exists (select 1 from public.events where action = 'workshop_parts_settings'
                          and entity_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and occurred_at >= now() - interval '1 minute')
            then 'ok' else 'KO' end;
do $$ begin
  perform public.workshop_parts_settings_set('3d9f0f13-a691-4d07-ad58-34590df86e33', 'demain', 16, 5);
  insert into _t(check_name, result) values ('reglages : moment inconnu refuse', 'KO');
exception when others then
  insert into _t(check_name, result) values ('reglages : moment inconnu refuse', case when sqlerrm like 'Moment%' then 'ok' else 'KO ' || sqlerrm end);
end $$;

-- RDV « Entretien annuel » dans 2 jours a 9 h (Bruxelles).
with a as (
  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, mileage, starts_at, planned_minutes, status, reason_code, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'contact'), (select v::uuid from _ctx where k = 'vehicle'), 15000,
          ((select v::date from _ctx where k = 'today') + 2 + time '09:00') at time zone 'Europe/Brussels', 90, 'prevu', 'entretien_annuel', 'dms')
  returning id)
insert into _ctx select 'rdv1', id::text from a;

insert into _t(check_name, result)
select 'RDV dans 2 jours : filtre reserve, manque (2) au panier URGENTE',
       case when (select qty_reserved from public.stock_reservations where appointment_id = (select v::uuid from _ctx where k = 'rdv1')
                   and article_id = (select v::uuid from _ctx where k = 'filter') and status = 'active') = 1
             and (select s.basket_kind || ':' || s.qty_to_order from public.stock_reservations s
                   where s.appointment_id = (select v::uuid from _ctx where k = 'rdv1')
                     and s.article_id = (select v::uuid from _ctx where k = 'missing') and s.status = 'active') = 'urgente:2.000'
             and exists (select 1 from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                          join public.stock_reservations s on s.id = l.origin_line_id
                         where s.appointment_id = (select v::uuid from _ctx where k = 'rdv1') and b.kind = 'urgente' and b.status = 'ouvert'
                           and l.article_id = (select v::uuid from _ctx where k = 'missing') and l.qty = 2)
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'piece remplacee sans stock : le RDV passe, rien au panier, « manquante » (non commandable)',
       case when s.qty_to_order = 0 and s.qty_reserved = 0
             and not exists (select 1 from public.supplier_basket_lines l where l.origin_line_id = s.id)
             and (select u.part_state || ':' || u.supplier_availability || ':' || u.can_order_urgent
                    from public.workshop_upcoming_parts('3d9f0f13-a691-4d07-ad58-34590df86e33',
                           (select v::date from _ctx where k = 'today'), (select v::date from _ctx where k = 'today') + 3) u
                   where u.reservation_id = s.id) = 'manquante:yellow:false'
            then 'ok' else 'KO' end
  from public.stock_reservations s
 where s.appointment_id = (select v::uuid from _ctx where k = 'rdv1') and s.article_id = (select v::uuid from _ctx where k = 'yellow')
   and s.status = 'active';

insert into _t(check_name, result)
select 'RDV dans 2 jours : pas encore de picking list (ce n''est pas la veille)',
       case when not exists (select 1 from public.picking_lists where appointment_id = (select v::uuid from _ctx where k = 'rdv1'))
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'magasin : filtre « reservee », missing « au_panier » urgente, RDV du jour J+2',
       case when (select string_agg(u.part_state || '/' || coalesce(u.basket_kind, '-'), ',' order by u.part_state)
                    from public.workshop_upcoming_parts('3d9f0f13-a691-4d07-ad58-34590df86e33',
                           (select v::date from _ctx where k = 'today'), (select v::date from _ctx where k = 'today') + 3) u
                   where u.appointment_id = (select v::uuid from _ctx where k = 'rdv1')
                     and u.article_id in (select v::uuid from _ctx where k in ('filter', 'missing'))) = 'au_panier/urgente,reservee/-'
            then 'ok' else 'KO ' || coalesce((select string_agg(u.part_state || '/' || coalesce(u.basket_kind, '-'), ',')
                    from public.workshop_upcoming_parts('3d9f0f13-a691-4d07-ad58-34590df86e33',
                           (select v::date from _ctx where k = 'today'), (select v::date from _ctx where k = 'today') + 3) u
                   where u.appointment_id = (select v::uuid from _ctx where k = 'rdv1')), 'aucune ligne') end;

do $$ begin
  perform public._cron_workshop_picking_eve(now(), '3d9f0f13-a691-4d07-ad58-34590df86e33');
  insert into _t(check_name, result) values ('droits : la tache de la veille n''est pas appelable depuis l''ecran', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('droits : la tache de la veille n''est pas appelable depuis l''ecran', 'ok');
end $$;

-- ------------------------------------------------------------ 2. la tache de la veille (proprietaire, comme pg_cron)
reset role;
insert into _ctx select 'moves_before_pick', count(*)::text from public.stock_moves;
insert into _ctx select 'cron_today',
  public._cron_workshop_picking_eve(((select v::date from _ctx where k = 'today') + time '10:00') at time zone 'Europe/Brussels',
                                    '3d9f0f13-a691-4d07-ad58-34590df86e33')::text;
insert into _t(check_name, result)
select 'tache aujourd''hui 10 h : rien pour le RDV de J+2',
       case when not exists (select 1 from public.picking_lists where appointment_id = (select v::uuid from _ctx where k = 'rdv1'))
            then 'ok' else 'KO' end;
insert into _ctx select 'cron_eve_early',
  public._cron_workshop_picking_eve(((select v::date from _ctx where k = 'today') + 1 + time '15:30') at time zone 'Europe/Brussels',
                                    '3d9f0f13-a691-4d07-ad58-34590df86e33')::text;
insert into _t(check_name, result)
select 'tache la veille 15 h 30 (avant l''heure reglee) : rien',
       case when not exists (select 1 from public.picking_lists where appointment_id = (select v::uuid from _ctx where k = 'rdv1'))
            then 'ok' else 'KO' end;
insert into _ctx select 'cron_eve',
  public._cron_workshop_picking_eve(((select v::date from _ctx where k = 'today') + 1 + time '16:30') at time zone 'Europe/Brussels',
                                    '3d9f0f13-a691-4d07-ad58-34590df86e33')::text;
insert into _ctx select 'pick1', id::text from public.picking_lists where appointment_id = (select v::uuid from _ctx where k = 'rdv1');
insert into _t(check_name, result)
select 'tache la veille 16 h 30 : picking list du RDV creee, 3 pieces du kit, aucun mouvement de stock (B7)',
       case when (select v from _ctx where k = 'pick1') is not null
             and (select count(*) from public.picking_list_items where picking_id = (select v::uuid from _ctx where k = 'pick1') and origin = 'kit') = 3
             and (select count(*) from public.stock_moves) = (select v::int from _ctx where k = 'moves_before_pick')
             and exists (select 1 from public.events where action = 'picking_open_for_appointment'
                          and entity_id = (select v from _ctx where k = 'pick1'))
            then 'ok' else 'KO ' || coalesce((select v from _ctx where k = 'cron_eve'), '?') || ' / '
                 || (select count(*) from public.picking_list_items where picking_id = (select v::uuid from _ctx where k = 'pick1'))::text end;
select public._cron_workshop_picking_eve(((select v::date from _ctx where k = 'today') + 1 + time '17:05') at time zone 'Europe/Brussels',
                                         '3d9f0f13-a691-4d07-ad58-34590df86e33');
insert into _t(check_name, result)
select 'tache relancee : pas de doublon (une liste, 3 lignes)',
       case when (select count(*) from public.picking_lists where appointment_id = (select v::uuid from _ctx where k = 'rdv1')) = 1
             and (select count(*) from public.picking_list_items where picking_id = (select v::uuid from _ctx where k = 'pick1')) = 3
            then 'ok' else 'KO' end;
update public.workshop_planning_settings set picking_auto_mode = 'reception'
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
insert into _t(check_name, result)
select 'mode « a la reception » : la tache de la veille ne cree rien, l''OR le fera',
       case when not public._workshop_picking_due('3d9f0f13-a691-4d07-ad58-34590df86e33',
                       ((select v::date from _ctx where k = 'today') + 1 + time '09:00') at time zone 'Europe/Brussels',
                       ((select v::date from _ctx where k = 'today') + time '18:00') at time zone 'Europe/Brussels')
             and public._workshop_picking_due('3d9f0f13-a691-4d07-ad58-34590df86e33', null, now()) is false
            then 'ok' else 'KO' end;
update public.workshop_planning_settings set picking_auto_mode = 'veille'
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33';
insert into _t(check_name, result)
select 'mode veille : RDV de demain due a 18 h, pas a 15 h ; RDV du jour toujours due',
       case when public._workshop_picking_due('3d9f0f13-a691-4d07-ad58-34590df86e33',
                       ((select v::date from _ctx where k = 'today') + 1 + time '09:00') at time zone 'Europe/Brussels',
                       ((select v::date from _ctx where k = 'today') + time '18:00') at time zone 'Europe/Brussels')
             and not public._workshop_picking_due('3d9f0f13-a691-4d07-ad58-34590df86e33',
                       ((select v::date from _ctx where k = 'today') + 1 + time '09:00') at time zone 'Europe/Brussels',
                       ((select v::date from _ctx where k = 'today') + time '15:00') at time zone 'Europe/Brussels')
             and public._workshop_picking_due('3d9f0f13-a691-4d07-ad58-34590df86e33',
                       ((select v::date from _ctx where k = 'today') + time '14:00') at time zone 'Europe/Brussels',
                       ((select v::date from _ctx where k = 'today') + time '08:00') at time zone 'Europe/Brussels')
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 3. standard -> urgente
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
-- Second RDV dans 10 jours : missing (2) au panier STANDARD.
with a as (
  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, mileage, starts_at, planned_minutes, status, reason_code, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'contact'), (select v::uuid from _ctx where k = 'vehicle'), 15000,
          ((select v::date from _ctx where k = 'today') + 10 + time '09:00') at time zone 'Europe/Brussels', 90, 'prevu', 'entretien_annuel', 'dms')
  returning id)
insert into _ctx select 'rdv2', id::text from a;
insert into _ctx select 'res2', id::text from public.stock_reservations
 where appointment_id = (select v::uuid from _ctx where k = 'rdv2') and article_id = (select v::uuid from _ctx where k = 'missing') and status = 'active';
insert into _t(check_name, result)
select 'RDV dans 10 jours : manque au panier STANDARD, « commander en urgente » propose',
       case when (select basket_kind from public.stock_reservations where id = (select v::uuid from _ctx where k = 'res2')) = 'standard'
             and (select u.part_state || ':' || u.basket_kind || ':' || u.can_order_urgent
                    from public.workshop_upcoming_parts('3d9f0f13-a691-4d07-ad58-34590df86e33',
                           (select v::date from _ctx where k = 'today'), (select v::date from _ctx where k = 'today') + 14) u
                   where u.reservation_id = (select v::uuid from _ctx where k = 'res2')) = 'au_panier:standard:true'
            then 'ok' else 'KO' end;
insert into _ctx select 'urg2', public.workshop_reservation_order_urgent((select v::uuid from _ctx where k = 'res2'))::text;
insert into _t(check_name, result)
select 'commander en urgente : la ligne quitte le standard pour l''urgente (meme quantite, rien en double)',
       case when ((select v::jsonb from _ctx where k = 'urg2') ->> 'moved')::numeric = 2
             and ((select v::jsonb from _ctx where k = 'urg2') ->> 'added')::numeric = 0
             and (select string_agg(b.kind || ':' || l.qty, ',') from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                   where l.origin_line_id = (select v::uuid from _ctx where k = 'res2') and b.status = 'ouvert') = 'urgente:2.000'
             and (select basket_kind || ':' || qty_to_order from public.stock_reservations where id = (select v::uuid from _ctx where k = 'res2')) = 'urgente:2.000'
            then 'ok' else 'KO ' || (select v from _ctx where k = 'urg2') end;

-- RDV avance : le filtre de RDV2 est reserve ; on remet un manque au standard puis on avance le RDV.
-- (la piece remplacee ne va jamais au panier : seul « missing » est concerne)
reset role;
-- Simule une ligne standard restee pour RDV2 (ex. ajoutee a la main) : ajout direct par la fonction interne.
select public._basket_add_lines(public._basket_current('3d9f0f13-a691-4d07-ad58-34590df86e33', 'standard', true),
  jsonb_build_array(jsonb_build_object('article_id', (select v from _ctx where k = 'missing'), 'qty', 1, 'origin', 'atelier',
                                       'origin_ref', 'ESSAI', 'origin_line_id', (select v from _ctx where k = 'res2'))), false);
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
update public.workshop_appointments
   set starts_at = ((select v::date from _ctx where k = 'today') + 3 + time '09:00') at time zone 'Europe/Brussels'
 where id = (select v::uuid from _ctx where k = 'rdv2');
insert into _t(check_name, result)
select 'RDV avance a J+3 (sous 5 jours) : la ligne standard ouverte passe seule en urgente',
       case when not exists (select 1 from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                              where l.origin_line_id = (select v::uuid from _ctx where k = 'res2') and b.status = 'ouvert' and b.kind = 'standard')
             and exists (select 1 from public.events where action = 'workshop_reservation_urgent'
                          and entity_id = (select v from _ctx where k = 'res2') and new_data ->> 'via' = 'rdv_avance')
            then 'ok' else 'KO' end;

-- Panier urgente annule : les pieces redeviennent « manquante », « commander en urgente » les recommande.
select public.basket_cancel(public.basket_current('3d9f0f13-a691-4d07-ad58-34590df86e33', 'urgente'), 'essai lot B');
insert into _ctx select 'res1', id::text from public.stock_reservations
 where appointment_id = (select v::uuid from _ctx where k = 'rdv1') and article_id = (select v::uuid from _ctx where k = 'missing') and status = 'active';
insert into _t(check_name, result)
select 'panier urgente annule : la piece du RDV est « manquante », commande urgente proposee',
       case when (select u.part_state || ':' || u.can_order_urgent
                    from public.workshop_upcoming_parts('3d9f0f13-a691-4d07-ad58-34590df86e33',
                           (select v::date from _ctx where k = 'today'), (select v::date from _ctx where k = 'today') + 3) u
                   where u.reservation_id = (select v::uuid from _ctx where k = 'res1')) = 'manquante:true'
            then 'ok' else 'KO' end;
insert into _ctx select 'urg1', public.workshop_reservation_order_urgent((select v::uuid from _ctx where k = 'res1'))::text;
insert into _t(check_name, result)
select 'commander en urgente : 2 dans un nouveau panier urgente, piece « au_panier »',
       case when ((select v::jsonb from _ctx where k = 'urg1') ->> 'added')::numeric = 2
             and (select u.part_state || ':' || u.basket_kind || ':' || u.qty_on_order
                    from public.workshop_upcoming_parts('3d9f0f13-a691-4d07-ad58-34590df86e33',
                           (select v::date from _ctx where k = 'today'), (select v::date from _ctx where k = 'today') + 3) u
                   where u.reservation_id = (select v::uuid from _ctx where k = 'res1')) = 'au_panier:urgente:2.000'
            then 'ok' else 'KO ' || (select v from _ctx where k = 'urg1') end;
insert into _ctx select 'urg1b', public.workshop_reservation_order_urgent((select v::uuid from _ctx where k = 'res1'))::text;
insert into _t(check_name, result)
select 'commander en urgente deux fois : rien de plus (deja commandee)',
       case when (select v::jsonb from _ctx where k = 'urg1b') ->> 'reason' = 'already_ordered'
            then 'ok' else 'KO ' || (select v from _ctx where k = 'urg1b') end;
do $$ begin
  perform public.workshop_reservation_order_urgent((select id from public.stock_reservations
    where appointment_id = (select v::uuid from _ctx where k = 'rdv1') and article_id = (select v::uuid from _ctx where k = 'yellow') and status = 'active'));
  insert into _t(check_name, result) values ('piece remplacee : la commande urgente est refusee avec la raison', 'KO');
exception when others then
  insert into _t(check_name, result) values ('piece remplacee : la commande urgente est refusee avec la raison',
    case when sqlerrm like '%remplacée%' then 'ok' else 'KO ' || sqlerrm end);
end $$;

-- « Preparer maintenant » pour RDV2 puis RDV2 annule : liste annulee, reservations liberees.
insert into _ctx select 'pick2', public.picking_open_for_appointment((select v::uuid from _ctx where k = 'rdv2'))::text;
update public.workshop_appointments set status = 'annule' where id = (select v::uuid from _ctx where k = 'rdv2');
insert into _t(check_name, result)
select 'RDV annule : sa picking list est annulee, ses reservations liberees',
       case when (select status || ':' || cancel_reason from public.picking_lists where id = (select v::uuid from _ctx where k = 'pick2')) = 'annulee:RDV annulé'
             and not exists (select 1 from public.stock_reservations where appointment_id = (select v::uuid from _ctx where k = 'rdv2') and status = 'active')
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 4. l'OR nait du RDV : la meme liste, completee
with r as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, reason_code)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'OR-ESSAI-LOTB', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 15000, 'a_faire', 'entretien_annuel')
  returning id)
insert into _ctx select 'or', id::text from r;
-- Lignes de l'OR (Q49 : le kit) : le filtre (deja dans la liste) et une piece ajoutee par l'atelier.
insert into public.repair_order_lines (or_id, kind, article_id, designation, quantity, unit_price_ht, sort_order)
select (select v::uuid from _ctx where k = 'or'), 'piece', a.id, a.designation, 1, 10, row_number() over ()
  from public.articles a where a.id in (select v::uuid from _ctx where k in ('filter', 'extra'));
update public.workshop_appointments set or_id = (select v::uuid from _ctx where k = 'or')
 where id = (select v::uuid from _ctx where k = 'rdv1');
insert into _t(check_name, result)
select 'OR ne du RDV : la picking list de la veille suit l''OR (meme liste), completee de la piece ajoutee',
       case when (select repair_order_id from public.picking_lists where id = (select v::uuid from _ctx where k = 'pick1')) = (select v::uuid from _ctx where k = 'or')
             and (select count(*) from public.picking_lists where repair_order_id = (select v::uuid from _ctx where k = 'or')) = 1
             and (select count(*) from public.picking_list_items where picking_id = (select v::uuid from _ctx where k = 'pick1')) = 4
             and public.picking_open_for_repair_order((select v::uuid from _ctx where k = 'or')) = (select v::uuid from _ctx where k = 'pick1')
             and (select count(*) from public.picking_list_items where picking_id = (select v::uuid from _ctx where k = 'pick1')) = 4
            then 'ok' else 'KO ' || (select count(*) from public.picking_list_items where picking_id = (select v::uuid from _ctx where k = 'pick1'))::text end;
insert into _t(check_name, result)
select 'OR ne du RDV : les reservations suivent l''OR, toujours sans double reservation',
       case when (select count(*) from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or') and status = 'active') = 3
             and (select reserved_qty from public.article_stock((select v::uuid from _ctx where k = 'filter')))
                 = (select coalesce(sum(qty_reserved), 0) from public.stock_reservations
                     where article_id = (select v::uuid from _ctx where k = 'filter') and status = 'active')
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 5. reception de la piece commandee
-- La reception (purchase_doc_save) fait une entree de stock par record_stock_move : meme chemin.
select public.record_stock_move((select v::uuid from _ctx where k = 'missing'), 'entree', 2, 5, false, null, 'reception', 'REC-ESSAI-LOTB', 'essai lot B');
insert into _t(check_name, result)
select 'reception : la piece arrivee est reservee pour l''OR (2), etat « reservee » au magasin',
       case when (select qty_reserved from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
                   and article_id = (select v::uuid from _ctx where k = 'missing') and status = 'active') = 2
             and (select u.part_state from public.workshop_upcoming_parts('3d9f0f13-a691-4d07-ad58-34590df86e33',
                           (select v::date from _ctx where k = 'today'), (select v::date from _ctx where k = 'today') + 3) u
                   where u.repair_order_id = (select v::uuid from _ctx where k = 'or')
                     and u.article_id = (select v::uuid from _ctx where k = 'missing')) = 'reservee'
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 6. facture : B7
with d as (
  insert into public.documents (company_id, doc_type, status, contact_id, vehicle_id, number)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'FAC', 'brouillon', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 'FAC-ESSAI-LOTB')
  returning id)
insert into _ctx select 'fac', id::text from d;
insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, sort_order)
select (select v::uuid from _ctx where k = 'fac'), a.id, a.designation,
       case when a.id = (select v::uuid from _ctx where k = 'missing') then 2 else 1 end, 10, 21, 0
  from public.articles a where a.id in (select v::uuid from _ctx where k in ('filter', 'missing'));
select public.record_stock_move((select v::uuid from _ctx where k = 'filter'), 'sortie', -1, null, false, null, 'sale', 'FAC-ESSAI-LOTB', 'essai');
select public.record_stock_move((select v::uuid from _ctx where k = 'missing'), 'sortie', -2, null, false, null, 'sale', 'FAC-ESSAI-LOTB', 'essai');
update public.repair_orders set status = 'facture', invoice_document_id = (select v::uuid from _ctx where k = 'fac')
 where id = (select v::uuid from _ctx where k = 'or');
insert into _t(check_name, result)
select 'B7 : a la facture, la somme des mouvements de reservation revient a 0 (filtre, missing, yellow)',
       case when (select coalesce(sum(qty_delta), 0) from public.stock_moves where origin = 'atelier' and is_reservation
                   and article_id in (select v::uuid from _ctx where k in ('filter', 'missing', 'yellow'))
                   and occurred_at >= now() - interval '5 minutes') = 0
             and not exists (select 1 from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or') and status = 'active')
             and (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'missing'))) = 0
            then 'ok' else 'KO' end;

reset role;
select n, check_name, result from _t order by n;
