/**
 * M8 — « Contrôle du temps atelier » avant la facture d'un OR (G8, 07-atelier §4 « Passage en
 * facture ») : une ligne par main-d'oeuvre (mécanicien, date, heures facturées, passées, internes,
 * garanties), modifiable ; rapprochement temps passé / facturé / pointé en bas. Valider enregistre
 * le temps (quantité de la MO = heures facturées) puis lance la facture.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { controlLineHt, controlRows, hoursOrNull, normalizeControlRow, reconcile, type ControlLineSource, type ControlRow } from './rules';
import { getOrPointedTime, listMechanics } from './api';

const NONE = ' none';
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const hrs = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${String(Math.round(n * 100) / 100).replace('.', ',')} h`);
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

type Draft = Omit<ControlRow, 'billed' | 'worked' | 'internal' | 'warranty'> & { billed: string; worked: string; internal: string; warranty: string };

export function TimeControlDialog({ companyId, orId, orNumber, lines, busy, error, onConfirm, onCancel }: {
  companyId: string; orId: string; orNumber: string | null;
  lines: ControlLineSource[];
  busy: boolean; error?: string | null;
  onConfirm: (rows: ControlRow[]) => void;
  onCancel: () => void;
}) {
  const mechanicsQ = useQuery({ queryKey: ['workshop-mechanics', companyId], queryFn: () => listMechanics(companyId), staleTime: 300_000 });
  const pointedQ = useQuery({ queryKey: ['or-pointed-time', orId], queryFn: () => getOrPointedTime(orId) });
  const mechanics = mechanicsQ.data ?? [];
  const pointed = useMemo(() => pointedQ.data ?? [], [pointedQ.data]);
  const today = new Date().toISOString().slice(0, 10);

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const initial = useMemo<Draft[]>(() => controlRows(lines, pointed, today).map((r) => ({
    ...r, billed: fmt(r.billed), worked: fmt(r.worked), internal: fmt(r.internal || null), warranty: fmt(r.warranty || null),
  })), [lines, pointed, today]);
  const rows = drafts ?? initial;
  const set = (id: string, patch: Partial<Draft>) => setDrafts((ds) => (ds ?? initial).map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const parsed: (ControlRow & { billedReset: boolean })[] = rows.map((d) => normalizeControlRow({
    ...d, billed: hoursOrNull(d.billed) ?? 0, worked: hoursOrNull(d.worked), internal: hoursOrNull(d.internal) ?? 0, warranty: hoursOrNull(d.warranty) ?? 0,
  }));
  const totalPointed = pointed.reduce((s, p) => s + p.pointed_h, 0);
  const rec = reconcile(parsed, totalPointed);
  const totalHt = parsed.reduce((s, r) => s + controlLineHt(r), 0);
  const loading = pointedQ.isLoading || mechanicsQ.isLoading;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clock className="size-5" aria-hidden /> {t('labourTime.controlTitle')}{orNumber ? ` · OR ${orNumber}` : ''}</DialogTitle>
          <DialogDescription>{t('labourTime.controlIntro')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="sticky top-0 bg-muted"><tr>
                <Th>{t('workshop.colDesignation')}</Th><Th className="w-44">{t('labourTime.mechanic')}</Th><Th className="w-36">{t('labourTime.workDate')}</Th>
                <Th className="w-20 text-right">{t('labourTime.colBilled')}</Th><Th className="w-20 text-right">{t('labourTime.colWorked')}</Th>
                <Th className="w-20 text-right">{t('labourTime.colInternal')}</Th><Th className="w-20 text-right">{t('labourTime.colWarranty')}</Th>
                <Th className="w-24 text-right">{t('workshop.colLineHt')}</Th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">{t('labourTime.noMoLines')}</td></tr>}
                {rows.map((d, i) => {
                  const p = parsed[i];
                  return (
                    <tr key={d.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-3 py-1.5">
                        {d.designation}
                        {p.billedReset && <p className="mt-1 flex items-start gap-1 text-[12px] text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('labourTime.billedResetHint')}</p>}
                      </td>
                      <td className="px-2 py-1">
                        {mechanics.length > 0 ? (
                          <Select value={d.mechanic_code || NONE} onValueChange={(v) => { const m = mechanics.find((x) => x.code === v); set(d.id, { mechanic_code: m?.code ?? null, mechanic_name: m?.name ?? null }); }}>
                            <SelectTrigger className="h-8"><SelectValue placeholder={d.mechanic_name ?? undefined} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{d.mechanic_name && !d.mechanic_code ? d.mechanic_name : t('orPage.none')}</SelectItem>
                              {mechanics.map((m) => <SelectItem key={m.code} value={m.code}>{m.code} · {m.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input value={d.mechanic_name ?? ''} onChange={(e) => set(d.id, { mechanic_name: e.target.value || null, mechanic_code: null })} className="h-8" />
                        )}
                      </td>
                      <td className="px-2 py-1"><Input type="date" value={d.work_date} onChange={(e) => set(d.id, { work_date: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Hours value={d.billed} onChange={(v) => set(d.id, { billed: v })} /></td>
                      <td className="px-2 py-1"><Hours value={d.worked} onChange={(v) => set(d.id, { worked: v })} /></td>
                      <td className="px-2 py-1"><Hours value={d.internal} onChange={(v) => set(d.id, { internal: v })} /></td>
                      <td className="px-2 py-1"><Hours value={d.warranty} onChange={(v) => set(d.id, { warranty: v })} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{eur(controlLineHt(p))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Rapprochement temps passé / temps facturé (B11) */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-border bg-card px-4 py-3 font-data text-[13px] tabular-nums sm:grid-cols-4">
          <Kv label={t('labourTime.colBilled')} value={hrs(rec.billed)} strong />
          <Kv label={t('labourTime.colWorked')} value={hrs(rec.worked)} />
          <Kv label={t('labourTime.pointedOnOr')} value={hrs(rec.pointed)} />
          <Kv label={t('labourTime.col_notBilled')} value={hrs(rec.notBilled)} />
          <Kv label={t('labourTime.colInternal')} value={hrs(rec.internal)} />
          <Kv label={t('labourTime.colWarranty')} value={hrs(rec.warranty)} />
          <Kv label={t('labourTime.col_billedPct')} value={rec.billedPct === null ? '—' : `${String(rec.billedPct).replace('.', ',')} %`} />
          <Kv label={t('labourTime.moTotalHt')} value={eur(totalHt)} strong />
        </div>
        {pointed.length > 0 && (
          <p className="text-[12px] text-muted-foreground">
            {t('labourTime.pointedDetail')} : {pointed.map((p) => `${p.mechanic_name || p.mechanic_code || p.mechanic_key} ${hrs(p.pointed_h)}`).join(' · ')}
          </p>
        )}
        {rec.gapPointed !== 0 && rec.pointed > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('labourTime.gapHint').replace('{gap}', hrs(Math.abs(rec.gapPointed)))}
          </p>
        )}
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>{t('labourTime.cancel')}</Button>
          <Button onClick={() => onConfirm(parsed.map(({ billedReset: _r, ...r }) => r))} disabled={busy || loading}>
            {busy ? <Loader2 className="animate-spin" /> : null} {t('labourTime.controlConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Hours({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-right tabular-nums" />;
}
function Kv({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-2"><span className="text-muted-foreground">{label}</span>{strong ? <b>{value}</b> : <span>{value}</span>}</div>;
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
