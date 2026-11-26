/**
 * Libellés du bloc « Pièces du kit » de la fiche moto (ATE014, 26/11/2026) — bloc `vehicleKit` des
 * quatre dictionnaires. Fichier à part pour ne pas entrer en conflit avec les autres lots. Le FR fait foi :
 * les trois autres langues ont exactement les mêmes clés (type `Shape`, test i18n-dictionnaires).
 */

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

export const vehicleKitFr = {
  title: 'Pièces du kit',
  hint: 'Lecture seule : les mêmes lignes que celles mises sur l\'OR créé depuis un RDV pour cet entretien.',
  service: 'Entretien',
  dueTag: '{label} — entretien dû',
  colRef: 'Référence', colDesignation: 'Désignation', colQty: 'Quantité', colStock: 'Disponible',
  noModel: 'Modèle Ducati à compléter : reliez la moto au catalogue Ducati pour voir son kit.',
  noKit: 'Pas de kit pour ce modèle pour cet entretien.',
  openKit: 'Ouvrir le kit', openKitN: 'Ouvrir le kit {n}',
  loadErr: 'Impossible de charger le kit de cette moto.',
};

export const vehicleKitNl: Shape<typeof vehicleKitFr> = {
  title: 'Onderdelen van de kit',
  hint: 'Alleen lezen: dezelfde regels als op de WO die vanuit een afspraak voor dit onderhoud wordt gemaakt.',
  service: 'Onderhoud',
  dueTag: '{label} — onderhoud vereist',
  colRef: 'Referentie', colDesignation: 'Omschrijving', colQty: 'Aantal', colStock: 'Beschikbaar',
  noModel: 'Ducati-model aan te vullen: koppel de moto aan de Ducati-catalogus om de kit te zien.',
  noKit: 'Geen kit voor dit model voor dit onderhoud.',
  openKit: 'Kit openen', openKitN: 'Kit {n} openen',
  loadErr: 'Kan de kit van deze moto niet laden.',
};

export const vehicleKitEn: Shape<typeof vehicleKitFr> = {
  title: 'Kit parts',
  hint: 'Read only: the same lines as those put on the RO created from an appointment for this service.',
  service: 'Service',
  dueTag: '{label} — service due',
  colRef: 'Reference', colDesignation: 'Description', colQty: 'Quantity', colStock: 'Available',
  noModel: 'Ducati model to complete: link the bike to the Ducati catalogue to see its kit.',
  noKit: 'No kit for this model for this service.',
  openKit: 'Open kit', openKitN: 'Open kit {n}',
  loadErr: 'Could not load this bike\'s kit.',
};

export const vehicleKitIt: Shape<typeof vehicleKitFr> = {
  title: 'Ricambi del kit',
  hint: 'Sola lettura: le stesse righe messe sull\'OR creato da un appuntamento per questo tagliando.',
  service: 'Tagliando',
  dueTag: '{label} — tagliando dovuto',
  colRef: 'Riferimento', colDesignation: 'Descrizione', colQty: 'Quantità', colStock: 'Disponibile',
  noModel: 'Modello Ducati da completare: collega la moto al catalogo Ducati per vederne il kit.',
  noKit: 'Nessun kit per questo modello per questo tagliando.',
  openKit: 'Apri il kit', openKitN: 'Apri il kit {n}',
  loadErr: 'Impossibile caricare il kit di questa moto.',
};
