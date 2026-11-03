/**
 * « Commander » une commande demo / courtoisie (mission 09, carte 6) : le classeur Ducati
 * rempli part en piece jointe a cas.dwe@ducati.com (reglable) depuis la boite Outlook de
 * l'utilisateur (`graph-send-email`, boite au choix parmi les boites partagees de la societe
 * et l'adresse de l'utilisateur si meme domaine). « Verifier sans envoyer » = simulation du
 * serveur (rien ne part). Ordre reel : classeur conserve en GED → mail → statut « commandee »
 * (fonction SQL excel_order_mark_ordered, trace events). Le numero DCS se saisit apres.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Mail, ShieldCheck, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { MailPreview } from '@/components/mail-preview';
import { useAuth } from '@/lib/auth/auth-context';
import { listCompanyMailboxes } from '@/modules/crm/api';
import { bytesToBase64, mailErrorLabel, plainTextToHtml } from '@/modules/sales/document-mail-api';
import { t, fillVars } from '@/lib/i18n';
import { eur } from './order-ui';
import type { ExcelOrderLine } from './excel-api';
import { DEMO_TAB_LABELS, checkDemoOrder, demoMailSubject, demoWorkbookFileName, filledMotos, motosForTab } from './demo-rules';
import { buildDemoWorkbook, keepWorkbookWithOrder, markDemoOrdered, type DemoOrder, type DemoTemplate } from './demo-api';

type Preview = { from: string; attachments: { name: string; size: number }[]; html?: string };

export function DemoMailDialog({ companyId, companyName, order, lines, template, dealerCode, mailTo, onClose, onOrdered }: {
  companyId: string; companyName: string; order: DemoOrder; lines: ExcelOrderLine[]; template: DemoTemplate;
  dealerCode: string; mailTo: string; onClose: () => void; onOrdered: (o: DemoOrder) => void;
}) {
  const { session } = useAuth();
  const myEmail = (session?.user?.email ?? '').toLowerCase();
  const check = useMemo(() => checkDemoOrder(lines.map((l) => ({ tab: l.tab, priceDealer: l.price_dealer, qty: l.qty })), 0), [lines]);
  const tabs = check.tabsWithLines;
  const fileName = demoWorkbookFileName(order.number ?? null, tabs);

  const listText = tabs.map((tab) => {
    const tl = lines.filter((l) => l.tab === tab && l.qty > 0);
    const motos = filledMotos(motosForTab(order.demo_motos, tab)).map((m) => [m.model, m.orderNo, m.serial].filter(Boolean).join(' / ')).join(' ; ');
    return `${DEMO_TAB_LABELS[tab]} : ${tl.length} ${t('demoOrder.mailLinesWord')}${motos ? ` — ${t('demoOrder.mailMotosWord')} ${motos}` : ''}`;
  }).join('\n');
  const vars = { company: companyName, dealer: dealerCode, date: new Date().toLocaleDateString('fr-BE'), lines: listText, number: order.number ?? '' };

  const [to, setTo] = useState(mailTo);
  const [subject, setSubject] = useState(demoMailSubject(tabs, companyName));
  const [body, setBody] = useState(fillVars(t('demoOrder.mailBody'), vars));
  const [preview, setPreview] = useState<Preview | null>(null);

  const mailboxesQ = useQuery({ queryKey: ['company-mailboxes', companyId], queryFn: () => listCompanyMailboxes(companyId) });
  const shared = (mailboxesQ.data ?? []).map((m) => m.address.toLowerCase());
  const sameDomain = shared.some((a) => a.split('@')[1] === myEmail.split('@')[1]);
  const senders = [...shared, ...(myEmail && sameDomain && !shared.includes(myEmail) ? [myEmail] : [])];
  const [fromPick, setFromPick] = useState('');
  const fromBox = fromPick || (senders.includes(myEmail) ? myEmail : senders[0] ?? '');

  // Le classeur est construit une fois (lecture du vierge en GED, remplissage SheetJS).
  const builtQ = useQuery({
    queryKey: ['demo-workbook-built', order.id, lines.map((l) => `${l.id}:${l.qty}`).join(','), JSON.stringify(order.demo_motos ?? {})],
    queryFn: () => buildDemoWorkbook(template, order, lines, dealerCode, fileName),
    staleTime: Infinity,
  });

  const validTo = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to.trim());
  const canSend = validTo && !!subject.trim() && !!fromBox && !!builtQ.data && builtQ.data.report.unknown.length === 0 && !check.empty;

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const built = builtQ.data!;
      let kept: { attachmentId: string; path: string } | null = null;
      if (!dryRun) {
        // 1. Le classeur rempli est conserve avec la commande AVANT l'envoi (M-79).
        kept = await keepWorkbookWithOrder(companyId, order, built, fillVars(t('demoOrder.keptNote'), { to: to.trim() }));
      }
      // 2. Envoi (ou simulation) par la boite Outlook choisie.
      const { data, error } = await supabase.functions.invoke('graph-send-email', {
        body: {
          companyId, to: to.trim(), from: fromBox || undefined, subject, body: plainTextToHtml(body),
          attachments: [{ name: built.fileName, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBytes: bytesToBase64(built.bytes) }],
          ...(dryRun ? { dryRun: true } : {}),
        },
      });
      if (error) {
        const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
        let code: string | undefined;
        if (ctx && typeof ctx.json === 'function') { try { code = ((await ctx.json()) as { error?: string })?.error; } catch { /* corps illisible */ } }
        return { ok: false as const, error: code ?? error.message };
      }
      const r = data as { ok?: boolean; error?: string; from?: string; dryRun?: boolean; html?: string; attachments?: { name: string; size: number }[] };
      if (!r?.ok) return { ok: false as const, error: r?.error ?? 'send_failed' };
      if (r.dryRun || !kept) return { ok: true as const, dryRun: true, from: r.from ?? fromBox, attachments: r.attachments ?? [], html: r.html ?? '', order: null };
      // 3. Statut « commandee » (controles serveur : minimum par onglet, accessoires, classeur conserve).
      const ordered = await markDemoOrdered({ orderId: order.id, attachmentId: kept.attachmentId, path: kept.path, mailTo: to.trim(), mailFrom: r.from ?? fromBox, mailSubject: subject });
      return { ok: true as const, dryRun: false, from: r.from ?? fromBox, attachments: r.attachments ?? [], html: '', order: ordered };
    },
    onSuccess: (r) => {
      if (!r.ok) { toast.error(mailErrorLabel(r.error)); return; }
      if (r.dryRun) { setPreview({ from: r.from, attachments: r.attachments, html: r.html }); return; }
      toast.success(fillVars(t('demoOrder.sent'), { n: r.order?.number ?? '', to: to.trim(), from: r.from }));
      onOrdered(r.order!);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('orders.errGeneric')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="size-5" /> {t('demoOrder.mailTitle')}</DialogTitle>
          <DialogDescription>{t('demoOrder.mailIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px]">
            <p className="flex items-center gap-2 font-ui font-bold"><FileSpreadsheet className="size-4" /> {fileName}</p>
            {builtQ.isLoading && <p className="text-muted-foreground"><Loader2 className="inline size-3.5 animate-spin" /> {t('demoOrder.building')}</p>}
            {builtQ.error && <p className="text-danger">{(builtQ.error as Error).message}</p>}
            {builtQ.data && (
              <ul className="mt-1 text-muted-foreground">
                {tabs.map((tab) => (
                  <li key={tab}>
                    {DEMO_TAB_LABELS[tab]} : {fillVars(t('demoOrder.writtenLines'), { n: builtQ.data!.report.written[tab] })} · {eur(lines.filter((l) => l.tab === tab && l.qty > 0).reduce((s, l) => s + l.price_dealer * l.qty, 0))}
                  </li>
                ))}
                {builtQ.data.report.unknown.length > 0 && (
                  <li className="text-danger">
                    {fillVars(t('demoOrder.unknownRefs'), { refs: builtQ.data.report.unknown.map((u) => `${u.reference} (${DEMO_TAB_LABELS[u.tab]})`).join(', ') })}
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('salesMail.from')}</Label>
              <Select value={fromBox} onValueChange={(v) => { setFromPick(v); setPreview(null); }}>
                <SelectTrigger><SelectValue placeholder={t('salesMail.fromPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  {senders.map((a) => <SelectItem key={a} value={a}>{a}{a === myEmail ? ` · ${t('crm.fromMyAddress')}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('salesMail.to')}</Label>
              <Input type="email" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('salesMail.subject')}</Label>
            <Input value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('salesMail.body')}</Label>
            <Textarea rows={8} value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} />
          </div>
          {preview && (
            <div className="space-y-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
              <p className="flex items-center gap-1.5 font-medium"><ShieldCheck className="size-3.5" /> {t('salesMail.dryRunOk')}</p>
              <p>{fillVars(t('proposal.dryRunDetail'), {
                from: preview.from,
                files: preview.attachments.map((a) => `${a.name} (${Math.max(1, Math.round(a.size / 1024))} Ko)`).join(', '),
              })}</p>
              {preview.html && <MailPreview html={preview.html} />}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>{t('action.cancel')}</Button>
          <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending || !canSend} title={t('salesMail.dryRunHint')}>
            {run.isPending && run.variables === true ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('salesMail.dryRun')}
          </Button>
          <Button onClick={() => run.mutate(false)} disabled={run.isPending || !canSend}>
            {run.isPending && run.variables === false ? <Loader2 className="animate-spin" /> : <Mail />} {t('demoOrder.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
