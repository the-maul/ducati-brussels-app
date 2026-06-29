/**
 * M1 — Balises « modèles d'intérêt » Ducati.
 * Affichage réutilisable (fiche client, en-tête, liste). Si `onRemove` est fourni,
 * chaque balise porte une croix de suppression. `max` tronque l'affichage (liste).
 */
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/i18n';

export function ModelInterestBadges({ models, onRemove, max }: {
  models: string[];
  onRemove?: (model: string) => void;
  max?: number;
}) {
  if (!models || models.length === 0) return null;
  const shown = max ? models.slice(0, max) : models;
  const extra = max && models.length > max ? models.length - max : 0;

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((m) => (
        <Badge key={m} variant="secondary" className="gap-1 font-normal">
          {m}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(m); }}
              className="-mr-0.5 ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              aria-label={`${t('contacts.removeModel')} ${m}`}
              title={t('contacts.removeModel')}
            >
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {extra > 0 && <Badge variant="outline" className="font-normal">+{extra}</Badge>}
    </div>
  );
}
