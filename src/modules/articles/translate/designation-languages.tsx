/**
 * M2 — Fiche article : le libelle en quatre langues et l'original fournisseur (I18N002).
 * La designation du formulaire reste la version FR ; cette carte montre ce que le
 * client verra dans sa langue et permet de relancer la traduction d'un article
 * reste sans traduction (fonction indisponible au moment de la creation).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Languages, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import type { Article } from '../api';
import { retranslateArticle } from './api';
import { LANGS, type Lang } from './engine';

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

type ArticleLangs = Pick<Article, 'id' | 'designation'> & {
  designation_source?: string | null;
  designation_source_lang?: string | null;
  designation_i18n?: unknown;
  designation_translated_at?: string | null;
};

export function DesignationLanguages({ companyId, article }: { companyId: string; article: ArticleLangs }) {
  const qc = useQueryClient();
  const i18n = (article.designation_i18n && typeof article.designation_i18n === 'object' ? article.designation_i18n : {}) as Partial<Record<Lang, string>>;
  const translated = !!article.designation_translated_at;
  const retry = useMutation({
    mutationFn: () => retranslateArticle(companyId, article),
    onSuccess: (r) => {
      if (r) toast.success(t('articles.langsRetranslated'));
      else toast.warning(t('articles.langsRetranslateFailed'));
      qc.invalidateQueries({ queryKey: ['article', article.id] });
      qc.invalidateQueries({ queryKey: ['articles'] });
    },
    onError: () => toast.error(t('articles.langsRetranslateFailed')),
  });
  const langLabel = (l: string | null | undefined) => t(`articles.lang_${l ?? '?'}`);

  return (
    <section className="mb-4 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="inline-flex items-center gap-2 font-ui text-[15px] font-bold"><Languages className="size-4" /> {t('articles.langsTitle')}</h2>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
          {retry.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('articles.langsRetranslate')}
        </Button>
      </div>
      {!translated && <p className="mb-2 text-[13px] text-warning">{t('articles.langsPending')}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">
          {t('articles.langsOriginal')}
          {article.designation_source_lang ? ` (${fill(t('articles.langsOriginalLang'), { lang: langLabel(article.designation_source_lang) })})` : ''}
        </dt>
        <dd className="font-data">{article.designation_source ?? article.designation}</dd>
        {LANGS.map((l) => (
          <LangRow key={l} label={t(`articles.lang_${l}`)} value={i18n[l] ?? (l === 'fr' ? article.designation : null)} />
        ))}
      </dl>
    </section>
  );
}

function LangRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={value ? 'font-data' : 'text-muted-foreground'}>{value || '—'}</dd>
    </>
  );
}
