/**
 * M10 — Mailing e-mail / SMS (G8 « Mailing E-mail » / « Mailing SMS »), 18/11/2026.
 * MODE ESSAI UNIQUEMENT : la campagne est préparée (destinataires, adresse, message
 * personnalisé, exclusions) et tracée, mais RIEN n'est envoyé — aucune fonction d'envoi
 * n'existe et la base refuse tout autre mode que « test ».
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Loader2, Mail, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { prepareCampaign, listCampaignRecipients } from './api';
import { renderCampaignText, smsSegments, type RenderContact } from './rules';
import { g8ErrorMessage } from './client-g8-tabs';

export type CampaignTarget = RenderContact & { id: string; email?: string | null; mobile?: string | null; marketing_opt_out?: boolean };

export function CampaignDialog({ open, onOpenChange, companyId, channel, targets, criteria }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string;
  channel: 'email' | 'sms';
  targets: CampaignTarget[];
  criteria?: Record<string, unknown>;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(`${t(channel === 'email' ? 'g8c.campaign.defaultNameEmail' : 'g8c.campaign.defaultNameSms')} ${new Date().toLocaleDateString('fr-BE')}`);
      setSubject(''); setBody(''); setCampaignId(null);
    }
  }, [open, channel]);

  const sample = useMemo(() => targets.find((c) => (channel === 'email' ? c.email : c.mobile) && !c.marketing_opt_out) ?? targets[0] ?? null, [targets, channel]);
  const prep = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => prepareCampaign({ companyId, channel, name, subject, body, contactIds: targets.map((c) => c.id), criteria: criteria ?? {} }),
    onSuccess: (id) => { setCampaignId(id); toast.success(t('g8c.campaign.prepared')); qc.invalidateQueries({ queryKey: ['g8-campaigns', companyId] }); },
    onError: (e) => toast.error(g8ErrorMessage(e)),
  });
  const recQ = useQuery({ queryKey: ['g8-campaign-recipients', campaignId], queryFn: () => listCampaignRecipients(campaignId!), enabled: !!campaignId });
  const ready = (recQ.data ?? []).filter((r) => r.status === 'pret').length;
  const skipped = (recQ.data ?? []).filter((r) => r.status === 'ignore');
  const skipCounts = skipped.reduce<Record<string, number>>((acc, r) => { const k = r.skip_reason ?? 'archive'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  const canPrepare = name.trim() && body.trim() && (channel === 'sms' || subject.trim()) && targets.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {channel === 'email' ? <Mail className="size-4" /> : <MessageSquare className="size-4" />}
            {t(channel === 'email' ? 'g8c.campaign.titleEmail' : 'g8c.campaign.titleSms')}
          </DialogTitle>
        </DialogHeader>
        <p className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><FlaskConical className="mt-0.5 size-4 shrink-0" /> {t('g8c.campaign.testBanner')}</p>
        {!campaignId ? (
          <div className="space-y-3 text-[13px]">
            <p className="text-muted-foreground">{t('g8c.campaign.targets').replace('{n}', String(targets.length))}</p>
            <label className="block"><span className="mb-1 block font-medium">{t('g8c.campaign.name')}</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} /></label>
            {channel === 'email' && (
              <label className="block"><span className="mb-1 block font-medium">{t('g8c.campaign.subject')}</span>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
            )}
            <label className="block"><span className="mb-1 block font-medium">{t('g8c.campaign.body')}</span>
              <Textarea rows={channel === 'email' ? 8 : 4} value={body} onChange={(e) => setBody(e.target.value)} /></label>
            <p className="text-[12px] text-muted-foreground">{t('g8c.campaign.variables')}</p>
            {channel === 'sms' && body && (
              <p className="text-[12px] text-muted-foreground tabular-nums">{t('g8c.campaign.smsCount').replace('{chars}', String([...body].length)).replace('{n}', String(smsSegments(body)))}</p>
            )}
            {sample && body && (
              <div className="rounded-md border border-border bg-card p-3">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('g8c.campaign.preview')}</div>
                {channel === 'email' && <div className="font-medium">{renderCampaignText(subject, sample)}</div>}
                <div className="whitespace-pre-wrap">{renderCampaignText(body, sample)}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-[13px]">
            {recQ.isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="info" icon={FlaskConical} label={t('g8c.campaign.readyCount').replace('{n}', String(ready))} />
                  <StatusBadge tone="neutral" label={t('g8c.campaign.skippedCount').replace('{n}', String(skipped.length))} />
                </p>
                {Object.entries(skipCounts).map(([k, n]) => (
                  <p key={k} className="text-muted-foreground">{t(`g8c.campaign.skip_${k}`)} : <span className="tabular-nums">{n}</span></p>
                ))}
                <p className="text-muted-foreground">{t('g8c.campaign.afterPrepare')}</p>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{campaignId ? t('g8c.close') : t('g8c.cancel')}</Button>
          {!campaignId && (
            <Button disabled={!canPrepare || prep.isPending} onClick={() => prep.mutate()}>
              {prep.isPending ? <Loader2 className="animate-spin" /> : <FlaskConical />} {t('g8c.campaign.prepare')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
