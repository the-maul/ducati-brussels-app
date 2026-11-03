/**
 * PageBack — le bouton « Retour » present en tete de toutes les pages de
 * l'application (UX010, demande client du 03/11/2026).
 *
 * Rendu par l'AppShell au-dessus du contenu, donc avant le fil d'Ariane de
 * `PageHeader` : aucune page n'y echappe, meme celles qui n'ont pas d'en-tete.
 * Masque sur les entrees du menu de gauche (tableau de bord, listes de rubrique).
 *
 * Comportement (logique pure dans `src/lib/back-navigation.ts`) :
 * - page precedente connue et dans l'application → un pas en arriere dans l'historique ;
 * - sinon (lien direct, rechargement, creation qui a ouvert la fiche) → page parente ;
 * - formulaire modifie non enregistre → confirmation d'abord (`useLeaveGuard`).
 *
 * Pas de raccourci Escape : la touche sert deja a fermer dialogues, menus et
 * listes deroulantes, et un retour de page par erreur ferait perdre une saisie.
 * Alt+Fleche gauche (natif) reste disponible.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';
import { t } from '@/lib/i18n';
import { decideBack, isRootPage, previousVisit, recordVisit } from '@/lib/back-navigation';
import { hasUnsavedChanges } from '@/lib/use-dirty';

type HistoryState = { __TSR_index?: number } | undefined;

function useHistoryIndex(): number | null {
  const location = useLocation();
  const index = (location.state as HistoryState)?.__TSR_index;
  return typeof index === 'number' ? index : null;
}

/**
 * Note chaque page visitee (index d'historique → chemin). Monte dans la route
 * racine, pour voir passer aussi les pages publiques (login, espace client) :
 * un retour vers elles n'a pas de sens, `decideBack` choisit alors le parent.
 */
export function BackHistoryTracker() {
  const { pathname } = useLocation();
  const index = useHistoryIndex();
  useEffect(() => {
    recordVisit(index, pathname);
  }, [index, pathname]);
  return null;
}

export function PageBack() {
  const { pathname } = useLocation();
  const index = useHistoryIndex();
  const router = useRouter();
  const navigate = useNavigate();
  const confirm = useConfirm();

  if (isRootPage(pathname)) return null;

  const goBack = async () => {
    if (hasUnsavedChanges()) {
      const ok = await confirm({
        title: t('confirm.leaveTitle'),
        message: t('confirm.leaveMessage'),
        confirmLabel: t('confirm.leave'),
        variant: 'delete',
      });
      if (!ok) return;
    }
    const decision = decideBack(pathname, previousVisit(index));
    if (decision.kind === 'history') router.history.back();
    else navigate({ href: decision.to });
  };

  return (
    <div className="-ml-2 mb-2 md:mb-3">
      {/* 44 px sur tablette / smartphone (charte §5.1, ecrans tactiles), 32 px sur poste fixe. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={goBack}
        className="h-11 px-3 text-muted-foreground md:h-8"
      >
        <ArrowLeft />
        {t('action.back')}
      </Button>
    </div>
  );
}
