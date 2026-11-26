/**
 * M8 — Mode operatoire de l'atelier (ATE014, 26/11/2026) : en-tete « Mode operatoire de l'atelier »
 * (auteur, date, version, photos, Modifier) pose dans ProcedureView, page « pas de mode operatoire »
 * avec « Ecrire le mode operatoire », et l'editeur (etapes, couples, outils, remarques, photos,
 * portee modele-annee / modele, versions). Regles : `./workshop-procedure-rules.ts`.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BookOpen, Camera, History, Loader2, NotebookPen, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { signedThumb, type Attachment } from '@/modules/documents/ged-api';
import { fill } from '@/modules/catalog/format';
import { t } from '@/lib/i18n';
import {
  addProcedurePhoto, listProcedurePhotos, listProcedureVersions, saveWorkshopProcedure,
} from './workshop-procedure-api';
import {
  cleanDraft, draftFrom, draftValid, scopeName, type OrProceduresInfo, type ProcedureDraft, type WorkshopProcedure,
} from './workshop-procedure-rules';

const frDay = (iso: string) => new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });

function PhotoThumb({ att }: { att: Attachment }) {
  const url = useQuery({ queryKey: ['own-proc-thumb', att.storage_path], queryFn: () => signedThumb(att.storage_path), staleTime: 30 * 60_000 });
  if (!url.data) return <div className="size-24 rounded-md border border-border bg-accent" />;
  return (
    <a href={url.data} target="_blank" rel="noreferrer" className="block size-24 overflow-hidden rounded-md border border-border bg-gray-0">
      <img src={url.data} alt={att.file_name} className="size-full object-cover" />
    </a>
  );
}

export function ProcedurePhotos({ procedureId }: { procedureId: string }) {
  const photos = useQuery({ queryKey: ['own-proc-photos', procedureId], queryFn: () => listProcedurePhotos(procedureId) });
  if (!photos.data?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {photos.data.map((a) => <PhotoThumb key={a.id} att={a} />)}
    </div>
  );
}

/** En-tete du mode operatoire de l'atelier, dans le pas a pas. */
export function WorkshopProcedureHeader({ wp, canWrite, onEdit }: { wp: WorkshopProcedure; canWrite: boolean; onEdit: () => void }) {
  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="info" icon={NotebookPen} label={t('ownProc.badge')} />
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {fill(t('ownProc.byline'), { who: wp.updated_by_name ?? wp.created_by_name ?? '?', date: frDay(wp.updated_at), v: wp.version })}
        </span>
        {canWrite && <Button variant="outline" className="ml-auto h-11 text-[14px]" onClick={onEdit}><Pencil /> {t('ownProc.edit')}</Button>}
      </div>
      <ProcedurePhotos procedureId={wp.id} />
    </section>
  );
}

/** Operation sans mode operatoire (ni Ducati ni atelier) : le dire, et proposer de l'ecrire. */
export function WorkshopProcedureEmpty({ label, info, onBack, onWrite }: { label: string; info: OrProceduresInfo | null; onBack: () => void; onWrite: () => void }) {
  return (
    <div className="pb-6">
      <div className="mb-4 flex items-start gap-3">
        <Button variant="outline" className="h-12 shrink-0 px-3" onClick={onBack} aria-label={t('journey.backToOps')}><ArrowLeft /></Button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[17px] font-bold uppercase leading-tight sm:text-[20px]">{label}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground"><BookOpen className="size-4" aria-hidden />{t('ownProc.emptyTitle')}</p>
        </div>
      </div>
      {!info?.model_id ? (
        <p className="text-[14px] text-muted-foreground">{t('ownProc.noModel')}</p>
      ) : info.can_write ? (
        <div className="space-y-3">
          <p className="text-[14px] text-muted-foreground">{t('ownProc.emptyHint')}</p>
          <Button className="h-12 text-[15px]" onClick={onWrite}><NotebookPen /> {t('ownProc.write')}</Button>
        </div>
      ) : (
        <p className="text-[14px] text-muted-foreground">{t('ownProc.noRight')}</p>
      )}
    </div>
  );
}

/** Liste de champs texte (etapes, outils) : ajouter / retirer. */
function TextList({ values, onChange, label, addLabel, multiline }: {
  values: string[]; onChange: (v: string[]) => void; label: (i: number) => string; addLabel: string; multiline?: boolean;
}) {
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          {multiline
            ? <Textarea rows={2} value={v} aria-label={label(i)} placeholder={label(i)} className="text-[15px]" onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
            : <Input value={v} aria-label={label(i)} placeholder={label(i)} className="h-11 text-[15px]" onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />}
          <Button type="button" variant="ghost" className="h-11 shrink-0 px-2" aria-label={t('ownProc.remove')} onClick={() => onChange(values.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" className="h-11 text-[14px]" onClick={() => onChange([...values, ''])}><Plus /> {addLabel}</Button>
    </div>
  );
}

export function WorkshopProcedureEditor({ open, orId, companyId, opLabel, info, existing, onClose }: {
  open: boolean; orId: string; companyId: string; opLabel: string; info: OrProceduresInfo | null;
  existing: WorkshopProcedure | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ProcedureDraft>(() => draftFrom(existing));
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (open) { setDraft(draftFrom(existing)); setSavedId(existing?.id ?? null); } }, [open, existing]);
  const versions = useQuery({ queryKey: ['own-proc-versions', savedId], queryFn: () => listProcedureVersions(savedId!), enabled: open && !!savedId });
  const set = (p: Partial<ProcedureDraft>) => setDraft((d) => ({ ...d, ...p }));

  const save = useMutation({
    mutationFn: () => saveWorkshopProcedure({ orId, opLabel, draft: cleanDraft(draft), id: savedId }),
    meta: { success: false },
    onSuccess: (wp) => {
      setSavedId(wp.id);
      toast.success(t('ownProc.saved'));
      void qc.invalidateQueries({ queryKey: ['own-procs', orId] });
      void qc.invalidateQueries({ queryKey: ['own-proc-versions', wp.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const photo = useMutation({
    mutationFn: (f: File) => addProcedurePhoto(companyId, savedId!, f),
    meta: { success: false },
    onSuccess: () => { toast.success(t('ownProc.photoSaved')); void qc.invalidateQueries({ queryKey: ['own-proc-photos', savedId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  const names = info ? { my: scopeName(info, 'model_year'), model: scopeName(info, 'model') } : { my: '', model: '' };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('ownProc.editorTitle')}</DialogTitle>
          <DialogDescription>{fill(t('ownProc.editorHint'), { op: opLabel })}</DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ownProc.scope')}</p>
          <RadioGroup value={draft.scope} onValueChange={(v) => set({ scope: v === 'model' ? 'model' : 'model_year' })} className="gap-2">
            <Label className="flex min-h-11 items-center gap-2 text-[15px] font-normal"><RadioGroupItem value="model_year" />{fill(t('ownProc.scopeModelYear'), { name: names.my })}</Label>
            <Label className="flex min-h-11 items-center gap-2 text-[15px] font-normal"><RadioGroupItem value="model" />{fill(t('ownProc.scopeModel'), { name: names.model })}</Label>
          </RadioGroup>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ownProc.stepsTitle')}</p>
          <TextList multiline values={draft.steps} onChange={(steps) => set({ steps })} label={(i) => fill(t('ownProc.stepN'), { n: i + 1 })} addLabel={t('ownProc.addStep')} />
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ownProc.torquesTitle')}</p>
          {draft.torques.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={c.label} placeholder={t('ownProc.torqueLabel')} aria-label={t('ownProc.torqueLabel')} className="h-11 flex-1 text-[15px]"
                onChange={(e) => set({ torques: draft.torques.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Input value={c.value} placeholder={t('ownProc.torqueValue')} aria-label={t('ownProc.torqueValue')} className="h-11 w-40 text-[15px] tabular-nums"
                onChange={(e) => set({ torques: draft.torques.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <Button type="button" variant="ghost" className="h-11 shrink-0 px-2" aria-label={t('ownProc.remove')} onClick={() => set({ torques: draft.torques.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" className="h-11 text-[14px]" onClick={() => set({ torques: [...draft.torques, { label: '', value: '' }] })}><Plus /> {t('ownProc.addTorque')}</Button>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ownProc.toolsTitle')}</p>
          <TextList values={draft.tools} onChange={(tools) => set({ tools })} label={() => t('ownProc.toolLabel')} addLabel={t('ownProc.addTool')} />
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ownProc.remarksTitle')}</p>
          <Textarea rows={3} value={draft.remarks} placeholder={t('ownProc.remarksHint')} className="text-[15px]" onChange={(e) => set({ remarks: e.target.value })} />
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('ownProc.photosTitle')}</p>
          {savedId ? (
            <>
              <ProcedurePhotos procedureId={savedId} />
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) photo.mutate(f); e.target.value = ''; }} />
              <Button type="button" variant="outline" className="h-11 text-[14px]" disabled={photo.isPending} onClick={() => fileRef.current?.click()}>
                {photo.isPending ? <Loader2 className="animate-spin" /> : <Camera />} {t('ownProc.addPhoto')}
              </Button>
            </>
          ) : <p className="text-[13px] text-muted-foreground">{t('ownProc.photosAfterSave')}</p>}
        </section>

        {!!versions.data?.length && (
          <section className="space-y-1">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"><History className="size-3.5" aria-hidden />{t('ownProc.versions')}</p>
            <ul className="space-y-0.5 text-[13px] text-muted-foreground tabular-nums">
              {versions.data.map((v) => <li key={v.id}>{fill(t('ownProc.versionLine'), { v: v.version, who: v.edited_by_name ?? '?', date: frDay(v.edited_at) })}</li>)}
            </ul>
          </section>
        )}

        <DialogFooter className="gap-2">
          {!draftValid(draft) && <p className="mr-auto self-center text-[13px] text-warning">{t('ownProc.needStep')}</p>}
          <Button variant="outline" className="h-12 text-[15px]" onClick={onClose}>{t('action.cancel')}</Button>
          <Button className="h-12 text-[15px]" disabled={!draftValid(draft) || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('ownProc.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
