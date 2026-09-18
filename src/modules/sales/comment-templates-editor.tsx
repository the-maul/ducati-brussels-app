/**
 * M6 — Paramètres → Commentaires types (mission 05, carte 5).
 * Nom court + texte (multi-lignes), actif, ordre. Suppression réservée à l'administrateur ;
 * les autres rôles désactivent. Toute écriture est tracée dans events (trigger audit_row).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import {
  listCommentTemplates, createCommentTemplate, updateCommentTemplate, deleteCommentTemplate,
  type CommentTemplate, type CommentTemplateInput,
} from './comment-templates-api';

const EMPTY: CommentTemplateInput = { name: '', body: '', is_active: true, sort_order: 0 };

export function CommentTemplatesEditor({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['comment-templates', companyId, 'all'],
    queryFn: () => listCommentTemplates(companyId),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['comment-templates', companyId] });
  const [draft, setDraft] = useState<CommentTemplateInput>(EMPTY);
  const create = useMutation({
    mutationFn: () => createCommentTemplate(companyId, draft),
    onSuccess: () => { setDraft(EMPTY); refresh(); },
  });

  if (isLoading) return <div className="grid place-items-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">{t('commentTemplates.intro')}</p>
      {(data ?? []).length === 0 && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('commentTemplates.empty')}</p>}
      {(data ?? []).map((c) => (
        <TemplateRow key={c.id} template={c} canDelete={isAdmin(companyId)} onChanged={refresh} />
      ))}

      <div className="space-y-3 rounded-md border border-dashed border-border bg-card p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('commentTemplates.new')}</p>
        <TemplateFields value={draft} onChange={setDraft} />
        {create.error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorText(create.error)}</p>}
        <Button onClick={() => create.mutate()} disabled={create.isPending || !draft.name.trim() || !draft.body.trim()}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('commentTemplates.add')}
        </Button>
      </div>
    </div>
  );
}

function TemplateRow({ template, canDelete, onChanged }: { template: CommentTemplate; canDelete: boolean; onChanged: () => void }) {
  const confirm = useConfirm();
  const initial: CommentTemplateInput = { name: template.name, body: template.body, is_active: template.is_active, sort_order: template.sort_order };
  const [value, setValue] = useState<CommentTemplateInput>(initial);
  useEffect(() => { setValue({ name: template.name, body: template.body, is_active: template.is_active, sort_order: template.sort_order }); },
    [template.name, template.body, template.is_active, template.sort_order]);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const save = useMutation({ mutationFn: () => updateCommentTemplate(template.id, value), onSuccess: onChanged });
  const del = useMutation({ mutationFn: () => deleteCommentTemplate(template.id), onSuccess: onChanged });
  return (
    <div className={`space-y-3 rounded-md border border-border bg-card p-4 ${value.is_active ? '' : 'opacity-70'}`}>
      <TemplateFields value={value} onChange={setValue} />
      {(save.error || del.error) && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorText(save.error ?? del.error)}</p>}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || !value.name.trim() || !value.body.trim()}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('action.save')}
        </Button>
        {canDelete && (
          <Button variant="outline" disabled={del.isPending}
            onClick={async () => { if (await confirm({ variant: 'delete', message: t('commentTemplates.deleteConfirm') })) del.mutate(); }}>
            <Trash2 className="text-danger" /> {t('commentTemplates.delete')}
          </Button>
        )}
      </div>
    </div>
  );
}

function TemplateFields({ value, onChange }: { value: CommentTemplateInput; onChange: (v: CommentTemplateInput) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem_8rem]">
      <div className="space-y-1.5">
        <Label>{t('commentTemplates.name')}</Label>
        <Input value={value.name} maxLength={60} placeholder={t('commentTemplates.namePlaceholder')} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>{t('commentTemplates.order')}</Label>
        <Input type="number" value={String(value.sort_order)} onChange={(e) => onChange({ ...value, sort_order: Number(e.target.value) || 0 })} className="text-right tabular-nums" />
      </div>
      <label className="flex items-end gap-2 pb-2 text-sm">
        <Checkbox checked={value.is_active} onCheckedChange={(v) => onChange({ ...value, is_active: v === true })} />
        {t('commentTemplates.active')}
      </label>
      <div className="space-y-1.5 sm:col-span-3">
        <Label>{t('commentTemplates.body')}</Label>
        <Textarea rows={3} value={value.body} maxLength={4000} onChange={(e) => onChange({ ...value, body: e.target.value })} />
      </div>
    </div>
  );
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? '');
  if (/duplicate key|unique/i.test(msg)) return t('commentTemplates.errDuplicate');
  return msg || t('sales.errSave');
}
