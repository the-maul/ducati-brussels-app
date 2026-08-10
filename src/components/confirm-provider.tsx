/**
 * ConfirmProvider — dialogue de confirmation impératif réutilisable.
 *
 * Fournit un hook `useConfirm()` renvoyant une fonction async : on `await`
 * la réponse de l'utilisateur avant d'agir. Évite le `window.confirm()` natif
 * (non stylé, hors charte) et centralise le pattern « es-tu sûr ? ».
 *
 * Usage :
 *   const confirm = useConfirm();
 *   const ok = await confirm({ variant: 'delete' });   // titre/texte par défaut
 *   if (!ok) return;
 *   del.mutate(id);
 *
 * Options : title, message, confirmLabel, cancelLabel, variant ('delete' |
 * 'default'). En variant 'delete' le bouton d'action est en rouge (destructive)
 * et les libellés par défaut parlent de suppression.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type ConfirmOptions = {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'delete' | 'default';
};

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Hook : renvoie une fonction async qui ouvre le dialogue et résout un booléen. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm doit être utilisé dans <ConfirmProvider>');
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({});
  // Résolveur de la Promise en attente ; nettoyé après chaque réponse.
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options = {}) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  const isDelete = opts.variant === 'delete';
  const title = opts.title ?? t(isDelete ? 'confirm.deleteTitle' : 'confirm.genericTitle');
  const message = opts.message ?? t(isDelete ? 'confirm.deleteMessage' : 'confirm.genericMessage');
  const confirmLabel =
    opts.confirmLabel ?? t(isDelete ? 'confirm.delete' : 'confirm.confirm');
  const cancelLabel = opts.cancelLabel ?? t('confirm.cancel');

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => { if (!o) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction
              className={cn(isDelete && buttonVariants({ variant: 'destructive' }))}
              onClick={() => settle(true)}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
