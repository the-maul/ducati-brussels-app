/**
 * M8 — Fiche moto : « Pièces du kit » (ATE014). Bloc repliable sous le prochain entretien : les pièces
 * du kit d'entretien de CE modèle-année, sans ouvrir de RDV ni d'OR. Lecture seule.
 *
 * Les lignes viennent de `serviceKitRows` (workshop_service_kit_lines), la même lecture que l'OR créé
 * depuis un RDV : même kit, même fusion annuel + huile. Le disponible vient du détail du kit
 * (`maintenance_kit_detail`, réel − réservé). « Ouvrir le kit » mène à Atelier → Kits sur ce kit.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, Info, Loader2, AlertTriangle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { fill } from '@/modules/catalog/format';
import { serviceLabelKey, type ServiceCode } from '../service-code';
import { getKitDetail, type KitDetailLine } from './api';
import { serviceKitRows } from './kit-from-appointment';
import { availableQty, defaultServiceForDue, distinctKitIds, kitQtyLabel, serviceChoices } from './vehicle-kit-rules';

type Props = { vehicleId: string; modelYearId: string | null; dueKind: string | null };

export function VehicleKitPanel({ vehicleId, modelYearId, dueKind }: Props) {
  const [open, setOpen] = useState(false);
  const due = defaultServiceForDue(dueKind);
  const [picked, setPicked] = useState<ServiceCode | null>(null);
  const service = picked ?? due;

  const rowsQ = useQuery({
    queryKey: ['vehicle-kit', vehicleId, service],
    queryFn: () => serviceKitRows(vehicleId, service),
    enabled: open && !!modelYearId,
    retry: false,
  });
  const rows = rowsQ.data ?? [];
  const kitIds = distinctKitIds(rows);
  const stockQ = useQuery({
    queryKey: ['vehicle-kit-stock', ...kitIds],
    queryFn: async () => {
      const details = await Promise.all(kitIds.map((id) => getKitDetail(id).catch(() => [] as KitDetailLine[])));
      return new Map(details.flat().map((d) => [d.id, d]));
    },
    enabled: open && kitIds.length > 0,
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left">
          <span className="text-[13px] font-bold uppercase tracking-[0.04em]">{t('vehicleKit.title')}</span>
          <ChevronDown className={`ml-auto size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-border p-3">
        {!modelYearId ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('vehicleKit.noModel')}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{t('vehicleKit.service')}</span>
              <Select value={service} onValueChange={(v) => setPicked(v as ServiceCode)}>
                <SelectTrigger className="h-8 w-auto min-w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {serviceChoices(due).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c === due && dueKind ? fill(t('vehicleKit.dueTag'), { label: t(serviceLabelKey(c)) }) : t(serviceLabelKey(c))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-auto flex flex-wrap gap-2">
                {kitIds.map((id, i) => (
                  <Button key={id} asChild variant="outline" size="sm">
                    <Link to="/workshop/kits" search={{ kit: id }}>
                      <ExternalLink /> {kitIds.length > 1 ? fill(t('vehicleKit.openKitN'), { n: String(i + 1) }) : t('vehicleKit.openKit')}
                    </Link>
                  </Button>
                ))}
              </span>
            </div>
            {rowsQ.isLoading ? <Loader2 className="size-5 animate-spin text-muted-foreground" />
              : rowsQ.error ? (
                <p className="flex items-start gap-2 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('vehicleKit.loadErr')}
                </p>
              ) : rows.length === 0 ? (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('vehicleKit.noKit')}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full border-collapse font-data text-[13px]">
                    <thead className="bg-muted">
                      <tr>
                        <Th>{t('vehicleKit.colRef')}</Th>
                        <Th>{t('vehicleKit.colDesignation')}</Th>
                        <Th className="text-right">{t('vehicleKit.colQty')}</Th>
                        <Th className="text-right">{t('vehicleKit.colStock')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const avail = availableQty(r.kit_item_id ? stockQ.data?.get(r.kit_item_id) : null);
                        return (
                          <tr key={r.kit_item_id ?? `x${i}`} className="border-t border-border">
                            <td className="px-3 py-2 tabular-nums">{r.reference || '—'}</td>
                            <td className="px-3 py-2">{r.designation}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{kitQtyLabel(r.quantity, r.unit)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {avail == null ? '—' : kitQtyLabel(avail, null)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            <p className="text-[12px] text-muted-foreground">{t('vehicleKit.hint')}</p>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
