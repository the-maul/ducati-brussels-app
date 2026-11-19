/**
 * Parametres → SMS (lot SMS Brevo, 18/11/2026 ; G8 « Reglages du planning » onglet SMS / Mail).
 * - Connexion Brevo : cle posee ou non (lue par la fonction Edge, JAMAIS la cle), expediteur par
 *   defaut, solde SMS du compte.
 * - Envoi : Arrete (defaut) / Test (tout au numero de test) / Actif (confirmation) ; expediteur,
 *   signature, horaires ; SMS automatique de fin de travaux ; rappel de RDV N avant.
 * - Modeles par type (fin de travaux, rappel) et par langue du client, avec apercu et compteur.
 * - SMS de test au numero SAISI par l'utilisateur (jamais celui d'un client).
 * - Liste des SMS programmes / historique, avec annulation.
 * Societe de test (lot ItalTest) : bandeau, mode force a « arrete » par la base.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, FlaskConical, KeyRound, Loader2, MessageSquareText, RotateCcw, Save, Send, ShieldAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import { getSmsSettings, getSmsStatus, sendTestSms, setSmsSettings, smsSchemaReady, type SmsSettings } from './sms-api';
import {
  SMS_KINDS, SMS_LOCALES, SMS_MODES, SMS_TEMPLATE_MAX, SMS_VARS, cleanTemplates, isValidReminderLead, isValidSender,
  joinLead, normalizePhone, renderSms, sampleVars, smsModeTone, smsSize, splitLead, templateFor, unknownVars,
  type SmsKind, type SmsLocale, type SmsMode,
} from './sms-rules';
import { SmsQueueList, smsErrorLabel, smsReasonLabel } from './sms-queue';

const MODE_ICON: Record<SmsMode, LucideIcon> = { arrete: Ban, test: FlaskConical, actif: Send };

function TemplateEditor({ kind, locale, value, onChange, s, disabled }: {
  kind: SmsKind; locale: SmsLocale; value: string; onChange: (v: string) => void; s: SmsSettings; disabled: boolean;
}) {
  const tpl = value.trim() ? value : templateFor(null, kind, locale);
  const preview = renderSms(tpl, sampleVars(locale, { signature: s.signature, openingHours: s.openingHours, companyName: s.companyName }));
  const size = smsSize(preview);
  const unknown = unknownVars(tpl, kind);
  return (
    <div className="space-y-2">
      <Textarea rows={3} value={value || templateFor(null, kind, locale)} onChange={(e) => onChange(e.target.value)} disabled={disabled} maxLength={SMS_TEMPLATE_MAX} />
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span>{fillVars(t('sms.templates.vars'), { list: SMS_VARS[kind].map((v) => `{${v}}`).join(' ') })}</span>
        {!disabled && value.trim() && (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onChange('')}><RotateCcw className="size-3.5" /> {t('sms.templates.reset')}</Button>
        )}
      </div>
      {unknown.length > 0 && <p className="text-[12px] text-warning">{fillVars(t('sms.templates.unknownVars'), { list: unknown.map((v) => `{${v}}`).join(' ') })}</p>}
      <div className="rounded-md bg-muted px-3 py-2 text-[13px]">
        <p className="mb-1 text-[12px] font-bold text-muted-foreground">{t('sms.templates.preview')}</p>
        <p>{preview}</p>
        <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
          {fillVars(t('sms.templates.size'), { units: String(size.units), segments: String(size.segments) })}
          {size.encoding === 'unicode' ? ` · ${t('sms.templates.unicode')}` : ''}
        </p>
      </div>
    </div>
  );
}

export function SmsSettingsPanel({ companyId }: { companyId: string }) {
  const { rolesForActiveCompany } = useAuth();
  const admin = rolesForActiveCompany.includes('admin');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const readyQ = useQuery({ queryKey: ['sms-schema', companyId], queryFn: () => smsSchemaReady(companyId), staleTime: Infinity });
  const settingsQ = useQuery({ queryKey: ['sms-settings', companyId], queryFn: () => getSmsSettings(companyId), enabled: readyQ.data === true });
  const statusQ = useQuery({ queryKey: ['sms-status', companyId], queryFn: () => getSmsStatus(companyId), retry: false, enabled: readyQ.data === true });
  const [draft, setDraft] = useState<SmsSettings | null>(null);
  const [kind, setKind] = useState<SmsKind>('ready');
  const [testTo, setTestTo] = useState('');

  const cur = draft ?? settingsQ.data ?? null;
  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: async (s: SmsSettings) => {
      if (s.mode === 'actif' && settingsQ.data?.mode !== 'actif') {
        const ok = await confirm({ title: t('sms.mode.confirmLiveTitle'), message: t('sms.mode.confirmLiveMsg'), confirmLabel: t('sms.mode.confirmLiveDo'), variant: 'delete' });
        if (!ok) return false;
      }
      await setSmsSettings(companyId, { ...s, templates: cleanTemplates(s.templates) });
      return true;
    },
    onSuccess: (done) => {
      if (!done) return;
      toast.success(t('sms.saved'));
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['sms-settings', companyId] });
    },
    onError: (e) => toast.error(smsErrorLabel(e)),
  });

  const test = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => sendTestSms(companyId, testTo,
      fillVars(t('sms.test.body'), { societe: (cur?.signature ?? '').trim() || (cur?.companyName ?? '') })),
    onSuccess: (r) => {
      if (r.ok) toast.success(fillVars(t('sms.test.sent'), { to: r.to ?? testTo }));
      else toast.error(fillVars(t('sms.test.failed'), { reason: r.error?.startsWith('SMS_') ? smsErrorLabel(r.error) : smsReasonLabel(r.error) }));
      qc.invalidateQueries({ queryKey: ['sms-list', companyId] });
      qc.invalidateQueries({ queryKey: ['sms-status', companyId] });
    },
    onError: (e) => toast.error(fillVars(t('sms.test.failed'), { reason: smsErrorLabel(e) })),
  });

  if (readyQ.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (readyQ.data === false) return <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('sms.schemaMissing')}</p>;
  if (settingsQ.isLoading || !cur) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  const set = (patch: Partial<SmsSettings>) => setDraft({ ...cur, ...patch });
  const setTpl = (k: SmsKind, l: SmsLocale, v: string) => set({ templates: { ...cur.templates, [k]: { ...(cur.templates[k] ?? {}), [l]: v } } });
  const lead = splitLead(cur.reminderLeadMinutes);
  const leadOk = isValidReminderLead(cur.reminderLeadMinutes);
  const senderOk = !cur.sender || isValidSender(cur.sender);
  const testRecOk = cur.mode !== 'test' || !!normalizePhone(cur.testRecipient);
  const tplOk = SMS_KINDS.every((k) => SMS_LOCALES.every((l) => (cur.templates[k]?.[l] ?? '').length <= SMS_TEMPLATE_MAX));
  const locked = !admin || cur.isTestCompany;
  const st = statusQ.data;
  const testNumber = normalizePhone(testTo);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">{t('sms.intro')}</p>
      {cur.isTestCompany && (
        <p className="flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning"><ShieldAlert className="size-4" /> {t('sms.testCompany')}</p>
      )}

      <section className="space-y-3 rounded-md border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold"><KeyRound className="size-5 text-primary" /> {t('sms.connection.title')}</h2>
        {statusQ.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
          : statusQ.isError || !st ? <StatusBadge tone="warning" icon={TriangleAlert} label={t('sms.connection.keyUnknown')} />
          : st.configured ? <StatusBadge tone="success" icon={CheckCircle2} label={t('sms.connection.keyPresent')} />
          : <StatusBadge tone="warning" icon={TriangleAlert} label={t('sms.connection.keyMissing')} />}
        {st?.configured && (
          <p className="text-[13px] tabular-nums">{st.credits != null ? fillVars(t('sms.connection.credits'), { n: String(st.credits) }) : t('sms.connection.creditsUnknown')}</p>
        )}
        {st && <p className="text-[13px]">{fillVars(t('sms.connection.senderDefault'), { sender: st.defaultSender })}</p>}
        {st?.envSenderInvalid && <p className="text-[12px] text-warning">{t('sms.connection.senderEnvInvalid')}</p>}
        <p className="text-[12px] text-muted-foreground">{t('sms.connection.keyNever')}</p>
      </section>

      <section className="space-y-4 rounded-md border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold"><MessageSquareText className="size-5 text-primary" /> {t('sms.mode.label')}</h2>
        {!admin && <p className="text-[13px] text-muted-foreground">{t('sms.adminOnly')}</p>}
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Select value={cur.mode} onValueChange={(v) => set({ mode: v as SmsMode })} disabled={locked}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{SMS_MODES.map((m) => <SelectItem key={m} value={m}>{t(`sms.mode.${m}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <StatusBadge tone={smsModeTone(cur.mode)} icon={MODE_ICON[cur.mode]} label={t(`sms.mode.${cur.mode}`)} />
          <span className="text-[13px] text-muted-foreground">{t(`sms.mode.hint_${cur.mode}`)}</span>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label>{t('sms.mode.testRecipient')}</Label>
            <Input className="w-56 tabular-nums" value={cur.testRecipient ?? ''} onChange={(e) => set({ testRecipient: e.target.value || null })} disabled={locked}
                   aria-invalid={!testRecOk || undefined} placeholder="+32 4.." />
            <p className="text-[12px] text-muted-foreground">{t('sms.mode.testRecipientHint')}</p>
          </div>
          <div className="space-y-1">
            <Label>{t('sms.sender')}</Label>
            <Input className="w-48" maxLength={15} value={cur.sender ?? ''} onChange={(e) => set({ sender: e.target.value.trim() || null })} disabled={locked}
                   aria-invalid={!senderOk || undefined} placeholder={st?.defaultSender ?? 'DucatiBXL'} />
            <p className="max-w-xs text-[12px] text-muted-foreground">{senderOk ? t('sms.senderHint') : t('sms.senderInvalid')}</p>
          </div>
          <div className="space-y-1">
            <Label>{t('sms.signature')}</Label>
            <Input className="w-48" maxLength={40} value={cur.signature ?? ''} onChange={(e) => set({ signature: e.target.value || null })} disabled={locked} placeholder={cur.companyName ?? ''} />
            <p className="text-[12px] text-muted-foreground">{t('sms.signatureHint')}</p>
          </div>
          <div className="space-y-1">
            <Label>{t('sms.openingHours')}</Label>
            <Input className="w-72" maxLength={120} value={cur.openingHours ?? ''} onChange={(e) => set({ openingHours: e.target.value || null })} disabled={locked} />
            <p className="max-w-xs text-[12px] text-muted-foreground">{t('sms.openingHoursHint')}</p>
          </div>
        </div>
        <label className="flex items-start gap-3 text-[14px]">
          <Switch checked={cur.readyAuto} onCheckedChange={(v) => set({ readyAuto: v })} disabled={locked} />
          <span>{t('sms.readyAuto')}<span className="block text-[12px] text-muted-foreground">{t('sms.readyAutoHint')}</span></span>
        </label>
        <label className="flex items-start gap-3 text-[14px]">
          <Switch checked={cur.reminderAuto} onCheckedChange={(v) => set({ reminderAuto: v })} disabled={locked} />
          <span>{t('sms.reminderAuto')}<span className="block text-[12px] text-muted-foreground">{t('sms.mailUnchanged')}</span></span>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <span className="pb-2 text-[13px]">{t('sms.reminderLead')}</span>
          {(['d', 'h', 'm'] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label>{t(k === 'd' ? 'sms.days' : k === 'h' ? 'sms.hours' : 'sms.minutes')}</Label>
              <Input type="number" min={0} className="w-20 text-right tabular-nums" value={String(lead[k])} disabled={locked || !cur.reminderAuto}
                     onChange={(e) => set({ reminderLeadMinutes: joinLead({ ...lead, [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) }) })}
                     aria-invalid={!leadOk || undefined} />
            </div>
          ))}
          {!leadOk && <span className="pb-2 text-[12px] text-danger">{t('sms.leadInvalid')}</span>}
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-border bg-card p-5">
        <h2 className="font-ui text-[15px] font-bold">{t('sms.templates.title')}</h2>
        <p className="text-[12px] text-muted-foreground">{t('sms.templates.hint')}</p>
        <Select value={kind} onValueChange={(v) => setKind(v as SmsKind)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{SMS_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`sms.templates.kind_${k}`)}</SelectItem>)}</SelectContent>
        </Select>
        <Tabs defaultValue="fr">
          <TabsList>{SMS_LOCALES.map((l) => <TabsTrigger key={l} value={l}>{t(`sms.templates.locale_${l}`)}</TabsTrigger>)}</TabsList>
          {SMS_LOCALES.map((l) => (
            <TabsContent key={l} value={l} className="mt-3">
              <TemplateEditor kind={kind} locale={l} value={cur.templates[kind]?.[l] ?? ''} onChange={(v) => setTpl(kind, l, v)} s={cur} disabled={locked} />
            </TabsContent>
          ))}
        </Tabs>
        {!tplOk && <p className="text-[12px] text-danger">{t('sms.templates.tooLong')}</p>}
        {admin && !cur.isTestCompany && (
          <Button onClick={() => save.mutate(cur)} disabled={!draft || save.isPending || !leadOk || !senderOk || !testRecOk || !tplOk}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('sms.save')}
          </Button>
        )}
      </section>

      {admin && (
        <section className="space-y-3 rounded-md border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold"><Send className="size-5 text-primary" /> {t('sms.test.title')}</h2>
          <p className="text-[12px] text-muted-foreground">{t('sms.test.hint')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>{t('sms.test.number')}</Label>
              <Input className="w-56 tabular-nums" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="0470 12 34 56" aria-invalid={(testTo !== '' && !testNumber) || undefined} />
            </div>
            <Button variant="outline" onClick={() => test.mutate()} disabled={!testNumber || test.isPending || cur.isTestCompany}>
              {test.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t('sms.test.send')}
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-md border border-border bg-card p-5">
        <SmsQueueList companyId={companyId} canCancel={admin} />
      </section>
    </div>
  );
}
