/**
 * Mission 03 — Synchronisation Shopify sur l'écran Produits Shopify (W-8) :
 * mode Arrêtée / Essai / Tous, articles d'essai, simulation (lecture seule), « Tout resynchroniser »,
 * journal des envois. Administrateurs : actions ; vendeurs : lecture.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, PauseCircle, FlaskConical, CheckCircle2, AlertTriangle, RefreshCw, Send, Search, Trash2, Plus, Clock,
  Link2, Unlink, MinusCircle, Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { listArticles } from './api';
import {
  getSyncStatus, setSyncMode, addTrialArticle, removeTrialArticle, resyncAll, processQueueNow, simulatePush, listSyncLog,
  type SyncMode, type SimulatedLine, type PushReport,
} from './shopify-sync-api';
import { t } from '@/lib/i18n';

type Icon = typeof CheckCircle2;

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);
}
const errMsg = (e: unknown) => (e as { message?: string } | null)?.message ?? String(e);
const fmtEur = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('fr-BE') : t('shopifySync.never'));

const MODE_BADGE: Record<SyncMode, { tone: StatusTone; icon: Icon; label: string }> = {
  arrete: { tone: 'neutral', icon: PauseCircle, label: 'shopifySync.stArrete' },
  essai: { tone: 'warning', icon: FlaskConical, label: 'shopifySync.stEssai' },
  tous: { tone: 'success', icon: CheckCircle2, label: 'shopifySync.stTous' },
};

export const RESULT_BADGE: Record<string, { tone: StatusTone; icon: Icon; label: string }> = {
  ok: { tone: 'success', icon: CheckCircle2, label: 'shopifySync.rOk' },
  deja_a_jour: { tone: 'info', icon: MinusCircle, label: 'shopifySync.rSame' },
  erreur: { tone: 'danger', icon: AlertTriangle, label: 'shopifySync.rErr' },
  a_envoyer: { tone: 'warning', icon: Send, label: 'shopifySync.rTodo' },
};

export const KIND_LABEL: Record<string, string> = {
  stock_prix: 'shopifySync.kStockPrix',
  publication: 'shopifySync.kPublication',
  retrait: 'shopifySync.kRetrait',
  mise_a_jour: 'shopifySync.kMaj',
};

function reportToast(r: PushReport) {
  const list = Array.isArray(r.companies) ? r.companies : [];
  if (!list.length) { toast.info(t('shopifySync.processNothing')); return; }
  const sum = list.reduce((a, c) => ({ ok: a.ok + c.ok, same: a.same + c.up_to_date, err: a.err + c.errors }), { ok: 0, same: 0, err: 0 });
  (sum.err ? toast.warning : toast.success)(fill(t('shopifySync.processDone'), sum));
}

export function ShopifySyncPanel({ companyId, admin }: { companyId: string; admin: boolean }) {
  const qc = useQueryClient();
  const [pendingMode, setPendingMode] = useState<SyncMode | null>(null);
  const [confirmResync, setConfirmResync] = useState(false);
  const [sim, setSim] = useState<SimulatedLine[] | null>(null);
  const [q, setQ] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);

  const statusQ = useQuery({ queryKey: ['shopify-sync-status', companyId], queryFn: () => getSyncStatus(companyId), refetchInterval: 60_000 });
  const logQ = useQuery({
    queryKey: ['shopify-sync-log', companyId, errorsOnly],
    queryFn: () => listSyncLog(companyId, { errorsOnly, limit: 50 }),
    refetchInterval: 60_000,
  });
  const st = statusQ.data;
  const mode = st?.mode ?? 'arrete';
  const mb = MODE_BADGE[mode];
  const trial = st?.trial ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['shopify-sync-status', companyId] });
    qc.invalidateQueries({ queryKey: ['shopify-sync-log', companyId] });
    qc.invalidateQueries({ queryKey: ['shopify-products', companyId] });
  };

  const term = q.trim();
  const found = useQuery({
    queryKey: ['shopify-trial-search', companyId, term],
    queryFn: () => listArticles(companyId, { search: term, limit: 10 }),
    enabled: admin && term.length >= 2,
  });

  const modeM = useMutation({
    mutationFn: (m: SyncMode) => setSyncMode(companyId, m),
    onSuccess: (n) => { toast.success(fill(t('shopifySync.modeChanged'), { n })); refresh(); },
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${errMsg(e)}`),
  });
  const addM = useMutation({
    mutationFn: (id: string) => addTrialArticle(companyId, id),
    onSuccess: () => { toast.success(t('shopifySync.trialAdded')); setQ(''); refresh(); },
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${errMsg(e)}`),
  });
  const removeM = useMutation({
    mutationFn: (id: string) => removeTrialArticle(companyId, id),
    onSuccess: () => { toast.success(t('shopifySync.trialRemoved')); refresh(); },
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${errMsg(e)}`),
  });
  const simM = useMutation({
    mutationFn: () => simulatePush(companyId, trial.filter((x) => x.linked).map((x) => x.article_id)),
    onSuccess: (r) => setSim(r),
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${errMsg(e)}`),
  });
  const resyncM = useMutation({
    mutationFn: async () => {
      const n = await resyncAll(companyId);
      toast.success(fill(t('shopifySync.resyncDone'), { n }));
      return mode === 'arrete' ? null : processQueueNow(companyId);
    },
    onSuccess: (r) => { if (r) reportToast(r); refresh(); },
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${errMsg(e)}`),
  });
  const processM = useMutation({
    mutationFn: () => processQueueNow(companyId),
    onSuccess: (r) => { reportToast(r); refresh(); },
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${errMsg(e)}`),
  });

  const confirmText = pendingMode === 'essai'
    ? fill(t('shopifySync.modeConfirmEssai'), { n: trial.length })
    : pendingMode === 'tous'
      ? fill(t('shopifySync.modeConfirmTous'), { n: st?.linked ?? 0 })
      : t('shopifySync.modeConfirmArrete');
  const modeLabel = (m: SyncMode) => t(m === 'arrete' ? 'shopifySync.modeArrete' : m === 'essai' ? 'shopifySync.modeEssai' : 'shopifySync.modeTous');
  const modeHint = t(mode === 'arrete' ? 'shopifySync.modeArreteHint' : mode === 'essai' ? 'shopifySync.modeEssaiHint' : 'shopifySync.modeTousHint');

  return (
    <section className="mb-4 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-ui text-[15px] font-bold">{t('shopifySync.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {statusQ.isLoading ? <Loader2 className="size-4 animate-spin" /> : <StatusBadge tone={mb.tone} icon={mb.icon} label={t(mb.label)} />}
          {admin && (
            <Select value={mode} onValueChange={(v) => { if (v !== mode) setPendingMode(v as SyncMode); }} disabled={modeM.isPending || statusQ.isLoading}>
              <SelectTrigger className="w-56" aria-label={t('shopifySync.modeLabel')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['arrete', 'essai', 'tous'] as SyncMode[]).map((m) => <SelectItem key={m} value={m}>{modeLabel(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <p className="mb-1 text-[13px] text-muted-foreground">{t('shopifySync.intro')}</p>
      <p className="mb-3 text-[13px] font-medium">{modeHint}</p>

      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
        <span className="flex items-center gap-1.5"><Clock className="size-4 text-muted-foreground" />{t('shopifySync.pending')} : <b className="tabular-nums">{st?.queue_pending ?? 0}</b></span>
        <span className="flex items-center gap-1.5"><AlertTriangle className="size-4 text-muted-foreground" />{t('shopifySync.errors')} : <b className="tabular-nums">{st?.queue_errors ?? 0}</b></span>
        <span>{t('shopifySync.lastOk')} : <span className="tabular-nums">{fmtDate(st?.last_ok_at)}</span></span>
        {admin && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => processM.mutate()} disabled={processM.isPending || mode === 'arrete'}>
              {processM.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t('shopifySync.processNow')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmResync(true)} disabled={resyncM.isPending}>
              {resyncM.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('shopifySync.resyncAll')}
            </Button>
          </span>
        )}
      </div>

      <div className="mb-3 rounded-md border border-border p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('shopifySync.trialTitle')}</h3>
          {admin && (
            <Button size="sm" variant="outline" onClick={() => simM.mutate()} disabled={simM.isPending || !trial.some((x) => x.linked)}>
              {simM.isPending ? <Loader2 className="animate-spin" /> : <Eye />} {simM.isPending ? t('shopifySync.simulating') : t('shopifySync.simulate')}
            </Button>
          )}
        </div>
        <p className="mb-2 text-[12px] text-muted-foreground">{t('shopifySync.trialHint')}</p>
        {trial.length === 0 ? <p className="text-[13px] text-muted-foreground">{t('shopifySync.trialEmpty')}</p> : (
          <ul>
            {trial.map((x) => (
              <li key={x.article_id} className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0">
                <div className="min-w-0 text-[13px]">
                  <span className="font-mono text-[12px]">{x.reference}</span> {x.designation}
                </div>
                <div className="flex items-center gap-2">
                  {x.linked
                    ? <StatusBadge tone="success" icon={Link2} label={t('shopifySync.trialLinked')} />
                    : <StatusBadge tone="neutral" icon={Unlink} label={t('shopifySync.trialNotLinked')} />}
                  {admin && (
                    <Button size="sm" variant="ghost" onClick={() => removeM.mutate(x.article_id)} disabled={removeM.isPending}>
                      <Trash2 /> {t('shopifySync.trialRemove')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {admin && (
          <div className="mt-2">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('shopifySync.trialSearch')} className="pl-9" />
            </div>
            {term.length >= 2 && (
              found.isFetching ? <Loader2 className="mt-2 size-4 animate-spin" /> : (
                <ul className="mt-1 max-h-48 max-w-2xl overflow-y-auto">
                  {(found.data ?? []).filter((a) => !trial.some((x) => x.article_id === a.id)).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 border-t border-border py-1 first:border-t-0">
                      <span className="text-[13px]"><span className="font-mono text-[12px]">{a.reference}</span> {a.designation}</span>
                      <Button size="sm" variant="outline" onClick={() => addM.mutate(a.id)} disabled={addM.isPending}>
                        <Plus /> {t('shopifySync.trialAdd')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('shopifySync.logTitle')}</h3>
          <label className="flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" className="size-4" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
            {t('shopifySync.logErrorsOnly')}
          </label>
        </div>
        {(logQ.data ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">{t('shopifySync.logEmpty')}</p> : (
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-left text-[12px] uppercase text-muted-foreground">
                  <th className="px-2 py-1.5">{t('shopifySync.colDate')}</th>
                  <th className="px-2 py-1.5">{t('shopifySync.colKind')}</th>
                  <th className="px-2 py-1.5">{t('shopifySync.colResult')}</th>
                  <th className="px-2 py-1.5 text-right">{t('shopifySync.colPriceDms')}</th>
                  <th className="px-2 py-1.5 text-right">{t('shopifySync.colStockDms')}</th>
                  <th className="px-2 py-1.5">{t('shopifySync.colDetail')}</th>
                </tr>
              </thead>
              <tbody>
                {(logQ.data ?? []).map((l) => {
                  const b = RESULT_BADGE[l.status] ?? RESULT_BADGE.erreur;
                  return (
                    <tr key={l.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums">{fmtDate(l.created_at)}</td>
                      <td className="px-2 py-1">{t(KIND_LABEL[l.kind] ?? l.kind)}</td>
                      <td className="px-2 py-1"><StatusBadge tone={b.tone} icon={b.icon} label={t(b.label)} /></td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtEur(l.price_sent)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{l.qty_sent ?? '—'}</td>
                      <td className="px-2 py-1 text-[12px] text-muted-foreground">{l.detail ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={!!pendingMode} onOpenChange={(o) => { if (!o) setPendingMode(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('shopifySync.modeConfirmTitle')} {pendingMode ? `→ ${modeLabel(pendingMode)}` : ''}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const m = pendingMode; setPendingMode(null); if (m) modeM.mutate(m); }}>
              {pendingMode ? modeLabel(pendingMode) : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmResync} onOpenChange={setConfirmResync}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('shopifySync.resyncAll')}</AlertDialogTitle>
            <AlertDialogDescription>{fill(t('shopifySync.resyncConfirm'), { mode: modeLabel(mode) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmResync(false); resyncM.mutate(); }}>{t('shopifySync.resyncAll')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!sim} onOpenChange={(o) => { if (!o) setSim(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('shopifySync.simulateTitle')}</DialogTitle>
            <DialogDescription>{t('shopifySync.simulateHint')}</DialogDescription>
          </DialogHeader>
          {(sim ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">{t('shopifySync.simNothing')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-data text-[13px]">
                <thead className="bg-muted">
                  <tr className="text-left text-[12px] uppercase text-muted-foreground">
                    <th className="px-2 py-1.5">{t('shopifySync.colRef')}</th>
                    <th className="px-2 py-1.5 text-right">{t('shopifySync.colPriceSite')}</th>
                    <th className="px-2 py-1.5 text-right">{t('shopifySync.colPriceDms')}</th>
                    <th className="px-2 py-1.5 text-right">{t('shopifySync.colStockSite')}</th>
                    <th className="px-2 py-1.5 text-right">{t('shopifySync.colStockDms')}</th>
                    <th className="px-2 py-1.5">{t('shopifySync.colResult')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(sim ?? []).map((r) => {
                    const b = RESULT_BADGE[r.status] ?? RESULT_BADGE.erreur;
                    return (
                      <tr key={r.article_id} className="border-t border-border">
                        <td className="px-2 py-1 font-mono text-[12px]">{r.reference}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtEur(r.price_before)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtEur(r.price_sent)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.qty_before ?? '—'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.qty_sent ?? '—'}</td>
                        <td className="px-2 py-1">
                          <StatusBadge tone={b.tone} icon={b.icon} label={t(b.label)} />
                          {r.detail && <div className="text-[11px] text-muted-foreground">{r.detail}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
