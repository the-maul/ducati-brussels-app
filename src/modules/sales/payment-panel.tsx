/**
 * M6 — Écran de règlement (POS) : multi-modes, partiel, à échéance (différé),
 * rendu de monnaie sur espèces, ajout/suppression de règlements.
 * Réf. G8 Facturation p.39-40, p.67-69, p.90. Libellés via i18n.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import {
  listPaymentMethods, listPayments, addPayments, deletePayment, markPaymentReceived,
  type NewPayment,
} from './write-api';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const CASH = 'ESP'; // mode espèces → rendu de monnaie

type Draft = { _key: string; method: string; amount: string; deferred: boolean; dueDate: string; given: string };
let dc = 0;

export function PaymentPanel({ documentId, companyId, due }: { documentId: string; companyId: string; due: number }) {
  const qc = useQueryClient();
  const { data: methods } = useQuery({ queryKey: ['pay-methods', companyId], queryFn: () => listPaymentMethods(companyId) });
  const { data: payments } = useQuery({ queryKey: ['payments', documentId], queryFn: () => listPayments(documentId) });

  const firstMethod = methods?.[0]?.code ?? CASH;
  const newDraft = (amount = ''): Draft => ({ _key: `d${dc++}`, method: firstMethod, amount, deferred: false, dueDate: '', given: '' });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const methodLabel = useMemo(() => {
    const map = new Map((methods ?? []).map((m) => [m.code, m.label]));
    return (code: string) => map.get(code) ?? code;
  }, [methods]);

  const setDraft = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d._key === key ? { ...d, ...patch } : d)));
  const addLine = () => setDrafts((ds) => [...ds, newDraft(ds.length === 0 ? String(due.toFixed(2)) : '')]);
  const removeLine = (key: string) => setDrafts((ds) => ds.filter((d) => d._key !== key));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payments', documentId] });
    qc.invalidateQueries({ queryKey: ['doc-full', documentId] });
    qc.invalidateQueries({ queryKey: ['documents'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const lines: NewPayment[] = drafts
        .filter((d) => num(d.amount) > 0)
        .map((d) => ({
          method: d.method, amount: num(d.amount),
          status: d.deferred ? 'attendu' : 'recu',
          dueDate: d.deferred ? (d.dueDate || null) : null,
          givenAmount: d.method === CASH && num(d.given) > 0 ? num(d.given) : null,
        }));
      if (lines.length === 0) throw new Error(t('sales.payNeedAmount'));
      await addPayments(documentId, lines);
    },
    onSuccess: () => { setDrafts([]); setError(null); refresh(); },
    onError: (e) => setError(e instanceof Error ? e.message : t('sales.errSave')),
  });

  const del = useMutation({ mutationFn: (id: string) => deletePayment(id, documentId), onSuccess: refresh });
  const recv = useMutation({ mutationFn: (id: string) => markPaymentReceived(id, documentId), onSuccess: refresh });

  // Rendu de monnaie : total espèces remises − total espèces à encaisser dans les drafts.
  const cashDue = drafts.filter((d) => d.method === CASH && !d.deferred).reduce((s, d) => s + num(d.amount), 0);
  const cashGiven = drafts.filter((d) => d.method === CASH && !d.deferred).reduce((s, d) => s + num(d.given), 0);
  const change = cashGiven > cashDue ? cashGiven - cashDue : 0;
  const draftTotal = drafts.reduce((s, d) => s + (d.deferred ? 0 : num(d.amount)), 0);

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.payments')}</p>
        {due > 0.005 && <span className="font-data text-sm tabular-nums text-danger">{t('sales.due')} : <b>{eur(due)}</b></span>}
      </div>

      {/* Règlements déjà saisis */}
      {payments && payments.length > 0 && (
        <table className="w-full border-collapse font-data text-[13px]">
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="py-1.5">{methodLabel(p.method)}</td>
                <td className="py-1.5">
                  {p.status === 'attendu'
                    ? <StatusBadge tone="warning" label={`${t('sales.deferred')}${p.due_date ? ` · ${p.due_date}` : ''}`} />
                    : <StatusBadge tone="success" label={t('sales.received')} />}
                </td>
                <td className="py-1.5 text-right tabular-nums">{eur(Number(p.amount))}</td>
                <td className="w-20 py-1.5 text-right">
                  {p.status === 'attendu' && (
                    <Button size="sm" variant="ghost" title={t('sales.markReceived')} onClick={() => recv.mutate(p.id)} disabled={recv.isPending}><Check className="size-4 text-success" /></Button>
                  )}
                  <Button size="sm" variant="ghost" title={t('action.delete')} onClick={() => del.mutate(p.id)} disabled={del.isPending}><Trash2 className="size-4 text-danger" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Saisie de nouveaux règlements */}
      {drafts.map((d) => (
        <div key={d._key} className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-2">
          <div className="space-y-1">
            <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.payMethod')}</label>
            <Select value={d.method} onValueChange={(v) => setDraft(d._key, { method: v })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{(methods ?? []).map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.payAmount')}</label>
            <Input type="number" step="0.01" value={d.amount} onChange={(e) => setDraft(d._key, { amount: e.target.value })} className="w-28 text-right tabular-nums" />
          </div>
          {d.method === CASH && !d.deferred && (
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.cashGiven')}</label>
              <Input type="number" step="0.01" value={d.given} onChange={(e) => setDraft(d._key, { given: e.target.value })} className="w-28 text-right tabular-nums" />
            </div>
          )}
          <label className="flex h-9 items-center gap-2 px-1 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={d.deferred} onChange={(e) => setDraft(d._key, { deferred: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" />
            {t('sales.deferred')}
          </label>
          {d.deferred && (
            <div className="space-y-1">
              <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.dueDate')}</label>
              <Input type="date" value={d.dueDate} onChange={(e) => setDraft(d._key, { dueDate: e.target.value })} className="w-40" />
            </div>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => removeLine(d._key)}><Trash2 className="size-4 text-danger" /></Button>
        </div>
      ))}

      {change > 0.005 && (
        <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('sales.change')} : <b className="tabular-nums">{eur(change)}</b></p>
      )}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addLine}><Plus /> {t('sales.addPayment')}</Button>
        {drafts.length > 0 && (
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} {t('sales.recordPayments')}{draftTotal > 0 ? ` · ${eur(draftTotal)}` : ''}
          </Button>
        )}
      </div>
    </div>
  );
}
