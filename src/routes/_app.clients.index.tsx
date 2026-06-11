import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listContacts, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/clients/')({
  head: () => ({ meta: [{ title: 'Clients — Ducati Bruxelles' }] }),
  component: ClientsList,
});

function ClientsList() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['contacts', activeCompanyId, debounced, typeFilter],
    queryFn: () => listContacts(activeCompanyId!, debounced, typeFilter === 'all' ? undefined : typeFilter),
    enabled: !!activeCompanyId,
  });

  return (
    <>
      <PageHeader
        title={t('contacts.title')}
        description={t('contacts.subtitle')}
        actions={
          <Button onClick={() => navigate({ to: '/clients/new' })}>
            <UserPlus /> {t('contacts.new')}
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('contacts.search')}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('contacts.filterAll')}</SelectItem>
            <SelectItem value="particulier">{t('contacts.type_particulier')}</SelectItem>
            <SelectItem value="professionnel">{t('contacts.type_professionnel')}</SelectItem>
            <SelectItem value="fournisseur">{t('contacts.type_fournisseur')}</SelectItem>
            <SelectItem value="banque_leasing">{t('contacts.type_banque_leasing')}</SelectItem>
          </SelectContent>
        </Select>
        {data && <span className="text-sm text-muted-foreground">{data.length}</span>}
      </div>

      {error && (
        <div className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          <p>{t('contacts.errLoad')}</p>
          <p className="mt-1 font-mono text-[11px] opacity-80">{(error as Error).message}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('contacts.colName')}</Th>
              <Th>{t('contacts.colType')}</Th>
              <Th>{t('contacts.colCity')}</Th>
              <Th>{t('contacts.colContact')}</Th>
              <Th>{t('contacts.colFlags')}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                <Loader2 className="mx-auto size-5 animate-spin" />
              </td></tr>
            )}
            {data && data.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('contacts.empty')}</td></tr>
            )}
            {data?.map((c) => (
              <tr
                key={c.id}
                onClick={() => navigate({ to: '/clients/$contactId', params: { contactId: c.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent"
              >
                <td className="px-3 py-2 font-medium">{contactDisplayName(c)}</td>
                <td className="px-3 py-2">{t(`contacts.type_${c.type}`)}</td>
                <td className="px-3 py-2">{c.city ?? '—'}</td>
                <td className="px-3 py-2">{c.email ?? c.mobile ?? c.phone ?? '—'}</td>
                <td className="px-3 py-2"><Flags c={c} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Flags({ c }: { c: Contact }) {
  return (
    <div className="flex flex-wrap gap-1">
      {c.is_vip && <StatusBadge tone="warning" label={t('contacts.flagVip')} />}
      {c.is_detaxe && <StatusBadge tone="info" label={t('contacts.flagDetaxe')} />}
      {c.is_watch && <StatusBadge tone="danger" label={t('contacts.flagWatch')} />}
      {c.is_account && <StatusBadge tone="neutral" label={t('contacts.flagAccount')} />}
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
      {children}
    </th>
  );
}
