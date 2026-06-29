import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Download, Chrome, MousePointerClick, ListChecks } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/extension')({
  head: () => ({ meta: [{ title: 'Extension My Ducati — Ducati Bruxelles' }] }),
  component: ExtensionPage,
});

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">{n}</span>
      <span className="text-sm leading-relaxed">{children}</span>
    </li>
  );
}

function ExtensionPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t('settings.extTitle')}
        description={t('settings.extDesc')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> {t('settings.title')}</Button>}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Téléchargement */}
        <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <Download className="size-6 text-primary" />
          <h2 className="mt-2 font-ui text-[15px] font-bold">{t('settings.extDownload')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('settings.extDownloadHint')}</p>
          <a href="/myducati-extension.zip" download>
            <Button className="mt-3"><Download className="size-4" /> {t('settings.extDownloadBtn')}</Button>
          </a>
        </div>

        {/* Installation */}
        <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] lg:col-span-2">
          <div className="flex items-center gap-2"><Chrome className="size-5 text-primary" /><h2 className="font-ui text-[15px] font-bold">{t('settings.extInstall')}</h2></div>
          <ol className="mt-3 space-y-2.5">
            <Step n={1}>{t('settings.extStep1')}</Step>
            <Step n={2}>{t('settings.extStep2')} <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">chrome://extensions</code></Step>
            <Step n={3}>{t('settings.extStep3')}</Step>
            <Step n={4}>{t('settings.extStep4')}</Step>
            <Step n={5}>{t('settings.extStep5')}</Step>
          </ol>
        </div>

        {/* Utilisation */}
        <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)] lg:col-span-3">
          <div className="flex items-center gap-2"><MousePointerClick className="size-5 text-primary" /><h2 className="font-ui text-[15px] font-bold">{t('settings.extUse')}</h2></div>
          <ol className="mt-3 space-y-2.5">
            <Step n={1}>{t('settings.extUse1')}</Step>
            <Step n={2}>{t('settings.extUse2')}</Step>
            <Step n={3}>{t('settings.extUse3')}</Step>
            <Step n={4}>{t('settings.extUse4')}</Step>
          </ol>
          <div className="mt-4 flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">
            <ListChecks className="mt-0.5 size-4 shrink-0" />
            <span>{t('settings.extNote')}</span>
          </div>
        </div>
      </div>
    </>
  );
}
