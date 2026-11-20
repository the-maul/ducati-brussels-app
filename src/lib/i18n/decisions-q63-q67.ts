/**
 * Libellés des décisions client Q63, Q64 et Q67 (20/11/2026) : opérateur au comptoir comme G8
 * (`q63`), km de l'OR vers la fiche moto et « Forcer l'enregistrement du kilométrage inférieur »
 * (`q64`), fiche client comme G8 — civilité / nom / prénom obligatoires, MAJUSCULES (`q67`).
 * Q65 (impression achats) et Q66 (CA HT) ont leurs fichiers (purchase-print.ts, dashboard-ca.ts).
 * Le FR fait foi : les trois autres langues ont exactement les mêmes clés (type `Shape`, test
 * i18n-dictionnaires). Apostrophes droites uniquement.
 */

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

export const decisionsQ63Q67Fr = {
  q63: {
    operator: "Opérateur",
    choose: "Choisir l'opérateur",
    required: "Choisissez l'opérateur (le vendeur qui fait la vente).",
    hint: "Le nom de l'opérateur est imprimé sur le ticket, la facture et le PDF, et compte dans ses statistiques.",
    none: "Aucun opérateur actif : Paramètres → Tables → Opérateurs (vendeurs).",
    inactive: "désactivé",
    errUnknown: "Opérateur inconnu ou désactivé pour cette société : choisissez-en un autre.",
    errLocked: "Le document est validé : son opérateur ne change plus.",
  },
  q64: {
    forceLabel: "Forcer l'enregistrement du kilométrage inférieur",
    forceHint: "La fiche moto garde le relevé le plus haut ({last} km).",
    save: "Enregistrer {km} km",
    errLower: "Kilométrage inférieur : {km} km saisis, dernier relevé {last} km. Corrigez le km ou cochez « Forcer l'enregistrement du kilométrage inférieur ».",
    errLowerShort: "Kilométrage inférieur au dernier relevé ({last} km). Corrigez le km ou cochez « Forcer l'enregistrement du kilométrage inférieur ».",
    vehicleUpdated: "La fiche moto passe à {km} km (relevé de l'OR).",
  },
  q67: {
    errRequired: "Fiche client : compléter {fields}.",
    civility: "Civilité",
    lastName: "Nom",
    firstName: "Prénom",
    companyName: "Raison sociale",
    completeTitle: "Fiche à compléter",
    completeBody: "Comme G8, une fiche de particulier doit avoir une civilité, un nom et un prénom (une société : sa raison sociale). Complétez : {fields}.",
    upperHint: "Enregistré en MAJUSCULES.",
  },
};

export const decisionsQ63Q67Nl: Shape<typeof decisionsQ63Q67Fr> = {
  q63: {
    operator: "Operator",
    choose: "Operator kiezen",
    required: "Kies de operator (de verkoper die de verkoop doet).",
    hint: "De naam van de operator wordt op het kasticket, de factuur en de pdf gedrukt en telt mee in zijn statistieken.",
    none: "Geen actieve operator: Instellingen → Tabellen → Operatoren (verkopers).",
    inactive: "gedeactiveerd",
    errUnknown: "Onbekende of gedeactiveerde operator voor deze vennootschap: kies een andere.",
    errLocked: "Het document is gevalideerd: de operator kan niet meer wijzigen.",
  },
  q64: {
    forceLabel: "Lagere kilometerstand toch opslaan",
    forceHint: "De motorfiche behoudt de hoogste stand ({last} km).",
    save: "{km} km opslaan",
    errLower: "Lagere kilometerstand: {km} km ingevoerd, laatste stand {last} km. Verbeter de stand of vink « Lagere kilometerstand toch opslaan » aan.",
    errLowerShort: "Lagere kilometerstand dan de laatste stand ({last} km). Verbeter de stand of vink « Lagere kilometerstand toch opslaan » aan.",
    vehicleUpdated: "De motorfiche gaat naar {km} km (stand van de werkorder).",
  },
  q67: {
    errRequired: "Klantenfiche: vul {fields} in.",
    civility: "Aanspreking",
    lastName: "Naam",
    firstName: "Voornaam",
    companyName: "Bedrijfsnaam",
    completeTitle: "Fiche aan te vullen",
    completeBody: "Zoals in G8 moet de fiche van een particulier een aanspreking, naam en voornaam hebben (een bedrijf: zijn bedrijfsnaam). Vul aan: {fields}.",
    upperHint: "Opgeslagen in HOOFDLETTERS.",
  },
};

export const decisionsQ63Q67En: Shape<typeof decisionsQ63Q67Fr> = {
  q63: {
    operator: "Operator",
    choose: "Choose the operator",
    required: "Choose the operator (the salesperson making the sale).",
    hint: "The operator's name is printed on the receipt, the invoice and the PDF, and counts in their statistics.",
    none: "No active operator: Settings → Tables → Operators (salespeople).",
    inactive: "deactivated",
    errUnknown: "Unknown or deactivated operator for this company: choose another one.",
    errLocked: "The document is validated: its operator can no longer change.",
  },
  q64: {
    forceLabel: "Force saving the lower mileage",
    forceHint: "The bike record keeps the highest reading ({last} km).",
    save: "Save {km} km",
    errLower: "Lower mileage: {km} km entered, last reading {last} km. Correct the mileage or tick « Force saving the lower mileage ».",
    errLowerShort: "Mileage lower than the last reading ({last} km). Correct the mileage or tick « Force saving the lower mileage ».",
    vehicleUpdated: "The bike record moves to {km} km (repair order reading).",
  },
  q67: {
    errRequired: "Customer record: fill in {fields}.",
    civility: "Title",
    lastName: "Last name",
    firstName: "First name",
    companyName: "Company name",
    completeTitle: "Record to complete",
    completeBody: "As in G8, a private customer needs a title, a last name and a first name (a company: its company name). Please fill in: {fields}.",
    upperHint: "Saved in CAPITALS.",
  },
};

export const decisionsQ63Q67It: Shape<typeof decisionsQ63Q67Fr> = {
  q63: {
    operator: "Operatore",
    choose: "Scegli l'operatore",
    required: "Scegli l'operatore (il venditore che fa la vendita).",
    hint: "Il nome dell'operatore è stampato sullo scontrino, sulla fattura e sul PDF, e conta nelle sue statistiche.",
    none: "Nessun operatore attivo: Impostazioni → Tabelle → Operatori (venditori).",
    inactive: "disattivato",
    errUnknown: "Operatore sconosciuto o disattivato per questa società: scegline un altro.",
    errLocked: "Il documento è convalidato: il suo operatore non cambia più.",
  },
  q64: {
    forceLabel: "Forza la registrazione del chilometraggio inferiore",
    forceHint: "La scheda moto mantiene la lettura più alta ({last} km).",
    save: "Registra {km} km",
    errLower: "Chilometraggio inferiore: {km} km inseriti, ultima lettura {last} km. Correggi i km o spunta « Forza la registrazione del chilometraggio inferiore ».",
    errLowerShort: "Chilometraggio inferiore all'ultima lettura ({last} km). Correggi i km o spunta « Forza la registrazione del chilometraggio inferiore ».",
    vehicleUpdated: "La scheda moto passa a {km} km (lettura dell'OR).",
  },
  q67: {
    errRequired: "Scheda cliente: completare {fields}.",
    civility: "Titolo",
    lastName: "Cognome",
    firstName: "Nome",
    companyName: "Ragione sociale",
    completeTitle: "Scheda da completare",
    completeBody: "Come in G8, la scheda di un privato deve avere titolo, cognome e nome (una società: la ragione sociale). Completa: {fields}.",
    upperHint: "Registrato in MAIUSCOLO.",
  },
};
