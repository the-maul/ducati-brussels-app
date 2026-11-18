/**
 * M2 — Rattrapage G8 (18/11/2026) : bouton « Import microfiches » (ventes, OR, commandes,
 * inventaire). G8 : fichier CSV « ligne ; référence ; quantité » exporté d'un catalogue pièces.
 *
 * Le dialogue lit le fichier (ou un collage), retrouve chaque référence (référence exacte puis
 * code-barres), montre ce qui est trouvé et ce qui ne l'est pas, puis remet à l'écran appelant
 * la liste (article, quantité). Rien n'est écrit en base ici : c'est l'écran appelant qui
 * ajoute ses lignes comme si on les avait saisies (le document reste à enregistrer).
 */
import { useRef, useState } from 'react';
import { FileUp, Loader2, ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { fillVars, t } from '@/lib/i18n';
import { articleBaseSaleHt, articleVatRate } from '@/modules/sales/article-price';
import type { SaleArticle } from '@/modules/sales/write-api';
import { normalizeRef, parseMicrofiche, type MicroficheParse } from './microfiche';
import { resolveReferences, type ResolvedArticle } from './api';
import { Td, Th, errorText, qty } from './ui';

export type MicroficheItem = { article: ResolvedArticle; quantity: number };

/** Article d'une microfiche vu comme un résultat de recherche de ligne (OR, vente). */
export function microficheToSaleArticle(a: ResolvedArticle): SaleArticle {
  return {
    id: a.id, reference: a.reference, designation: a.designation,
    sale_price_ht: articleBaseSaleHt(a), vat_rate: articleVatRate(a),
    mgmt_type: a.mgmt_type ?? null, real_qty: 0, reserved_qty: 0, on_order_qty: 0,
    bin_location: a.bin_location ?? null, superseded_by_id: null, equivalence_group: null,
  };
}

export function MicroficheImportButton({ companyId, onImport, disabled, label }: {
  companyId: string;
  onImport: (items: MicroficheItem[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        <FileUp /> {label ?? t('g8a.micro.button')}
      </Button>
      {open && <MicroficheDialog companyId={companyId} onClose={() => setOpen(false)} onImport={(items) => { onImport(items); setOpen(false); }} />}
    </>
  );
}

function MicroficheDialog({ companyId, onClose, onImport }: { companyId: string; onClose: () => void; onImport: (items: MicroficheItem[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<MicroficheParse | null>(null);
  const [found, setFound] = useState<Map<string, ResolvedArticle> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyse = async (content: string) => {
    setError(null);
    const p = parseMicrofiche(content);
    setParsed(p);
    setFound(null);
    if (!p.lines.length) return;
    setBusy(true);
    try {
      setFound(await resolveReferences(companyId, p.lines.map((l) => l.reference)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | null) => {
    if (!f) return;
    const content = await f.text();
    setText(content);
    await analyse(content);
    if (fileRef.current) fileRef.current.value = '';
  };

  const items: MicroficheItem[] = (parsed?.lines ?? [])
    .map((l) => ({ article: found?.get(normalizeRef(l.reference)), quantity: l.quantity }))
    .filter((x): x is MicroficheItem => !!x.article);
  const unknown = (parsed?.lines ?? []).filter((l) => found && !found.has(normalizeRef(l.reference)));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('g8a.micro.title')}</DialogTitle>
          <DialogDescription>{t('g8a.micro.hint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}><FileUp /> {t('g8a.micro.file')}</Button>
            <span className="text-[12px] text-muted-foreground">{t('g8a.micro.format')}</span>
          </div>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-[12px]" placeholder={'1;96480471A;2\n2;77140677CF;1'} />
          <div className="flex justify-end">
            <Button type="button" variant="outline" disabled={busy || !text.trim()} onClick={() => void analyse(text)}>
              {busy ? <Loader2 className="animate-spin" /> : null} {t('g8a.micro.analyse')}
            </Button>
          </div>
          {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
          {parsed && (
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="success" label={fillVars(t('g8a.micro.found'), { n: items.length })} />
              {unknown.length > 0 && <StatusBadge tone="warning" label={fillVars(t('g8a.micro.unknown'), { n: unknown.length })} />}
              {parsed.errors.length > 0 && <StatusBadge tone="danger" label={fillVars(t('g8a.micro.errors'), { n: parsed.errors.length })} />}
            </div>
          )}
          {parsed && (parsed.lines.length > 0 || parsed.errors.length > 0) && (
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse font-data text-[13px]">
                <thead className="sticky top-0 bg-muted">
                  <tr><Th>{t('g8a.micro.colLine')}</Th><Th>{t('g8a.micro.colRef')}</Th><Th>{t('g8a.micro.colDesignation')}</Th><Th className="text-right">{t('g8a.micro.colQty')}</Th></tr>
                </thead>
                <tbody>
                  {parsed.lines.map((l) => {
                    const a = found?.get(normalizeRef(l.reference));
                    return (
                      <tr key={l.reference} className="border-b border-border last:border-0">
                        <Td className="tabular-nums">{l.line}</Td>
                        <Td className="font-mono text-[12px]">{l.reference}</Td>
                        <Td className={a ? '' : 'text-warning'}>{a ? a.designation : found ? t('g8a.micro.notFound') : '…'}</Td>
                        <Td className="text-right tabular-nums">{qty(l.quantity)}</Td>
                      </tr>
                    );
                  })}
                  {parsed.errors.map((e) => (
                    <tr key={`err-${e.line}`} className="border-b border-border last:border-0 text-danger">
                      <Td className="tabular-nums">{e.line}</Td>
                      <Td className="font-mono text-[12px]" >{e.raw}</Td>
                      <Td>{t(`g8a.micro.err_${e.reason}`)}</Td>
                      <Td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button type="button" disabled={busy || items.length === 0} onClick={() => onImport(items)}>
            <ListPlus /> {fillVars(t('g8a.micro.add'), { n: items.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
