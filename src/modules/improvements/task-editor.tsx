/**
 * M0 — Éditeur d'une tâche d'amélioration (création puis édition complète).
 * Titre, description, statut, checklist (points + sous-points), documents (GED).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, CornerDownRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AttachmentsPanel } from '@/modules/documents/attachments-panel';
import { t } from '@/lib/i18n';
import {
  IMPROVEMENT_STATUSES, type Improvement, type ImprovementStatus,
  createImprovement, updateImprovement, deleteImprovement,
  listPoints, createPoint, updatePoint, deletePoint,
} from './api';
import { STATUS_META } from './status';

export function TaskEditor({ companyId, improvement, open, onOpenChange }: {
  companyId: string;
  improvement: Improvement | null;       // null = création
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [id, setId] = useState<string | null>(improvement?.id ?? null);
  const [title, setTitle] = useState(improvement?.title ?? '');
  const [description, setDescription] = useState(improvement?.description ?? '');
  const [status, setStatus] = useState<ImprovementStatus>((improvement?.status as ImprovementStatus) ?? 'pending');
  const refreshBoard = () => qc.invalidateQueries({ queryKey: ['improvements', companyId] });

  const create = useMutation({
    mutationFn: () => createImprovement({ companyId, title: title.trim(), description, status }),
    onSuccess: (newId) => { setId(newId); refreshBoard(); },
  });
  const saveField = (patch: Parameters<typeof updateImprovement>[1]) => {
    if (!id) return;
    updateImprovement(id, patch).then(refreshBoard);
  };
  const remove = useMutation({
    mutationFn: () => deleteImprovement(id!),
    onSuccess: () => { refreshBoard(); onOpenChange(false); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{id ? t('improvements.editTask') : t('improvements.newTask')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Lbl>{t('improvements.fTitle')}</Lbl>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => id && title.trim() && saveField({ title: title.trim() })} placeholder={t('improvements.titlePlaceholder')} />
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Lbl>{t('improvements.fStatus')}</Lbl>
              <Select value={status} onValueChange={(v) => { setStatus(v as ImprovementStatus); saveField({ status: v }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IMPROVEMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(STATUS_META[s].labelKey)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Lbl>{t('improvements.fDescription')}</Lbl>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => id && saveField({ description: description || null })} rows={3} placeholder={t('improvements.descPlaceholder')} />
          </div>

          {!id ? (
            <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('improvements.createHint')}</p>
          ) : (
            <>
              <PointsEditor companyId={companyId} improvementId={id} />
              <div className="space-y-1">
                <Lbl>{t('improvements.fDocuments')}</Lbl>
                <AttachmentsPanel companyId={companyId} entityType="improvement" entityId={id} />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {id ? (
            <Button variant="ghost" className="text-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              <Trash2 className="size-4" /> {t('improvements.delete')}
            </Button>
          ) : <span />}
          {!id
            ? <Button onClick={() => create.mutate()} disabled={create.isPending || !title.trim()}>{create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('improvements.create')}</Button>
            : <Button variant="outline" onClick={() => onOpenChange(false)}>{t('improvements.close')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Checklist points + sous-points. */
function PointsEditor({ companyId, improvementId }: { companyId: string; improvementId: string }) {
  const qc = useQueryClient();
  const key = ['improvement-points', improvementId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => listPoints(improvementId) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const [newRoot, setNewRoot] = useState('');
  const [subFor, setSubFor] = useState<string | null>(null);
  const [subLabel, setSubLabel] = useState('');

  const add = useMutation({ mutationFn: (p: { label: string; parentId: string | null }) => createPoint({ companyId, improvementId, parentId: p.parentId, label: p.label }), onSuccess: refresh });
  const upd = useMutation({ mutationFn: (p: { id: string; patch: Parameters<typeof updatePoint>[1] }) => updatePoint(p.id, p.patch), onSuccess: refresh });
  const del = useMutation({ mutationFn: (pid: string) => deletePoint(pid), onSuccess: refresh });

  const roots = (data ?? []).filter((p) => !p.parent_id);
  const childrenOf = (pid: string) => (data ?? []).filter((p) => p.parent_id === pid);

  const Row = ({ id, label, done, sub }: { id: string; label: string; done: boolean; sub?: boolean }) => (
    <div className={`flex items-center gap-2 ${sub ? 'ml-6' : ''}`}>
      {sub && <CornerDownRight className="size-3 shrink-0 text-muted-foreground" />}
      <Checkbox checked={done} onCheckedChange={(v) => upd.mutate({ id, patch: { done: !!v } })} />
      <Input defaultValue={label} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== label) upd.mutate({ id, patch: { label: v } }); }}
        className={`h-8 flex-1 border-transparent px-1 shadow-none focus-visible:border-border ${done ? 'text-muted-foreground line-through' : ''}`} />
      {!sub && <Button size="sm" variant="ghost" className="size-7 p-0" title={t('improvements.addSubPoint')} onClick={() => { setSubFor(subFor === id ? null : id); setSubLabel(''); }}><CornerDownRight className="size-3.5" /></Button>}
      <Button size="sm" variant="ghost" className="size-7 p-0" onClick={() => del.mutate(id)}><Trash2 className="size-3.5 text-danger" /></Button>
    </div>
  );

  return (
    <div className="space-y-1.5">
      <Lbl>{t('improvements.fPoints')}</Lbl>
      {isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
        <div className="space-y-1.5 rounded-md border border-border p-2">
          {roots.length === 0 && <p className="px-1 text-[12px] text-muted-foreground">{t('improvements.noPoints')}</p>}
          {roots.map((p) => (
            <div key={p.id} className="space-y-1.5">
              <Row id={p.id} label={p.label} done={p.done} />
              {childrenOf(p.id).map((c) => <Row key={c.id} id={c.id} label={c.label} done={c.done} sub />)}
              {subFor === p.id && (
                <div className="ml-6 flex items-center gap-2">
                  <CornerDownRight className="size-3 shrink-0 text-muted-foreground" />
                  <Input autoFocus value={subLabel} onChange={(e) => setSubLabel(e.target.value)} placeholder={t('improvements.subPointPlaceholder')} className="h-8"
                    onKeyDown={(e) => { if (e.key === 'Enter' && subLabel.trim()) { add.mutate({ label: subLabel.trim(), parentId: p.id }); setSubLabel(''); } }} />
                  <Button size="sm" variant="outline" onClick={() => { if (subLabel.trim()) { add.mutate({ label: subLabel.trim(), parentId: p.id }); setSubLabel(''); } }}><Plus className="size-3.5" /></Button>
                </div>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Plus className="size-3.5 shrink-0 text-muted-foreground" />
            <Input value={newRoot} onChange={(e) => setNewRoot(e.target.value)} placeholder={t('improvements.pointPlaceholder')} className="h-8"
              onKeyDown={(e) => { if (e.key === 'Enter' && newRoot.trim()) { add.mutate({ label: newRoot.trim(), parentId: null }); setNewRoot(''); } }} />
            <Button size="sm" variant="outline" onClick={() => { if (newRoot.trim()) { add.mutate({ label: newRoot.trim(), parentId: null }); setNewRoot(''); } }} disabled={!newRoot.trim()}>{t('improvements.addPoint')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>;
}
