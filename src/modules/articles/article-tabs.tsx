/**
 * M2 — Onglets de la fiche article : codes-barres, kit/nomenclature, remplacement/équivalence.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  listBarcodes, addBarcodeRow, deleteBarcode, listKitItems, addKitItem, deleteKitItem,
  setReplacement, searchArticlesLite,
} from './subobjects-api';
import { getArticle } from './api';

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
  const { data: replacement } = useQuery({ queryKey: ['article', supersededById], queryFn: () => (supersededById ? getArticle(supersededById) : null), enabled: !!supersededById });
  const inv = () => { qc.invalidateQueries({ queryKey: ['article', articleId] }); qc.invalidateQueries({ queryKey: ['articles'] }); };
  const set = useMutation({ mutationFn: (id: string | null) => setReplacement(articleId, id), onSuccess: inv });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Indiquez l'article qui <b>remplace</b> cette référence. À la saisie de l'ancienne référence, la nouvelle sera proposée
        (le transfert de stock/PAMP sera géré avec le module Stock).
      </p>
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

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
