/**
 * M8 — Fenetre « Envoyer le dossier a Ducati » (mission 09, carte 5). Meme regle que l'envoi
 * d'un document de vente : boite d'envoi = boite partagee de la societe ou adresse de
 * l'utilisateur connecte (meme domaine) ; destinataire et copie lus dans Parametres → Tables
 * (`accident_file_mail`, copie vide par defaut) ; objet et message pre-remplis (texte de
 * Domenico) modifiables ; « Verifier sans envoyer » = simulation cote serveur, rien ne part.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Image, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { MailPreview } from '@/components/mail-preview';
import { useAuth } from '@/lib/auth/auth-context';
import { listCompanyMailboxes } from '@/modules/crm/api';
import { mailErrorLabel, type DryRunPreview } from '@/modules/sales/document-mail-api';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { loadAccidentMailSettings, type AccidentFileFull } from './api';
import { sendAccidentFile, accidentNames } from './send';
import { accidentAttachmentNames, accidentMailBody, accidentMailSubject, splitAddresses } from './rules';

const ACCIDENT_ERRORS = ['accident_no_quote', 'accident_no_vin_photo', 'accident_vin_photo_unreadable'];
export function accidentErrorLabel(code: string): string {
  return ACCIDENT_ERRORS.includes(code) ? t(`accidentFile.err_${code}`) : mailErrorLabel(code);
}

export function AccidentSendDialog({ file, companyName, onClose, onSent }: {
  file: AccidentFileFull; companyName: string; onClose: () => void; onSent: () => void;
}) {
  const { session } = useAuth();
  const myEmail = (session?.user?.email ?? '').toLowerCase();
  const names = accidentNames(file);
  const mailInput = { clientName: names.clientName, model: names.model, vin: names.vin, isUrgent: file.is_urgent, urgentNote: file.urgent_note };
  const fileNames = accidentAttachmentNames(names);

  const settingsQ = useQuery({ queryKey: ['accident-mail-settings', file.company_id], queryFn: () => loadAccidentMailSettings(file.company_id) });
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [toTouched, setToTouched] = useState(false);
  useEffect(() => {
    if (settingsQ.data && !toTouched) { setTo(settingsQ.data.to); setCc(settingsQ.data.cc.join(', ')); }
  }, [settingsQ.data, toTouched]);
  const [subject, setSubject] = useState(file.mail_subject ?? accidentMailSubject(mailInput));
  const [body, setBody] = useState(accidentMailBody(mailInput));
  const [preview, setPreview] = useState<DryRunPreview & { from: string } | null>(null);

  // Boites d'envoi : boites partagees + adresse de l'utilisateur si meme domaine (regle du CRM).
  const mailboxesQ = useQuery({ queryKey: ['company-mailboxes', file.company_id], queryFn: () => listCompanyMailboxes(file.company_id) });
  const shared = (mailboxesQ.data ?? []).map((m) => m.address.toLowerCase());
  const sameDomain = shared.some((a) => a.split('@')[1] === myEmail.split('@')[1]);
  const senders = [...shared, ...(myEmail && sameDomain && !shared.includes(myEmail) ? [myEmail] : [])];
  const [fromBox, setFromBox] = useState('');
  const [fromTouched, setFromTouched] = useState(false);
  useEffect(() => {
    if (fromTouched || !senders.length) return;
    const pick = senders.includes(myEmail) ? myEmail : senders[0];
    if (pick && pick !== fromBox) setFromBox(pick);
  }, [senders.join('|'), myEmail, fromTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const validTo = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to.trim());
  const canSend = validTo && !!subject.trim() && !!fromBox;
  const noMailbox = mailboxesQ.isSuccess && senders.length === 0;

  const run = useMutation({
    mutationFn: (dryRun: boolean) => sendAccidentFile({
      file, from: fromBox || undefined, to, cc: splitAddresses(cc), subject, body, dryRun, companyName,
      labels: { vin: t('accidentFile.pdfVin'), photo: t('accidentFile.pdfPhoto'), page: t('accidentFile.pdfPage'), gedNote: t('accidentFile.gedNote') },
    }),
    meta: { success: false, error: false },
    onSuccess: (r) => {
      if (!r.ok) { toast.error(accidentErrorLabel(r.error)); return; }
      if (r.dryRun) { setPreview({ ...(r.preview as DryRunPreview), from: r.from }); return; }
      toast.success(fillVars(t('accidentFile.sent'), { to: to.trim(), from: r.from }));
      onSent();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const attachments = [
    { icon: FileSpreadsheet, label: t('accidentFile.attForm'), name: fileNames.form },
    { icon: FileText, label: t('accidentFile.attQuote'), name: fileNames.quote },
    { icon: FileText, label: t('accidentFile.attPhotos'), name: fileNames.photos },
    { icon: Image, label: t('accidentFile.attVin'), name: fileNames.vinPhoto },
  ];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('accidentFile.sendTitle')}</DialogTitle>
          <DialogDescription>{t('accidentFile.sendIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {noMailbox && <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('accidentFile.errNoMailbox')}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('accidentFile.from')}</Label>
              <Select value={fromBox} onValueChange={(v) => { setFromTouched(true); setFromBox(v); setPreview(null); }}>
                <SelectTrigger><SelectValue placeholder={t('salesMail.fromPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  {senders.map((a) => <SelectItem key={a} value={a}>{a}{a === myEmail ? ` · ${t('crm.fromMyAddress')}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('accidentFile.to')}</Label>
              <Input type="email" value={to} onChange={(e) => { setToTouched(true); setTo(e.target.value); setPreview(null); }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('accidentFile.cc')}</Label>
            <Input value={cc} onChange={(e) => { setToTouched(true); setCc(e.target.value); setPreview(null); }} />
            <p className="text-[12px] text-muted-foreground">{t('accidentFile.ccHint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t('accidentFile.subject')}</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('accidentFile.body')}</Label>
            <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="space-y-1 rounded-md border border-border px-3 py-2 text-[13px]">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('accidentFile.attachments')}</p>
            {attachments.map((a) => (
              <p key={a.name} className="flex items-center gap-2"><a.icon className="size-4 shrink-0 text-muted-foreground" /> <span>{a.label}</span> <span className="truncate font-data text-[12px] text-muted-foreground">{a.name}</span></p>
            ))}
          </div>
          {run.isPending && <p className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {t('accidentFile.preparing')}</p>}
          {preview && (
            <div className="space-y-1 rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">
              <p className="flex items-center gap-1.5 font-medium"><ShieldCheck className="size-3.5" /> {t('accidentFile.dryRunOk')}</p>
              <p>{fillVars(t('accidentFile.dryRunDetail'), {
                from: preview.from, to: to.trim(),
                files: preview.attachments.map((a) => `${a.name} (${Math.max(1, Math.round(a.size / 1024))} Ko)`).join(', '),
              })}</p>
            </div>
          )}
          {preview?.html && <MailPreview html={preview.html} />}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending || !canSend} title={t('salesMail.dryRunHint')}>
            {run.isPending && run.variables === true ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('accidentFile.dryRun')}
          </Button>
          <Button onClick={() => run.mutate(false)} disabled={run.isPending || !canSend}>
            {run.isPending && run.variables === false ? <Loader2 className="animate-spin" /> : <Mail />} {file.sent_at ? t('accidentFile.resend') : t('accidentFile.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
