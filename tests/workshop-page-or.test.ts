/**
 * ATE001b — page OR (retours client du 03/11/2026) : operateur choisi dans l'equipe (connecte par
 * defaut), type de reparation en liste (pre-rempli par le motif), prix de la ligne tire de
 * l'article (HT deduit du TTC), motif accident → dossier accident ; garde-fous : un seul
 * composant de recherche d'article (OR, check-up, ventes), liste en surcouche (portail).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  defaultOperator, operatorToSave, workshopTeamOptions, repairTypeFromReason, nextRepairType,
  repairTypeLabel, legacyRepairType, matchRepairTypeCode, showExpertFields, showWarrantyField,
  shouldOpenAccidentFile, isAccidentOr, DEFAULT_REPAIR_TYPES, type TeamMemberRow,
} from '../src/modules/workshop/or-page-rules';
import { articleBaseSaleHt, articleLinePrice, articleVatRate, customerDiscountPct, labourUnitPrice } from '../src/modules/sales/article-price';
import { moveActive } from '../src/modules/sales/article-line-pick';

const members: TeamMemberRow[] = [
  { user_id: 'dom', name: 'Domenico Desouter', roles: 'admin, chef_atelier, comptable, magasinier, marketing, mecanicien, vendeur' },
  { user_id: 'sim', name: 'SIMON', roles: 'marketing, vendeur' },
  { user_id: 'john', name: 'John', roles: 'chef_atelier, mecanicien' },
  { user_id: 'marc', name: 'Marc Mécano', roles: 'mecanicien' },
  { user_id: 'compta', name: 'Compta', roles: 'comptable' },
];

describe('operateur — membre de l equipe, connecte par defaut', () => {
  it('nouvel OR : l utilisateur connecte (John, chef mecano) est l operateur', () => {
    expect(defaultOperator({ isNew: true, currentUserId: 'john', members })).toEqual({ operatorId: 'john', legacyText: null });
  });
  it('OR enregistre avec un id : on garde cet id, meme si un autre est connecte', () => {
    expect(defaultOperator({ isNew: false, currentUserId: 'john', members, savedOperatorId: 'marc', savedOperatorText: 'Marc Mécano' }).operatorId).toBe('marc');
  });
  it('ancien OR (texte) : le nom retrouve son membre sans accents ni casse', () => {
    expect(defaultOperator({ isNew: false, currentUserId: 'john', members, savedOperatorText: 'marc mecano' })).toEqual({ operatorId: 'marc', legacyText: null });
  });
  it('ancien OR (texte inconnu) : le texte est garde, personne n est choisi', () => {
    expect(defaultOperator({ isNew: false, currentUserId: 'john', members, savedOperatorText: 'thierry' })).toEqual({ operatorId: null, legacyText: 'thierry' });
  });
  it('ancien OR sans operateur : on ne met pas l utilisateur connecte d office', () => {
    expect(defaultOperator({ isNew: false, currentUserId: 'john', members, savedOperatorText: '' }).operatorId).toBeNull();
  });
  it('liste : equipe atelier + admin, triee ; le connecte (vendeur) y figure aussi ; pas le comptable', () => {
    const opts = workshopTeamOptions(members, ['sim']);
    expect(opts.map((o) => o.userId)).toEqual(['dom', 'john', 'marc', 'sim']);
    expect(opts.find((o) => o.userId === 'sim')?.workshop).toBe(false);
    expect(workshopTeamOptions(members).map((o) => o.userId)).not.toContain('compta');
  });
  it('enregistrement : id + nom en texte (impression, ancien champ) ; texte ancien garde sans id', () => {
    expect(operatorToSave({ operatorId: 'john', legacyText: null }, members)).toEqual({ operatorId: 'john', operatorText: 'John' });
    expect(operatorToSave({ operatorId: null, legacyText: 'thierry' }, members)).toEqual({ operatorId: null, operatorText: 'thierry' });
    expect(operatorToSave({ operatorId: null, legacyText: null }, members)).toEqual({ operatorId: null, operatorText: '' });
    // Equipe pas encore chargee : le nom connu est garde, jamais efface.
    expect(operatorToSave({ operatorId: 'john', legacyText: null }, [], 'John')).toEqual({ operatorId: 'john', operatorText: 'John' });
  });
});

describe('type de reparation — liste reglable, pre-remplie par le motif', () => {
  it('liste par defaut : les 11 types demandes', () => {
    expect(DEFAULT_REPAIR_TYPES.map((x) => x.code)).toEqual([
      'entretien', 'reparation', 'garantie_ducati', 'garantie_magasin', 'accident', 'pneus', 'diagnostic', 'pdi', 'oro', 'accessoires', 'autre',
    ]);
  });
  it('motif evident → type ; garantie (Ducati ou magasin ?) et autre → rien', () => {
    expect(repairTypeFromReason('entretien_annuel')).toBe('entretien');
    expect(repairTypeFromReason('vidange')).toBe('entretien');
    expect(repairTypeFromReason('accident')).toBe('accident');
    expect(repairTypeFromReason('pneus')).toBe('pneus');
    expect(repairTypeFromReason('freins')).toBe('reparation');
    expect(repairTypeFromReason('diagnostic')).toBe('diagnostic');
    expect(repairTypeFromReason('garantie')).toBeNull();
    expect(repairTypeFromReason('autre')).toBeNull();
    expect(repairTypeFromReason(null)).toBeNull();
  });
  it('changement de motif : remplit un type vide, suit un type pre-rempli, ne touche jamais un choix manuel', () => {
    expect(nextRepairType({ current: '', previousReason: null, nextReason: 'accident' })).toBe('accident');
    expect(nextRepairType({ current: 'accident', previousReason: 'accident', nextReason: 'entretien_annuel' })).toBe('entretien');
    expect(nextRepairType({ current: 'accident', previousReason: 'accident', nextReason: 'autre' })).toBe('');
    expect(nextRepairType({ current: 'pdi', previousReason: 'accident', nextReason: 'entretien_annuel' })).toBe('pdi');
    expect(nextRepairType({ current: 'garantie_ducati', previousReason: null, nextReason: 'garantie' })).toBe('garantie_ducati');
  });
  it('ancien texte libre : « ENTRETIEN » retrouve son code, « calandre » reste tel quel', () => {
    expect(matchRepairTypeCode('ENTRETIEN', DEFAULT_REPAIR_TYPES)).toBe('entretien');
    expect(matchRepairTypeCode('calandre', DEFAULT_REPAIR_TYPES)).toBeNull();
    expect(legacyRepairType('calandre', DEFAULT_REPAIR_TYPES)).toBe('calandre');
    expect(legacyRepairType('pdi', DEFAULT_REPAIR_TYPES)).toBeNull();
    expect(repairTypeLabel('pdi', DEFAULT_REPAIR_TYPES)).toBe('Préparation moto neuve (PDI)');
    expect(repairTypeLabel('calandre', DEFAULT_REPAIR_TYPES)).toBe('calandre');
  });
});

describe('champs conditionnels', () => {
  it('expert et date d expert : accident seulement (ou deja remplis)', () => {
    expect(showExpertFields({ reasonCode: 'entretien_annuel', repairType: 'entretien' })).toBe(false);
    expect(showExpertFields({ reasonCode: 'accident' })).toBe(true);
    expect(showExpertFields({ repairType: 'accident' })).toBe(true);
    expect(showExpertFields({ reasonCode: 'pneus', expertName: 'Cabinet X' })).toBe(true);
  });
  it('prise en charge garantie : type garantie (ou deja engagee)', () => {
    expect(showWarrantyField({ repairType: 'entretien', warrantyStatus: 'aucune' })).toBe(false);
    expect(showWarrantyField({ repairType: 'garantie_magasin', warrantyStatus: 'aucune' })).toBe(true);
    expect(showWarrantyField({ reasonCode: 'garantie', repairType: '' })).toBe(true);
    expect(showWarrantyField({ repairType: 'entretien', warrantyStatus: 'en_attente' })).toBe(true);
  });
});

describe('motif accident → dossier accident', () => {
  it('ouvre le dossier pour un OR accident sans dossier', () => {
    expect(shouldOpenAccidentFile({ reasonCode: 'accident', status: 'a_faire', hasFile: false, schemaReady: true })).toBe(true);
    expect(shouldOpenAccidentFile({ repairType: 'accident', status: 'en_cours', hasFile: false, schemaReady: true })).toBe(true);
  });
  it('jamais deux dossiers, rien sans la migration, rien pour un OR annule ou non accident', () => {
    expect(shouldOpenAccidentFile({ reasonCode: 'accident', status: 'a_faire', hasFile: true, schemaReady: true })).toBe(false);
    expect(shouldOpenAccidentFile({ reasonCode: 'accident', status: 'a_faire', hasFile: false, schemaReady: false })).toBe(false);
    expect(shouldOpenAccidentFile({ reasonCode: 'accident', status: 'annule', hasFile: false, schemaReady: true })).toBe(false);
    expect(shouldOpenAccidentFile({ reasonCode: 'pneus', status: 'a_faire', hasFile: false, schemaReady: true })).toBe(false);
    expect(isAccidentOr({ reasonCode: null, repairType: null })).toBe(false);
  });
});

describe('prix de la ligne tire de l article', () => {
  it('PV HT connu : repris tel quel', () => {
    expect(articleBaseSaleHt({ sale_price_ht: 260.46, sale_price_ttc: 315.16, vat_rate: 21 })).toBe(260.46);
  });
  it('seulement le PV TTC (81 089 articles) : HT = TTC / (1 + TVA)', () => {
    expect(articleBaseSaleHt({ sale_price_ht: null, sale_price_ttc: 46.49, vat_rate: 21 })).toBe(38.42);
    expect(articleBaseSaleHt({ sale_price_ht: 0, sale_price_ttc: 121, vat_rate: 21 })).toBe(100);
    expect(articleBaseSaleHt({ sale_price_ht: null, sale_price_ttc: 50, vat_rate: 0 })).toBe(50);
    expect(articleBaseSaleHt({ sale_price_ht: null, sale_price_ttc: null, vat_rate: 21 })).toBe(0);
  });
  it('TVA de l article (pas 21 en dur), 21 si inconnue', () => {
    expect(articleVatRate({ vat_rate: 0 })).toBe(0);
    expect(articleVatRate({ vat_rate: 6 })).toBe(6);
    expect(articleVatRate({ vat_rate: null })).toBe(21);
  });
  it('ligne : PU HT (arrondi catalogue applique), TVA de l article, remise client', () => {
    const roundUp = (ht: number, v: number) => Math.round((Math.max(2, Math.ceil(ht * (1 + v / 100) - 1e-9)) / (1 + v / 100)) * 100) / 100;
    expect(articleLinePrice({ sale_price_ht: 38.42, vat_rate: 21 }, { effectiveHt: roundUp })).toEqual({ unit_price_ht: 38.84, vat_rate: 21, discount_pct: 0 });
    expect(articleLinePrice({ sale_price_ht: 38.42, vat_rate: 21 })).toEqual({ unit_price_ht: 38.42, vat_rate: 21, discount_pct: 0 });
    expect(articleLinePrice({ sale_price_ht: 100, vat_rate: 6 }, { clientDiscountPct: 10 })).toEqual({ unit_price_ht: 100, vat_rate: 6, discount_pct: 10 });
  });
  it('remise client : remise % et paliers seulement', () => {
    expect(customerDiscountPct({ rule_kind: 'discount_pct', discount_pct: 15 })).toBe(15);
    expect(customerDiscountPct({ rule_kind: 'quantity_tiers', discount_pct: 5 })).toBe(5);
    expect(customerDiscountPct({ rule_kind: 'base', discount_pct: 0 })).toBe(0);
    expect(customerDiscountPct({ rule_kind: 'coefficient', discount_pct: 0 })).toBe(0);
    expect(customerDiscountPct(null)).toBe(0);
  });
  it('main-d oeuvre : taux horaire atelier si pas de prix, jamais d ecrasement', () => {
    expect(labourUnitPrice(0, 90)).toBe(90);
    expect(labourUnitPrice(75, 90)).toBe(75);
    expect(labourUnitPrice(0, null)).toBe(0);
  });
});

describe('recherche d article — un composant, en surcouche, au clavier', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  it('fleches : boucle en haut et en bas', () => {
    expect(moveActive(-1, 1, 5)).toBe(0);
    expect(moveActive(-1, -1, 5)).toBe(4);
    expect(moveActive(4, 1, 5)).toBe(0);
    expect(moveActive(0, -1, 5)).toBe(4);
    expect(moveActive(2, 1, 0)).toBe(-1);
  });
  it('OR, check-up et ventes utilisent ArticleLinePicker ; liste dans un Popover (portail)', () => {
    expect(read('src/modules/workshop/or-editor.tsx')).toContain('<ArticleLinePicker');
    expect(read('src/modules/sales/document-editor.tsx')).toContain('<ArticleLinePicker');
    expect(read('src/modules/workshop/checkup/checkup-tab.tsx')).toContain("import { ArticlePicker } from '../or-editor'");
    const picker = read('src/modules/sales/article-line-picker.tsx');
    expect(picker).toContain('PopoverContent');
    expect(picker).not.toContain('absolute z-20');
  });
  it('recherche : fonction classee d abord, repli sur l ancienne ; PV HT deduit du TTC', () => {
    const api = read('src/modules/sales/write-api.ts');
    expect(api).toContain("'article_line_search'");
    expect(api).toContain("'part_order_article_search'");
    expect(api).toContain('articleBaseSaleHt(');
  });
});
