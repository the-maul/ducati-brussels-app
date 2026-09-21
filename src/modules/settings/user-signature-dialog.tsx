/**
 * M10 — Nom et fonction d'un utilisateur pour la signature de ses e-mails (retour client du 21/09).
 * Ouvert depuis le menu du compte (« Ma signature e-mail ») pour soi-même, ou depuis
 * Paramètres → Utilisateurs (bouton « Signature ») par un administrateur.
 * Enregistré par `set_user_mail_signature` (droits vérifiés en base, trace `events`).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getUserSignature, setUserSignature } from './mail-signature-api';
import { t } from '@/lib/i18n';

export function UserSignatureDialog({ userId, displayName, onClose, onSaved }: {
  userId: string;
  /** Nom affiché dans le titre (avant chargement). */
  displayName: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['user-mail-signature', userId], queryFn: () => getUserSignature(userId), retry: false });
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  useEffect(() => {
    if (!q.data) return;
    setFullName(q.data.full_name ?? '');
    setJobTitle(q.data.job_title ?? '');
  }, [q.data]);

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => setUserSignature(userId, fullName, jobTitle),
    onSuccess: () => {
      setMsg({ ok: true, text: t('mailSignature.saved') });
      qc.invalidateQueries({ queryKey: ['user-mail-signature', userId] });
      onSaved?.();
    },
    onError: (e) => setMsg({ ok: false, text: t('mailSignature.saveError').replace('{error}', e instanceof Error ? e.message : String(e)) }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('mailSignature.userTitle').replace('{name}', fullName || displayName)}</DialogTitle>
          <DialogDescription>{t('mailSignature.userIntro')}</DialogDescription>
        </DialogHeader>
        {q.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {q.isError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('mailSignature.loadError')}</p>}
        {q.data && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sig-name">{t('mailSignature.fullName')}</Label>
              <Input id="sig-name" value={fullName} maxLength={120} onChange={(e) => { setFullName(e.target.value); setMsg(null); }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sig-title">{t('mailSignature.jobTitle')}</Label>
              <Input id="sig-title" value={jobTitle} maxLength={80} placeholder={t('mailSignature.jobTitlePlaceholder')} onChange={(e) => { setJobTitle(e.target.value); setMsg(null); }} />
            </div>
          </div>
        )}
        {msg && <p className={`rounded-md px-3 py-2 text-[13px] ${msg.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{msg.text}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('users.close')}</Button>
          <Button onClick={() => { setMsg(null); save.mutate(); }} disabled={!q.data || save.isPending || !fullName.trim()}>
            {save.isPending && <Loader2 className="animate-spin" />} {t('mailSignature.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
