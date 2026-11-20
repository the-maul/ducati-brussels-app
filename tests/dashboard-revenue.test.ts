/**
 * M13 — CA du tableau de bord, décision Q66 (20/11/2026) : CA HT hors dépôt-vente en chiffre
 * principal, y compris dépôt-vente en détail ; repli sur l'ancien CA TTC sans la migration.
 */
import { describe, expect, it } from 'bun:test';
import { dashboardRevenue } from '../src/modules/reports/dashboard-revenue';
import { fr } from '../src/lib/i18n/fr';
import { nl } from '../src/lib/i18n/nl';
import { en } from '../src/lib/i18n/en';
import { it as itDict } from '../src/lib/i18n/it';

const raw = {
  revenue_today: 8253.18, revenue_month: 9000,
  revenue_ht_today: '1035.68', revenue_ht_month: 1500,
  revenue_ht_today_incl_consignment: '8035.68', revenue_ht_month_incl_consignment: 8500,
};

describe('dashboardRevenue (Q66)', () => {
  it('jour : CA HT hors dépôt en principal, y compris dépôt-vente en détail', () => {
    expect(dashboardRevenue(raw, 'today')).toEqual({ ht: true, main: 1035.68, withConsignment: 8035.68 });
  });
  it('mois : mêmes règles', () => {
    expect(dashboardRevenue(raw, 'month')).toEqual({ ht: true, main: 1500, withConsignment: 8500 });
  });
  it('base sans la migration : ancien CA TTC, pas de détail', () => {
    expect(dashboardRevenue({ revenue_today: 120, revenue_month: 300 }, 'today')).toEqual({ ht: false, main: 120, withConsignment: null });
    expect(dashboardRevenue({ revenue_month: 300 }, 'month')).toEqual({ ht: false, main: 300, withConsignment: null });
  });
  it('réponse vide ou nulle : 0 sans planter', () => {
    expect(dashboardRevenue(null, 'today')).toEqual({ ht: false, main: 0, withConsignment: null });
    expect(dashboardRevenue({}, 'month')).toEqual({ ht: false, main: 0, withConsignment: null });
  });
  it('CA HT à 0 reste un chiffre HT (pas le repli TTC)', () => {
    expect(dashboardRevenue({ revenue_today: 50, revenue_ht_today: 0, revenue_ht_today_incl_consignment: 0 }, 'today'))
      .toEqual({ ht: true, main: 0, withConsignment: 0 });
  });
  it('libellés présents dans les quatre langues', () => {
    for (const d of [fr, nl, en, itDict]) {
      expect(d.dashboardCa.todayHt.length).toBeGreaterThan(0);
      expect(d.dashboardCa.monthHt.length).toBeGreaterThan(0);
      expect(d.dashboardCa.withConsignment).toContain('{amount}');
    }
  });
});
