-- =====================================================================
-- M6 — RATTRAPAGE G8 « ENCAISSEMENTS » (18/11/2026), 2/5 : RELANCES D IMPAYES
-- Ref. G8 : Encaissements > Gestion des relances (Lettre de relance : modeles 01 Releve de factures,
-- 02 Premiere relance, 03 Deuxieme relance, 04 Dernier rappel - Let AR ; format A4 / Ticket ; niveau,
-- agio %, montant minimum, 4 blocs de texte) et ecran « Relances » (factures a echeance jusqu au,
-- type de relance a envoyer / deja traitee, montant frais, majorer de %, grille avec type, date et
-- media de la derniere relance, envoi par mail avec facture jointe, edition). Fiche client, onglet
-- Relances (n° facture, date, mode, type, adresse). Inventaire 06-ventes-caisse.md et 01-clients.md ;
-- comparaison section 2, bloquant #11.
--
-- ENVOI : par le canal existant du DMS (Outlook / Microsoft Graph, fonction `graph-send-email`),
-- EN MODE TEST UNIQUEMENT (decision du 03/11, journal : « relances = test -> simon@themaul.be »).
-- `receivable_settings.dunning_mode` n accepte que `arrete` ou `test` : le mode reel (`actif`) est
-- IMPOSSIBLE tant qu une migration ulterieure ne l ouvre pas (jour J, apres recette). En test, tout
-- part a l adresse de test (celle des relances, sinon celle des relances d entretien
-- `followup_settings.test_recipient`), objet prefixe « [TEST relance pour <client>] ». La fonction
-- `graph-send-email` (redeployee) refait ce controle cote serveur pour tout envoi `purpose: dunning`.
--
-- CE QUE POSE CETTE MIGRATION
--   1. `receivable_settings` (un reglage par societe) : mode des relances (test par defaut),
--      adresse de test, nombre d echeances par defaut (12, G8), validite et minimum des bons d achat.
--   2. `dunning_templates` : modeles de lettres 01-04 editables (niveau, format, minimum, frais fixes,
--      majoration %, objet, 4 blocs de texte avec variables {client}, {date}, {total_du}, {frais},
--      {total_a_payer}, {societe}, {iban}). Precharges pour chaque societe (textes A FAIRE RELIRE).
--   3. `dunning_letters` : historique APPEND-ONLY des relances (qui, quand, quelle facture, quel modele,
--      quel media, a quelle adresse, test ou non, montant du, frais) -> onglet Relances de la fiche.
--   4. `dunning_candidates` : factures echues a relancer (ou avoirs / trop-percus pour les
--      crediteurs), derniere relance (modele, date, media), modele suivant propose.
--   5. `receivable_settings_get` / `receivable_settings_set` (admin, trace `events`).
--
-- Idempotente. NON APPLIQUEE. Suppose 20261118170000 posee juste avant.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reglages par societe.
-- ---------------------------------------------------------------------
create table if not exists public.receivable_settings (
  company_id             uuid primary key references public.companies(id) on delete cascade,
  dunning_mode           text not null default 'test' check (dunning_mode in ('arrete', 'test')),
  dunning_test_recipient text,
  default_installments   int  not null default 12 check (default_installments between 1 and 60),
  voucher_validity_days  int  not null default 365 check (voucher_validity_days between 1 and 3650),
  voucher_min_amount     numeric(14,2) not null default 0 check (voucher_min_amount >= 0),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id) on delete set null
);
comment on table public.receivable_settings is
  'Encaissements (rattrapage G8) : mode des relances d impayes (arrete / test ; le reel est volontairement impossible), '
  'adresse de test, echeancier par defaut, bons d achat (validite, minimum).';

drop trigger if exists trg_receivable_settings_updated on public.receivable_settings;
create trigger trg_receivable_settings_updated before update on public.receivable_settings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_receivable_settings_audit on public.receivable_settings;
create trigger trg_receivable_settings_audit after insert or update or delete on public.receivable_settings
  for each row execute function public.audit_row();

alter table public.receivable_settings enable row level security;
revoke all on public.receivable_settings from anon;
revoke insert, update, delete on public.receivable_settings from authenticated;
grant select on public.receivable_settings to authenticated;
drop policy if exists receivable_settings_select on public.receivable_settings;
create policy receivable_settings_select on public.receivable_settings for select to authenticated
  using (public.is_member(company_id));

create or replace function public.receivable_settings_get(_company uuid)
returns table(dunning_mode text, dunning_test_recipient text, effective_test_recipient text,
              default_installments int, voucher_validity_days int, voucher_min_amount numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _s public.receivable_settings; _fallback text;
begin
  if auth.uid() is not null and not public.is_member(_company) then return; end if;
  select * into _s from public.receivable_settings where company_id = _company;
  -- Repli : adresse de test des relances d entretien (20261103140000), si la table existe.
  if to_regclass('public.followup_settings') is not null then
    execute 'select test_recipient from public.followup_settings where company_id = $1' into _fallback using _company;
  end if;
  dunning_mode := coalesce(_s.dunning_mode, 'test');
  dunning_test_recipient := _s.dunning_test_recipient;
  effective_test_recipient := coalesce(nullif(btrim(_s.dunning_test_recipient), ''), nullif(btrim(_fallback), ''));
  default_installments := coalesce(_s.default_installments, 12);
  voucher_validity_days := coalesce(_s.voucher_validity_days, 365);
  voucher_min_amount := coalesce(_s.voucher_min_amount, 0);
  return next;
end $$;
revoke all on function public.receivable_settings_get(uuid) from public, anon;
grant execute on function public.receivable_settings_get(uuid) to authenticated, service_role;

-- _patch : cles facultatives dunning_mode, dunning_test_recipient, default_installments,
-- voucher_validity_days, voucher_min_amount. Administrateur seulement.
create or replace function public.receivable_settings_set(_company uuid, _patch jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare _old jsonb; _mode text; _rcpt text;
begin
  if auth.uid() is not null and not public.is_admin(_company) then
    raise exception 'Reserve aux administrateurs.' using errcode = '42501';
  end if;
  _mode := _patch->>'dunning_mode';
  if _mode is not null and _mode not in ('arrete', 'test') then
    raise exception 'Mode des relances : arrete ou test seulement (l envoi reel aux clients n est pas ouvert).' using errcode = '23514';
  end if;
  _rcpt := nullif(btrim(coalesce(_patch->>'dunning_test_recipient', '')), '');
  if _rcpt is not null and _rcpt !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' then
    raise exception 'Adresse de test invalide : %', _rcpt using errcode = '23514';
  end if;
  select to_jsonb(s) into _old from public.receivable_settings s where company_id = _company;
  insert into public.receivable_settings (company_id) values (_company) on conflict (company_id) do nothing;
  update public.receivable_settings set
    dunning_mode           = coalesce(_mode, dunning_mode),
    dunning_test_recipient = case when _patch ? 'dunning_test_recipient' then lower(_rcpt) else dunning_test_recipient end,
    default_installments   = coalesce((_patch->>'default_installments')::int, default_installments),
    voucher_validity_days  = coalesce((_patch->>'voucher_validity_days')::int, voucher_validity_days),
    voucher_min_amount     = coalesce((_patch->>'voucher_min_amount')::numeric, voucher_min_amount),
    updated_by             = auth.uid()
  where company_id = _company;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'receivable_settings_set', 'receivable_settings', _company::text, 'screen', _old, _patch);
end $$;
revoke all on function public.receivable_settings_set(uuid, jsonb) from public, anon;
grant execute on function public.receivable_settings_set(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Modeles de lettres de relance.
-- ---------------------------------------------------------------------
create table if not exists public.dunning_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  code          text not null,                         -- 01, 02, 03, 04 (G8)
  label         text not null,
  level         int  not null default 1 check (level between 0 and 9),
  format        text not null default 'A4' check (format in ('A4', 'ticket')),
  min_amount    numeric(14,2) not null default 0 check (min_amount >= 0),
  fee_fixed     numeric(14,2) not null default 0 check (fee_fixed >= 0),
  surcharge_pct numeric(6,2)  not null default 0 check (surcharge_pct >= 0 and surcharge_pct <= 100),
  subject       text not null default '',
  header_text   text not null default '',
  body_text     text not null default '',
  closing_text  text not null default '',
  footer_text   text not null default '',
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  updated_at    timestamptz not null default now(),
  unique (company_id, code)
);
comment on table public.dunning_templates is
  'G8 « Lettre de relance » : modeles 01-04 (niveau, format A4 / ticket, montant minimum, frais fixes, majoration %, 4 blocs de texte).';

drop trigger if exists trg_dunning_templates_updated on public.dunning_templates;
create trigger trg_dunning_templates_updated before update on public.dunning_templates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_dunning_templates_audit on public.dunning_templates;
create trigger trg_dunning_templates_audit after insert or update or delete on public.dunning_templates
  for each row execute function public.audit_row();

alter table public.dunning_templates enable row level security;
revoke all on public.dunning_templates from anon;
grant select, insert, update, delete on public.dunning_templates to authenticated;
drop policy if exists dunning_templates_all on public.dunning_templates;
create policy dunning_templates_all on public.dunning_templates for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Prechargement (textes de depart en FR, A FAIRE RELIRE par Domenico / le comptable).
insert into public.dunning_templates (company_id, code, label, level, format, min_amount, fee_fixed, surcharge_pct, subject, header_text, body_text, closing_text, footer_text, sort_order)
select c.id, t.code, t.label, t.level, 'A4', t.min_amount, t.fee_fixed, t.surcharge_pct, t.subject, t.header_text, t.body_text, t.closing_text, t.footer_text, t.sort_order
  from public.companies c
 cross join (values
   ('01', 'Releve de factures', 0, 0::numeric, 0::numeric, 0::numeric,
    'Releve de vos factures en attente de reglement',
    'Madame, Monsieur {client},',
    'Sauf erreur de notre part, les factures ci-dessous restent ouvertes dans nos livres a la date du {date}. Vous trouverez le detail ci-dessous.',
    'Si votre reglement nous est deja parvenu, merci de ne pas tenir compte de ce releve.',
    'Reglement par virement sur le compte {iban} en mentionnant le numero de facture.', 10),
   ('02', 'Premiere relance', 1, 0::numeric, 0::numeric, 0::numeric,
    'Rappel : facture(s) echue(s)',
    'Madame, Monsieur {client},',
    'Nous constatons que le reglement des factures ci-dessous, arrivees a echeance, ne nous est pas encore parvenu. Le montant restant du s eleve a {total_du}.',
    'Nous vous remercions de bien vouloir proceder au reglement dans les meilleurs delais. Si votre paiement s est croise avec ce courrier, merci de ne pas en tenir compte.',
    'Reglement par virement sur le compte {iban} en mentionnant le numero de facture.', 20),
   ('03', 'Deuxieme relance', 2, 0::numeric, 0::numeric, 0::numeric,
    'Deuxieme rappel : facture(s) impayee(s)',
    'Madame, Monsieur {client},',
    'Malgre notre precedent rappel, les factures ci-dessous restent impayees. Montant du : {total_du}. Frais de rappel : {frais}. Total a payer : {total_a_payer}.',
    'Nous vous prions de regulariser cette situation sous huit jours.',
    'Reglement par virement sur le compte {iban} en mentionnant le numero de facture.', 30),
   ('04', 'Dernier rappel - lettre recommandee', 3, 0::numeric, 0::numeric, 0::numeric,
    'Dernier rappel avant mise en demeure',
    'Madame, Monsieur {client},',
    'En l absence de reglement des factures ci-dessous malgre nos rappels, nous vous adressons ce dernier rappel. Montant du : {total_du}. Frais : {frais}. Total a payer : {total_a_payer}.',
    'Sans reglement de votre part sous huit jours, nous serons contraints de transmettre le dossier a notre service contentieux, sans autre avis.',
    'Courrier envoye par recommande avec accuse de reception.', 40)
 ) as t(code, label, level, min_amount, fee_fixed, surcharge_pct, subject, header_text, body_text, closing_text, footer_text, sort_order)
on conflict (company_id, code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Historique des relances (append-only).
-- ---------------------------------------------------------------------
create table if not exists public.dunning_letters (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  batch_id      uuid not null,                          -- une lettre peut couvrir plusieurs factures
  contact_id    uuid references public.contacts(id) on delete set null,
  document_id   uuid references public.documents(id) on delete set null,
  template_code text not null,
  template_label text,
  level         int not null default 0,
  media         text not null check (media in ('mail', 'courrier', 'pdf')),
  sent_to       text,                                   -- adresse reellement utilisee (test : adresse de test)
  is_test       boolean not null default false,
  with_invoice  boolean not null default false,
  amount_due    numeric(14,2) not null default 0,
  fees          numeric(14,2) not null default 0,
  subject       text,
  sent_at       timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null default auth.uid()
);
create index if not exists idx_dunning_letters_document on public.dunning_letters(document_id, sent_at desc);
create index if not exists idx_dunning_letters_contact on public.dunning_letters(contact_id, sent_at desc);
create index if not exists idx_dunning_letters_company on public.dunning_letters(company_id, sent_at desc);
comment on table public.dunning_letters is
  'Historique append-only des relances d impayes (fiche client > Relances ; G8 : derniere relance, date, media).';

-- Auteur et date poses par la base (pas par le navigateur).
create or replace function public.dunning_letters_stamp()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.sent_at := now();
  end if;
  if new.document_id is not null and not exists (select 1 from public.documents d where d.id = new.document_id and d.company_id = new.company_id) then
    raise exception 'Relance : le document n appartient pas a la societe.' using errcode = '23514';
  end if;
  if new.contact_id is not null and not exists (select 1 from public.contacts c where c.id = new.contact_id and c.company_id = new.company_id) then
    raise exception 'Relance : le client n appartient pas a la societe.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.dunning_letters_stamp() from public, anon, authenticated;
drop trigger if exists trg_dunning_letters_stamp on public.dunning_letters;
create trigger trg_dunning_letters_stamp before insert on public.dunning_letters
  for each row execute function public.dunning_letters_stamp();
drop trigger if exists trg_dunning_letters_audit on public.dunning_letters;
create trigger trg_dunning_letters_audit after insert on public.dunning_letters
  for each row execute function public.audit_row();

alter table public.dunning_letters enable row level security;
revoke all on public.dunning_letters from anon;
revoke update, delete on public.dunning_letters from authenticated;
grant select, insert on public.dunning_letters to authenticated;
drop policy if exists dunning_letters_select on public.dunning_letters;
create policy dunning_letters_select on public.dunning_letters for select to authenticated
  using (public.is_member(company_id));
drop policy if exists dunning_letters_insert on public.dunning_letters;
create policy dunning_letters_insert on public.dunning_letters for insert to authenticated
  with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 4. Factures a relancer.
--    _side : 'debit' (reste du > 0 : factures echues) | 'credit' (reste du < 0 : avoirs non
--    rembourses, trop-percus). Echeance = due_date, sinon date du document.
--    _last_code : null = toutes ; '' = jamais relancees ; sinon dernier modele envoye.
-- ---------------------------------------------------------------------
create or replace function public.dunning_candidates(
  _company uuid, _due_to date default current_date, _side text default 'debit',
  _contact uuid default null, _min_amount numeric default 0, _last_code text default null
) returns table(
  document_id uuid, doc_type text, number text, issue_date date, due_date date, total_ttc numeric,
  amount_due numeric, scheduled numeric, contact_id uuid, contact_code text, contact_name text, email text,
  accounting_account text, last_code text, last_label text, last_level int, last_date timestamptz,
  last_media text, last_is_test boolean, next_code text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with docs as (
    select d.*, round(d.total_ttc - d.paid_amount, 2) as due
      from public.documents d
     where d.company_id = _company and (auth.uid() is null or public.is_member(_company))
       and d.doc_type in ('FAC', 'FAA', 'TIK', 'AVO')
       and d.status not in ('brouillon', 'annulee', 'converti')
       and d.contact_id is not null
       and coalesce(d.due_date, d.issue_date) <= coalesce(_due_to, current_date)
       and (_contact is null or d.contact_id = _contact)
  )
  select d.id, d.doc_type, d.number, d.issue_date, coalesce(d.due_date, d.issue_date), d.total_ttc, d.due,
         coalesce((select sum(p.amount) from public.document_payments p where p.document_id = d.id and p.status = 'attendu'), 0),
         c.id, c.code::text,
         coalesce(nullif(btrim(c.company_name), ''), btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))),
         coalesce(nullif(btrim(c.email), ''), nullif(btrim(c.email_pro), '')),
         c.accounting_account::text,
         l.template_code, l.template_label, l.level, l.sent_at, l.media, l.is_test,
         coalesce(
           (select t.code from public.dunning_templates t
             where t.company_id = _company and t.is_active and t.level > coalesce(l.level, -1)
             order by t.level, t.sort_order limit 1),
           (select t.code from public.dunning_templates t
             where t.company_id = _company and t.is_active order by t.level desc, t.sort_order desc limit 1))
    from docs d
    join public.contacts c on c.id = d.contact_id
    left join lateral (
      select dl.template_code, dl.template_label, dl.level, dl.sent_at, dl.media, dl.is_test
        from public.dunning_letters dl where dl.document_id = d.id
       order by dl.sent_at desc limit 1
    ) l on true
   where case when coalesce(_side, 'debit') = 'credit' then d.due < -0.005
              else d.due > 0.005 and d.due >= coalesce(_min_amount, 0) end
     and (_last_code is null or (_last_code = '' and l.template_code is null) or l.template_code = _last_code)
   order by 11, coalesce(d.due_date, d.issue_date), d.number;
$$;
revoke all on function public.dunning_candidates(uuid, date, text, uuid, numeric, text) from public, anon;
grant execute on function public.dunning_candidates(uuid, date, text, uuid, numeric, text) to authenticated;
