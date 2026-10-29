import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Ban, BellRing, CalendarClock, CalendarDays, CheckCircle2, Clock, Eye, Loader2, Mail, MailCheck,
  MoreHorizontal, PhoneCall, RefreshCw, Send, Wrench, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { KpiCard } from '@/components/kpi-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t, pageTitle, fillVars } from '@/lib/i18n';
import {
  listFollowups, planFollowups, setFollowup, renderFollowup, sendFollowupNow, listFollowupTemplates, saveFollowupTemplate,
  type Followup, type FollowupTemplate, type RenderedFollowup,
} from '@/modules/crm/followups-api';
import {
  counters, fillTemplate, followupTab, statusTone, unknownVars, FOLLOWUP_LOCALES, TEMPLATE_KINDS, TEMPLATE_VARS, LEAD_DAYS, CALLBACK_DAYS,
  type FollowupStatus, type FollowupTab, type FollowupLocale, type TemplateKind,
} from '@/modules/crm/followups-rules';

/**
 * Clients (CRM) → « Relances » (M10, decision client du 30/10/2026, M-72).
 * Le marketing prepare les relances automatiques par mail (entretien du : 15 jours avant ;
 * intervention reportee : a la date fixee au comptoir). Un mail envoye sans reponse ni
 * rendez-vous pendant 5 jours tombe dans le CRM commercial comme « personne a rappeler ».
 * Un rendez-vous pris ferme la relance.
 */
export const Route = createFileRoute('/_app/crm/relances')({
  head: () => ({ meta: [{ title: pageTitle('crmFollowups') }] }),
  component: FollowupsPage,
});

const STATUS_ICON: Record<FollowupStatus, LucideIcon> = {
  planifiee: Clock, envoyee: Send, repondue: MailCheck, a_rappeler: PhoneCall, close: CheckCircle2, annulee: Ban,
};
const TABS: FollowupTab[] = ['a_envoyer', 'en_attente', 'a_rappeler'];
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('fr-BE', { dateStyle: 'short' }) : '—');
const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const todayIso = () => new Date().toISOString().slice(0, 10);
const errMsg = (e: unknown) => {
  const m = (e as { message?: string } | null)?.message ?? String(e);
  const key = `followups.err_${m}`;
  const v = t(key);
  return v === key ? m : v;
};

function FollowupsPage() {
  const { activeCompanyId } = useAuth();
  const canWrite = useCanWrite();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<FollowupTab>('a_envoyer');
  const [preview, setPreview] = useState<{ f: Followup; r: RenderedFollowup } | null>(null);
  const [postpone, setPostpone] = useState<{ f: Followup; date: string } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const list = useQuery({ queryKey: ['followups', activeCompanyId], queryFn: () => listFollowups(activeCompanyId!), enabled: !!activeCompanyId, refetchInterval: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['followups', activeCompanyId] });
  const fail = (e: unknown) => toast.error(`${t('followups.errorPrefix')} : ${errMsg(e)}`);

  const plan = useMutation({
    mutationFn: () => planFollowups(activeCompanyId!),
    onSuccess: (r) => { toast.success(fillVars(t('followups.planDone'), r)); refresh(); },
    onError: fail,
  });
  const act = useMutation({
    mutationFn: (p: { id: string; action: 'cancel' | 'answered' | 'close' | 'postpone'; date?: string }) => setFollowup(p.id, p.action, p.date),
    onSuccess: (_s, p) => { toast.success(t(`followups.done_${p.action}`)); setPostpone(null); refresh(); },
    onError: fail,
  });
  const sendNow = useMutation({
    mutationFn: (f: Followup) => sendFollowupNow(activeCompanyId!, f.id),
    onSuccess: (r) => {
      if (r.error) { fail(new Error(r.error)); refresh(); return; }
      if ((r.failed ?? 0) > 0) toast.error(`${t('followups.errorPrefix')} : ${r.errors?.[0]?.error ?? ''}`);
      else toast.success(t('followups.sentNow'));
      refresh();
    },
    onError: fail,
  });
  const openPreview = useMutation({
    mutationFn: async (f: Followup) => ({ f, r: await renderFollowup(f.id) }),
    onSuccess: (p) => setPreview(p),
    onError: fail,
  });

  const rows = list.data ?? [];
  const today = todayIso();
  const kpi = useMemo(() => counters(rows, today), [rows, today]);
  const byTab = (x: FollowupTab) => rows.filter((f) => followupTab(f.status) === x);
  const shown = byTab(tab);

  const cancelIt = async (f: Followup) => {
    if (await confirm({ title: t('followups.cancelTitle'), message: t('followups.cancelMsg'), confirmLabel: t('followups.act_cancel'), variant: 'delete' })) {
      act.mutate({ id: f.id, action: 'cancel' });
    }
  };

  return (
    <>
      <PageHeader
        title={t('followups.title')}
        description={fillVars(t('followups.subtitle'), { lead: LEAD_DAYS, callback: CALLBACK_DAYS })}
        breadcrumbs={[{ label: t('nav.crm'), to: '/crm' }, { label: t('followups.title') }]}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowTemplates((v) => !v)}>
              <Mail className="size-4" /> {t('followups.templates')}
            </Button>
            {canWrite && (
              <Button size="sm" onClick={() => plan.mutate()} disabled={plan.isPending}>
                {plan.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {t('followups.planNow')}
              </Button>
            )}
          </div>
        )}
      />

      {/* Compteurs */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label={t('followups.kpiToSend')} value={String(kpi.toSendThisWeek)} icon={CalendarClock} />
        <KpiCard label={t('followups.kpiWaiting')} value={String(kpi.waiting)} icon={Send} />
        <KpiCard label={t('followups.kpiToCall')} value={String(kpi.toCall)} icon={PhoneCall} />
      </div>

      {showTemplates && activeCompanyId && <TemplatesBlock companyId={activeCompanyId} canWrite={canWrite} />}

      {/* Onglets */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as FollowupTab)} className="mb-3">
        <TabsList>
          {TABS.map((x) => (
            <TabsTrigger key={x} value={x}>
              {t(`followups.tab_${x}`)} <span className="ml-1.5 rounded bg-muted px-1.5 text-[11px] tabular-nums">{byTab(x).length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {list.isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
      {list.error && <p className="text-[13px] text-[var(--danger)]">{errMsg(list.error)}</p>}

      {!list.isLoading && shown.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
          <BellRing className="mx-auto mb-2 size-6" aria-hidden />
          {t(`followups.empty_${tab}`)}
        </div>
      )}

      {shown.length > 0 && (
        <div className="rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('followups.colClient')}</TableHead>
                <TableHead>{t('followups.colVehicle')}</TableHead>
                <TableHead>{t('followups.colSubject')}</TableHead>
                <TableHead>{t(`followups.colDate_${tab}`)}</TableHead>
                <TableHead>{t('followups.colChannel')}</TableHead>
                <TableHead>{t('followups.colStatus')}</TableHead>
                <TableHead>{t('followups.colSource')}</TableHead>
                <TableHead className="w-10"><span className="sr-only">{t('followups.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((f) => {
                const Icon = STATUS_ICON[f.status];
                const date = tab === 'a_envoyer' ? fmtDate(f.send_at) : tab === 'en_attente' ? fmtDateTime(f.sent_at) : fmtDateTime(f.answered_at ?? f.closed_at ?? f.sent_at);
                return (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">
                      {f.contact_id ? <Link to="/clients/$contactId" params={{ contactId: f.contact_id }} className="hover:underline">{f.contact_name ?? '—'}</Link> : (f.contact_name ?? '—')}
                      <div className="text-[11px] text-muted-foreground">{f.to_email ?? t('followups.noEmail')}</div>
                    </TableCell>
                    <TableCell>
                      {f.vehicle_id ? <Link to="/vehicles/$vehicleId" params={{ vehicleId: f.vehicle_id }} className="hover:underline">{f.vehicle_label ?? '—'}</Link> : (f.vehicle_label ?? '—')}
                    </TableCell>
                    <TableCell>
                      {f.label ?? '—'}
                      {f.due_date && <div className="text-[11px] text-muted-foreground">{t('followups.dueOn')} {fmtDate(f.due_date)}</div>}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {date}
                      {f.last_error && (
                        <div className="flex items-center gap-1 text-[11px] text-[var(--danger)]" title={f.last_error}>
                          <AlertTriangle className="size-3 shrink-0" /> {t('followups.sendError')}
                        </div>
                      )}
                    </TableCell>
                    <TableCell><span className="inline-flex items-center gap-1 text-[12px]"><Mail className="size-3.5 text-muted-foreground" aria-hidden /> {t('followups.channel_email')}</span></TableCell>
                    <TableCell>
                      <StatusBadge tone={statusTone(f.status)} icon={Icon} label={t(`followups.st_${f.status}`)} />
                      {f.answered_how && f.status !== 'planifiee' && f.status !== 'envoyee' && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{t(`followups.how_${f.answered_how}`)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-[12px]"><Wrench className="size-3.5 text-muted-foreground" aria-hidden /> {t(`followups.kind_${f.kind}`)}</span>
                      {f.crm_card_id && (
                        <div className="text-[11px]">
                          <Link to="/crm" search={{ lead: f.crm_card_id }} className="text-[var(--info)] hover:underline">{t('followups.openCard')}</Link>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t('followups.actions')}><MoreHorizontal className="size-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openPreview.mutate(f)}><Eye className="size-4" /> {t('followups.act_preview')}</DropdownMenuItem>
                          {canWrite && f.status === 'planifiee' && (
                            <>
                              <DropdownMenuItem onClick={() => sendNow.mutate(f)} disabled={sendNow.isPending}><Send className="size-4" /> {t('followups.act_sendNow')}</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setPostpone({ f, date: f.send_at })}><CalendarDays className="size-4" /> {t('followups.act_postpone')}</DropdownMenuItem>
                            </>
                          )}
                          {canWrite && (f.status === 'envoyee' || f.status === 'a_rappeler') && (
                            <DropdownMenuItem onClick={() => act.mutate({ id: f.id, action: 'answered' })}><MailCheck className="size-4" /> {t('followups.act_answered')}</DropdownMenuItem>
                          )}
                          {f.crm_card_id && (
                            <DropdownMenuItem asChild><Link to="/crm" search={{ lead: f.crm_card_id }}><PhoneCall className="size-4" /> {t('followups.openCard')}</Link></DropdownMenuItem>
                          )}
                          {canWrite && (f.status === 'repondue' || f.status === 'a_rappeler') && (
                            <DropdownMenuItem onClick={() => act.mutate({ id: f.id, action: 'close' })}><CheckCircle2 className="size-4" /> {t('followups.act_close')}</DropdownMenuItem>
                          )}
                          {canWrite && f.status !== 'close' && f.status !== 'annulee' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => cancelIt(f)} className="text-[var(--danger)]"><Ban className="size-4" /> {t('followups.act_cancel')}</DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Apercu du mail */}
      {preview && (
        <Dialog open onOpenChange={(o) => { if (!o) setPreview(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('followups.previewTitle')}</DialogTitle>
              <DialogDescription>
                {t('followups.previewTo')} {preview.r.to_email ?? '—'} · {t('followups.previewLang')} {preview.r.locale.toUpperCase()}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-[13px]">
              <p><span className="font-bold">{t('followups.previewSubject')} :</span> {preview.r.subject}</p>
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-sans text-[13px] leading-5">{preview.r.body}</pre>
              <p className="text-[11px] text-muted-foreground">{t('followups.previewNote')}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)}>{t('action.close')}</Button>
              {canWrite && preview.f.status === 'planifiee' && (
                <Button onClick={() => { sendNow.mutate(preview.f); setPreview(null); }} disabled={sendNow.isPending}><Send className="size-4" /> {t('followups.act_sendNow')}</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Decaler */}
      {postpone && (
        <Dialog open onOpenChange={(o) => { if (!o) setPostpone(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('followups.postponeTitle')}</DialogTitle>
              <DialogDescription>{postpone.f.contact_name ?? ''} — {postpone.f.label ?? ''}</DialogDescription>
            </DialogHeader>
            <label className="block space-y-1 text-[12px]">
              <span className="font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('followups.postponeDate')}</span>
              <Input type="date" min={todayIso()} value={postpone.date} onChange={(e) => setPostpone({ ...postpone, date: e.target.value })} />
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPostpone(null)}>{t('action.cancel')}</Button>
              <Button onClick={() => act.mutate({ id: postpone.f.id, action: 'postpone', date: postpone.date })} disabled={act.isPending || !postpone.date || postpone.date < todayIso()}>
                {act.isPending && <Loader2 className="size-4 animate-spin" />} {t('followups.act_postpone')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Bloc « Modeles » : 2 kinds × 4 langues, variables expliquees, apercu avec des valeurs d'exemple. */
function TemplatesBlock({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<TemplateKind>('entretien');
  const [locale, setLocale] = useState<FollowupLocale>('fr');
  const [draft, setDraft] = useState<{ key: string; subject: string; body: string } | null>(null);
  const tpl = useQuery({ queryKey: ['followup-templates', companyId], queryFn: () => listFollowupTemplates(companyId) });
  const current = tpl.data?.find((x) => x.kind === kind && x.locale === locale);
  const key = `${kind}/${locale}`;
  const subject = draft?.key === key ? draft.subject : (current?.subject ?? '');
  const body = draft?.key === key ? draft.body : (current?.body ?? '');
  const dirty = draft?.key === key && (draft.subject !== (current?.subject ?? '') || draft.body !== (current?.body ?? ''));
  const bad = unknownVars(`${subject}\n${body}`);
  const save = useMutation({
    mutationFn: () => saveFollowupTemplate({ company_id: companyId, kind, locale, subject, body } as FollowupTemplate),
    onSuccess: () => { toast.success(t('followups.templateSaved')); setDraft(null); qc.invalidateQueries({ queryKey: ['followup-templates', companyId] }); },
    onError: (e) => toast.error(`${t('followups.errorPrefix')} : ${errMsg(e)}`),
  });
  const sample = { prenom: 'Marco', nom: 'Rossi', moto: 'Ducati Multistrada V4 (1-ABC-123)', date: fmtDate(todayIso()), objet: 'Desmo Service 24 000 km', km: '24 000', lien_rdv: 'https://…/mon-espace/rendez-vous' };

  return (
    <div className="mb-4 rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <div className="text-sm font-semibold">{t('followups.templates')}</div>
          <p className="text-[12px] text-muted-foreground">{t('followups.templatesHelp')}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as TemplateKind)}>
            <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{TEMPLATE_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`followups.kind_${k}`)}</SelectItem>)}</SelectContent>
          </Select>
          <Tabs value={locale} onValueChange={(v) => setLocale(v as FollowupLocale)}>
            <TabsList className="h-8">{FOLLOWUP_LOCALES.map((l) => <TabsTrigger key={l} value={l} className="h-6 px-2 text-[12px] uppercase">{l}</TabsTrigger>)}</TabsList>
          </Tabs>
        </div>
      </div>
      {tpl.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {tpl.data && !current && <p className="text-[12px] text-muted-foreground">{t('followups.templateMissing')}</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="block space-y-1 text-[12px]">
            <span className="font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('followups.templateSubject')}</span>
            <Input value={subject} readOnly={!canWrite} onChange={(e) => setDraft({ key, subject: e.target.value, body })} />
          </label>
          <label className="block space-y-1 text-[12px]">
            <span className="font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('followups.templateBody')}</span>
            <Textarea rows={12} value={body} readOnly={!canWrite} onChange={(e) => setDraft({ key, subject, body: e.target.value })} className="font-sans text-[13px] leading-5" />
          </label>
          {bad.length > 0 && (
            <p className="flex items-center gap-1 text-[12px] text-[var(--danger)]"><AlertTriangle className="size-3.5" /> {t('followups.unknownVars')} {bad.join(', ')}</p>
          )}
          {canWrite && (
            <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending || !subject.trim() || !body.trim()}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} {t('followups.templateSave')}
            </Button>
          )}
        </div>
        <div className="space-y-2 text-[12px]">
          <div className="font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('followups.variables')}</div>
          <ul className="space-y-0.5 text-muted-foreground">
            {TEMPLATE_VARS.map((v) => <li key={v}><code className="rounded bg-muted px-1 text-foreground">{`{${v}}`}</code> — {t(`followups.var_${v}`)}</li>)}
          </ul>
          <div className="mt-2 font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('followups.sampleTitle')}</div>
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="font-bold">{fillTemplate(subject, sample)}</p>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-[12px] leading-5">{fillTemplate(body, sample)}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
