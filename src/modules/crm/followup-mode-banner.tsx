/**
 * CRM011 — Bandeau « Envoi des relances : ARRETE / TEST / ACTIF » (03/11/2026).
 *
 * Toujours visible en tete de CRM → Relances, rappele dans Parametres (tuile). Le reglage vit
 * dans `followup_settings` (pas de ligne = arrete) ; seul un administrateur le change, avec une
 * confirmation avant de passer en envoi reel. Statut = couleur + icone + libelle (charte).
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, FlaskConical, Loader2, Send, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import { getFollowupSettings, setFollowupSettings, type FollowupSettings } from './followups-api';
import { FOLLOWUP_MODES, isEmail, modeTone, type FollowupMode } from './followups-rules';

export const MODE_ICON: Record<FollowupMode, LucideIcon> = { arrete: Ban, test: FlaskConical, actif: Send };

export const followupSettingsKey = (companyId: string | null | undefined) => ['followup-settings', companyId] as const;

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

const errMsg = (e: unknown) => (e as { message?: string } | null)?.message ?? String(e);

/** Bandeau complet : statut, explication, selecteur et adresse de test (admin). */
export function FollowupModeBanner({ companyId }: { companyId: string }) {
  const { rolesForActiveCompany } = useAuth();
  const admin = rolesForActiveCompany.includes('admin');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useFollowupSettings(companyId);
  const current: FollowupSettings = q.data ?? { mode: 'arrete', testRecipient: null, updatedAt: null };
  const [draft, setDraft] = useState<{ mode: FollowupMode; email: string } | null>(null);
  const mode = draft?.mode ?? current.mode;
  const email = draft?.email ?? (current.testRecipient ?? '');
  const dirty = !!draft && (draft.mode !== current.mode || draft.email.trim().toLowerCase() !== (current.testRecipient ?? ''));
  const needsEmail = mode === 'test' && !isEmail(email);

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'actif' && current.mode !== 'actif') {
        const ok = await confirm({ title: t('followups.modeActifTitle'), message: t('followups.modeActifMsg'), confirmLabel: t('followups.modeActifConfirm'), variant: 'delete' });
        if (!ok) return false;
      }
      await setFollowupSettings(companyId, mode, email || null);
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
      </div>
      <div className="min-w-64 flex-1 text-[13px] text-muted-foreground">
        <p>{fillVars(t(`followups.modeHelp_${current.mode}`), { email: current.testRecipient ?? '' })}</p>
        {!admin && <p className="mt-1">{t('followups.modeAdminOnly')}</p>}
      </div>
      {admin && (
        <div className="flex w-full flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="space-y-1 text-[12px]">
            <span className="block font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('followups.modeTitle')}</span>
            <Select value={mode} onValueChange={(v) => setDraft({ mode: v as FollowupMode, email })}>
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
              onChange={(e) => setDraft({ mode, email: e.target.value })}
              aria-invalid={needsEmail || undefined}
            />
          </label>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || needsEmail || save.isPending || q.isLoading}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} {t('followups.modeSave')}
          </Button>
          {needsEmail && <p className="basis-full text-[12px] text-[var(--danger)]">{t('followups.modeTestNeedsEmail')}</p>}
        </div>
      )}
    </div>
  );
}

/** Tuile de Parametres : rappel du mode, lien vers CRM → Relances. */
export function FollowupModeCard() {
  const { activeCompanyId } = useAuth();
  const q = useFollowupSettings(activeCompanyId);
  const s = q.data ?? { mode: 'arrete' as FollowupMode, testRecipient: null };
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
    </Link>
  );
}
