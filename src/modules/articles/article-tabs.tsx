/**
 * M2 — Onglets de la fiche article : codes-barres, kit/nomenclature, remplacement/équivalence.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  listBarcodes, addBarcodeRow, deleteBarcode, listKitItems, addKitItem, deleteKitItem,
  setReplacement, searchArticlesLite,
} from './subobjects-api';
import { getArticle } from './api';
import { getArticleStock, listMoves, recordMove, transferStockOnReplace, MOVE_TYPE_LABELS, type StockMoveType } from '@/modules/stock/api';
import { listArticleSales, aggregateByMonth } from '@/modules/sales/api';

type LiteArticle = { id: string; reference: string; designation: string };

/* ---------------- Sélecteur d'article ---------------- */
function ArticlePicker({ companyId, onPick }: { companyId: string; onPick: (a: LiteArticle) => void }) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['art-lite', companyId, deb], queryFn: () => searchArticlesLite(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Rechercher un article…" className="pl-9" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => { onPick(a); setTerm(''); setDeb(''); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Spinner() { return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>; }

/* ---------------- Codes-barres ---------------- */
export function BarcodesTab({ articleId }: { articleId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['barcodes', articleId], queryFn: () => listBarcodes(articleId) });
  const [code, setCode] = useState('');
  const inv = () => qc.invalidateQueries({ queryKey: ['barcodes', articleId] });
  const add = useMutation({ mutationFn: () => addBarcodeRow(articleId, code.trim()), onSuccess: () => { inv(); setCode(''); } });
  const del = useMutation({ mutationFn: (id: string) => deleteBarcode(id), onSuccess: inv });
  if (isLoading) return <Spinner />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {data?.map((b) => (
          <span key={b.id} className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-muted px-2 py-1 font-mono text-[12px]">
            {b.barcode}
            <button type="button" onClick={() => del.mutate(b.id)} className="text-muted-foreground hover:text-danger"><X className="size-3" /></button>
          </span>
        ))}
        {(!data || data.length === 0) && <span className="text-sm text-muted-foreground">Aucun code-barres.</span>}
      </div>
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Nouveau code-barres" className="max-w-xs font-mono" onKeyDown={(e) => e.key === 'Enter' && code.trim() && add.mutate()} />
        <Button onClick={() => add.mutate()} disabled={add.isPending || !code.trim()}><Plus /> Ajouter</Button>
      </div>
    </div>
  );
}

/* ---------------- Kit / nomenclature ---------------- */
export function KitTab({ articleId, companyId }: { articleId: string; companyId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['kit', articleId], queryFn: () => listKitItems(articleId) });
  const [pick, setPick] = useState<LiteArticle | null>(null);
  const [qty, setQty] = useState('1');
  const inv = () => qc.invalidateQueries({ queryKey: ['kit', articleId] });
  const add = useMutation({ mutationFn: () => addKitItem(articleId, pick!.id, Number(qty) || 1), onSuccess: () => { inv(); setPick(null); setQty('1'); } });
  const del = useMutation({ mutationFn: (id: string) => deleteKitItem(id), onSuccess: inv });
  if (isLoading) return <Spinner />;
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>Réf.</Th><Th>Composant</Th><Th className="w-24 text-right">Qté</Th><Th className="w-12" /></tr></thead>
          <tbody>
            {(!data || data.length === 0) && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Aucun composant.</td></tr>}
            {data?.map((k) => (
              <tr key={k.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-[12px]">{k.component?.reference ?? '—'}</td>
                <td className="px-3 py-2">{k.component?.designation ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{k.quantity}</td>
                <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => del.mutate(k.id)}><Trash2 className="size-4 text-danger" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
        {pick ? (
          <span className="inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm">
            <span className="font-mono text-[12px]">{pick.reference}</span>{pick.designation}
            <button type="button" onClick={() => setPick(null)}><X className="size-3" /></button>
          </span>
        ) : <ArticlePicker companyId={companyId} onPick={setPick} />}
        <Input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className="w-24 text-right tabular-nums" />
        <Button onClick={() => add.mutate()} disabled={add.isPending || !pick}><Plus /> Ajouter</Button>
      </div>
    </div>
  );
}

/* ---------------- Remplacement / équivalence ---------------- */
export function ReplacementTab({ articleId, companyId, supersededById }: { articleId: string; companyId: string; supersededById: string | null }) {
  const qc = useQueryClient();
  const [transferStock, setTransferStock] = useState(true);
  const { data: replacement } = useQuery({ queryKey: ['article', supersededById], queryFn: () => (supersededById ? getArticle(supersededById) : null), enabled: !!supersededById });
  const inv = () => {
    qc.invalidateQueries({ queryKey: ['article', articleId] });
    qc.invalidateQueries({ queryKey: ['articles'] });
    qc.invalidateQueries({ queryKey: ['stock', articleId] });
  };
  const set = useMutation({
    mutationFn: async (id: string | null) => {
      await setReplacement(articleId, id);
      if (id && transferStock) await transferStockOnReplace(articleId, id);  // transfert stock + PAMP (B5/B7)
    },
    onSuccess: inv,
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Indiquez l'article qui <b>remplace</b> cette référence. À la saisie de l'ancienne référence, la nouvelle sera proposée.
      </p>
      {!supersededById && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={transferStock} onChange={(e) => setTransferStock(e.target.checked)} />
          Transférer le stock et le PAMP vers la nouvelle référence
        </label>
      )}
      {supersededById && replacement ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
          <span className="text-sm">Remplacée par&nbsp;: <b className="font-mono">{replacement.reference}</b> — {replacement.designation}</span>
          <Button size="sm" variant="outline" onClick={() => set.mutate(null)} disabled={set.isPending}>Retirer</Button>
        </div>
      ) : (
        <ArticlePicker companyId={companyId} onPick={(a) => set.mutate(a.id)} />
      )}
    </div>
  );
}

/* ---------------- Stock (triple stock + mouvements) ---------------- */
const MOVE_CHOICES: StockMoveType[] = ['entree', 'sortie', 'correction', 'inventaire', 'cession'];

export function StockTab({ articleId }: { articleId: string }) {
  const qc = useQueryClient();
  const stock = useQuery({ queryKey: ['stock', articleId], queryFn: () => getArticleStock(articleId) });
  const moves = useQuery({ queryKey: ['moves', articleId], queryFn: () => listMoves(articleId) });
  const [type, setType] = useState<StockMoveType>('entree');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const inv = () => { qc.invalidateQueries({ queryKey: ['stock', articleId] }); qc.invalidateQueries({ queryKey: ['moves', articleId] }); qc.invalidateQueries({ queryKey: ['article', articleId] }); };
  const rec = useMutation({
    mutationFn: () => {
      const q = Number(qty.replace(',', '.'));
      const signed = type === 'sortie' || type === 'cession' ? -Math.abs(q) : Math.abs(q);
      return recordMove({ article: articleId, type, qty: signed, unitCost: type === 'entree' && cost ? Number(cost.replace(',', '.')) : null, note: note || null });
    },
    onSuccess: () => { inv(); setQty(''); setCost(''); setNote(''); },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StockCard label="Réel" value={stock.data?.real} loading={stock.isLoading} />
        <StockCard label="Réservé" value={stock.data?.reserved} loading={stock.isLoading} muted />
        <StockCard label="Disponible" value={stock.data?.available} loading={stock.isLoading} accent />
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
        <div className="space-y-1">
          <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">Mouvement</label>
          <Select value={type} onValueChange={(v) => setType(v as StockMoveType)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{MOVE_CHOICES.map((m) => <SelectItem key={m} value={m}>{MOVE_TYPE_LABELS[m]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">Quantité</label>
          <Input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className="w-28 text-right tabular-nums" />
        </div>
        {type === 'entree' && (
          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">PA unitaire (PAMP)</label>
            <Input type="number" step="0.001" value={cost} onChange={(e) => setCost(e.target.value)} className="w-32 text-right tabular-nums" />
          </div>
        )}
        <Input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-xs" />
        <Button onClick={() => rec.mutate()} disabled={rec.isPending || !qty.trim()}>{rec.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Enregistrer</Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>Date</Th><Th>Type</Th><Th className="text-right">Qté</Th><Th className="text-right">PA</Th><Th>Origine</Th><Th>Note</Th></tr></thead>
          <tbody>
            {moves.isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {moves.data && moves.data.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun mouvement.</td></tr>}
            {moves.data?.map((mv) => (
              <tr key={mv.id} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5 font-mono text-[12px]">{new Date(mv.occurred_at).toLocaleString('fr-BE')}</td>
                <td className="px-3 py-1.5">{MOVE_TYPE_LABELS[mv.move_type]}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${mv.qty_delta < 0 ? 'text-danger' : 'text-success'}`}>{mv.qty_delta > 0 ? '+' : ''}{mv.qty_delta}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{mv.unit_cost ?? '—'}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{mv.origin}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{mv.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockCard({ label, value, loading, muted, accent }: { label: string; value?: number; loading: boolean; muted?: boolean; accent?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${accent ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-data text-2xl tabular-nums ${muted ? 'text-muted-foreground' : ''}`}>
        {loading ? '…' : (value ?? 0)}
      </div>
    </div>
  );
}

/* ---------------- Statistiques (ventes par mois) ---------------- */
export function StatsTab({ articleId }: { articleId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['art-sales', articleId], queryFn: () => listArticleSales(articleId) });
  if (isLoading) return <Spinner />;
  const rows = aggregateByMonth(data ?? []);
  const totalQty = (data ?? []).reduce((s, l) => s + l.quantity, 0);
  const totalAmount = (data ?? []).reduce((s, l) => s + l.line_ht, 0);
  const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
  if (rows.length === 0) return <Empty>Aucune vente enregistrée pour cet article.</Empty>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-card p-3"><div className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">Quantité vendue</div><div className="mt-1 font-data text-2xl tabular-nums">{totalQty}</div></div>
        <div className="rounded-md border border-border bg-card p-3"><div className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">CA HT</div><div className="mt-1 font-data text-2xl tabular-nums">{eur(totalAmount)}</div></div>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>Mois</Th><Th className="text-right">Qté</Th><Th className="text-right">CA HT</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-[12px]">{r.month}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) { return <div className="rounded-md border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{children}</div>; }

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
