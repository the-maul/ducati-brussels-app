/**
 * Fiche d'une banque ou d'un leasing (Simon, 26/11/2026) : les motos qu'elle finance, avec le motard
 * propriétaire, la facture adressée à la banque (n°, date, montant) et le n° de contrat.
 * Une moto dont la banque est encore inscrite comme propriétaire (repris de G8) est signalée :
 * le vrai motard vient du DCS. Ne s'affiche pas pour un contact qui ne finance aucune moto.
 * VEH001 : les financements terminés (historique vehicle_financings) suivent ceux en cours, marqués « Terminé ».
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, Bike, CheckCircle2, History, Landmark } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { contactDisplayName } from './api';
import { eur } from '@/modules/sales/balance-panel';
import { t } from '@/lib/i18n';
import { listEndedBankFinancings, financingPeriodLabel } from '@/modules/vehicles/fiche-g8-api';
import { byMostRecent, type FinancingStatus } from '@/modules/vehicles/financing-history';

type FinancedBike = {
  key: string; status: FinancingStatus; period: string | null;
  id: string; vin: string | null; plate: string | null; brand: string | null; model: string | null;
  contract: string | null; ownerId: string | null; ownerName: string | null;
  invoice: { number: string | null; date: string | null; total: number | null } | null;
};

// Colonnes de financement pas encore dans les types générés.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

async function listFinancedBikes(bankId: string): Promise<FinancedBike[]> {
  const { data: bikes, error } = await db.from('vehicles')
    .select('id, vin, plate, brand, model, financing_contract')
    .eq('financing_contact_id', bankId).order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (bikes ?? []) as Array<{ id: string; vin: string | null; plate: string | null; brand: string | null; model: string | null; financing_contract: string | null }>;
  if (!rows.length) return [];
  const ids = rows.map((v) => v.id);
  const [owners, docs] = await Promise.all([
    supabase.from('vehicle_owners').select('vehicle_id, contact_id, contacts(first_name, last_name, company_name, type)')
      .in('vehicle_id', ids).eq('is_current', true),
    supabase.from('documents').select('vehicle_id, number, issue_date, total_ttc, status')
      .in('vehicle_id', ids).eq('contact_id', bankId).eq('doc_type', 'FAC').neq('status', 'annulee')
      .order('issue_date', { ascending: false }),
  ]);
  if (owners.error) throw owners.error;
  if (docs.error) throw docs.error;
  return rows.map((v) => {
    const o = (owners.data ?? []).find((x) => x.vehicle_id === v.id) as
      { contact_id: string; contacts: Parameters<typeof contactDisplayName>[0] | null } | undefined;
    const d = (docs.data ?? []).find((x) => x.vehicle_id === v.id) as
      { number: string | null; issue_date: string | null; total_ttc: number | string | null } | undefined;
    return {
      key: v.id, status: 'current' as const, period: null,
      id: v.id, vin: v.vin, plate: v.plate, brand: v.brand, model: v.model, contract: v.financing_contract,
      ownerId: o?.contact_id ?? null, ownerName: o?.contacts ? contactDisplayName(o.contacts) : null,
      invoice: d ? { number: d.number, date: d.issue_date, total: d.total_ttc == null ? null : Number(d.total_ttc) } : null,
    };
  });
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '—');

/** Financements terminés de cette banque : le client financé à la place du propriétaire actuel. */
async function listEndedBikes(bankId: string): Promise<FinancedBike[]> {
  const rows = (await listEndedBankFinancings(bankId)).filter((f) => f.vehicle).sort(byMostRecent);
  return rows.map((f) => ({
    key: f.id, status: 'ended' as const, period: financingPeriodLabel(f),
    id: f.vehicle!.id, vin: f.vehicle!.vin, plate: f.vehicle!.plate, brand: f.vehicle!.brand, model: f.vehicle!.model,
    contract: f.contract, ownerId: f.client?.id ?? null, ownerName: f.client ? contactDisplayName(f.client) : null,
    invoice: f.doc ? { number: f.doc.number, date: f.doc.issue_date, total: f.doc.total_ttc == null ? null : Number(f.doc.total_ttc) }
      : f.source_invoice ? { number: f.source_invoice, date: f.started_on, total: null } : null,
  }));
}

function StatusTag({ status }: { status: FinancingStatus }) {
  return status === 'current' ? (
    <span className="inline-flex items-center gap-1 rounded bg-success-bg px-2 py-0.5 text-[12px] font-bold text-success">
      <CheckCircle2 className="size-3.5" aria-hidden /> {t('dossier.financingCurrent')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-neutral-bg px-2 py-0.5 text-[12px] font-bold text-neutral-tag">
      <History className="size-3.5" aria-hidden /> {t('dossier.financingEnded')}
    </span>
  );
}

export function FinancedBikes({ contactId }: { contactId: string }) {
  const q = useQuery({ queryKey: ['financed-bikes', contactId], queryFn: () => listFinancedBikes(contactId) });
  const ended = useQuery({ queryKey: ['financed-bikes-ended', contactId], queryFn: () => listEndedBikes(contactId) });
  const current = q.data ?? [];
  const rows = [...current, ...(ended.data ?? [])];
  if (!rows.length) return null;
  const total = current.reduce((s, r) => s + (r.invoice?.total ?? 0), 0);
  return (
    <section className="mb-5 space-y-2" aria-label={t('dossier.financedTitle')}>
      <h3 className="flex items-center gap-2 font-ui text-[15px] font-bold">
        <Landmark className="size-4" aria-hidden /> {t('dossier.financedTitle')}
        <span className="text-[13px] font-normal text-muted-foreground">· {current.length} · {eur(total)}</span>
      </h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr className="text-left text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              <th className="px-3 py-2">{t('dossier.financedStatus')}</th>
              <th className="px-3 py-2">{t('dossier.financedBike')}</th>
              <th className="px-3 py-2">VIN</th>
              <th className="px-3 py-2">{t('dossier.financedPlate')}</th>
              <th className="px-3 py-2">{t('dossier.financedOwner')}</th>
              <th className="px-3 py-2">{t('dossier.financedInvoice')}</th>
              <th className="px-3 py-2 text-right">{t('dossier.financedAmount')}</th>
              <th className="px-3 py-2">{t('dossier.financingContract')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bankIsOwner = r.status === 'current' && r.ownerId === contactId;
              return (
                <tr key={r.key} className="border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-2">
                    <StatusTag status={r.status} />
                    {r.period && <div className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">{r.period}</div>}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <Link to="/vehicles/$vehicleId" params={{ vehicleId: r.id }} className="underline-offset-2 hover:underline">
                      <Bike className="mr-1 inline size-4" aria-hidden />{[r.brand, r.model].filter(Boolean).join(' ') || r.vin || '—'}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.vin ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.plate ?? '—'}</td>
                  <td className="px-3 py-2">
                    {bankIsOwner ? (
                      <span className="inline-flex items-center gap-1 rounded bg-warning-bg px-2 py-0.5 text-[12px] font-bold text-warning">
                        <AlertTriangle className="size-3.5" aria-hidden /> {t('dossier.financedOwnerToFix')}
                      </span>
                    ) : r.ownerId ? (
                      <Link to="/clients/$contactId" params={{ contactId: r.ownerId }} className="underline-offset-2 hover:underline">{r.ownerName ?? '—'}</Link>
                    ) : <span className="text-muted-foreground">{t('dossier.financedNoOwner')}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.invoice ? `${r.invoice.number ?? '—'} · ${fmtDate(r.invoice.date)}` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.invoice?.total != null ? eur(r.invoice.total) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.contract ?? <span className="text-muted-foreground">{t('dossier.financedNoContract')}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
