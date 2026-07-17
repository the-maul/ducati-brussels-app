import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Types de champ où l'on ne force JAMAIS les majuscules (exigence client :
 * « tous les champs en majuscules SAUF les adresses e-mail »). On exclut aussi
 * les champs techniques où la casse est significative ou sans objet.
 */
const NO_UPPERCASE_TYPES = new Set([
  "email", "password", "url", "search", "tel", "number",
  "date", "time", "datetime-local", "month", "week",
  "color", "file", "range", "hidden", "checkbox", "radio",
]);

/**
 * Input — champ texte. Par défaut, la saisie est forcée en MAJUSCULES (données
 * cohérentes, héritage G8). Exceptions :
 *  - `type` e-mail / mot de passe / url / nombre / date… (voir NO_UPPERCASE_TYPES) ;
 *  - `inputMode` email / url / numeric / decimal / tel ;
 *  - opt-out explicite `data-case="preserve"` (URL portail, e-mail en champ texte…).
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onChange, inputMode, ...props }, ref) => {
    const preserve = (props as Record<string, unknown>)["data-case"] === "preserve";
    const forceUpper =
      !preserve &&
      !NO_UPPERCASE_TYPES.has(type ?? "text") &&
      inputMode !== "email" && inputMode !== "url" &&
      inputMode !== "numeric" && inputMode !== "decimal" && inputMode !== "tel";

    const handleChange = forceUpper && onChange
      ? (e: React.ChangeEvent<HTMLInputElement>) => {
          const v = e.target.value;
          const up = v.toUpperCase();
          if (up !== v) {
            const start = e.target.selectionStart;
            const end = e.target.selectionEnd;
            e.target.value = up; // longueur identique → curseur conservé
            try { e.target.setSelectionRange(start, end); } catch { /* champ sans sélection */ }
          }
          onChange(e);
        }
      : onChange;

    return (
      <input
        type={type}
        inputMode={inputMode}
        onChange={handleChange}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
