/**
 * M8 — Points d'entrée des vues éclatées (lot E du parcours mécanicien, 19/11/2026).
 *
 *  - `useOrExplodedViews` : pour l'éditeur de l'OR. Donne le bouton « Vues éclatées de la moto »
 *    (barre des lignes), le petit bouton « Voir sur la vue éclatée » d'une ligne pièce, et la
 *    fenêtre. L'ajout passe par `onAdd` : l'éditeur reçoit une ligne déjà chiffrée par LA fonction
 *    de prix des lignes d'OR (comme le kit et la recherche d'article) ; l'OR s'enregistre ensuite
 *    par son bouton habituel.
 *  - `PickingExplodedButton` : sur une ligne de la picking list (tablette), consultation seule.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import type { OrLinePricer } from '@/modules/workshop/or-line-pricing';
import { t } from '@/lib/i18n';
import { pickingModelYear } from './api';
import { ExplodedViewsDialog, type ExplodedTarget } from './exploded-views-dialog';
import type { CatalogOrLine } from './rules';

export function useOrExplodedViews(p: {
  companyId: string; modelYearId: string | null; orId: string | null; readOnly: boolean;
  pricer: OrLinePricer; effectiveHt: (ht: number, vat: number) => number;
  onAdd: (line: CatalogOrLine) => void;
}): { button: ReactNode; rowButton: (articleId: string | null | undefined) => ReactNode; dialog: ReactNode } {
  const [target, setTarget] = useState<ExplodedTarget | undefined>(undefined);
  const button = (
    <Button type="button" variant="outline" onClick={() => setTarget(null)} title={t('exploded.buttonHint')}>
      <Layers /> {t('exploded.button')}
    </Button>
  );
  const rowButton = (articleId: string | null | undefined) => (articleId ? (
    <Button type="button" size="sm" variant="ghost" onClick={() => setTarget({ articleId })} title={t('exploded.rowButton')} aria-label={t('exploded.rowButton')}>
      <Layers className="size-4" />
    </Button>
  ) : null);
  const dialog = target !== undefined ? (
    <ExplodedViewsDialog
      companyId={p.companyId} modelYearId={p.modelYearId} target={target} onClose={() => setTarget(undefined)}
      orId={p.orId} readOnly={p.readOnly} onAdd={p.onAdd} pricer={p.pricer} effectiveHt={p.effectiveHt}
    />
  ) : null;
  return { button, rowButton, dialog };
}

/** Ligne de la picking list : « Voir sur la vue éclatée » (moto de l'OR / du RDV / du document). */
export function PickingExplodedButton({ pickingId, reference, articleId = null }: { pickingId: string; reference: string | null | undefined; articleId?: string | null }) {
  const { activeCompanyId } = useAuth();
  const [open, setOpen] = useState(false);
  const my = useQuery({ queryKey: ['exploded', 'picking-my', pickingId], queryFn: () => pickingModelYear(pickingId), staleTime: 300_000 });
  if ((!reference && !articleId) || !activeCompanyId) return null;
  return (
    <>
      <Button type="button" variant="outline" className="h-12 px-4 text-base" onClick={() => setOpen(true)} disabled={my.isLoading}>
        <Layers className="size-5" /> {t('exploded.rowButton')}
      </Button>
      {open && (
        <ExplodedViewsDialog companyId={activeCompanyId} modelYearId={my.data ?? null} target={articleId ? { articleId } : { reference }} readOnly onClose={() => setOpen(false)} />
      )}
    </>
  );
}
