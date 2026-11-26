/**
 * M1 — « Mails à rattacher » (CON002, 26/11/2026). Un mail arrive d'une adresse inconnue mais au
 * nom d'un client existant (même prénom + nom, ou même société) : la relève ne crée plus de fiche,
 * elle demande. Le choix rattache le mail et ses pièces jointes ; « Ajouter cette adresse à … »
 * ajoute aussi l'adresse en e-mail secondaire de la fiche choisie.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2, Mail, Paperclip, UserPlus, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import {
  contactEmailErrorCode, listEmailAttachRequests, resolveEmailAttachRequest,
  type AttachCandidate, type EmailAttachRequest,
} from './contact-emails-api';
import { homonymReason } from './contact-emails-rules';

export const emailAttachKey = (companyId: string | null | undefined) => ['email-attach-requests', companyId];

/** Les mails en attente de la société (cloche). */
export function useEmailAttachRequests(companyId: string | null | undefined) {
  return useQuery({
    queryKey: emailAttachKey(companyId),
    queryFn: () => listEmailAttachRequests(companyId!),
    enabled: !!companyId,
    refetchInterval: 120_000,
    retry: false,
  });
}

export function requestLabel(r: EmailAttachRequest): string {
  return r.company_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || r.sender || '—';
}

const candidateLabel = (c: AttachCandidate) => [c.name, c.code, c.city].filter(Boolean).join(' · ');
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function EmailAttachDialog({ companyId, request, onClose }: {
  companyId: string; request: EmailAttachRequest | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const resolve = useMutation({
    mutationFn: (contactId: string | null) => resolveEmailAttachRequest(request!.id, contactId),
    onSuccess: (res, contactId) => {
      const chosen = request?.candidates.find((c) => c.id === contactId);
      toast.success(
        contactId ? fillVars(t('contactEmails.done'), { client: chosen ? candidateLabel(chosen) : '' }) : t('contactEmails.doneNew'),
        {
          action: { label: t('contacts.dupOpen'), onClick: () => { navigate({ to: '/clients/$contactId', params: { contactId: res.contact_id } }); } },
        },
      );
      qc.invalidateQueries({ queryKey: emailAttachKey(companyId) });
      qc.invalidateQueries({ queryKey: ['contact-emails', res.contact_id] });
      onClose();
    },
    onError: (e) => {
      toast.error(contactEmailErrorCode(e) === 'EMAIL_REQUEST_DONE' ? t('contactEmails.errDone') : errorMessage(e));
      qc.invalidateQueries({ queryKey: emailAttachKey(companyId) });
    },
  });

  const r = request;
  return (
    <Dialog open={!!r} onOpenChange={(o) => { if (!o && !resolve.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('contactEmails.dialogTitle')}</DialogTitle>
        </DialogHeader>
        {r && (
          <div className="space-y-3 text-[13px]">
            <p className="text-muted-foreground">{t('contactEmails.dialogIntro')}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border p-2.5">
              <dt className="text-muted-foreground">{t('contactEmails.from')}</dt>
              <dd className="min-w-0 break-all">
                <span className="font-medium">{requestLabel(r)}</span>
                {r.email && <span className="text-muted-foreground"> · {r.email}</span>}
              </dd>
              {r.subject && (<><dt className="text-muted-foreground">{t('contactEmails.subject')}</dt><dd className="min-w-0">{r.subject}</dd></>)}
              {r.received_at && (<><dt className="text-muted-foreground">{t('contactEmails.received')}</dt><dd>{fmt(r.received_at)}</dd></>)}
              {r.attachments.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{t('contactEmails.attachments')}</dt>
                  <dd className="min-w-0">
                    {r.attachments.map((a, i) => (
                      <span key={i} className="mr-2 inline-flex items-center gap-1"><Paperclip className="size-3" />{a}</span>
                    ))}
                  </dd>
                </>
              )}
            </dl>
            {r.preview && <p className="line-clamp-4 rounded-md bg-muted px-2.5 py-2 text-[12px] text-muted-foreground">{r.preview}</p>}

            <p className="font-medium">{t('contactEmails.candidatesTitle')}</p>
            <div className="space-y-1.5">
              {r.candidates.map((c) => {
                const why = homonymReason(r, c);
                return (
                  <div key={c.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <Link to="/clients/$contactId" params={{ contactId: c.id }} className="block truncate font-medium text-info hover:underline" target="_blank">
                        {candidateLabel(c)}
                      </Link>
                      {why && (
                        <span className="text-[11px] text-muted-foreground">
                          {why === 'nom' ? t('contactEmails.reasonName') : t('contactEmails.reasonCompany')}
                        </span>
                      )}
                    </div>
                    <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={resolve.isPending}
                      onClick={() => resolve.mutate(c.id)}>
                      {resolve.isPending && resolve.variables === c.id ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />}
                      {fillVars(t(r.email ? 'contactEmails.addTo' : 'contactEmails.attachTo'), { client: c.code || c.name || '' })}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" disabled={resolve.isPending} onClick={onClose}>{t('contactEmails.later')}</Button>
          <Button type="button" variant="outline" disabled={resolve.isPending || !r} onClick={() => resolve.mutate(null)}>
            {resolve.isPending && resolve.variables === null ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            {t('contactEmails.createNew')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Une ligne de la cloche. */
export function EmailAttachBellRow({ request }: { request: EmailAttachRequest }) {
  return (
    <span className="flex w-full flex-col items-start gap-0.5">
      <span className="flex w-full items-center gap-1.5">
        <Mail className="size-3.5 shrink-0 text-[var(--warning)]" />
        <span className="truncate text-[13px] font-medium">{requestLabel(request)}</span>
      </span>
      <span className="w-full truncate text-[11px] text-muted-foreground">{request.subject || request.email || ''}</span>
      <span className="text-[11px] text-muted-foreground">{t('contactEmails.bellItemHint')}{request.received_at ? ` · ${fmt(request.received_at)}` : ''}</span>
    </span>
  );
}
