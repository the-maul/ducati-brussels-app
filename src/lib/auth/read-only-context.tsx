/**
 * M0 — « Cette page est en lecture seule » mis à disposition de toute la page.
 *
 * Posé une seule fois par la garde d'accès (components/layout/access-guard),
 * il évite que chaque écran ait à relire les rôles. Le bouton partagé
 * (components/ui/button) s'y branche pour neutraliser les actions d'écriture :
 * un bouton principal ou destructeur, ou un bouton d'envoi de formulaire, est
 * désactivé quand la page est en consultation.
 *
 * Hors application du personnel (portail client, écrans publics), la valeur
 * par défaut est « on peut écrire » : rien ne change.
 */
import { createContext, useContext, type ReactNode } from 'react';

const Ctx = createContext(false);

export function ReadOnlyProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** La page affichée est-elle en lecture seule ? */
export function useReadOnly(): boolean {
  return useContext(Ctx);
}
