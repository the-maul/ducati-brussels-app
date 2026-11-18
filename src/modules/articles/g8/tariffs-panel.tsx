/**
 * M2 — Rattrapage G8 (18/11/2026) : suivi des tarifs fournisseurs (G8 « Mise à jour de tarifs » :
 * Tarif · Fichier · Date du tarif · Status · Date d'installation) et « fichier perso » par
 * fournisseur. Posés sur l'écran Import (/parts/import), qui reste le seul moteur d'import
 * (tarif Ducati ListPrice compris).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Save, Wand2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { fillVars, t } from '@/lib/i18n';
import { useReadOnly } from '@/lib/auth/read-only-context';
import {
  G8SchemaMissingError, createSupplierTariff, getTariffFormat, listSupplierTariffs, saveTariffFormat, updateSupplierTariff,
  type SupplierTariff, type TariffStatus,
} from './api';
import { mappingToNames, namesToMapping, type IndexMapping } from './tariff-format';
import { Empty, QueryError, Td, Th, dateFr, dateTimeFr, errorText } from './ui';

/** Boutons « Reprendre / Enregistrer le format perso » du fournisseur du fichier. */
export function TariffFormatBar({ companyId, supplierName, headers, mapping, onApply }: {
  companyId: string; supplierName: string; headers: string[]; mapping: IndexMapping;
  onApply: (m: IndexMapping) => void;
}) {
  const readOnly = useReadOnly();
  const name = supplierName.trim();
  const fmtQ = useQuery({
    queryKey: ['g8-tariff-format', companyId, name.toLowerCase()],
    queryFn: () => getTariffFormat(companyId, name),
    enabled: !!name,
    retry: false,
  });
  const save = useMutation({
    meta: { success: false },
    mutationFn: () => saveTariffFormat(companyId, name, mappingToNames(mapping, headers)),
    onSuccess: () => { void fmtQ.refetch(); toast.success(fillVars(t('g8a.tariffs.formatSaved'), { supplier: name })); },
    onError: (e) => toast.error(errorText(e)),
  });
  if (!name) return <p className="text-[12px] text-muted-foreground">{t('g8a.tariffs.formatNeedSupplier')}</p>;
  const reuse = () => {
    if (!fmtQ.data) return;
    const { mapping: m, missing } = namesToMapping(fmtQ.data.mapping ?? {}, headers);
    onApply(m);
    if (missing.length) toast.warning(fillVars(t('g8a.tariffs.formatMissing'), { cols: missing.join(', ') }));
    else toast.success(t('g8a.tariffs.formatApplied'));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!fmtQ.data} onClick={reuse}>
        <Wand2 /> {fmtQ.data ? fillVars(t('g8a.tariffs.formatReuse'), { supplier: fmtQ.data.supplier_name }) : t('g8a.tariffs.formatNone')}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={readOnly || save.isPending || mapping.reference == null} onClick={() => save.mutate()}>
        <Save /> {t('g8a.tariffs.formatSave')}
      </Button>
      {fmtQ.error instanceof G8SchemaMissingError && <span className="text-[12px] text-warning">{t('g8a.schemaMissing')}</span>}
    </div>
  );
}

/**
 * Inscrit un tarif au registre. Sans la migration : ne bloque pas l'import (renvoie false,
 * l'appelant affiche un avertissement).
 */
export async function recordTariff(companyId: string, t0: Partial<SupplierTariff> & { supplier_name: string }): Promise<boolean> {
  try {
    await createSupplierTariff(companyId, t0);
    return true;
  } catch (e) {
    if (e instanceof G8SchemaMissingError) return false;
    throw e;
  }
}

const STATUS_TONE: Record<TariffStatus, { tone: 'success' | 'warning' | 'neutral'; icon: typeof Clock }> = {
  installe: { tone: 'success', icon: CheckCircle2 },
  en_attente: { tone: 'warning', icon: Clock },
  abandonne: { tone: 'neutral', icon: XCircle },
};

export function TariffTrackingPanel({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const q = useQuery({ queryKey: ['g8-tariffs', companyId], queryFn: () => listSupplierTariffs(companyId) });
  const upd = useMutation({
    meta: { success: false },
    mutationFn: ({ id, status }: { id: string; status: TariffStatus }) =>
      updateSupplierTariff(id, status === 'installe' ? { status, installed_at: new Date().toISOString() } : { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['g8-tariffs', companyId] }),
    onError: (e) => toast.error(errorText(e)),
  });
  const rows = q.data ?? [];
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">{t('g8a.tariffs.hint')}</p>
      <QueryError error={q.error} />
      {rows.length === 0 ? (!q.error && <Empty>{t('g8a.tariffs.empty')}</Empty>) : (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('g8a.tariffs.colSupplier')}</Th><Th>{t('g8a.tariffs.colFile')}</Th><Th>{t('g8a.tariffs.colDate')}</Th>
                <Th>{t('g8a.tariffs.colStatus')}</Th><Th>{t('g8a.tariffs.colInstalled')}</Th><Th className="text-right">{t('g8a.tariffs.colRows')}</Th><Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS_TONE[r.status] ?? STATUS_TONE.en_attente;
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <Td>{r.supplier_name}{r.label ? <span className="block text-[11px] text-muted-foreground">{r.label}</span> : null}</Td>
                    <Td className="font-mono text-[12px]">{r.file_name ?? '—'}</Td>
                    <Td>{dateFr(r.tariff_date)}</Td>
                    <Td><StatusBadge tone={st.tone} icon={st.icon} label={t(`g8a.tariffs.status_${r.status}`)} /></Td>
                    <Td className="whitespace-nowrap">{dateTimeFr(r.installed_at)}</Td>
                    <Td className="text-right tabular-nums">
                      {r.rows_count != null ? fillVars(t('g8a.tariffs.rowsDetail'), { n: r.rows_count, c: r.created_count ?? 0, u: r.updated_count ?? 0 }) : '—'}
                    </Td>
                    <Td className="text-right">
                      {r.status === 'en_attente' && !readOnly && (
                        <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: r.id, status: 'abandonne' })}>{t('g8a.tariffs.abandon')}</Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
