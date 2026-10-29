/**
 * M8 — Onglet « Check-up » de l'OR, pensé TABLETTE (ATE008 / ATE009, décision client du 30/10) :
 * une colonne de grandes cartes, une par action. Carte = libellé, état (OK / à faire / à prévoir :
 * couleur + icône + libellé), photo (appareil ou galerie, rangée dans la GED de l'OR), temps
 * (proposé par le plan, sinon saisi, heures décimales), pièces (recherche dans les articles),
 * prix calculé (MO = heures x taux horaire HT, pièces = PV). « + Constat » ajoute une carte.
 * Total des actions proposées toujours visible en bas, avec « Envoyer la proposition ».
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, Camera, CheckCircle2, Clock, Image as ImageIcon, Loader2, Plus, Save, Send, Trash2, CalendarClock,
  ListChecks, Wrench, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { SaleArticle } from '@/modules/sales/write-api';
import { ArticlePicker } from '../or-editor';
import { checkupPhotoUrl, prefillFromMaintenancePlan, uploadCheckupPhoto, vehicleMaintenanceDue } from './api';
import {
  CHECKUP_STATES, blankCard, blankPart, cardPrice, cardRate, checkupTotals, isMaintenanceReason, PROPOSED_STATES,
  type CheckupCard, type CheckupPart, type CheckupState,
} from './rules';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const hoursText = (h: number) => String(Math.round(h * 100) / 100).replace('.', ',');

/** Un état du check-up = couleur + icône + libellé (règle 9). Jamais le rouge Ducati. */
const STATE_STYLE: Record<CheckupState, { icon: LucideIcon; tone: 'success' | 'danger' | 'warning' | 'neutral'; active: string }> = {
  ok: { icon: CheckCircle2, tone: 'success', active: 'border-success bg-success-bg text-success' },
  a_faire: { icon: AlertTriangle, tone: 'danger', active: 'border-danger bg-danger-bg text-danger' },
  a_prevoir: { icon: Clock, tone: 'warning', active: 'border-warning bg-warning-bg text-warning' },
  reporte: { icon: CalendarClock, tone: 'neutral', active: 'border-border bg-neutral-bg text-neutral-tag' },
};

export function CheckupTab({
  companyId, orId, vehicleId, reasonCode, cards, onChange, rate, rateLoading, busy, error, approvalPending, hasClient,
  onSave, onSendProposal, extraActions,
}: {
  companyId: string; orId: string; vehicleId: string | null; reasonCode: string | null;
  cards: CheckupCard[]; onChange: (cards: CheckupCard[]) => void;
  rate: number | null; rateLoading: boolean; busy: boolean; error?: string | null; approvalPending: boolean; hasClient: boolean;
  onSave: () => void; onSendProposal: () => void; extraActions?: ReactNode;
}) {
  const totals = checkupTotals(cards, rate);
  const maintenance = isMaintenanceReason(reasonCode);
  const dueQ = useQuery({ queryKey: ['vehicle-maintenance-due', vehicleId], queryFn: () => vehicleMaintenanceDue(vehicleId!), enabled: !!vehicleId, staleTime: 300_000 });

  const update = (key: string, patch: Partial<CheckupCard>) => onChange(cards.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const remove = (key: string) => onChange(cards.filter((c) => c.key !== key));
  const add = () => onChange([...cards, blankCard({ state: 'a_faire', hourly_rate_ht: rate ?? null })]);

  const prefill = useMutation({
    mutationFn: () => prefillFromMaintenancePlan(companyId, vehicleId, reasonCode ?? ''),
    meta: { success: false, error: false },
    onSuccess: (r) => {
      if (r.reason) { toast.info(t(`checkup.prefill_${r.reason}`)); return; }
      onChange([...cards, ...r.cards]);
      toast.success(t('checkup.prefillDone').replace('{n}', String(r.cards.length)).replace('{service}', r.serviceName ?? ''));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('checkup.prefillError')),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-32">
      {/* Bandeau d'aide + prochain entretien + actions de départ */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">{t('checkup.intro')}</p>
        {dueQ.data && (dueQ.data.label || dueQ.data.due_date) && (
          <span className="rounded-md bg-info-bg px-2 py-1 text-[12px] text-info">
            {t('checkup.nextDue')} {dueQ.data.label ?? ''}{dueQ.data.due_date ? ` · ${new Date(`${dueQ.data.due_date}T00:00:00`).toLocaleDateString('fr-BE')}` : ''}{dueQ.data.due_km != null ? ` · ${dueQ.data.due_km} km` : ''}
          </span>
        )}
        {maintenance && (
          <Button type="button" variant="outline" className="h-11 text-[14px]" onClick={() => prefill.mutate()} disabled={prefill.isPending}>
            {prefill.isPending ? <Loader2 className="animate-spin" /> : <ListChecks />} {t('checkup.prefillFromPlan')}
          </Button>
        )}
      </div>
      {rate == null && !rateLoading && (
        <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('checkup.noRate')}</p>
      )}
      {approvalPending && (
        <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('checkup.editWhilePending')}</p>
      )}

      {cards.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-card p-8 text-center">
          <Wrench className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden />
          <p className="text-[15px] font-medium">{t('checkup.emptyTitle')}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('checkup.emptyHint')}</p>
        </div>
      )}

      {cards.map((card, i) => (
        <CheckupCardView
          key={card.key} index={i + 1} card={card} companyId={companyId} orId={orId} rate={rate}
          onChange={(patch) => update(card.key, patch)} onRemove={() => remove(card.key)}
        />
      ))}

      <Button type="button" variant="outline" className="h-14 w-full text-[16px]" onClick={add}>
        <Plus className="size-5" /> {t('checkup.addFinding')}
      </Button>

      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      {/* Barre du bas, toujours visible : total des actions proposées + envoyer */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 px-4 py-3 shadow-[var(--shadow-modal)] backdrop-blur md:left-[var(--sidebar-width,0px)]">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              {t('checkup.totalProposed').replace('{n}', String(totals.count))}
            </p>
            <p className="font-data text-[22px] font-bold tabular-nums leading-tight">
              {eur(totals.ttc)} <span className="text-[13px] font-normal text-muted-foreground">TTC · {eur(totals.ht)} HT</span>
            </p>
          </div>
          {extraActions}
          <Button type="button" variant="outline" className="h-12 text-[15px]" onClick={onSave} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} {t('workshop.save')}
          </Button>
          <Button type="button" className="h-12 text-[15px]" onClick={onSendProposal} disabled={busy || totals.count === 0 || !hasClient}
            title={!hasClient ? t('checkup.needClient') : totals.count === 0 ? t('checkup.needAction') : undefined}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />} {t('checkup.sendProposal')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CheckupCardView({ index, card, companyId, orId, rate, onChange, onRemove }: {
  index: number; card: CheckupCard; companyId: string; orId: string; rate: number | null;
  onChange: (patch: Partial<CheckupCard>) => void; onRemove: () => void;
}) {
  const price = cardPrice(card, rate);
  const appliedRate = cardRate(card, rate);
  const deferred = card.state === 'reporte';
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [hoursText_, setHoursText] = useState(hoursText(card.hours));
  useEffect(() => { setHoursText(hoursText(card.hours)); }, [card.hours]);

  const photo = useMutation({
    mutationFn: (file: File) => uploadCheckupPhoto(companyId, orId, file, card.label),
    meta: { success: false, error: false },
    onSuccess: (path) => onChange({ photo_path: path }),
    onError: (e) => toast.error(e instanceof Error ? e.message : t('ged.errUpload')),
  });
  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) photo.mutate(f);
  };

  const setPart = (key: string, patch: Partial<CheckupPart>) => onChange({ parts: card.parts.map((p) => (p.key === key ? { ...p, ...patch } : p)) });
  const removePart = (key: string) => onChange({ parts: card.parts.filter((p) => p.key !== key) });
  const pickArticle = (key: string, a: SaleArticle) => setPart(key, { article_id: a.id, reference: a.reference, designation: a.designation, unit_price_ht: a.sale_price_ht, vat_rate: a.vat_rate });

  return (
    <div className={cn('rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]', deferred && 'opacity-80')}>
      {/* Libellé */}
      <div className="flex items-start gap-2">
        <span className="mt-2 grid size-8 shrink-0 place-items-center rounded-md bg-muted font-data text-[13px] font-bold tabular-nums text-muted-foreground">{index}</span>
        <Input value={card.label} onChange={(e) => onChange({ label: e.target.value })} placeholder={t('checkup.labelPlaceholder')}
          className="h-12 flex-1 text-[16px] font-medium" disabled={deferred} />
        <Button type="button" variant="ghost" size="icon" className="mt-1 size-10 shrink-0" onClick={onRemove} aria-label={t('checkup.removeCard')} title={t('checkup.removeCard')}>
          <Trash2 className="size-5 text-danger" />
        </Button>
      </div>
      {card.origin === 'plan' && <p className="mt-1 pl-10 text-[12px] text-muted-foreground">{t('checkup.fromPlan')}</p>}

      {/* État : couleur + icône + libellé */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {deferred ? (
          <div className="col-span-3"><StatusBadge tone="neutral" icon={CalendarClock} label={t('checkup.state_reporte')} /></div>
        ) : CHECKUP_STATES.map((s) => {
          const st = STATE_STYLE[s];
          const Icon = st.icon;
          const active = card.state === s;
          return (
            <button key={s} type="button" onClick={() => onChange({ state: s })} aria-pressed={active}
              className={cn('flex h-12 items-center justify-center gap-2 rounded-md border text-[14px] font-medium',
                active ? st.active : 'border-border bg-background text-muted-foreground hover:bg-accent')}>
              <Icon className="size-5 shrink-0" aria-hidden /> {t(`checkup.state_${s}`)}
            </button>
          );
        })}
      </div>

      {card.state !== 'ok' && (
        <>
          {/* Photo */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {card.photo_path && <PhotoThumb path={card.photo_path} onRemove={() => onChange({ photo_path: null })} />}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pickFile} />
            <input ref={galleryRef} type="file" accept="image/*" className="sr-only" onChange={pickFile} />
            <Button type="button" variant="outline" className="h-12 flex-1 text-[14px]" onClick={() => cameraRef.current?.click()} disabled={photo.isPending || deferred}>
              {photo.isPending ? <Loader2 className="animate-spin" /> : <Camera />} {card.photo_path ? t('checkup.retakePhoto') : t('checkup.takePhoto')}
            </Button>
            <Button type="button" variant="outline" className="h-12 text-[14px]" onClick={() => galleryRef.current?.click()} disabled={photo.isPending || deferred}>
              <ImageIcon /> {t('checkup.fromGallery')}
            </Button>
          </div>

          {/* Temps */}
          <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('checkup.hours')}</label>
              <Input value={hoursText_} inputMode="decimal" onChange={(e) => setHoursText(e.target.value)}
                onBlur={() => onChange({ hours: Math.max(0, num(hoursText_)) })}
                className="h-12 text-right text-[16px] tabular-nums" disabled={deferred} />
              <p className="text-[12px] text-muted-foreground">
                {card.suggested_hours != null && card.suggested_hours > 0
                  ? t('checkup.suggestedHours').replace('{h}', hoursText(card.suggested_hours))
                  : t('checkup.hoursHint')}
                {appliedRate > 0 ? ` · ${t('checkup.rate').replace('{rate}', eur(appliedRate))}` : ''}
              </p>
            </div>
            <div className="pb-5 text-right font-data text-[14px] tabular-nums">
              <span className="text-muted-foreground">{t('checkup.labour')}</span> <b>{eur(price.labourHt)}</b> HT
            </div>
          </div>

          {/* Pièces */}
          <div className="mt-3 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('checkup.parts')}</p>
            {card.parts.map((p) => (
              <div key={p.key} className="grid grid-cols-[1fr_72px_96px_auto] items-center gap-2">
                {p.article_id
                  ? <div className="flex h-11 min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-[14px]"><span className="font-mono text-[12px] text-muted-foreground">{p.reference}</span><span className="truncate">{p.designation}</span></div>
                  : <ArticlePicker companyId={companyId} value={p.designation} onText={(v) => setPart(p.key, { designation: v })} onPick={(a) => pickArticle(p.key, a)} className="h-11 text-[14px]" />}
                <Input value={String(p.quantity)} inputMode="decimal" onChange={(e) => setPart(p.key, { quantity: num(e.target.value) })} className="h-11 text-right tabular-nums" aria-label={t('workshop.colQty')} disabled={deferred} />
                <Input value={String(p.unit_price_ht)} inputMode="decimal" onChange={(e) => setPart(p.key, { unit_price_ht: num(e.target.value) })} className="h-11 text-right tabular-nums" aria-label={t('workshop.colPuHt')} disabled={deferred} />
                <Button type="button" variant="ghost" size="icon" className="size-10" onClick={() => removePart(p.key)} aria-label={t('checkup.removePart')} disabled={deferred}><Trash2 className="size-4 text-danger" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" className="h-11 text-[14px]" onClick={() => onChange({ parts: [...card.parts, blankPart()] })} disabled={deferred}>
              <Plus /> {t('checkup.addPart')}
            </Button>
          </div>

          {/* Prix de la carte */}
          <div className="mt-3 flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 border-t border-border pt-3 font-data text-[14px] tabular-nums">
            <span className="text-muted-foreground">{t('checkup.labour')} {eur(price.labourHt)} + {t('checkup.parts')} {eur(price.partsHt)}</span>
            <span className="text-[18px] font-bold">{eur(price.totalTtc)} <span className="text-[12px] font-normal text-muted-foreground">TTC</span></span>
          </div>
        </>
      )}
    </div>
  );
}

function PhotoThumb({ path, onRemove }: { path: string; onRemove: () => void }) {
  const url = useQuery({ queryKey: ['checkup-photo', path], queryFn: () => checkupPhotoUrl(path), staleTime: 50 * 60_000 });
  return (
    <div className="relative size-20 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
      {url.data ? <img src={url.data} alt="" className="size-full object-cover" /> : <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-muted-foreground" />}
      <button type="button" onClick={onRemove} aria-label={t('checkup.removePhoto')} title={t('checkup.removePhoto')}
        className="absolute right-0.5 top-0.5 grid size-6 place-items-center rounded-md bg-card/90 text-danger">
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
