/**
 * M2 — Photos de l'article (GALERIE, plusieurs photos possibles) : prise de vue
 * smartphone/tablette ou galerie, stockées en GED dossier « Photos ».
 * STRICTEMENT indépendantes des photos de localisation (dossiers
 * « Localisation-1 » / « Localisation-2 » — jamais mélangées ici).
 * Chaque miniature s'agrandit au clic (visionneuse, avec suppression).
 */
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, ImageOff, ZoomIn, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { listAttachments, uploadAttachment, deleteAttachment, signedUrl, type Attachment } from '@/modules/documents/ged-api';
import { t } from '@/lib/i18n';

const PHOTOS_FOLDER = 'Photos';
const MAX_GALLERY = 12;

type PhotoItem = { att: Attachment; url: string };

/** Photo « article » = dossier Photos ou racine GED — jamais les localisations. */
function isArticlePhoto(a: Attachment): boolean {
  if (!(a.content_type ?? '').startsWith('image/')) return false;
  return a.folder == null || a.folder === PHOTOS_FOLDER;
}

export function ArticlePhotoCard({ companyId, articleId }: { companyId: string; articleId: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState<PhotoItem | null>(null);

  // Galerie : toutes les photos de l'article (les plus récentes d'abord)
  const photosQ = useQuery({
    queryKey: ['article-photos', articleId],
    queryFn: async (): Promise<PhotoItem[]> => {
      const atts = await listAttachments('article', articleId);
      const imgs = atts.filter(isArticlePhoto).slice(0, MAX_GALLERY);
      const out: PhotoItem[] = [];
      for (const att of imgs) {
        try {
          const url = await signedUrl(att.storage_path);
          if (url) out.push({ att, url });
        } catch { /* pièce illisible — ignorée */ }
      }
      return out;
    },
  });
  const photos = photosQ.data ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['article-photos', articleId] });
    qc.invalidateQueries({ queryKey: ['attachments', 'article', articleId] });
  };

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadAttachment(companyId, 'article', articleId, file, Date.now(), t('articles.photoOf'), PHOTOS_FOLDER),
    onSuccess: refresh,
    onError: () => toast.error(t('articles.errSave')),
  });

  const del = useMutation({
    mutationFn: (att: Attachment) => deleteAttachment(att),
    onSuccess: () => { setZoom(null); refresh(); },
    onError: () => toast.error(t('articles.errSave')),
  });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try { await upload.mutateAsync(f); } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="mb-4 rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[13px] font-bold">{t('articles.photoOf')}</p>
        <input
          ref={inputRef} type="file" accept="image/*" capture="environment" className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} {t('articles.photoTake')}
        </Button>
      </div>

      {photos.length === 0 ? (
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="grid h-20 w-28 place-items-center rounded border border-dashed border-border">
            {photosQ.isLoading ? <Loader2 className="size-5 animate-spin" /> : <ImageOff className="size-6" />}
          </div>
          {!photosQ.isLoading && <p className="text-[12px]">{t('articles.photoNone')}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <button
              key={p.att.id} type="button" onClick={() => setZoom(p)} title={t('articles.photoZoom')}
              className="group relative shrink-0 cursor-zoom-in overflow-hidden rounded border border-border"
            >
              <img src={p.url} alt={t('articles.photoOf')} className="h-20 w-28 object-cover transition-transform group-hover:scale-105" />
              <span className="absolute inset-0 grid place-items-center text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                <ZoomIn className="size-4" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Visionneuse — photo en grand + suppression */}
      <Dialog open={!!zoom} onOpenChange={(o) => { if (!o) setZoom(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('articles.photoOf')}</DialogTitle>
          </DialogHeader>
          {zoom && (
            <>
              <img src={zoom.url} alt={t('articles.photoOf')} className="max-h-[74vh] w-full rounded object-contain" />
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => del.mutate(zoom.att)} disabled={del.isPending}>
                  {del.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4 text-danger" />} {t('action.delete')}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
