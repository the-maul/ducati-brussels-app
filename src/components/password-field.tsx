/**
 * Champ mot de passe partagé (décision U-4 du 18/09) :
 *   - bouton « Afficher / Masquer » (grande cible tactile) ;
 *   - la casse est TOUJOURS conservée, même affiché en clair (`data-case="preserve"`,
 *     sinon le champ texte forcerait les majuscules) ;
 *   - `autoComplete="new-password"` par défaut : le navigateur ne propose ni ne
 *     retient un ancien mot de passe (indispensable sur la borne partagée).
 * `PasswordRules` affiche, pendant la saisie, les règles de src/lib/password-policy.ts
 * déjà remplies.
 */
import { forwardRef, useState, type ComponentProps } from 'react';
import { Check, Circle, Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { checkPassword } from '@/lib/password-policy';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & { inputClassName?: string };

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, inputClassName, autoComplete, ...props }, ref) => {
    const [shown, setShown] = useState(false);
    return (
      <div className={cn('relative', className)}>
        <Input
          ref={ref}
          type={shown ? 'text' : 'password'}
          data-case="preserve"
          autoComplete={autoComplete ?? 'new-password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn('pr-12', inputClassName)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-label={shown ? t('pwd.hide') : t('pwd.show')}
          title={shown ? t('pwd.hide') : t('pwd.show')}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shown ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

/** Liste des règles, cochées au fur et à mesure de la saisie. */
export function PasswordRules({ value, className, large }: { value: string; className?: string; large?: boolean }) {
  const rules = checkPassword(value);
  return (
    <ul className={cn('grid gap-1 sm:grid-cols-2', large ? 'text-[14px]' : 'text-[12px]', className)} aria-live="polite">
      {rules.map((r) => (
        <li key={r.key} className={cn('flex items-center gap-1.5', r.ok ? 'text-success' : 'text-muted-foreground')}>
          {r.ok
            ? <Check className="size-3.5 shrink-0" aria-hidden />
            : <Circle className="size-3 shrink-0" aria-hidden />}
          <span>
            {t(`pwd.rules.${r.key}`)}
            <span className="sr-only"> — {r.ok ? t('pwd.ruleOk') : t('pwd.ruleMissing')}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
