/**
 * Bandeau « saisie en cours retrouvee » (UX011) : affiche quand un formulaire de creation
 * a restaure son brouillon (`useFormDraft`). « Recommencer a zero » = abandon explicite.
 * Statut = couleur + icone + libelle (charte).
 */
import { History, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export function FormDraftBanner({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
      <History className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{t('confirm.draftRestored')}</span>
      <Button type="button" variant="outline" size="sm" className="h-11 md:h-8" onClick={onDiscard}>
        <RotateCcw /> {t('confirm.draftDiscard')}
      </Button>
    </div>
  );
}
