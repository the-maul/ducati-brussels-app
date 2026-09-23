/**
 * M8 — Parcours d'entretien : figures du manuel.
 * Vignette large (le technicien a des gants) ; un appui ouvre la figure en plein écran,
 * un second appui zoome ×2,5 et on fait glisser pour se déplacer.
 */
import { useState } from 'react';
import { ImageOff, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { figureUrl } from './source';
import type { Figure } from './types';
import { t } from '@/lib/i18n';

function Missing({ className }: { className?: string }) {
  return (
    <div className={`grid min-h-[140px] place-items-center rounded-md border border-dashed border-border bg-muted/40 p-4 text-center ${className ?? ''}`}>
      <div>
        <ImageOff className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <p className="mt-1 text-[12px] text-muted-foreground">{t('journey.noFigure')}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">{t('journey.noFigureHint')}</p>
      </div>
    </div>
  );
}

/** Une figure : vignette cliquable. */
export function FigureThumb({ figure, alt, onOpen }: { figure: Figure; alt: string; onOpen: (f: Figure) => void }) {
  const [broken, setBroken] = useState(false);
  const src = figureUrl(figure.src);
  if (!src || broken) return <Missing />;
  return (
    <button
      type="button"
      onClick={() => onOpen(figure)}
      className="group relative block w-full overflow-hidden rounded-md border border-border bg-gray-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={alt}
    >
      <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className="h-auto w-full object-contain" />
      <span className="pointer-events-none absolute bottom-2 right-2 grid size-9 place-items-center rounded-full bg-background/85 text-foreground shadow-[var(--shadow-card)]">
        <ZoomIn className="size-5" aria-hidden />
      </span>
    </button>
  );
}

/** Grille de figures d'une étape. */
export function FigureGrid({ figures, alt, onOpen }: { figures: Figure[]; alt: string; onOpen: (f: Figure) => void }) {
  if (!figures.length) return null;
  return (
    <div className={`grid gap-3 ${figures.length > 1 ? 'sm:grid-cols-2' : ''}`}>
      {figures.map((f, i) => <FigureThumb key={`${f.src}-${i}`} figure={f} alt={`${alt} (${i + 1})`} onOpen={onOpen} />)}
    </div>
  );
}

/** Figure en plein écran, zoomable. */
export function FigureZoom({ figure, alt, onClose }: { figure: Figure | null; alt: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  const [broken, setBroken] = useState(false);
  const src = figure ? figureUrl(figure.zoom) ?? figureUrl(figure.src) : null;
  return (
    <Dialog open={!!figure} onOpenChange={(o) => { if (!o) { setZoomed(false); setBroken(false); onClose(); } }}>
      <DialogContent className="max-h-[96vh] max-w-[96vw] gap-2 overflow-hidden p-3 sm:p-4">
        <DialogHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <DialogTitle className="truncate text-[15px]">{alt}</DialogTitle>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="lg" className="h-11 px-3" onClick={() => setZoomed((z) => !z)} aria-label={t('journey.openProcedure')}>
              {zoomed ? <ZoomOut /> : <ZoomIn />}
            </Button>
            <Button variant="outline" size="lg" className="h-11 px-3" onClick={onClose} aria-label={t('journey.cancel')}><X /></Button>
          </div>
        </DialogHeader>
        <div className="max-h-[80vh] overflow-auto overscroll-contain rounded-md bg-gray-0">
          {src && !broken ? (
            <img
              src={src}
              alt={alt}
              onError={() => setBroken(true)}
              onClick={() => setZoomed((z) => !z)}
              className={zoomed ? 'w-[250%] max-w-none cursor-zoom-out' : 'mx-auto h-auto w-full cursor-zoom-in'}
            />
          ) : <Missing className="min-h-[50vh]" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
