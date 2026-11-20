/**
 * Libellés du lot « VP G8 » (décisions du client du 20/11/2026, « tout comme G8 ») : champs
 * obligatoires de l'OR et de la cession (VP8), frais du dépôt-vente à charge du déposant (VP4),
 * compagnons qui comptent dans la charge atelier (VP9), libellés d'entretien en français.
 * Le FR fait foi : les trois autres langues ont exactement les mêmes clés (type `Shape`, test
 * i18n-dictionnaires). Apostrophes droites uniquement.
 */

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

export const vpG8Fr = {
  orRequired: "OR : complétez {fields} (obligatoire, comme dans G8).",
  cessionRequired: "Cession : complétez {fields} (obligatoire, comme dans G8).",
  fieldOperator: "Opérateur",
  fieldClient: "Client",
  fieldVehicle: "N° de série (moto)",
  fieldType: "Type de cession",
  cessionVehicleRequired: "Obligatoire pour ce type de cession (n° de série de la moto).",
  repairsSuggestWithDepot: "Reprendre les OR non facturés ({m}) et les frais de la cession ({d})",
  depotCostsHint: "Frais de la cession du dépôt, à charge du déposant : {m} (déduits du reversement).",
  depotCostsOpen: "{n} cession(s) du dépôt encore ouverte(s) avec des lignes : validez-la avant la vente pour que ses frais soient déduits.",
  countsInLoad: "Charge",
  countsInLoadHint: "Compte dans la charge atelier (compagnon) : sa capacité et ses RDV entrent dans le taux d'occupation du planning.",
  serviceAnnual: "Entretien annuel",
  serviceOil: "Entretien vidange",
  serviceDesmo: "Entretien Desmo (jeu aux soupapes)",
  serviceValve: "Contrôle du jeu aux soupapes",
  serviceFirst: "1er entretien (1 000 km)",
  serviceCheck: "Contrôle d'entretien",
};

export const vpG8Nl: Shape<typeof vpG8Fr> = {
  orRequired: "OR: vul {fields} in (verplicht, zoals in G8).",
  cessionRequired: "Overdracht: vul {fields} in (verplicht, zoals in G8).",
  fieldOperator: "Operator",
  fieldClient: "Klant",
  fieldVehicle: "Chassisnummer (motor)",
  fieldType: "Type overdracht",
  cessionVehicleRequired: "Verplicht voor dit type overdracht (chassisnummer van de motor).",
  repairsSuggestWithDepot: "Niet-gefactureerde OR ({m}) en kosten van de overdracht ({d}) overnemen",
  depotCostsHint: "Kosten van de overdracht van de consignatie, ten laste van de inbrenger: {m} (afgetrokken van de uitbetaling).",
  depotCostsOpen: "{n} overdracht(en) van de consignatie nog open met lijnen: valideer ze voor de verkoop zodat de kosten worden afgetrokken.",
  countsInLoad: "Belasting",
  countsInLoadHint: "Telt mee in de werkplaatsbelasting (technieker): capaciteit en afspraken tellen mee in de bezettingsgraad van de planning.",
  serviceAnnual: "Jaarlijks onderhoud",
  serviceOil: "Olieonderhoud",
  serviceDesmo: "Desmo-onderhoud (klepspeling)",
  serviceValve: "Controle van de klepspeling",
  serviceFirst: "1e onderhoud (1 000 km)",
  serviceCheck: "Onderhoudscontrole",
};

export const vpG8En: Shape<typeof vpG8Fr> = {
  orRequired: "Repair order: please fill in {fields} (required, as in G8).",
  cessionRequired: "Internal transfer: please fill in {fields} (required, as in G8).",
  fieldOperator: "Operator",
  fieldClient: "Customer",
  fieldVehicle: "Serial number (motorcycle)",
  fieldType: "Transfer type",
  cessionVehicleRequired: "Required for this transfer type (serial number of the motorcycle).",
  repairsSuggestWithDepot: "Use the uninvoiced repair orders ({m}) and the transfer costs ({d})",
  depotCostsHint: "Costs of the consignment transfer, paid by the consignor: {m} (deducted from the payout).",
  depotCostsOpen: "{n} consignment transfer(s) still open with lines: validate it before the sale so its costs are deducted.",
  countsInLoad: "Load",
  countsInLoadHint: "Counts in the workshop load (mechanic): their capacity and appointments count in the planning occupancy rate.",
  serviceAnnual: "Annual service",
  serviceOil: "Oil service",
  serviceDesmo: "Desmo service (valve clearance)",
  serviceValve: "Valve clearance check",
  serviceFirst: "First service (1,000 km)",
  serviceCheck: "Service check",
};

export const vpG8It: Shape<typeof vpG8Fr> = {
  orRequired: "OR: completare {fields} (obbligatorio, come in G8).",
  cessionRequired: "Cessione: completare {fields} (obbligatorio, come in G8).",
  fieldOperator: "Operatore",
  fieldClient: "Cliente",
  fieldVehicle: "N. di telaio (moto)",
  fieldType: "Tipo di cessione",
  cessionVehicleRequired: "Obbligatorio per questo tipo di cessione (numero di telaio della moto).",
  repairsSuggestWithDepot: "Riprendi gli OR non fatturati ({m}) e le spese della cessione ({d})",
  depotCostsHint: "Spese della cessione del conto vendita, a carico del depositante: {m} (dedotte dal versamento).",
  depotCostsOpen: "{n} cessione/i del conto vendita ancora aperta/e con righe: convalidala prima della vendita perché le spese siano dedotte.",
  countsInLoad: "Carico",
  countsInLoadHint: "Conta nel carico dell'officina (meccanico): capacità e appuntamenti entrano nel tasso di occupazione del planning.",
  serviceAnnual: "Tagliando annuale",
  serviceOil: "Tagliando olio",
  serviceDesmo: "Tagliando Desmo (gioco valvole)",
  serviceValve: "Controllo del gioco valvole",
  serviceFirst: "Primo tagliando (1.000 km)",
  serviceCheck: "Controllo tagliando",
};
