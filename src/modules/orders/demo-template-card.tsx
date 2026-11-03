/**
 * Parametres → « Deposer le classeur Ducati de l'annee » (mission 09, carte 6).
 * Le classeur vierge « Fichier de commande Demo Crtsy Shwrm <annee>_FR VIERGE.xlsx » contient
 * les prix concession : il n'est pas dans le depot, il est depose une fois par an dans la GED
 * privee de la societe (bucket ged, entite excel_template) par un administrateur, puis rempli
 * a chaque commande demo / courtoisie (demo-workbook.ts).
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import { getDemoTemplate, uploadDemoTemplate } from './demo-api';

export function DemoTemplateCard() {
  const { activeCompanyId, isAdmin } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const companyId = activeCompanyId ?? '';
  const admin = isAdmin(companyId);
  const q = useQuery({ queryKey: ['demo-template', companyId], queryFn: () => getDemoTemplate(companyId), enabled: !!companyId });
  const up = useMutation({
    mutationFn: (f: File) => uploadDemoTemplate(companyId, f, fillVars(t('demoOrder.settingsNote'), { year: String(new Date().getFullYear()) })),
    onSuccess: () => {
      toast.success(t('demoOrder.settingsUploaded'));
      setFile(null);
      if (input.current) input.current.value = '';
      qc.invalidateQueries({ queryKey: ['demo-template', companyId] });
    },
    onError: (e) => toast.error(e instanceof Error && e.message === 'xlsx_only' ? t('demoOrder.settingsXlsxOnly') : (e as Error).message),
  });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('fr-BE');

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <FileSpreadsheet className="size-6 text-primary" />
      <span className="font-ui text-[15px] font-bold">{t('demoOrder.settingsCard')}</span>
      <span className="text-sm text-muted-foreground">{t('demoOrder.settingsCardDesc')}</span>
      <p className="text-[13px]">
        {q.isLoading ? <Loader2 className="inline size-4 animate-spin" /> : q.data
          ? fillVars(t('demoOrder.settingsCurrent'), { file: q.data.file_name, date: fmtDate(q.data.created_at) })
          : <span className="text-warning">{t('demoOrder.settingsNone')}</span>}
      </p>
      {admin ? (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12px]" aria-label={t('demoOrder.settingsUpload')} />
          <Button size="sm" onClick={() => file && up.mutate(file)} disabled={!file || up.isPending}>
            {up.isPending ? <Loader2 className="animate-spin" /> : <Upload />} {t('demoOrder.settingsUpload')}
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">{t('demoOrder.settingsAdminOnly')}</p>
      )}
    </div>
  );
}
