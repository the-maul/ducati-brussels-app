/**
 * Mission 01, lot 4 — Borne du comptoir (décisions K-1 à K-4, précisions du 18/09).
 *
 * Une page qui revient TOUJOURS à l'accueil :
 *   - aucun lien sortant (les informations s'ouvrent en surimpression) ;
 *   - le bouton « retour » du navigateur ne quitte pas la borne : il remet le
 *     formulaire à zéro ;
 *   - formulaire vide 15 s après le message de bienvenue, et après 90 s sans
 *     toucher l'écran (y compris au milieu d'une saisie) ;
 *   - rechargement complet discret une fois par nuit (nouvelles versions), et
 *     seulement quand personne n'utilise la borne ;
 *   - bandeau clair si la connexion internet tombe ; le formulaire réessaie seul ;
 *   - rien du client précédent ne reste : le formulaire est détruit puis recréé
 *     (état React) à chaque retour à l'accueil — mot de passe compris —, aucune
 *     donnée dans l'adresse ni dans l'historique, pas d'auto-complétion
 *     (autocomplete="off", et "new-password" sur les deux champs mot de passe :
 *     le navigateur ne propose ni n'enregistre de mot de passe).
 * Mot de passe choisi à la borne comme en ligne : décision K-5 du 18/09.
 * Lancement depuis Paramètres → Borne d'inscription : décision K-6.
 *
 * Écran d'accueil à 3 tuiles (retour client du 21/09) : « Configurer ma Ducati »
 * (configurateur officiel), « Créer mon compte » (le formulaire) et « Nos occasions »
 * (site Ducati Bruxelles). Adresses réglables (src/modules/signup/kiosk-links.ts).
 * Les deux sites refusent tout cadre (X-Frame-Options: DENY) : ils s'ouvrent dans le
 * même onglet, et le retour à /borne est assuré par l'application kiosque de la
 * tablette (liste blanche, bouton accueil, retour après inactivité : guide
 * borne-kiosque.md). Toute remise à zéro ramène à cet écran d'accueil.
 * Verrouillage de la tablette : docs/bible/guides/borne-kiosque.md.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bike, ExternalLink, Home, Maximize, RotateCcw, SlidersHorizontal, UserPlus, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { SignupForm, SignupWelcome, type SignupSuccess } from './signup-form';
import { kioskHasHome, kioskUrlHost, type KioskLinks } from './kiosk-links';

const WELCOME_MS = 15_000;
const IDLE_MS = 90_000;
/** Heure du rechargement nocturne (heure locale de la tablette). */
const NIGHTLY_RELOAD_HOUR = 3;
/** Filet de sécurité : jamais plus de 26 h sans rechargement. */
const MAX_UPTIME_MS = 26 * 60 * 60 * 1000;

export function KioskSignup({ links }: { links: KioskLinks }) {
  const hasHome = kioskHasHome(links);
  const homeScreen = hasHome ? 'home' : 'form';
  const [screen, setScreen] = useState<'home' | 'form'>(homeScreen);
  const [round, setRound] = useState(0); // change → le formulaire est recréé vide
  const [result, setResult] = useState<SignupSuccess | null>(null);
  const [countdown, setCountdown] = useState(WELCOME_MS / 1000);
  const [online, setOnline] = useState(true);
  const lastActivity = useRef(Date.now());
  const loadedAt = useRef(Date.now());
  const pristine = useRef(true); // aucune saisie depuis la dernière remise à zéro

  const reset = useCallback(() => {
    setScreen(homeScreen);
    setResult(null);
    setRound((r) => r + 1);
    setCountdown(WELCOME_MS / 1000);
    pristine.current = true;
    lastActivity.current = Date.now();
    if (typeof document !== 'undefined') {
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.scrollTo({ top: 0 });
    }
  }, [homeScreen]);

  // Activité à l'écran : repousse la remise à zéro.
  useEffect(() => {
    const touch = () => {
      lastActivity.current = Date.now();
      pristine.current = false;
    };
    const events = ['pointerdown', 'keydown', 'input', 'touchstart', 'wheel'] as const;
    events.forEach((e) => document.addEventListener(e, touch, { passive: true, capture: true }));
    return () => events.forEach((e) => document.removeEventListener(e, touch, { capture: true }));
  }, []);

  // Inactivité (90 s) et rechargement nocturne : une horloge toutes les secondes.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastActivity.current;
      if (!pristine.current && idleFor >= IDLE_MS) reset();

      // Rechargement discret : la nuit, ou après 26 h, seulement si personne n'est là.
      const uptime = now - loadedAt.current;
      const hour = new Date(now).getHours();
      const quiet = idleFor >= 5 * 60 * 1000 && pristine.current;
      if (quiet && navigator.onLine && ((hour === NIGHTLY_RELOAD_HOUR && uptime > 60 * 60 * 1000) || uptime > MAX_UPTIME_MS)) {
        window.location.replace(window.location.pathname);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [reset]);

  // Message de bienvenue : retour au formulaire vide après 15 s.
  useEffect(() => {
    if (!result) return;
    const started = Date.now();
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((WELCOME_MS - (Date.now() - started)) / 1000));
      setCountdown(left);
      if (left === 0) reset();
    }, 250);
    return () => clearInterval(id);
  }, [result, reset]);

  // Bouton « retour » du navigateur : on reste sur la borne, formulaire vidé.
  useEffect(() => {
    const here = window.location.pathname;
    window.history.replaceState(null, '', here);
    window.history.pushState(null, '', here);
    const onPop = () => {
      window.history.pushState(null, '', here);
      reset();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [reset]);

  // Retour depuis un site externe par le bouton « retour » : le navigateur peut
  // restaurer la page telle quelle (cache) ; on repart de l'accueil, vide.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) reset(); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [reset]);

  /** Tuile externe : même onglet (les sites refusent les cadres), borne remise à zéro avant. */
  const openExternal = (url: string) => {
    reset();
    window.location.assign(url);
  };

  // Connexion internet.
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    setCanFullscreen(!!document.documentElement.requestFullscreen);
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const goFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => { /* refusé : Accès guidé s'en charge */ });
  };

  return (
    <main
      className="min-h-screen select-none bg-background"
      onContextMenu={(e) => e.preventDefault()}
    >
      {!online && (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-warning-bg px-4 py-3 text-[15px] text-warning" role="alert">
          <WifiOff className="size-5 shrink-0" aria-hidden />
          <span>{t('signup.kiosk.offline')}</span>
        </div>
      )}

      <div className={`mx-auto w-full ${screen === 'home' ? 'max-w-5xl' : 'max-w-3xl'} px-4 py-6 sm:px-8 sm:py-8`}>
        <header className="mb-6 flex items-center gap-3 sm:mb-8">
          <span className="grid size-12 shrink-0 place-items-center rounded-md bg-primary font-display text-xl font-bold text-primary-foreground">D</span>
          <span className="min-w-0 font-display text-[20px] font-bold uppercase leading-7 text-foreground sm:text-[22px]">{t('signup.brand')}</span>
          <div className="ml-auto flex items-center gap-2">
            {canFullscreen && !isFullscreen && (
              <Button type="button" variant="ghost" className="h-11" onClick={goFullscreen}>
                <Maximize className="size-4" aria-hidden />
                {t('signup.kiosk.fullscreen')}
              </Button>
            )}
            {hasHome && screen === 'form' && !result && (
              <Button type="button" variant="outline" className="h-12 px-4 text-[15px]" onClick={reset}>
                <Home className="size-5" aria-hidden />
                {t('signup.kiosk.home')}
              </Button>
            )}
          </div>
        </header>

        {screen === 'home' ? (
          <KioskHome
            links={links}
            online={online}
            onSignup={() => { setScreen('form'); window.scrollTo({ top: 0 }); }}
            onExternal={openExternal}
          />
        ) : (
        <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-8">
          {result ? (
            <SignupWelcome
              result={result}
              mode="kiosk"
              footer={
                <div className="space-y-3 pt-4">
                  <Button type="button" size="lg" className="h-14 w-full text-[16px]" onClick={reset}>
                    <RotateCcw className="size-5" aria-hidden />
                    {t('signup.kiosk.next')}
                  </Button>
                  <p className="text-[13px] text-muted-foreground tabular-nums">
                    {t('signup.kiosk.resetIn').replace('{n}', String(countdown))}
                  </p>
                </div>
              }
            />
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-primary">{t('signup.stepLabel')}</p>
                <h1 className="font-display text-[28px] font-bold uppercase leading-[34px]">{t('signup.stepTitle')}</h1>
                <p className="text-[16px] text-muted-foreground">{t('signup.kioskIntro')}</p>
              </div>
              <SignupForm
                key={round}
                mode="kiosk"
                onSuccess={(r) => {
                  setResult(r);
                  lastActivity.current = Date.now();
                }}
              />
            </div>
          )}
        </div>
        )}
      </div>
    </main>
  );
}

/** Écran d'accueil : 3 grandes tuiles tactiles. */
function KioskHome({ links, online, onSignup, onExternal }: {
  links: KioskLinks;
  online: boolean;
  onSignup: () => void;
  onExternal: (url: string) => void;
}) {
  const tiles: { key: string; icon: typeof Bike; title: string; text: string; primary?: boolean; url?: string }[] = [];
  if (links.configurator) {
    tiles.push({ key: 'configurator', icon: SlidersHorizontal, title: t('signup.kiosk.tileConfigurator'), text: t('signup.kiosk.tileConfiguratorText'), url: links.configurator });
  }
  tiles.push({ key: 'signup', icon: UserPlus, title: t('signup.kiosk.tileSignup'), text: t('signup.kiosk.tileSignupText'), primary: true });
  if (links.used) {
    tiles.push({ key: 'used', icon: Bike, title: t('signup.kiosk.tileUsed'), text: t('signup.kiosk.tileUsedText'), url: links.used });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-[28px] font-bold uppercase leading-[34px] sm:text-[32px] sm:leading-[38px]">{t('signup.kiosk.homeTitle')}</h1>
        <p className="text-[17px] text-muted-foreground">{t('signup.kiosk.homeIntro')}</p>
      </div>
      <div className={`grid gap-4 ${tiles.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {tiles.map((tile) => {
          const Icon = tile.icon;
          const disabled = !!tile.url && !online;
          return (
            <button
              key={tile.key}
              type="button"
              disabled={disabled}
              onClick={() => (tile.url ? onExternal(tile.url) : onSignup())}
              className={`flex min-h-44 w-full flex-col items-start gap-3 rounded-md border p-6 text-left shadow-[var(--shadow-card)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:min-h-64 ${
                tile.primary
                  ? 'border-primary bg-primary text-primary-foreground active:bg-primary/90'
                  : 'border-border bg-card text-foreground active:bg-muted'
              }`}
            >
              <span className={`grid size-14 place-items-center rounded-md ${tile.primary ? 'bg-primary-foreground/15' : 'bg-muted text-primary'}`}>
                <Icon className="size-8" aria-hidden />
              </span>
              <span className="font-display text-[22px] font-bold uppercase leading-7">{tile.title}</span>
              <span className={`text-[15px] leading-snug ${tile.primary ? 'text-primary-foreground/90' : 'text-muted-foreground'}`}>{tile.text}</span>
              {tile.url && (
                <span className="mt-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <ExternalLink className="size-4" aria-hidden />
                  {disabled ? t('signup.kiosk.tileOffline') : kioskUrlHost(tile.url)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[14px] text-muted-foreground">{t('signup.kiosk.homeReturnHint')}</p>
    </div>
  );
}
