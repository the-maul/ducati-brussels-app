/**
 * M0 — Paramètres → « Mise en production » (demande client du 19/11/2026, administrateurs).
 *
 * Une carte dans Paramètres ouvre la fenêtre qui liste TOUT ce qui part vers l'extérieur (connexions
 * et automatismes : Shopify, mails aux clients, SMS, transfert comptable, relève Outlook et IA,
 * application client, Stripe) avec, pour chaque ligne, ce qu'elle fera, son état (Arrêté / Test /
 * Actif / Non utilisé : couleur + icône + libellé), ce qui manque pour la démarrer, et une case.
 * Boutons : « Démarrer la sélection » (Actif), « Passer en test », « Mettre en pause » (chemin
 * inverse), chacun avec une confirmation explicite qui récapitule avant → après. La base refait tous
 * les contrôles (production_apply : tout ou rien, trace events) : ce composant ne fait que griser.
 * En bas : les tâches planifiées pg_cron, leur état et leur dernière exécution.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleSlash, FlaskConical, Loader2, Pause, Play, Rocket, Save, ShieldAlert, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import { applyProduction, getProductionOverview, productionKey, setAutomationSettings } from './production-api';
import {
  CRON_ITEM, PRODUCTION_GROUPS, canAct, cronTone, isCheckable, missingFor, productionErrorKey, productionTone,
  selectionAllows, targetMode, type ProductionAction, type ProductionItem, type ProductionMode,
} from './production-rules';

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

/** Carte de Paramètres : ouvre la fenêtre (administrateurs seulement). */
export function ProductionCard() {
  const { activeCompanyId, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  if (!activeCompanyId || !isAdmin(activeCompanyId)) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <Rocket className="size-6 text-primary" />
      <span className="font-ui text-[15px] font-bold">{t('production.cardTitle')}</span>
      <span className="text-sm text-muted-foreground">{t('production.cardDesc')}</span>
      <div><Button size="sm" onClick={() => setOpen(true)}><Rocket /> {t('production.open')}</Button></div>
      {open && <ProductionDialog companyId={activeCompanyId} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ProductionDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: productionKey(companyId), queryFn: () => getProductionOverview(companyId), retry: false });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<ProductionAction | null>(null);
  const [box, setBox] = useState<string | null>(null);
  const [rcpt, setRcpt] = useState<string | null>(null);

  const data = q.data;
  const items = useMemo(() => data?.items ?? [], [data]);
  const isTest = !!data?.is_test_company;
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);

  const toggle = (key: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n; });

  const apply = useMutation({
    meta: { success: false, error: false },
    mutationFn: (action: ProductionAction) => applyProduction(companyId, [...sel], action),
    onSuccess: (done) => {
      toast.success(fillVars(t('production.done'), { n: String(done.length) }));
      setPending(null);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: productionKey(companyId) });
    },
    onError: (e) => { setPending(null); toast.error(errorText(e)); },
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

  const chosen = items.filter((i) => sel.has(i.key));
  const allowed = (a: ProductionAction) => selectionAllows(items, sel, a, isTest);

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
                      {rows.map((it) => <ItemRow key={it.key} item={it} isTest={isTest} checked={sel.has(it.key)} onToggle={(on) => toggle(it.key, on)} />)}
                    </tbody>
                  </table>
                </section>
              );
            })}

            {/* Tâches planifiées */}
            <section className="overflow-x-auto rounded-md border border-border">
              <p className="bg-muted px-3 py-2 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('production.crons.title')}</p>
              <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('production.crons.intro')}</p>
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
                        <td className="px-3 py-1.5 font-mono">{j.jobname}</td>
                        <td className="px-3 py-1.5 font-mono">{j.schedule}</td>
                        <td className="px-3 py-1.5">
                          <StatusBadge tone={st.tone} label={t(`production.crons.state_${st.state}`)} />
                          {j.last_message && <p className="mt-1 max-w-md break-words text-[11px] text-danger">{j.last_message}</p>}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums">{j.last_run ? new Date(j.last_run).toLocaleString() : '—'}</td>
                        <td className="px-3 py-1.5">
                          {serves === 'mail_queue' ? t('production.crons.mailQueue')
                            : serves && byKey.has(serves) ? itemName(serves) : t('production.crons.internal')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </div>
        )}

        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
          <span className="text-[12px] text-muted-foreground">{fillVars(t('production.selected'), { n: String(sel.size) })}</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPending('pause')} disabled={!allowed('pause') || apply.isPending}><Pause /> {t('production.actions.pause')}</Button>
            <Button variant="outline" onClick={() => setPending('test')} disabled={!allowed('test') || apply.isPending}><FlaskConical /> {t('production.actions.test')}</Button>
            <Button onClick={() => setPending('start')} disabled={!allowed('start') || apply.isPending}><Play /> {t('production.actions.start')}</Button>
          </div>
        </DialogFooter>

        <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o && !apply.isPending) setPending(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{pending ? t(`production.confirm.title_${pending}`) : ''}</AlertDialogTitle>
              <AlertDialogDescription>{pending ? t(`production.confirm.body_${pending}`) : ''}</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="space-y-1 text-[13px]">
              {pending && chosen.map((i) => (
                <li key={i.key}>{fillVars(t('production.confirm.line'), {
                  name: itemName(i.key), from: t(`production.mode.${i.mode}`), to: t(`production.mode.${targetMode(pending)}`),
                })}</li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={apply.isPending}>{t('action.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); if (pending) apply.mutate(pending); }} disabled={apply.isPending}>
                {apply.isPending ? <Loader2 className="animate-spin" /> : null} {pending ? t(`production.confirm.ok_${pending}`) : ''}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function ItemRow({ item, isTest, checked, onToggle }: { item: ProductionItem; isTest: boolean; checked: boolean; onToggle: (on: boolean) => void }) {
  const checkable = isCheckable(item, isTest);
  const toStart = item.mode === 'actif' || item.key === 'stripe' ? [] : missingFor(item, 'start', new Set());
  const toTest = item.test_ok && item.mode === 'arrete' ? (item.missing_test ?? []) : [];
  return (
    <tr className={`border-b border-border last:border-0 align-top ${checkable ? '' : 'text-muted-foreground'}`}>
      <td className="w-8 px-3 py-2">
        <Checkbox checked={checked} disabled={!checkable} onCheckedChange={(v) => onToggle(v === true)} aria-label={itemName(item.key)} />
      </td>
      <td className="px-3 py-2">
        <p className="font-bold">{itemName(item.key)}</p>
        <p className="text-[12px] text-muted-foreground">{t(`production.items.${item.key}.desc`)}</p>
      </td>
      <td className="w-36 px-3 py-2"><ProductionModeBadge mode={item.mode} /></td>
      <td className="w-80 px-3 py-2 text-[12px]">
        {toStart.length > 0 && <p><span className="font-bold">{t('production.missingLabel')}</span> {missingText(toStart)}</p>}
        {toTest.length > 0 && <p><span className="font-bold">{t('production.missingTestLabel')}</span> {missingText(toTest)}</p>}
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
