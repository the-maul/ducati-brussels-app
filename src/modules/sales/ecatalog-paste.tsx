/**
 * M6 — « Coller une référence ou un lien e-catalog » (mission 05, carte 4).
 *
 * Le vendeur colle une référence Ducati ou un lien e-catalog.ducati.com :
 *   1. la référence est lue (sans appeler le site) et normalisée — si le lien n'en contient
 *      pas, on la lui demande ;
 *   2. recherche exacte dans les articles de la société (référence, réf. fournisseur,
 *      code-barres, librairie comprise) ; une référence remplacée propose la dernière de la
 *      chaîne (ReplacementHint, carte 3) ;
 *   3. rien trouvé → « Créer l'article à compléter » (librairie, marque Ducati, désignation
 *      et prix saisis ; le magasin complète ensuite PA, fournisseur, famille).
 * Le choix pose la ligne comme la recherche habituelle (pastille de disponibilité comprise).
 */
import { useState, type FormEvent } from 'react';
import { ClipboardPaste, ExternalLink, Loader2, Plus, Search, Library, FilePenLine } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { effectiveSaleHt, useRoundSalePrices } from '@/lib/pricing';
import { saleStockStatus } from './availability';
import { SaleStockBadge } from './availability-badge';
import { ReplacementHint } from './replacement-hint';
import { ECATALOG_HOME, ecatalogLinkFor, isEcatalogUrl, looksLikeDucatiReference, normalizeReference, parseEcatalogInput } from './ecatalog';
import { createToCompleteArticle, lookupExactReference, type ExactMatch } from './ecatalog-api';
import type { SaleArticle } from './write-api';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export type EcatalogPick = { article: SaleArticle; catalogUrl: string | null; created: boolean; unitPriceHt?: number };

export function EcatalogPasteButton({ companyId, priceMode, onPick }: {
  companyId: string; priceMode: 'ht' | 'ttc'; onPick: (p: EcatalogPick) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}><ClipboardPaste /> {t('ecatalog.pasteButton')}</Button>
      {open && <EcatalogPasteDialog companyId={companyId} priceMode={priceMode} onClose={() => setOpen(false)}
        onPick={(p) => { onPick(p); setOpen(false); }} />}
    </>
  );
}

type Phase =
  | { step: 'input' }
  | { step: 'searching' }
  | { step: 'found'; reference: string; matches: ExactMatch[] }
  | { step: 'not_found'; reference: string };

function EcatalogPasteDialog({ companyId, priceMode, onClose, onPick }: {
  companyId: string; priceMode: 'ht' | 'ttc'; onClose: () => void; onPick: (p: EcatalogPick) => void;
}) {
  const roundUp = useRoundSalePrices(companyId);
  const [raw, setRaw] = useState('');
  const [askedRef, setAskedRef] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [needRef, setNeedRef] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: 'input' });
  const [error, setError] = useState<string | null>(null);
  // Création « à compléter »
  const [designation, setDesignation] = useState('');
  const [price, setPrice] = useState('');
  const [creating, setCreating] = useState(false);

  const search = async (reference: string) => {
    setError(null);
    setPhase({ step: 'searching' });
    try {
      const matches = await lookupExactReference(companyId, reference);
      setPhase(matches.length ? { step: 'found', reference, matches } : { step: 'not_found', reference });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ecatalog.errSearch'));
      setPhase({ step: 'input' });
    }
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (needRef) {
      const ref = normalizeReference(askedRef);
      const parsed = parseEcatalogInput(ref);
      if (parsed.kind !== 'reference') { setError(t('ecatalog.errInvalid')); return; }
      void search(parsed.reference);
      return;
    }
    const parsed = parseEcatalogInput(raw);
    if (parsed.kind === 'empty') return;
    if (parsed.kind === 'invalid') { setError(t('ecatalog.errInvalid')); return; }
    if (parsed.kind === 'url_without_reference') { setUrl(parsed.url); setNeedRef(true); return; }
    setUrl(parsed.url);
    void search(parsed.reference);
  };

  const reset = () => { setPhase({ step: 'input' }); setNeedRef(false); setAskedRef(''); setUrl(null); setError(null); };

  const catalogUrlToKeep = url && isEcatalogUrl(url) ? url : null;

  const create = async (reference: string) => {
    const p = num(price);
    if (!designation.trim()) { setError(t('ecatalog.errDesignation')); return; }
    if (!Number.isFinite(p) || p <= 0) { setError(t('ecatalog.errPrice')); return; }
    setCreating(true); setError(null);
    try {
      const a = await createToCompleteArticle({ companyId, reference, designation, price: p, priceMode, catalogUrl: catalogUrlToKeep });
      onPick({ article: a, catalogUrl: a.catalog_url, created: true, unitPriceHt: a.sale_price_ht });
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      setError(code === '23505' ? t('ecatalog.errDuplicate').replace('{ref}', reference) : (e instanceof Error ? e.message : t('ecatalog.errCreate')));
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('ecatalog.title')}</DialogTitle>
          <DialogDescription>{t('ecatalog.hint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ecatalog-input">{t('ecatalog.inputLabel')}</Label>
            <div className="flex gap-2">
              <Input id="ecatalog-input" autoFocus value={raw} placeholder={t('ecatalog.inputPlaceholder')}
                onChange={(e) => { setRaw(e.target.value); if (phase.step !== 'input' || needRef) reset(); }} />
              {!needRef && (
                <Button type="submit" disabled={!raw.trim() || phase.step === 'searching'}>
                  {phase.step === 'searching' ? <Loader2 className="animate-spin" /> : <Search />} {t('ecatalog.search')}
                </Button>
              )}
            </div>
          </div>
          {needRef && (
            <div className="space-y-1 rounded-md bg-info-bg p-3">
              <p className="text-[13px] text-info">{t('ecatalog.urlWithoutRef')}</p>
              <div className="flex gap-2">
                <Input autoFocus value={askedRef} placeholder={t('ecatalog.refPlaceholder')} onChange={(e) => setAskedRef(e.target.value)} className="bg-background" />
                <Button type="submit" disabled={!askedRef.trim() || phase.step === 'searching'}>
                  {phase.step === 'searching' ? <Loader2 className="animate-spin" /> : <Search />} {t('ecatalog.search')}
                </Button>
              </div>
            </div>
          )}
        </form>

        {phase.step === 'found' && (
          <div className="space-y-2">
            <p className="text-[12px] text-muted-foreground">{t('ecatalog.foundFor').replace('{ref}', phase.reference)}</p>
            {phase.matches.map((a) => (
              <div key={a.id} className="space-y-1 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-[12px]">{a.reference}</span>
                  <span className="truncate font-medium">{a.designation}</span>
                  {a.matched_on !== 'reference' && <span className="text-[12px] text-muted-foreground">{t(`ecatalog.matched_${a.matched_on}`)}</span>}
                  {a.is_library && <StatusBadge tone="neutral" icon={Library} label={t('ecatalog.libraryBadge')} />}
                  {a.to_complete && <StatusBadge tone="info" icon={FilePenLine} label={t('ecatalog.toCompleteBadge')} />}
                  <span className="ml-auto flex items-center gap-2">
                    <SaleStockBadge status={saleStockStatus(a)} free={a.real_qty - a.reserved_qty} />
                    <span className="tabular-nums text-muted-foreground">{eur(effectiveSaleHt(a.sale_price_ht, a.vat_rate, roundUp))} {t('ecatalog.ht')}</span>
                    <Button type="button" size="sm" onClick={() => onPick({ article: a, catalogUrl: a.catalog_url ?? catalogUrlToKeep, created: false })}>
                      <Plus /> {t('ecatalog.add')}
                    </Button>
                  </span>
                </div>
                <ReplacementHint companyId={companyId} article={a}
                  onReplace={(latest) => onPick({ article: latest, catalogUrl: null, created: false })} />
              </div>
            ))}
          </div>
        )}

        {phase.step === 'not_found' && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-[13px]">{t('ecatalog.notFound').replace('{ref}', phase.reference)}</p>
            <p className="text-[12px] text-muted-foreground">{t('ecatalog.createHint')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t('ecatalog.reference')}</Label>
                <Input value={phase.reference} readOnly disabled className="font-mono" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ecatalog-designation">{t('ecatalog.designation')}</Label>
                <Input id="ecatalog-designation" autoFocus value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder={t('ecatalog.designationPlaceholder')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ecatalog-price">{priceMode === 'ttc' ? t('ecatalog.priceTtc') : t('ecatalog.priceHt')}</Label>
                <Input id="ecatalog-price" type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="text-right tabular-nums" />
              </div>
              <div className="flex items-end sm:col-span-2">
                <Button type="button" onClick={() => void create(phase.reference)} disabled={creating}>
                  {creating ? <Loader2 className="animate-spin" /> : <Plus />} {t('ecatalog.create')}
                </Button>
              </div>
            </div>
            {!looksLikeDucatiReference(phase.reference) && <p className="text-[12px] text-warning">{t('ecatalog.notDucatiFormat')}</p>}
          </div>
        )}

        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

        <a href={url && isEcatalogUrl(url) ? url : ECATALOG_HOME} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-info underline">
          <ExternalLink className="size-3.5" /> {t('ecatalog.openCatalog')}
        </a>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lien « Voir dans l'e-catalog » d'une ligne d'article Ducati : ouvre le lien enregistré sur
 * l'article, sinon l'accueil du catalogue, dans un nouvel onglet ; copie la référence pour la
 * coller dans la recherche du catalogue. Rien n'est téléchargé du site.
 */
export function EcatalogLink({ reference, catalogUrl }: { reference: string | null | undefined; catalogUrl?: string | null }) {
  const ref = normalizeReference(reference);
  const copy = () => { try { void navigator.clipboard?.writeText(ref); } catch { /* copie facultative */ } };
  return (
    <a href={ecatalogLinkFor(catalogUrl)} target="_blank" rel="noopener noreferrer" onClick={copy}
      title={t('ecatalog.viewHint').replace('{ref}', ref)}
      className="mt-1 inline-flex items-center gap-1 text-[12px] text-info underline">
      <ExternalLink className="size-3.5" /> {t('ecatalog.view')}
    </a>
  );
}
