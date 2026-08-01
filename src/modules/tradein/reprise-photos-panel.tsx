/**
 * M7 — Photos & documents d'une reprise EXISTANTE : ajouter, remplacer,
 * retoucher (pivoter / recadrer / annoter) ou supprimer à tout moment.
 * Chaque case correspond à un emplacement du formulaire (l'ordre fait foi pour
 * la fiche PDF). Les fichiers sont compressés avant envoi dans la GED véhicule.
 */
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, ImagePlus, Pencil, Trash2, Loader2, FileText, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PhotoEditor } from '@/components/photo-editor';
import { compressImageFile } from '@/lib/image-tools';
import {
  listAttachments, uploadAttachment, deleteAttachment, signedUrl, type Attachment,
} from '@/modules/documents/ged-api';
import { PHOTO_SLOTS, FREE_PHOTO_SLOTS, DOC_SLOTS, type PhotoSlot } from './reprise-wizard-data';
import { PHOTOS_FOLDER, DOCS_FOLDER } from './sheet-builder';
import { t } from '@/lib/i18n';

type Entry = { att: Attachment; url: string | null };

export function ReprisePhotosPanel({ companyId, vehicleId }: { companyId: string; vehicleId: string }) {
  const qc = useQueryClient();
  const key = ['reprise-photos', vehicleId];

  const q = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Entry[]> => {
      const atts = await listAttachments('vehicle', vehicleId);
      const mine = atts.filter((a) => a.folder === PHOTOS_FOLDER || a.folder === DOCS_FOLDER);
      const out: Entry[] = [];
      for (const att of mine) {
        try { out.push({ att, url: await signedUrl(att.storage_path) }); }
        catch { out.push({ att, url: null }); }
      }
      return out;
    },
  });
  const entries = q.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  /** Pièce rattachée à un emplacement : appariée par libellé (note). */
  const entryFor = (slot: PhotoSlot): Entry | null =>
    entries.find((e) => (e.att.note ?? '').trim().toLowerCase() === slot.label.toLowerCase()) ?? null;

  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-ui text-[15px] font-bold text-foreground">{t('tradein.photosPanelTitle')}</h2>
        {q.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="mb-3 text-[12px] text-muted-foreground">{t('tradein.photosPanelHint')}</p>

      <Group title={t('tradein.wizPhotosTitle')} slots={PHOTO_SLOTS} entryFor={entryFor} companyId={companyId} vehicleId={vehicleId} folder={PHOTOS_FOLDER} onChanged={refresh} />
      <Group title={t('tradein.wizPhotoFree')} slots={FREE_PHOTO_SLOTS} entryFor={entryFor} companyId={companyId} vehicleId={vehicleId} folder={PHOTOS_FOLDER} onChanged={refresh} />
      <Group title={t('tradein.docsSection')} slots={DOC_SLOTS} entryFor={entryFor} companyId={companyId} vehicleId={vehicleId} folder={DOCS_FOLDER} onChanged={refresh} />
    </div>
  );
}

function Group({ title, slots, entryFor, companyId, vehicleId, folder, onChanged }: {
  title: string;
  slots: PhotoSlot[];
  entryFor: (s: PhotoSlot) => Entry | null;
  companyId: string;
  vehicleId: string;
  folder: string;
  onChanged: () => void;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {slots.map((slot) => (
          <SlotBox
            key={slot.key}
            slot={slot}
            entry={entryFor(slot)}
            companyId={companyId}
            vehicleId={vehicleId}
            folder={folder}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

function SlotBox({ slot, entry, companyId, vehicleId, folder, onChanged }: {
  slot: PhotoSlot;
  entry: Entry | null;
  companyId: string;
  vehicleId: string;
  folder: string;
  onChanged: () => void;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [editFile, setEditFile] = useState<File | null>(null);
  const isDoc = folder === DOCS_FOLDER;
  const isImage = (entry?.att.content_type ?? '').startsWith('image/');

  /**
   * Remplace la pièce de cet emplacement. La NOUVELLE est téléversée D'ABORD :
   * si l'envoi échoue (réseau instable en concession), l'ancienne photo est
   * toujours là. L'ancienne n'est supprimée qu'après un envoi réussi.
   * `alreadyCompressed` : sortie de l'éditeur, déjà au bon format (pas de 2e passe).
   */
  const put = async (file: File, alreadyCompressed = false) => {
    setBusy(true);
    try {
      const small = alreadyCompressed ? file : await compressImageFile(file, isDoc ? 'document' : 'upload');
      await uploadAttachment(companyId, 'vehicle', vehicleId, small, Date.now(), slot.label, folder);
      if (entry) {
        try { await deleteAttachment(entry.att); }
        catch { /* remplacement fait : l'ancienne reste, non bloquant */ }
      }
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('tradein.errSave'));
    } finally {
      setBusy(false);
    }
  };

  /** Retouche : rapatrie l'image existante puis rouvre l'éditeur. */
  const openEditor = async () => {
    if (!entry?.url) return;
    setBusy(true);
    try {
      const resp = await fetch(entry.url);
      const blob = await resp.blob();
      setEditFile(new File([blob], entry.att.file_name || `${slot.key}.jpg`, { type: blob.type || 'image/jpeg' }));
    } catch {
      toast.error(t('tradein.errSave'));
    } finally {
      setBusy(false);
    }
  };

  /** Suppression définitive (pas de corbeille) → confirmation obligatoire. */
  const remove = async () => {
    if (!entry) return;
    if (!window.confirm(t('tradein.photoRemoveConfirm').replace('{label}', slot.label))) return;
    setBusy(true);
    try {
      await deleteAttachment(entry.att);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('tradein.errSave'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void put(f); if (camRef.current) camRef.current.value = ''; }} />
      <input ref={libRef} type="file" accept={isDoc ? 'image/*,application/pdf' : 'image/*'} className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void put(f); if (libRef.current) libRef.current.value = ''; }} />

      {busy ? (
        <div className="grid h-24 place-items-center bg-muted/50"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : entry?.url && isImage ? (
        <a href={entry.url} target="_blank" rel="noopener noreferrer" className="block">
          <img src={entry.url} alt={slot.label} className="h-24 w-full object-cover" />
        </a>
      ) : entry ? (
        <a href={entry.url ?? '#'} target="_blank" rel="noopener noreferrer" className="grid h-24 place-items-center bg-muted/50 text-muted-foreground">
          <FileText className="size-6" />
        </a>
      ) : (
        <button type="button" onClick={() => camRef.current?.click()} className="grid h-24 w-full place-items-center bg-muted/50 text-muted-foreground">
          {slot.free ? <ImageIcon className="size-6" /> : isDoc ? <FileText className="size-6" /> : <Camera className="size-6" />}
        </button>
      )}

      <div className="px-2 pb-1.5 pt-1.5">
        <p className="truncate text-[11px] leading-tight">{slot.label}</p>
        <div className="mt-1 flex items-center gap-1">
          <Act onClick={() => camRef.current?.click()} title={t('tradein.photoCamera')}><Camera className="size-3.5" /></Act>
          <Act onClick={() => libRef.current?.click()} title={t('tradein.photoGallery')}><ImagePlus className="size-3.5" /></Act>
          {entry && isImage && <Act onClick={openEditor} title={t('tradein.photoEdit')}><Pencil className="size-3.5" /></Act>}
          {entry && <Act onClick={remove} title={t('tradein.photoRemove')}><Trash2 className="size-3.5" /></Act>}
        </div>
      </div>

      <PhotoEditor
        open={!!editFile}
        onOpenChange={(o) => { if (!o) setEditFile(null); }}
        file={editFile}
        title={slot.label}
        onSave={(f) => { setEditFile(null); void put(f, true); }}
      />
    </div>
  );
}

function Act({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} title={title} aria-label={title}
      className="grid size-7 place-items-center rounded border border-border text-muted-foreground hover:border-[var(--ducati-red)] hover:text-[var(--ducati-red)]"
    >
      {children}
    </button>
  );
}
