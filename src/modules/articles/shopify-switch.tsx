/**
 * Mission 03 — Une reference remplacee bascule sur la nouvelle, sur le site (decision client 29-30/10/2026).
 *
 * - ShopifySwitchButton : « Basculer le site sur la nouvelle reference » avec apercu (plan lu par la
 *   fonction serveur en simulation : rien n'est ecrit), puis execution. Sur la fiche de l'ancienne
 *   reference (onglet Remplacement, encadre Shopify) et sur celle de la nouvelle (une ligne par ancienne
 *   reference encore reliee au site).
 * - ShopifyReplacedPanel : ecran Produits Shopify, « Produits relies a une reference remplacee » :
 *   la liste, et « Tout basculer » (une bascule apres l'autre, avec le compte).
 * Administrateurs seulement ; soumis au mode de synchronisation (Arretee : grise ; Essai : les deux
 * references doivent etre des articles d'essai ; Tous : tout).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, CheckCircle2, Clock, Loader2, XCircle, MinusCircle, Info, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import {
  getArticleSiteStatus, listReplacedLinked, runSwitch,
  type ReplacedLinkedRow, type SwitchPlan, type SwitchResult, type SwitchStepName,
} from './shopify-sync-api';

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);
}

const STEP_LABEL: Record<SwitchStepName, string> = {
  contenu: 'shopifySwitch.stepContenu',
  publication: 'shopifySwitch.stepPublication',
  remise_en_ligne: 'shopifySwitch.stepRemise',
  mise_a_jour: 'shopifySwitch.stepMaj',
  retrait: 'shopifySwitch.stepRetrait',
  redirection: 'shopifySwitch.stepRedirection',
};

const STATUS_BADGE: Record<string, { tone: StatusTone; icon: typeof CheckCircle2; label: string }> = {
  a_faire: { tone: 'warning', icon: Clock, label: 'shopifySwitch.sTodo' },
  deja_fait: { tone: 'info', icon: MinusCircle, label: 'shopifySwitch.sDone' },
  bloque: { tone: 'danger', icon: XCircle, label: 'shopifySwitch.sBlocked' },
  ok: { tone: 'success', icon: CheckCircle2, label: 'shopifySwitch.sOk' },
  erreur: { tone: 'danger', icon: AlertTriangle, label: 'shopifySwitch.sErr' },
};

const REASON_LABEL: Record<string, string> = {
  not_replaced: 'shopifySwitch.eNotReplaced',
  old_not_linked: 'shopifySwitch.eOldNotLinked',
  sync_stopped: 'shopifySync.blockedStopped',
  not_in_trial: 'shopifySwitch.eNotInTrialBoth',
  inactive: 'shopifySync.eInactive',
  no_price: 'shopifySwitch.eNoPriceNext',
  no_handle: 'shopifySwitch.eNoHandle',
  not_configured: 'shopifySwitch.eNotConfigured',
};

function switchErrorText(r: SwitchResult | null | undefined): string {
  if (!r) return t('shopifySync.actionErr');
  if (r.error && REASON_LABEL[r.error]) return t(REASON_LABEL[r.error]);
  return `${t('shopifySync.eShopify')} : ${r.detail ?? r.error ?? ''}`;
}

/** Ce qui va se passer (apercu) ou ce qui s'est passe (resultat), etape par etape. */
function StepList({ plan, results }: { plan: SwitchPlan; results?: SwitchResult['results'] }) {
  const done = new Map((results ?? []).map((r) => [r.step, r]));
  return (
    <ul className="space-y-1 text-[13px]">
      {plan.steps.map((s) => {
        const r = done.get(s.step);
        const b = r ? STATUS_BADGE[r.ok ? 'ok' : 'erreur'] : STATUS_BADGE[s.status];
        return (
          <li key={s.step} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <StatusBadge tone={b.tone} icon={b.icon} label={t(b.label)} />
            <span>{t(STEP_LABEL[s.step])}</span>
            {(r?.detail ?? s.detail) && <span className="text-muted-foreground">— {r?.detail ?? s.detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Bouton + apercu + execution d'une bascule pour UNE ancienne reference (articleId).
 * `compact` : bouton seul (listes) ; sinon, un encadre avec le texte d'explication.
 */
export function ShopifySwitchButton({ companyId, articleId, nextReference, compact = false, disabled = false, onDone }: {
  companyId: string; articleId: string; nextReference?: string | null; compact?: boolean; disabled?: boolean; onDone?: () => void;
}) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SwitchResult | null>(null);
  const [result, setResult] = useState<SwitchResult | null>(null);

  const invalidate = (r: SwitchResult | null) => {
    qc.invalidateQueries({ queryKey: ['article-site-status', articleId] });
    if (r?.next?.article_id) qc.invalidateQueries({ queryKey: ['article-site-status', r.next.article_id] });
    qc.invalidateQueries({ queryKey: ['shopify-products', companyId] });
    qc.invalidateQueries({ queryKey: ['shopify-replaced', companyId] });
    qc.invalidateQueries({ queryKey: ['shopify-sync-log', companyId] });
  };

  const simulate = useMutation({
    mutationFn: () => runSwitch(companyId, articleId, true),
    onSuccess: (r) => { setPreview(r); setResult(null); setOpen(true); },
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${(e as Error)?.message ?? e}`),
  });
  const run = useMutation({
    mutationFn: () => runSwitch(companyId, articleId, false),
    onSuccess: (r) => {
      setResult(r);
      if (r?.ok) toast.success(fill(t('shopifySwitch.done'), { next: r.next?.reference ?? '' }));
      else if (r?.results?.length) toast.warning(fill(t('shopifySwitch.partial'), { n: r.results.filter((x) => !x.ok).length }));
      else toast.error(switchErrorText(r));
      invalidate(r);
      onDone?.();
    },
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${(e as Error)?.message ?? e}`),
  });

  if (!isAdmin()) return null;
  const busy = simulate.isPending || run.isPending;
  const plan = preview?.plan ?? null;

  const button = (
    <Button type="button" size="sm" variant={compact ? 'outline' : 'default'} onClick={() => simulate.mutate()} disabled={busy || disabled}>
      {simulate.isPending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
      {compact ? t('shopifySwitch.btnShort') : t('shopifySwitch.btn')}
    </Button>
  );

  return (
    <>
      {compact ? button : (
        <div className="rounded-md border border-border bg-card p-3">
          <p className="mb-2 flex items-start gap-1.5 text-[13px]">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{fill(t('shopifySwitch.hint'), { next: nextReference ?? '' })}</span>
          </p>
          {button}
        </div>
      )}
      <Dialog open={open} onOpenChange={(o) => { if (!o && !run.isPending) setOpen(false); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('shopifySwitch.title')}</DialogTitle>
            <DialogDescription>
              {preview?.old && preview?.next
                ? fill(t('shopifySwitch.intro'), { old: preview.old.reference, next: preview.next.reference })
                : t('shopifySwitch.intro')}
            </DialogDescription>
          </DialogHeader>
          {plan && (
            <div className="space-y-3">
              {!result && !plan.ok && preview?.error && (
                <p className="flex items-center gap-1.5 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
                  <XCircle className="size-4" />{switchErrorText(preview)}
                </p>
              )}
              <div>
                <div className="mb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                  {result ? t('shopifySwitch.resultTitle') : t('shopifySwitch.stepsTitle')}
                </div>
                <StepList plan={plan} results={result?.results} />
              </div>
              {plan.notice && (
                <p className="text-[13px] text-muted-foreground">{t('shopifySwitch.noticeLabel')} : <span className="text-foreground">{plan.notice}</span></p>
              )}
              {result && !result.ok && !result.results?.length && (
                <p className="flex items-center gap-1.5 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
                  <XCircle className="size-4" />{switchErrorText(result)}
                </p>
              )}
              <p className="text-[12px] text-muted-foreground">{t('shopifySwitch.safety')}</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={run.isPending}>
              {result ? t('action.close') : t('action.cancel')}
            </Button>
            {!result && (
              <Button type="button" onClick={() => run.mutate()} disabled={!plan?.ok || run.isPending}>
                {run.isPending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} {t('shopifySwitch.confirm')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Onglet Remplacement de l'ANCIENNE reference : le bouton, seulement si elle est reliee au site et remplacee. */
export function ShopifyReplacementSwitch({ companyId, articleId }: { companyId: string; articleId: string }) {
  const { isAdmin } = useAuth();
  const { data: st } = useQuery({
    queryKey: ['article-site-status', articleId],
    queryFn: () => getArticleSiteStatus(companyId, articleId),
    enabled: isAdmin(),
  });
  if (!isAdmin() || !st?.link || !st.replaced_by) return null;
  return <ShopifySwitchButton companyId={companyId} articleId={articleId} nextReference={st.replaced_by.reference} />;
}

/** Pour la fiche de la NOUVELLE reference : les anciennes encore reliees au site, chacune avec son bouton. */
export function ShopifyOldLinkedList({ companyId, articleId }: { companyId: string; articleId: string }) {
  const { isAdmin } = useAuth();
  const { data: st } = useQuery({
    queryKey: ['article-site-status', articleId],
    queryFn: () => getArticleSiteStatus(companyId, articleId),
    enabled: isAdmin(),
  });
  const rows = (st?.old_linked ?? []).filter((o) => !(o.redirect_done && o.product_status !== 'ACTIVE'));
  if (!isAdmin() || !rows.length) return null;
  return (
    <div className="mt-2 rounded-md border border-border bg-card p-3">
      <div className="mb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('shopifySwitch.oldOnSite')}</div>
      <ul className="space-y-1">
        {rows.map((o) => (
          <li key={o.article_id} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-mono">{o.reference}</span>
            <span className="text-muted-foreground">{o.product_status === 'ACTIVE' ? t('shopifySync.siteActive') : t('shopifySync.siteDraft')}</span>
            <ShopifySwitchButton companyId={companyId} articleId={o.article_id} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}

const SITE_BADGE = (status: string | null | undefined, linked: boolean): { tone: StatusTone; label: string } =>
  !linked ? { tone: 'neutral', label: 'shopifySync.siteNotLinked' }
  : status === 'ACTIVE' ? { tone: 'success', label: 'shopifySync.siteActive' }
  : status === 'ARCHIVED' ? { tone: 'neutral', label: 'shopifySync.siteArchived' }
  : { tone: 'warning', label: 'shopifySync.siteDraft' };

/** Ecran Produits Shopify : produits relies a une reference remplacee, avec « Tout basculer ». */
export function ShopifyReplacedPanel({ companyId, admin, mode }: { companyId: string; admin: boolean; mode: 'arrete' | 'essai' | 'tous' | undefined }) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { data: rows, isLoading } = useQuery({
    queryKey: ['shopify-replaced', companyId],
    queryFn: () => listReplacedLinked(companyId),
  });
  const todo = (rows ?? []).filter((r) => !r.done);
  const blocked = mode === 'arrete';

  const all = useMutation({
    mutationFn: async () => {
      let ok = 0; let err = 0;
      const list = todo.filter((r) => mode !== 'essai' || (r.old_in_trial && r.next_in_trial));
      for (let i = 0; i < list.length; i++) {
        setProgress({ i: i + 1, n: list.length });
        try {
          const r = await runSwitch(companyId, list[i].article_id, false);
          if (r?.ok) ok++; else err++;
        } catch { err++; }
      }
      return { ok, err, skipped: todo.length - list.length };
    },
    onSettled: () => {
      setProgress(null);
      qc.invalidateQueries({ queryKey: ['shopify-replaced', companyId] });
      qc.invalidateQueries({ queryKey: ['shopify-products', companyId] });
      qc.invalidateQueries({ queryKey: ['shopify-sync-log', companyId] });
    },
    onSuccess: (r) => (r.err ? toast.warning : toast.success)(fill(t('shopifySwitch.allDone'), r)),
    onError: (e) => toast.error(`${t('shopifySync.actionErr')} : ${(e as Error)?.message ?? e}`),
  });

  return (
    <div className="mb-4 rounded-md border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ArrowRightLeft className="size-4 text-muted-foreground" />
        <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('shopifySwitch.panelTitle')}</span>
        {isLoading ? <Loader2 className="size-4 animate-spin" /> : <span className="tabular-nums text-[13px]">{fill(t('shopifySwitch.panelCount'), { n: todo.length, total: (rows ?? []).length })}</span>}
        {admin && todo.length > 0 && (
          <Button type="button" size="sm" className="ml-auto" onClick={() => setConfirm(true)} disabled={all.isPending || blocked}>
            {all.isPending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
            {progress ? fill(t('shopifySwitch.progress'), progress) : t('shopifySwitch.allBtn')}
          </Button>
        )}
      </div>
      <p className="mb-2 text-[13px] text-muted-foreground">{t('shopifySwitch.panelIntro')}</p>
      {admin && blocked && (
        <p className="mb-2 flex items-center gap-1.5 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><Info className="size-4" />{t('shopifySync.blockedStopped')}</p>
      )}
      {admin && mode === 'essai' && (
        <p className="mb-2 flex items-center gap-1.5 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><Info className="size-4" />{t('shopifySwitch.essaiHint')}</p>
      )}
      {!isLoading && (rows ?? []).length === 0 && <p className="text-[13px] text-muted-foreground">{t('shopifySwitch.panelEmpty')}</p>}
      {(rows ?? []).length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                <th className="px-2 py-1">{t('shopifySwitch.colOld')}</th>
                <th className="px-2 py-1">{t('shopifySwitch.colSite')}</th>
                <th className="px-2 py-1">{t('shopifySwitch.colNew')}</th>
                <th className="px-2 py-1">{t('shopifySwitch.colSite')}</th>
                <th className="px-2 py-1">{t('shopifySwitch.colRedirect')}</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r: ReplacedLinkedRow) => {
                const o = SITE_BADGE(r.product_status, true);
                const n = SITE_BADGE(r.next_product_status, r.next_linked);
                return (
                  <tr key={r.article_id} className="border-t border-border">
                    <td className="px-2 py-1"><span className="font-mono">{r.reference}</span> <span className="text-muted-foreground">{r.designation}</span></td>
                    <td className="px-2 py-1"><StatusBadge tone={o.tone} label={t(o.label)} /></td>
                    <td className="px-2 py-1"><span className="font-mono">{r.next_reference}</span> <span className="text-muted-foreground">{r.next_designation}</span></td>
                    <td className="px-2 py-1"><StatusBadge tone={n.tone} label={t(n.label)} /></td>
                    <td className="px-2 py-1">
                      {r.redirect_done
                        ? <StatusBadge tone="success" icon={CheckCircle2} label={t('shopifySwitch.redirectDone')} />
                        : <StatusBadge tone="neutral" icon={MinusCircle} label={t('shopifySwitch.redirectTodo')} />}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {r.done
                        ? <StatusBadge tone="success" icon={CheckCircle2} label={t('shopifySwitch.rowDone')} />
                        : admin && <ShopifySwitchButton companyId={companyId} articleId={r.article_id} compact disabled={all.isPending || blocked} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('shopifySwitch.allBtn')}</DialogTitle>
            <DialogDescription>{fill(t('shopifySwitch.allConfirm'), { n: todo.length })}</DialogDescription>
          </DialogHeader>
          <p className="text-[12px] text-muted-foreground">{t('shopifySwitch.safety')}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(false)}>{t('action.cancel')}</Button>
            <Button type="button" onClick={() => { setConfirm(false); all.mutate(); }}><ArrowRightLeft /> {t('shopifySwitch.allBtn')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
