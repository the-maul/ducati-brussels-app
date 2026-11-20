/**
 * Libelles du CA du tableau de bord, decision client Q66 (20/11/2026) : « CA HT » hors ventes pour
 * le compte des deposants, et « CA HT y compris depot-vente » en dessous (`dashboardCa`). Fichier a
 * part (meme principe que decisions-q57-q60.ts). Le FR fait foi : les trois autres langues ont
 * exactement les memes cles (type `Shape`, test i18n-dictionnaires). Apostrophes droites uniquement.
 */

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

export const dashboardCaFr = {
  dashboardCa: {
    todayHt: "CA HT du jour",
    monthHt: "CA HT du mois",
    withConsignment: "y compris dépôt-vente : {amount}",
    hint: "Hors ventes pour le compte des déposants (dépôt-vente). Avoirs déduits.",
  },
};

export const dashboardCaNl: Shape<typeof dashboardCaFr> = {
  dashboardCa: {
    todayHt: "Omzet excl. btw vandaag",
    monthHt: "Omzet excl. btw deze maand",
    withConsignment: "incl. consignatieverkoop: {amount}",
    hint: "Zonder verkopen voor rekening van de consignatiegevers. Creditnota's afgetrokken.",
  },
};

export const dashboardCaEn: Shape<typeof dashboardCaFr> = {
  dashboardCa: {
    todayHt: "Revenue excl. VAT today",
    monthHt: "Revenue excl. VAT this month",
    withConsignment: "incl. consignment sales: {amount}",
    hint: "Excluding sales made on behalf of consignors. Credit notes deducted.",
  },
};

export const dashboardCaIt: Shape<typeof dashboardCaFr> = {
  dashboardCa: {
    todayHt: "Fatturato IVA esclusa di oggi",
    monthHt: "Fatturato IVA esclusa del mese",
    withConsignment: "incluso conto vendita: {amount}",
    hint: "Escluse le vendite per conto dei depositanti (conto vendita). Note di credito dedotte.",
  },
};
