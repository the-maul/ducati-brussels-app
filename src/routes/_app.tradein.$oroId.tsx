import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Trash2, Lock, Printer, FileDown, Award, CheckCircle2, Pencil, XCircle, FileUp, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { getOroFull, repriseClientLabel } from '@/modules/tradein/api';
import { addOroLine, deleteOroLine, closeOro, type OroLineInput } from '@/modules/tradein/write-api';
import { searchPurchaseArticles, type PurchaseArticle } from '@/modules/purchases/api';
import {
  listOffers, addOffer, deleteOffer, listPartners, partnersForBrand,
  needsFollowUp, buildDispatchMailto,
} from '@/modules/tradein/partners-api';
import { printSheetForOro, downloadSheetForOro } from '@/modules/tradein/sheet-builder';
import { ValidateRepriseDialog } from '@/modules/tradein/validate-dialog';
import { cancelReprise, tradeinStatusOf } from '@/modules/tradein/validate-api';
import { listAttachments, uploadAttachment, deleteAttachment, signedUrl, type Attachment } from '@/modules/documents/ged-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/tradein/$oroId')({
  head: () => ({ meta: [{ title: 'ORO — Ducati Bruxelles' }] }),
  component: OroView,
});

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function OroView() {
  const { oroId } = Route.useParams();
  const { activeCompanyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['oro-full', oroId], queryFn: () => getOroFull(oroId) });
  const offersQ = useQuery({ queryKey: ['oro-offers', oroId], queryFn: () => listOffers(oroId) });

  const [kind, setKind] = useState<'piece' | 'mo' | 'frais'>('piece');
  const [designation, setDesignation] = useState('');
  const [articleId, setArticleId] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['oro-full', oroId] }); qc.invalidateQueries({ queryKey: ['oro', activeCompanyId] }); };

  const add = useMutation({
    mutationFn: () => {
      const l: OroLineInput = { kind, article_id: articleId, designation: designation || '—', quantity: num(qty), unit_cost: num(cost) };
      return addOroLine(oroId, activeCompanyId!, l);
    },
    onSuccess: () => { setDesignation(''); setArticleId(null); setQty('1'); setCost(''); refresh(); },
    onError: (e) => setError(e instanceof Error ? e.message : t('tradein.errSave')),
  });
  const del = useMutation({ mutationFn: (id: string) => deleteOroLine(id, oroId), onSuccess: refresh });
  const close = useMutation({ mutationFn: () => closeOro(oroId), onSuccess: refresh });

  // Fiche de reprise : PDF téléchargé (transmissible) ou impression papier
  const download = useMutation({ mutationFn: () => downloadSheetForOro(oroId) });
  const print = useMutation({ mutationFn: () => printSheetForOro(oroId) });

  // Validation / annulation de la reprise (entrée en stock)
  const [validateOpen, setValidateOpen] = useState(false);
  const cancel = useMutation({
    mutationFn: () => cancelReprise(activeCompanyId!, oroId, data?.oro.number ?? oroId, data?.vehicle?.id ?? null),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: () => setError(t('tradein.errSave')),
  });

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <><PageHeader title="ORO" /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('tradein.notFound')}</p></>;

  const { oro, lines, vehicle, client } = data;
  const reprise = Number(vehicle?.purchase_price ?? 0);
  const oroCost = Number(oro.total_cost);
  const cost_revient = Number(vehicle?.cost_price ?? reprise + oroCost);
  const resale = Number(vehicle?.display_price ?? 0);
  const margin = resale > 0 ? resale - cost_revient : 0;
  const open = oro.status === 'ouvert';
  const offers = offersQ.data ?? [];
  const best = offers.length ? Number(offers[0].amount) : 0;
  const followUp = needsFollowUp(oro.created_at, offers.length, oro.status);
  const tStatus = tradeinStatusOf(oro as unknown as Record<string, unknown>, oroId, vehicle);
  const motoLabel = vehicle
    ? [vehicle.brand, vehicle.model, vehicle.model_year ? `(${vehicle.model_year})` : null].filter(Boolean).join(' ')
    : '';

  return (
    <>
      <PageHeader
        title={`${t('tradein.oroTitle')} ${oro.number ?? ''}`}
        description={[repriseClientLabel(client), motoLabel, vehicle?.vin ?? null].filter((s) => s && s !== '—').join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => download.mutate()} disabled={download.isPending}>
              {download.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} {t('tradein.pdfSheet')}
            </Button>
            <Button variant="outline" onClick={() => print.mutate()} disabled={print.isPending}>
              {print.isPending ? <Loader2 className="animate-spin" /> : <Printer />} {t('tradein.printSheet')}
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/tradein' })}><ArrowLeft /> {t('tradein.back')}</Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusBadge
          tone={tStatus === 'valide' ? 'success' : tStatus === 'annule' ? 'neutral' : 'warning'}
          label={t(`tradein.tstatus_${tStatus}`)}
        />
        {followUp && tStatus === 'ouvert' && <StatusBadge tone="danger" label={t('tradein.followUp')} />}
        <span className="font-data text-sm tabular-nums">{t('tradein.colOffers')} : <b>{offers.length}</b>{offers.length > 0 && <span className="text-muted-foreground"> ({offers.slice(0, 3).map((o) => o.partner_name).filter(Boolean).join(', ')}{offers.length > 3 ? '…' : ''})</span>}</span>
        {best > 0 && <span className="font-data text-sm tabular-nums">{t('tradein.colBest')} : <b>{eur(best)}</b></span>}
        <span className="font-data text-sm tabular-nums">{t('tradein.reprise')} : <b>{eur(reprise)}</b></span>
        <span className="font-data text-sm tabular-nums">{t('tradein.oroCost')} : <b>{eur(oroCost)}</b></span>
        <span className="font-data text-sm tabular-nums">{t('tradein.vehicleCost')} : <b>{eur(cost_revient)}</b></span>
        {resale > 0 && <span className={`font-data text-sm tabular-nums ${margin < 0 ? 'text-danger' : 'text-success'}`}>{t('tradein.margin')} : <b>{eur(margin)}</b></span>}
      </div>

      {/* Validation de la reprise : appel d'offres → entrée en stock */}
      <div className="mb-4 flex flex-wrap gap-2">
        {tStatus !== 'valide' && vehicle && (
          <Button onClick={() => setValidateOpen(true)}>
            <CheckCircle2 /> {t('tradein.valOpen')}
          </Button>
        )}
        {tStatus === 'valide' && vehicle && (
          <Button variant="outline" onClick={() => setValidateOpen(true)}>
            <Pencil /> {t('tradein.valEdit')}
          </Button>
        )}
        {tStatus !== 'annule' && (
          <Button
            variant="outline"
            onClick={() => { if (window.confirm(t('tradein.cancelConfirm'))) cancel.mutate(); }}
            disabled={cancel.isPending}
          >
            {cancel.isPending ? <Loader2 className="animate-spin" /> : <XCircle className="text-danger" />} {t('tradein.valCancel')}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr><Th>{t('tradein.lineKind')}</Th><Th>{t('tradein.lineDesignation')}</Th><Th className="text-right">{t('tradein.lineQty')}</Th><Th className="text-right">{t('tradein.lineCost')}</Th><Th className="text-right">{t('tradein.lineTotal')}</Th><Th className="w-10" /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{t(`tradein.kind_${l.kind}`)}</td>
                <td className="px-3 py-2">{l.designation}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.unit_cost))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(Number(l.line_cost))}</td>
                <td className="px-2 py-1 text-center">{open && <Button size="sm" variant="ghost" onClick={() => del.mutate(l.id)}><Trash2 className="size-4 text-danger" /></Button>}</td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">—</td></tr>}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
          <Field label={t('tradein.lineKind')}>
            <Select value={kind} onValueChange={(v) => setKind(v as 'piece' | 'mo' | 'frais')}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="piece">{t('tradein.kind_piece')}</SelectItem><SelectItem value="mo">{t('tradein.kind_mo')}</SelectItem><SelectItem value="frais">{t('tradein.kind_frais')}</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label={t('tradein.lineDesignation')}>
            {kind === 'piece'
              ? <ArticlePicker companyId={activeCompanyId!} value={designation} onText={(v) => { setDesignation(v); setArticleId(null); }} onPick={(a) => { setArticleId(a.id); setDesignation(`${a.reference} ${a.designation}`); setCost(String(a.purchase_price)); }} />
              : <Input value={designation} onChange={(e) => setDesignation(e.target.value)} className="w-64" />}
          </Field>
          <Field label={t('tradein.lineQty')}><Input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} className="w-20 text-right tabular-nums" /></Field>
          <Field label={t('tradein.lineCost')}><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="w-28 text-right tabular-nums" /></Field>
          <Button onClick={() => add.mutate()} disabled={add.isPending}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('tradein.addLine')}</Button>
        </div>
      )}

      {error && <p className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      {open && (
        <div className="mt-4 flex justify-end">
          <Button variant="destructive" onClick={() => close.mutate()} disabled={close.isPending}>{close.isPending ? <Loader2 className="animate-spin" /> : <Lock />} {t('tradein.closeOro')}</Button>
        </div>
      )}

      <OffersPanel oroId={oroId} companyId={activeCompanyId!} brand={vehicle?.brand ?? null} motoTitle={motoLabel} followUp={followUp} />

      {/* Facture d'achat (reprises professionnelles) — annexable à tout moment */}
      {vehicle && <PurchaseInvoicePanel companyId={activeCompanyId!} vehicleId={vehicle.id} />}

      {vehicle && (
        <ValidateRepriseDialog
          key={String(validateOpen)}
          open={validateOpen}
          onOpenChange={setValidateOpen}
          companyId={activeCompanyId!}
          oro={{
            id: oroId,
            number: oro.number,
            vehicle: {
              id: vehicle.id, vin: vehicle.vin, brand: vehicle.brand, model: vehicle.model,
              model_year: vehicle.model_year, mileage: vehicle.mileage,
              displacement: vehicle.displacement, power_cv: vehicle.power_cv, power_kw: vehicle.power_kw,
              first_registration_date: vehicle.first_registration_date ?? null,
              purchase_price: vehicle.purchase_price, display_price: vehicle.display_price,
            },
          }}
          oroRow={oro as unknown as Record<string, unknown>}
          onDone={refresh}
        />
      )}
    </>
  );
}

/** Facture d'achat PDF (reprise professionnelle) : téléchargement ou glisser-
 *  déposer, annexable même après validation. Stockée en GED du véhicule. */
function PurchaseInvoicePanel({ companyId, vehicleId }: { companyId: string; vehicleId: string }) {
  const qc = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const invoicesQ = useQuery({
    queryKey: ['tradein-invoices', vehicleId],
    queryFn: async () => {
      const atts = await listAttachments('vehicle', vehicleId);
      const invoices = atts.filter((a) => a.folder === 'Facture-achat');
      const out: { att: Attachment; url: string | null }[] = [];
      for (const att of invoices) {
        let url: string | null = null;
        try { url = await signedUrl(att.storage_path); } catch { /* illisible */ }
        out.push({ att, url });
      }
      return out;
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tradein-invoices', vehicleId] });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const ok = file.type === 'application/pdf' || file.type.startsWith('image/');
    if (!ok) return;
    setBusy(true);
    try {
      await uploadAttachment(companyId, 'vehicle', vehicleId, file, Date.now(), t('tradein.invoiceTitle'), 'Facture-achat');
      refresh();
    } catch { toast.error(t('tradein.errSave')); } finally { setBusy(false); }
  };

  return (
    <div className="mt-6">
      <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('tradein.invoiceTitle')}</h2>
      <div
        className={`rounded-md border ${dragOver ? 'border-info bg-info-bg' : 'border-dashed border-border'} p-3`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]); }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] hover:bg-accent">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {t('tradein.invoiceUpload')}
            <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <span className="text-[12px] text-muted-foreground">{t('tradein.invoiceDrop')}</span>
        </div>
        {(invoicesQ.data ?? []).length > 0 && (
          <ul className="mt-3 space-y-1">
            {(invoicesQ.data ?? []).map(({ att, url }) => (
              <li key={att.id} className="flex items-center gap-2 text-[13px]">
                <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-info hover:underline">
                  <ExternalLink className="size-3.5" /> {att.file_name}
                </a>
                <button type="button" onClick={async () => { await deleteAttachment(att); refresh(); }} title={t('action.delete')}>
                  <Trash2 className="size-3.5 text-danger" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Offres des marchands partenaires — triées de la plus haute à la plus basse. */
function OffersPanel({ oroId, companyId, brand, motoTitle, followUp }: { oroId: string; companyId: string; brand: string | null; motoTitle?: string; followUp?: boolean }) {
  const qc = useQueryClient();
  const [partnerId, setPartnerId] = useState<string>('');
  const [partnerName, setPartnerName] = useState('');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');

  const offersQ = useQuery({ queryKey: ['oro-offers', oroId], queryFn: () => listOffers(oroId) });
  const partnersQ = useQuery({ queryKey: ['tradein-partners', companyId], queryFn: () => listPartners(companyId) });
  const partners = partnersForBrand(partnersQ.data ?? [], brand);
  const offers = offersQ.data ?? [];

  const refreshOffers = () => {
    qc.invalidateQueries({ queryKey: ['oro-offers', oroId] });
    qc.invalidateQueries({ queryKey: ['oro-offer-counts', companyId] });
  };
  const add = useMutation({
    mutationFn: () => addOffer(companyId, oroId, { partnerId: partnerId || null, partnerName: partnerName || (partners.find((p) => p.id === partnerId)?.name ?? ''), amount: num(amount), message }),
    onSuccess: () => { setPartnerId(''); setPartnerName(''); setAmount(''); setMessage(''); refreshOffers(); },
  });
  const del = useMutation({ mutationFn: (id: string) => deleteOffer(id), onSuccess: refreshOffers });

  const relanceMailto = buildDispatchMailto(
    partners,
    t('tradein.followUpSubject').replace('{title}', motoTitle || ''),
    `${t('tradein.followUpHint')}\n\n${motoTitle ?? ''}`,
  );

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-ui text-[15px] font-bold text-foreground">{t('tradein.offers')}</h2>
        {followUp && relanceMailto && (
          <Button variant="outline" size="sm" onClick={() => { window.location.href = relanceMailto; }}>
            {t('tradein.followUpBtn')}
          </Button>
        )}
      </div>
      {offers.length === 0
        ? <p className="rounded-md border border-dashed border-border px-3 py-3 text-[13px] text-muted-foreground">{t('tradein.offersNone')}</p>
        : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted"><tr><Th>{t('tradein.offerPartner')}</Th><Th>{t('tradein.offerMessage')}</Th><Th className="text-right">{t('tradein.offerAmount')}</Th><Th className="w-10" /></tr></thead>
              <tbody>
                {offers.map((o, i) => (
                  <tr key={o.id} className={`border-b border-border last:border-0 ${i === 0 ? 'bg-[var(--ducati-red-tint)]' : ''}`}>
                    <td className="px-3 py-2 font-medium">
                      {o.partner_name ?? '—'}
                      {i === 0 && <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--ducati-red)]"><Award className="size-3" />{t('tradein.offerBest')}</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{o.message ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{eur(Number(o.amount))}</td>
                    <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" onClick={() => del.mutate(o.id)}><Trash2 className="size-4 text-danger" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
        <Field label={t('tradein.offerPartner')}>
          {partners.length > 0 ? (
            <Select value={partnerId || undefined} onValueChange={(v) => { setPartnerId(v); setPartnerName(partners.find((p) => p.id === v)?.name ?? ''); }}>
              <SelectTrigger className="w-56"><SelectValue placeholder={t('tradein.wizChoose')} /></SelectTrigger>
              <SelectContent>{partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} className="w-56" placeholder={t('tradein.partnerName')} />
          )}
        </Field>
        <Field label={t('tradein.offerAmount')}><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 text-right tabular-nums" /></Field>
        <Field label={t('tradein.offerMessage')}><Input value={message} onChange={(e) => setMessage(e.target.value)} className="w-64" /></Field>
        <Button onClick={() => add.mutate()} disabled={add.isPending || num(amount) <= 0 || (!partnerId && !partnerName.trim())}>
          {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('tradein.offerAdd')}
        </Button>
      </div>
    </div>
  );
}

function ArticlePicker({ companyId, value, onText, onPick }: { companyId: string; value: string; onText: (v: string) => void; onPick: (a: PurchaseArticle) => void }) {
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(value.trim()), 250); return () => clearTimeout(id); }, [value]);
  const { data } = useQuery({ queryKey: ['oro-art', companyId, deb], queryFn: () => searchPurchaseArticles(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Input value={value} onChange={(e) => onText(e.target.value)} placeholder={t('tradein.articlePlaceholder')} className="w-64" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span>
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
