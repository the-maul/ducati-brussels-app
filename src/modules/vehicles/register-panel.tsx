/**
 * M3 — Encadre « Registre des vehicules a moteur » de la fiche moto : les entrees / sorties de
 * cette moto (n° d'ordre, dates, nature, facture), lien vers le registre complet.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { listRegister, registerSchemaReady, type RegisterRow } from './register-api';

const STATE_TONE: Record<RegisterRow['state'], StatusTone> = {
  en_cours: 'info', a_facturer: 'warning', en_retard: 'danger', close: 'success', rectifiee: 'neutral', annulee: 'neutral',
};
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export function VehicleRegisterPanel({ companyId, vehicleId }: { companyId: string; vehicleId: string }) {
  const readyQ = useQuery({ queryKey: ['vehicle-register-ready'], queryFn: registerSchemaReady, staleTime: 300_000 });
  const q = useQuery({
    queryKey: ['vehicle-register', companyId, 'vehicle', vehicleId],
    queryFn: () => listRegister(companyId, null, null, 'all', vehicleId),
    enabled: readyQ.data !== false,
  });
  if (readyQ.data === false) return <p className="text-[13px] text-muted-foreground">{t('vehicleRegister.notReady')}</p>;
  if (q.isLoading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  const rows = q.data ?? [];
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-[13px] text-muted-foreground">{t('vehicleRegister.ficheEmpty')}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                {(['colNumber', 'colEntered', 'colNature', 'colLeft', 'colInvoice', 'colState'] as const).map((k) => (
                  <th key={k} className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`vehicleRegister.${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-border last:border-0 ${r.rectified_by_id || r.is_void ? 'text-muted-foreground line-through' : ''}`}>
                  <td className="px-3 py-2 font-mono">{r.number}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{fmtDate(r.entered_at)}</td>
                  <td className="px-3 py-2"><span className="font-mono">{r.nature_code}</span> <span className="text-[12px]">{r.nature_label}</span></td>
                  <td className="px-3 py-2 font-mono text-[12px]">{fmtDate(r.left_at)}</td>
                  <td className="px-3 py-2">{r.invoice_ref ? <span className="font-mono">{r.invoice_ref}</span> : r.no_document_reason ? <span className="text-[12px]">{r.no_document_reason}</span> : '—'}</td>
                  <td className="px-3 py-2"><StatusBadge tone={STATE_TONE[r.state]} label={t(`vehicleRegister.state_${r.state}`)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link to="/vehicles/register" className="text-[12px] text-primary underline-offset-2 hover:underline">{t('vehicleRegister.open')}</Link>
    </div>
  );
}
