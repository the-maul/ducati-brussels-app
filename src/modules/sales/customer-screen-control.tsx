/**
 * M6 -- Ecran client sur tablette (PDV020) : cote vendeur.
 *  - `useCustomerScreenPush` : pousse l ecran du vendeur (mode + ticket), dedoublonne, sans bruit si la
 *    migration n est pas appliquee ;
 *  - `CustomerScreenButton` : le bouton « Ecran client » de la caisse et du document (etat connecte /
 *    deconnecte = couleur + icone + libelle), la fenetre avec l apercu reduit de ce que voit le client,
 *    l appairage par code, « Prendre cet ecran », les gestes manuels (accueil, ticket, carte, signature,
 *    merci) et les reponses du client : adresse e-mail (le vendeur envoie le ticket) et signature
 *    (rangee automatiquement en GED du document, empreinte SHA-256 calculee par la base).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, CreditCard, Home, Loader2, Mail, MonitorOff, MonitorSmartphone, PenLine, Receipt, Wifi, WifiOff, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars, getLocale } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { uploadAttachment } from '@/modules/documents/ged-api';
import { CustomerScreenPreview } from './customer-screen-view';
import { subscribeCounterDisplay } from './qr-payment-api';
import {
  SCREEN_POLL_MS, deviceOnline, isPairingCode, normalizePairingCode, resolveScreen, screenLinkState, screenLocale,
  type ScreenLink, type ScreenMode, type ScreenPayload,
} from './customer-screen';
import {
  claimDevice, clearScreenReply, getVendorScreen, isMissingFunction, listDevices, pairDevice, setScreen,
  type ScreenReply,
} from './customer-screen-api';

const SCREEN_PATH = '/ecran-client';

/* ------------------------------------------------------------------------------------------------
 * Pousser l ecran
 * ---------------------------------------------------------------------------------------------- */

export function useCustomerScreenPush(companyId: string | null | undefined) {
  const qc = useQueryClient();
  const last = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const missing = useRef(false);
  const warned = useRef(false);

  const send = useCallback((mode: ScreenMode, payload: ScreenPayload, opts: { force?: boolean; immediate?: boolean } = {}) => {
    if (!companyId || missing.current) return;
    const key = `${mode}|${JSON.stringify(payload)}`;
    if (!opts.force && key === last.current) return;
    last.current = key;
    if (timer.current) window.clearTimeout(timer.current);
    const run = () => {
      setScreen(companyId, mode, payload)
        .then(() => { void qc.invalidateQueries({ queryKey: ['vendor-screen', companyId] }); })
        .catch((e) => {
          if (isMissingFunction(e)) { missing.current = true; return; }
          last.current = null;
          if (!warned.current) { warned.current = true; toast.error(fillVars(t('customerScreen.pushError'), { error: errorMessage(e) })); }
        });
    };
    if (opts.immediate) run(); else timer.current = window.setTimeout(run, 250);
  }, [companyId, qc]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return send;
}

/** Etat de l ecran du vendeur (apercu, appareils, reponse du client), relu en direct. */
export function useVendorScreen(companyId: string | null | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['vendor-screen', companyId],
    queryFn: () => getVendorScreen(companyId!),
    enabled: !!companyId,
    refetchInterval: (query) => (query.state.error && isMissingFunction(query.state.error) ? false : SCREEN_POLL_MS),
    retry: (n, e) => !isMissingFunction(e) && n < 2,
  });
  useEffect(() => {
    if (!user?.id) return;
    return subscribeCounterDisplay(user.id, () => { void qc.invalidateQueries({ queryKey: ['vendor-screen'] }); });
  }, [user?.id, qc]);
  const available = !(q.error && isMissingFunction(q.error));
  const link: ScreenLink = q.isLoading ? 'none' : screenLinkState(q.data?.devices, q.data?.now, available);
  return { query: q, available, link };
}

/* ------------------------------------------------------------------------------------------------
 * Bouton et fenetre
 * ---------------------------------------------------------------------------------------------- */

const LINK_LOOK: Record<ScreenLink, { icon: typeof Wifi; cls: string; key: string }> = {
  online: { icon: Wifi, cls: 'text-success', key: 'stateOnline' },
  offline: { icon: WifiOff, cls: 'text-warning', key: 'stateOffline' },
  none: { icon: MonitorSmartphone, cls: 'text-muted-foreground', key: 'stateNone' },
  unavailable: { icon: MonitorOff, cls: 'text-muted-foreground', key: 'stateUnavailable' },
};

export type ScreenAction = 'accueil' | 'ticket' | 'terminal' | 'merci';

export function CustomerScreenButton({
  companyId, onAction, signatureFor, onSendTicket, allowEmail, onAllowEmail, initialCode, onSigned, hint,
}: {
  companyId: string;
  /** Gestes manuels ; absents = boutons masques. */
  onAction?: (a: ScreenAction) => void;
  /** Document a faire signer (BL, prise en charge, decharge). */
  signatureFor?: { documentId: string; number: string | null } | null;
  /** Le client a tape son adresse sur la tablette : le vendeur envoie le ticket. */
  onSendTicket?: (email: string) => void;
  allowEmail?: boolean;
  onAllowEmail?: (v: boolean) => void;
  /** Code lu dans l adresse (?ecran=XXXXXX, QR de la tablette) : ouvre la fenetre pre-remplie. */
  initialCode?: string | null;
  onSigned?: () => void;
  hint?: string;
}) {
  const { query, available, link } = useVendorScreen(companyId);
  const [open, setOpen] = useState(!!initialCode);
  const look = LINK_LOOK[link];
  const Icon = look.icon;
  const reply = query.data?.reply ?? null;
  useReplyHandling(companyId, reply, onSigned);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} title={t(`customerScreen.${look.key}`)} aria-label={t(`customerScreen.${look.key}`)}>
        <Icon className={look.cls} /> <span className={look.cls}>{t(`customerScreen.${look.key}`)}</span>
        {reply?.kind === 'email' && <Mail className="text-info" aria-hidden />}
      </Button>
      {reply?.kind === 'email' && onSendTicket && (
        <EmailReplyBanner companyId={companyId} email={reply.email} onSend={onSendTicket} />
      )}
      {open && (
        <ScreenDialog
          companyId={companyId} available={available} link={link} onClose={() => setOpen(false)}
          onAction={onAction} signatureFor={signatureFor} allowEmail={allowEmail} onAllowEmail={onAllowEmail}
          initialCode={initialCode ?? null} hint={hint}
        />
      )}
    </>
  );
}

function EmailReplyBanner({ companyId, email, onSend }: { companyId: string; email: string; onSend: (email: string) => void }) {
  const qc = useQueryClient();
  return (
    <span className="inline-flex items-center gap-2 rounded-[var(--radius-card)] bg-info-bg px-3 py-1.5 text-[13px] text-info">
      <Mail className="size-4" aria-hidden /> {fillVars(t('customerScreen.replyEmail'), { email })}
      <Button
        size="sm" variant="outline"
        onClick={() => {
          onSend(email);
          clearScreenReply(companyId).then(() => qc.invalidateQueries({ queryKey: ['vendor-screen', companyId] })).catch(() => undefined);
        }}
      >
        <Mail /> {t('customerScreen.sendTicket')}
      </Button>
    </span>
  );
}

/** Signature recue : rangee une seule fois dans la GED du document, puis la reponse est effacee. */
function useReplyHandling(companyId: string, reply: ScreenReply | null, onSigned?: () => void) {
  const qc = useQueryClient();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!reply || reply.kind !== 'signature' || !reply.document_id) return;
    const key = `${reply.document_id}|${reply.at}`;
    if (done.current === key) return;
    done.current = key;
    (async () => {
      try {
        const blob = await (await fetch(reply.png)).blob();
        const stamp = Date.now();
        const file = new File([blob], `signature-ecran-client-${stamp}.png`, { type: 'image/png' });
        const note = [reply.signer_name, `SHA-256 ${reply.hash}`].filter(Boolean).join(' - ');
        await uploadAttachment(companyId, 'document', reply.document_id!, file, stamp, note, null);
        await clearScreenReply(companyId);
        toast.success(t('customerScreen.archived'));
        void qc.invalidateQueries({ queryKey: ['vendor-screen', companyId] });
        void qc.invalidateQueries({ queryKey: ['attachments'] });
        onSigned?.();
      } catch (e) {
        done.current = null;
        toast.error(fillVars(t('customerScreen.archiveError'), { error: errorMessage(e) }));
      }
    })();
  }, [reply, companyId, qc, onSigned]);
}

function ScreenDialog({
  companyId, available, link, onClose, onAction, signatureFor, allowEmail, onAllowEmail, initialCode, hint,
}: {
  companyId: string; available: boolean; link: ScreenLink; onClose: () => void;
  onAction?: (a: ScreenAction) => void; signatureFor?: { documentId: string; number: string | null } | null;
  allowEmail?: boolean; onAllowEmail?: (v: boolean) => void; initialCode: string | null; hint?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { query } = useVendorScreen(companyId);
  const state = query.data;
  const [signOpen, setSignOpen] = useState(false);
  const serverNow = state ? Date.parse(state.now) + (Date.now() - (query.dataUpdatedAt || Date.now())) : Date.now();
  const resolved = resolveScreen(state?.screen ?? null, serverNow);
  const devicesQ = useQuery({ queryKey: ['screen-devices', companyId], queryFn: () => listDevices(companyId), enabled: available });
  const others = (devicesQ.data ?? []).filter((d) => !d.revoked_at && d.user_id !== user?.id);

  const claim = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => claimDevice(id),
    onSuccess: () => { toast.success(t('customerScreen.claimed')); void qc.invalidateQueries({ queryKey: ['vendor-screen', companyId] }); void devicesQ.refetch(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(`${getLocale()}-BE`, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : t('customerScreen.never'));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MonitorSmartphone className="size-5" /> {t('customerScreen.dialogTitle')}</DialogTitle>
          <DialogDescription>{hint ?? t('customerScreen.autoHint')}</DialogDescription>
        </DialogHeader>

        {!available ? (
          <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('customerScreen.unavailableHint')}</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('customerScreen.preview')}</p>
              <CustomerScreenPreview
                snapshot={state?.screen ?? null} resolved={resolved}
                locale={screenLocale(state?.screen?.payload.locale, null)}
                companyName={state?.screen?.company_name ?? ''}
              />
              <LinkBadge link={link} />
              {onAction && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" variant="outline" onClick={() => onAction('accueil')}><Home /> {t('customerScreen.showWelcome')}</Button>
                  <Button size="sm" variant="outline" onClick={() => onAction('ticket')}><Receipt /> {t('customerScreen.showTicket')}</Button>
                  <Button size="sm" variant="outline" onClick={() => onAction('terminal')}><CreditCard /> {t('customerScreen.showTerminal')}</Button>
                  <Button size="sm" variant="outline" onClick={() => onAction('merci')}><CheckCircle2 /> {t('customerScreen.showThanks')}</Button>
                  {signatureFor && <Button size="sm" variant="outline" onClick={() => setSignOpen(true)}><PenLine /> {t('customerScreen.showSign')}</Button>}
                </div>
              )}
              {onAllowEmail && (
                <label className="flex items-center gap-2 pt-1 text-[13px]">
                  <Checkbox checked={!!allowEmail} onCheckedChange={(v) => onAllowEmail(v === true)} /> {t('customerScreen.allowEmail')}
                </label>
              )}
              {resolved.mode === 'signature' && !resolved.signed && (
                <p className="flex items-center gap-2 text-[13px] text-info"><Loader2 className="size-4 animate-spin" /> {t('customerScreen.waitingSignature')}</p>
              )}
            </div>

            <div className="space-y-4">
              <section className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('customerScreen.myScreens')}</p>
                {(state?.devices ?? []).length === 0 && <p className="text-[13px] text-muted-foreground">{t('customerScreen.stateNone')}</p>}
                <ul className="space-y-1 text-[13px]">
                  {(state?.devices ?? []).map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <OnlineBadge online={deviceOnline(d.last_seen_at, state?.now)} />
                      <span className="font-bold">{d.name}</span>
                      <span className="font-mono text-[12px] text-muted-foreground">{d.register_code}</span>
                      <span className="text-[12px] text-muted-foreground">{fillVars(t('customerScreen.lastSeen'), { when: when(d.last_seen_at) })}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <PairForm companyId={companyId} initialCode={initialCode} onPaired={() => { void qc.invalidateQueries({ queryKey: ['vendor-screen', companyId] }); void devicesQ.refetch(); }} />

              {others.length > 0 && (
                <section className="space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('customerScreen.otherScreens')}</p>
                  <ul className="space-y-1 text-[13px]">
                    {others.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2">
                        <OnlineBadge online={deviceOnline(d.last_seen_at, d.server_now)} />
                        <span className="font-bold">{d.name}</span>
                        <span className="font-mono text-[12px] text-muted-foreground">{d.register_code}</span>
                        {d.user_name && <span className="text-[12px] text-muted-foreground">{fillVars(t('customerScreen.followedBy'), { name: d.user_name })}</span>}
                        <Button size="sm" variant="ghost" className="ml-auto" disabled={claim.isPending} onClick={() => claim.mutate(d.id)}>
                          <Link2 /> {t('customerScreen.claim')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        )}
        {signOpen && signatureFor && (
          <SignatureRequestDialog companyId={companyId} target={signatureFor} locale={state?.screen?.payload.locale ?? null} onClose={() => setSignOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkBadge({ link }: { link: ScreenLink }) {
  const tone = link === 'online' ? 'success' : link === 'offline' ? 'warning' : 'neutral';
  const look = LINK_LOOK[link];
  return <StatusBadge tone={tone} icon={look.icon} label={t(`customerScreen.${look.key}`)} />;
}

function OnlineBadge({ online }: { online: boolean }) {
  return online
    ? <StatusBadge tone="success" icon={Wifi} label={t('customerScreen.stateOnline')} />
    : <StatusBadge tone="warning" icon={WifiOff} label={t('customerScreen.stateOffline')} />;
}

function PairForm({ companyId, initialCode, onPaired }: { companyId: string; initialCode: string | null; onPaired: () => void }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [name, setName] = useState(t('customerScreen.nameDefault'));
  const [register, setRegister] = useState('CAISSE-1');
  const norm = normalizePairingCode(code);
  const valid = isPairingCode(norm);
  const pair = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => pairDevice(norm, companyId, name, register),
    onSuccess: () => { toast.success(t('customerScreen.paired')); setCode(''); onPaired(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form className="space-y-2 rounded-md border border-border p-3" onSubmit={(e) => { e.preventDefault(); if (valid) pair.mutate(); }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('customerScreen.pairSection')}</p>
      <p className="text-[12px] text-muted-foreground">{fillVars(t('customerScreen.pairIntro'), { path: SCREEN_PATH })}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="pair-code">{t('customerScreen.codeLabel')}</Label>
          <Input id="pair-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={9} autoComplete="off" className="font-mono uppercase tracking-[0.12em]" autoFocus={!!initialCode} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pair-name">{t('customerScreen.nameLabel')}</Label>
          <Input id="pair-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pair-register">{t('customerScreen.registerInput')}</Label>
          <Input id="pair-register" value={register} onChange={(e) => setRegister(e.target.value.toUpperCase())} maxLength={12} className="font-mono" />
        </div>
      </div>
      {code && !valid && <p className="text-[12px] text-warning">{t('customerScreen.codeInvalid')}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!valid || pair.isPending}>
          {pair.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} {t('customerScreen.pairButton')}
        </Button>
      </div>
    </form>
  );
}

function SignatureRequestDialog({ companyId, target, locale, onClose }: {
  companyId: string; target: { documentId: string; number: string | null }; locale: unknown; onClose: () => void;
}) {
  const qc = useQueryClient();
  const number = target.number ?? '';
  const [title, setTitle] = useState(t('customerScreen.signDefaultTitle'));
  const [text, setText] = useState(fillVars(t('customerScreen.signDefaultText'), { number }));
  const loc = useMemo(() => screenLocale(locale, null), [locale]);
  const send = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => setScreen(companyId, 'signature', {
      document_number: target.number, locale: loc,
      signature: { title: title.trim(), text: text.trim(), document_id: target.documentId },
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['vendor-screen', companyId] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{t('customerScreen.signDialogTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="sig-title">{t('customerScreen.signTitleLabel')}</Label><Input id="sig-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></div>
          <div className="space-y-1"><Label htmlFor="sig-text">{t('customerScreen.signTextLabel')}</Label><Textarea id="sig-text" value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => send.mutate()} disabled={!title.trim() || !text.trim() || send.isPending}>
            {send.isPending ? <Loader2 className="animate-spin" /> : <PenLine />} {t('customerScreen.signSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
