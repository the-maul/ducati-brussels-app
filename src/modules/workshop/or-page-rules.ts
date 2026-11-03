/**
 * M8 — Page OR : regles pures (retours client du 03/11/2026, ATE001b, mission 10).
 *
 * - Operateur : un membre de l'equipe (mecaniciens, chef d'atelier, administrateurs), l'utilisateur
 *   connecte par defaut ; un ancien OR garde son texte libre (affiche s'il ne correspond a personne).
 * - Type de reparation : liste reglable (Parametres → Tables, `workshop_repair_type`), pre-remplie
 *   d'apres le motif d'entree quand il le rend evident.
 * - Champs conditionnels : expert et date d'expert seulement pour un accident, prise en charge
 *   garantie seulement pour une garantie (toujours visibles s'ils sont deja remplis).
 * - Motif « accident » : a l'enregistrement, le dossier accident s'ouvre (brouillon, lie a l'OR).
 */

// ---------------------------------------------------------------------------------------------
// Operateur
// ---------------------------------------------------------------------------------------------

export type TeamMemberRow = { user_id: string; name: string; roles: string | null };
export type TeamOption = { userId: string; name: string; workshop: boolean };

/** Roles de l'atelier (mecanicien / chef_atelier) et administrateurs (Domenico). */
export const WORKSHOP_TEAM_ROLES = ['mecanicien', 'chef_atelier', 'admin'] as const;

const rolesOf = (r: string | null | undefined) => (r ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Liste du choix « Operateur » : l'equipe atelier (et les administrateurs) par ordre alphabetique ;
 * l'utilisateur connecte y figure toujours (meme vendeur : il ouvre l'OR a son nom), ainsi que
 * l'operateur deja enregistre sur l'OR.
 */
export function workshopTeamOptions(members: TeamMemberRow[], keepUserIds: (string | null | undefined)[] = []): TeamOption[] {
  const keep = new Set(keepUserIds.filter(Boolean) as string[]);
  const out: TeamOption[] = [];
  for (const m of members) {
    const workshop = rolesOf(m.roles).some((r) => (WORKSHOP_TEAM_ROLES as readonly string[]).includes(r));
    if (workshop || keep.has(m.user_id)) out.push({ userId: m.user_id, name: m.name, workshop });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

export type OperatorChoice = {
  /** Membre choisi (id utilisateur) ; null = personne / texte ancien seulement. */
  operatorId: string | null;
  /** Texte d'un ancien OR qui ne correspond a aucun membre (affiche tel quel, garde a l'enregistrement). */
  legacyText: string | null;
};

/**
 * Operateur a l'ouverture de l'ecran :
 * - OR enregistre avec un id → cet id ;
 * - OR ancien (texte seulement) → le membre dont le nom correspond (sans accents ni casse), sinon
 *   le texte garde tel quel (« ancien texte ») ;
 * - nouvel OR → l'utilisateur connecte (John, chef mecano, connecte : l'OR est a son nom).
 */
export function defaultOperator(p: {
  isNew: boolean;
  currentUserId: string | null;
  members: TeamMemberRow[];
  savedOperatorId?: string | null;
  savedOperatorText?: string | null;
}): OperatorChoice {
  if (p.savedOperatorId) return { operatorId: p.savedOperatorId, legacyText: null };
  const text = (p.savedOperatorText ?? '').trim();
  if (text) {
    const m = p.members.find((x) => norm(x.name) === norm(text));
    return m ? { operatorId: m.user_id, legacyText: null } : { operatorId: null, legacyText: text };
  }
  if (p.isNew && p.currentUserId) return { operatorId: p.currentUserId, legacyText: null };
  return { operatorId: null, legacyText: null };
}

/** Ce qui s'enregistre : l'id (si la colonne existe) et le nom en texte (ancien champ, impression). */
export function operatorToSave(choice: OperatorChoice, members: TeamMemberRow[], fallbackText = ''): { operatorId: string | null; operatorText: string } {
  if (choice.operatorId) {
    // Equipe pas encore chargee (ou en erreur) : on garde le nom deja connu plutot que de l'effacer.
    const m = members.find((x) => x.user_id === choice.operatorId);
    return { operatorId: choice.operatorId, operatorText: m?.name ?? (choice.legacyText || fallbackText) };
  }
  return { operatorId: null, operatorText: choice.legacyText ?? '' };
}

// ---------------------------------------------------------------------------------------------
// Type de reparation
// ---------------------------------------------------------------------------------------------

export const WORKSHOP_REPAIR_TYPE_TABLE_KEY = 'workshop_repair_type';

/** Memes valeurs que celles prechargees par la migration 20261103230000 (repli tant qu'elle n'est pas posee). */
export const DEFAULT_REPAIR_TYPES: { code: string; label: string }[] = [
  { code: 'entretien', label: 'Entretien' },
  { code: 'reparation', label: 'Réparation' },
  { code: 'garantie_ducati', label: 'Garantie Ducati' },
  { code: 'garantie_magasin', label: 'Garantie magasin' },
  { code: 'accident', label: 'Accident / carrosserie' },
  { code: 'pneus', label: 'Pneus' },
  { code: 'diagnostic', label: 'Diagnostic' },
  { code: 'pdi', label: 'Préparation moto neuve (PDI)' },
  { code: 'oro', label: 'Remise en état occasion (ORO)' },
  { code: 'accessoires', label: 'Accessoires / montage' },
  { code: 'autre', label: 'Autre' },
];

/**
 * Type de reparation evident d'apres le motif d'entree (null = pas evident : on ne propose rien).
 * « Garantie » n'est pas tranche (Ducati ou magasin ?) : le chef d'atelier choisit.
 */
export function repairTypeFromReason(reasonCode: string | null | undefined): string | null {
  const r = (reasonCode ?? '').toLowerCase();
  if (!r) return null;
  if (r.startsWith('entretien') || r === 'vidange' || r.startsWith('desmo')) return 'entretien';
  if (r === 'accident') return 'accident';
  if (r === 'pneus') return 'pneus';
  if (r === 'freins') return 'reparation';
  if (r === 'diagnostic') return 'diagnostic';
  return null;
}

/**
 * Pre-remplissage a chaque changement de motif : seulement si le type est vide ou s'il avait ete
 * pre-rempli par le motif precedent (un type choisi a la main n'est jamais ecrase).
 */
export function nextRepairType(p: { current: string; previousReason: string | null; nextReason: string | null }): string {
  const proposed = repairTypeFromReason(p.nextReason);
  const auto = repairTypeFromReason(p.previousReason);
  const untouched = !p.current || (auto !== null && p.current === auto);
  if (!untouched) return p.current;
  return proposed ?? '';
}

/** Libelle a afficher : celui de la liste, sinon le texte libre d'un ancien OR (ex. « calandre »). */
export function repairTypeLabel(value: string | null | undefined, types: { code: string; label: string }[]): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const hit = types.find((x) => x.code === v) ?? types.find((x) => norm(x.label) === norm(v) || norm(x.code) === norm(v));
  return hit ? hit.label : v;
}

/** Code de la liste qui correspond a une valeur (code exact, ou libelle / code sans casse ni accents : « ENTRETIEN »). */
export function matchRepairTypeCode(value: string | null | undefined, types: { code: string; label: string }[]): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const hit = types.find((x) => x.code === v) ?? types.find((x) => norm(x.label) === norm(v) || norm(x.code) === norm(v));
  return hit ? hit.code : null;
}

/** Valeur ancienne hors liste (texte libre) : gardee comme option « ancien » pour ne pas la perdre. */
export function legacyRepairType(value: string | null | undefined, types: { code: string; label: string }[]): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  return types.some((x) => x.code === v) ? null : v;
}

// ---------------------------------------------------------------------------------------------
// Champs conditionnels et dossier accident
// ---------------------------------------------------------------------------------------------

export const isAccidentOr = (p: { reasonCode?: string | null; repairType?: string | null }) =>
  (p.reasonCode ?? '') === 'accident' || (p.repairType ?? '') === 'accident';

export const isWarrantyType = (repairType: string | null | undefined) => (repairType ?? '').startsWith('garantie');

/** Expert et date d'expert : OR accident, ou deja remplis (ancien OR). */
export function showExpertFields(p: { reasonCode?: string | null; repairType?: string | null; expertName?: string | null; expertDate?: string | null }): boolean {
  return isAccidentOr(p) || !!(p.expertName ?? '').trim() || !!(p.expertDate ?? '').trim();
}

/** Prise en charge garantie : type garantie ou motif garantie, ou deja engagee (statut autre que « aucune »). */
export function showWarrantyField(p: { reasonCode?: string | null; repairType?: string | null; warrantyStatus?: string | null }): boolean {
  return isWarrantyType(p.repairType) || (p.reasonCode ?? '') === 'garantie' || ((p.warrantyStatus ?? 'aucune') !== 'aucune');
}

/**
 * Faut-il ouvrir le dossier accident a l'enregistrement ? Motif ou type « accident », OR non
 * annule, et pas encore de dossier pour cet OR (l'ouverture est de toute facon idempotente).
 */
export function shouldOpenAccidentFile(p: { reasonCode?: string | null; repairType?: string | null; status?: string | null; hasFile: boolean; schemaReady: boolean }): boolean {
  if (!p.schemaReady || p.hasFile) return false;
  if (p.status === 'annule') return false;
  return isAccidentOr(p);
}
