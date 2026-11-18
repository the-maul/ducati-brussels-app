import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { listSearchFromRaw } from '@/lib/list-search';
import { useListSearch } from '@/lib/use-list-search';
import { Plus, Timer, CalendarDays, BookOpen, LifeBuoy, Wrench, ShieldCheck, Car, PackageCheck, BarChart3, FileQuestion, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { WarrantyOrsTable, WarrantyReturnsPanel, WarrantyListsPanel } from '@/modules/workshop/warranty/warranty-views';
import { AccidentOrsTable } from '@/modules/workshop/accident/accident-ors-table';
import { OrListScreen, OR_LIST_DEFAULTS, OR_LIST_CHOICES, WORKSHOP_VIEWS, type WorkshopView } from '@/modules/workshop/or-base/or-list-screen';
import { t, pageTitle } from '@/lib/i18n';
import { useCanWrite } from '@/lib/auth/use-access';

export const Route = createFileRoute('/_app/workshop/')({
  head: () => ({ meta: [{ title: pageTitle('workshop') }] }),
  validateSearch: (s: Record<string, unknown>) => listSearchFromRaw(s, OR_LIST_DEFAULTS, OR_LIST_CHOICES),
  component: WorkshopList,
});

/**
 * Vues de la liste (G8 : Rappel d'un O.R. › Ordres de reparation / Devis de reparation / O.R. garantie /
 * O.R. accident), plus le suivi des retours constructeur (G8 : Appros › Historique garantie) et les
 * listes « Garanties » / « Garanties / CA » (G8 : Liste des cessions) — rattrapage G8 du 18/11/2026.
 * OR et devis de reparation : `or-base/or-list-screen.tsx` (recherche n° / immat / client / chassis,
 * filtres, pagination, export Excel) ; garantie et accident : tables du lot garantie / accident.
 */
const VIEW_ICON: Record<WorkshopView, LucideIcon> = { or: Wrench, devis: FileQuestion, garantie: ShieldCheck, accident: Car, retours: PackageCheck, stats: BarChart3 };
const viewLabel = (v: WorkshopView) => (v === 'devis' ? t('orBase.views.devis') : t(`warranty.view_${v}`));

function WorkshopList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  // Lecture seule : on ne propose pas une action qui serait refusée ensuite.
  const canWrite = useCanWrite();
  // Vue et filtres dans l'adresse (UX011) : Retour depuis un OR retrouve la meme liste.
  const [ls, setLs] = useListSearch(OR_LIST_DEFAULTS, OR_LIST_CHOICES);
  const view = ((WORKSHOP_VIEWS as readonly string[]).includes(ls.view) ? ls.view : 'or') as WorkshopView;

  return (
    <>
      <PageHeader
        title={t('workshop.title')}
        description={t('workshop.subtitle')}
        actions={
          <div className="flex gap-2">
            {/* search explicite : ces routes declarent un parametre facultatif,
                mais TanStack exige quand meme l'objet. */}
            <Button variant="outline" onClick={() => navigate({ to: '/workshop/planning', search: { week: undefined } })}><CalendarDays /> {t('workshop.planning')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/workshop/chrono' })}><Timer /> {t('workshop.chrono')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/workshop/maintenance-plans' })}><BookOpen /> {t('workshop.maintenancePlans')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/workshop/accidents' })}><LifeBuoy /> {t('accidentFile.title')}</Button>
            <Button variant="outline" onClick={() => navigate({ to: '/stock/cessions' })}><Wrench /> {t('cession.title')}</Button>
            {canWrite && (
              <Button onClick={() => navigate({ to: '/workshop/new', search: { contactId: undefined, vehicleId: undefined } })}><Plus /> {t('workshop.newOr')}</Button>
            )}
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
        {WORKSHOP_VIEWS.map((v) => {
          const Icon = VIEW_ICON[v];
          return (
            <button
              key={v} type="button" onClick={() => setLs({ view: v, page: 1 })}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-bold ${view === v ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="size-4" aria-hidden /> {viewLabel(v)}
            </button>
          );
        })}
      </div>
      {view === 'garantie' && activeCompanyId && <WarrantyOrsTable companyId={activeCompanyId} />}
      {view === 'accident' && activeCompanyId && <AccidentOrsTable companyId={activeCompanyId} />}
      {view === 'retours' && activeCompanyId && <WarrantyReturnsPanel companyId={activeCompanyId} />}
      {view === 'stats' && activeCompanyId && <WarrantyListsPanel companyId={activeCompanyId} />}
      {(view === 'or' || view === 'devis') && activeCompanyId && <OrListScreen companyId={activeCompanyId} view={view} />}
    </>
  );
}
