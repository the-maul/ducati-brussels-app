// M10 — Construction du message Microsoft Graph envoyé par `graph-send-email` (pur, testé :
// tests/graph-send-email-message.test.ts). Aucun accès réseau ici : la fonction serveur décide
// du pied de mail et de la boîte, ce module assemble le message et le résumé de trace.

export type InAttachment = { name?: unknown; contentType?: unknown; contentBytes?: unknown };
export type GraphAttachment = {
  '@odata.type': '#microsoft.graph.fileAttachment';
  name: string;
  contentType: string;
  contentBytes: string;
};

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Style du pied de mail : contenu d'un e-mail (HTML envoyé), hors application → valeurs en dur
// assumées, comme un document imprimé.
const FOOTER_STYLE = 'margin-top:24px;padding-top:12px;border-top:1px solid #d9d9d9;font-size:13px;line-height:18px;color:#5c5c5c';

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
  <p style="margin:0"><a href="${esc(link)}" style="color:#c8102e">${label}</a></p>
</div>`;
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

/** Corps de la requête Graph /sendMail. */
export function buildGraphMessage(p: { subject: string; bodyHtml: string; footer: string; to: string; attachments: GraphAttachment[] }) {
  return {
    message: {
      subject: p.subject,
      body: { contentType: 'HTML', content: String(p.bodyHtml || '') + p.footer },
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
