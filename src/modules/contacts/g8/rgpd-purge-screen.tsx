/**
 * M1 — RGPD - Purge (G8, liste des clients), 18/11/2026. Deux phases, comme G8 :
 *   1. Identifier : prospects sans activité depuis 3 ans, clients sans facture ni activité
 *      depuis 5 ans (durées réglables dans Paramètres -> Tables, « gdpr_purge »). Les fiches
 *      ayant un document en cours (ou un compte client, un OR, un RDV à venir...) sont gardées.
 *      Aucune fiche n'est modifiée.
 *   2. Confirmer (le jour même) : chaque fiche est revérifiée puis ANONYMISÉE. Les fiches
 *      décochées sont gardées. Tout est tracé (events), sans donnée personnelle.
 * Réservé aux administrateurs.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, SearchCheck, ShieldX, Ban, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { contactDisplayName } from '../api';
import { listPurgeRuns, listPurgeItems, purgeIdentify, purgeConfirm, purgeAbandon, contactsByIdsChunked, type PurgeRun } from './api';
import { Th, Empty, Spinner, MissingMigration, g8ErrorMessage } from './client-g8-tabs';

const fmt = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-BE') : '—');
const RUN_TONE: Record<PurgeRun['status'], StatusTone> = { identifie: 'warning', execute: 'success', abandonne: 'neutral' };

export function RgpdPurgeScreen({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const admin = isAdmin(companyId);
  const runsQ = useQuery({ queryKey: ['g8-purge-runs', companyId], queryFn: () => listPurgeRuns(companyId), enabled: admin });
  const runs = runsQ.data?.rows ?? [];
  const pending = runs.find((r) => r.status === 'identifie') ?? null;
  const [shownRun, setShownRun] = useState<string | null>(null);
  const runId = shownRun ?? pending?.id ?? runs[0]?.id ?? null;
  const run = runs.find((r) => r.id === runId) ?? null;
  const itemsQ = useQuery({ queryKey: ['g8-purge-items', runId], queryFn: () => listPurgeItems(runId!), enabled: !!runId });
  const ids = (itemsQ.data ?? []).map((i) => i.contact_id).filter((x): x is string => !!x);
  const contactsQ = useQuery({ queryKey: ['g8-purge-contacts', runId, ids.length], queryFn: () => contactsByIdsChunked(ids), enabled: ids.length > 0 });
  const byId = useMemo(() => new Map((contactsQ.data ?? []).map((c) => [c.id, c])), [contactsQ.data]);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const refresh = () => { qc.invalidateQueries({ queryKey: ['g8-purge-runs', companyId] }); qc.invalidateQueries({ queryKey: ['g8-purge-items'] }); };

  const identify = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => purgeIdentify(companyId),
    onSuccess: (id) => { setShownRun(id); setKept(new Set()); refresh(); toast.success(t('g8c.purge.identified')); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  const execute = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => purgeConfirm(run!.id, [...kept]),
    onSuccess: (r) => { refresh(); qc.invalidateQueries({ queryKey: ['contacts'] }); toast.success(t('g8c.purge.done').replace('{n}', String(r.anonymised)).replace('{k}', String(r.skipped))); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  const abandon = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => purgeAbandon(run!.id),
    onSuccess: () => { refresh(); toast.success(t('g8c.purge.abandoned')); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });

  if (!admin) return <p className="flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning"><Lock className="size-4" /> {t('g8c.purge.adminOnly')}</p>;
  if (runsQ.isLoading) return <Spinner />;
  if (runsQ.data?.missing) return <MissingMigration />;

  const items = itemsQ.data ?? [];
  const purgeable = items.filter((i) => !i.kept_reason && !i.outcome);
  const toPurge = purgeable.filter((i) => i.contact_id && !kept.has(i.contact_id));
  const isPending = run?.status === 'identifie';
  const stale = isPending && run!.reference_date !== new Date().toISOString().slice(0, 10);

  const doConfirm = async () => {
    const ok = await confirm({
      title: t('g8c.purge.confirmTitle'),
      message: t('g8c.purge.confirmMessage').replace('{n}', String(toPurge.length)),
      confirmLabel: t('g8c.purge.confirmBtn'),
      variant: 'delete',
    });
    if (ok) execute.mutate();
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-md border border-border bg-card p-3 text-[13px]">
        <p>{t('g8c.purge.rule')}</p>
        <p className="text-muted-foreground">{t('g8c.purge.anonymiseRule')}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button disabled={identify.isPending} onClick={() => identify.mutate()}>{identify.isPending ? <Loader2 className="animate-spin" /> : <SearchCheck />} {t('g8c.purge.identify')}</Button>
          <span className="text-[12px] text-muted-foreground">{t('g8c.purge.identifyHint')}</span>
        </div>
      </section>

      {runs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('g8c.purge.history')}</span>
          {runs.map((r) => (
            <button key={r.id} type="button" onClick={() => { setShownRun(r.id); setKept(new Set()); }}
              className={`rounded-md border px-2 py-1 ${r.id === runId ? 'border-foreground' : 'border-border'} hover:bg-accent`}>
              {fmt(r.identified_at)} · <StatusBadge tone={RUN_TONE[r.status]} label={t(`g8c.purge.run_${r.status}`)} />
            </button>
          ))}
        </div>
      )}

      {run && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <StatusBadge tone={RUN_TONE[run.status]} label={t(`g8c.purge.run_${run.status}`)} />
            <span>{t('g8c.purge.limits').replace('{p}', fmt(run.prospect_before)).replace('{c}', fmt(run.client_before)).replace('{l}', fmt(run.legal_before))}</span>
            <span className="tabular-nums">{t('g8c.purge.counts').replace('{n}', String(run.candidates)).replace('{k}', String(run.kept_open))}</span>
            {run.status === 'execute' && <span className="tabular-nums">{t('g8c.purge.executedCount').replace('{n}', String(run.executed_count))}</span>}
          </div>
          {stale && <p className="flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning"><AlertTriangle className="size-4" /> {t('g8c.purge.stale')}</p>}
          {itemsQ.isLoading ? <Spinner /> : items.length === 0 ? <Empty>{t('g8c.purge.none')}</Empty> : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[56rem] border-collapse font-data text-[13px]">
                <thead className="bg-muted"><tr>
                  <Th className="w-24">{t('g8c.purge.colPurge')}</Th><Th>{t('g8c.list.colCode')}</Th><Th>{t('g8c.list.colName')}</Th><Th>{t('g8c.purge.colReason')}</Th>
                  <Th>{t('g8c.purge.colLastActivity')}</Th><Th>{t('g8c.purge.colLastInvoice')}</Th><Th>{t('g8c.purge.colMode')}</Th><Th>{t('g8c.purge.colResult')}</Th>
                </tr></thead>
                <tbody>
                  {items.map((i) => {
                    const c = i.contact_id ? byId.get(i.contact_id) : undefined;
                    const blocked = !!i.kept_reason;
                    return (
                      <tr key={i.id} className={`border-b border-border last:border-0 ${blocked ? 'text-muted-foreground' : ''}`}>
                        <td className="px-3 py-1.5">
                          {isPending && !blocked && i.contact_id ? (
                            <Checkbox checked={!kept.has(i.contact_id)} onCheckedChange={() => setKept((p) => { const n = new Set(p); if (n.has(i.contact_id!)) n.delete(i.contact_id!); else n.add(i.contact_id!); return n; })} />
                          ) : blocked ? <Ban className="size-4" /> : null}
                        </td>
                        <td className="px-3 py-1.5 font-mono">{i.contact_id ? <a className="text-info underline" href={`/clients/${i.contact_id}`} target="_blank" rel="noopener noreferrer">{i.contact_code ?? '—'}</a> : (i.contact_code ?? '—')}</td>
                        <td className="px-3 py-1.5">{c ? contactDisplayName(c) : '—'}</td>
                        <td className="px-3 py-1.5">{t(`g8c.purge.reason_${i.reason}`)}</td>
                        <td className="px-3 py-1.5 tabular-nums">{fmt(i.last_activity_at)}</td>
                        <td className="px-3 py-1.5 tabular-nums">{fmt(i.last_invoice_date)}</td>
                        <td className="px-3 py-1.5">{t(`g8c.purge.mode_${i.mode}`)}</td>
                        <td className="px-3 py-1.5">
                          {i.outcome === 'anonymise' && <StatusBadge tone="success" icon={CheckCircle2} label={t('g8c.purge.out_anonymise')} />}
                          {i.outcome && i.outcome !== 'anonymise' && <StatusBadge tone="neutral" label={t(`g8c.purge.out_${i.outcome}`)} />}
                          {!i.outcome && blocked && <StatusBadge tone="info" icon={ShieldX} label={t(`g8c.purge.kept_${i.kept_reason}`)} />}
                          {!i.outcome && !blocked && <StatusBadge tone="warning" label={t('g8c.purge.toPurge')} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {isPending && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={abandon.isPending} onClick={() => abandon.mutate()}>{t('g8c.purge.abandon')}</Button>
              <Button disabled={stale || toPurge.length === 0 || execute.isPending} onClick={() => void doConfirm()}>
                {execute.isPending ? <Loader2 className="animate-spin" /> : <ShieldX />} {t('g8c.purge.confirmBtnN').replace('{n}', String(toPurge.length))}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
