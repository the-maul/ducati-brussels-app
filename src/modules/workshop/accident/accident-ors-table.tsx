/**
 * M8 — Vue « O.R. accident » de la liste des OR (G8 : Rappel d'un O.R. › O.R. accident) :
 * statut OR, n° OR, client, cabinet, franchise, date OR, expert, passage, accepte, immat., chassis.
 * Une ligne par OR accident (son dossier accident porte le volet assureur).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Hourglass, Loader2 } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { contactDisplayName } from '@/modules/contacts/api';
import { listAccidentOrs } from './insurance-api';
import { deductibleLabel } from './insurance-rules';

const eur = (n: number) => `${new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '—');

export function AccidentOrsTable({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const [withInvoiced, setWithInvoiced] = useState(false);
  const q = useQuery({ queryKey: ['accident-ors', companyId, withInvoiced], queryFn: () => listAccidentOrs(companyId, { includeInvoiced: withInvoiced }) });
  const rows = q.data?.rows ?? [];
  const head = [t('workshop.colStatus'), t('workshop.colNumber'), t('workshop.colClient'), t('insurance.colInsurer'), t('insurance.deductible'), t('insurance.colOrDate'), t('insurance.expert'), t('insurance.colVisit'), t('insurance.colAccepted'), t('insurance.pdfPlate'), t('warranty.colVin')];
  return (
    <div className="space-y-3">
      {q.data && !q.data.schemaReady && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('insurance.migrationMissing')}</p>}
      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <input type="checkbox" checked={withInvoiced} onChange={(e) => setWithInvoiced(e.target.checked)} className="size-4" />
        {t('warranty.includeInvoiced')}
      </label>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>{head.map((h) => <th key={h} className="px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{h}</th>)}</tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={head.length} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={head.length} className="px-3 py-6 text-center text-muted-foreground">{t('insurance.emptyOrs')}</td></tr>}
            {rows.map((r) => {
              const or = r.repair_order!;
              return (
                <tr key={r.id} onClick={() => navigate({ to: '/workshop/$orId', params: { orId: or.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-2"><StatusBadge tone={or.status === 'facture' ? 'success' : or.status === 'pret' ? 'info' : 'warning'} label={t(`workshop.status_${or.status}`)} /></td>
                  <td className="px-3 py-2 font-mono text-[12px]">{or.number ?? '—'}</td>
                  <td className="px-3 py-2">{r.contact ? contactDisplayName(r.contact) : '—'}</td>
                  <td className="px-3 py-2">{r.insurer_party?.name ?? r.insurer ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{deductibleLabel(r.deductible_kind, r.deductible_value, or.total_ttc, eur)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtDate(or.created_at)}</td>
                  <td className="px-3 py-2">{r.expert_party?.name ?? r.expert_name ?? or.expert_name ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtDate(r.expert_visit_date ?? or.expert_date)}</td>
                  <td className="px-3 py-2">{r.work_start_accepted
                    ? <StatusBadge tone="success" icon={CheckCircle2} label={t('insurance.yes')} />
                    : <StatusBadge tone="warning" icon={Hourglass} label={t('insurance.no')} />}</td>
                  <td className="px-3 py-2 font-data">{r.vehicle?.plate ?? '—'}</td>
                  <td className="px-3 py-2 font-data text-[12px] uppercase">{r.vehicle?.vin ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
