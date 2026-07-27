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
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
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
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
