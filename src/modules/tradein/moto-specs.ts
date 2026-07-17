/**
 * M7 — Base de spécifications motos (préremplissage automatique de l'assistant
 * de reprise : cylindrée, puissance d'origine, cylindres, carburant).
 * Données constructeur usuelles (fiches techniques publiques type motoplanete.com) ;
 * la valeur préremplie reste modifiable par l'utilisateur.
 * Fonctions PURES — testées dans tests/reprise-wizard.test.ts.
 */

export type MotoSpec = {
  brand: string;
  model: string;
  cc: number;        // cylindrée cm³
  ch: number;        // puissance d'origine (ch)
  cylinders: number;
  fuel: 'Essence' | 'Électrique';
};

const S = (brand: string, model: string, cc: number, ch: number, cylinders: number, fuel: MotoSpec['fuel'] = 'Essence'): MotoSpec =>
  ({ brand, model, cc, ch, cylinders, fuel });

export const MOTO_SPECS: MotoSpec[] = [
  // ── Ducati — gamme actuelle ──────────────────────────────────────────────
  S('Ducati', 'Panigale V4', 1103, 215, 4),
  S('Ducati', 'Panigale V4 S', 1103, 215, 4),
  S('Ducati', 'Panigale V4 R', 998, 218, 4),
  S('Ducati', 'Panigale V2', 955, 155, 2),
  S('Ducati', 'Streetfighter V4', 1103, 208, 4),
  S('Ducati', 'Streetfighter V4 S', 1103, 208, 4),
  S('Ducati', 'Streetfighter V2', 955, 153, 2),
  S('Ducati', 'Monster', 937, 111, 2),
  S('Ducati', 'Monster +', 937, 111, 2),
  S('Ducati', 'Monster SP', 937, 111, 2),
  S('Ducati', 'Multistrada V4', 1158, 170, 4),
  S('Ducati', 'Multistrada V4 S', 1158, 170, 4),
  S('Ducati', 'Multistrada V4 Rally', 1158, 170, 4),
  S('Ducati', 'Multistrada V2', 937, 113, 2),
  S('Ducati', 'Multistrada V2 S', 937, 113, 2),
  S('Ducati', 'DesertX', 937, 110, 2),
  S('Ducati', 'Diavel V4', 1158, 168, 4),
  S('Ducati', 'XDiavel V4', 1158, 168, 4),
  S('Ducati', 'Hypermotard 950', 937, 114, 2),
  S('Ducati', 'Hypermotard 698 Mono', 659, 77, 1),
  S('Ducati', 'SuperSport 950', 937, 110, 2),
  S('Ducati', 'Scrambler Icon', 803, 73, 2),
  S('Ducati', 'Scrambler Nightshift', 803, 73, 2),
  S('Ducati', 'Scrambler Full Throttle', 803, 73, 2),
  S('Ducati', 'Scrambler Desert Sled', 803, 73, 2),
  S('Ducati', 'Scrambler 1100', 1079, 86, 2),
  // ── Ducati — générations précédentes ─────────────────────────────────────
  S('Ducati', '899 Panigale', 898, 148, 2),
  S('Ducati', '959 Panigale', 955, 157, 2),
  S('Ducati', '1199 Panigale', 1198, 195, 2),
  S('Ducati', '1299 Panigale', 1285, 205, 2),
  S('Ducati', '848', 849, 134, 2),
  S('Ducati', '848 EVO', 849, 140, 2),
  S('Ducati', '1098', 1099, 160, 2),
  S('Ducati', '1198', 1198, 170, 2),
  S('Ducati', '916', 916, 114, 2),
  S('Ducati', '996', 996, 112, 2),
  S('Ducati', '998', 998, 123, 2),
  S('Ducati', '999', 999, 124, 2),
  S('Ducati', '749', 748, 103, 2),
  S('Ducati', 'Monster 600', 583, 51, 2),
  S('Ducati', 'Monster 696', 696, 80, 2),
  S('Ducati', 'Monster 796', 803, 87, 2),
  S('Ducati', 'Monster 821', 821, 109, 2),
  S('Ducati', 'Monster 900', 904, 71, 2),
  S('Ducati', 'Monster 1200', 1198, 147, 2),
  S('Ducati', 'Monster 1200 S', 1198, 150, 2),
  S('Ducati', 'Multistrada 950', 937, 113, 2),
  S('Ducati', 'Multistrada 1200', 1198, 150, 2),
  S('Ducati', 'Multistrada 1260', 1262, 158, 2),
  S('Ducati', 'Hypermotard 796', 803, 81, 2),
  S('Ducati', 'Hypermotard 821', 821, 110, 2),
  S('Ducati', 'Hypermotard 1100', 1078, 90, 2),
  S('Ducati', 'Diavel', 1198, 162, 2),
  S('Ducati', 'Diavel 1260', 1262, 159, 2),
  S('Ducati', 'XDiavel', 1262, 152, 2),
  S('Ducati', 'ST2', 944, 83, 2),
  S('Ducati', 'ST3', 992, 102, 2),
  S('Ducati', 'ST4', 916, 107, 2),
  S('Ducati', 'Scrambler Sixty2', 399, 41, 2),
  // ── BMW ──────────────────────────────────────────────────────────────────
  S('BMW', 'R 1250 GS', 1254, 136, 2),
  S('BMW', 'R 1200 GS', 1170, 125, 2),
  S('BMW', 'R 1300 GS', 1300, 145, 2),
  S('BMW', 'S 1000 RR', 999, 207, 4),
  S('BMW', 'S 1000 R', 999, 165, 4),
  S('BMW', 'F 850 GS', 853, 95, 2),
  S('BMW', 'F 900 R', 895, 105, 2),
  S('BMW', 'R nineT', 1170, 110, 2),
  // ── Honda ────────────────────────────────────────────────────────────────
  S('Honda', 'CB650R', 649, 95, 4),
  S('Honda', 'CBR650R', 649, 95, 4),
  S('Honda', 'Africa Twin', 1084, 102, 2),
  S('Honda', 'CBR1000RR-R Fireblade', 999, 217, 4),
  S('Honda', 'CB750 Hornet', 755, 92, 2),
  S('Honda', 'X-ADV', 745, 59, 2),
  // ── Yamaha ───────────────────────────────────────────────────────────────
  S('Yamaha', 'MT-07', 689, 73, 2),
  S('Yamaha', 'MT-09', 890, 119, 3),
  S('Yamaha', 'MT-10', 998, 166, 4),
  S('Yamaha', 'R1', 998, 200, 4),
  S('Yamaha', 'R7', 689, 73, 2),
  S('Yamaha', 'Tracer 9', 890, 119, 3),
  S('Yamaha', 'Ténéré 700', 689, 73, 2),
  S('Yamaha', 'XSR900', 890, 119, 3),
  // ── Kawasaki ─────────────────────────────────────────────────────────────
  S('Kawasaki', 'Z650', 649, 68, 2),
  S('Kawasaki', 'Z900', 948, 125, 4),
  S('Kawasaki', 'Ninja ZX-10R', 998, 203, 4),
  S('Kawasaki', 'Ninja 650', 649, 68, 2),
  S('Kawasaki', 'Versys 650', 649, 66, 2),
  // ── KTM ──────────────────────────────────────────────────────────────────
  S('KTM', '390 Duke', 373, 44, 1),
  S('KTM', '790 Duke', 799, 105, 2),
  S('KTM', '890 Duke R', 889, 121, 2),
  S('KTM', '1290 Super Duke R', 1301, 180, 2),
  S('KTM', '1290 Super Adventure', 1301, 160, 2),
  // ── Triumph ──────────────────────────────────────────────────────────────
  S('Triumph', 'Street Triple 765 RS', 765, 130, 3),
  S('Triumph', 'Speed Triple 1200 RS', 1160, 180, 3),
  S('Triumph', 'Trident 660', 660, 81, 3),
  S('Triumph', 'Bonneville T120', 1200, 80, 2),
  S('Triumph', 'Tiger 900', 888, 95, 3),
  // ── Aprilia ──────────────────────────────────────────────────────────────
  S('Aprilia', 'RS 660', 659, 100, 2),
  S('Aprilia', 'Tuono 660', 659, 95, 2),
  S('Aprilia', 'Tuono V4', 1099, 175, 4),
  S('Aprilia', 'RSV4', 1099, 217, 4),
  // ── Divers ───────────────────────────────────────────────────────────────
  S('Harley-Davidson', 'Pan America 1250', 1252, 152, 2),
  S('Moto Guzzi', 'V7', 853, 65, 2),
  S('Moto Guzzi', 'V85 TT', 853, 80, 2),
  S('MV Agusta', 'Brutale 800', 798, 140, 3),
  S('Royal Enfield', 'Interceptor 650', 648, 47, 2),
  S('Zero', 'SR/F', 0, 110, 0, 'Électrique'),
  S('Zero', 'DSR/X', 0, 102, 0, 'Électrique'),
];

const ci = (s: string) => s.trim().toLowerCase();

/** Modèles connus pour une marque (suggestions du champ Modèle). */
export function modelsForBrand(brand: string): string[] {
  const b = ci(brand);
  return MOTO_SPECS.filter((s) => ci(s.brand) === b).map((s) => s.model);
}

/** Specs d'un modèle : correspondance exacte d'abord, puis préfixe (« Panigale V4 S 2022 »). */
export function findSpecs(brand: string, model: string): MotoSpec | null {
  const b = ci(brand), m = ci(model);
  if (!b || !m) return null;
  const inBrand = MOTO_SPECS.filter((s) => ci(s.brand) === b);
  const exact = inBrand.find((s) => ci(s.model) === m);
  if (exact) return exact;
  // Préfixe le plus long (V4 S avant V4)
  const prefix = inBrand
    .filter((s) => m.startsWith(ci(s.model)))
    .sort((a, x) => x.model.length - a.model.length)[0];
  return prefix ?? null;
}
