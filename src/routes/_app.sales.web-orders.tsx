import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, CircleDashed, Clock, Ban, FlaskConical, Link2, Loader2, RefreshCw, RotateCcw, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import {
  listWebOrders, getWebOrderSettings, setWebOrderImport, retryWebOrder, syncWebOrdersNow,
  webOrderTone, canRetry, countByStatus, WEB_ORDER_STATUSES, WEB_ORDER_ROLES,
  type WebOrder, type WebOrderImportStatus,
} from '@/modules/sales/web-orders-api';
import { eur } from '@/modules/sales/balance-panel';
import { t } from '@/lib/i18n';

/**
 * Ventes → « Commandes du site » (mission 03, carte « Une vente sur le site crée la vente et la
 * sortie de stock dans le DMS »). Liste des commandes Shopify reçues, statut d'import (importée,
 * à relier, erreur…), lien vers la facture du DMS, bouton « Réessayer » ; réglage société
 * « Import des commandes du site » (Arrêté / Actif, administrateurs).
 */
export const Route = createFileRoute('/_app/sales/web-orders')({
  head: () => ({ meta: [{ title: 'Commandes du site — Ducati Bruxelles' }] }),
  component: WebOrdersPage,
});

const ALL = '__all';
const ICONS: Record<WebOrderImportStatus, typeof CheckCircle2> = {
  importee: CheckCircle2, a_relier: Link2, erreur: XCircle, en_attente: Clock, annulee: Ban, ignoree: FlaskConical,
};
const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);
const errMsg = (e: unknown) => {
  const m = (e as { message?: string } | null)?.message ?? String(e);
  return m === 'import_stopped' ? t('webOrders.stopped') : m;
};
const finLabel = (s: string | null) => {
  if (!s) return '—';
  const k = `webOrders.fin_${s}`;
  const v = t(k);
  return v === k ? s : v;
};

function WebOrdersPage() {
  const { activeCompanyId, rolesForActiveCompany } = useAuth();
  const qc = useQueryClient();
  const admin = rolesForActiveCompany.includes('admin');
  const allowed = rolesForActiveCompany.some((r) => (WEB_ORDER_ROLES as readonly string[]).includes(r));
  const [status, setStatus] = useState<string>(ALL);
  const [confirm, setConfirm] = useState<boolean | null>(null);

  const settingsQ = useQuery({
    queryKey: ['web-order-settings', activeCompanyId],
    queryFn: () => getWebOrderSettings(activeCompanyId!),
    enabled: !!activeCompanyId && allowed,
  });
  const ordersQ = useQuery({
    queryKey: ['web-orders', activeCompanyId],
    queryFn: () => listWebOrders(activeCompanyId!),
    enabled: !!activeCompanyId && allowed,
    refetchInterval: 60_000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['web-orders', activeCompanyId] });
    qc.invalidateQueries({ queryKey: ['web-order-settings', activeCompanyId] });
  };

  const toggle = useMutation({
    mutationFn: (on: boolean) => setWebOrderImport(activeCompanyId!, on),
    onSuccess: () => { toast.success(t('webOrders.switched')); refresh(); },
    onError: (e) => toast.error(`${t('webOrders.errorPrefix')} : ${errMsg(e)}`),
  });
  const sync = useMutation({
    mutationFn: () => syncWebOrdersNow(activeCompanyId!),
    onSuccess: (n) => { toast.success(fill(t('webOrders.syncDone'), { n })); refresh(); },
    onError: (e) => toast.error(`${t('webOrders.errorPrefix')} : ${errMsg(e)}`),
  });
  const retry = useMutation({
    mutationFn: (o: WebOrder) => retryWebOrder(activeCompanyId!, o.shopifyOrderId),
    onSuccess: (st) => {
      const k = `webOrders.st_${st}`;
      toast.success(fill(t('webOrders.retryDone'), { status: t(k) === k ? st : t(k) }));
      refresh();
    },
    onError: (e) => { toast.error(`${t('webOrders.errorPrefix')} : ${errMsg(e)}`); refresh(); },
  });

  if (!allowed) {
    return (
      <>
        <PageHeader title={t('webOrders.title')} breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: t('webOrders.title') }]} />
        <p className="text-sm text-muted-foreground">{t('webOrders.notAllowed')}</p>
      </>
    );
  }

  const s = settingsQ.data;
  const rows = ordersQ.data ?? [];
  const counts = countByStatus(rows);
  const shown = status === ALL ? rows
    : status === 'a_verifier' ? rows.filter((r) => r.needsCheck)
    : rows.filter((r) => r.status === status);

  return (
    <>
      <PageHeader
        title={t('webOrders.title')}
        description={t('webOrders.subtitle')}
        breadcrumbs={[{ label: t('nav.sales'), to: '/sales' }, { label: t('webOrders.title') }]}
        actions={admin && s?.importEnabled ? (
          <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {t('webOrders.syncBtn')}
          </Button>
        ) : undefined}
      />

      {/* Réglage société */}
      <div className="mb-4 flex flex-wrap items-start gap-4 rounded-md border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <Switch
            checked={!!s?.importEnabled}
            disabled={!admin || !s || toggle.isPending}
            onCheckedChange={(on) => setConfirm(on)}
            aria-label={t('webOrders.settingTitle')}
          />
          <div>
            <div className="text-sm font-semibold">{t('webOrders.settingTitle')}</div>
            <StatusBadge
              tone={s?.importEnabled ? 'success' : 'neutral'}
              icon={s?.importEnabled ? CheckCircle2 : Ban}
              label={s?.importEnabled ? t('webOrders.settingOn') : t('webOrders.settingOff')}
            />
          </div>
        </div>
        <div className="min-w-64 flex-1 text-[13px] text-muted-foreground">
          <p>
            {s?.importEnabled
              ? fill(t('webOrders.settingHelpOn'), { date: fmtDateTime(s.enabledAt) })
              : t('webOrders.settingHelpOff')}
          </p>
          {s?.importEnabled && (
            <p>{fill(t('webOrders.lastCatchup'), { date: s.lastCatchupAt ? fmtDateTime(s.lastCatchupAt) : t('webOrders.never') })}</p>
          )}
          {!admin && <p>{t('webOrders.settingAdminOnly')}</p>}
        </div>
      </div>

      {/* Compteurs + filtre */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('webOrders.filterStatus')}</span>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('webOrders.all')} ({rows.length})</SelectItem>
              {WEB_ORDER_STATUSES.map((st) => (
                <SelectItem key={st} value={st}>{t(`webOrders.st_${st}`)} ({counts[st]})</SelectItem>
              ))}
              <SelectItem value="a_verifier">{t('webOrders.count_a_verifier')} ({counts.a_verifier})</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <div className="flex flex-wrap gap-2 pb-1">
          {(['a_relier', 'erreur'] as const).filter((st) => counts[st] > 0).map((st) => (
            <StatusBadge key={st} tone={webOrderTone(st)} icon={ICONS[st]} label={`${t(`webOrders.st_${st}`)} : ${counts[st]}`} />
          ))}
          {counts.a_verifier > 0 && (
            <StatusBadge tone="warning" icon={AlertTriangle} label={`${t('webOrders.toCheck')} : ${counts.a_verifier}`} />
          )}
        </div>
      </div>

      {ordersQ.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('webOrders.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full font-data text-[13px]">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t('webOrders.colOrder')}</th>
                <th className="px-3 py-2">{t('webOrders.colDate')}</th>
                <th className="px-3 py-2">{t('webOrders.colClient')}</th>
                <th className="px-3 py-2 text-right">{t('webOrders.colTotal')}</th>
                <th className="px-3 py-2">{t('webOrders.colPayment')}</th>
                <th className="px-3 py-2">{t('webOrders.colStatus')}</th>
                <th className="px-3 py-2">{t('webOrders.colDocument')}</th>
                <th className="px-3 py-2 text-right">{t('webOrders.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const unlinked = o.lines.filter((l) => !l.articleId);
                return (
                  <tr key={o.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-semibold">{o.name ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtDateTime(o.createdAt)}</td>
                    <td className="px-3 py-2">
                      {o.contactId ? (
                        <Link to="/clients/$contactId" params={{ contactId: o.contactId }} className="hover:underline">
                          {o.contactName ?? o.email ?? '—'}
                        </Link>
                      ) : (o.email ?? '—')}
                      {o.contactCreated && <span className="ml-1 text-[11px] text-muted-foreground">({t('webOrders.newContact')})</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{o.totalTtc == null ? '—' : eur(o.totalTtc)}</td>
                    <td className="px-3 py-2">
                      {finLabel(o.financialStatus)}
                      {o.cancelledAt && <span className="block text-[11px] text-muted-foreground">{t('webOrders.cancelled')}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge tone={webOrderTone(o.status)} icon={ICONS[o.status]} label={t(`webOrders.st_${o.status}`)} />
                        {o.needsCheck && <StatusBadge tone="warning" icon={AlertTriangle} label={t('webOrders.toCheck')} />}
                        {o.status === 'erreur' && o.errorMessage && (
                          <span className="max-w-72 text-[11px] text-[var(--danger)]">{o.errorMessage}</span>
                        )}
                        {o.needsCheck && o.checkReason && <span className="max-w-72 text-[11px] text-muted-foreground">{o.checkReason}</span>}
                        {unlinked.length > 0 && (
                          <span className="max-w-72 text-[11px] text-muted-foreground">
                            {fill(t('webOrders.toLink'), { list: unlinked.map((l) => l.sku || l.title || '—').join(', ') })}
                            {' · '}
                            <Link to="/parts/shopify" className="underline">{t('webOrders.openLinks')}</Link>
                          </span>
                        )}
                        {o.attempts > 1 && <span className="text-[11px] text-muted-foreground">{fill(t('webOrders.attempts'), { n: o.attempts })}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {o.documentId ? (
                        <Link to="/sales/$documentId" params={{ documentId: o.documentId }} className="font-semibold hover:underline">
                          {o.documentNumber ?? '—'}
                        </Link>
                      ) : '—'}
                      {o.credits.map((c) => (
                        <Link key={c.id} to="/sales/$documentId" params={{ documentId: c.id }} className="block text-[11px] text-muted-foreground hover:underline">
                          {t('webOrders.credits')} {c.number ?? ''} · <span className="tabular-nums">{eur(-Math.abs(c.amount))}</span>
                        </Link>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canRetry(o) && s?.importEnabled && (
                        <Button
                          variant="outline" size="sm"
                          disabled={retry.isPending && retry.variables?.id === o.id}
                          onClick={() => retry.mutate(o)}
                          title={o.status === 'a_relier' ? t('webOrders.linkHint') : undefined}
                        >
                          {retry.isPending && retry.variables?.id === o.id
                            ? <Loader2 className="size-4 animate-spin" />
                            : o.status === 'a_relier' ? <CircleDashed className="size-4" /> : <RotateCcw className="size-4" />}
                          {t('webOrders.retryBtn')}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? t('webOrders.confirmOnTitle') : t('webOrders.confirmOffTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{confirm ? t('webOrders.confirmOnBody') : t('webOrders.confirmOffBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm !== null) toggle.mutate(confirm); setConfirm(null); }}>
              {confirm ? t('webOrders.settingOn') : t('webOrders.settingOff')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
