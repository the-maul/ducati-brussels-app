/**
 * Paramètres → « Réassort minimax » (décision de Simon du 18/11/2026), par société :
 * automatique (défaut : la pièce passée sous son minimum part tout de suite au panier standard)
 * ou proposition manuelle (fenêtre à la validation d'une vente / caisse / picking, comme G8).
 * Statut = couleur + icône + libellé ; seul un administrateur change le réglage (tracé en base).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hand, Loader2, RefreshCcw, Zap, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { getMinimaxMode, minimaxModeKey, setMinimaxMode } from './minimax-api';
import { MINIMAX_MODES, type MinimaxMode } from './minimax-immediate';

export const MINIMAX_MODE_ICON: Record<MinimaxMode, LucideIcon> = { auto: Zap, manuel: Hand };

export function MinimaxModeBadge({ mode }: { mode: MinimaxMode }) {
  return <StatusBadge tone={mode === 'auto' ? 'success' : 'info'} icon={MINIMAX_MODE_ICON[mode]} label={t(`minimax.mode_${mode}`)} />;
}

export function useMinimaxMode(companyId: string | null | undefined) {
  return useQuery({ queryKey: minimaxModeKey(companyId), queryFn: () => getMinimaxMode(companyId!), enabled: !!companyId });
}

export function MinimaxModeCard() {
  const { activeCompanyId, isAdmin } = useAuth();
  const companyId = activeCompanyId ?? '';
  const admin = !!companyId && isAdmin(companyId);
  const qc = useQueryClient();
  const q = useMinimaxMode(companyId);
  const current: MinimaxMode = q.data ?? 'auto';
  const [draft, setDraft] = useState<MinimaxMode | null>(null);
  const mode = draft ?? current;

  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => setMinimaxMode(companyId, mode),
    onSuccess: () => {
      toast.success(t('minimax.saved'));
      setDraft(null);
      qc.invalidateQueries({ queryKey: minimaxModeKey(companyId) });
    },
    onError: (e) => toast.error(`${t('minimax.error')} : ${e instanceof Error ? e.message : String(e)}`),
  });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <RefreshCcw className="size-6 text-primary" />
      <span className="font-ui text-[15px] font-bold">{t('minimax.cardTitle')}</span>
      <span className="text-sm text-muted-foreground">{t('minimax.cardDesc')}</span>
      <span>{q.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <MinimaxModeBadge mode={current} />}</span>
      <p className="text-[13px] text-muted-foreground">{t(`minimax.modeHelp_${mode}`)}</p>
      {admin ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-[12px]">
            <span className="block font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('minimax.modeLabel')}</span>
            <Select value={mode} onValueChange={(v) => setDraft(v as MinimaxMode)}>
              <SelectTrigger className="h-8 w-56" aria-label={t('minimax.modeLabel')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {MINIMAX_MODES.map((m) => {
                  const Icon = MINIMAX_MODE_ICON[m];
                  return <SelectItem key={m} value={m}><span className="inline-flex items-center gap-2"><Icon className="size-3.5" aria-hidden /> {t(`minimax.mode_${m}`)}</span></SelectItem>;
                })}
              </SelectContent>
            </Select>
          </label>
          <Button size="sm" onClick={() => save.mutate()} disabled={mode === current || save.isPending || q.isLoading}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} {t('minimax.save')}
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">{t('minimax.adminOnly')}</p>
      )}
    </div>
  );
}
