/**
 * M8 — Ecran tablette « Mon atelier » (lot F du parcours mecanicien, 19/11/2026).
 * La route ne fait que cabler le module : src/modules/workshop/my-workshop/.
 * Memes droits que l'atelier (grille des droits, alias /workshop).
 * `?mechanic=` : atelier regarde (id d'une fiche compagnon ou `all`), choisi par un administrateur
 * ou un chef d'atelier ; absent = le mien. Ignore pour un mecanicien simple.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth/auth-context';
import { MyWorkshopScreen } from '@/modules/workshop/my-workshop/my-workshop-screen';
import { parseWorkshopView, workshopViewParam } from '@/modules/workshop/my-workshop/rules';
import { pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/workshop/my-workshop')({
  validateSearch: (s: Record<string, unknown>): { mechanic?: string } => ({
    mechanic: workshopViewParam(parseWorkshopView(s.mechanic)),
  }),
  head: () => ({ meta: [{ title: pageTitle('workshopMine') }] }),
  component: MyWorkshopRoute,
});

function MyWorkshopRoute() {
  const { activeCompanyId } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <>
      {/* Lot UX atelier (20/11) : l'en-tete tient sur une ligne, dans l'ecran (titre, date, atelier de, relire). */}
      {activeCompanyId && (
        <MyWorkshopScreen
          companyId={activeCompanyId}
          view={parseWorkshopView(search.mechanic)}
          onView={(v) => navigate({ search: { mechanic: workshopViewParam(v) }, replace: true })}
        />
      )}
    </>
  );
}
