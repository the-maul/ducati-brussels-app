/**
 * M5 — Grille de réajustement (B6) : sur le STOCK RÉEL ou sur un ARRÊTÉ, en 3 modes
 * (annule et remplace · cumul multi-emplacements · par casier à la volée).
 * La liste couvre TOUS les articles stockés (pas seulement ceux déjà mouvementés) et se
 * filtre en base (scan douchette, casier, « pas encore comptés »). Chaque saisie validée
 * est un mouvement / une ligne de réajustement tracée (ancien → nouveau, opérateur, heure).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eraser, Loader2, ScanLine, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { useDeviceSetup } from '@/lib/devices/use-devices';
import { t, fillVars } from '@/lib/i18n';
import { listCountRows, adjustSnapshot, readjustReal, enqueueLabels, type CountScope, type AdjustResult } from './g8-api';
import type { ReadjustMode } from './inventory-rules';
import { MicroficheImportButton, type MicroficheItem } from '@/modules/articles/g8/microfiche-import';

export type ReadjustTarget = { kind: 'reel'; ref?: string | null } | { kind: 'arrete'; snapshotId: string };

const MODES: ReadjustMode[] = ['annule_remplace', 'cumul', 'casier'];
const SCOPES: CountScope[] = ['stock', 'tous', 'non_comptes'];
const PAGE = 200;
const num = (s: string) => { const v = Number(String(s).replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

export function ReadjustGrid({ companyId, target, defaultMode = 'annule_remplace', onApplied }: {
  companyId: string; target: ReadjustTarget; defaultMode?: ReadjustMode; onApplied?: () => void;
}) {
  const qc = useQueryClient();
  const devices = useDeviceSetup(companyId);
  const [mode, setMode] = useState<ReadjustMode>(defaultMode);
  const [scope, setScope] = useState<CountScope>('stock');
  const [bin, setBin] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(1);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [withLabels, setWithLabels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ ref: string; r: AdjustResult }[]>([]);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const snapshotId = target.kind === 'arrete' ? target.snapshotId : null;

  useEffect(() => setMode(defaultMode), [defaultMode]);

  // Mode casier : le casier saisi filtre la liste, sauf si l'on scanne un article « à la volée ».
  const binFilter = mode === 'casier' ? (search ? '' : bin) : bin;
  const key = ['count-list', companyId, snapshotId, scope, search, binFilter, pages];
  const listQ = useQuery({
    queryKey: key,
    queryFn: () => listCountRows(companyId, { snapshotId, scope: target.kind === 'reel' && scope === 'non_comptes' ? 'stock' : scope, search, bin: binFilter, limit: Math.min(PAGE * pages, 1000) }),
  });
  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  const total = rows[0]?.total_count ?? 0;

  // Scan : un seul résultat → curseur directement sur sa quantité.
  useEffect(() => {
    if (search && rows.length === 1) inputRefs.current[rows[0].article_id]?.focus();
  }, [search, rows]);

  const filled = Object.entries(inputs).filter(([, v]) => v.trim() !== '' && Number.isFinite(num(v)));
  // G8 « Import microfiches » (lot G8 articles du 18/11/2026) : les quantités du fichier deviennent des
  // saisies (cumulées avec une saisie déjà faite) ; un article hors de la page affichée est compté quand même.
  const importMicrofiche = (items: MicroficheItem[]) => {
    setInputs((p) => {
      const n = { ...p };
      for (const { article, quantity } of items) {
        const prev = n[article.id]?.trim() && Number.isFinite(num(n[article.id])) ? num(n[article.id]) : 0;
        n[article.id] = String(Math.round((prev + quantity) * 1000) / 1000);
      }
      return n;
    });
    const shown = new Set(rows.map((r) => r.article_id));
    toast.success(fillVars(t('g8a.micro.inventoryDone'), { n: items.length, hidden: items.filter((x) => !shown.has(x.article.id)).length }));
  };

  const apply = async () => {
    if (mode === 'casier' && !bin.trim()) { toast.error(t('stockG8.count.binRequired')); return; }
    setBusy(true);
    const done: { id: string; ref: string; r: AdjustResult }[] = [];
    try {
      for (const [articleId, v] of filled) {
        const row = rows.find((r) => r.article_id === articleId);
        const ref = row?.reference ?? articleId;
        try {
          const r = target.kind === 'arrete'
            ? await adjustSnapshot(target.snapshotId, articleId, num(v), mode, mode === 'casier' ? bin : null)
            : await readjustReal(articleId, num(v), mode, mode === 'casier' ? bin : null, target.ref ?? null);
          done.push({ id: articleId, ref, r });
        } catch (e) {
          toast.error(fillVars(t('stockG8.count.applyErr'), { ref, msg: errMsg(e) }));
        }
      }
      if (done.length) {
        toast.success(fillVars(t('stockG8.count.applied'), { n: done.length }));
        setLast((p) => [...done.map(({ ref, r }) => ({ ref, r })), ...p].slice(0, 30));
        setInputs((p) => { const n = { ...p }; for (const d of done) delete n[d.id]; return n; });
        if (withLabels) {
          const items = done.filter((d) => d.r.new > 0).map((d) => ({ article_id: d.id, qty: Math.round(d.r.new) }));
          if (items.length) {
            const nq = await enqueueLabels(companyId, items, {
              workstationId: devices.workstation?.id ?? null, source: 'reajustement', withBarcode: true, withPrice: true, withTarif: false,
            });
            toast.success(fillVars(t('stockG8.count.labelsQueued'), { n: nq }));
          }
        }
        qc.invalidateQueries({ queryKey: ['count-list', companyId] });
        qc.invalidateQueries({ queryKey: ['stock', companyId] });
        onApplied?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Lbl>{t('stockG8.count.mode')}</Lbl>
          <Select value={mode} onValueChange={(v) => setMode(v as ReadjustMode)}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>{MODES.map((m) => <SelectItem key={m} value={m}>{t(`stockG8.count.mode_${m}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Lbl>{t('stockG8.count.bin')}</Lbl>
          <Input className="w-32 font-mono" maxLength={12} value={bin} onChange={(e) => { setBin(e.target.value.toUpperCase()); setPages(1); }} />
        </div>
        <div className="space-y-1">
          <Lbl>{t('stockG8.count.scope')}</Lbl>
          <Select value={scope} onValueChange={(v) => { setScope(v as CountScope); setPages(1); }}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SCOPES.filter((s) => target.kind === 'arrete' || s !== 'non_comptes').map((s) => <SelectItem key={s} value={s}>{t(`stockG8.count.scope_${s}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <form className="flex flex-1 items-end gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(draft.trim()); setPages(1); }}>
          <div className="min-w-64 flex-1 space-y-1">
            <Lbl>{t('stockG8.count.search')}</Lbl>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          </div>
          <Button type="submit" variant="outline"><ScanLine /></Button>
          <MicroficheImportButton companyId={companyId} onImport={importMicrofiche} />
          {search && <Button type="button" variant="ghost" onClick={() => { setDraft(''); setSearch(''); }}><X /></Button>}
        </form>
      </div>
      <p className="text-[12px] text-muted-foreground">{t(`stockG8.count.modeHelp_${mode}`)}</p>

      <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <Th>{t('stockG8.count.colRef')}</Th><Th>{t('stockG8.count.colDesignation')}</Th><Th>{t('stockG8.count.colBin')}</Th>
              <Th>{t('stockG8.count.colType')}</Th><Th right>{t('stockG8.count.colReal')}</Th>
              {target.kind === 'arrete' && <><Th right>{t('stockG8.count.colInitial')}</Th><Th right>{t('stockG8.count.colAdjusted')}</Th><Th>{t('stockG8.count.colStatus')}</Th></>}
              <Th right>{t('stockG8.count.colCounted')}</Th><Th />
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && <tr><td colSpan={10} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {!listQ.isLoading && rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{t('stockG8.count.empty')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.article_id} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5 font-mono text-[12px]">{r.reference}</td>
                <td className="px-3 py-1.5">{r.designation}</td>
                <td className="px-3 py-1.5 font-mono text-[12px]">
                  {[r.bin_location, r.bin_location2].filter(Boolean).join(' / ') || '—'}
                  {r.multi_bin && <span className="ml-1 text-[11px] text-muted-foreground">({t('stockG8.count.multiBin')})</span>}
                </td>
                <td className="px-3 py-1.5">{r.mgmt_type}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.real_qty}</td>
                {target.kind === 'arrete' && (
                  <>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.snapshot_qty}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.adjusted_qty}</td>
                    <td className="px-3 py-1.5">{r.counted
                      ? <StatusBadge tone="success" label={t('stockG8.count.counted')} />
                      : <StatusBadge tone="neutral" label={t('stockG8.count.notCounted')} />}</td>
                  </>
                )}
                <td className="px-2 py-1 text-right">
                  <Input
                    ref={(el) => { inputRefs.current[r.article_id] = el; }}
                    type="number" step="0.001" inputMode="decimal"
                    className="ml-auto h-8 w-24 text-right tabular-nums"
                    value={inputs[r.article_id] ?? ''}
                    onChange={(e) => setInputs((p) => ({ ...p, [r.article_id]: e.target.value }))}
                  />
                </td>
                <td className="px-1">
                  {inputs[r.article_id] && (
                    <Button size="sm" variant="ghost" title={t('stockG8.count.clearLine')} onClick={() => setInputs((p) => { const n = { ...p }; delete n[r.article_id]; return n; })}><X className="size-4" /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] tabular-nums text-muted-foreground">{fillVars(t('stockG8.count.total'), { n: total.toLocaleString('fr-BE') })}</span>
        {rows.length < total && rows.length < 1000 && <Button size="sm" variant="outline" onClick={() => setPages((p) => p + 1)}>{t('stockG8.count.more')}</Button>}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Checkbox checked={withLabels} onCheckedChange={(v) => setWithLabels(v === true)} /> {t('stockG8.count.withLabels')}
        </label>
        <Button variant="outline" onClick={() => setInputs({})} disabled={filled.length === 0}><Eraser /> {t('stockG8.count.clearAll')}</Button>
        <Button onClick={apply} disabled={busy || filled.length === 0}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />} {fillVars(t('stockG8.count.apply'), { n: filled.length })}
        </Button>
      </div>

      {last.length > 0 && (
        <div className="rounded-md border border-border bg-card p-3">
          <Lbl>{t('stockG8.count.last')}</Lbl>
          <ul className="mt-1 grid gap-0.5 font-data text-[12px] tabular-nums sm:grid-cols-2 lg:grid-cols-3">
            {last.map((l, i) => <li key={i}><span className="font-mono">{l.ref}</span> : {l.r.old} → <b>{l.r.new}</b> ({l.r.delta > 0 ? '+' : ''}{l.r.delta})</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</span>;
}
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
