-- =====================================================================
-- MISSION 04 — CARTE 4 (1/2) : « E-mail en minuscules… ».
-- Migration STRICTEMENT ADDITIVE (une fonction, un déclencheur). Aucune fiche
-- existante n'est réécrite par cette migration.
--
-- Toute adresse e-mail ENREGISTRÉE sur une fiche (comptoir, borne, espace client,
-- CRM, relève mail, import) est mise en minuscules et sans espaces autour, par la
-- base elle-même : BEFORE INSERT, et BEFORE UPDATE seulement si l'e-mail change
-- (une modification d'un autre champ ne touche pas un e-mail repris de G8).
--
-- Vérifié le 19/09 avant d'écrire ce déclencheur : aucune contrainte UNIQUE sur
-- contacts.email (index simple idx_contacts_email). 7 fiches ont un e-mail avec des
-- majuscules ; une seule paire ne diffère QUE par la casse (codes 231 et 8293,
-- fredgilson_1@msn.com) : on ne les réécrit pas, elles relèvent de la fusion (D3).
-- =====================================================================

create or replace function public.trg_contacts_normalize_email()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    new.email := nullif(lower(btrim(new.email)), '');
  end if;
  return new;
end $fn$;
comment on function public.trg_contacts_normalize_email() is
  'Mission 04 carte 4 : e-mail d''une fiche en minuscules, sans espaces (à l''insertion et quand l''e-mail change).';
revoke all on function public.trg_contacts_normalize_email() from public, anon, authenticated;

drop trigger if exists trg_contacts_normalize_email on public.contacts;
create trigger trg_contacts_normalize_email
  before insert or update of email on public.contacts
  for each row execute function public.trg_contacts_normalize_email();
