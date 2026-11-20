/**
 * M6 — Opérateur au comptoir comme G8 (décision du client Q63, 20/11/2026). PDV001 VEN016
 *
 * Règles pures (testées dans tests/sales-operators.test.ts) :
 *  - les opérateurs viennent de Paramètres → Tables → « Opérateurs (vendeurs) »
 *    (reference_values, table_key = sales_operator) : code, nom, actif, type, compte lié (e-mail) ;
 *  - par défaut : l'opérateur relié à l'utilisateur connecté (même e-mail), s'il est actif ;
 *  - le NOM de l'opérateur est imprimé, jamais un e-mail (`operatorPrintName`, aussi pour les
 *    documents anciens dont le texte est un e-mail : partie avant « @ », en majuscules — la
 *    migration 20261120150000 les renomme en base, ceci couvre l'écran tant qu'elle n'est pas posée).
 * La base fait foi (trg_documents_operator) : opérateur actif de la société, nom recopié.
 */

export const SALES_OPERATOR_TABLE = 'sales_operator';
export const SALES_OPERATOR_KINDS = ['vendeur', 'atelier', 'chef_atelier', 'retrocession'] as const;
export type SalesOperatorKind = (typeof SALES_OPERATOR_KINDS)[number];

export type SalesOperator = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  kind: SalesOperatorKind;
  /** E-mail du compte DMS relié (facultatif). */
  email: string | null;
};

type RefLike = { id: string; code: string; label: string; is_active: boolean | null; extra: unknown; sort_order?: number | null };

/** Ligne reference_values → opérateur ; tri : actifs d'abord, puis ordre et nom. */
export function toSalesOperators(rows: ReadonlyArray<RefLike>): SalesOperator[] {
  return rows
    .map((r) => {
      const x = (r.extra && typeof r.extra === 'object' ? r.extra : {}) as Record<string, unknown>;
      const kind = SALES_OPERATOR_KINDS.includes(x.kind as SalesOperatorKind) ? (x.kind as SalesOperatorKind) : 'vendeur';
      const email = typeof x.email === 'string' && x.email.trim() ? x.email.trim().toLowerCase() : null;
      return { id: r.id, code: r.code, name: (r.label || r.code).trim(), isActive: r.is_active !== false, kind, email, _o: r.sort_order ?? 0 };
    })
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a._o - b._o || a.name.localeCompare(b.name, 'fr'))
    .map(({ _o: _drop, ...o }) => o);
}

/** Opérateurs proposés à la vente : les actifs, plus l'opérateur déjà posé sur le document s'il a été désactivé. */
export function selectableOperators(ops: ReadonlyArray<SalesOperator>, currentId?: string | null): SalesOperator[] {
  return ops.filter((o) => o.isActive || (!!currentId && o.id === currentId));
}

/** Défaut G8 : l'utilisateur connecté s'il est opérateur (actif, même e-mail). Sinon rien : il faut choisir. */
export function defaultOperatorId(ops: ReadonlyArray<SalesOperator>, userEmail: string | null | undefined): string | null {
  const e = (userEmail ?? '').trim().toLowerCase();
  if (!e) return null;
  return ops.find((o) => o.isActive && o.email === e)?.id ?? null;
}

/**
 * Choix obligatoire (G8 : « Opérateur » obligatoire à la saisie) dès que la société a des
 * opérateurs actifs. Sans référentiel (société neuve), la base pose l'utilisateur connecté.
 */
export function operatorMissing(ops: ReadonlyArray<SalesOperator>, chosenId: string | null | undefined): boolean {
  return ops.some((o) => o.isActive) && !chosenId;
}

/** Nom imprimé : jamais un e-mail (partie avant « @ », en majuscules). */
export function operatorPrintName(operator: string | null | undefined): string {
  const s = (operator ?? '').trim();
  if (!s) return '';
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at).toUpperCase() : at === 0 ? '' : s;
}

/** Erreur de la base sur l'opérateur (hint du déclencheur) → clé i18n, sinon null. */
export function operatorErrorKey(e: unknown): 'q63.errUnknown' | 'q63.errLocked' | null {
  const hint = (e as { hint?: string } | null)?.hint;
  if (hint === 'operator_unknown') return 'q63.errUnknown';
  if (hint === 'operator_locked') return 'q63.errLocked';
  return null;
}
