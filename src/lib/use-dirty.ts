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
import { useRef } from 'react';

export function useIsDirty(current: unknown): boolean {
  const initial = useRef<string | null>(null);
  const now = JSON.stringify(current);
  if (initial.current === null) initial.current = now;
  return now !== initial.current;
}
