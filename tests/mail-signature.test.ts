/**
 * Tests M10 — signature des e-mails selon l'adresse d'envoi (retour client du 21/09).
 * Fonctions pures de supabase/functions/_shared/mail-message.ts : aucun envoi.
 * Données fictives uniquement (les vraies coordonnées sont en base).
 */
import { test, expect } from 'bun:test';
import {
  signatureHtml, signatureFor, signaturePhone, buildGraphMessage, footerHtml, MAIL_STYLE,
  contactFromCompany, contactHtml,
} from '../supabase/functions/_shared/mail-message.ts';

const company = {
  name: 'SOCIETE TEST', address: 'Rue de l’Essai 1', zip: '1000', city: 'Bruxelles',
  mail_signature_brand: 'Concession Test', mail_signature_address: 'Chaussée de l’Essai 12 – 1400 Nivelles',
  mail_signature_phone: '+3223853282', mail_signature_site_url: 'https://site.example.be',
  mail_signature_site_label: 'Concession Test - Store officiel',
};

test('téléphone de la signature à la belge : +32 (0) …', () => {
  expect(signaturePhone('+3223853282')).toBe('+32 (0) 2 385 32 82');
  expect(signaturePhone('+32470123456')).toBe('+32 (0) 470 12 34 56');
  expect(signaturePhone('+3267123456')).toBe('+32 (0) 67 12 34 56');
  expect(signaturePhone('+33612345678')).toBe('+33 6 12 34 56 78');
  expect(signaturePhone('02 385 32 82')).toBe('02 385 32 82'); // texte hérité : tel quel
  expect(signaturePhone('')).toBe('');
});

test('adresse personnelle : nom en gras, fonction en gris italique, concession en rouge gras', () => {
  const html = signatureHtml(signatureFor({
    from: 'Vendeur@Example.be', shared: false,
    user: { full_name: 'Prénom Nom', job_title: 'Sales Manager' }, company,
  }));
  expect(html).toContain('font-weight:bold;font-size:14px');
  expect(html).toContain('>Prénom Nom</p>');
  expect(html).toContain(`font-style:italic;font-size:12px;color:${MAIL_STYLE.subtle}">Sales Manager</p>`);
  expect(html).toContain(`color:${MAIL_STYLE.brand};text-decoration:none">CONCESSION TEST</a>`);
  expect(html).toContain('Chaussée de l’Essai 12 – 1400 Nivelles');
  expect(html).toContain('T :&nbsp;<a href="tel:+3223853282"');
  expect(html).toContain('+32 (0) 2 385 32 82');
  expect(html).toContain('E :&nbsp;<a href="mailto:vendeur@example.be"');
  expect(html).toContain('<a href="https://site.example.be" style="color:' + MAIL_STYLE.brand + ';text-decoration:underline">Concession Test - Store officiel</a>');
  // Ordre des lignes du modèle client.
  const order = ['Prénom Nom', 'Sales Manager', 'CONCESSION TEST', 'Chaussée', 'T :', 'E :', 'Store officiel'].map((x) => html.indexOf(x));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test('boîte partagée : nom de la boîte, sans personne ni fonction', () => {
  const html = signatureHtml(signatureFor({
    from: 'shop@example.be', shared: true, mailboxName: 'Service commercial',
    user: { full_name: 'Ne doit pas apparaître', job_title: 'Non plus' }, company,
  }));
  expect(html).toContain('>Service commercial</p>');
  expect(html).not.toContain('Ne doit pas apparaître');
  expect(html).not.toContain('Non plus');
  expect(html).toContain('mailto:shop@example.be');
});

test('boîte partagée sans nom : la signature commence par la concession', () => {
  const html = signatureHtml(signatureFor({ from: 'info@example.be', shared: true, mailboxName: null, company }));
  expect(html.indexOf('CONCESSION TEST')).toBeLessThan(html.indexOf('mailto:'));
  expect(html).not.toContain('margin-top:12px'); // pas de blanc au-dessus : rien avant
});

test('réglages absents (migration pas encore appliquée) : nom et adresse de la fiche société', () => {
  const s = signatureFor({ from: 'a@example.be', shared: false, user: { full_name: 'A B' }, company: { name: 'SOCIETE TEST', address: 'Rue X 2', zip: '1000', city: 'Bruxelles' } });
  expect(s.brand).toBe('SOCIETE TEST');
  expect(s.address).toBe('Rue X 2 – 1000 Bruxelles');
  const html = signatureHtml(s);
  expect(html).not.toContain('T :');
  expect(html).not.toContain('text-decoration:underline');
});

test('rien à signer → aucune signature', () => {
  expect(signatureHtml({ email: 'a@example.be' })).toBe('');
  expect(signatureHtml(signatureFor({ from: 'a@example.be', shared: true, company: null }))).toBe('');
});

test('échappement : pas d’injection HTML, lien non http refusé', () => {
  const html = signatureHtml({
    name: '<script>x</script>', title: 'A "B"', brand: 'X & Y', siteUrl: 'javascript:alert(1)', siteLabel: 'lien',
    email: 'a"b@example.be',
  });
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('A &quot;B&quot;');
  expect(html).toContain('X &amp; Y');
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('mailto:'); // adresse invalide : ligne E : omise
});

test('message Graph : signature entre le texte et le pied de mail', () => {
  const signature = signatureHtml(signatureFor({ from: 'v@example.be', shared: false, user: { full_name: 'Prénom Nom' }, company }));
  const footer = footerHtml('join', 'https://app.example.be', 'client@exemple.be');
  const msg = buildGraphMessage({ subject: 's', bodyHtml: '<p>Bonjour</p>', signature, footer, to: 'client@exemple.be', attachments: [] });
  const c = msg.message.body.content;
  expect(c).toContain('<p>Bonjour</p>');
  expect(c.indexOf('<p>Bonjour</p>')).toBeLessThan(c.indexOf('Mon espace Ducati Bruxelles'));
  expect(c.indexOf('Prénom Nom')).toBeGreaterThan(0);
  expect(c.indexOf('Prénom Nom')).toBeLessThan(c.indexOf('Mon espace Ducati Bruxelles'));
});

// --------------------------------------------- Pied de mail completé (retour client 21/09)

test('pied de mail : factures, atelier, demandes commerciales', () => {
  for (const kind of ['join', 'login'] as const) {
    const html = footerHtml(kind, 'https://app.example.be', 'client@exemple.be');
    expect(html).toContain('factures');
    expect(html).toContain('atelier');
    expect(html).toContain('demande commerciale');
  }
});

test('coordonnées du magasin : lues sur la fiche société, jamais en dur', () => {
  const contact = contactFromCompany(company);
  expect(contact).not.toBeNull();
  const html = footerHtml('join', 'https://app.example.be', 'client@exemple.be', contact);
  expect(html).toContain('Chaussée de l’Essai 12 – 1400 Nivelles');
  expect(html).toContain('+32 (0) 2 385 32 82');          // téléphone remis en forme
  expect(html).toContain('https://site.example.be');
  expect(html).toContain('Concession Test - Store officiel');
  // Sans coordonnées : pied de mail inchangé pour les appelants existants.
  expect(footerHtml('join', 'https://app.example.be', 'client@exemple.be')).not.toContain('Nivelles');
});

test('coordonnées : repli sur adresse + code postal + ville, et rien si la base est vide', () => {
  expect(contactFromCompany({ address: 'Rue A 1', zip: '1000', city: 'Bruxelles' })?.address)
    .toBe('Rue A 1 – 1000 Bruxelles');
  expect(contactFromCompany({ name: 'X' })).toBeNull();
  expect(contactFromCompany(null)).toBeNull();
  expect(contactHtml(null)).toBe('');
});

test('coordonnées : pas d’injection HTML ni de lien non http', () => {
  const html = contactHtml({
    address: '<script>x</script> "A" & B', phone: '+3223853282',
    siteUrl: 'javascript:alert(1)', siteLabel: '<b>lien</b>',
  });
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('javascript:');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&amp;');
});

test('coordonnées écrites une seule fois : signature OU pied de mail, jamais les deux', () => {
  // Règle appliquée par graph-send-email : contact passé au pied de mail seulement sans signature.
  const signature = signatureHtml(signatureFor({ from: 'info@exemple.be', shared: true, mailboxName: 'Boîte', company }));
  const contact = contactFromCompany(company);
  const avecSignature = footerHtml('join', 'https://app.example.be', 'c@exemple.be', signature ? null : contact);
  const sansSignature = footerHtml('join', 'https://app.example.be', 'c@exemple.be', contact);
  expect(signature).not.toBe('');
  expect(avecSignature).not.toContain('Nivelles');
  expect(sansSignature).toContain('Nivelles');
  // Dans les deux cas, le texte complété est bien là.
  for (const html of [avecSignature, sansSignature]) expect(html).toContain('factures');
});
