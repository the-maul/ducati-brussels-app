/**
 * M8 — « Rechercher RDV » (G8, 07-atelier.md §13) : par client, immatriculation ou n° de chassis.
 * Colonnes G8 : RDV (statut) · Date · Heure · Temps · Travaux · Compagnon · Marque · Modele.
 * Choisir une ligne ouvre la semaine du RDV et le RDV.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { t } from '@/lib/i18n';
import { searchAppointments, type AppointmentSearchRow } from './api';
import { formatMinutes, statusTone } from './rules';
import { StatusIcon } from './status-icon';
import { fmtTime } from './ui-bits';

export function AppointmentSearchDialog({ companyId, onClose, onPick }: { companyId: string; onClose: () => void; onPick: (r: AppointmentSearchRow) => void }) {
  const [term, setTerm] = useState(''); const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 300); return () => clearTimeout(id); }, [term]);
  const q = useQuery({ queryKey: ['planning-search', companyId, deb], queryFn: () => searchAppointments(companyId, deb), enabled: deb.length >= 2 });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[880px]">
        <DialogHeader><DialogTitle>{t('planningG8.searchTitle')}</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('planningG8.searchPlaceholder')} className="pl-9" />
        </div>
        <div className="max-h-[60vh] overflow-auto">
          {q.isFetching && <div className="grid place-items-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
          {deb.length >= 2 && !q.isFetching && (q.data ?? []).length === 0 && <p className="py-4 text-sm text-muted-foreground">{t('planningG8.searchEmpty')}</p>}
          {(q.data ?? []).length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('planningG8.colRdv')}</TableHead>
                  <TableHead>{t('planningG8.colDate')}</TableHead>
                  <TableHead>{t('planningG8.colTime')}</TableHead>
                  <TableHead className="text-right">{t('planningG8.colDuration')}</TableHead>
                  <TableHead>{t('planningG8.colClient')}</TableHead>
                  <TableHead>{t('planningG8.colWork')}</TableHead>
                  <TableHead>{t('planningG8.colMechanic')}</TableHead>
                  <TableHead>{t('planningG8.colMoto')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q.data ?? []).map((r) => (
                  <TableRow key={r.id} className="cursor-pointer font-data text-[13px]" onClick={() => onPick(r)}>
                    <TableCell><StatusBadge tone={statusTone(r.status)} icon={StatusIcon(r.status)} label={t(`planningG8.status_${r.status}`)} /></TableCell>
                    <TableCell className="tabular-nums">{new Date(r.starts_at).toLocaleDateString('fr-BE')}</TableCell>
                    <TableCell className="tabular-nums">{r.unassigned ? '—' : fmtTime(r.starts_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.planned_minutes ? formatMinutes(r.planned_minutes) : '—'}</TableCell>
                    <TableCell>{r.client_name ?? '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{r.work_description ?? ''}</TableCell>
                    <TableCell>{r.unassigned ? t('planningG8.waitingShort') : r.mechanic_name ?? '—'}</TableCell>
                    <TableCell>{[r.brand, r.model].filter(Boolean).join(' ')}{r.plate ? ` · ${r.plate}` : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
