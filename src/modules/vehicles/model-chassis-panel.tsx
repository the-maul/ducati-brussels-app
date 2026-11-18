/**
 * Rattrapage G8 (18/11/2026, lot parc) — « Modification produit fini » de G8 : la grille des
 * chassis d'un modele (article V) et le bouton « Nouveau chassis » (parcours 14 : stock 4 -> 5).
 * Le stock du modele = nombre de chassis en stock (somme des mouvements, B4 / B7).
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import { normalizeVin } from '@/lib/vin';
import { VEHICLE_STATUSES } from './api';
import { addModelChassis, listModelChassis, type NewChassisInput } from './chassis-api';
import { modelChassisSummary } from './chassis-rules';
import { daysInStockOf } from './economics';

const eur = (n: number | null | undefined) =>
  n == null ? '—' : `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const toneOf = (s: string) => VEHICLE_STATUSES.find((x) => x.value === s)?.tone ?? 'neutral';

export function ModelChassisPanel({ articleId, purchasePrice, salePriceTtc, readOnly }: {
  articleId: string; purchasePrice: number | null; salePriceTtc: number | null; readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['model-chassis', articleId], queryFn: () => listModelChassis(articleId) });
  const rows = q.data ?? [];
  const sum = modelChassisSummary(rows);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t('parcG8.chassisHint')}</p>
        <span className="font-data text-[13px] tabular-nums">
          {fillVars(t('parcG8.chassisSummary'), { stock: sum.inStock, sold: sum.sold, total: sum.total })}
        </span>
        {!readOnly && (
          <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}><Plus /> {t('parcG8.newChassis')}</Button>
        )}
      </div>
      {q.isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('parcG8.noChassis')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                {[t('vehicles.vin'), t('vehicles.engineNumber'), t('vehicles.color'), t('vehicles.status'), t('vehicles.entryDate'),
                  t('vehicles.daysInStock'), t('vehicles.purchasePrice'), t('vehicles.policeBook'), t('vehicles.expositionCode')].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${i === 5 || i === 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: r.id } })}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-2 font-mono">{r.vin ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.engine_number ?? '—'}</td>
                  <td className="px-3 py-2">{r.color ?? '—'}</td>
                  <td className="px-3 py-2"><StatusBadge tone={toneOf(r.status)} label={t(`vehicles.status_${r.status}`)} /></td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.entry_date ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{daysInStockOf(r.entry_date, r.sold_date) ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(r.purchase_price)}</td>
                  <td className="px-3 py-2">{r.police_book_number ?? '—'}</td>
                  <td className="px-3 py-2">{r.exposition_code ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <NewChassisDialog
          articleId={articleId} purchasePrice={purchasePrice} salePriceTtc={salePriceTtc}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ['model-chassis', articleId] });
            qc.invalidateQueries({ queryKey: ['article-stock', articleId] });
            qc.invalidateQueries({ queryKey: ['vehicles'] });
          }}
        />
      )}
    </div>
  );
}

function NewChassisDialog({ articleId, purchasePrice, salePriceTtc, onClose, onDone }: {
  articleId: string; purchasePrice: number | null; salePriceTtc: number | null; onClose: () => void; onDone: () => void;
}) {
  const [f, setF] = useState({
    vin: '', engine_number: '', color: '', model_year: '', key_number: '', police_book_number: '', exposition_code: '',
    unit_cost: purchasePrice != null && purchasePrice > 0 ? String(purchasePrice) : '',
    display_price: salePriceTtc != null && salePriceTtc > 0 ? String(salePriceTtc) : '',
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const m = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => {
      const input: NewChassisInput = {
        vin: f.vin, engine_number: f.engine_number, color: f.color, model_year: num(f.model_year),
        key_number: f.key_number, police_book_number: f.police_book_number, exposition_code: f.exposition_code,
        unit_cost: num(f.unit_cost), display_price: num(f.display_price),
      };
      return addModelChassis(articleId, input);
    },
    onSuccess: () => { toast.success(t('parcG8.chassisAdded')); onDone(); },
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('parcG8.newChassis')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <F label={t('vehicles.vin')}><Input value={f.vin} onChange={(e) => set('vin', e.target.value)} className="font-mono" maxLength={20} /></F>
          <F label={t('vehicles.engineNumber')}><Input value={f.engine_number} onChange={(e) => set('engine_number', e.target.value)} /></F>
          <F label={t('vehicles.color')}><Input value={f.color} onChange={(e) => set('color', e.target.value)} /></F>
          <F label={t('vehicles.modelYear')}><Input type="number" value={f.model_year} onChange={(e) => set('model_year', e.target.value)} className="text-right tabular-nums" /></F>
          <F label={t('vehicles.keyNumber')}><Input value={f.key_number} onChange={(e) => set('key_number', e.target.value)} /></F>
          <F label={t('vehicles.policeBook')}><Input value={f.police_book_number} onChange={(e) => set('police_book_number', e.target.value)} /></F>
          <F label={t('vehicles.expositionCode')}><Input value={f.exposition_code} onChange={(e) => set('exposition_code', e.target.value)} /></F>
          <F label={t('vehicles.purchasePrice')}><Input type="number" step="0.01" value={f.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} className="text-right tabular-nums" /></F>
          <F label={t('vehicles.displayPrice')}><Input type="number" step="0.01" value={f.display_price} onChange={(e) => set('display_price', e.target.value)} className="text-right tabular-nums" /></F>
        </div>
        <p className="text-[12px] text-muted-foreground">{t('parcG8.newChassisHint')}</p>
        {m.error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(m.error as Error).message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => m.mutate()} disabled={!normalizeVin(f.vin) || m.isPending}>
            {m.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('parcG8.newChassis')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
