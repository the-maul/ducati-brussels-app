/**
 * M8 — Onglet « Extract DCS » de Atelier → Plans d'entretien (mission 07, carte 4).
 * Domenico sort chaque mois de DCS le fichier « ENTRETIEN EN RETARD 180 JOURS + 6 MOIS A VENIR »
 * (feuille Export). Ici : choisir le fichier, vérifier (essai à blanc : motos connues / inconnues,
 * doublons), importer. Même fonction SQL que le script tools/migration/import_dcs_entretiens.py.
 * Bouton « Recalculer toutes les motos » (reprise par lots) pour l'administrateur.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { fill, fmtDateTime, fmtInt } from '@/modules/catalog/format';
import type { DcsRow } from './maintenance-due';
import {
  importDcsRows, isMissingSchema, listDcsImportFiles, readDcsFile, recomputeAllDue, type DcsImportReport,
} from './maintenance-due-api';
import { fmtDateFr } from './vehicle-next-service-panel';

export function DcsImportPanel() {
  const { activeCompanyId, hasRole } = useAuth();
  const canEdit = hasRole('admin') || hasRole('chef_atelier');
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<DcsRow[]>([]);
  const [parsed, setParsed] = useState<{ dup: number; ignored: number } | null>(null);
  const [report, setReport] = useState<DcsImportReport | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const files = useQuery({
    queryKey: ['maintenance', 'dcs-files', activeCompanyId],
    queryFn: () => listDcsImportFiles(activeCompanyId!), enabled: !!activeCompanyId, retry: false,
  });

  const read = useMutation({
    mutationFn: async (f: File) => readDcsFile(f),
    onSuccess: (r, f) => {
      setFileName(f.name); setRows(r.rows); setParsed({ dup: r.duplicates.length, ignored: r.ignored }); setReport(null);
      if (!r.rows.length) toast.error(t('maintenance.dcsErr'));
    },
    onError: () => toast.error(t('maintenance.dcsErr')),
  });
  const run = useMutation({
    mutationFn: (apply: boolean) => importDcsRows(activeCompanyId!, fileName ?? 'extract DCS', rows, apply),
    onSuccess: (r) => {
      setReport(r);
      if (r.applied) {
        toast.success(fill(t('maintenance.dcsDone'), { recomputed: fmtInt(r.recomputed) }));
        qc.invalidateQueries({ queryKey: ['maintenance'] });
      }
    },
    onError: (e) => toast.error(isMissingSchema(e) ? t('maintenance.dueMigrationMissing') : e instanceof Error ? e.message : t('maintenance.saveErr')),
  });
  const recomputeAll = useMutation({
    mutationFn: () => recomputeAllDue(activeCompanyId!, (n) => setProgress(n)),
    onSuccess: (r) => {
      setProgress(null);
      toast.success(fill(t('maintenance.recomputeAllDone'), { done: fmtInt(r.done), withDue: fmtInt(r.with_due) }));
      qc.invalidateQueries({ queryKey: ['maintenance'] });
    },
    onError: (e) => { setProgress(null); toast.error(isMissingSchema(e) ? t('maintenance.dueMigrationMissing') : e instanceof Error ? e.message : t('maintenance.saveErr')); },
  });

  const busy = read.isPending || run.isPending;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <h3 className="font-ui text-[15px] font-bold">{t('maintenance.dcsTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('maintenance.dcsHint')}</p>
        {!canEdit && <p className="mt-1 text-[12px] text-muted-foreground">{t('maintenance.dcsCanEdit')}</p>}
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) read.mutate(f); e.target.value = ''; }} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!canEdit || busy}>
            {read.isPending ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} {t('maintenance.dcsChoose')}
          </Button>
          {fileName && <span className="truncate text-[13px] text-muted-foreground">{fileName}</span>}
        </div>
        {parsed && rows.length > 0 && (
          <div className="mt-3 space-y-3">
            <p className="text-sm">{fill(t('maintenance.dcsParsed'), { rows: fmtInt(rows.length), dup: fmtInt(parsed.dup), ignored: fmtInt(parsed.ignored) })}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => run.mutate(false)} disabled={!canEdit || busy || !activeCompanyId}>
                {run.isPending && !run.variables ? <Loader2 className="animate-spin" /> : <Search />} {t('maintenance.dcsCheck')}
              </Button>
              <Button onClick={() => run.mutate(true)} disabled={!canEdit || busy || !activeCompanyId || !report || report.applied}>
                {run.isPending && run.variables ? <Loader2 className="animate-spin" /> : <Upload />} {t('maintenance.dcsImport')}
              </Button>
            </div>
            {report && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {report.applied
                    ? <StatusBadge tone="success" icon={CheckCircle2} label={t('maintenance.dcsApplied')} />
                    : <StatusBadge tone="info" icon={Search} label={t('maintenance.dcsDryRun')} />}
                  <span>{fill(t('maintenance.dcsReport'), {
                    known: fmtInt(report.known), unknown: fmtInt(report.unknown), inserted: fmtInt(report.inserted),
                    duplicates: fmtInt(report.duplicates), owners: fmtInt(report.owners_with_email),
                  })}</span>
                </div>
                {report.unknown_vins.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] text-muted-foreground">
                      <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />
                      {fill(t('maintenance.dcsUnknownVins'), { n: fmtInt(report.unknown_vins.length) })}
                    </summary>
                    <p className="mt-1 break-all font-mono text-[12px]">{report.unknown_vins.join(' · ')}</p>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-ui text-[15px] font-bold">{t('maintenance.dcsFiles')}</h3>
          <Button variant="outline" size="sm" onClick={() => recomputeAll.mutate()} disabled={!canEdit || recomputeAll.isPending || !activeCompanyId}>
            {recomputeAll.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {progress != null ? fill(t('maintenance.recomputeAllProgress'), { done: fmtInt(progress) }) : t('maintenance.recomputeAll')}
          </Button>
        </div>
        {files.isLoading ? <Loader2 className="mt-2 size-5 animate-spin text-muted-foreground" />
          : files.error ? (
            <p className="mt-2 text-sm text-warning">{isMissingSchema(files.error) ? t('maintenance.dueMigrationMissing') : t('maintenance.loadErr')}</p>
          ) : !files.data?.length ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('maintenance.dcsNoFile')}</p>
          ) : (
            <div className="mt-2 overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('maintenance.dcsColFile')}</TableHead>
                    <TableHead>{t('maintenance.dcsColDate')}</TableHead>
                    <TableHead className="text-right">{t('maintenance.dcsColRows')}</TableHead>
                    <TableHead className="text-right">{t('maintenance.dcsColKnown')}</TableHead>
                    <TableHead>{t('maintenance.dcsColRange')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.data.map((f) => (
                    <TableRow key={`${f.file_name}|${f.imported_at}`}>
                      <TableCell className="font-medium">{f.file_name}</TableCell>
                      <TableCell className="font-mono text-[12px]">{fmtDateTime(f.imported_at)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(f.rows_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(f.known_count)}</TableCell>
                      <TableCell className="font-mono text-[12px]">{fmtDateFr(f.next_min)} → {fmtDateFr(f.next_max)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </div>
    </div>
  );
}
