/**
 * M8 / M5 — Lot B du parcours mecanicien (19/11/2026) : « les pieces sans clic ». ATE015 ATE013.
 * Regles pures, miroir des fonctions SQL de la migration 20261119250000_m8_pieces_sans_clic.sql :
 *   _workshop_picking_due            -> pickingDue
 *   workshop_upcoming_parts          -> upcomingPartState, canReserve, canOrderUrgent
 *   _workshop_reservation_make_urgent -> urgentPlan
 *   _workshop_reservations_sync (lot B) -> isOrderable (fin de serie / remplacee : jamais au panier)
 * Rappel B7 : la picking list ne fait aucun mouvement de stock ; la reservation reste celle du RDV.
 */

const q3 = (n: number) => Math.round(n * 1000) / 1000;

export type PickingAutoMode = 'veille' | 'reception' | 'manuel';
export const PICKING_MODES: readonly PickingAutoMode[] = ['veille', 'reception', 'manuel'];
/** Q58 (20/11/2026) : veille OUVREE (defaut, dernier jour ouvert de l'atelier) ou veille calendaire. */
export type PickingEveBasis = 'ouvree' | 'calendaire';
export const PICKING_EVE_BASES: readonly PickingEveBasis[] = ['ouvree', 'calendaire'];
export const isPickingEveBasis = (v: unknown): v is PickingEveBasis => v === 'ouvree' || v === 'calendaire';
export const DEFAULT_PARTS_SETTINGS = { mode: 'veille' as PickingAutoMode, eveHour: 16, urgentDays: 5, eveBasis: 'ouvree' as PickingEveBasis };

export function isPickingMode(v: unknown): v is PickingAutoMode {
  return typeof v === 'string' && (PICKING_MODES as readonly string[]).includes(v);
}

/** Date (AAAA-MM-JJ) et heure a Bruxelles d'un instant. */
export function brusselsParts(d: Date): { date: string; hour: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * La picking list d'un RDV est-elle due ? Mode veille : RDV du jour (rattrapage), ou RDV du
 * lendemain a partir de l'heure reglee. Les autres modes ne creent rien a l'avance.
 */
export function pickingDue(p: {
  mode: PickingAutoMode; eveHour: number; startsAt: string | Date | null; now?: Date;
  /** Q58 : jour de creation de la liste (AAAA-MM-JJ) ; absent = veille calendaire. */
  eveDate?: string | null;
}): boolean {
  if (p.mode !== 'veille' || !p.startsAt) return false;
  const now = brusselsParts(p.now ?? new Date());
  const rdv = brusselsParts(typeof p.startsAt === 'string' ? new Date(p.startsAt) : p.startsAt);
  const d = dayDiff(rdv.date, now.date);
  if (d === 0) return true;          // rattrapage : RDV du jour
  if (d < 0) return false;
  const eve = p.eveDate ?? addDaysYmd(rdv.date, -1);
  const fromEve = dayDiff(now.date, eve);
  return fromEve > 0 || (fromEve === 0 && now.hour >= p.eveHour);
}

/** AAAA-MM-JJ + n jours (calendrier, sans fuseau). */
export function addDaysYmd(ymd: string, n: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Q58 (20/11/2026) : jour de creation de la picking list d'un RDV du jour `rdvDate`. Veille
 * calendaire : le jour d'avant. Veille ouvree : le dernier jour OUVERT de l'atelier avant le RDV
 * (`isOpen` = horaires des compagnons, feries belges, fermetures : workshop_day_is_open), 31 jours
 * au plus ; aucun jour ouvert : la veille calendaire. Miroir : workshop_picking_eve_date.
 * Exemple : RDV du mardi, atelier ferme dimanche et lundi → samedi.
 */
export function eveDate(rdvDate: string, basis: PickingEveBasis, isOpen: (ymd: string) => boolean): string {
  if (basis === 'calendaire') return addDaysYmd(rdvDate, -1);
  for (let i = 1; i <= 31; i++) {
    const d = addDaysYmd(rdvDate, -i);
    if (isOpen(d)) return d;
  }
  return addDaysYmd(rdvDate, -1);
}

export type SupplierAvailability = 'green' | 'yellow' | 'red' | null;

/** Fin de serie (red) ou remplacee (yellow) : ne part jamais au panier (garde-fou du panier). */
export const isOrderable = (availability: string | null | undefined) => availability !== 'red' && availability !== 'yellow';

export type UpcomingPartState = 'reservee' | 'au_panier' | 'commandee' | 'manquante' | 'hors_stock';

/**
 * Etat d'une piece de RDV : tout reserve ; sinon le manque est-il couvert par un panier ouvert
 * (au_panier) ou commande (commandee) ? Sinon manquante. `outsideStock` = piece du kit qui ne se
 * reserve pas (non stockee, sans article).
 */
export function upcomingPartState(p: { needed: number; reserved: number; qtyOpen: number; qtySent: number; outsideStock?: boolean }): UpcomingPartState {
  if (p.outsideStock) return 'hors_stock';
  const missing = q3(Math.max(p.needed - p.reserved, 0));
  if (missing <= 0) return 'reservee';
  if (p.qtyOpen + p.qtySent >= missing) return p.qtyOpen > 0 ? 'au_panier' : 'commandee';
  return 'manquante';
}

/** « Reserver » : il manque quelque chose et du stock libre existe. */
export const canReserve = (p: { missing: number; freeQty: number }) => p.missing > 0 && p.freeQty > 0;

/**
 * « Commander en urgente » : il manque quelque chose, la piece est commandable, et soit le manque
 * n'est pas couvert, soit une ligne attend encore dans le panier standard ouvert.
 */
export function canOrderUrgent(p: { missing: number; covered: number; hasOpenStandard: boolean; availability?: string | null }): boolean {
  return p.missing > 0 && isOrderable(p.availability) && (p.covered < p.missing || p.hasOpenStandard);
}

/**
 * Ce que fait « commander en urgente » : les lignes du panier standard OUVERT passent en urgente
 * (meme quantite), puis ce qui manque et n'est commande nulle part (panier ouvert ou commande)
 * part en urgente. Un panier deja commande ne bouge pas.
 */
export function urgentPlan(p: {
  needed: number; reserved: number;
  lines: { qty: number; kind: 'standard' | 'urgente' | 'demo'; status: 'ouvert' | 'commande' | 'recu' | 'annule' }[];
  addMissing?: boolean; availability?: string | null;
}): { moved: number; added: number; qtyToOrder: number } {
  const orderable = isOrderable(p.availability);
  const moved = orderable ? q3(p.lines.filter((l) => l.status === 'ouvert' && l.kind === 'standard').reduce((s, l) => s + l.qty, 0)) : 0;
  const covered = q3(p.lines.filter((l) => l.status === 'ouvert' || l.status === 'commande').reduce((s, l) => s + l.qty, 0));
  const missing = q3(Math.max(p.needed - p.reserved, 0));
  const added = (p.addMissing ?? true) && orderable && missing > covered ? q3(missing - covered) : 0;
  return { moved, added, qtyToOrder: q3(covered + added) };
}

export type UpcomingPartRow = {
  appointmentId: string; startsAt: string; appointmentStatus: string; repairOrderId: string | null; orNumber: string | null;
  contactName: string | null; vehicleLabel: string | null; plate: string | null; serviceCode: string | null;
  mechanicName: string | null; pickingId: string | null; pickingStatus: string | null;
  reservationId: string | null; articleId: string | null; reference: string; designation: string; bin: string | null;
  qtyNeeded: number; qtyReserved: number; qtyMissing: number; qtyOnOrder: number; state: UpcomingPartState;
  basketId: string | null; basketLabel: string | null; basketKind: string | null; basketStatus: string | null;
  dcsOrderNumber: string | null; availability: string | null; replacementReference: string | null;
  realQty: number; freeQty: number; canReserve: boolean; canOrderUrgent: boolean;
};

export type UpcomingAppointment = {
  appointmentId: string; startsAt: string; appointmentStatus: string; repairOrderId: string | null; orNumber: string | null;
  contactName: string | null; vehicleLabel: string | null; plate: string | null; serviceCode: string | null;
  mechanicName: string | null; pickingId: string | null; pickingStatus: string | null; parts: UpcomingPartRow[];
};

/** Regroupe les lignes par jour (Bruxelles) puis par RDV, dans l'ordre des heures. */
export function groupUpcoming(rows: UpcomingPartRow[]): { day: string; appointments: UpcomingAppointment[] }[] {
  const byAppt = new Map<string, UpcomingAppointment>();
  for (const r of [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.reference.localeCompare(b.reference))) {
    let a = byAppt.get(r.appointmentId);
    if (!a) {
      a = {
        appointmentId: r.appointmentId, startsAt: r.startsAt, appointmentStatus: r.appointmentStatus, repairOrderId: r.repairOrderId,
        orNumber: r.orNumber, contactName: r.contactName, vehicleLabel: r.vehicleLabel, plate: r.plate, serviceCode: r.serviceCode,
        mechanicName: r.mechanicName, pickingId: r.pickingId, pickingStatus: r.pickingStatus, parts: [],
      };
      byAppt.set(r.appointmentId, a);
    }
    a.parts.push(r);
  }
  const days = new Map<string, UpcomingAppointment[]>();
  for (const a of byAppt.values()) {
    const d = brusselsParts(new Date(a.startsAt)).date;
    days.set(d, [...(days.get(d) ?? []), a]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, appointments]) => ({ day, appointments }));
}

/** Nombre de pieces a traiter par le magasin (manquantes) d'un RDV. */
export const missingCount = (a: UpcomingAppointment) => a.parts.filter((p) => p.state === 'manquante').length;
