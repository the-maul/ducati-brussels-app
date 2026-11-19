/**
 * M8 — Reglages du planning (G8 roue dentee, 07-atelier.md §14) :
 *   - Compagnons (G8 « Table des compagnons ») : nom, membre de l'equipe lie (fin du texte libre),
 *     atelier, visible au planning, ordre d'affichage, actif, horaires matin / apres-midi par jour
 *     avec total quotidien et hebdomadaire ;
 *   - Parametres : plage horaire, 1er jour, nombre de jours, granularite, feries belges, taux
 *     d'occupation, blocage des RDV simultanes, conditions generales du contrat de pret ;
 *   - Calendrier : feries ajoutes, fermetures, absences, pauses (retires de la capacite) ;
 *   - Types de RDV : Parametres → Tables (couleur metier et temps prevu propose).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Clock, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { t, LOCALES, type Locale } from '@/lib/i18n';
import { DEFAULT_LOAN_DEDUCTIBLE, parseDeductible } from '../loans/contract-rules';
import { listCompanyTeam } from '../or-page-api';
import { workshopTeamOptions } from '../or-page-rules';
import {
  addCalendarBlock, deleteCalendarBlock, listCalendarBlocks, saveMechanic, saveMechanicHours, savePlanningSettings,
  type MechanicRow, type PlanningSettings,
} from './api';
import { belgianHolidays, formatMinutes, weeklyMinutes, type MechanicHours } from './rules';
import type { usePlanningBase } from './planning-data';
import { Field, fmtDateTime } from './ui-bits';

const NONE = '__none__';
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const SLOT_CHOICES = [5, 10, 15, 20, 30, 60];
const BLOCK_KINDS = ['ferie', 'fermeture', 'absence', 'pause'] as const;

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function PlanningSettingsView({ companyId, base, onChanged }: { companyId: string; base: ReturnType<typeof usePlanningBase>; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <MechanicsSection companyId={companyId} base={base} onChanged={onChanged} />
      <SettingsSection settings={base.settings} onChanged={onChanged} />
      <CalendarSection companyId={companyId} base={base} onChanged={onChanged} />
      <Section title={t('planningG8.typesTitle')}>
        <p className="text-sm text-muted-foreground">{t('planningG8.typesHint')}</p>
        <Link to="/settings/tables/$tableKey" params={{ tableKey: 'workshop_appointment_type' }} className="mt-2 inline-block text-sm font-medium underline">{t('planningG8.typesLink')}</Link>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Compagnons
// ---------------------------------------------------------------------------------------------
function MechanicsSection({ companyId, base, onChanged }: { companyId: string; base: ReturnType<typeof usePlanningBase>; onChanged: () => void }) {
  const team = useQuery({ queryKey: ['company-team', companyId], queryFn: () => listCompanyTeam(companyId), staleTime: 300_000 });
  const [hoursFor, setHoursFor] = useState<MechanicRow | null>(null);
  const [draft, setDraft] = useState<Record<string, Partial<MechanicRow>>>({});
  const rows: (MechanicRow | (Partial<MechanicRow> & { id: string; isNew: true }))[] = [
    ...(base.mechanics as MechanicRow[]),
    ...Object.entries(draft).filter(([k]) => k.startsWith('new-')).map(([id, v]) => ({ ...v, id, isNew: true as const })),
  ];
  const options = workshopTeamOptions(team.data ?? [], base.mechanics.map((m) => m.user_id));

  const save = useMutation({
    mutationFn: async (id: string) => {
      const cur = base.mechanics.find((m) => m.id === id) as MechanicRow | undefined;
      const d = draft[id] ?? {};
      const name = (d.name ?? cur?.name ?? '').trim();
      if (!name) throw new Error(t('planningG8.errMechanicName'));
      await saveMechanic({ ...(cur ?? {}), ...d, id: id.startsWith('new-') ? undefined : id, company_id: companyId, name });
    },
    onSuccess: (_r, id) => { setDraft((x) => { const n = { ...x }; delete n[id]; return n; }); toast.success(t('feedback.saved')); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });
  const val = <K extends keyof MechanicRow>(r: Partial<MechanicRow> & { id: string }, k: K): MechanicRow[K] | undefined =>
    (draft[r.id]?.[k] ?? r[k]) as MechanicRow[K] | undefined;
  const set = (id: string, patch: Partial<MechanicRow>) => setDraft((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  return (
    <Section title={t('planningG8.mechanicsTitle')}
      actions={<Button size="sm" variant="outline" onClick={() => set(`new-${Date.now()}`, { name: '', visible_in_planning: true, is_active: true, sort_order: (base.mechanics.length + 1) * 10 })}><Plus /> {t('planningG8.addMechanic')}</Button>}>
      <p className="mb-2 text-[12px] text-muted-foreground">{t('planningG8.mechanicsHint')}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16 text-right">{t('planningG8.order')}</TableHead>
            <TableHead>{t('planningG8.mechanicName')}</TableHead>
            <TableHead>{t('planningG8.linkedMember')}</TableHead>
            <TableHead>{t('planningG8.workshop')}</TableHead>
            <TableHead>{t('planningG8.visible')}</TableHead>
            <TableHead>{t('planningG8.active')}</TableHead>
            <TableHead className="text-right">{t('planningG8.weekTotal')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const isNew = 'isNew' in r;
            const total = isNew ? 0 : weeklyMinutes(base.hours, r.id).total;
            return (
              <TableRow key={r.id} className="font-data text-[13px]">
                <TableCell><Input value={String(val(r, 'sort_order') ?? 0)} onChange={(e) => set(r.id, { sort_order: Number(e.target.value) || 0 })} className="h-8 w-16 text-right tabular-nums" /></TableCell>
                <TableCell><Input value={String(val(r, 'name') ?? '')} onChange={(e) => set(r.id, { name: e.target.value })} className="h-8" /></TableCell>
                <TableCell>
                  <Select value={(val(r, 'user_id') as string | null) || NONE} onValueChange={(v) => {
                    const o = options.find((x) => x.userId === v);
                    set(r.id, { user_id: v === NONE ? null : v, ...(o && !String(val(r, 'name') ?? '').trim() ? { name: o.name } : {}) });
                  }}>
                    <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('planningG8.noMember')}</SelectItem>
                      {options.map((o) => <SelectItem key={o.userId} value={o.userId}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Input value={String(val(r, 'workshop') ?? '')} onChange={(e) => set(r.id, { workshop: e.target.value || null })} className="h-8 w-28" /></TableCell>
                <TableCell><input type="checkbox" checked={!!val(r, 'visible_in_planning')} onChange={(e) => set(r.id, { visible_in_planning: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" aria-label={t('planningG8.visible')} /></TableCell>
                <TableCell><input type="checkbox" checked={!!val(r, 'is_active')} onChange={(e) => set(r.id, { is_active: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" aria-label={t('planningG8.active')} /></TableCell>
                <TableCell className="text-right tabular-nums">{formatMinutes(total)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {!isNew && <Button size="sm" variant="ghost" className="h-8" onClick={() => setHoursFor(r as MechanicRow)}><Clock className="size-3.5" /> {t('planningG8.hours')}</Button>}
                  <Button size="sm" variant="outline" className="h-8" disabled={!draft[r.id] || save.isPending} onClick={() => save.mutate(r.id)}>{t('action.save')}</Button>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-sm text-muted-foreground">{t('planningG8.noMechanics')}</TableCell></TableRow>}
        </TableBody>
      </Table>
      {hoursFor && <HoursDialog companyId={companyId} mechanic={hoursFor} hours={base.hours} onClose={() => setHoursFor(null)} onSaved={() => { setHoursFor(null); onChanged(); }} />}
    </Section>
  );
}

type HoursDraft = Record<number, { am_start: string; am_end: string; pm_start: string; pm_end: string }>;
const hhmm = (v: string | null) => (v ? v.slice(0, 5) : '');

function HoursDialog({ companyId, mechanic, hours, onClose, onSaved }: { companyId: string; mechanic: MechanicRow; hours: MechanicHours[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<HoursDraft>(() => {
    const out: HoursDraft = {};
    for (const wd of WEEKDAYS) {
      const h = hours.find((x) => x.mechanic_id === mechanic.id && x.weekday === wd);
      out[wd] = { am_start: hhmm(h?.am_start ?? null), am_end: hhmm(h?.am_end ?? null), pm_start: hhmm(h?.pm_start ?? null), pm_end: hhmm(h?.pm_end ?? null) };
    }
    return out;
  });
  const asRows = useMemo(() => WEEKDAYS.map((wd) => ({ mechanic_id: mechanic.id, weekday: wd, am_start: d[wd].am_start || null, am_end: d[wd].am_end || null, pm_start: d[wd].pm_start || null, pm_end: d[wd].pm_end || null })), [d, mechanic.id]);
  const totals = weeklyMinutes(asRows, mechanic.id);
  const save = useMutation({
    mutationFn: () => saveMechanicHours(companyId, mechanic.id, asRows.map(({ mechanic_id: _m, ...r }) => r)),
    onSuccess: () => { toast.success(t('feedback.saved')); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });
  const copyFirst = () => {
    const src = WEEKDAYS.map((wd) => d[wd]).find((x) => x.am_start || x.pm_start);
    if (!src) return;
    setD((x) => { const n = { ...x }; for (const wd of WEEKDAYS) if (n[wd].am_start || n[wd].pm_start) n[wd] = { ...src }; return n; });
  };
  const cell = (wd: number, k: keyof HoursDraft[number]) => (
    <Input type="time" value={d[wd][k]} onChange={(e) => setD((x) => ({ ...x, [wd]: { ...x[wd], [k]: e.target.value } }))} className="h-8 w-28 tabular-nums" />
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[880px]">
        <DialogHeader><DialogTitle>{t('planningG8.hoursTitle')} — {mechanic.name}</DialogTitle></DialogHeader>
        <p className="text-[12px] text-muted-foreground">{t('planningG8.hoursHint')}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('planningG8.day')}</TableHead>
              <TableHead>{t('planningG8.amStart')}</TableHead><TableHead>{t('planningG8.amEnd')}</TableHead>
              <TableHead>{t('planningG8.pmStart')}</TableHead><TableHead>{t('planningG8.pmEnd')}</TableHead>
              <TableHead className="text-right">{t('planningG8.dayTotal')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {WEEKDAYS.map((wd) => (
              <TableRow key={wd}>
                <TableCell className="font-medium">{t(`planningG8.weekday_${wd}`)}</TableCell>
                <TableCell>{cell(wd, 'am_start')}</TableCell><TableCell>{cell(wd, 'am_end')}</TableCell>
                <TableCell>{cell(wd, 'pm_start')}</TableCell><TableCell>{cell(wd, 'pm_end')}</TableCell>
                <TableCell className="text-right font-data tabular-nums">{totals.perDay[wd] ? formatMinutes(totals.perDay[wd]) : t('planningG8.rest')}</TableCell>
              </TableRow>
            ))}
            <TableRow><TableCell colSpan={5} className="text-right font-bold">{t('planningG8.weekTotal')}</TableCell><TableCell className="text-right font-data font-bold tabular-nums">{formatMinutes(totals.total)}</TableCell></TableRow>
          </TableBody>
        </Table>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={copyFirst}>{t('planningG8.copyFirstDay')}</Button>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} {t('action.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Parametres
// ---------------------------------------------------------------------------------------------
function SettingsSection({ settings, onChanged }: { settings: PlanningSettings; onChanged: () => void }) {
  const [s, setS] = useState<PlanningSettings>(settings);
  useEffect(() => setS(settings), [settings]);
  // Contrat de pret G8 : franchise et CG par langue, seulement quand la migration 20261119180000 est en base.
  const contractReady = settings.loan_deductible !== undefined;
  const [deductible, setDeductible] = useState(String(settings.loan_deductible ?? DEFAULT_LOAN_DEDUCTIBLE).replace('.', ','));
  useEffect(() => setDeductible(String(settings.loan_deductible ?? DEFAULT_LOAN_DEDUCTIBLE).replace('.', ',')), [settings]);
  const [termsLang, setTermsLang] = useState<Locale>('fr');
  const termsText = termsLang === 'fr' ? s.loan_terms ?? '' : s.loan_terms_i18n?.[termsLang] ?? '';
  const setTermsText = (text: string) => setS(termsLang === 'fr'
    ? { ...s, loan_terms: text || null }
    : { ...s, loan_terms_i18n: { ...(s.loan_terms_i18n ?? {}), [termsLang]: text } });
  const save = useMutation({
    mutationFn: () => {
      if (!(s.day_end > s.day_start)) throw new Error(t('planningG8.errRange'));
      const next: PlanningSettings = { ...s, day_start: s.day_start.slice(0, 5), day_end: s.day_end.slice(0, 5) };
      if (contractReady) {
        const amount = parseDeductible(deductible);
        if (amount === null) throw new Error(t('loans.err_deductible'));
        next.loan_deductible = amount;
      }
      return savePlanningSettings(next);
    },
    onSuccess: () => { toast.success(t('feedback.saved')); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });
  const check = (k: 'belgian_holidays' | 'show_occupancy' | 'block_overlaps') => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} className="size-4 accent-[var(--ducati-red)]" /> {t(`planningG8.set_${k}`)}
    </label>
  );
  return (
    <Section title={t('planningG8.settingsTitle')} actions={<Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{t('action.save')}</Button>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Field label={t('planningG8.dayStart')}><Input type="time" value={s.day_start.slice(0, 5)} onChange={(e) => setS({ ...s, day_start: e.target.value })} /></Field>
        <Field label={t('planningG8.dayEnd')}><Input type="time" value={s.day_end.slice(0, 5)} onChange={(e) => setS({ ...s, day_end: e.target.value })} /></Field>
        <Field label={t('planningG8.firstWeekday')}>
          <Select value={String(s.first_weekday)} onValueChange={(v) => setS({ ...s, first_weekday: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{WEEKDAYS.map((wd) => <SelectItem key={wd} value={String(wd)}>{t(`planningG8.weekday_${wd}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('planningG8.daysShown')}>
          <Select value={String(s.days_shown)} onValueChange={(v) => setS({ ...s, days_shown: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[1, 2, 3, 4, 5, 6, 7].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('planningG8.slotMinutes')}>
          <Select value={String(s.slot_minutes)} onValueChange={(v) => setS({ ...s, slot_minutes: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SLOT_CHOICES.map((n) => <SelectItem key={n} value={String(n)}>{n} min</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">{check('belgian_holidays')}{check('show_occupancy')}{check('block_overlaps')}</div>
      {/* Lot A parcours mecanicien (19/11) : arret automatique des pointages, comme G8. */}
      {s.auto_stop_mode !== undefined && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5">
          <Field label={t('pointage.autoStopLabel')} className="md:col-span-2">
            <Select value={s.auto_stop_mode} onValueChange={(v) => setS({ ...s, auto_stop_mode: v as 'off' | 'end_of_schedule' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t('pointage.autoStop_off')}</SelectItem>
                <SelectItem value="end_of_schedule">{t('pointage.autoStop_end_of_schedule')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <p className="self-end pb-2 text-[12px] text-muted-foreground md:col-span-3">{t('pointage.autoStopHint')}</p>
        </div>
      )}
      {contractReady && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label={t('loans.deductibleLabel')}>
            <Input value={deductible} onChange={(e) => setDeductible(e.target.value)} inputMode="decimal" className="text-right tabular-nums" />
          </Field>
          <p className="col-span-1 self-end pb-2 text-[12px] text-muted-foreground md:col-span-4">{t('loans.deductibleHint')}</p>
        </div>
      )}
      <div className="mt-3 flex items-end gap-3">
        <Field label={t('loans.termsLabel')} className="flex-1">
          <Textarea rows={6} value={termsText} onChange={(e) => setTermsText(e.target.value)} />
        </Field>
        {contractReady && (
          <Field label={t('loans.termsLanguage')} className="w-40 self-start">
            <Select value={termsLang} onValueChange={(v) => setTermsLang(v as Locale)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LOCALES.map((l) => <SelectItem key={l} value={l}>{t(`locale.${l}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{t('loans.termsHint')}{contractReady ? ` ${t('loans.termsHintLang')}` : ''}</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Calendrier : feries, fermetures, absences, pauses
// ---------------------------------------------------------------------------------------------
function CalendarSection({ companyId, base, onChanged }: { companyId: string; base: ReturnType<typeof usePlanningBase>; onChanged: () => void }) {
  const year = new Date().getFullYear();
  const from = new Date(year, 0, 1); const to = new Date(year + 2, 0, 1);
  const q = useQuery({ queryKey: ['planning-g8', companyId, 'blocks-settings', year], queryFn: () => listCalendarBlocks(companyId, from.toISOString(), to.toISOString()) });
  const [kind, setKind] = useState<(typeof BLOCK_KINDS)[number]>('absence');
  const [mechanicId, setMechanicId] = useState('');
  const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const [label, setLabel] = useState('');
  const add = useMutation({
    mutationFn: async () => {
      if (!start || !end) throw new Error(t('planningG8.errPeriod'));
      const s = new Date(start); const e = new Date(end);
      if (!(e > s)) throw new Error(t('planningG8.errPeriod'));
      if (kind === 'absence' && !mechanicId) throw new Error(t('planningG8.errAbsenceMechanic'));
      await addCalendarBlock({ company_id: companyId, kind, mechanic_id: mechanicId || null, starts_at: s.toISOString(), ends_at: e.toISOString(), label: label || null });
    },
    onSuccess: () => { toast.success(t('feedback.created')); setLabel(''); void q.refetch(); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('feedback.error')),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteCalendarBlock(id),
    onSuccess: () => { toast.success(t('feedback.deleted')); void q.refetch(); onChanged(); },
  });
  const nameOf = (id: string | null) => (id ? base.mechanics.find((m) => m.id === id)?.name ?? '—' : t('planningG8.wholeWorkshop'));
  const upcoming = (q.data ?? []).filter((b) => new Date(b.ends_at).getTime() >= Date.now() - 7 * 86400000);
  return (
    <Section title={t('planningG8.calendarTitle')}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Field label={t('planningG8.blockKind')}>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{BLOCK_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`planningG8.block_${k}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('planningG8.mechanic')}>
          <Select value={mechanicId || NONE} onValueChange={(v) => setMechanicId(v === NONE ? '' : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('planningG8.wholeWorkshop')}</SelectItem>
              {base.mechanics.filter((m) => m.is_active).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('planningG8.from')}><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t('planningG8.to')}><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label={t('planningG8.blockLabel')}><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <div className="flex items-end"><Button onClick={() => add.mutate()} disabled={add.isPending}><Plus /> {t('planningG8.addBlock')}</Button></div>
      </div>
      <Table className="mt-3">
        <TableHeader>
          <TableRow>
            <TableHead>{t('planningG8.blockKind')}</TableHead><TableHead>{t('planningG8.mechanic')}</TableHead>
            <TableHead>{t('planningG8.from')}</TableHead><TableHead>{t('planningG8.to')}</TableHead><TableHead>{t('planningG8.blockLabel')}</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {upcoming.map((b) => (
            <TableRow key={b.id} className="font-data text-[13px]">
              <TableCell>{t(`planningG8.block_${b.kind}`)}</TableCell>
              <TableCell>{nameOf(b.mechanic_id)}</TableCell>
              <TableCell className="tabular-nums">{fmtDateTime(b.starts_at)}</TableCell>
              <TableCell className="tabular-nums">{fmtDateTime(b.ends_at)}</TableCell>
              <TableCell>{b.label ?? ''}</TableCell>
              <TableCell className="text-right"><Button size="sm" variant="ghost" className="h-8" onClick={() => del.mutate(b.id)} aria-label={t('action.delete')}><Trash2 className="size-3.5" /></Button></TableCell>
            </TableRow>
          ))}
          {upcoming.length === 0 && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">{t('planningG8.noBlocks')}</TableCell></TableRow>}
        </TableBody>
      </Table>
      {base.settings.belgian_holidays && (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('planningG8.legalHolidays')} {year}</p>
          <p className="mt-1 font-data text-[13px] tabular-nums text-muted-foreground">
            {belgianHolidays(year).map((h) => `${new Date(`${h.date}T00:00`).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })} ${t(`planningG8.holiday_${h.key}`)}`).join(' · ')}
          </p>
        </div>
      )}
    </Section>
  );
}
