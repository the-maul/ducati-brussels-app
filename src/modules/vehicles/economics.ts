/**
 * Rattrapage G8 (18/11/2026, lot parc) — onglet « Bilan economique » de la fiche produit fini G8 :
 * prix d'achat net HT, prix de revient HT, PV HT / TVA / PV TTC, marge previsionnelle (EUR et %),
 * cote. Logique PURE, testee dans tests/parc-fiche-moto.test.ts.
 *
 * Regimes (B2) :
 *  - V (neuf) et P (occasion pro) : TVA 21 % sur le prix, PV HT = PV TTC / (1 + taux) ;
 *  - O (occasion particulier, TVA sur la marge) : la TVA ne porte que sur PV TTC - prix d'achat
 *    (prix de reprise, base legale), TVA = marge x taux / (100 + taux) ; PV HT = PV TTC - cette TVA ;
 *  - D (depot-vente) : la moto n'est pas a nous, pas de marge sur le prix (commission a part).
 * Marge previsionnelle = PV HT - prix de revient (PA + remise en etat + frais, B3) ;
 * % = taux de marque (marge / PV HT), comme la « Marge (PAHT) / Taux de marque » de G8.
 * Les primes et aides constructeur (Saisie de prime) s'ajoutent a la marge « primes comprises ».
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export type EconomicsInput = {
  mgmtType: string | null | undefined;     // V, O, P, D (article de la moto) ; null = V par defaut
  purchasePrice: number | null | undefined; // PA net HT ou prix de reprise
  costPrice: number | null | undefined;     // prix de revient HT
  saleTtc: number | null | undefined;       // PV TTC (prix affiche)
  vatRate?: number | null;                  // 21 par defaut
  bonuses?: number | null;                  // total des primes et aides
  marketValue?: number | null;              // cote (argus)
};

export type Economics = {
  scheme: 'normal' | 'marge' | 'depot';
  purchase: number | null;
  cost: number | null;
  saleTtc: number | null;
  saleHt: number | null;
  vat: number | null;
  margin: number | null;
  marginPct: number | null;
  bonuses: number;
  marginWithBonuses: number | null;
  marketValue: number | null;
  /** PV TTC - cote : positif = au-dessus de la cote */
  gapToMarket: number | null;
};

const val = (n: number | null | undefined): number | null => (n == null || !Number.isFinite(Number(n)) ? null : Number(n));

export function vehicleEconomics(i: EconomicsInput): Economics {
  const mgmt = (i.mgmtType ?? 'V').toUpperCase();
  const scheme: Economics['scheme'] = mgmt === 'O' ? 'marge' : mgmt === 'D' ? 'depot' : 'normal';
  const rate = val(i.vatRate) ?? 21;
  const purchase = val(i.purchasePrice);
  const cost = val(i.costPrice) ?? purchase;
  const saleTtc = val(i.saleTtc);
  const bonuses = r2(val(i.bonuses) ?? 0);
  const marketValue = val(i.marketValue);

  let saleHt: number | null = null;
  let vat: number | null = null;
  if (saleTtc != null && saleTtc > 0) {
    if (scheme === 'marge') {
      const base = Math.max(saleTtc - (purchase ?? 0), 0);
      vat = r2((base * rate) / (100 + rate));
      saleHt = r2(saleTtc - vat);
    } else if (scheme === 'normal') {
      saleHt = r2(saleTtc / (1 + rate / 100));
      vat = r2(saleTtc - saleHt);
    }
  }
  const margin = scheme !== 'depot' && saleHt != null && cost != null ? r2(saleHt - cost) : null;
  const marginPct = margin != null && saleHt != null && saleHt > 0 ? Math.round((margin / saleHt) * 10000) / 100 : null;
  return {
    scheme, purchase, cost, saleTtc, saleHt, vat, margin, marginPct, bonuses,
    marginWithBonuses: margin != null ? r2(margin + bonuses) : null,
    marketValue,
    gapToMarket: saleTtc != null && marketValue != null ? r2(saleTtc - marketValue) : null,
  };
}

/** Jours de stock (G8 « Jour(s) stock ») : de l'entree a la sortie, ou a aujourd'hui. */
export function daysInStockOf(entry: string | null | undefined, sold: string | null | undefined, today: Date = new Date()): number | null {
  if (!entry) return null;
  const start = new Date(entry);
  if (Number.isNaN(start.getTime())) return null;
  const end = sold ? new Date(sold) : today;
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

export type Bonus = { id: string; bonus_date: string; amount: number; comment: string | null; vehicle_id: string };

/** Primes d'une periode (bornes incluses, AAAA-MM-JJ) et leur total. */
export function bonusesInPeriod<T extends Pick<Bonus, 'bonus_date' | 'amount'>>(rows: ReadonlyArray<T>, from?: string | null, to?: string | null): { rows: T[]; total: number } {
  const kept = rows.filter((r) => (!from || r.bonus_date >= from) && (!to || r.bonus_date <= to));
  return { rows: kept, total: r2(kept.reduce((s, r) => s + Number(r.amount || 0), 0)) };
}

/** Fin de garantie proposee : mise en circulation (ou entree) + duree en mois. */
export function warrantyEndFrom(start: string | null | undefined, months: number | null | undefined): string | null {
  if (!start || !months || months <= 0) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]) - 1 + Math.round(months); const d = Number(m[3]);
  const target = new Date(Date.UTC(y + Math.floor(mo / 12), mo % 12, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
