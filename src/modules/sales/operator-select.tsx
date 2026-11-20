/**
 * M6 — Choix de l'opérateur (le vendeur qui fait la vente), comme G8 (décision Q63, 20/11/2026).
 * Liste : opérateurs actifs de la société (+ celui déjà posé s'il a été désactivé). Obligatoire dès
 * que la société a des opérateurs ; par défaut l'utilisateur connecté s'il est opérateur (posé par
 * l'appelant avec `defaultId` de useSalesOperators).
 */
import { UserRound } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { selectableOperators, type SalesOperator } from './operators';

export function OperatorSelect({ operators, value, onChange, invalid, disabled, fallbackName, className }: {
  operators: SalesOperator[];
  value: string | null;
  onChange: (id: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  /** Nom à afficher quand la société n'a pas encore d'opérateurs (utilisateur connecté). */
  fallbackName?: string;
  className?: string;
}) {
  const list = selectableOperators(operators, value);
  if (!list.length) {
    return (
      <div className={`flex h-9 items-center gap-2 rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground ${className ?? ''}`} title={t('q63.none')}>
        <UserRound className="size-4 shrink-0" /> <span className="truncate">{fallbackName || t('q63.none')}</span>
      </div>
    );
  }
  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={`${invalid ? 'border-danger' : ''} ${className ?? ''}`} aria-invalid={invalid} title={t('q63.hint')}>
        <UserRound className="mr-1 size-4 shrink-0 text-muted-foreground" />
        <SelectValue placeholder={t('q63.choose')} />
      </SelectTrigger>
      <SelectContent>
        {list.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}{!o.isActive ? ` (${t('q63.inactive')})` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
