import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Play, Upload, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { parseContactsCsv, applyContactsImport, type ImportPreview } from '@/modules/migration/contacts-import';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/_app/settings/migration')({
  head: () => ({ meta: [{ title: 'Migration & imports — Ducati Bruxelles' }] }),
  component: MigrationPage,
});

function MigrationPage() {
  const { activeCompanyId, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const apply = useMutation({
    mutationFn: () => applyContactsImport(activeCompanyId!, preview!),
    onSuccess: (n) => { setDone(n); setPreview(null); setText(''); },
  });

  if (!isAdmin()) return <><PageHeader title={t('migration.title')} /><p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{t('settings.notAdmin')}</p></>;

  return (
    <>
      <PageHeader
        title={t('migration.contactsTitle')}
        description={t('migration.contactsSubtitle')}
        actions={<Button variant="outline" onClick={() => navigate({ to: '/settings' })}><ArrowLeft /> {t('settings.title')}</Button>}
      />
      {done !== null && <p className="mb-3 flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-[13px] text-success"><CheckCircle2 className="size-4" /> {t('migration.done').replace('{n}', String(done))}</p>}

      <Textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} rows={8} placeholder={'Nom;Prénom;Email;Ville;Type\nMoreau;Simon;simon@x.be;Bruxelles;particulier'} className="font-mono text-[12px]" />
      <div className="mt-3 flex gap-2">
        <Button variant="outline" onClick={() => setPreview(parseContactsCsv(text))} disabled={!text.trim()}><Play /> {t('migration.analyze')}</Button>
        {preview && preview.toCreate > 0 && <Button onClick={() => apply.mutate()} disabled={apply.isPending}>{apply.isPending ? <Loader2 className="animate-spin" /> : <Upload />} {t('migration.apply')} ({preview.toCreate})</Button>}
      </div>

      {preview && (
        <div className="mt-4">
          <p className="mb-2 text-sm"><b>{preview.toCreate}</b> {t('migration.toCreate')} · <b className={preview.errors ? 'text-danger' : ''}>{preview.errors}</b> {t('migration.errors')}</p>
          <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse font-data text-[13px]">
              <thead className="bg-muted sticky top-0"><tr><Th>{t('migration.colName')}</Th><Th>{t('migration.colEmail')}</Th><Th>{t('migration.colCity')}</Th><Th>{t('migration.colType')}</Th><Th>{t('migration.colStatus')}</Th></tr></thead>
              <tbody>
                {preview.mapped.map((m, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{String(m.payload.last_name ?? m.payload.company_name ?? '—')}</td>
                    <td className="px-3 py-1.5">{String(m.payload.email ?? '—')}</td>
                    <td className="px-3 py-1.5">{String(m.payload.city ?? '—')}</td>
                    <td className="px-3 py-1.5">{String(m.payload.type ?? '—')}</td>
                    <td className="px-3 py-1.5">{m.error ? <span className="text-danger">{m.error}</span> : <span className="text-success">{t('migration.ok')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children }: { children?: React.ReactNode }) { return <th className="px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{children}</th>; }
