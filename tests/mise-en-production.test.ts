/**
 * Mise en production (19/11/2026) : règles de la fenêtre (src/modules/settings/production-rules.ts) et
 * règle commune de l'expéditeur des mails (supabase/functions/_shared/graph-mail.ts). La base refait
 * tous les contrôles (supabase/tests/m0_mise_en_production.sql) ; ici, ce que l'écran grise et affiche.
 */
import { describe, expect, test } from 'bun:test';
import {
  canAct, cronTone, isCheckable, missingFor, normalizeProductionMode, productionErrorKey, productionTone,
  selectionAllows, targetMode, type ProductionItem, choiceEnabled, planChanges, APPLY_ORDER,
} from '../src/modules/settings/production-rules';
import { allowedSender, plainToHtml } from '../supabase/functions/_shared/graph-mail';
import { productionFr, productionNl, productionEn, productionIt } from '../src/lib/i18n/production';

const item = (p: Partial<ProductionItem> & { key: string }): ProductionItem => ({
  group: 'mail', mode: 'arrete', missing: [], missing_test: [], test_ok: false, detail: {}, ...p,
});

describe('mise en production : etats', () => {
  test('statut = couleur (jamais le rouge de la marque) ; inconnu = arrete', () => {
    expect(productionTone('actif')).toBe('success');
    expect(productionTone('test')).toBe('warning');
    expect(productionTone('arrete')).toBe('neutral');
    expect(productionTone('non_utilise')).toBe('neutral');
    expect(normalizeProductionMode('n importe quoi')).toBe('arrete');
    expect(targetMode('start')).toBe('actif');
    expect(targetMode('test')).toBe('test');
    expect(targetMode('pause')).toBe('arrete');
  });
});

describe('mise en production : ce qui peut etre coche et demarre', () => {
  const ok = item({ key: 'appointment_reminder_mail', test_ok: true });
  const noKey = item({ key: 'sms', group: 'sms', missing: ['brevo_secret'], test_ok: true });
  const sub = item({ key: 'sms_ready', group: 'sms', missing: ['depends_sms'] });
  const sms = item({ key: 'sms', group: 'sms', test_ok: true, missing_test: ['test_recipient_sms'] });

  test('non configure : ni demarrage ni test, case grisee tant qu il ne tourne pas', () => {
    expect(canAct(noKey, 'start', false)).toBe(false);
    expect(canAct(noKey, 'test', false)).toBe(false);
    expect(isCheckable(noKey, false)).toBe(false);
    // ... mais s'il tourne (actif), on peut toujours le mettre en pause.
    expect(isCheckable({ ...noKey, mode: 'actif' }, false)).toBe(true);
    expect(canAct({ ...noKey, mode: 'actif' }, 'pause', false)).toBe(true);
  });

  test('configure : demarrable ; deja actif : seulement la pause', () => {
    expect(canAct(ok, 'start', false)).toBe(true);
    expect(canAct({ ...ok, mode: 'actif' }, 'start', false)).toBe(false);
    expect(canAct(ok, 'pause', false)).toBe(false);
  });

  test('societe de test : jamais demarree ni passee en test, la pause reste possible', () => {
    expect(canAct(ok, 'start', true)).toBe(false);
    expect(canAct(ok, 'test', true)).toBe(false);
    expect(canAct({ ...ok, mode: 'actif' }, 'pause', true)).toBe(true);
  });

  test('dependance : le SMS de fin de travaux demarre si le SMS est coche dans la meme selection', () => {
    expect(missingFor(sub, 'start', new Set())).toEqual(['depends_sms']);
    expect(missingFor(sub, 'start', new Set(['sms', 'sms_ready']))).toEqual([]);
    expect(selectionAllows([sms, sub], new Set(['sms', 'sms_ready']), 'start', false)).toBe(true);
    expect(selectionAllows([sms, sub], new Set(['sms_ready']), 'start', false)).toBe(false);
  });

  test('mode test : seulement pour les elements qui en ont un, avec adresse / numero de test', () => {
    expect(canAct(sms, 'test', false)).toBe(false); // numero de test manquant
    expect(canAct({ ...sms, missing_test: [] }, 'test', false)).toBe(true);
    expect(canAct(item({ key: 'outlook_poll', test_ok: false }), 'test', false)).toBe(false);
  });

  test('Stripe (non utilise) : jamais demarrable', () => {
    const stripe = item({ key: 'stripe', group: 'payment', mode: 'non_utilise', missing: ['not_used'] });
    expect(canAct(stripe, 'start', false)).toBe(false);
    expect(isCheckable(stripe, false)).toBe(false);
  });

  test('tout ou rien : un seul element refuse grise le bouton', () => {
    expect(selectionAllows([ok, noKey], new Set(['appointment_reminder_mail', 'sms']), 'start', false)).toBe(false);
    expect(selectionAllows([ok, noKey], new Set(), 'start', false)).toBe(false);
  });
});

describe('mise en production : refus de la base et taches planifiees', () => {
  test('refus traduits', () => {
    expect(productionErrorKey('MEP_NOT_CONFIGURED:sms:brevo_secret,cron_unchecked')).toEqual({ key: 'MEP_NOT_CONFIGURED', item: 'sms', missing: ['brevo_secret', 'cron_unchecked'] });
    expect(productionErrorKey('ERROR: MEP_TEST_COMPANY').key).toBe('MEP_TEST_COMPANY');
    expect(productionErrorKey('autre chose').key).toBe('generic');
  });
  test('tache en echec (followups-plan) bien visible', () => {
    expect(cronTone({ jobname: 'followups-plan', schedule: '0 6 * * *', active: true, last_status: 'failed', last_run: null, last_message: 'x' }))
      .toEqual({ tone: 'danger', state: 'failed' });
    expect(cronTone({ jobname: 'x', schedule: '', active: false, last_status: 'succeeded', last_run: null, last_message: null }).state).toBe('inactive');
  });
});

describe('mails automatiques : expediteur autorise (regle commune graph-mail)', () => {
  const boxes = ['info@ducatibxl.be', 'shop@ducatibxl.be'];
  test('boite de la societe ou adresse de l utilisateur du meme domaine, rien d autre', () => {
    expect(allowedSender({ wanted: 'Shop@DucatiBXL.be', shared: boxes })).toEqual({ mailbox: 'shop@ducatibxl.be', shared: true });
    expect(allowedSender({ wanted: 'simon@ducatibxl.be', userEmail: 'simon@ducatibxl.be', shared: boxes })).toEqual({ mailbox: 'simon@ducatibxl.be', shared: false });
    expect(allowedSender({ wanted: 'simon@gmail.com', userEmail: 'simon@gmail.com', shared: boxes })).toEqual({ error: 'unknown_mailbox' });
    expect(allowedSender({ wanted: 'pirate@ducatibxl.be', userEmail: 'simon@ducatibxl.be', shared: boxes })).toEqual({ error: 'unknown_mailbox' });
    expect(allowedSender({ wanted: '', shared: boxes, fallback: 'info@ducatibxl.be' })).toEqual({ mailbox: 'info@ducatibxl.be', shared: true });
    expect(allowedSender({ wanted: '', shared: boxes, fallback: null })).toEqual({ error: 'no_mailbox' });
  });
  test('texte de la file en HTML echappe', () => {
    expect(plainToHtml('Bonjour <b>\nligne 2\n\nfin')).toBe('<p style="margin:0 0 14px 0">Bonjour &lt;b&gt;<br>ligne 2</p><p style="margin:0 0 14px 0">fin</p>');
  });
});

describe('mise en production : libelles', () => {
  test('chaque element et chaque manque a un libelle dans les quatre langues', () => {
    const keys = ['shopify_stock', 'shopify_orders', 'followups', 'dunning', 'invoice_reminder_auto', 'appointment_reminder_mail',
      'order_confirm_mail', 'portal_invite', 'sms', 'sms_ready', 'sms_reminder', 'accounting_auto_transfer', 'outlook_poll',
      'prospect_classify', 'exchange_summary', 'client_app', 'stripe'];
    for (const d of [productionFr, productionNl, productionEn, productionIt]) {
      for (const k of keys) {
        expect((d.items as Record<string, { name: string; desc: string }>)[k]?.name?.length ?? 0).toBeGreaterThan(0);
        expect((d.items as Record<string, { name: string; desc: string }>)[k]?.desc?.length ?? 0).toBeGreaterThan(0);
      }
      for (const m of ['graph_secret', 'graph_unchecked', 'brevo_secret', 'shopify_secret', 'anthropic_secret', 'cron_secret',
        'cron_unchecked', 'sender_mailbox', 'mailbox_none', 'accounting_frequency', 'depends_sms', 'depends_outlook_poll',
        'no_signup_settings', 'not_used', 'test_recipient', 'test_recipient_sms']) {
        expect((d.missing as Record<string, string>)[m]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe('mise en production : choix Arrete / Test / Actif par ligne (revue UX/UI 20/11/2026)', () => {
  const sms = item({ key: 'sms', group: 'sms', test_ok: true });
  const smsEnd = item({ key: 'sms_end_of_work', group: 'sms', test_ok: true, missing: ['depends_sms'] });
  const live = item({ key: 'shopify_stock', group: 'shopify', mode: 'actif' });

  test('le mode actuel et les actions impossibles ne sont pas cliquables', () => {
    expect(choiceEnabled(live, 'start', false)).toBe(false); // deja actif
    expect(choiceEnabled(live, 'pause', false)).toBe(true);
    expect(choiceEnabled(sms, 'pause', false)).toBe(false); // deja arrete
    expect(choiceEnabled(sms, 'start', false)).toBe(true);
    expect(choiceEnabled(sms, 'start', true)).toBe(false); // societe de test : jamais actif
    // La dependance peut etre choisie en meme temps : le bouton reste cliquable.
    expect(choiceEnabled(smsEnd, 'start', false)).toBe(true);
  });

  test('planChanges : regroupe par action, signale la dependance non choisie', () => {
    const items = [sms, smsEnd, live];
    const alone = planChanges(items, { sms_end_of_work: 'start' }, false);
    expect(alone.byAction.start).toEqual(['sms_end_of_work']);
    expect(alone.invalid).toEqual(['sms_end_of_work']);
    const both = planChanges(items, { sms: 'start', sms_end_of_work: 'start', shopify_stock: 'pause' }, false);
    expect(both.invalid).toEqual([]);
    expect(both.byAction).toEqual({ pause: ['shopify_stock'], test: [], start: ['sms', 'sms_end_of_work'] });
    expect(both.count).toBe(3);
    // Choisir le mode actuel = aucun changement.
    expect(planChanges(items, { shopify_stock: 'start' }, false).count).toBe(0);
    expect(APPLY_ORDER).toEqual(['pause', 'test', 'start']);
  });
});
