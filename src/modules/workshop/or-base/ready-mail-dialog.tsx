/**
 * M8 — Message « moto prete » au client (G8 « SMS / mail de fin de travaux », ATE018, 18/11/2026).
 *
 * Le message est prepare dans la langue de la fiche du client (objet + corps modifiables) et passe
 * par le mecanisme d'envoi existant (`graph-send-email`, boite Outlook au choix) en MODE TEST
 * seulement : « Verifier sans envoyer » (dryRun) controle la boite, le destinataire et le pied de
 * mail, rien ne part. L'envoi reel est derriere `READY_MAIL_LIVE` (false) : a ouvrir quand l'atelier
 * aura valide le texte. « Marquer Client informe » passe l'OR au statut G8 « Client informe »
 * (client prevenu autrement, par telephone par exemple).
 * Pas de SMS : aucun fournisseur SMS n'est pose (bible M08 / M10).
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Mail, MailCheck, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { MailPreview } from '@/components/mail-preview';
import { useAuth } from '@/lib/auth/auth-context';
import { clientAppUrl } from '@/lib/client-app-url';
import { t, tIn, fillVars } from '@/lib/i18n';
import { contactLocale } from '@/lib/i18n/client-locale';
import { listCompanyMailboxes } from '@/modules/crm/api';
import { contactDisplayName, getContact } from '@/modules/contacts/api';
import { getVehicle, vehicleLabel } from '@/modules/vehicles/api';
import { mailErrorLabel, plainTextToHtml } from '@/modules/sales/document-mail-api';
import { setOrStatus } from './api';

/** Envoi reel du message « moto prete » : desactive tant que l'atelier n'a pas valide le texte. */
export const READY_MAIL_LIVE = false;

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} EUR`;

export function ReadyMailDialog({ companyId, companyName, or, onClose, onInformed }: {
  companyId: string; companyName: string;
  or: { id: string; number: string | null; contact_id: string | null; vehicle_id: string | null; total_ttc: number };
  onClose: () => void; onInformed: () => void;
}) {
  const { session } = useAuth();
  const myEmail = (session?.user?.email ?? '').toLowerCase();
  const prepQ = useQuery({
    queryKey: ['ready-mail', or.id],
    staleTime: Infinity,
    queryFn: async () => {
      const contact = or.contact_id ? await getContact(or.contact_id) : null;
      const vehicle = or.vehicle_id ? await getVehicle(or.vehicle_id) : null;
      const locale = contactLocale(contact as { locale?: unknown } | null);
      const vars = {
        company: companyName, client: contact ? contactDisplayName(contact) : '',
        vehicle: vehicle ? vehicleLabel(vehicle) : tIn(locale, 'orBase.readyVehicleFallback'),
        or: or.number ? fillVars(tIn(locale, 'orBase.readyOr'), { number: or.number }) : '',
        amount: eur(or.total_ttc),
      };
      return {
        contact, locale,
        subject: fillVars(tIn(locale, 'orBase.readySubject'), vars),
        body: fillVars(tIn(locale, 'orBase.readyBody'), vars),
      };
    },
  });
  const prep = prepQ.data;
  const [to, setTo] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const toV = to ?? prep?.contact?.email ?? '';
  const subjectV = subject ?? prep?.subject ?? '';
  const bodyV = body ?? prep?.body ?? '';
  const [preview, setPreview] = useState<{ from: string; html: string } | null>(null);

  const mailboxesQ = useQuery({ queryKey: ['company-mailboxes', companyId], queryFn: () => listCompanyMailboxes(companyId) });
  const shared = (mailboxesQ.data ?? []).map((m) => m.address.toLowerCase());
  const sameDomain = shared.some((a) => a.split('@')[1] === myEmail.split('@')[1]);
  const senders = [...shared, ...(myEmail && sameDomain && !shared.includes(myEmail) ? [myEmail] : [])];
  const [fromPick, setFromPick] = useState('');
  const fromBox = fromPick || (senders.includes(myEmail) ? myEmail : senders[0] ?? '');
  const validTo = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(toV.trim());
  const canRun = validTo && !!subjectV.trim() && !!fromBox;

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      if (!dryRun && !READY_MAIL_LIVE) throw new Error(t('orBase.readyTestOnly'));
      const { data, error } = await supabase.functions.invoke('graph-send-email', {
        body: {
          companyId, ...(or.contact_id ? { contactId: or.contact_id } : {}), to: toV.trim(), from: fromBox || undefined,
          subject: subjectV, body: plainTextToHtml(bodyV), origin: clientAppUrl(),
          ...(prep?.locale ? { locale: prep.locale } : {}),
          ...(dryRun ? { dryRun: true } : {}),
        },
      });
      if (error) {
        const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
        let code: string | undefined;
        if (ctx && typeof ctx.json === 'function') { try { code = ((await ctx.json()) as { error?: string })?.error; } catch { /* corps illisible */ } }
        return { ok: false as const, error: code ?? error.message };
      }
      const r = data as { ok?: boolean; error?: string; from?: string; dryRun?: boolean; html?: string };
      if (!r?.ok) return { ok: false as const, error: r?.error ?? 'send_failed' };
      if (!r.dryRun) await setOrStatus(or.id, 'client_informe');
      return { ok: true as const, dryRun: !!r.dryRun, from: r.from ?? fromBox, html: r.html ?? '' };
    },
    meta: { success: false },
    onSuccess: (r) => {
      if (!r.ok) { toast.error(mailErrorLabel(r.error)); return; }
      if (r.dryRun) { setPreview({ from: r.from, html: r.html }); return; }
      toast.success(t('orBase.informed'));
      onInformed();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  const informed = useMutation({
    mutationFn: () => setOrStatus(or.id, 'client_informe'),
    meta: { success: false },
    onSuccess: () => { toast.success(t('orBase.informed')); onInformed(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('workshop.errSave')),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="size-5" /> {t('orBase.readyTitle')}</DialogTitle>
          <DialogDescription>{t('orBase.readyIntro')}</DialogDescription>
        </DialogHeader>
        {prepQ.isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {prep && (
          <div className="space-y-3">
            {!prep.contact?.email && <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('orBase.readyNoEmail')}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('salesMail.from')}</Label>
                <Select value={fromBox} onValueChange={(v) => { setFromPick(v); setPreview(null); }}>
                  <SelectTrigger><SelectValue placeholder={t('salesMail.fromPlaceholder')} /></SelectTrigger>
                  <SelectContent>{senders.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('salesMail.to')}</Label>
                <Input type="email" value={toV} onChange={(e) => { setTo(e.target.value); setPreview(null); }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('salesMail.subject')}</Label>
              <Input value={subjectV} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('salesMail.body')}</Label>
              <Textarea rows={9} value={bodyV} onChange={(e) => { setBody(e.target.value); setPreview(null); }} />
            </div>
            {!READY_MAIL_LIVE && <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('orBase.readyTestOnly')}</p>}
            {preview && (
              <div className="space-y-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
                <p className="flex items-center gap-1.5 font-medium"><ShieldCheck className="size-3.5" /> {t('salesMail.dryRunOk')}</p>
                {preview.html && <MailPreview html={preview.html} />}
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>{t('action.cancel')}</Button>
          <Button variant="outline" onClick={() => informed.mutate()} disabled={informed.isPending}>
            {informed.isPending ? <Loader2 className="animate-spin" /> : <MailCheck />} {t('orBase.markInformed')}
          </Button>
          <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending || !canRun} title={t('salesMail.dryRunHint')}>
            {run.isPending && run.variables === true ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('salesMail.dryRun')}
          </Button>
          {READY_MAIL_LIVE && (
            <Button onClick={() => run.mutate(false)} disabled={run.isPending || !canRun}>
              {run.isPending && run.variables === false ? <Loader2 className="animate-spin" /> : <Mail />} {t('salesMail.send')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
