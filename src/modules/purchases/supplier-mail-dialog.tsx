/**
 * M4/M10 — Mail au fournisseur depuis la proposition de commande (mission 02, carte 4) :
 * « Demande de prix » (sans prix) ou « Envoyer la commande par mail » (PA HT), pièce jointe PDF ou CSV,
 * boîte Outlook au choix (boîtes partagées de la société + adresse de l'utilisateur si même domaine,
 * même règle que le CRM), envoi par `graph-send-email`. « Vérifier sans envoyer » = mode simulation
 * du serveur (rien ne part, rien n'est enregistré). Pas de pied de mail client (pas d'`origin`).
 * Un envoi réel est tracé dans `events` (`supplier_proposal_log_mail`).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, Loader2, Mail, ShieldCheck } from 'lucide-react';
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
import { t } from '@/lib/i18n';
import { aggregateForSupplier, buildSupplierCsv, type ProposalRow } from './proposal';
import { buildSupplierPdf } from './proposal-pdf';
import { logSupplierMail } from './proposal-api';

const fill = (s: string, vars: Record<string, string>) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), s);

export type SupplierMailKind = 'price_request' | 'order';
type Preview = { from: string; attachments: { name: string; size: number }[]; html?: string };

export function SupplierMailDialog({ kind, companyId, companyName, supplierId, supplierName, supplierEmail, lines, onClose }: {
  kind: SupplierMailKind; companyId: string; companyName: string;
  supplierId: string; supplierName: string; supplierEmail: string | null;
  lines: ProposalRow[]; onClose: () => void;
}) {
  const { session } = useAuth();
  const myEmail = (session?.user?.email ?? '').toLowerCase();
  const today = new Date().toLocaleDateString('fr-BE');
  const fileLines = useMemo(() => aggregateForSupplier(lines), [lines]);
  const listText = fileLines.map((l) => `- ${l.supplierRef || l.reference} · ${l.designation} · ${t('proposal.colQty')} ${String(l.qty).replace('.', ',')}`).join('\n');
  const vars = { company: companyName, supplier: supplierName, date: today, lines: listText };

  const [to, setTo] = useState(supplierEmail ?? '');
  const [subject, setSubject] = useState(fill(t(kind === 'order' ? 'proposal.mailSubjectOrder' : 'proposal.mailSubjectPrice'), vars));
  const [body, setBody] = useState(fill(t(kind === 'order' ? 'proposal.mailBodyOrder' : 'proposal.mailBodyPrice'), vars));
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');
  const [preview, setPreview] = useState<Preview | null>(null);

  const mailboxesQ = useQuery({ queryKey: ['company-mailboxes', companyId], queryFn: () => listCompanyMailboxes(companyId) });
  const shared = (mailboxesQ.data ?? []).map((m) => m.address.toLowerCase());
  const sameDomain = shared.some((a) => a.split('@')[1] === myEmail.split('@')[1]);
  const senders = [...shared, ...(myEmail && sameDomain && !shared.includes(myEmail) ? [myEmail] : [])];
  const [fromPick, setFromPick] = useState('');
  const fromBox = fromPick || (senders.includes(myEmail) ? myEmail : senders[0] ?? '');

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `${kind === 'order' ? t('proposal.fileOrder') : t('proposal.filePrice')}_${supplierName.replace(/[^\p{L}\p{N}]+/gu, '-')}_${stamp}`;

  async function buildAttachment(): Promise<{ name: string; contentType: string; bytes: Uint8Array }> {
    if (format === 'csv') {
      const csv = buildSupplierCsv(fileLines, kind === 'order', [
        t('proposal.colSupplierRef'), t('proposal.colRef'), t('proposal.colDesignation'), t('proposal.colQty'), t('proposal.colPa'), t('proposal.colAmount'),
      ]);
      return { name: `${baseName}.csv`, contentType: 'text/csv', bytes: new TextEncoder().encode(csv) };
    }
    const { data: sup } = await supabase.from('contacts').select('supplier_customer_no').eq('id', supplierId).maybeSingle();
    const bytes = await buildSupplierPdf({ kind, companyName, supplierName, supplierCustomerNo: sup?.supplier_customer_no ?? null, date: today, lines: fileLines });
    return { name: `${baseName}.pdf`, contentType: 'application/pdf', bytes };
  }

  const validTo = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to.trim());
  const canSend = validTo && !!subject.trim() && !!fromBox && fileLines.length > 0;

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const att = await buildAttachment();
      const { data, error } = await supabase.functions.invoke('graph-send-email', {
        body: {
          companyId, contactId: supplierId, to: to.trim(), from: fromBox || undefined,
          subject, body: plainTextToHtml(body),
          attachments: [{ name: att.name, contentType: att.contentType, contentBytes: bytesToBase64(att.bytes) }],
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
      if (!r.dryRun) {
        await logSupplierMail({ companyId, supplierId, kind, to: to.trim(), from: r.from ?? fromBox, subject, lineIds: lines.map((l) => l.line_id), attachment: att.name })
          .catch(() => toast.warning(t('proposal.mailLogFailed')));
      }
      return { ok: true as const, dryRun: !!r.dryRun, from: r.from ?? fromBox, attachments: r.attachments ?? [], html: r.html ?? '' };
    },
    onSuccess: (r) => {
      if (!r.ok) { toast.error(mailErrorLabel(r.error)); return; }
      if (r.dryRun) { setPreview({ from: r.from, attachments: r.attachments, html: r.html }); return; }
      toast.success(fill(t('proposal.mailSent'), { to: to.trim(), from: r.from }));
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('proposal.errGeneric')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(kind === 'order' ? 'proposal.mailTitleOrder' : 'proposal.mailTitlePrice')} · {supplierName}</DialogTitle>
          <DialogDescription>{t('proposal.mailIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
              <Input type="email" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} placeholder={t('salesMail.toPlaceholder')} />
              {!supplierEmail && <p className="text-[12px] text-muted-foreground">{t('proposal.noSupplierEmail')}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('salesMail.subject')}</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('salesMail.body')}</Label>
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-[13px]">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span>{t('proposal.attachment')}</span>
            <Select value={format} onValueChange={(v) => { setFormat(v as 'pdf' | 'csv'); setPreview(null); }}>
              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-muted-foreground tabular-nums">{fill(t('proposal.attachmentLines'), { n: String(fileLines.length) })}</span>
          </div>
          {kind === 'order' && <p className="text-[12px] text-muted-foreground">{t('proposal.mailOrderHint')}</p>}
          {preview && (
            <div className="space-y-1 rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">
              <p className="flex items-center gap-1.5 font-medium"><ShieldCheck className="size-3.5" /> {t('salesMail.dryRunOk')}</p>
              <p>{fill(t('proposal.dryRunDetail'), {
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
            {run.isPending && run.variables === true ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('salesMail.dryRun')}
          </Button>
          <Button onClick={() => run.mutate(false)} disabled={run.isPending || !canSend}>
            {run.isPending && run.variables === false ? <Loader2 className="animate-spin" /> : <Mail />} {t('salesMail.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
