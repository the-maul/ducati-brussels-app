/**
 * Retour visuel global des écritures — un toast sur CHAQUE mutation.
 *
 * Pourquoi ici et pas dans chaque écran : l'application compte une soixantaine
 * de `useMutation`. Les instrumenter un par un laisse forcément des trous, et
 * tout nouvel écran repart sans retour. Branché sur le `MutationCache` du
 * QueryClient, le retour est acquis partout, y compris pour le code à venir.
 *
 * Réglage par mutation via `meta` :
 *
 *   useMutation({
 *     mutationFn: saveThing,
 *     meta: { success: 'Fiche créée' },      // message sur mesure
 *   })
 *
 *   useMutation({
 *     mutationFn: lookupVat,
 *     meta: { success: false },              // lecture, pas une écriture : muet
 *   })
 *
 * `success: false` sert aussi quand l'écran affiche déjà son propre retour
 * (dialogue de résultat, panneau d'import…) : sinon l'utilisateur voit deux
 * notifications pour une seule action.
 */
import { MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';

import { t } from '@/lib/i18n';

export interface MutationFeedbackMeta {
  /** Message du toast de succès. `false` pour n'en afficher aucun. */
  success?: string | false;
  /** Message du toast d'erreur. `false` pour n'en afficher aucun. */
  error?: string | false;
}

/** Lit `meta` sans dépendre de l'augmentation de module de react-query. */
function readMeta(meta: unknown): MutationFeedbackMeta {
  return (meta ?? {}) as MutationFeedbackMeta;
}

export function createMutationCache() {
  return new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      const { success } = readMeta(mutation.options.meta);
      if (success === false) return;
      toast.success(success ?? t('feedback.saved'));
    },
    onError: (err, _variables, _context, mutation) => {
      const { error } = readMeta(mutation.options.meta);
      if (error === false) return;
      // Le message de l'exception est plus utile que « ça a échoué » : les
      // fonctions Postgres renvoient des messages métier (CONTACT_HAS_DEPENDENCIES…).
      const fallback = err instanceof Error && err.message ? err.message : t('feedback.error');
      toast.error(error ?? fallback);
    },
  });
}
