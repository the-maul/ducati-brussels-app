/**
 * Lecture de la fiche DCS (tools/myducati-extension/dcs-core.js) sur du HTML fictif qui reproduit
 * les vrais libellés du portail. Noms, VIN et coordonnées sont inventés.
 */
import { describe, expect, test } from 'bun:test';
import '../tools/myducati-extension/dcs-core.js';

type Core = {
  parseTitle: (s: string) => { descriptor: string; year: number; market: string } | null;
  parseHeaderLine: (s: string) => { vin: string | null; plate: string | null };
  parseDate: (s: string) => string | null;
  parseKm: (s: string) => number | null;
  readPage: (root: unknown) => {
    vin: string | null; issues: string[];
    header: { title: string | null; descriptor: string | null; year: number | null; market: string | null; plate: string | null };
    vehicle: Record<string, unknown>; contact: Record<string, unknown>;
  };
  readEvents: (root: unknown) => { rows: Array<Record<string, unknown>>; tables: string[] };
  readBulletins: (root: unknown) => Array<Record<string, unknown>>;
  requestedVin: (url: string) => string | null;
  buildPayload: (page: unknown, events: unknown, bulletins: unknown, vin: string | null) => Record<string, unknown>;
};
const core = (globalThis as unknown as { DmsDcsCore: Core }).DmsDcsCore;

// Minimal DOM: just what dcs-core reads (same property names as the browser).
class El {
  children: El[] = [];
  parentElement: El | null = null;
  attrs: Record<string, string> = {};
  text: Array<string | El> = [];
  constructor(public tagName: string) {}
  getAttribute(n: string) { return n in this.attrs ? this.attrs[n] : null; }
  get textContent(): string { return this.text.map((x) => (typeof x === 'string' ? x : x.textContent)).join(''); }
  get nextElementSibling(): El | null {
    const s = this.parentElement?.children ?? [];
    return s[s.indexOf(this) + 1] ?? null;
  }
}
const VOID = new Set(['input', 'img', 'br', 'use']);
function html(src: string): El {
  const root = new El('BODY');
  const stack: El[] = [root];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.text.push(m[5]); continue; }
    if (m[1]) { stack.pop(); continue; }
    const el = new El(m[2].toUpperCase());
    for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) el.attrs[a[1]] = a[2] ?? '';
    el.parentElement = top;
    top.children.push(el);
    top.text.push(el);
    if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
  }
  return root;
}

const VIN = 'ZDM00000000000001';
const field = (label: string, value: string) => `<div class="f"><span>${label}</span><span>${value}</span></div>`;
const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const table = (heads: string[], rows: string[][]) =>
  `<table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
const BASE = ['Événement', 'Type', 'ID', 'Référence', 'État', 'Symptôme/Défaut', 'Cause', 'km/mi/h'];

const PAGE = `
<header>
  <h1>MULTISTRADA 1200 S TOURING DUCATI RED 2016 FRA</h1>
  <p>VIN: ${VIN} | Plaque d'immatriculation: TST260</p>
  <div><span>État de Maintenance</span><span>A jour</span></div>
  <div><span>État de la Garantie</span><span>expiré depuis 300 jours</span></div>
  <div><span>Type de Garantie</span><span>Tuile</span></div>
  <div><span>Dernier Kilométrage</span><span>1 km</span></div>
</header>
<nav><a>Événements</a><a>Détails</a><a>Bulletins</a></nav>
<section>
  <h2>Détails de la Moto</h2>
  ${field('Numéro de Moteur', 'ZDM 1198 A2-000001')}${field('État', 'En Service')}${field('Utilisation', 'Client')}
  ${field('Date de Production', '6/07/2016')}${field('Dernier Kilométrage', '23436 km')}
  ${field("Date d’Expédition depuis Ducati", '20/07/2016')}${field('Moto Facturée à', '100001 CONCESSION TEST')}
</section>
<section>
  <h2>Détails du Client</h2>
  ${field('Nom', 'CAMILLE EXEMPLE')}${field('Code Ducati', 'C-0001')}${field('Email', 'camille@example.test')}
  ${field('Date de naissance', '01/01/1980')}${field('Téléphone mobile', '+32000000000')}${field('Pays', 'Belgique')}
  ${field('Adresse postale', '1 rue Fictive')}${field('Code postal', '1000')}${field('Ville', 'Bruxelles')}${field('Région/Province', '-')}
  <div><span>Activité de Marketing</span><span><lightning-icon icon-name="utility:check"></lightning-icon></span></div>
  <div><span>Profilage</span><span><lightning-icon icon-name="utility:close"></lightning-icon></span></div>
  <div><span>Monetary</span><span>★★★☆☆</span></div>
  <div><span>Propriétaire Actuel</span><span><svg class="mystery"></svg></span></div>
</section>
<section>
  <h2>Détails de Garantie</h2>
  ${field('Date de Début de Garantie', '1/08/2016')}${field('Date de Fin de Garantie', '31/07/2018')}
  ${field('Type de Garantie', 'Conventionnelle (24 mois)')}${field('Garantie Activée par', '100001 CONCESSION TEST')}
  ${field('État de la Garantie', 'Expirée')}${field('Âge', '3400')}
</section>
${table([...BASE, "Prochaine Date d'Echéance"], [['Maintenance', 'Annual Service', '-', '-', 'Prévu', '-', '-', '30.000 km', '15/03/2027']])}
${table([...BASE, 'Date de création', 'Concessionnaire'], [['Garantie', 'RED2', 'E000000002', 'R2', 'En cours', 'D12', 'C3', '20.000 km', '2/02/2026', 'CONCESSION TEST']])}
${table([...BASE, 'Date', 'Concessionnaire'], [
  ['Maintenance', 'Oil Service 1000km/600mi', '10000001', '-', 'Fait', '-', '-', '1.000 km', '5/09/2016', 'CONCESSION TEST'],
  ['Garantie', 'WCRC', 'E000000001', 'R1', 'Remboursé', 'D10', 'C7', '12.345 km', '3/04/2018', 'CONCESSION TEST'],
])}
${table(['ID de Bulletin', 'Titre', 'Numéro de Bulletin', 'Date de Publication'], [['900', 'Bulletin fictif', 'SRV-TST-26-001', '1/02/2026']])}
`;

describe('lecture par libellé exact', () => {
  const page = core.readPage(html(PAGE));

  test('« État » ne prend ni une colonne ni « État de la Garantie »', () => {
    expect(page.vehicle.ducati_state).toBe('En Service');
    expect(page.vehicle.warranty_state).toBe('Expirée');
  });

  test('les tuiles de l’en-tête ne remplacent pas la section', () => {
    expect(page.vehicle.last_km).toBe('23436 km');
    expect(page.vehicle.warranty_type).toBe('Conventionnelle (24 mois)');
  });

  test('apostrophe typographique et « - » = vide', () => {
    expect(page.vehicle.ship_date).toBe('20/07/2016');
    expect(page.contact.region).toBeNull();
  });

  test('un champ vide ne prend pas le libellé suivant', () => {
    const p = core.readPage(html(`<section><h2>Détails du Client</h2>
      <div><span>Email</span><span></span></div>${field('Téléphone mobile', '+32000000001')}</section>`));
    expect(p.contact.my_ducati_email).toBeNull();
    expect(p.contact.my_ducati_phone).toBe('+32000000001');
  });

  test('en-tête : modèle + couleur, année, marché, plaque, VIN', () => {
    expect(page.vin).toBe(VIN);
    expect(page.header.descriptor).toBe('MULTISTRADA 1200 S TOURING DUCATI RED');
    expect(page.header.year).toBe(2016);
    expect(page.header.market).toBe('FRA');
    expect(page.header.plate).toBe('TST260');
    expect(core.parseHeaderLine(`VIN: ${VIN} | Plaque d'immatriculation: -`).plate).toBeNull();
  });

  test('icônes et étoiles : interprétées, sinon vides et jamais « faux »', () => {
    expect(page.contact.my_ducati_marketing).toBe(true);
    expect(page.contact.my_ducati_profiling).toBe(false);
    expect(page.contact.my_ducati_is_current_owner).toBeNull();
    expect(page.contact.my_ducati_score).toBe(3);
  });
});

describe('événements', () => {
  const ev = core.readEvents(html(PAGE));
  const byId = (id: string) => ev.rows.find((r) => r.ducati_event_id === id)!;

  test('les trois tableaux sont conservés, garantie comprise', () => {
    expect([...ev.tables].sort()).toEqual(['current', 'past', 'upcoming']);
    expect(ev.rows).toHaveLength(4);
    expect(byId('E000000001')).toMatchObject({ kind: 'past', event_category: 'Garantie', service_type: 'WCRC', state: 'Remboursé', symptom: 'D10', cause: 'C7', km: 12345 });
  });

  test('chaque tableau a la bonne date', () => {
    const upcoming = ev.rows.find((r) => r.kind === 'upcoming')!;
    expect(upcoming).toMatchObject({ due_date: '2027-03-15', event_date: null });
    expect(byId('E000000002')).toMatchObject({ kind: 'current', event_date: '2026-02-02', due_date: null });
    expect(byId('10000001')).toMatchObject({ kind: 'past', event_date: '2016-09-05' });
  });

  test('une ligne sans ID garde une clé stable', () => {
    const again = core.readEvents(html(PAGE)).rows.find((r) => r.kind === 'upcoming')!;
    expect(String(again.ducati_event_id).startsWith('auto:')).toBe(true);
    expect(again.ducati_event_id).toBe(ev.rows.find((r) => r.kind === 'upcoming')!.ducati_event_id);
  });

  test('un tableau affiché deux fois ne double pas les lignes', () => {
    const twice = PAGE + table([...BASE, 'Date', 'Concessionnaire'], [['Maintenance', 'Oil Service 1000km/600mi', '10000001', '-', 'Fait', '-', '-', '1.000 km', '5/09/2016', 'CONCESSION TEST']]);
    expect(core.readEvents(html(twice)).rows).toHaveLength(4);
  });

  test('bulletins lus par leurs colonnes', () => {
    expect(core.readBulletins(html(PAGE))).toMatchObject([{ bulletin_id: '900', number: 'SRV-TST-26-001', published_at: '1/02/2026' }]);
  });
});

describe('formats et VIN', () => {
  test('date impossible ou kilomètres dans une autre unité : vide', () => {
    expect(core.parseDate('31/02/2025')).toBeNull();
    expect(core.parseDate('6/07/2022')).toBe('2022-07-06');
    expect(core.parseKm('12.345 km')).toBe(12345);
    expect(core.parseKm('500 mi')).toBeNull();
  });

  test('titre sans année ou marché : refusé', () => {
    expect(core.parseTitle('Fiche moto')).toBeNull();
    expect(core.parseTitle('MULTISTRADA 1200 S TOURING ICEBERG WHITE 2015 FRA')?.market).toBe('FRA');
  });

  test('VIN lu différent du VIN demandé : erreur de lecture', () => {
    const page = core.readPage(html(PAGE));
    expect(core.requestedVin(`https://portal.test/s/vinhistory?vin=${VIN}`)).toBe(VIN);
    expect(core.buildPayload(page, { rows: [], tables: [] }, [], VIN).read_error).toBeNull();
    expect(core.buildPayload(page, { rows: [], tables: [] }, [], 'ZDM99999999999999').read_error).toBe('vin_mismatch');
  });

  test('page sans VIN (connexion) : erreur de lecture', () => {
    const page = core.readPage(html('<p>Connexion</p>'));
    expect(core.buildPayload(page, { rows: [], tables: [] }, [], VIN).read_error).toBe('vin_not_found');
  });
});
