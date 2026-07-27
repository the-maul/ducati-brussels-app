/**
 * M10/M3 — Matching « client intéressé ↔ moto qui entre en stock ».
 * Rapproche l'intérêt déclaré d'un contact (modèles précis suivis, ou grandes
 * familles d'usage Route/Sport/Off-road/Piste) avec les véhicules disponibles,
 * pour relancer le client dès qu'une moto qui l'intéresse arrive en stock.
 */
import { supabase } from '@/integrations/supabase/client';
import { listContacts, contactDisplayName, getModelInterests, type Contact } from '@/modules/contacts/api';
import { addCommunication, sendEmailViaOutlook } from '@/modules/crm/api';
import { vehicleLabel, type Vehicle } from '@/modules/vehicles/api';

export type VehicleUsage = 'route' | 'sport' | 'offroad' | 'piste';

/**
 * Heuristique v1 : les usages Route/Sport/Off-road/Piste ne sont pas encore une
 * colonne sur `vehicles`. On les déduit du modèle (familles Ducati connues), avec
 * un repli sur segment_type/category en texte libre. À remplacer si une vraie
 * colonne d'usages est ajoutée côté fiche moto.
 */
const MODEL_USAGE_RULES: { pattern: RegExp; usages: VehicleUsage[] }[] = [
  // Superbikes / hypernaked de piste
  { pattern: /panigale|streetfighter|superleggera|supersport/i, usages: ['sport', 'piste'] },
  // Supermotard : usage sportif et piste
  { pattern: /hypermotard/i, usages: ['sport', 'piste'] },
  // Trail / adventure / scrambler : route + off-road léger
  { pattern: /multistrada|desert.?x|scrambler/i, usages: ['route', 'offroad'] },
  // Roadster / cruiser : usage route
  { pattern: /monster|x?diavel/i, usages: ['route'] },
  // Motocross pur (Desmo MX) : off-road et piste (terrain), pas la route
  { pattern: /desmo.?(mx|450|250)|off-road/i, usages: ['offroad', 'piste'] },
];

const TEXT_USAGE_RULES: { pattern: RegExp; usages: VehicleUsage[] }[] = [
  { pattern: /trail|adventure/i, usages: ['route', 'offroad'] },
  { pattern: /sport|racing|superbike|hyper/i, usages: ['sport', 'piste'] },
  { pattern: /naked|roadster|custom|cruiser|tourisme|touring/i, usages: ['route'] },
  { pattern: /motocross|off-road|tout.terrain|enduro/i, usages: ['offroad', 'piste'] },
  { pattern: /piste|track|circuit/i, usages: ['piste'] },
];

/** Usages Route/Sport/Off-road/Piste déduits du véhicule (v1, voir heuristique ci-dessus). */
export function vehicleUsages(vehicle: Pick<Vehicle, 'model' | 'segment_type' | 'category'>): VehicleUsage[] {
  const usages = new Set<VehicleUsage>();
  const model = vehicle.model ?? '';
  for (const rule of MODEL_USAGE_RULES) {
    if (rule.pattern.test(model)) rule.usages.forEach((u) => usages.add(u));
  }
  if (usages.size === 0) {
    const text = [vehicle.segment_type, vehicle.category].filter(Boolean).join(' ');
    for (const rule of TEXT_USAGE_RULES) {
      if (rule.pattern.test(text)) rule.usages.forEach((u) => usages.add(u));
    }
  }
  return [...usages];
}

export type MatchReason = 'model' | 'usage';
export type InterestedContact = { contact: Contact; reason: MatchReason; score: number };

const MAX_RESULTS = 200;

function modelMatches(interestModel: string, vehicleModel: string): boolean {
  const a = interestModel.trim().toLowerCase();
  const b = vehicleModel.trim().toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Contacts actifs intéressés par ce véhicule : match fort sur un modèle précis
 * suivi (`model_interests`), ou match d'usage (interests Route/Sport/Off-road/Piste
 * ∩ usages déduits du véhicule). Triés par pertinence (modèle avant usage).
 */
export async function findInterestedContacts(companyId: string, vehicle: Vehicle): Promise<InterestedContact[]> {
  const contacts = await listContacts(companyId);
  const usages = vehicleUsages(vehicle);
  const vehicleModel = vehicle.model ?? '';
  const results: InterestedContact[] = [];

  for (const contact of contacts) {
    if (!contact.is_active) continue;
    const modelInterests = getModelInterests(contact);
    if (vehicleModel && modelInterests.some((m) => modelMatches(m, vehicleModel))) {
      results.push({ contact, reason: 'model', score: 2 });
      continue;
    }
    const interests = contact.interests ?? [];
    if (usages.length > 0 && interests.some((i) => usages.includes(i as VehicleUsage))) {
      results.push({ contact, reason: 'usage', score: 1 });
    }
  }

  results.sort((a, b) => b.score - a.score || contactDisplayName(a.contact).localeCompare(contactDisplayName(b.contact)));
  return results.slice(0, MAX_RESULTS);
}

export type NotifyChannel = 'email' | 'sms';

/**
 * Notifie un client intéressé : enfile un envoi (email/SMS, via la file
 * `notifications` / Edge Function d'envoi déjà en place, cf. M10) et historise
 * la communication sur sa fiche CRM.
 */
export async function notifyInterestedContact(p: {
  companyId: string;
  contact: Contact;
  vehicle: Vehicle;
  channel: NotifyChannel;
}): Promise<void> {
  const { companyId, contact, vehicle, channel } = p;
  const toAddress = channel === 'email' ? contact.email : contact.mobile;
  if (!toAddress) throw new Error('Coordonnée manquante pour ce canal.');

  const label = vehicleLabel(vehicle);
  const subject = `Ducati Bruxelles — ${label} disponible`;
  const body = `Bonjour ${contactDisplayName(contact)},\n\nLa moto ${label} qui vous intéresse vient d'entrer en stock chez Ducati Bruxelles. Contactez-nous pour en savoir plus ou planifier un essai.\n\nDucati Bruxelles`;

  if (channel === 'email') {
    const { error } = await sendEmailViaOutlook({
      companyId, contactId: contact.id, to: toAddress,
      subject, body: body.replace(/\n/g, '<br>'),
    });
    if (error) throw new Error(error);
  } else {
    const { error } = await supabase.rpc('enqueue_notification', {
      _company: companyId,
      _channel: channel,
      _to: toAddress,
      _subject: subject,
      _body: body,
      _template: 'crm_match',
      _entity_type: 'vehicle',
      _entity_id: vehicle.id,
    });
    if (error) throw error;
  }

  await addCommunication({
    companyId,
    contactId: contact.id,
    channel,
    direction: 'out',
    subject,
    body,
  });
}
