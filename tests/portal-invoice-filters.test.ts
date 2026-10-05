/**
 * Filtres de « Mes factures » (portail client).
 * Jeu d'essai calqué sur le cas réel AGM : factures à son nom, factures de la
 * fiche liée (FONTEIO) et facture d'achat de la moto au nom de CBC BANQUE.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL, MINE, NO_FILTER, buildInvoiceFilterOptions, filterInvoices, isFiltered,
} from '../src/modules/portal/invoice-filters';
import type { PortalInvoiceSummary } from '../src/modules/portal/api';

const inv = (p: Partial<PortalInvoiceSummary>): PortalInvoiceSummary => ({
  id: Math.random().toString(36).slice(2),
  doc_type: 'FAC',
  number: '1',
  issue_date: '2024-01-01',
  due_date: null,
  status: 'payee',
  total_ttc: 100,
  paid_amount: 100,
  vehicle_label: null,
  imported: true,
  on_behalf: null,
  pdf_path: null,
  ...p,
});

const SF = 'DUCATI STREETFIGHTER V2 S';
const MONSTER = 'DUCATI MONSTER 821';

const list: PortalInvoiceSummary[] = [
  inv({ number: '25001434', issue_date: '2025-10-28', total_ttc: 20963.91, vehicle_label: SF, on_behalf: 'CBC BANQUE' }),
  inv({ number: '26000542', issue_date: '2026-05-15', total_ttc: 686.09, vehicle_label: SF }),
  inv({ number: '24001485', issue_date: '2024-12-03', total_ttc: 132.1 }),
  inv({ number: '20180705', issue_date: '2018-07-17', total_ttc: 11854.08, vehicle_label: MONSTER, on_behalf: 'FONTEIO' }),
  inv({ number: '20190982', issue_date: '2019-10-04', total_ttc: 28.72, vehicle_label: MONSTER, on_behalf: 'FONTEIO' }),
];

const amountLabel = (k: string) => k;

describe('filtres des factures du portail', () => {
  it('sans filtre, rend toutes les factures', () => {
    expect(filterInvoices(list, NO_FILTER)).toHaveLength(5);
    expect(isFiltered(NO_FILTER)).toBe(false);
  });

  it('filtre par moto', () => {
    const r = filterInvoices(list, { ...NO_FILTER, vehicle: SF });
    expect(r.map((d) => d.number)).toEqual(['25001434', '26000542']);
  });

  it('filtre par titulaire : « à mon nom » exclut fiche liée et financement', () => {
    const r = filterInvoices(list, { ...NO_FILTER, profile: MINE });
    expect(r.map((d) => d.number)).toEqual(['26000542', '24001485']);
  });

  it('filtre par titulaire : une fiche précise', () => {
    const r = filterInvoices(list, { ...NO_FILTER, profile: 'CBC BANQUE' });
    expect(r.map((d) => d.number)).toEqual(['25001434']);
  });

  it('filtre par année', () => {
    expect(filterInvoices(list, { ...NO_FILTER, year: '2019' }).map((d) => d.number)).toEqual(['20190982']);
    expect(filterInvoices(list, { ...NO_FILTER, year: '2030' })).toHaveLength(0);
  });

  it('filtre par tranche de montant, bornes comprises/exclues', () => {
    expect(filterInvoices(list, { ...NO_FILTER, amount: 'lt100' }).map((d) => d.number)).toEqual(['20190982']);
    // 132,10 € tombe dans 100–500, pas dans « moins de 100 ».
    expect(filterInvoices(list, { ...NO_FILTER, amount: 'r100' }).map((d) => d.number)).toEqual(['24001485']);
    expect(filterInvoices(list, { ...NO_FILTER, amount: 'r500' }).map((d) => d.number)).toEqual(['26000542']);
    expect(filterInvoices(list, { ...NO_FILTER, amount: 'gt2000' }).map((d) => d.number)).toEqual(['25001434', '20180705']);
  });

  it('combine les filtres', () => {
    const r = filterInvoices(list, { vehicle: MONSTER, profile: 'FONTEIO', year: '2018', amount: 'gt2000' });
    expect(r.map((d) => d.number)).toEqual(['20180705']);
  });

  it('ne propose que des options qui donnent un résultat', () => {
    const o = buildInvoiceFilterOptions(list, 'À mon nom', amountLabel);
    expect(o.vehicles.map((v) => v.value)).toEqual([MONSTER, SF]);
    expect(o.profiles.map((v) => v.value)).toEqual([MINE, 'CBC BANQUE', 'FONTEIO']);
    expect(o.years.map((v) => v.value)).toEqual(['2026', '2025', '2024', '2019', '2018']);
    expect(o.amounts.map((v) => v.value)).toEqual(['lt100', 'r100', 'r500', 'gt2000']);
  });

  it('chaque option proposée rend au moins une facture', () => {
    const o = buildInvoiceFilterOptions(list, 'À mon nom', amountLabel);
    for (const v of o.vehicles) expect(filterInvoices(list, { ...NO_FILTER, vehicle: v.value }).length).toBeGreaterThan(0);
    for (const p of o.profiles) expect(filterInvoices(list, { ...NO_FILTER, profile: p.value }).length).toBeGreaterThan(0);
    for (const y of o.years) expect(filterInvoices(list, { ...NO_FILTER, year: y.value }).length).toBeGreaterThan(0);
    for (const a of o.amounts) expect(filterInvoices(list, { ...NO_FILTER, amount: a.value }).length).toBeGreaterThan(0);
  });

  it('un client sans fiche liée n’a pas de filtre titulaire à proposer', () => {
    const o = buildInvoiceFilterOptions([inv({}), inv({})], 'À mon nom', amountLabel);
    expect(o.profiles).toHaveLength(1); // une seule option → la puce ne s'affiche pas
  });

  it('ALL est une valeur neutre sur chaque critère', () => {
    expect(filterInvoices(list, { vehicle: ALL, profile: ALL, year: ALL, amount: ALL })).toHaveLength(5);
  });
});
