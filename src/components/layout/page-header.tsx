/**
 * PageHeader — en-tête de page/module (charte §3.2).
 * Titre de module en Ext UPPERCASE ; actions optionnelles à droite.
 */
import * as React from 'react';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export type PageHeaderBreadcrumb = { label: string; to?: string };

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: PageHeaderBreadcrumb[];
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      {/* Revue UX (20/11) : le titre garde au moins 18rem. Quand les actions ne tiennent pas
          a cote, elles passent sous le titre (au lieu d'ecraser le titre en colonne d'une lettre,
          vu sur Achats, Stock, fiche client a 1024 et 1280 px). */}
      <div className="min-w-[min(100%,18rem)] flex-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumb className="mb-1.5">
            <BreadcrumbList>
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {crumb.to && i < breadcrumbs.length - 1 ? (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.to}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        )}
        <h1 className="font-display text-[22px] font-bold uppercase leading-tight text-foreground sm:text-[28px] sm:leading-[34px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {/* Pas de shrink-0 : avec 6 boutons (facture), le bloc d'actions prenait
          toute la largeur et le titre se retrouvait a 60px, une lettre par ligne.
          Les boutons passent maintenant a la ligne. */}
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}
