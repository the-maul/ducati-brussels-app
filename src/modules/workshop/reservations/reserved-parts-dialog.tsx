/**
 * Fenetre « Pieces reservees » d'un RDV (planning) : ouverte depuis la carte du RDV, ou juste apres
 * la prise d'un RDV d'entretien (les pieces viennent d'etre reservees par la base, M-111).
 */
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t, fillVars } from '@/lib/i18n';
import { ReservedPartsBlock, fmtDateTime } from './reserved-parts-block';

export function ReservedPartsDialog({ appointmentId, startsAt, serviceCode, onClose }: {
  appointmentId: string; startsAt: string | null; serviceCode: string | null; onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{fillVars(t('reservation.dialogTitle'), { date: fmtDateTime(startsAt) })}</DialogTitle></DialogHeader>
        <ReservedPartsBlock appointmentId={appointmentId} serviceCode={serviceCode} />
        <DialogFooter><Button onClick={onClose}>{t('reservation.close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
