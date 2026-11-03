/**
 * M6 -- Ecran client sur tablette (PDV020) : la tablette elle-meme (/ecran-client).
 *
 * Trois cas, dans cet ordre :
 *  1. la tablette garde un jeton d appareil (localStorage) : elle lit SON ecran par jeton
 *     (customer_display_read, sans compte), en direct (signal Realtime sans donnee sur son canal secret)
 *     et toutes les 5 s en secours. Jeton inconnu, expire ou revoque : elle redemande un code ;
 *  2. pas de jeton, mais une session de l equipe (la fenetre « Ouvrir l ecran client » du vendeur,
 *     comme avant) : ecran du vendeur connecte ; si la migration n est pas appliquee, l ancien ecran
 *     QR de virement (CustomerDisplay) est servi tel quel ;
 *  3. ni l un ni l autre : la tablette demande un code d appairage et l affiche (code + QR).
 * Aucune donnee client n est gardee sur la tablette : seulement le jeton.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2, LogIn, Maximize, WifiOff, MonitorSmartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { tIn, fillVars, type Locale } from '@/lib/i18n';
import { CustomerDisplay } from './customer-display';
import { CustomerScreenView } from './customer-screen-view';
import { QrCodeSvg } from './qr-code-svg';
import { subscribeCounterDisplay } from './qr-payment-api';
import {
  SCREEN_POLL_MS, canChooseLocale, keepDeviceToken, pairingUrl, resolveScreen, screenLocale,
  type DeviceRead, type ResolvedScreen, type ScreenSnapshot,
} from './customer-screen';
import {
  beginPairing, getVendorScreen, isMissingFunction, readDevice, readDeviceToken, replyEmail, replySignature,
  storeDeviceToken, subscribeDeviceChannel,
} from './customer-screen-api';

/** Horloge du serveur estimee : `now` de la derniere lecture + temps ecoule depuis. */
function useServerClock(serverNow: string | null | undefined, fetchedAt: number): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setTick(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const base = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(base) ? base + (tick - fetchedAt) : tick;
}

/** Langue choisie sur la tablette, oubliee au retour a l accueil apres une vente. */
function useScreenLocale(customerLocale: unknown, mode: ResolvedScreen['mode']) {
  const [chosen, setChosen] = useState<Locale | null>(null);
  const prev = useRef(mode);
  useEffect(() => {
    if (mode === 'accueil' && prev.current !== 'accueil' && prev.current !== 'ticket') setChosen(null);
    prev.current = mode;
  }, [mode]);
  return { locale: screenLocale(customerLocale, chosen), chosen, setChosen, canChoose: canChooseLocale(customerLocale) };
}

/** L ecran reste allume (kiosque) quand le navigateur le permet. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const ask = () => { nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined); };
    ask();
    const onVis = () => { if (document.visibilityState === 'visible') ask(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release().catch(() => undefined); };
  }, []);
}

const fullscreen = () => {
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
};

function Corner({ locale, offline }: { locale: Locale; offline?: boolean }) {
  return (
    <>
      {offline && (
        <p className="fixed left-3 top-3 z-10 flex items-center gap-2 rounded-[var(--radius-card)] bg-warning-bg px-3 py-2 text-[16px] text-warning">
          <WifiOff className="size-5" aria-hidden /> {tIn(locale, 'customerScreen.connectionLost')}
        </p>
      )}
      <Button variant="ghost" size="sm" className="fixed bottom-3 right-3 opacity-40 hover:opacity-100" onClick={fullscreen} title={tIn(locale, 'qrPay.fullscreen')}>
        <Maximize className="size-4" />
      </Button>
    </>
  );
}

function Spinner() {
  return <div className="grid min-h-screen place-items-center bg-background"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;
}

/* ------------------------------------------------------------------------------------------------ */

export function CustomerScreenPage({ forcePairing = false }: { forcePairing?: boolean }) {
  const { loading, session, roles } = useAuth();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setToken(readDeviceToken()); }, []);
  useWakeLock();

  const lost = useCallback((why: DeviceRead['status']) => {
    storeDeviceToken(null);
    setNotice(why === 'revoked' ? 'pairRevoked' : null);
    setToken(null);
  }, []);
  const paired = useCallback((tok: string) => { storeDeviceToken(tok); setToken(tok); }, []);

  if (token === undefined || (!token && loading)) return <Spinner />;
  if (token) return <DeviceScreen token={token} onLost={lost} />;
  if (session && roles.length > 0 && !forcePairing) return <SessionScreen />;
  return <PairingStart onStarted={paired} notice={notice} />;
}

/** Demande un code d appairage (une seule fois), puis passe la main a DeviceScreen (jeton en attente). */
function PairingStart({ onStarted, notice }: { onStarted: (token: string) => void; notice: string | null }) {
  const [state, setState] = useState<'busy' | 'missing' | 'error'>('busy');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Differe d un tour : le double montage du mode strict annule le premier essai avant tout appel.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      beginPairing()
        .then((r) => { if (!cancelled) onStarted(r.token); })
        .catch((e) => {
          if (cancelled) return;
          if (isMissingFunction(e)) { setState('missing'); return; }
          setState('error');
          window.setTimeout(() => { if (!cancelled) { setState('busy'); setAttempt((n) => n + 1); } }, SCREEN_POLL_MS);
        });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [attempt, onStarted]);

  const locale: Locale = 'fr';
  if (state === 'missing') {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
          <MonitorSmartphone className="size-20 text-muted-foreground" aria-hidden />
          <p className="text-[24px]">{tIn(locale, 'customerScreen.pairUnavailable')}</p>
          <Button asChild size="lg" className="h-14 px-8 text-[20px]"><Link to="/login"><LogIn /> {tIn(locale, 'customerScreen.pairLogin')}</Link></Button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
      <div className="flex flex-col items-center gap-4 text-center">
        {notice && <p className="rounded-[var(--radius-card)] bg-info-bg px-5 py-3 text-[22px] text-info">{tIn(locale, `customerScreen.${notice}`)}</p>}
        {state === 'error'
          ? <p className="flex items-center gap-3 text-[22px] text-warning"><WifiOff className="size-6" aria-hidden /> {tIn(locale, 'customerScreen.connectionLost')}</p>
          : <Loader2 className="size-8 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}

/** Tablette appairee (ou en attente) : lit son ecran par jeton. */
function DeviceScreen({ token, onLost }: { token: string; onLost: (why: DeviceRead['status']) => void }) {
  const qc = useQueryClient();
  const key = useMemo(() => ['device-screen', token.slice(0, 12)], [token]);
  const q = useQuery({
    queryKey: key,
    queryFn: () => readDevice(token),
    refetchInterval: SCREEN_POLL_MS,
    refetchIntervalInBackground: true,
    retry: true,
    retryDelay: SCREEN_POLL_MS,
  });
  const read = q.data;

  useEffect(() => { if (read && !keepDeviceToken(read)) onLost(read.status); }, [read, onLost]);

  const channel = read?.status === 'paired' ? read.device.channel : null;
  useEffect(() => {
    if (!channel) return;
    return subscribeDeviceChannel(channel, () => { void qc.invalidateQueries({ queryKey: key }); });
  }, [channel, qc, key]);

  const serverNow = useServerClock(read && 'now' in read ? read.now : null, q.dataUpdatedAt || Date.now());
  const snapshot: ScreenSnapshot | null = read?.status === 'paired' ? read.screen : null;
  const resolved = resolveScreen(snapshot, serverNow);
  const { locale, setChosen, canChoose } = useScreenLocale(snapshot?.payload.locale, resolved.mode);

  if (!read) return <Spinner />;
  if (read.status === 'pending') return <PendingScreen code={read.code} expiresAt={read.expires_at} offline={q.isError} />;
  if (read.status !== 'paired') return <Spinner />;

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return (
    <>
      <CustomerScreenView
        snapshot={snapshot} resolved={resolved} locale={locale}
        companyName={snapshot?.company_name ?? ''} registerCode={read.device.register_code}
        chooseLocale={canChoose} onLocale={setChosen}
        onEmail={async (email) => { await replyEmail(token, email); await refresh(); }}
        onSignature={async (png, name) => { await replySignature(token, png, name); await refresh(); }}
      />
      <Corner locale={locale} offline={q.isError} />
    </>
  );
}

function PendingScreen({ code, expiresAt, offline }: { code: string; expiresAt: string; offline: boolean }) {
  const locale: Locale = 'fr';
  const tc = (k: string) => tIn(locale, `customerScreen.${k}`);
  const url = typeof window !== 'undefined' ? pairingUrl(window.location.origin, code) : code;
  const time = expiresAt ? new Date(expiresAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
      <div className="grid w-full max-w-5xl items-center gap-10 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <span className="h-1 w-24 bg-primary" aria-hidden />
          <h1 className="font-display text-[44px] uppercase leading-tight">{tc('pairTitle')}</h1>
          <div>
            <p className="text-[18px] font-bold uppercase tracking-[var(--tracking-label)] text-muted-foreground">{tc('pairCode')}</p>
            <p className="font-mono text-[96px] font-bold leading-none tracking-[0.12em]">{code}</p>
          </div>
          <p className="text-[24px]">{tc('pairHow')}</p>
          <p className="text-[18px] text-muted-foreground">{fillVars(tc('pairExpires'), { time })}</p>
        </div>
        <QrCodeSvg value={url} label={tc('qrPairAlt')} className="aspect-square w-full max-w-[420px] justify-self-center" />
      </div>
      <Corner locale={locale} offline={offline} />
    </div>
  );
}

/** Fenetre ouverte par le vendeur dans sa session (comme avant) ; ancien ecran si la base n est pas a jour. */
function SessionScreen() {
  const { user, activeCompanyId, activeCompany } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['counter-display-state', activeCompanyId],
    queryFn: () => getVendorScreen(activeCompanyId!),
    enabled: !!activeCompanyId,
    refetchInterval: SCREEN_POLL_MS,
    refetchIntervalInBackground: true,
    retry: (n, e) => !isMissingFunction(e) && n < 2,
  });
  useEffect(() => {
    if (!user?.id) return;
    return subscribeCounterDisplay(user.id, () => { void qc.invalidateQueries({ queryKey: ['counter-display-state'] }); });
  }, [user?.id, qc]);

  const serverNow = useServerClock(q.data?.now, q.dataUpdatedAt || Date.now());
  const snapshot = q.data?.screen ?? null;
  const resolved = resolveScreen(snapshot, serverNow);
  const { locale, setChosen, canChoose } = useScreenLocale(snapshot?.payload.locale, resolved.mode);

  if (q.isError && isMissingFunction(q.error)) return <CustomerDisplay />;
  if (!activeCompanyId) return <CustomerDisplay />;
  if (!q.data) return <Spinner />;
  const unsupported = async () => { throw new Error('session'); };
  return (
    <>
      <CustomerScreenView
        snapshot={snapshot} resolved={resolved} locale={locale}
        companyName={snapshot?.company_name || activeCompany?.name || ''}
        chooseLocale={canChoose} onLocale={setChosen}
        onEmail={unsupported} onSignature={unsupported}
      />
      <Corner locale={locale} offline={q.isError} />
    </>
  );
}
