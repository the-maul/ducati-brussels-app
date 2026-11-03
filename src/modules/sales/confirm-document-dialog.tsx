/**
 * M6 — Fenêtre de confirmation avant de créer une facture ou un avoir (mission 08, cartes 4 et 6).
 * Récapitulatif : type, numéro qui sera attribué (aperçu de la séquence de la société), client,
 * total TTC, lignes, conséquences (stock, irréversible). Le bouton principal dit ce qu'il fait
 * (« Créer la facture »). Logique pure dans `confirm.ts`.
 */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { listSequences } from '@/modules/settings/sequences-api';
import { t } from '@/lib/i18n';
import { buildConfirmSummary, visibleConfirmLines, type ConfirmAction, type ConfirmLine } from './confirm';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export type ConfirmDocumentRequest = {
  action: ConfirmAction; docType: string; clientName: string | null; totalTtc: number; lines: ConfirmLine[];
};

export function ConfirmDocumentDialog({ companyId, request, pending, onConfirm, onCancel }: {
  companyId: string; request: ConfirmDocumentRequest | null; pending?: boolean;
  onConfirm: (r: ConfirmDocumentRequest) => void; onCancel: () => void;
}) {
  const seqQ = useQuery({ queryKey: ['sequences', companyId], queryFn: () => listSequences(companyId), enabled: !!request });
  if (!request) return null;
  const sequence = seqQ.data?.find((s) => s.doc_type === request.docType) ?? null;
  const summary = buildConfirmSummary({ ...request, sequence });
  const { shown, hidden } = visibleConfirmLines(summary.lines);
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !pending) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`sales.${summary.titleKey}`)}</AlertDialogTitle>
          <AlertDialogDescription>{t('sales.confirmHint')}</AlertDialogDescription>
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
            <tbody>
              {shown.map((l, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-2 py-1">{l.designation}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{eur(l.lineTtc)}</td>
                </tr>
              ))}
              {hidden > 0 && <tr><td colSpan={3} className="px-2 py-1 text-muted-foreground">{t('sales.confirmMoreLines').replace('{n}', String(hidden))}</td></tr>}
            </tbody>
          </table>
        </div>
        <ul className="space-y-1 rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning">
          {summary.consequences.map((k) => (
            <li key={k} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{t(`sales.${k}`)}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} onClick={onCancel}>{t('action.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); onConfirm(request); }}>
            {pending && <Loader2 className="animate-spin" />} {t(`sales.${summary.primaryKey}`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
