import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { useReadOnly } from "@/lib/auth/read-only-context";
import { t } from "@/lib/i18n";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Garde le bouton actif sur une page en lecture seule (M0, droits par role).
   * A reserver aux actions qui n'ecrivent rien : rechercher, exporter, imprimer,
   * ouvrir un ecran. Par defaut, un bouton principal, destructeur ou d'envoi de
   * formulaire est desactive sur une page en consultation.
   */
  allowInReadOnly?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, allowInReadOnly = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    // M0 — page en lecture seule : on neutralise ce qui ecrit. `asChild` est
    // laisse tranquille (c'est un lien de navigation, pas une ecriture).
    const readOnly = useReadOnly();
    const writes = props.type === "submit" || variant === "default" || variant === undefined || variant === "destructive";
    const blocked = readOnly && !asChild && !allowInReadOnly && writes;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        disabled={props.disabled || blocked}
        title={blocked ? t("access.noWrite") : props.title}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
