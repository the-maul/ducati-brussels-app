/**
 * Mission 12, carte P3 -- PDV040 : Parametres -> Paiement Stripe (QR Bancontact / carte).
 * Reglage par societe (`stripe_settings`, pas de ligne = desactive) : active oui / non, moyens
 * proposes, mode test / reel, duree du QR au comptoir. Etat de la cle (lu par la fonction Edge,
 * jamais la cle elle-meme), adresse du webhook a declarer chez Stripe. Administrateur seulement ;
 * passage en reel confirme. Rappel de la regle : aucun supplement, frais a charge du magasin.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, FlaskConical, KeyRound, Loader2, Save, TriangleAlert, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { getStripeSettings, getStripeStatus, setStripeSettings, stripeStatusKey, type StripeMethodCode, type StripeSettings } from './stripe-pay-api';

const METHODS: StripeMethodCode[] = ['bancontact', 'card', 'wero'];

export function StripeSettingsPanel({ companyId }: { companyId: string }) {
  const { rolesForActiveCompany } = useAuth();
  const admin = rolesForActiveCompany.includes('admin');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const settingsQ = useQuery({ queryKey: ['stripe-settings', companyId], queryFn: () => getStripeSettings(companyId) });
  const statusQ = useQuery({ queryKey: stripeStatusKey(companyId), queryFn: () => getStripeStatus(companyId), retry: false });
  const [draft, setDraft] = useState<StripeSettings | null>(null);
  const current = draft ?? settingsQ.data ?? null;

  const save = useMutation({
    meta: { success: false, error: false },
    mutationFn: async (s: StripeSettings) => {
      if (s.mode === 'live' && settingsQ.data?.mode !== 'live') {
        const ok = await confirm({ title: t('stripePay.liveConfirmTitle'), message: t('stripePay.liveConfirmMsg'), confirmLabel: t('stripePay.liveConfirmDo'), variant: 'delete' });
        if (!ok) return false;
      }
      await setStripeSettings(companyId, s);
      return true;
    },
    onSuccess: (done) => {
      if (!done) return;
      toast.success(t('stripePay.saved'));
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['stripe-settings', companyId] });
      qc.invalidateQueries({ queryKey: stripeStatusKey(companyId) });
    },
    onError: (e) => toast.error(`${t('stripePay.errorPrefix')} : ${errorMessage(e)}`),
  });

  if (settingsQ.isLoading || !current) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  const set = (patch: Partial<StripeSettings>) => setDraft({ ...current, ...patch });
  const toggle = (m: StripeMethodCode, on: boolean) => set({ methods: METHODS.filter((x) => (x === m ? on : current.methods.includes(x))) });
  const minutesOk = Number.isInteger(current.counterMinutes) && current.counterMinutes >= 30 && current.counterMinutes <= 1440;
  const st = statusQ.data;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">{t('stripePay.settingsIntro')}</p>
      <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('stripePay.rule')}</p>

      <section className="space-y-3 rounded-md border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold"><KeyRound className="size-5 text-primary" /> {t('stripePay.keyStatus')}</h2>
        {statusQ.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
          : statusQ.isError || !st ? <StatusBadge tone="warning" icon={TriangleAlert} label={t('stripePay.keyUnknown')} />
          : !st.configured ? <StatusBadge tone="warning" icon={TriangleAlert} label={t('stripePay.keyMissing')} />
          : st.keyMode === 'live' ? <StatusBadge tone="success" icon={CheckCircle2} label={t('stripePay.keyLive')} />
          : <StatusBadge tone="info" icon={FlaskConical} label={t('stripePay.keyTest')} />}
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-[13px] font-bold"><Webhook className="size-4" /> {t('stripePay.webhookLabel')}</p>
          <p className="break-all font-mono text-[12px]">{st?.webhookUrl ?? '<SUPABASE_URL>/functions/v1/stripe-webhook'}</p>
          <p className="text-[12px] text-muted-foreground">{t('stripePay.webhookEvents')}</p>
        </div>
      </section>

      <section className="space-y-4 rounded-md border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold"><CreditCard className="size-5 text-primary" /> {t('stripePay.settingsTitle')}</h2>
        {!admin && <p className="text-[13px] text-muted-foreground">{t('stripePay.adminOnly')}</p>}
        <label className="flex items-center gap-3 text-[14px]">
          <Switch checked={current.enabled} onCheckedChange={(v) => set({ enabled: v })} disabled={!admin} />
          {t('stripePay.enabled')}
        </label>
        <div className="space-y-2">
          <Label>{t('stripePay.methodsLabel')}</Label>
          {METHODS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={current.methods.includes(m)} onCheckedChange={(v) => toggle(m, v === true)} disabled={!admin} />
              {t(`stripePay.method_${m}`)}
            </label>
          ))}
          <p className="text-[12px] text-muted-foreground">{t('stripePay.weroHint')}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label>{t('stripePay.modeLabel')}</Label>
            <Select value={current.mode} onValueChange={(v) => set({ mode: v as 'test' | 'live' })} disabled={!admin}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="test">{t('stripePay.mode_test')}</SelectItem>
                <SelectItem value="live">{t('stripePay.mode_live')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('stripePay.counterMinutes')}</Label>
            <Input
              type="number" min={30} max={1440} step={1} className="w-32 text-right tabular-nums" disabled={!admin}
              value={String(current.counterMinutes)} onChange={(e) => set({ counterMinutes: Math.round(Number(e.target.value)) })}
              aria-invalid={!minutesOk || undefined}
            />
          </div>
        </div>
        {admin && (
          <Button onClick={() => save.mutate(current)} disabled={!draft || save.isPending || current.methods.length === 0 || !minutesOk}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('stripePay.save')}
          </Button>
        )}
      </section>
    </div>
  );
}
