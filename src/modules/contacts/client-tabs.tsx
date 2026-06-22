/**
 * M1 — Onglets de la fiche client : Parc (VIN liés), Adresses de livraison, Tarifs à paliers.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Plus, Trash2, Bike } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { vehicleLabel, VEHICLE_STATUSES, type VehicleStatus } from '@/modules/vehicles/api';
import {
  listOwnedVehicles, listDeliveryAddresses, upsertDeliveryAddress, deleteDeliveryAddress,
  listClientPriceRules, upsertClientPriceRule, deleteClientPriceRule,
  listSubcontacts, upsertSubcontact, deleteSubcontact,
} from './subobjects-api';
import { getContactEncours, listContactDocuments, listContactDueItems } from '@/modules/sales/api';
import { t } from '@/lib/i18n';

const toneOf = (s: VehicleStatus) => VEHICLE_STATUSES.find((x) => x.value === s)?.tone ?? 'neutral';
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

/* ---------------- Encours (bandeau crédit) ---------------- */
export function EncoursBar({ contactId }: { contactId: string }) {
  const { data } = useQuery({ queryKey: ['encours', contactId], queryFn: () => getContactEncours(contactId) });
  if (!data) return null;
  const over = data.available < 0;
  return (
    <div className="mb-4 grid grid-cols-3 gap-3">
      <div className="rounded-md border border-border bg-card p-3"><div className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">Encours autorisé</div><div className="mt-1 font-data text-xl tabular-nums">{eur(data.authorized)}</div></div>
      <div className="rounded-md border border-border bg-card p-3"><div className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">Encours actuel</div><div className="mt-1 font-data text-xl tabular-nums">{eur(data.current)}</div></div>
      <div className={`rounded-md border p-3 ${over ? 'border-danger/40 bg-danger-bg' : 'border-success/30 bg-success-bg'}`}><div className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">Disponible</div><div className={`mt-1 font-data text-xl tabular-nums ${over ? 'text-danger' : 'text-success'}`}>{eur(data.available)}</div></div>
    </div>
  );
}

/* ---------------- Documents ---------------- */
export function DocumentsTab({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['client-docs', contactId], queryFn: () => listContactDocuments(contactId) });
  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <Empty>Aucun document.</Empty>;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[13px]">
        <thead className="bg-muted"><tr><Th>N°</Th><Th>Type</Th><Th>Date</Th><Th>Statut</Th><Th className="text-right">TTC</Th><Th className="text-right">Réglé</Th></tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent" onClick={() => navigate({ to: '/sales/$documentId', params: { documentId: d.id } })}>
              <td className="px-3 py-2 font-mono text-[12px] text-info underline">{d.number ?? '—'}</td>
              <td className="px-3 py-2">{d.doc_type}</td>
              <td className="px-3 py-2 font-mono text-[12px]">{d.issue_date}</td>
              <td className="px-3 py-2"><StatusBadge tone={d.status === 'payee' ? 'success' : d.status === 'annulee' ? 'neutral' : 'warning'} label={d.status} /></td>
              <td className="px-3 py-2 text-right tabular-nums">{eur(Number(d.total_ttc))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{eur(Number(d.paid_amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Échéances ---------------- */
export function DueItemsTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['client-due', contactId], queryFn: () => listContactDueItems(contactId) });
  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <Empty>Aucune échéance en attente.</Empty>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[13px]">
        <thead className="bg-muted"><tr><Th>N°</Th><Th>Échéance</Th><Th className="text-right">Reste dû</Th><Th>État</Th></tr></thead>
        <tbody>
          {data.map((d) => {
            const due = Number(d.total_ttc) - Number(d.paid_amount);
            const late = d.due_date && d.due_date < today;
            return (
              <tr key={d.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-[12px]">{d.number ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.due_date ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(due)}</td>
                <td className="px-3 py-2">{late ? <StatusBadge tone="danger" label="En retard" /> : <StatusBadge tone="warning" label="À échoir" />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Parc ---------------- */
export function ParcTab({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['client-parc', contactId], queryFn: () => listOwnedVehicles(contactId) });
  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <Empty>Aucun véhicule lié à ce client.</Empty>;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse font-data text-[13px]">
        <thead className="bg-muted"><tr><Th>Véhicule</Th><Th>VIN</Th><Th>Période</Th><Th>Statut</Th></tr></thead>
        <tbody>
          {data.map((o) => (
            <tr key={o.ownerId} onClick={() => navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: o.vehicle.id } })}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
              <td className="px-3 py-2 font-medium"><Bike className="mr-1 inline size-4" />{vehicleLabel(o.vehicle)}</td>
              <td className="px-3 py-2 font-mono text-[12px]">{o.vehicle.vin ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-[12px]">{o.from_date}{o.to_date ? ` → ${o.to_date}` : (o.is_current ? ' · actuel' : '')}</td>
              <td className="px-3 py-2"><StatusBadge tone={toneOf(o.vehicle.status)} label={t(`vehicles.status_${o.vehicle.status}`)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Adresses de livraison ---------------- */
export function DeliveryTab({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['client-deliv', contactId], queryFn: () => listDeliveryAddresses(contactId) });
  const [form, setForm] = useState({ label: '', address: '', zip: '', city: '' });
  const inv = () => qc.invalidateQueries({ queryKey: ['client-deliv', contactId] });
  const add = useMutation({ mutationFn: () => upsertDeliveryAddress({ contact_id: contactId, ...form, country: 'BE' }), onSuccess: () => { inv(); setForm({ label: '', address: '', zip: '', city: '' }); } });
  const del = useMutation({ mutationFn: (id: string) => deleteDeliveryAddress(id), onSuccess: inv });

  if (isLoading) return <Spinner />;
  return (
    <div className="space-y-3">
      {data && data.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>Libellé</Th><Th>Adresse</Th><Th>CP</Th><Th>Ville</Th><Th /></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{a.label ?? '—'}</td><td className="px-3 py-2">{a.address ?? '—'}</td>
                  <td className="px-3 py-2">{a.zip ?? '—'}</td><td className="px-3 py-2">{a.city ?? '—'}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => del.mutate(a.id)}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-5">
        <Input placeholder="Libellé" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        <Input placeholder="Adresse" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        <Input placeholder="CP" value={form.zip} onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))} />
        <Input placeholder="Ville" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
        <Button onClick={() => add.mutate()} disabled={add.isPending || !form.address.trim()}><Plus /> Ajouter</Button>
      </div>
    </div>
  );
}

/* ---------------- Tarifs client à paliers ---------------- */
export function PriceRulesTab({ contactId, companyId }: { contactId: string; companyId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['client-prices', contactId], queryFn: () => listClientPriceRules(contactId) });
  const [form, setForm] = useState({ target_type: 'all', target_value: '', mode: 'discount', value1: '', is_promo: false });
  const inv = () => qc.invalidateQueries({ queryKey: ['client-prices', contactId] });
  const add = useMutation({
    mutationFn: () => upsertClientPriceRule({
      company_id: companyId, contact_id: contactId, target_type: form.target_type, target_value: form.target_value || null,
      mode: form.mode, value1: form.value1 ? Number(form.value1) : null, is_promo: form.is_promo,
    }),
    onSuccess: () => { inv(); setForm({ target_type: 'all', target_value: '', mode: 'discount', value1: '', is_promo: false }); },
  });
  const del = useMutation({ mutationFn: (id: string) => deleteClientPriceRule(id), onSuccess: inv });

  const modeLabel = (m: string) => (m === 'discount' ? 'Remise %' : m === 'net' ? 'Prix net' : 'Coefficient');
  const targetLabel = (ty: string) => ({ all: 'Tout', brand: 'Marque', category: 'Catégorie', reference: 'Référence', supplier: 'Fournisseur' } as Record<string, string>)[ty] ?? ty;

  if (isLoading) return <Spinner />;
  return (
    <div className="space-y-3">
      {data && data.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>Cible</Th><Th>Mode</Th><Th className="text-right">Valeur</Th><Th>Promo</Th><Th /></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{targetLabel(p.target_type)}{p.target_value ? ` : ${p.target_value}` : ''}</td>
                  <td className="px-3 py-2">{modeLabel(p.mode)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.value1 ?? '—'}</td>
                  <td className="px-3 py-2">{p.is_promo ? <StatusBadge tone="warning" label="PROMO" /> : '—'}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => del.mutate(p.id)}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-6">
        <Select value={form.target_type} onValueChange={(v) => setForm((f) => ({ ...f, target_type: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tout</SelectItem><SelectItem value="brand">Marque</SelectItem>
            <SelectItem value="category">Catégorie</SelectItem><SelectItem value="reference">Référence</SelectItem>
            <SelectItem value="supplier">Fournisseur</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Cible (valeur)" value={form.target_value} onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))} />
        <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="discount">Remise %</SelectItem><SelectItem value="net">Prix net</SelectItem><SelectItem value="coef">Coefficient</SelectItem></SelectContent>
        </Select>
        <Input type="number" step="0.01" placeholder="Valeur" value={form.value1} onChange={(e) => setForm((f) => ({ ...f, value1: e.target.value }))} className="text-right tabular-nums" />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.is_promo} onCheckedChange={(v) => setForm((f) => ({ ...f, is_promo: v === true }))} /> Promo</label>
        <Button onClick={() => add.mutate()} disabled={add.isPending || !form.value1.trim()}><Plus /> Ajouter</Button>
      </div>
    </div>
  );
}

/* ---------------- Sous-contacts (interlocuteurs B2B) ---------------- */
export function SubcontactsTab({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['subcontacts', contactId], queryFn: () => listSubcontacts(contactId) });
  const [form, setForm] = useState({ name: '', role: '', phone: '', email: '' });
  const inv = () => qc.invalidateQueries({ queryKey: ['subcontacts', contactId] });
  const add = useMutation({ mutationFn: () => upsertSubcontact({ contact_id: contactId, ...form }), onSuccess: () => { inv(); setForm({ name: '', role: '', phone: '', email: '' }); } });
  const del = useMutation({ mutationFn: (id: string) => deleteSubcontact(id), onSuccess: inv });
  if (isLoading) return <Spinner />;
  return (
    <div className="space-y-3">
      {data && data.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted"><tr><Th>Nom</Th><Th>Fonction</Th><Th>Téléphone</Th><Th>Email</Th><Th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{s.name}</td><td className="px-3 py-2">{s.role ?? '—'}</td>
                  <td className="px-3 py-2">{s.phone ?? '—'}</td><td className="px-3 py-2">{s.email ?? '—'}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => del.mutate(s.id)}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-5">
        <Input placeholder="Nom" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input placeholder="Fonction" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} />
        <Input placeholder="Téléphone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        <Input placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        <Button onClick={() => add.mutate()} disabled={add.isPending || !form.name.trim()}><Plus /> Ajouter</Button>
      </div>
    </div>
  );
}

function Spinner() { return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <div className="rounded-md border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{children}</div>; }
function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
