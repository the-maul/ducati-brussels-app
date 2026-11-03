/**
 * Choix d'une moto apres un client (OR, RDV, document de vente) — logique pure, testee.
 *
 * Bug client du 03/11/2026 (ATE001) : le selecteur de l'OR ne montrait pas les motos du client
 * et le client se vidait. Regles :
 *  - les motos dont le client est le proprietaire courant passent en premier ;
 *  - des 2 caracteres, on cherche aussi dans tout le parc (VIN, plaque, modele, marque) ;
 *  - une moto du client qui ressort aussi de la recherche n'apparait qu'une fois, en tete ;
 *  - choisir une moto ne touche jamais au client, et inversement.
 */

export type VehiclePickRow = {
  id: string;
  vin: string | null;
  plate: string | null;
  brand: string | null;
  model: string | null;
  model_year?: number | null;
};

/** Le terme compte comme une recherche a partir de 2 caracteres utiles. */
export const VEHICLE_SEARCH_MIN = 2;

export function normalizeVehicleTerm(term: string): string {
  return term.replace(/[,()%*]/g, ' ').trim().toLowerCase();
}

export function isVehicleSearch(term: string): boolean {
  return normalizeVehicleTerm(term).length >= VEHICLE_SEARCH_MIN;
}

/** La moto correspond-elle au terme (VIN, plaque, modele, marque, annee) ? */
export function vehicleMatches(v: VehiclePickRow, term: string): boolean {
  const q = normalizeVehicleTerm(term);
  if (!q) return true;
  const hay = [v.vin, v.plate, v.model, v.brand, v.model_year != null ? String(v.model_year) : null]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  // La plaque se tape avec ou sans tirets : 1-ABC-123 == 1ABC123.
  const compact = q.replace(/[-\s]/g, '');
  return hay.some((h) => h.includes(q) || (compact.length > 0 && h.replace(/[-\s]/g, '').includes(compact)));
}

export type VehicleChoices<V extends VehiclePickRow> = {
  /** Motos du client (proprietaire courant), filtrees par le terme s'il y en a un. */
  own: V[];
  /** Motos du reste du parc trouvees par la recherche, sans celles du client. */
  park: V[];
  /** Le terme declenche-t-il une recherche dans le parc ? */
  searching: boolean;
};

/**
 * Compose la liste proposee : motos du client en tete (filtrees par le terme), puis les motos du
 * parc trouvees par la recherche, sans doublon.
 */
export function buildVehicleChoices<V extends VehiclePickRow>(input: { own: V[]; found: V[]; term: string }): VehicleChoices<V> {
  const searching = isVehicleSearch(input.term);
  const own = searching ? input.own.filter((v) => vehicleMatches(v, input.term)) : input.own;
  const ownIds = new Set(own.map((v) => v.id));
  const park = searching ? input.found.filter((v) => !ownIds.has(v.id)) : [];
  return { own, park, searching };
}

/** Ce que le menu doit dire quand il n'y a rien a lister. */
export type VehiclePickEmpty = 'none' | 'noClient' | 'noneForClient' | 'noneFound';

export function vehiclePickEmptyState(input: {
  contactId: string | null; ownLoaded: boolean; searchLoaded: boolean; choices: VehicleChoices<VehiclePickRow>;
}): VehiclePickEmpty {
  const { contactId, ownLoaded, searchLoaded, choices } = input;
  if (choices.searching) {
    if (!searchLoaded) return 'none';
    return choices.own.length + choices.park.length === 0 ? 'noneFound' : 'none';
  }
  if (!contactId) return 'noClient';
  if (ownLoaded && choices.own.length === 0) return 'noneForClient';
  return 'none';
}

/* ---- Client + moto : une selection a deux cases, chaque case independante ---- */

export type ClientVehicleSelection<C, V> = { contact: C | null; vehicle: V | null };

export function pickVehicle<C, V>(sel: ClientVehicleSelection<C, V>, vehicle: V): ClientVehicleSelection<C, V> {
  return { contact: sel.contact, vehicle };
}
export function clearVehicle<C, V>(sel: ClientVehicleSelection<C, V>): ClientVehicleSelection<C, V> {
  return { contact: sel.contact, vehicle: null };
}
export function pickContact<C, V>(sel: ClientVehicleSelection<C, V>, contact: C): ClientVehicleSelection<C, V> {
  return { contact, vehicle: sel.vehicle };
}
export function clearContact<C, V>(sel: ClientVehicleSelection<C, V>): ClientVehicleSelection<C, V> {
  return { contact: null, vehicle: sel.vehicle };
}
