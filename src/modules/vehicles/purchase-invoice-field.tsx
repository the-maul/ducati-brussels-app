/**
 * M3/M9 — Facture d'achat du véhicule : glisser-déposer ou téléverser le PDF.
 * Stockage via la GED (bucket 'ged', entityType 'vehicle', dossier "Facture d'achat"),
 * donc la pièce apparaît aussi dans le panneau Documents de la fiche.
 * Disponible une fois le véhicule enregistré (un id est requis pour rattacher le fichier).
 * NB : rendu à l'intérieur du <form> de la fiche → tous les boutons sont type="button".
 */
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload, Trash2, ExternalLink, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listAttachments, uploadAttachment, deleteAttachment, signedUrl, type Attachment } from '@/modules/documents/ged-api';
import { t } from '@/lib/i18n';

const FOLDER = "Facture d'achat";

export function PurchaseInvoiceField({ companyId, vehicleId }: { companyId: string; vehicleId: string | null }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', 'vehicle', vehicleId],
    queryFn: () => listAttachments('vehicle', vehicleId!),
    enabled: !!vehicleId,
  });
  const invoices = (data ?? []).filter((a) => a.folder === FOLDER);
  const refresh = () => qc.invalidateQueries({ queryKey: ['attachments', 'vehicle', vehicleId] });

  const up = useMutation({
    mutationFn: async (files: FileList) => {
      let i = 0;
      for (const file of Array.from(files)) { await uploadAttachment(companyId, 'vehicle', vehicleId!, file, Date.now() + i, FOLDER, FOLDER); i++; }
    },
    onSuccess: () => { setError(null); refresh(); if (inputRef.current) inputRef.current.value = ''; },
    onError: (e) => setError(e instanceof Error ? e.message : t('ged.errUpload')),
  });
  const del = useMutation({ mutationFn: (a: Attachment) => deleteAttachment(a), onSuccess: refresh });
  const open = async (a: Attachment) => { const url = await signedUrl(a.storage_path); if (url) window.open(url, '_blank', 'noopener,noreferrer'); };

  if (!vehicleId) {
    return <p className="text-[13px] text-muted-foreground">{t('vehicles.invoiceSaveFirst')}</p>;
  }

  return (
    <div
      className={`space-y-2 rounded-md border-2 border-dashed p-3 ${dropActive ? 'border-[var(--ducati-red)] bg-accent' : 'border-border'}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropActive(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false); }}
      onDrop={(e) => { setDropActive(false); if (e.dataTransfer.files?.length) { e.preventDefault(); up.mutate(e.dataTransfer.files); } }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) up.mutate(e.target.files); }} />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={up.isPending}>
          {up.isPending ? <Loader2 className="animate-spin" /> : <Upload />} {t('vehicles.invoiceUpload')}
        </Button>
        <span className="text-[12px] text-muted-foreground">{t('vehicles.invoiceDragHint')}</span>
      </div>
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : invoices.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t('vehicles.invoiceEmpty')}</p>
      ) : (
        <ul className="space-y-1">
          {invoices.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-[13px]">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <button type="button" onClick={() => open(a)} className="flex-1 truncate text-left text-primary hover:underline">{a.file_name}</button>
              <Button type="button" size="sm" variant="ghost" onClick={() => open(a)}><ExternalLink className="size-4 text-info" /></Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => del.mutate(a)} disabled={del.isPending}><Trash2 className="size-4 text-danger" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
