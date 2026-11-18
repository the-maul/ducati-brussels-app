/**
 * M8 — OR garantie (B10), regles pures (rattrapage G8 du 18/11/2026, lot garantie / accident).
 *
 * G8 (07-atelier.md §1, §11, §15) :
 * - onglet Garantie de l'OR : cession 05 garantie fournisseur / 06 garantie magasin-atelier /
 *   07 geste commercial ; avancement en attente / acceptee / refusee / refus partiel ;
 * - par ligne « Garantie/Cession article » : la ligne passe a 0 € pour le client (lettre G) ;
 * - MO garantie au taux garantie (MO_ATELIER GARANTIE) ;
 * - liste des cessions › Garanties (temps MO, achat ART, cout MO) et Garanties / CA ;
 * - suivi des retours constructeur (rembourse, echange, attente remboursement, attente echange).
 *
 * Aucun import d'alias ici : fichier teste tel quel.
 */

export const WARRANTY_STATUSES = ['aucune', 'en_attente', 'accepte', 'refus_total', 'refus_partiel'] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

/** Types de cession garantie proposes sur l'OR (codes de la table « Types de cession interne »). */
export const WARRANTY_CESSION_CODES = ['05', '06', '07'] as const;
export type WarrantyCessionCode = (typeof WARRANTY_CESSION_CODES)[number];
export const isWarrantyCessionCode = (v: unknown): v is WarrantyCessionCode =>
  typeof v === 'string' && (WARRANTY_CESSION_CODES as readonly string[]).includes(v);

/** Libelles par defaut (ceux de G8) si la table de parametres n'a pas la ligne. */
export const DEFAULT_WARRANTY_CESSION_LABELS: Record<WarrantyCessionCode, string> = {
  '05': 'Garantie fournisseur',
  '06': 'Garantie magasin/atelier',
  '07': 'Geste commercial',
};

export type LineDecision = 'accepte' | 'refuse';
export const isLineDecision = (v: unknown): v is LineDecision => v === 'accepte' || v === 'refuse';

export type WarrantyLineLike = {
  kind?: string;
  is_warranty: boolean;
  warranty_decision?: string | null;
};

/**
 * La ligne est-elle a la charge de la garantie (0 € pour le client) ?
 * - pas cochee « garantie » → non ;
 * - refus total → non : toutes les lignes sont re-routees vers le client ;
 * - refus partiel → oui sauf les lignes marquees « refusee » (re-routees vers le client) ;
 * - en attente / acceptee / aucune (ancienne saisie) → oui.
 */
export function lineCoveredByWarranty(line: WarrantyLineLike, status: string | null | undefined): boolean {
  if (!line.is_warranty) return false;
  if (status === 'refus_total') return false;
  if (status === 'refus_partiel') return line.warranty_decision !== 'refuse';
  return true;
}

/** La ligne avait ete demandee en garantie mais le client la paie (refus total ou ligne refusee). */
export function lineReroutedToClient(line: WarrantyLineLike, status: string | null | undefined): boolean {
  return line.is_warranty && !lineCoveredByWarranty(line, status);
}

/** Prix unitaire HT facture au client : 0 si la garantie couvre la ligne. */
export function clientUnitPrice(line: WarrantyLineLike & { unit_price_ht: number }, status: string | null | undefined): number {
  return lineCoveredByWarranty(line, status) ? 0 : line.unit_price_ht;
}

/** Decision enregistree pour la ligne : seulement pour une ligne en garantie. */
export function lineDecisionToSave(line: WarrantyLineLike): LineDecision | null {
  return line.is_warranty && isLineDecision(line.warranty_decision) ? line.warranty_decision : null;
}

/** Type de cession propose d'apres le type de reparation (garantie Ducati = fournisseur, magasin = magasin). */
export function cessionFromRepairType(repairType: string | null | undefined): WarrantyCessionCode | null {
  if (repairType === 'garantie_ducati') return '05';
  if (repairType === 'garantie_magasin') return '06';
  return null;
}

/**
 * Choisir un type de cession sur un OR sans prise en charge ouvre la demande (G8 : avancement
 * « Demande de prise en charge en attente »). Un statut deja engage n'est jamais ecrase.
 */
export function statusAfterCessionChoice(current: string | null | undefined, cession: string | null | undefined): string {
  const cur = current || 'aucune';
  if (cession && cur === 'aucune') return 'en_attente';
  return cur;
}

/** Commentaire automatique de G8 : « Demande de garantie pour le Chassis … Immat … ». */
export function warrantyRequestNote(template: string, v: { vin?: string | null; plate?: string | null }): string {
  return template
    .split('{vin}').join((v.vin ?? '').trim() || '—')
    .split('{plate}').join((v.plate ?? '').trim() || '—');
}

/** Couleur du badge d'avancement (statut = couleur + icone + libelle). */
export function warrantyStatusTone(s: string | null | undefined): 'warning' | 'success' | 'danger' | 'info' | 'neutral' {
  if (s === 'en_attente') return 'warning';
  if (s === 'accepte') return 'success';
  if (s === 'refus_total') return 'danger';
  if (s === 'refus_partiel') return 'info';
  return 'neutral';
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Ce que la garantie prend en charge sur l'OR (affiche sous les lignes, avant facturation) :
 * valeur au prix de vente des lignes couvertes, heures de MO couvertes et leur valeur au taux
 * MO garantie (0 / null = prix de la ligne), lignes re-routees vers le client.
 */
export function warrantySummary(
  lines: (WarrantyLineLike & { kind: string; quantity: number; unit_price_ht: number; discount_pct?: number; checkup_state?: string | null })[],
  status: string | null | undefined,
  warrantyRateHt: number | null | undefined,
): { coveredLines: number; coveredSaleHt: number; labourHours: number; labourWarrantyHt: number; rerouted: number } {
  let coveredLines = 0, coveredSaleHt = 0, labourHours = 0, labourWarrantyHt = 0, rerouted = 0;
  for (const l of lines) {
    if (l.checkup_state === 'ok' || l.checkup_state === 'reporte') continue;
    if (lineReroutedToClient(l, status)) { rerouted++; continue; }
    if (!lineCoveredByWarranty(l, status)) continue;
    coveredLines++;
    coveredSaleHt += l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100);
    if (l.kind === 'mo') {
      labourHours += l.quantity;
      labourWarrantyHt += l.quantity * (warrantyRateHt && warrantyRateHt > 0 ? warrantyRateHt : l.unit_price_ht);
    }
  }
  return { coveredLines, coveredSaleHt: r2(coveredSaleHt), labourHours: r2(labourHours), labourWarrantyHt: r2(labourWarrantyHt), rerouted };
}

// ---------------------------------------------------------------------------------------------
// Parametre : taux MO garantie (Parametres → Tables → Garantie atelier, code « mo »)
// ---------------------------------------------------------------------------------------------

export const WARRANTY_SETTINGS_TABLE_KEY = 'workshop_warranty';

/** Taux MO garantie HT lu dans la ligne « mo » ; null si absent, inactif ou 0. */
export function parseWarrantyRate(rows: { code: string; is_active?: boolean | null; extra: unknown }[]): number | null {
  const r = rows.find((x) => x.code === 'mo' && x.is_active !== false);
  const raw = r && r.extra && typeof r.extra === 'object' ? (r.extra as Record<string, unknown>).hourly_rate_ht : null;
  const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
  return raw != null && raw !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------------------------
// Retours / remboursements constructeur
// ---------------------------------------------------------------------------------------------

export const WARRANTY_RETURN_STATUSES = ['attente_remboursement', 'attente_echange', 'rembourse', 'echange'] as const;
export type WarrantyReturnStatus = (typeof WARRANTY_RETURN_STATUSES)[number];
export const isWarrantyReturnStatus = (v: unknown): v is WarrantyReturnStatus =>
  typeof v === 'string' && (WARRANTY_RETURN_STATUSES as readonly string[]).includes(v);

export const isReturnSettled = (s: string) => s === 'rembourse' || s === 'echange';

export function warrantyReturnTone(s: string): 'warning' | 'success' {
  return isReturnSettled(s) ? 'success' : 'warning';
}

/**
 * Changement d'etat d'un retour : passer a « rembourse » / « echange » date la reception de la
 * garantie (aujourd'hui, si elle n'est pas deja saisie) ; revenir en attente l'efface.
 */
export function returnStatusPatch(next: WarrantyReturnStatus, current: { settled_at: string | null }, today: string): { status: WarrantyReturnStatus; settled_at: string | null } {
  if (isReturnSettled(next)) return { status: next, settled_at: current.settled_at || today };
  return { status: next, settled_at: null };
}

/** Totaux d'une liste de retours : nombre et montant en attente / regles. */
export function returnsTotals(rows: { status: string; amount_ht: number | string }[]): { pendingCount: number; pendingHt: number; settledCount: number; settledHt: number } {
  let pendingCount = 0, pendingHt = 0, settledCount = 0, settledHt = 0;
  for (const r of rows) {
    const a = Number(r.amount_ht) || 0;
    if (isReturnSettled(r.status)) { settledCount++; settledHt += a; } else { pendingCount++; pendingHt += a; }
  }
  return { pendingCount, pendingHt: r2(pendingHt), settledCount, settledHt: r2(settledHt) };
}

// ---------------------------------------------------------------------------------------------
// Statistique « Garanties / CA »
// ---------------------------------------------------------------------------------------------

export type WarrantyStatRow = {
  contact_id: string | null; client_code: string | null; client_name: string | null;
  revenue_ht: number | string; warranty_pamp_ht: number | string; warranty_pa_ht: number | string;
  warranty_sale_ht: number | string; warranty_lines: number;
};

/** % garantie / CA (au PAMP, comme G8) ; null si pas de CA. */
export function warrantyRatePct(warrantyHt: number, revenueHt: number): number | null {
  if (!revenueHt || revenueHt <= 0) return null;
  return Math.round((warrantyHt / revenueHt) * 10000) / 100;
}

export function warrantyStatsTotals(rows: WarrantyStatRow[]): { revenueHt: number; pampHt: number; paHt: number; saleHt: number; lines: number; pct: number | null } {
  let revenueHt = 0, pampHt = 0, paHt = 0, saleHt = 0, lines = 0;
  for (const r of rows) {
    revenueHt += Number(r.revenue_ht) || 0;
    pampHt += Number(r.warranty_pamp_ht) || 0;
    paHt += Number(r.warranty_pa_ht) || 0;
    saleHt += Number(r.warranty_sale_ht) || 0;
    lines += Number(r.warranty_lines) || 0;
  }
  return { revenueHt: r2(revenueHt), pampHt: r2(pampHt), paHt: r2(paHt), saleHt: r2(saleHt), lines, pct: warrantyRatePct(pampHt, revenueHt) };
}

/** Totaux de la liste « Garanties » (temps MO, achat pieces, cout MO, cout MO + pieces). */
export function warrantyLinesTotals(rows: { labour_hours: number | string; parts_cost_ht: number | string; labour_cost_ht: number | string }[]): { hours: number; partsHt: number; labourHt: number; totalHt: number } {
  let hours = 0, partsHt = 0, labourHt = 0;
  for (const r of rows) {
    hours += Number(r.labour_hours) || 0;
    partsHt += Number(r.parts_cost_ht) || 0;
    labourHt += Number(r.labour_cost_ht) || 0;
  }
  return { hours: r2(hours), partsHt: r2(partsHt), labourHt: r2(labourHt), totalHt: r2(partsHt + labourHt) };
}
