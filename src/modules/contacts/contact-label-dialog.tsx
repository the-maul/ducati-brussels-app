/**
 * M1/M2 (B12) — Impression d'une étiquette depuis la fiche client : cochez les
 * informations (Nom-Prénom, entreprise, moto, 6 derniers chiffres du châssis,
 * n° de document, localisation magasin), prévisualisez, imprimez.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listOwnedVehicles } from './subobjects-api';
import { listContactDocuments } from '@/modules/sales/api';
import { listTemplates } from '@/modules/articles/labels/templates-api';
import { renderFreeTextLabelSvg, printRawLabels, DEFAULT_QUICK_STYLE } from '@/modules/articles/labels/render';
import {
  LABEL_LOCATIONS, LOCATION_FREE, buildContactLabelLines, type ContactLabelSelection,
} from './contact-label-data';
import type { Contact } from './api';
import { t } from '@/lib/i18n';

const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function ContactLabelDialog({ open, onOpenChange, companyId, contact }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string;
  contact: Contact;
}) {
  const personName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');

  // Sélection des informations
  const [incName, setIncName] = useState(true);
  const [incCompany, setIncCompany] = useState(!!contact.company_name);
  const [incModel, setIncModel] = useState(true);
  const [incVin, setIncVin] = useState(true);
  const [incDoc, setIncDoc] = useState(false);
  const [incLoc, setIncLoc] = useState(false);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [docNumber, setDocNumber] = useState('');
  const [location, setLocation] = useState<string>(LABEL_LOCATIONS[0]);
  const [freeLocation, setFreeLocation] = useState('');

  // Mise en forme (réduite — gros et gras par défaut, comme P-touch)
  const [sizePt, setSizePt] = useState('19');
  const [bold, setBold] = useState(true);
  const [copies, setCopies] = useState('1');
  const [templateId, setTemplateId] = useState<string | null>(null);

  const vehiclesQ = useQuery({
    queryKey: ['label-vehicles', contact.id],
    queryFn: () => listOwnedVehicles(contact.id),
    enabled: open,
  });
  const vehicles = vehiclesQ.data ?? [];
  const vehicle = vehicles.find((v) => v.vehicle.id === vehicleId) ?? vehicles[0] ?? null;

  const docsQ = useQuery({
    queryKey: ['label-docs', contact.id],
    queryFn: () => listContactDocuments(contact.id),
    enabled: open,
  });
  const docs = docsQ.data ?? [];

  const templatesQ = useQuery({
    queryKey: ['label-templates', companyId],
    queryFn: () => listTemplates(companyId),
    enabled: open,
  });
  const templates = templatesQ.data ?? [];
  const template = templates.find((x) => x.id === templateId) ?? templates.find((x) => x.is_default) ?? templates[0] ?? null;

  const selection: ContactLabelSelection = {
    includeName: incName, nameLine: personName,
    includeCompany: incCompany, companyLine: contact.company_name ?? '',
    includeModel: incModel, modelLine: vehicle ? [vehicle.vehicle.brand, vehicle.vehicle.model].filter(Boolean).join(' ') : '',
    includeVin6: incVin, vin: vehicle?.vehicle.vin ?? null,
    includeDoc: incDoc, docNumber,
    includeLocation: incLoc, location, freeLocation,
  };
  const lines = useMemo(() => buildContactLabelLines(selection), [selection]);

  const style = { ...DEFAULT_QUICK_STYLE, sizePt: Math.max(4, num(sizePt)), bold };
  const dims = template ? { widthMm: template.config.widthMm, heightMm: template.config.heightMm } : { widthMm: 62, heightMm: 29 };
  const previewSvg = useMemo(() => renderFreeTextLabelSvg(dims, lines, style, true), [dims, lines, style]);

  const doPrint = () => {
    if (!template || lines.length === 0) return;
    printRawLabels(template.config, renderFreeTextLabelSvg(dims, lines, style, false), num(copies) || 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('contacts.labelTitle')}</DialogTitle>
          <DialogDescription>{t('contacts.labelSubtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* ── Informations à imprimer ───────────────────────────────────── */}
          <div className="space-y-2.5">
            <CheckRow checked={incName} onChange={setIncName} label={t('contacts.labelName')} hint={personName || '—'} disabled={!personName} />
            <CheckRow checked={incCompany} onChange={setIncCompany} label={t('contacts.labelCompany')} hint={contact.company_name ?? '—'} disabled={!contact.company_name} />

            {/* Moto (sélection si plusieurs) */}
            <CheckRow checked={incModel || incVin} onChange={(v) => { setIncModel(v); setIncVin(v); }} label={`${t('contacts.labelModel')} + ${t('contacts.labelVin6')}`}
              hint={vehicles.length === 0 ? t('contacts.labelNoVehicle') : undefined} disabled={vehicles.length === 0} />
            {vehicles.length > 0 && (
              <div className="ml-6 space-y-1.5">
                <Select value={vehicle?.vehicle.id} onValueChange={setVehicleId}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {vehicles.map((v) => (
                      <SelectItem key={v.vehicle.id} value={v.vehicle.id}>
                        {[v.vehicle.brand, v.vehicle.model].filter(Boolean).join(' ')} {v.vehicle.vin ? `· ${v.vehicle.vin.slice(-6)}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-[13px]">
                    <Checkbox checked={incModel} onCheckedChange={(v) => setIncModel(v === true)} /> {t('contacts.labelModel')}
                  </label>
                  <label className="flex items-center gap-2 text-[13px]">
                    <Checkbox checked={incVin} onCheckedChange={(v) => setIncVin(v === true)} /> {t('contacts.labelVin6')}
                  </label>
                </div>
              </div>
            )}

            {/* Document */}
            <CheckRow checked={incDoc} onChange={setIncDoc} label={t('contacts.labelDoc')}
              hint={docs.length === 0 ? t('contacts.labelNoDoc') : undefined} disabled={docs.length === 0} />
            {incDoc && docs.length > 0 && (
              <div className="ml-6">
                <Select value={docNumber || undefined} onValueChange={setDocNumber}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {docs.slice(0, 30).map((d) => (
                      <SelectItem key={d.id} value={d.number ?? d.id}>{d.number ?? d.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Localisation */}
            <CheckRow checked={incLoc} onChange={setIncLoc} label={t('contacts.labelLocation')} />
            {incLoc && (
              <div className="ml-6 space-y-1.5">
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LABEL_LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    <SelectItem value={LOCATION_FREE}>{t('contacts.labelLocationFree')}</SelectItem>
                  </SelectContent>
                </Select>
                {location === LOCATION_FREE && (
                  <Input className="h-9" value={freeLocation} onChange={(e) => setFreeLocation(e.target.value)} placeholder={t('contacts.labelLocationFree')} />
                )}
              </div>
            )}
          </div>

          {/* ── Prévisualisation + impression ─────────────────────────────── */}
          <div className="space-y-3">
            <Field label={t('articles.tplPreview')}>
              <div
                className="overflow-auto rounded border border-border bg-muted/40 p-3"
                dangerouslySetInnerHTML={{ __html: previewSvg.replace('<svg ', '<svg style="width:100%;max-width:380px" ') }}
              />
              {lines.length === 0 && <p className="mt-1 text-[12px] text-warning">{t('contacts.labelEmptyLines')}</p>}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('articles.labelsFormat')}>
                <Select value={template?.id ?? undefined} onValueChange={setTemplateId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{templates.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={t('articles.quickSize')}>
                <Input className="h-9 text-right tabular-nums" inputMode="decimal" value={sizePt} onChange={(e) => setSizePt(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={bold} onCheckedChange={(v) => setBold(v === true)} /> {t('articles.quickBold')}
              </label>
              <Field label={t('articles.quickCopies')}>
                <Input className="h-9 text-right tabular-nums" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} />
              </Field>
            </div>
            <Button className="h-10 w-full" onClick={doPrint} disabled={!template || lines.length === 0}>
              <Printer /> {t('articles.quickPrint')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CheckRow({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <Checkbox className="mt-0.5" checked={checked && !disabled} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      <span>
        {label}
        {hint && <span className="block text-[12px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
