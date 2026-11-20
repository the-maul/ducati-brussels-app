/**
 * M0 — Paramètres → « Mise en production » (demande client du 19/11/2026, administrateurs).
 *
 * Une carte dans Paramètres ouvre la fenêtre qui liste TOUT ce qui part vers l'extérieur (connexions
 * et automatismes : Shopify, mails aux clients, SMS, transfert comptable, relève Outlook et IA,
 * application client, Stripe) avec, pour chaque ligne, ce qu'elle fera, son état (Arrêté / Test /
 * Actif / Non utilisé : couleur + icône + libellé) et ce qui manque pour la démarrer.
 *
 * Revue UX/UI (20/11/2026) : sur chaque ligne, un choix « Arrêté · Test · Actif » en 3 boutons (au
 * lieu d'une case de 16 px et de 3 boutons de sélection en bas). On choisit ligne par ligne, puis
 * « Appliquer les changements » récapitule avant → après et applique, une action à la fois (arrêts,
 * puis tests, puis démarrages). Mêmes règles qu'avant (production-rules.ts) ; la base refait tous les
 * contrôles (production_apply : tout ou rien, trace events) : ce composant ne fait que griser.
 * En bas, replié : les tâches automatiques du serveur, en français et à l'heure de Bruxelles.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleSlash, FlaskConical, Loader2, Pause, Play, Rocket, Save, ShieldAlert, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/utils';
import { t, fillVars, getLocale } from '@/lib/i18n';
import { applyProduction, getProductionOverview, productionKey, setAutomationSettings } from './production-api';
import {
  APPLY_ORDER, CRON_ITEM, PRODUCTION_CHOICES, PRODUCTION_GROUPS, canAct, choiceEnabled, cronTone, missingFor, planChanges,
  productionErrorKey, productionTone, targetMode, type CronJob, type ProductionAction, type ProductionItem, type ProductionMode,
} from './production-rules';
import { BRUSSELS_TZ, describeCron } from './cron-describe';
import { SETTINGS_CARD_CLASS } from './settings-card';

const MODE_ICON: Record<ProductionMode, LucideIcon> = { actif: Play, test: FlaskConical, arrete: Pause, non_utilise: CircleSlash };
const DEFAULT_BOX = '__default__';

export function ProductionModeBadge({ mode }: { mode: ProductionMode }) {
  return <StatusBadge tone={productionTone(mode)} icon={MODE_ICON[mode]} label={t(`production.mode.${mode}`)} />;
}

const itemName = (key: string) => t(`production.items.${key}.name`);
const missingText = (codes: string[]) => codes.map((c) => t(`production.missing.${c}`)).join(' · ');

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/production_overview|automation_settings_set|production_apply/.test(msg) && /could not find|does not exist|PGRST202/i.test(msg)) {
    return t('production.schemaMissing');
  }
  const k = productionErrorKey(msg);
  if (k.key === 'generic') return fillVars(t('production.errors.generic'), { msg });
  return fillVars(t(`production.errors.${k.key}`), {
    item: k.item ? itemName(k.item) : '', missing: k.missing ? missingText(k.missing) : '',
  });
}

/** Carte de Paramètres : la carte entière ouvre la fenêtre (administrateurs seulement), sans bouton rouge. */
export function ProductionCard() {
  const { activeCompanyId, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  if (!activeCompanyId || !isAdmin(activeCompanyId)) return null;
  return (
    <>
      <button type="button" className={SETTINGS_CARD_CLASS} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="flex items-center gap-2">
          <Rocket className="size-5 shrink-0 text-primary" aria-hidden />
          <span className="font-ui text-[15px] font-bold">{t('production.cardTitle')}</span>
        </span>
        <span className="text-sm text-muted-foreground">{t('designTransverse.settings.production')}</span>
      </button>
      {open && <ProductionDialog companyId={activeCompanyId} onClose={() => setOpen(false)} />}
    </>
  );
}

const dt = (key: string) => t(`designTransverse.production.${key}`);

/** Fréquence d'une tâche du serveur, en mots, à l'heure de Bruxelles. */
function cronText(schedule: string): string {
  const d = describeCron(schedule);
  const vars: Record<string, string> = { ...d.vars };
  if (d.key === 'weekly_at') vars.day = dt(`day_${d.vars.dayIndex}`);
  return fillVars(dt(d.key), vars);
}

/** Nom d'une tâche du serveur en mots ; une tâche inconnue garde son nom technique. */
function cronName(job: CronJob): string {
  const key = `designTransverse.production.jobs.${job.jobname.replace(/-/g, '_')}`;
  const v = t(key);
  return v === key ? job.jobname : v;
}

function lastRunText(iso: string | null): string {
  if (!iso) return '—';
  const loc = getLocale();
  return new Date(iso).toLocaleString(loc === 'fr' ? 'fr-BE' : loc === 'nl' ? 'nl-BE' : loc === 'it' ? 'it-IT' : 'en-GB', {
    timeZone: BRUSSELS_TZ, dateStyle: 'short', timeStyle: 'short',
  });
}

export function ProductionDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: productionKey(companyId), queryFn: () => getProductionOverview(companyId), retry: false });
  const [targets, setTargets] = useState<Record<string, ProductionAction>>({});
  const [confirming, setConfirming] = useState(false);
  const [box, setBox] = useState<string | null>(null);
  const [rcpt, setRcpt] = useState<string | null>(null);

  const data = q.data;
  const items = useMemo(() => data?.items ?? [], [data]);
  const isTest = !!data?.is_test_company;
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);

  /** Choisir un mode sur une ligne ; rechoisir le mode actuel (ou le même choix) annule le choix. */
  const choose = (item: ProductionItem, action: ProductionAction) => setTargets((cur) => {
    const n = { ...cur };
    if (targetMode(action) === item.mode || n[item.key] === action) delete n[item.key];
    else n[item.key] = action;
    return n;
  });
  const plan = useMemo(() => planChanges(items, targets, isTest), [items, targets, isTest]);

  // Une action à la fois, dans l'ordre arrêts → tests → démarrages ; chaque appel est « tout ou rien ».
  const apply = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      let n = 0;
      for (const action of APPLY_ORDER) {
        const keys = plan.byAction[action];
        if (keys.length === 0) continue;
        const done = await applyProduction(companyId, keys, action);
        n += done.length;
      }
      return n;
    },
    onSuccess: (n) => {
      toast.success(fillVars(t('production.done'), { n: String(n) }));
      setConfirming(false);
      setTargets({});
      qc.invalidateQueries({ queryKey: productionKey(companyId) });
    },
    onError: (e) => {
      setConfirming(false);
      toast.error(errorText(e));
      qc.invalidateQueries({ queryKey: productionKey(companyId) });
    },
  });

  const saveSender = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => setAutomationSettings(
      companyId,
      (box ?? data?.settings?.sender_mailbox ?? DEFAULT_BOX) === DEFAULT_BOX ? null : (box ?? data?.settings?.sender_mailbox ?? null),
      (rcpt ?? data?.settings?.mail_test_recipient ?? '').trim() || null,
    ),
    onSuccess: () => {
      toast.success(t('production.sender.saved'));
      setBox(null); setRcpt(null);
      qc.invalidateQueries({ queryKey: productionKey(companyId) });
    },
    onError: (e) => toast.error(errorText(e)),
  });


  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Rocket className="size-5" /> {t('production.title')}</DialogTitle>
          <DialogDescription>{t('production.intro')}</DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : q.isError || !data ? (
          <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{fillVars(t('production.error'), { msg: errorText(q.error) })}</p>
        ) : (
          <div className="space-y-4">
            {isTest && (
              <p className="flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
                <ShieldAlert className="size-4 shrink-0" /> {t('production.testCompany')}
              </p>
            )}
            {!data.statusChecked && (
              <p className="flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
                <ShieldAlert className="size-4 shrink-0" /> {t('production.statusUnchecked')}
              </p>
            )}

            {/* Boîte d'envoi et adresse de test des mails automatiques */}
            <section className="space-y-2 rounded-md border border-border p-3">
              <p className="font-ui text-[13px] font-bold">{t('production.sender.title')}</p>
              <p className="text-[12px] text-muted-foreground">{t('production.sender.intro')}</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-[12px]">
                  <span className="block font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('production.sender.mailbox')}</span>
                  <Select value={box ?? data.settings?.sender_mailbox ?? DEFAULT_BOX} onValueChange={setBox}>
                    <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_BOX}>{fillVars(t('production.sender.mailboxDefault'), { box: data.sender_mailbox ?? t('production.sender.noMailbox') })}</SelectItem>
                      {data.mailboxes.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1 text-[12px]">
                  <span className="block font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('production.sender.testRecipient')}</span>
                  <Input type="email" className="w-72" value={rcpt ?? data.settings?.mail_test_recipient ?? ''} onChange={(e) => setRcpt(e.target.value)}
                    placeholder={data.mail_test_recipient ?? ''} />
                </label>
                <Button size="sm" variant="outline" onClick={() => saveSender.mutate()} disabled={saveSender.isPending || (box === null && rcpt === null)}>
                  {saveSender.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('production.sender.save')}
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">{fillVars(t('production.sender.testRecipientHint'), { to: data.mail_test_recipient ?? '—' })}</p>
            </section>

            {/* Tout ce qui sort, par thème */}
            {PRODUCTION_GROUPS.map((g) => {
              const rows = items.filter((i) => i.group === g);
              if (rows.length === 0) return null;
              return (
                <section key={g} className="overflow-x-auto rounded-md border border-border">
                  <p className="bg-muted px-3 py-2 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t(`production.groups.${g}`)}</p>
                  <table className="w-full border-collapse text-[13px]">
                    <tbody>
                      {rows.map((it) => (
                        <ItemRow key={it.key} item={it} isTest={isTest} target={targets[it.key] ?? null}
                          invalid={plan.invalid.includes(it.key)} targets={targets} onChoose={(a) => choose(it, a)} />
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}

            {/* Tâches automatiques du serveur : repliées (rarement utiles), en mots, à l'heure de Bruxelles. */}
            <details className="group overflow-x-auto rounded-md border border-border">
              <summary className="flex cursor-pointer list-none items-center gap-2 bg-muted px-3 py-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                {fillVars(dt('cronsToggle'), { n: String(data.crons.length) })}
              </summary>
              <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('production.crons.intro')} {dt('cronsHint')}</p>
              <table className="w-full border-collapse font-data text-[12px]">
                <thead><tr className="border-b border-border">
                  <Th>{t('production.crons.colJob')}</Th><Th>{t('production.crons.colSchedule')}</Th><Th>{t('production.crons.colState')}</Th>
                  <Th>{t('production.crons.colLast')}</Th><Th>{t('production.crons.colServes')}</Th>
                </tr></thead>
                <tbody>
                  {data.crons.map((j) => {
                    const st = cronTone(j);
                    const serves = CRON_ITEM[j.jobname];
                    return (
                      <tr key={j.jobname} className="border-b border-border last:border-0 align-top">
                        <td className="px-3 py-1.5" title={j.jobname}>{cronName(j)}</td>
                        <td className="px-3 py-1.5" title={j.schedule}>{cronText(j.schedule)}</td>
                        <td className="px-3 py-1.5">
                          <StatusBadge tone={st.tone} label={t(`production.crons.state_${st.state}`)} />
                          {j.last_message && <p className="mt-1 max-w-md break-words text-[11px] text-danger">{j.last_message}</p>}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums">{lastRunText(j.last_run)}</td>
                        <td className="px-3 py-1.5">
                          {serves === 'mail_queue' ? t('production.crons.mailQueue')
                            : serves && byKey.has(serves) ? itemName(serves) : t('production.crons.internal')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          </div>
        )}

        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
          <span className="text-[13px] text-muted-foreground">
            {plan.count === 0 ? dt('unchanged') : plan.count === 1 ? dt('changesOne') : fillVars(dt('changes'), { n: String(plan.count) })}
          </span>
          <div className="flex flex-wrap gap-2">
            {plan.count > 0 && (
              <Button variant="outline" onClick={() => setTargets({})} disabled={apply.isPending}>{dt('reset')}</Button>
            )}
            <Button onClick={() => setConfirming(true)} disabled={plan.count === 0 || plan.invalid.length > 0 || apply.isPending}>
              <Save /> {dt('apply')}
            </Button>
          </div>
        </DialogFooter>

        <AlertDialog open={confirming} onOpenChange={(o) => { if (!o && !apply.isPending) setConfirming(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{dt('confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription className="sr-only">{dt('confirmTitle')}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 text-[13px]">
              {APPLY_ORDER.filter((a) => plan.byAction[a].length > 0).map((a) => (
                <div key={a} className="space-y-1">
                  <p className="font-bold">{t(`production.confirm.title_${a}`)}</p>
                  <p className="text-muted-foreground">{t(`production.confirm.body_${a}`)}</p>
                  <ul className="space-y-0.5">
                    {plan.byAction[a].map((key) => {
                      const it = byKey.get(key);
                      return it ? (
                        <li key={key}>{fillVars(t('production.confirm.line'), {
                          name: itemName(key), from: t(`production.mode.${it.mode}`), to: t(`production.mode.${targetMode(a)}`),
                        })}</li>
                      ) : null;
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={apply.isPending}>{t('action.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); apply.mutate(); }} disabled={apply.isPending}>
                {apply.isPending ? <Loader2 className="animate-spin" /> : null} {dt('confirmOk')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/** Le mode affiché comme choisi : couleur + icône + libellé (jamais le rouge de la marque). */
const CHOICE_ON: Record<ProductionMode, string> = {
  actif: 'border-success bg-success-bg text-success hover:bg-success-bg',
  test: 'border-warning bg-warning-bg text-warning hover:bg-warning-bg',
  arrete: 'border-neutral-tag bg-neutral-bg text-neutral-tag hover:bg-neutral-bg',
  non_utilise: 'border-neutral-tag bg-neutral-bg text-neutral-tag hover:bg-neutral-bg',
};

function ItemRow({ item, isTest, target, invalid, targets, onChoose }: {
  item: ProductionItem; isTest: boolean; target: ProductionAction | null; invalid: boolean;
  targets: Readonly<Record<string, ProductionAction>>; onChoose: (a: ProductionAction) => void;
}) {
  const starting = new Set(Object.entries(targets).filter(([, a]) => a === 'start').map(([k]) => k));
  const toStart = item.mode === 'actif' || item.key === 'stripe' ? [] : missingFor(item, 'start', new Set());
  const toTest = item.test_ok && item.mode === 'arrete' ? (item.missing_test ?? []) : [];
  const blocking = target && invalid ? missingFor(item, target, starting) : [];
  const shownMode: ProductionMode = target ? targetMode(target) : item.mode;
  // Rien à choisir (non utilisé, ou aucun autre mode possible) : l'état seul, comme avant.
  const choosable = item.mode !== 'non_utilise' && PRODUCTION_CHOICES.some((c) => choiceEnabled(item, c.action, isTest));
  return (
    <tr className={cn('border-b border-border last:border-0 align-top', target && 'bg-accent/40')}>
      <td className="px-3 py-2">
        <p className="font-bold">{itemName(item.key)}</p>
        <p className="text-[12px] text-muted-foreground">{t(`production.items.${item.key}.desc`)}</p>
      </td>
      <td className="w-[19rem] px-3 py-2">
        {!choosable ? (
          <ProductionModeBadge mode={item.mode} />
        ) : (
          <div role="group" aria-label={fillVars(dt('choiceLabel'), { name: itemName(item.key) })} className="inline-flex flex-wrap gap-1">
            {PRODUCTION_CHOICES.map(({ action, mode }) => {
              const Icon = MODE_ICON[mode];
              const isCurrent = item.mode === mode;
              const on = shownMode === mode;
              return (
                <Button
                  key={mode} type="button" size="sm" variant="outline"
                  aria-pressed={on}
                  // Le mode actuel reste cliquable : le rechoisir annule le changement prévu sur la ligne.
                  disabled={!isCurrent && !choiceEnabled(item, action, isTest)}
                  onClick={() => onChoose(action)}
                  className={cn('gap-1.5 px-2.5', on && cn('font-bold', CHOICE_ON[mode]), on && target && 'border-2 border-dashed')}
                >
                  <Icon /> {t(`production.mode.${mode}`)}
                </Button>
              );
            })}
          </div>
        )}
        {target && (
          <p className="mt-1 text-[12px] font-bold">{fillVars(dt('pending'), { mode: t(`production.mode.${targetMode(target)}`) })}</p>
        )}
      </td>
      <td className="w-72 px-3 py-2 text-[12px]">
        {blocking.length > 0 && (
          <p className="flex items-start gap-1 text-danger">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span><span className="font-bold">{t('production.missingLabel')}</span> {missingText(blocking)}</span>
          </p>
        )}
        {blocking.length === 0 && toStart.length > 0 && <p><span className="font-bold">{t('production.missingLabel')}</span> {missingText(toStart)}</p>}
        {blocking.length === 0 && toTest.length > 0 && <p><span className="font-bold">{t('production.missingTestLabel')}</span> {missingText(toTest)}</p>}
        {item.key === 'stripe' && <p className="text-muted-foreground">{dt('stripeHint')}</p>}
        {item.mode !== 'actif' && item.key !== 'stripe' && toStart.length === 0 && !isTest && canAct(item, 'start', isTest, new Set([item.key, 'sms', 'outlook_poll'])) && (
          <p className="text-muted-foreground">{t('production.ready')}</p>
        )}
      </td>
    </tr>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</th>;
}
