/**
 * Popup « 4 pieces manquent pour cet entretien : les mettre en commande ? »
 * (mission 09, carte 3 ; ATE013). Affiche a la prise d'un RDV d'entretien et a l'ouverture
 * d'un OR avec motif entretien : liste (reference, designation, qte, stock, deja en commande),
 * choix Standard (defaut) / Urgente (propose si le RDV est a moins de N jours), bouton
 * « Mettre en commande » → panier du type choisi (ou commande de pieces de repli).
 * Pas de popup si rien ne manque ; les pieces proposees sont memorisees sur l'OR / le RDV
 * et ne sont jamais redemandees (« Pas maintenant » compris).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShoppingCart, PackageSearch, Zap, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t, fillVars } from '@/lib/i18n';
import { fmtQty } from './kits/rules';
import { missingKitParts, suggestedKind, popupNeeded, isMaintenanceReasonCode, type PopupKind, type MissingPart } from './parts-popup-rules';
import { maintenanceKitStock, askedPartKeys, getUrgentWithinDays, logPartsPrompt, addMissingToBasket } from './parts-popup-api';

export type PartsPopupContext = {
  companyId: string;
  vehicleId: string | null;
  contactId?: string | null;
  reasonCode: string | null;
  orId?: string | null;
  orNumber?: string | null;
  appointmentId?: string | null;
  /** date du rendez-vous (ISO) ; absente = la moto est la (OR) */
  appointmentAt?: string | null;
};

/** Calcul des pieces manquantes (vide si le motif n'est pas un entretien). */
export async function computeMissingParts(ctx: PartsPopupContext): Promise<{ missing: MissingPart[]; serviceName: string | null; urgentWithinDays: number }> {
  if (!isMaintenanceReasonCode(ctx.reasonCode) || !ctx.vehicleId) return { missing: [], serviceName: null, urgentWithinDays: 5 };
  const [{ lines, ctx: kit }, asked, urgentWithinDays] = await Promise.all([
    maintenanceKitStock(ctx.companyId, ctx.vehicleId, ctx.reasonCode!),
    askedPartKeys({ orId: ctx.orId, appointmentId: ctx.appointmentId }),
    getUrgentWithinDays(ctx.companyId),
  ]);
  return { missing: missingKitParts(lines, asked), serviceName: kit.serviceName, urgentWithinDays };
}

/**
 * Se monte avec le contexte ; ne rend rien tant que le calcul tourne ou s'il ne manque rien
 * (`onDone` est alors appele tout de suite). Sinon la fenetre s'ouvre.
 */
export function MaintenancePartsPopup({ ctx, onDone }: { ctx: PartsPopupContext; onDone: (result: { ordered: boolean; partOrderId: string | null }) => void }) {
  const qc = useQueryClient();
  const key = ['maintenance-parts-missing', ctx.orId ?? ctx.appointmentId ?? ctx.vehicleId, ctx.reasonCode];
  const q = useQuery({ queryKey: key, queryFn: () => computeMissingParts(ctx), staleTime: 0 });
  const missing = q.data?.missing ?? [];
  const [kind, setKind] = useState<PopupKind | null>(null);
  const [closed, setClosed] = useState(false);
  const suggested = useMemo(
    () => (q.data ? suggestedKind(ctx.appointmentAt ?? null, new Date(), q.data.urgentWithinDays) : 'standard'),
    [q.data, ctx.appointmentAt],
  );
  const chosen = kind ?? suggested;
  const needed = !!q.data && popupNeeded(missing);

  useEffect(() => {
    if (q.data && !needed && !closed) { setClosed(true); onDone({ ordered: false, partOrderId: null }); }
  }, [q.data, needed, closed, onDone]);
  useEffect(() => {
    if (q.error && !closed) { setClosed(true); onDone({ ordered: false, partOrderId: null }); }
  }, [q.error, closed, onDone]);

  const order = useMutation({
    mutationFn: async () => {
      const r = await addMissingToBasket({
        companyId: ctx.companyId, kind: chosen, missing, contactId: ctx.contactId ?? null, vehicleId: ctx.vehicleId,
        orId: ctx.orId ?? null, orNumber: ctx.orNumber ?? null,
        note: fillVars(t('partsPopup.basketNote'), { service: q.data?.serviceName ?? '' }),
      });
      await logPartsPrompt({ companyId: ctx.companyId, orId: ctx.orId, appointmentId: ctx.appointmentId, missing, decision: 'commande', kind: chosen, partOrderId: r.partOrderId });
      return r;
    },
    onSuccess: (r) => {
      toast.success(fillVars(t(r.fallback ? 'partsPopup.addedFallback' : 'partsPopup.added'), { n: r.lines, kind: t(`partsPopup.kind_${chosen}`) }));
      for (const m of [...(r.substituted ?? []), ...(r.refused ?? [])]) toast.warning(m);
      qc.invalidateQueries({ queryKey: ['part-orders'] });
      qc.invalidateQueries({ queryKey: key });
      setClosed(true);
      onDone({ ordered: true, partOrderId: r.partOrderId });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('orders.errGeneric')),
  });

  const later = useMutation({
    mutationFn: () => logPartsPrompt({ companyId: ctx.companyId, orId: ctx.orId, appointmentId: ctx.appointmentId, missing, decision: 'ignore' }),
    onSettled: () => { setClosed(true); qc.invalidateQueries({ queryKey: key }); onDone({ ordered: false, partOrderId: null }); },
  });

  if (closed || !needed) return null;
  const busy = order.isPending || later.isPending;
  const days = ctx.appointmentAt ? Math.max(0, Math.round((new Date(ctx.appointmentAt).getTime() - Date.now()) / 86_400_000)) : 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) later.mutate(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageSearch className="size-5" /> {fillVars(t('partsPopup.title'), { n: missing.length })}
          </DialogTitle>
          <DialogDescription>
            {fillVars(t('partsPopup.intro'), { service: q.data?.serviceName ?? t('partsPopup.serviceUnknown') })}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-data text-[13px]">
            <thead className="bg-muted">
              <tr>
                <Th>{t('partsPopup.colRef')}</Th>
                <Th>{t('partsPopup.colDesignation')}</Th>
                <Th className="text-right">{t('partsPopup.colQty')}</Th>
                <Th className="text-right">{t('partsPopup.colStock')}</Th>
                <Th className="text-right">{t('partsPopup.colOnOrder')}</Th>
                <Th className="text-right">{t('partsPopup.colMissing')}</Th>
              </tr>
            </thead>
            <tbody>
              {missing.map((m) => (
                <tr key={m.articleId ?? m.reference} className="border-b border-border last:border-0">
                  <td className="px-2 py-1 font-mono text-[12px]">{m.reference || '—'}</td>
                  <td className="px-2 py-1">{m.designation}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtQty(m.qtyNeeded)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtQty(Math.max(m.realQty - m.reservedQty, 0))}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtQty(m.onOrderQty)}</td>
                  <td className="px-2 py-1 text-right font-bold tabular-nums text-warning">{fmtQty(m.qtyMissing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('orders.colKind')}</span>
          {(['standard', 'urgente'] as PopupKind[]).map((k) => {
            const Icon = k === 'urgente' ? Zap : Clock;
            return (
              <button
                key={k} type="button" onClick={() => setKind(k)} aria-pressed={chosen === k}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] font-ui transition-colors ${chosen === k ? 'border-ring bg-accent font-bold' : 'border-border hover:bg-accent'}`}
              >
                <Icon className="size-4" /> {t(`partsPopup.kind_${k}`)}
              </button>
            );
          })}
          <span className="text-[12px] text-muted-foreground">
            {suggested === 'urgente'
              ? fillVars(t(ctx.appointmentAt ? 'partsPopup.urgentHint' : 'partsPopup.urgentHintNow'), { days, n: q.data?.urgentWithinDays ?? 5 })
              : fillVars(t('partsPopup.standardHint'), { days, n: q.data?.urgentWithinDays ?? 5 })}
          </span>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => later.mutate()} disabled={busy}>{t('partsPopup.later')}</Button>
          <Button onClick={() => order.mutate()} disabled={busy}>
            {order.isPending ? <Loader2 className="animate-spin" /> : <ShoppingCart />} {t('partsPopup.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-2 py-1.5 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
