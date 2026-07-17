/**
 * M2 — Photo de l'article : prise de vue smartphone/tablette (ou galerie),
 * stockée dans la GED de l'article (dossier « Photos »), prévisualisation sur
 * la fiche et agrandissement au clic (visionneuse).
 */
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, ImageOff, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { listAttachments, uploadAttachment, signedUrl } from '@/modules/documents/ged-api';
import { t } from '@/lib/i18n';

const PHOTOS_FOLDER = 'Photos';

export function ArticlePhotoCard({ companyId, articleId }: { companyId: string; articleId: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  // Photo la plus récente (GED article, images uniquement)
  const photoQ = useQuery({
    queryKey: ['article-photo', articleId],
    queryFn: async () => {
      const atts = await listAttachments('article', articleId);
      const img = atts.find((a) => (a.content_type ?? '').startsWith('image/'));
      if (!img) return null;
      return signedUrl(img.storage_path);
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      await uploadAttachment(companyId, 'article', articleId, file, Date.now(), t('articles.photoOf'), PHOTOS_FOLDER);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['article-photo', articleId] });
      qc.invalidateQueries({ queryKey: ['attachments', 'article', articleId] });
    },
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
    <div className="mb-4 flex items-center gap-4 rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      {photoQ.data ? (
        <button
          type="button"
          onClick={() => setZoomOpen(true)}
          title={t('articles.photoZoom')}
          className="group relative shrink-0 cursor-zoom-in overflow-hidden rounded border border-border"
        >
          <img src={photoQ.data} alt={t('articles.photoOf')} className="h-24 w-32 object-cover transition-transform group-hover:scale-105" />
          <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
            <ZoomIn className="size-5" />
          </span>
        </button>
      ) : (
        <div className="grid h-24 w-32 place-items-center rounded border border-dashed border-border text-muted-foreground">
          {photoQ.isLoading ? <Loader2 className="size-5 animate-spin" /> : <ImageOff className="size-6" />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold">{t('articles.photoOf')}</p>
        {!photoQ.data && !photoQ.isLoading && (
          <p className="text-[12px] text-muted-foreground">{t('articles.photoNone')}</p>
        )}
        <input
          ref={inputRef} type="file" accept="image/*" capture="environment" className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} {t('articles.photoTake')}
        </Button>
      </div>

      {/* Visionneuse — photo en grand */}
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('articles.photoOf')}</DialogTitle>
          </DialogHeader>
          {photoQ.data && (
            <img src={photoQ.data} alt={t('articles.photoOf')} className="max-h-[78vh] w-full rounded object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
