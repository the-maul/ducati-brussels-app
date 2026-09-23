/**
 * M8 — Kits de pièces d'entretien (mission 07, carte 2 ; décision M-20).
 *
 * Règles PURES, testées par `tests/maintenance-kits.test.ts`. Elles sont le miroir des
 * fonctions SQL `maintenance_deduce_parts`, `maintenance_kit_generate`,
 * `repair_order_order_needs` et `picking_order_needs` (migrations 20260923160000 à
 * 20260923163000). **Le serveur fait foi** : ces fonctions servent à expliquer, à
 * pré-calculer l'affichage et à verrouiller le comportement par des tests.
 *
 * Trois étages, dans cet ordre :
 *   1. BESOIN   — le libellé d'une opération du manuel dit qu'il faut une pièce
 *                 (« Remplacement des bougies ») ou non (« Contrôle des bougies ») ;
 *   2. PIÈCE    — on cherche la référence dans les vues éclatées du catalogue Ducati
 *                 DU MODÈLE-ANNÉE concerné ; plusieurs références = soit toutes
 *                 nécessaires (2 courroies), soit une ambiguïté à trancher par l'atelier ;
 *   3. MANQUANT — besoin − libre − en commande − déjà en brouillon.
 *
 * Rien n'est inventé : ce qui n'est pas sûr sort en `a_confirmer`.
 */

/** Famille de pièce d'entretien (table `maintenance_part_families`). */
export type PartFamilyKind = 'piece' | 'consommable';

export type PartFamily = {
  code: string;
  label: string;
  kind: PartFamilyKind;
  /** Absente du catalogue = non applicable à ce modèle (joint de bougie, crépine…). */
  optional: boolean;
  unit?: string | null;
};

/** Règle « libellé d'opération → besoin » (table `maintenance_part_need_rules`). */
export type NeedRule = { familyCode: string; pattern: string };

/** Règle « besoin → référence du catalogue » (table `maintenance_part_catalog_rules`). */
export type CatalogRule = {
  familyCode: string;
  includeRe: string;
  excludeRe?: string | null;
  drawingRe?: string | null;
  drawingExcludeRe?: string | null;
  /** Vrai : plusieurs références = plusieurs pièces à prendre. Faux : variantes à trancher. */
  takeAll?: boolean;
};

/** Une ligne d'une vue éclatée du catalogue Ducati. */
export type CatalogLine = {
  drawingId: string;
  drawingDescription: string;
  position?: string | null;
  reference: string;
  description: string;
  quantity?: number | null;
};

export type Confidence = 'sur' | 'a_confirmer' | 'non_applicable';

/** Une pièce déduite pour une échéance d'entretien. */
export type DeducedPart = {
  familyCode: string;
  kind: PartFamilyKind;
  optional: boolean;
  references: string[];
  quantity: number | null;
  confidence: Confidence;
};

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Les vues d'outillage ne contiennent jamais une pièce d'entretien. */
const TOOL_DRAWING = /OUTILS SPECIAUX/;

/**
 * Étage 1 — quelles familles de pièces un jeu de libellés d'opérations réclame.
 * Les libellés arrivent tels quels ; la comparaison se fait en minuscules, comme en SQL.
 */
export function deduceFamilies(labels: string[], rules: NeedRule[]): string[] {
  const found = new Set<string>();
  const lowered = labels.map((l) => (l ?? '').toLowerCase());
  for (const r of rules) {
    let re: RegExp;
    try {
      re = new RegExp(r.pattern);
    } catch {
      continue; // une règle mal écrite ne doit jamais casser la déduction
    }
    if (lowered.some((l) => re.test(l))) found.add(r.familyCode);
  }
  return [...found];
}

/** Est-ce que cette ligne du catalogue répond à la règle ? */
export function catalogLineMatches(line: CatalogLine, rule: CatalogRule): boolean {
  const drawing = (line.drawingDescription ?? '').toUpperCase();
  const descr = (line.description ?? '').toUpperCase();
  if (TOOL_DRAWING.test(drawing)) return false;
  try {
    if (!new RegExp(rule.includeRe).test(descr)) return false;
    if (rule.excludeRe && new RegExp(rule.excludeRe).test(descr)) return false;
    if (rule.drawingRe && !new RegExp(rule.drawingRe).test(drawing)) return false;
    if (rule.drawingExcludeRe && new RegExp(rule.drawingExcludeRe).test(drawing)) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * Étage 2 — résoudre une famille en références du catalogue de ce modèle-année.
 * La quantité vient de la colonne « quantité » de la vue éclatée (2 bougies sur un
 * bicylindre, 4 sur un V4, 2 courroies), jamais d'une supposition.
 */
export function resolveFamily(
  family: PartFamily,
  rule: CatalogRule | undefined,
  lines: CatalogLine[],
): DeducedPart[] {
  if (!rule) {
    return [{ familyCode: family.code, kind: family.kind, optional: family.optional, references: [], quantity: null, confidence: family.optional ? 'non_applicable' : 'a_confirmer' }];
  }
  const matched = lines.filter((l) => catalogLineMatches(l, rule));
  // une même référence peut revenir sur plusieurs vues (culasse verticale + horizontale)
  const byRef = new Map<string, number>();
  const seen = new Set<string>();
  for (const l of matched) {
    const key = `${l.drawingId}|${l.position ?? ''}|${l.reference}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byRef.set(l.reference, (byRef.get(l.reference) ?? 0) + Math.max(num(l.quantity) || 1, 1));
  }
  const refs = [...byRef.keys()].sort();
  if (refs.length === 0) {
    return [{ familyCode: family.code, kind: family.kind, optional: family.optional, references: [], quantity: null, confidence: family.optional ? 'non_applicable' : 'a_confirmer' }];
  }
  if (rule.takeAll) {
    return refs.map((ref) => ({
      familyCode: family.code, kind: family.kind, optional: family.optional,
      references: [ref], quantity: byRef.get(ref) ?? 1, confidence: 'sur' as Confidence,
    }));
  }
  const qty = refs.reduce((s, r) => s + (byRef.get(r) ?? 0), 0);
  return [{
    familyCode: family.code, kind: family.kind, optional: family.optional,
    references: refs, quantity: qty,
    // plusieurs variantes possibles : l'atelier tranche, on n'en choisit aucune au hasard
    confidence: refs.length > 1 ? 'a_confirmer' : 'sur',
  }];
}

/**
 * Signature de famille moteur (M-20). La famille de moteur n'existe pas en base : on la
 * caractérise par ce qui compte pour l'entretien — filtre à huile, bougie, courroie de
 * distribution. Deux modèles-années qui partagent ces références partagent le moteur.
 */
export const ENGINE_FAMILIES = ['filtre_huile', 'bougie', 'courroie_distribution'] as const;

export function engineFamilyKey(parts: Pick<DeducedPart, 'familyCode' | 'references'>[]): string {
  const refs = new Set<string>();
  for (const p of parts) {
    if ((ENGINE_FAMILIES as readonly string[]).includes(p.familyCode)) {
      for (const r of p.references) refs.add(r);
    }
  }
  return refs.size === 0 ? 'inconnu' : [...refs].sort().join(',');
}

/** Signature du contenu d'un kit : deux modèles-années au même contenu partagent le kit. */
export function kitSignature(parts: Pick<DeducedPart, 'familyCode' | 'references' | 'quantity'>[]): string {
  return parts
    .map((p) => `${p.familyCode}#${[...p.references].sort().join('+')}#${p.quantity ?? ''}`)
    .sort()
    .join(',');
}

// ---------------------------------------------------------------------------
// Étage 3 — la picking list et le manquant
// ---------------------------------------------------------------------------

/** Une ligne de kit, telle que l'atelier la voit et la corrige. */
export type KitItem = {
  id: string;
  familyCode: string | null;
  articleId: string | null;
  reference: string | null;
  designation: string;
  quantity: number;
  unit?: string | null;
  kind: PartFamilyKind;
  confidence: 'sur' | 'a_confirmer';
  origin: 'deduit' | 'ajoute';
};

/** Une ligne « pièce » de l'OR, ajoutée par le technicien (parcours → « Reporter sur l'OR »). */
export type WorkshopLine = { articleId: string | null; designation: string; quantity: number };

export type PickingSource = 'kit' | 'atelier';

export type PickingDraftLine = {
  articleId: string | null;
  reference: string | null;
  designation: string;
  quantity: number;
  source: PickingSource;
  kitItemId?: string | null;
};

/**
 * Ce que contient la picking list d'un entretien : les pièces du kit PUIS les pièces
 * ajoutées par le technicien. Une pièce déjà présente par le kit n'est pas dupliquée
 * (même règle que la fonction SQL `picking_open_for_repair_order`).
 */
export function buildPickingDraft(kit: KitItem[], workshop: WorkshopLine[]): PickingDraftLine[] {
  const out: PickingDraftLine[] = kit.map((i) => ({
    articleId: i.articleId,
    reference: i.reference,
    designation: i.kind === 'consommable' && i.unit
      ? `${i.designation} (${fmtQty(i.quantity)} ${i.unit})`
      : i.designation,
    quantity: i.quantity,
    source: 'kit',
    kitItemId: i.id,
  }));
  for (const w of workshop) {
    if (num(w.quantity) <= 0) continue;
    const already = out.some((o) =>
      (w.articleId !== null && o.articleId === w.articleId)
      || (w.articleId === null && o.designation === w.designation));
    if (already) continue;
    out.push({ articleId: w.articleId, reference: null, designation: w.designation, quantity: num(w.quantity), source: 'atelier' });
  }
  return out;
}

export function fmtQty(n: number): string {
  return Number(n).toLocaleString('fr-BE', { maximumFractionDigits: 3 });
}

/** Types de gestion commandables par ce chemin : pièce stockée (A), composant de kit (N). */
export const ORDERABLE_MGMT_TYPES = ['A', 'N'] as const;

export type WorkshopNeedInput = {
  mgmtType: string | null;
  qtyNeeded: number;
  realQty: number;
  reservedQty: number;
  onOrderQty: number;
  draftQty: number;
};

/**
 * Quantité manquante à commander — miroir exact de `repair_order_order_needs` /
 * `picking_order_needs` : besoin − libre (réel − réservé, jamais négatif) − en commande
 * pour ce client − déjà lancé en brouillon. Une pièce sans article ou d'un type non
 * commandable (main-d'œuvre, texte, moto) ne manque jamais : elle ne se commande pas ici.
 */
export function workshopMissingQty(n: WorkshopNeedInput): number {
  if (!n.mgmtType || !(ORDERABLE_MGMT_TYPES as readonly string[]).includes(n.mgmtType)) return 0;
  const free = Math.max(num(n.realQty) - num(n.reservedQty), 0);
  return Math.max(num(n.qtyNeeded) - free - num(n.onOrderQty) - num(n.draftQty), 0);
}

/** Types de commande proposés au moins : le choix du type est obligatoire (demande du 23/09). */
export const WORKSHOP_ORDER_KINDS = ['standard', 'urgente'] as const;
export type WorkshopOrderKind = (typeof WORKSHOP_ORDER_KINDS)[number] | 'excel' | 'accident';

/** Le fichier DCS (ACH001) dépend du type : seule « urgente » sort en URGENTE. */
export function dcsKindOfWorkshopOrder(kind: string): 'STANDARD' | 'URGENTE' {
  return kind === 'urgente' ? 'URGENTE' : 'STANDARD';
}

/** Compte des lignes d'un kit qui attendent une confirmation de l'atelier. */
export function kitToConfirmCount(items: KitItem[]): number {
  return items.filter((i) => i.confidence === 'a_confirmer').length;
}

/** Un kit est prêt à servir quand toutes ses lignes ont un article et sont confirmées. */
export function kitIsReady(items: KitItem[]): boolean {
  return items.length > 0 && items.every((i) => i.articleId !== null && i.confidence === 'sur');
}
