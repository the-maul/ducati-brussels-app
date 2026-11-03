/**
 * M8 — Photos avant reparation d'un dossier accident (mission 09, carte 5). Pense telephone /
 * tablette comme le check-up (appareil photo ou galerie, plusieurs a la fois) : vignette,
 * legende par photo, UNE photo marquee « n° de chassis grave » (obligatoire pour envoyer),
 * retrait. Les fichiers vont dans la GED du dossier (dossier « Photos »).
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Images, Loader2, Trash2, Hash } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { errorMessage } from '@/lib/mutation-feedback';
import { t, fillVars } from '@/lib/i18n';
import {
  accidentFileUrl, addAccidentPhoto, listAccidentPhotos, removeAccidentPhoto, setVinPhoto, updateAccidentPhoto,
  type AccidentFilePhoto,
} from './api';

export const accidentPhotosKey = (fileId: string) => ['accident-photos', fileId];

export function AccidentPhotos({ companyId, fileId, disabled }: { companyId: string; fileId: string; disabled?: boolean }) {
  const qc = useQueryClient();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const photosQ = useQuery({ queryKey: accidentPhotosKey(fileId), queryFn: () => listAccidentPhotos(fileId) });
  const photos = photosQ.data ?? [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: accidentPhotosKey(fileId) });
    qc.invalidateQueries({ queryKey: ['attachments', 'accident_file', fileId] });
  };

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      let sort = photos.length ? Math.max(...photos.map((p) => p.sort)) + 1 : 1;
      for (const f of Array.from(files)) { await addAccidentPhoto(companyId, fileId, f, { sort }); sort++; }
    },
    meta: { success: false },
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) upload.mutate(e.target.files);
    e.target.value = '';
  };
  const caption = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => updateAccidentPhoto(id, { caption: value.trim() || null }),
    meta: { success: false }, onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)),
  });
  const vin = useMutation({
    mutationFn: (photoId: string | null) => setVinPhoto(fileId, photoId),
    meta: { success: false }, onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (p: AccidentFilePhoto) => removeAccidentPhoto(p),
    meta: { success: false }, onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">{t('accidentFile.photosHint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
        <input ref={galleryRef} type="file" accept="image/*" multiple className="sr-only" onChange={pick} />
        <Button type="button" variant="outline" className="h-11" onClick={() => cameraRef.current?.click()} disabled={disabled || upload.isPending}>
          {upload.isPending ? <Loader2 className="animate-spin" /> : <Camera />} {t('accidentFile.takePhoto')}
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={() => galleryRef.current?.click()} disabled={disabled || upload.isPending}>
          <Images /> {t('accidentFile.addPhotos')}
        </Button>
        <span className="text-[12px] text-muted-foreground">{fillVars(t('accidentFile.photosCount'), { n: photos.length })}</span>
        {upload.isPending && <span className="text-[12px] text-muted-foreground">{t('accidentFile.photoUploading')}</span>}
      </div>
      {photosQ.isLoading ? (
        <div className="grid place-items-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : photos.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted-foreground">{t('accidentFile.noPhotos')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => (
            <PhotoCard
              key={p.id} photo={p} disabled={disabled}
              onCaption={(value) => caption.mutate({ id: p.id, value })}
              onVin={() => vin.mutate(p.is_vin ? null : p.id)}
              onRemove={() => remove.mutate(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoCard({ photo, disabled, onCaption, onVin, onRemove }: {
  photo: AccidentFilePhoto; disabled?: boolean;
  onCaption: (value: string) => void; onVin: () => void; onRemove: () => void;
}) {
  const url = useQuery({ queryKey: ['accident-photo-url', photo.path], queryFn: () => accidentFileUrl(photo.path), staleTime: 50 * 60_000 });
  const [value, setValue] = useState(photo.caption ?? '');
  const taken = photo.taken_at ? new Date(photo.taken_at).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '';
  return (
    <div className={`space-y-2 rounded-md border bg-card p-2 ${photo.is_vin ? 'border-[var(--ducati-red)]' : 'border-border'}`}>
      <button type="button" className="relative block aspect-[4/3] w-full overflow-hidden rounded-md bg-muted" onClick={() => { if (url.data) window.open(url.data, '_blank'); }}>
        {url.data ? <img src={url.data} alt={photo.caption ?? ''} className="size-full object-cover" /> : <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-muted-foreground" />}
        {photo.is_vin && <span className="absolute left-1 top-1"><StatusBadge tone="info" icon={Hash} label={t('accidentFile.vinPhoto')} /></span>}
      </button>
      <Input
        value={value} placeholder={t('accidentFile.photoCaption')} disabled={disabled} className="h-9"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { if ((value.trim() || null) !== (photo.caption ?? null)) onCaption(value); }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-data text-[11px] tabular-nums text-muted-foreground">{taken}</span>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant={photo.is_vin ? 'default' : 'outline'} onClick={onVin} disabled={disabled} title={t('accidentFile.markVin')}>
            <Hash /> {t('accidentFile.markVin')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onRemove} disabled={disabled} title={t('accidentFile.removePhoto')} aria-label={t('accidentFile.removePhoto')}>
            <Trash2 className="size-4 text-danger" />
          </Button>
        </div>
      </div>
    </div>
  );
}
