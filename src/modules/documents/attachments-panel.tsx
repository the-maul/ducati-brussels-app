/**
 * M9 — Panneau de pièces jointes (GED) réutilisable : upload, liste, ouverture, suppression.
 * Usage : <AttachmentsPanel companyId entityType="vehicle" entityId={id} />
 */
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload, Trash2, ExternalLink, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listAttachments, uploadAttachment, deleteAttachment, signedUrl, type Attachment } from './ged-api';
import { t } from '@/lib/i18n';

const kb = (n: number | null) => (n ? `${Math.round(n / 1024)} Ko` : '');

export function AttachmentsPanel({ companyId, entityType, entityId }: { companyId: string; entityType: string; entityId: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['attachments', entityType, entityId], queryFn: () => listAttachments(entityType, entityId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['attachments', entityType, entityId] });

  const up = useMutation({
    mutationFn: async (files: FileList) => {
      let i = 0;
      for (const f of Array.from(files)) { await uploadAttachment(companyId, entityType, entityId, f, Date.now() + i); i++; }
    },
    onSuccess: () => { refresh(); if (inputRef.current) inputRef.current.value = ''; },
    onError: (e) => setError(e instanceof Error ? e.message : t('ged.errUpload')),
  });
  const del = useMutation({ mutationFn: (a: Attachment) => deleteAttachment(a), onSuccess: refresh });
  const open = async (a: Attachment) => { const url = await signedUrl(a.storage_path); if (url) window.open(url, '_blank'); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) up.mutate(e.target.files); }} />
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={up.isPending}>
          {up.isPending ? <Loader2 className="animate-spin" /> : <Upload />} {t('ged.upload')}
        </Button>
        <span className="text-[12px] text-muted-foreground">{t('ged.hint')}</span>
      </div>
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      {isLoading ? <div className="grid place-items-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>{t('ged.colFile')}</Th><Th className="text-right">{t('ged.colSize')}</Th><Th>{t('ged.colDate')}</Th><Th className="w-20" /></tr></thead>
            <tbody>
              {data && data.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground"><Paperclip className="mr-1 inline size-4" />{t('ged.empty')}</td></tr>}
              {data?.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{a.file_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{kb(a.size_bytes)}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{new Date(a.created_at).toLocaleDateString('fr-BE')}</td>
                  <td className="px-2 py-1 text-center whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => open(a)}><ExternalLink className="size-4 text-info" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(a)} disabled={del.isPending}><Trash2 className="size-4 text-danger" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
