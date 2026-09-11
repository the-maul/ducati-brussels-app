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

/**
 * Extrait un message lisible d'une exception, quelle que soit sa forme.
 *
 * supabase-js ne leve PAS des instances d'Error : PostgrestError est un objet
 * simple { message, details, hint, code }. Un test `err instanceof Error` le
 * rate donc et l'utilisateur recoit « L'enregistrement a echoue » a la place du
 * vrai motif — par exemple une colonne absente du schema, qui dit exactement
 * quelle migration manque.
 */
export function errorMessage(err: unknown): string {
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [o.message, o.details, o.hint]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (parts.length) return parts.join(' — ');
  }
  return t('feedback.error');
}

export function createMutationCache() {
  return new MutationCache({
    // Signature react-query : (data, variables, onMutateResult, mutation, context).
    onSuccess: (_data, _variables, _onMutateResult, mutation) => {
      const { success } = readMeta(mutation.options.meta);
      if (success === false) return;
      toast.success(success ?? t('feedback.saved'));
    },
    onError: (err, _variables, _onMutateResult, mutation) => {
      const { error } = readMeta(mutation.options.meta);
      if (error === false) return;
      toast.error(error ?? errorMessage(err));
    },
  });
}
