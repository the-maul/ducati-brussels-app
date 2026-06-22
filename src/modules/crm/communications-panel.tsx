/**
 * M10 — Journal des communications (histo e-mail / SMS / appels / notes) d'un contact.
 * Réutilisable : <CommunicationsPanel companyId contactId />
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Loader2, Plus, Mail, MessageSquare, Phone, StickyNote, Send, Paperclip, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RichEditor } from '@/components/rich-editor';
import { listCommunications, addCommunication, sendEmailViaOutlook, type MailAttachment } from './api';
import { getContact } from '@/modules/contacts/api';
import { supabase } from '@/integrations/supabase/client';

const readBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = reject; r.readAsDataURL(file);
});
import { t } from '@/lib/i18n';

const ICON: Record<string, typeof Mail> = { email: Mail, sms: MessageSquare, call: Phone, note: StickyNote };

export function CommunicationsPanel({ companyId, contactId }: { companyId: string; contactId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['comms', contactId], queryFn: () => listCommunications(contactId) });
  const [channel, setChannel] = useState('call');
  const [direction, setDirection] = useState('out');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState('');
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [atts, setAtts] = useState<MailAttachment[]>([]);
  const [editorKey, setEditorKey] = useState(0);

  const contactQ = useQuery({ queryKey: ['comm-contact', contactId], queryFn: () => getContact(contactId) });
  useEffect(() => { if (contactQ.data?.email && !to) setTo(contactQ.data.email); }, [contactQ.data]); // eslint-disable-line

  const add = useMutation({
    mutationFn: () => addCommunication({ companyId, contactId, channel, direction, subject, body }),
    onSuccess: () => { setSubject(''); setBody(''); qc.invalidateQueries({ queryKey: ['comms', contactId] }); },
  });
  // Envoi réel depuis Outlook (journalisé côté serveur) — visible quand le canal = e-mail.
  const send = useMutation({
    mutationFn: async () => {
      const r = await sendEmailViaOutlook({ companyId, contactId, to, subject, body, attachments: atts });
      if (r.error) return r;
      // déclenche la relève pour journaliser le mail envoyé tout de suite (best-effort)
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
  const onPickFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: MailAttachment[] = [];
    for (const f of Array.from(files)) added.push({ name: f.name, contentType: f.type || 'application/octet-stream', contentBytes: await readBase64(f) });
    setAtts((a) => [...a, ...added]);
  };
  const attTotalKo = Math.round(atts.reduce((s, a) => s + a.contentBytes.length * 0.75, 0) / 1024);
  const errLabel = (code: string) => code === 'graph_not_configured' ? t('crm.emailNotConfigured') : code;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
        <div className="space-y-1"><Lbl>{t('crm.channel')}</Lbl>
          <Select value={channel} onValueChange={setChannel}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{['call', 'email', 'sms', 'note'].map((c) => <SelectItem key={c} value={c}>{t(`crm.channel_${c}`)}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="space-y-1"><Lbl>{t('crm.direction')}</Lbl>
          <Select value={direction} onValueChange={setDirection}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="out">{t('crm.dir_out')}</SelectItem><SelectItem value="in">{t('crm.dir_in')}</SelectItem></SelectContent></Select>
        </div>
        {channel === 'email' && <div className="space-y-1"><Lbl>{t('crm.to')}</Lbl><Input value={to} onChange={(e) => setTo(e.target.value)} className="w-56" placeholder="email@client" /></div>}
        <div className="flex-1 space-y-1"><Lbl>{t('crm.subject')}</Lbl><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <Button variant="outline" onClick={() => add.mutate()} disabled={add.isPending || (!subject.trim() && !body.trim())}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('crm.logComm')}</Button>
        {channel === 'email' && <Button onClick={() => { setSendMsg(null); send.mutate(); }} disabled={send.isPending || !to.trim() || !subject.trim()}>{send.isPending ? <Loader2 className="animate-spin" /> : <Send className="size-4" />} {t('crm.sendEmail')}</Button>}

        {/* Corps : éditeur enrichi pour l'e-mail, zone simple sinon */}
        <div className="w-full space-y-1">
          <Lbl>{t('crm.body')}</Lbl>
          {channel === 'email'
            ? <RichEditor html={body} onChange={setBody} resetKey={editorKey} placeholder={t('crm.bodyPlaceholder')} />
            : <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} />}
        </div>

        {/* Pièces jointes (e-mail) */}
        {channel === 'email' && (
          <div className="w-full space-y-1">
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] hover:bg-accent">
                <Paperclip className="size-3.5" /> {t('crm.attach')}
                <input type="file" multiple className="hidden" onChange={(e) => { onPickFiles(e.target.files); e.target.value = ''; }} />
              </label>
              {atts.length > 0 && <span className="text-[11px] text-muted-foreground">{atts.length} fichier(s) · {attTotalKo} Ko</span>}
            </div>
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
        {sendMsg && <p className="w-full text-[12px] text-info">{sendMsg}</p>}
      </div>

      {isLoading ? <div className="grid place-items-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : (
        <div className="space-y-2">
          {data && data.length === 0 && <p className="text-sm text-muted-foreground">{t('crm.noComm')}</p>}
          {data?.map((c) => {
            const Icon = ICON[c.channel] ?? StickyNote;
            return (
              <div key={c.id} className="flex gap-3 rounded-md border border-border p-3 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.subject || t(`crm.channel_${c.channel}`)}</span>
                    <span className="text-[11px] text-muted-foreground">{t(`crm.dir_${c.direction}`)}</span>
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
