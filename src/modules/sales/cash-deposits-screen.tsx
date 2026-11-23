/**
 * M6 (POS) — Caisse → Remises en banque (rattrapage G8 du 18/11/2026, PDV009 ; décision Q31 : remise G8
 * ET Z numéroté, sans blocage).
 *
 * « Nouvelle remise » (G8 : Création d'une remise) : mode de règlement, période depuis le dernier report,
 * lignes sélectionnables (report précédent, encaissements, mouvements de caisse, règlements négatifs,
 * écarts d'ouverture / de clôture), montant remis ↔ nouveau fond de caisse, banque, commentaire,
 * « Archiver sans remise », « Générer remise » avec confirmation puis bordereau PDF.
 * « Remises archivées » : consulter, bordereau, commenter, modifier (motif), annuler (motif) ; tout est
 * tracé dans `events` par la base. Avant les migrations du 18/11 : message « disponible après la mise
 * à jour de la base », rien d'autre ne change.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Landmark, Archive, FileDown, Eye, Pencil, Ban, MessageSquarePlus, Info, AlertTriangle, CheckCircle2, XCircle, Calculator } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { StatusBadge } from '@/components/status-badge';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { toast } from 'sonner';
import { listPaymentMethods } from './write-api';
import { getOpenSession } from './cash-api';
import {
  DepositsUnavailable, listBankAccounts, listDepositCandidates, listDeposits, lastActiveDeposit, getDepositLines, listDepositComments,
  addDepositComment, createDeposit, cancelDeposit, amendDeposit, type CashDeposit, type DepositCandidate,
} from './cash-deposit-api';
import { selectionTotal, newFloatFrom, depositedFromNewFloat, depositCheck, effectiveDeposited, type DepositKind } from './cash-deposit-rules';
import { depositSlipJournal, sourceLabel } from './cash-deposit-slip';
import { buildJournalsPdf, formatCell } from './cash-journals-export';
import { localDay, frDay } from './cash-journals';
import { openPdfBytes } from './z-report-pdf';
import { CashCountGrid, countTotal } from './cash-count';
import { CASH_METHOD } from './cash-rounding';
import { NOT_DEPOSITABLE_METHODS } from './cash-close-order';

const eur = (n: number | null | undefined) => (n == null ? '—' : `${formatCell(n, 'money')} €`);
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const today = () => localDay(new Date().toISOString());
const keyOf = (c: Pick<DepositCandidate, 'source_type' | 'source_id'>) => `${c.source_type}:${c.source_id}`;
/** Début de journée locale (Bruxelles) d'un AAAA-MM-JJ, en ISO ; fin = jour suivant exclu → 23:59:59. */
const dayStartIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const dayEndIso = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

export function CashDepositsScreen({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { data: methods } = useQuery({ queryKey: ['pay-methods', companyId], queryFn: () => listPaymentMethods(companyId) });
  const { data: deposits, error } = useQuery({ queryKey: ['cash-deposits', companyId], queryFn: () => listDeposits(companyId), retry: false });
  const methodLabel = (code: string) => methods?.find((m) => m.code === code)?.label ?? code;
  if (error instanceof DepositsUnavailable) {
    return <p className="flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info"><Info className="size-4" /> {t('cashDeposits.unavailable')}</p>;
  }
  return (
    <Tabs defaultValue="new">
      <TabsList>
        <TabsTrigger value="new">{t('cashDeposits.newTab')}</TabsTrigger>
        <TabsTrigger value="archive">{t('cashDeposits.archiveTab')}</TabsTrigger>
      </TabsList>
      <TabsContent value="new" className="mt-4">
        <NewDeposit companyId={companyId} companyName={companyName} methods={(methods ?? []).filter((m) => !NOT_DEPOSITABLE_METHODS.has(m.code))} methodLabel={methodLabel} />
      </TabsContent>
      <TabsContent value="archive" className="mt-4">
        <ArchivedDeposits companyId={companyId} companyName={companyName} deposits={deposits ?? []} methodLabel={methodLabel} />
      </TabsContent>
    </Tabs>
  );
}

/* ================================================================ Nouvelle remise */
function NewDeposit({ companyId, companyName, methods, methodLabel }: {
  companyId: string; companyName: string; methods: { code: string; label: string }[]; methodLabel: (c: string) => string;
}) {
  const qc = useQueryClient();
  const [method, setMethod] = useState(CASH_METHOD);
  const { data: last } = useQuery({ queryKey: ['cash-deposit-last', companyId, method], queryFn: () => lastActiveDeposit(companyId, method), retry: false });
  // Début vide = toutes les lignes non remises (rien ne reste caché dans le tiroir) ; G8 part du dernier report,
  // qui est toujours proposé en première ligne.
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState(today());
  const [depositDate, setDepositDate] = useState(today());
  const [showDeposited, setShowDeposited] = useState(false);
  const [withMovements, setWithMovements] = useState(true);
  const [withNegative, setWithNegative] = useState(true);
  const [withComment, setWithComment] = useState(false);
  const [comment, setComment] = useState('');
  const [bank, setBank] = useState<string>('');
  const fromDay = from ?? '';
  const { data: banks } = useQuery({ queryKey: ['bank-accounts', companyId], queryFn: () => listBankAccounts(companyId) });
  useEffect(() => { if (!bank && banks?.length) setBank(banks[0].code); }, [banks, bank]);
  const { data: session } = useQuery({ queryKey: ['cash-session', companyId], queryFn: () => getOpenSession(companyId) });
  const candidatesKey = ['cash-deposit-candidates', companyId, method, fromDay, to, showDeposited];
  const { data: candidates, isLoading, error } = useQuery({
    queryKey: candidatesKey,
    queryFn: () => listDepositCandidates(companyId, method, fromDay ? dayStartIso(fromDay) : null, dayEndIso(to), showDeposited),
    retry: false,
  });

  // Lignes visibles (G8 : cases « inclure les mouvements de caisse », « afficher les règlements négatifs »).
  const visible = useMemo(() => (candidates ?? []).filter((c) => {
    if (!withMovements && c.source_type === 'movement') return false;
    if (!withNegative && c.source_type === 'payment' && c.amount < 0) return false;
    return true;
  }), [candidates, withMovements, withNegative]);
  const selectable = visible.filter((c) => !c.deposit_id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Nouvelle liste = tout sélectionné (G8 : les lignes de la période sont cochées).
  useEffect(() => { setSelected(new Set(selectable.map(keyOf))); }, [candidates, withMovements, withNegative]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = selectable.filter((c) => selected.has(keyOf(c)));
  const total = selectionTotal(chosen.map((c) => c.amount));
  const report = chosen.filter((c) => c.source_type === 'report').reduce((a, c) => a + c.amount, 0);
  const isCash = method === CASH_METHOD;

  // Montant remis ↔ nouveau fond (G8 : l'un se calcule depuis l'autre).
  const [depositedStr, setDepositedStr] = useState('');
  const [floatStr, setFloatStr] = useState('');
  const deposited = isCash ? num(depositedStr) : total;
  const newFloat = newFloatFrom(method, 'remise', total, deposited);
  useEffect(() => { setDepositedStr(''); setFloatStr(''); }, [method, total]);
  const onDeposited = (v: string) => { setDepositedStr(v); setFloatStr(v.trim() === '' ? '' : String(newFloatFrom(method, 'remise', total, num(v)) ?? '')); };
  const onFloat = (v: string) => { setFloatStr(v); setDepositedStr(v.trim() === '' ? '' : String(depositedFromNewFloat(total, num(v)))); };
  const [countOpen, setCountOpen] = useState(false);
  const [qtys, setQtys] = useState<Record<string, string>>({});

  const [ask, setAsk] = useState<DepositKind | null>(null);
  const check = (k: DepositKind) => depositCheck(method, k, chosen.length, total, deposited);
  const create = useMutation({
    mutationFn: async (kind: DepositKind) => {
      const id = await createDeposit({
        companyId, method, kind, fromISO: fromDay ? dayStartIso(fromDay) : last?.created_at ?? null, toISO: dayEndIso(to), depositDate,
        items: chosen.map((c) => ({ type: c.source_type, id: c.source_id })), deposited: effectiveDeposited(method, kind, total, deposited),
        bankCode: bank || null, comment: withComment ? comment : null,
      });
      return { id, kind };
    },
    onSuccess: async ({ id, kind }) => {
      setAsk(null); setComment(''); setDepositedStr(''); setFloatStr(''); setFrom(null);
      ['cash-deposits', 'cash-deposit-candidates', 'cash-deposit-last', 'cash-drawer-balance', 'cash-mov', 'cash-z', 'cash-count-theoretical']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(t(kind === 'archive' ? 'cashDeposits.archivedOk' : 'cashDeposits.createdOk'));
      if (kind === 'remise') {
        try {
          const all = await listDeposits(companyId, method);
          const d = all.find((x) => x.id === id);
          if (d) openPdfBytes(await buildJournalsPdf([depositSlipJournal(d, await getDepositLines(id), methodLabel(method))], { companyName, period: frDay(d.deposit_date) }));
        } catch (e) { toast.warning(errorMessage(e)); }
      }
    },
  });

  if (error instanceof DepositsUnavailable) return <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('cashDeposits.unavailable')}</p>;
  const openedBeforeToday = session && localDay(session.opened_at) < today();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4">
        <Field label={t('cashDeposits.method')}>
          <Select value={method} onValueChange={(v) => { setMethod(v); setFrom(null); }}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{methods.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('cashDeposits.periodFrom')}><Input type="date" value={fromDay} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
        <Field label={t('cashDeposits.periodTo')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value || today())} className="w-40" /></Field>
        <Field label={t('cashDeposits.depositDate')}><Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value || today())} className="w-40" /></Field>
        <Field label={t('cashDeposits.bank')}>
          <Select value={bank} onValueChange={setBank}>
            <SelectTrigger className="w-64"><SelectValue placeholder={t('cashDeposits.noBank')} /></SelectTrigger>
            <SelectContent>{(banks ?? []).map((b) => <SelectItem key={b.code} value={b.code}>{b.code} - {b.label}{b.iban ? ` (${b.iban})` : ''}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <Check label={t('cashDeposits.showDeposited')} checked={showDeposited} onChange={setShowDeposited} />
          <Check label={t('cashDeposits.withMovements')} checked={withMovements} onChange={setWithMovements} />
          <Check label={t('cashDeposits.withNegative')} checked={withNegative} onChange={setWithNegative} />
          <Check label={t('cashDeposits.withComment')} checked={withComment} onChange={setWithComment} />
        </div>
      </div>

      {last
        ? <p className="font-data text-[12px] text-muted-foreground">{fillVars(t('cashDeposits.lastReport'), { number: last.number, date: frDay(last.deposit_date), amount: eur(last.new_float ?? last.deposited_amount) })}</p>
        : <p className="font-data text-[12px] text-muted-foreground">{t('cashDeposits.noPrevious')}</p>}
      {isCash && session && (
        <p className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">
          <Info className="mt-0.5 size-4 shrink-0" />
          {openedBeforeToday ? fillVars(t('cashDeposits.sessionOpenOld'), { date: new Date(session.opened_at).toLocaleString('fr-BE') }) : t('cashDeposits.sessionOpen')}
        </p>
      )}
      {withComment && <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('cashDeposits.commentHint')} />}

      <div className="overflow-hidden rounded-md border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2 text-[12px]">
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set(selectable.map(keyOf)))}>{t('cashDeposits.selectAll')}</Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>{t('cashDeposits.selectNone')}</Button>
          <span className="ml-auto font-data tabular-nums text-muted-foreground">{fillVars(t('cashDeposits.selectedCount'), { n: chosen.length, total: selectable.length })}</span>
        </div>
        {isLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : (
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr>
              <Th />
              <Th>{t('cashJournals.col.date')}</Th><Th>{t('cashJournals.col.client')}</Th><Th>{t('cashJournals.col.operation')}</Th>
              <Th>{t('cashJournals.col.document')}</Th><Th>{t('cashDeposits.deposit')}</Th><Th className="text-right">{t('cashJournals.col.amount')}</Th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('cashDeposits.nothing')}</td></tr>}
              {visible.map((c) => (
                <tr key={keyOf(c)} className={`border-b border-border last:border-0 ${c.deposit_id ? 'text-muted-foreground' : ''}`}>
                  <td className="w-8 px-3 py-1.5">{!c.deposit_id && <Checkbox checked={selected.has(keyOf(c))} onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(keyOf(c)); else n.delete(keyOf(c)); return n; })} />}</td>
                  <td className="px-3 py-1.5 tabular-nums">{new Date(c.occurred_at).toLocaleString('fr-BE')}</td>
                  <td className="px-3 py-1.5">{c.contact_label ?? ''}</td>
                  <td className="px-3 py-1.5">{c.source_type === 'report' ? <b>{sourceLabel(c)}</b> : sourceLabel(c)}</td>
                  <td className="px-3 py-1.5">{c.document_number ?? ''}</td>
                  <td className="px-3 py-1.5">{c.deposit_number ? fillVars(t('cashDeposits.depositNo'), { number: c.deposit_number }) : ''}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${c.amount < 0 ? 'text-danger' : ''}`}>{eur(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid gap-4 rounded-md border border-border bg-card p-4 md:grid-cols-2">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 font-data text-[13px] tabular-nums">
          {isCash && <><dt className="text-muted-foreground">{t('cashDeposits.lastReportShort')}</dt><dd className="text-right">{eur(report)}</dd></>}
          <dt className="text-muted-foreground">{t(isCash ? 'cashDeposits.totalCash' : 'cashDeposits.totalSelected')}</dt><dd className="text-right font-bold">{eur(total)}</dd>
          {!isCash && <><dt className="text-muted-foreground">{t('cashDeposits.depositedAmount')}</dt><dd className="text-right">{eur(total)}</dd></>}
        </dl>
        {isCash && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('cashDeposits.depositedAmount')}><Input type="number" step="0.01" value={depositedStr} onChange={(e) => onDeposited(e.target.value)} className="w-36 text-right tabular-nums" placeholder="0,00" /></Field>
              <Field label={t('cashDeposits.newFloat')}><Input type="number" step="0.01" value={floatStr === '' && depositedStr === '' ? '' : floatStr} onChange={(e) => onFloat(e.target.value)} className="w-36 text-right tabular-nums" placeholder={eur(newFloat)} /></Field>
              <Button variant="outline" size="sm" onClick={() => setCountOpen((o) => !o)}><Calculator /> {t('cashDeposits.countDrawer')}</Button>
            </div>
            {countOpen && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <CashCountGrid qtys={qtys} onChange={setQtys} />
                <div className="flex flex-wrap items-center justify-end gap-2 font-data text-[13px] tabular-nums">
                  <span>{t('cashCount.totalCash')} : <b>{eur(countTotal(qtys).total)}</b></span>
                  <Button size="sm" variant="outline" onClick={() => onDeposited(String(countTotal(qtys).total))}>{t('cashDeposits.countAsDeposited')}</Button>
                  <Button size="sm" variant="outline" onClick={() => onFloat(String(countTotal(qtys).total))}>{t('cashDeposits.countAsFloat')}</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {(() => {
        const c = check('remise');
        return c !== 'none' && chosen.length > 0 && (isCash ? depositedStr !== '' : true)
          ? <p className="flex items-center gap-2 rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning"><AlertTriangle className="size-4" /> {t(`cashDeposits.check.${c}`)}</p>
          : null;
      })()}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => { create.reset(); setAsk('archive'); }} disabled={create.isPending || check('archive') !== 'none'}><Archive /> {t('cashDeposits.archiveNoDeposit')}</Button>
        <Button onClick={() => { create.reset(); setAsk('remise'); }} disabled={create.isPending || check('remise') !== 'none' || (isCash && depositedStr.trim() === '' && floatStr.trim() === '')}><Landmark /> {t('cashDeposits.generate')}</Button>
      </div>

      <AlertDialog open={ask != null} onOpenChange={(o) => { if (!create.isPending && !o) setAsk(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(ask === 'archive' ? 'cashDeposits.confirmArchiveTitle' : 'cashDeposits.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {ask === 'archive'
                ? fillVars(t('cashDeposits.confirmArchiveBody'), { n: chosen.length, method: methodLabel(method), total: eur(total) })
                : fillVars(t('cashDeposits.confirmBody'), { method: methodLabel(method), bank: banks?.find((b) => b.code === bank)?.label ?? t('cashDeposits.noBank'), date: frDay(depositDate), amount: eur(deposited) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isCash && ask && <p className="font-data text-[13px] tabular-nums">{t('cashDeposits.newFloat')} : <b>{eur(newFloatFrom(method, ask, total, deposited))}</b></p>}
          {create.isError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(create.error)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={create.isPending}>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (ask) create.mutate(ask); }} disabled={create.isPending}>{create.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t('cashDeposits.confirmDo')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ================================================================ Remises archivées */
function ArchivedDeposits({ companyId, companyName, deposits, methodLabel }: {
  companyId: string; companyName: string; deposits: CashDeposit[]; methodLabel: (c: string) => string;
}) {
  const [showArchives, setShowArchives] = useState(true);
  const [method, setMethod] = useState('all');
  const [view, setView] = useState<CashDeposit | null>(null);
  const [edit, setEdit] = useState<CashDeposit | null>(null);
  const [cancel, setCancel] = useState<CashDeposit | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const methodsUsed = [...new Set(deposits.map((d) => d.method))];
  const shown = deposits.filter((d) => (showArchives || d.kind === 'remise') && (method === 'all' || d.method === method));
  const slip = async (d: CashDeposit) => {
    setPdfError(null);
    try { openPdfBytes(await buildJournalsPdf([depositSlipJournal(d, await getDepositLines(d.id), methodLabel(d.method))], { companyName, period: frDay(d.deposit_date) })); }
    catch (e) { setPdfError(errorMessage(e)); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('cashDeposits.method')}>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('cashDeposits.allMethods')}</SelectItem>
              {methodsUsed.map((m) => <SelectItem key={m} value={m}>{methodLabel(m)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Check label={t('cashDeposits.showArchives')} checked={showArchives} onChange={setShowArchives} />
      </div>
      {pdfError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{pdfError}</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>
            <Th>{t('cashJournals.col.number')}</Th><Th>{t('cashJournals.col.method')}</Th><Th>{t('cashJournals.col.date')}</Th><Th>{t('cashJournals.col.kind')}</Th>
            <Th>{t('cashJournals.col.status')}</Th><Th className="text-right">{t('cashJournals.col.lines')}</Th><Th className="text-right">{t('cashJournals.col.deposited')}</Th>
            <Th className="text-right">{t('cashJournals.col.newFloat')}</Th><Th>{t('cashJournals.col.bank')}</Th><Th />
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{t('cashDeposits.noArchive')}</td></tr>}
            {shown.map((d) => (
              <tr key={d.id} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5 font-bold tabular-nums">{d.number}</td>
                <td className="px-3 py-1.5">{methodLabel(d.method)}</td>
                <td className="px-3 py-1.5 tabular-nums">{frDay(d.deposit_date)}</td>
                <td className="px-3 py-1.5">{t(`cashDeposits.kind.${d.kind}`)}</td>
                <td className="px-3 py-1.5">{d.status === 'active'
                  ? <StatusBadge tone="success" icon={CheckCircle2} label={t('cashDeposits.status.active')} />
                  : <StatusBadge tone="danger" icon={XCircle} label={t('cashDeposits.status.annulee')} />}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{d.line_count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{eur(d.deposited_amount)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{eur(d.new_float)}</td>
                <td className="px-3 py-1.5">{d.bank_label ?? ''}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  <Button size="icon" variant="ghost" title={t('cashDeposits.view')} onClick={() => setView(d)}><Eye /></Button>
                  <Button size="icon" variant="ghost" title={t('cashDeposits.slip')} onClick={() => slip(d)}><FileDown /></Button>
                  {d.status === 'active' && <Button size="icon" variant="ghost" title={t('cashDeposits.amend')} onClick={() => setEdit(d)}><Pencil /></Button>}
                  {d.status === 'active' && <Button size="icon" variant="ghost" title={t('cashDeposits.cancel')} onClick={() => setCancel(d)}><Ban /></Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view && <DepositDetail companyId={companyId} deposit={view} methodLabel={methodLabel} onClose={() => setView(null)} />}
      {edit && <AmendDialog companyId={companyId} deposit={edit} onClose={() => setEdit(null)} />}
      {cancel && <CancelDialog deposit={cancel} methodLabel={methodLabel} onClose={() => setCancel(null)} />}
    </div>
  );
}

function DepositDetail({ companyId, deposit, methodLabel, onClose }: { companyId: string; deposit: CashDeposit; methodLabel: (c: string) => string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: lines } = useQuery({ queryKey: ['cash-deposit-lines', deposit.id], queryFn: () => getDepositLines(deposit.id) });
  const { data: comments } = useQuery({ queryKey: ['cash-deposit-comments', deposit.id], queryFn: () => listDepositComments(deposit.id) });
  const [body, setBody] = useState('');
  const add = useMutation({
    mutationFn: () => addDepositComment(companyId, deposit.id, body),
    onSuccess: () => { setBody(''); qc.invalidateQueries({ queryKey: ['cash-deposit-comments', deposit.id] }); },
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{fillVars(t('cashDeposits.slipTitle'), { method: methodLabel(deposit.method), number: deposit.number })}</DialogTitle>
          <DialogDescription>{[frDay(deposit.deposit_date), deposit.bank_label, deposit.bank_iban].filter(Boolean).join(' - ')}</DialogDescription>
        </DialogHeader>
        {deposit.status === 'annulee' && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('cashDeposits.status.annulee')} : {deposit.cancel_reason}</p>}
        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <tbody>
              {(lines ?? []).map((l) => (
                <tr key={l.id} className={`border-b border-border last:border-0 ${l.active ? '' : 'text-muted-foreground line-through'}`}>
                  <td className="px-3 py-1.5 tabular-nums">{new Date(l.occurred_at).toLocaleString('fr-BE')}</td>
                  <td className="px-3 py-1.5">{l.contact_label ?? ''}</td>
                  <td className="px-3 py-1.5">{sourceLabel(l)}</td>
                  <td className="px-3 py-1.5">{l.document_number ?? ''}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{eur(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 font-data text-[13px] tabular-nums">
          <dt className="text-muted-foreground">{t('cashDeposits.totalReceipts')}</dt><dd className="text-right">{eur(deposit.lines_total)}</dd>
          <dt className="text-muted-foreground">{t('cashDeposits.depositedAmount')}</dt><dd className="text-right">{eur(deposit.deposited_amount)}</dd>
          {deposit.new_float != null && <><dt className="text-muted-foreground">{t('cashDeposits.carriedAmount')}</dt><dd className="text-right">{eur(deposit.new_float)}</dd></>}
        </dl>
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('cashDeposits.comments')}</p>
          {deposit.comment && <p className="text-[13px]">{deposit.comment}</p>}
          {(comments ?? []).map((c) => <p key={c.id} className="text-[13px]"><span className="font-data text-muted-foreground">{new Date(c.created_at).toLocaleString('fr-BE')} - </span>{c.body}</p>)}
          <div className="flex gap-2">
            <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('cashDeposits.commentHint')} />
            <Button variant="outline" onClick={() => add.mutate()} disabled={!body.trim() || add.isPending}><MessageSquarePlus /> {t('cashDeposits.addComment')}</Button>
          </div>
          {add.isError && <p className="text-[12px] text-danger">{errorMessage(add.error)}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('cash.done')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AmendDialog({ companyId, deposit, onClose }: { companyId: string; deposit: CashDeposit; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: banks } = useQuery({ queryKey: ['bank-accounts', companyId], queryFn: () => listBankAccounts(companyId) });
  const [amount, setAmount] = useState(String(deposit.deposited_amount));
  const [date, setDate] = useState(deposit.deposit_date);
  const [bank, setBank] = useState(deposit.bank_code ?? '');
  const [reason, setReason] = useState('');
  const editAmount = deposit.method === CASH_METHOD && deposit.kind === 'remise';
  const save = useMutation({
    mutationFn: () => amendDeposit(deposit.id, { deposited: editAmount ? num(amount) : deposit.deposited_amount, depositDate: date, bankCode: bank || null, reason }),
    onSuccess: () => { ['cash-deposits', 'cash-deposit-candidates', 'cash-drawer-balance', 'cash-mov', 'cash-z'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('cashDeposits.amendedOk')); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fillVars(t('cashDeposits.amendTitle'), { number: deposit.number })}</DialogTitle>
          <DialogDescription>{t('cashDeposits.amendHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {editAmount && <Field label={t('cashDeposits.depositedAmount')}><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tabular-nums" /></Field>}
          {editAmount && <p className="font-data text-[12px] tabular-nums text-muted-foreground">{t('cashDeposits.newFloat')} : {eur(Math.round((deposit.lines_total - num(amount)) * 100) / 100)}</p>}
          <Field label={t('cashDeposits.depositDate')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t('cashDeposits.bank')}>
            <Select value={bank} onValueChange={setBank}>
              <SelectTrigger><SelectValue placeholder={t('cashDeposits.noBank')} /></SelectTrigger>
              <SelectContent>{(banks ?? []).map((b) => <SelectItem key={b.code} value={b.code}>{b.code} - {b.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={t('cashDeposits.reason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('cashDeposits.reasonHint')} /></Field>
        </div>
        {save.isError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(save.error)}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !reason.trim()}>{save.isPending ? <Loader2 className="animate-spin" /> : <Pencil />} {t('cashDeposits.amendDo')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ deposit, methodLabel, onClose }: { deposit: CashDeposit; methodLabel: (c: string) => string; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: () => cancelDeposit(deposit.id, reason),
    onSuccess: () => { ['cash-deposits', 'cash-deposit-candidates', 'cash-deposit-last', 'cash-drawer-balance', 'cash-mov', 'cash-z'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(t('cashDeposits.cancelledOk')); onClose(); },
  });
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !run.isPending) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-warning" /> {fillVars(t('cashDeposits.cancelTitle'), { number: deposit.number, method: methodLabel(deposit.method) })}</AlertDialogTitle>
          <AlertDialogDescription>{t('cashDeposits.cancelBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field label={t('cashDeposits.reason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('cashDeposits.reasonHint')} /></Field>
        {run.isError && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{errorMessage(run.error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={run.isPending}>{t('action.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); run.mutate(); }} disabled={run.isPending || !reason.trim()}>{run.isPending ? <Loader2 className="animate-spin" /> : <Ban />} {t('cashDeposits.cancelDo')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ================================================================ petits composants */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>{children}</div>;
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} /> {label}</label>;
}
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
