/**
 * Achats → Commandes fournisseur (« Toutes nos commandes », parité G8 « Rappel proposition
 * commande », mission 09 carte 1) : tous les paniers Ducati (standard / urgente / démo) par
 * statut, type et période, avec leurs totaux, le fichier conservé et le numéro DCS.
 * Actions : nouveau panier (plusieurs ouverts possibles), « Remplir depuis les minimums ».
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown, Loader2, Plus, RefreshCw, Zap } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, fillVars, pageTitle } from '@/lib/i18n';
import {
  BASKET_KINDS, BASKET_STATUSES, countBaskets, filterBaskets, type BasketKind, type BasketStatus,
} from '@/modules/purchases/basket';
import { fillMinimax, listBaskets, openBasket } from '@/modules/purchases/basket-api';
import { storedExportUrl } from '@/modules/purchases/basket-export';
import { BasketKindBadge, BasketStatusBadge, basketKindLabel, eur, fmtDate, fmtDateTime } from '@/modules/purchases/basket-ui';

export const Route = createFileRoute('/_app/purchases/baskets/')({
  head: () => ({ meta: [{ title: pageTitle('purchasesBaskets') }] }),
  component: BasketsPage,
});

function BasketsPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const [status, setStatus] = useState<BasketStatus | 'all'>('all');
  const [kind, setKind] = useState<BasketKind | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const basketsQ = useQuery({ queryKey: ['supplier-baskets', activeCompanyId], queryFn: () => listBaskets(activeCompanyId!), enabled: !!activeCompanyId });
  const rows = basketsQ.data ?? [];
  const shown = useMemo(() => filterBaskets(rows, { status, kind, from: from || null, to: to || null }), [rows, status, kind, from, to]);
  const counts = useMemo(() => countBaskets(rows), [rows]);
  const shownTotals = useMemo(() => countBaskets(shown), [shown]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['supplier-baskets', activeCompanyId] });

  const open = useMutation({
    meta: { success: t('basket.opened') },
    mutationFn: (k: BasketKind) => openBasket(activeCompanyId!, k),
    onSuccess: (id) => { refresh(); navigate({ to: '/purchases/baskets/$basketId', params: { basketId: id } }); },
  });
  const minimax = useMutation({
    meta: { success: false },
    mutationFn: () => fillMinimax(activeCompanyId!, null),
    onSuccess: (r) => { refresh(); navigate({ to: '/purchases/baskets/$basketId', params: { basketId: r.basket_id } }); },
  });
  const download = useMutation({
    meta: { success: false },
    mutationFn: async (path: string) => { const url = await storedExportUrl(path); if (url) window.open(url, '_blank', 'noopener'); },
  });

  return (
    <>
      <PageHeader
        title={t('basket.title')}
        description={t('basket.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate({ to: '/purchases' })}><ArrowLeft /> {t('purchases.backToList')}</Button>
            {canWrite && (
              <>
                <Button variant="outline" disabled={minimax.isPending} onClick={() => minimax.mutate()}>
                  {minimax.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('basket.fillMinimax')}
                </Button>
                <Button variant="outline" disabled={open.isPending} onClick={() => open.mutate('urgente')}><Zap /> {t('basket.newUrgente')}</Button>
                <Button disabled={open.isPending} onClick={() => open.mutate('standard')}><Plus /> {t('basket.newStandard')}</Button>
              </>
            )}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('basket.filterStatus')}</span>
          <Select value={status} onValueChange={(v) => setStatus(v as BasketStatus | 'all')}>
            <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('basket.all')} ({rows.length})</SelectItem>
              {BASKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`basket.status_${s}`)} ({counts.byStatus[s] ?? 0})</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('basket.filterKind')}</span>
          <Select value={kind} onValueChange={(v) => setKind(v as BasketKind | 'all')}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('basket.all')}</SelectItem>
              {BASKET_KINDS.map((k) => <SelectItem key={k} value={k}>{basketKindLabel(k)} ({counts.byKind[k] ?? 0})</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('basket.filterFrom')}</span>
          <Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('basket.filterTo')}</span>
          <Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <p className="pb-2 font-data text-[13px] tabular-nums text-muted-foreground">
          {fillVars(t('basket.listTotals'), { n: shown.length, total: eur(shownTotals.totalHt) })}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('basket.colLabel')}</Th><Th>{t('basket.colKind')}</Th><Th>{t('basket.colStatus')}</Th>
              <Th>{t('basket.colCreated')}</Th><Th>{t('basket.colOrdered')}</Th>
              <Th className="text-right">{t('basket.colTotal')}</Th><Th>{t('basket.colDcs')}</Th><Th>{t('basket.colFile')}</Th>
            </tr>
          </thead>
          <tbody>
            {basketsQ.isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {basketsQ.isError && <tr><td colSpan={8} className="px-3 py-4 text-danger">{(basketsQ.error as Error).message}</td></tr>}
            {basketsQ.data && shown.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{t('basket.empty')}</td></tr>}
            {shown.map((b) => (
              <tr key={b.id} onClick={() => navigate({ to: '/purchases/baskets/$basketId', params: { basketId: b.id } })}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                <td className="px-3 py-2 font-medium">{b.label || '—'}</td>
                <td className="px-3 py-2"><BasketKindBadge kind={b.kind} /></td>
                <td className="px-3 py-2"><BasketStatusBadge status={b.status} /></td>
                <td className="px-3 py-2 tabular-nums">{fmtDate(b.created_at)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtDateTime(b.ordered_at)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(b.total_ht)}</td>
                <td className="px-3 py-2 font-mono text-[12px]">
                  {b.status === 'commande' || b.status === 'recu' ? (b.dcs_order_number ?? <span className="text-warning">{t('basket.dcsMissing')}</span>) : '—'}
                </td>
                <td className="px-3 py-2">
                  {b.file_path ? (
                    <Button size="sm" variant="outline" disabled={download.isPending} onClick={(e) => { e.stopPropagation(); download.mutate(b.file_path!); }}>
                      <FileDown /> {t('basket.download')}
                    </Button>
                  ) : '—'}
                </td>
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
