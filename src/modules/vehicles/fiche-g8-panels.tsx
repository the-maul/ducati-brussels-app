/**
 * Rattrapage G8 (18/11/2026, lot parc) — fiche moto, ce que la fiche produit fini de G8 a en plus :
 *  - Proprietaire / Detenteur / Utilisateur (3 tiers, fleche « recopier le proprietaire ») ;
 *  - Bilan economique (PA net, prix de revient, PV HT / TVA / TTC, marge previsionnelle EUR et %, cote) ;
 *  - Primes et aides (date, montant, commentaire) + liste des primes du parc par periode.
 * Migration 20261118141000 ; sans elle, message clair et rien n'est perdu en silence.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowDown, Loader2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t, fillVars } from '@/lib/i18n';
import { ContactPicker } from '@/modules/sales/document-editor';
import { contactDisplayName, getContact, type Contact } from '@/modules/contacts/api';
import { getArticle } from '@/modules/articles/api';
import type { Vehicle } from './api';
import { vehicleEconomics, bonusesInPeriod, daysInStockOf } from './economics';
import {
  addVehicleBonus, deleteVehicleBonus, listBonusesForPeriod, listVehicleBonuses, setVehicleParties,
} from './fiche-g8-api';

const eur = (n: number | null | undefined) =>
  n == null ? '—' : `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!,))/g, ' ')} €`;
const today = () => new Date().toISOString().slice(0, 10);

type VehicleG8 = Vehicle & {
  holder_contact_id?: string | null; user_contact_id?: string | null; market_value?: number | null; warranty_months?: number | null;
};

/* ------------------------------------------------------------------ Proprietaire / detenteur / utilisateur */
export function VehiclePartiesPanel({ companyId, vehicle, currentOwnerId }: { companyId: string; vehicle: Vehicle; currentOwnerId: string | null }) {
  const v = vehicle as VehicleG8;
  const qc = useQueryClient();
  const [holder, setHolder] = useState<string | null>(v.holder_contact_id ?? null);
  const [user, setUser] = useState<string | null>(v.user_contact_id ?? null);
  const dirty = holder !== (v.holder_contact_id ?? null) || user !== (v.user_contact_id ?? null);
  const m = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => setVehicleParties(vehicle.id, { holderId: holder, userId: user }),
    onSuccess: () => { toast.success(t('feedback.saved')); qc.invalidateQueries({ queryKey: ['vehicle', vehicle.id] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <PartyField companyId={companyId} label={t('parcG8.owner')} contactId={currentOwnerId} readOnly hint={t('parcG8.ownerHint')} />
        <PartyField companyId={companyId} label={t('parcG8.holder')} contactId={holder} onChange={setHolder}
          onCopyOwner={currentOwnerId ? () => setHolder(currentOwnerId) : undefined} />
        <PartyField companyId={companyId} label={t('parcG8.user')} contactId={user} onChange={setUser}
          onCopyOwner={currentOwnerId ? () => setUser(currentOwnerId) : undefined} />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => m.mutate()} disabled={!dirty || m.isPending}>
          {m.isPending && <Loader2 className="animate-spin" />} {t('action.save')}
        </Button>
      </div>
    </div>
  );
}

function PartyField({ companyId, label, contactId, onChange, onCopyOwner, readOnly, hint }: {
  companyId: string; label: string; contactId: string | null; onChange?: (id: string | null) => void;
  onCopyOwner?: () => void; readOnly?: boolean; hint?: string;
}) {
  const q = useQuery({ queryKey: ['contact-lite', contactId], queryFn: () => getContact(contactId!), enabled: !!contactId, staleTime: 300_000 });
  const c = q.data as Contact | null | undefined;
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
        {onCopyOwner && !readOnly && (
          <button type="button" onClick={onCopyOwner} title={t('parcG8.copyOwner')} className="text-muted-foreground hover:text-foreground">
            <ArrowDown className="size-3.5" />
          </button>
        )}
      </Label>
      {contactId ? (
        <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
          {c ? <Link to="/clients/$contactId" params={{ contactId }} className="truncate font-medium text-primary hover:underline">{contactDisplayName(c)}</Link>
            : <span className="text-muted-foreground">…</span>}
          {!readOnly && onChange && (
            <button type="button" onClick={() => onChange(null)} className="ml-auto text-muted-foreground hover:text-danger"><X className="size-4" /></button>
          )}
        </div>
      ) : readOnly ? (
        <p className="flex h-9 items-center text-sm text-muted-foreground">{t('motoClient.noOwner')}</p>
      ) : (
        <ContactPicker companyId={companyId} onPick={(x) => onChange?.(x.id)} />
      )}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ Bilan economique */
export function VehicleEconomicsPanel({ vehicle }: { vehicle: Vehicle }) {
  const v = vehicle as VehicleG8;
  const art = useQuery({ queryKey: ['article', v.article_id], queryFn: () => getArticle(v.article_id!), enabled: !!v.article_id });
  const bonuses = useQuery({ queryKey: ['vehicle-bonuses', v.id], queryFn: () => listVehicleBonuses(v.id) });
  const a = art.data;
  const saleTtc = v.display_price ?? (a?.sale_price_ttc ? Number(a.sale_price_ttc) : null);
  const e = vehicleEconomics({
    mgmtType: a?.mgmt_type ?? null, purchasePrice: v.purchase_price, costPrice: v.cost_price, saleTtc,
    vatRate: a?.mgmt_type === 'O' ? 21 : a?.vat_rate != null ? Number(a.vat_rate) : 21,
    bonuses: bonusesInPeriod(bonuses.data ?? []).total, marketValue: v.market_value ?? null,
  });
  const days = daysInStockOf(v.entry_date, v.sold_date);
  const rows: [string, string, boolean?][] = [
    [t('parcG8.ecoPurchase'), eur(e.purchase)],
    [t('parcG8.ecoCost'), eur(e.cost)],
    [t('parcG8.ecoSaleHt'), eur(e.saleHt)],
    [e.scheme === 'marge' ? t('parcG8.ecoVatMargin') : t('parcG8.ecoVat'), eur(e.vat)],
    [t('parcG8.ecoSaleTtc'), eur(e.saleTtc)],
    [t('parcG8.ecoMargin'), e.margin == null ? '—' : `${eur(e.margin)}${e.marginPct != null ? ` (${String(e.marginPct).replace('.', ',')} %)` : ''}`, true],
    [t('parcG8.ecoBonuses'), eur(e.bonuses)],
    [t('parcG8.ecoMarginBonuses'), eur(e.marginWithBonuses), true],
    [t('parcG8.ecoMarket'), eur(e.marketValue)],
    [t('parcG8.ecoGapMarket'), eur(e.gapToMarket)],
    [t('vehicles.daysInStock'), days == null ? '—' : String(days)],
  ];
  return (
    <div className="space-y-2">
      {e.scheme === 'depot' && <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('parcG8.ecoDepot')}</p>}
      {e.scheme === 'marge' && <p className="text-[12px] text-muted-foreground">{t('parcG8.ecoMargeHint')}</p>}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, val, strong]) => (
          <div key={k} className="flex items-baseline justify-between border-b border-border py-1 text-sm last:border-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={`font-data tabular-nums ${strong ? 'font-bold' : ''}`}>{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ Primes et aides */
export function VehicleBonusesPanel({ companyId, vehicleId }: { companyId: string; vehicleId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['vehicle-bonuses', vehicleId], queryFn: () => listVehicleBonuses(vehicleId) });
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const inv = () => qc.invalidateQueries({ queryKey: ['vehicle-bonuses', vehicleId] });
  const add = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => addVehicleBonus({ companyId, vehicleId, date, amount: Number(amount.replace(',', '.')), comment }),
    onSuccess: () => { setAmount(''); setComment(''); inv(); toast.success(t('parcG8.bonusAdded')); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const del = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => deleteVehicleBonus(id),
    onSuccess: inv,
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const rows = q.data ?? [];
  const total = bonusesInPeriod(rows).total;
  const amountOk = Number.isFinite(Number(amount.replace(',', '.'))) && Number(amount.replace(',', '.')) !== 0;
  return (
    <div className="space-y-3">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('parcG8.noBonus')}</p> : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr>
              <th className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('parcG8.bonusDate')}</th>
              <th className="px-3 py-2 text-right font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('parcG8.bonusAmount')}</th>
              <th className="px-3 py-2 text-left font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('parcG8.bonusComment')}</th>
              <th className="w-10" />
            </tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-[12px]">{b.bonus_date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(b.amount)}</td>
                  <td className="px-3 py-2">{b.comment ?? ''}</td>
                  <td className="px-2 py-1 text-right"><Button size="sm" variant="ghost" onClick={() => del.mutate(b.id)} disabled={del.isPending}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              ))}
              <tr className="bg-muted/50"><td className="px-3 py-2 font-bold">{t('parcG8.total')}</td><td className="px-3 py-2 text-right font-bold tabular-nums">{eur(total)}</td><td colSpan={2} /></tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
        <div className="space-y-1"><Label className="text-[12px]">{t('parcG8.bonusDate')}</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" /></div>
        <div className="space-y-1"><Label className="text-[12px]">{t('parcG8.bonusAmount')}</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-32 text-right tabular-nums" /></div>
        <div className="min-w-[200px] flex-1 space-y-1"><Label className="text-[12px]">{t('parcG8.bonusComment')}</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        <Button onClick={() => add.mutate()} disabled={!amountOk || !date || add.isPending}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('parcG8.addBonus')}</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Liste des primes par periode */
export function BonusesPeriodDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const y = new Date().getFullYear();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(today());
  const q = useQuery({ queryKey: ['bonuses-period', companyId, from, to], queryFn: () => listBonusesForPeriod(companyId, from, to), enabled: !!from && !!to });
  const rows = q.data ?? [];
  const total = bonusesInPeriod(rows).total;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{t('parcG8.bonusList')}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label className="text-[12px]">{t('parcG8.from')}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
          <div className="space-y-1"><Label className="text-[12px]">{t('parcG8.to')}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
          <span className="ml-auto font-data text-sm tabular-nums">{fillVars(t('parcG8.bonusListTotal'), { n: rows.length })} <b>{eur(total)}</b></span>
        </div>
        {q.isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" />
          : q.error ? <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(q.error as Error).message}</p>
          : rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('parcG8.noBonus')}</p> : (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="sticky top-0 bg-muted"><tr>
                {[t('parcG8.bonusDate'), t('vehicles.model'), t('vehicles.vin'), t('parcG8.bonusAmount'), t('parcG8.bonusComment')].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-ui text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[12px]">{b.bonus_date}</td>
                    <td className="px-3 py-2">
                      <Link to="/vehicles/$vehicleId" params={{ vehicleId: b.vehicle_id }} className="text-primary hover:underline" onClick={onClose}>
                        {[b.vehicle?.brand, b.vehicle?.model].filter(Boolean).join(' ') || '—'}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px]">{b.vehicle?.vin ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(b.amount)}</td>
                    <td className="px-3 py-2">{b.comment ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
