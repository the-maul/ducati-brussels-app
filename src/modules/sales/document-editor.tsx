/**
 * M6 — Éditeur de document de vente (FAC / DEV devis-proforma / BC bon de commande / RES / BL / TIK).
 * Opérateur = utilisateur connecté, écrit par le serveur à la création (trg_documents_operator).
 * En-tête (type, client, dates) + lignes (article ou texte libre) + pied de facture
 * (mode HT/TTC, détaxe export, remise globale, frais de port, net TTC forcé) + totaux
 * + brouillon/validation. Tout libellé via i18n (CLAUDE.md règle 10).
 * Devis atelier (mission 02) : frais de devis accident (fixe) ou diagnostic (tarif horaire,
 * plafonné) posés en ligne dédiée, sans doublon — voir modules/workshop/quote-fees.ts.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Plus, Trash2, Search, X, Save, CheckCircle2, Wrench, Repeat, Clock, Type, Minus, MessageSquareText } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listContacts, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { createDocument, computeTotals, searchSaleArticles, searchLabourArticles, lineHasAmount, type LineInput, type LineType, type SaleArticle, type PiedInput } from './write-api';
import { listCommentTemplates } from './comment-templates-api';
import { effectiveSaleHt, useRoundSalePrices } from '@/lib/pricing';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { buildQuoteFeeLine, applyQuoteFee, clampDiagnosticHours, quoteFeeDesignation, type QuoteFeeKind } from '@/modules/workshop/quote-fees';
import { loadQuoteFeeParams } from '@/modules/workshop/quote-fees-api';
import { saleStockStatus } from './availability';
import { SaleStockBadge } from './availability-badge';
import { ReplacementHint } from './replacement-hint';
import { StatusBadge } from '@/components/status-badge';
import { EcatalogPasteButton, EcatalogLink, type EcatalogPick } from './ecatalog-paste';
import { looksLikeDucatiReference } from './ecatalog';

const DOC_TYPES = ['DEV', 'BC', 'RES', 'BL', 'FAC', 'TIK'] as const;
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

type EditLine = LineInput & { _key: string; _fee?: QuoteFeeKind | null; _stock?: SaleArticle | null; _catalogUrl?: string | null };
let counter = 0;
const blankLine = (type: LineType = 'article', designation = ''): EditLine => ({
  _key: `l${counter++}`, article_id: null, designation, quantity: type === 'texte' || type === 'vide' ? 0 : 1,
  unit_price_ht: 0, vat_rate: 21, discount_pct: 0, line_type: type,
});

export function DocumentEditor({ companyId, initialContactId, initialVehicleId, workshopOrNumber, workshop }: {
  companyId: string; initialContactId?: string; initialVehicleId?: string; workshopOrNumber?: string; workshop?: boolean;
}) {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const operatorName = profile?.full_name?.trim() || profile?.email || user?.email || '';
  const roundUp = useRoundSalePrices(companyId);
  const [docType, setDocType] = useState<string>(workshop ? 'DEV' : 'FAC');
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

  // Devis atelier : frais de devis (accident fixe / diagnostic au tarif horaire plafonné)
  const [workshopQuote, setWorkshopQuote] = useState(!!workshop);
  const [feeKind, setFeeKind] = useState<QuoteFeeKind>('diagnostic');
  const [feeHours, setFeeHours] = useState('');
  const { data: feeParams } = useQuery({ queryKey: ['quote-fee-params', companyId], queryFn: () => loadQuoteFeeParams(companyId), enabled: workshopQuote });
  const addQuoteFee = () => {
    if (!feeParams) return;
    const hours = feeHours.trim() ? num(feeHours) : feeParams.diagnosticMaxHours;
    const fee: EditLine = { ...buildQuoteFeeLine(feeKind, feeParams, hours), _key: `l${counter++}`, _fee: feeKind };
    setLines((ls) => applyQuoteFee(ls, fee));
    if (feeKind === 'diagnostic') setFeeHours(String(fee.quantity));
  };
  const toggleWorkshopQuote = (on: boolean) => {
    setWorkshopQuote(on);
    if (!on) setLines((ls) => { const kept = ls.filter((l) => !l._fee); return kept.length ? kept : [blankLine()]; });
  };
  // Quantité d'une ligne de frais : accident figé à 1 ; diagnostic modifiable vers le bas seulement.
  const setFeeQty = (l: EditLine, v: number) => {
    if (l._fee !== 'diagnostic' || !feeParams) return;
    const h = clampDiagnosticHours(v, feeParams.diagnosticMaxHours);
    setLine(l._key, { quantity: h, designation: quoteFeeDesignation('diagnostic', h) });
    setFeeHours(String(h));
  };

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
  // Article posé sur une ligne (recherche, remplacement par la dernière référence, équivalent).
  // Un article de type T devient une ligne « main d'œuvre » (quantité en heures, sans stock).
  const pickArticle = (key: string, a: SaleArticle) => setLine(key, {
    article_id: a.id, designation: a.designation, reference: a.reference,
    unit_price_ht: effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp), vat_rate: a.vat_rate, _stock: a,
    line_type: a.mgmt_type === 'T' ? 'main_oeuvre' : 'article', _catalogUrl: null,
  });
  const addLine = (type: LineType, designation = '') => setLines((ls) => [...ls, blankLine(type, designation)]);
  // Article collé depuis l'e-catalog (carte 4) : remplit la dernière ligne article vide, sinon en ajoute une.
  const addEcatalogLine = ({ article: a, catalogUrl, unitPriceHt }: EcatalogPick) => setLines((ls) => {
    const last = ls[ls.length - 1];
    const reuse = last && last.line_type === 'article' && !last.article_id && !last._fee && !last.designation.trim();
    const base = reuse ? last : blankLine();
    const line: EditLine = {
      ...base, article_id: a.id, designation: a.designation, reference: a.reference,
      unit_price_ht: unitPriceHt ?? effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp), vat_rate: a.vat_rate, _stock: a,
      line_type: a.mgmt_type === 'T' ? 'main_oeuvre' : 'article', _catalogUrl: catalogUrl,
    };
    return reuse ? [...ls.slice(0, -1), line] : [...ls, line];
  });
  const [recallOpen, setRecallOpen] = useState(false);
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l._key !== key) : ls));

  const pied: PiedInput = {
    priceMode, taxExempt,
    globalDiscountPct: num(discountPct), globalDiscountAmount: num(discountAmount),
    shippingHt: num(shippingHt), shippingTaxed, shippingVatRate: 21,
    forcedTtc: forcedTtc.trim() ? num(forcedTtc) : null,
  };
  const totals = computeTotals(lines.map(({ _key, _fee, _stock, _catalogUrl, ...l }) => l), pied);

  const save = async (status: 'brouillon' | 'validee') => {
    setBusy(true); setError(null);
    try {
      // Une ligne vide est gardée telle quelle (séparation) ; les autres doivent avoir un libellé.
      const payload = lines.filter((l) => l.line_type === 'vide' || l.designation.trim()).map(({ _key, _fee, _stock, _catalogUrl, ...l }) => l);
      if (!payload.some((l) => l.line_type !== 'vide')) { setError(t('sales.needLine')); setBusy(false); return; }
      const notes = workshopQuote ? [t('sales.workshopQuote'), workshopOrNumber ? `OR ${workshopOrNumber}` : ''].filter(Boolean).join(' — ') : null;
      const id = await createDocument({
        companyId, docType, contactId: contact?.id ?? null, vehicleId: initialVehicleId ?? null, issueDate, dueDate: dueDate || null,
        status, notes, lines: payload, pied,
      });
      navigate({ to: '/sales/$documentId', params: { documentId: id } });
    } catch (e) { setError(e instanceof Error ? e.message : t('sales.errSave')); setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-5">
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
        <Field label={t('sales.operator')}>
          <Input value={operatorName} readOnly disabled title={t('sales.operatorAuto')} />
        </Field>
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
              <Th className="w-36">{t('availability.colDispo')}</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const del = <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" onClick={() => removeLine(l._key)}><Trash2 className="size-4 text-danger" /></Button></td>;
              if (l.line_type === 'vide') return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td colSpan={7} className="px-3 py-2 text-[12px] italic text-muted-foreground"><Minus className="mr-1 inline size-3.5" />{t('sales.blankLine')}</td>
                  {del}
                </tr>
              );
              if (l.line_type === 'texte') return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td colSpan={7} className="px-2 py-1">
                    <Textarea rows={Math.min(6, Math.max(2, l.designation.split('\n').length))} value={l.designation}
                      placeholder={t('sales.textPlaceholder')} onChange={(e) => setLine(l._key, { designation: e.target.value })} className="min-h-0 text-[13px]" />
                  </td>
                  {del}
                </tr>
              );
              const labour = l.line_type === 'main_oeuvre';
              const ht = lineHasAmount(l) ? l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100) : 0;
              const vatFactor = 1 + (taxExempt ? 0 : l.vat_rate || 0) / 100;
              const shownPrice = priceMode === 'ttc' ? r2(l.unit_price_ht * vatFactor) : l.unit_price_ht;
              const onPrice = (v: number) => setLine(l._key, { unit_price_ht: priceMode === 'ttc' ? r2(v / vatFactor) : v });
              return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td className="px-2 py-1">
                    {l._fee ? (
                      <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-muted px-3 text-sm">
                        <Wrench className="size-3.5 text-muted-foreground" /><span className="truncate font-medium">{l.designation}</span>
                      </div>
                    ) : l.article_id ? (
                      <>
                        <Input value={l.designation} onChange={(e) => setLine(l._key, { designation: e.target.value })} className="h-8" />
                        {l._stock && <ReplacementHint companyId={companyId} article={l._stock} onReplace={(a) => pickArticle(l._key, a)} />}
                        {(l._catalogUrl || looksLikeDucatiReference(l.reference)) && <EcatalogLink reference={l.reference} catalogUrl={l._catalogUrl} />}
                      </>
                    ) : labour ? (
                      <LabourPicker companyId={companyId} value={l.designation}
                        onText={(v) => setLine(l._key, { designation: v })}
                        onPick={(a) => pickArticle(l._key, a)} />
                    ) : (
                      <LinePicker companyId={companyId} value={l.designation}
                        onText={(v) => setLine(l._key, { designation: v })}
                        onPick={(a) => pickArticle(l._key, a)} />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {l._fee ? (
                      <Input type="number" step="0.25" min={0} max={feeParams?.diagnosticMaxHours} value={String(l.quantity)} disabled={l._fee === 'accident'}
                        onChange={(e) => setFeeQty(l, num(e.target.value))} title={l._fee === 'diagnostic' ? t('sales.feeHoursHint') : undefined} className="h-8 text-right tabular-nums" />
                    ) : labour ? (
                      <div className="flex items-center gap-1">
                        <Input type="number" step="0.25" min={0} value={String(l.quantity)} onChange={(e) => setLine(l._key, { quantity: num(e.target.value) })} className="h-8 text-right tabular-nums" />
                        <span className="text-[12px] text-muted-foreground">{t('sales.hoursUnit')}</span>
                      </div>
                    ) : (
                      <Input type="number" step="0.001" value={String(l.quantity)} onChange={(e) => setLine(l._key, { quantity: num(e.target.value) })} className="h-8 text-right tabular-nums" />
                    )}
                  </td>
                  <td className="px-2 py-1"><Input type="number" step="0.01" value={String(shownPrice)} onChange={(e) => onPrice(num(e.target.value))} disabled={!!l._fee} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.vat_rate)} onChange={(e) => setLine(l._key, { vat_rate: num(e.target.value) })} disabled={taxExempt} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.discount_pct)} onChange={(e) => setLine(l._key, { discount_pct: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-3 py-1 text-right tabular-nums">{eur(ht)}</td>
                  <td className="px-2 py-1">{labour
                    ? <StatusBadge tone="neutral" icon={Clock} label={t('sales.lineType_main_oeuvre')} />
                    : l._stock && <SaleStockBadge status={saleStockStatus(l._stock, l.quantity)} free={l._stock.real_qty - l._stock.reserved_qty} />}</td>
                  {del}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => addLine('article')}><Plus /> {t('sales.addLine')}</Button>
        <Button type="button" variant="outline" onClick={() => addLine('main_oeuvre')}><Clock /> {t('sales.addLabour')}</Button>
        <Button type="button" variant="outline" onClick={() => addLine('texte')}><Type /> {t('sales.addText')}</Button>
        <Button type="button" variant="outline" onClick={() => addLine('vide')}><Minus /> {t('sales.addBlank')}</Button>
        <Button type="button" variant="outline" onClick={() => setRecallOpen(true)}><MessageSquareText /> {t('sales.recallComment')}</Button>
        <EcatalogPasteButton companyId={companyId} priceMode={priceMode} onPick={addEcatalogLine} />
      </div>
      {recallOpen && <RecallCommentDialog companyId={companyId} onClose={() => setRecallOpen(false)} onPick={(body) => { addLine('texte', body); setRecallOpen(false); }} />}

      {/* Devis atelier : frais de devis */}
      {(docType === 'DEV' || workshopQuote) && (
        <div className="space-y-3 rounded-md border border-border bg-card p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={workshopQuote} onChange={(e) => toggleWorkshopQuote(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
            {t('sales.workshopQuote')}
            {workshopOrNumber && <span className="text-muted-foreground">· OR {workshopOrNumber}</span>}
          </label>
          {workshopQuote && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t('sales.feeKind')}>
                  <Select value={feeKind} onValueChange={(v) => setFeeKind(v as QuoteFeeKind)}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accident">{t('sales.fee_accident')}</SelectItem>
                      <SelectItem value="diagnostic">{t('sales.fee_diagnostic')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {feeKind === 'diagnostic' && (
                  <Field label={t('sales.feeHours')}>
                    <Input type="number" step="0.25" min={0} max={feeParams?.diagnosticMaxHours} value={feeHours}
                      placeholder={feeParams ? String(feeParams.diagnosticMaxHours) : ''}
                      onChange={(e) => setFeeHours(e.target.value)}
                      onBlur={() => { if (feeParams && feeHours.trim()) setFeeHours(String(clampDiagnosticHours(num(feeHours), feeParams.diagnosticMaxHours))); }}
                      className="w-28 text-right tabular-nums" />
                  </Field>
                )}
                <Button type="button" variant="outline" onClick={addQuoteFee} disabled={!feeParams}>
                  <Wrench /> {lines.some((l) => l._fee) ? t('sales.feeReplace') : t('sales.feeAdd')}
                </Button>
              </div>
              {feeParams && (
                <p className="text-[12px] text-muted-foreground">
                  {t('sales.feeRule')
                    .replace('{accident}', eur(feeParams.accidentAmountHt))
                    .replace('{rate}', eur(feeParams.hourlyRateHt))
                    .replace('{max}', String(feeParams.diagnosticMaxHours).replace('.', ','))}
                </p>
              )}
              {feeParams && feeKind === 'diagnostic' && feeParams.hourlyRateHt <= 0 && (
                <p className="rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning">{t('sales.feeNoRate')}</p>
              )}
            </>
          )}
        </div>
      )}

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
  const roundUp = useRoundSalePrices(companyId);
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(value.trim()), 250); return () => clearTimeout(id); }, [value]);
  const { data } = useQuery({ queryKey: ['sale-art', companyId, deb], queryFn: () => searchSaleArticles(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Input value={value} onChange={(e) => onText(e.target.value)} placeholder={t('sales.lineArticleOrText')} className="h-8" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => onPick(a)}
              title={t('availability.stockHint').replace('{free}', String(a.real_qty - a.reserved_qty)).replace('{real}', String(a.real_qty)).replace('{reserved}', String(a.reserved_qty)).replace('{order}', String(a.on_order_qty))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {a.superseded_by_id && <StatusBadge tone="warning" icon={Repeat} label={t('sales.replacedBadge')} />}
                <SaleStockBadge status={saleStockStatus(a)} free={a.real_qty - a.reserved_qty} />
                <span className="tabular-nums text-muted-foreground">{eur(effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp))}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ligne main-d'œuvre : articles de type T (liste complète à l'ouverture, filtrée à la frappe). */
function LabourPicker({ companyId, value, onText, onPick }: { companyId: string; value: string; onText: (v: string) => void; onPick: (a: SaleArticle) => void }) {
  const roundUp = useRoundSalePrices(companyId);
  const [open, setOpen] = useState(false);
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(value.trim()), 250); return () => clearTimeout(id); }, [value]);
  const { data, isFetched } = useQuery({ queryKey: ['sale-labour', companyId, deb], queryFn: () => searchLabourArticles(companyId, deb), enabled: open });
  return (
    <div className="relative">
      <Clock className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => onText(e.target.value)} placeholder={t('sales.labourPlaceholder')} className="h-8 pl-8" />
      {open && isFetched && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {(data ?? []).length === 0 && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('sales.labourNone')}</p>}
          {(data ?? []).map((a) => (
            <button key={a.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(a); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{eur(effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp))} / {t('sales.hoursUnit')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** « Rappeler un commentaire » : insère le texte d'un commentaire type en ligne texte (modifiable ensuite). */
function RecallCommentDialog({ companyId, onClose, onPick }: { companyId: string; onClose: () => void; onPick: (body: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['comment-templates', companyId, 'active'], queryFn: () => listCommentTemplates(companyId, true) });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sales.recallTitle')}</DialogTitle>
          <DialogDescription>{t('sales.recallHint')}</DialogDescription>
        </DialogHeader>
        {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {!isLoading && (data ?? []).length === 0 && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('sales.recallEmpty')}</p>}
        <div className="max-h-80 space-y-2 overflow-auto">
          {(data ?? []).map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c.body)}
              className="block w-full rounded-md border border-border px-3 py-2 text-left hover:bg-accent">
              <span className="block text-sm font-bold">{c.name}</span>
              <span className="block whitespace-pre-wrap text-[12px] text-muted-foreground">{c.body}</span>
            </button>
          ))}
        </div>
        <Link to="/settings/comments" className="text-[12px] text-info underline">{t('sales.recallManage')}</Link>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
