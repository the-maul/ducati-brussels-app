/**
 * M6 — Fenêtre « Envoyer par e-mail » d'un document de vente, PDF joint (mission 05 carte 8,
 * mission 02 carte 6). Destinataire = e-mail du client (modifiable) ; boîte d'envoi au choix
 * selon la règle du CRM (boîtes partagées de la société + adresse de l'utilisateur si même
 * domaine ; par défaut celle qui a reçu le dernier mail du client) ; objet et message
 * pré-remplis modifiables ; « Vérifier sans envoyer » = simulation côté serveur.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { listCompanyMailboxes, listCommunications } from '@/modules/crm/api';
import { contactDisplayName, type Contact } from '@/modules/contacts/api';
import { t } from '@/lib/i18n';
import type { DocumentFull } from './write-api';
import { generateSalesPdf, pdfBlob } from './document-pdf-data';
import { sendDocumentMail, mailErrorLabel, type DryRunPreview } from './document-mail-api';

const fill = (s: string, vars: Record<string, string>) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), s);

export function DocumentMailDialog({ full, contact, companyName, onClose }: {
  full: DocumentFull; contact: Contact; companyName: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { doc } = full;
  const { session } = useAuth();
  const myEmail = (session?.user?.email ?? '').toLowerCase();

  const vars = {
    type: t(`sales.type_${doc.doc_type}`), number: doc.number ?? t('sales.draftSuffix'),
    company: companyName, client: contactDisplayName(contact),
  };
  const isReservation = doc.doc_type === 'RES';
  const [to, setTo] = useState(contact.email ?? '');
  const [subject, setSubject] = useState(fill(t(isReservation ? 'salesMail.subjectRes' : 'salesMail.subjectDefault'), vars));
  const [body, setBody] = useState(fill(t(isReservation ? 'salesMail.bodyRes' : 'salesMail.bodyDefault'), vars));
  const [preview, setPreview] = useState<DryRunPreview & { from: string } | null>(null);

  // Boîtes d'envoi : même règle que les échanges du CRM (communications-panel).
  const mailboxesQ = useQuery({ queryKey: ['company-mailboxes', doc.company_id], queryFn: () => listCompanyMailboxes(doc.company_id) });
  const commsQ = useQuery({ queryKey: ['comms', contact.id], queryFn: () => listCommunications(contact.id) });
  const shared = (mailboxesQ.data ?? []).map((m) => m.address.toLowerCase());
  const sameDomain = shared.some((a) => a.split('@')[1] === myEmail.split('@')[1]);
  const senders = [...shared, ...(myEmail && sameDomain && !shared.includes(myEmail) ? [myEmail] : [])];
  const lastInboundBox = (commsQ.data ?? []).find((c) => c.channel === 'email' && c.direction === 'in' && c.mailbox)?.mailbox?.toLowerCase() ?? '';
  const [fromBox, setFromBox] = useState('');
  const [fromTouched, setFromTouched] = useState(false);
  useEffect(() => {
    if (fromTouched) return;
    const pick = senders.includes(lastInboundBox) ? lastInboundBox : (senders.includes(myEmail) ? myEmail : senders[0] ?? '');
    if (pick && pick !== fromBox) setFromBox(pick);
  }, [lastInboundBox, senders.join('|'), myEmail, fromTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le PDF est généré une fois à l'ouverture : c'est exactement lui qui part et qui est archivé.
  const pdfQ = useQuery({ queryKey: ['sales-pdf', doc.id, doc.updated_at], queryFn: () => generateSalesPdf(full), staleTime: Infinity, gcTime: 0 });
  const pdfKo = pdfQ.data ? Math.max(1, Math.round(pdfQ.data.bytes.length / 1024)) : 0;
  const openPdf = () => {
    if (!pdfQ.data) return;
    const url = URL.createObjectURL(pdfBlob(pdfQ.data.bytes));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  };

  const validTo = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to.trim());
  const canSend = validTo && !!subject.trim() && !!pdfQ.data && !!fromBox;

  const run = useMutation({
    mutationFn: (dryRun: boolean) => sendDocumentMail({
      full, contactId: contact.id, to, from: fromBox || undefined, subject, body, dryRun, pdf: pdfQ.data,
    }),
    meta: { success: false, error: false },
    onSuccess: (r) => {
      if (!r.ok) { toast.error(mailErrorLabel(r.error)); return; }
      if (r.dryRun) { setPreview({ ...(r.preview as DryRunPreview), from: r.from }); return; }
      toast.success(fill(t('salesMail.sent'), { to: to.trim(), from: r.from }));
      if (!r.archived) toast.warning(t('salesMail.archiveFailed'));
      qc.invalidateQueries({ queryKey: ['attachments'] });
      qc.invalidateQueries({ queryKey: ['comms', contact.id] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('salesMail.errGeneric')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('salesMail.title')}</DialogTitle>
          <DialogDescription>{t('salesMail.intro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('salesMail.from')}</Label>
              <Select value={fromBox} onValueChange={(v) => { setFromTouched(true); setFromBox(v); setPreview(null); }}>
                <SelectTrigger><SelectValue placeholder={t('salesMail.fromPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  {senders.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}{a === lastInboundBox ? ` · ${t('crm.fromReceivedHere')}` : a === myEmail ? ` · ${t('crm.fromMyAddress')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('salesMail.to')}</Label>
              <Input type="email" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} placeholder={t('salesMail.toPlaceholder')} />
              {!contact.email && <p className="text-[12px] text-muted-foreground">{t('salesMail.noClientEmail')}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('salesMail.subject')}</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('salesMail.body')}</Label>
            <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="text-[12px] text-muted-foreground">{t('salesMail.footerHint')}</p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            {pdfQ.isLoading && <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {t('salesMail.pdfBuilding')}</span>}
            {pdfQ.isError && <span className="text-danger">{t('salesMail.pdfError')}</span>}
            {pdfQ.data && <span className="flex-1 truncate">{pdfQ.data.fileName} <span className="tabular-nums text-muted-foreground">· {pdfKo} Ko</span></span>}
            {pdfQ.data && <Button type="button" size="sm" variant="outline" onClick={openPdf}><Eye /> {t('salesMail.openPdf')}</Button>}
          </div>
          {isReservation && <p className="text-[12px] text-muted-foreground">{t('salesMail.resAllLines')}</p>}
          <p className="text-[12px] text-muted-foreground">{t('salesMail.archiveHint')}</p>
          {preview && (
            <div className="space-y-1 rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">
              <p className="flex items-center gap-1.5 font-medium"><ShieldCheck className="size-3.5" /> {t('salesMail.dryRunOk')}</p>
              <p>{fill(t('salesMail.dryRunDetail'), {
                from: preview.from, to: to.trim(),
                files: preview.attachments.map((a) => `${a.name} (${Math.max(1, Math.round(a.size / 1024))} Ko)`).join(', '),
                footer: preview.footer === 'join' ? t('salesMail.footerJoin') : preview.footer === 'login' ? t('salesMail.footerLogin') : t('salesMail.footerNone'),
              })}</p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending || !canSend} title={t('salesMail.dryRunHint')}>
            {run.isPending && run.variables === true ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('salesMail.dryRun')}
          </Button>
          <Button onClick={() => run.mutate(false)} disabled={run.isPending || !canSend}>
            {run.isPending && run.variables === false ? <Loader2 className="animate-spin" /> : <Mail />} {t('salesMail.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
