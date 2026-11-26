/**
 * M1 — Plusieurs e-mails par fiche (CON002, 26/11/2026). Règles pures, testées (tests/contact-emails.test.ts).
 *
 * Les mêmes règles tournent en base (migration 20261126300000) :
 *   - une fiche « porte » une adresse si c'est son e-mail principal, son e-mail pro G8 ou un de
 *     ses e-mails secondaires (table contact_emails), sans tenir compte de la casse ni des espaces ;
 *   - deux fiches sont homonymes si elles ont le même prénom + nom (dans un sens ou dans l'autre,
 *     sans accents, tirets et espaces multiples comptés comme un espace) ou le même nom de société.
 *     Un mail d'une adresse inconnue au nom d'un homonyme n'ouvre plus de fiche : il attend qu'on
 *     choisisse à qui le rattacher (cloche, « Mails à rattacher »).
 */

export type EmailKind = 'pro' | 'prive';

/** Une adresse de la fiche, telle que lue dans contact_emails. */
export type ContactEmailRow = {
  id: string;
  contact_id: string;
  email: string;
  kind: EmailKind | null;
  is_primary: boolean;
  source: 'fiche' | 'fiche_pro' | 'ajout' | 'mail' | 'fusion';
  created_at: string;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

/** Adresse comparable : minuscules, sans espaces autour ; vide → null. */
export function normEmail(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase();
  return s ? s : null;
}

export function isValidEmail(v: string | null | undefined): boolean {
  const s = normEmail(v);
  return !!s && EMAIL_RE.test(s);
}

/** Ce qu'il faut savoir d'une fiche pour dire si elle porte une adresse. */
export type EmailOwner = {
  email?: string | null;
  email_pro?: string | null;
  /** E-mails secondaires (contact_emails). */
  extra?: ReadonlyArray<string | null | undefined>;
};

/** La fiche porte-t-elle cette adresse (principale, pro ou secondaire) ? */
export function ownsEmail(c: EmailOwner, email: string | null | undefined): boolean {
  const e = normEmail(email);
  if (!e) return false;
  return [c.email, c.email_pro, ...(c.extra ?? [])].some((x) => normEmail(x) === e);
}

/**
 * Fiches qui portent l'adresse, dans l'ordre où la relève mail les prend : une fiche active
 * d'abord, puis la plus ancienne. La première est celle qui reçoit le mail.
 */
export function contactsByEmail<T extends EmailOwner & { id: string; is_active?: boolean | null; created_at?: string | null }>(
  contacts: ReadonlyArray<T>, email: string | null | undefined,
): T[] {
  return contacts
    .filter((c) => ownsEmail(c, email))
    .sort((a, b) => {
      const act = Number(b.is_active !== false) - Number(a.is_active !== false);
      if (act !== 0) return act;
      return (a.created_at ?? '').localeCompare(b.created_at ?? '');
    });
}

/** Clé de comparaison d'un nom : sans accents ni casse, tirets et espaces répétés = un espace. */
export function nameKey(v: string | null | undefined): string | null {
  const s = (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, ' ')
    .trim();
  return s ? s : null;
}

export type NameProbe = { first_name?: string | null; last_name?: string | null; company_name?: string | null };

/**
 * Pourquoi la fiche `c` est un homonyme de la personne `p` : même prénom + nom (les deux
 * sont exigés, dans un sens ou dans l'autre), ou même nom de société. null = pas homonyme.
 */
export function homonymReason(p: NameProbe, c: NameProbe): 'nom' | 'societe' | null {
  const f = nameKey(p.first_name);
  const l = nameKey(p.last_name);
  if (f && l) {
    const cand = nameKey([c.first_name, c.last_name].filter(Boolean).join(' '));
    if (cand && (cand === `${f} ${l}` || cand === `${l} ${f}`)) return 'nom';
  }
  const co = nameKey(p.company_name);
  if (co && nameKey(c.company_name) === co) return 'societe';
  return null;
}

/** Fiches actives homonymes de la personne (les employés ne comptent pas). */
export function findHomonyms<T extends NameProbe & { id: string; is_active?: boolean | null; type?: string | null }>(
  p: NameProbe, contacts: ReadonlyArray<T>,
): T[] {
  return contacts.filter((c) => c.is_active !== false && c.type !== 'employe' && homonymReason(p, c) !== null);
}

export type NewEmailCheck = 'ok' | 'empty' | 'invalid' | 'exists';

/** Contrôle d'une adresse avant de l'ajouter à une fiche qui porte déjà `existing`. */
export function checkNewEmail(input: string | null | undefined, existing: ReadonlyArray<string | null | undefined>): NewEmailCheck {
  const e = normEmail(input);
  if (!e) return 'empty';
  if (!EMAIL_RE.test(e)) return 'invalid';
  if (existing.some((x) => normEmail(x) === e)) return 'exists';
  return 'ok';
}

/** Les « Autres e-mails » de la fiche : tout sauf le principal, les plus anciens d'abord. */
export function otherEmails(rows: ReadonlyArray<ContactEmailRow>): ContactEmailRow[] {
  return rows.filter((r) => !r.is_primary).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
