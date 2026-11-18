import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Save, Check, CalendarClock, Hash, Moon, ShieldCheck, Lock } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusBadge } from '@/components/status-badge';
import { useAuth } from '@/lib/auth/auth-context';
import {
  listSequences, updateSequence, getNumberingOverview, setSalesNumberingMode, setSequenceNextValue,
  type DocSequence, type NumberingOverview,
} from '@/modules/settings/sequences-api';
import {
  previewNumber, formatNumber, effectiveNextValue, nextValueError, skippedNumbers, isDormant, isSharedSalesType,
  groupOf, compareDocTypes, hasHelp, NUMBERING_GROUPS, SINGLE_COUNTER_TYPE, type SalesNumberingMode,
} from '@/modules/settings/numbering-rules';
import { t, pageTitle } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/numbering')({
  head: () => ({ meta: [{ title: pageTitle('settingsNumbering') }] }),
  component: NumberingPage,
});

type Row = DocSequence & { _dirty?: boolean };

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

/** Message lisible d'une erreur Supabase (objet, pas toujours un `Error`). */
const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : ((e as { message?: string } | null)?.message ?? t('settings.numError'));

function NumberingPage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<Row | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sequences', activeCompanyId],
    queryFn: () => listSequences(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const overviewQ = useQuery({
    queryKey: ['numbering-overview', activeCompanyId],
    queryFn: () => getNumberingOverview(activeCompanyId!),
    enabled: !!activeCompanyId,
  });
  const overview = overviewQ.data ?? null;
  const mode: SalesNumberingMode = overview?.sales_mode ?? 'separate';
  const year = overview?.year ?? new Date().getFullYear();
  const canManage = !!overview?.can_manage;

  useEffect(() => { if (data) setRows(data.map((d) => ({ ...d }))); }, [data]);

  const upd = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, _dirty: true } : r)));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sequences', activeCompanyId] });
    qc.invalidateQueries({ queryKey: ['numbering-overview', activeCompanyId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      for (const r of rows.filter((x) => x._dirty)) {
        await updateSequence(r.id, {
          prefix: r.prefix, separator: r.separator, padding: r.padding,
          reset_yearly: r.reset_yearly, suffix: r.suffix, label: r.label,
        });
      }
    },
    onSuccess: refresh,
    onError: (e) => setError(errMsg(e)),
  });

  // Le compteur unique n'apparaît que lorsque la migration l'a créé ; les séries en sommeil restent visibles.
  const grouped = useMemo(() => {
    const visible = rows.filter((r) => r.doc_type !== SINGLE_COUNTER_TYPE || !!overview);
    return NUMBERING_GROUPS
      .map((g) => ({ group: g, items: visible.filter((r) => groupOf(r.doc_type) === g).sort((a, b) => compareDocTypes(a.doc_type, b.doc_type)) }))
      .filter((g) => g.items.length > 0);
  }, [rows, overview]);

  if (!activeCompanyId) return null;

  return (
    <>
      <PageHeader
        title={t('settings.numbering')}
        description={t('settings.numberingDescLong')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> {t('settings.title')}</Button>}
      />

      <p className="mb-4 max-w-3xl text-[13px] text-muted-foreground">{t('numbering.intro')}</p>

      {!overviewQ.isLoading && !overview && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('numbering.migrationMissing')}
        </p>
      )}

      {overview && <ModeCard companyId={activeCompanyId} overview={overview} onDone={refresh} />}

      {(isLoading || overviewQ.isLoading) && <div className="grid place-items-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && !overviewQ.isLoading && (
        <>
          <p className="mb-3 max-w-3xl text-[12px] text-muted-foreground">{t('numbering.formatWarning')}</p>
          {grouped.map(({ group, items }) => (
            <section key={group} className="mb-5">
              <h2 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`numbering.groups.${group}`)}</h2>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse font-data text-[13px]">
                  <thead className="bg-muted">
                    <tr>
                      <Th>{t('settings.numColType')}</Th><Th>{t('settings.numColLabel')}</Th><Th className="w-24">{t('settings.numColPrefix')}</Th><Th className="w-16">{t('settings.numColSeparator')}</Th>
                      <Th className="w-20">{t('settings.numColPadding')}</Th><Th className="w-20 text-center">{t('settings.numColResetYearly')}</Th><Th className="w-24">{t('settings.numColSuffix')}</Th>
                      <Th>{t('settings.numColPreview')}</Th>
                      {overview && <Th className="w-32">{t('numbering.colNext')}</Th>}
                      {overview && <Th className="w-28">{t('numbering.colState')}</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => {
                      const dormant = !!overview && isDormant(r.doc_type, mode);
                      return (
                        <tr key={r.id} className={`border-b border-border align-top last:border-0 ${dormant ? 'bg-muted/40' : ''}`}>
                          <td className="px-2 py-1 font-mono text-[12px] font-bold">{r.doc_type}</td>
                          <td className="px-2 py-1">
                            <Input value={r.label} onChange={(e) => upd(r.id, { label: e.target.value })} className="h-8" />
                            {hasHelp(r.doc_type) && <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{t(`numbering.help.${r.doc_type}`)}</p>}
                            {dormant && (
                              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                                {t(isSharedSalesType(r.doc_type) ? 'numbering.dormantShared' : 'numbering.dormantSingle')}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-1"><Input value={r.prefix} onChange={(e) => upd(r.id, { prefix: e.target.value })} className="h-8 font-mono" /></td>
                          <td className="px-2 py-1"><Input value={r.separator} onChange={(e) => upd(r.id, { separator: e.target.value })} className="h-8 text-center font-mono" /></td>
                          <td className="px-2 py-1"><Input type="number" min={1} max={12} value={String(r.padding)} onChange={(e) => upd(r.id, { padding: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })} className="h-8 text-right tabular-nums" /></td>
                          <td className="px-2 py-1 text-center"><Checkbox checked={r.reset_yearly} onCheckedChange={(v) => upd(r.id, { reset_yearly: v === true })} /></td>
                          <td className="px-2 py-1"><Input value={r.suffix ?? ''} onChange={(e) => upd(r.id, { suffix: e.target.value || null })} className="h-8 font-mono" /></td>
                          <td className="px-2 py-1">
                            <span className={`inline-block whitespace-nowrap rounded bg-muted px-2 py-1 font-mono text-[12px] ${dormant ? 'text-muted-foreground line-through' : ''}`}>{previewNumber(r, year)}</span>
                          </td>
                          {overview && (
                            <td className="px-2 py-1">
                              <div className="flex items-center gap-2">
                                <span className="tabular-nums">{effectiveNextValue(r, year)}</span>
                                {canManage && (
                                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setAdjusting(r)} disabled={r._dirty}>
                                    <Hash className="size-3.5" /> {t('numbering.adjust')}
                                  </Button>
                                )}
                              </div>
                            </td>
                          )}
                          {overview && (
                            <td className="px-2 py-1">
                              {dormant
                                ? <StatusBadge tone="neutral" icon={Moon} label={t('numbering.dormant')} />
                                : <StatusBadge tone="success" label={t('numbering.active')} />}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {overview && (
            <section className="mb-5">
              <h2 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('numbering.otherTitle')}</h2>
              <div className="rounded-md border border-border px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold">{t('numbering.policeLabel')}</span>
                  {overview.police_register_next
                    ? <span className="rounded bg-muted px-2 py-1 font-mono text-[12px]">{overview.police_register_next}</span>
                    : <span className="text-muted-foreground">{t('numbering.policeNone')}</span>}
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">{t('numbering.policeHelp')}</p>
              </div>
            </section>
          )}
        </>
      )}

      {error && <p className="mt-3 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => { setError(null); save.mutate(); }} disabled={save.isPending || !rows.some((r) => r._dirty)}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('action.save')}
        </Button>
        {save.isSuccess && !save.isPending && <span className="flex items-center gap-1 text-[13px] text-success"><Check className="size-4" /> {t('settings.saved')}</span>}
      </div>

      <NextValueDialog row={adjusting} year={year} onClose={() => setAdjusting(null)} onDone={() => { setAdjusting(null); refresh(); }} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Mode de numérotation des ventes (séries séparées / compteur unique)
// ---------------------------------------------------------------------------------------------
function ModeCard({ companyId, overview, onDone }: { companyId: string; overview: NumberingOverview; onDone: () => void }) {
  const [choice, setChoice] = useState<SalesNumberingMode>(overview.sales_mode);
  const [pending, setPending] = useState<{ mode: SalesNumberingMode; fromNextYear: boolean } | null>(null);
  useEffect(() => { setChoice(overview.sales_mode); }, [overview.sales_mode]);

  const apply = useMutation({
    mutationFn: (p: { mode: SalesNumberingMode; fromNextYear: boolean }) => setSalesNumberingMode(companyId, p.mode, p.fromNextYear),
    onSuccess: () => { toast.success(t('numbering.modeSaved')); setPending(null); onDone(); },
    onError: (e) => { toast.error(errMsg(e)); setPending(null); },
  });

  const modeLabel = (m: SalesNumberingMode) => t(m === 'single' ? 'numbering.modeSingle' : 'numbering.modeSeparate');
  const changed = choice !== overview.sales_mode;
  const nextYear = overview.year + 1;
  const disabled = !overview.can_manage || apply.isPending;

  return (
    <section className="mb-6 rounded-md border border-border p-4">
      <h2 className="mb-1 font-ui text-[15px] font-bold">{t('numbering.modeTitle')}</h2>
      <RadioGroup value={choice} onValueChange={(v) => setChoice(v as SalesNumberingMode)} className="mt-3 gap-3" disabled={disabled}>
        {(['separate', 'single'] as const).map((m) => (
          <label key={m} htmlFor={`mode-${m}`} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
            <RadioGroupItem id={`mode-${m}`} value={m} className="mt-0.5" />
            <span className="flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{modeLabel(m)}</span>
                {overview.sales_mode === m && <StatusBadge tone="success" icon={ShieldCheck} label={t('numbering.modeCurrent')} />}
              </span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">{t(m === 'single' ? 'numbering.modeSingleDesc' : 'numbering.modeSeparateDesc')}</span>
            </span>
          </label>
        ))}
      </RadioGroup>

      {overview.next_sales_mode && overview.next_sales_mode_year && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <StatusBadge tone="info" icon={CalendarClock}
            label={fill(t('numbering.modeScheduled'), { mode: modeLabel(overview.next_sales_mode), year: overview.next_sales_mode_year })} />
          {overview.can_manage && (
            <Button size="sm" variant="outline" disabled={disabled}
              onClick={() => apply.mutate({ mode: overview.sales_mode, fromNextYear: true })}>
              {t('numbering.cancelSchedule')}
            </Button>
          )}
        </div>
      )}

      <p className={`mt-3 text-[12px] ${overview.can_change_now ? 'text-muted-foreground' : 'text-warning'}`}>
        {overview.can_change_now
          ? fill(t('numbering.canChangeNow'), { year: overview.year })
          : fill(t('numbering.cannotChangeNow'), { n: overview.numbered_this_year, year: overview.year, next: nextYear })}
      </p>

      {!overview.can_manage && <p className="mt-2 text-[12px] text-muted-foreground">{t('numbering.readOnly')}</p>}

      {overview.can_manage && changed && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={disabled || !overview.can_change_now} onClick={() => setPending({ mode: choice, fromNextYear: false })}>
            {t('numbering.applyNow')}
          </Button>
          <Button variant="outline" disabled={disabled} onClick={() => setPending({ mode: choice, fromNextYear: true })}>
            <CalendarClock /> {fill(t('numbering.scheduleNextYear'), { year: nextYear })}
          </Button>
        </div>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o && !apply.isPending) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('numbering.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending && fill(t(pending.fromNextYear ? 'numbering.confirmSchedule' : 'numbering.confirmNow'), {
                year: nextYear, target: t(pending.mode === 'single' ? 'numbering.targetSingle' : 'numbering.targetSeparate'),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apply.isPending}>{t('numbering.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={apply.isPending} onClick={(e) => { e.preventDefault(); if (pending) apply.mutate(pending); }}>
              {apply.isPending && <Loader2 className="animate-spin" />} {t('numbering.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Réglage du prochain numéro (vers le haut seulement, motif obligatoire, tracé)
// ---------------------------------------------------------------------------------------------
function NextValueDialog({ row, year, onClose, onDone }: { row: Row | null; year: number; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { setValue(''); setReason(''); }, [row?.id]);

  const save = useMutation({
    mutationFn: () => setSequenceNextValue(row!.id, Number(value), reason.trim()),
    onSuccess: () => { toast.success(t('numbering.nextSaved')); onDone(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (!row) return null;
  const current = effectiveNextValue(row, year);
  const requested = Number(value);
  const err = value === '' ? null : nextValueError(row, requested, reason, year);
  const errText = err === 'notInteger' ? t('numbering.errNotInteger')
    : err === 'notHigher' ? fill(t('numbering.errNotHigher'), { n: current })
    : err === 'tooBig' ? t('numbering.errTooBig')
    : err === 'reasonMissing' ? t('numbering.errReason') : null;
  const showPreview = value !== '' && err !== 'notInteger' && err !== 'notHigher' && err !== 'tooBig';
  const gap = showPreview ? skippedNumbers(row, requested, year) : 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fill(t('numbering.nextTitle'), { label: `${row.doc_type} (${row.label})` })}</DialogTitle>
          <DialogDescription>{t('numbering.nextIntro')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-[13px]">
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
            <span>{t('numbering.nextCurrent')}</span>
            <span className="font-mono tabular-nums">{previewNumber(row, year)}</span>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="next-value">{t('numbering.nextNew')}</Label>
            <Input id="next-value" type="number" min={current + 1} step={1} value={value} onChange={(e) => setValue(e.target.value)} className="tabular-nums" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="next-reason">{t('numbering.nextReason')}</Label>
            <Textarea id="next-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {showPreview && (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span>{t('numbering.nextPreview')}</span>
              <span className="font-mono tabular-nums">{formatNumber(row, year, requested)}</span>
            </div>
          )}
          {gap > 0 && <p className="rounded-md bg-warning-bg px-3 py-2 text-warning">{fill(t('numbering.nextGap'), { n: gap })}</p>}
          {errText && <p className="text-danger">{errText}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>{t('numbering.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || value === '' || !!err}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('numbering.saveNext')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-2 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
