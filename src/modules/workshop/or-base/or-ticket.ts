/**
 * M8 — OR au FORMAT TICKET 80 mm (decision du client Q46 du 18/11/2026 ; G8 « Edition Ordre de
 * reparation » › Ticket). Pur et teste (tests/workshop-or-ticket.test.ts).
 *
 * Meme mecanisme que les tickets de caisse (PDV030, src/lib/devices) : une suite de BLOCS mise en
 * page en colonnes fixes, imprimee par le pilote du poste (navigateur 80 mm, Epson ePOS, Star,
 * Web Serial, WebUSB). Le PDF A4 (or-pdf.ts) reste l'impression par defaut.
 * Contenu : coordonnees de la concession, n° d'OR (et code-barres pour la pointeuse), date et heure
 * de reception, client, telephone, moto (modele, immatriculation, VIN abrege), km, travaux demandes,
 * date et heure promises, acompte eventuel. Les informations complementaires ne sont jamais imprimees.
 */
import type { ReceiptBlock, ReceiptDoc } from '@/lib/devices/receipt';
import { receiptAmount } from '@/lib/devices/receipt';

export type OrTicketInput = {
  company: { name: string; address?: string | null; phone?: string | null; vat?: string | null };
  or: {
    number: string | null; receivedAt: string; promisedAt: string | null; mileage: number | null;
    workDescription: string | null;
  };
  client: { name: string; phone: string | null } | null;
  vehicle: { model: string | null; plate: string | null; vin: string | null } | null;
  /** Acompte net percu (0 / null = pas de ligne). */
  deposit: number | null;
};

/** Libelles du ticket : `tr('cle')` lit `orBase.ticket.cle` dans la langue du client. */
export type OrTicketTranslate = (key: string) => string;

const two = (n: number) => String(n).padStart(2, '0');
/** JJ/MM/AAAA HH:MM a l'heure du poste ; vide si la date manque ou est invalide. */
export function ticketDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** VIN abrege : « ...» + les 8 derniers caracteres (G8 imprime la fin du chassis). Court : tel quel. */
export function shortVin(vin: string | null | undefined): string {
  const v = (vin ?? '').trim().toUpperCase();
  return v.length > 8 ? `...${v.slice(-8)}` : v;
}

const kmText = (n: number | null) => (n == null ? '' : `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km`);

export function buildOrTicket(p: OrTicketInput, tr: OrTicketTranslate): ReceiptDoc {
  const b: ReceiptBlock[] = [];
  const line = (left: string, right: string) => { if (right.trim()) b.push({ kind: 'pair', left, right }); };
  // Concession
  b.push({ kind: 'text', text: p.company.name, align: 'center', bold: true });
  if (p.company.address) b.push({ kind: 'text', text: p.company.address, align: 'center' });
  if (p.company.phone) b.push({ kind: 'text', text: `${tr('phone')} ${p.company.phone}`, align: 'center' });
  if (p.company.vat) b.push({ kind: 'text', text: p.company.vat, align: 'center' });
  b.push({ kind: 'rule', char: '=' });
  b.push({ kind: 'text', text: tr('title'), align: 'center', bold: true });
  b.push({ kind: 'text', text: p.or.number ?? '', align: 'center', bold: true, large: true });
  b.push({ kind: 'rule' });
  line(tr('receivedAt'), ticketDateTime(p.or.receivedAt));
  // Client
  if (p.client) {
    b.push({ kind: 'text', text: tr('client'), bold: true });
    b.push({ kind: 'text', text: p.client.name });
    if (p.client.phone) line(tr('phone'), p.client.phone);
  }
  // Moto
  if (p.vehicle) {
    b.push({ kind: 'text', text: tr('vehicle'), bold: true });
    if (p.vehicle.model) b.push({ kind: 'text', text: p.vehicle.model });
    if (p.vehicle.plate) line(tr('plate'), p.vehicle.plate);
    if (p.vehicle.vin) line(tr('vin'), shortVin(p.vehicle.vin));
  }
  line(tr('mileage'), kmText(p.or.mileage));
  // Travaux
  const work = (p.or.workDescription ?? '').trim();
  if (work) {
    b.push({ kind: 'rule' });
    b.push({ kind: 'text', text: tr('work'), bold: true });
    b.push({ kind: 'text', text: work });
  }
  b.push({ kind: 'rule' });
  if (p.or.promisedAt) b.push({ kind: 'pair', left: tr('promisedAt'), right: ticketDateTime(p.or.promisedAt), bold: true });
  if (p.deposit && Math.abs(p.deposit) >= 0.005) b.push({ kind: 'pair', left: tr('deposit'), right: `${receiptAmount(p.deposit)} EUR`, bold: true });
  b.push({ kind: 'feed' });
  if (p.or.number) b.push({ kind: 'barcode', value: p.or.number });
  b.push({ kind: 'text', text: tr('footer'), align: 'center' });
  b.push({ kind: 'feed', lines: 2 });
  return { title: `${tr('title')} ${p.or.number ?? ''}`.trim(), blocks: b, widthMm: 80 };
}
