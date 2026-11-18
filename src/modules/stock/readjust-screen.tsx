/**
 * M5 — Gestion du stock réel et Gestion d'arrêté (G8) : réajustement en 3 modes (B6) sur le
 * stock réel ou sur un arrêté, génération / réintégration d'un arrêté hors inventaire, remise
 * à zéro du stock (positifs et négatifs, ou négatifs seuls) avec confirmation forte.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Eraser, Loader2, RotateCcw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { t, fillVars } from '@/lib/i18n';
import { ReadjustGrid } from './readjust-grid';
import { listSnapshots, generatePhoto, reintegrateStandalone, resetRealStock } from './g8-api';
import { RESET_CONFIRM_PHRASE } from './inventory-rules';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

export function ReadjustScreen({ companyId }: { companyId: string }) {
  return (
    <Tabs defaultValue="reel">
      <TabsList>
        <TabsTrigger value="reel">{t('stockG8.readjust.tabReal')}</TabsTrigger>
        <TabsTrigger value="arrete">{t('stockG8.readjust.tabArrete')}</TabsTrigger>
        <TabsTrigger value="raz">{t('stockG8.readjust.tabReset')}</TabsTrigger>
      </TabsList>
      <TabsContent value="reel" className="pt-3"><ReadjustGrid companyId={companyId} target={{ kind: 'reel' }} /></TabsContent>
      <TabsContent value="arrete" className="pt-3"><ArreteTab companyId={companyId} /></TabsContent>
      <TabsContent value="raz" className="pt-3"><ResetTab companyId={companyId} /></TabsContent>
    </Tabs>
  );
}

function ArreteTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const snapsQ = useQuery({ queryKey: ['stock-snapshots', companyId], queryFn: () => listSnapshots(companyId) });
  const open = useMemo(() => (snapsQ.data ?? []).filter((s) => s.kind === 'arrete' && s.status === 'actif' && !s.reintegrated), [snapsQ.data]);
  const [picked, setPicked] = useState<string>('');
  const current = open.find((s) => s.id === picked) ?? open[0] ?? null;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const id = await generatePhoto(companyId, 'arrete');
      toast.success(t('stockG8.readjust.arreteCreated'));
      await qc.invalidateQueries({ queryKey: ['stock-snapshots', companyId] });
      setPicked(id);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const reintegrate = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const nMoves = await reintegrateStandalone(current.id);
      toast.success(fillVars(t('stockG8.readjust.reintegrated'), { n: nMoves }));
      qc.invalidateQueries({ queryKey: ['stock-snapshots', companyId] });
      qc.invalidateQueries({ queryKey: ['stock', companyId] });
      qc.invalidateQueries({ queryKey: ['count-list', companyId] });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); setConfirm(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('stockG8.readjust.pickArrete')}</span>
          <Select value={current?.id ?? ''} onValueChange={setPicked}>
            <SelectTrigger className="w-96"><SelectValue placeholder={t('stockG8.readjust.noArrete')} /></SelectTrigger>
            <SelectContent>
              {open.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label ?? ''} — {new Date(s.created_at).toLocaleString('fr-BE')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={create} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Camera />} {t('stockG8.readjust.newArrete')}</Button>
        {current && !current.session_id && (
          <Button variant="outline" onClick={() => setConfirm(true)} disabled={busy}><RotateCcw /> {t('stockG8.readjust.reintegrate')}</Button>
        )}
      </div>
      {current?.session_id && <p className="text-[12px] text-muted-foreground">{t('stockG8.readjust.inSession')}</p>}
      {!snapsQ.isLoading && !current && <p className="text-sm text-muted-foreground">{t('stockG8.readjust.noArrete')}</p>}
      {current && <ReadjustGrid key={current.id} companyId={companyId} target={{ kind: 'arrete', snapshotId: current.id }} />}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('stockG8.readjust.reintegrate')}</AlertDialogTitle>
            <AlertDialogDescription>{t('stockG8.readjust.reintegrateConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('stockG8.steps.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={reintegrate}>{t('stockG8.steps.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ResetTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'tous' | 'negatifs'>('negatifs');
  const [keep, setKeep] = useState(true);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await resetRealStock(companyId, scope, keep, phrase.trim().toUpperCase());
      toast.success(fillVars(t('stockG8.readjust.resetDone'), { n: r.moves, ref: r.ref }));
      setPhrase('');
      qc.invalidateQueries({ queryKey: ['stock', companyId] });
      qc.invalidateQueries({ queryKey: ['count-list', companyId] });
      qc.invalidateQueries({ queryKey: ['stock-snapshots', companyId] });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-xl space-y-4 rounded-md border border-border bg-card p-4">
      <p className="flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {t('stockG8.readjust.resetWarn')}
      </p>
      <div className="space-y-2">
        {(['negatifs', 'tous'] as const).map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm">
            <input type="radio" name="raz-scope" checked={scope === s} onChange={() => setScope(s)} className="size-4 accent-[var(--ducati-red)]" />
            {t(`stockG8.readjust.resetScope_${s}`)}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} /> {t('stockG8.method.keepVehicles')}</label>
      <div className="space-y-1">
        <span className="block text-[12px] text-muted-foreground">{fillVars(t('stockG8.readjust.resetType'), { phrase: RESET_CONFIRM_PHRASE })}</span>
        <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} className="w-64 font-mono" />
      </div>
      <Button variant="destructive" onClick={go} disabled={busy || phrase.trim().toUpperCase() !== RESET_CONFIRM_PHRASE}>
        {busy ? <Loader2 className="animate-spin" /> : <Eraser />} {t('stockG8.readjust.resetGo')}
      </Button>
    </div>
  );
}
