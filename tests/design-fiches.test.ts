/**
 * Lot « design des fiches » (20/11/2026, revue UX/UI validée par le client) :
 *  - fiche client en 5 onglets + « Plus », sans rien perdre (chaque ancien onglet a sa place) ;
 *  - encours en une seule tuile « Rien à payer » / « Reste à payer X € » ;
 *  - liste des clients : vrais liens, actions dangereuses sous « Outils » ;
 *  - fiche moto en 5 onglets (charte §5.7), blocs commerce seulement pour une moto du stock,
 *    un seul « Enregistrer » rouge ;
 *  - vocabulaire « Clients » et libellés présents dans les quatre langues.
 * Règles PURES de présentation, aucune règle métier nouvelle. Exécution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIENT_MAIN_TABS, CLIENT_MORE_TABS, CLIENT_TAB_LABEL, LEGACY_CLIENT_TAB, encoursTile, isMoreTab, parseClientTab,
} from '../src/modules/contacts/fiche-tabs';
import { VEHICLE_TABS, parseVehicleTab, showCommerceBlocks } from '../src/modules/vehicles/fiche-tabs';
import { designFichesEn, designFichesFr, designFichesIt, designFichesNl } from '../src/lib/i18n/design-fiches';
import { fr } from '../src/lib/i18n/fr';
import { nl } from '../src/lib/i18n/nl';
import { en } from '../src/lib/i18n/en';
import { it } from '../src/lib/i18n/it';
import { t } from '../src/lib/i18n';

const ROOT = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('fiche client : onglets', () => {
  test('5 onglets principaux + « Plus », dans l\'ordre validé', () => {
    expect([...CLIENT_MAIN_TABS]).toEqual(['essentiel', 'motos', 'atelier', 'documents', 'relances']);
    expect(CLIENT_MORE_TABS.length).toBeGreaterThan(0);
    for (const v of CLIENT_MORE_TABS) expect(isMoreTab(v)).toBe(true);
    for (const v of CLIENT_MAIN_TABS) expect(isMoreTab(v)).toBe(false);
  });
  test('onglet lu dans l\'adresse : valeur inconnue ignorée', () => {
    expect(parseClientTab('relances')).toBe('relances');
    expect(parseClientTab('archives')).toBe('archives');
    expect(parseClientTab('g8-rdv')).toBeUndefined();
    expect(parseClientTab(undefined)).toBeUndefined();
    expect(parseClientTab(3)).toBeUndefined();
  });
  test('rien ne disparaît : les 20 anciens onglets ont tous une place', () => {
    const legacy = ['fiche', 'parc', 'documents', 'echeances', 'relances', 'reportees', 'livraisons', 'contacts', 'tarifs',
      'documents-ged', 'comms', 'g8-mail', 'g8-rgpd', 'g8-dispo', 'g8-archives', 'g8-rdv', 'g8-relances', 'g8-images',
      'g8-groupes', 'g8-groupement'];
    expect(Object.keys(LEGACY_CLIENT_TAB).sort()).toEqual([...legacy].sort());
    for (const k of legacy) expect(parseClientTab(LEGACY_CLIENT_TAB[k])).toBe(LEGACY_CLIENT_TAB[k]);
    // Doublons fusionnés : un seul onglet Documents, un seul onglet Relances.
    expect(LEGACY_CLIENT_TAB['documents']).toBe(LEGACY_CLIENT_TAB['documents-ged']);
    expect(new Set([LEGACY_CLIENT_TAB.echeances, LEGACY_CLIENT_TAB.relances, LEGACY_CLIENT_TAB['g8-relances']]).size).toBe(1);
  });
  test('la route affiche encore chaque panneau d\'avant', () => {
    const src = read('src/routes/_app.clients.$contactId.tsx');
    const panels = ['<ContactForm', '<ParcTab', '<DocumentsTab', '<DueItemsTab', '<ClientReceivablesTab', '<DeferredPanel',
      '<DeliveryTab', '<SubcontactsTab', '<PriceRulesTab', '<AttachmentsPanel', '<CommunicationsPanel', '<CampaignHistoryTab',
      '<RgpdTab', '<DispoTab', '<ArchivesTab', '<AppointmentsTab', '<FollowupsTab', '<ImagesTab', '<GroupsTab', '<GroupSalesTab'];
    for (const p of panels) expect(src).toContain(p);
    for (const v of [...CLIENT_MAIN_TABS, ...CLIENT_MORE_TABS]) expect(src).toContain(`value="${v}"`);
    expect(src).toContain('validateSearch');
    // Fusion, archivage, suppression : rangés sous « Outils ».
    expect(src).toContain("t('designFiches.tools')");
  });
  test('chaque onglet a un libellé traduit', () => {
    for (const key of Object.values(CLIENT_TAB_LABEL)) expect(t(key)).not.toBe(key);
  });
});

describe('fiche client : tuile d\'encours', () => {
  test('rien à payer', () => {
    const r = encoursTile({ clientDue: 0, overdue: false, toReceiveFromOrg: 0, financingPending: 0, credit: { authorized: 0, current: 0, available: 0 } });
    expect(r.kind).toBe('nothing');
    expect(r.tone).toBe('success');
    expect(r.showCredit).toBe(false);
  });
  test('un reliquat d\'arrondi compte pour rien', () => {
    expect(encoursTile({ clientDue: 0.004, overdue: true, toReceiveFromOrg: 0, financingPending: 0 }).kind).toBe('nothing');
  });
  test('reste à payer, en retard = danger', () => {
    const r = encoursTile({ clientDue: 1027, overdue: true, toReceiveFromOrg: 0, financingPending: 0 });
    expect(r).toMatchObject({ kind: 'due', tone: 'danger', due: 1027, overdue: true });
    expect(encoursTile({ clientDue: 50, overdue: false, toReceiveFromOrg: 0, financingPending: 0 }).tone).toBe('warning');
  });
  test('ligne de crédit seulement si un crédit est accordé ou dépassé', () => {
    expect(encoursTile({ clientDue: 0, overdue: false, toReceiveFromOrg: 0, financingPending: 0, credit: { authorized: 5000, current: 0, available: 5000 } }).showCredit).toBe(true);
    const over = encoursTile({ clientDue: 0, overdue: false, toReceiveFromOrg: 0, financingPending: 0, credit: { authorized: 0, current: 200, available: -200 } });
    expect(over).toMatchObject({ showCredit: true, creditOver: 200, tone: 'danger' });
  });
});

describe('liste des clients', () => {
  test('lignes en vrais liens, outils dangereux à part de « Nouveau client »', () => {
    const src = read('src/routes/_app.clients.index.tsx');
    expect(src).toContain('<Link\n');
    expect(src).toContain('to="/clients/$contactId"');
    expect(src).toContain('onAuxClick');
    expect(src).toContain("t('designFiches.tools')");
    // Cascade et purge RGPD dans le menu (DropdownMenuItem), plus en boutons.
    expect(src).not.toMatch(/<Button[^>]*\/clients\/cascade/);
    expect(src).not.toMatch(/<Button[^>]*\/clients\/rgpd/);
    expect(src).toContain("<DropdownMenuItem onSelect={() => navigate({ to: '/clients/cascade' })}>");
    expect(src).toContain("<DropdownMenuItem onSelect={() => navigate({ to: '/clients/rgpd' })}");
  });
});

describe('fiche moto', () => {
  test('onglets de la charte §5.7', () => {
    expect([...VEHICLE_TABS]).toEqual(['infos', 'atelier', 'documents', 'photos', 'comptabilite']);
    expect(parseVehicleTab('photos')).toBe('photos');
    expect(parseVehicleTab('bilan')).toBeUndefined();
  });
  test('blocs commerce : moto du stock oui, moto de client non', () => {
    expect(showCommerceBlocks({ status: 'stock_vo', article_id: 'a1' })).toBe(true);
    expect(showCommerceBlocks({ status: 'depot_vente', article_id: null })).toBe(true);
    expect(showCommerceBlocks({ status: 'vendu', article_id: 'a1' })).toBe(true); // vendue par nous : bilan utile
    expect(showCommerceBlocks({ status: 'vendu', article_id: null })).toBe(false); // moto de client (M-12)
    expect(showCommerceBlocks({ status: 'livre' })).toBe(false);
  });
  test('la route garde tous les blocs et un seul bouton rouge', () => {
    const src = read('src/routes/_app.vehicles.$vehicleId.tsx');
    const blocks = ['<VehicleForm', '<VehiclePartiesPanel', '<VehicleEconomicsPanel', '<VehicleBonusesPanel', '<MotoSitePanel',
      '<DucatiInfoPanel', '<VehicleNextServicePanel', '<VehicleMaintenancePanel', '<DeferredPanel', '<VehicleRegisterPanel',
      '<AttachmentsPanel', '<InterestedContactsPanel', '<VehicleWorkshopHistoryPanel', '<VehicleReceptionPhotos', '<PosterDialog'];
    for (const b of blocks) expect(src).toContain(b);
    for (const v of VEHICLE_TABS) expect(src).toContain(`value="${v}"`);
    expect(src).toContain('showCommerceBlocks(vehicle)');
    // En-têtes du tableau des documents traduits (plus de « N° / Total TTC » en dur).
    expect(src).not.toContain("'Total TTC'");
    // Enregistrements secondaires en contour : le seul rouge est l'« Enregistrer » de la fiche.
    const g8 = read('src/modules/vehicles/fiche-g8-panels.tsx');
    expect(g8).toContain('<Button size="sm" variant="outline" onClick={() => m.mutate()}');
    expect(g8).toContain('<Button variant="outline" onClick={() => add.mutate()}');
    const next = read('src/modules/workshop/vehicle-next-service-panel.tsx');
    expect(next).toContain('<Button size="sm" variant="outline" onClick={() => save.mutate()}');
    const form = read('src/modules/vehicles/vehicle-form.tsx');
    expect(form).toContain('sticky bottom-0');
  });
});

describe('vocabulaire et dictionnaires', () => {
  test('mêmes clés dans les quatre langues', () => {
    const keys = Object.keys(designFichesFr).sort();
    for (const d of [designFichesNl, designFichesEn, designFichesIt]) expect(Object.keys(d).sort()).toEqual(keys);
  });
  test('« Clients » partout pour l\'objet client (menu et titre)', () => {
    expect(fr.nav.clients).toBe('Clients');
    expect(fr.contacts.title).toBe('Clients');
    expect(nl.nav.clients).toBe('Klanten');
    expect(en.nav.clients).toBe('Customers');
    expect(it.nav.clients).toBe('Clienti');
    for (const d of [fr, nl, en, it]) expect(d.contacts.title).toBe(d.nav.clients);
  });
  test('vocabulaire du dépôt-vente réservé aux dépôts, pas de « (s) »', () => {
    expect(fr.motoParc.clientBikeHint).not.toContain('confiée');
    expect(fr.vinId.complete).not.toContain('(s)');
  });
});
