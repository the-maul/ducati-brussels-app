/**
 * M8 — Éditeur d'ordre de réparation (OR). En-tête (client, VIN, km, opérateur, motif d'entrée,
 * type, travaux, observations, garantie) + lignes pièces/MO/texte (garantie par ligne) + totaux.
 *
 * Depuis le 31/10 (ATE008 / ATE009) : onglet « Check-up » pensé tablette — une carte par action
 * (état, photo, temps, pièces, prix) — dont les cartes sont des lignes de l'OR réunies par
 * `checkup_key` (règles pures : `checkup/rules.ts`). Un seul état de lignes : les lignes
 * classiques ici, les cartes dans l'onglet ; à l'enregistrement, les deux sont réécrites ensemble.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Search, X, Save, ClipboardCheck, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listContacts, contactDisplayName, type Contact } from '@/modules/contacts/api';
import { LinkedLines, useLinkedBrief } from '@/modules/contacts/linked-line';
import { searchSaleArticles, type SaleArticle } from '@/modules/sales/write-api';
import { searchVehicles, type VehicleLite, type RepairOrderFull } from './api';
import { computeRoTotals, type RoLineInput } from './write-api';
import { loadHourlyRateHt } from './maintenance-api';
import { listWorkshopReasons } from './checkup/api';
import { cardsToLines, linesToCards, nonCheckupLines, PROPOSED_STATES, type CheckupCard } from './checkup/rules';
import { CheckupTab } from './checkup/checkup-tab';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const STATUSES = ['a_faire', 'en_cours', 'pret'] as const;
const WARRANTY = ['aucune', 'en_attente', 'accepte', 'refus_total', 'refus_partiel'] as const;
const NO_REASON = ' none';

type EditLine = RoLineInput & { _key: string };
let counter = 0;
const blankLine = (): EditLine => ({ _key: `ro${counter++}`, kind: 'piece', article_id: null, designation: '', quantity: 1, unit_price_ht: 0, vat_rate: 21, discount_pct: 0, is_warranty: false });

export type OrPayload = {
  contactId: string | null; vehicleId: string | null; mileage: number | null; operator: string;
  repairType: string; workDescription: string; receptionNotes: string; status: string; warrantyStatus: string;
  expertName: string; expertDate: string; reasonCode: string | null; lines: RoLineInput[];
};

export type OrEditorIntent = 'save' | 'proposal';

export function OrEditor({ companyId, initial, busy, error, onSubmit, checkupReady = false, approvalPending = false, header, proposalActions }: {
  companyId: string; initial?: RepairOrderFull | null; busy: boolean; error?: string | null;
  /** `intent = 'proposal'` : enregistrer puis envoyer la proposition au client. */
  onSubmit: (p: OrPayload, intent: OrEditorIntent) => void;
  /** La migration du check-up est en base (onglet et motif actifs). */
  checkupReady?: boolean;
  /** Accord client en attente : les cartes restent modifiables, le bandeau le rappelle. */
  approvalPending?: boolean;
  /** Bloc affiché au-dessus de l'éditeur (accord client). */
  header?: ReactNode;
  /** Boutons supplémentaires de la barre du check-up (faire signer, voir la proposition…). */
  proposalActions?: ReactNode;
}) {
  const o = initial?.or;
  const ox = (o ?? null) as (Record<string, unknown> | null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [vehicle, setVehicle] = useState<VehicleLite | null>(o?.vehicle_id ? { id: o.vehicle_id, vin: null, plate: null, brand: null, model: null } : null);
  const [mileage, setMileage] = useState(o?.mileage != null ? String(o.mileage) : '');
  const [operator, setOperator] = useState(o?.operator ?? '');
  const [repairType, setRepairType] = useState(o?.repair_type ?? '');
  const [reasonCode, setReasonCode] = useState<string>((ox?.reason_code as string | null) ?? '');
  const [workDescription, setWork] = useState(o?.work_description ?? '');
  const [receptionNotes, setNotes] = useState(o?.reception_notes ?? '');
  const [status, setStatus] = useState(o?.status && o.status !== 'facture' && o.status !== 'annule' ? o.status : 'a_faire');
  const [warrantyStatus, setWarranty] = useState(o?.warranty_status ?? 'aucune');
  const [expertName, setExpertName] = useState(o?.expert_name ?? '');
  const [expertDate, setExpertDate] = useState(o?.expert_date ?? '');
  const initialLines = useMemo(() => (initial?.lines ?? []) as (RepairOrderFull['lines'][number] & { checkup_key?: string | null; checkup_state?: string | null; photo_path?: string | null; proposal_line_id?: string | null })[], [initial]);
  const [lines, setLines] = useState<EditLine[]>(() => {
    const classic = nonCheckupLines(initialLines);
    return classic.length
      ? classic.map((l) => ({ _key: `ro${counter++}`, kind: l.kind as RoLineInput['kind'], article_id: l.article_id, designation: l.designation, quantity: Number(l.quantity), unit_price_ht: Number(l.unit_price_ht), vat_rate: Number(l.vat_rate), discount_pct: Number(l.discount_pct), is_warranty: l.is_warranty }))
      : [blankLine()];
  });
  const [cards, setCards] = useState<CheckupCard[]>(() => linesToCards(initialLines));
  const [tab, setTab] = useState<'fiche' | 'checkup'>(() => (cards.length > 0 ? 'checkup' : 'fiche'));

  // précharge contact si édition
  const { data: preContact } = useQuery({
    queryKey: ['ro-contact', o?.contact_id], enabled: !!o?.contact_id,
    queryFn: async () => (o?.contact_id ? (await listContacts(companyId, '')).find((c) => c.id === o.contact_id) ?? null : null),
  });
  useEffect(() => { if (preContact) setContact(preContact); }, [preContact]);

  // Motifs d'entrée (Paramètres → Tables) et taux horaire de l'atelier (frais de devis atelier).
  const reasonsQ = useQuery({ queryKey: ['workshop-reasons', companyId], queryFn: () => listWorkshopReasons(companyId), staleTime: 300_000 });
  const rateQ = useQuery({ queryKey: ['maintenance', 'rate', companyId], queryFn: () => loadHourlyRateHt(companyId), staleTime: 300_000 });
  const rate = rateQ.data ?? null;

  const setLine = (k: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l._key === k ? { ...l, ...patch } : l)));
  const removeLine = (k: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l._key !== k) : ls));
  const classicInputs = lines.filter((l) => l.designation.trim() || l.article_id).map(({ _key, ...l }) => l);
  const cardLines = cardsToLines(cards.filter((c) => c.label.trim() || c.parts.length), rate);
  const totals = computeRoTotals([...classicInputs, ...cardLines]);
  const proposedCount = cards.filter((c) => PROPOSED_STATES.includes(c.state) && c.label.trim()).length;

  const payload = (): OrPayload => ({
    contactId: contact?.id ?? null, vehicleId: vehicle?.id ?? null, mileage: mileage ? Math.round(num(mileage)) : null,
    operator, repairType, workDescription, receptionNotes, status, warrantyStatus, expertName, expertDate,
    reasonCode: reasonCode || null,
    lines: [...classicInputs, ...cardLines],
  });

  const fiche = (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('workshop.client')}>
          {contact ? <Picked label={contactDisplayName(contact)} onClear={() => setContact(null)} /> : <ContactPicker companyId={companyId} onPick={setContact} />}
        </Field>
        <Field label={t('workshop.vehicle')}>
          {vehicle ? <Picked label={[vehicle.vin, vehicle.model].filter(Boolean).join(' ') || vehicle.id.slice(0, 8)} onClear={() => setVehicle(null)} /> : <VehiclePicker companyId={companyId} onPick={setVehicle} />}
        </Field>
        <Field label={t('workshop.mileage')}><Input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} className="text-right tabular-nums" /></Field>
        {checkupReady && (
          <Field label={t('checkup.reason')}>
            <Select value={reasonCode || NO_REASON} onValueChange={(v) => setReasonCode(v === NO_REASON ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('checkup.reasonPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REASON}>{t('checkup.reasonNone')}</SelectItem>
                {(reasonsQ.data ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label={t('workshop.operator')}><Input value={operator} onChange={(e) => setOperator(e.target.value)} /></Field>
        <Field label={t('workshop.repairType')}><Input value={repairType} onChange={(e) => setRepairType(e.target.value)} /></Field>
        <Field label={t('workshop.status')}>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`workshop.status_${s}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('workshop.warranty')}>
          <Select value={warrantyStatus} onValueChange={setWarranty}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{WARRANTY.map((w) => <SelectItem key={w} value={w}>{t(`workshop.warranty_${w}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('workshop.expertName')}><Input value={expertName} onChange={(e) => setExpertName(e.target.value)} /></Field>
        <Field label={t('workshop.expertDate')}><Input type="date" value={expertDate} onChange={(e) => setExpertDate(e.target.value)} /></Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('workshop.workDescription')}><Textarea value={workDescription} onChange={(e) => setWork(e.target.value)} rows={3} /></Field>
        <Field label={t('workshop.receptionNotes')}><Textarea value={receptionNotes} onChange={(e) => setNotes(e.target.value)} rows={3} /></Field>
      </div>

      {/* Lignes */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>
            <Th className="w-28">{t('workshop.colKind')}</Th><Th>{t('workshop.colDesignation')}</Th>
            <Th className="w-20 text-right">{t('workshop.colQty')}</Th><Th className="w-28 text-right">{t('workshop.colPuHt')}</Th>
            <Th className="w-20 text-right">{t('workshop.colVat')}</Th><Th className="w-20 text-right">{t('workshop.colDiscount')}</Th>
            <Th className="w-24 text-right">{t('workshop.colLineHt')}</Th><Th className="w-20 text-center">{t('workshop.warrantyLine')}</Th><Th className="w-10" />
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const ht = l.quantity * (l.is_warranty ? 0 : l.unit_price_ht) * (1 - (l.discount_pct || 0) / 100);
              return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td className="px-2 py-1">
                    <Select value={l.kind} onValueChange={(v) => setLine(l._key, { kind: v as RoLineInput['kind'] })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="piece">{t('workshop.kind_piece')}</SelectItem><SelectItem value="mo">{t('workshop.kind_mo')}</SelectItem><SelectItem value="texte">{t('workshop.kind_texte')}</SelectItem></SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1 min-w-[180px]">
                    {l.article_id || l.kind !== 'piece'
                      ? <Input value={l.designation} onChange={(e) => setLine(l._key, { designation: e.target.value })} className="h-8" />
                      : <ArticlePicker companyId={companyId} value={l.designation} onText={(v) => setLine(l._key, { designation: v })} onPick={(a) => setLine(l._key, { article_id: a.id, designation: a.designation, unit_price_ht: a.sale_price_ht, vat_rate: a.vat_rate })} />}
                  </td>
                  <td className="px-2 py-1"><Input type="number" step="0.01" value={String(l.quantity)} onChange={(e) => setLine(l._key, { quantity: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.01" value={String(l.unit_price_ht)} onChange={(e) => setLine(l._key, { unit_price_ht: num(e.target.value) })} disabled={l.is_warranty} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.vat_rate)} onChange={(e) => setLine(l._key, { vat_rate: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.discount_pct)} onChange={(e) => setLine(l._key, { discount_pct: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-3 py-1 text-right tabular-nums">{eur(ht)}</td>
                  <td className="px-2 py-1 text-center"><input type="checkbox" checked={l.is_warranty} onChange={(e) => setLine(l._key, { is_warranty: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" title={t('workshop.warrantyHint')} /></td>
                  <td className="px-2 py-1 text-center"><Button size="sm" variant="ghost" onClick={() => removeLine(l._key)}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cards.length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {t('checkup.linesFromCheckup').replace('{n}', String(cards.length))}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus /> {t('workshop.addLine')}</Button>
        <div className="flex gap-5 rounded-md border border-border bg-card px-4 py-2 font-data text-sm tabular-nums">
          <span>{t('workshop.totalHt')} <b>{eur(totals.total_ht)}</b></span>
          <span className="text-muted-foreground">{t('workshop.totalVat')} {eur(totals.total_vat)}</span>
          <span className="text-base">{t('workshop.totalTtc')} <b>{eur(totals.total_ttc)}</b></span>
        </div>
      </div>

      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end"><Button onClick={() => onSubmit(payload(), 'save')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t('workshop.save')}</Button></div>
    </div>
  );

  // Nouvel OR ou migration absente : pas d'onglet Check-up (il faut un OR enregistré pour les photos).
  if (!checkupReady || !o) return <div className="space-y-4">{header}{fiche}</div>;

  return (
    <div className="space-y-4">
      {header}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'fiche' | 'checkup')}>
        <TabsList className="h-11">
          <TabsTrigger value="fiche" className="h-9 px-4 text-[14px]"><FileText className="mr-1.5 size-4" /> {t('checkup.tabFiche')}</TabsTrigger>
          <TabsTrigger value="checkup" className="h-9 px-4 text-[14px]">
            <ClipboardCheck className="mr-1.5 size-4" /> {t('checkup.tabCheckup')}
            {proposedCount > 0 && <span className="ml-1.5 rounded-[var(--radius-badge)] bg-warning-bg px-1.5 font-data text-[11px] tabular-nums text-warning">{proposedCount}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="fiche" className="mt-4">{fiche}</TabsContent>
        <TabsContent value="checkup" className="mt-4">
          <CheckupTab
            companyId={companyId} orId={o.id} vehicleId={vehicle?.id ?? null} reasonCode={reasonCode || null}
            cards={cards} onChange={setCards} rate={rate} rateLoading={rateQ.isLoading}
            busy={busy} error={error} approvalPending={approvalPending}
            hasClient={!!contact}
            onSave={() => onSubmit(payload(), 'save')}
            onSendProposal={() => onSubmit(payload(), 'proposal')}
            extraActions={proposalActions}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Picked({ label, onClear }: { label: string; onClear: () => void }) {
  return <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"><span className="truncate">{label}</span><button type="button" onClick={onClear} className="ml-auto text-muted-foreground hover:text-danger"><X className="size-4" /></button></div>;
}
function ContactPicker({ companyId, onPick }: { companyId: string; onPick: (c: Contact) => void }) {
  const [term, setTerm] = useState(''); const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['ro-cpick', companyId, deb], queryFn: () => listContacts(companyId, deb), enabled: deb.length >= 2 });
  // Fiches liees des resultats affiches, en un appel (retour du 05/10).
  const linkedByContact = useLinkedBrief((data ?? []).slice(0, 8).map((c) => c.id));
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('workshop.clientPlaceholder')} className="h-9 pl-9" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.slice(0, 8).map((c) => (
            <div key={c.id} className="border-b border-border last:border-0">
              <button type="button" onClick={() => onPick(c)} className="block w-full px-3 pt-2 text-left text-sm hover:bg-accent">{contactDisplayName(c)}</button>
              {/* Fiche liee sous la ligne, en plus clair (retour du 05/10). */}
              <div className="px-3 pb-1.5"><LinkedLines links={linkedByContact.get(c.id)} clickable={false} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function VehiclePicker({ companyId, onPick }: { companyId: string; onPick: (v: VehicleLite) => void }) {
  const [term, setTerm] = useState(''); const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['ro-vpick', companyId, deb], queryFn: () => searchVehicles(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('workshop.vehiclePlaceholder')} className="h-9 pl-9" />
      {data && data.length > 0 && deb.length >= 2 && <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">{data.map((v) => <button key={v.id} type="button" onClick={() => onPick(v)} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"><span className="font-mono text-[12px]">{v.vin ?? v.plate ?? '—'}</span> {[v.brand, v.model].filter(Boolean).join(' ')}</button>)}</div>}
    </div>
  );
}
export function ArticlePicker({ companyId, value, onText, onPick, className = 'h-8' }: { companyId: string; value: string; onText: (v: string) => void; onPick: (a: SaleArticle) => void; className?: string }) {
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(value.trim()), 250); return () => clearTimeout(id); }, [value]);
  const { data } = useQuery({ queryKey: ['ro-apick', companyId, deb], queryFn: () => searchSaleArticles(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Input value={value} onChange={(e) => onText(e.target.value)} placeholder={t('workshop.articlePlaceholder')} className={className} />
      {data && data.length > 0 && deb.length >= 2 && <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">{data.map((a) => <button key={a.id} type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"><span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span></button>)}</div>}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
