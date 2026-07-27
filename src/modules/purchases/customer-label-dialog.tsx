/**
 * M4/M2 (B12) — Rapprochement réception ↔ client : impression d'étiquettes
 * portant le n° de document (préempli depuis la réception) + le nom du client.
 *
 * TODO liaison auto : purchase_lines n'a aujourd'hui aucune colonne de lien vers
 * un document/une réservation client (pas de backorder table) — la saisie du nom
 * client reste donc manuelle. Si une table de réservation/backorder relie une
 * ligne de réception à une commande client, préremplir customerName automatiquement.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listTemplates } from '@/modules/articles/labels/templates-api';
import { renderLabelSvg, printRawLabels } from '@/modules/articles/labels/render';
import type { LabelData } from '@/modules/articles/labels/template-types';
import type { PurchaseLine } from './api';
import { t } from '@/lib/i18n';

const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n) : 1; };

export function CustomerLabelDialog({ open, onOpenChange, companyId, storeName, docNumber, lines }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string | null;
  storeName: string;
  docNumber: string;
  lines: PurchaseLine[];
}) {
  const [lineId, setLineId] = useState<string | null>(lines[0]?.id ?? null);
  const [customerName, setCustomerName] = useState('');
  const [doc, setDoc] = useState(docNumber);
  const [copies, setCopies] = useState('1');

  const templatesQ = useQuery({
    queryKey: ['label-templates', companyId],
    queryFn: () => listTemplates(companyId!),
    enabled: !!companyId && open,
  });
  const template = (templatesQ.data ?? []).find((x) => x.is_default) ?? templatesQ.data?.[0] ?? null;
  const line = lines.find((l) => l.id === lineId) ?? lines[0] ?? null;

  const data: LabelData | null = useMemo(() => {
    if (!line) return null;
    return {
      reference: line.supplier_ref ?? '', designation: line.designation,
      price_ttc: line.sale_price_ttc != null ? Number(line.sale_price_ttc) : null,
      price_ht: null, price_promo: null, discount: null,
      store_name: storeName, bin: line.bin_location, bin2: null, pack_qty: null,
      barcode_value: '', customerName: customerName.trim() || undefined, docNumber: doc.trim() || undefined,
    };
  }, [line, storeName, customerName, doc]);

  const previewSvg = data && template ? renderLabelSvg(template.config, data, new Date(), true) : null;

  const doPrint = () => {
    if (!data || !template) return;
    const svg = renderLabelSvg(template.config, data, new Date());
    printRawLabels(template.config, svg, num(copies));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('labels.customerLabel')}</DialogTitle>
          <DialogDescription>{t('purchases.customerLabelHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('purchases.colArticle')}</Label>
            <Select value={line?.id ?? undefined} onValueChange={setLineId}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.designation}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('labels.customerName')}</Label>
              <Input className="h-9" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t('labels.customerName')} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('labels.docNumber')}</Label>
              <Input className="h-9" value={doc} onChange={(e) => setDoc(e.target.value)} />
            </div>
          </div>

          {previewSvg && (
            <div className="overflow-auto rounded border border-border bg-muted/40 p-3" dangerouslySetInnerHTML={{ __html: previewSvg.replace('<svg ', '<svg style="width:100%;max-width:320px" ') }} />
          )}

          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('articles.quickCopies')}</Label>
              <Input className="h-9 w-24 text-right tabular-nums" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} />
            </div>
            <Button className="h-9 flex-1" onClick={doPrint} disabled={!data || !template}>
              <Printer /> {t('labels.printCustomerLabels')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
