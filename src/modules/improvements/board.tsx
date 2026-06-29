/**
 * M0 — Board « Améliorations » : 5 colonnes de statut, cartes déplaçables par menu de statut.
 * Échange direct des demandes de modification entre admins (client + intégrateur).
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import {
  IMPROVEMENT_STATUSES, type Improvement, type ImprovementStatus,
  listImprovements, listCompanyPoints, updateImprovement,
} from './api';
import { STATUS_META } from './status';
import { TaskEditor } from './task-editor';

export function ImprovementsBoard({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { data: items, isLoading } = useQuery({ queryKey: ['improvements', companyId], queryFn: () => listImprovements(companyId) });
  const { data: points } = useQuery({ queryKey: ['improvement-points-all', companyId], queryFn: () => listCompanyPoints(companyId) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['improvements', companyId] }); qc.invalidateQueries({ queryKey: ['improvement-points-all', companyId] }); };

  const [editing, setEditing] = useState<Improvement | null>(null);
  const [open, setOpen] = useState(false);

  const move = useMutation({ mutationFn: (p: { id: string; status: ImprovementStatus }) => updateImprovement(p.id, { status: p.status }), onSuccess: refresh });

  const progress = useMemo(() => {
    const m: Record<string, { done: number; total: number }> = {};
    for (const p of points ?? []) {
      const e = (m[p.improvement_id] ??= { done: 0, total: 0 });
      e.total++; if (p.done) e.done++;
    }
    return m;
  }, [points]);

  const openNew = () => { setEditing(null); setOpen(true); };
  const openTask = (it: Improvement) => { setEditing(it); setOpen(true); };

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={openNew}><Plus /> {t('improvements.newTask')}</Button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {IMPROVEMENT_STATUSES.map((st) => {
          const meta = STATUS_META[st];
          const Icon = meta.Icon;
          const col = (items ?? []).filter((i) => i.status === st);
          return (
            <div key={st} className="flex w-72 shrink-0 flex-col rounded-md bg-muted/40">
              <div className="flex items-center gap-2 px-3 py-2">
                <Icon className={`size-4 ${meta.text}`} />
                <span className="text-[13px] font-semibold">{t(meta.labelKey)}</span>
                <span className="ml-auto rounded-[var(--radius-badge)] bg-card px-1.5 text-[11px] tabular-nums text-muted-foreground">{col.length}</span>
              </div>
              <div className="flex flex-col gap-2 px-2 pb-2">
                {col.map((it) => {
                  const pr = progress[it.id];
                  return (
                    <button key={it.id} type="button" onClick={() => openTask(it)}
                      className="rounded-md border border-border bg-card p-2.5 text-left transition-colors hover:border-[var(--ducati-red)]">
                      <p className="text-[13px] font-medium leading-snug">{it.title}</p>
                      {it.description && <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{it.description}</p>}
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                        {pr && pr.total > 0 && <span className="inline-flex items-center gap-1 tabular-nums"><Paperclip className="size-3 rotate-90" />{pr.done}/{pr.total}</span>}
                        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
                          <Select value={it.status} onValueChange={(v) => move.mutate({ id: it.id, status: v as ImprovementStatus })}>
                            <SelectTrigger className="h-6 w-auto gap-1 border-none px-1.5 py-0 text-[11px] shadow-none"><SelectValue /></SelectTrigger>
                            <SelectContent>{IMPROVEMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(STATUS_META[s].labelKey)}</SelectItem>)}</SelectContent>
                          </Select>
                        </span>
                      </div>
                    </button>
                  );
                })}
                {col.length === 0 && <p className="px-1 py-3 text-center text-[12px] text-muted-foreground/70">—</p>}
              </div>
            </div>
          );
        })}
      </div>

      {open && <TaskEditor companyId={companyId} improvement={editing} open={open} onOpenChange={(v) => { setOpen(v); if (!v) refresh(); }} />}
    </>
  );
}
