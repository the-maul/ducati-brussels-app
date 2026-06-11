/**
 * M5 — Écran Inventaire. Recompose les 8 méthodes G8 en 3 toggles
 * (magasin ouvert/fermé × effacement × édition des écarts). Chaque opération insère
 * des mouvements append-only (arrêté, comptage, remise à zéro, réintégration).
 */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Camera, Eraser, Check, RotateCcw, Lock, Play } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { listStock } from './stock-api';
import {
  getOpenSession, createSession, closeSession, generateSnapshot, resetRealStock, recordCount, reintegrateSnapshot, getGaps,
  type InventorySession,
} from './inventory-api';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function InventoryScreen({ companyId }: { companyId: string }) {
  const { data: session, isLoading } = useQuery({ queryKey: ['inv-session', companyId], queryFn: () => getOpenSession(companyId) });
  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  return session ? <ActiveSession companyId={companyId} session={session} /> : <CreateForm companyId={companyId} />;
}

function CreateForm({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [erase, setErase] = useState(false);
  const [ecarts, setEcarts] = useState(false);
  const start = useMutation({
    mutationFn: () => createSession(companyId, { magasin_ouvert: open, effacement: erase, edition_ecarts: ecarts }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inv-session', companyId] }),
  });
  return (
    <div className="max-w-lg space-y-3 rounded-md border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{t('stock.noSession')}</p>
      <Toggle label={t('stock.optOpen')} checked={open} onChange={setOpen} />
      <Toggle label={t('stock.optErase')} checked={erase} onChange={setErase} />
      <Toggle label={t('stock.optEcarts')} checked={ecarts} onChange={setEcarts} />
      <p className="text-[12px] text-muted-foreground">{t('stock.mode')} : <b>{erase ? t('stock.mode_cumul') : t('stock.mode_annule_remplace')}</b></p>
      <Button onClick={() => start.mutate()} disabled={start.isPending}>{start.isPending ? <Loader2 className="animate-spin" /> : <Play />} {t('stock.start')}</Button>
    </div>
  );
}

function ActiveSession({ companyId, session }: { companyId: string; session: InventorySession }) {
  const qc = useQueryClient();
  const { data: stock } = useQuery({ queryKey: ['stock', companyId], queryFn: () => listStock(companyId) });
  const { data: gaps } = useQuery({ queryKey: ['inv-gaps', session.snapshot_id], queryFn: () => getGaps(companyId, session.snapshot_id!), enabled: !!session.snapshot_id && session.edition_ecarts });
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [term, setTerm] = useState('');
  const [reintegrated, setReintegrated] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refreshStock = () => { qc.invalidateQueries({ queryKey: ['stock', companyId] }); qc.invalidateQueries({ queryKey: ['inv-gaps', session.snapshot_id] }); };
  const invalidateSession = () => qc.invalidateQueries({ queryKey: ['inv-session', companyId] });

  const snap = useMutation({ mutationFn: () => generateSnapshot(companyId, session.id, session.label ?? `Arrêté ${new Date().toISOString().slice(0, 10)}`), onSuccess: () => { invalidateSession(); setMsg(t('stock.snapshot')); } });
  const reset = useMutation({ mutationFn: (keep: boolean) => resetRealStock(companyId, keep), onSuccess: (n) => { refreshStock(); setMsg(`${t('stock.reset')} (${n})`); } });
  const reintegrate = useMutation({ mutationFn: () => reintegrateSnapshot(session.snapshot_id!), onSuccess: (n) => { refreshStock(); setReintegrated(true); setMsg(`${t('stock.reintegrate')} (${n})`); }, onError: (e) => setErr(e instanceof Error ? e.message : 'Erreur') });
  const close = useMutation({ mutationFn: () => closeSession(session.id), onSuccess: invalidateSession });

  const applyCounts = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(counts).filter(([, v]) => v.trim() !== '');
      for (const [articleId, v] of entries) await recordCount(articleId, num(v), session.mode as 'annule_remplace' | 'cumul');
    },
    onSuccess: () => { setCounts({}); refreshStock(); setMsg(t('stock.applyCount')); },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Erreur'),
  });

  const [keepVeh, setKeepVeh] = useState(true);
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (stock ?? []).filter((r) => !q || `${r.reference} ${r.designation} ${r.bin_location ?? ''}`.toLowerCase().includes(q));
  }, [stock, term]);

  return (
    <div className="space-y-5">
      {/* Bandeau session */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
        <StatusBadge tone="info" label={session.magasin_ouvert ? t('stock.optOpen') : 'Magasin fermé'} />
        {session.effacement && <StatusBadge tone="warning" label={t('stock.optErase')} />}
        {session.edition_ecarts && <StatusBadge tone="info" label={t('stock.optEcarts')} />}
        <span className="text-[12px] text-muted-foreground">{t('stock.mode')} : {session.mode === 'cumul' ? t('stock.mode_cumul') : t('stock.mode_annule_remplace')}</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => close.mutate()} disabled={close.isPending}><Lock className="size-4" /> {t('stock.finish')}</Button>
      </div>

      {/* Étapes */}
      <div className="flex flex-wrap gap-2">
        {session.magasin_ouvert && !session.snapshot_id && (
          <Button variant="outline" onClick={() => snap.mutate()} disabled={snap.isPending}>{snap.isPending ? <Loader2 className="animate-spin" /> : <Camera />} {t('stock.generateSnapshot')}</Button>
        )}
        {session.effacement && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => reset.mutate(keepVeh)} disabled={reset.isPending}>{reset.isPending ? <Loader2 className="animate-spin" /> : <Eraser />} {t('stock.reset')}</Button>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground"><input type="checkbox" checked={keepVeh} onChange={(e) => setKeepVeh(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('stock.keepVehicles')}</label>
          </div>
        )}
        {session.magasin_ouvert && session.snapshot_id && !reintegrated && (
          <Button variant="outline" onClick={() => reintegrate.mutate()} disabled={reintegrate.isPending}>{reintegrate.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t('stock.reintegrate')}</Button>
        )}
      </div>

      {msg && <p className="rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{msg}</p>}
      {err && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{err}</p>}

      {/* Comptage */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('stock.search')} className="max-w-sm" />
          <Button onClick={() => applyCounts.mutate()} disabled={applyCounts.isPending || Object.values(counts).every((v) => v.trim() === '')}>
            {applyCounts.isPending ? <Loader2 className="animate-spin" /> : <Check />} {t('stock.applyCount')}
          </Button>
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted sticky top-0"><tr><Th>{t('stock.colRef')}</Th><Th>{t('stock.colDesignation')}</Th><Th>{t('stock.colBin')}</Th><Th className="text-right">{t('stock.current')}</Th><Th className="text-right">{t('stock.counted')}</Th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.article_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 font-mono text-[12px]">{r.reference}</td>
                  <td className="px-3 py-1.5">{r.designation}</td>
                  <td className="px-3 py-1.5 font-mono text-[12px]">{r.bin_location ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.real_qty}</td>
                  <td className="px-2 py-1 text-right"><Input type="number" step="0.001" value={counts[r.article_id] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [r.article_id]: e.target.value }))} className="ml-auto h-8 w-24 text-right tabular-nums" placeholder={session.mode === 'cumul' ? '+/-' : ''} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Écarts */}
      {session.edition_ecarts && session.snapshot_id && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('stock.ecarts')}</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('stock.colRef')}</Th><Th>{t('stock.colDesignation')}</Th><Th className="text-right">{t('stock.colReal')}</Th><Th className="text-right">{t('stock.snapshot')}</Th><Th className="text-right">{t('stock.gap')}</Th><Th className="text-right">{t('stock.colValue')}</Th></tr></thead>
              <tbody>
                {(gaps ?? []).length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">—</td></tr>}
                {(gaps ?? []).map((g) => (
                  <tr key={g.article_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[12px]">{g.reference}</td>
                    <td className="px-3 py-1.5">{g.designation}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{g.real_qty}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{g.snapshot_qty}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${g.gap_qty < 0 ? 'text-danger' : ''}`}>{g.gap_qty > 0 ? '+' : ''}{g.gap_qty}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{eur(g.gap_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
      {label}
    </label>
  );
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
