/**
 * M8 — Q60 (20/11/2026) : tablette partagee. Monte une fois pour tout l'atelier (route
 * `_app.workshop`) :
 *  - lit le mode du compte (workshop_tablet_mode) et du poste (case « Cette tablette est
 *    partagee ») et le donne au store ;
 *  - affiche la fenetre « Qui etes-vous ? » quand un geste la demande : gros boutons avec les
 *    noms des compagnons, puis le code (clavier a 4 chiffres) ;
 *  - en mode partage, une barre fine en haut dit qui est identifie et pour combien de temps,
 *    avec « Changer » et « Ce n'est pas moi ».
 * Ergonomie tablette : cibles de 56 a 72 px, texte 16 a 24 px. Charte : tokens, statut = couleur +
 * icone + libelle, rouge Ducati pour le seul bouton principal.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Delete, KeyRound, Loader2, LogOut, Tablet, User, UserCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { useAuth } from '@/lib/auth/auth-context';
import { fillVars, t } from '@/lib/i18n';
import { endSharedSession, getTabletMode, identify, listSharedMechanics } from './api';
import { identifyOutcome, identitySecondsLeft, isFullPin, keypadPress, PIN_LENGTH, sortSharedMechanics, type SharedMechanic } from './rules';
import {
  cancelIdentityPrompt, configureSharedTablet, getSharedTabletState, resolveIdentityPrompt, setIdentity, sharedModeActive,
  subscribeSharedTablet, type SharedTabletState,
} from './store';

export function useSharedTablet(): SharedTabletState & { shared: boolean } {
  const s = useSyncExternalStore(subscribeSharedTablet, getSharedTabletState, getSharedTabletState);
  return { ...s, shared: s.accountMode === 'shared' || s.posteShared };
}

export function SharedTabletProvider({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useAuth();
  const mode = useQuery({
    queryKey: ['tablet-mode', activeCompanyId], queryFn: () => getTabletMode(activeCompanyId!),
    enabled: !!activeCompanyId, staleTime: 60_000,
  });
  useEffect(() => {
    configureSharedTablet({
      companyId: activeCompanyId, accountMode: mode.data?.mode ?? 'personal',
      ttlSeconds: mode.data?.ttlSeconds ?? 120, ready: !!mode.data?.ready,
    });
  }, [activeCompanyId, mode.data?.mode, mode.data?.ttlSeconds, mode.data?.ready]);
  const s = useSharedTablet();
  return (
    <>
      {s.shared && activeCompanyId && <SharedIdentityBar />}
      {children}
      {s.prompting && activeCompanyId && <WhoAreYouDialog companyId={activeCompanyId} />}
    </>
  );
}

/** Secondes restantes de l'identite, rafraichies chaque seconde. */
function useSecondsLeft(): number {
  const s = useSharedTablet();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s.identity) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [s.identity]);
  return identitySecondsLeft(s.identity);
}
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Barre « Tablette partagee · Identifie : John (1:45) » + Changer / Ce n'est pas moi. */
export function SharedIdentityBar({ large = false }: { large?: boolean }) {
  const s = useSharedTablet();
  const left = useSecondsLeft();
  if (!s.shared) return null;
  const id = left > 0 ? s.identity : null;
  const leave = () => {
    const cur = s.identity;
    setIdentity(null);
    if (cur) void endSharedSession(cur.session);
  };
  return (
    <div className={`mb-3 flex flex-wrap items-center gap-3 rounded-md border border-info bg-info-bg px-3 py-2 ${large ? 'text-[17px]' : 'text-[15px]'}`} role="status">
      <StatusBadge tone="info" icon={Tablet} label={t('sharedTablet.badge')} className="px-2.5 py-1 text-[13px]" />
      {id ? (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <UserCheck className="size-5 shrink-0 text-info" aria-hidden />
          <span className="truncate font-bold">{fillVars(t('sharedTablet.identified'), { name: id.name })}</span>
          <span className="font-data tabular-nums text-muted-foreground">{fillVars(t('sharedTablet.forTime'), { time: mmss(left) })}</span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
          <User className="size-5 shrink-0" aria-hidden /> {t('sharedTablet.nobody')}
        </span>
      )}
      {id ? (
        <>
          <Button type="button" variant="outline" className="h-12 text-[15px]" onClick={leave}><Users className="size-5" /> {t('sharedTablet.change')}</Button>
          <Button type="button" variant="ghost" className="h-12 text-[15px]" onClick={leave}><LogOut className="size-5" /> {t('sharedTablet.notMe')}</Button>
        </>
      ) : null}
    </div>
  );
}

function WhoAreYouDialog({ companyId }: { companyId: string }) {
  const list = useQuery({ queryKey: ['shared-mechanics', companyId], queryFn: () => listSharedMechanics(companyId), staleTime: 60_000 });
  const mechanics = useMemo(() => sortSharedMechanics(list.data ?? []), [list.data]);
  const [picked, setPicked] = useState<SharedMechanic | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (code: string) => {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      const out = identifyOutcome(await identify(companyId, picked.id, code));
      if (out.ok) { resolveIdentityPrompt(out.identity); return; }
      setPin('');
      setError(out.messageKey === 'sharedTablet.wrongCode'
        ? fillVars(t('sharedTablet.wrongCode'), { n: out.attemptsLeft ?? 0 })
        : fillVars(t(out.messageKey), { name: picked.name }));
    } catch (e) {
      setPin('');
      setError(e instanceof Error ? e.message : t('sharedTablet.error'));
    } finally {
      setBusy(false);
    }
  };
  const press = (k: string) => {
    const next = keypadPress(pin, k);
    setPin(next);
    if (isFullPin(next) && picked?.has_pin) void submit(next);
  };
  const usesPointeuseCode = !!picked && !picked.has_pin && picked.has_pointeuse_code;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) cancelIdentityPrompt(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[24px]"><Users className="size-7" aria-hidden /> {t('sharedTablet.whoTitle')}</DialogTitle>
          <DialogDescription className="text-[16px]">{picked ? fillVars(t('sharedTablet.codeFor'), { name: picked.name }) : t('sharedTablet.whoHint')}</DialogDescription>
        </DialogHeader>

        {!picked && (
          list.isLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>
          : mechanics.length === 0 ? <p className="rounded-md border border-warning bg-warning-bg p-4 text-[16px]">{t('sharedTablet.noMechanics')}</p>
          : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {mechanics.map((m) => {
                const can = m.has_pin || m.has_pointeuse_code;
                return (
                  <Button key={m.id} type="button" variant="outline" disabled={!can}
                    className="h-20 flex-col gap-1 whitespace-normal text-[20px] font-bold"
                    onClick={() => { setPicked(m); setPin(''); setError(null); }}>
                    <span className="flex items-center gap-2"><User className="size-6" aria-hidden /> {m.name}</span>
                    {!can && <span className="text-[13px] font-normal text-muted-foreground">{t('sharedTablet.noCodeShort')}</span>}
                  </Button>
                );
              })}
            </div>
          )
        )}

        {picked && (
          <div className="space-y-4">
            {usesPointeuseCode ? (
              <form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); void submit(pin); }}>
                <Input autoFocus value={pin} onChange={(e) => setPin(e.target.value.toUpperCase())} className="h-16 text-[24px] font-data tracking-[0.2em]"
                  aria-label={t('sharedTablet.pointeuseCode')} placeholder={t('sharedTablet.pointeuseCode')} />
                <Button type="submit" className="h-16 px-6 text-[18px]" disabled={busy || !pin.trim()}>
                  {busy ? <Loader2 className="size-6 animate-spin" /> : <KeyRound className="size-6" />} {t('sharedTablet.ok')}
                </Button>
              </form>
            ) : (
              <>
                <div className="flex justify-center gap-4" aria-label={t('sharedTablet.codeDots')}>
                  {Array.from({ length: PIN_LENGTH }, (_, i) => (
                    <span key={i} className={`size-6 rounded-full border-2 ${i < pin.length ? 'border-foreground bg-foreground' : 'border-border'}`} />
                  ))}
                </div>
                <div className="mx-auto grid max-w-sm grid-cols-3 gap-3">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((k) => (
                    <Button key={k} type="button" variant="outline" disabled={busy} className="h-[72px] text-[28px] font-bold font-data"
                      aria-label={k === 'back' ? t('sharedTablet.back') : k === 'clear' ? t('sharedTablet.clear') : k}
                      onClick={() => press(k)}>
                      {k === 'back' ? <Delete className="size-7" /> : k === 'clear' ? <span className="text-[16px]">{t('sharedTablet.clear')}</span> : k}
                    </Button>
                  ))}
                </div>
              </>
            )}
            {busy && !usesPointeuseCode && <p className="flex items-center justify-center gap-2 text-[16px] text-muted-foreground"><Loader2 className="size-5 animate-spin" /> {t('sharedTablet.checking')}</p>}
            {error && <p className="rounded-md border border-danger bg-danger-bg p-3 text-[16px] text-danger" role="alert">{error}</p>}
            <div className="flex flex-wrap justify-between gap-3">
              <Button type="button" variant="ghost" className="h-14 text-[16px]" onClick={() => { setPicked(null); setPin(''); setError(null); }}>
                <Users className="size-5" /> {t('sharedTablet.otherName')}
              </Button>
              <Button type="button" variant="ghost" className="h-14 text-[16px]" onClick={() => cancelIdentityPrompt()}>{t('sharedTablet.cancel')}</Button>
            </div>
          </div>
        )}
        {!picked && (
          <div className="flex justify-end">
            <Button type="button" variant="ghost" className="h-14 text-[16px]" onClick={() => cancelIdentityPrompt()}>{t('sharedTablet.cancel')}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mode partage actif ? (hors React : pointage/api.ts) — reexport pratique pour les ecrans. */
export { sharedModeActive };
