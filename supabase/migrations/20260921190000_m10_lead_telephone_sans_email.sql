-- =====================================================================
-- MISSION 01 / M10 — Carte ERP « Carte CRM seulement si le client demande à être recontacté »
-- Retour client du 21/09 : « Ne pas laisser la possibilité de mettre un mail dans champs
-- téléphone. » Capture : fenêtre d'une carte CRM, champ TÉLÉPHONE = « +32 | adresse e-mail ».
--
-- Le téléphone de la CARTE n'est pas celui de la fiche client : il est stocké dans
-- `leads.phone` (colonne propre à la carte), que le garde-fou de la migration
-- 20260921160000 (table `contacts`) ne couvre pas. Même règle ici :
--
--   1. RÉPARE les cartes existantes dont `phone` contient « @ » : l'adresse va dans
--      `leads.email` s'il est vide, sinon le champ est vidé. Une ligne `events` par carte
--      (action `lead_phone_email_repair`, origine `system`) avec les anciennes valeurs.
--   2. GARDE-FOU pour toutes les entrées (carte ouverte à la main, relève des mails,
--      inscription, reprise, API) : déclencheur BEFORE INSERT/UPDATE OF phone, tracé
--      dans `events` (action `lead_phone_email_guard`).
--
-- À l'écran (même lot) : la fenêtre de la carte et « Nouvelle demande » utilisent le
-- composant téléphone (préfixe pays + numéro), refusent l'enregistrement d'un numéro
-- invalide avec un message, et enregistrent au format E.164 (+32470123456).
--
-- DÉPEND DE : 20260921160000_m1_telephone_sans_email_permis_verso.sql
--   (fonction public.contact_email_in_phone). À appliquer après elle.
-- NON DESTRUCTIVE : aucune colonne ni table supprimée ; valeurs retirées gardées dans events.
-- =====================================================================

-- ------------------------------------------------ 1. Réparation des cartes existantes
do $$
declare
  _l     record;
  _cand  text;
  _email text;
  _n     integer := 0;
begin
  for _l in
    select id, company_id, email, phone
      from public.leads
     where position('@' in coalesce(phone, '')) > 0
     order by id
     for update
  loop
    _email := nullif(btrim(coalesce(_l.email, '')), '');
    _cand := public.contact_email_in_phone(_l.phone);
    if _email is null and _cand is not null then _email := _cand; end if;

    update public.leads set phone = null, email = _email where id = _l.id;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_l.company_id, null, 'lead_phone_email_repair', 'leads', _l.id::text, 'system',
            jsonb_build_object('email', _l.email, 'phone', _l.phone),
            jsonb_build_object('email', _email, 'phone', null,
                               'reason', 'Adresse e-mail trouvée dans le téléphone de la carte (migration 20260921190000)'));
    _n := _n + 1;
  end loop;
  raise notice 'lead_phone_email_repair : % carte(s) corrigée(s)', _n;
end $$;

-- ------------------------------------------------ 2. Garde-fou pour les prochaines saisies
create or replace function public.trg_leads_phone_not_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _old  jsonb := jsonb_build_object('email', new.email, 'phone', new.phone);
  _cand text;
begin
  if position('@' in coalesce(new.phone, '')) = 0 then
    return new;
  end if;

  _cand := public.contact_email_in_phone(new.phone);
  if nullif(btrim(coalesce(new.email, '')), '') is null and _cand is not null then
    new.email := _cand;
  end if;
  new.phone := null;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (new.company_id, auth.uid(), 'lead_phone_email_guard', 'leads', new.id::text, 'system',
          _old,
          jsonb_build_object('email', new.email, 'phone', new.phone,
                             'reason', 'Adresse e-mail refusée dans le téléphone de la carte'));
  return new;
end $fn$;
comment on function public.trg_leads_phone_not_email() is
  'Retour client 21/09 (carte CRM) : une adresse e-mail n''est jamais enregistrée comme téléphone de la carte '
  '(leads.phone) ; elle va dans leads.email s''il est vide, sinon le champ est vidé. Tracé dans events.';
revoke all on function public.trg_leads_phone_not_email() from public, anon, authenticated;

drop trigger if exists trg_leads_phone_not_email on public.leads;
create trigger trg_leads_phone_not_email
  before insert or update of phone on public.leads
  for each row execute function public.trg_leads_phone_not_email();

comment on column public.leads.phone is
  'Téléphone de la carte, format E.164 (+32470123456) depuis le 21/09. Jamais une adresse e-mail '
  '(garde-fou trg_leads_phone_not_email).';
