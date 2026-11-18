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
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Lock, Wallet, AlertTriangle, FileDown, CheckCircle2 } from 'lucide-react';
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
import { getDrawerBalance, listMovementTypes, addTypedMovement } from './cash-deposit-api';
import { CashCountGrid, countTotal } from './cash-count';
import { expectedCash, cashVariance, varianceReasonMissing } from './cash-rules';
import type { ZReport } from './z-report';
import { buildZPdf, openPdfBytes } from './z-report-pdf';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { toast } from 'sonner';
import { ZReportView } from './z-report-view';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function CashScreen({ companyId }: { companyId: string }) {
  const { data: session, isLoading } = useQuery({ queryKey: ['cash-session', companyId], queryFn: () => getOpenSession(companyId) });
  const { data: sessions } = useQuery({ queryKey: ['cash-sessions', companyId], queryFn: () => listSessions(companyId) });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {session ? <OpenSession companyId={companyId} session={session} /> : <OpenForm companyId={companyId} />}
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
  const value = float ?? (proposed != null ? String(proposed) : '');
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
      <div className="space-y-1"><Label>{t('cash.openingFloat')}</Label><Input type="number" step="0.01" value={value} onChange={(e) => setFloat(e.target.value)} className="text-right tabular-nums" placeholder="0,00" /></div>
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
function OpenSession({ companyId, session }: { companyId: string; session: CashSession }) {
  const qc = useQueryClient();
  const nowIso = useMemo(() => new Date().toISOString(), []); // borne haute figée pour cette vue
  const { data: methods } = useQuery({ queryKey: ['pay-methods', companyId], queryFn: () => listPaymentMethods(companyId) });
  const { data: movements } = useQuery({ queryKey: ['cash-mov', session.id], queryFn: () => listSessionMovements(companyId, session.opened_at, nowIso) });
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

      <ClosePanel companyId={companyId} sessionId={session.id} theoreticalCash={theoreticalCash} onClosed={setClosed} />
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
  const add = useMutation({
    mutationFn: () => addTypedMovement(companyId, sessionId, { kind, amount: num(amount), method, reason: reason.trim() || (type?.label ?? ''), typeCode: type?.code ?? null }),
    onSuccess: () => { setAmount(''); setReason(''); setAsk(false); onChanged(); },
  });
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.movements')}</p>
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
        <Button onClick={() => { add.reset(); setAsk(true); }} disabled={add.isPending || num(amount) <= 0 || needType}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('cash.add')}</Button>
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

/* ---------------- Clôture + calcul monnaie ---------------- */
function ClosePanel({ companyId, sessionId, theoreticalCash, onClosed }: { companyId: string; sessionId: string; theoreticalCash: number; onClosed: (s: CashSession) => void }) {
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const { total: counted, denominations: denoms } = countTotal(qtys);
  const variance = cashVariance(counted, theoreticalCash);
  const [reason, setReason] = useState('');
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Un écart (compté ≠ théorique) se motive avant la clôture (PDV010) ; la base le refuse aussi.
  const reasonMissing = varianceReasonMissing(variance, reason);
  const close = useMutation({
    mutationFn: async () => {
      const closed = await closeSession(sessionId, Math.round(counted * 100) / 100, denoms, reason);
      // Journal Z figé → PDF rangé dans la GED de la session (l'échec de l'archive ne défait pas la clôture).
      const z = frozenZ(closed);
      if (z) {
        try { await archiveZPdf(companyId, z, await buildZPdf(z)); } catch { toast.warning(t('cash.zArchiveFailed')); }
      }
      return closed;
    },
    onSuccess: (closed) => { setAsk(false); setError(null); onClosed(closed); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.counting')}</p>
      <CashCountGrid qtys={qtys} onChange={setQtys} />
      <div className="flex flex-col items-end gap-1 font-data text-sm tabular-nums">
        <span>{t('cash.theoretical')} : {eur(theoreticalCash)}</span>
        <span>{t('cash.countedCash')} : <b>{eur(counted)}</b></span>
        <span className={Math.abs(variance) > 0.005 ? 'text-danger' : 'text-success'}>{t('cash.variance')} : <b>{variance >= 0 ? '+' : '−'} {eur(Math.abs(variance))}</b></span>
      </div>
      {Math.abs(variance) > 0.004 && (
        <div className="space-y-1">
          <Label>{t('cash.varianceReason')}</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('cash.varianceReasonHint')} />
          {reasonMissing && <p className="text-[12px] text-warning">{t('cash.varianceReasonNeeded')}</p>}
        </div>
      )}
      {error && !ask && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end">
        <Button variant="destructive" onClick={() => { setError(null); setAsk(true); }} disabled={close.isPending || reasonMissing}>{close.isPending ? <Loader2 className="animate-spin" /> : <Lock />} {t('cash.closeConfirm')}</Button>
      </div>
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
            <dt className="text-muted-foreground">{t('cash.variance')}</dt><dd className={`text-right ${Math.abs(variance) > 0.005 ? 'text-danger' : 'text-success'}`}>{variance >= 0 ? '+' : '−'} {eur(Math.abs(variance))}</dd>
            {reason.trim() && <><dt className="text-muted-foreground">{t('cash.varianceReason')}</dt><dd className="text-right">{reason.trim()}</dd></>}
          </dl>
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
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.pastSessions')}</p>
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
  return <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>;
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
