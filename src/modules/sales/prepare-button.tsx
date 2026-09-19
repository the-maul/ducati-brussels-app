/**
 * M6 — Bouton « Préparer » (mission 05, carte 6) : « générer la pick list en un clic, sans devoir
 * rentrer dans le document ». Crée ou rouvre la liste de préparation du document puis ouvre la
 * vue tablette. Utilisé dans la liste des ventes et l'onglet Documents de la fiche client.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ClipboardList, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { openPickingForDocument, canPrepareDocument } from './picking-api';
import { t } from '@/lib/i18n';

export function PrepareButton({ doc, withLabel = false }: { doc: { id: string; doc_type: string; status: string }; withLabel?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const open = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => openPickingForDocument(doc.id),
    onSuccess: (pickingId) => {
      qc.invalidateQueries({ queryKey: ['picking-lists'] });
      navigate({ to: '/preparation/$pickingId', params: { pickingId } });
    },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('picking.errOpen')),
  });
  if (!canPrepareDocument(doc)) return null;
  const icon = open.isPending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardList className="size-4" />;
  return withLabel ? (
    <Button variant="outline" size="sm" title={t('picking.prepareHint')} onClick={(e) => { e.stopPropagation(); open.mutate(); }} disabled={open.isPending}>
      {icon} {t('picking.prepare')}
    </Button>
  ) : (
    <Button variant="ghost" size="icon" title={t('picking.prepareHint')} onClick={(e) => { e.stopPropagation(); open.mutate(); }} disabled={open.isPending}>
      {icon}
    </Button>
  );
}
