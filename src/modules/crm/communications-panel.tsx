/**
 * M10 — Journal des communications (histo e-mail / SMS / appels / notes) d'un contact.
 * Réutilisable : <CommunicationsPanel companyId contactId />
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Mail, MessageSquare, Phone, StickyNote } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listCommunications, addCommunication } from './api';
import { t } from '@/lib/i18n';

const ICON: Record<string, typeof Mail> = { email: Mail, sms: MessageSquare, call: Phone, note: StickyNote };

export function CommunicationsPanel({ companyId, contactId }: { companyId: string; contactId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['comms', contactId], queryFn: () => listCommunications(contactId) });
  const [channel, setChannel] = useState('call');
  const [direction, setDirection] = useState('out');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const add = useMutation({
    mutationFn: () => addCommunication({ companyId, contactId, channel, direction, subject, body }),
    onSuccess: () => { setSubject(''); setBody(''); qc.invalidateQueries({ queryKey: ['comms', contactId] }); },
  });

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
        <div className="flex-1 space-y-1"><Lbl>{t('crm.subject')}</Lbl><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <Button onClick={() => add.mutate()} disabled={add.isPending || (!subject.trim() && !body.trim())}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('crm.logComm')}</Button>
        <div className="w-full space-y-1"><Lbl>{t('crm.body')}</Lbl><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} /></div>
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
