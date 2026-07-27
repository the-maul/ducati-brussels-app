/**
 * M8 — Programme d'Aide à la Réparation Ducati (moto accidentée). Génère le
 * fichier de commande (Excel) et rappelle les pièces à joindre à l'e-mail
 * Technique@ducati.fr (note réseau Ducati).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Mail, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { getVehicle } from '@/modules/vehicles/api';
import { getContact, contactDisplayName } from '@/modules/contacts/api';
import type { RepairOrderFull } from './api';
import {
  buildAccidentOrder, extractPartsFromOR, downloadAccidentOrderXlsx,
  ACCIDENT_HELP_EMAIL, type AccidentPart,
} from './accident-form';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;

export function AccidentHelpDialog({ open, onOpenChange, orFull }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orFull: RepairOrderFull;
}) {
  const { or } = orFull;

  const vehicleQ = useQuery({
    queryKey: ['accident-vehicle', or.vehicle_id],
    queryFn: () => getVehicle(or.vehicle_id!),
    enabled: open && !!or.vehicle_id,
  });
  const contactQ = useQuery({
    queryKey: ['accident-contact', or.contact_id],
    queryFn: () => getContact(or.contact_id!),
    enabled: open && !!or.contact_id,
  });
  const partsQ = useQuery({
    queryKey: ['accident-parts', or.id],
    queryFn: () => extractPartsFromOR(orFull),
    enabled: open,
  });

  const [chassis, setChassis] = useState('');
  const [clientName, setClientName] = useState('');

  useEffect(() => { if (vehicleQ.data?.vin) setChassis(vehicleQ.data.vin); }, [vehicleQ.data]);
  useEffect(() => { if (contactQ.data) setClientName(contactDisplayName(contactQ.data)); }, [contactQ.data]);

  const parts: AccidentPart[] = partsQ.data ?? [];
  const summary = buildAccidentOrder({ chassis, clientName, parts });

  const mailtoHref = () => {
    const subject = encodeURIComponent(t('accident.emailSubject'));
    const body = encodeURIComponent(
      `${t('workshop.colVehicle')} : ${chassis}\n${t('accident.clientName')} : ${clientName}\n\n${t('accident.toSendList')}`,
    );
    return `mailto:${ACCIDENT_HELP_EMAIL}?subject=${subject}&body=${body}`;
  };

  const loading = vehicleQ.isLoading || contactQ.isLoading || partsQ.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('accident.title')}</DialogTitle>
          <DialogDescription>{t('accident.subtitle')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>{t('accident.chassis')}</Label><Input value={chassis} onChange={(e) => setChassis(e.target.value.toUpperCase())} /></div>
              <div><Label>{t('accident.clientName')}</Label><Input value={clientName} onChange={(e) => setClientName(e.target.value)} /></div>
            </div>

            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-bold uppercase text-[11px] text-muted-foreground">{t('accident.colReference')}</th>
                    <th className="px-3 py-1.5 text-left font-bold uppercase text-[11px] text-muted-foreground">{t('accident.colDesignation')}</th>
                    <th className="px-3 py-1.5 text-right font-bold uppercase text-[11px] text-muted-foreground">{t('accident.colQty')}</th>
                    <th className="px-3 py-1.5 text-right font-bold uppercase text-[11px] text-muted-foreground">{t('accident.colPuHt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">{t('accident.noParts')}</td></tr>
                  ) : parts.map((p, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-1.5 font-data tabular-nums">{p.reference}</td>
                      <td className="px-3 py-1.5">{p.designation}</td>
                      <td className="px-3 py-1.5 text-right font-data tabular-nums">{p.qty}</td>
                      <td className="px-3 py-1.5 text-right font-data tabular-nums">{eur(p.unitPriceHt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-1.5 rounded-md border border-border bg-card p-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">{t('accident.totalParts')}</span>
                <span className="font-data tabular-nums font-bold">{eur(summary.partsTotalHt)}</span>
              </div>
              {summary.eligible ? (
                <StatusBadge tone="success" label={t('accident.eligible').replace('{discount}', eur(summary.discount).replace(' €', ''))} />
              ) : (
                <StatusBadge tone="warning" label={t('accident.notEligible')} />
              )}
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">{t('accident.net')}</span>
                <span className="font-data tabular-nums font-bold">{eur(summary.netAfterDiscount)}</span>
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-[12px] text-muted-foreground">
              <p className="mb-1 font-bold text-foreground">{t('accident.toSend').replace('{email}', ACCIDENT_HELP_EMAIL)}</p>
              <p>{t('accident.toSendList')}</p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('accident.close')}</Button>
              <Button variant="outline" asChild>
                <a href={mailtoHref()}><Mail /> {t('accident.sendEmail')}</a>
              </Button>
              <Button onClick={() => downloadAccidentOrderXlsx({ chassis, clientName, parts })}>
                <Download /> {t('accident.downloadXlsx')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
