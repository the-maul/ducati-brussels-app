/**
 * M6 — Fenêtre de confirmation avant de créer une facture ou un avoir (mission 08, cartes 4 et 6).
 * Récapitulatif : type, numéro qui sera attribué (aperçu de la séquence de la société), client,
 * total TTC, lignes, conséquences (stock, irréversible). Le bouton principal dit ce qu'il fait
 * (« Créer la facture »). Logique pure dans `confirm.ts`.
 *
 * Avoir (03/11/2026, étude facturation §3 ligne 10) : la quantité de chaque ligne se choisit
 * (avoir partiel) ; tout reprendre = avoir total, la facture passe en « compensée par un avoir »
 * mais reste au journal des ventes.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { listSequences } from '@/modules/settings/sequences-api';
import { t } from '@/lib/i18n';
import {
  buildConfirmSummary, visibleConfirmLines, defaultCreditChoice, clampCreditQuantity, creditChoiceSummary,
  type ConfirmAction, type ConfirmLine, type CreditChoice,
} from './confirm';
import type { CreditSelection } from './write-api';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export type ConfirmDocumentRequest = {
  action: ConfirmAction; docType: string; clientName: string | null; totalTtc: number; lines: ConfirmLine[];
};

export function ConfirmDocumentDialog({ companyId, request, pending, onConfirm, onCancel }: {
  companyId: string; request: ConfirmDocumentRequest | null; pending?: boolean;
  /** Avoir : `selection` = lignes et quantités choisies (vide = tout). */
  onConfirm: (r: ConfirmDocumentRequest, selection?: CreditSelection[]) => void; onCancel: () => void;
}) {
  const seqQ = useQuery({ queryKey: ['sequences', companyId], queryFn: () => listSequences(companyId), enabled: !!request });
  const isCredit = request?.action === 'creditNote';
  // Le choix des quantités repart de « tout » à chaque nouvelle demande (la fenêtre reste montée).
  const [chosen, setChosen] = useState<{ req: ConfirmDocumentRequest | null; choice: CreditChoice }>({ req: null, choice: new Map() });
  const choice = chosen.req === request ? chosen.choice : defaultCreditChoice(request?.lines ?? []);
  const setChoice = (fn: (c: CreditChoice) => CreditChoice) => setChosen({ req: request, choice: fn(choice) });
  const creditSummary = useMemo(() => (request && isCredit ? creditChoiceSummary(request.lines, choice) : null), [request, isCredit, choice]);
  if (!request) return null;
  const sequence = seqQ.data?.find((s) => s.doc_type === request.docType) ?? null;
  const summary = buildConfirmSummary({
    ...request, sequence,
    totalTtc: creditSummary ? creditSummary.totalTtc : request.totalTtc,
    partialCredit: creditSummary ? !creditSummary.full : false,
  });
  const { shown, hidden } = visibleConfirmLines(isCredit ? request.lines : summary.lines);
  const nothing = !!creditSummary && creditSummary.lines.length === 0;
  const confirm = () => {
    if (!creditSummary) { onConfirm(request); return; }
    onConfirm(request, creditSummary.lines.map((l) => ({ lineId: l.lineId as string, quantity: Math.abs(l.quantity) })));
  };
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !pending) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`sales.${summary.titleKey}`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(isCredit ? 'sales.confirmCreditHint' : 'sales.confirmHint')}</AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-muted-foreground">{t('sales.type')}</dt>
          <dd className="font-medium">{t(`sales.type_${summary.docType}`)}</dd>
          <dt className="text-muted-foreground">{t('sales.confirmNextNumber')}</dt>
          <dd className="font-mono">{seqQ.isLoading ? <Loader2 className="inline size-3.5 animate-spin" /> : summary.nextNumber ?? t('sales.confirmNumberUnknown')}</dd>
          <dt className="text-muted-foreground">{t('sales.client')}</dt>
          <dd className="font-medium">{summary.clientName ?? '—'}</dd>
          <dt className="text-muted-foreground">{t('sales.totalTtc')}</dt>
          <dd className="font-data font-bold tabular-nums">{eur(summary.totalTtc)}</dd>
        </dl>
        <div className="max-h-48 overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[12px]">
            {isCredit && (
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr><th className="px-2 py-1 text-left">{t('sales.colDesignation')}</th><th className="px-2 py-1 text-right">{t('sales.creditQty')}</th><th className="px-2 py-1 text-right">{t('sales.colTtc')}</th></tr>
              </thead>
            )}
            <tbody>
              {shown.map((l, i) => {
                const editable = isCredit && !!l.lineId && (l.maxQuantity ?? 0) > 0;
                const q = editable ? (choice.get(l.lineId as string) ?? 0) : l.quantity;
                return (
                  <tr key={l.lineId ?? i} className="border-b border-border last:border-0">
                    <td className="px-2 py-1">{l.designation}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {editable ? (
                        <span className="inline-flex items-center justify-end gap-1">
                          <Input
                            type="number" min={0} max={l.maxQuantity} step="0.001" value={q}
                            onChange={(e) => setChoice((c) => new Map(c).set(l.lineId as string, clampCreditQuantity(Number(e.target.value), l.maxQuantity as number)))}
                            className="h-7 w-20 text-right font-data text-[12px]"
                          />
                          <span className="text-muted-foreground">/ {l.maxQuantity}</span>
                        </span>
                      ) : (isCredit && (l.maxQuantity ?? 0) <= 0 ? <span className="text-muted-foreground">{t('sales.creditAlready')}</span> : l.quantity)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {editable ? eur(-Math.round((Math.abs(l.lineTtc) / Math.abs(l.quantity || 1)) * Number(q) * 100) / 100) : eur(l.lineTtc)}
                    </td>
                  </tr>
                );
              })}
              {hidden > 0 && <tr><td colSpan={3} className="px-2 py-1 text-muted-foreground">{t('sales.confirmMoreLines').replace('{n}', String(hidden))}</td></tr>}
            </tbody>
          </table>
        </div>
        {nothing && <p className="rounded-md bg-danger-bg px-3 py-2 text-[12px] text-danger">{t('sales.creditNoteNothing')}</p>}
        <ul className="space-y-1 rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning">
          {summary.consequences.map((k) => (
            <li key={k} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{t(`sales.${k}`)}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} onClick={onCancel}>{t('action.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={pending || nothing} onClick={(e) => { e.preventDefault(); confirm(); }}>
            {pending && <Loader2 className="animate-spin" />} {t(`sales.${summary.primaryKey}`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
