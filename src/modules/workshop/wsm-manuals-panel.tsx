/**
 * M8 — Onglet « Manuels d'atelier » de l'écran Atelier → Plans d'entretien (mission 07, carte 3).
 *
 * Écran de vérification : quels modèles-années sont couverts par un manuel d'atelier, le programme
 * d'entretien officiel de chacun (échéances, opérations, temps en UT) et le nombre de procédures.
 * Le « parcours technicien » (les étapes, les figures, les couples pas à pas) viendra sur une autre
 * branche : ici on ne fait que constater la couverture.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Search, XCircle } from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { fill, fmtInt } from '@/modules/catalog/format';
import {
  getWsmManualOverview, listWsmManuals, serviceDeadlineLabel, utLabel,
  type WsmManualRow, type WsmOverview,
} from './wsm-api';

const LINK_STATUS: Record<string, { tone: StatusTone; icon: typeof CheckCircle2 }> = {
  lie: { tone: 'success', icon: CheckCircle2 },
  a_valider: { tone: 'warning', icon: AlertTriangle },
  rejete: { tone: 'neutral', icon: XCircle },
};

function LinkBadge({ status }: { status: string | null }) {
  if (!status) return <StatusBadge tone="danger" icon={XCircle} label={t('wsm.st_absent')} />;
  const m = LINK_STATUS[status] ?? LINK_STATUS.rejete;
  return <StatusBadge tone={m.tone} icon={m.icon} label={t(`maintenance.st_${status}`)} />;
}

export function WsmManualsPanel() {
  const [family, setFamily] = useState('all');
  const [q, setQ] = useState('');
  const [manualId, setManualId] = useState<string | null>(null);
  const manuals = useQuery({ queryKey: ['wsm', 'manuals'], queryFn: () => listWsmManuals(null, null) });

  const families = useMemo(
    () => [...new Set((manuals.data ?? []).map((m) => m.family))].sort(),
    [manuals.data],
  );
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (manuals.data ?? []).filter(
      (m) => (family === 'all' || m.family === family)
        && (!k || `${m.family} ${m.supermodel ?? ''} ${m.model} ${m.modelYear}`.toLowerCase().includes(k)),
    );
  }, [manuals.data, family, q]);

  if (manuals.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (manuals.error) return <p className="text-sm text-danger">{t('wsm.loadErr')}</p>;
  if (!manuals.data?.length) return <p className="text-sm text-muted-foreground">{t('wsm.empty')}</p>;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={family} onValueChange={setFamily}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('wsm.allFamilies')}</SelectItem>
              {families.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('wsm.searchPlaceholder')} />
          </div>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {fill(t('wsm.countLine'), { n: fmtInt(filtered.length), total: fmtInt(manuals.data.length) })}
        </p>
        <div className="max-h-[560px] overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('wsm.colModel')}</TableHead>
                <TableHead className="text-right tabular-nums">{t('wsm.colYear')}</TableHead>
                <TableHead className="text-right tabular-nums">{t('wsm.colServices')}</TableHead>
                <TableHead className="text-right tabular-nums">{t('wsm.colProcedures')}</TableHead>
                <TableHead>{t('wsm.colCatalog')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.id} onClick={() => setManualId(m.id)}
                  className={cn('cursor-pointer', manualId === m.id && 'bg-neutral-bg')}>
                  <TableCell className="font-data">{m.model}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.modelYear}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(m.servicesCount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(m.proceduresCount)}</TableCell>
                  <TableCell><LinkBadge status={m.linkStatus} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        {manualId
          ? <ManualDetail manualId={manualId} row={filtered.find((m) => m.id === manualId) ?? null} />
          : <p className="text-sm text-muted-foreground">{t('wsm.pickManual')}</p>}
      </section>
    </div>
  );
}

function ManualDetail({ manualId, row }: { manualId: string; row: WsmManualRow | null }) {
  const q = useQuery({ queryKey: ['wsm', 'manual', manualId], queryFn: () => getWsmManualOverview(manualId) });
  if (q.isLoading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (q.error) return <p className="text-sm text-danger">{t('wsm.loadErr')}</p>;
  const d = q.data as WsmOverview;

  return (
    <div className="space-y-3 rounded-md border border-border p-3 shadow-[var(--shadow-card)]">
      <header>
        <h3 className="font-display text-[length:var(--text-h2)]">{d.manual.model} {d.manual.model_year}</h3>
        <p className="text-[12px] text-muted-foreground">
          {d.manual.family}{d.manual.supermodel ? ` · ${d.manual.supermodel}` : ''}
          {d.manual.manual_root ? ` · ${fill(t('wsm.manualRoot'), { root: d.manual.manual_root })}` : ''}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Fact label={t('wsm.factServices')} value={fmtInt(d.services.length)} />
        <Fact label={t('wsm.factOperations')} value={fmtInt(d.operations.length)} />
        <Fact label={t('wsm.factProcedures')} value={fmtInt(d.procedures.length)} />
        <Fact label={t('wsm.factTorques')} value={fmtInt(d.torqueTables.reduce((s, x) => s + x.lines, 0))} />
      </div>

      <div>
        <h4 className="mb-1 text-[length:var(--text-label)] uppercase tracking-[var(--tracking-label)] text-muted-foreground">
          {t('wsm.programme')}
        </h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('wsm.colService')}</TableHead>
              <TableHead>{t('wsm.colDeadline')}</TableHead>
              <TableHead className="text-right tabular-nums">{t('wsm.colOps')}</TableHead>
              <TableHead className="text-right tabular-nums">{t('wsm.colProcs')}</TableHead>
              <TableHead className="text-right tabular-nums">{t('wsm.colUt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.services.map((s) => (
              <TableRow key={s.code}>
                <TableCell className="font-data">{s.name}</TableCell>
                <TableCell className="tabular-nums">{serviceDeadlineLabel(s)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(s.operations)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(s.procedures)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.ut == null ? '—' : utLabel(s.ut, null)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!d.services.length && <p className="text-sm text-muted-foreground">{t('wsm.noService')}</p>}
      </div>

      <div>
        <h4 className="mb-1 text-[length:var(--text-label)] uppercase tracking-[var(--tracking-label)] text-muted-foreground">
          {t('wsm.catalogLinks')}
        </h4>
        {d.links.length
          ? (
            <ul className="space-y-1 text-sm">
              {d.links.map((l) => (
                <li key={l.modelYearId} className="flex items-center gap-2">
                  <LinkBadge status={l.status} />
                  <span className="font-data">{l.label}</span>
                  <span className="text-[12px] text-muted-foreground">{l.reason ?? t(`wsm.origin_${l.origin}`)}</span>
                </li>
              ))}
            </ul>
          )
          : <p className="text-sm text-muted-foreground">{t('wsm.noLink')}</p>}
      </div>

      {row?.gaps?.length ? (
        <p className="text-[12px] text-warning">{fill(t('wsm.gaps'), { n: fmtInt(row.gaps.length) })}</p>
      ) : null}

      <p className="text-[12px] text-muted-foreground">
        {fill(t('wsm.sourceLine'), { file: d.manual.source_file ?? '—' })}
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[4px] border border-border px-2 py-1">
      <p className="text-[length:var(--text-label)] uppercase tracking-[var(--tracking-label)] text-muted-foreground">{label}</p>
      <p className="font-data text-[length:var(--text-data)] tabular-nums">{value}</p>
    </div>
  );
}
