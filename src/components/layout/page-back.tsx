/**
 * PageBack — le bouton « Retour » present en tete de toutes les pages de
 * l'application (UX010, demande client du 03/11/2026 ; revu par UX011 le meme jour :
 * « Retour revient exactement ou on etait »).
 *
 * Rendu par l'AppShell au-dessus du contenu, donc avant le fil d'Ariane de
 * `PageHeader` : aucune page n'y echappe, meme celles qui n'ont pas d'en-tete.
 * Masque sur les entrees du menu de gauche (tableau de bord, listes de rubrique).
 *
 * Comportement (logique pure dans `src/lib/back-navigation.ts`) :
 * - page precedente connue et dans l'application → retour dans l'historique du navigateur
 *   (en sautant le formulaire de creation deja utilise et la meme page), donc la page d'avant
 *   avec son adresse complete : recherche, filtres, onglet, page (`list-search.ts`) ; le
 *   defilement est restaure par le routeur (`scrollRestoration`, zone `#app-main`) ;
 * - sinon (lien direct, page jamais vue dans cet onglet) → page parente ;
 * - formulaire modifie non enregistre → confirmation d'abord (`useLeaveGuard`) ; quitter
 *   par Retour = abandon explicite : le brouillon du formulaire est efface (`form-draft.ts`).
 *
 * Pas de raccourci Escape : la touche sert deja a fermer dialogues, menus et
 * listes deroulantes, et un retour de page par erreur ferait perdre une saisie.
 * Alt+Fleche gauche (natif) reste disponible (il garde le brouillon).
 */
import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';
import { t } from '@/lib/i18n';
import { decideBack, isRootPage, previousVisits, recordVisit } from '@/lib/back-navigation';
import { discardActiveDrafts } from '@/lib/form-draft';
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

/**
 * La meme action que le bouton Retour, pour les boutons « Retour » propres a un ecran :
 * confirmation si modifie, historique sinon page parente.
 */
export function useGoBack(): () => Promise<void> {
  const { pathname } = useLocation();
  const index = useHistoryIndex();
  const router = useRouter();
  const navigate = useNavigate();
  const confirm = useConfirm();
  return useCallback(async () => {
    if (hasUnsavedChanges()) {
      const ok = await confirm({
        title: t('confirm.leaveTitle'),
        message: t('confirm.leaveMessage'),
        confirmLabel: t('confirm.leave'),
        variant: 'delete',
      });
      if (!ok) return;
    }
    // Retour = on abandonne la saisie de cet ecran (les autres chemins de sortie la gardent).
    discardActiveDrafts();
    const decision = decideBack(pathname, previousVisits(index));
    if (decision.kind === 'history') {
      if (decision.steps <= 1) router.history.back();
      else router.history.go(-decision.steps);
    } else navigate({ href: decision.to });
  }, [pathname, index, router, navigate, confirm]);
}

export function PageBack() {
  const { pathname } = useLocation();
  const goBack = useGoBack();

  if (isRootPage(pathname)) return null;

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
