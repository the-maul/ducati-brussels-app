/**
 * M8 — Modeles de commentaires sur l'OR (G8 « Memoriser · Rappeler · Supprimer », 18/11/2026).
 * Meme bibliotheque que les commentaires types des documents de vente (Parametres → Commentaires,
 * table `document_comment_templates`) : un texte memorise depuis l'OR se retrouve dans les ventes.
 * Supprimer : l'administrateur supprime ; les autres roles retirent le modele de la liste (RLS).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, ChevronDown, FileText, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import {
  createCommentTemplate, deleteCommentTemplate, listCommentTemplates, updateCommentTemplate, type CommentTemplate,
} from '@/modules/sales/comment-templates-api';

/** Texte rappele : remplace un champ vide, sinon s'ajoute a la ligne. */
export function recallInto(current: string, body: string): string {
  return current.trim() ? `${current.replace(/\s+$/, '')}\n${body}` : body;
}

export function CommentTemplatesMenu({ companyId, text, onText, disabled = false }: { companyId: string; text: string; onText: (v: string) => void; disabled?: boolean }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState('');
  const key = ['comment-templates', companyId];
  const listQ = useQuery({ queryKey: key, queryFn: () => listCommentTemplates(companyId, true), staleTime: 60_000 });
  const templates = listQ.data ?? [];

  const save = useMutation({
    mutationFn: () => createCommentTemplate(companyId, {
      name: name.trim().slice(0, 60), body: text.trim().slice(0, 4000), is_active: true,
      sort_order: templates.reduce((m, x) => Math.max(m, x.sort_order), 0) + 10,
    }),
    meta: { success: false },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setSaveOpen(false); setName(''); toast.success(t('orBase.tplSaved')); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });
  const remove = useMutation({
    mutationFn: async (tpl: CommentTemplate) => {
      if (isAdmin()) { await deleteCommentTemplate(tpl.id); return 'deleted' as const; }
      await updateCommentTemplate(tpl.id, { name: tpl.name, body: tpl.body, is_active: false, sort_order: tpl.sort_order });
      return 'deactivated' as const;
    },
    meta: { success: false },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: key }); toast.success(t(r === 'deleted' ? 'orBase.tplDeleted' : 'orBase.tplDeactivated')); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={disabled}>
            {t('orBase.tplMenu')} <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
          <DropdownMenuLabel>{t('orBase.tplRecall')}</DropdownMenuLabel>
          {templates.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">{t('orBase.tplEmpty')}</p>}
          {templates.map((tpl) => (
            <DropdownMenuItem key={tpl.id} onSelect={() => onText(recallInto(text, tpl.body))}>
              <FileText className="size-4" />
              <span className="truncate">{tpl.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { if (!text.trim()) { toast.error(t('orBase.tplNeedText')); return; } setSaveOpen(true); }}>
            <BookmarkPlus className="size-4" /> {t('orBase.tplSave')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} disabled={templates.length === 0}>
            <Trash2 className="size-4" /> {t('orBase.tplDelete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={(o) => { if (!o) setSaveOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('orBase.tplSaveTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>{t('orBase.tplName')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">{text}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>{t('action.cancel')}</Button>
            <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <BookmarkPlus />} {t('orBase.tplSaveAction')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(o) => { if (!o) setDeleteOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('orBase.tplDeleteTitle')}</DialogTitle></DialogHeader>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px]">{tpl.name}</span>
                <Button
                  size="sm" variant="ghost" disabled={remove.isPending}
                  onClick={() => { if (window.confirm(fillVars(t('orBase.tplDeleteConfirm'), { name: tpl.name }))) remove.mutate(tpl); }}
                >
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </li>
            ))}
            {templates.length === 0 && <li className="text-[13px] text-muted-foreground">{t('orBase.tplEmpty')}</li>}
          </ul>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>{t('action.cancel')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
