/**
 * M7 (B2/B3) — « Valider la reprise » en 3 fenêtres :
 *  1. Checklist « L'acheteur confirme avoir reçu » ;
 *  2. Vérification des données client (client lié, recherche d'un autre client
 *     ou saisie manuelle) + photos recto/verso de la carte d'identité +
 *     attestation TVA marge signée digitalement (PDF joint véhicule + client) ;
 *  3. Montants (TVAC ⇄ HTVA), prix de vente / minimum (alerte + notification
 *     Domenico sous le minimum), classement — puis ENTRÉE EN STOCK.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, ChevronRight, ChevronLeft, CheckCircle2, FileSignature, AlertTriangle, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { searchContactsToLink } from '@/modules/contacts/subobjects-api';
import { IdDocsSection } from '@/modules/contacts/id-docs';
import { SignaturePad } from '@/modules/documents/signature-pad';
import {
  CHECKLIST_KEYS, emptyChecklist, needsAttestation, defaultVatRate, ttcToHt, htToTtc,
  belowMinimum, defaultClassification, MIN_PRICE_ALERT_EMAIL,
  type Checklist, type SellerVatStatus, type ValidationData,
} from './validate-data';
import { buildMarginAttestationPdf } from './attestation-pdf';
import { buildValidationPdf, attachPdfToGed } from './validation-pdf';
import { validateReprise, readValidationMeta } from './validate-api';
import { t } from '@/lib/i18n';

/* eslint-disable @typescript-eslint/no-explicit-any */

type OroLike = {
  id: string; number: string | null;
  vehicle: {
    id: string; vin: string | null; brand: string | null; model: string | null;
    model_year: number | null; mileage: number | null; displacement: number | null;
    power_cv: number | null; power_kw: number | null;
    first_registration_date?: string | null;
    purchase_price?: number | null; display_price?: number | null;
  } | null;
};

type ContactRow = Record<string, any>;

const todayIso = () => new Date().toISOString().slice(0, 10);

export function ValidateRepriseDialog({ open, onOpenChange, companyId, oro, oroRow, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string;
  oro: OroLike;
  oroRow: Record<string, unknown>;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const meta = useMemo(() => readValidationMeta(oroRow, oro.id), [oroRow, oro.id]);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Étape 1 : checklist ──────────────────────────────────────────────────
  const [checklist, setChecklist] = useState<Checklist>(() => ({ ...emptyChecklist(), ...(meta.checklist ?? {}) }));

  // ── Étape 2 : client + attestation ───────────────────────────────────────
  const [contactId, setContactId] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState({ first_name: '', last_name: '', company_name: '', email: '', phone: '', address: '', zip: '', city: '' });
  const [searchQ, setSearchQ] = useState('');
  const [sellerStatus, setSellerStatus] = useState<SellerVatStatus>((meta.seller_vat_status as SellerVatStatus) ?? 'particulier');
  const [attPlace, setAttPlace] = useState(meta.attestation?.place ?? 'WATERLOO');
  const [attDate, setAttDate] = useState(meta.attestation?.date ?? todayIso());
  const [signature, setSignature] = useState<string | null>(null);
  const [attestationDone, setAttestationDone] = useState(!!meta.attestation?.signed);

  // Client lié (dernier propriétaire de la moto) — préremplissage
  useQuery({
    queryKey: ['tradein-validate-client', oro.vehicle?.id],
    queryFn: async () => {
      const { data: owner } = await supabase.from('vehicle_owners')
        .select('contact_id').eq('vehicle_id', oro.vehicle!.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (owner?.contact_id) pickContact(owner.contact_id as string);
      return owner?.contact_id ?? null;
    },
    enabled: open && !!oro.vehicle?.id && !contactId,
  });

  const pickContact = async (id: string) => {
    const { data: c } = await supabase.from('contacts').select('*').eq('id', id).maybeSingle();
    if (!c) return;
    setContactId(id);
    const row = c as ContactRow;
    setClientForm({
      first_name: row.first_name ?? '', last_name: row.last_name ?? '',
      company_name: row.company_name ?? '', email: row.email ?? '', phone: row.phone ?? '',
      address: row.address ?? '', zip: row.zip ?? '', city: row.city ?? '',
    });
  };

  const searchRes = useQuery({
    queryKey: ['tradein-validate-search', companyId, searchQ],
    queryFn: () => searchContactsToLink(companyId, searchQ, contactId ?? '00000000-0000-0000-0000-000000000000'),
    enabled: open && searchQ.trim().length >= 2,
  });

  const attestationNeeded = needsAttestation(sellerStatus);

  const signAttestation = useMutation({
    mutationFn: async () => {
      const blob = await buildMarginAttestationPdf({
        lastName: clientForm.last_name || clientForm.company_name,
        firstName: clientForm.first_name,
        sellerStatus: sellerStatus as Exclude<SellerVatStatus, 'assujetti'>,
        brand: oro.vehicle?.brand ?? '',
        model: oro.vehicle?.model ?? '',
        displacement: oro.vehicle?.displacement != null ? String(oro.vehicle.displacement) : '',
        power: oro.vehicle?.power_cv != null ? `${oro.vehicle.power_cv} cv` : (oro.vehicle?.power_kw != null ? `${oro.vehicle.power_kw} kW` : ''),
        vin: oro.vehicle?.vin ?? '',
        firstRegistration: oro.vehicle?.first_registration_date ?? '',
        place: attPlace, dateIso: attDate, signatureDataUrl: signature,
      });
      const targets: { entityType: 'vehicle' | 'contact'; entityId: string }[] = [];
      if (oro.vehicle) targets.push({ entityType: 'vehicle', entityId: oro.vehicle.id });
      if (contactId) targets.push({ entityType: 'contact', entityId: contactId });
      await attachPdfToGed(companyId, blob, `Attestation-TVA-marge_${oro.number ?? oro.id}.pdf`,
        targets, 'Attestations', t('tradein.attTitleShort'));
      // Copie téléchargeable immédiate
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Attestation-TVA-marge_${oro.number ?? oro.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => { setAttestationDone(true); toast.success(t('tradein.attDone')); },
    onError: () => toast.error(t('tradein.attError')),
  });

  // ── Étape 3 : montants + classement ──────────────────────────────────────
  // Défauts : métadonnées sauvegardées, sinon valorisation du véhicule (cas
  // « Modifier » depuis un poste sans les métadonnées locales).
  const vehBuy = oro.vehicle?.purchase_price != null && oro.vehicle.purchase_price > 0 ? String(oro.vehicle.purchase_price) : '';
  const vehSale = oro.vehicle?.display_price != null && oro.vehicle.display_price > 0 ? String(oro.vehicle.display_price) : '';
  const [vatRate, setVatRate] = useState<number>(meta.vat_rate ?? defaultVatRate(sellerStatus));
  const [buyTtc, setBuyTtc] = useState<string>(meta.buy_price_ttc != null ? String(meta.buy_price_ttc) : vehBuy);
  const [buyHt, setBuyHt] = useState<string>(meta.buy_price_ht != null ? String(meta.buy_price_ht) : vehBuy);
  const [salePrice, setSalePrice] = useState<string>(meta.sale_price != null ? String(meta.sale_price) : vehSale);
  const [minPrice, setMinPrice] = useState<string>(meta.min_sale_price != null ? String(meta.min_sale_price) : '');
  const [cls, setCls] = useState(() => meta.classification ?? defaultClassification(false));
  const [minAlertOpen, setMinAlertOpen] = useState(false);

  const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

  const onVat = (rate: number) => {
    setVatRate(rate);
    if (buyTtc) setBuyHt(String(ttcToHt(num(buyTtc), rate)));
    setCls(defaultClassification(rate > 0));
  };
  const onBuyTtc = (v: string) => { setBuyTtc(v); setBuyHt(v ? String(ttcToHt(num(v), vatRate)) : ''); };
  const onBuyHt = (v: string) => { setBuyHt(v); setBuyTtc(v ? String(htToTtc(num(v), vatRate)) : ''); };

  const buildData = (): ValidationData => ({
    checklist,
    seller_vat_status: sellerStatus,
    attestation_place: attPlace,
    attestation_date: attDate,
    vat_rate: vatRate,
    buy_price_ttc: num(buyTtc),
    buy_price_ht: num(buyHt),
    sale_price: num(salePrice),
    min_sale_price: num(minPrice),
    classification: cls,
  });

  const finish = useMutation({
    mutationFn: async () => {
      const data = buildData();
      // Mise à jour des coordonnées client vérifiées (étape 2)
      if (contactId) {
        await supabase.from('contacts').update({
          first_name: clientForm.first_name || null, last_name: clientForm.last_name || null,
          company_name: clientForm.company_name || null, email: clientForm.email || null,
          phone: clientForm.phone || null, address: clientForm.address || null,
          zip: clientForm.zip || null, city: clientForm.city || null,
        }).eq('id', contactId).then(() => undefined, () => undefined);
      }
      const attestation = attestationNeeded
        ? { place: attPlace, date: attDate, signed: attestationDone }
        : null;
      const designation = [oro.vehicle?.brand, oro.vehicle?.model, oro.vehicle?.model_year ? `(${oro.vehicle.model_year})` : '']
        .filter(Boolean).join(' ') || (oro.number ?? 'Reprise');
      await validateReprise({
        companyId, oroId: oro.id, oroNumber: oro.number ?? oro.id,
        vehicleId: oro.vehicle!.id, designation, data, attestation,
      });
      // PDF d'archive (sans prix de vente) → GED véhicule + client
      const blob = await buildValidationPdf({
        number: oro.number ?? '',
        client: {
          name: [clientForm.first_name, clientForm.last_name].filter(Boolean).join(' ') || clientForm.company_name,
          company: clientForm.company_name, email: clientForm.email, phone: clientForm.phone,
          address: [clientForm.address, clientForm.zip, clientForm.city].filter(Boolean).join(', '),
        },
        vehicle: {
          label: designation, vin: oro.vehicle?.vin,
          mileage: oro.vehicle?.mileage, displacement: oro.vehicle?.displacement,
          power: oro.vehicle?.power_cv != null ? `${oro.vehicle.power_cv} cv` : null,
          firstRegistration: oro.vehicle?.first_registration_date ?? null,
        },
        data, attestation,
      });
      const targets: { entityType: 'vehicle' | 'contact'; entityId: string }[] = [];
      if (oro.vehicle) targets.push({ entityType: 'vehicle', entityId: oro.vehicle.id });
      if (contactId) targets.push({ entityType: 'contact', entityId: contactId });
      await attachPdfToGed(companyId, blob, `Reprise_${oro.number ?? oro.id}.pdf`, targets, 'Reprise-Fiche', t('tradein.valPdfTitle'));
    },
    onSuccess: () => {
      toast.success(t('tradein.valDone'));
      qc.invalidateQueries({ queryKey: ['oro-full', oro.id] });
      qc.invalidateQueries({ queryKey: ['oro'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      onDone();
      onOpenChange(false);
    },
    onError: () => toast.error(t('tradein.valError')),
  });

  const trySubmit = () => {
    if (belowMinimum(num(salePrice), num(minPrice))) setMinAlertOpen(true);
    else finish.mutate();
  };

  const notifyDomenico = () => {
    const subject = encodeURIComponent(`${t('tradein.minAlertMailSubject')} ${oro.number ?? ''}`);
    const body = encodeURIComponent(
      `${t('tradein.minAlertMailBody')}\n\n${oro.number ?? ''} — ${oro.vehicle?.brand ?? ''} ${oro.vehicle?.model ?? ''}\n` +
      `${t('tradein.valSalePrice')} : ${num(salePrice).toFixed(2)} €\n${t('tradein.valMinPrice')} : ${num(minPrice).toFixed(2)} €`,
    );
    window.open(`mailto:${MIN_PRICE_ALERT_EMAIL}?subject=${subject}&body=${body}`, '_blank');
  };

  const stepTitle = step === 1 ? t('tradein.valStep1Title') : step === 2 ? t('tradein.valStep2Title') : t('tradein.valStep3Title');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('tradein.valTitle')} {oro.number ?? ''} — {step}/3</DialogTitle>
          <DialogDescription>{stepTitle}</DialogDescription>
        </DialogHeader>

        {/* ── Fenêtre 1 : checklist de réception ─────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-[14px] font-bold uppercase">{t('tradein.valStep1Title')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CHECKLIST_KEYS.map((key) => (
                <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 hover:bg-accent">
                  <Checkbox
                    checked={checklist[key]}
                    onCheckedChange={(v) => setChecklist((c) => ({ ...c, [key]: v === true }))}
                  />
                  <span className="text-[13px]">{t(`tradein.chk_${key}`)}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)}>{t('action.validate')} <ChevronRight /></Button>
            </div>
          </div>
        )}

        {/* ── Fenêtre 2 : données client + carte d'identité + attestation ── */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Recherche d'un autre client */}
            <div className="space-y-1.5">
              <Label>{t('tradein.valPickClient')}</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input className="pl-8" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={t('tradein.valPickClientPh')} />
              </div>
              {(searchRes.data ?? []).length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                  {(searchRes.data ?? []).map((c: ContactRow) => (
                    <button
                      key={c.id} type="button"
                      className="block w-full px-3 py-2 text-left text-[13px] hover:bg-accent"
                      onClick={() => { pickContact(c.id); setSearchQ(''); }}
                    >
                      {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name} {c.code ? `· ${c.code}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Coordonnées (préremplies, modifiables) */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>{t('contacts.firstName')}</Label><Input value={clientForm.first_name} onChange={(e) => setClientForm((f) => ({ ...f, first_name: e.target.value }))} /></div>
              <div><Label>{t('contacts.lastName')}</Label><Input value={clientForm.last_name} onChange={(e) => setClientForm((f) => ({ ...f, last_name: e.target.value.toUpperCase() }))} /></div>
              <div><Label>{t('contacts.companyName')}</Label><Input value={clientForm.company_name} onChange={(e) => setClientForm((f) => ({ ...f, company_name: e.target.value }))} /></div>
              <div><Label>E-mail</Label><Input value={clientForm.email} onChange={(e) => setClientForm((f) => ({ ...f, email: e.target.value }))} /></div>
              <div><Label>{t('contacts.phone')}</Label><Input value={clientForm.phone} onChange={(e) => setClientForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div><Label>{t('contacts.street')}</Label><Input value={clientForm.address} onChange={(e) => setClientForm((f) => ({ ...f, address: e.target.value }))} /></div>
              <div><Label>{t('contacts.zip')}</Label><Input value={clientForm.zip} onChange={(e) => setClientForm((f) => ({ ...f, zip: e.target.value }))} /></div>
              <div><Label>{t('contacts.city')}</Label><Input value={clientForm.city} onChange={(e) => setClientForm((f) => ({ ...f, city: e.target.value.toUpperCase() }))} /></div>
            </div>

            {/* Carte d'identité recto/verso (GED du contact) */}
            {contactId && (
              <div className="grid gap-2">
                <Label>{t('contacts.idCard')}</Label>
                <IdDocsSection
                  companyId={companyId} contactId={contactId} only={['idcard']}
                  current={{
                    first_name: clientForm.first_name, last_name: clientForm.last_name,
                    birth_date: '', national_id: '', national_register: '',
                    license_number: '', license_date: '', license_place: '', license_category: '',
                  }}
                  onApply={(patch) => setClientForm((f) => ({
                    ...f,
                    first_name: patch.first_name ?? f.first_name,
                    last_name: patch.last_name ?? f.last_name,
                  }))}
                />
              </div>
            )}

            {/* Statut TVA du vendeur — changer de statut invalide l'attestation déjà signée */}
            <div className="space-y-1.5">
              <Label>{t('tradein.valSellerStatus')}</Label>
              <Select
                value={sellerStatus}
                onValueChange={(v) => {
                  if (v !== sellerStatus) setAttestationDone(false);
                  setSellerStatus(v as SellerVatStatus);
                }}
              >
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['particulier', 'morale_non_assujettie', 'assujetti_44', 'assujetti_56', 'assujetti'] as const).map((s) => (
                    <SelectItem key={s} value={s}>{t(`tradein.vat_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Attestation TVA marge (si requise) */}
            {attestationNeeded && (
              <div className="space-y-3 rounded-md border border-border bg-card p-3">
                <p className="text-[13px] font-bold">{t('tradein.attTitle')}</p>
                <p className="text-[12px] text-muted-foreground">{t('tradein.attPrefilledHint')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>{t('tradein.attPlace')}</Label><Input value={attPlace} onChange={(e) => setAttPlace(e.target.value.toUpperCase())} /></div>
                  <div><Label>{t('tradein.attDate')}</Label><Input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} /></div>
                </div>
                <div>
                  <Label>{t('tradein.attSignature')}</Label>
                  <SignaturePad onChange={setSignature} />
                </div>
                <Button
                  type="button" variant="outline"
                  onClick={() => signAttestation.mutate()}
                  disabled={!signature || signAttestation.isPending}
                >
                  {signAttestation.isPending ? <Loader2 className="animate-spin" /> : <FileSignature />}
                  {t('tradein.attGenerate')}
                </Button>
                {attestationDone && (
                  <p className="inline-flex items-center gap-1 text-[12px] font-bold text-success">
                    <CheckCircle2 className="size-4" /> {t('tradein.attDone')}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}><ChevronLeft /> {t('action.back')}</Button>
              <Button
                onClick={() => {
                  // N'impose le taux par défaut qu'à la première saisie —
                  // jamais d'écrasement d'un taux déjà choisi (mode Modifier).
                  if (!buyTtc && !buyHt) onVat(defaultVatRate(sellerStatus));
                  setStep(3);
                }}
                disabled={attestationNeeded && !attestationDone}
                title={attestationNeeded && !attestationDone ? t('tradein.attRequired') : undefined}
              >
                {t('action.validate')} <ChevronRight />
              </Button>
            </div>
          </div>
        )}

        {/* ── Fenêtre 3 : montants + classement ──────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t('tradein.valVatRate')}</Label>
                <Select value={String(vatRate)} onValueChange={(v) => onVat(Number(v))}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t('tradein.vatOptMargin')}</SelectItem>
                    <SelectItem value="21">{t('tradein.vatOptPro')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div />
              <PriceField label={t('tradein.valBuyTtc')} value={buyTtc} onChange={onBuyTtc} />
              <PriceField label={t('tradein.valBuyHt')} value={buyHt} onChange={onBuyHt} />
              <PriceField label={t('tradein.valSalePrice')} value={salePrice} onChange={setSalePrice} />
              <PriceField label={t('tradein.valMinPrice')} value={minPrice} onChange={setMinPrice} />
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-[13px] font-bold">{t('tradein.valClassification')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>{t('tradein.clsSupplier')}</Label><Input value={cls.supplier} onChange={(e) => setCls((c) => ({ ...c, supplier: e.target.value }))} /></div>
                <div><Label>{t('tradein.clsRayon')}</Label><Input value={cls.rayon} onChange={(e) => setCls((c) => ({ ...c, rayon: e.target.value }))} /></div>
                <div><Label>{t('tradein.clsSubRayon')}</Label><Input value={cls.sub_rayon} onChange={(e) => setCls((c) => ({ ...c, sub_rayon: e.target.value }))} /></div>
                <div><Label>{t('tradein.clsCategory')}</Label><Input value={cls.category} onChange={(e) => setCls((c) => ({ ...c, category: e.target.value }))} /></div>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}><ChevronLeft /> {t('action.back')}</Button>
              <Button onClick={trySubmit} disabled={finish.isPending}>
                {finish.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                {t('tradein.valFinish')}
              </Button>
            </div>
          </div>
        )}

        {/* Alerte prix sous minimum */}
        <Dialog open={minAlertOpen} onOpenChange={setMinAlertOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-warning">
                <AlertTriangle className="size-5" /> {t('tradein.minAlertTitle')}
              </DialogTitle>
              <DialogDescription>{t('tradein.minAlertBody')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setMinAlertOpen(false)}>{t('tradein.minAlertFix')}</Button>
              <Button variant="outline" onClick={notifyDomenico}><Mail /> {t('tradein.minAlertNotify')}</Button>
              <Button onClick={() => { setMinAlertOpen(false); finish.mutate(); }}>{t('tradein.minAlertProceed')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function PriceField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative">
        <Input
          inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)}
          className="h-11 pr-8 text-right tabular-nums"
        />
        <span className="absolute right-3 top-2.5 text-muted-foreground">€</span>
      </div>
    </div>
  );
}
