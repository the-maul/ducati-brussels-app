import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listCompanyMembers } from '@/modules/crm/api';
import { listOpenBalances, sortOpenBalances, totalOpenBalances, type BalanceSort } from '@/modules/sales/deposit-alerts';
import { RestStatusBadge, eur } from '@/modules/sales/balance-panel';
import { t } from '@/lib/i18n';

/**
 * Soldes à encaisser (mission 05, carte 10) : « ne pas laisser traîner des factures à payer ou des
 * soldes ». Documents ouverts (facture, ticket, bon de commande, réservation, BL) dont le reste à
 * payer par le client est > 0, financement accepté déduit (même calcul que la fiche du document,
 * fonction SQL sales_open_balances). Tri par échéance (échus d'abord), ancienneté ou montant ;
 * filtre par vendeur (opérateur du document).
 */
export const Route = createFileRoute('/_app/sales/balances')({
  head: () => ({ meta: [{ title: 'Soldes à encaisser — Ducati Bruxelles' }] }),
  component: OpenBalancesPage,
});

const ALL = '__all';
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('fr-BE') : '—');

function OpenBalancesPage() {
  const { activeCompanyId } = useAuth();
  const [operator, setOperator] = useState<string>(ALL);
  const [sort, setSort] = useState<BalanceSort>('due');
  const membersQ = useQuery({
    queryKey: ['company-members', activeCompanyId],
    queryFn: () => listCompanyMembers(activeCompanyId!),
    enabled: !!activeCompanyId,
    staleTime: 300_000,
  });
  const q = useQuery({
    queryKey: ['open-balances', activeCompanyId, operator],
    queryFn: () => listOpenBalances(activeCompanyId!, operator === ALL ? null : operator),
    enabled: !!activeCompanyId,
  });
  const rows = sortOpenBalances(q.data ?? [], sort);
  const tot = totalOpenBalances(rows);

  return (
    <>
      <PageHeader
        title={t('openBalances.title')}
        description={t('openBalances.subtitle')}
        breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: t('openBalances.title') }]}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('openBalances.filterSeller')}</span>
          <Select value={operator} onValueChange={setOperator}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('openBalances.allSellers')}</SelectItem>
              {(membersQ.data ?? []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('openBalances.sortBy')}</span>
          <Select value={sort} onValueChange={(v) => setSort(v as BalanceSort)}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="due">{t('openBalances.sortDue')}</SelectItem>
              <SelectItem value="age">{t('openBalances.sortAge')}</SelectItem>
              <SelectItem value="amount">{t('openBalances.sortAmount')}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <div className="ml-auto flex flex-wrap gap-6 rounded-md border border-border bg-card px-4 py-2 text-[13px]">
          <span className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('openBalances.totalDue')}</span>
            <b className="font-data text-xl tabular-nums">{eur(tot.clientDue)}</b>
          </span>
          <span className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('openBalances.overdueDue')}</span>
            <b className={`font-data text-xl tabular-nums ${tot.overdueDue > 0.005 ? 'text-danger' : ''}`}>{eur(tot.overdueDue)}</b>
          </span>
          <span className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('openBalances.docs')}</span>
            <b className="font-data text-xl tabular-nums">{tot.count}{tot.overdueCount > 0 ? ` (${t('openBalances.overdueCount').replace('{n}', String(tot.overdueCount))})` : ''}</b>
          </span>
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-border bg-card px-3 py-6 text-center text-[13px] text-muted-foreground">{t('openBalances.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('openBalances.colDoc')}</Th>
                <Th>{t('openBalances.colClient')}</Th>
                <Th>{t('openBalances.colSeller')}</Th>
                <Th>{t('openBalances.colDate')}</Th>
                <Th>{t('openBalances.colDue')}</Th>
                <Th>{t('openBalances.colState')}</Th>
                <Th className="text-right">{t('balance.ttc')}</Th>
                <Th className="text-right">{t('balance.paidClient')}</Th>
                <Th className="text-right">{t('balance.toReceiveFromOrg')}</Th>
                <Th className="text-right">{t('balance.restToPayClient')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Link to="/sales/$documentId" params={{ documentId: r.id }} className="font-medium text-info underline">
                      {t(`sales.type_${r.docType}`)} {r.number ?? t('sales.draftSuffix')}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.contactId ? (
                      <Link to="/clients/$contactId" params={{ contactId: r.contactId }} className="text-info underline">{r.contactName ?? '—'}</Link>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">{r.operatorName ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {fmtDate(r.issueDate)}
                    <span className="ml-1 text-[11px] text-muted-foreground">{t('openBalances.ageDays').replace('{n}', String(r.ageDays))}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {fmtDate(r.dueDate)}
                    {r.overdue && <span className="ml-1 text-[11px] text-danger">{t('openBalances.daysOverdue').replace('{n}', String(r.daysOverdue))}</span>}
                  </td>
                  <td className="px-3 py-2"><RestStatusBadge due={r.clientDue} overdue={r.overdue} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.ttc)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.paid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.toReceiveFromOrg > 0.005 ? eur(r.toReceiveFromOrg) : '—'}</td>
                  <td className={`px-3 py-2 text-right font-bold tabular-nums ${r.overdue ? 'text-danger' : ''}`}>{eur(r.clientDue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted-foreground">{t('openBalances.rule')}</p>
    </>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
