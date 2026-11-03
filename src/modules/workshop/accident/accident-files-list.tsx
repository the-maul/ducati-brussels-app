/**
 * M8 — Liste des dossiers accident de la societe (Atelier → Dossiers accident), mission 09 carte 5.
 * Un dossier s'ouvre depuis un OR ou un devis (boutons sur ces fiches) : ici on les retrouve,
 * avec leur statut (couleur + icone + libelle), le devis lie et la date d'envoi.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { contactDisplayName } from '@/modules/contacts/api';
import { accidentSchemaReady, listAccidentFiles } from './api';
import { AccidentStatusBadge } from './accident-file-screen';

const eur = (n: number) => `${new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '—');

export function AccidentFilesList({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const schema = useQuery({ queryKey: ['accident-schema'], queryFn: accidentSchemaReady, staleTime: Infinity });
  const filesQ = useQuery({ queryKey: ['accident-files', companyId], queryFn: () => listAccidentFiles(companyId), enabled: schema.data === true });

  if (schema.data === false) return <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('accidentFile.migrationMissing')}</p>;
  if (schema.isLoading || filesQ.isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  const files = filesQ.data ?? [];

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[13px]">
        <thead className="bg-muted">
          <tr>
            <Th>{t('accidentFile.colVehicle')}</Th><Th>{t('accidentFile.colClient')}</Th><Th>{t('accidentFile.colQuote')}</Th>
            <Th>{t('accidentFile.colStatus')}</Th><Th>{t('accidentFile.colSent')}</Th><Th>{t('accidentFile.colCreated')}</Th>
          </tr>
        </thead>
        <tbody>
          {files.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('accidentFile.empty')}</td></tr>}
          {files.map((f) => (
            <tr key={f.id} onClick={() => navigate({ to: '/workshop/accidents/$fileId', params: { fileId: f.id } })} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
              <td className="px-3 py-2">
                <div>{[f.vehicle?.brand, f.vehicle?.model].filter(Boolean).join(' ') || '—'}</div>
                <div className="text-[12px] uppercase text-muted-foreground">{f.vehicle?.vin ?? ''}</div>
              </td>
              <td className="px-3 py-2">{f.contact ? contactDisplayName(f.contact) : '—'}</td>
              <td className="px-3 py-2 tabular-nums">{f.quote ? `${f.quote.number ?? t('sales.draftSuffix')} · ${eur(Number(f.quote.total_ht))}` : '—'}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  <AccidentStatusBadge status={f.status} />
                  {f.is_urgent && <StatusBadge tone="warning" label={t('accidentFile.urgent')} />}
                </div>
              </td>
              <td className="px-3 py-2 tabular-nums">{fmtDate(f.sent_at)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtDate(f.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</th>;
}
