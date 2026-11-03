/**
 * useIsDirty — le formulaire a-t-il été modifié depuis son ouverture ?
 *
 * Sert à griser le bouton d'enregistrement tant que rien n'a bougé : un bouton
 * toujours actif laisse croire qu'il y a quelque chose à sauver, et un clic inutile
 * déclenche une écriture, donc une ligne d'audit, pour rien.
 *
 * On compare une empreinte de l'état courant à celle prise au premier rendu. Les
 * formulaires du projet construisent leur état par `{ ...p, [k]: v }`, donc l'ordre
 * des clés est stable d'un rendu à l'autre et `JSON.stringify` suffit.
 *
 * La référence n'est jamais réinitialisée : les écrans concernés quittent la page
 * après enregistrement. Un écran qui resterait en place devrait se remonter (prop
 * `key`), comme le fait déjà la fiche contact.
 */
import { useEffect, useRef } from 'react';

export function useIsDirty(current: unknown): boolean {
  const initial = useRef<string | null>(null);
  const now = JSON.stringify(current);
  if (initial.current === null) initial.current = now;
  return now !== initial.current;
}

// --- Garde de sortie (bouton Retour, UX010, 03/11/2026) ------------------------------
// Un formulaire modifie et non enregistre se declare ici ; le bouton Retour de
// l'en-tete demande confirmation avant de quitter la page. Compteur en memoire :
// plusieurs formulaires peuvent etre ouverts sur un meme ecran (onglets).

let unsavedForms = 0;

/** A appeler avec le `dirty` de `useIsDirty` : la page est « non enregistree » tant qu'il est vrai. */
export function useLeaveGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    unsavedForms += 1;
    return () => {
      unsavedForms -= 1;
    };
  }, [dirty]);
}

/** Y a-t-il, sur l'ecran courant, un formulaire modifie et non enregistre ? */
export function hasUnsavedChanges(): boolean {
  return unsavedForms > 0;
}
