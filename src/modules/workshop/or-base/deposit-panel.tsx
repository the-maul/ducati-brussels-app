/**
 * M8 — Panneau « Acompte » de la fiche OR (decision Q45 du 18/11/2026, comme G8). Reutilise TELS
 * QUELS les panneaux des ventes : encaissement (PaymentPanel, mode acompte : caisse, especes,
 * plafond, contre-passation) et facture d'acompte (DepositInvoicePanel : FAA, « a facturer avant
 * le 15 »). Le document porteur (BC numerote du n° de l'OR) est cree a la premiere saisie.
 * Facture de l'OR validee : l'acompte y est deduit par la base ; le panneau ne propose plus d'encaisser.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import { PaymentPanel } from '@/modules/sales/payment-panel';
import { DepositInvoicePanel } from '@/modules/sales/deposit-invoice-panel';
import { getDocumentFull } from '@/modules/sales/write-api';
import { ensureOrDepositDocument, getOrDeposit } from './deposit-api';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function OrDepositPanel({ companyId, or, readOnly = false }: {
  companyId: string;
  or: { id: string; status: string; contact_id: string | null; vehicle_id: string | null; total_ttc: number };
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const depQ = useQuery({ queryKey: ['or-deposit', or.id], queryFn: () => getOrDeposit(or.id) });
  const dep = depQ.data ?? null;
  const docQ = useQuery({ queryKey: ['doc-full', dep?.documentId], queryFn: () => getDocumentFull(dep!.documentId), enabled: !!dep?.documentId });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['or-deposit', or.id] });
    qc.invalidateQueries({ queryKey: ['repair-orders'] });
    if (dep?.documentId) {
      qc.invalidateQueries({ queryKey: ['doc-full', dep.documentId] });
      qc.invalidateQueries({ queryKey: ['deposit-invoices', dep.documentId] });
    }
  };
  const open = useMutation({
    mutationFn: () => ensureOrDepositDocument(or.id),
    meta: { success: false },
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });

  if (depQ.isLoading) return null;
  // Migration 20261119191000 absente : on le dit, sans bloquer l'OR.
  if (depQ.data === undefined) return <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('orBase.deposit_migrationMissing')}</p>;

  const closed = or.status === 'facture' || or.status === 'annule' || dep?.status === 'converti';
  const doc = docQ.data?.doc ?? null;
  const due = Math.max(0, Math.round((Number(or.total_ttc) - (dep?.amount ?? 0)) * 100) / 100);

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Wallet className="size-4 text-muted-foreground" aria-hidden />
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orBase.deposit_title')}</p>
        {dep && dep.amount > 0 && <span className="font-data text-[13px] font-bold tabular-nums">{eur(dep.amount)}</span>}
        {dep?.status === 'converti' && <StatusBadge tone="success" label={t('orBase.deposit_deducted')} />}
        {dep?.documentId && (
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: dep.documentId } })}>
            {fillVars(t('orBase.deposit_openDocument'), { number: dep.number ?? '' })}
          </Button>
        )}
      </div>
      {!or.contact_id && !dep && <p className="text-[13px] text-muted-foreground">{t('orBase.deposit_needClient')}</p>}
      {or.contact_id && !dep && !closed && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-muted-foreground">{t('orBase.deposit_hint')}</p>
          <Button size="sm" variant="outline" onClick={() => open.mutate()} disabled={readOnly || open.isPending}>
            {open.isPending ? <Loader2 className="animate-spin" /> : <Wallet />} {t('orBase.deposit_add')}
          </Button>
        </div>
      )}
      {dep && closed && dep.status === 'converti' && <p className="text-[13px] text-muted-foreground">{t('orBase.deposit_deductedHint')}</p>}
      {dep && !closed && !readOnly && (
        <PaymentPanel documentId={dep.documentId} companyId={companyId} due={due} acompte onSaved={() => refresh()} />
      )}
      {doc && (
        <DepositInvoicePanel doc={doc} readOnly={readOnly} required={!!or.vehicle_id || !!doc.vehicle_id} />
      )}
    </div>
  );
}
