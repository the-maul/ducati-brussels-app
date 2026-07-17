/**
 * M2 — Photo d'une LOCALISATION d'article (rayonnage) avec ANNOTATION :
 * au téléchargement, l'utilisateur entoure l'endroit exact où se trouve
 * l'article (cercles dessinés au doigt/souris, incrustés dans l'image).
 * Stockée en GED (dossier « Localisation-1 » / « Localisation-2 »),
 * miniature cliquable → visionneuse en grand.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, ZoomIn, Trash2, Eraser, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { listAttachments, uploadAttachment, deleteAttachment, signedUrl, type Attachment } from '@/modules/documents/ged-api';
import { t } from '@/lib/i18n';

/** Ellipse « entourage » à partir d'un glisser (coin → coin). Fonction pure. */
export function ellipseFrom(x1: number, y1: number, x2: number, y2: number) {
  return {
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2,
    rx: Math.max(4, Math.abs(x2 - x1) / 2),
    ry: Math.max(4, Math.abs(y2 - y1) / 2),
  };
}

type Ellipse = ReturnType<typeof ellipseFrom>;
const MAX_DIM = 1400; // taille max de l'image annotée (px)

export function LocationPhoto({ companyId, articleId, slot }: {
  companyId: string;
  articleId: string;
  slot: 1 | 2;
}) {
  const folder = `Localisation-${slot}`;
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);

  const photoQ = useQuery({
    queryKey: ['article-loc-photo', articleId, slot],
    queryFn: async (): Promise<{ att: Attachment; url: string } | null> => {
      const atts = await listAttachments('article', articleId);
      const img = atts.find((a) => a.folder === folder && (a.content_type ?? '').startsWith('image/'));
      if (!img) return null;
      const url = await signedUrl(img.storage_path);
      return url ? { att: img, url } : null;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['article-loc-photo', articleId, slot] });

  const del = useMutation({
    mutationFn: (att: Attachment) => deleteAttachment(att),
    onSuccess: refresh,
    onError: () => toast.error(t('articles.errSave')),
  });

  const onUploadAnnotated = async (file: File) => {
    // Remplace la photo précédente de cette localisation (une seule à la fois)
    if (photoQ.data) { try { await deleteAttachment(photoQ.data.att); } catch { /* non bloquant */ } }
    await uploadAttachment(companyId, 'article', articleId, file, Date.now(), `${t('articles.binLocation')} ${slot}`, folder);
    refresh();
  };

  return (
    <div className="mt-1.5 flex items-center gap-2">
      {photoQ.data && (
        <button
          type="button" onClick={() => setZoomOpen(true)} title={t('articles.photoZoom')}
          className="group relative shrink-0 cursor-zoom-in overflow-hidden rounded border border-border"
        >
          <img src={photoQ.data.url} alt="" className="h-12 w-16 object-cover transition-transform group-hover:scale-105" />
          <span className="absolute inset-0 grid place-items-center text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
            <ZoomIn className="size-4" />
          </span>
        </button>
      )}
      <input
        ref={inputRef} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingFile(f); if (inputRef.current) inputRef.current.value = ''; }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <Camera className="size-4" /> {t('articles.locPhotoTake')}
      </Button>
      {photoQ.data && (
        <Button type="button" variant="ghost" size="sm" onClick={() => del.mutate(photoQ.data!.att)} title={t('action.delete')}>
          <Trash2 className="size-4 text-danger" />
        </Button>
      )}

      {/* Annotation au téléchargement : entourer l'emplacement de l'article */}
      {pendingFile && (
        <AnnotateDialog
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onSave={async (annotated) => {
            setPendingFile(null);
            try { await onUploadAnnotated(annotated); } catch { toast.error(t('articles.errSave')); }
          }}
        />
      )}

      {/* Visionneuse en grand */}
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{`${t('articles.binLocation')} ${slot}`}</DialogTitle>
          </DialogHeader>
          {photoQ.data && <img src={photoQ.data.url} alt="" className="max-h-[78vh] w-full rounded object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Dialogue d'annotation : dessiner des cercles sur la photo (souris / doigt). */
function AnnotateDialog({ file, onCancel, onSave }: {
  file: File;
  onCancel: () => void;
  onSave: (annotated: File) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<Ellipse[]>([]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<Ellipse | null>(null);
  const [saving, setSaving] = useState(false);

  // Charge l'image dans le canvas (réduite à MAX_DIM)
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      imgRef.current = img;
      redraw(canvas, img, [], null);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const redraw = (canvas: HTMLCanvasElement, img: HTMLImageElement, all: Ellipse[], extra: Ellipse | null) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = Math.max(3, canvas.width / 180);
    for (const e of extra ? [...all, extra] : all) {
      ctx.beginPath();
      ctx.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && imgRef.current) redraw(canvas, imgRef.current, shapes, preview);
  }, [shapes, preview]);

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    canvas.toBlob((blob) => {
      if (!blob) { setSaving(false); return; }
      onSave(new File([blob], 'localisation.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.85);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('articles.annotTitle')}</DialogTitle>
          <DialogDescription>{t('articles.annotHint')}</DialogDescription>
        </DialogHeader>
        <canvas
          ref={canvasRef}
          className="w-full cursor-crosshair rounded border border-border"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(toCanvas(e)); }}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = toCanvas(e);
            setPreview(ellipseFrom(drag.x, drag.y, p.x, p.y));
          }}
          onPointerUp={(e) => {
            if (!drag) return;
            const p = toCanvas(e);
            const el = ellipseFrom(drag.x, drag.y, p.x, p.y);
            if (el.rx > 8 || el.ry > 8) setShapes((s) => [...s, el]);
            setDrag(null);
            setPreview(null);
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setShapes([])} disabled={shapes.length === 0}>
            <Eraser className="size-4" /> {t('articles.annotClear')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>{t('action.cancel')}</Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />} {t('articles.annotSave')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
