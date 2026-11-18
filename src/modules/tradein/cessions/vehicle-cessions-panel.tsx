/**
 * Cessions / remises en etat d'une moto (G8 : onglet « Cessions » de la fiche produit fini) :
 * n°, type, date, montant HT, comptabilisee ou non, statut, total ; ouverture d'une nouvelle
 * cession sur la moto ; historique append-only du cout de revient. Monte sur le dossier de reprise,
 * reutilisable sur la fiche moto.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { listCessionDocs, listVehicleCostChanges, cessionsSchemaReady } from './api';
import { CessionNewDialog } from './cession-new-dialog';
import { CessionStatusBadge } from './cession-document';

const eur = (n: number | null | undefined) => (n == null ? '—' : `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '');

export function VehicleCessionsPanel({ companyId, vehicleId, vehicleLabel, canWrite = true }: {
  companyId: string;
  vehicleId: string;
  vehicleLabel: string;
  canWrite?: boolean;
}) {
  const navigate = useNavigate();
  const ready = useQuery({ queryKey: ['cessions-ready'], queryFn: cessionsSchemaReady });
  const docs = useQuery({
    queryKey: ['vehicle-cessions', vehicleId],
    queryFn: () => listCessionDocs(companyId, { vehicleId }),
    enabled: ready.data === true,
  });
  const history = useQuery({ queryKey: ['vehicle-cost-changes', vehicleId], queryFn: () => listVehicleCostChanges(vehicleId), enabled: ready.data === true });
  const [newOpen, setNewOpen] = useState(false);
  const open = (id: string) => navigate({ to: '/stock/cessions', search: { doc: id } });

  const rows = (docs.data ?? []).filter((r) => r.status !== 'annule');
  const imputed = rows.filter((r) => r.accounted && r.validated_at).reduce((s, r) => s + Number(r.total_cost) + Number(r.options_amount), 0);

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-ui text-[15px] font-bold text-foreground">{t('cession.panelTitle')}</h2>
        {canWrite && ready.data === true && <Button size="sm" onClick={() => setNewOpen(true)}><Plus /> {t('cession.panelNew')}</Button>}
      </div>
      {ready.data === false ? (
        <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('cession.schemaMissing')}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-[13px] text-muted-foreground">{t('cession.panelEmpty')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr>
              <Th>{t('cession.colNumber')}</Th><Th>{t('cession.type')}</Th><Th>{t('cession.colDate')}</Th><Th>{t('cession.status')}</Th>
              <Th>{t('cession.accountedCol')}</Th><Th>{t('cession.operator')}</Th><Th className="text-right">{t('cession.colAmountHt')}</Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => open(r.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-2 font-mono text-[12px]">{r.number}</td>
                  <td className="px-3 py-2">{r.type_label}</td>
                  <td className="px-3 py-2">{day(r.validated_at ?? r.created_at)}</td>
                  <td className="px-3 py-2"><CessionStatusBadge status={r.status} /></td>
                  <td className="px-3 py-2">{r.accounted ? t('cession.accounted') : t('cession.notAccounted')}</td>
                  <td className="px-3 py-2">{r.operator_name ?? ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.validated_at ? eur(Number(r.total_cost) + Number(r.options_amount)) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && <p className="mt-1 text-right font-data text-[13px] tabular-nums">{t('cession.panelImputed')} : <b>{eur(imputed)}</b></p>}
      {(history.data ?? []).length > 0 && (
        <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">{t('cession.costHistory')}</summary>
          <ul className="mt-1 space-y-0.5 font-data tabular-nums">
            {(history.data ?? []).map((h) => (
              <li key={h.id}>{new Date(h.occurred_at).toLocaleString('fr-BE')} · {eur(h.old_cost)} → <b>{eur(h.new_cost)}</b> · {t(`cession.source_${h.source}`)} {h.source_ref ?? ''}</li>
            ))}
          </ul>
        </details>
      )}
      {newOpen && (
        <CessionNewDialog open={newOpen} onOpenChange={setNewOpen} companyId={companyId}
          vehicle={{ id: vehicleId, label: vehicleLabel }} onCreated={open} />
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
