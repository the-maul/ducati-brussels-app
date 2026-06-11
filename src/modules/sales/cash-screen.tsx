/**
 * M6 (POS) — Écran Caisse : ouverture (fond), mouvements de fond de caisse,
 * journal Z (encaissements par mode, ventilation TVA), clôture avec calcul monnaie.
 * Réf. G8 Facturation p.128-131, p.164-179. Libellés via i18n.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Lock, Wallet } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import {
  getOpenSession, listSessions, openSession, closeSession, addMovement, listSessionMovements, getZReport,
} from './cash-api';
import { listPaymentMethods } from './write-api';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

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
function OpenForm({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [float, setFloat] = useState('');
  const [note, setNote] = useState('');
  const open = useMutation({
    mutationFn: () => openSession(companyId, num(float), note || undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cash-session', companyId] }); qc.invalidateQueries({ queryKey: ['cash-sessions', companyId] }); },
  });
  return (
    <div className="max-w-md space-y-3 rounded-md border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-bold"><Wallet className="size-4" /> {t('cash.noSession')}</p>
      <div className="space-y-1"><Label>{t('cash.openingFloat')}</Label><Input type="number" step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} className="text-right tabular-nums" placeholder="0,00" /></div>
      <div className="space-y-1"><Label>{t('cash.note')}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <Button onClick={() => open.mutate()} disabled={open.isPending}>{open.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('cash.open')}</Button>
    </div>
  );
}

/* ---------------- Session ouverte ---------------- */
function OpenSession({ companyId, session }: { companyId: string; session: { id: string; opened_at: string; opening_float: number } }) {
  const qc = useQueryClient();
  const nowIso = useMemo(() => new Date().toISOString(), []); // borne haute figée pour cette vue
  const { data: methods } = useQuery({ queryKey: ['pay-methods', companyId], queryFn: () => listPaymentMethods(companyId) });
  const { data: movements } = useQuery({ queryKey: ['cash-mov', session.id], queryFn: () => listSessionMovements(companyId, session.opened_at, nowIso) });
  const { data: z } = useQuery({ queryKey: ['cash-z', session.id], queryFn: () => getZReport(companyId, session.opened_at, nowIso) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cash-mov', session.id] });
    qc.invalidateQueries({ queryKey: ['cash-z', session.id] });
  };

  const espTotal = z?.payments_by_method.find((p) => p.method === 'ESP')?.total ?? 0;
  const theoreticalCash = Number(session.opening_float) + espTotal + (z?.cash_in ?? 0) - (z?.cash_out ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone="success" label={t('cash.statusOpen')} />
        <span className="font-data text-sm text-muted-foreground">{t('cash.openedAt')} {new Date(session.opened_at).toLocaleString('fr-BE')}</span>
        <span className="font-data text-sm tabular-nums">{t('cash.openingFloat')} : <b>{eur(Number(session.opening_float))}</b></span>
      </div>

      <MovementPanel companyId={companyId} sessionId={session.id} methods={methods ?? []} movements={movements ?? []} onChanged={refresh} />

      {z && <ZPanel z={z} />}

      <ClosePanel sessionId={session.id} theoreticalCash={theoreticalCash} onClosed={() => { qc.invalidateQueries({ queryKey: ['cash-session', companyId] }); qc.invalidateQueries({ queryKey: ['cash-sessions', companyId] }); }} />
    </div>
  );
}

/* ---------------- Mouvements de fond de caisse ---------------- */
function MovementPanel({ companyId, sessionId, methods, movements, onChanged }: {
  companyId: string; sessionId: string; methods: { code: string; label: string }[];
  movements: { id: string; kind: string; method: string; amount: number; reason: string | null; occurred_at: string }[]; onChanged: () => void;
}) {
  const [kind, setKind] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('ESP');
  const [reason, setReason] = useState('');
  const add = useMutation({
    mutationFn: () => addMovement(companyId, sessionId, kind, num(amount), method, reason),
    onSuccess: () => { setAmount(''); setReason(''); onChanged(); },
  });
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.movements')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label>{t('cash.method')}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as 'in' | 'out')}>
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
        <div className="flex-1 space-y-1"><Label>{t('cash.reason')}</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <Button onClick={() => add.mutate()} disabled={add.isPending || num(amount) <= 0}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('cash.add')}</Button>
      </div>
      {movements.length > 0 && (
        <table className="w-full border-collapse font-data text-[13px]">
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="py-1.5">{new Date(m.occurred_at).toLocaleString('fr-BE')}</td>
                <td className="py-1.5"><StatusBadge tone={m.kind === 'in' ? 'success' : 'warning'} label={m.kind === 'in' ? t('cash.in') : t('cash.out')} /></td>
                <td className="py-1.5">{m.method}</td>
                <td className="py-1.5">{m.reason}</td>
                <td className="py-1.5 text-right tabular-nums">{m.kind === 'in' ? '+' : '−'} {eur(Number(m.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Journal Z ---------------- */
function ZPanel({ z }: { z: import('./cash-api').ZReport }) {
  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.z')}</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-[12px] font-bold">{t('cash.byMethod')}</p>
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>{t('cash.method')}</Th><Th className="text-right">{t('cash.sales')}</Th><Th className="text-right">{t('cash.deposits')}</Th><Th className="text-right">{t('cash.refunds')}</Th><Th className="text-right">{t('cash.total')}</Th></tr></thead>
            <tbody>
              {z.payments_by_method.map((p) => (
                <tr key={p.method} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5">{p.method}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(p.sales)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(p.deposits)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(p.refunds)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">{eur(p.total)}</td>
                </tr>
              ))}
              {z.payments_by_method.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">—</td></tr>}
            </tbody>
          </table>
          <div className="mt-2 flex justify-between font-data text-[13px] tabular-nums text-muted-foreground">
            <span>{t('cash.cashIn')} : {eur(z.cash_in)}</span><span>{t('cash.cashOut')} : {eur(z.cash_out)}</span>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[12px] font-bold">{t('cash.vat')}</p>
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th className="text-right">{t('cash.vatRate')}</Th><Th className="text-right">{t('cash.baseHt')}</Th><Th className="text-right">{t('cash.vatAmount')}</Th></tr></thead>
            <tbody>
              {z.vat_breakdown.map((v) => (
                <tr key={v.vat_rate} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5 text-right tabular-nums">{v.vat_rate}%</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(v.base_ht)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{eur(v.vat)}</td>
                </tr>
              ))}
              {z.vat_breakdown.length === 0 && <tr><td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">—</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Clôture + calcul monnaie ---------------- */
function ClosePanel({ sessionId, theoreticalCash, onClosed }: { sessionId: string; theoreticalCash: number; onClosed: () => void }) {
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const counted = DENOMS.reduce((s, d) => s + d * num(qtys[String(d)] ?? ''), 0);
  const variance = counted - theoreticalCash;
  const close = useMutation({
    mutationFn: () => {
      const denoms: Record<string, number> = {};
      for (const d of DENOMS) { const q = num(qtys[String(d)] ?? ''); if (q > 0) denoms[String(d)] = q; }
      return closeSession(sessionId, Math.round(counted * 100) / 100, denoms);
    },
    onSuccess: onClosed,
  });
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.counting')}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {DENOMS.map((d) => (
          <div key={d} className="flex items-center gap-2">
            <span className="w-14 text-right font-data text-[13px] tabular-nums text-muted-foreground">{eur(d)}</span>
            <Input type="number" min="0" step="1" value={qtys[String(d)] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [String(d)]: e.target.value }))} className="h-8 w-16 text-right tabular-nums" placeholder="0" />
          </div>
        ))}
      </div>
      <div className="flex flex-col items-end gap-1 font-data text-sm tabular-nums">
        <span>{t('cash.theoretical')} : {eur(theoreticalCash)}</span>
        <span>{t('cash.countedCash')} : <b>{eur(counted)}</b></span>
        <span className={Math.abs(variance) > 0.005 ? 'text-danger' : 'text-success'}>{t('cash.variance')} : <b>{variance >= 0 ? '+' : '−'} {eur(Math.abs(variance))}</b></span>
      </div>
      <div className="flex justify-end">
        <Button variant="destructive" onClick={() => close.mutate()} disabled={close.isPending}>{close.isPending ? <Loader2 className="animate-spin" /> : <Lock />} {t('cash.closeConfirm')}</Button>
      </div>
    </div>
  );
}

/* ---------------- Sessions passées ---------------- */
function PastSessions({ sessions }: { sessions: { id: string; status: string; opened_at: string; closed_at: string | null; opening_float: number; counted_cash: number | null }[] }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cash.pastSessions')}</p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('cash.colOpened')}</Th><Th>{t('cash.colClosed')}</Th><Th className="text-right">{t('cash.colFloat')}</Th><Th className="text-right">{t('cash.colCounted')}</Th><Th>{t('cash.colStatus')}</Th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
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
