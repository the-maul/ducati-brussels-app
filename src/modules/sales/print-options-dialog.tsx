/**
 * M6 — Fenêtre « Options d'édition » (G8 : Édition d'un document) : sans références, sans
 * règlements, preuve d'achat sans prix (BL non chiffré), totaux uniquement, recto-verso, titre
 * Proforma / Devis / Estimation ou Réservation / Commande ; puis Imprimer ou Aperçu PDF.
 */
import { useState } from 'react';
import { FileDown, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { DEFAULT_PRINT_OPTIONS, normalizePrintOptions, titleChoicesFor, titleKey, type PrintOptions, type PrintTitle } from './print-options';

type BoolKey = 'noReferences' | 'noPayments' | 'noPrices' | 'totalsOnly' | 'duplex';
const BOOL_KEYS: BoolKey[] = ['noReferences', 'noPayments', 'noPrices', 'totalsOnly', 'duplex'];

/** Cases et titre, réutilisés par l'impression groupée de la liste des factures. */
export function PrintOptionsFields({ docType, value, onChange }: { docType: string | null; value: PrintOptions; onChange: (o: PrintOptions) => void }) {
  const titles = docType ? titleChoicesFor(docType) : ['default' as PrintTitle];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {BOOL_KEYS.map((k) => (
          <label key={k} className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={value[k]}
              onCheckedChange={(v) => onChange(normalizePrintOptions(docType ?? '', { ...value, [k]: v === true, ...(k === 'totalsOnly' && v === true ? { noPrices: false } : {}) }))}
            />
            <span>
              {t(`printOptions.${k}`)}
              <span className="block text-[12px] text-muted-foreground">{t(`printOptions.${k}Hint`)}</span>
            </span>
          </label>
        ))}
      </div>
      {titles.length > 1 && (
        <div className="space-y-1.5">
          <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('printOptions.title')}</Label>
          <Select value={value.title} onValueChange={(v) => onChange({ ...value, title: v as PrintTitle })}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {titles.map((tt) => {
                const k = titleKey(tt);
                return <SelectItem key={tt} value={tt}>{k ? t(k) : t(`sales.type_${docType}`)}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function PrintOptionsDialog({ docType, onPrint, onPdf, onClose }: {
  docType: string;
  onPrint: (o: PrintOptions) => Promise<void>;
  onPdf?: (o: PrintOptions) => Promise<void>;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS);
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);
  const run = async (kind: 'print' | 'pdf') => {
    const fn = kind === 'print' ? onPrint : onPdf;
    if (!fn) return;
    setBusy(kind);
    try { await fn(normalizePrintOptions(docType, opts)); onClose(); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('printOptions.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('printOptions.dialogHint')}</DialogDescription>
        </DialogHeader>
        <PrintOptionsFields docType={docType} value={opts} onChange={setOpts} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          {onPdf && (
            <Button variant="outline" onClick={() => run('pdf')} disabled={!!busy}>
              {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileDown />} {t('salesMail.previewPdf')}
            </Button>
          )}
          <Button onClick={() => run('print')} disabled={!!busy}>
            {busy === 'print' ? <Loader2 className="animate-spin" /> : <Printer />} {t('sales.print')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
