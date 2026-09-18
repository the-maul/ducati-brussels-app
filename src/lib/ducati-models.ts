/**
 * Gamme Ducati — données statiques pour le choix de la moto (inscription client,
 * borne du comptoir). Utilisé par `src/components/moto-picker.tsx`.
 *
 * Organisation : famille → modèles, chaque modèle avec ses années de
 * commercialisation (première année-modèle, dernière ou `null` = toujours au
 * catalogue). Les années proposées au client sont bornées par ces valeurs.
 *
 * Les noms de familles et de modèles sont des noms propres (marque) : ce sont
 * des DONNÉES, pas des libellés d'interface, ils ne passent donc pas par l'i18n.
 *
 * Maintenance : ajouter un modèle = une ligne dans sa famille. Garder l'ordre
 * « plus récent d'abord » dans chaque famille ; les familles sont affichées dans
 * l'ordre de ce tableau (les plus demandées en premier). À relire par la
 * concession à chaque nouveau millésime.
 */

export type DucatiModel = {
  /** Nom affiché et enregistré (ex. « Panigale V4 S »). */
  name: string;
  /** Première année-modèle. */
  from: number;
  /** Dernière année-modèle, ou null si toujours au catalogue. */
  to: number | null;
};

export type DucatiFamily = {
  /** Identifiant stable (enregistré en base avec la déclaration). */
  key: string;
  /** Nom affiché de la famille. */
  name: string;
  models: DucatiModel[];
};

export const DUCATI_FAMILIES: DucatiFamily[] = [
  {
    key: 'panigale', name: 'Panigale', models: [
      { name: 'Panigale V4', from: 2018, to: null },
      { name: 'Panigale V4 S', from: 2018, to: null },
      { name: 'Panigale V4 R', from: 2019, to: null },
      { name: 'Panigale V4 SP2', from: 2022, to: 2024 },
      { name: 'Panigale V4 SP', from: 2021, to: 2021 },
      { name: 'Panigale V4 Tricolore', from: 2025, to: null },
      { name: 'Panigale V2', from: 2020, to: null },
      { name: 'Panigale V2 S', from: 2025, to: null },
      { name: '1299 Panigale', from: 2015, to: 2017 },
      { name: '1199 Panigale', from: 2012, to: 2014 },
      { name: '959 Panigale', from: 2016, to: 2019 },
      { name: '899 Panigale', from: 2014, to: 2015 },
      { name: 'Superleggera V4', from: 2020, to: 2021 },
    ],
  },
  {
    key: 'monster', name: 'Monster', models: [
      { name: 'Monster', from: 2021, to: null },
      { name: 'Monster +', from: 2021, to: null },
      { name: 'Monster SP', from: 2023, to: null },
      { name: 'Monster 1200', from: 2014, to: 2021 },
      { name: 'Monster 821', from: 2014, to: 2020 },
      { name: 'Monster 797', from: 2017, to: 2020 },
      { name: 'Monster 1100', from: 2009, to: 2013 },
      { name: 'Monster 796', from: 2010, to: 2014 },
      { name: 'Monster 696', from: 2008, to: 2014 },
      { name: 'Monster S4R', from: 2003, to: 2008 },
      { name: 'Monster 900', from: 1993, to: 2002 },
      { name: 'Monster 600 / 620 / 750', from: 1994, to: 2006 },
    ],
  },
  {
    key: 'multistrada', name: 'Multistrada', models: [
      { name: 'Multistrada V4', from: 2021, to: null },
      { name: 'Multistrada V4 S', from: 2021, to: null },
      { name: 'Multistrada V4 Rally', from: 2023, to: null },
      { name: 'Multistrada V4 Pikes Peak', from: 2022, to: null },
      { name: 'Multistrada V4 RS', from: 2024, to: null },
      { name: 'Multistrada V2', from: 2022, to: null },
      { name: 'Multistrada V2 S', from: 2022, to: null },
      { name: 'Multistrada 1260', from: 2018, to: 2020 },
      { name: 'Multistrada 1200', from: 2010, to: 2017 },
      { name: 'Multistrada 950', from: 2017, to: 2021 },
      { name: 'Multistrada 1000 / 1100 DS', from: 2003, to: 2009 },
    ],
  },
  {
    key: 'scrambler', name: 'Scrambler', models: [
      { name: 'Scrambler Icon', from: 2015, to: null },
      { name: 'Scrambler Icon Dark', from: 2020, to: null },
      { name: 'Scrambler Full Throttle', from: 2015, to: null },
      { name: 'Scrambler Nightshift', from: 2021, to: null },
      { name: 'Scrambler 1100', from: 2018, to: 2023 },
      { name: 'Scrambler Desert Sled', from: 2017, to: 2023 },
      { name: 'Scrambler Café Racer', from: 2017, to: 2020 },
      { name: 'Scrambler Sixty2', from: 2016, to: 2020 },
    ],
  },
  {
    key: 'streetfighter', name: 'Streetfighter', models: [
      { name: 'Streetfighter V4', from: 2020, to: null },
      { name: 'Streetfighter V4 S', from: 2020, to: null },
      { name: 'Streetfighter V4 SP2', from: 2022, to: 2024 },
      { name: 'Streetfighter V2', from: 2022, to: null },
      { name: 'Streetfighter V2 S', from: 2025, to: null },
      { name: 'Streetfighter 1098', from: 2009, to: 2013 },
      { name: 'Streetfighter 848', from: 2012, to: 2015 },
    ],
  },
  {
    key: 'diavel', name: 'Diavel & XDiavel', models: [
      { name: 'Diavel V4', from: 2023, to: null },
      { name: 'Diavel V4 RS', from: 2025, to: null },
      { name: 'Diavel 1260', from: 2019, to: 2022 },
      { name: 'Diavel', from: 2011, to: 2018 },
      { name: 'XDiavel V4', from: 2025, to: null },
      { name: 'XDiavel', from: 2016, to: 2024 },
    ],
  },
  {
    key: 'hypermotard', name: 'Hypermotard', models: [
      { name: 'Hypermotard 698 Mono', from: 2024, to: null },
      { name: 'Hypermotard V2', from: 2025, to: null },
      { name: 'Hypermotard 950', from: 2019, to: 2024 },
      { name: 'Hypermotard 950 SP', from: 2019, to: 2024 },
      { name: 'Hypermotard 939', from: 2016, to: 2018 },
      { name: 'Hypermotard 821', from: 2013, to: 2015 },
      { name: 'Hypermotard 796 / 1100', from: 2007, to: 2012 },
    ],
  },
  {
    key: 'desertx', name: 'DesertX', models: [
      { name: 'DesertX', from: 2022, to: null },
      { name: 'DesertX Rally', from: 2024, to: null },
      { name: 'DesertX Discovery', from: 2025, to: null },
    ],
  },
  {
    key: 'supersport', name: 'SuperSport', models: [
      { name: 'SuperSport 950', from: 2021, to: 2024 },
      { name: 'SuperSport 950 S', from: 2021, to: 2024 },
      { name: 'SuperSport 939', from: 2017, to: 2020 },
    ],
  },
  {
    key: 'superbike_classic', name: 'Superbike (avant Panigale)', models: [
      { name: '1198', from: 2009, to: 2011 },
      { name: '1098', from: 2007, to: 2008 },
      { name: '848', from: 2008, to: 2013 },
      { name: '999', from: 2003, to: 2006 },
      { name: '749', from: 2003, to: 2006 },
      { name: '998', from: 2002, to: 2004 },
      { name: '996', from: 1999, to: 2001 },
      { name: '916', from: 1994, to: 1998 },
      { name: '748', from: 1995, to: 2002 },
      { name: '851 / 888', from: 1988, to: 1994 },
    ],
  },
  {
    key: 'sport_touring_classic', name: 'Sport Touring & classiques', models: [
      { name: 'SportClassic (Paul Smart, GT, Sport)', from: 2006, to: 2010 },
      { name: 'ST2 / ST3 / ST4', from: 1997, to: 2007 },
      { name: 'SS (Supersport à carburateurs / i.e.)', from: 1989, to: 2007 },
      { name: 'Paso', from: 1986, to: 1993 },
    ],
  },
  {
    key: 'offroad', name: 'Off-Road', models: [
      { name: 'Desmo450 MX', from: 2025, to: null },
    ],
  },
];

/** Autres marques proposées quand le client ne roule pas en Ducati (liste courte, « Autre » en saisie libre). */
export const OTHER_BRANDS: string[] = [
  'Aprilia', 'BMW', 'Harley-Davidson', 'Honda', 'Husqvarna', 'Indian', 'Kawasaki',
  'KTM', 'Moto Guzzi', 'MV Agusta', 'Royal Enfield', 'Suzuki', 'Triumph', 'Yamaha',
];

/** Année-modèle la plus récente proposée : le millésime suivant apparaît en novembre (salon EICMA). */
export function latestModelYear(now: Date = new Date()): number {
  return now.getFullYear() + (now.getMonth() >= 10 ? 1 : 0);
}

/** Années proposées pour un modèle, de la plus récente à la plus ancienne. */
export function yearsFor(model: DucatiModel, now: Date = new Date()): number[] {
  const last = Math.min(model.to ?? latestModelYear(now), latestModelYear(now));
  const out: number[] = [];
  for (let y = last; y >= model.from; y--) out.push(y);
  return out;
}

/** Années proposées pour une autre marque (30 dernières années). */
export function recentYears(now: Date = new Date(), span = 30): number[] {
  const last = latestModelYear(now);
  return Array.from({ length: span }, (_, i) => last - i);
}

export function findFamily(key: string): DucatiFamily | undefined {
  return DUCATI_FAMILIES.find((f) => f.key === key);
}
