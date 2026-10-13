/**
 * M0 — « Qualité des données » : les écrans de maintenance regroupés en un
 * seul endroit (demande de Simon du 23/09 : ils occupaient le même niveau que
 * les écrans de travail quotidien alors qu'on ne les ouvre que ponctuellement).
 *
 * Chaque chantier dit combien il reste à traiter et ouvre l'écran concerné.
 * Un chantier n'apparaît que si le rôle a le droit d'ouvrir cet écran.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, GitMerge, Globe, Bike, Smartphone, Loader2, ChevronRight, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { canSee } from '@/lib/auth/permissions';
import { getDataQualityCounts, type DataQualityCounts } from '@/modules/settings/data-quality-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/data-quality')({
  component: DataQualityPage,
});

type Topic = {
  key: keyof Omit<DataQualityCounts, 'total'>;
  to: string;
  icon: LucideIcon;
  /** Recherche obligatoire de la route visée (TanStack l'exige même vide). */
  search?: Record<string, undefined>;
};

const TOPICS: Topic[] = [
  { key: 'links', to: '/parts/links', icon: GitMerge },
  { key: 'shopify_unlinked', to: '/parts/shopify', icon: Globe },
  { key: 'declarations', to: '/vehicles/declarations', icon: Bike },
  { key: 'phone_gsm', to: '/clients/mobiles', icon: Smartphone },
];

function DataQualityPage() {
  const { activeCompanyId, rolesForActiveCompany } = useAuth();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ['data-quality', activeCompanyId],
    queryFn: () => getDataQualityCounts(activeCompanyId!),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });

  // Un chantier qui mène à une page interdite au rôle n'a pas à s'afficher.
  const topics = TOPICS.filter((x) => canSee(x.to, rolesForActiveCompany));
  const nothing = q.data && topics.every((x) => (q.data?.[x.key] ?? 0) === 0);

  return (
    <>
      <PageHeader title={t('dataQuality.title')} description={t('dataQuality.subtitle')} />

      {q.isLoading && (
        <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      )}
      {/* Le comptage peut echouer (migration pas encore appliquee) : on affiche
          quand meme les chantiers, sans les nombres, plutot qu'un ecran rouge. */}
      {q.error && (
        <p className="mb-3 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('dataQuality.noCounts')}</p>
      )}

      {nothing && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-success-bg px-3 py-2 text-[13px] text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden /> {t('dataQuality.allClear')}
        </div>
      )}

      {(q.data || q.error) && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {topics.map((x) => {
            const n = q.data?.[x.key] ?? 0;
            const Icon = x.icon;
            return (
              <li key={x.key}>
                <button
                  type="button"
                  onClick={() => navigate({ to: x.to })}
                  className="flex w-full items-start gap-3 rounded-md border border-border bg-card p-4 text-left hover:bg-accent"
                >
                  <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium">{t(`dataQuality.${x.key}`)}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{t(`dataQuality.${x.key}Hint`)}</p>
                    <p className="mt-1.5 font-data text-[13px] tabular-nums">
                      {q.error ? (
                        <span className="text-muted-foreground">—</span>
                      ) : n > 0 ? (
                        <span className="rounded-[var(--radius-badge)] bg-warning-bg px-1.5 py-0.5 font-bold text-warning">
                          {n} {t('dataQuality.toHandle')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t('dataQuality.none')}</span>
                      )}
                    </p>
                  </div>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <Button variant="outline" allowInReadOnly onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Loader2 className="animate-spin" /> : null} {t('dataQuality.refresh')}
        </Button>
      </div>
    </>
  );
}
