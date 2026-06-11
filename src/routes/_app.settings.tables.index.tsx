import { createFileRoute, Link } from '@tanstack/react-router';
import { Table2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { REFERENCE_TABLES, REFERENCE_GROUPS } from '@/modules/settings/reference-tables';

export const Route = createFileRoute('/_app/settings/tables/')({
  head: () => ({ meta: [{ title: 'Tables de données — Ducati Bruxelles' }] }),
  component: TablesIndex,
});

function TablesIndex() {
  return (
    <>
      <PageHeader title="Tables de données" description="Référentiels paramétrables (TVA, règlements, marques, cessions, civilités…)." />
      <div className="space-y-6">
        {REFERENCE_GROUPS.map((g) => {
          const tables = REFERENCE_TABLES.filter((t) => t.group === g.key);
          if (tables.length === 0) return null;
          return (
            <div key={g.key}>
              <h2 className="mb-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{g.label}</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {tables.map((tb) => (
                  <Link
                    key={tb.key}
                    to="/settings/tables/$tableKey"
                    params={{ tableKey: tb.key }}
                    className="flex items-center gap-3 rounded-md border border-border bg-card p-3 text-sm font-medium transition-colors hover:border-ring/40"
                  >
                    <Table2 className="size-5 shrink-0 text-primary" />
                    {tb.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
