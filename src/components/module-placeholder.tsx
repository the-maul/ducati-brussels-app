/**
 * ModulePlaceholder — état vide pour un module pas encore construit (charte §5.8).
 * Permet d'avoir une navigation complète et crédible dès l'Epic 0.
 */
import { Construction, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';

export function ModulePlaceholder({
  title,
  description,
  icon: Icon = Construction,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="grid place-items-center rounded-md border border-dashed border-border bg-card py-20 text-center">
        <Icon className="size-12 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <p className="mt-4 text-sm text-muted-foreground">
          Module en cours de construction.
        </p>
      </div>
    </>
  );
}
