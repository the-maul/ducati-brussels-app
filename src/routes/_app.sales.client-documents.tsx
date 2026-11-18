import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, pageTitle } from '@/lib/i18n';
import { listCompanyMembers } from '@/modules/crm/api';
import { contactDisplayName, type Contact } from '@/modules/contacts/api';
import { ContactPicker } from '@/modules/sales/document-editor';
import { DocumentListPanel } from '@/modules/sales/document-list-panel';
import { AvailabilityBadge } from '@/modules/sales/availability-badge';
import { listPaymentMethods } from '@/modules/sales/write-api';
import { DirectDepositDialog } from '@/modules/sales/direct-deposit-dialog';
import {
  listReservationAvailability, listRepairAvailability, listRepairOrdersFor, listPaymentsOfKind, listCessionsFor,
  type ClientDocFilters, type AvailabilityRow,
} from '@/modules/sales/client-documents-api';
import { CLIENT_DOC_TABS, TAB_DOC_TYPES, matchesAvailability, sumOf, type ClientDocTab, type AvailabilityFilter, type PaymentKind } from '@/modules/sales/client-documents';
import type { DocListFilters } from '@/modules/sales/document-list';

/**
 * Ventes → Documents clients (G8 Facturation › Documents clients) : une période, un client et un
 * opérateur communs à onze onglets (factures, réservations, disponibilité, réparations, livraisons,
 * proformas, acomptes, régularisations, compensations, cessions), chacun avec ses totaux.
 */
export const Route = createFileRoute('/_app/sales/client-documents')({
  head: () => ({ meta: [{ title: pageTitle('salesClientDocuments') }] }),
  component: ClientDocumentsPage,
});

const eur = (n: number | null | undefined) => (n == null ? '—' : `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`);
const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-BE');
const ALL = '__all';
const docTone = (s: string) => (s === 'payee' || s === 'facture' ? 'success' : s === 'annulee' || s === 'annule' || s === 'converti' || s === 'avoir_emis' ? 'neutral' : 'warning');
/** Statut = couleur + icône + libellé (charte) : OR ou document de vente. */
const statusBadge = (isOr: boolean, s: string) => <StatusBadge tone={docTone(s)} label={isOr ? t(`workshop.status_${s}`) : t(`sales.status_${s}`)} />;
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

function ClientDocumentsPage() {
  const { activeCompanyId } = useAuth();
  const canWrite = useCanWrite();
  const [tab, setTab] = useState<ClientDocTab>('invoices');
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState('');
  const [contact, setContact] = useState<Contact | null>(null);
  const [operatorId, setOperatorId] = useState<string>(ALL);
  const [depositOpen, setDepositOpen] = useState(false);
  const membersQ = useQuery({ queryKey: ['company-members', activeCompanyId], queryFn: () => listCompanyMembers(activeCompanyId!), enabled: !!activeCompanyId, staleTime: 300_000 });
  const operator = (membersQ.data ?? []).find((m) => m.user_id === operatorId) ?? null;
  const filters: ClientDocFilters = { dateFrom, dateTo, contactId: contact?.id ?? null, operatorUserId: operator?.user_id ?? null, operatorName: operator?.name ?? null };
  const fixed: Partial<DocListFilters> = useMemo(() => ({ fiscal: 'all', dateFrom, dateTo, contactId: contact?.id ?? null, operatorUserId: operator?.user_id ?? null }), [dateFrom, dateTo, contact, operator]);

  if (!activeCompanyId) return null;
  return (
    <>
      <PageHeader
        title={t('clientDocs.title')}
        description={t('clientDocs.subtitle')}
        breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: t('clientDocs.title') }]}
        actions={canWrite ? <Button variant="outline" onClick={() => setDepositOpen(true)}><Plus /> {t('directDeposit.new')}</Button> : undefined}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('sales.filterDateFrom')}><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
        <Field label={t('sales.filterDateTo')}><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
        <Field label={t('sales.client')}>
          {contact ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <span className="truncate">{contactDisplayName(contact)}</span>
              <button type="button" onClick={() => setContact(null)} className="ml-auto text-muted-foreground hover:text-danger" aria-label={t('sales.filterReset')}><X className="size-4" /></button>
            </div>
          ) : <ContactPicker companyId={activeCompanyId} onPick={setContact} />}
        </Field>
        <Field label={t('sales.operator')}>
          <Select value={operatorId} onValueChange={setOperatorId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('sales.filterAll')}</SelectItem>
              {(membersQ.data ?? []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ClientDocTab)}>
        <TabsList className="mb-3 h-auto flex-wrap justify-start">
          {CLIENT_DOC_TABS.map((k) => <TabsTrigger key={k} value={k}>{t(`clientDocs.tab_${k}`)}</TabsTrigger>)}
        </TabsList>
        {CLIENT_DOC_TABS.map((k) => (
          <TabsContent key={k} value={k}>
            {tab === k && (
              TAB_DOC_TYPES[k]
                ? <DocumentListPanel companyId={activeCompanyId} docTypes={TAB_DOC_TYPES[k]!} fixed={fixed} showFiscal={false} showTransfer={k === 'invoices'} />
                : k === 'reservationsAvailability' || k === 'repairsAvailability'
                  ? <AvailabilityTab companyId={activeCompanyId} filters={filters} repairs={k === 'repairsAvailability'} />
                  : k === 'repairs'
                    ? <RepairsTab companyId={activeCompanyId} filters={filters} />
                    : k === 'cessions'
                      ? <CessionsTab companyId={activeCompanyId} filters={filters} />
                      : <PaymentsTab companyId={activeCompanyId} filters={filters} kind={k === 'deposits' ? 'deposit' : k === 'regularisations' ? 'regularisation' : 'compensation'} />
            )}
          </TabsContent>
        ))}
      </Tabs>
      {depositOpen && <DirectDepositDialog companyId={activeCompanyId} initialContact={contact} onClose={() => setDepositOpen(false)} />}
    </>
  );
}

function AvailabilityTab({ companyId, filters, repairs }: { companyId: string; filters: ClientDocFilters; repairs: boolean }) {
  const navigate = useNavigate();
  const [avail, setAvail] = useState<AvailabilityFilter>('all');
  const q = useQuery({
    queryKey: ['client-docs-availability', companyId, filters, repairs],
    queryFn: () => (repairs ? listRepairAvailability(companyId, filters) : listReservationAvailability(companyId, filters)),
  });
  const rows = (q.data ?? []).filter((r) => matchesAvailability(avail, r.availability?.status));
  const open = (r: AvailabilityRow) => (r.kind === 'or'
    ? navigate({ to: '/workshop/$orId', params: { orId: r.id } })
    : navigate({ to: '/sales/$documentId', params: { documentId: r.id } }));
  return (
    <div className="space-y-3">
      <Select value={avail} onValueChange={(v) => setAvail(v as AvailabilityFilter)}>
        <SelectTrigger className="h-9 w-64"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(['all', 'full', 'partial', 'missing'] as AvailabilityFilter[]).map((a) => <SelectItem key={a} value={a}>{t(`clientDocs.avail_${a}`)}</SelectItem>)}
        </SelectContent>
      </Select>
      <SimpleTable
        loading={q.isLoading}
        head={[t('sales.colNumber'), t('sales.colType'), t('sales.colDate'), t('sales.client'), t('sales.colStatus'), t('availability.colDispo'), t('docList.ttc'), t('docList.colDeposit')]}
        right={[6, 7]}
        rows={rows.map((r) => ({
          key: r.id, onClick: () => open(r),
          cells: [
            r.number ?? '—', r.kind === 'or' ? t('clientDocs.orType') : t(`sales.type_${r.doc_type}`), fmtDate(r.date), r.contact_name ?? '—',
            statusBadge(r.kind === 'or', r.status),
            r.availability ? <AvailabilityBadge status={r.availability.status} pct={r.availability.pct} /> : '',
            eur(r.total_ttc), r.deposit ? eur(r.deposit) : '',
          ],
        }))}
        foot={[t('docList.totals').replace('{n}', String(rows.length)), '', '', '', '', '', eur(sumOf(rows, (r) => r.total_ttc)), eur(sumOf(rows, (r) => r.deposit))]}
      />
    </div>
  );
}

function RepairsTab({ companyId, filters }: { companyId: string; filters: ClientDocFilters }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['client-docs-repairs', companyId, filters], queryFn: () => listRepairOrdersFor(companyId, filters) });
  const rows = q.data ?? [];
  return (
    <SimpleTable
      loading={q.isLoading}
      head={[t('sales.colNumber'), t('sales.colDate'), t('sales.client'), t('sales.operator'), t('sales.colStatus'), t('docList.ht'), t('docList.ttc')]}
      right={[5, 6]}
      rows={rows.map((r) => ({
        key: r.id, onClick: () => navigate({ to: '/workshop/$orId', params: { orId: r.id } }),
        cells: [r.number ?? '—', fmtDate(r.date), r.contact_name ?? '—', r.operator ?? '', statusBadge(true, r.status), eur(r.total_ht), eur(r.total_ttc)],
      }))}
      foot={[t('docList.totals').replace('{n}', String(rows.length)), '', '', '', '', eur(sumOf(rows, (r) => r.total_ht)), eur(sumOf(rows, (r) => r.total_ttc))]}
    />
  );
}

function PaymentsTab({ companyId, filters, kind }: { companyId: string; filters: ClientDocFilters; kind: PaymentKind }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['client-docs-payments', companyId, filters, kind], queryFn: () => listPaymentsOfKind(companyId, filters, kind) });
  const methodsQ = useQuery({ queryKey: ['payment-methods', companyId], queryFn: () => listPaymentMethods(companyId), staleTime: 300_000 });
  const label = (code: string) => (code === 'AVO' ? t('clientDocs.methodAvo') : methodsQ.data?.find((m) => m.code === code)?.label ?? code);
  const rows = q.data ?? [];
  return (
    <SimpleTable
      loading={q.isLoading}
      head={[t('clientDocs.colPaidAt'), t('sales.colNumber'), t('sales.colType'), t('sales.client'), t('clientDocs.colMethod'), t('clientDocs.colNote'), t('clientDocs.colAmount')]}
      right={[6]}
      rows={rows.map((p) => ({
        key: p.id, onClick: () => navigate({ to: '/sales/$documentId', params: { documentId: p.document_id } }),
        cells: [fmtDate(p.paid_at), p.number ?? '—', t(`sales.type_${p.doc_type}`), p.contact_name ?? '—', label(p.method), p.note ?? '', eur(p.amount)],
      }))}
      foot={[t('docList.totals').replace('{n}', String(rows.length)), '', '', '', '', '', eur(sumOf(rows, (p) => p.amount))]}
    />
  );
}

function CessionsTab({ companyId, filters }: { companyId: string; filters: ClientDocFilters }) {
  const q = useQuery({ queryKey: ['client-docs-cessions', companyId, filters], queryFn: () => listCessionsFor(companyId, filters) });
  const rows = q.data ?? [];
  return (
    <SimpleTable
      loading={q.isLoading}
      head={[t('sales.colDate'), t('clientDocs.colReference'), t('clientDocs.colDesignation'), t('clientDocs.colCessionType'), t('clientDocs.colNote'), t('sales.colQty'), t('clientDocs.colValue')]}
      right={[5, 6]}
      rows={rows.map((c) => ({
        key: String(c.id),
        cells: [fmtDate(c.occurred_at), c.reference ?? '', c.designation ?? '', c.cession_type ?? '', c.note ?? '', String(c.qty), eur(c.value)],
      }))}
      foot={[t('docList.totals').replace('{n}', String(rows.length)), '', '', '', '', String(sumOf(rows, (c) => c.qty)), eur(sumOf(rows, (c) => c.value))]}
    />
  );
}

function SimpleTable({ head, rows, foot, right = [], loading }: {
  head: string[]; rows: { key: string; cells: ReactNode[]; onClick?: () => void }[]; foot?: ReactNode[]; right?: number[]; loading?: boolean;
}) {
  const align = (i: number) => (right.includes(i) ? 'text-right tabular-nums' : '');
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[13px]">
        <thead className="bg-muted">
          <tr>{head.map((h, i) => <th key={i} className={`whitespace-nowrap px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${right.includes(i) ? 'text-right' : ''}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={head.length} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
          {!loading && !rows.length && <tr><td colSpan={head.length} className="px-3 py-6 text-center text-muted-foreground">{t('clientDocs.empty')}</td></tr>}
          {rows.map((r) => (
            <tr key={r.key} onClick={r.onClick} className={`border-b border-border last:border-0 ${r.onClick ? 'cursor-pointer hover:bg-accent' : ''}`}>
              {r.cells.map((c, i) => <td key={i} className={`px-3 py-2 ${align(i)}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
        {foot && rows.length > 0 && (
          <tfoot className="bg-muted font-semibold">
            <tr>{foot.map((c, i) => <td key={i} className={`px-3 py-2 ${align(i)}`}>{c}</td>)}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
