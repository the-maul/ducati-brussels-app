/**
 * M6 (POS) — Écran Caisse : ouverture (fond), mouvements de fond de caisse,
 * rapport X de la session (encaissements par mode, ventilation TVA, remises, remboursements,
 * ventes > 500 EUR), clôture avec calcul monnaie, motif d'écart obligatoire et journal Z
 * numéroté, figé, archivé en PDF dans la GED (PDV010, 03/11/2026).
 * Réf. G8 Facturation p.128-131, p.164-179. Libellés via i18n.
 * Rattrapage G8 (18/11/2026) : fond proposé à l'ouverture (report de la remise en banque), mouvements
 * typés avec confirmation (Paramètres → Tables → Types de mouvement de caisse), grille de calcul monnaie
 * partagée (`cash-count.tsx`), avertissement « caisse ouverte depuis la veille » (jamais bloquant).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Lock, Wallet, AlertTriangle, FileDown, CheckCircle2, ArrowLeft, ArrowRight } from 'lucide-react';
import { useReadOnly } from '@/lib/auth/read-only-context';
import { formatEur } from '@/lib/format-eur';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  getOpenSession, listSessions, openSession, closeSession, listSessionMovements, getSessionReport,
  frozenZ, archiveZPdf, type CashSession,
} from './cash-api';
import { listPaymentMethods } from './write-api';
import { getDrawerBalance, listMovementTypes, addTypedMovement, listDepositCandidates } from './cash-deposit-api';
import { CashCountGrid, countTotal } from './cash-count';
import { expectedCash, cashVariance, varianceReasonMissing } from './cash-rules';
import { closeOrderTrail, depositCashOut, depositProgress, drawerChangeSinceCount, methodsToCheck, type CloseOrderStep } from './cash-close-order';
import { CashDepositsScreen } from './cash-deposits-screen';
import { StepTrail } from './step-trail';
import type { ZReport } from './z-report';
import { buildZPdf, openPdfBytes } from './z-report-pdf';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { toast } from 'sonner';
import { ZReportView } from './z-report-view';

// Revue UX (20/11) : séparateur de milliers (« 1 027,00 € »), formateur unique.
const eur = formatEur;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function CashScreen({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { data: session, isLoading } = useQuery({ queryKey: ['cash-session', companyId], queryFn: () => getOpenSession(companyId) });
  const { data: sessions } = useQuery({ queryKey: ['cash-sessions', companyId], queryFn: () => listSessions(companyId) });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {session ? <OpenSession companyId={companyId} companyName={companyName} session={session} /> : <OpenForm companyId={companyId} />}
      {sessions && sessions.length > 0 && <PastSessions sessions={sessions} />}
    </div>
  );
}

/* ---------------- Ouverture ---------------- */
// Fond proposé = espèces du tiroir (report de la dernière remise en banque + espèces non remises, G8).
// Un fond saisi différent reste possible (jamais bloquant) : l'écart devient une ligne de la remise suivante.
function OpenForm({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { data: proposed } = useQuery({ queryKey: ['cash-drawer-balance', companyId], queryFn: () => getDrawerBalance(companyId) });
  const [float, setFloat] = useState<string | null>(null);
  // Fond proposé à 0 : champ vide (placeholder) — sinon taper « 100 » devant le « 0 » donnait 1000 €.
  const value = float ?? (proposed != null && proposed !== 0 ? String(proposed) : '');
  const [note, setNote] = useState('');
  const gap = proposed != null && value.trim() !== '' ? Math.round((num(value) - proposed) * 100) / 100 : 0;
  const open = useMutation({
    mutationFn: () => openSession(companyId, num(value), note || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-session', companyId] }); qc.invalidateQueries({ queryKey: ['cash-sessions', companyId] });
      qc.invalidateQueries({ queryKey: ['cash-drawer-balance', companyId] });
    },
  });
  return (
    <div className="max-w-md space-y-3 rounded-md border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-bold"><Wallet className="size-4" /> {t('cash.noSession')}</p>
      <div className="space-y-1"><Label>{t('cash.openingFloat')}</Label><Input type="number" step="0.01" value={value} onChange={(e) => setFloat(e.target.value)} onFocus={(e) => e.currentTarget.select()} className="text-right tabular-nums" placeholder="0,00" /></div>
      {proposed != null && <p className="font-data text-[12px] tabular-nums text-muted-foreground">{t('cash.proposedFloat')} : <b>{eur(proposed)}</b></p>}
      {gap !== 0 && (
        <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {fillVars(t('cash.floatGap'), { gap: `${gap > 0 ? '+' : '−'} ${eur(Math.abs(gap))}` })}
        </p>
      )}
      <div className="space-y-1"><Label>{gap !== 0 ? t('cash.floatGapNote') : t('cash.note')}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {open.isError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(open.error)}</p>}
      <Button onClick={() => open.mutate()} disabled={open.isPending}>{open.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('cash.open')}</Button>
    </div>
  );
}

/* ---------------- Session ouverte ---------------- */
function OpenSession({ companyId, companyName, session }: { companyId: string; companyName: string; session: CashSession }) {
  const qc = useQueryClient();
  const { data: methods } = useQuery({ queryKey: ['pay-methods', companyId], queryFn: () => listPaymentMethods(companyId) });
  // Borne haute recalculée à chaque lecture : figée au montage, un mouvement saisi ensuite (sortie
  // de 10 € pour consommables) restait hors des espèces théoriques jusqu'au rechargement de la page.
  const { data: movements } = useQuery({ queryKey: ['cash-mov', session.id], queryFn: () => listSessionMovements(companyId, session.opened_at, new Date(Date.now() + 60_000).toISOString()) });
  // Rapport X : calculé sur la session (tickets et règlements rattachés), non numéroté.
  const { data: z } = useQuery({ queryKey: ['cash-z', session.id], queryFn: () => getSessionReport(session) });
  const [closed, setClosed] = useState<CashSession | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cash-mov', session.id] });
    qc.invalidateQueries({ queryKey: ['cash-z', session.id] });
  };

  // Espèces théoriques du tiroir : fond + règlements ESP + entrées − sorties **en espèces** seulement
  // (un mouvement saisi en carte ou virement ne passe pas par le tiroir ; audit caisse du 03/11/2026).
  const theoreticalCash = expectedCash(Number(session.opening_float), z, movements ?? []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone="success" label={t('cash.statusOpen')} />
        <span className="font-data text-sm text-muted-foreground">{t('cash.openedAt')} {new Date(session.opened_at).toLocaleString('fr-BE')}</span>
        <span className="font-data text-sm tabular-nums">{t('cash.openingFloat')} : <b>{eur(Number(session.opening_float))}</b></span>
      </div>

      {/* Caisse oubliée la veille (décision Q31) : jamais bloquant, on dit quoi faire. */}
      {new Date(session.opened_at).toDateString() !== new Date().toDateString() && (
        <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {fillVars(t('cash.staleSession'), { date: new Date(session.opened_at).toLocaleString('fr-BE') })}
        </p>
      )}

      <MovementPanel companyId={companyId} sessionId={session.id} methods={methods ?? []} movements={(movements ?? []) as MovementRow[]} onChanged={refresh} />

      {z && <ZPanel z={z} />}

      <ClosePanel companyId={companyId} companyName={companyName} session={session} theoreticalCash={theoreticalCash} z={z} movements={movements as MovementRow[] | undefined} methods={methods ?? []} onClosed={setClosed} />
      {closed && <ClosedDialog session={closed} onDone={() => { setClosed(null); qc.invalidateQueries({ queryKey: ['cash-session', companyId] }); qc.invalidateQueries({ queryKey: ['cash-sessions', companyId] }); qc.invalidateQueries({ queryKey: ['cash-closures', companyId] }); }} />}
    </div>
  );
}

/* ---------------- Après clôture : numéro du Z, PDF archivé ---------------- */
function ClosedDialog({ session, onDone }: { session: CashSession; onDone: () => void }) {
  const z = frozenZ(session);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const openZ = async () => {
    if (!z) return;
    try { openPdfBytes(await buildZPdf(z)); } catch (e) { setPdfError(errorMessage(e)); }
  };
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onDone(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-success" /> {session.z_number ? fillVars(t('cash.closedTitle'), { number: session.z_number }) : t('cash.closedTitleNoZ')}</AlertDialogTitle>
          <AlertDialogDescription>{z ? t('cash.closedBody') : t('cash.closedBodyNoZ')}</AlertDialogDescription>
        </AlertDialogHeader>
        {pdfError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{pdfError}</p>}
        <AlertDialogFooter>
          {z && <Button variant="outline" onClick={openZ}><FileDown /> {t('cash.openZPdf')}</Button>}
          <AlertDialogAction onClick={onDone}>{t('cash.done')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ---------------- Mouvements de fond de caisse ---------------- */
// G8 « Mouvement de caisse » : type (Paramètres → Tables → Types de mouvement de caisse), mode, commentaire,
// montant, confirmation « Confirmez-vous une sortie d'argent en ESPÈCES de 10,00 € ? ». Le type fixe le sens,
// la TVA comprise (achat de consommables 21 %) et le compte. Sans types (migration du 18/11 non posée) :
// entrée / sortie avec motif libre, comme avant.
type MovementRow = { id: string; kind: string; method: string; amount: number; reason: string | null; occurred_at: string; movement_no?: number | null; type_code?: string | null; vat_amount?: number | null; deposit_id?: string | null };
function MovementPanel({ companyId, sessionId, methods, movements, onChanged }: {
  companyId: string; sessionId: string; methods: { code: string; label: string }[];
  movements: MovementRow[]; onChanged: () => void;
}) {
  const { data: allTypes } = useQuery({ queryKey: ['cash-movement-types', companyId], queryFn: () => listMovementTypes(companyId) });
  const types = (allTypes ?? []).filter((x) => !x.system);
  const [typeCode, setTypeCode] = useState('');
  const type = types.find((x) => x.code === typeCode) ?? null;
  const [kindChoice, setKind] = useState<'in' | 'out'>('out');
  const kind: 'in' | 'out' = type && type.direction !== 'both' ? type.direction : kindChoice;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('ESP');
  const [reason, setReason] = useState('');
  const [ask, setAsk] = useState(false);
  const methodLabel = (code: string) => methods.find((m) => m.code === code)?.label ?? code;
  const typeLabel = (code: string | null | undefined) => (code ? (allTypes ?? []).find((x) => x.code === code)?.label ?? code : '');
  const vat = type?.vatRate ? Math.round(num(amount) * type.vatRate / (100 + type.vatRate) * 100) / 100 : 0;
  const needType = types.length > 0 && !type;
  // Bouton en contour : la garde « lecture seule » du bouton principal ne s'applique plus d'elle-même.
  const readOnly = useReadOnly();
  const add = useMutation({
    mutationFn: () => addTypedMovement(companyId, sessionId, { kind, amount: num(amount), method, reason: reason.trim() || (type?.label ?? ''), typeCode: type?.code ?? null }),
    onSuccess: () => { setAmount(''); setReason(''); setAsk(false); onChanged(); },
  });
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.movements')}</p>
      <div className="flex flex-wrap items-end gap-2">
        {types.length > 0 && (
          <div className="space-y-1"><Label>{t('cash.movementType')}</Label>
            <Select value={typeCode} onValueChange={setTypeCode}>
              <SelectTrigger className="w-64"><SelectValue placeholder={t('cash.movementTypePick')} /></SelectTrigger>
              <SelectContent>{types.map((x) => <SelectItem key={x.code} value={x.code}>{x.code} - {x.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1"><Label>{t('cash.direction')}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as 'in' | 'out')} disabled={!!type && type.direction !== 'both'}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="in">{t('cash.in')}</SelectItem><SelectItem value="out">{t('cash.out')}</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>{t('cash.amount')}</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 text-right tabular-nums" /></div>
        <div className="space-y-1"><Label>{t('cash.method')}</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{methods.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex-1 space-y-1"><Label>{types.length > 0 ? t('cash.comment') : t('cash.reason')}</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <Button variant="outline" onClick={() => { add.reset(); setAsk(true); }} disabled={readOnly || add.isPending || num(amount) <= 0 || needType}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('cash.add')}</Button>
      </div>
      {vat > 0 && <p className="font-data text-[12px] tabular-nums text-muted-foreground">{fillVars(t('cash.movementVat'), { rate: type?.vatRate ?? 0, vat: eur(vat) })}</p>}
      {movements.length > 0 && (
        <table className="w-full border-collapse font-data text-[13px]">
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="py-1.5 tabular-nums text-muted-foreground">{m.movement_no ?? ''}</td>
                <td className="py-1.5">{new Date(m.occurred_at).toLocaleString('fr-BE')}</td>
                <td className="py-1.5"><StatusBadge tone={m.kind === 'in' ? 'success' : 'warning'} label={m.kind === 'in' ? t('cash.in') : t('cash.out')} /></td>
                <td className="py-1.5">{typeLabel(m.type_code)}</td>
                <td className="py-1.5">{methodLabel(m.method)}</td>
                <td className="py-1.5">{m.reason}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">{m.vat_amount ? `${t('cash.vatShort')} ${eur(Number(m.vat_amount))}` : ''}</td>
                <td className="py-1.5 text-right tabular-nums">{m.kind === 'in' ? '+' : '−'} {eur(Number(m.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AlertDialog open={ask} onOpenChange={(o) => { if (!add.isPending) setAsk(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cash.movementConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {fillVars(t(kind === 'in' ? 'cash.movementConfirmIn' : 'cash.movementConfirmOut'), { method: methodLabel(method), amount: eur(num(amount)) })}
              {type ? ` (${type.code} - ${type.label})` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {add.isError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(add.error)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={add.isPending}>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); add.mutate(); }} disabled={add.isPending}>{add.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t('cash.movementConfirmDo')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------- Rapport X de la session ouverte ---------------- */
function ZPanel({ z }: { z: ZReport }) {
  return <ZReportView z={z} />;
}

/* ---------------- Clôture dans l'ordre : comptage → remise en banque → clôture Z ---------------- */
// Chantier C6 (CAI-06, 23/11/2026). Décision Q31 : « les deux, sans blocage » : le fil guide et prévient,
// toutes ses étapes restent cliquables, et le Z reste possible sans remise après confirmation.
// Calculs inchangés : espèces théoriques (`expectedCash`), écart (`cashVariance`), motif obligatoire
// (`varianceReasonMissing`), clôture et Z figé. L'écart se lit après la remise, car une remise caisse
// ouverte fait baisser le théorique : la grille est alors corrigée avant de clôturer.
function ClosePanel({ companyId, companyName, session, theoreticalCash, z, movements, methods, onClosed }: {
  companyId: string; companyName: string; session: CashSession; theoreticalCash: number; z: ZReport | undefined;
  movements: MovementRow[] | undefined; methods: { code: string; label: string }[]; onClosed: (s: CashSession) => void;
}) {
  const sessionId = session.id;
  const [step, setStep] = useState<CloseOrderStep>('count');
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [outAtCount, setOutAtCount] = useState<number | null>(null);
  const [skipAsk, setSkipAsk] = useState(false);
  const [showForm, setShowForm] = useState<boolean | null>(null);
  const { total: counted, denominations: denoms } = countTotal(qtys);
  const variance = cashVariance(counted, theoreticalCash);
  const hasVariance = Math.abs(variance) > 0.004;
  const [reason, setReason] = useState('');
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Un écart (compté ≠ théorique) se motive avant la clôture (PDV010) ; la base le refuse aussi.
  const reasonMissing = varianceReasonMissing(variance, reason);

  // État de la remise pour cette caisse. La clé commence par « cash-deposit-candidates » : créer, modifier
  // ou annuler une remise la rafraîchit. Si le contrôle échoue, on ne prévient pas à tort et rien ne bloque.
  const codes = methodsToCheck((z?.payments_by_method ?? []).map((p) => p.method), (movements ?? []).map((m) => m.method));
  const linesQ = useQuery({
    queryKey: ['cash-deposit-candidates', 'close-order', companyId, sessionId, codes.join(',')],
    queryFn: async () => (await Promise.all(codes.map(async (method) => {
      const rows = await listDepositCandidates(companyId, method, session.opened_at, new Date(Date.now() + 60_000).toISOString(), true);
      return rows.map((r) => ({ method, source_type: r.source_type, amount: r.amount, deposit_id: r.deposit_id }));
    }))).flat(),
    enabled: step !== 'count' && !!z && !!movements,
    retry: false,
  });
  const progress = linesQ.data ? depositProgress(linesQ.data) : null;
  const depositPending = progress?.state === 'pending';
  const methodLabel = (code: string) => methods.find((m) => m.code === code)?.label ?? code;

  const drawerChange = drawerChangeSinceCount(outAtCount, movements ?? []);
  const needsRecount = drawerChange !== 0;
  const goTo = (next: CloseOrderStep) => {
    // Quitter le comptage fixe sa référence : une remise faite ensuite sera détectée.
    if (step === 'count' && next !== 'count') setOutAtCount(depositCashOut(movements ?? []));
    setSkipAsk(false);
    setStep(next);
  };
  const trail = closeOrderTrail(step, { counted: outAtCount != null, deposit: progress?.state ?? null })
    .map((s) => ({ ...s, label: t(`clotureCaisse.step${s.key === 'count' ? 'Count' : s.key === 'deposit' ? 'Deposit' : 'Z'}`) }));
  const stepNumber = step === 'count' ? 1 : step === 'deposit' ? 2 : 3;

  const close = useMutation({
    mutationFn: async () => {
      const closed = await closeSession(sessionId, Math.round(counted * 100) / 100, denoms, reason);
      // Journal Z figé → PDF rangé dans la GED de la session (l'échec de l'archive ne défait pas la clôture).
      const frozen = frozenZ(closed);
      if (frozen) {
        try { await archiveZPdf(companyId, frozen, await buildZPdf(frozen)); } catch { toast.warning(t('cash.zArchiveFailed')); }
      }
      return closed;
    },
    onSuccess: (closed) => { setAsk(false); setError(null); onClosed(closed); },
    onError: (e) => setError(errorMessage(e)),
  });
  const varianceText = `${variance >= 0 ? '+' : '−'} ${eur(Math.abs(variance))}`;
  const summary = (
    <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 font-data text-[14px] tabular-nums">
      <dt className="text-muted-foreground">{t('cash.theoretical')}</dt><dd className="text-right">{eur(theoreticalCash)}</dd>
      <dt className="text-muted-foreground">{t('cash.countedCash')}</dt><dd className="text-right font-bold">{eur(counted)}</dd>
      <dt className="text-muted-foreground">{t('cash.variance')}</dt>
      <dd className={`flex items-center justify-end gap-1.5 font-bold ${hasVariance ? 'text-danger' : 'text-success'}`}>
        {hasVariance ? <AlertTriangle className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />} {varianceText}
      </dd>
    </dl>
  );
  const pendingList = progress && progress.byMethod.length > 0 && (
    <ul className="mt-1 space-y-0.5 font-data text-[12px] tabular-nums">
      {progress.byMethod.map((m) => <li key={m.method}>{fillVars(t('clotureCaisse.lineByMethod'), { method: methodLabel(m.method), amount: eur(m.amount), n: m.count })}</li>)}
    </ul>
  );
  const formOpen = showForm ?? depositPending;
  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.close')}</p>
        <span className="font-data text-[12px] text-muted-foreground">{fillVars(t('designEcrans.stepOf'), { n: stepNumber })}</span>
      </div>
      <StepTrail items={trail} selected={step} onSelect={(k) => goTo(k as CloseOrderStep)} ariaLabel={t('designEcrans.closeStepsLabel')} />

      {step === 'count' && (
        <>
          <p className="text-[13px] text-muted-foreground">{t('designEcrans.countHint')}</p>
          <CashCountGrid qtys={qtys} onChange={setQtys} />
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="font-data text-[14px] tabular-nums">{t('designEcrans.countedSoFar')} : <b>{eur(counted)}</b></span>
            <Button variant="outline" onClick={() => goTo('deposit')} disabled={!movements}>{t('clotureCaisse.toDeposit')} <ArrowRight /></Button>
          </div>
        </>
      )}

      {step === 'deposit' && (
        <>
          <p className="text-[13px] text-muted-foreground">{t('clotureCaisse.depositHint')}</p>
          {linesQ.isLoading && <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('clotureCaisse.depositChecking')}</p>}
          {depositPending && (
            <div className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>{fillVars(t('clotureCaisse.depositPending'), { n: progress?.pendingCount ?? 0 })}{pendingList}</div>
            </div>
          )}
          {progress?.state === 'done' && <p className="flex items-start gap-2 text-[13px] text-success"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('clotureCaisse.depositDone')}</p>}
          {progress?.state === 'nothing' && <p className="flex items-start gap-2 text-[13px] text-muted-foreground"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('clotureCaisse.depositNothing')}</p>}
          <Button variant="outline" size="sm" onClick={() => setShowForm(!formOpen)}>{t(formOpen ? 'clotureCaisse.hideForm' : 'clotureCaisse.showForm')}</Button>
          {formOpen && <div className="rounded-md border border-border p-3"><CashDepositsScreen companyId={companyId} companyName={companyName} /></div>}
          {skipAsk ? (
            <div className="space-y-2 rounded-md border border-warning p-3" role="alert">
              <p className="flex items-center gap-2 text-[13px] font-bold text-warning"><AlertTriangle className="size-4" aria-hidden /> {t('clotureCaisse.skipTitle')}</p>
              <p className="text-[13px]">{t('clotureCaisse.skipBody')}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setSkipAsk(false)}>{t('clotureCaisse.skipBack')}</Button>
                <Button variant="outline" onClick={() => goTo('z')}>{t('clotureCaisse.skipDo')} <ArrowRight /></Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => goTo('count')}><ArrowLeft /> {t('designEcrans.backToCount')}</Button>
              <Button variant="outline" onClick={() => (depositPending ? setSkipAsk(true) : goTo('z'))}>{t('clotureCaisse.toZ')} <ArrowRight /></Button>
            </div>
          )}
        </>
      )}

      {step === 'z' && needsRecount && (
        <>
          <div className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-bold">{t('clotureCaisse.recountTitle')}</p>
              <p>{fillVars(t('clotureCaisse.recountBody'), { delta: `${drawerChange > 0 ? '−' : '+'} ${eur(Math.abs(drawerChange))}`, expected: eur(theoreticalCash) })}</p>
            </div>
          </div>
          <CashCountGrid qtys={qtys} onChange={setQtys} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => goTo('deposit')}><ArrowLeft /> {t('clotureCaisse.backToDeposit')}</Button>
            <span className="font-data text-[14px] tabular-nums">{t('designEcrans.countedSoFar')} : <b>{eur(counted)}</b></span>
            <Button variant="outline" onClick={() => setOutAtCount(depositCashOut(movements ?? []))}><CheckCircle2 /> {t('clotureCaisse.recountDo')}</Button>
          </div>
        </>
      )}

      {step === 'z' && !needsRecount && (
        <>
          <p className="text-[13px] font-bold">{t('designEcrans.closeSummary')}</p>
          {summary}
          {depositPending && (
            <div className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>{t('clotureCaisse.zPendingWarning')}{pendingList}</div>
            </div>
          )}
          {counted === 0 && (
            <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t('designEcrans.countedZero')}</p>
          )}
          {hasVariance ? (
            <div className="space-y-1">
              <p className="flex items-start gap-2 text-[13px] text-danger"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t('designEcrans.varianceFound')}</p>
              <Label>{t('cash.varianceReason')}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('cash.varianceReasonHint')} className="max-w-xl" />
              {reasonMissing && <p className="text-[12px] text-warning">{t('cash.varianceReasonNeeded')}</p>}
            </div>
          ) : (
            <p className="flex items-start gap-2 text-[13px] text-success"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {t('designEcrans.noVariance')}</p>
          )}
          {error && !ask && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => goTo('deposit')} disabled={close.isPending}><ArrowLeft /> {t('clotureCaisse.backToDeposit')}</Button>
            {/* Seul bouton rouge de la clôture : la dernière étape. */}
            <Button onClick={() => { setError(null); setAsk(true); }} disabled={close.isPending || reasonMissing}>{close.isPending ? <Loader2 className="animate-spin" /> : <Lock />} {t('cash.closeConfirm')}</Button>
          </div>
        </>
      )}

      {/* La clôture est définitive (règlements et mouvements de la session figés, Z numéroté) : on confirme. */}
      <AlertDialog open={ask} onOpenChange={(o) => { if (!close.isPending) setAsk(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-warning" /> {t('cash.closeAsk')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cash.closeAskBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-data text-[13px] tabular-nums">
            <dt className="text-muted-foreground">{t('cash.theoretical')}</dt><dd className="text-right">{eur(theoreticalCash)}</dd>
            <dt className="text-muted-foreground">{t('cash.countedCash')}</dt><dd className="text-right">{eur(counted)}</dd>
            <dt className="text-muted-foreground">{t('cash.variance')}</dt><dd className={`text-right ${Math.abs(variance) > 0.005 ? 'text-danger' : 'text-success'}`}>{varianceText}</dd>
            {reason.trim() && <><dt className="text-muted-foreground">{t('cash.varianceReason')}</dt><dd className="text-right">{reason.trim()}</dd></>}
          </dl>
          {depositPending && <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('clotureCaisse.zPendingWarning')}</p>}
          {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={close.isPending}>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); close.mutate(); }} disabled={close.isPending}>{close.isPending ? <Loader2 className="animate-spin" /> : <Lock />} {t('cash.closeDo')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------- Sessions passées ---------------- */
function PastSessions({ sessions }: { sessions: CashSession[] }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.pastSessions')}</p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('cash.colZ')}</Th><Th>{t('cash.colOpened')}</Th><Th>{t('cash.colClosed')}</Th><Th className="text-right">{t('cash.colFloat')}</Th><Th className="text-right">{t('cash.colCounted')}</Th><Th>{t('cash.colStatus')}</Th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-bold">{s.z_number ?? '—'}</td>
                <td className="px-3 py-2">{new Date(s.opened_at).toLocaleString('fr-BE')}</td>
                <td className="px-3 py-2">{s.closed_at ? new Date(s.closed_at).toLocaleString('fr-BE') : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(s.opening_float))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.counted_cash != null ? eur(Number(s.counted_cash)) : '—'}</td>
                <td className="px-3 py-2"><StatusBadge tone={s.status === 'open' ? 'success' : 'neutral'} label={s.status === 'open' ? t('cash.statusOpen') : t('cash.statusClosed')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>;
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
