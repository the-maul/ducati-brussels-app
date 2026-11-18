/**
 * Rattrapage G8 (19/11/2026, lot forfaits) : forfaits / nomenclatures G8, liquides des kits,
 * profils moteur, MO au taux atelier. Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  G8_SERVICE_ARTICLES, G8_FORFAITS, G8_PRICES, G8_FORMATION_FOOTER_TTC, G8_FORMATION_UNIT_TTC,
  G8_REAL_FOOTER_TTC, G8_REAL_UNIT_TTC, DEFAULT_KIT_LINES, DEFAULT_FLUID_ARTICLES, DEFAULT_ENGINE_PROFILES,
} from '../src/modules/workshop/forfaits/g8-catalog';
import { convertFluidQuantity, linkFluidLine, matchEngineProfile, literFactor } from '../src/modules/workshop/kits/fluid-rules';
import { kitInsertLines, type PricedArticle } from '../src/modules/workshop/kits/insert-rules';
import { kitLineFlag, kitLineSource, kitToDesignateCount, kitQtyToCheckCount } from '../src/modules/workshop/kits/rules';

const MIG = readFileSync('supabase/migrations/20261119140000_m8_forfaits_g8_structure.sql', 'utf8');
const PRICES_MIG = readFileSync('supabase/migrations/20261119142000_m8_forfaits_g8_prix.sql', 'utf8');
const DATA_MIG = readFileSync('supabase/migrations/20261119141000_m8_forfaits_g8_donnees_italbike.sql', 'utf8');
const WARRANTY_MIG = readFileSync('supabase/migrations/20261119143000_m8_taux_mo_garantie_g8.sql', 'utf8');

const SERVICE_REFS = new Set(G8_SERVICE_ARTICLES.map((a) => a.reference));
const DUCATI_REF = /^[0-9]{8}[A-Z]{1,2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Le corps VALUES d'une fonction catalogue de la migration, ligne par ligne. */
function sqlValues(fn: string): string[] {
  const start = MIG.indexOf(`function public.${fn}()`);
  expect(start).toBeGreaterThan(0);
  const body = MIG.slice(MIG.indexOf('(values', start) + 7, MIG.indexOf(') v(', start));
  return body.split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
}
const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);

describe('les 37 forfaits G8', () => {
  test('37 nomenclatures, codes uniques, une ligne par composant (contrainte article_kit_items)', () => {
    expect(G8_FORFAITS.length).toBe(37);
    expect(new Set(G8_FORFAITS.map((f) => f.code)).size).toBe(37);
    for (const f of G8_FORFAITS) {
      const refs = f.lines.map(([r]) => r);
      expect(new Set(refs).size).toBe(refs.length);
      for (const [r, qty] of f.lines) {
        expect(qty).toBeGreaterThan(0);
        expect(SERVICE_REFS.has(r) || DUCATI_REF.test(r)).toBe(true);
      }
    }
  });

  test('le forfait DDS de la vraie base et les compositions de reference', () => {
    const dds = G8_FORFAITS.find((f) => f.code === 'DDS')!;
    expect(dds.lines).toEqual([['PRISE EN CHARGE', 1], ['PETITES FOURNITURES', 1], ['PRODUITS NETTOYAGE MOT', 1], ['CHAIN CLEANER', 1], ['CONTRI', 2], ['APPAREIL DE DIAGNOTI', 1]]);
    const m796 = G8_FORFAITS.find((f) => f.code === 'OILSERVICEM79624000')!;
    expect(m796.lines.some(([r]) => r === 'TENSION ET GRAISSAGE')).toBe(false);
    const oil2 = G8_FORFAITS.find((f) => f.code === 'OILSERVICE2SOUPAPES')!;
    expect(oil2.lines.some(([r]) => r === 'CONTROLE DES NIVEAUX')).toBe(false);
    expect(oil2.lines.find(([r]) => r === 'MO')?.[1]).toBe(1);
  });

  const total = (code: string, unit: Readonly<Record<string, number>>, zero: (ref: string, code: string) => boolean) => {
    const f = G8_FORFAITS.find((x) => x.code === code)!;
    return r2(f.lines.reduce((s, [r, n]) => s + (zero(r, code) ? 0 : n * (unit[r] ?? 0)), 0));
  };

  test('base de formation : la somme des lignes redonne le pied de fiche G8', () => {
    for (const [code, ttc] of Object.entries(G8_FORMATION_FOOTER_TTC)) {
      expect([code, total(code, G8_FORMATION_UNIT_TTC, () => false)]).toEqual([code, ttc]);
    }
  });

  test('vraie base : meme calcul avec MO et petites fournitures a 0 € (sauf DDS)', () => {
    const zero = (r: string, code: string) => r === 'MO' || (r === 'PETITES FOURNITURES' && code !== 'DDS');
    for (const [code, ttc] of Object.entries(G8_REAL_FOOTER_TTC)) {
      expect([code, total(code, G8_REAL_UNIT_TTC, zero)]).toEqual([code, ttc]);
    }
  });
});

describe('la migration est la copie exacte du catalogue TS', () => {
  test('articles de service', () => {
    expect(sqlValues('_g8_service_catalog')).toEqual(G8_SERVICE_ARTICLES.map((a, i) =>
      `(${q(a.reference)}, ${q(a.designation)}, ${q(a.mgmtType)}, ${q(a.brand)}, ${q(a.measureUnit)}, ${i + 1})`));
  });
  test('forfaits ligne a ligne, dans l\'ordre G8', () => {
    const rows: string[] = [];
    G8_FORFAITS.forEach((f, fi) => f.lines.forEach(([r, n], li) => rows.push(`(${q(f.code)}, ${q(f.designation)}, ${fi + 1}, ${li + 1}, ${q(r)}, ${n})`)));
    expect(sqlValues('_g8_forfaits_catalog')).toEqual(rows);
  });
  test('lignes par defaut, liquides, profils moteur', () => {
    expect(sqlValues('_g8_default_kit_lines_catalog')).toEqual(DEFAULT_KIT_LINES.map(([r, n], i) => `(${q(r)}, ${n}, ${i + 1})`));
    expect(sqlValues('_g8_fluid_articles_catalog')).toEqual(DEFAULT_FLUID_ARTICLES.map((f) =>
      `(${q(f.family)}, ${q(f.reference)}, ${q(f.saleUnit)}, ${f.litersPerUnit}, ${f.wholeUnits})`));
    expect(sqlValues('_g8_engine_profiles_catalog').length).toBe(DEFAULT_ENGINE_PROFILES.length);
    for (const p of DEFAULT_ENGINE_PROFILES) expect(MIG).toContain(q(p.pattern));
  });
  test('prix : bloc separe identique a G8_PRICES, sans piece Ducati, par le circuit trace', () => {
    const json = PRICES_MIG.slice(PRICES_MIG.indexOf("'["), PRICES_MIG.indexOf("]'") + 1).slice(1);
    const parsed = JSON.parse(json) as { reference: string; ht: number; ttc: number }[];
    expect(parsed).toEqual(G8_PRICES.map((p) => ({ ...p })));
    expect(parsed.some((p) => DUCATI_REF.test(p.reference))).toBe(false);
    expect(PRICES_MIG).toContain('_g8_prices_apply');
    expect(MIG).toContain("set_config('app.price_change_origin'");
    expect(MIG).not.toMatch(/sale_price_ttc\s*=\s*[0-9]/);
    for (const p of G8_PRICES) expect(r2(p.ht * 1.21)).toBeCloseTo(p.ttc, 1);
  });
});

describe('garde-fous SQL', () => {
  test('lignes de service : ni preparation, ni reservation (kits et OR)', () => {
    expect(MIG).toContain("and i.kind <> 'forfait'");
    expect(MIG).toContain("coalesce(a.mgmt_type::text, '') not in ('F', 'T')");
    expect(MIG).toContain("check (kind in ('piece', 'consommable', 'forfait'))");
  });
  test('un kit avec des pieces passe avant un kit vide', () => {
    expect(MIG).toMatch(/order by exists \(select 1 from public\.maintenance_kit_items i where i\.kit_id = k\.id and i\.kind <> 'forfait'\) desc,\s+\(k\.service_code = _kind\) desc/);
  });
  test('generateur : kit complete apres son rattachement au modele-annee, puis photo « generation »', () => {
    const put = MIG.slice(MIG.indexOf('function public._maintenance_kit_put('));
    const link = put.indexOf('lnk := found;');
    const complete = put.indexOf('_maintenance_kit_complete(kid, false)');
    const snap = put.indexOf("_maintenance_kit_snapshot(kid, 'generation')");
    expect(link).toBeGreaterThan(0);
    expect(complete).toBeGreaterThan(link);
    expect(snap).toBeGreaterThan(complete);
    expect(put.slice(0, link)).not.toContain('fa.article_id');
  });
  test('rattrapage versionne, rejouable, uniquement ITALBIKE STORE', () => {
    expect(MIG).toContain("perform public._maintenance_kit_bump(_kit, _reason)");
    expect(DATA_MIG).toContain('3d9f0f13-a691-4d07-ad58-34590df86e33');
    expect(DATA_MIG).toContain('maintenance_kits_complete(co, true, 200, off)');
    expect(WARRANTY_MIG).toContain("= 46.94");
  });
  test('pas d\'apostrophe courbe dans les fichiers du lot', () => {
    const curly = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x201c, 0x201d) + ']');
    for (const s of [MIG, PRICES_MIG, DATA_MIG, WARRANTY_MIG]) expect(curly.test(s)).toBe(false);
  });
});

describe('liquides : conversion et rattachement', () => {
  test('unites reconnues', () => {
    expect(literFactor('l')).toBe(1);
    expect(literFactor('dm3')).toBe(1);
    expect(literFactor('cc')).toBe(0.001);
    expect(literFactor('cm3')).toBe(0.001);
    expect(literFactor('kg')).toBeNull();
  });
  test('huile au litre, huile de fourche en flacons de 0,5 l arrondis', () => {
    expect(convertFluidQuantity(3.4, 'l', 1, false)).toMatchObject({ quantity: 3.4, plausible: true, corrected: false });
    expect(convertFluidQuantity(3.7, 'dm3', 1, false).quantity).toBe(3.7);
    expect(convertFluidQuantity(521, 'cc', 0.5, true)).toMatchObject({ liters: 0.521, quantity: 2, plausible: true });
    expect(convertFluidQuantity(500, 'cc', 0.5, true).quantity).toBe(1);
  });
  test('quantites douteuses : 587,5 « l » lu en cm3, 65 l invraisemblable, unite inconnue', () => {
    expect(convertFluidQuantity(587.5, 'l', 0.5, true)).toMatchObject({ liters: 0.5875, quantity: 2, corrected: true });
    expect(convertFluidQuantity(65, 'l', 1, false).plausible).toBe(false);
    expect(convertFluidQuantity(3, null, 1, false)).toMatchObject({ quantity: null, plausible: false });
  });
  test('regle de rattachement : manuel, sinon forfait G8, sinon a confirmer', () => {
    expect(linkFluidLine({ qty: 3.4, unit: 'l', qtyFromSource: true, litersPerUnit: 1, wholeUnits: false, profileQuantity: 3.1 }))
      .toEqual({ quantity: 3.4, confidence: 'sur', quantitySource: 'manuel' });
    expect(linkFluidLine({ qty: 1, unit: 'l', qtyFromSource: false, litersPerUnit: 1, wholeUnits: false, profileQuantity: 3.1 }))
      .toEqual({ quantity: 3.1, confidence: 'sur', quantitySource: 'forfait_g8' });
    expect(linkFluidLine({ qty: 1, unit: 'l', qtyFromSource: false, litersPerUnit: 0.5, wholeUnits: true, profileQuantity: null }))
      .toEqual({ quantity: 1, confidence: 'a_confirmer', quantitySource: 'a_verifier' });
    expect(linkFluidLine({ qty: 65, unit: 'l', qtyFromSource: true, litersPerUnit: 1, wholeUnits: false }).confidence).toBe('a_confirmer');
  });
});

describe('profils moteur (quantite d\'huile des forfaits G8)', () => {
  const P = DEFAULT_ENGINE_PROFILES.map((p) => ({ ...p, exclude: p.exclude }));
  const m = (d: string, a: number | null = null, b: number | null = null) => matchEngineProfile(d, a, b, P)?.code ?? null;
  test('1000 SS (capture du client) : 2 soupapes, 3,10 l', () => {
    expect(m('1000 SS | SUPERSPORT > SUPERSPORT > 1000 SS | SUPERSPORT > SUPERSPORT > 1000 SS USA', 2003, 2006)).toBe('deux_soupapes');
    expect(P.find((p) => p.code === 'deux_soupapes')!.oilQuantity).toBe(3.1);
  });
  test('Panigale 1199 : 3,40 l + FILTRE A HUILE 1199', () => {
    const p = matchEngineProfile('1199 PANIGALE | SUPERBIKE > 1199 Panigale > 1199 Panigale S', 2012, 2014, P)!;
    expect(p.code).toBe('panigale_1199');
    expect(p.filterReference).toBe('FILTRE A HUILE 1199');
  });
  test('Multistrada 1200 : 2010-2012 = MOTO 4 ROAD 4,00 l ; plus recente = 4 soupapes', () => {
    const p = matchEngineProfile('800 | MULTISTRADA > 1200 > 1200 S ABS', 2010, 2012, P)!;
    expect([p.code, p.oilReference, p.oilQuantity]).toEqual(['mts1200_2010_2012', 'MOTO 4 ROAD 15W50', 4]);
    expect(m('1200 | MULTISTRADA > 1200 > 1200 S Touring', 2013, 2014)).toBe('quatre_soupapes');
  });
  test('749 / 999 : joint 22032083A ; Diavel, Hypermotard 939 : 4 soupapes ; Monster 696 : 2 soupapes', () => {
    expect(matchEngineProfile('749 S | SUPERBIKE > 749 > 749 S', 2004, 2006, P)!.washerReference).toBe('22032083A');
    expect(m('DIAVEL | DIAVEL > DIAVEL > Diavel Carbon')).toBe('quatre_soupapes');
    expect(m('939 | HYPERMOTARD > 939 > HYPERSTRADA 939')).toBe('quatre_soupapes');
    expect(m('696 | MONSTER > 696 > 696')).toBe('deux_soupapes');
  });
  test('V4 : aucun forfait G8, rien n\'est invente', () => {
    expect(m('PANIGALE V4 | SUPERBIKE > PANIGALE V4 > PANIGALE V4 S')).toBeNull();
    expect(m('V4 | MULTISTRADA > MULTISTRADA V4 > MULTISTRADA V4S')).toBeNull();
  });
});

describe('ecran et insertion', () => {
  test('une ligne rattachee n\'est plus « a designer » mais « quantite a verifier »', () => {
    expect(kitLineFlag({ confidence: 'a_confirmer', catalogRefs: [], articleId: 'oil' })).toBe('qte_a_verifier');
    expect(kitLineFlag({ confidence: 'a_confirmer', catalogRefs: [], articleId: null })).toBe('a_designer');
    expect(kitLineFlag({ confidence: 'sur', articleId: 'oil' })).toBeNull();
    const items = [
      { confidence: 'a_confirmer' as const, articleId: 'oil' }, { confidence: 'a_confirmer' as const, articleId: null },
      { confidence: 'sur' as const, articleId: 'f' },
    ];
    expect(kitToDesignateCount(items)).toBe(1);
    expect(kitQtyToCheckCount(items)).toBe(1);
  });
  test('provenance affichee : forfait G8, ligne standard', () => {
    expect(kitLineSource({ origin: 'defaut', provenance: { besoin: 'defaut' } })).toBe('defaut');
    expect(kitLineSource({ origin: 'deduit', provenance: { besoin: 'forfait_g8' } })).toBe('forfait_g8');
    expect(kitLineSource({ origin: 'deduit', provenance: { besoin: 'manuel' } })).toBe('manuel');
  });
  test('Q40 : la MO d\'un forfait sans prix propre prend le taux horaire de l\'atelier', () => {
    const arts = new Map<string, PricedArticle>([
      ['mo', { id: 'mo', reference: 'MO', designation: 'Main d oeuvre', mgmt_type: 'T', sale_price_ht: null, sale_price_ttc: 0, vat_rate: 21 }],
      ['dds', { id: 'dds', reference: 'APPAREIL DE DIAGNOTI', designation: 'DDS', mgmt_type: 'F', sale_price_ht: 26.86, vat_rate: 21 }],
      ['ctl', { id: 'ctl', reference: 'CONTROLE DES FREINS', designation: 'Controle', mgmt_type: 'F', sale_price_ht: 0, sale_price_ttc: 0, vat_rate: 21 }],
    ]);
    const comps = [
      { articleId: 'mo', reference: 'MO', designation: 'MO', quantity: 1.8 },
      { articleId: 'dds', reference: 'APPAREIL DE DIAGNOTI', designation: 'DDS', quantity: 1 },
      { articleId: 'ctl', reference: 'CONTROLE DES FREINS', designation: 'Controle', quantity: 1 },
    ];
    const lines = kitInsertLines({ title: 'ENTRETIEN ANNUEL 2 SOUPAPES', components: comps, articles: arts, labourRateHt: 109.74 });
    expect(lines[1]).toMatchObject({ type: 'mo', quantity: 1.8, unit_price_ht: 109.74 });
    expect(lines[2]).toMatchObject({ type: 'piece', unit_price_ht: 26.86 });
    expect(lines[3]).toMatchObject({ unit_price_ht: 0 });
    const withOwn = new Map(arts);
    withOwn.set('mo', { ...arts.get('mo')!, sale_price_ht: 95 });
    expect(kitInsertLines({ title: '', components: comps.slice(0, 1), articles: withOwn, labourRateHt: 109.74 })[0].unit_price_ht).toBe(95);
    expect(kitInsertLines({ title: '', components: comps.slice(0, 1), articles: arts })[0].unit_price_ht).toBe(0);
  });
});
