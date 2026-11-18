/**
 * Rattrapage G8 (18/11/2026, lot parc) — « Reference a remplacer -> nouvelle reference ·
 * Modifier les forfaits » : remplace une piece dans TOUS les kits d'entretien actifs et tous les
 * forfaits d'article, avec apercu avant d'ecrire (fonction SQL `kits_replace_article`).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2, Replace, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t, fillVars } from '@/lib/i18n';
import { ArticleLinePicker } from '@/modules/sales/article-line-picker';
import type { SaleArticle } from '@/modules/sales/write-api';
import { replaceArticleInKits } from './insert-api';

type ArtPick = Pick<SaleArticle, 'id' | 'reference' | 'designation'>;

export function ReplaceRefDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [oldA, setOldA] = useState<ArtPick | null>(null);
  const [newA, setNewA] = useState<ArtPick | null>(null);
  const [oldText, setOldText] = useState('');
  const [newText, setNewText] = useState('');
  const ready = !!oldA && !!newA && oldA.id !== newA.id;
  const preview = useQuery({
    queryKey: ['kits-replace-preview', oldA?.id, newA?.id],
    queryFn: () => replaceArticleInKits(companyId, oldA!.id, newA!.id, false),
    enabled: ready,
  });
  const apply = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => replaceArticleInKits(companyId, oldA!.id, newA!.id, true),
    onSuccess: (r) => {
      toast.success(fillVars(t('parcG8.replaceDone'), { kits: r.kits_entretien, forfaits: r.forfaits }));
      qc.invalidateQueries({ queryKey: ['kits'] });
      qc.invalidateQueries({ queryKey: ['kit'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const p = preview.data;
  const total = p ? p.kits_entretien + p.forfaits : 0;

  const field = (label: string, value: ArtPick | null, set: (a: ArtPick | null) => void, text: string, setText: (s: string) => void) => (
    <div className="space-y-1">
      <Label className="text-[12px]">{label}</Label>
      {value ? (
        <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
          <span className="font-mono text-[12px]">{value.reference}</span>
          <span className="truncate">{value.designation}</span>
          <button type="button" className="ml-auto text-muted-foreground hover:text-danger" onClick={() => set(null)}><X className="size-4" /></button>
        </div>
      ) : (
        <ArticleLinePicker companyId={companyId} value={text} onText={setText} onPick={(a) => { set(a); setText(''); }} className="h-9" />
      )}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('parcG8.replaceTitle')}</DialogTitle></DialogHeader>
        <p className="text-[13px] text-muted-foreground">{t('parcG8.replaceHint')}</p>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          {field(t('parcG8.replaceOld'), oldA, setOldA, oldText, setOldText)}
          <ArrowRight className="mb-2 hidden size-4 text-muted-foreground sm:block" />
          {field(t('parcG8.replaceNew'), newA, setNewA, newText, setNewText)}
        </div>
        {ready && (preview.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : preview.error ? (
          <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(preview.error as Error).message}</p>
        ) : p && (
          <p className={`rounded-md px-3 py-2 text-[13px] ${total > 0 ? 'bg-info-bg text-info' : 'bg-muted text-muted-foreground'}`}>
            {fillVars(t('parcG8.replacePreview'), { kits: p.kits_entretien, forfaits: p.forfaits, merged: p.fusionnes_entretien + p.fusionnes_forfaits })}
          </p>
        ))}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => apply.mutate()} disabled={!ready || total === 0 || apply.isPending}>
            {apply.isPending ? <Loader2 className="animate-spin" /> : <Replace />} {t('parcG8.replaceApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
