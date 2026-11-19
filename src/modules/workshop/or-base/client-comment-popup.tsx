/**
 * M8 — Popup G8 « Commentaires client » (18/11/2026) : a l'ouverture d'un OR (et au choix du client
 * sur un nouvel OR), le commentaire de la fiche client (`contacts.notes`) s'affiche tout seul.
 * « Modifier » permet de le corriger sur place (la fiche client est mise a jour), « Valider » ferme.
 * Rien ne s'affiche si la fiche n'a pas de commentaire. Une fois par client et par ecran ouvert.
 * Lot « OR lisible » (19/11) : les lignes « Statut G8 : Client / Prospect… » ecrites par l'import
 * G8 ne sont pas un commentaire (presque toutes les fiches en ont une) : la fenetre ne s'ouvre que
 * pour un vrai texte, et n'affiche que lui ; « Modifier » garde la fiche complete.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquareText, Pencil, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t, fillVars } from '@/lib/i18n';
import { getContactComment, saveContactComment } from './api';
import { meaningfulClientComment } from './progress-rules';

export function ClientCommentPopup({ contactId }: { contactId: string | null }) {
  const qc = useQueryClient();
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const q = useQuery({
    queryKey: ['contact-comment', contactId], enabled: !!contactId, staleTime: 30_000,
    queryFn: () => getContactComment(contactId as string),
  });

  useEffect(() => {
    if (!contactId || shownFor === contactId || !q.data) return;
    setShownFor(contactId);
    if (meaningfulClientComment(q.data.notes)) { setDraft(q.data.notes); setEditing(false); setOpen(true); }
  }, [contactId, shownFor, q.data]);

  const save = useMutation({
    mutationFn: () => saveContactComment(contactId as string, draft),
    meta: { success: false },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-comment', contactId] });
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      toast.success(t('orBase.commentSaved'));
      setEditing(false);
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  if (!open || !q.data) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) setOpen(false); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageSquareText className="size-5" /> {t('orBase.commentTitle')}</DialogTitle>
          <DialogDescription>{fillVars(t('orBase.commentFor'), { name: q.data.name })}</DialogDescription>
        </DialogHeader>
        {editing
          ? <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} autoFocus />
          : <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 text-[14px]">{meaningfulClientComment(q.data.notes)}</p>}
        <DialogFooter className="gap-2">
          {editing ? (
            <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('orBase.commentSave')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> {t('orBase.commentEdit')}</Button>
          )}
          <Button onClick={() => setOpen(false)}>{t('orBase.commentValidate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
