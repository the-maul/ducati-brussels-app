/**
 * « La plaque suit le motard » (Simon, 26/11/2026, VEH001). En Belgique la plaque appartient au
 * motard : quand il rachète une moto et y met sa plaque, elle quitte ses motos plus anciennes, qui
 * restent dans le DMS sans plaque. Chaque moto garde l'historique de ses plaques
 * (table vehicle_plate_history, migration 20261126220000, tenue par la base).
 *
 * Règles pures, testées dans tests/vehicle-plate-history.test.ts :
 *  - même motard : même propriétaire actuel, ou propriétaire = banque / leasing et même client
 *    financé (les `riders` d'une moto contiennent déjà ce client) ;
 *  - moto la plus récente : date de la dernière vente au motard, puis année du modèle ;
 *  - anciennes plaques affichées sous le champ plaque.
 */

/** Ce qu'on sait d'une moto pour savoir laquelle est la plus récente. */
export type BikeRecency = {
  id: string;
  vin: string | null;
  modelYear: number | null;
  productionDate: string | null;
  /** Propriétaires actuels (+ client financé quand le propriétaire est une banque). Vide = sans propriétaire. */
  riders: string[];
  /** Dernière facture de vente adressée au motard (AAAA-MM-JJ). */
  riderInvoiceDate: string | null;
  /** Dernière facture de vente de la moto, quel que soit le client. */
  anyInvoiceDate: string | null;
  /** Début du propriétaire actuel, sauf date d'import G8 (non fiable). */
  ownerFrom: string | null;
  /** vehicles.sold_date : pour une reprise revendue, c'est la date de revente par la concession. */
  soldDate: string | null;
};

const VIN_YEAR_LETTERS = 'ABCDEFGHJKLMNPRSTVWXY'; // A = 2010 … Y = 2030 (cycle de 30 ans)

/** Année-modèle lue au 10e caractère d'un VIN Ducati complet (ZDM…, 17 caractères). */
export function vinModelYear(vin: string | null | undefined, maxYear = new Date().getFullYear() + 1): number | null {
  const v = String(vin ?? '').toUpperCase();
  if (!/^ZDM[A-HJ-NPR-Z0-9]{14}$/.test(v)) return null;
  const c = v[9];
  const i = VIN_YEAR_LETTERS.indexOf(c);
  if (i >= 0) {
    const y = 2010 + i;
    return y > maxYear ? y - 30 : y;
  }
  if (/[1-9]/.test(c)) return 2000 + Number(c);
  return null;
}

/** Année du modèle : model_year, sinon année de production, sinon VIN Ducati. */
export function bikeYear(b: Pick<BikeRecency, 'modelYear' | 'productionDate' | 'vin'>, maxYear?: number): number | null {
  if (b.modelYear) return b.modelYear;
  if (b.productionDate) return Number(b.productionDate.slice(0, 4)) || null;
  return vinModelYear(b.vin, maxYear);
}

/** Même motard : un propriétaire (ou client financé) en commun. Une fiche sans propriétaire n'en a aucun. */
export function sameRider(a: Pick<BikeRecency, 'riders'>, b: Pick<BikeRecency, 'riders'>): boolean {
  return a.riders.some((r) => b.riders.includes(r));
}

/**
 * Date de la dernière vente au motard. `prudent` : facture au motard, sinon début du propriétaire ;
 * `large` : toute facture de vente, sinon date de vente, sinon début du propriétaire.
 * Fiche sans propriétaire (souvent une reprise revendue) : pas de date.
 */
export function lastSaleDate(b: BikeRecency, method: 'prudent' | 'large' = 'prudent'): string | null {
  if (!b.riders.length) return null;
  if (method === 'large') return b.anyInvoiceDate ?? b.soldDate ?? b.ownerFrom;
  return b.riderInvoiceDate ?? b.ownerFrom;
}

/** > 0 : `a` est plus récente que `b` ; 0 : on ne peut pas trancher. */
export function compareBikeRecency(a: BikeRecency, b: BikeRecency, method: 'prudent' | 'large' = 'prudent', maxYear?: number): number {
  const sa = lastSaleDate(a, method);
  const sb = lastSaleDate(b, method);
  if (sa && sb && sa !== sb) return sa > sb ? 1 : -1;
  // La moto vendue au client l'emporte sur une fiche sans propriétaire.
  if (sa && !sb && !b.riders.length) return 1;
  if (sb && !sa && !a.riders.length) return -1;
  const ya = bikeYear(a, maxYear);
  const yb = bikeYear(b, maxYear);
  if (ya && yb && ya !== yb) return ya > yb ? 1 : -1;
  // En dernier recours (méthode prudente) : la date de vente de deux motos du client.
  if (method === 'prudent' && a.riders.length && b.riders.length && a.soldDate && b.soldDate && a.soldDate !== b.soldDate) {
    return a.soldDate > b.soldDate ? 1 : -1;
  }
  return 0;
}

function strictlyNewest(bikes: BikeRecency[], method: 'prudent' | 'large', maxYear?: number): BikeRecency | null {
  return bikes.find((v) => bikes.every((w) => w === v || compareBikeRecency(v, w, method, maxYear) > 0)) ?? null;
}

/**
 * La moto qui garde la plaque dans un groupe du même motard. null = doute (aucune moto clairement
 * plus récente, ou les deux lectures des dates se contredisent) : on ne touche à rien.
 */
export function mostRecentBike(bikes: BikeRecency[], maxYear?: number): BikeRecency | null {
  if (bikes.length === 1) return bikes[0];
  const prudent = strictlyNewest(bikes, 'prudent', maxYear);
  const large = strictlyNewest(bikes, 'large', maxYear);
  return prudent && prudent === large ? prudent : null;
}

/* ------------------------------------------------------------------ Historique affiché */

export type PlateHistoryRow = {
  id: string;
  plate: string;
  from_date: string | null;
  to_date: string | null;
  is_current: boolean;
  reason: string | null;
  created_at: string;
};

/** Anciennes plaques (pas celle en cours), la plus récente d'abord ; sans date de fin en dernier. */
export function previousPlates<T extends PlateHistoryRow>(rows: T[], currentPlate?: string | null): T[] {
  const cur = String(currentPlate ?? '').trim().toUpperCase();
  return rows
    .filter((r) => !r.is_current && r.plate.trim().toUpperCase() !== cur)
    .sort((a, b) => {
      if (a.to_date !== b.to_date) {
        if (!a.to_date) return 1;
        if (!b.to_date) return -1;
        return a.to_date < b.to_date ? 1 : -1;
      }
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
    });
}
