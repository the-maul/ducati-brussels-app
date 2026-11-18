/**
 * Document « Cession interne / O.R.O » (G8 : ecran Cession interne) : en-tete (type, operateur,
 * moto, valorisation PAMP / dernier PA, travaux), lignes pieces / main-d'oeuvre (heures internes et
 * passees, mecanicien) / frais / texte, pointage sur la cession, validation par la fenetre
 * « prix de revient », archivage, impression (cession + fiche de travail, en PAMP / PV / PA).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, CheckCircle2, Loader2, Play, Plus, Printer, Square, Trash2, XCircle } from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { useCanWrite } from '@/lib/auth/use-access';
import { t } from '@/lib/i18n';
import { listRef } from '@/modules/settings/reference-api';
import { listCompanyTeam } from '@/modules/workshop/or-page-api';
import {
  addCessionLine, archiveCession, cancelCession, cessionWorkedMinutes, deleteCessionLine, getCession,
  myOpenWork, searchCessionArticles, setCessionCostBasis, startCessionWork, stopCessionWork, unarchiveCession,
  updateCessionHeader, validateCession, readCessionSettings, type CessionArticle, type CessionFull,
} from './api';
import { CessionCostDialog } from './cession-cost-dialog';
import { printCession, type CessionPrintKind } from './print';
import { cessionActions, minutesToHours, type CessionLineKind, type CessionStatus, type CostBasis, type PrintPriceMode } from './rules';

const eur = (n: number | null | undefined) => (n == null ? '—' : `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`);
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export const CESSION_STATUS_TONE: Record<CessionStatus, StatusTone> = { ouvert: 'info', valide: 'success', archive: 'neutral', annule: 'danger' };

export function CessionStatusBadge({ status }: { status: CessionStatus }) {
  return <StatusBadge tone={CESSION_STATUS_TONE[status]} label={t(`cession.status_${status}`)} />;
}

export function CessionDocument({ cessionId, companyId }: { cessionId: string; companyId: string }) {
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const { activeCompany, user } = useAuth();
  const q = useQuery({ queryKey: ['cession', cessionId], queryFn: () => getCession(cessionId) });
  const types = useQuery({ queryKey: ['cession-types', companyId], queryFn: () => listRef(companyId, 'cession_type') });
  const team = useQuery({ queryKey: ['company-team', companyId], queryFn: () => listCompanyTeam(companyId) });
  const worked = useQuery({ queryKey: ['cession-worked', cessionId], queryFn: () => cessionWorkedMinutes(cessionId) });
  const openWork = useQuery({ queryKey: ['cession-open-work', companyId], queryFn: () => myOpenWork(companyId) });
  const settings = useQuery({ queryKey: ['cession-settings', companyId], queryFn: () => readCessionSettings(companyId) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cession', cessionId] });
    qc.invalidateQueries({ queryKey: ['cession-docs'] });
    qc.invalidateQueries({ queryKey: ['vehicle-cessions'] });
  };

  const [work, setWork] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [printMode, setPrintMode] = useState<PrintPriceMode>('pamp');
  const [printKind, setPrintKind] = useState<CessionPrintKind>('both');
  const [withOwner, setWithOwner] = useState(false);
  const [lastResult, setLastResult] = useState<{ before: number | null; after: number | null } | null>(null);

  const header = useMutation({
    mutationFn: (patch: Parameters<typeof updateCessionHeader>[1]) => updateCessionHeader(cessionId, patch),
    onSuccess: refresh,
  });
  const basis = useMutation({ mutationFn: (b: CostBasis) => setCessionCostBasis(cessionId, b), onSuccess: refresh });
  const delLine = useMutation({ mutationFn: (id: string) => deleteCessionLine(id), onSuccess: refresh });
  const validate = useMutation({
    meta: { success: t('cession.validated') },
    mutationFn: (options: number) => validateCession(cessionId, options),
    onSuccess: (r) => { setCostOpen(false); setLastResult({ before: r.cost_before, after: r.cost_after }); refresh(); qc.invalidateQueries({ queryKey: ['oro-full'] }); },
  });
  const archive = useMutation({ mutationFn: () => archiveCession(cessionId), onSuccess: refresh });
  const unarchive = useMutation({ mutationFn: () => unarchiveCession(cessionId), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => cancelCession(cessionId), onSuccess: refresh });
  const refreshWork = () => { qc.invalidateQueries({ queryKey: ['cession-open-work', companyId] }); qc.invalidateQueries({ queryKey: ['cession-worked', cessionId] }); };
  const myName = team.data?.find((m) => m.user_id === user?.id)?.name ?? user?.email ?? null;
  const startWork = useMutation({ meta: { success: false }, mutationFn: () => startCessionWork(companyId, cessionId, myName), onSuccess: refreshWork });
  const stopWork = useMutation({ meta: { success: false }, mutationFn: () => stopCessionWork(companyId), onSuccess: refreshWork });

  if (q.isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  const c = q.data;
  if (!c) return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('cession.notFound')}</p>;

  const acts = cessionActions(c.status);
  const editable = acts.edit && canWrite;
  const v = c.vehicle;
  const contactName = c.contact ? (c.contact.company_name || [c.contact.first_name, c.contact.last_name].filter(Boolean).join(' ')) : null;
  const totalCost = c.status === 'ouvert' ? c.lines.reduce((s, l) => s + Number(l.line_cost), 0) : Number(c.total_cost);
  const totalSale = c.status === 'ouvert' ? c.lines.reduce((s, l) => s + Number(l.line_sale_ht), 0) : Number(c.total_sale_ht);
  const onThis = openWork.data?.cession_id === cessionId;
  const workedTotal = (worked.data ?? []).reduce((s, w) => s + w.minutes, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <CessionStatusBadge status={c.status} />
        <StatusBadge tone={c.accounted ? 'info' : 'neutral'} label={c.accounted ? t('cession.accounted') : t('cession.notAccounted')} />
        {c.archive_reason && <span className="text-[12px] text-muted-foreground">{t(`cession.archiveReason_${c.archive_reason}`)}</span>}
        <span className="font-data text-sm tabular-nums">{t('cession.totalCost')} : <b>{eur(totalCost)}</b></span>
        <span className="font-data text-sm tabular-nums">{t('cession.totalSaleHt')} : <b>{eur(totalSale)}</b></span>
        {Number(c.options_amount) > 0 && <span className="font-data text-sm tabular-nums">{t('cession.options')} : <b>{eur(Number(c.options_amount))}</b></span>}
        {c.cost_after != null && (
          <span className="font-data text-sm tabular-nums">{t('cession.costBefore')} {eur(c.cost_before)} → {t('cession.costAfter')} <b>{eur(c.cost_after)}</b></span>
        )}
      </div>
      {lastResult && lastResult.after != null && (
        <p className="rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
          {t('cession.validatedCost').replace('{before}', eur(lastResult.before)).replace('{after}', eur(lastResult.after))}
        </p>
      )}

      {/* En-tete */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-3">
        <Field label={t('cession.type')}>
          {editable ? (
            <Select value={c.cession_type} onValueChange={(val) => header.mutate({ cession_type: val })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(types.data ?? []).filter((r) => r.is_active || r.code === c.cession_type).map((r) => <SelectItem key={r.code} value={r.code}>{r.code} · {r.label}</SelectItem>)}</SelectContent>
            </Select>
          ) : <p className="text-sm">{c.cession_type} · {c.type_label}</p>}
          {(c.account || c.journal) && <p className="text-[12px] text-muted-foreground">{t('cession.account')} {c.account ?? '—'} · {t('cession.journal')} {c.journal ?? '—'}</p>}
        </Field>
        <Field label={t('cession.operator')}>
          {editable ? (
            <Select value={c.operator_id ?? ''} onValueChange={(val) => header.mutate({ operator_id: val, operator_name: team.data?.find((m) => m.user_id === val)?.name ?? null })}>
              <SelectTrigger><SelectValue placeholder={c.operator_name ?? t('cession.choose')} /></SelectTrigger>
              <SelectContent>{(team.data ?? []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : <p className="text-sm">{c.operator_name ?? '—'}</p>}
        </Field>
        <Field label={t('cession.costBasis')}>
          {editable ? (
            <Select value={c.cost_basis} onValueChange={(val) => basis.mutate(val as CostBasis)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pamp">{t('cession.basis_pamp')}</SelectItem>
                <SelectItem value="pa">{t('cession.basis_pa')}</SelectItem>
              </SelectContent>
            </Select>
          ) : <p className="text-sm">{t(`cession.basis_${c.cost_basis}`)}</p>}
        </Field>
        <Field label={t('cession.vehicle')}>
          <p className="text-sm">{v ? [v.brand, v.model].filter(Boolean).join(' ') || '—' : t('cession.noVehicle')}</p>
          {v && <p className="font-mono text-[12px] text-muted-foreground">{[v.vin, v.plate, v.reference].filter(Boolean).join(' · ')}</p>}
        </Field>
        <Field label={t('cession.client')}><p className="text-sm">{contactName ?? '—'}</p></Field>
        <Field label={t('cession.workedTime')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-data text-sm tabular-nums">{minutesToHours(workedTotal).toFixed(2).replace('.', ',')} h</span>
            {c.status === 'ouvert' && canWrite && (onThis
              ? <Button size="sm" variant="outline" onClick={() => stopWork.mutate()} disabled={stopWork.isPending}><Square /> {t('cession.stopWork')}</Button>
              : <Button size="sm" variant="outline" onClick={() => startWork.mutate()} disabled={startWork.isPending}><Play /> {t('cession.startWork')}</Button>)}
          </div>
        </Field>
        <div className="md:col-span-2">
          <Field label={t('cession.work')}>
            {editable ? (
              <Textarea rows={2} value={work ?? c.work_description ?? ''} onChange={(e) => setWork(e.target.value)}
                onBlur={() => { if (work != null && work !== (c.work_description ?? '')) header.mutate({ work_description: work || null }); }} />
            ) : <p className="whitespace-pre-wrap text-sm">{c.work_description ?? '—'}</p>}
          </Field>
        </div>
        <Field label={t('cession.internalNote')}>
          {editable ? (
            <Textarea rows={2} value={note ?? c.internal_note ?? ''} onChange={(e) => setNote(e.target.value)}
              onBlur={() => { if (note != null && note !== (c.internal_note ?? '')) header.mutate({ internal_note: note || null }); }} />
          ) : <p className="whitespace-pre-wrap text-sm">{c.internal_note ?? '—'}</p>}
        </Field>
      </div>

      {/* Lignes */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('cession.colKind')}</Th><Th>{t('cession.colRef')}</Th><Th>{t('cession.colDesignation')}</Th><Th>{t('cession.colMechanic')}</Th>
              <Th className="text-right">{t('cession.colQty')}</Th><Th className="text-right">{t('cession.colHoursSpent')}</Th>
              <Th className="text-right">{t('cession.colPamp')}</Th><Th className="text-right">{t('cession.colPa')}</Th><Th className="text-right">{t('cession.colPvHt')}</Th>
              <Th className="text-right">{t('cession.colUnitCost')}</Th><Th className="text-right">{t('cession.colTotal')}</Th><Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {c.lines.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">{t('cession.noLines')}</td></tr>}
            {c.lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{t(`cession.kind_${l.kind}`)}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{l.reference ?? ''}</td>
                <td className="px-3 py-2">{l.designation}</td>
                <td className="px-3 py-2">{l.mechanic_name ?? ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.kind === 'texte' ? '' : Number(l.quantity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.hours_spent != null ? Number(l.hours_spent) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.unit_pamp != null ? eur(l.unit_pamp) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.unit_pa != null ? eur(l.unit_pa) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.unit_sale_ht != null ? eur(l.unit_sale_ht) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.kind === 'texte' ? '' : eur(l.unit_cost)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{l.kind === 'texte' ? '' : eur(l.line_cost)}</td>
                <td className="px-2 py-1 text-center">
                  {editable && <Button size="sm" variant="ghost" onClick={() => delLine.mutate(l.id)} aria-label={t('cession.deleteLine')}><Trash2 className="size-4 text-danger" /></Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted-foreground">{t('cession.vatZeroHint')}</p>

      {editable && (
        <AddLineForm
          companyId={companyId}
          cessionId={cessionId}
          team={team.data ?? []}
          workedByMechanic={worked.data ?? []}
          hourlyRate={num(settings.data?.values.internal_hourly_rate ?? '0')}
          onAdded={refresh}
        />
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
        {acts.validate && canWrite && (
          <Button onClick={() => setCostOpen(true)} disabled={c.lines.length === 0}><CheckCircle2 /> {t('cession.validate')}</Button>
        )}
        {acts.archive && canWrite && (
          <Button variant="outline" onClick={() => { if (window.confirm(t('cession.archiveConfirm'))) archive.mutate(); }} disabled={archive.isPending}><Archive /> {t('cession.archive')}</Button>
        )}
        {acts.unarchive && canWrite && (
          <Button variant="outline" onClick={() => unarchive.mutate()} disabled={unarchive.isPending}><ArchiveRestore /> {t('cession.unarchive')}</Button>
        )}
        {acts.cancel && canWrite && (
          <Button variant="outline" onClick={() => { if (window.confirm(t('cession.cancelConfirm'))) cancel.mutate(); }} disabled={cancel.isPending}><XCircle className="text-danger" /> {t('cession.cancelDoc')}</Button>
        )}
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Field label={t('cession.printKind')}>
            <Select value={printKind} onValueChange={(val) => setPrintKind(val as CessionPrintKind)}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">{t('cession.printKind_both')}</SelectItem>
                <SelectItem value="cession">{t('cession.printKind_cession')}</SelectItem>
                <SelectItem value="fiche">{t('cession.printKind_fiche')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('cession.printModeLabel')}>
            <Select value={printMode} onValueChange={(val) => setPrintMode(val as PrintPriceMode)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pamp">{t('cession.printMode_pamp')}</SelectItem>
                <SelectItem value="pv">{t('cession.printMode_pv')}</SelectItem>
                <SelectItem value="pa">{t('cession.printMode_pa')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <label className="flex h-9 items-center gap-2 text-[13px] text-muted-foreground">
            <input type="checkbox" checked={withOwner} onChange={(e) => setWithOwner(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
            {t('cession.printWithOwner')}
          </label>
          <Button variant="outline" onClick={() => printCession(c as CessionFull, { mode: printMode, kind: printKind, companyName: activeCompany?.name ?? '', withOwner })}>
            <Printer /> {t('cession.print')}
          </Button>
        </div>
      </div>

      {costOpen && (
        <CessionCostDialog
          open={costOpen}
          onOpenChange={setCostOpen}
          cessionId={cessionId}
          hasVehicle={!!c.vehicle_id}
          pending={validate.isPending}
          onConfirm={(options) => validate.mutate(options)}
        />
      )}
    </div>
  );
}

function AddLineForm({ companyId, cessionId, team, workedByMechanic, hourlyRate, onAdded }: {
  companyId: string;
  cessionId: string;
  team: { user_id: string; name: string }[];
  workedByMechanic: { mechanic_id: string | null; minutes: number }[];
  hourlyRate: number;
  onAdded: () => void;
}) {
  const [kind, setKind] = useState<CessionLineKind>('piece');
  const [article, setArticle] = useState<CessionArticle | null>(null);
  const [designation, setDesignation] = useState('');
  const [qty, setQty] = useState('1');
  const [hoursSpent, setHoursSpent] = useState('');
  const [mechanicId, setMechanicId] = useState('');
  const [cost, setCost] = useState('');
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const searchKind = kind === 'mo' ? 'mo' : 'piece';
  const found = useQuery({
    queryKey: ['cession-art', companyId, searchKind, deb],
    queryFn: () => searchCessionArticles(companyId, deb, searchKind),
    enabled: (kind === 'piece' || kind === 'mo') && deb.length >= 2 && !article,
  });

  const reset = () => { setArticle(null); setDesignation(''); setQty('1'); setHoursSpent(''); setCost(''); setTerm(''); };
  const add = useMutation({
    meta: { success: false },
    mutationFn: () => addCessionLine(cessionId, {
      kind, articleId: article?.id ?? null, designation: designation || article?.designation || null,
      quantity: kind === 'texte' ? 0 : num(qty),
      hoursSpent: kind === 'mo' && hoursSpent !== '' ? num(hoursSpent) : null,
      mechanicId: kind === 'mo' ? mechanicId || null : null,
      mechanicName: kind === 'mo' ? team.find((m) => m.user_id === mechanicId)?.name ?? null : null,
      unitCost: kind === 'frais' || (kind === 'mo' && !article) ? (cost === '' ? (kind === 'mo' ? hourlyRate : 0) : num(cost)) : null,
    }),
    onSuccess: () => { reset(); onAdded(); },
  });

  const fromChrono = () => {
    const m = workedByMechanic.find((w) => w.mechanic_id === mechanicId) ?? (workedByMechanic.length === 1 ? workedByMechanic[0] : null);
    if (m) setHoursSpent(String(minutesToHours(m.minutes)));
  };

  const canAdd = kind === 'piece' ? !!article && num(qty) > 0
    : kind === 'mo' ? num(qty) >= 0 && (!!article || designation.trim() !== '')
    : designation.trim() !== '';

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3">
      <Field label={t('cession.colKind')}>
        <Select value={kind} onValueChange={(val) => { setKind(val as CessionLineKind); reset(); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="piece">{t('cession.kind_piece')}</SelectItem>
            <SelectItem value="mo">{t('cession.kind_mo')}</SelectItem>
            <SelectItem value="frais">{t('cession.kind_frais')}</SelectItem>
            <SelectItem value="texte">{t('cession.kind_texte')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {(kind === 'piece' || kind === 'mo') && (
        <Field label={kind === 'mo' ? t('cession.moArticle') : t('cession.article')}>
          {article ? (
            <div className="flex h-9 w-72 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <span className="truncate">{article.reference} {article.designation}</span>
              <button type="button" className="ml-auto text-muted-foreground" onClick={() => setArticle(null)} aria-label={t('cession.clear')}>×</button>
            </div>
          ) : (
            <div className="relative">
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('cession.articleSearch')} className="w-72" />
              {deb.length >= 2 && (found.data ?? []).length > 0 && (
                <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
                  {(found.data ?? []).map((a) => (
                    <button key={a.id} type="button" onClick={() => { setArticle(a); setTerm(''); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
                      <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">{eur(a.pamp)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>
      )}
      {(kind !== 'piece') && (
        <Field label={t('cession.colDesignation')}>
          <Input value={designation} onChange={(e) => setDesignation(e.target.value)} className="w-56" placeholder={kind === 'mo' && article ? article.designation : ''} />
        </Field>
      )}
      {kind === 'mo' && (
        <Field label={t('cession.colMechanic')}>
          <Select value={mechanicId} onValueChange={setMechanicId}>
            <SelectTrigger className="w-44"><SelectValue placeholder={t('cession.choose')} /></SelectTrigger>
            <SelectContent>{team.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      )}
      {kind !== 'texte' && (
        <Field label={kind === 'mo' ? t('cession.internalHours') : t('cession.colQty')}>
          <Input type="number" step="0.01" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="w-24 text-right tabular-nums" />
        </Field>
      )}
      {kind === 'mo' && (
        <Field label={t('cession.colHoursSpent')}>
          <div className="flex gap-1">
            <Input type="number" step="0.01" min="0" value={hoursSpent} onChange={(e) => setHoursSpent(e.target.value)} className="w-24 text-right tabular-nums" />
            {workedByMechanic.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={fromChrono}>{t('cession.fromChrono')}</Button>}
          </div>
        </Field>
      )}
      {(kind === 'frais' || (kind === 'mo' && !article)) && (
        <Field label={kind === 'mo' ? t('cession.hourlyCost') : t('cession.colUnitCost')}>
          <Input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={kind === 'mo' ? String(hourlyRate) : ''} className="w-28 text-right tabular-nums" />
        </Field>
      )}
      <Button onClick={() => add.mutate()} disabled={!canAdd || add.isPending}>
        {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('cession.addLine')}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
