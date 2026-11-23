/**
 * Catalogue Ducati — une vue éclatée : image Ducati avec les repères cliquables (hotspots) et la
 * liste des pièces, avec pour chaque pièce l'article du DMS correspondant et sa disponibilité.
 *
 * Lot E du parcours mécanicien (19/11/2026) : la même vue sert l'OR et la picking list.
 *  - `highlightPos` : repère à mettre en évidence à l'ouverture (pièce retrouvée par sa référence) ;
 *  - `renderSelected` : panneau du repère choisi (référence, stock, prix, « Ajouter à l'OR »…) ;
 *  - image Ducati indisponible : liste des repères cliquables et lien « Ouvrir chez Ducati ».
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, ImageOff, Info, Loader2, Maximize2, Replace, Timer, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SaleStockBadge } from '@/modules/sales/availability-badge';
import { saleStockStatus } from '@/modules/sales/availability';
import { cn } from '@/lib/utils';
import { fillVars, t } from '@/lib/i18n';
import { getCatalogDrawing, listDrawingLines, type CatalogLine } from './api';
import { fill, fmtMoney, focusTransform, hotspotBox } from './format';
import { normalizeCatalogReference } from './reference';
import { CreateArticleButton } from './create-article-button';
import { positionsOf } from './positions';

export type SelectedPosition = { position: string; lines: CatalogLine[] };

export function DrawingView({ drawingId, companyId, highlightRef = null, highlightPos = null, focusOnOpen = false, onBack, renderSelected, backLabel }: {
  drawingId: string; companyId: string | null; highlightRef?: string | null; onBack: () => void;
  /** Repère mis en évidence à l'ouverture (lien depuis l'OR / la picking list). */
  highlightPos?: string | null;
  /** Chantier C1 : la planche s'ouvre zoomée et centrée sur la pièce, entourée. */
  focusOnOpen?: boolean;
  /** Panneau du repère choisi (au-dessus de la liste des pièces). */
  renderSelected?: (sel: SelectedPosition) => ReactNode;
  backLabel?: string;
}) {
  const drawing = useQuery({ queryKey: ['ducati-catalog', 'drawing', drawingId], queryFn: () => getCatalogDrawing(drawingId) });
  const lines = useQuery({
    queryKey: ['ducati-catalog', 'lines', companyId, drawingId],
    queryFn: () => listDrawingLines(companyId as string, drawingId),
    enabled: !!companyId,
  });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [imgError, setImgError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const d = drawing.data;
  const img = d?.image_url || d?.original_image_url || d?.thumbnail_url || null;
  useEffect(() => { setNatural(null); setImgError(false); setSelected(highlightPos ?? null); }, [drawingId, highlightPos]);
  const positions = useMemo(() => positionsOf(d?.hotspots, lines.data), [d?.hotspots, lines.data]);
  const selectedLines = useMemo(() => (selected ? (lines.data ?? []).filter((l) => l.position === selected) : []), [selected, lines.data]);
  const ducatiUrl = d?.original_image_url || d?.image_url || null;

  // Chantier C1 : zoom sur la zone du repère (un repère peut avoir plusieurs zones sur la planche).
  const [zoomed, setZoomed] = useState(focusOnOpen);
  const [spotIdx, setSpotIdx] = useState(0);
  useEffect(() => { setZoomed(focusOnOpen); }, [drawingId, highlightPos, focusOnOpen]);
  useEffect(() => { setSpotIdx(0); }, [drawingId, selected]);
  const spots = useMemo(() => (selected ? (d?.hotspots ?? []).filter((h) => String(h.pos) === selected) : []), [d?.hotspots, selected]);
  const spot = spots[Math.min(spotIdx, Math.max(0, spots.length - 1))] ?? null;
  const spotBox = spot ? hotspotBox(spot, natural) : null;
  const focus = zoomed && spotBox ? focusTransform(spotBox) : null;
  const zoomScale = focus?.scale ?? 1;
  const noZone = focusOnOpen && !!d && !!natural && lines.isSuccess && spots.length === 0;

  const firstRowByPos = useMemo(() => {
    const m: Record<string, number> = {};
    (lines.data ?? []).forEach((l) => { if (l.position && m[l.position] == null) m[l.position] = l.line_no; });
    return m;
  }, [lines.data]);

  // Lien direct depuis une référence (fiche article, recherche) : surligner sa ligne.
  const target = highlightRef ? normalizeCatalogReference(highlightRef) : '';
  useEffect(() => {
    if (highlightPos && lines.data) {
      const n = lines.data.find((x) => x.position === highlightPos)?.line_no;
      if (n != null) setTimeout(() => rowRefs.current[String(n)]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    if (!target || !lines.data) return;
    const l = lines.data.find((x) => x.reference_norm === target);
    if (!l) return;
    if (l.position) setSelected(l.position);
    setTimeout(() => rowRefs.current[String(l.line_no)]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [target, lines.data, highlightPos]);

  const pick = (pos: string) => {
    setSelected(pos);
    const n = firstRowByPos[pos];
    if (n != null) rowRefs.current[String(n)]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft /> {backLabel ?? t('catalog.back')}</Button>
        {d && <h3 className="font-ui text-[15px] font-bold">{[d.code, d.description].filter(Boolean).join(' — ')}</h3>}
        {ducatiUrl && (
          <a href={ducatiUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={t('catalog.openAtDucatiHint')}
            className="ml-auto inline-flex items-center gap-1 text-sm text-info hover:underline">
            <ExternalLink className="size-4" /> {t('catalog.openAtDucati')}
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="rounded-md border border-border bg-card p-2">
          {drawing.isLoading ? (
            <Loader2 className="m-6 size-5 animate-spin text-muted-foreground" />
          ) : !img || imgError ? (
            <div className="space-y-3 p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><ImageOff className="size-4" /> {t('catalog.imageMissing')}</div>
              {positions.length > 0 && (
                <>
                  <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('catalog.positionsTitle')}</p>
                  <div className="flex flex-wrap gap-2" aria-label={t('catalog.positionsTitle')}>
                    {positions.map((p) => (
                      <button key={p} type="button" onClick={() => pick(p)}
                        className={cn('min-h-11 min-w-11 rounded-[6px] border px-3 font-data text-base tabular-nums',
                          selected === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted')}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <p className="text-[12px] text-muted-foreground">{t('catalog.positionsHint')}</p>
                </>
              )}
            </div>
          ) : (
            <>
              {noZone && (
                <p className="mb-2 flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('dossier.explodedNoZone')}
                </p>
              )}
              <div className="w-full overflow-hidden">
              <div
                className="relative w-full origin-top-left transition-transform duration-300"
                style={focus ? { transform: `translate(${focus.x}%, ${focus.y}%) scale(${focus.scale})` } : undefined}
              >
                <img
                  src={img}
                  alt={d?.description ?? ''}
                  className="block h-auto w-full"
                  referrerPolicy="no-referrer"
                  onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  onError={() => setImgError(true)}
                />
                {(d?.hotspots ?? []).map((h, i) => {
                  const box = hotspotBox(h, natural);
                  if (!box) return null;
                  const on = selected === String(h.pos);
                  // Le trait garde son épaisseur à l'écran quel que soit le zoom ; la pièce est entourée.
                  const ring = on ? { outlineWidth: `${3 / zoomScale}px`, outlineOffset: `${2 / zoomScale}px` } : {};
                  return (
                    <button
                      key={`${h.pos}-${i}`}
                      type="button"
                      title={String(h.pos)}
                      aria-label={`${t('catalog.colPos')} ${h.pos}`}
                      onClick={() => pick(String(h.pos))}
                      className={cn(
                        'absolute rounded-[2px] border-2 transition-colors',
                        on ? 'border-primary bg-primary/25 outline outline-primary' : 'border-info/70 bg-info/10 hover:bg-info/25',
                      )}
                      style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`, borderWidth: `${2 / zoomScale}px`, ...ring }}
                    />
                  );
                })}
              </div>
              </div>
              {spotBox && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="h-11" onClick={() => setZoomed((z) => !z)}>
                    {zoomed ? <Maximize2 /> : <ZoomIn />} {zoomed ? t('dossier.explodedFull') : t('dossier.explodedZoomIn')}
                  </Button>
                  {zoomed && spots.length > 1 && (
                    <Button type="button" variant="outline" className="h-11" onClick={() => setSpotIdx((i) => (i + 1) % spots.length)}>
                      {fillVars(t('dossier.explodedNextSpot'), { i: spotIdx + 1, n: spots.length })}
                    </Button>
                  )}
                </div>
              )}
              <p className="mt-2 text-[12px] text-muted-foreground">{t('catalog.hotspotHint')}</p>
            </>
          )}
        </div>

        <div className="space-y-3">
        {renderSelected && selected && selectedLines.length > 0 && renderSelected({ position: selected, lines: selectedLines })}
        <div className="max-h-[75vh] overflow-auto rounded-md border border-border bg-card">
          {lines.isLoading ? (
            <Loader2 className="m-6 size-5 animate-spin text-muted-foreground" />
          ) : !(lines.data ?? []).length ? (
            <p className="p-4 text-sm text-muted-foreground">{d && !d.parts_loaded_at ? t('catalog.partsPending') : t('catalog.noLines')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">{t('catalog.colPos')}</TableHead>
                  <TableHead>{t('catalog.colRef')}</TableHead>
                  <TableHead>{t('catalog.colDesignation')}</TableHead>
                  <TableHead className="text-right">{t('catalog.colQty')}</TableHead>
                  <TableHead className="text-right" title={t('catalog.colPriceHint')}>{t('catalog.colPrice')}</TableHead>
                  <TableHead>{t('catalog.colArticle')}</TableHead>
                  <TableHead className="text-right" title={t('catalog.salePriceHint')}>{t('catalog.colSalePrice')}</TableHead>
                  <TableHead>{t('catalog.colDispo')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lines.data ?? []).map((l) => (
                  <LineRow key={l.line_no} l={l} selected={(!!selected && l.position === selected) || (!!target && l.reference_norm === target)}
                    onPick={() => l.position && setSelected(l.position)}
                    refCb={(el) => { rowRefs.current[String(l.line_no)] = el; }} />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function LineRow({ l, selected, onPick, refCb }: { l: CatalogLine; selected: boolean; onPick: () => void; refCb: (el: HTMLTableRowElement | null) => void }) {
  const status = l.article_id
    ? saleStockStatus({ mgmt_type: l.article_mgmt_type, real_qty: l.real_qty ?? 0, reserved_qty: l.reserved_qty ?? 0, on_order_qty: l.on_order_qty ?? 0 }, Number(l.quantity) || 1)
    : null;
  const free = (Number(l.real_qty) || 0) - (Number(l.reserved_qty) || 0);
  return (
    <TableRow ref={refCb} onClick={onPick} className={cn('cursor-pointer', selected && 'bg-primary/10')}>
      <TableCell className="font-data tabular-nums">{l.position ?? ''}</TableCell>
      <TableCell className="whitespace-nowrap font-data tabular-nums">
        {l.reference ?? ''}
        {l.replaced && l.replaced_part && (
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-warning"><Replace className="size-3" />{fill(t('catalog.replacedBy'), { ref: l.replaced_part })}</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {l.description ?? ''}
        {l.has_tempario && <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"><Timer className="size-3" />{t('catalog.tempario')}</span>}
        {(l.notes || l.part_notes) && <div className="text-[11px] text-muted-foreground">{[l.notes, l.part_notes].filter(Boolean).join(' · ')}</div>}
      </TableCell>
      <TableCell className="text-right tabular-nums">{l.quantity ?? ''}</TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(l.catalog_price_ht)}</TableCell>
      <TableCell className="text-sm">
        {l.article_id ? (
          <Link to="/parts/$articleId" params={{ articleId: l.article_id }} className="text-info hover:underline" onClick={(e) => e.stopPropagation()}>
            {l.article_reference} · {l.article_designation}
          </Link>
        ) : l.reference ? (
          <CreateArticleButton reference={l.reference} designation={l.description} />
        ) : (
          <span className="text-muted-foreground">{t('catalog.noArticle')}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">{l.article_id ? fmtMoney(l.article_sale_price_ht) : ''}</TableCell>
      <TableCell>{status && <SaleStockBadge status={status} free={free} />}</TableCell>
    </TableRow>
  );
}
