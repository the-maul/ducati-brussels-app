/**
 * Paramètres → Application client (décision W-5, 19/09 ; réservé aux administrateurs
 * par la garde de _app.settings.tsx, et en base par la RLS).
 *
 *   - interrupteur « Application client : bientôt disponible / ouverte »
 *     (`signup_settings.client_app_open`, tracé dans `events`) ;
 *   - l'adresse exacte à mettre sur le site Shopify (`<adresse de l'app>/app-client`),
 *     copiable en un clic ; elle ne change pas quand l'application ouvre ;
 *   - la liste des personnes « Prévenez-moi à l'ouverture », exportable en CSV.
 * Logique : src/modules/settings/app-client-api.ts. Guide : docs/bible/guides/lien-site-shopify.md.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, BellRing, Check, Clock, Copy, Download, ExternalLink, Link2, Smartphone, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/lib/auth/auth-context';
import { clientAppUrl } from '@/lib/client-app-url';
import { useSaveMutation } from '@/lib/use-save-mutation';
import {
  downloadWaitlistCsv, getAppClientSettings, listWaitlist, setAppClientOpen,
} from '@/modules/settings/app-client-api';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/app-client')({
  head: () => ({ meta: [{ title: t('appClient.settings.pageTitle') }] }),
  component: AppClientSettingsPage,
});

function Card({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`space-y-3 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] ${className ?? ''}`}>
      <h2 className="flex items-center gap-2 font-ui text-[15px] font-bold">{icon}{title}</h2>
      {children}
    </section>
  );
}

const dateFmt = new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' });

function AppClientSettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  // L'adresse dépend de window (repli sur l'adresse du site) : calculée côté navigateur.
  useEffect(() => { setUrl(`${clientAppUrl()}/app-client`); }, []);

  const settings = useQuery({ queryKey: ['app-client', 'settings'], queryFn: getAppClientSettings });
  const waitlist = useQuery({ queryKey: ['app-client', 'waitlist'], queryFn: listWaitlist });

  const toggle = useSaveMutation({
    mutationFn: (open: boolean) => setAppClientOpen(open, user?.id ?? null),
    success: t('appClient.settings.saved'),
    error: t('appClient.settings.notAllowed'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-client', 'settings'] }),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2500);
  };

  const open = settings.data?.open ?? false;
  const rows = waitlist.data ?? [];

  return (
    <>
      <PageHeader
        title={t('appClient.settings.title')}
        description={t('appClient.settings.subtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> {t('settings.title')}</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={<Smartphone className="size-5 text-primary" />} title={t('appClient.settings.stateTitle')}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              {/* Statut = couleur + icône + libellé. */}
              {open ? (
                <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] bg-success-bg px-2 py-1 text-[12px] font-bold uppercase tracking-[0.04em] text-success">
                  <Check className="size-3.5" /> {t('appClient.settings.stateOpen')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] bg-warning-bg px-2 py-1 text-[12px] font-bold uppercase tracking-[0.04em] text-warning">
                  <Clock className="size-3.5" /> {t('appClient.settings.stateSoon')}
                </span>
              )}
              <p className="text-[13px] text-muted-foreground">
                {open ? t('appClient.settings.stateOpenText') : t('appClient.settings.stateSoonText')}
              </p>
            </div>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <span className="text-sm font-medium">{t('appClient.settings.switchLabel')}</span>
            <Switch
              checked={open}
              disabled={settings.isLoading || !settings.data || toggle.status === 'saving'}
              onCheckedChange={(v) => toggle.mutate(v)}
            />
          </label>
          {settings.data && !settings.data.signupOpen && (
            <p className="flex items-start gap-2 text-[12px] text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {t('appClient.settings.signupClosedWarning')}
            </p>
          )}
          <Button asChild variant="outline" className="h-11">
            <a href="/app-client" target="_blank" rel="noreferrer"><ExternalLink /> {t('appClient.settings.preview')}</a>
          </Button>
        </Card>

        <Card icon={<Link2 className="size-5 text-primary" />} title={t('appClient.settings.addressTitle')}>
          <p className="text-[13px] text-muted-foreground">{t('appClient.settings.addressHint')}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-[13px]">{url}</code>
            <Button variant="outline" className="h-11" onClick={() => void copy()} disabled={!url}>
              {copied === 'ok' ? <Check /> : <Copy />} {copied === 'ok' ? t('appClient.settings.copied') : t('appClient.settings.copy')}
            </Button>
          </div>
          {copied === 'fail' && <p className="text-[12px] text-danger">{t('appClient.settings.copyFailed')}</p>}
          <p className="text-[12px] text-muted-foreground">{t('appClient.settings.addressGuide')}</p>
        </Card>

        <Card icon={<BellRing className="size-5 text-primary" />} title={t('appClient.settings.listTitle')} className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground tabular-nums">
              {t('appClient.settings.listCount').replace('{n}', String(rows.length))}
            </p>
            <Button
              variant="outline" className="h-11" disabled={rows.length === 0}
              onClick={() => downloadWaitlistCsv(rows, t('appClient.settings.csvHeader').split(';'))}
            >
              <Download /> {t('appClient.settings.export')}
            </Button>
          </div>
          {waitlist.isError ? (
            <p className="text-[13px] text-danger">{t('appClient.settings.listError')}</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{waitlist.isLoading ? '…' : t('appClient.settings.listEmpty')}</p>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('appClient.settings.colEmail')}</TableHead>
                    <TableHead>{t('appClient.settings.colDate')}</TableHead>
                    <TableHead>{t('appClient.settings.colNotified')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="break-all font-data text-[13px]">{r.email}</TableCell>
                      <TableCell className="whitespace-nowrap font-data text-[13px] tabular-nums">{dateFmt.format(new Date(r.created_at))}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.notified_at ? (
                          <span className="inline-flex items-center gap-1 text-[12px] text-success"><Check className="size-3.5" /> {t('appClient.settings.notifiedYes')}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[12px] text-neutral-tag"><Clock className="size-3.5" /> {t('appClient.settings.notifiedNo')}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
