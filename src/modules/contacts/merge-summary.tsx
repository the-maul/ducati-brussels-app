/**
 * M1 — Récapitulatif avant fusion de fiches.
 *
 * Dit clairement quelle fiche est GARDÉE, lesquelles sont absorbées puis archivées, et
 * ce qui sera rapatrié (documents, motos, échanges, pièces jointes...). Les chiffres
 * viennent de la base (`contact_merge_preview`), comme les blocages éventuels (deux
 * comptes client, deux soldes d'ouverture) : l'écran les montre avant que l'on clique.
 */
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { t } from '@/lib/i18n';

import {
  contactDisplayName, getMergePreview, mergeCodeLabel, mergeErrorMessage,
  type Contact, type MergeCounts, type MergePreview,
} from './api';

/** Rubriques montrées en clair ; le reste est regroupé sous « autres éléments ». */
const MAIN_KEYS: { key: string; label: string }[] = [
  { key: 'documents', label: 'contacts.mergeCountDocuments' },
  { key: 'vehicle_owners', label: 'contacts.mergeCountVehicles' },
  { key: 'communications', label: 'contacts.mergeCountCommunications' },
  { key: 'attachments', label: 'contacts.mergeCountAttachments' },
  { key: 'repair_orders', label: 'contacts.mergeCountRepairOrders' },
  { key: 'workshop_appointments', label: 'contacts.mergeCountAppointments' },
  { key: 'leads', label: 'contacts.mergeCountLeads' },
];

function sumCounts(previews: MergePreview[]): MergeCounts {
  const total: MergeCounts = {};
  for (const p of previews) {
    for (const [k, v] of Object.entries(p.counts ?? {})) total[k] = (total[k] ?? 0) + Number(v ?? 0);
  }
  return total;
}

/**
 * Aperçus de fusion de chaque fiche de `absorbed` dans `keep`. `ready && !blocked`
 * indique à l'appelant qu'il peut activer son bouton « Fusionner ».
 */
export function useMergePreviews(keep: Contact | null, absorbed: Contact[], enabled: boolean) {
  const results = useQueries({
    queries: absorbed.map((a) => ({
      queryKey: ['contact-merge-preview', keep?.id, a.id],
      queryFn: () => getMergePreview(keep!.id, a.id),
      enabled: enabled && !!keep && a.id !== keep.id,
      staleTime: 0,
    })),
  });
  const loading = results.some((r) => r.isLoading);
  const error = results.find((r) => r.error)?.error ?? null;
  const previews = results.map((r) => r.data).filter((d): d is MergePreview => !!d);
  const blockers = previews.flatMap((p) => (p.blockers ?? []).map((code) => ({ id: p.absorbed_id, code })));
  const ready = !loading && !error && previews.length === absorbed.length && absorbed.length > 0;
  return { loading, error, previews, blockers, ready, blocked: blockers.length > 0 || !!error };
}

export function MergeSummary({ keep, absorbed, preview }: {
  keep: Contact;
  absorbed: Contact[];
  preview: ReturnType<typeof useMergePreviews>;
}) {
  const nameOf = (c: Contact) => `${c.code ? `${c.code} · ` : ''}${contactDisplayName(c)}`;
  const byId = new Map(absorbed.map((c) => [c.id, c]));
  const total = sumCounts(preview.previews);
  const mainTotal = MAIN_KEYS.reduce((s, { key }) => s + (total[key] ?? 0), 0);
  const all = Object.values(total).reduce((s, v) => s + v, 0);
  const others = all - mainTotal;

  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3 text-[13px]">
      <p>
        <span className="font-medium">{t('contacts.mergeKeptLabel')}</span>{' '}
        <span className="font-medium text-foreground">{nameOf(keep)}</span>
      </p>
      <p>
        <span className="font-medium">{t('contacts.mergeAbsorbedLabel')}</span>{' '}
        {absorbed.map(nameOf).join(', ')}
      </p>

      {preview.loading && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t('contacts.mergePreviewLoading')}
        </p>
      )}

      {!preview.loading && preview.previews.length > 0 && (
        <div>
          <p className="font-medium">{t('contacts.mergeWillMove')}</p>
          {all === 0 ? (
            <p className="text-muted-foreground">{t('contacts.mergeNothingToMove')}</p>
          ) : (
            <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
              {MAIN_KEYS.filter(({ key }) => (total[key] ?? 0) > 0).map(({ key, label }) => (
                <li key={key}>{t(label).replace('{n}', String(total[key]))}</li>
              ))}
              {others > 0 && <li>{t('contacts.mergeCountOthers').replace('{n}', String(others))}</li>}
            </ul>
          )}
          <p className="mt-1 text-muted-foreground">{t('contacts.mergeFillRule')}</p>
        </div>
      )}

      {preview.error && (
        <p className="flex items-center gap-2 rounded bg-danger-bg px-2 py-1 text-danger">
          <AlertTriangle className="size-4 shrink-0" /> {mergeErrorMessage(preview.error)}
        </p>
      )}
      {preview.blockers.map((b) => (
        <p key={`${b.id}-${b.code}`} className="flex items-center gap-2 rounded bg-danger-bg px-2 py-1 text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {byId.get(b.id) ? `${nameOf(byId.get(b.id)!)} : ` : ''}{mergeCodeLabel(b.code)}
        </p>
      ))}
    </div>
  );
}
