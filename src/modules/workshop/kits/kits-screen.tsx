/**
 * Atelier → Kits d'entretien (mission 07, carte 2 ; décision M-20 : « un kit de pièces par
 * famille de moteur et par entretien, proposé automatiquement à partir du catalogue et
 * corrigeable par l'atelier »).
 *
 * Gauche : la liste des kits (famille de moteur × échéance), avec le nombre de pièces, ce
 * qui reste à confirmer et le nombre de modèles-années servis.
 * Droite : le contenu du kit choisi — pièce, référence, quantité, casier, stock réel,
 * en commande — avec ajout, changement de quantité et retrait. Chaque correction fait une
 * nouvelle version du kit, tracée.
 *
 * Aucun mouvement de stock : un kit décrit ce qu'il faut, il ne sort rien.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wrench, Plus, Trash2, RefreshCw, AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { searchOrderArticles, type OrderArticleHit } from '@/modules/orders/api';
import { listKits, getKitDetail, generateKits, saveKitItem, deleteKitItem, type KitRow } from './api';
import { fmtQty, kitToConfirmCount } from './rules';

export function KitsScreen({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const kitsQ = useQuery({ queryKey: ['maintenance-kits', companyId, search], queryFn: () => listKits(companyId, search) });

  /** Génération par lots : le serveur coupe à 8 s, on avance tranche par tranche. */
  const generate = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      let offset = 0;
      let created = 0;
      let linked = 0;
      for (let pass = 0; pass < 60; pass += 1) {
        const r = await generateKits(companyId, 8, offset);
        created += r.created;
        linked += r.linked;
        offset = r.nextOffset;
        setProgress(t('kits.generating').replace('{n}', String(offset)).replace('{c}', String(created)));
        if (r.done) break;
      }
      return { created, linked };
    },
    onSuccess: (r) => {
      setProgress(null);
      toast.success(t('kits.generated').replace('{c}', String(r.created)).replace('{l}', String(r.linked)));
      qc.invalidateQueries({ queryKey: ['maintenance-kits'] });
    },
    onError: (e) => { setProgress(null); setError(e instanceof Error ? e.message : t('kits.errGenerate')); },
  });

  const kits = kitsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('kits.searchPlaceholder')} />
        </div>
        <Button variant="outline" onClick={() => { setError(null); generate.mutate(); }} disabled={generate.isPending}>
          {generate.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('kits.generate')}
        </Button>
        {progress && <span className="text-[12px] text-muted-foreground">{progress}</span>}
      </div>

      <p className="text-[12px] text-muted-foreground">{t('kits.intro')}</p>
      {/* Tant que les migrations ne sont pas appliquées, la fonction SQL n'existe pas :
          on le dit franchement plutôt que d'afficher une liste vide trompeuse. */}
      {kitsQ.isError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
          {kitsQ.error instanceof Error ? kitsQ.error.message : t('kits.errGenerate')}
        </p>
      )}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-md border border-border">
          {kitsQ.isLoading ? (
            <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : kits.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{t('kits.empty')}</p>
          ) : (
            <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
              {kits.map((k) => (
                <li key={k.id}>
                  <button
                    type="button" onClick={() => setSelected(k.id)} aria-pressed={selected === k.id}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${selected === k.id ? 'bg-accent' : 'hover:bg-accent'}`}
                  >
                    <span className="font-ui text-[13px] font-bold">{k.engineFamilyLabel}</span>
                    <span className="text-[13px]">{k.serviceLabel}</span>
                    <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">{t('kits.itemsCount').replace('{n}', String(k.itemsCount))}</span>
                      <span className="tabular-nums">{t('kits.modelYears').replace('{n}', String(k.modelYearsCount))}</span>
                      <span className="tabular-nums">v{k.version}</span>
                      {k.editedAt && <StatusBadge tone="info" label={t('kits.edited')} />}
                      {k.toConfirmCount > 0 && <StatusBadge tone="warning" label={t('kits.toConfirm').replace('{n}', String(k.toConfirmCount))} />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected ? <KitDetail kitId={selected} companyId={companyId} kit={kits.find((k) => k.id === selected)} />
          : <p className="rounded-md border border-dashed border-border px-3 py-10 text-center text-[13px] text-muted-foreground">{t('kits.pick')}</p>}
      </div>
    </div>
  );
}

function KitDetail({ kitId, companyId, kit }: { kitId: string; companyId: string; kit?: KitRow }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [hit, setHit] = useState<OrderArticleHit | null>(null);
  const [addQty, setAddQty] = useState('1');

  const itemsQ = useQuery({ queryKey: ['maintenance-kit-detail', kitId], queryFn: () => getKitDetail(kitId) });
  const hitsQ = useQuery({
    queryKey: ['kit-article-search', companyId, term],
    queryFn: () => searchOrderArticles(companyId, term, 8),
    enabled: term.trim().length >= 2,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['maintenance-kit-detail', kitId] });
    qc.invalidateQueries({ queryKey: ['maintenance-kits'] });
  };

  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: (p: { itemId?: string | null; articleId?: string | null; quantity: number }) =>
      saveKitItem({ kitId, itemId: p.itemId ?? null, articleId: p.articleId ?? null, quantity: p.quantity }),
    onSuccess: () => { refresh(); setHit(null); setTerm(''); setAddQty('1'); },
    onError: (e) => setError(e instanceof Error ? e.message : t('kits.errSave')),
  });
  const remove = useMutation({
    meta: { success: false, error: false },
    mutationFn: (itemId: string) => deleteKitItem(itemId),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : t('kits.errSave')),
  });

  const items = itemsQ.data ?? [];
  const toConfirm = kitToConfirmCount(items);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-ui text-[15px] font-bold">{kit ? `${kit.engineFamilyLabel} — ${kit.serviceLabel}` : t('kits.title')}</h2>
        {kit && <span className="text-[12px] text-muted-foreground">{t('kits.version').replace('{n}', String(kit.version))}</span>}
      </div>

      {toConfirm > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t('kits.toConfirmHint').replace('{n}', String(toConfirm))}
        </p>
      )}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('kits.colPart')}</Th>
              <Th>{t('kits.colOrigin')}</Th>
              <Th className="w-24 text-right">{t('kits.colQty')}</Th>
              <Th>{t('orders.colBin')}</Th>
              <Th className="text-right">{t('kits.colStock')}</Th>
              <Th className="text-right">{t('orderFromDoc.colOnOrder')}</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {itemsQ.isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {!itemsQ.isLoading && items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('kits.noItems')}</td></tr>
            )}
            {items.map((i) => (
              <tr key={i.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  {i.reference && <span className="mr-2 font-mono text-[12px] text-muted-foreground">{i.reference}</span>}
                  {i.designation}
                  {i.confidence === 'a_confirmer' && <StatusBadge tone="warning" label={t('kits.badgeToConfirm')} />}
                  {(i.fluidSpec || i.fluidProduct) && (
                    <span className="ml-2 block text-[11px] text-muted-foreground">{i.fluidProduct ?? i.fluidSpec}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-[12px] text-muted-foreground">{t(`kits.origin_${i.origin}`)}</td>
                <td className="px-3 py-2">
                  <QtyCell
                    value={i.quantity} unit={i.unit}
                    onCommit={(v) => { setError(null); save.mutate({ itemId: i.id, quantity: v }); }}
                  />
                </td>
                <td className="px-3 py-2 text-[12px]">{i.bins.length ? i.bins.join(' · ') : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.articleId ? fmtQty(i.realQty - i.reservedQty) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.articleId ? fmtQty(i.onOrderQty) : '—'}</td>
                <td className="px-3 py-2">
                  <Button variant="ghost" size="icon" aria-label={t('action.delete')}
                    onClick={() => { setError(null); remove.mutate(i.id); }} disabled={remove.isPending}>
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-border p-3">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
          <Wrench className="size-4" /> {t('kits.addTitle')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" value={term} onChange={(e) => { setTerm(e.target.value); setHit(null); }} placeholder={t('kits.addPlaceholder')} />
          <Input className="w-24 text-right tabular-nums" inputMode="decimal" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
          <Button
            disabled={!hit || save.isPending}
            onClick={() => {
              setError(null);
              const q = Number(addQty.replace(',', '.'));
              save.mutate({ articleId: hit!.articleId, quantity: Number.isFinite(q) && q > 0 ? q : 1 });
            }}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('kits.add')}
          </Button>
        </div>
        {hitsQ.data && hitsQ.data.length > 0 && (
          <ul className="mt-2 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {hitsQ.data.map((h) => (
              <li key={h.articleId}>
                <button
                  type="button" onClick={() => setHit(h)} aria-pressed={hit?.articleId === h.articleId}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] ${hit?.articleId === h.articleId ? 'bg-accent' : 'hover:bg-accent'}`}
                >
                  <span><span className="mr-2 font-mono text-[12px] text-muted-foreground">{h.reference}</span>{h.designation}</span>
                  <span className="tabular-nums text-[12px] text-muted-foreground">{fmtQty(h.availableQty)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function QtyCell({ value, unit, onCommit }: { value: number; unit?: string | null; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value).replace('.', ','));
  return (
    <span className="flex items-center gap-1">
      <Input
        className="h-8 w-16 text-right tabular-nums" inputMode="decimal" value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number(text.replace(',', '.'));
          if (Number.isFinite(v) && v > 0 && v !== value) onCommit(v);
          else setText(String(value).replace('.', ','));
        }}
      />
      {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
    </span>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
