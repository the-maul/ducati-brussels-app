/**
 * M8 — Lot E integre au parcours (lot F, 19/11/2026) : « Voir sur la vue eclatee » pour chaque
 * operation du plan, branche sur l'emplacement `operationExtra(op)` prevu par le lot D
 * (parcours technicien `JourneyScreen` et bloc « Operations » de la fiche OR `PlanOpsPanel`).
 *
 * Reutilise la fenetre du lot E (`ExplodedViewsDialog`), rien n'est refait :
 *  - une piece de l'OR consommee par l'operation → sa vue s'ouvre, le repere en evidence ;
 *  - plusieurs pieces → on choisit la piece (gros boutons), ou toutes les vues de la moto ;
 *  - aucune piece (controle, reglage) → les vues de la moto, par groupe du catalogue.
 * « Reserver » reste possible (OR enregistre, ni facture ni annule) ; « Ajouter a l'OR » n'est
 * propose que dans l'editeur de l'OR (lot E), pas ici : le parcours ne modifie pas les lignes.
 * Le modele-annee de la moto est lu une fois par OR (meme cle de cache pour toutes les operations).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import type { PlanOpSlotInfo } from '../plan-ops/rules';
import { ExplodedViewsDialog, type ExplodedTarget } from './exploded-views-dialog';
import { operationArticles, orReadOnly } from './rules';

type OrMy = { modelYearId: string | null; status: string | null };

/** Moto de l'OR → modele-annee du catalogue Ducati, et statut de l'OR (consultation seule si facture / annule). */
async function orModelYear(orId: string): Promise<OrMy> {
  const sb = supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } } } };
  const { data, error } = await sb.from('repair_orders').select('status, vehicles(ducati_model_year_id)').eq('id', orId).maybeSingle();
  if (error || !data) return { modelYearId: null, status: null };
  const row = data as unknown as { status: string | null; vehicles: { ducati_model_year_id: string | null } | null };
  return { modelYearId: row.vehicles?.ducati_model_year_id ?? null, status: row.status ?? null };
}

export function OperationExplodedButton({ info, companyId }: { info: PlanOpSlotInfo; companyId: string }) {
  const my = useQuery({ queryKey: ['exploded', 'or-my', info.orId], queryFn: () => orModelYear(info.orId), staleTime: 300_000 });
  const parts = useMemo(() => operationArticles(info), [info]);
  const [choose, setChoose] = useState(false);
  const [target, setTarget] = useState<ExplodedTarget | undefined>(undefined);

  const open = () => {
    if (parts.length === 1) setTarget({ articleId: parts[0].articleId });
    else if (parts.length > 1) setChoose(true);
    else setTarget(null);
  };

  return (
    <>
      <Button
        type="button" variant="outline" className="h-12 shrink-0 self-start px-3 text-[14px]"
        onClick={open} disabled={my.isLoading} aria-label={t('myWorkshop.opExploded')}
      >
        <Layers /> <span className="hidden sm:inline">{t('myWorkshop.opExploded')}</span>
      </Button>
      {choose && (
        <Dialog open onOpenChange={(o) => { if (!o) setChoose(false); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('myWorkshop.opExplodedChoose')}</DialogTitle>
              <DialogDescription>{info.label}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {parts.map((p) => (
                <Button
                  key={p.articleId} type="button" variant="outline" className="h-14 justify-start whitespace-normal text-left text-[15px]"
                  onClick={() => { setChoose(false); setTarget({ articleId: p.articleId }); }}
                >
                  <Package className="shrink-0" /> {p.designation}
                </Button>
              ))}
              <Button type="button" variant="ghost" className="h-12 justify-start text-[15px]" onClick={() => { setChoose(false); setTarget(null); }}>
                <Layers className="shrink-0" /> {t('myWorkshop.opExplodedAll')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {target !== undefined && (
        <ExplodedViewsDialog
          companyId={companyId} modelYearId={my.data?.modelYearId ?? null} target={target}
          onClose={() => setTarget(undefined)}
          orId={info.orId} readOnly={orReadOnly(my.data?.status)} onAdd={null}
        />
      )}
    </>
  );
}
