/**
 * M8 — « Voir sur la vue eclatee » pour chaque operation du plan (parcours technicien
 * `JourneyScreen`, dossier atelier, bloc « Operations » de la fiche OR `PlanOpsPanel`).
 *
 * Correctif ATE-05 du 26/11/2026 (Simon, Monster 1100 S 2009 sans manuel : le bouton ouvrait la
 * liste de tous les dessins). Le bouton ouvre maintenant LE dessin de la piece que l'operation
 * remplace, zoome et surligne sur son repere (regle pure `operationTargets`, operation-parts.ts) :
 * familles de pieces de l'operation → lignes de l'OR reliees, puis kit de la moto, puis regles de
 * recherche des kits dans le catalogue de ce modele-annee ; seules les references presentes sur un
 * dessin du modele-annee comptent. Plusieurs pieces : la premiere s'ouvre, les autres se
 * choisissent dans la fenetre.
 * Les controles / nettoyages / vidanges de liquide ouvrent aussi le dessin de l'element concerne
 * (table operation → composant → dessins, operation-components.ts).
 * Decision de Simon (26/11) : « si y a pas de vues y a pas de bouton » — aucun dessin de la moto
 * ne montre l'element (lecture DDS, essai, nettoyage...) : aucun bouton.
 * « Reserver » reste possible (OR enregistre, ni facture ni annule) ; « Ajouter a l'OR » n'est
 * propose que dans l'editeur de l'OR (lot E) : le parcours ne modifie pas les lignes.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import type { PlanOpSlotInfo } from '../plan-ops/rules';
import { opLinesRefs } from './api';
import { useOrCatalogIndex } from './use-or-catalog';
import { ExplodedViewsDialog } from './exploded-views-dialog';
import { operationMayHaveTargets, operationTargets } from './operation-parts';
import { orReadOnly } from './rules';

export function OperationExplodedButton({ info, companyId }: { info: PlanOpSlotInfo; companyId: string }) {
  const hasFamilies = operationMayHaveTargets(info);
  const { my, modelYearId, index } = useOrCatalogIndex(info.orId, companyId, hasFamilies);
  const lineKey = info.lines.map((l) => `${l.family_code}:${l.article_id ?? ''}`).join(',');
  const lineRefs = useQuery({
    queryKey: ['exploded', 'op-line-refs', lineKey],
    queryFn: () => opLinesRefs(info.lines),
    enabled: hasFamilies && !!modelYearId && info.lines.some((l) => !!l.article_id), staleTime: 300_000,
  });
  const targets = useMemo(
    () => (index.data ? operationTargets({ familyCodes: info.familyCodes, lines: lineRefs.data ?? [], label: info.label }, index.data) : []),
    [index.data, lineRefs.data, info.familyCodes, info.label],
  );
  const [open, setOpen] = useState(false);

  // Pas de piece situee sur un dessin de cette moto : pas de bouton.
  if (!targets.length || !modelYearId) return null;
  return (
    <>
      <Button
        type="button" variant="outline" className="h-12 shrink-0 self-start px-3 text-[14px]"
        onClick={() => setOpen(true)} aria-label={t('myWorkshop.opExploded')} title={targets[0].drawingLabel}
      >
        <Layers /> <span className="hidden sm:inline">{t('myWorkshop.opExploded')}</span>
      </Button>
      {open && (
        <ExplodedViewsDialog
          companyId={companyId} modelYearId={modelYearId} target={null} targets={targets}
          onClose={() => setOpen(false)}
          orId={info.orId} readOnly={orReadOnly(my.data?.status)} onAdd={null}
        />
      )}
    </>
  );
}
