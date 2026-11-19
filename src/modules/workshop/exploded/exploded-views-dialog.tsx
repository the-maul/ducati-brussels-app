/**
 * M8 — Fenêtre « Vues éclatées de la moto » (lot E du parcours mécanicien, 19/11/2026).
 * Demande du client : « on peut voir les plans des pièces ... pour chaque pièce ».
 *
 * Réutilise l'écran du catalogue Ducati (planches par groupe `ModelYearDrawings`, vue éclatée
 * `DrawingView`) pour le modèle-année de la moto de l'OR ou de la picking list :
 *  - ouverte depuis une pièce (« Voir sur la vue éclatée ») : la pièce est retrouvée par sa
 *    référence (ou celle qu'elle remplace) et son repère est mis en évidence ;
 *  - ouverte depuis l'OR : navigation par groupe du catalogue ;
 *  - un repère montre référence, désignation, stock, prix, statut (remplacée, fin de série) et
 *    « Ajouter à l'OR » (fonction de prix des lignes d'OR) / « Réserver » (réservation atelier).
 * Images : liens vers e-catalog.ducati.com (publics, rien n'est copié) ; sans image, la liste
 * des repères et « Ouvrir chez Ducati ».
 * Pensée tablette : grands boutons (44-48 px), fenêtre presque plein écran.
 */
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BookOpen, Loader2, Minus, PackageCheck, Plus, Replace, SearchX, XCircle, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { SaleStockBadge } from '@/modules/sales/availability-badge';
import { saleStockStatus } from '@/modules/sales/availability';
import { supplyBadgeOf } from '@/modules/articles/supply-state';
import { DrawingView, type SelectedPosition } from '@/modules/catalog/drawing-view';
import { ModelYearDrawings } from '@/modules/catalog/model-year-drawings';
import { CreateArticleButton } from '@/modules/catalog/create-article-button';
import type { CatalogLine } from '@/modules/catalog/api';
import { fmtMoney } from '@/modules/catalog/format';
import { listReservedParts } from '@/modules/workshop/reservations/api';
import type { OrLinePricer } from '@/modules/workshop/or-line-pricing';
import { t, fillVars } from '@/lib/i18n';
import { articleCatalogRefs, articleSupply, getModelYearInfo, getPricedArticle, locateFirst, reserveForOr } from './api';
import {
  canAddLine, canReserveLine, catalogPickToOrLine, freeQty, reserveOutcome, stepQty,
  type ActionContext, type CatalogOrLine,
} from './rules';

/** Pièce à retrouver : par sa référence, ou par l'article du DMS (ligne d'OR). */
export type ExplodedTarget = { reference?: string | null; articleId?: string | null } | null;

export type ExplodedViewsProps = {
  companyId: string;
  modelYearId: string | null;
  target: ExplodedTarget;
  onClose: () => void;
  /** OR enregistré (« Réserver ») ; null pour un nouvel OR ou une picking list sans OR. */
  orId?: string | null;
  /** OR facturé / annulé : consultation seulement. */
  readOnly?: boolean;
  /** Éditeur de l'OR : la ligne chiffrée à ajouter (null = pas d'ajout, ex. picking list). */
  onAdd?: ((line: CatalogOrLine) => void) | null;
  /** Fonction de prix des lignes d'OR (tarif du client / de l'assureur) et arrondi de la société. */
  pricer?: OrLinePricer | null;
  effectiveHt?: (ht: number, vat: number) => number;
};

export function ExplodedViewsDialog(p: ExplodedViewsProps) {
  const { companyId, modelYearId, target, onClose } = p;
  const [drawing, setDrawing] = useState<{ id: string; pos: string | null; ref: string | null } | null>(null);

  const info = useQuery({ queryKey: ['exploded', 'my-info', modelYearId], queryFn: () => getModelYearInfo(modelYearId as string), enabled: !!modelYearId, staleTime: 3_600_000 });
  // Ligne d'OR : la référence vient de l'article du DMS (sa référence, puis la référence Ducati reliée).
  const refs = useQuery({
    queryKey: ['exploded', 'article-refs', target?.articleId], queryFn: () => articleCatalogRefs(target!.articleId as string),
    enabled: !!target?.articleId && !target?.reference, staleTime: 300_000,
  });
  const wanted = target?.reference ? [target.reference] : (refs.data ?? []);
  const located = useQuery({
    queryKey: ['exploded', 'locate', modelYearId, wanted.join('|')],
    queryFn: () => locateFirst(modelYearId as string, wanted),
    enabled: !!modelYearId && wanted.length > 0, staleTime: 300_000,
  });
  const reference = located.data?.reference ?? wanted[0] ?? null;
  const locations = located.data?.locations;
  // Pièce trouvée : sa première vue s'ouvre, le repère en évidence.
  useEffect(() => {
    const first = locations?.[0];
    if (first) setDrawing({ id: first.drawingId, pos: first.position, ref: reference });
  }, [locations, reference]);

  const title = info.data?.model
    ? fillVars(t('exploded.title'), { model: [info.data.model, info.data.year ?? info.data.code ?? ''].filter(Boolean).join(' ') })
    : t('exploded.button');
  const searching = (!!target?.articleId && refs.isLoading) || (wanted.length > 0 && located.isLoading);
  const notFound = !!reference && located.isSuccess && !locations?.length;
  const others = (locations ?? []).filter((l) => l.drawingId !== drawing?.id);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="flex h-[94vh] max-w-[min(1400px,98vw)] flex-col gap-3 overflow-hidden p-3 sm:p-5">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{reference ? fillVars(t('exploded.forPart'), { ref: reference }) : t('exploded.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {!modelYearId ? (
            <NoModelYear reference={reference} />
          ) : (
            <div className="space-y-3">
              {searching && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('exploded.locating')}</p>}
              {located.error && <p className="text-sm text-danger">{t('exploded.errLocate')}</p>}
              {notFound && (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
                  <SearchX className="size-4 shrink-0" aria-hidden /> <span className="flex-1">{fillVars(t('exploded.notFound'), { ref: reference ?? '' })}</span>
                  <Link to="/parts/catalog" search={{ ref: reference ?? '' }} target="_blank" className="font-semibold hover:underline">{t('exploded.notFoundAll')}</Link>
                </div>
              )}
              {drawing && others.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  <span>{t('exploded.alsoIn')}</span>
                  {others.map((o) => (
                    <Button key={o.drawingId} variant="outline" className="h-10" onClick={() => setDrawing({ id: o.drawingId, pos: o.position, ref: reference })}>
                      {o.position ? fillVars(t('exploded.otherView'), { pos: o.position }) : t('exploded.otherViewNoPos')}
                    </Button>
                  ))}
                </div>
              )}
              {drawing ? (
                <DrawingView
                  drawingId={drawing.id} companyId={companyId} highlightRef={drawing.ref} highlightPos={drawing.pos}
                  backLabel={t('exploded.allViews')}
                  onBack={() => setDrawing(null)}
                  renderSelected={(sel) => <PositionPanel sel={sel} {...p} />}
                />
              ) : (
                <ModelYearDrawings modelYearId={modelYearId} groupNav large onPick={(id) => setDrawing({ id, pos: null, ref: null })} />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NoModelYear({ reference }: { reference: string | null }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <p className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {t('exploded.noModelYear')}</p>
      <Button asChild variant="outline" className="h-11">
        <Link to="/parts/catalog" search={reference ? { ref: reference } : {}} target="_blank"><BookOpen /> {t('exploded.openCatalog')}</Link>
      </Button>
    </div>
  );
}

/** Le repère choisi : ses pièces, leur état, et les actions sur l'OR. */
function PositionPanel({ sel, companyId, orId = null, readOnly = false, onAdd = null, pricer = null, effectiveHt }: { sel: SelectedPosition } & ExplodedViewsProps) {
  const ids = sel.lines.map((l) => l.article_id).filter((x): x is string => !!x);
  const supply = useQuery({ queryKey: ['exploded', 'supply', ids.join(',')], queryFn: () => articleSupply(ids), enabled: ids.length > 0, staleTime: 300_000 });
  const reserved = useQuery({ queryKey: ['reserved-parts', 'or', orId], queryFn: () => listReservedParts({ orId }), enabled: !!orId });
  const ctx: ActionContext = { orId, readOnly, canAdd: !!onAdd && !!pricer };
  return (
    <section className="rounded-md border border-primary/40 bg-card p-3 shadow-[var(--shadow-card)]" aria-live="polite">
      <p className="mb-2 font-ui text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{fillVars(t('exploded.selectedTitle'), { pos: sel.position })}</p>
      {readOnly && <p className="mb-2 text-[12px] text-muted-foreground">{t('exploded.readOnly')}</p>}
      <div className="space-y-3">
        {sel.lines.map((l) => (
          <PartRow key={l.line_no} l={l} ctx={ctx} supply={l.article_id ? supply.data?.get(l.article_id) ?? null : null}
            onOr={l.article_id ? (reserved.data ?? []).find((r) => r.articleId === l.article_id && r.status === 'active') ?? null : null}
            companyId={companyId} onAdd={onAdd} pricer={pricer} effectiveHt={effectiveHt} />
        ))}
      </div>
    </section>
  );
}

function PartRow({ l, ctx, supply, onOr, onAdd, pricer, effectiveHt }: {
  l: CatalogLine; ctx: ActionContext; supply: string | null;
  onOr: { qtyNeeded: number; qtyReserved: number } | null;
  companyId: string; onAdd: ((line: CatalogOrLine) => void) | null; pricer: OrLinePricer | null;
  effectiveHt?: (ht: number, vat: number) => number;
}) {
  const qc = useQueryClient();
  const [qty, setQty] = useState(1);
  const sBadge = supplyBadgeOf(supply);
  const stock = l.article_id
    ? saleStockStatus({ mgmt_type: l.article_mgmt_type, real_qty: l.real_qty ?? 0, reserved_qty: l.reserved_qty ?? 0, on_order_qty: l.on_order_qty ?? 0 }, qty)
    : null;
  const ref = l.article_reference || l.reference || '';

  const add = useMutation({
    meta: { success: false },
    mutationFn: async () => {
      const a = await getPricedArticle(l.article_id as string);
      if (!a || !pricer || !onAdd) throw new Error(t('exploded.errAdd'));
      return catalogPickToOrLine(a, qty, pricer, effectiveHt);
    },
    onSuccess: (line) => { onAdd?.(line); toast.success(fillVars(t('exploded.added'), { ref, qty })); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('exploded.errAdd')),
  });
  const reserve = useMutation({
    meta: { success: false },
    mutationFn: () => reserveForOr(ctx.orId as string, l.article_id as string, qty),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['reserved-parts'] });
      qc.invalidateQueries({ queryKey: ['ducati-catalog', 'lines'] });
      if (!r) { toast.info(t('exploded.reserveMissing')); return; }
      const o = reserveOutcome(r);
      if (o.kind === 'already') toast.info(fillVars(t('exploded.reservedAlready'), { ref }));
      else if (o.kind === 'reserved') toast.success(fillVars(t('exploded.reserved'), { ref, n: o.reserved }));
      else if (o.kind === 'basket') toast.success(fillVars(t('exploded.reservedBasket'), { ref, n: o.reserved, missing: o.missing, kind: t(`exploded.basket_${o.basket}`) }));
      else toast.warning(fillVars(t('exploded.reservedBlocked'), { ref, n: o.reserved, missing: o.missing }));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('exploded.errReserve')),
  });

  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
      <div className="min-w-[220px] flex-1 space-y-1">
        <div className="font-data text-[15px] font-bold tabular-nums">{ref}</div>
        <div className="text-sm">{l.article_designation || l.description || ''}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {l.replaced && (
            <StatusBadge tone="warning" icon={Replace} label={l.replaced_part ? fillVars(t('exploded.replacedBy'), { ref: l.replaced_part }) : t('articles.supplyReplaced')} />
          )}
          {sBadge && <StatusBadge tone={sBadge.tone} icon={sBadge.tone === 'danger' ? XCircle : Replace} label={sBadge.label} />}
          {stock && <SaleStockBadge status={stock} free={freeQty(l)} />}
        </div>
        {l.article_id ? (
          <p className="font-data text-[13px] tabular-nums text-muted-foreground">
            {fillVars(t('exploded.stockLine'), { free: freeQty(l), real: Number(l.real_qty) || 0, order: Number(l.on_order_qty) || 0 })}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <span>{t('exploded.noArticle')}</span>
            {l.reference && <CreateArticleButton reference={l.reference} designation={l.description} />}
          </div>
        )}
        {onOr && (
          <p className="font-data text-[13px] tabular-nums text-info">
            {fillVars(t('exploded.onOr'), { reserved: onOr.qtyReserved, needed: onOr.qtyNeeded })}
          </p>
        )}
      </div>
      <div className="text-right">
        <div className="font-data text-[15px] font-bold tabular-nums">{l.article_id ? fmtMoney(l.article_sale_price_ht) : '—'}</div>
        <div className="text-[12px] text-muted-foreground">{t('exploded.priceHt')}</div>
        {l.catalog_price_ht != null && (
          <div className="font-data text-[12px] tabular-nums text-muted-foreground" title={t('catalog.colPriceHint')}>
            {t('catalog.colPrice')} {fmtMoney(l.catalog_price_ht)}
          </div>
        )}
      </div>
      {(canAddLine(l, ctx) || canReserveLine(l, ctx)) && (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1" role="group" aria-label={t('exploded.qty')}>
            <Button type="button" variant="outline" size="icon" className="size-11" onClick={() => setQty((q) => stepQty(q, -1))} aria-label={t('exploded.qtyLess')}><Minus /></Button>
            <span className="w-10 text-center font-data text-lg tabular-nums" aria-live="polite">{qty}</span>
            <Button type="button" variant="outline" size="icon" className="size-11" onClick={() => setQty((q) => stepQty(q, 1))} aria-label={t('exploded.qtyMore')}><Plus /></Button>
          </div>
          {canReserveLine(l, ctx) && (
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => reserve.mutate()} disabled={reserve.isPending} title={t('exploded.reserveHint')}>
              {reserve.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />} {t('exploded.reserve')}
            </Button>
          )}
          {canAddLine(l, ctx) && (
            <Button type="button" className="h-11 px-4" onClick={() => add.mutate()} disabled={add.isPending}>
              {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('exploded.add')}
            </Button>
          )}
        </div>
      )}
      {!ctx.orId && ctx.canAdd && !ctx.readOnly && l.article_id && l.article_mgmt_type === 'A' && (
        <p className="w-full text-right text-[12px] text-muted-foreground">{t('exploded.saveFirst')}</p>
      )}
    </div>
  );
}

