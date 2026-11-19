/**
 * Encaissements (rattrapage G8, 18/11/2026) — onglet « Relances » : G8 Encaissements > Gestion
 * des relances. Factures échues jusqu'au …, type de relance à envoyer, type déjà traité, montant
 * frais, majorer de %, grille (type, date et média de la dernière relance), sélection, aperçu,
 * « Éditer relance(s) » (PDF, noté « courrier »), « Envoyer par mail » EN TEST UNIQUEMENT.
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FlaskConical, Loader2, Mail, Printer, Send, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { getReceivableSettings, listDunningCandidates, listDunningTemplates, type ContactPick, type DunningCandidate } from './api';
import { groupLetters, meetsMinimum, normalizeDunningMode, type DunningTemplate } from './dunning';
import { prepareLetters, previewLetters, printLetters, sendLettersByMail } from './dunning-send';
import { openPdf } from './receivables-pdf';
import { eur, fmtDate, loadPdfCompany, parseAmount, todayIso } from './helpers';
import { ContactPicker, Empty, Lbl, Th } from './ui-bits';

const AUTO = '__auto';
const ALL = '__all';
const NEVER = '__never';

export function DunningTab({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [dueTo, setDueTo] = useState(todayIso());
  const [side, setSide] = useState<'debit' | 'credit'>('debit');
  const [contact, setContact] = useState<ContactPick | null>(null);
  const [lastCode, setLastCode] = useState<string>(ALL);
  const [minAmount, setMinAmount] = useState('');
  const [sendCode, setSendCode] = useState<string>(AUTO);
  const [fee, setFee] = useState('');
  const [surcharge, setSurcharge] = useState('');
  const [withInvoice, setWithInvoice] = useState(false);
  const [message, setMessage] = useState('');
  const [letterDate, setLetterDate] = useState(todayIso());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settingsQ = useQuery({ queryKey: ['receivable-settings', companyId], queryFn: () => getReceivableSettings(companyId), retry: false });
  const templatesQ = useQuery({ queryKey: ['dunning-templates', companyId], queryFn: () => listDunningTemplates(companyId) });
  const q = useQuery({
    queryKey: ['dunning-candidates', companyId, dueTo, side, contact?.id, lastCode, minAmount],
    queryFn: () => listDunningCandidates(companyId, {
      dueTo, side, contactId: contact?.id, minAmount: parseAmount(minAmount),
      lastCode: lastCode === ALL ? null : lastCode === NEVER ? '' : lastCode,
    }),
  });
  const rows = q.data ?? [];
  const templates = (templatesQ.data ?? []).filter((x) => x.is_active !== false);
  const tplMap = useMemo(() => new Map<string, DunningTemplate>(templates.map((x) => [x.code, x])), [templates]);
  const mode = normalizeDunningMode(settingsQ.data?.dunning_mode);
  const testTo = settingsQ.data?.effective_test_recipient ?? null;
  // Envoi reel aux clients : seulement apres Parametres → Mise en production.
  const live = mode === 'actif';
  const selected = rows.filter((r) => sel.has(r.document_id));
  const total = rows.reduce((s, r) => s + r.amount_due, 0);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const buildPrepared = async (isTest: boolean) => {
    if (selected.length === 0) throw new Error(t('receivables.selectSome'));
    const fallback = templates[0]?.code;
    if (!fallback) throw new Error(t('receivables.noTemplate'));
    const letters = groupLetters(selected.map(toDunningRow), sendCode === AUTO ? null : sendCode, fallback)
      .filter((l) => { const tpl = tplMap.get(l.templateCode); return tpl ? meetsMinimum(l, tpl) : false; });
    if (letters.length === 0) throw new Error(t('receivables.belowMinimum'));
    const company = await loadPdfCompany(companyId);
    return prepareLetters(company, letters, tplMap, {
      dateIso: letterDate, feeFixed: fee.trim() ? parseAmount(fee) : null, surchargePct: surcharge.trim() ? parseAmount(surcharge) : null,
    }, isTest);
  };

  const preview = useMutation({
    mutationFn: async () => { const w = window.open('', '_blank'); try { openPdf(await previewLetters(await buildPrepared(false)), w); } catch (e) { w?.close(); throw e; } },
    onError: (e) => setError(errorMessage(e)),
  });
  const print = useMutation({
    mutationFn: async () => { const w = window.open('', '_blank'); try { openPdf(await printLetters(companyId, await buildPrepared(false)), w); } catch (e) { w?.close(); throw e; } },
    onSuccess: () => { setInfo(t('receivables.printedOk')); setSel(new Set()); qc.invalidateQueries({ queryKey: ['dunning-candidates'] }); },
    onError: (e) => setError(errorMessage(e)),
  });
  const send = useMutation({
    mutationFn: async () => sendLettersByMail({ companyId, prepared: await buildPrepared(!live), mode, testRecipient: testTo, withInvoice, message }),
    onSuccess: (r) => {
      setConfirm(false);
      if (r.skipped) { setError(t(r.skipped === 'arrete' ? 'receivables.mailStopped' : 'receivables.noTestRecipient')); return; }
      setInfo(live ? fillVars(t('receivables.mailSentLive'), { n: String(r.sent) }) : fillVars(t('receivables.mailSentTest'), { n: String(r.sent), to: r.to ?? '' }));
      if (r.failed.length) setError(r.failed.map((f) => `${f.client} : ${f.error}`).join(' · '));
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ['dunning-candidates'] });
    },
    onError: (e) => { setConfirm(false); setError(errorMessage(e)); },
  });
  const busy = preview.isPending || print.isPending || send.isPending;

  return (
    <div className="space-y-3">
      {/* Mode d'envoi : arrete / test / actif (actif = Parametres → Mise en production) */}
      <div className={`flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-[13px] ${mode === 'arrete' ? 'bg-neutral-bg text-neutral-tag' : live ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'}`}>
        {mode === 'arrete'
          ? <StatusBadge tone="neutral" icon={ShieldOff} label={t('receivables.modeStopped')} />
          : live ? <StatusBadge tone="success" icon={Send} label={t('receivables.modeActive')} />
          : <StatusBadge tone="warning" icon={FlaskConical} label={t('receivables.modeTest')} />}
        <span>{mode === 'arrete' ? t('receivables.modeStoppedHelp') : live ? t('receivables.modeActiveHelp') : testTo ? fillVars(t('receivables.modeTestHelp'), { to: testTo }) : t('receivables.noTestRecipient')}</span>
      </div>

      <div className="grid gap-3 rounded-md border border-border bg-card p-3 md:grid-cols-4">
        <label className="space-y-1"><Lbl>{t('receivables.dueUntil')}</Lbl><Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} /></label>
        <label className="space-y-1"><Lbl>{t('receivables.side')}</Lbl>
          <Select value={side} onValueChange={(v) => { setSide(v as 'debit' | 'credit'); setSel(new Set()); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="debit">{t('receivables.sideDebit')}</SelectItem><SelectItem value="credit">{t('receivables.sideCredit')}</SelectItem></SelectContent>
          </Select>
        </label>
        <label className="space-y-1"><Lbl>{t('receivables.colClient')}</Lbl><ContactPicker companyId={companyId} value={contact} onChange={setContact} className="w-full" /></label>
        <label className="space-y-1"><Lbl>{t('receivables.alreadyTreated')}</Lbl>
          <Select value={lastCode} onValueChange={setLastCode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('receivables.allTypes')}</SelectItem>
              <SelectItem value={NEVER}>{t('receivables.neverReminded')}</SelectItem>
              {templates.map((x) => <SelectItem key={x.code} value={x.code}>{x.code} · {x.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1"><Lbl>{t('receivables.typeToSend')}</Lbl>
          <Select value={sendCode} onValueChange={setSendCode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{t('receivables.typeAuto')}</SelectItem>
              {templates.map((x) => <SelectItem key={x.code} value={x.code}>{x.code} · {x.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1"><Lbl>{t('receivables.minAmount')}</Lbl><Input type="number" step="0.01" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="text-right tabular-nums" /></label>
        <label className="space-y-1"><Lbl>{t('receivables.feeFixed')}</Lbl><Input type="number" step="0.01" value={fee} placeholder={t('receivables.fromTemplate')} onChange={(e) => setFee(e.target.value)} className="text-right tabular-nums" /></label>
        <label className="space-y-1"><Lbl>{t('receivables.surchargePct')}</Lbl><Input type="number" step="0.01" value={surcharge} placeholder={t('receivables.fromTemplate')} onChange={(e) => setSurcharge(e.target.value)} className="text-right tabular-nums" /></label>
        <label className="space-y-1"><Lbl>{t('receivables.letterDate')}</Lbl><Input type="date" value={letterDate} onChange={(e) => setLetterDate(e.target.value)} /></label>
        <label className="flex items-end gap-2 pb-2 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={withInvoice} onChange={(e) => setWithInvoice(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" /> {t('receivables.withInvoice')}
        </label>
        <label className="space-y-1 md:col-span-2"><Lbl>{t('receivables.customMessage')}</Lbl><Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('receivables.customMessageHint')} /></label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setSel(new Set(rows.map((r) => r.document_id)))} disabled={!rows.length}>{t('receivables.selectAll')}</Button>
        <Button variant="outline" size="sm" onClick={() => setSel(new Set())} disabled={sel.size === 0}>{t('receivables.selectNone')}</Button>
        <span className="text-[12px] text-muted-foreground">{fillVars(t('receivables.selectedCount'), { n: String(sel.size) })}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { setError(null); preview.mutate(); }} disabled={busy || sel.size === 0}>{preview.isPending ? <Loader2 className="animate-spin" /> : <Eye />} {t('receivables.preview')}</Button>
          {canWrite && <Button variant="outline" size="sm" onClick={() => { setError(null); setInfo(null); print.mutate(); }} disabled={busy || sel.size === 0}>{print.isPending ? <Loader2 className="animate-spin" /> : <Printer />} {t('receivables.printLetters')}</Button>}
          {canWrite && <Button size="sm" onClick={() => { setError(null); setInfo(null); setConfirm(true); }} disabled={busy || sel.size === 0 || mode === 'arrete' || (!live && !testTo)}><Mail /> {t(live ? 'receivables.sendMailLive' : 'receivables.sendMailTest')}</Button>}
        </div>
      </div>
      {info && <p className="rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">{info}</p>}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      {q.isLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : q.isError ? <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(q.error)}</p>
        : rows.length === 0 ? <Empty>{t('receivables.noDunning')}</Empty> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[12px]">
            <thead className="bg-muted"><tr>
              <Th /><Th>{t('receivables.colCode')}</Th><Th>{t('receivables.colClient')}</Th><Th>{t('receivables.colNumber')}</Th><Th>{t('receivables.colDate')}</Th>
              <Th>{t('receivables.colDueDate')}</Th><Th className="text-right">{t('receivables.colAmountDue')}</Th><Th>{t('receivables.colTypeToSend')}</Th>
              <Th>{t('receivables.colLastType')}</Th><Th>{t('receivables.colLastDate')}</Th><Th>{t('receivables.colLastMedia')}</Th><Th>{t('receivables.colEmail')}</Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const code = sendCode === AUTO ? r.next_code : sendCode;
                return (
                  <tr key={r.document_id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5"><input type="checkbox" checked={sel.has(r.document_id)} onChange={() => toggle(r.document_id)} className="size-4 accent-[var(--ducati-red)]" /></td>
                    <td className="px-2 py-1.5 font-mono">{r.contact_code ?? ''}</td>
                    <td className="px-2 py-1.5"><Link to="/clients/$contactId" params={{ contactId: r.contact_id }} className="hover:underline">{r.contact_name}</Link></td>
                    <td className="px-2 py-1.5 font-mono"><Link to="/sales/$documentId" params={{ documentId: r.document_id }} className="hover:underline">{r.number ?? '—'}</Link></td>
                    <td className="px-2 py-1.5">{fmtDate(r.issue_date)}</td>
                    <td className="px-2 py-1.5">{fmtDate(r.due_date)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${r.amount_due > 0 ? 'text-danger' : 'text-info'}`}>{eur(r.amount_due)}</td>
                    <td className="px-2 py-1.5">{code ? `${code} · ${tplMap.get(code)?.label ?? ''}` : '—'}</td>
                    <td className="px-2 py-1.5">{r.last_code ? `${r.last_code} · ${r.last_label ?? ''}` : '—'}</td>
                    <td className="px-2 py-1.5">{r.last_date ? fmtDate(r.last_date) : '—'}</td>
                    <td className="px-2 py-1.5">{r.last_media ? `${t(`receivables.media_${r.last_media}`)}${r.last_is_test ? ` (${t('receivables.testShort')})` : ''}` : '—'}</td>
                    <td className="px-2 py-1.5">{r.email ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="bg-muted font-bold">
              <td colSpan={6} className="px-2 py-2 text-right">{t('receivables.totalDue')}</td>
              <td className="px-2 py-2 text-right tabular-nums">{eur(total)}</td><td colSpan={5} />
            </tr></tfoot>
          </table>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={(o) => { if (!send.isPending) setConfirm(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(live ? 'receivables.sendMailLive' : 'receivables.sendMailTest')}</AlertDialogTitle>
            <AlertDialogDescription>{live ? fillVars(t('receivables.sendConfirmBodyLive'), { n: String(sel.size) }) : fillVars(t('receivables.sendConfirmBody'), { n: String(sel.size), to: testTo ?? '—' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={send.isPending}>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); send.mutate(); }} disabled={send.isPending}>
              {send.isPending ? <Loader2 className="animate-spin" /> : <Mail />} {t(live ? 'receivables.sendMailLiveDo' : 'receivables.sendMailTestDo')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function toDunningRow(r: DunningCandidate) {
  return {
    document_id: r.document_id, number: r.number, issue_date: r.issue_date, due_date: r.due_date, amount_due: r.amount_due,
    contact_id: r.contact_id, contact_name: r.contact_name, email: r.email, next_code: r.next_code,
  };
}
