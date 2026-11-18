import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { t, pageTitle } from '@/lib/i18n';
import { CessionsScreen, CESSIONS_TABS, type CessionsTab } from '@/modules/tradein/cessions/cessions-screen';
import { CessionDocument } from '@/modules/tradein/cessions/cession-document';

/**
 * Cessions internes / O.R.O (rattrapage G8, 18/11/2026) : liste des documents, listes par rayon et
 * detaillees, archives, reglages ; `?doc=<id>` ouvre le document (creation, lignes, validation par
 * la fenetre « prix de revient », impression). Accessible depuis Stock et Atelier.
 */
type CessionsSearch = { doc?: string; tab?: CessionsTab };

export const Route = createFileRoute('/_app/stock/cessions')({
  head: () => ({ meta: [{ title: pageTitle('stockCessions') }] }),
  validateSearch: (s: Record<string, unknown>): CessionsSearch => {
    const out: CessionsSearch = {};
    if (typeof s.doc === 'string' && s.doc) out.doc = s.doc;
    if (typeof s.tab === 'string' && (CESSIONS_TABS as string[]).includes(s.tab) && s.tab !== 'documents') out.tab = s.tab as CessionsTab;
    return out;
  },
  component: CessionsPage,
});

function CessionsPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const { doc, tab } = Route.useSearch();

  if (doc) {
    return (
      <>
        <PageHeader
          title={t('cession.docTitle')}
          description={t('cession.docSubtitle')}
          breadcrumbs={[{ label: t('cession.title'), to: '/stock/cessions' }, { label: t('cession.docTitle') }]}
          actions={<Button variant="outline" onClick={() => navigate({ to: '/stock/cessions', search: tab ? { tab } : {} })}><ArrowLeft /> {t('cession.backToList')}</Button>}
        />
        {activeCompanyId && <CessionDocument key={doc} cessionId={doc} companyId={activeCompanyId} />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('cession.title')}
        description={t('cession.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/stock' })}><ArrowLeft /> {t('stock.title')}</Button>}
      />
      {activeCompanyId && (
        <CessionsScreen
          companyId={activeCompanyId}
          tab={tab ?? 'documents'}
          onTab={(next) => navigate({ to: '/stock/cessions', search: next === 'documents' ? {} : { tab: next }, replace: true })}
          onOpen={(id) => navigate({ to: '/stock/cessions', search: tab ? { doc: id, tab } : { doc: id } })}
        />
      )}
    </>
  );
}
