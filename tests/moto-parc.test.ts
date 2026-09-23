/**
 * Mission 03 / M03 — « Motos à vendre » (décision M-36) : règles de statut de parc et de publication.
 * CLAUDE.md règle 7. Exécution : `bun test`.
 *
 * Ces règles sont dupliquées en SQL (vehicle_parc_kind / vehicle_needs_article /
 * vehicle_parc_publishable / vehicle_article_mgmt_type, migration 20260923150000).
 * Les tests fixent le contrat des deux côtés.
 */
import { test, expect } from 'bun:test';
import {
  parcKind, needsArticle, canPublish, isCustomerBike, articleMgmtType, articleVatRate,
} from '../src/modules/vehicles/parc';
import { VEHICLE_STATUSES } from '../src/modules/vehicles/api';

test('parcKind : les 11 statuts de parc sont couverts, aucun « interne » par défaut imprévu', () => {
  expect(parcKind('stock_vn')).toBe('en_stock');
  expect(parcKind('stock_vo')).toBe('en_stock');
  expect(parcKind('reserve')).toBe('en_stock');
  expect(parcKind('demo')).toBe('en_stock');
  expect(parcKind('depot_vente')).toBe('depot_vente');
  expect(parcKind('depot_agent')).toBe('depot_vente');
  expect(parcKind('vendu')).toBe('vendue');
  expect(parcKind('livre')).toBe('vendue');
  expect(parcKind('en_commande')).toBe('en_commande');
  expect(parcKind('repris')).toBe('reprise');
  expect(parcKind('courtoisie')).toBe('interne');
  // Tous les statuts de l'énumération sont rangés explicitement.
  for (const s of VEHICLE_STATUSES) expect(typeof parcKind(s.value)).toBe('string');
  expect(VEHICLE_STATUSES.length).toBe(11);
});

test('needsArticle : une moto en stock ou en dépôt-vente porte un article, pas les autres', () => {
  expect(needsArticle('stock_vn')).toBe(true);
  expect(needsArticle('stock_vo')).toBe(true);
  expect(needsArticle('reserve')).toBe(true);
  expect(needsArticle('demo')).toBe(true);
  expect(needsArticle('depot_vente')).toBe(true);
  expect(needsArticle('depot_agent')).toBe(true);
  expect(needsArticle('vendu')).toBe(false);
  expect(needsArticle('livre')).toBe(false);
  expect(needsArticle('en_commande')).toBe(false);
  expect(needsArticle('repris')).toBe(false);
  expect(needsArticle('courtoisie')).toBe(false);
});

test('canPublish : « Publier sur le site » seulement pour En stock (VN/VO) et Dépôt-vente', () => {
  expect(canPublish('stock_vn')).toBe(true);
  expect(canPublish('stock_vo')).toBe(true);
  expect(canPublish('depot_vente')).toBe(true);
  // Réservée, démo, en commande, reprise, courtoisie : jamais proposées.
  for (const s of ['reserve', 'demo', 'en_commande', 'repris', 'courtoisie'] as const) {
    expect(canPublish(s)).toBe(false);
  }
  // Une moto vendue est retirée du site.
  expect(canPublish('vendu')).toBe(false);
  expect(canPublish('livre')).toBe(false);
});

test('canPublish n’est jamais vrai sans article (cohérence avec needsArticle)', () => {
  for (const s of VEHICLE_STATUSES) {
    if (canPublish(s.value)) expect(needsArticle(s.value)).toBe(true);
  }
});

test('isCustomerBike : moto de client = statut « Vendu » sans article (décision M-12)', () => {
  expect(isCustomerBike('vendu', null)).toBe(true);
  expect(isCustomerBike('vendu', undefined)).toBe(true);
  expect(isCustomerBike('vendu', 'art-1')).toBe(false);   // moto vendue par nous
  expect(isCustomerBike('stock_vo', null)).toBe(false);
});

test('articleMgmtType : V neuf / O occasion particulier / P pro / D dépôt-vente (B1)', () => {
  expect(articleMgmtType('stock_vn', null)).toBe('V');
  expect(articleMgmtType('demo', null)).toBe('V');
  expect(articleMgmtType('en_commande', null)).toBe('V');
  expect(articleMgmtType('stock_vo', null)).toBe('O');
  expect(articleMgmtType('repris', null)).toBe('O');
  expect(articleMgmtType('depot_vente', null)).toBe('D');
  expect(articleMgmtType('depot_agent', null)).toBe('D');
  // La référence G8 tranche pour une moto réservée : OCC… = occasion, DEP… = dépôt, sinon neuve.
  expect(articleMgmtType('reserve', 'OCC1260017')).toBe('O');
  expect(articleMgmtType('reserve', 'DEP749')).toBe('D');
  expect(articleMgmtType('reserve', 'MULTISTRADAV4PIKESPEAK')).toBe('V');
  expect(articleMgmtType('reserve', null)).toBe('V');
  // La référence l'emporte aussi quand le statut ne dit rien de plus.
  expect(articleMgmtType('stock_vn', 'DEP558')).toBe('D');
  expect(articleMgmtType('stock_vn', 'occ1250032')).toBe('O');
});

test('articleVatRate : type O en TVA sur marge (0 sur la ligne), V et P à 21 % (B2)', () => {
  expect(articleVatRate('O')).toBe(0);
  expect(articleVatRate('D')).toBe(0);
  expect(articleVatRate('V')).toBe(21);
  expect(articleVatRate('P')).toBe(21);
});
