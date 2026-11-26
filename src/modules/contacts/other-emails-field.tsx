/**
 * M1 — « Autres e-mails » de la fiche client, sous l'e-mail principal (CON002, 26/11/2026).
 * Enregistré tout de suite (sans le bouton Enregistrer de la fiche) : une adresse ajoutée ici
 * rattache à la fiche les mails qui en arrivent, et la recherche la retrouve.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { addContactEmail, contactEmailErrorCode, listContactEmails, removeContactEmail } from './contact-emails-api';
import { checkNewEmail, otherEmails, type ContactEmailRow, type EmailKind } from './contact-emails-rules';

const ERR_KEYS: Record<string, string> = {
  CONTACT_EMAIL_EXISTS: 'contactEmails.errExists',
  CONTACT_EMAIL_INVALID: 'contactEmails.errInvalid',
  CONTACT_EMAIL_PRIMARY: 'contactEmails.errPrimary',
  FORBIDDEN: 'contactEmails.errForbidden',
};

function errText(e: unknown): string {
  const code = contactEmailErrorCode(e);
  return code && ERR_KEYS[code] ? t(ERR_KEYS[code]) : errorMessage(e);
}

function sourceNote(r: ContactEmailRow): string | null {
  if (r.source === 'mail') return t('contactEmails.sourceMail');
  if (r.source === 'fusion') return t('contactEmails.sourceFusion');
  if (r.source === 'fiche_pro') return t('contactEmails.sourceG8');
  return null;
}

export function OtherEmailsField({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const key = ['contact-emails', contactId];
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<'none' | EmailKind>('none');
  const [err, setErr] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({ queryKey: key, queryFn: () => listContactEmails(contactId), retry: false });
  const others = otherEmails(rows ?? []);

  const add = useMutation({
    mutationFn: () => addContactEmail(contactId, value, kind === 'none' ? null : kind),
    onSuccess: () => { setValue(''); setKind('none'); setErr(null); toast.success(t('contactEmails.added')); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => setErr(errText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeContactEmail(id),
    onSuccess: () => { toast.success(t('contactEmails.removed')); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(errText(e)),
  });

  const submit = () => {
    const check = checkNewEmail(value, (rows ?? []).map((r) => r.email));
    if (check === 'empty') { setErr(t('contactEmails.errEmpty')); return; }
    if (check === 'invalid') { setErr(t('contactEmails.errInvalid')); return; }
    if (check === 'exists') { setErr(t('contactEmails.errExists')); return; }
    add.mutate();
  };

  return (
    <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
      <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('contactEmails.otherTitle')}</p>
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : others.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t('contactEmails.none')}</p>
      ) : (
        <ul className="space-y-1">
          {others.map((r) => {
            const note = sourceNote(r);
            return (
              <li key={r.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[13px]">
                <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{r.email}</span>
                {r.kind && (
                  <span className="shrink-0 rounded-[4px] bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {r.kind === 'pro' ? t('contactEmails.kindPro') : t('contactEmails.kindPrive')}
                  </span>
                )}
                {note && <span className="shrink-0 text-[11px] text-muted-foreground">{note}</span>}
                <Button
                  type="button" size="icon" variant="ghost" className="ml-auto size-7 shrink-0"
                  aria-label={t('contactEmails.remove')} title={t('contactEmails.remove')}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="email" value={value} placeholder={t('contactEmails.placeholder')} className="min-w-0 flex-1 basis-56"
          onChange={(e) => { setValue(e.target.value); setErr(null); }}
          // Entrée ajoute l'adresse sans enregistrer le reste de la fiche.
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        />
        <Select value={kind} onValueChange={(v) => setKind(v as 'none' | EmailKind)}>
          <SelectTrigger className="w-36" aria-label={t('contactEmails.kindLabel')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('contactEmails.kindNone')}</SelectItem>
            <SelectItem value="pro">{t('contactEmails.kindPro')}</SelectItem>
            <SelectItem value="prive">{t('contactEmails.kindPrive')}</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" disabled={add.isPending} onClick={submit}>
          {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {t('contactEmails.add')}
        </Button>
      </div>
      {err && <p className="text-[12px] text-[var(--danger)]" role="alert">{err}</p>}
      <p className="text-[11px] text-muted-foreground">{t('contactEmails.otherHint')}</p>
    </div>
  );
}
