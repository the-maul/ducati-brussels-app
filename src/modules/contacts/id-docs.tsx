/**
 * M1 — Permis & ID : photos RECTO / VERSO du permis de conduire et de la carte
 * d'identité (appareil photo, téléchargement ou glisser-déposer, images et PDF),
 * indicateurs visuels clairs (par face + badge Complet/Incomplet par document),
 * stockage GED (dossiers Permis-recto/verso, CarteID-recto/verso), et lecture
 * automatique (fonction serveur read-id-doc, Claude vision) pour compléter les
 * champs vides de la fiche.
 */
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Camera, Loader2, Trash2, ZoomIn, FileText, CheckCircle2, AlertTriangle, ScanText,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { listAttachments, uploadAttachment, deleteAttachment, signedUrl, type Attachment } from '@/modules/documents/ged-api';
import { buildIdPatch, type ExtractedIdData, type IdTargets } from './id-docs-data';
import { t } from '@/lib/i18n';

/* eslint-disable @typescript-eslint/no-explicit-any */

type SlotDef = { folder: string; label: string };
type DocDef = { key: 'license' | 'idcard'; title: string; slots: SlotDef[] };

type SlotItem = { att: Attachment; url: string | null; isPdf: boolean };

const ACCEPT = 'image/*,.pdf,application/pdf';

export function IdDocsSection({ companyId, contactId, current, onApply }: {
  companyId: string;
  contactId: string | null;
  current: IdTargets;
  onApply: (patch: Partial<IdTargets>, filledLabels: string[]) => void;
}) {
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<{ url: string; title: string } | null>(null);

  const docs: DocDef[] = [
    {
      key: 'license', title: t('contacts.idLicense'),
      slots: [
        { folder: 'Permis-recto', label: t('contacts.idRecto') },
        { folder: 'Permis-verso', label: t('contacts.idVerso') },
      ],
    },
    {
      key: 'idcard', title: t('contacts.idCard'),
      slots: [
        { folder: 'CarteID-recto', label: t('contacts.idRecto') },
        { folder: 'CarteID-verso', label: t('contacts.idVerso') },
      ],
    },
  ];
  const allFolders = docs.flatMap((d) => d.slots.map((s) => s.folder));

  // Un scan par dossier (le plus récent)
  const scansQ = useQuery({
    queryKey: ['contact-id-docs', contactId],
    queryFn: async (): Promise<Record<string, SlotItem>> => {
      const atts = await listAttachments('contact', contactId!);
      const out: Record<string, SlotItem> = {};
      for (const folder of allFolders) {
        const att = atts.find((a) => a.folder === folder);
        if (!att) continue;
        const isPdf = (att.content_type ?? '') === 'application/pdf';
        let url: string | null = null;
        try { url = await signedUrl(att.storage_path); } catch { /* illisible */ }
        out[folder] = { att, url, isPdf };
      }
      return out;
    },
    enabled: !!contactId,
  });
  const scans = scansQ.data ?? {};
  const refresh = () => qc.invalidateQueries({ queryKey: ['contact-id-docs', contactId] });

  const upload = async (folder: string, label: string, file: File) => {
    if (!contactId) return;
    const ok = file.type.startsWith('image/') || file.type === 'application/pdf';
    if (!ok) { toast.error(t('contacts.idBadFile')); return; }
    // Remplacement : un seul scan par face
    const prev = scans[folder];
    if (prev) { try { await deleteAttachment(prev.att); } catch { /* non bloquant */ } }
    await uploadAttachment(companyId, 'contact', contactId, file, Date.now(), label, folder);
    refresh();
  };

  const del = useMutation({
    mutationFn: (att: Attachment) => deleteAttachment(att),
    onSuccess: refresh,
    onError: () => toast.error(t('contacts.uploadError')),
  });

  // Lecture automatique : envoie les scans présents à la fonction serveur
  const read = useMutation({
    mutationFn: async (): Promise<ExtractedIdData> => {
      const paths = allFolders.map((fo) => scans[fo]?.att.storage_path).filter(Boolean) as string[];
      const { data, error } = await (supabase as any).functions.invoke('read-id-doc', { body: { paths } });
      if (error) {
        const msg = String((error as { message?: string }).message ?? '');
        // Fonction non déployée / clé absente → message d'installation clair
        if (/not found|404|Failed to send|non-2xx/i.test(msg)) throw new Error('not_configured');
        throw new Error('read_failed');
      }
      if (data?.error === 'not_configured') throw new Error('not_configured');
      if (data?.error || !data?.data) throw new Error('read_failed');
      return data.data as ExtractedIdData;
    },
    onSuccess: (extracted) => {
      const patch = buildIdPatch(current, extracted);
      const labels: Record<string, string> = {
        first_name: t('contacts.firstName'), last_name: t('contacts.lastName'),
        birth_date: t('contacts.birthDate'), national_id: t('contacts.nationalId'),
        national_register: t('contacts.nationalRegister'), license_number: t('contacts.licenseNumber'),
        license_date: t('contacts.licenseDate'), license_place: t('contacts.licensePlace'),
        license_category: t('contacts.licenseCategory'),
      };
      const filled = Object.keys(patch).map((k) => labels[k] ?? k);
      onApply(patch, filled);
      if (filled.length) toast.success(t('contacts.idReadDone').replace('{fields}', filled.join(', ')));
      else toast.info(t('contacts.idReadNothing'));
    },
    onError: (e) => {
      toast.error(e instanceof Error && e.message === 'not_configured'
        ? t('contacts.idReadNotConfigured')
        : t('contacts.idReadError'));
    },
  });

  if (!contactId) {
    return <p className="col-span-full text-[12px] text-muted-foreground">{t('contacts.uploadHint')}</p>;
  }

  const hasAnyScan = allFolders.some((fo) => scans[fo]);

  return (
    <div className="col-span-full space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {docs.map((doc) => {
          const complete = doc.slots.every((s) => scans[s.folder]);
          const missing = doc.slots.filter((s) => !scans[s.folder]).map((s) => s.label);
          return (
            <div key={doc.key} className="rounded-md border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold">{doc.title}</p>
                {complete ? (
                  <span className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-success-bg px-2 py-0.5 text-[11px] font-bold uppercase text-success">
                    <CheckCircle2 className="size-3.5" /> {t('contacts.idComplete')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-warning-bg px-2 py-0.5 text-[11px] font-bold uppercase text-warning">
                    <AlertTriangle className="size-3.5" /> {t('contacts.idMissing').replace('{sides}', missing.join(' + '))}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {doc.slots.map((slot) => (
                  <IdSlot
                    key={slot.folder}
                    label={slot.label}
                    item={scans[slot.folder] ?? null}
                    onFile={(file) => upload(slot.folder, `${doc.title} — ${slot.label}`, file)}
                    onDelete={(att) => del.mutate(att)}
                    onZoom={(url) => setZoom({ url, title: `${doc.title} — ${slot.label}` })}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lecture automatique */}
      {hasAnyScan && (
        <Button type="button" variant="outline" size="sm" onClick={() => read.mutate()} disabled={read.isPending}>
          {read.isPending ? <Loader2 className="size-4 animate-spin" /> : <ScanText className="size-4" />}
          {read.isPending ? t('contacts.idReading') : t('contacts.idRead')}
        </Button>
      )}

      {/* Visionneuse */}
      <Dialog open={!!zoom} onOpenChange={(o) => { if (!o) setZoom(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>{zoom?.title}</DialogTitle></DialogHeader>
          {zoom && <img src={zoom.url} alt={zoom.title} className="max-h-[78vh] w-full rounded object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Une case Recto ou Verso : photo / téléchargement / glisser-déposer + aperçu. */
function IdSlot({ label, item, onFile, onDelete, onZoom }: {
  label: string;
  item: SlotItem | null;
  onFile: (file: File) => Promise<void>;
  onDelete: (att: Attachment) => void;
  onZoom: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try { await onFile(file); } catch { toast.error(t('contacts.uploadError')); } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      className={`relative rounded-md border ${dragOver ? 'border-info bg-info-bg' : 'border-dashed border-border'} p-2`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handle(e.dataTransfer.files?.[0]); }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="inline-flex items-center gap-1 text-[12px] font-bold uppercase">
          {item && <CheckCircle2 className="size-3.5 text-success" />}
          {label}
        </span>
        {item && (
          <button type="button" onClick={() => onDelete(item.att)} title={t('action.delete')}>
            <Trash2 className="size-3.5 text-danger" />
          </button>
        )}
      </div>

      {item ? (
        item.isPdf ? (
          <a
            href={item.url ?? undefined} target="_blank" rel="noopener noreferrer"
            className="flex h-20 flex-col items-center justify-center gap-1 rounded border border-border text-muted-foreground hover:text-foreground"
          >
            <FileText className="size-6" />
            <span className="max-w-full truncate px-1 text-[11px]">{item.att.file_name}</span>
          </a>
        ) : (
          <button
            type="button" onClick={() => item.url && onZoom(item.url)} title={t('articles.photoZoom')}
            className="group relative block h-20 w-full cursor-zoom-in overflow-hidden rounded border border-border"
          >
            {item.url && <img src={item.url} alt={label} className="h-full w-full object-cover transition-transform group-hover:scale-105" />}
            <span className="absolute inset-0 grid place-items-center text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
              <ZoomIn className="size-4" />
            </span>
          </button>
        )
      ) : (
        <button
          type="button" onClick={() => inputRef.current?.click()} disabled={busy}
          className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
          <span className="px-1 text-center text-[10px] leading-tight">{t('contacts.idDrop')}</span>
        </button>
      )}

      <input
        ref={inputRef} type="file" accept={ACCEPT} capture="environment" className="sr-only"
        onChange={(e) => handle(e.target.files?.[0])}
      />
    </div>
  );
}
