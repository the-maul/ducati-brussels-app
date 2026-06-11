/**
 * M6 — Éditeur de document de vente (FAC/DEV/TIK/BL).
 * En-tête (type, client, dates) + lignes (article ou texte libre) + pied de facture
 * (mode HT/TTC, détaxe export, remise globale, frais de port, net TTC forcé) + totaux
 * + brouillon/validation. Tout libellé via i18n (CLAUDE.md règle 10).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Plus, Trash2, Search, X, Save, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listContacts, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { createDocument, computeTotals, searchSaleArticles, type LineInput, type SaleArticle, type PiedInput } from './write-api';
import { t } from '@/lib/i18n';

const DOC_TYPES = ['FAC', 'DEV', 'TIK', 'BL'] as const;
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

type EditLine = LineInput & { _key: string };
let counter = 0;
const blankLine = (): EditLine => ({ _key: `l${counter++}`, article_id: null, designation: '', quantity: 1, unit_price_ht: 0, vat_rate: 21, discount_pct: 0 });

export function DocumentEditor({ companyId, initialContactId }: { companyId: string; initialContactId?: string }) {
  const navigate = useNavigate();
  const [docType, setDocType] = useState<string>('FAC');
  const [contact, setContact] = useState<Contact | null>(null);
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pied de facture
  const [priceMode, setPriceMode] = useState<'ht' | 'ttc'>('ttc');
  const [taxExempt, setTaxExempt] = useState(false);
  const [discountPct, setDiscountPct] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [shippingHt, setShippingHt] = useState('');
  const [shippingTaxed, setShippingTaxed] = useState(true);
  const [forcedTtc, setForcedTtc] = useState('');

  // La détaxe n'est valable qu'en mode HT (G8 p.54) : on la coupe si on repasse en TTC.
  useEffect(() => { if (priceMode !== 'ht' && taxExempt) setTaxExempt(false); }, [priceMode, taxExempt]);

  // précharge le client si fourni
  const { data: preContact } = useQuery({
    queryKey: ['contact-pre', initialContactId],
    queryFn: async () => (initialContactId ? (await listContacts(companyId, '')).find((c) => c.id === initialContactId) ?? null : null),
    enabled: !!initialContactId,
  });
  useEffect(() => { if (preContact) setContact(preContact); }, [preContact]);

  const setLine = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l._key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l._key !== key) : ls));

  const pied: PiedInput = {
    priceMode, taxExempt,
    globalDiscountPct: num(discountPct), globalDiscountAmount: num(discountAmount),
    shippingHt: num(shippingHt), shippingTaxed, shippingVatRate: 21,
    forcedTtc: forcedTtc.trim() ? num(forcedTtc) : null,
  };
  const totals = computeTotals(lines.map(({ _key, ...l }) => l), pied);

  const save = async (status: 'brouillon' | 'validee') => {
    setBusy(true); setError(null);
    try {
      const payload = lines.filter((l) => l.designation.trim()).map(({ _key, ...l }) => l);
      if (payload.length === 0) { setError(t('sales.needLine')); setBusy(false); return; }
      const id = await createDocument({
        companyId, docType, contactId: contact?.id ?? null, issueDate, dueDate: dueDate || null, status, lines: payload, pied,
      });
      navigate({ to: '/sales/$documentId', params: { documentId: id } });
    } catch (e) { setError(e instanceof Error ? e.message : t('sales.errSave')); setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-4">
        <Field label={t('sales.type')}>
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DOC_TYPES.map((d) => <SelectItem key={d} value={d}>{t(`sales.type_${d}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('sales.client')}>
          {contact ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <span className="truncate">{contactDisplayName(contact)}</span>
              <button type="button" onClick={() => setContact(null)} className="ml-auto text-muted-foreground hover:text-danger"><X className="size-4" /></button>
            </div>
          ) : <ContactPicker companyId={companyId} onPick={setContact} />}
        </Field>
        <Field label={t('sales.date')}><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
        <Field label={t('sales.dueDate')}><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </div>

      {/* Lignes */}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('sales.colDesignation')}</Th>
              <Th className="w-20 text-right">{t('sales.colQty')}</Th>
              <Th className="w-28 text-right">{priceMode === 'ttc' ? t('sales.colPuTtc') : t('sales.colPuHt')}</Th>
              <Th className="w-16 text-right">{t('sales.colVat')}</Th>
              <Th className="w-20 text-right">{t('sales.colDiscount')}</Th>
              <Th className="w-28 text-right">{t('sales.colLineHt')}</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const ht = l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100);
              const vatFactor = 1 + (taxExempt ? 0 : l.vat_rate || 0) / 100;
              const shownPrice = priceMode === 'ttc' ? r2(l.unit_price_ht * vatFactor) : l.unit_price_ht;
              const onPrice = (v: number) => setLine(l._key, { unit_price_ht: priceMode === 'ttc' ? r2(v / vatFactor) : v });
              return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td className="px-2 py-1">
                    {l.article_id ? (
                      <Input value={l.designation} onChange={(e) => setLine(l._key, { designation: e.target.value })} className="h-8" />
                    ) : (
                      <LinePicker companyId={companyId} value={l.designation}
                        onText={(v) => setLine(l._key, { designation: v })}
                        onPick={(a) => setLine(l._key, { article_id: a.id, designation: a.designation, unit_price_ht: a.sale_price_ht, vat_rate: a.vat_rate })} />
                    )}
                  </td>
                  <td className="px-2 py-1"><Input type="number" step="0.001" value={String(l.quantity)} onChange={(e) => setLine(l._key, { quantity: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.01" value={String(shownPrice)} onChange={(e) => onPrice(num(e.target.value))} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.vat_rate)} onChange={(e) => setLine(l._key, { vat_rate: num(e.target.value) })} disabled={taxExempt} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.discount_pct)} onChange={(e) => setLine(l._key, { discount_pct: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-3 py-1 text-right tabular-nums">{eur(ht)}</td>
                  <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" onClick={() => removeLine(l._key)}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus /> {t('sales.addLine')}</Button>

      {/* Pied de facture + totaux */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-3 rounded-md border border-border bg-card p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('sales.pied')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('sales.priceMode')}>
              <Select value={priceMode} onValueChange={(v) => setPriceMode(v as 'ht' | 'ttc')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ttc">{t('sales.mode_ttc')}</SelectItem>
                  <SelectItem value="ht">{t('sales.mode_ht')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('sales.taxExempt')}>
              <label className={`flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm ${priceMode !== 'ht' ? 'opacity-50' : ''}`}>
                <input type="checkbox" checked={taxExempt} disabled={priceMode !== 'ht'} onChange={(e) => setTaxExempt(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
                <span className="truncate text-[12px] text-muted-foreground">{t('sales.taxExemptHint')}</span>
              </label>
            </Field>
            <Field label={t('sales.discountPct')}><Input type="number" step="0.1" value={discountPct} onChange={(e) => { setDiscountPct(e.target.value); if (e.target.value.trim()) setDiscountAmount(''); }} className="text-right tabular-nums" placeholder="0" /></Field>
            <Field label={t('sales.discountAmount')}><Input type="number" step="0.01" value={discountAmount} onChange={(e) => { setDiscountAmount(e.target.value); if (e.target.value.trim()) setDiscountPct(''); }} className="text-right tabular-nums" placeholder="0,00" /></Field>
            <Field label={t('sales.shippingHt')}><Input type="number" step="0.01" value={shippingHt} onChange={(e) => setShippingHt(e.target.value)} className="text-right tabular-nums" placeholder="0,00" /></Field>
            <Field label={taxExempt ? t('sales.shippingUntaxed') : t('sales.shippingTaxed')}>
              <label className={`flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm ${taxExempt ? 'opacity-50' : ''}`}>
                <input type="checkbox" checked={shippingTaxed && !taxExempt} disabled={taxExempt} onChange={(e) => setShippingTaxed(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
                <span className="text-[12px] text-muted-foreground">{t('sales.shippingTaxed')}</span>
              </label>
            </Field>
            <Field label={t('sales.forcedTtc')}><Input type="number" step="0.01" value={forcedTtc} onChange={(e) => setForcedTtc(e.target.value)} className="text-right tabular-nums" placeholder={t('sales.forcedTtcHint')} /></Field>
          </div>
          {taxExempt && <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('sales.taxExemptMention')}</p>}
        </div>

        {/* Totaux */}
        <div className="flex flex-col justify-end gap-1 rounded-md border border-border bg-card p-4 font-data text-sm tabular-nums">
          {totals.global_discount > 0 && <Row label={t('sales.totalDiscount')} value={`− ${eur(totals.global_discount)}`} muted />}
          {num(shippingHt) > 0 && <Row label={t('sales.totalShipping')} value={eur(num(shippingHt))} muted />}
          <Row label={t('sales.totalHt')} value={eur(totals.total_ht)} strong />
          <Row label={t('sales.totalVat')} value={eur(totals.total_vat)} muted />
          <div className="my-1 border-t border-border" />
          <Row label={t('sales.totalTtc')} value={eur(totals.total_ttc)} big />
        </div>
      </div>

      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => save('brouillon')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t('sales.draft')}</Button>
        <Button onClick={() => save('validee')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t('sales.validate')}</Button>
      </div>
    </div>
  );
}

function Row({ label, value, muted, strong, big }: { label: string; value: string; muted?: boolean; strong?: boolean; big?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-6 ${big ? 'text-base' : ''} ${muted ? 'text-muted-foreground' : ''}`}>
      <span>{label}</span><span>{strong || big ? <b>{value}</b> : value}</span>
    </div>
  );
}

/* ---------------- Pickers ---------------- */
function ContactPicker({ companyId, onPick }: { companyId: string; onPick: (c: Contact) => void }) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['contact-pick', companyId, deb], queryFn: () => listContacts(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('sales.clientPlaceholder')} className="h-9 pl-9" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.slice(0, 8).map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c)} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent">{contactDisplayName(c)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function LinePicker({ companyId, value, onText, onPick }: { companyId: string; value: string; onText: (v: string) => void; onPick: (a: SaleArticle) => void }) {
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(value.trim()), 250); return () => clearTimeout(id); }, [value]);
  const { data } = useQuery({ queryKey: ['sale-art', companyId, deb], queryFn: () => searchSaleArticles(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Input value={value} onChange={(e) => onText(e.target.value)} placeholder={t('sales.lineArticleOrText')} className="h-8" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span><span className="ml-auto tabular-nums text-muted-foreground">{eur(a.sale_price_ht)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
