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
 *                 nécessaires (2 courroies), soit des variantes : depuis le 03/11 (M-90,
 *                 « on garde les deux ») chaque référence fait SA ligne de kit, marquée
 *                 « plusieurs références dans le catalogue » ; l'atelier retire à l'écran ;
 *   3. MANQUANT — besoin − libre − en commande − déjà en brouillon.
 *
 * Rien n'est inventé. Trois niveaux : `sur`, `a_confirmer` (plusieurs références, ou article
 * du DMS à désigner : ne bloque pas l'usage), `absent` (aucune référence trouvée : signalé,
 * jamais proposé à la commande).
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

export type Confidence = 'sur' | 'a_confirmer' | 'absent' | 'non_applicable';

/**
 * Une pièce déduite pour une échéance d'entretien : UNE ligne par référence (M-90).
 * `reference` est la référence de cette ligne ; `references` toutes celles trouvées pour le
 * besoin (plus d'une = « plusieurs références dans le catalogue »).
 */
export type DeducedPart = {
  familyCode: string;
  kind: PartFamilyKind;
  optional: boolean;
  reference: string | null;
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
  // aucune référence trouvée : signalé « absent » (famille ferme) ou non applicable (optionnelle)
  const none = (): DeducedPart[] => [{
    familyCode: family.code, kind: family.kind, optional: family.optional,
    reference: null, references: [], quantity: null,
    confidence: family.optional ? 'non_applicable' : 'absent',
  }];
  if (!rule) return none();
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
  if (refs.length === 0) return none();
  if (rule.takeAll) {
    // toutes nécessaires (2 courroies) : chacune est une pièce à part entière, sûre
    return refs.map((ref) => ({
      familyCode: family.code, kind: family.kind, optional: family.optional,
      reference: ref, references: [ref], quantity: byRef.get(ref) ?? 1, confidence: 'sur' as Confidence,
    }));
  }
  // variantes : on garde TOUTES les références (M-90), une ligne chacune avec sa quantité ;
  // plus d'une = « plusieurs références dans le catalogue », l'atelier retire à l'écran
  return refs.map((ref) => ({
    familyCode: family.code, kind: family.kind, optional: family.optional,
    reference: ref, references: refs, quantity: byRef.get(ref) ?? 1,
    confidence: refs.length > 1 ? 'a_confirmer' : 'sur',
  }));
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
export function kitSignature(parts: Pick<DeducedPart, 'familyCode' | 'reference' | 'quantity'>[]): string {
  return parts
    .map((p) => `${p.familyCode}#${p.reference ?? ''}#${p.quantity ?? ''}`)
    .sort()
    .join(',');
}

/** Avancement de la génération par lots, en pour cent (0 quand le parc est inconnu). */
export function generationPercent(offset: number, total: number): number {
  if (!(num(total) > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((num(offset) / num(total)) * 100)));
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
  confidence: KitConfidence;
  origin: 'deduit' | 'ajoute';
  /** Toutes les références trouvées pour ce besoin ; plus d'une = plusieurs références dans le catalogue. */
  catalogRefs?: string[] | null;
  /** D'où vient la ligne (besoin, référence, quantité) — colonne `provenance` (03/11). */
  provenance?: KitProvenance | null;
};

/**
 * Provenance d'une ligne de kit générée (M-92) : le BESOIN vient du manuel d'atelier, sinon du
 * plan Ducati, sinon de la règle « annuel + huile = vidange + filtre » ; la RÉFÉRENCE et sa
 * quantité viennent des vues éclatées du catalogue ; la quantité d'un consommable vient des
 * ravitaillements du manuel.
 */
export type KitProvenance = {
  besoin?: 'manuel' | 'plan' | 'regle' | null;
  echeance?: string | null;
  operations?: string[] | null;
  reference?: 'catalogue' | null;
  quantite?: 'catalogue' | 'manuel' | null;
  produit?: 'manuel' | null;
  repris_de?: string | null;
};

/** La source affichée d'une ligne : manuel, plan, règle, ou ajout de l'atelier. */
export type KitLineSource = 'manuel' | 'plan' | 'regle' | 'atelier';

export function kitLineSource(i: Pick<KitItem, 'origin' | 'provenance'>): KitLineSource {
  if (i.origin === 'ajoute') return 'atelier';
  const b = i.provenance?.besoin;
  return b === 'manuel' || b === 'plan' ? b : 'regle';
}

/** Type d'entretien (M-91) : 1er entretien, annuel + huile, annuel, desmo. */
export type ServiceKind = 'first_1000' | 'oil' | 'annual' | 'desmo';

/**
 * Même règle que la fonction SQL `maintenance_service_kind` : le type d'une échéance d'après son
 * code (plan, manuel ou extract DCS), ses km, ses mois et le drapeau « premier entretien ».
 */
export function serviceKindOf(
  code: string | null | undefined, km?: number | null, months?: number | null, firstService?: boolean | null,
): ServiceKind | null {
  const c = String(code ?? '').toLowerCase();
  if (firstService || km === 1000 || /(^|[^0-9])1[_ ]?000([^0-9]|$)/.test(c) || /(first|premier|1er)/.test(c)) return 'first_1000';
  if (/(desmo|valve|soupape)/.test(c)) return 'desmo';
  if (/(oil|huile)/.test(c)) return 'oil';
  if (/(annual|annuel|temporel|12_?mois)/.test(c)) return 'annual';
  if (months != null && km == null) return 'annual';
  if (km != null && km >= 10000 && km <= 15000) return 'oil';
  if (km != null && km >= 20000 && km <= 30000) return 'desmo';
  if (km === 36000 || km === 45000) return 'oil';
  if (km === 48000 || km === 60000) return 'desmo';
  return null;
}

/** Compteurs d'un lot de génération (retour de `maintenance_kit_generate`). */
export type GenerationTotals = {
  modelYears: number; created: number; reused: number; linked: number; skipped: number;
  itemsMultiRef: number; itemsAbsent: number;
};

export function addGenerationTotals(a: GenerationTotals, b: Partial<GenerationTotals>): GenerationTotals {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    modelYears: a.modelYears + n(b.modelYears), created: a.created + n(b.created), reused: a.reused + n(b.reused),
    linked: a.linked + n(b.linked), skipped: a.skipped + n(b.skipped),
    itemsMultiRef: a.itemsMultiRef + n(b.itemsMultiRef), itemsAbsent: a.itemsAbsent + n(b.itemsAbsent),
  };
}

export const EMPTY_GENERATION_TOTALS: GenerationTotals = {
  modelYears: 0, created: 0, reused: 0, linked: 0, skipped: 0, itemsMultiRef: 0, itemsAbsent: 0,
};

/** Niveau d'une ligne de kit : sûr, à confirmer (ne bloque pas), absent (signalé, jamais commandé). */
export type KitConfidence = 'sur' | 'a_confirmer' | 'absent';

/** Ce que l'écran dit d'une ligne : rien, plusieurs références, article à désigner, absente. */
export type KitLineFlag = 'plusieurs_refs' | 'a_designer' | 'absent' | null;

export function kitLineFlag(i: Pick<KitItem, 'confidence' | 'catalogRefs'>): KitLineFlag {
  if (i.confidence === 'absent') return 'absent';
  if ((i.catalogRefs?.length ?? 0) > 1) return 'plusieurs_refs';
  if (i.confidence === 'a_confirmer') return 'a_designer';
  return null;
}

/** Lignes « plusieurs références dans le catalogue » (M-90 : on les garde toutes). */
export function kitMultiRefCount(items: Pick<KitItem, 'confidence' | 'catalogRefs'>[]): number {
  return items.filter((i) => kitLineFlag(i) === 'plusieurs_refs').length;
}

/** Besoins sans aucune référence trouvée. */
export function kitAbsentCount(items: Pick<KitItem, 'confidence'>[]): number {
  return items.filter((i) => i.confidence === 'absent').length;
}

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

/** Compte des lignes d'un kit qui attendent encore un choix de l'atelier (plusieurs références, article à désigner). */
export function kitToConfirmCount(items: Pick<KitItem, 'confidence'>[]): number {
  return items.filter((i) => i.confidence === 'a_confirmer').length;
}

/**
 * Un kit est prêt à servir quand toutes ses lignes ont un article et qu'aucune n'est absente.
 * « À confirmer » ne bloque plus (M-90) : le kit propose tout, l'atelier retire ce qu'il ne veut pas.
 */
export function kitIsReady(items: Pick<KitItem, 'articleId' | 'confidence'>[]): boolean {
  return items.length > 0 && items.every((i) => i.articleId !== null && i.confidence !== 'absent');
}
