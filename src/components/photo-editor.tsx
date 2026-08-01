/**
 * Éditeur de photo (tablette / smartphone / bureau) : pivoter, recadrer et
 * annoter (rectangle, cercle, flèche) pour mettre un détail en évidence.
 * Sortie : un JPEG allégé prêt à téléverser. Aucune dépendance externe (canvas).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  RotateCcw, RotateCw, Crop, Square, Circle, ArrowUpRight, Undo2, Check, Loader2, X,
} from 'lucide-react';
import {
  decodeImage, drawToCanvas, canvasToJpegFile, IMAGE_PRESETS,
} from '@/lib/image-tools';
import { t } from '@/lib/i18n';

type Tool = 'crop' | 'rect' | 'ellipse' | 'arrow';
type Shape = { tool: Exclude<Tool, 'crop'>; x0: number; y0: number; x1: number; y1: number };

/** Rouge Ducati (annotations) — valeur figée : le canvas n'a pas accès aux tokens CSS. */
const ANNOT_COLOR = '#C8102E';

/** Dessine les annotations dans un contexte (rendu écran ET aplatissement). */
function paintShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], refWidth: number): void {
  const lw = Math.max(3, Math.round(refWidth / 250));
  ctx.save();
  ctx.lineWidth = lw;
  ctx.strokeStyle = ANNOT_COLOR;
  ctx.fillStyle = ANNOT_COLOR;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of shapes) {
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    if (s.tool === 'rect') {
      ctx.strokeRect(s.x0, s.y0, w, h);
    } else if (s.tool === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(s.x0 + w / 2, s.y0 + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
      const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
      const head = Math.max(lw * 4, 16);
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x1 - head * Math.cos(a - Math.PI / 7), s.y1 - head * Math.sin(a - Math.PI / 7));
      ctx.lineTo(s.x1 - head * Math.cos(a + Math.PI / 7), s.y1 - head * Math.sin(a + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Copie l'image de travail + les annotations dans un nouveau canvas. */
function flattenCanvas(base: HTMLCanvasElement, shapes: Shape[]): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext('2d');
  if (ctx) {
    ctx.drawImage(base, 0, 0);
    paintShapes(ctx, shapes, base.width);
  }
  return out;
}

export function PhotoEditor({ open, onOpenChange, file, onSave, title }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  file: File | null;
  onSave: (f: File) => void;
  title?: string;
}) {
  const baseRef = useRef<HTMLCanvasElement | null>(null);   // image de travail
  const viewRef = useRef<HTMLCanvasElement | null>(null);   // rendu écran
  const [tool, setTool] = useState<Tool>('rect');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [cropRect, setCropRect] = useState<Shape | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0); // force le rendu après rotation / recadrage
  /** Une modification non enregistrée est en cours (garde-fou à la fermeture). */
  const dirty = shapes.length > 0 || version > 1;

  // ── Chargement du fichier ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!open || !file) { setReady(false); return; }
    setReady(false); setLoadError(false);
    setShapes([]); setDraft(null); setCropRect(null); setTool('rect');
    (async () => {
      const bmp = await decodeImage(file);
      if (cancelled) return;
      if (!bmp) { setLoadError(true); return; } // format illisible → message, pas de spinner infini
      // Borne la résolution de travail : fluide sur tablette, qualité conservée
      baseRef.current = drawToCanvas(bmp, { maxPx: IMAGE_PRESETS.upload.maxPx });
      bmp.close?.();
      setVersion((v) => v + 1);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [open, file]);

  /** Fermeture : confirme si un travail non enregistré serait perdu. */
  const requestClose = (o: boolean) => {
    if (!o && dirty && !window.confirm(t('photoEditor.discardConfirm'))) return;
    onOpenChange(o);
  };

  // ── Rendu : image + annotations + tracé en cours + voile de recadrage ───────
  const render = useCallback(() => {
    const base = baseRef.current;
    const view = viewRef.current;
    if (!base || !view) return;
    if (view.width !== base.width || view.height !== base.height) {
      view.width = base.width;
      view.height = base.height;
    }
    const ctx = view.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(base, 0, 0);
    paintShapes(ctx, draft ? [...shapes, draft] : shapes, base.width);

    if (cropRect) {
      const x = Math.min(cropRect.x0, cropRect.x1);
      const y = Math.min(cropRect.y0, cropRect.y1);
      const w = Math.abs(cropRect.x1 - cropRect.x0);
      const h = Math.abs(cropRect.y1 - cropRect.y0);
      const lw = Math.max(3, Math.round(base.width / 250));
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.rect(0, 0, view.width, view.height);
      ctx.rect(x, y, w, h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, lw / 2);
      ctx.setLineDash([lw * 2, lw * 2]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }, [shapes, draft, cropRect, version]);

  useEffect(() => { if (ready) render(); }, [ready, render]);

  // ── Tracé (souris + tactile) ────────────────────────────────────────────────
  const startRef = useRef<{ x: number; y: number } | null>(null);
  /** Coordonnées canvas, BORNÉES à l'image (un glissé hors cadre ne crée pas de bande blanche). */
  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return { x: 0, y: 0 };
    const r = view.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    return {
      x: clamp(((e.clientX - r.left) / r.width) * view.width, view.width),
      y: clamp(((e.clientY - r.top) / r.height) * view.height, view.height),
    };
  };
  const shapeFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Shape => ({
    tool: tool === 'crop' ? 'rect' : tool, x0: a.x, y0: a.y, x1: b.x, y1: b.y,
  });
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    startRef.current = p;
    const s = shapeFrom(p, p);
    if (tool === 'crop') setCropRect(s); else setDraft(s);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = startRef.current;
    if (!start) return;
    const s = shapeFrom(start, toCanvas(e));
    if (tool === 'crop') setCropRect(s); else setDraft(s);
  };
  const onUp = () => {
    if (!startRef.current) return;
    startRef.current = null;
    if (tool !== 'crop' && draft) {
      const big = Math.abs(draft.x1 - draft.x0) > 6 || Math.abs(draft.y1 - draft.y0) > 6;
      if (big) setShapes((p) => [...p, draft]);
      setDraft(null);
    }
  };

  // ── Actions ─────────────────────────────────────────────────────────────────
  const rotate = (dir: -1 | 1) => {
    const base = baseRef.current;
    if (!base) return;
    // Les annotations sont fixées dans l'image avant de pivoter
    baseRef.current = drawToCanvas(flattenCanvas(base, shapes), { rotation: dir === 1 ? 90 : 270 });
    setShapes([]); setDraft(null); setCropRect(null);
    setVersion((v) => v + 1);
  };

  const applyCrop = () => {
    const base = baseRef.current;
    if (!base || !cropRect) return;
    const x = Math.round(Math.min(cropRect.x0, cropRect.x1));
    const y = Math.round(Math.min(cropRect.y0, cropRect.y1));
    const w = Math.round(Math.abs(cropRect.x1 - cropRect.x0));
    const h = Math.round(Math.abs(cropRect.y1 - cropRect.y0));
    if (w < 20 || h < 20) return;
    const flat = flattenCanvas(base, shapes); // annotations conservées, puis découpe
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d')?.drawImage(flat, x, y, w, h, 0, 0, w, h);
    baseRef.current = out;
    setShapes([]); setDraft(null); setCropRect(null);
    setVersion((v) => v + 1);
    setTool('rect');
  };

  const save = async () => {
    const base = baseRef.current;
    if (!base || !file) return;
    setBusy(true);
    try {
      // Export depuis l'image aplatie (jamais le voile de recadrage)
      const out = await canvasToJpegFile(flattenCanvas(base, shapes), file.name, IMAGE_PRESETS.upload.quality);
      onSave(out);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const ToolBtn = ({ id, icon, label }: { id: Tool; icon: React.ReactNode; label: string }) => (
    <Button
      type="button"
      variant={tool === id ? 'default' : 'outline'}
      size="sm"
      title={label}
      aria-label={label}
      aria-pressed={tool === id}
      onClick={() => { setTool(id); if (id !== 'crop') setCropRect(null); }}
    >
      {icon} <span className="hidden sm:inline">{label}</span>
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title ?? t('photoEditor.title')}</DialogTitle>
          <DialogDescription>{t('photoEditor.hint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => rotate(-1)} title={t('photoEditor.rotateLeft')}>
            <RotateCcw className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => rotate(1)} title={t('photoEditor.rotateRight')}>
            <RotateCw className="size-4" />
          </Button>
          <span className="mx-1 h-6 w-px bg-border" />
          <ToolBtn id="rect" icon={<Square className="size-4" />} label={t('photoEditor.rect')} />
          <ToolBtn id="ellipse" icon={<Circle className="size-4" />} label={t('photoEditor.ellipse')} />
          <ToolBtn id="arrow" icon={<ArrowUpRight className="size-4" />} label={t('photoEditor.arrow')} />
          <ToolBtn id="crop" icon={<Crop className="size-4" />} label={t('photoEditor.crop')} />
          {tool === 'crop' && (
            <Button type="button" size="sm" onClick={applyCrop} disabled={!cropRect}>
              <Check className="size-4" /> {t('photoEditor.applyCrop')}
            </Button>
          )}
          <span className="mx-1 h-6 w-px bg-border" />
          <Button type="button" variant="outline" size="sm" onClick={() => setShapes((p) => p.slice(0, -1))} disabled={shapes.length === 0} title={t('photoEditor.undo')}>
            <Undo2 className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { setShapes([]); setCropRect(null); }} disabled={shapes.length === 0 && !cropRect} title={t('photoEditor.clear')}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="grid max-h-[60vh] place-items-center overflow-auto rounded-md border border-border bg-muted/40 p-2">
          {loadError ? (
            <p className="my-10 px-4 text-center text-[13px] text-danger">{t('photoEditor.loadError')}</p>
          ) : !ready ? (
            <Loader2 className="my-12 size-6 animate-spin text-muted-foreground" />
          ) : (
            <canvas
              ref={viewRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              className="max-h-[54vh] max-w-full cursor-crosshair touch-none rounded"
            />
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => requestClose(false)}>{t('action.cancel')}</Button>
          <Button type="button" onClick={save} disabled={!ready || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} {t('photoEditor.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
