/**
 * useSaveMutation — `useMutation` + l'état du bouton d'enregistrement.
 *
 * Le TOAST n'est pas émis ici : il l'est par le `MutationCache` global
 * (`mutation-feedback.ts`), qui couvre déjà toutes les mutations de l'app. Ce
 * hook ajoute ce que le cache global ne peut pas faire : suivre l'état du
 * bouton (idle → saving → ✓) et retarder la navigation pour que la coche soit
 * vue avant que la page change.
 *
 * Écran qui reste en place :
 *   const m = useSaveMutation({
 *     mutationFn: (v: Payload) => updateContact(v),
 *     success: 'Fiche enregistrée',            // message passé au toast global
 *     onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
 *   });
 *   <SaveButton status={m.status} onClick={() => m.mutate(payload)} />
 *
 * Écran qui navigue après enregistrement : passer `onDone`, exécuté après
 * SETTLE_MS pour laisser voir la coche.
 *   onDone: (c) => navigate({ to: '/clients/$contactId', params: { contactId: c.id } }),
 *
 * `success: false` supprime le toast (lecture, ou écran affichant son propre
 * retour). Idem `error: false`.
 */
import { useMutation, type MutationFunction, type UseMutationOptions } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SaveStatus } from '@/components/ui/save-button';
import type { MutationFeedbackMeta } from '@/lib/mutation-feedback';

/** Délai avant `onDone` : laisse la coche visible avant de naviguer. */
export const SETTLE_MS = 800;
/** Durée d'affichage de la coche quand l'écran reste en place. */
export const SAVED_MS = 1600;

export interface UseSaveMutationOptions<TData, TVars>
  extends Omit<UseMutationOptions<TData, Error, TVars>, 'onSuccess' | 'onError'>,
    MutationFeedbackMeta {
  /** Redéclaré (et requis) pour que TypeScript infère TData ici, donc dans `onDone`. */
  mutationFn: MutationFunction<TData, TVars>;
  /** Effets immédiats : invalidation de cache, fermeture de dialogue… */
  onSuccess?: (data: TData, variables: TVars) => void;
  onError?: (err: Error, variables: TVars) => void;
  /** Exécuté APRÈS SETTLE_MS — réservé à la navigation, pour laisser voir la coche. */
  onDone?: (data: TData, variables: TVars) => void;
}

export function useSaveMutation<TData = unknown, TVars = void>({
  success,
  error,
  onSuccess,
  onError,
  onDone,
  ...options
}: UseSaveMutationOptions<TData, TVars>) {
  const [status, setStatus] = useState<SaveStatus>('idle');

  // Les timers survivraient au démontage (la navigation démonte l'écran) : on
  // les annule, sinon React avertit d'un setState sur composant démonté et
  // `onDone` pourrait naviguer depuis un écran déjà quitté.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const m = useMutation<TData, Error, TVars>({
    ...options,
    // Le toast est émis par le MutationCache global à partir de ce meta.
    meta: { success, error, ...options.meta },
    onMutate: (variables) => {
      clearTimers();
      setStatus('saving');
      return options.onMutate?.(variables);
    },
    onSuccess: (data, variables) => {
      setStatus('saved');
      onSuccess?.(data, variables);
      if (onDone) later(() => onDone(data, variables), SETTLE_MS);
      later(() => setStatus('idle'), SAVED_MS);
    },
    onError: (err, variables) => {
      setStatus('idle');
      onError?.(err, variables);
    },
  });

  return { ...m, status };
}
