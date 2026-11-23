import { DestinationLabelsButton } from '@/modules/purchases/destination-labels';

/**
 * M8 / C2 — Étiquettes « pour qui » depuis l'étape Réserver du dossier.
 * Elles portent le numéro de l'OR : avant l'entrée de la moto, on les imprime depuis la liste de préparation.
 */
export function DossierLabelsLink({ companyId, orId }: { companyId: string; orId: string | null }) {
  if (!orId) return null;
  return <DestinationLabelsButton companyId={companyId} kind="repair_order" id={orId} className="h-11" />;
}
