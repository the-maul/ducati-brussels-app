/**
 * « Ce poste est : ... » (PDV030) : le poste du navigateur courant est memorise LOCALEMENT
 * (localStorage, une cle par societe). Rien en base : deux PC de la meme societe ont chacun leur
 * poste. Navigation privee ou stockage bloque : aucun poste, la caisse imprime comme avant.
 */
const KEY = (companyId: string) => `dms.workstation.${companyId}`;
export const WORKSTATION_EVENT = 'dms-workstation-change';

export function getLocalWorkstationId(companyId: string | null | undefined): string | null {
  if (!companyId || typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(KEY(companyId)) || null; } catch { return null; }
}

export function setLocalWorkstationId(companyId: string, id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(KEY(companyId), id);
    else window.localStorage.removeItem(KEY(companyId));
  } catch { /* stockage indisponible : choix non memorise */ }
  window.dispatchEvent(new CustomEvent(WORKSTATION_EVENT, { detail: { companyId, id } }));
}
