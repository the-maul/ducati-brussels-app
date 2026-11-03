/**
 * M8 — Dossier accident (mission 09, carte 5, ACH005) : REGLES PURES, sans acces reseau.
 *
 * Un dossier accident part a Ducati West Europe (aide a la reparation) avec quatre pieces
 * jointes : le formulaire Excel « Aide Reparation Moto Accidentee », le devis du DMS (PDF), le
 * PDF des photos avant reparation, la photo du n° de chassis grave. Regle M08 : « un dossier
 * part complet ou ne part pas » — la checklist ci-dessous est le seul juge.
 *
 * Le formulaire Excel reproduit EXACTEMENT le modele Ducati (docs/modeles/formulaire-commande-
 * moto-accidentee.xlsx) : on ne redessine rien, on remplit les cellules du modele (C4 chassis,
 * C5 client, puis trois blocs Reference / Designation / Qte en colonnes B-D, I-K, P-R a partir
 * de la ligne 8). Le modele a 39 lignes bordees par bloc (8 a 46) : au-dela, on passe au bloc
 * suivant. Testable sans navigateur (tests/workshop-accident-file.test.ts).
 */
import type { StatusTone } from '@/components/status-badge';

/** Seuil Ducati : un dossier accident sous 1 500 € HTVA passe en commande standard. */
export const ACCIDENT_FILE_MIN_HT = 1500;
/** Remise constructeur sur les pieces quand l'aide est accordee. */
export const ACCIDENT_FILE_DISCOUNT_RATE = 0.15;
/** Nombre minimum de photos avant reparation (4 cotes de la moto). */
export const ACCIDENT_FILE_MIN_PHOTOS = 4;
/** Destinataire par defaut (reglable : Parametres → Tables → `accident_file_mail`, code `to`). */
export const ACCIDENT_FILE_DEFAULT_TO = 'technique.dwe@ducati.com';
/** Cle de la table de parametres (codes `to` et `cc`). */
export const ACCIDENT_FILE_MAIL_TABLE_KEY = 'accident_file_mail';
/** Entite GED des fichiers du dossier (photos, formulaire, PDF, rapport d'expert). */
export const ACCIDENT_FILE_ENTITY = 'accident_file';

export const ACCIDENT_FILE_STATUSES = ['brouillon', 'envoye', 'accorde', 'pieces_recues', 'repare', 'clos'] as const;
export type AccidentFileStatus = (typeof ACCIDENT_FILE_STATUSES)[number];

export function isAccidentFileStatus(v: unknown): v is AccidentFileStatus {
  return typeof v === 'string' && (ACCIDENT_FILE_STATUSES as readonly string[]).includes(v);
}

/** Couleur du statut (l'icone et le libelle sont poses par l'ecran : charte, couleur + icone + libelle). */
export function accidentStatusTone(status: AccidentFileStatus): StatusTone {
  switch (status) {
    case 'brouillon': return 'neutral';
    case 'envoye': return 'info';
    case 'accorde': return 'success';
    case 'pieces_recues': return 'info';
    case 'repare': return 'success';
    case 'clos': return 'neutral';
  }
}

/** Transitions possibles depuis un statut (le brouillon ne passe « envoye » que par l'envoi du mail). */
export function accidentNextStatuses(status: AccidentFileStatus): AccidentFileStatus[] {
  switch (status) {
    case 'brouillon': return [];
    case 'envoye': return ['accorde', 'clos'];
    case 'accorde': return ['pieces_recues', 'clos'];
    case 'pieces_recues': return ['repare', 'clos'];
    case 'repare': return ['clos'];
    case 'clos': return [];
  }
}

// ---------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------

export type AccidentQuotePart = { reference: string; designation: string; qty: number; unitPriceHt: number };

/** Lignes PIECES d'un devis (article rattache, montant) : pas la main-d'oeuvre, pas les textes, pas les frais de devis. */
export function quotePartLines(lines: { line_type?: string | null; article_id?: string | null; reference?: string | null; designation: string; quantity: number | string; unit_price_ht: number | string }[]): AccidentQuotePart[] {
  return lines
    .filter((l) => (l.line_type ?? 'article') === 'article' && !!l.article_id && Number(l.quantity) > 0)
    .map((l) => ({
      reference: (l.reference ?? '').trim(),
      designation: l.designation,
      qty: Number(l.quantity),
      unitPriceHt: Number(l.unit_price_ht),
    }));
}

export type AccidentAmounts = {
  /** Total HTVA du devis (pieces + main-d'oeuvre) : c'est lui que Ducati compare au seuil. */
  quoteTotalHt: number;
  partsTotalHt: number;
  /** Sous le seuil : commande standard, pas de dossier. */
  belowThreshold: boolean;
  /** Remise prevue par l'aide a la reparation (15 % des pieces) quand le dossier est eligible. */
  expectedDiscount: number;
};

export function accidentAmounts(quoteTotalHt: number, parts: AccidentQuotePart[]): AccidentAmounts {
  const partsTotalHt = Math.round(parts.reduce((s, p) => s + p.qty * p.unitPriceHt, 0) * 100) / 100;
  const belowThreshold = quoteTotalHt < ACCIDENT_FILE_MIN_HT;
  return {
    quoteTotalHt, partsTotalHt, belowThreshold,
    expectedDiscount: belowThreshold ? 0 : Math.round(partsTotalHt * ACCIDENT_FILE_DISCOUNT_RATE * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Checklist « Dossier complet ? »
// ---------------------------------------------------------------------------

export type AccidentChecklistInput = {
  hasQuote: boolean;
  hasForm: boolean;
  photoCount: number;
  hasVinPhoto: boolean;
  quoteTotalHt: number | null;
};

export type AccidentChecklist = {
  quote: boolean;
  form: boolean;
  photos: boolean;
  vinPhoto: boolean;
  amount: boolean;
  complete: boolean;
};

export function accidentChecklist(i: AccidentChecklistInput): AccidentChecklist {
  const quote = i.hasQuote;
  const form = i.hasForm;
  const photos = i.photoCount >= ACCIDENT_FILE_MIN_PHOTOS;
  const vinPhoto = i.hasVinPhoto;
  const amount = i.quoteTotalHt != null && i.quoteTotalHt >= ACCIDENT_FILE_MIN_HT;
  return { quote, form, photos, vinPhoto, amount, complete: quote && form && photos && vinPhoto && amount };
}

// ---------------------------------------------------------------------------
// Mail a Ducati West Europe (texte de Domenico, mail reel du dossier modele)
// ---------------------------------------------------------------------------

/** Six derniers caracteres du VIN (Ducati designe la moto par le modele et ces six caracteres, ex. « MTSV4Rally 000321 »). */
export function vinLast6(vin: string | null | undefined): string {
  const clean = (vin ?? '').replace(/\s+/g, '').toUpperCase();
  return clean.slice(-6);
}

export type AccidentMailInput = {
  clientName: string;
  model: string;
  vin: string | null | undefined;
  isUrgent: boolean;
  urgentNote: string | null | undefined;
};

/** Objet : « Dossier Accident : <CLIENT> - <modele> <6 derniers du VIN> ». */
export function accidentMailSubject(i: AccidentMailInput): string {
  const moto = [i.model.trim(), vinLast6(i.vin)].filter(Boolean).join(' ');
  return `Dossier Accident : ${i.clientName.trim().toUpperCase()} - ${moto}`.trim();
}

/**
 * Corps (texte brut, en francais : le destinataire est Ducati West Europe, pas le client) :
 * la phrase de Domenico, la ligne « Dossier urgent : … » seulement si le dossier est urgent,
 * puis la formule de politesse ; la signature est ajoutee par `graph-send-email`.
 */
export function accidentMailBody(i: AccidentMailInput): string {
  const lines = ['Bonjour,', '', 'Pourrais-tu faire suivre ce dossier accident s\'il te plaît.'];
  if (i.isUrgent) {
    const note = (i.urgentNote ?? '').trim();
    lines.push('', note ? `Dossier urgent : ${note}` : 'Dossier urgent.');
  }
  lines.push('', 'Bien à toi,');
  return lines.join('\n');
}

/** Adresses d'une saisie « a, b ; c » → liste propre (doublons et vides retires). */
export function splitAddresses(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? '').split(/[,;\s]+/)) {
    const a = part.trim().toLowerCase();
    if (a && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(a) && !out.includes(a)) out.push(a);
  }
  return out;
}

/** Noms des quatre pieces jointes du mail (sans caracteres genants pour Outlook). */
export function accidentAttachmentNames(i: { clientName: string; model: string; vin: string | null | undefined }) {
  const tag = [i.clientName.trim().toUpperCase(), i.model.trim(), vinLast6(i.vin)].filter(Boolean).join('_').replace(/[^\w.-]+/g, '_');
  return {
    form: `Formulaire_Commande_${tag}.xlsx`,
    quote: `Devis_${tag}.pdf`,
    photos: `Photos_${tag}.pdf`,
    vinPhoto: `Chassis_${tag}.jpg`,
  };
}

// ---------------------------------------------------------------------------
// Formulaire Excel « Aide Reparation Moto Accidentee » : cellules a remplir dans le modele
// ---------------------------------------------------------------------------

/** Lignes bordees par bloc dans le modele (lignes 8 a 46). */
export const ACCIDENT_FORM_FIRST_ROW = 8;
export const ACCIDENT_FORM_ROWS_PER_BLOCK = 39;
/** Les trois blocs du modele : colonnes Reference / Designation / Qte, et la colonne des valeurs d'en-tete. */
export const ACCIDENT_FORM_BLOCKS = [
  { ref: 'B', des: 'C', qty: 'D', head: 'C' },
  { ref: 'I', des: 'J', qty: 'K', head: 'J' },
  { ref: 'P', des: 'Q', qty: 'R', head: 'Q' },
] as const;
export const ACCIDENT_FORM_CAPACITY = ACCIDENT_FORM_ROWS_PER_BLOCK * ACCIDENT_FORM_BLOCKS.length;

export type FormCell = { cell: string; value: string | number };

export type AccidentFormInput = { chassis: string; clientName: string; parts: Pick<AccidentQuotePart, 'reference' | 'designation' | 'qty'>[] };

/**
 * Liste des cellules a ecrire : C4 / C5 (bloc 1), puis une ligne par piece, bloc 1 (B-D) puis
 * bloc 2 (I-K) puis bloc 3 (P-R). Les en-tetes chassis / client sont recopies en tete des blocs
 * utilises (J4 / J5, Q4 / Q5). Au-dela de la capacite du modele, une erreur claire.
 */
export function accidentFormCells(i: AccidentFormInput): FormCell[] {
  if (i.parts.length > ACCIDENT_FORM_CAPACITY) throw new Error(`accident_form_overflow:${ACCIDENT_FORM_CAPACITY}`);
  const cells: FormCell[] = [];
  const usedBlocks = Math.max(1, Math.ceil(i.parts.length / ACCIDENT_FORM_ROWS_PER_BLOCK));
  for (let b = 0; b < usedBlocks; b++) {
    const col = ACCIDENT_FORM_BLOCKS[b].head;
    cells.push({ cell: `${col}4`, value: i.chassis.trim().toUpperCase() });
    cells.push({ cell: `${col}5`, value: i.clientName.trim() });
  }
  i.parts.forEach((p, idx) => {
    const block = ACCIDENT_FORM_BLOCKS[Math.floor(idx / ACCIDENT_FORM_ROWS_PER_BLOCK)];
    const row = ACCIDENT_FORM_FIRST_ROW + (idx % ACCIDENT_FORM_ROWS_PER_BLOCK);
    cells.push({ cell: `${block.ref}${row}`, value: p.reference });
    cells.push({ cell: `${block.des}${row}`, value: p.designation });
    cells.push({ cell: `${block.qty}${row}`, value: p.qty });
  });
  return cells;
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Ecrit les valeurs dans le XML de la feuille 1 du modele (xl/worksheets/sheet1.xml), en gardant
 * le style de chaque cellule (bordures, alignements, polices) : la cellule vide `<c r="B8" s="3"/>`
 * devient `<c r="B8" s="3" t="inlineStr"><is><t>…</t></is></c>`, un nombre `<c …><v>2</v></c>`.
 * Une cellule absente du modele est ajoutee en fin de ligne. Les textes vides sont ignores.
 */
export function fillAccidentFormSheetXml(sheetXml: string, cells: FormCell[]): string {
  let xml = sheetXml;
  for (const { cell, value } of cells) {
    if (typeof value === 'string' && value.trim() === '') continue;
    const content = typeof value === 'number'
      ? `<v>${value}</v>`
      : `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`;
    const typeAttr = typeof value === 'number' ? '' : ' t="inlineStr"';
    const self = new RegExp(`<c r="${cell}"((?:\\s+(?!t=)[a-zA-Z:]+="[^"]*")*)\\s*/>`);
    const open = new RegExp(`<c r="${cell}"((?:\\s+[a-zA-Z:]+="[^"]*")*)>[\\s\\S]*?</c>`);
    if (self.test(xml)) {
      xml = xml.replace(self, (_m, attrs: string) => `<c r="${cell}"${attrs}${typeAttr}>${content}</c>`);
    } else if (open.test(xml)) {
      xml = xml.replace(open, (_m, attrs: string) => `<c r="${cell}"${attrs.replace(/\s+t="[^"]*"/, '')}${typeAttr}>${content}</c>`);
    } else {
      const rowNum = cell.replace(/[A-Z]+/, '');
      const rowRe = new RegExp(`(<row r="${rowNum}"[^>]*>)([\\s\\S]*?)(</row>)`);
      if (rowRe.test(xml)) xml = xml.replace(rowRe, (_m, a: string, body: string, z: string) => `${a}${body}<c r="${cell}"${typeAttr}>${content}</c>${z}`);
      else xml = xml.replace('</sheetData>', `<row r="${rowNum}"><c r="${cell}"${typeAttr}>${content}</c></row></sheetData>`);
    }
  }
  return xml;
}

/** Valeur lue dans le XML d'une feuille pour une cellule (inlineStr ou nombre), null si vide. Pour les tests. */
export function readSheetCell(sheetXml: string, cell: string): string | number | null {
  const m = sheetXml.match(new RegExp(`<c r="${cell}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`));
  if (!m || !m[1]) return null;
  const t = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
  if (t) return t[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const v = m[1].match(/<v>([\s\S]*?)<\/v>/);
  return v ? Number(v[1]) : null;
}

/** Titre du PDF de photos : « Photos avant reparation — <modele> — <VIN> ». */
export function photosPdfTitle(model: string, vin: string | null | undefined): string {
  return ['Photos avant réparation', model.trim() || null, (vin ?? '').trim() || null].filter(Boolean).join(' — ');
}
