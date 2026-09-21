/**
 * Paramètres → Borne d'inscription (décision K-6 du 18/09, réservé aux administrateurs
 * par la garde de _app.settings.tsx).
 *
 * Retour de Simon : « comment on va se souvenir qu'il existe le mode borne ? On devrait
 * l'avoir quelque part dans les paramètres pour le lancer. » Cette page réunit :
 *   - une explication courte ;
 *   - « Lancer le mode borne sur cet appareil » : plein écran puis /borne dans le même
 *     onglet (navigation interne : le plein écran est conservé), avec déconnexion
 *     préalable recommandée sur la tablette du comptoir ;
 *   - l'adresse de la borne à copier et son QR code (générateur maison src/lib/qr.ts :
 *     aucune librairie QR dans le projet) ;
 *   - le guide de verrouillage de la tablette (docs/bible/guides/borne-kiosque.md),
 *     affiché dans l'application en surimpression.
 *   - les adresses des tuiles « Configurer ma Ducati » et « Nos occasions » de l'écran
 *     d'accueil de la borne (retour client du 21/09 ; src/modules/settings/kiosk-api.ts,
 *     défauts et validation dans src/modules/signup/kiosk-links.ts).
 * L'adresse suit VITE_CLIENT_APP_URL (src/lib/client-app-url.ts), comme le message de
 * bienvenue : app.ducatibruxelles.be à terme, l'adresse Netlify en attendant (K-4).
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Check, Copy, ExternalLink, LayoutGrid, Lock, QrCode, RotateCcw, TabletSmartphone, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SaveButton } from '@/components/ui/save-button';
import { useSaveMutation } from '@/lib/use-save-mutation';
import { getKioskLinkSettings, setKioskLinks } from '@/modules/settings/kiosk-api';
import {
  DEFAULT_CONFIGURATOR_URL, DEFAULT_USED_URL, checkKioskUrl, kioskUrlHost, type KioskUrlCheck,
} from '@/modules/signup/kiosk-links';
import { useAuth } from '@/lib/auth/auth-context';
import { clientAppUrl } from '@/lib/client-app-url';
import { qrMatrix, qrSvgPath } from '@/lib/qr';
import { t } from '@/lib/i18n';
import guideMd from '../../docs/bible/guides/borne-kiosque.md?raw';

export const Route = createFileRoute('/_app/settings/kiosk')({
  head: () => ({ meta: [{ title: t('kiosk.pageTitle') }] }),
  component: KioskSettingsPage,
});

function Card({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`space-y-3 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] ${className ?? ''}`}>
      <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold">{icon}{title}</h2>
      {children}
    </section>
  );
}

function KioskSettingsPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [signOutFirst, setSignOutFirst] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);

  // L'adresse dépend de window (repli sur l'adresse du site) : calculée côté navigateur.
  useEffect(() => { setUrl(`${clientAppUrl()}/borne`); }, []);
  const qr = useMemo(() => (url ? qrSvgPath(qrMatrix(url)) : null), [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2500);
  };

  const launch = async () => {
    // Le plein écran doit être demandé pendant le clic ; la navigation interne le conserve.
    try { await document.documentElement.requestFullscreen?.(); } catch { /* refusé : sans importance */ }
    await navigate({ to: '/borne' });
    if (signOutFirst) await signOut();
  };

  return (
    <>
      <PageHeader
        title={t('kiosk.title')}
        description={t('kiosk.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> {t('settings.title')}</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={<TabletSmartphone className="size-5 text-primary" />} title={t('kiosk.whatTitle')}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
            <li>{t('kiosk.what1')}</li>
            <li>{t('kiosk.what2')}</li>
            <li>{t('kiosk.what3')}</li>
          </ul>
        </Card>

        <Card icon={<TabletSmartphone className="size-5 text-primary" />} title={t('kiosk.launchTitle')}>
          <Button size="lg" className="h-12 w-full text-[15px]" onClick={() => void launch()}>
            <TabletSmartphone className="size-5" /> {t('kiosk.launch')}
          </Button>
          <label className="flex cursor-pointer items-start gap-2 text-[13px]">
            <Checkbox checked={signOutFirst} onCheckedChange={(v) => setSignOutFirst(v === true)} className="mt-0.5" />
            <span>{t('kiosk.signOutFirst')}</span>
          </label>
          <p className="text-[12px] text-muted-foreground">{t('kiosk.launchHint')}</p>
        </Card>

        <Card icon={<Copy className="size-5 text-primary" />} title={t('kiosk.addressTitle')}>
          <p className="text-[13px] text-muted-foreground">{t('kiosk.addressHint')}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-[13px]">{url}</code>
            <Button variant="outline" className="h-11" onClick={() => void copy()} disabled={!url}>
              {copied === 'ok' ? <Check /> : <Copy />} {copied === 'ok' ? t('kiosk.copied') : t('kiosk.copy')}
            </Button>
          </div>
          {copied === 'fail' && <p className="text-[12px] text-danger">{t('kiosk.copyFailed')}</p>}
        </Card>

        <Card icon={<QrCode className="size-5 text-primary" />} title={t('kiosk.qrTitle')}>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {qr && (
              <svg
                viewBox={`0 0 ${qr.size} ${qr.size}`}
                className="size-48 shrink-0 rounded-md border border-border"
                role="img"
                aria-label={url}
                shapeRendering="crispEdges"
              >
                {/* Toujours noir sur blanc, même en thème sombre : sinon illisible par les appareils photo. */}
                <rect width={qr.size} height={qr.size} fill="#ffffff" />
                <path d={qr.d} fill="#000000" />
              </svg>
            )}
            <p className="text-[13px] text-muted-foreground">{t('kiosk.qrHint')}</p>
          </div>
        </Card>

        <KioskLinksCard />

        <Card icon={<Lock className="size-5 text-primary" />} title={t('kiosk.guideTitle')}>
          <p className="text-[13px] text-muted-foreground">{t('kiosk.guideHint')}</p>
          <Button variant="outline" className="h-11" onClick={() => setGuideOpen(true)}>
            <BookOpen /> {t('kiosk.guideOpen')}
          </Button>
        </Card>
      </div>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('kiosk.guideDialogTitle')}</DialogTitle>
          </DialogHeader>
          <GuideMarkdown source={guideMd} url={url} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Valeur en base → champ affiché : null = défaut, '' = case masquée (champ vide). */
const toField = (stored: string | null, fallback: string) => (stored === null ? fallback : stored);
/** Champ → valeur en base : l'adresse par défaut n'est pas figée (null), pour suivre le code. */
const toStored = (value: string, fallback: string) => (value === fallback ? null : value);

function KioskLinksCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const settings = useQuery({ queryKey: ['kiosk', 'links'], queryFn: getKioskLinkSettings });
  const [configurator, setConfigurator] = useState(DEFAULT_CONFIGURATOR_URL);
  const [used, setUsed] = useState(DEFAULT_USED_URL);

  useEffect(() => {
    if (!settings.data) return;
    setConfigurator(toField(settings.data.configurator, DEFAULT_CONFIGURATOR_URL));
    setUsed(toField(settings.data.used, DEFAULT_USED_URL));
  }, [settings.data]);

  const checkC = checkKioskUrl(configurator);
  const checkU = checkKioskUrl(used);
  const available = settings.data?.available ?? false;

  const save = useSaveMutation({
    mutationFn: () => {
      if (!checkC.ok || !checkU.ok) throw new Error(t('kiosk.linkErrors.invalid'));
      return setKioskLinks({
        configurator: toStored(checkC.value, DEFAULT_CONFIGURATOR_URL),
        used: toStored(checkU.value, DEFAULT_USED_URL),
      }, user?.id ?? null);
    },
    success: t('kiosk.linksSaved'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kiosk', 'links'] }),
  });

  const hosts = [checkC, checkU]
    .map((c) => (c.ok && c.value ? kioskUrlHost(c.value) : ''))
    .filter(Boolean);

  return (
    <Card icon={<LayoutGrid className="size-5 text-primary" />} title={t('kiosk.linksTitle')} className="lg:col-span-2">
      <p className="text-[13px] text-muted-foreground">{t('kiosk.linksHint')}</p>
      {settings.data && !available && (
        <p className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning" role="status">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t('kiosk.linksPending')}</span>
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <LinkField
          id="kiosk-configurator"
          label={t('kiosk.linkConfigurator')}
          value={configurator}
          onChange={setConfigurator}
          check={checkC}
          fallback={DEFAULT_CONFIGURATOR_URL}
          disabled={!available}
        />
        <LinkField
          id="kiosk-used"
          label={t('kiosk.linkUsed')}
          value={used}
          onChange={setUsed}
          check={checkU}
          fallback={DEFAULT_USED_URL}
          disabled={!available}
        />
      </div>
      <p className="text-[12px] text-muted-foreground">{t('kiosk.linkEmptyHint')}</p>
      {hosts.length > 0 && (
        <p className="text-[12px] text-muted-foreground">{t('kiosk.linksWhitelist').replace('{hosts}', hosts.join(', '))}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <SaveButton status={save.status} onClick={() => save.mutate()} disabled={!available || !checkC.ok || !checkU.ok}>
          {t('kiosk.linksSave')}
        </SaveButton>
        <Button
          variant="outline"
          disabled={!available}
          onClick={() => { setConfigurator(DEFAULT_CONFIGURATOR_URL); setUsed(DEFAULT_USED_URL); }}
        >
          <RotateCcw /> {t('kiosk.linkRestore')}
        </Button>
      </div>
    </Card>
  );
}

function LinkField({ id, label, value, onChange, check, fallback, disabled }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  check: KioskUrlCheck;
  fallback: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="url"
          inputMode="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={!check.ok}
          className="font-mono text-[13px]"
        />
        <Button variant="outline" asChild={check.ok && !!check.value} disabled={!check.ok || !check.value}>
          {check.ok && check.value ? (
            <a href={check.value} target="_blank" rel="noopener noreferrer"><ExternalLink /> {t('kiosk.linkTest')}</a>
          ) : (
            <span><ExternalLink /> {t('kiosk.linkTest')}</span>
          )}
        </Button>
      </div>
      {!check.ok && <p className="text-[12px] text-danger">{t(`kiosk.linkErrors.${check.code}`)}</p>}
      <p className="break-all text-[12px] text-muted-foreground">{t('kiosk.linkDefault').replace('{url}', fallback)}</p>
    </div>
  );
}

/** Mise en forme légère du guide Markdown (titres, listes, code, gras) — suffisant pour ce guide. */
function GuideMarkdown({ source, url }: { source: string; url: string }) {
  const inline = (s: string, key: string): ReactNode[] => {
    // [texte](lien) → texte seul ; `code` ; **gras**.
    const clean = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    return clean.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => {
      if (part.startsWith('`')) return <code key={`${key}-${i}`} className="rounded bg-muted px-1 font-mono text-[12px]">{part.slice(1, -1)}</code>;
      if (part.startsWith('**')) return <b key={`${key}-${i}`}>{part.slice(2, -2)}</b>;
      return <span key={`${key}-${i}`}>{part}</span>;
    });
  };

  const out: ReactNode[] = [];
  const lines = source.replace(/<adresse de l'application>\/borne/g, url || '<adresse>/borne').split(/\r?\n/);
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) { out.push(<p key={`p${out.length}`} className="text-sm leading-relaxed">{inline(para.join(' '), `p${out.length}`)}</p>); para = []; }
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${out.length}-${i}`)}</li>);
      out.push(list.ordered
        ? <ol key={`o${out.length}`} className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">{items}</ol>
        : <ul key={`u${out.length}`} className="list-disc space-y-1 pl-5 text-sm leading-relaxed">{items}</ul>);
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      out.push(<pre key={`c${out.length}`} className="overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-[12px]">{code.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      if (h[1].length === 1) continue; // le titre du guide est déjà celui de la fenêtre
      out.push(h[1].length === 2
        ? <h3 key={`h${out.length}`} className="pt-2 font-ui text-[15px] font-bold">{inline(h[2], `h${out.length}`)}</h3>
        : <h4 key={`h${out.length}`} className="pt-1 font-ui text-[14px] font-bold">{inline(h[2], `h${out.length}`)}</h4>);
      continue;
    }
    const ul = /^\s*-\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      if (para.length) flush();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (/^\s{2,}\S/.test(line) && list) {
      // Suite d'un élément de liste.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (line.trim() === '' ) { flush(); continue; }
    const q = /^>\s?(.*)$/.exec(line);
    para.push(q ? q[1] : line.trim());
  }
  flush();
  return <div className="space-y-3">{out}</div>;
}
