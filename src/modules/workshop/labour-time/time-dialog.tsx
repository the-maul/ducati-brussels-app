/**
 * M8 — Fenêtre « Gestion du temps atelier » d'une ligne de main-d'oeuvre (G8, 07-atelier §3) :
 * mécanicien, heures facturées, heures passées, heures internes, heures garanties, date des travaux.
 * Les heures facturées deviennent la quantité de la ligne. Règle G8 : des heures internes ou
 * garanties remettent les heures facturées à zéro (le temps facturé se saisit sur une autre ligne).
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { applyTimeWindow, type LabourTime } from './rules';
import type { Mechanic } from './api';

const NONE = ' none';
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

export function LabourTimeDialog({ designation, initial, quantity, mechanics, onSave, onClose }: {
  designation: string;
  initial: LabourTime;
  /** Quantité actuelle de la ligne (heures facturées proposées si rien n'est saisi). */
  quantity: number;
  mechanics: Mechanic[];
  onSave: (time: LabourTime) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(initial.mechanic_code ?? '');
  const [name, setName] = useState(initial.mechanic_name ?? '');
  const [billed, setBilled] = useState(fmt(initial.billed_hours ?? quantity));
  const [worked, setWorked] = useState(fmt(initial.worked_hours));
  const [internal, setInternal] = useState(fmt(initial.internal_hours));
  const [warranty, setWarranty] = useState(fmt(initial.warranty_hours));
  const [date, setDate] = useState(initial.work_date ?? new Date().toISOString().slice(0, 10));
  const preview = applyTimeWindow({ billed, worked, internal, warranty });

  const save = () => {
    const w = applyTimeWindow({ billed, worked, internal, warranty });
    onSave({
      mechanic_code: code || null, mechanic_name: (name || '').trim() || null, work_date: date || null,
      billed_hours: w.billed, worked_hours: w.worked, internal_hours: w.internal || null, warranty_hours: w.warranty || null,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('labourTime.windowTitle')}</DialogTitle>
          <DialogDescription>{designation || t('workshop.kind_mo')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>{t('labourTime.mechanic')}</Label>
            {mechanics.length > 0 ? (
              <Select value={code || NONE} onValueChange={(v) => {
                const m = mechanics.find((x) => x.code === v);
                setCode(m ? m.code : ''); setName(m ? m.name : '');
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('orPage.none')}</SelectItem>
                  {mechanics.map((m) => <SelectItem key={m.code} value={m.code}>{m.code} · {m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
                <p className="text-[12px] text-muted-foreground">{t('labourTime.noMechanicCodes')}</p>
              </>
            )}
          </div>
          <HoursField label={t('labourTime.billedHours')} value={billed} onChange={setBilled} />
          <HoursField label={t('labourTime.workedHours')} value={worked} onChange={setWorked} />
          <HoursField label={t('labourTime.internalHours')} value={internal} onChange={setInternal} />
          <HoursField label={t('labourTime.warrantyHours')} value={warranty} onChange={setWarranty} />
          <div className="col-span-2 space-y-1">
            <Label>{t('labourTime.workDate')}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {preview.billedReset && (
          <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('labourTime.billedResetHint')}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('labourTime.cancel')}</Button>
          <Button onClick={save}>{t('labourTime.validate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HoursField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="text-right tabular-nums" />
    </div>
  );
}
