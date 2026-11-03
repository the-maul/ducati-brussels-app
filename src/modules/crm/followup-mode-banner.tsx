/**
 * CRM011 — Bandeau « Envoi des relances : ARRETE / TEST / ACTIF » (03/11/2026).
 * CRM012 — « Sources prises en compte » : les sources d'echeance qui declenchent une relance
 * d'entretien, « Estimation du plan » decochee par defaut (M-87).
 *
 * Toujours visible en tete de CRM → Relances, rappele dans Parametres (tuile). Le reglage vit
 * dans `followup_settings` (pas de ligne = arrete, sources par defaut) ; seul un administrateur le
 * change, avec une confirmation avant de passer en envoi reel. Statut = couleur + icone + libelle.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, CheckCircle2, FlaskConical, Loader2, Send, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import { getFollowupSettings, setFollowupSettings, type FollowupSettings } from './followups-api';
import {
  DEFAULT_FOLLOWUP_SOURCES, ESTIMATED_SOURCES, FOLLOWUP_MODES, FOLLOWUP_SOURCES, isEmail, modeTone, sourceTone,
  type FollowupMode, type FollowupSource,
} from './followups-rules';

export const MODE_ICON: Record<FollowupMode, LucideIcon> = { arrete: Ban, test: FlaskConical, actif: Send };

export const followupSettingsKey = (companyId: string | null | undefined) => ['followup-settings', companyId] as const;

const EMPTY_SETTINGS: FollowupSettings = { mode: 'arrete', testRecipient: null, sources: [...DEFAULT_FOLLOWUP_SOURCES], updatedAt: null };

/** Le reglage de la societe active (arrete tant qu'il n'est pas charge : ferme par defaut). */
export function useFollowupSettings(companyId: string | null | undefined) {
  return useQuery({
    queryKey: followupSettingsKey(companyId),
    queryFn: () => getFollowupSettings(companyId!),
    enabled: !!companyId,
    refetchInterval: 60_000,
  });
}

export function ModeBadge({ mode, email }: { mode: FollowupMode; email?: string | null }) {
  const short = fillVars(t(`followups.modeShort_${mode}`), { email: email ?? '' });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge tone={modeTone(mode)} icon={MODE_ICON[mode]} label={t(`followups.mode_${mode}`)} />
      <span className="text-[13px] text-muted-foreground">({short})</span>
    </span>
  );
}

/** Les sources retenues, en badges (une estimation retenue se voit : warning + icone). */
export function SourcesBadges({ sources }: { sources: readonly FollowupSource[] }) {
  if (sources.length === 0) return <span className="text-[13px] text-[var(--danger)]">{t('followups.sourcesNone')}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {FOLLOWUP_SOURCES.filter((s) => sources.includes(s)).map((s) => (
        <StatusBadge key={s} tone={sourceTone(s)} icon={sourceTone(s) === 'warning' ? AlertTriangle : undefined} label={t(`followups.src_${s}`)} />
      ))}
    </span>
  );
}

const errMsg = (e: unknown) => (e as { message?: string } | null)?.message ?? String(e);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Bandeau complet : statut, explication, selecteur, adresse de test et sources (admin). */
export function FollowupModeBanner({ companyId }: { companyId: string }) {
  const { rolesForActiveCompany } = useAuth();
  const admin = rolesForActiveCompany.includes('admin');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useFollowupSettings(companyId);
  const current: FollowupSettings = q.data ?? EMPTY_SETTINGS;
  const [draft, setDraft] = useState<{ mode: FollowupMode; email: string; sources: FollowupSource[] } | null>(null);
  const mode = draft?.mode ?? current.mode;
  const email = draft?.email ?? (current.testRecipient ?? '');
  const sources = draft?.sources ?? current.sources;
  const dirty = !!draft && (draft.mode !== current.mode || draft.email.trim().toLowerCase() !== (current.testRecipient ?? '') || !sameSet(draft.sources, current.sources));
  const needsEmail = mode === 'test' && !isEmail(email);
  const estimatedOn = sources.some((s) => ESTIMATED_SOURCES.includes(s));

  const toggleSource = (s: FollowupSource, on: boolean) => {
    const next = on ? [...sources, s] : sources.filter((x) => x !== s);
    setDraft({ mode, email, sources: FOLLOWUP_SOURCES.filter((x) => next.includes(x)) });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'actif' && current.mode !== 'actif') {
        const ok = await confirm({ title: t('followups.modeActifTitle'), message: t('followups.modeActifMsg'), confirmLabel: t('followups.modeActifConfirm'), variant: 'delete' });
        if (!ok) return false;
      }
      // CRM012 : cocher une estimation, c'est relancer des clients sur une date devinee : on le dit.
      if (estimatedOn && !current.sources.some((s) => ESTIMATED_SOURCES.includes(s))) {
        const ok = await confirm({ title: t('followups.srcPlanTitle'), message: t('followups.srcPlanMsg'), confirmLabel: t('followups.srcPlanConfirm'), variant: 'delete' });
        if (!ok) return false;
      }
      await setFollowupSettings(companyId, mode, email || null, sources);
      return true;
    },
    onSuccess: (saved) => {
      if (!saved) return;
      toast.success(t('followups.modeSaved'));
      setDraft(null);
      qc.invalidateQueries({ queryKey: followupSettingsKey(companyId) });
    },
    onError: (e) => toast.error(`${t('followups.errorPrefix')} : ${errMsg(e)}`),
  });

  return (
    <div className="mb-4 flex flex-wrap items-start gap-4 rounded-md border border-border bg-card p-4" role="status" aria-live="polite">
      <div className="min-w-56">
        <div className="text-sm font-semibold">{t('followups.modeTitle')}</div>
        <div className="mt-1">
          {q.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <ModeBadge mode={current.mode} email={current.testRecipient} />}
        </div>
        <div className="mt-3 text-sm font-semibold">{t('followups.sourcesTitle')}</div>
        <div className="mt-1">
          {q.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <SourcesBadges sources={current.sources} />}
        </div>
      </div>
      <div className="min-w-64 flex-1 text-[13px] text-muted-foreground">
        <p>{fillVars(t(`followups.modeHelp_${current.mode}`), { email: current.testRecipient ?? '' })}</p>
        <p className="mt-2">{t('followups.sourcesHelp')}</p>
        {!admin && <p className="mt-1">{t('followups.modeAdminOnly')}</p>}
      </div>
      {admin && (
        <div className="flex w-full flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="space-y-1 text-[12px]">
            <span className="block font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('followups.modeTitle')}</span>
            <Select value={mode} onValueChange={(v) => setDraft({ mode: v as FollowupMode, email, sources })}>
              <SelectTrigger className="h-8 w-44" aria-label={t('followups.modeTitle')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {FOLLOWUP_MODES.map((m) => {
                  const Icon = MODE_ICON[m];
                  return <SelectItem key={m} value={m}><span className="inline-flex items-center gap-2"><Icon className="size-3.5" aria-hidden /> {t(`followups.mode_${m}`)}</span></SelectItem>;
                })}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1 text-[12px]">
            <span className="block font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('followups.modeTestRecipient')}</span>
            <Input
              type="email" className="h-8 w-64" value={email} placeholder={t('followups.modeTestRecipientPh')}
              onChange={(e) => setDraft({ mode, email: e.target.value, sources })}
              aria-invalid={needsEmail || undefined}
            />
          </label>
          <fieldset className="basis-full space-y-1 text-[12px]">
            <legend className="font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('followups.sourcesTitle')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
              {FOLLOWUP_SOURCES.map((s) => {
                const estimated = ESTIMATED_SOURCES.includes(s);
                return (
                  <label key={s} className="inline-flex items-center gap-2 text-[13px]" title={estimated ? t('followups.srcPlanHelp') : undefined}>
                    <Checkbox checked={sources.includes(s)} onCheckedChange={(v) => toggleSource(s, v === true)} aria-label={t(`followups.src_${s}`)} />
                    <span>{t(`followups.src_${s}`)}</span>
                    {estimated && <AlertTriangle className="size-3.5 text-[var(--warning)]" aria-hidden />}
                  </label>
                );
              })}
            </div>
            <p className="text-[12px] text-muted-foreground">{t('followups.srcPlanHelp')}</p>
            {sources.length === 0 && <p className="text-[12px] text-[var(--danger)]">{t('followups.sourcesNone')}</p>}
          </fieldset>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || needsEmail || save.isPending || q.isLoading}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} {t('followups.modeSave')}
          </Button>
          {needsEmail && <p className="basis-full text-[12px] text-[var(--danger)]">{t('followups.modeTestNeedsEmail')}</p>}
        </div>
      )}
    </div>
  );
}

/** Tuile de Parametres : rappel du mode et des sources retenues, lien vers CRM → Relances. */
export function FollowupModeCard() {
  const { activeCompanyId } = useAuth();
  const q = useFollowupSettings(activeCompanyId);
  const s = q.data ?? EMPTY_SETTINGS;
  const Icon = s.mode === 'actif' ? CheckCircle2 : MODE_ICON[s.mode];
  return (
    <Link
      to="/crm/relances"
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-ring/40"
    >
      <Icon className="size-6 text-primary" />
      <span className="font-ui text-[15px] font-bold">{t('settings.followupModeTitle')}</span>
      <span className="text-sm text-muted-foreground">{t('settings.followupModeDesc')}</span>
      <span>{q.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <ModeBadge mode={s.mode} email={s.testRecipient} />}</span>
      {!q.isLoading && (
        <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <span>{t('settings.followupSourcesLine')}</span>
          <SourcesBadges sources={s.sources} />
        </span>
      )}
    </Link>
  );
}
