/**
 * Toaster — hôte des notifications `toast()` de sonner.
 *
 * Monté UNE fois dans `__root.tsx` : sans lui, tous les appels `toast()` de
 * l'application s'exécutent sans rien afficher.
 *
 * Couleurs par statut prises sur les tokens de la charte (règle 9 : couleur +
 * icône + libellé ; sonner fournit l'icône, le token fournit la couleur).
 */
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-success/40 [&_[data-icon]]:text-success",
          error: "group-[.toaster]:border-danger/40 [&_[data-icon]]:text-danger",
          warning: "group-[.toaster]:border-warning/40 [&_[data-icon]]:text-warning",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
