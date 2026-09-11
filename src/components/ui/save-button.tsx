/**
 * SaveButton — bouton d'enregistrement à trois états. Applique la règle 9
 * « tout statut = couleur + icône + libellé » au retour d'une écriture :
 * l'utilisateur doit toujours savoir si son action a été prise en compte.
 *
 *   idle    → icône disquette + libellé ("Enregistrer" / "Créer")
 *   saving  → spinner + "Enregistrement…", bouton désactivé
 *   saved   → coche verte + "Enregistré" pendant ~1,6 s, puis retour à idle
 *
 * L'état est piloté par `useSaveMutation`, qui gère aussi le toast et la
 * temporisation du retour à idle. Usage courant :
 *
 *   const m = useSaveMutation({ mutationFn: save, success: t('feedback.saved') });
 *   <SaveButton type="submit" status={m.status} />
 *
 * Sur un écran qui navigue après enregistrement, `useSaveMutation` retarde la
 * navigation de ~800 ms pour que la coche soit réellement visible.
 */
import { Check, Loader2, Save } from 'lucide-react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type SaveStatus = 'idle' | 'saving' | 'saved';

export interface SaveButtonProps extends Omit<ButtonProps, 'children'> {
  status: SaveStatus;
  /** Libellé au repos. Défaut : « Enregistrer ». */
  children?: React.ReactNode;
  /** Remplace « Enregistrement… » (ex. « Vérification des doublons… »). */
  savingLabel?: React.ReactNode;
  /** Masque l'icône disquette au repos (boutons compacts en barre d'outils). */
  hideIdleIcon?: boolean;
}

const SaveButton = ({
  status,
  children,
  savingLabel,
  hideIdleIcon = false,
  className,
  disabled,
  ...props
}: SaveButtonProps) => (
  <Button
    {...props}
    // `saved` reste cliquable : rien n'empêche un second enregistrement.
    disabled={disabled || status === 'saving'}
    aria-busy={status === 'saving'}
    className={cn(
      status === 'saved' &&
        'bg-success text-white shadow-sm hover:bg-success/90 focus-visible:ring-success',
      className,
    )}
  >
    {status === 'saving' ? (
      <Loader2 className="animate-spin" />
    ) : status === 'saved' ? (
      <Check />
    ) : hideIdleIcon ? null : (
      <Save />
    )}
    {status === 'saving'
      ? (savingLabel ?? t('action.saving'))
      : status === 'saved'
        ? t('action.saved')
        : (children ?? t('action.save'))}
  </Button>
);

export { SaveButton };
