import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, UserPlus, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listContactsPaged, contactDisplayName, getModelInterests, type Contact } from '@/modules/contacts/api';
import { ModelInterestBadges } from '@/modules/contacts/model-interest-badges';
import { t } from '@/lib/i18n';

type ColKey = 'type' | 'city' | 'contact' | 'mobile' | 'email' | 'flags' | 'models';
const ALL_COLS: { key: ColKey; label: () => string }[] = [
  { key: 'type',    label: () => t('contacts.colType') },
  { key: 'city',    label: () => t('contacts.colCity') },
  { key: 'contact', label: () => t('contacts.colContact') },
  { key: 'mobile',  label: () => t('contacts.colMobile') },
  { key: 'email',   label: () => t('contacts.colEmail') },
  { key: 'flags',   label: () => t('contacts.colFlags') },
  { key: 'models',  label: () => t('contacts.colModels') },
];

const PAGE_SIZES = [25, 50, 100, 200];

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
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(new Set(['type', 'city', 'contact', 'flags']));

  function toggleCol(key: ColKey) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  const colCount = 1 + visibleCols.size;

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);
  // Revenir à la 1re page quand le filtre/recherche/taille change
  useEffect(() => { setPage(0); }, [debounced, typeFilter, pageSize]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['contacts', activeCompanyId, debounced, typeFilter, page, pageSize],
    queryFn: () => listContactsPaged(activeCompanyId!, { search: debounced, type: typeFilter === 'all' ? undefined : typeFilter, page, pageSize }),
    enabled: !!activeCompanyId,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <>
      <PageHeader
        title={t('contacts.title')}
        description={t('contacts.subtitle')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/client-pricing' })}>{t('pricing.title')}</Button>
            <Button onClick={() => navigate({ to: '/clients/new' })}>
              <UserPlus /> {t('contacts.new')}
            </Button>
          </div>
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
        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}</SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <SlidersHorizontal className="size-4" />
              {t('contacts.colsBtn')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-2">
            <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t('contacts.colsBtnTitle')}</p>
            <div className="flex flex-col gap-1.5">
              {ALL_COLS.map(({ key, label }) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-accent">
                  <Checkbox checked={visibleCols.has(key)} onCheckedChange={() => toggleCol(key)} />
                  {label()}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {data && <span className="text-sm tabular-nums text-muted-foreground">{from}–{to} / {total}</span>}
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
              {visibleCols.has('type')    && <Th>{t('contacts.colType')}</Th>}
              {visibleCols.has('city')    && <Th>{t('contacts.colCity')}</Th>}
              {visibleCols.has('contact') && <Th>{t('contacts.colContact')}</Th>}
              {visibleCols.has('mobile')  && <Th>{t('contacts.colMobile')}</Th>}
              {visibleCols.has('email')   && <Th>{t('contacts.colEmail')}</Th>}
              {visibleCols.has('flags')   && <Th>{t('contacts.colFlags')}</Th>}
              {visibleCols.has('models')  && <Th>{t('contacts.colModels')}</Th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">
                <Loader2 className="mx-auto size-5 animate-spin" />
              </td></tr>
            )}
            {data && rows.length === 0 && (
              <tr><td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">{t('contacts.empty')}</td></tr>
            )}
            {rows.map((c) => (
              <tr
                key={c.id}
                onClick={() => navigate({ to: '/clients/$contactId', params: { contactId: c.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent"
              >
                <td className="px-3 py-2 font-medium">{contactDisplayName(c)}</td>
                {visibleCols.has('type')    && <td className="px-3 py-2">{t(`contacts.type_${c.type}`)}</td>}
                {visibleCols.has('city')    && <td className="px-3 py-2">{c.city ?? '—'}</td>}
                {visibleCols.has('contact') && <td className="px-3 py-2">{c.email ?? c.mobile ?? c.phone ?? '—'}</td>}
                {visibleCols.has('mobile')  && <td className="px-3 py-2">{c.mobile ?? '—'}</td>}
                {visibleCols.has('email')   && <td className="px-3 py-2">{c.email ?? '—'}</td>}
                {visibleCols.has('flags')   && <td className="px-3 py-2"><Flags c={c} /></td>}
                {visibleCols.has('models')  && <td className="px-3 py-2">{getModelInterests(c).length ? <ModelInterestBadges models={getModelInterests(c)} max={3} /> : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-end gap-3 text-[13px]">
        <span className="tabular-nums text-muted-foreground">{t('contacts.page')} {page + 1} / {pageCount}</span>
        <Button variant="outline" size="sm" disabled={page <= 0 || isLoading} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="size-4" /></Button>
        <Button variant="outline" size="sm" disabled={page >= pageCount - 1 || isLoading} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-4" /></Button>
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
