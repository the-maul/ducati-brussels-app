/**
 * M8 — ATE-05 (26/11/2026, 2e retour de Simon) : la vue éclatée s'ouvre aussi pour les CONTRÔLES,
 * nettoyages et vidanges de liquide, zoomée sur l'élément concerné, dès qu'il figure sur un dessin
 * du modèle-année de la moto. Règles PURES (tests/atelier-vue-eclatee-operation.test.ts).
 *
 * Méthode (pas de référence devinée) : une table de correspondance
 *   mots de l'opération → composant(s) → titres de dessins + désignations de pièces du catalogue
 * de CE modèle-année. Un composant n'est retenu que si une ligne d'un dessin de la moto répond à sa
 * désignation ; sinon rien (pas de bouton si aucune opération ni pièce ne donne de dessin).
 *  - `part` : désignations dans l'ordre de préférence ; le premier niveau qui trouve quelque chose
 *    l'emporte (ex. réservoir de liquide de frein, sinon maître-cylindre). `each` : chaque niveau
 *    est un élément à part (ex. vase d'expansion ET radiateur).
 *  - une cible par dessin (la première ligne du dessin), au plus `max` dessins par composant.
 * Textes comparés en majuscules sans accents (désignations du catalogue en français, quelques
 * titres de dessins en italien : ASPIRAZIONE ARIA, SOSPENSIONE POSTERIORE, COMANDO FRIZIONE).
 */

export type OperationComponent = {
  key: string;
  /** Mots de l'opération (texte normalisé). */
  op: string;
  opExclude?: string;
  /** Titres de dessins acceptés / refusés (sinon : tous les dessins de la moto). */
  drawing?: string;
  drawingExclude?: string;
  /** Désignations de pièces, par ordre de préférence. */
  part: string[];
  partExclude?: string;
  each?: boolean;
  max?: number;
};

const NOT_ELEC = 'DISPOSITIFS ELECTRIQUES';

export const OPERATION_COMPONENTS: readonly OperationComponent[] = [
  { key: 'filtre_air', op: 'FILTRE A AIR', part: ['^FILTRE A AIR( |$)', '^(ELEMENT|CARTOUCHE) FILTRANT'], partExclude: '(BOITE|CAGE|COUVERCLE|SUPPORT|COLLIER|TUBE)', drawingExclude: 'DISTRIBUTION' },
  { key: 'fourche_etancheite', op: 'ETANCHEITE.*FOURCHE|FOURCHE.*ETANCHEITE', drawing: 'FOURCHE AVANT|FORCELLA', drawingExclude: 'FOURCHETTE',
    part: ["JOINTS? (D'ETANCHEITE )?(DE )?FOURCHE|^KIT JOINTS|^JEU (DE )?JOINTS?", "^BAGUE D'?ETANCHEITE", '^(ENSEMBLE |DEMI-)?FOURCHE'] },
  { key: 'fourche', op: 'HUILE (DE )?FOURCHE', drawing: 'FOURCHE AVANT|FORCELLA', drawingExclude: 'FOURCHETTE', part: ['^(ENSEMBLE |DEMI-)?FOURCHE'] },
  { key: 'amortisseur', op: 'AMORTISSEUR ARRIERE|SUSPENSION ARRIERE', opExclude: 'CULBUTEUR', drawing: 'AMORTISSEUR|SOSPENSIONE POSTERIORE|SUSPENSION ARRIERE',
    part: ['^(MONO ?)?AMORTISSEUR( ARRIERE|$| )'], partExclude: '(CAOUTCHOUC|DIRECTION|COUPLE)' },
  { key: 'culbuteur_suspension', op: 'CULBUTEUR (DE LA )?SUSPENSION|CULBUTEUR AMORTISSEUR', part: ['^CULBUTEUR SUSPENSION', '^BASCULEUR'] },
  { key: 'frein_avant_liquide', op: '(HUILE|LIQUIDE) (DE |DES |DU )?FREINS?', drawing: 'FREIN AVANT', drawingExclude: 'ABS',
    part: ['^(RESERVOIR|VASE) (DE )?(LIQUIDE|HUILE)', '^(POMPE FREIN AVANT|MAITRE.?CYLINDRE)'] },
  { key: 'frein_arriere_liquide', op: '(HUILE|LIQUIDE) (DE |DES |DU )?FREINS?', drawing: 'FREIN ARRIERE', drawingExclude: 'ABS',
    part: ['^(RESERVOIR|VASE) (DE )?(LIQUIDE|HUILE)', '^(POMPE FREIN ARRIERE|MAITRE.?CYLINDRE)'] },
  { key: 'embrayage_liquide', op: "(HUILE|LIQUIDE) (DE |DES |D')?(FREINS? ET D'?)?EMBRAYAGE", drawing: 'MAITRE.?CYLINDRE EMBRAYAGE|COMANDO FRIZIONE|COMMANDE EMBRAYAGE|POMPE EMBRAYAGE',
    part: ['^(RESERVOIR|VASE) (DE )?(LIQUIDE|HUILE)', '^(POMPE|MAITRE.?CYLINDRE) (D.)?EMBRAYAGE'] },
  { key: 'plaquettes', op: 'PLAQUETTES', drawing: 'FREIN', part: ['^(JEU |PAIRE )?(DE )?PLAQUETTES?( |$)'], partExclude: '(RESSORT|PIVOT|GOUPILLE|REVISION)' },
  { key: 'disques_frein', op: 'DISQUES? (DU |DE |DES )?FREIN', part: ['^DISQUE (DE )?FREIN'] },
  { key: 'etriers', op: 'ETRIERS?', part: ['^ETRIER (DE )?FREIN'] },
  { key: 'pneus', op: 'PNEUS?( |$|,)', part: ['^PNEU (AVANT|ARRIERE)'], max: 1 },
  { key: 'roulements_roue', op: 'ROULEMENTS? (DES )?MOYEUX|MOYEUX? (DE |DES )?ROUES?', drawing: 'ROUE|RUOTA', part: ['^ROULEMENT'] },
  { key: 'ecrous_roue', op: 'ECROUS? (DE |DES )?ROUES?', drawing: 'ROUE|RUOTA', part: ['^ECROU( |$)'], max: 2 },
  { key: 'roues_rayons', op: 'ROUES A RAYONS', part: ['^RAYONS?( |$)'] },
  { key: 'chaine', op: 'CHAINE (DE TRANSMISSION|.*TRANSMISSION FINALE)|USURE DE LA CHAINE|TRANSMISSION FINALE', opExclude: 'DISTRIBUTION|COURROIE|XDIAVEL\\)$',
    part: ['^CHAINE( |$)', '^KIT TRANSMISSION SECONDAIRE'] },
  { key: 'couronne', op: 'COURONNE', opExclude: 'AMORTISSEURS? DE COUPLE|DISTRIBUTION', part: ['^COURONNE( |$)'] },
  { key: 'pignon', op: 'PIGNON', opExclude: 'DISTRIBUTION|PIGNON MOTEUR ET ROUE FOLLE', part: ['^PIGNON (DE )?CHAINE|^PIGNON SORTIE'] },
  { key: 'amortisseurs_couple', op: 'AMORTISSEURS? DE COUPLE', part: ['^AMORTISSEURS? (EN )?CAOUTCHOUC|^AMORTISSEURS? (DE )?COUPLE', '^BRIDE PORTE.?COURONNE'] },
  { key: 'direction', op: 'COLONNE DE DIRECTION', part: ['^ROULEMENTS? (DE )?(LA )?DIRECTION'] },
  { key: 'bequille', op: 'BEQUILLE LATERALE', opExclude: NOT_ELEC, part: ['^BEQUILLE( LATERALE)?( |$)'] },
  { key: 'securite_elec', op: 'DISPOSITIFS ELECTRIQUES DE SECURITE', part: ['^(MICRO.?)?(INTERRUPTEUR|CONTACTEUR) (DE )?(BEQUILLE|STOP|EMBRAYAGE|FREIN|POINT MORT)'], max: 4 },
  { key: 'batterie', op: 'BATTERIE', part: ['^BATTERIE( |$)'] },
  { key: 'bougies', op: 'BOUGIES?', part: ['^BOUGIE( |$)'], partExclude: '(CABLE|CABLAGE|CAPUCHON|JOINT|PROTECTION)' },
  { key: 'refroidissement', op: 'LIQUIDE (DE )?REFROIDISSEMENT', each: true,
    part: ["^(VASE|RESERVOIR) (D'?)?(EXPANSION|EAU)", "^RADIATEUR (D'?EAU|EAU)( |$)|^RADIATEUR$"], partExclude: 'HUILE' },
  { key: 'eclairage', op: 'ECLAIRAGE|CLIGNOTANTS|AVERTISSEUR SONORE', each: true,
    part: ['^(FEU AVANT|PHARE|PROJECTEUR)( |$)', '^FEU ARRIERE( |$)', '^CLIGNOTANT', '^(AVERTISSEUR|KLAXON)'], max: 1 },
  { key: 'soupapes', op: 'JEU AUX SOUPAPES|CULBUTEURS', opExclude: 'SUSPENSION|AMORTISSEUR', drawing: 'CULASSE|TESTA', part: ['^CULBUTEUR', '^SOUPAPE'] },
  { key: 'disques_embrayage', op: "DISQUES D'?EMBRAYAGE", drawing: 'EMBRAYAGE|FRIZIONE', drawingExclude: 'COUVERCLE|COMMANDE|COMANDO|MAITRE',
    part: ["^(JEU |PAQUET )?(DE )?DISQUES? (D'?)?EMBRAYAGE"] },
  { key: 'cloche_embrayage', op: "CLOCHE D'?EMBRAYAGE", part: ["^CLOCHE (D'?)?EMBRAYAGE"] },
  { key: 'levier_embrayage', op: "LEVIER (DE )?(COMMANDE )?(D'?)?EMBRAYAGE", drawingExclude: 'COUVERCLE', part: ["^LEVIER (D'?)?EMBRAYAGE"], max: 1 },
  { key: 'pedale_frein', op: '(LEVIER|PEDALE) DE FREIN ARRIERE', part: ['^PEDALE (DE )?FREIN'] },
  { key: 'levier_frein_avant', op: 'LEVIER DE FREIN AVANT', part: ['^LEVIER (DE )?FREIN AVANT'] },
  { key: 'cadre', op: 'FIXATIONS DU (SOUS-)?CADRE|CADRE AU MOTEUR', drawing: '^CADRE|TELAIO', part: ['^CADRE( |$)'] },
  { key: 'bras_oscillant', op: 'BRAS OSCILLANT', drawing: 'BRAS OSCILLANT|FORCELLONE', part: ['^(BRAS OSCILLANT|FOURCHE AR|FORCELLONE)'] },
  { key: 'pompe_eau', op: 'POMPE A EAU', drawing: 'POMPE A EAU', part: ['^POMPE A EAU', '^(JOINT|BAGUE)'] },
  { key: 'vanne_echappement', op: "VANNE (A |DE )?L'?ECHAPPEMENT", part: ['^CABLE (DE )?(SOUPAPE|VANNE)'] },
];

/** Majuscules sans accents, apostrophes droites, espaces simples. */
export function normalizeText(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'")
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

const reCache = new Map<string, RegExp | null>();
function re(src: string | undefined): RegExp | null {
  if (!src) return null;
  if (!reCache.has(src)) { try { reCache.set(src, new RegExp(src)); } catch { reCache.set(src, null); } }
  return reCache.get(src) ?? null;
}

/** Composants concernés par l'opération, dans l'ordre où le texte les cite. */
export function componentsOf(label: string | null | undefined, table: readonly OperationComponent[] = OPERATION_COMPONENTS): OperationComponent[] {
  const text = normalizeText(label);
  if (!text) return [];
  const hits: { c: OperationComponent; at: number; i: number }[] = [];
  table.forEach((c, i) => {
    const r = re(c.op);
    if (!r) return;
    const m = r.exec(text);
    if (!m) return;
    const ex = re(c.opExclude);
    if (ex && ex.test(text)) return;
    hits.push({ c, at: m.index, i });
  });
  return hits.sort((a, b) => a.at - b.at || a.i - b.i).map((h) => h.c);
}

export type ComponentLine = { drawing_id: string; line_no: number; position: string | null; description: string | null; reference: string | null };
export type ComponentDrawing = { drawing_id: string; description: string | null };
export type ComponentHit<L extends ComponentLine = ComponentLine> = { key: string; drawingId: string; line: L };

/**
 * Lignes des dessins de la moto qui montrent le composant : une par dessin (la première), dessins
 * dans l'ordre du catalogue (`drawings`), au plus `max` (3 par défaut) par niveau de désignation.
 */
export function locateComponent<L extends ComponentLine>(c: OperationComponent, drawings: readonly ComponentDrawing[], lines: readonly L[]): ComponentHit<L>[] {
  const dInc = re(c.drawing); const dExc = re(c.drawingExclude); const pExc = re(c.partExclude);
  const ok = new Map<string, number>();
  drawings.forEach((d, i) => {
    const title = normalizeText(d.description);
    if (/OUTILS? (SPECIAUX|D'ASSISTANCE)|INSTRUMENT|TESTER/.test(title)) return;
    if (c.drawing && (!dInc || !dInc.test(title))) return;
    if (dExc && dExc.test(title)) return;
    if (!ok.has(d.drawing_id)) ok.set(d.drawing_id, i);
  });
  if (!ok.size) return [];
  const cand = lines.filter((l) => ok.has(l.drawing_id))
    .sort((a, b) => ok.get(a.drawing_id)! - ok.get(b.drawing_id)! || a.line_no - b.line_no);
  const max = c.max ?? 3;
  const out: ComponentHit<L>[] = [];
  for (const p of c.part) {
    const r = re(p);
    if (!r) continue;
    const level: ComponentHit<L>[] = [];
    const seen = new Set<string>();
    for (const l of cand) {
      if (seen.has(l.drawing_id) || level.length >= max) continue;
      const desc = normalizeText(l.description);
      if (!r.test(desc) || (pExc && pExc.test(desc))) continue;
      seen.add(l.drawing_id);
      level.push({ key: c.key, drawingId: l.drawing_id, line: l });
    }
    out.push(...level);
    if (level.length && !c.each) break;
  }
  return out;
}
