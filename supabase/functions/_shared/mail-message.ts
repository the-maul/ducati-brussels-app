// M10 — Construction du message Microsoft Graph envoyé par `graph-send-email` (pur, testé :
// tests/graph-send-email-message.test.ts, tests/mail-signature.test.ts). Aucun accès réseau ici :
// la fonction serveur décide de la signature, du pied de mail et de la boîte, ce module
// assemble le message et le résumé de trace.
//
// GABARIT DES E-MAILS : c'est le SEUL endroit des couleurs et polices du HTML envoyé
// (MAIL_STYLE). Un e-mail est lu hors de l'application (Outlook, Gmail…) : il ne peut pas
// utiliser les variables CSS de src/styles/tokens.css, les valeurs sont donc recopiées ici
// depuis la charte (même esprit qu'un document imprimé).

export type InAttachment = { name?: unknown; contentType?: unknown; contentBytes?: unknown };
export type GraphAttachment = {
  '@odata.type': '#microsoft.graph.fileAttachment';
  name: string;
  contentType: string;
  contentBytes: string;
};

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Couleurs et police du HTML des e-mails (charte : --ducati-red #C8102E, --info #1D5FA8). */
export const MAIL_STYLE = {
  font: 'Arial,Helvetica,sans-serif',
  text: '#1a1a1a',
  muted: '#5c5c5c',
  subtle: '#8c8c8c',
  rule: '#d9d9d9',
  brand: '#c8102e',
  link: '#1d5fa8',
} as const;

// Style du pied de mail (invitation à l'application).
const FOOTER_STYLE = `margin-top:24px;padding-top:12px;border-top:1px solid ${MAIL_STYLE.rule};font-size:13px;line-height:18px;color:${MAIL_STYLE.muted}`;

/** Pied de mail P-5 / P-6, sous le message. Textes validés par le client (18/09, 19/09). */
export function footerHtml(kind: 'join' | 'login', origin: string, to: string): string {
  const join = kind === 'join';
  const link = join ? `${origin}/inscription?email=${encodeURIComponent(to)}` : `${origin}/login`;
  const text = join
    ? 'Retrouvez facilement la vie de votre moto (photos, entretiens, pièces, documents) et bénéficiez de bonus de fidélité en rejoignant notre communauté de clients sur l’application Ducati Bruxelles.'
    : 'Votre espace Ducati Bruxelles est prêt : retrouvez la vie de votre moto (photos, entretiens, pièces, documents) et vos bonus de fidélité.';
  const label = join ? 'Créer mon compte' : 'Me connecter';
  return `
<div style="${FOOTER_STYLE}">
  <p style="margin:0 0 6px 0">${esc(text)}</p>
  <p style="margin:0"><a href="${esc(link)}" style="color:${MAIL_STYLE.brand}">${label}</a></p>
</div>`;
}

// ------------------------------------------------------------------ Signature (21/09)

/** Tout ce qu'il faut pour la signature ; champs vides = ligne omise. */
export type SignatureInput = {
  /** Adresse personnelle : nom de l'utilisateur. Boîte partagée : nom de la boîte (ou vide). */
  name?: string | null;
  /** Fonction de l'utilisateur (adresse personnelle seulement). */
  title?: string | null;
  /** Nom de la concession (rouge gras). */
  brand?: string | null;
  address?: string | null;
  /** Téléphone E.164 (+3223853282) ou texte libre (hérité). */
  phone?: string | null;
  /** Adresse d'envoi : ligne « E : » en lien mailto. */
  email?: string | null;
  siteUrl?: string | null;
  siteLabel?: string | null;
};

/**
 * Téléphone de la signature, à la belge : « +32 (0) 2 385 32 82 », « +32 (0) 470 12 34 56 ».
 * Autre pays : « +33 6 12 34 56 78 » (groupes de 2). Texte non E.164 : rendu tel quel.
 */
export function signaturePhone(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return s;
  const pairs = (d: string) => d.replace(/(\d{2})(?=\d)/g, '$1 ');
  if (s.startsWith('+32')) {
    const d = s.slice(3);
    if (/^4\d{8}$/.test(d)) return `+32 (0) ${d.slice(0, 3)} ${pairs(d.slice(3))}`;
    if (d.length === 8 && /^[2349]/.test(d)) return `+32 (0) ${d[0]} ${d.slice(1, 4)} ${pairs(d.slice(4))}`;
    if (d.length === 8) return `+32 (0) ${d.slice(0, 2)} ${pairs(d.slice(2))}`;
    return `+32 ${d}`;
  }
  if (s.startsWith('+33') && s.length === 12) return `+33 ${s[3]} ${pairs(s.slice(4))}`;
  // Indicatif de 1 à 3 chiffres inconnu ici : on sépare seulement le « + » et le reste par groupes de 3.
  return `+${s.slice(1).replace(/(\d{3})(?=\d)/g, '$1 ')}`;
}

/** Lien http(s) sûr pour un attribut href, sinon ''. */
const safeUrl = (u: string | null | undefined) => {
  const s = String(u ?? '').trim();
  return /^https?:\/\/[^\s"<>]+$/i.test(s) ? s : '';
};
const oneLine = (v: string | null | undefined) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * HTML de la signature (modèles du client, 21/09) :
 *   Nom (gras) / Fonction (gris italique) / NOM DE LA CONCESSION (rouge gras) / adresse /
 *   T : téléphone / E : adresse d'envoi (mailto) / lien souligné vers le site.
 * Rien d'utile (ni nom, ni concession, ni coordonnées) → ''.
 */
export function signatureHtml(p: SignatureInput): string {
  const name = oneLine(p.name);
  const title = oneLine(p.title);
  const brand = oneLine(p.brand);
  const address = oneLine(p.address);
  const phone = signaturePhone(oneLine(p.phone));
  const email = oneLine(p.email).toLowerCase();
  const mail = /^[^\s@"<>]+@[^\s@"<>]+$/.test(email) ? email : '';
  const url = safeUrl(p.siteUrl);
  const label = oneLine(p.siteLabel) || url;
  if (!name && !brand && !address && !phone && !url) return '';

  const S = MAIL_STYLE;
  const rows: string[] = [];
  const line = (html: string, style = '') =>
    rows.push(`  <p style="${['margin:0', style].filter(Boolean).join(';')}">${html}</p>`);
  // Un blanc entre la personne (ou la boîte) et le bloc de la concession, comme sur les modèles.
  let gap = '';
  if (name) {
    line(esc(name), `font-weight:bold;font-size:14px;color:${S.text}`);
    if (title) line(esc(title), `font-style:italic;font-size:12px;color:${S.subtle}`);
    gap = 'margin-top:12px';
  }
  const block = (html: string, style = '') => { line(html, [gap, style].filter(Boolean).join(';')); gap = ''; };
  if (brand) block(esc(brand.toUpperCase()), `font-weight:bold;color:${S.brand}`);
  if (address) block(esc(address));
  if (phone) block(`T :&nbsp;${esc(phone)}`);
  if (mail) block(`E :&nbsp;<a href="mailto:${esc(mail)}" style="color:${S.link}">${esc(mail)}</a>`);
  if (url) block(`<a href="${esc(url)}" style="color:${S.link};text-decoration:underline">${esc(label)}</a>`);

  return `
<div style="margin-top:24px;font-family:${S.font};font-size:13px;line-height:18px;color:${S.text}">
${rows.join('\n')}
</div>`;
}

/** Réglages lus en base pour la signature (colonnes de companies, profiles, company_mailboxes). */
export type SignatureCompany = {
  name?: string | null; address?: string | null; zip?: string | null; city?: string | null;
  mail_signature_brand?: string | null; mail_signature_address?: string | null; mail_signature_phone?: string | null;
  mail_signature_site_url?: string | null; mail_signature_site_label?: string | null;
};

/**
 * Qui signe, selon l'adresse d'envoi (21/09) :
 *   - adresse PERSONNELLE → nom et fonction de l'utilisateur ;
 *   - BOÎTE PARTAGÉE → nom de la boîte (réglé par société), sans personne.
 * Puis les coordonnées de la société : nom de la concession (sinon nom de la société),
 * adresse (sinon adresse, code postal et ville de la fiche société), téléphone, site.
 */
export function signatureFor(p: {
  from: string;
  shared: boolean;
  user?: { full_name?: string | null; job_title?: string | null } | null;
  mailboxName?: string | null;
  company?: SignatureCompany | null;
}): SignatureInput {
  const c = p.company ?? {};
  const cityLine = [c.zip, c.city].map((x) => oneLine(x)).filter(Boolean).join(' ');
  const fallbackAddress = [oneLine(c.address), cityLine].filter(Boolean).join(' – ');
  return {
    name: p.shared ? p.mailboxName ?? null : p.user?.full_name ?? null,
    title: p.shared ? null : p.user?.job_title ?? null,
    brand: oneLine(c.mail_signature_brand) || oneLine(c.name) || null,
    address: oneLine(c.mail_signature_address) || fallbackAddress || null,
    phone: c.mail_signature_phone ?? null,
    email: p.from,
    siteUrl: c.mail_signature_site_url ?? null,
    siteLabel: c.mail_signature_site_label ?? null,
  };
}

/** Pièces jointes au format Graph ; entrées sans nom ou sans contenu ignorées. */
export function toGraphAttachments(attachments: unknown): GraphAttachment[] {
  if (!Array.isArray(attachments)) return [];
  return (attachments as InAttachment[])
    .filter((a) => a && typeof a.name === 'string' && a.name && typeof a.contentBytes === 'string' && a.contentBytes)
    .map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: String(a.name),
      contentType: typeof a.contentType === 'string' && a.contentType ? a.contentType : 'application/octet-stream',
      contentBytes: String(a.contentBytes),
    }));
}

/** Taille décodée (octets) d'un contenu base64. */
export function base64Size(b64: string): number {
  const clean = b64.replace(/\s/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
}

/**
 * Corps de la requête Graph /sendMail : message, puis signature (21/09), puis pied de mail
 * (invitation à l'application).
 */
export function buildGraphMessage(p: { subject: string; bodyHtml: string; signature?: string; footer: string; to: string; attachments: GraphAttachment[] }) {
  return {
    message: {
      subject: p.subject,
      body: { contentType: 'HTML', content: String(p.bodyHtml || '') + (p.signature ?? '') + p.footer },
      toRecipients: [{ emailAddress: { address: p.to } }],
      ...(p.attachments.length ? { attachments: p.attachments } : {}),
    },
    saveToSentItems: true,
  };
}

/** Résumé sans le contenu des fichiers (réponse du mode simulation, trace `events`). */
export function attachmentsSummary(atts: GraphAttachment[]): { name: string; contentType: string; size: number }[] {
  return atts.map((a) => ({ name: a.name, contentType: a.contentType, size: base64Size(a.contentBytes) }));
}
