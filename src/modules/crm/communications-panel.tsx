/**
 * M10 — Les échanges avec le client (e-mails, appels, SMS, notes).
 *
 * On choisit d'abord CE QU'ON FAIT, en toutes lettres :
 *   · « Répondre par e-mail » → le client reçoit le message (via Outlook), et
 *     on choisit depuis laquelle des boîtes de la concession il part ;
 *   · « Noter un appel / un SMS / une note » → rien n'est envoyé, on garde
 *     seulement la trace de ce qui s'est dit.
 *
 * Réutilisable : <CommunicationsPanel companyId contactId defaultChannel />
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Mail, MessageSquare, Phone, StickyNote, Send, Paperclip, X, Folder, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RichEditor } from '@/components/rich-editor';
import { MailPreview } from '@/components/mail-preview';
import { listCommunications, addCommunication, sendEmailViaOutlook, listCompanyMailboxes, type MailAttachment } from './api';
import { getContact } from '@/modules/contacts/api';
import { listAttachments, signedUrl } from '@/modules/documents/ged-api';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';

const readBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = reject; r.readAsDataURL(file);
});

const ICON: Record<string, typeof Mail> = { email: Mail, sms: MessageSquare, call: Phone, note: StickyNote };

/** Les quatre gestes possibles, dits en français. */
const ACTIONS = [
  { key: 'email', labelKey: 'crm.replyByEmail', Icon: Mail },
  { key: 'call', labelKey: 'crm.noteACall', Icon: Phone },
  { key: 'sms', labelKey: 'crm.noteASms', Icon: MessageSquare },
  { key: 'note', labelKey: 'crm.noteInternal', Icon: StickyNote },
] as const;

export function CommunicationsPanel({ companyId, contactId, defaultChannel = 'email' }: { companyId: string; contactId: string; defaultChannel?: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['comms', contactId], queryFn: () => listCommunications(contactId) });
  const [channel, setChannel] = useState(defaultChannel);
  const [direction, setDirection] = useState('out');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState('');
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [atts, setAtts] = useState<MailAttachment[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  // Boîte d'expédition (retour client du 18/09) :
  //   - par défaut, la boîte qui a REÇU le dernier mail du client (shop@, occasions@…) ;
  //   - au choix : une autre boîte partagée, ou sa propre adresse (simon@, domenico@…).
  // Le serveur revérifie tout : boîte de la société, ou adresse de la personne connectée.
  const { session } = useAuth();
  const myEmail = (session?.user?.email ?? '').toLowerCase();
  const [fromBox, setFromBox] = useState('');
  const [fromTouched, setFromTouched] = useState(false);
  const mailboxesQ = useQuery({ queryKey: ['company-mailboxes', companyId], queryFn: () => listCompanyMailboxes(companyId) });
  const shared = (mailboxesQ.data ?? []).map((m) => m.address.toLowerCase());
  const sameDomain = shared.some((a) => a.split('@')[1] === myEmail.split('@')[1]);
  const senders = [...shared, ...(myEmail && sameDomain && !shared.includes(myEmail) ? [myEmail] : [])];
  const lastInboundBox = (data ?? []).find((c) => c.channel === 'email' && c.direction === 'in' && c.mailbox)?.mailbox?.toLowerCase() ?? '';
  useEffect(() => {
    if (fromTouched) return;
    const pick = senders.includes(lastInboundBox) ? lastInboundBox : (senders.includes(myEmail) ? myEmail : senders[0] ?? '');
    if (pick && pick !== fromBox) setFromBox(pick);
  }, [lastInboundBox, senders.join('|'), myEmail, fromTouched]); // eslint-disable-line

  const contactQ = useQuery({ queryKey: ['comm-contact', contactId], queryFn: () => getContact(contactId) });
  useEffect(() => { if (contactQ.data?.email && !to) setTo(contactQ.data.email); }, [contactQ.data]); // eslint-disable-line

  const isEmail = channel === 'email';
  const isPhoneish = channel === 'call' || channel === 'sms';

  const add = useMutation({
    mutationFn: () => addCommunication({ companyId, contactId, channel, direction, subject, body }),
    onSuccess: () => { setSubject(''); setBody(''); qc.invalidateQueries({ queryKey: ['comms', contactId] }); },
  });

  // Envoi réel depuis Outlook (journalisé côté serveur).
  const send = useMutation({
    mutationFn: async () => {
      const r = await sendEmailViaOutlook({ companyId, contactId, to, subject, body, attachments: atts, from: fromBox || undefined });
      if (r.error) return r;
      // déclenche la relève pour enregistrer le mail envoyé tout de suite (best-effort)
      await new Promise((res) => setTimeout(res, 2500));
      try { await supabase.functions.invoke('outlook-poll', { body: {} }); } catch { /* le cron le fera */ }
      return r;
    },
    onSuccess: (r) => {
      if (r.error) { setSendMsg(errLabel(r.error)); return; }
      setSendMsg(t('crm.emailSent')); setSubject(''); setBody(''); setAtts([]); setEditorKey((k) => k + 1);
      qc.invalidateQueries({ queryKey: ['comms', contactId] });
    },
    onError: (e) => setSendMsg(e instanceof Error ? e.message : 'Erreur'),
  });

  // « Vérifier sans envoyer » (mode simulation) : aperçu du message tel qu'il partira,
  // avec la signature de l'adresse choisie et le pied de mail. Rien n'est envoyé.
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  useEffect(() => { setPreviewHtml(null); }, [fromBox, to, subject, body]);
  const check = useMutation({
    mutationFn: () => sendEmailViaOutlook({ companyId, contactId, to, subject, body, from: fromBox || undefined, dryRun: true }),
    onSuccess: (r) => {
      if (r.error) { setSendMsg(errLabel(r.error)); return; }
      setPreviewHtml(r.html ?? '');
    },
    onError: (e) => setSendMsg(e instanceof Error ? e.message : 'Erreur'),
  });

  const onPickFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: MailAttachment[] = [];
    for (const f of Array.from(files)) added.push({ name: f.name, contentType: f.type || 'application/octet-stream', contentBytes: await readBase64(f) });
    setAtts((a) => [...a, ...added]);
  };

  // Choisir une pièce parmi les documents du client (GED)
  const [showDocs, setShowDocs] = useState(false);
  const docsQ = useQuery({ queryKey: ['ged-pick', contactId], queryFn: () => listAttachments('contact', contactId), enabled: showDocs });
  const addFromGed = async (id: string, name: string, ctype: string | null, path: string) => {
    const url = await signedUrl(path); if (!url) return;
    const blob = await (await fetch(url)).blob();
    const b64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.readAsDataURL(blob); });
    setAtts((a) => [...a, { name, contentType: ctype || 'application/octet-stream', contentBytes: b64 }]);
  };
  const attTotalKo = Math.round(atts.reduce((s, a) => s + a.contentBytes.length * 0.75, 0) / 1024);
  const errLabel = (code: string) => code === 'graph_not_configured' ? t('crm.emailNotConfigured') : code;

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-md border border-dashed border-border p-3">
        {/* 1. QU'EST-CE QU'ON FAIT ? */}
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.map(({ key, labelKey, Icon }) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={channel === key ? 'default' : 'outline'}
              onClick={() => { setChannel(key); setDirection(key === 'email' ? 'out' : direction); setSendMsg(null); }}
            >
              <Icon className="size-3.5" /> {t(labelKey)}
            </Button>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">{isEmail ? t('crm.emailIntro') : t('crm.noteIntro')}</p>

        {/* 2. LES CHAMPS DU GESTE CHOISI */}
        {isEmail && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Lbl>{t('crm.replyFrom')}</Lbl>
              <Select value={fromBox} onValueChange={(v) => { setFromTouched(true); setFromBox(v); }}>
                <SelectTrigger><SelectValue placeholder={t('crm.replyFrom')} /></SelectTrigger>
                <SelectContent>
                  {senders.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                      {a === lastInboundBox ? ` · ${t('crm.fromReceivedHere')}` : a === myEmail ? ` · ${t('crm.fromMyAddress')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Lbl>{t('crm.to')}</Lbl>
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@client" />
            </div>
          </div>
        )}

        {isPhoneish && (
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant={direction === 'in' ? 'default' : 'outline'} onClick={() => setDirection('in')}>{t('crm.callIn')}</Button>
            <Button type="button" size="sm" variant={direction === 'out' ? 'default' : 'outline'} onClick={() => setDirection('out')}>{t('crm.callOut')}</Button>
          </div>
        )}

        <div className="space-y-1"><Lbl>{t('crm.subject')}</Lbl>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <div className="space-y-1">
          <Lbl>{t('crm.body')}</Lbl>
          {isEmail
            ? <RichEditor html={body} onChange={setBody} resetKey={editorKey} placeholder={t('crm.bodyPlaceholder')} />
            : <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />}
        </div>

        {/* Pièces jointes (e-mail seulement) */}
        {isEmail && (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] hover:bg-accent">
                <Paperclip className="size-3.5" /> {t('crm.attach')}
                <input type="file" multiple className="hidden" onChange={(e) => { onPickFiles(e.target.files); e.target.value = ''; }} />
              </label>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowDocs((s) => !s)}><Folder className="size-3.5" /> {t('crm.fromClientDocs')}</Button>
              {atts.length > 0 && <span className="text-[11px] text-muted-foreground">{atts.length} fichier(s) · {attTotalKo} Ko</span>}
            </div>
            {showDocs && (
              <div className="max-h-44 overflow-auto rounded-md border border-border p-2">
                {docsQ.isLoading && <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />}
                {docsQ.data && docsQ.data.length === 0 && <p className="text-[12px] text-muted-foreground">{t('crm.noClientDocs')}</p>}
                {docsQ.data?.map((d) => (
                  <button key={d.id} type="button" onClick={() => addFromGed(d.id, d.file_name, d.content_type, d.storage_path)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-accent">
                    <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{d.file_name}</span>
                    {d.folder && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{d.folder}</span>}
                  </button>
                ))}
              </div>
            )}
            {atts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {atts.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px]">
                    {a.name}
                    <button type="button" onClick={() => setAtts((x) => x.filter((_, j) => j !== i))}><X className="size-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. LE BOUTON QUI FAIT LE GESTE */}
        {isEmail ? (
          <div className="space-y-2">
            {previewHtml !== null && <MailPreview html={previewHtml} />}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="sm:flex-1" onClick={() => { setSendMsg(null); check.mutate(); }} disabled={check.isPending || send.isPending || !to.trim() || !subject.trim()} title={t('salesMail.dryRunHint')}>
                {check.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck className="size-4" />} {t('salesMail.dryRun')}
              </Button>
              <Button className="sm:flex-1" onClick={() => { setSendMsg(null); send.mutate(); }} disabled={send.isPending || !to.trim() || !subject.trim()}>
                {send.isPending ? <Loader2 className="animate-spin" /> : <Send className="size-4" />} {t('crm.sendEmail')}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => add.mutate()} disabled={add.isPending || (!subject.trim() && !body.trim())}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus className="size-4" />} {t('crm.logComm')}
          </Button>
        )}
        {sendMsg && <p className="text-[12px] text-info">{sendMsg}</p>}
      </div>

      {isLoading ? <div className="grid place-items-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : (
        <div className="space-y-2">
          {data && data.length === 0 && <p className="text-sm text-muted-foreground">{t('crm.noComm')}</p>}
          {/* Un même envoi relevé dans deux boîtes donne deux lignes identiques : on n'en montre qu'une. */}
          {data?.filter((c, i, all) => all.findIndex((x) =>
            x.channel === c.channel && x.direction === c.direction && (x.subject ?? '') === (c.subject ?? '')
            && x.occurred_at.slice(0, 19) === c.occurred_at.slice(0, 19)) === i).map((c) => {
            const Icon = ICON[c.channel] ?? StickyNote;
            return (
              <div key={c.id} className="flex gap-3 rounded-md border border-border p-3 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.subject || t(`crm.channel_${c.channel}`)}</span>
                    <span className="text-[11px] text-muted-foreground">{t(`crm.dir_${c.direction}`)}{c.mailbox ? ` · ${c.mailbox}` : ''}</span>
                    <span className="ml-auto font-mono text-[12px] text-muted-foreground">{new Date(c.occurred_at).toLocaleString('fr-BE')}</span>
                  </div>
                  {c.body && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{c.body}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</label>;
}
