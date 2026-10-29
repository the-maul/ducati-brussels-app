/**
 * Tests M10 — Relances d'entretien (decision client du 30/10/2026, M-72) :
 *   - date d'envoi : entretien = date due − 15 jours, intervention reportee = date fixee ;
 *   - regle J+5 : envoyee + 5 jours sans reponse ni rendez-vous → a rappeler ;
 *   - un rendez-vous pris → close ;
 *   - variables du modele remplies (et « Bonjour , » evite) ;
 *   - langue du modele = contacts.locale, FR a defaut ;
 *   - les textes serveur des mails (mail-i18n) ont le bouton dans les quatre langues ;
 *   - l'entree de menu « Relances » herite des droits du CRM (vendeur, marketing, admin).
 */
import { describe, expect, test } from 'bun:test';
import {
  sendAtFor, j5State, appointmentAfter, pickTemplateLocale, fillTemplate, unknownVars, followupTab, statusTone, counters,
  LEAD_DAYS, CALLBACK_DAYS, TEMPLATE_VARS, type FollowupLite,
} from '../src/modules/crm/followups-rules';
import { MAIL_LOCALES, mailTexts } from '../supabase/functions/_shared/mail-i18n.ts';
import { accessLevel } from '../src/lib/auth/permissions';
import { mainNav } from '../src/lib/navigation';
import { fr } from '../src/lib/i18n/fr';

const sent = (daysAgo: number, extra: Partial<FollowupLite> = {}): FollowupLite => ({
  status: 'envoyee',
  sent_at: new Date(Date.parse('2026-10-31T09:00:00Z') - daysAgo * 86400_000).toISOString(),
  answered_at: null, vehicle_id: 'v1', contact_id: 'c1', ...extra,
});
const NOW = new Date('2026-10-31T09:00:00Z');

describe('date d envoi', () => {
  test('entretien : 15 jours avant la date due', () => {
    expect(LEAD_DAYS).toBe(15);
    expect(sendAtFor('entretien', '2026-11-20', '2026-10-31')).toBe('2026-11-05');
  });
  test('entretien deja proche : part aujourd hui, jamais dans le passe', () => {
    expect(sendAtFor('entretien', '2026-11-05', '2026-10-31')).toBe('2026-10-31');
  });
  test('intervention reportee : la date fixee au comptoir', () => {
    expect(sendAtFor('intervention_reportee', '2026-12-01', '2026-10-31')).toBe('2026-12-01');
    expect(sendAtFor('intervention_reportee', '2026-10-01', '2026-10-31')).toBe('2026-10-31');
  });
});

describe('regle J+5', () => {
  test('5 jours sans reponse ni rendez-vous → a rappeler', () => {
    expect(CALLBACK_DAYS).toBe(5);
    expect(j5State(sent(5), [], NOW)).toBe('a_rappeler');
    expect(j5State(sent(6), [], NOW)).toBe('a_rappeler');
  });
  test('moins de 5 jours : on attend', () => {
    expect(j5State(sent(4), [], NOW)).toBe('unchanged');
  });
  test('une reponse recue : pas de rappel', () => {
    expect(j5State(sent(6, { answered_at: '2026-10-28T10:00:00Z' }), [], NOW)).toBe('unchanged');
  });
  test('un rendez-vous pris pour la moto apres l envoi → close', () => {
    const rdv = [{ created_at: '2026-10-29T10:00:00Z', status: 'demande', vehicle_id: 'v1', contact_id: 'c1' }];
    expect(appointmentAfter(sent(6), rdv)).toBe(true);
    expect(j5State(sent(6), rdv, NOW)).toBe('close');
    expect(j5State(sent(2), rdv, NOW)).toBe('close');
  });
  test('un rendez-vous pour une autre moto, annule, ou anterieur a l envoi ne compte pas', () => {
    expect(j5State(sent(6), [{ created_at: '2026-10-29T10:00:00Z', status: 'demande', vehicle_id: 'v2', contact_id: 'c1' }], NOW)).toBe('a_rappeler');
    expect(j5State(sent(6), [{ created_at: '2026-10-29T10:00:00Z', status: 'annule', vehicle_id: 'v1', contact_id: 'c1' }], NOW)).toBe('a_rappeler');
    expect(j5State(sent(6), [{ created_at: '2026-10-20T10:00:00Z', status: 'prevu', vehicle_id: 'v1', contact_id: 'c1' }], NOW)).toBe('a_rappeler');
  });
  test('sans moto sur le rendez-vous : le client suffit', () => {
    expect(j5State(sent(6), [{ created_at: '2026-10-29T10:00:00Z', status: 'demande', vehicle_id: null, contact_id: 'c1' }], NOW)).toBe('close');
  });
  test('seule une relance envoyee est concernee', () => {
    expect(j5State(sent(9, { status: 'planifiee' }), [], NOW)).toBe('unchanged');
    expect(j5State(sent(9, { status: 'repondue' }), [], NOW)).toBe('unchanged');
  });
});

describe('modele du mail', () => {
  const tpl = 'Bonjour {prenom},\n\nL\'entretien {objet} de votre {moto} est a prevoir pour le {date}.\n{lien_rdv}';
  test('les variables sont remplies', () => {
    const out = fillTemplate(tpl, { prenom: 'Marco', objet: 'Desmo Service 24 000 km', moto: 'Ducati Monster (1-ABC-123)', date: '15/11/2026', lien_rdv: 'https://app/mon-espace/rendez-vous?relance=x' });
    expect(out).toBe('Bonjour Marco,\n\nL\'entretien Desmo Service 24 000 km de votre Ducati Monster (1-ABC-123) est a prevoir pour le 15/11/2026.\nhttps://app/mon-espace/rendez-vous?relance=x');
  });
  test('prenom manquant : « Bonjour, » et non « Bonjour , »', () => {
    expect(fillTemplate('Bonjour {prenom},', {})).toBe('Bonjour,');
  });
  test('une variable inconnue est signalee', () => {
    expect(unknownVars('Bonjour {prenon}, votre {moto}')).toEqual(['{prenon}']);
    expect(unknownVars('{prenom} {nom} {moto} {date} {objet} {km} {lien_rdv}')).toEqual([]);
    expect(TEMPLATE_VARS).toHaveLength(7);
  });
  test('langue du modele = langue de la fiche du client, FR a defaut', () => {
    const available = ['fr', 'nl', 'en', 'it'];
    expect(pickTemplateLocale('nl', available)).toBe('nl');
    expect(pickTemplateLocale('it', available)).toBe('it');
    expect(pickTemplateLocale('de', available)).toBe('fr');
    expect(pickTemplateLocale(null, available)).toBe('fr');
    expect(pickTemplateLocale('nl', ['fr'])).toBe('fr');
  });
  test('le bouton « Prendre rendez-vous » existe dans les quatre langues des mails serveur', () => {
    for (const l of MAIL_LOCALES) expect(mailTexts(l).followup.book.length).toBeGreaterThan(3);
    expect(mailTexts('nl').followup.book).not.toBe(mailTexts('fr').followup.book);
  });
});

describe('ecran', () => {
  test('onglets : a envoyer / en attente / a rappeler et closes', () => {
    expect(followupTab('planifiee')).toBe('a_envoyer');
    expect(followupTab('envoyee')).toBe('en_attente');
    for (const s of ['repondue', 'a_rappeler', 'close', 'annulee'] as const) expect(followupTab(s)).toBe('a_rappeler');
  });
  test('chaque statut a une couleur, une icone et un libelle', () => {
    for (const s of ['planifiee', 'envoyee', 'repondue', 'a_rappeler', 'close', 'annulee'] as const) {
      expect(statusTone(s)).toBeDefined();
      expect((fr.followups as Record<string, string>)[`st_${s}`]).toBeTruthy();
    }
    expect(statusTone('a_rappeler')).toBe('danger');
  });
  test('compteurs : a envoyer cette semaine, en attente, a rappeler', () => {
    const list = [
      { status: 'planifiee' as const, send_at: '2026-11-02' },
      { status: 'planifiee' as const, send_at: '2026-11-20' },
      { status: 'envoyee' as const, send_at: '2026-10-20' },
      { status: 'a_rappeler' as const, send_at: '2026-10-10' },
      { status: 'close' as const, send_at: '2026-10-10' },
    ];
    expect(counters(list, '2026-10-31')).toEqual({ toSendThisWeek: 1, waiting: 1, toCall: 1 });
  });
  test('« Relances » est sous le CRM et herite de ses droits (vendeur, marketing, admin ; rien pour les autres)', () => {
    const item = mainNav.find((i) => i.to === '/crm/relances');
    expect(item?.child).toBe(true);
    expect(mainNav[mainNav.indexOf(item!) - 1].to).toBe('/crm');
    expect(accessLevel('/crm/relances', ['marketing'])).toBe('write');
    expect(accessLevel('/crm/relances', ['vendeur'])).toBe('write');
    expect(accessLevel('/crm/relances', ['admin'])).toBe('write');
    expect(accessLevel('/crm/relances', ['mecanicien'])).toBe('none');
    expect(accessLevel('/crm/relances', ['comptable'])).toBe('none');
  });
});
