-- =====================================================================
-- M8 — Rattrapage G8, lot « OR de base » (18/11/2026, ATE001 / ATE012 / ATE018).
-- Idempotente, a appliquer apres les migrations du 03/11. Rien n'est supprime.
--
-- 1. repair_orders :
--    - promised_at            : « Promis le » / « Prevu pour le » (date + heure promises au client).
--    - check_points (jsonb)   : les 30 points G8 « a verifier (V) / a remplacer (R) »,
--                               objet { code: 'V' | 'R' } (codes : src/modules/workshop/or-base/rules.ts).
--    - mileage_ack_previous   : kilometrage du dernier releve quand l'utilisateur a CONFIRME un km
--                               inferieur (avertissement bloquant G8) ; null = pas d'avertissement.
--    - statuts (texte libre, pas de contrainte) : en plus de a_faire / en_cours / pret / facture / annule,
--      l'ecran propose attente_devis, attente_pieces (« pieces en commande ») et client_informe.
--      Les fonctions existantes ne testent que 'facture' et 'annule' : rien a changer cote base.
-- 2. workshop_appointments.mileage : km releve a la prise du RDV, repris sur l'OR cree depuis le RDV.
-- 3. Rappel de RDV la veille : le SMS n'est enfile QUE si la case « SMS de rappel » du RDV est cochee
--    (bug : tous les clients avec un portable recevaient un SMS). Le mail de rappel est inchange.
--    Aucun fournisseur SMS n'est pose : dispatch-notifications continue de marquer les SMS « skipped ».
-- 4. Index de la liste des OR (tri par date, recherche par client / moto).
-- RLS : colonnes ajoutees a des tables deja protegees (is_member / can_write_table), audit_row inchange.
-- =====================================================================

-- ------------------------------------------------------------ 1. repair_orders
alter table public.repair_orders add column if not exists promised_at timestamptz;
alter table public.repair_orders add column if not exists check_points jsonb not null default '{}'::jsonb;
alter table public.repair_orders add column if not exists mileage_ack_previous int;

alter table public.repair_orders drop constraint if exists repair_orders_check_points_chk;
alter table public.repair_orders add constraint repair_orders_check_points_chk
  check (jsonb_typeof(check_points) = 'object');

alter table public.repair_orders drop constraint if exists repair_orders_mileage_chk;
alter table public.repair_orders add constraint repair_orders_mileage_chk
  check (mileage is null or mileage >= 0) not valid;

comment on column public.repair_orders.promised_at is
  'Promis le (G8 « Prevu pour le ») : date et heure de restitution promises au client.';
comment on column public.repair_orders.check_points is
  'Points G8 a verifier (V) / a remplacer (R) : objet { code: ''V'' | ''R'' }, codes dans or-base/rules.ts.';
comment on column public.repair_orders.mileage_ack_previous is
  'Dernier releve connu quand un km inferieur a ete confirme a la saisie (avertissement G8) ; null sinon.';
comment on column public.repair_orders.notes is
  'Informations complementaires NON imprimees (notes internes de l''OR).';
comment on column public.repair_orders.status is
  'a_faire | attente_devis | attente_pieces | en_cours | pret | client_informe | facture | annule';

create index if not exists idx_ro_company_created on public.repair_orders(company_id, created_at desc);

-- ------------------------------------------------------------ 2. km du RDV
alter table public.workshop_appointments add column if not exists mileage int;
alter table public.workshop_appointments drop constraint if exists workshop_appointments_mileage_chk;
alter table public.workshop_appointments add constraint workshop_appointments_mileage_chk
  check (mileage is null or mileage >= 0) not valid;
comment on column public.workshop_appointments.mileage is
  'Kilometrage annonce / releve a la prise du RDV ; repris sur l''OR cree depuis le RDV.';

-- ------------------------------------------------------------ 3. rappel RDV : SMS seulement si la case est cochee
create or replace function public._cron_appointment_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; _n int := 0;
begin
  for a in
    select ap.id, ap.company_id, ap.starts_at, ap.notify_sms, c.email, c.mobile, c.phone,
           coalesce(c.company_name, trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))) as name
    from public.workshop_appointments ap join public.contacts c on c.id = ap.contact_id
    where ap.status = 'prevu' and ap.starts_at::date = (current_date + 1)
  loop
    if coalesce(a.email,'') <> '' then
      perform public.enqueue_notification(a.company_id, 'email', a.email, 'Rappel de rendez-vous atelier',
        'Bonjour ' || a.name || ', nous vous rappelons votre rendez-vous atelier le ' || to_char(a.starts_at, 'DD/MM/YYYY à HH24:MI') || '.',
        'appointment_reminder', 'appointment', a.id::text);
      _n := _n + 1;
    end if;
    -- G8 « Programmer un envoi SMS pour rappel RDV » : le SMS part seulement si la case du RDV est cochee.
    if a.notify_sms and coalesce(a.mobile, a.phone, '') <> '' then
      perform public.enqueue_notification(a.company_id, 'sms', coalesce(a.mobile, a.phone),
        null, 'Rappel RDV atelier le ' || to_char(a.starts_at, 'DD/MM à HH24:MI') || '. A bientot.',
        'appointment_reminder', 'appointment', a.id::text || '-sms');
    end if;
  end loop;
  return _n;
end $$;
-- Meme droits qu'avant (securite S1) : la tache planifiee seulement.
revoke execute on function public._cron_appointment_reminders() from public, anon, authenticated;
grant execute on function public._cron_appointment_reminders() to service_role;
