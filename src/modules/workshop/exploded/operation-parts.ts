/**
 * M8 — « Voir sur la vue éclatée » d'une opération du parcours (ATE-05, correctif du 26/11/2026).
 * Règles PURES (testées dans tests/atelier-vue-eclatee-operation.test.ts).
 *
 * Bug signalé par Simon (Monster 1100 S 2009, sans manuel d'atelier) : le bouton ouvrait la liste
 * de TOUS les dessins. Le bouton ne connaissait que les lignes de l'OR reliées à l'opération par
 * `repair_order_operations_lines`, qui compare l'article de la ligne à l'article FINAL du kit
 * (remplaçant) : la ligne « filtre 44440035A » de l'OR ne répondait pas au kit « 44440031C », et
 * aucune ligne de l'OR n'existe pour les courroies. Aucune pièce → liste de tous les dessins.
 *
 * Règle (pour toute moto qui a un modèle-année catalogue) — pas de référence devinée :
 *  1. les familles de pièces de l'opération (`family_codes`, mêmes règles que les kits) ;
 *  2. pour chaque famille, les références dans cet ordre, la première source qui se retrouve sur
 *     un dessin de CE modèle-année l'emporte :
 *       a. les lignes de l'OR reliées à l'opération (article du DMS et ses références Ducati) ;
 *       b. le kit de la moto (articles et références catalogue du kit, pour cette famille) ;
 *       c. les règles de recherche des kits dans le catalogue de ce modèle-année
 *          (maintenance_part_catalog_rules, celles qui ont construit les kits) ;
 *     la référence n'est retenue que si elle figure (ou est remplacée) sur un dessin du modèle-année ;
 *  3. une cible par (dessin, repère), pièce principale d'abord (joints et bouchons après), puis
 *     l'ordre des familles de l'opération ;
 *  4. puis les éléments que l'opération CONTRÔLE / nettoie / vidange (filtre à air, fourche,
 *     réservoirs de frein, plaquettes, pneus, chaîne...) : table mots de l'opération → composant →
 *     dessins et désignations du catalogue de ce modèle-année (operation-components.ts) ;
 *  5. aucune cible (lecture DDS, essai, nettoyage, élément absent des dessins de la moto) : PAS de
 *     bouton (Simon, 26/11 : « si y a pas de vues y a pas de bouton » = aucun dessin ne montre
 *     l'élément).
 */
import { normalizeCatalogReference } from '@/modules/catalog/reference';
import { componentsOf, locateComponent } from './operation-components';

/** Dessin du modèle-année, dans l'ordre du catalogue (ducati_catalog_model_year_drawings + drawings). */
export type MyDrawing = { drawing_id: string; group_sort: number | null; sort: number | null; code: string | null; description: string | null };
/** Ligne de dessin (ducati_catalog_drawing_lines, colonnes lues). */
export type MyDrawingLine = {
  drawing_id: string; line_no: number; position: string | null;
  reference: string | null; reference_norm: string | null; description: string | null; replaced_part: string | null;
};
/** Règle de recherche d'une famille dans le catalogue (maintenance_part_catalog_rules). */
export type CatalogRule = {
  family_code: string; include_re: string; exclude_re: string | null;
  drawing_re: string | null; drawing_exclude_re: string | null;
};
/** Ligne du kit de la moto pour une famille (maintenance_kit_items, kits actifs du modèle-année). */
export type KitFamilyItem = { family_code: string | null; references: readonly (string | null | undefined)[]; designation: string | null };
/** Ligne de l'OR reliée à l'opération, avec les références à chercher pour son article. */
export type OpLineRefs = { family_code: string; designation: string; references: readonly string[] };

export type TargetSource = 'or_line' | 'kit' | 'catalogue' | 'composant';
export type OperationTarget = {
  familyCode: string;
  reference: string;
  designation: string;
  drawingId: string;
  drawingLabel: string;
  position: string | null;
  viaReplacement: boolean;
  source: TargetSource;
};

export type OperationPartsIndex = {
  drawings: readonly MyDrawing[];
  lines: readonly MyDrawingLine[];
  rules: readonly CatalogRule[];
  kit: readonly KitFamilyItem[];
};

/** Familles secondaires (joint, bouchon) : après la pièce principale de l'opération. */
export function isSecondaryFamily(code: string): boolean {
  return /^(joint_|bouchon_)/.test(code);
}

function safeRe(src: string | null | undefined): RegExp | null {
  if (!src) return null;
  try { return new RegExp(src); } catch { return null; }
}

/** Même test que la base (`upper(description) ~ include_re` ... ), sur le texte en majuscules. */
export function catalogRuleMatches(rule: CatalogRule, lineDescription: string | null | undefined, drawingDescription: string | null | undefined): boolean {
  const line = String(lineDescription ?? '').toUpperCase();
  const drawing = String(drawingDescription ?? '').toUpperCase();
  if (/OUTILS SPECIAUX/.test(drawing)) return false;
  const inc = safeRe(rule.include_re);
  if (!inc || !inc.test(line)) return false;
  const exc = safeRe(rule.exclude_re);
  if (exc && exc.test(line)) return false;
  const dre = safeRe(rule.drawing_re);
  if (rule.drawing_re && (!dre || !dre.test(drawing))) return false;
  const dex = safeRe(rule.drawing_exclude_re);
  if (dex && dex.test(drawing)) return false;
  return true;
}

type Hit = { line: MyDrawingLine; viaReplacement: boolean };

/** Lignes des dessins du modèle-année qui portent la référence (directe d'abord, puis « remplacée »). */
function hitsFor(reference: string, lines: readonly MyDrawingLine[]): Hit[] {
  const ref = normalizeCatalogReference(reference);
  if (!ref) return [];
  const direct: Hit[] = [];
  const repl: Hit[] = [];
  for (const l of lines) {
    const norm = l.reference_norm ? normalizeCatalogReference(l.reference_norm) : normalizeCatalogReference(l.reference);
    if (norm === ref) direct.push({ line: l, viaReplacement: false });
    else if (l.replaced_part && normalizeCatalogReference(l.replaced_part) === ref) repl.push({ line: l, viaReplacement: true });
  }
  return direct.length ? direct : repl;
}

/**
 * Cibles d'une opération : dessin + repère de chaque pièce qu'elle remplace, dans l'ordre où le
 * bouton les propose (la première s'ouvre, les autres se choisissent dans la fenêtre).
 */
export function operationTargets(
  op: { familyCodes: readonly string[]; lines: readonly OpLineRefs[]; label?: string | null },
  idx: OperationPartsIndex,
): OperationTarget[] {
  const families = [...new Set(op.familyCodes.filter(Boolean))];
  const comps = componentsOf(op.label);
  if ((!families.length && !comps.length) || !idx.drawings.length) return [];
  const rank = new Map<string, number>();
  idx.drawings.forEach((d, i) => { if (!rank.has(d.drawing_id)) rank.set(d.drawing_id, i); });
  const label = new Map<string, string>();
  for (const d of idx.drawings) if (!label.has(d.drawing_id)) label.set(d.drawing_id, [d.code, d.description].filter(Boolean).join(' — '));
  const lines = idx.lines.filter((l) => rank.has(l.drawing_id));
  const drawingDesc = new Map(idx.drawings.map((d) => [d.drawing_id, d.description]));

  const ordered = [...families].sort((a, b) => Number(isSecondaryFamily(a)) - Number(isSecondaryFamily(b)) || families.indexOf(a) - families.indexOf(b));
  const out: OperationTarget[] = [];
  const seen = new Set<string>();

  const firstRank = (hits: Hit[]) => Math.min(...hits.map((h) => rank.get(h.line.drawing_id)! * 100000 + h.line.line_no));
  const push = (fam: string, source: TargetSource, reference: string, designation: string, hits: Hit[]) => {
    const sorted = [...hits].sort((a, b) => rank.get(a.line.drawing_id)! - rank.get(b.line.drawing_id)! || a.line.line_no - b.line.line_no);
    for (const h of sorted) {
      const key = `${h.line.drawing_id}|${String(h.line.position ?? '').trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        familyCode: fam, reference, designation: designation || h.line.description || reference,
        drawingId: h.line.drawing_id, drawingLabel: label.get(h.line.drawing_id) ?? '',
        position: h.line.position == null ? null : String(h.line.position).trim() || null,
        viaReplacement: h.viaReplacement, source,
      });
    }
  };

  for (const fam of ordered) {
    // a. lignes de l'OR reliées à l'opération pour cette famille
    const fromOr: { ref: string; des: string }[] = [];
    for (const l of op.lines) if (l.family_code === fam) for (const r of l.references) fromOr.push({ ref: r, des: l.designation });
    // b. kit de la moto
    const fromKit: { ref: string; des: string }[] = [];
    for (const k of idx.kit) if (k.family_code === fam) for (const r of k.references) if (r) fromKit.push({ ref: r, des: k.designation ?? '' });

    let found = false;
    for (const [source, cands] of [['or_line', fromOr], ['kit', fromKit]] as const) {
      const done = new Set<string>();
      const located: { ref: string; des: string; hits: Hit[] }[] = [];
      for (const c of cands) {
        const norm = normalizeCatalogReference(c.ref);
        if (!norm || done.has(norm)) continue;
        done.add(norm);
        const hits = hitsFor(c.ref, lines);
        if (hits.length) located.push({ ref: c.ref, des: c.des, hits });
      }
      // plusieurs références pour la famille : dans l'ordre du catalogue
      for (const x of located.sort((a, b) => firstRank(a.hits) - firstRank(b.hits))) push(fam, source, x.ref, x.des, x.hits);
      if (located.length) { found = true; break; }
    }
    if (found) continue;
    // c. règles de recherche des kits dans le catalogue de ce modèle-année
    const rules = idx.rules.filter((r) => r.family_code === fam);
    if (!rules.length) continue;
    const byRef = new Map<string, Hit[]>();
    for (const l of lines) {
      if (!rules.some((r) => catalogRuleMatches(r, l.description, drawingDesc.get(l.drawing_id)))) continue;
      const ref = l.reference ?? l.reference_norm ?? '';
      if (!normalizeCatalogReference(ref)) continue;
      const arr = byRef.get(ref) ?? [];
      arr.push({ line: l, viaReplacement: false });
      byRef.set(ref, arr);
    }
    for (const [ref, hits] of [...byRef].sort((a, b) => firstRank(a[1]) - firstRank(b[1]))) {
      push(fam, 'catalogue', ref, hits[0].line.description ?? ref, hits);
    }
  }
  // Éléments contrôlés / nettoyés / vidangés par l'opération.
  for (const c of comps) {
    for (const h of locateComponent(c, idx.drawings, lines)) {
      push(c.key, 'composant', h.line.reference ?? '', h.line.description ?? '', [{ line: h.line, viaReplacement: false }]);
    }
  }
  return out;
}

/** L'opération peut-elle avoir une vue (familles de pièces ou élément de la table) ? Évite de lire le catalogue pour rien. */
export function operationMayHaveTargets(op: { familyCodes: readonly string[]; label?: string | null }): boolean {
  return op.familyCodes.some(Boolean) || componentsOf(op.label).length > 0;
}
