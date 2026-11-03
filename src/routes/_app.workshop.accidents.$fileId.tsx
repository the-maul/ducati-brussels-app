import { createFileRoute } from '@tanstack/react-router';
import { AccidentFileScreen } from '@/modules/workshop/accident/accident-file-screen';
import { pageTitle } from '@/lib/i18n';

/** Fiche d'un dossier accident (mission 09, carte 5, ACH005). */
export const Route = createFileRoute('/_app/workshop/accidents/$fileId')({
  head: () => ({ meta: [{ title: pageTitle('workshopAccident') }] }),
  component: AccidentFilePage,
});

function AccidentFilePage() {
  const { fileId } = Route.useParams();
  return <AccidentFileScreen fileId={fileId} />;
}
