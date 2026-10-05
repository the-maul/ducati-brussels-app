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
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
  text: '#202124',
  muted: '#5f6368',
  subtle: '#80868b',
  rule: '#d9d9d9',
  brand: '#c8102e',
  link: '#1d5fa8',
  /** Fond du bloc d'invitation (gris très clair, lisible partout). */
  panel: '#f7f7f8',
} as const;

// Style du pied de mail (invitation à l'application).
const FOOTER_STYLE = `margin-top:24px;padding-top:12px;border-top:1px solid ${MAIL_STYLE.rule};font-size:13px;line-height:18px;color:${MAIL_STYLE.muted}`;

/**
 * Coordonnées du magasin affichées sous l'invitation. Elles viennent TOUJOURS de la base
 * (colonnes `mail_signature_*` de `companies`, voir `contactFromCompany`) : aucune adresse
 * ni téléphone en dur ici, pour qu'une seule correction en base suffise (retour client 21/09).
 */
export type MailContact = {
  address?: string | null;
  /** Téléphone E.164 (+3223853282) ou texte libre. */
  phone?: string | null;
  siteUrl?: string | null;
  siteLabel?: string | null;
};

/**
 * Pied de mail P-5 / P-6, sous le message. Textes validés par le client (18/09, 19/09),
 * complétés le 21/09 (retour client) : l'espace client donne accès aux factures, au suivi
 * des interventions à l'atelier et au contact direct avec l'équipe pour toute demande
 * commerciale. Les coordonnées du magasin (`contact`) sont lues en base, jamais écrites ici.
 */
export function footerHtml(kind: 'join' | 'login', origin: string, to: string, contact?: MailContact | null): string {
  const join = kind === 'join';
  const link = join ? `${origin}/inscription?email=${encodeURIComponent(to)}` : `${origin}/login`;
  // Texte validé par Simon (05/10) : court, orienté bénéfice, puis l'appel à l'action.
  const text = join
    ? 'Retrouvez tous vos documents et le suivi de votre moto grâce à l’application Ducati Bruxelles.'
    : 'Votre espace Ducati Bruxelles est prêt : tous vos documents et le suivi de votre moto, au même endroit.';
  // Reprend les mots demandés par le client le 21/09 (factures, atelier, demande commerciale).
  const perks = 'Vos factures, le suivi de vos interventions à l’atelier, les photos de votre moto, et notre équipe joignable pour toute demande commerciale.';
  const nudge = join ? 'Pas encore de compte ? Créez-le gratuitement :' : 'Votre compte vous attend :';
  // Même libellé dans les deux cas (Simon, 05/10) : le bouton mène au compte,
  // vers l'inscription si la personne n'en a pas encore, vers la connexion sinon.
  const label = 'Mon espace Ducati Bruxelles';
  // Bloc encadré avec un vrai bouton : tableau + styles en ligne, seule mise en page
  // que tous les logiciels de messagerie rendent correctement (Outlook compris).
  return `
<div style="${FOOTER_STYLE}">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:4px 0 0 0">
    <tr>
      <td style="background:${MAIL_STYLE.panel};border:1px solid ${MAIL_STYLE.rule};border-left:4px solid ${MAIL_STYLE.brand};border-radius:6px;padding:16px 18px">
        <p style="margin:0 0 4px 0;font-size:15px;line-height:21px;color:${MAIL_STYLE.text};font-weight:bold">${esc(text)}</p>
        <p style="margin:0 0 12px 0;font-size:13px;line-height:19px;color:${MAIL_STYLE.muted}">${esc(perks)}</p>
        <p style="margin:0 0 10px 0;font-size:13px;line-height:19px;color:${MAIL_STYLE.text}">${esc(nudge)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
          <tr>
            <td style="background:${MAIL_STYLE.brand};border-radius:6px">
              <a href="${esc(link)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">${label}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>${contactHtml(contact)}
</div>`;
}

/** Ligne « adresse · T : téléphone · site » du pied de mail ; '' si la base ne dit rien. */
export function contactHtml(c: MailContact | null | undefined): string {
  if (!c) return '';
  const address = oneLine(c.address);
  const phone = signaturePhone(oneLine(c.phone));
  const url = safeUrl(c.siteUrl);
  const label = oneLine(c.siteLabel) || url.replace(/^https?:\/\//i, '');
  const parts: string[] = [];
  if (address) parts.push(esc(address));
  if (phone) parts.push(`T :&nbsp;${esc(phone)}`);
  if (url) parts.push(`<a href="${esc(url)}" style="color:${MAIL_STYLE.brand}">${esc(label)}</a>`);
  if (parts.length === 0) return '';
  return `
  <p style="margin:8px 0 0 0;color:${MAIL_STYLE.subtle}">${parts.join(' &middot; ')}</p>`;
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
  // Gmail transforme tout seul une adresse, un téléphone ou un nom de ville en lien bleu
  // souligné quand le texte n'est PAS déjà un lien (vu le 05/10). On pose donc nous-mêmes
  // le lien, avec notre couleur et sans soulignement : Gmail n'y touche plus.
  const noAuto = (html: string, href: string, color: string) =>
    `<a href="${esc(href)}" style="color:${color};text-decoration:none">${html}</a>`;
  if (brand) {
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([brand, address].filter(Boolean).join(' '))}`;
    block(noAuto(esc(brand.toUpperCase()), maps, S.brand), 'font-weight:bold');
  }
  if (address) {
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    block(noAuto(esc(address), maps, S.text));
  }
  const telHref = (oneLine(p.phone) || phone).replace(/\(0\)/g, '').replace(/[^+0-9]/g, '');
  if (phone) block(`T :&nbsp;${noAuto(esc(phone), `tel:${telHref}`, S.text)}`);
  if (mail) block(`E :&nbsp;<a href="mailto:${esc(mail)}" style="color:${S.text};text-decoration:none">${esc(mail)}</a>`);
  if (url) block(`<a href="${esc(url)}" style="color:${S.brand};text-decoration:underline">${esc(label)}</a>`);

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

/**
 * Coordonnées du magasin pour le pied de mail, lues sur la fiche société :
 * `mail_signature_address` (sinon adresse, code postal et ville de la fiche),
 * `mail_signature_phone`, `mail_signature_site_url` / `_site_label`.
 * Compléter ces colonnes suffit : rien à redéployer.
 */
export function contactFromCompany(c: SignatureCompany | null | undefined): MailContact | null {
  if (!c) return null;
  const cityLine = [c.zip, c.city].map((x) => oneLine(x)).filter(Boolean).join(' ');
  const fallbackAddress = [oneLine(c.address), cityLine].filter(Boolean).join(' – ');
  const contact: MailContact = {
    address: oneLine(c.mail_signature_address) || fallbackAddress || null,
    phone: c.mail_signature_phone ?? null,
    siteUrl: c.mail_signature_site_url ?? null,
    siteLabel: c.mail_signature_site_label ?? null,
  };
  return contactHtml(contact) ? contact : null;
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
      body: {
        contentType: 'HTML',
        // Enveloppe de mise en forme : police, taille et couleur du texte pour tout le message.
        content: `<div style="font-family:${MAIL_STYLE.font};font-size:15px;line-height:22px;color:${MAIL_STYLE.text}">`
          + String(p.bodyHtml || '') + (p.signature ?? '') + p.footer + '</div>',
      },
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
