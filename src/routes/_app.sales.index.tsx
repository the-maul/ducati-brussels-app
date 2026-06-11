import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { listDocuments } from '@/modules/sales/write-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/sales/')({
  head: () => ({ meta: [{ title: 'Ventes & Facturation — Ducati Bruxelles' }] }),
  component: SalesList,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const statusTone = (s: string) => (s === 'payee' ? 'success' : s === 'annulee' ? 'neutral' : s === 'brouillon' ? 'info' : 'warning');

function SalesList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['documents', activeCompanyId],
    queryFn: () => listDocuments(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  return (
    <>
      <PageHeader
        title={t('nav.sales')}
        description="Factures, devis, tickets et bons de livraison."
        actions={<Button onClick={() => navigate({ to: '/sales/new' })}><Plus /> Nouveau document</Button>}
      />
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr><Th>N°</Th><Th>Type</Th><Th>Date</Th><Th>Statut</Th><Th className="text-right">TTC</Th><Th className="text-right">Réglé</Th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun document.</td></tr>}
            {data?.map((d) => (
              <tr key={d.id} onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: d.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-mono text-[12px]">{d.number ?? '—'}</td>
                <td className="px-3 py-2">{d.doc_type}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.issue_date}</td>
                <td className="px-3 py-2"><StatusBadge tone={statusTone(d.status)} label={d.status} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(d.total_ttc))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(d.paid_amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
