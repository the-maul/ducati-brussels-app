import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/lib/auth/auth-context';
import {
  listPickings, getPicking, createPickingFromDocument, createEmptyPicking, addPickingItem,
  updatePickedQty, setPickingLocation, setPickingStatus,
  type PickingListRow, type PickingItem, type PickingStatus, type PickingItemStatus,
} from '@/modules/sales/picking-api';
import { listDocuments, type DocumentRow } from '@/modules/sales/write-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/picking')({
  head: () => ({ meta: [{ title: 'Picking list — Ducati Bruxelles' }] }),
  component: PickingPage,
});

const LOCATIONS = ['Buanderie', 'G.ET.C', 'P.ET.C', 'ET@'] as const;
const OTHER_SENTINEL = '__autre__';

const PICKING_STATUS_TONE: Record<PickingStatus, StatusTone> = { en_cours: 'warning', pret: 'success', livre: 'neutral' };
const ITEM_STATUS_TONE: Record<PickingItemStatus, StatusTone> = { a_preparer: 'neutral', partiel: 'warning', pret: 'success', a_recevoir: 'info' };

function PickingPage() {
  const { activeCompanyId } = useAuth();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['picking-lists', activeCompanyId],
    queryFn: () => listPickings(activeCompanyId!),
    enabled: !!activeCompanyId,
  });

  return (
    <>
      <PageHeader
        title={t('picking.title')}
        description={t('picking.subtitle')}
        actions={<Button onClick={() => setNewOpen(true)}><Plus /> {t('picking.new')}</Button>}
      />

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('picking.colDocument')}</Th>
              <Th>{t('picking.colLocation')}</Th>
              <Th>{t('picking.colStatus')}</Th>
              <Th className="text-right">{t('picking.colProgress')}</Th>
              <Th>{t('picking.colDate')}</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('picking.listEmpty')}</td></tr>}
            {data?.map((p) => <PickingRow key={p.id} picking={p} onOpen={() => setDetailId(p.id)} />)}
          </tbody>
        </table>
      </div>

      {newOpen && (
        <NewPickingDialog
          companyId={activeCompanyId!}
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            qc.invalidateQueries({ queryKey: ['picking-lists', activeCompanyId] });
            setNewOpen(false);
            setDetailId(id);
          }}
        />
      )}

      {detailId && (
        <PickingDetailDialog
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ['picking-lists', activeCompanyId] })}
        />
      )}
    </>
  );
}

function PickingRow({ picking, onOpen }: { picking: PickingListRow; onOpen: () => void }) {
  const { data: items } = useQuery({
    queryKey: ['picking-items', picking.id],
    queryFn: () => getPicking(picking.id).then((r) => r.items),
  });
  const total = items?.length ?? 0;
  const ready = items?.filter((i) => i.status === 'pret').length ?? 0;
  return (
    <tr onClick={onOpen} className="cursor-pointer border-b border-border last:border-0 hover:bg-accent">
      <td className="px-3 py-2 font-mono text-[12px]">
        {picking.document_number ? `${t(`sales.type_${picking.document_type}`)} ${picking.document_number}` : t('picking.noDocument')}
      </td>
      <td className="px-3 py-2">{picking.location || '—'}</td>
      <td className="px-3 py-2"><StatusBadge tone={PICKING_STATUS_TONE[picking.status]} label={t(`picking.status${cap(picking.status)}`)} /></td>
      <td className="px-3 py-2 text-right tabular-nums">{ready} / {total}</td>
      <td className="px-3 py-2 font-mono text-[12px]">{picking.created_at.slice(0, 10)}</td>
    </tr>
  );
}

function cap(s: string): string {
  return s.replace(/(^|_)([a-z])/g, (_, sep, c: string) => c.toUpperCase());
}

function NewPickingDialog({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [source, setSource] = useState<'document' | 'empty'>('document');
  const [documentId, setDocumentId] = useState('');
  const [location, setLocation] = useState('');
  const [otherLocation, setOtherLocation] = useState('');

  const { data: documents } = useQuery({
    queryKey: ['sales-documents-for-picking', companyId],
    queryFn: () => listDocuments(companyId),
    enabled: !!companyId,
  });

  const resolvedLocation = location === OTHER_SENTINEL ? otherLocation : location;

  const createMut = useMutation({
    mutationFn: () => source === 'document'
      ? createPickingFromDocument(companyId, documentId, resolvedLocation)
      : createEmptyPicking(companyId, resolvedLocation),
    onSuccess: (id) => { toast.success(t('picking.created')); onCreated(id); },
    onError: () => toast.error(t('picking.errCreate')),
  });

  const canCreate = source === 'empty' || !!documentId;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('picking.newTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('picking.sourceLabel')}</Label>
            <RadioGroup value={source} onValueChange={(v) => setSource(v as 'document' | 'empty')} className="gap-2">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="document" /> {t('picking.fromDocument')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="empty" /> {t('picking.empty')}
              </label>
            </RadioGroup>
          </div>

          {source === 'document' && (
            <div className="space-y-1.5">
              <Label>{t('picking.document')}</Label>
              <Select value={documentId} onValueChange={setDocumentId}>
                <SelectTrigger><SelectValue placeholder={t('picking.documentPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  {documents?.map((d: DocumentRow) => (
                    <SelectItem key={d.id} value={d.id}>
                      {t(`sales.type_${d.doc_type}`)} {d.number ?? '—'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t('picking.location')}</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger><SelectValue placeholder={t('picking.locationPlaceholder')} /></SelectTrigger>
              <SelectContent>
                {LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                <SelectItem value={OTHER_SENTINEL}>{t('picking.locOther')}</SelectItem>
              </SelectContent>
            </Select>
            {location === OTHER_SENTINEL && (
              <Input value={otherLocation} onChange={(e) => setOtherLocation(e.target.value)} placeholder={t('picking.locOtherPlaceholder')} />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => createMut.mutate()} disabled={!canCreate || createMut.isPending}>
            {createMut.isPending ? <Loader2 className="animate-spin" /> : <ClipboardCheck />} {t('picking.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickingDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['picking-detail', id],
    queryFn: () => getPicking(id),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['picking-detail', id] });
    qc.invalidateQueries({ queryKey: ['picking-items', id] });
    onChanged();
  };

  const locationMut = useMutation({
    mutationFn: (loc: string) => setPickingLocation(id, loc),
    onSuccess: () => { toast.success(t('picking.updated')); refresh(); },
    onError: () => toast.error(t('picking.errUpdate')),
  });
  const statusMut = useMutation({
    mutationFn: (s: PickingStatus) => setPickingStatus(id, s),
    onSuccess: () => { toast.success(t('picking.updated')); refresh(); },
    onError: () => toast.error(t('picking.errUpdate')),
  });
  const qtyMut = useMutation({
    mutationFn: ({ itemId, qty }: { itemId: string; qty: number }) => updatePickedQty(itemId, qty),
    onSuccess: () => refresh(),
    onError: () => toast.error(t('picking.errQty')),
  });

  const picking = data?.picking;
  const items = useMemo(() => data?.items ?? [], [data]);
  const [locationDraft, setLocationDraft] = useState<string | null>(null);
  const location = locationDraft ?? picking?.location ?? '';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{t('picking.detailTitle')}</DialogTitle></DialogHeader>

        {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}

        {picking && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>{t('picking.location')}</Label>
                <Input
                  value={location}
                  onChange={(e) => setLocationDraft(e.target.value)}
                  onBlur={() => { if (locationDraft !== null && locationDraft !== picking.location) locationMut.mutate(locationDraft); }}
                  className="w-48"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('picking.globalStatus')}</Label>
                <Select value={picking.status} onValueChange={(v) => statusMut.mutate(v as PickingStatus)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en_cours">{t('picking.statusEnCours')}</SelectItem>
                    <SelectItem value="pret">{t('picking.statusPret')}</SelectItem>
                    <SelectItem value="livre">{t('picking.statusLivre')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" className="ml-auto" onClick={() => setAddOpen(true)}>
                <Plus /> {t('picking.addItem')}
              </Button>
            </div>

            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full border-collapse font-data text-[13px]">
                <thead className="bg-muted">
                  <tr>
                    <Th>{t('picking.colDesignation')}</Th>
                    <Th>{t('picking.colReference')}</Th>
                    <Th className="text-right">{t('picking.qtyOrdered')}</Th>
                    <Th className="text-right">{t('picking.qtyPicked')}</Th>
                    <Th>{t('picking.colStatusItem')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('picking.itemsEmpty')}</td></tr>}
                  {items.map((item) => <ItemRow key={item.id} item={item} onQtyBlur={(qty) => qtyMut.mutate({ itemId: item.id, qty })} />)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.close')}</Button>
        </DialogFooter>
      </DialogContent>

      {addOpen && picking && (
        <AddItemDialog
          pickingId={id} companyId={picking.company_id}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); refresh(); }}
        />
      )}
    </Dialog>
  );
}

function ItemRow({ item, onQtyBlur }: { item: PickingItem; onQtyBlur: (qty: number) => void }) {
  const [qty, setQty] = useState(String(item.qty_picked));
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2">{item.designation || '—'}</td>
      <td className="px-3 py-2 font-mono text-[12px]">{item.reference || '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">{item.qty_ordered}</td>
      <td className="px-3 py-2 text-right">
        <Input
          type="number" min={0} value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => {
            const n = Number(qty);
            if (!Number.isNaN(n) && n !== item.qty_picked) onQtyBlur(n);
          }}
          className="w-24 text-right tabular-nums"
        />
      </td>
      <td className="px-3 py-2"><StatusBadge tone={ITEM_STATUS_TONE[item.status]} label={t(`picking.itemStatus_${item.status}`)} /></td>
    </tr>
  );
}

function AddItemDialog({ pickingId, companyId, onClose, onAdded }: { pickingId: string; companyId: string; onClose: () => void; onAdded: () => void }) {
  const [designation, setDesignation] = useState('');
  const [reference, setReference] = useState('');
  const [qty, setQty] = useState('1');

  const addMut = useMutation({
    mutationFn: () => addPickingItem(pickingId, companyId, { designation, reference, qtyOrdered: Number(qty) || 0 }),
    onSuccess: () => { toast.success(t('picking.itemAdded')); onAdded(); },
    onError: () => toast.error(t('picking.errAddItem')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('picking.addItemTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('picking.itemDesignation')}</Label>
            <Input value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('picking.itemReference')}</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('picking.itemQty')}</Label>
            <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => addMut.mutate()} disabled={!designation.trim() || addMut.isPending}>
            {addMut.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('picking.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
