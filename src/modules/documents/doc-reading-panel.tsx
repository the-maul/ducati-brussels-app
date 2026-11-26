/**
 * M9 (Simon, 26/11/2026) — panneau « Lu dans le fichier » : après la lecture automatique d'un fichier
 * de la fiche client ou moto, montre le type reconnu, le dossier de rangement, et pour chaque
 * information : valeur lue / valeur de la fiche (même principe que le bloc DCS).
 *   - case vide → « À remplir », écrite par « Tout appliquer » ;
 *   - contradiction → orange, « Prendre le fichier » ou « Garder la fiche » en un clic ;
 *   - valeur certifiée DCS → jamais modifiée.
 * Rien n'est écrit sans clic ; chaque écriture est tracée dans events avec le fichier source.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDot, FileSearch, Info, Loader2, Lock, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t, fillVars } from '@/lib/i18n';
import { applyReading, loadReadingContext, type ReadableAttachment } from './doc-reading-api';
import { buildProposals, fillKeys, type Note, type Proposal, type ProposalState } from './doc-reading-rules';

const L = (k: string) => t(`lectureFichiers.${k}`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (v: string | null) => (v && DATE_RE.test(v) ? new Date(`${v}T12:00:00`).toLocaleDateString('fr-BE') : v ?? '—');
const money = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

function noteText(n: Note): string {
  switch (n.code) {
    case 'other_vehicle': return fillVars(L('note_other_vehicle'), { vin: n.vin });
    case 'vehicle_not_found': return fillVars(L('note_vehicle_not_found'), { id: n.vin ?? n.plate ?? '' });
    case 'name_mismatch': return fillVars(L('note_name_mismatch'), { read: n.read, current: n.current });
    case 'bank_not_found': return fillVars(L('note_bank_not_found'), { name: n.name });
    case 'warranty_unknown': return fillVars(L('note_warranty_unknown'), { raw: n.raw });
    case 'delivery_date': return fillVars(L('note_delivery_date'), { date: fmt(n.date) });
    case 'inspection_date': return fillVars(L('note_inspection_date'), { date: fmt(n.date) });
    default: return L(`note_${n.code}`);
  }
}

const STATE_STYLE: Record<ProposalState, { cls: string; Icon: typeof Info }> = {
  fill: { cls: 'bg-info-bg text-info', Icon: CircleDot },
  same: { cls: 'bg-success-bg text-success', Icon: CheckCircle2 },
  conflict: { cls: 'bg-warning-bg text-warning', Icon: AlertTriangle },
  locked: { cls: 'bg-muted text-muted-foreground', Icon: Lock },
};

export function DocReadingPanel({ companyId, entityType, entityId, attachment, onClose, onApplied }: {
  companyId: string; entityType: 'contact' | 'vehicle'; entityId: string; attachment: ReadableAttachment;
  onClose: () => void; onApplied?: () => void;
}) {
  const qc = useQueryClient();
  const reading = attachment.extracted ?? null;
  const [kept, setKept] = useState<Set<string>>(new Set());
  const ctxQ = useQuery({
    queryKey: ['doc-reading-ctx', attachment.id, attachment.read_at ?? null],
    queryFn: () => loadReadingContext(companyId, entityType, entityId, reading!),
    enabled: !!reading,
  });
  const built = useMemo(() => (reading && ctxQ.data ? buildProposals(reading, ctxQ.data) : null), [reading, ctxQ.data]);
  const proposals = (built?.proposals ?? []).filter((p) => !kept.has(p.key));
  const fills = fillKeys(proposals);

  const apply = useMutation({
    meta: { success: false, error: false },
    mutationFn: (keys: string[]) => applyReading(companyId, ctxQ.data!, built!.proposals, keys, attachment),
    onSuccess: (n) => {
      toast.success(fillVars(L('applied'), { n: String(n) }));
      if (ctxQ.data?.contact) qc.invalidateQueries({ queryKey: ['contact', ctxQ.data.contact.id] });
      if (ctxQ.data?.vehicle) qc.invalidateQueries({ queryKey: ['vehicle', ctxQ.data.vehicle.id] });
      qc.invalidateQueries({ queryKey: ['doc-reading-ctx', attachment.id] });
      onApplied?.();
    },
    onError: () => toast.error(L('err_apply')),
  });

  if (!reading) return null;
  const target = (p: Proposal) => (p.target === 'contact' ? L('targetContact') : L('targetVehicle'));
  const r = reading.receipt;

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 font-ui text-[13px] font-bold"><FileSearch className="size-4 text-info" />{fillVars(L('panelTitle'), { file: attachment.file_name })}</p>
          <p className="text-[12px] text-muted-foreground">
            {L('kindLabel')} : <span className="font-semibold text-foreground">{t(`lectureFichiers.kind.${reading.doc_kind}`)}</span>
            {attachment.folder ? <> · {fillVars(L('filedIn'), { folder: attachment.folder })}</> : null}
          </p>
          {reading.summary && <p className="text-[12px] text-muted-foreground">{reading.summary}</p>}
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} title={L('close')}><X className="size-4" /></Button>
      </div>

      {reading.confidence === 'low' && (
        <p className="flex items-center gap-1.5 rounded-md bg-warning-bg px-2 py-1.5 text-[12px] text-warning"><AlertTriangle className="size-3.5" />{L('confidenceLow')}</p>
      )}
      {(built?.notes ?? []).map((n, i) => (
        <p key={i} className="flex items-start gap-1.5 rounded-md bg-info-bg px-2 py-1.5 text-[12px] text-info"><Info className="mt-0.5 size-3.5 shrink-0" />{noteText(n)}</p>
      ))}

      {ctxQ.isLoading ? <div className="grid place-items-center py-3"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div> : proposals.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr>
                <Th>{L('colInfo')}</Th><Th>{L('colInFile')}</Th><Th>{L('colOnRecord')}</Th><Th /><Th />
              </tr></thead>
              <tbody>
                {proposals.map((p) => {
                  const st = STATE_STYLE[p.state];
                  return (
                    <tr key={p.key} className={`border-b border-border last:border-0 ${p.state === 'conflict' ? 'bg-warning-bg' : ''}`}>
                      <td className="px-3 py-1.5"><span className="text-muted-foreground">{target(p)} · </span>{t(`lectureFichiers.field.${p.field}`)}</td>
                      <td className="px-3 py-1.5 font-mono text-[12px]">{fmt(p.readLabel)}</td>
                      <td className="px-3 py-1.5 font-mono text-[12px] text-muted-foreground">{fmt(p.currentLabel)}</td>
                      <td className="px-3 py-1.5"><span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${st.cls}`}><st.Icon className="size-3" />{L(`state_${p.state}`)}</span></td>
                      <td className="whitespace-nowrap px-2 py-1 text-right">
                        {p.state === 'conflict' && (
                          <>
                            <Button size="sm" variant="outline" disabled={apply.isPending} onClick={() => apply.mutate([p.key])}>{L('takeDoc')}</Button>{' '}
                            <Button size="sm" variant="ghost" disabled={apply.isPending} onClick={() => setKept((s) => new Set(s).add(p.key))}>{L('keepRecord')}</Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {fills.length > 0
            ? <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate(fills)}>{apply.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {fillVars(L('applyAll'), { n: String(fills.length) })}</Button>
            : <p className="text-[12px] text-muted-foreground">{L('upToDate')}</p>}
        </>
      ) : !r && <p className="text-[12px] text-muted-foreground">{L('nothingRead')}</p>}

      {r && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <p className="font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{L('receiptTitle')}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-3">
            <Item label={L('receiptSupplier')} value={r.supplier ?? '—'} />
            <Item label={L('receiptNumber')} value={r.number ?? '—'} />
            <Item label={L('receiptDate')} value={fmt(r.date)} />
            <Item label={L('receiptHt')} value={money(r.total_ht)} num />
            <Item label={L('receiptVat')} value={money(r.total_vat)} num />
            <Item label={L('receiptTtc')} value={money(r.total_ttc)} num />
          </dl>
          {r.lines.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse font-data text-[12px]">
                <thead className="bg-muted"><tr><Th>{L('colLabel')}</Th><Th className="text-right">{L('colQty')}</Th><Th className="text-right">{L('colUnit')}</Th><Th className="text-right">{L('colTotal')}</Th></tr></thead>
                <tbody>
                  {r.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-1">{l.label ?? '—'}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{l.quantity ?? '—'}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{money(l.unit_price)}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{money(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{L('receiptNoAccounting')}</p>
        </div>
      )}
    </div>
  );
}

function Item({ label, value, num }: { label: string; value: string; num?: boolean }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className={num ? 'tabular-nums' : ''}>{value}</dd></div>;
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-1.5 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
