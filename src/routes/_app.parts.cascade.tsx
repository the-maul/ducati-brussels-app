import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Search, Wand2, Check } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { listArticles, updateArticle, recordPriceChange, MGMT_TYPES, type Article } from '@/modules/articles/api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/parts/cascade')({
  head: () => ({ meta: [{ title: 'Modification en cascade — Ducati Bruxelles' }] }),
  component: CascadePage,
});

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

type Action = 'pv_pct' | 'pa_pct' | 'coef' | 'vat' | 'brand' | 'mgmt_type' | 'bin' | 'lock_sale' | 'unlock_sale' | 'lock_purchase' | 'unlock_purchase';

function computePatch(a: Article, action: Action, value: string): Record<string, unknown> | null {
  const v = Number(value.replace(',', '.'));
  const vf = 1 + (a.vat_rate ?? 21) / 100;
  switch (action) {
    case 'pv_pct': return Number.isFinite(v) ? { sale_price_ttc: r2(a.sale_price_ttc * (1 + v / 100)) } : null;
    case 'pa_pct': return Number.isFinite(v) ? { purchase_price: r4(a.purchase_price * (1 + v / 100)) } : null;
    case 'coef': { if (!Number.isFinite(v)) return null; const pvht = r2(a.purchase_price * v); return { coefficient: r4(v), sale_price_ht: pvht, sale_price_ttc: r2(pvht * vf) }; }
    case 'vat': return Number.isFinite(v) ? { vat_rate: v } : null;
    case 'brand': return { brand: value.trim() || null };
    case 'mgmt_type': return { mgmt_type: value };
    case 'bin': return { bin_location: value.trim() || null };
    case 'lock_sale': return { price_sale_locked: true };
    case 'unlock_sale': return { price_sale_locked: false };
    case 'lock_purchase': return { price_purchase_locked: true };
    case 'unlock_purchase': return { price_purchase_locked: false };
    default: return null;
  }
}

const NEEDS_VALUE: Action[] = ['pv_pct', 'pa_pct', 'coef', 'vat', 'brand', 'mgmt_type', 'bin'];
// Actions touchant un prix → passent par record_price_change (tracé append-only B7).
const PRICE_ACTIONS: Action[] = ['pv_pct', 'pa_pct', 'coef'];

function CascadePage() {
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action>('pv_pct');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!activeCompanyId) return;
    setLoading(true); setError(null); setDone(null);
    try {
      const data = await listArticles(activeCompanyId, search);
      setArticles(data);
      setSel(new Set(data.map((a) => a.id)));
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
    finally { setLoading(false); }
  };

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = articles.length > 0 && sel.size === articles.length;

  const apply = useMutation({
    mutationFn: async () => {
      let count = 0;
      for (const a of articles) {
        if (!sel.has(a.id)) continue;
        const patch = computePatch(a, action, value);
        if (!patch || !Object.keys(patch).length) continue;
        if (PRICE_ACTIONS.includes(action)) {
          // Modification de prix → tracée (price_changes), origine 'cascade'.
          await recordPriceChange(a.id, {
            purchase: patch.purchase_price as number | undefined,
            saleHt: patch.sale_price_ht as number | undefined,
            saleTtc: patch.sale_price_ttc as number | undefined,
            coef: patch.coefficient as number | undefined,
            origin: 'cascade',
          });
        } else {
          await updateArticle(a.id, patch);
        }
        count++;
      }
      return count;
    },
    onSuccess: (n) => setDone(n),
    onError: (e) => setError(e instanceof Error ? e.message : 'Erreur'),
  });

  return (
    <>
      <PageHeader
        title="Modification en cascade"
        description="Filtrer une sélection d'articles puis appliquer une action de masse (prix, TVA, marque, type, casier, verrous)."
        actions={<Button variant="outline" onClick={() => navigate({ to: '/parts' })}><ArrowLeft /> {t('articles.title')}</Button>}
      />
      <p className="mb-4 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
        Les modifications de prix sont tracées dans le journal <strong>price_changes</strong> (append-only, B7) : qui, quand, ancien/nouveau, origine « cascade ».
      </p>

      {/* Filtre + chargement */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('articles.search')} className="pl-9" onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <Search />} Charger</Button>
      </div>

      {/* Action de masse */}
      {articles.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3">
          <div className="space-y-1">
            <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">Action</label>
            <Select value={action} onValueChange={(v) => setAction(v as Action)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pv_pct">PV TTC ± %</SelectItem>
                <SelectItem value="pa_pct">PA ± %</SelectItem>
                <SelectItem value="coef">Coefficient =</SelectItem>
                <SelectItem value="vat">Taux TVA =</SelectItem>
                <SelectItem value="brand">Marque =</SelectItem>
                <SelectItem value="mgmt_type">Type de gestion =</SelectItem>
                <SelectItem value="bin">Casier =</SelectItem>
                <SelectItem value="lock_sale">Bloquer prix de vente</SelectItem>
                <SelectItem value="unlock_sale">Débloquer prix de vente</SelectItem>
                <SelectItem value="lock_purchase">Bloquer prix d'achat</SelectItem>
                <SelectItem value="unlock_purchase">Débloquer prix d'achat</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {NEEDS_VALUE.includes(action) && (
            <div className="space-y-1">
              <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">Valeur</label>
              {action === 'mgmt_type' ? (
                <Select value={value} onValueChange={setValue}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{MGMT_TYPES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input value={value} onChange={(e) => setValue(e.target.value)} className="w-40" placeholder={action.includes('pct') ? 'ex. 5 ou -3' : ''} />
              )}
            </div>
          )}
          <Button onClick={() => { setError(null); setDone(null); apply.mutate(); }} disabled={apply.isPending || sel.size === 0}>
            {apply.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} Appliquer ({sel.size})
          </Button>
          {done != null && <span className="flex items-center gap-1 text-[13px] text-success"><Check className="size-4" /> {done} article(s) modifié(s).</span>}
        </div>
      )}

      {error && <p className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      {/* Liste sélectionnable */}
      {articles.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <Th className="w-10 text-center"><Checkbox checked={allSelected} onCheckedChange={(v) => setSel(v === true ? new Set(articles.map((a) => a.id)) : new Set())} /></Th>
                  <Th>Réf.</Th><Th>Désignation</Th><Th className="text-right">PA</Th><Th className="text-right">PV TTC</Th><Th className="text-right">Coef</Th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-accent">
                    <td className="px-3 py-1.5 text-center"><Checkbox checked={sel.has(a.id)} onCheckedChange={() => toggle(a.id)} /></td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{a.reference}</td>
                    <td className="px-3 py-1.5">{a.designation}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{a.purchase_price}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{a.sale_price_ttc}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{a.coefficient ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
