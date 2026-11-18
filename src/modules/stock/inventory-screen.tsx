/**
 * M5 — Inventaire GUIDÉ (rattrapage G8 du 18/11/2026). Les 8 méthodes G8 (magasin ouvert /
 * fermé × effacement des stocks × édition des écarts) deviennent une check-list d'étapes
 * datées (date, heure, opérateur) avec retour arrière sur la dernière étape validée.
 * Chaque étape s'exécute en base (inventory_step_validate / inventory_step_rollback) :
 * photos datées, remise à zéro tracée, réajustement de l'arrêté (3 modes, B6),
 * réintégration unique (B4). Rien n'est jamais écrasé : tout est mouvement ou ligne ajoutée (B7).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileDown, Loader2, Play, Printer, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusBadge } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import { getOpenSession, type InventorySession } from './inventory-api';
import {
  getSessionSteps, validateStep, rollbackStep, startInventory, getSessionGaps, listCountRows, type SessionStep, type CountRow,
} from './g8-api';
import {
  methodSteps, methodCode, defaultMode, rollbackTarget, stepKind, isDangerousStep, type MethodFlags, type StepCode,
} from './inventory-rules';
import { ReadjustGrid } from './readjust-grid';
import { printSheet, printProcedure, fmtNum } from './print-sheets';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
const stepLabel = (s: string) => t(`stockG8.step.${s}`);
const methodLabel = (f: MethodFlags) => [
  f.open ? t('stockG8.method.open') : t('stockG8.method.closed'),
  f.erase ? t('stockG8.method.erase') : null,
  f.gaps ? t('stockG8.method.gaps') : null,
].filter(Boolean).join(' · ');
const nowLabel = () => fillVars(t('stockG8.sheet.printedOn'), { date: new Date().toLocaleString('fr-BE') });

function doPrintProcedure(f: MethodFlags) {
  printProcedure(t('stockG8.sheet.procedureTitle'), methodLabel(f), methodSteps(f).map((s) => ({ label: stepLabel(s), help: t(`stockG8.stepHelp.${s}`) })), {
    no: t('stockG8.steps.colNo'), step: t('stockG8.steps.colStep'), help: t('stockG8.steps.colResult'), done: t('stockG8.steps.done'),
  });
}

export function InventoryScreen({ companyId }: { companyId: string }) {
  const { data: session, isLoading } = useQuery({ queryKey: ['inv-session', companyId], queryFn: () => getOpenSession(companyId) });
  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  return session ? <GuidedSession companyId={companyId} session={session} /> : <MethodForm companyId={companyId} />;
}

function MethodForm({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState<MethodFlags>({ open: true, erase: false, gaps: true });
  const [keep, setKeep] = useState(true);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const steps = methodSteps(f);
  const start = async () => {
    setBusy(true);
    try {
      await startInventory(companyId, { ...f, keepVehicles: keep, label });
      toast.success(t('stockG8.method.started'));
      qc.invalidateQueries({ queryKey: ['inv-session', companyId] });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4 rounded-md border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">{t('stockG8.method.none')}</p>
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((open) => (
            <button key={String(open)} type="button" onClick={() => setF((p) => ({ ...p, open }))}
              className={`rounded-md border p-3 text-left text-sm ${f.open === open ? 'border-primary bg-muted' : 'border-border'}`}>
              <b>{open ? t('stockG8.method.open') : t('stockG8.method.closed')}</b>
              <span className="mt-1 block text-[12px] text-muted-foreground">{open ? t('stockG8.method.openHelp') : t('stockG8.method.closedHelp')}</span>
            </button>
          ))}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={f.erase} onCheckedChange={(v) => setF((p) => ({ ...p, erase: v === true }))} />
          <span>{t('stockG8.method.erase')}<span className="block text-[12px] text-muted-foreground">{t('stockG8.method.eraseHelp')}</span></span>
        </label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.gaps} onCheckedChange={(v) => setF((p) => ({ ...p, gaps: v === true }))} /> {t('stockG8.method.gaps')}</label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} /> {t('stockG8.method.keepVehicles')}</label>
        <div className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('stockG8.method.label')}</span>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <p className="text-[12px] text-muted-foreground">{t('stockG8.method.allStocked')}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={start} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Play />} {t('stockG8.method.start')}</Button>
          <Button variant="outline" onClick={() => doPrintProcedure(f)}><FileDown /> {t('stockG8.method.printProcedure')}</Button>
        </div>
      </div>
      <div className="rounded-md border border-border bg-card p-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('stockG8.method.preview')} — {methodCode(f)}</p>
        <ol className="space-y-1.5 text-sm">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-2">
              <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
              <span><b>{stepLabel(s)}</b><span className="block text-[12px] text-muted-foreground">{t(`stockG8.stepHelp.${s}`)}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function resultText(d: Record<string, unknown> | null | undefined): string {
  if (!d) return '';
  if (d.moves != null) return fillVars(t('stockG8.steps.resultMoves'), { n: Number(d.moves) });
  if (d.lines != null) return fillVars(t('stockG8.steps.resultLines'), { n: Number(d.lines) });
  if (d.snapshot_id) return t('stockG8.steps.resultPhoto');
  return '';
}

function GuidedSession({ companyId, session }: { companyId: string; session: InventorySession }) {
  const qc = useQueryClient();
  const flags: MethodFlags = { open: session.magasin_ouvert, erase: session.effacement, gaps: session.edition_ecarts };
  const stepsQ = useQuery({ queryKey: ['inv-steps', session.id], queryFn: () => getSessionSteps(session.id) });
  const steps = useMemo(() => stepsQ.data ?? [], [stepsQ.data]);
  const validated = useMemo(() => new Set(steps.filter((s) => s.validated).map((s) => s.step_code)), [steps]);
  const back = rollbackTarget(methodSteps(flags), validated);
  const next = steps.find((s) => s.is_next) ?? null;
  const [confirm, setConfirm] = useState<{ kind: 'validate' | 'back'; step: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['inv-steps', session.id] });
    qc.invalidateQueries({ queryKey: ['inv-session', companyId] });
    qc.invalidateQueries({ queryKey: ['inv-gaps', session.id] });
    qc.invalidateQueries({ queryKey: ['count-list', companyId] });
    qc.invalidateQueries({ queryKey: ['stock', companyId] });
  };

  const run = async (kind: 'validate' | 'back', step: string) => {
    setBusy(true);
    try {
      if (kind === 'validate') {
        await validateStep(session.id, step);
        toast.success(step === 'fin' ? t('stockG8.steps.closed') : fillVars(t('stockG8.steps.validated'), { step: stepLabel(step) }));
      } else {
        const s = await rollbackStep(session.id);
        toast.success(fillVars(t('stockG8.steps.rolledBack'), { step: stepLabel(s) }));
      }
      refresh();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); setConfirm(null); }
  };

  const onValidate = (s: SessionStep) => {
    if (isDangerousStep(s.step_code as StepCode) || s.step_code === 'fin') setConfirm({ kind: 'validate', step: s.step_code });
    else run('validate', s.step_code);
  };

  const snapshotId = session.snapshot_id;
  const countingOpen = !!snapshotId && validated.has('generation_arrete') && !validated.has(flags.open ? 'reintegration' : 'sauvegarde_finale');
  const gapsQ = useQuery({ queryKey: ['inv-gaps', session.id], queryFn: () => getSessionGaps(session.id), enabled: !!snapshotId && flags.gaps });

  const printArrete = async (final: boolean) => {
    if (!snapshotId) return;
    try {
      const rows: CountRow[] = [];
      for (let offset = 0; offset < 20000; offset += 1000) {
        const page = await listCountRows(companyId, { snapshotId, scope: 'stock', limit: 1000, offset });
        rows.push(...page);
        if (page.length < 1000) break;
      }
      printSheet({
        title: `${stepLabel(final ? 'edition_arrete_final' : 'edition_arrete_initial')} — ${session.label ?? ''}`,
        subtitle: methodLabel(flags), printedOn: nowLabel(),
        columns: [
          { label: t('stockG8.count.colRef') }, { label: t('stockG8.count.colDesignation') }, { label: t('stockG8.count.colBin') },
          { label: final ? t('stockG8.count.colAdjusted') : t('stockG8.count.colInitial'), align: 'right' },
          { label: final ? t('stockG8.count.colStatus') : t('stockG8.sheet.countCol'), blank: !final },
        ],
        groups: [{ title: null, rows: rows.map((r) => [
          r.reference, r.designation, [r.bin_location, r.bin_location2].filter(Boolean).join(' / '),
          fmtNum(final ? r.adjusted_qty : r.snapshot_qty),
          final ? (r.counted ? t('stockG8.count.counted') : t('stockG8.count.notCounted')) : '',
        ]) }],
      });
    } catch (e) { toast.error(errMsg(e)); }
  };

  const gaps = gapsQ.data ?? [];
  const gapTotal = gaps.reduce((s, g) => s + g.gap_value, 0);
  const printGaps = () => printSheet({
    title: t('stockG8.gaps.title'), subtitle: methodLabel(flags), printedOn: nowLabel(),
    columns: [
      { label: t('stockG8.count.colRef') }, { label: t('stockG8.count.colDesignation') }, { label: t('stockG8.count.colBin') },
      { label: t('stockG8.gaps.colInitial'), align: 'right' }, { label: t('stockG8.gaps.colCounted'), align: 'right' },
      { label: t('stockG8.gaps.colGap'), align: 'right' }, { label: t('stockG8.gaps.colValue'), align: 'right' },
    ],
    groups: [{ title: null, rows: gaps.map((g) => [g.reference, g.designation, g.bin_location ?? '', fmtNum(g.initial_qty), fmtNum(g.counted_qty), fmtNum(g.gap_qty), eur(g.gap_value)]) }],
    total: [t('stockG8.gaps.total'), '', '', '', '', '', eur(gapTotal)],
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
        <StatusBadge tone="info" label={t('stockG8.method.current')} />
        <span className="text-sm font-semibold">{methodLabel(flags)}</span>
        {session.label && <span className="text-sm text-muted-foreground">— {session.label}</span>}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => doPrintProcedure(flags)}><FileDown className="size-4" /> {t('stockG8.method.printProcedure')}</Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('stockG8.steps.colNo')}</Th><Th>{t('stockG8.steps.colStep')}</Th><Th>{t('stockG8.steps.colDate')}</Th>
              <Th>{t('stockG8.steps.colTime')}</Th><Th>{t('stockG8.steps.colOperator')}</Th><Th>{t('stockG8.steps.colResult')}</Th><Th />
            </tr>
          </thead>
          <tbody>
            {stepsQ.isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {steps.map((s) => {
              const at = s.validated_at ? new Date(s.validated_at) : null;
              return (
                <tr key={s.step_code} className={`border-b border-border last:border-0 ${s.is_next ? 'bg-muted/60' : ''}`}>
                  <td className="px-3 py-1.5 tabular-nums">{s.step_no}</td>
                  <td className="px-3 py-1.5">
                    <b>{stepLabel(s.step_code)}</b>
                    {s.is_next && <span className="block text-[12px] text-muted-foreground">{t(`stockG8.stepHelp.${s.step_code}`)}</span>}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{at ? at.toLocaleDateString('fr-BE') : ''}</td>
                  <td className="px-3 py-1.5 tabular-nums">{at ? at.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : ''}</td>
                  <td className="px-3 py-1.5">{s.operator_name ?? ''}</td>
                  <td className="px-3 py-1.5">
                    {s.validated ? <StatusBadge tone="success" label={t('stockG8.steps.done')} />
                      : s.is_next ? <StatusBadge tone="warning" label={t('stockG8.steps.todo')} />
                      : <StatusBadge tone="neutral" label={t('stockG8.steps.waiting')} />}
                    <span className="ml-2 text-[12px] text-muted-foreground">{resultText(s.detail)}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    {s.is_next && (
                      <Button size="sm" onClick={() => onValidate(s)} disabled={busy}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {t('stockG8.steps.validate')}
                      </Button>
                    )}
                    {back === s.step_code && (
                      <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: 'back', step: s.step_code })} disabled={busy}>
                        <Undo2 className="size-4" /> {t('stockG8.steps.back')}
                      </Button>
                    )}
                    {s.step_code === 'reintegration' && s.validated && <span className="text-[12px] text-muted-foreground">{t('stockG8.steps.definitive')}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {snapshotId && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => printArrete(false)}><Printer /> {t('stockG8.sheet.printInitial')}</Button>
          {flags.open && <Button variant="outline" onClick={() => printArrete(true)}><Printer /> {t('stockG8.sheet.printFinal')}</Button>}
          {flags.gaps && <Button variant="outline" onClick={printGaps}><Printer /> {t('stockG8.gaps.print')}</Button>}
        </div>
      )}

      {countingOpen && next && (stepKind(next.step_code as StepCode) === 'saisie' || next.step_code.startsWith('edition')) && (
        <div className="rounded-md border border-border bg-card p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
            {t('stockG8.count.title')} — {flags.open ? t('stockG8.count.target_arrete') : t('stockG8.count.target_reel')}
          </p>
          <ReadjustGrid
            companyId={companyId}
            target={flags.open ? { kind: 'arrete', snapshotId: snapshotId! } : { kind: 'reel', ref: session.id }}
            defaultMode={defaultMode(flags)}
            onApplied={() => qc.invalidateQueries({ queryKey: ['inv-gaps', session.id] })}
          />
        </div>
      )}

      {flags.gaps && snapshotId && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('stockG8.gaps.title')}</p>
          <div className="max-h-[40vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <Th>{t('stockG8.count.colRef')}</Th><Th>{t('stockG8.count.colDesignation')}</Th>
                  <Th right>{t('stockG8.gaps.colInitial')}</Th><Th right>{t('stockG8.gaps.colCounted')}</Th>
                  <Th right>{t('stockG8.gaps.colGap')}</Th><Th right>{t('stockG8.gaps.colValue')}</Th>
                </tr>
              </thead>
              <tbody>
                {gaps.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">{t('stockG8.gaps.empty')}</td></tr>}
                {gaps.map((g) => (
                  <tr key={g.article_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[12px]">{g.reference}</td>
                    <td className="px-3 py-1.5">{g.designation}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{g.initial_qty}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{g.counted_qty}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${g.gap_qty < 0 ? 'text-danger' : ''}`}>{g.gap_qty > 0 ? '+' : ''}{g.gap_qty}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{eur(g.gap_value)}</td>
                  </tr>
                ))}
              </tbody>
              {gaps.length > 0 && (
                <tfoot><tr className="bg-muted font-semibold"><td colSpan={5} className="px-3 py-1.5">{t('stockG8.gaps.total')}</td><td className="px-3 py-1.5 text-right tabular-nums">{eur(gapTotal)}</td></tr></tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'back'
                ? fillVars(t('stockG8.steps.confirmBack'), { step: confirm ? stepLabel(confirm.step) : '' })
                : fillVars(t('stockG8.steps.confirmTitle'), { step: confirm ? stepLabel(confirm.step) : '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? t(`stockG8.stepHelp.${confirm.step}`) : ''}
              {confirm?.kind === 'validate' && isDangerousStep(confirm.step as StepCode) && <span className="mt-2 block font-semibold">{t('stockG8.steps.confirmDanger')}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('stockG8.steps.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && run(confirm.kind, confirm.step)}>{t('stockG8.steps.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
