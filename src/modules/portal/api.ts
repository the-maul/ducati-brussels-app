/**
 * Portail client (/mon-espace) — accès aux données du client connecté.
 *
 * SÉCURITÉ : un client n'a aucun rôle, la RLS lui ferme toutes les tables. Tout
 * passe par les fonctions SQL portal_* (SECURITY DEFINER) qui retrouvent SA fiche
 * via contact_accounts.user_id = auth.uid(). Les identifiants envoyés ici (moto,
 * facture, rendez-vous) ne servent qu'à désigner : la base vérifie qu'ils lui
 * appartiennent. Migration : supabase/migrations/20260919120000_m0_portail_client.sql.
 *
 * Fichiers (bucket privé « ged ») : URL signée de 5 minutes demandée avec le jeton
 * du client ; la politique Storage ged_portal_select (prédicat portal_can_read_object)
 * n'accepte que ses propres dépôts et le PDF d'origine de ses factures.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { t } from '@/lib/i18n';
import { prepareFileForUpload } from './image';

const BUCKET = 'ged';
const SIGNED_URL_SECONDS = 300;

// ---------------------------------------------------------------- types
export type PortalWhoami = {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  is_pro: boolean;
  dealer: string | null;
  avatar_path: string | null;
};

export type StepKey =
  | 'coordonnees' | 'avatar' | 'preferences' | 'permis' | 'societe'
  | 'vehicle_photo' | 'carte_grise' | 'assurance';

export type CompletionStep = {
  key: StepKey;
  done: boolean;
  vehicle_id?: string;
  vehicle_label?: string | null;
};

export type PortalAppointment = {
  id: string;
  starts_at: string;
  status: string;
  work_description: string | null;
  requested_slot?: string | null;
  source?: string | null;
  vehicle_id?: string | null;
  vehicle_label: string | null;
};

export type PortalHome = {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  steps: CompletionStep[];
  steps_done: number;
  steps_total: number;
  progress: number;
  vehicles_count: number;
  invoices_count: number;
  pending_requests: number;
  next_appointment: PortalAppointment | null;
};

export type PortalProfile = {
  civility: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  address: string | null;
  street_number: string | null;
  address_complement: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  birth_date: string | null;
  is_pro: boolean;
  company_name: string | null;
  vat_number: string | null;
  vies_valid: boolean | null;
  contact_preference: ContactPreference | null;
  marketing_opt_out: boolean;
  license_number: string | null;
  dealer: string | null;
  avatar_path: string | null;
  license_path: string | null;
};

export type ContactPreference = 'email' | 'telephone' | 'sms' | 'whatsapp';
export const CONTACT_PREFERENCES: ContactPreference[] = ['email', 'telephone', 'sms', 'whatsapp'];

/** Champs modifiables (même liste blanche que portal_update_profile). */
export type ProfilePatch = Partial<Pick<PortalProfile,
  'civility' | 'first_name' | 'last_name' | 'mobile' | 'phone' | 'address' | 'street_number'
  | 'address_complement' | 'zip' | 'city' | 'country' | 'birth_date' | 'company_name'
  | 'vat_number' | 'contact_preference' | 'marketing_opt_out' | 'license_number'>>;

export type PortalVehicleSummary = {
  id: string;
  brand: string | null;
  model: string | null;
  vin: string | null;
  plate: string | null;
  model_year: number | null;
  color: string | null;
  mileage: number | null;
  photo_path: string | null;
  has_registration: boolean;
  has_insurance: boolean;
};

export type PortalRepair = {
  id: string;
  number: string | null;
  date: string;
  status: string;
  work_description: string | null;
  mileage: number | null;
  invoice_document_id: string | null;
};

export type PortalMaintenance = {
  kind: string | null;
  service_type: string | null;
  state: string | null;
  km: number | null;
  event_date: string | null;
  due_date: string | null;
  dealer: string | null;
};

export type PortalFile = {
  id: string;
  kind: UploadKind;
  file_name: string;
  content_type: string;
  path: string;
  created_at: string;
};

export type PortalVehicleDetail = Omit<PortalVehicleSummary, 'has_registration' | 'has_insurance'> & {
  displacement: number | null;
  power_kw: number | null;
  power_cv: number | null;
  is_restricted: boolean;
  first_registration_date: string | null;
  next_inspection_date: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  repairs: PortalRepair[];
  maintenance: PortalMaintenance[];
  files: PortalFile[];
  invoices: { id: string; doc_type: string; number: string | null; issue_date: string; total_ttc: number }[];
};

export type PortalInvoiceSummary = {
  id: string;
  doc_type: 'FAC' | 'AVO' | 'TIK' | string;
  number: string | null;
  issue_date: string;
  due_date: string | null;
  status: string;
  total_ttc: number;
  paid_amount: number;
  vehicle_label: string | null;
  imported: boolean;
  pdf_path: string | null;
};

export type PortalInvoiceDetail = PortalInvoiceSummary & {
  total_ht: number;
  total_vat: number;
  tax_exempt: boolean;
  vehicle: { brand: string | null; model: string | null; vin: string | null; plate: string | null } | null;
  company: {
    name: string | null; legal_name: string | null; vat_number: string | null; address: string | null;
    zip: string | null; city: string | null; country: string | null; iban: string | null; bic: string | null;
    invoice_footer: string | null;
  };
  customer: {
    first_name: string | null; last_name: string | null; company_name: string | null; address: string | null;
    street_number: string | null; zip: string | null; city: string | null; country: string | null;
    vat_number: string | null;
  };
  lines: {
    reference: string | null; designation: string | null; quantity: number; unit_price_ht: number;
    vat_rate: number; discount_pct: number | null; line_ht: number; line_ttc: number;
  }[];
  payments: { method: string | null; amount: number; paid_at: string | null; status: string | null }[];
};

export type UploadKind =
  | 'avatar' | 'permis' | 'vehicle_photo' | 'carte_grise' | 'assurance' | 'coc' | 'controle_technique' | 'autre';

/** Documents qu'un client peut déposer sur sa moto (hors photo). */
export const VEHICLE_DOC_KINDS: UploadKind[] = ['carte_grise', 'assurance', 'coc', 'controle_technique', 'autre'];

export type AppointmentSlot = 'matin' | 'apres_midi';

// ---------------------------------------------------------------- erreurs
/** Traduit les erreurs des fonctions portal_ en message lisible par le client. */
export function portalErrorMessage(err: unknown): string {
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err ?? '');
  const map: [string, string][] = [
    ['file too large', 'portal.errors.fileTooLarge'],
    ['file type not allowed', 'portal.errors.fileType'],
    ['a photo is expected', 'portal.errors.photoExpected'],
    ['too many uploads', 'portal.errors.tooManyUploads'],
    ['too many pending requests', 'portal.errors.tooManyRequests'],
    ['invalid date', 'portal.errors.invalidDate'],
    ['invalid slot', 'portal.errors.invalidSlot'],
    ['reason required', 'portal.errors.reasonRequired'],
    ['invalid birth_date', 'portal.errors.invalidBirthDate'],
    ['invalid phone', 'portal.errors.invalidPhone'],
    ['invalid country', 'portal.errors.invalidCountry'],
    ['invalid vat_number', 'portal.errors.invalidVat'],
    ['not found', 'portal.errors.notFound'],
    ['no client account', 'portal.errors.noAccount'],
  ];
  for (const [needle, key] of map) if (msg.includes(needle)) return t(key);
  return t('portal.errors.generic');
}

async function rpc<T>(fn: Parameters<typeof supabase.rpc>[0], args?: Record<string, unknown>): Promise<T> {
  // Le typage généré des arguments est trop strict pour les valeurs nulles facultatives.
  const { data, error } = await (supabase.rpc as unknown as (
    f: string, a?: Record<string, unknown>,
  ) => Promise<{ data: Json; error: { message: string } | null }>)(fn as string, args);
  if (error) throw new Error(portalErrorMessage(error));
  return data as unknown as T;
}

// ---------------------------------------------------------------- lectures
export const getWhoami = () => rpc<PortalWhoami | null>('portal_whoami');
export const getHome = () => rpc<PortalHome>('portal_home');
export const getProfile = () => rpc<PortalProfile>('portal_profile');
export const listVehicles = () => rpc<PortalVehicleSummary[]>('portal_vehicles');
export const getVehicle = (id: string) => rpc<PortalVehicleDetail>('portal_vehicle', { p_vehicle_id: id });
export const listInvoices = () => rpc<PortalInvoiceSummary[]>('portal_invoices');
export const getInvoice = (id: string) => rpc<PortalInvoiceDetail>('portal_invoice', { p_document_id: id });
export const listAppointments = () => rpc<PortalAppointment[]>('portal_appointments');

// ---------------------------------------------------------------- écritures
export const updateProfile = (patch: ProfilePatch) =>
  rpc<PortalProfile>('portal_update_profile', { p: patch });

export const requestAppointment = (p: { vehicleId: string | null; reason: string; date: string; slot: AppointmentSlot }) =>
  rpc<string>('portal_request_appointment', {
    p_vehicle_id: p.vehicleId, p_reason: p.reason, p_date: p.date, p_slot: p.slot,
  });

export const cancelAppointmentRequest = (id: string) =>
  rpc<null>('portal_cancel_appointment_request', { p_appointment_id: id });

/**
 * Retient la visite de l'espace client (contact_accounts.first/last_portal_visit_at).
 * Sert au pied de mail (P-6) : tant que le client n'est jamais venu, ses mails
 * l'invitent à se connecter. Sans effet visible ; une erreur est ignorée.
 * Migration : supabase/migrations/20260919200000_m0_portail_visite.sql.
 */
export const touchPortal = () => rpc<null>('portal_touch').catch(() => null);

/**
 * Dépôt d'un fichier en trois temps :
 *   1. portal_prepare_upload : la base vérifie la moto, le type, la taille et FIXE le chemin ;
 *   2. envoi dans le bucket, autorisé par la politique ged_portal_insert pour ce seul chemin ;
 *   3. portal_complete_upload : la base contrôle le fichier reçu et l'indexe dans la GED.
 */
export async function uploadPortalFile(kind: UploadKind, vehicleId: string | null, original: File): Promise<void> {
  const file = await prepareFileForUpload(original);
  const prepared = await rpc<{ upload_id: string; path: string }>('portal_prepare_upload', {
    p_kind: kind, p_vehicle_id: vehicleId, p_file_name: original.name,
    p_content_type: file.type, p_size: file.size,
  });
  const { error } = await supabase.storage.from(BUCKET).upload(prepared.path, file, {
    contentType: file.type, upsert: false,
  });
  if (error) throw new Error(portalErrorMessage(error));
  await rpc('portal_complete_upload', { p_upload_id: prepared.upload_id });
}

/** URL signée courte (5 min) pour afficher ou ouvrir un fichier du client. */
export async function signedFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(t('portal.errors.fileUnavailable'));
  return data.signedUrl;
}

/**
 * Ouvre un fichier dans un nouvel onglet. L'onglet est ouvert AVANT l'appel réseau
 * (sinon Safari sur iPhone bloque la fenêtre), puis dirigé vers l'URL signée.
 */
export async function openFile(path: string): Promise<void> {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const url = await signedFileUrl(path);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    win?.close();
    throw e;
  }
}
