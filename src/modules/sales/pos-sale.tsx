/**
 * M6 (POS) — Vente comptoir (Express) : scan/recherche d'articles → panier →
 * encaissement → ticket. Crée un TIK validé (stock réel débité) puis encaissement
 * via le panneau de règlement, et impression du ticket.
 * Audit caisse du 03/11/2026 (PDV000) : plus de ticket à 0 € ; le scan n'ajoute un article que
 * s'il est seul à correspondre ; « Nouvelle vente » prévient quand le ticket n'est pas réglé
 * (le ticket reste dû, il s'annule par un avoir depuis sa fiche).
 * Caisse conforme au droit belge (PDV010, 03/11/2026) :
 *  - pas de vente caisse fermée : message et bouton « Ouvrir la caisse » ; le ticket se rattache
 *    à la session ouverte (en base) ;
 *  - facture obligatoire (AR n° 1 art. 1er § 2) pour une moto, et au-delà de 125 € TTC pour une
 *    pièce / un accessoire / une prestation du véhicule (famille réglable, Paramètres → Tables) :
 *    la caisse exige un client et produit une facture FAC ;
 *  - ticket par e-mail sans client (adresse saisie, non enregistrée).
 * Ecran client sur tablette (PDV020, 03/11/2026) : le ticket s'affiche en direct pendant la saisie,
 * puis le montant à payer, « Payez sur le terminal » si carte, la signature si demandée, le merci
 * (avec l'adresse e-mail tapée par le client si on l'autorise) ; envoi automatique (parcours testé
 * dans customer-screen.ts, `nextSaleFlow`).
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Search, ScanLine, CreditCard, Printer, RotateCcw, FileText, AlertTriangle, Mail, Wallet, X, Receipt } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  createDocument, computeTotals, searchSaleArticles, getDocumentFull, listPayments, documentValidationMessage,
  listInvoiceFamilyRules, invoiceRequiredMessage, type SaleArticle,
} from './write-api';
import { posCartError, posTicketLines, scanAutoPick, ticketRemaining, localIsoDate, invoiceRequired, posSessionError } from './pos-rules';
import { getOpenSession, type CashSession } from './cash-api';
import { PaymentPanel } from './payment-panel';
import { printDocument } from './print-document';
import { ContactPicker } from './document-editor';
import { DocumentMailDialog } from './document-mail-dialog';
import { contactDisplayName, type Contact } from '@/modules/contacts/api';
import { contactLocale } from '@/lib/i18n/client-locale';
import { CustomerScreenButton, useCustomerScreenPush, type ScreenAction } from './customer-screen-control';
import { initialSaleFlow, nextSaleFlow, screenModeForFlow, ticketForScreen, type ScreenMode, type ScreenPayload } from './customer-screen';
import { effectiveSaleHt, useRoundSalePrices } from '@/lib/pricing';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

type CartLine = {
  _key: string; article_id: string | null; designation: string; quantity: number; unit_price_ht: number; vat_rate: number;
  /** Famille et type de gestion : règle de la facture obligatoire (PDV010). */
  category_path: string | null; mgmt_type: string | null;
};
let ck = 0;

/** La session porte-t-elle les colonnes de la migration 20261103170000 (rattachement possible) ? */
const sessionLinkable = (s: CashSession | null | undefined): boolean => !!s && 'register_code' in s;

export function PosSale({ companyId, companyName, onOpenCash, screenCode }: { companyId: string; companyName: string; onOpenCash?: () => void; screenCode?: string | null }) {
  const qc = useQueryClient();
  const roundUp = useRoundSalePrices(companyId);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [activeDoc, setActiveDoc] = useState<{ id: string; ttc: number; contact: Contact | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askUnpaid, setAskUnpaid] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailTo, setMailTo] = useState<string | null>(null);
  // Ecran client (PDV020) : parcours accueil -> ticket -> paiement -> (signature) -> merci -> accueil.
  const [flow, dispatch] = useReducer(nextSaleFlow, initialSaleFlow);
  const [manual, setManual] = useState<ScreenAction | null>(null);
  const [screenNonce, setScreenNonce] = useState(0);
  const [allowEmail, setAllowEmail] = useState(true);
  const pushScreen = useCustomerScreenPush(companyId);

  const { data: session, isLoading: sessionLoading } = useQuery({ queryKey: ['cash-session', companyId], queryFn: () => getOpenSession(companyId) });
  const { data: rules } = useQuery({ queryKey: ['invoice-family-rules', companyId], queryFn: () => listInvoiceFamilyRules(companyId) });

  const totals = computeTotals(posTicketLines(cart));
  // Facture imposée par la loi : moto, ou > 125 € TTC avec une pièce / un accessoire du véhicule.
  const mustInvoice = invoiceRequired(cart, rules ?? []);
  const noSession = !sessionLoading && posSessionError(session) === 'noSession';

  const add = (a: SaleArticle) => setCart((c) => {
    const existing = c.find((l) => l.article_id === a.id);
    if (existing) return c.map((l) => (l.article_id === a.id ? { ...l, quantity: l.quantity + 1 } : l));
    return [...c, {
      _key: `c${ck++}`, article_id: a.id, designation: a.designation, quantity: 1,
      unit_price_ht: effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp), vat_rate: a.vat_rate,
      category_path: a.category_path ?? null, mgmt_type: a.mgmt_type ?? null,
    }];
  });
  const setQty = (key: string, q: number) => setCart((c) => c.map((l) => (l._key === key ? { ...l, quantity: q } : l)));
  const remove = (key: string) => setCart((c) => c.filter((l) => l._key !== key));

  const checkout = async () => {
    setBusy(true); setError(null);
    try {
      // Même règle que l'écran de vente : au moins une ligne et un montant (plus de ticket à 0 €).
      const refused = posCartError(cart);
      if (refused) { setError(refused === 'needLine' ? t('pos.cartEmpty') : documentValidationMessage(refused)); setBusy(false); return; }
      // Caisse fermée : rien ne s'encaisse (le ticket et les espèces se rattachent à la session).
      const open = await getOpenSession(companyId);
      if (!open) { setError(t('pos.noSessionBody')); qc.invalidateQueries({ queryKey: ['cash-session', companyId] }); setBusy(false); return; }
      if (mustInvoice && !contact) { setError(invoiceRequiredMessage(mustInvoice)); setBusy(false); return; }
      const lines = posTicketLines(cart);
      // Avec un client : facture (obligatoire au-delà du seuil, toujours possible) ; sans : ticket.
      const docType = contact ? 'FAC' : 'TIK';
      const id = await createDocument({
        companyId, docType, contactId: contact?.id ?? null, issueDate: localIsoDate(), status: 'validee', lines,
        // Le ticket est rattaché à la session par la base ; la facture du comptoir l'est ici.
        cashSessionId: docType === 'FAC' && sessionLinkable(open) ? open.id : null,
      });
      const tot = computeTotals(lines);
      setActiveDoc({ id, ttc: tot.total_ttc, contact });
      dispatch({ type: 'checkout' });
    } catch (e) { setError(errorMessage(e) || t('pos.errSale')); }
    setBusy(false);
  };

  // Règlements du ticket en cours : « Nouvelle vente » prévient tant qu'il reste à encaisser.
  const { data: payments } = useQuery({ queryKey: ['payments', activeDoc?.id], queryFn: () => listPayments(activeDoc!.id), enabled: !!activeDoc });
  const remaining = activeDoc ? ticketRemaining(activeDoc.ttc, payments ?? []) : 0;
  const { data: full } = useQuery({ queryKey: ['doc-full', activeDoc?.id], queryFn: () => getDocumentFull(activeDoc!.id), enabled: !!activeDoc });

  // ---- Ecran client : ce que le parcours demande, poussé automatiquement (dédoublonné)
  useEffect(() => { dispatch({ type: 'cart', lines: cart.filter((l) => Number(l.quantity) > 0).length }); }, [cart]);
  const paidNow = !!activeDoc && !!payments && remaining <= 0.005;
  useEffect(() => { if (paidNow) dispatch({ type: 'paid' }); }, [paidNow]);
  useEffect(() => { setManual(null); }, [flow.step]);
  const screenStarted = useRef(false);
  const pushedNonce = useRef(0);
  useEffect(() => {
    const mode: ScreenMode = manual === 'merci' ? 'merci' : manual === 'accueil' ? 'accueil' : manual === 'ticket' && flow.step !== 'accueil' ? 'ticket' : screenModeForFlow(flow);
    // Rien n'est poussé à l'ouverture de la caisse (un QR affiché depuis un document reste à l'écran).
    if (!screenStarted.current && mode === 'accueil') return;
    screenStarted.current = true;
    const ticket = ticketForScreen(posTicketLines(cart));
    const base: ScreenPayload = {
      ...ticket, doc_type: full?.doc.doc_type ?? null, document_number: full?.doc.number ?? null,
      customer_name: (activeDoc?.contact ?? contact) ? contactDisplayName((activeDoc?.contact ?? contact)!) : null,
      locale: (activeDoc?.contact ?? contact) ? contactLocale(activeDoc?.contact ?? contact) : null,
    };
    let payload: ScreenPayload = {};
    if (mode === 'ticket' || mode === 'terminal' || mode === 'qr') {
      payload = activeDoc
        ? { ...base, stage: 'a_payer', amount: activeDoc.ttc, due: remaining, methods: ['card', 'cash'] }
        : { ...base, stage: 'saisie' };
    } else if (mode === 'merci') {
      payload = { document_number: base.document_number, locale: base.locale, amount: activeDoc?.ttc ?? ticket.totals?.ttc, allow_email: allowEmail && !!activeDoc };
    }
    // Un geste manuel (ou la signature rangée) repousse l'écran même s'il n'a pas changé ici.
    const force = screenNonce !== pushedNonce.current;
    pushedNonce.current = screenNonce;
    pushScreen(mode === 'qr' ? 'ticket' : mode, payload, { force });
  }, [flow, manual, cart, contact, activeDoc, remaining, full?.doc.number, full?.doc.doc_type, allowEmail, screenNonce, pushScreen]);
  const onScreenAction = (a: ScreenAction) => {
    if (a === 'terminal') { dispatch({ type: 'method', method: 'card' }); setManual(null); }
    else if (a === 'ticket') { dispatch({ type: 'method', method: null }); setManual('ticket'); }
    else setManual(a);
    setScreenNonce((n) => n + 1);
  };
  const screenButton = (
    <CustomerScreenButton
      companyId={companyId} initialCode={screenCode} onAction={onScreenAction}
      signatureFor={activeDoc ? { documentId: activeDoc.id, number: full?.doc.number ?? null } : null}
      allowEmail={allowEmail} onAllowEmail={setAllowEmail}
      onSendTicket={activeDoc ? (email) => { setMailTo(email); setMailOpen(true); } : undefined}
      onSigned={() => { setManual(null); setScreenNonce((n) => n + 1); }}
    />
  );

  const newSale = () => { setCart([]); setContact(null); setActiveDoc(null); setError(null); setAskUnpaid(false); setMailOpen(false); setMailTo(null); dispatch({ type: 'newSale' }); setManual(null); qc.invalidateQueries({ queryKey: ['stock', companyId] }); };
  const askNewSale = () => { if (remaining > 0.005) setAskUnpaid(true); else newSale(); };
  const print = async () => {
    if (!activeDoc) return;
    try { const f = await getDocumentFull(activeDoc.id); await printDocument(f, companyName); } catch (e) { setError(errorMessage(e)); }
  };

  // Encaissement en cours
  if (activeDoc) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t('pos.toCollect')}{activeDoc.contact ? ` · ${t('pos.invoiceFor')} ${contactDisplayName(activeDoc.contact)}` : ''}</p>
          <p className="font-data text-2xl font-bold tabular-nums">{eur(activeDoc.ttc)}</p>
          {payments && (remaining > 0.005
            ? <p className="mt-1 font-data text-sm tabular-nums text-warning">{t('pos.remaining')} : <b>{eur(remaining)}</b></p>
            : <p className="mt-1 font-data text-sm text-success">{t('pos.paidOk')}</p>)}
        </div>
        <PaymentPanel
          documentId={activeDoc.id} companyId={companyId} due={remaining}
          stripe={{
            totalTtc: activeDoc.ttc, customerName: activeDoc.contact ? contactDisplayName(activeDoc.contact) : null,
            customerEmail: activeDoc.contact?.email ?? null, customerPhone: activeDoc.contact?.phone ?? null,
          }}
        />
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <span className="mr-auto">{screenButton}</span>
          <Button variant="outline" asChild><Link to="/sales/$documentId" params={{ documentId: activeDoc.id }}><FileText /> {t('pos.openTicket')}</Link></Button>
          <Button variant="outline" onClick={() => setMailOpen(true)}><Mail /> {t('pos.mailTicket')}</Button>
          <Button variant="outline" onClick={print}><Printer /> {t('pos.printTicket')}</Button>
          <Button onClick={askNewSale}><RotateCcw /> {t('pos.newSale')}</Button>
        </div>
        {mailOpen && full && (
          <DocumentMailDialog full={full} contact={activeDoc.contact} companyName={companyName} initialTo={mailTo} onClose={() => { setMailOpen(false); setMailTo(null); }} />
        )}
        <AlertDialog open={askUnpaid} onOpenChange={setAskUnpaid}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-warning" /> {t('pos.unpaidTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{fillVars(t('pos.unpaidBody'), { amount: eur(remaining) })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={newSale}>{t('pos.unpaidConfirm')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {noSession && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning bg-warning-bg px-4 py-3">
          <Wallet className="size-5 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-bold text-warning">{t('pos.noSessionTitle')}</p>
            <p className="text-[13px] text-foreground">{t('pos.noSessionBody')}</p>
          </div>
          {onOpenCash && <Button onClick={onOpenCash}><Wallet /> {t('cash.open')}</Button>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* Panier */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1"><ScanBar companyId={companyId} onAdd={add} /></div>
            {screenButton}
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('pos.article')}</Th><Th className="w-24 text-right">{t('pos.qty')}</Th><Th className="w-24 text-right">{t('pos.price')}</Th><Th className="w-24 text-right">{t('pos.total')}</Th><Th className="w-10" /></tr></thead>
              <tbody>
                {cart.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">{t('pos.cartEmpty')}</td></tr>}
                {cart.map((l) => (
                  <tr key={l._key} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{l.designation}</td>
                    <td className="px-2 py-1"><Input type="number" step="1" min="0" value={String(l.quantity)} onChange={(e) => setQty(l._key, num(e.target.value))} className="h-8 text-right tabular-nums" /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(l.unit_price_ht * (1 + l.vat_rate / 100))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(l.quantity * l.unit_price_ht * (1 + l.vat_rate / 100))}</td>
                    <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" onClick={() => remove(l._key)}><Trash2 className="size-4 text-danger" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Client (facture) + total + encaisser */}
        <div className="space-y-3 rounded-md border border-border bg-card p-4">
          <div className="space-y-1">
            <label className="block text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('pos.clientForInvoice')}</label>
            {contact ? (
              <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <span className="truncate">{contactDisplayName(contact)}</span>
                <button type="button" title={t('pos.removeClient')} onClick={() => setContact(null)} className="ml-auto text-muted-foreground hover:text-danger"><X className="size-4" /></button>
              </div>
            ) : <ContactPicker companyId={companyId} onPick={setContact} />}
            <p className="text-[12px] text-muted-foreground">{contact ? t('pos.willInvoice') : t('pos.clientHint')}</p>
          </div>
          {mustInvoice && !contact && (
            <p className="flex gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning"><Receipt className="mt-0.5 size-4 shrink-0" /> {invoiceRequiredMessage(mustInvoice)}</p>
          )}
          <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">{t('pos.totalHt')}</span><span className="font-data tabular-nums">{eur(totals.total_ht)}</span></div>
          <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">{t('pos.totalVat')}</span><span className="font-data tabular-nums">{eur(totals.total_vat)}</span></div>
          <div className="flex items-baseline justify-between border-t border-border pt-3"><span className="font-bold">{t('pos.totalTtc')}</span><span className="font-data text-2xl font-bold tabular-nums">{eur(totals.total_ttc)}</span></div>
          {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
          <Button className="w-full" size="lg" onClick={checkout} disabled={busy || cart.length === 0 || noSession || (!!mustInvoice && !contact)}>
            {busy ? <Loader2 className="animate-spin" /> : <CreditCard />} {contact ? t('pos.checkoutInvoice') : t('pos.checkout')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScanBar({ companyId, onAdd }: { companyId: string; onAdd: (a: SaleArticle) => void }) {
  const roundUp = useRoundSalePrices(companyId);
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 200); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['pos-art', companyId, deb], queryFn: () => searchSaleArticles(companyId, deb), enabled: deb.length >= 2 });

  // Scan : Entrée → si une seule correspondance, l'ajoute et vide le champ ; plusieurs → on choisit.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const one = scanAutoPick(data);
    if (one) { onAdd(one); setTerm(''); setHint(null); }
    else if (data && data.length > 1) setHint(t('pos.scanMany'));
    else if (deb.length >= 2 && data && data.length === 0) setHint(t('pos.scanNone'));
  };
  return (
    <div className="relative">
      <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input ref={inputRef} value={term} onChange={(e) => { setTerm(e.target.value); setHint(null); }} onKeyDown={onKey} placeholder={t('pos.scan')} className="h-11 pl-9 text-base" autoFocus />
      {hint && <p className="mt-1 text-[12px] text-warning">{hint}</p>}
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => { onAdd(a); setTerm(''); setHint(null); inputRef.current?.focus(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <Search className="size-4 text-muted-foreground" /><span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span><span className="ml-auto tabular-nums text-muted-foreground">{eur(effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp))}</span><Plus className="size-4 text-success" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
