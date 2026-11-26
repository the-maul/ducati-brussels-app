/**
 * M1 — Personnes de contact d'une fiche (interlocuteurs ; pour une banque : nom, prénom, téléphone,
 * e-mail et dossier moto lié). CON002. Logique pure, testée dans tests/bank-persons.test.ts.
 */

export type PersonForm = { first_name: string; name: string; role: string; phone: string; email: string; vehicle_id: string | null };
export const EMPTY_PERSON: PersonForm = { first_name: '', name: '', role: '', phone: '', email: '', vehicle_id: null };

const nn = (s: string) => (s.trim() ? s.trim() : null);

/** Le nom est obligatoire (colonne `name` non nulle) ; le reste est facultatif. */
export function canSavePerson(f: PersonForm): boolean {
  return !!f.name.trim();
}

/** Ligne à enregistrer : champs vides → null ; `id` seulement en modification. */
export function personPayload(f: PersonForm, contactId: string, id?: string | null) {
  return {
    ...(id ? { id } : {}),
    contact_id: contactId,
    name: f.name.trim(),
    first_name: nn(f.first_name),
    role: nn(f.role),
    phone: nn(f.phone),
    email: nn(f.email),
    vehicle_id: f.vehicle_id,
  };
}

/** « Prénom Nom », comme on l'écrit sur une fiche. */
export function personName(p: { first_name?: string | null; name?: string | null }): string {
  return [p.first_name, p.name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
}
