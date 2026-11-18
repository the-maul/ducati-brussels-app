/**
 * M8 — OR accident cote assureur, regles pures (rattrapage G8 du 18/11/2026).
 *
 * G8 (07-atelier.md §1 onglet Assurance, §12) : cabinet d'assurance et expert choisis dans un
 * fichier (« Fiche assurance » : coordonnees, compte comptable, code tarif), date de passage de
 * l'expert, franchise a percevoir en montant ou en %, valeur venale, cote, « Accepter demarrage
 * des travaux », document specifique « accident ». Dans le DMS ces donnees vivent sur le DOSSIER
 * ACCIDENT de l'OR (un seul dossier par OR, ouvert automatiquement) : pas de doublon.
 *
 * Aucun import d'alias ici : fichier teste tel quel.
 */

export const INSURANCE_PARTY_KINDS = ['cabinet', 'expert'] as const;
export type InsurancePartyKind = (typeof INSURANCE_PARTY_KINDS)[number];

export const DEDUCTIBLE_KINDS = ['montant', 'pourcentage'] as const;
export type DeductibleKind = (typeof DEDUCTIBLE_KINDS)[number];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Saisie « 250 », « 250,50 », « 10 % » → nombre positif, sinon null. */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[%€\s]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? r2(n) : null;
}

/**
 * Franchise a percevoir aupres du client, en euros : le montant saisi, ou le pourcentage du
 * montant TTC de l'OR. Un pourcentage au-dela de 100 est refuse (null).
 */
export function deductibleAmount(kind: DeductibleKind | string | null | undefined, value: number | string | null | undefined, orTotalTtc: number | string | null | undefined): number | null {
  const v = parseAmount(value as string | number | null | undefined);
  if (v == null) return null;
  if (kind === 'pourcentage') {
    if (v > 100) return null;
    const base = Number(orTotalTtc) || 0;
    return r2((base * v) / 100);
  }
  return v;
}

/** Affichage court de la franchise : « 250,00 € » ou « 10 % (35,00 €) ». */
export function deductibleLabel(kind: string | null | undefined, value: number | string | null | undefined, orTotalTtc: number | string | null | undefined, fmtEur: (n: number) => string): string {
  const v = parseAmount(value as string | number | null | undefined);
  if (v == null) return '—';
  if (kind === 'pourcentage') {
    const amount = deductibleAmount(kind, v, orTotalTtc);
    const pct = `${String(v).replace('.', ',')} %`;
    return amount == null ? pct : `${pct} (${fmtEur(amount)})`;
  }
  return fmtEur(v);
}

/** Cocher / decocher « Demarrage des travaux accepte » : qui et quand (trace), efface si decoche. */
export function workStartPatch(accepted: boolean, userId: string | null, nowIso: string): { work_start_accepted: boolean; work_start_accepted_at: string | null; work_start_accepted_by: string | null } {
  return accepted
    ? { work_start_accepted: true, work_start_accepted_at: nowIso, work_start_accepted_by: userId }
    : { work_start_accepted: false, work_start_accepted_at: null, work_start_accepted_by: null };
}

export type InsurancePartyDraft = {
  kind: string; code?: string | null; name: string; email?: string | null; vat_number?: string | null;
};

/** Controle de la fiche : type connu, nom obligatoire, e-mail plausible. Renvoie les cles d'erreur. */
export function validateInsuranceParty(p: InsurancePartyDraft): string[] {
  const errs: string[] = [];
  if (!(INSURANCE_PARTY_KINDS as readonly string[]).includes(p.kind)) errs.push('kind');
  if (!p.name || !p.name.trim()) errs.push('name');
  const mail = (p.email ?? '').trim();
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) errs.push('email');
  return errs;
}

/** Libelle de liste : « CODE — Nom (Ville) ». */
export function insurancePartyLabel(p: { code?: string | null; name: string; city?: string | null }): string {
  const head = [p.code?.trim(), p.name.trim()].filter(Boolean).join(' — ');
  return p.city?.trim() ? `${head} (${p.city.trim()})` : head;
}
