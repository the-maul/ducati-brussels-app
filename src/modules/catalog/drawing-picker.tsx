/**
 * Mission 06, carte 5 — « Choisir sur la vue éclatée » depuis un devis, une facture ou un OR.
 *
 * Le document porte une moto (`documents.vehicle_id` / `repair_orders.vehicle_id`). Si cette moto
 * est reliée au catalogue (`vehicles.ducati_model_year_id`, carte 4), le bouton ouvre les groupes
 * et les planches de CE modèle-année, puis la vue éclatée de Ducati avec ses repères cliquables
 * (composant `DrawingView`, celui de l'écran Catalogue — il n'est pas réécrit, il reçoit `onAdd`).
 *
 * Un clic sur « Ajouter » pose la pièce en ligne du document :
 *   - l'article du DMS existe (lien par référence normalisée) → il est posé tel quel, avec son prix
 *     de vente et sa disponibilité ;
 *   - il n'existe pas → l'article est créé à la volée par le chemin habituel
 *     (`createToCompleteArticle`, mission 05 carte 4) : librairie, marque Ducati, type A,
 *     « à compléter », prix de vente = prix public Ducati HT de la planche. Le magasin complètera
 *     PA, fournisseur et famille ; la création est tracée dans `events`.
 * Rien n'est écrit sur le document ici : la ligne est rendue à l'éditeur, qui enregistre.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleDashed, ImageOff, Loader2, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { createToCompleteArticle } from '@/modules/sales/ecatalog-api';
import type { SaleArticle } from '@/modules/sales/write-api';
import {
  getVehicleCatalogRef, listModelYearDrawings, vehicleCatalogLabel,
  type CatalogDrawingRef, type CatalogLine,
} from './api';
import { DrawingView, type DrawingAddState } from './drawing-view';
import { fill } from './format';

/** Pièce choisie sur une planche, prête à devenir une ligne de document. */
export type CatalogDrawingPick = {
  article: SaleArticle;
  catalogUrl: string | null;
  created: boolean;
  unitPriceHt: number;
  /** Quantité Ducati sur la moto (1 par défaut). */
  quantity: number;
};

/**
 * Bouton « Choisir sur la vue éclatée ». Ne s'affiche que si le document porte une moto reliée au
 * catalogue : sans moto, ou moto non reconnue, il n'y a rien à montrer.
 */
export function DrawingPickButton({ companyId, vehicleId, onPick }: {
  companyId: string; vehicleId?: string | null; onPick: (p: CatalogDrawingPick) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useQuery({
    queryKey: ['ducati-catalog', 'vehicle-my', vehicleId],
    queryFn: () => getVehicleCatalogRef(vehicleId as string),
    enabled: !!vehicleId,
  });
  if (!vehicleId || !ref.data) return null;
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} title={t('catalog.pickHint')}>
        <Network /> {t('catalog.pickButton')}
      </Button>
      {open && (
        <DrawingPickDialog companyId={companyId} modelYearId={ref.data.modelYearId}
          bikeLabel={vehicleCatalogLabel(ref.data)} onClose={() => setOpen(false)}
          onPick={(p) => { onPick(p); }} />
      )}
    </>
  );
}

function DrawingPickDialog({ companyId, modelYearId, bikeLabel, onClose, onPick }: {
  companyId: string; modelYearId: string; bikeLabel: string;
  onClose: () => void; onPick: (p: CatalogDrawingPick) => void;
}) {
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [add, setAdd] = useState<DrawingAddState>({ lineNo: null, error: null });
  const [added, setAdded] = useState(0);

  const drawings = useQuery({
    queryKey: ['ducati-catalog', 'my-drawings', modelYearId],
    queryFn: () => listModelYearDrawings(modelYearId),
  });

  const k = q.trim().toUpperCase();
  const groups: { id: string; label: string; items: CatalogDrawingRef[] }[] = [];
  for (const d of drawings.data ?? []) {
    const hay = [d.drawing?.code, d.drawing?.description, d.group?.description].filter(Boolean).join(' ').toUpperCase();
    if (k && !hay.includes(k)) continue;
    let g = groups.find((x) => x.id === d.group_id);
    if (!g) { g = { id: d.group_id, label: [d.group?.code, d.group?.description].filter(Boolean).join(' — '), items: [] }; groups.push(g); }
    g.items.push(d);
  }

  /** Un clic sur « Ajouter » : article existant, sinon créé à la volée, puis ligne rendue. */
  const handleAdd = async (l: CatalogLine) => {
    if (!l.reference) return;
    setAdd({ lineNo: l.line_no, error: null });
    const qty = Number(l.quantity) > 0 ? Number(l.quantity) : 1;
    try {
      if (l.article_id) {
        const a: SaleArticle = {
          id: l.article_id, reference: l.article_reference ?? l.reference,
          designation: l.article_designation ?? l.description ?? l.reference,
          sale_price_ht: Number(l.article_sale_price_ht ?? 0), vat_rate: 21,
          mgmt_type: l.article_mgmt_type ?? null, bin_location: null,
          real_qty: Number(l.real_qty ?? 0), reserved_qty: Number(l.reserved_qty ?? 0), on_order_qty: Number(l.on_order_qty ?? 0),
          superseded_by_id: null, equivalence_group: null,
        };
        onPick({ article: a, catalogUrl: null, created: false, unitPriceHt: a.sale_price_ht, quantity: qty });
      } else {
        const a = await createToCompleteArticle({
          companyId, reference: l.reference,
          designation: (l.description ?? l.reference).trim() || l.reference,
          price: Number(l.catalog_price_ht ?? 0), priceMode: 'ht',
        });
        onPick({ article: a, catalogUrl: a.catalog_url, created: true, unitPriceHt: a.sale_price_ht, quantity: qty });
      }
      setAdd({ lineNo: null, error: null });
      setAdded((n) => n + 1);
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      setAdd({
        lineNo: null,
        error: code === '23505'
          ? fill(t('catalog.pickErrDuplicate'), { ref: l.reference })
          : (e instanceof Error ? e.message : t('catalog.pickErrAdd')),
      });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-[min(96vw,1400px)] overflow-auto">
        <DialogHeader>
          <DialogTitle>{t('catalog.pickTitle')}</DialogTitle>
          <DialogDescription>
            {bikeLabel}
            {added > 0 && <> · {fill(t('catalog.pickAddedCount'), { n: added })}</>}
          </DialogDescription>
        </DialogHeader>

        {drawingId ? (
          <DrawingView drawingId={drawingId} companyId={companyId} onBack={() => setDrawingId(null)}
            onAdd={(l) => { void handleAdd(l); }} addState={add} />
        ) : (
          <div className="space-y-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('catalog.pickSearchDrawing')}
              aria-label={t('catalog.pickSearchDrawing')} />
            {drawings.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
            {!drawings.isLoading && !groups.length && <p className="text-sm text-muted-foreground">{t('catalog.noDrawing')}</p>}
            {groups.map((g) => (
              <section key={g.id}>
                <h3 className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{g.label || g.id}</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {g.items.map((d) => (
                    <button key={d.drawing_id} type="button" onClick={() => setDrawingId(d.drawing_id)}
                      className="rounded-md border border-border bg-card p-2 text-left hover:border-primary">
                      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[4px] bg-muted">
                        {d.drawing?.thumbnail_url
                          ? <img src={d.drawing.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" />
                          : <ImageOff className="size-5 text-muted-foreground" />}
                      </div>
                      <div className="mt-1 text-[12px] font-semibold">{d.drawing?.code}</div>
                      <div className="line-clamp-2 text-[12px] text-muted-foreground">{d.drawing?.description}</div>
                      {!d.drawing?.parts_loaded_at && <div className="mt-1"><StatusBadge tone="warning" icon={CircleDashed} label={t('catalog.partsPending')} /></div>}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
