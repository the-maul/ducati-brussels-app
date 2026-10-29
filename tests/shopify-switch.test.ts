/**
 * Mission 03 — une reference remplacee bascule sur la nouvelle, sur le site (29-30/10/2026) :
 * plan de bascule selon le mode, choix du contenu repris, mention « Remplace aussi … » idempotente,
 * mutations de redirection. Aucune requete reseau. Execution : `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import {
  planSwitch, contentToImport, switchAllowed, cleanReferences, replacementNoticeText, replacementNoticeHtml,
  applyReplacementNotice, stripReplacementNotice, redirectPath, redirectSearch, pickRedirect, buildRedirectCreate,
  buildRedirectUpdate, mediaIdsOf, summarizeSteps, type SwitchArticle,
} from '../supabase/functions/_shared/shopify-switch';
import { photosToPush } from '../supabase/functions/_shared/shopify-push';

const A = (over: Partial<SwitchArticle> = {}): SwitchArticle => ({
  article_id: 'a', reference: '14622167AA', is_active: true, in_trial: false, ttc: 143.17,
  web_title: 'Arbre moteur', web_description: '<p>Texte</p>', photo_count: 2,
  link: { product_id: 'gid://shopify/Product/1', product_status: 'ACTIVE', handle: 'arbre-moteur-14622167aa' },
  ...over,
});
const B = (over: Partial<SwitchArticle> = {}): SwitchArticle => ({
  article_id: 'b', reference: '14622162CA', is_active: true, in_trial: false, ttc: 150,
  web_title: null, web_description: null, photo_count: 0, link: null,
  ...over,
});
const steps = (p: ReturnType<typeof planSwitch>) => p.steps.map((s) => `${s.step}:${s.status}`);

describe('mention « Remplace aussi … »', () => {
  test('une reference, plusieurs references, aucune', () => {
    expect(replacementNoticeText(['14622167AA'])).toBe('Remplace aussi la référence 14622167AA.');
    expect(replacementNoticeText(['14622167AA', '59210212F', '59210212G'])).toBe('Remplace aussi les références 14622167AA, 59210212F et 59210212G.');
    expect(replacementNoticeText([])).toBe('');
    expect(replacementNoticeHtml([])).toBe('');
  });
  test('references nettoyees : majuscules, sans doublon ni vide, ordre garde', () => {
    expect(cleanReferences([' 14622167aa ', '', null, '14622167AA', '59210212F'])).toEqual(['14622167AA', '59210212F']);
  });
  test('le HTML porte la classe dms-remplace et echappe le texte', () => {
    expect(replacementNoticeHtml(['A<B'])).toBe('<p class="dms-remplace">Remplace aussi la référence A&lt;B.</p>');
  });
  test('ajout a la fin de la description, idempotent', () => {
    const once = applyReplacementNotice('<p>Description</p>', ['14622167AA']);
    expect(once).toBe('<p>Description</p>\n<p class="dms-remplace">Remplace aussi la référence 14622167AA.</p>');
    expect(applyReplacementNotice(once, ['14622167AA'])).toBe(once);
    expect(applyReplacementNotice(applyReplacementNotice(once, ['14622167AA']), ['14622167AA'])).toBe(once);
  });
  test('une nouvelle ancienne reference remplace la mention, sans doublon', () => {
    const once = applyReplacementNotice('<p>Description</p>', ['14622167AA']);
    const twice = applyReplacementNotice(once, ['14622167AA', '59210212F']);
    expect(twice).toBe('<p>Description</p>\n<p class="dms-remplace">Remplace aussi les références 14622167AA et 59210212F.</p>');
    expect(twice.match(/Remplace aussi/g)?.length).toBe(1);
  });
  test('description vide : la mention seule ; mention sans classe (Shopify a retire l attribut) : retrouvee', () => {
    expect(applyReplacementNotice('', ['X1'])).toBe('<p class="dms-remplace">Remplace aussi la référence X1.</p>');
    expect(applyReplacementNotice(null, [])).toBe('');
    const legacy = '<p>Texte</p><p>Remplace aussi la référence X1.</p>';
    expect(stripReplacementNotice(legacy)).toBe('<p>Texte</p>');
    expect(applyReplacementNotice(legacy, ['X1', 'X2'])).toBe('<p>Texte</p>\n<p class="dms-remplace">Remplace aussi les références X1 et X2.</p>');
  });
});

describe('contenu repris de l ancienne reference (« il garde celle de l ancienne ref par defaut »)', () => {
  test('fiche vide : titre, description et photos a reprendre', () => {
    expect(contentToImport({ web_title: null, web_description: null, photo_count: 0 })).toEqual(['titre', 'description', 'photos']);
    expect(contentToImport({ web_title: '  ', web_description: '<p>&nbsp;</p>', photo_count: 0 })).toEqual(['titre', 'description', 'photos']);
  });
  test('fiche deja remplie : rien a reprendre ; partiellement : seulement ce qui manque', () => {
    expect(contentToImport({ web_title: 'T', web_description: '<p>D</p>', photo_count: 1 })).toEqual([]);
    expect(contentToImport({ web_title: 'T', web_description: null, photo_count: 3 })).toEqual(['description']);
  });
  test('photos reprises du produit de A partent vers le produit de B deja en ligne', () => {
    const photos = [
      { attachment_id: 'p1', external_id: 'gid://shopify/MediaImage/11', pushed_to: [] },            // reprise de A
      { attachment_id: 'p2', external_id: 'gid://shopify/MediaImage/22', pushed_to: [] },            // reprise de B lui-meme
      { attachment_id: 'p3', external_id: null, pushed_to: ['gid://shopify/Product/2'] },            // deja envoyee
      { attachment_id: 'p4', external_id: null, pushed_to: [] },                                      // photo du DMS
    ];
    const ids = photosToPush(photos, 'gid://shopify/Product/2', ['gid://shopify/MediaImage/11']).map((p) => p.attachment_id);
    expect(ids).toEqual(['p1', 'p4']);
    // Sans bascule : comportement inchange (une photo reprise de Shopify ne repart pas).
    expect(photosToPush(photos, 'gid://shopify/Product/2').map((p) => p.attachment_id)).toEqual(['p4']);
    // Nouveau produit : tout part.
    expect(photosToPush(photos, null).map((p) => p.attachment_id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
});

describe('plan de bascule', () => {
  test('cas nominal (mode Tous) : reprise du contenu, publication de B, retrait de A, redirection', () => {
    const p = planSwitch({ mode: 'tous', old: A(), next: B(), old_references: [], redirect_done: false });
    expect(p.ok).toBe(true);
    expect(p.reason).toBeNull();
    expect(steps(p)).toEqual(['contenu:a_faire', 'publication:a_faire', 'retrait:a_faire', 'redirection:a_faire']);
    expect(p.notice).toBe('Remplace aussi la référence 14622167AA.');
    expect(p.old_references).toEqual(['14622167AA']);
    expect(p.steps[3].detail).toBe('/products/arbre-moteur-14622167aa -> (adresse de la nouvelle fiche)');
  });
  test('toute la chaine est citee (A et ceux avant A), jamais B elle-meme', () => {
    const p = planSwitch({ mode: 'tous', old: A(), next: B(), old_references: ['59210212F', '14622162CA', '14622167AA'], redirect_done: false });
    expect(p.old_references).toEqual(['59210212F', '14622167AA']);
    expect(p.notice).toBe('Remplace aussi les références 59210212F et 14622167AA.');
  });
  test('B deja en ligne : mise a jour seulement ; B en brouillon : remise en ligne + mise a jour', () => {
    const online = B({ link: { product_id: 'gid://shopify/Product/2', product_status: 'ACTIVE', handle: 'b' }, web_title: 'T', web_description: 'D', photo_count: 1 });
    expect(steps(planSwitch({ mode: 'tous', old: A(), next: online, old_references: [], redirect_done: false })))
      .toEqual(['contenu:deja_fait', 'mise_a_jour:a_faire', 'retrait:a_faire', 'redirection:a_faire']);
    const draft = B({ link: { product_id: 'gid://shopify/Product/2', product_status: 'DRAFT', handle: 'b' } });
    const p = planSwitch({ mode: 'tous', old: A(), next: draft, old_references: [], redirect_done: false });
    expect(steps(p)).toEqual(['contenu:a_faire', 'remise_en_ligne:a_faire', 'mise_a_jour:a_faire', 'retrait:a_faire', 'redirection:a_faire']);
    expect(p.steps[4].detail).toBe('/products/arbre-moteur-14622167aa -> /products/b');
  });
  test('deja bascule : A en brouillon et redirection faite -> rien a refaire sauf la mise a jour', () => {
    const p = planSwitch({
      mode: 'tous', old: A({ link: { product_id: 'gid://shopify/Product/1', product_status: 'DRAFT', handle: 'a' } }),
      next: B({ link: { product_id: 'gid://shopify/Product/2', product_status: 'ACTIVE', handle: 'b' }, web_title: 'T', web_description: 'D', photo_count: 1 }),
      old_references: [], redirect_done: true,
    });
    expect(p.ok).toBe(true);
    expect(steps(p)).toEqual(['contenu:deja_fait', 'mise_a_jour:a_faire', 'retrait:deja_fait', 'redirection:deja_fait']);
  });
  test('mode Arretee : bloque, les etapes restent visibles pour l apercu', () => {
    const p = planSwitch({ mode: 'arrete', old: A(), next: B(), old_references: [], redirect_done: false });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('sync_stopped');
    expect(p.steps.length).toBe(4);
  });
  test('mode Essai : l ancienne ET la nouvelle doivent etre des articles d essai', () => {
    expect(switchAllowed('essai', true, false)).toBe(false);
    expect(switchAllowed('essai', true, true)).toBe(true);
    expect(switchAllowed('tous', false, false)).toBe(true);
    expect(switchAllowed('arrete', true, true)).toBe(false);
    expect(planSwitch({ mode: 'essai', old: A({ in_trial: true }), next: B(), old_references: [], redirect_done: false }).reason).toBe('not_in_trial');
    expect(planSwitch({ mode: 'essai', old: A({ in_trial: true }), next: B({ in_trial: true }), old_references: [], redirect_done: false }).ok).toBe(true);
    expect(planSwitch({ mode: 'inconnu', old: A(), next: B(), old_references: [], redirect_done: false }).reason).toBe('sync_stopped');
  });
  test('refus : pas remplacee, A pas reliee, B sans prix, B inactive', () => {
    expect(planSwitch({ mode: 'tous', old: A(), next: A(), old_references: [], redirect_done: false }).reason).toBe('not_replaced');
    expect(planSwitch({ mode: 'tous', old: A({ link: null }), next: B(), old_references: [], redirect_done: false }).reason).toBe('old_not_linked');
    const noPrice = planSwitch({ mode: 'tous', old: A(), next: B({ ttc: null }), old_references: [], redirect_done: false });
    expect(noPrice.reason).toBe('no_price');
    expect(noPrice.steps.find((s) => s.step === 'publication')?.status).toBe('bloque');
    expect(planSwitch({ mode: 'tous', old: A(), next: B({ is_active: false }), old_references: [], redirect_done: false }).reason).toBe('inactive');
  });
  test('le mode passe avant les autres raisons', () => {
    expect(planSwitch({ mode: 'arrete', old: A(), next: B({ ttc: null }), old_references: [], redirect_done: false }).reason).toBe('sync_stopped');
  });
  test('resume lisible pour le journal', () => {
    const p = planSwitch({ mode: 'tous', old: A(), next: B(), old_references: [], redirect_done: true });
    expect(summarizeSteps(p.steps)).toBe('contenu:a_faire (titre, description, photos) ; publication:a_faire (Remplace aussi la référence 14622167AA.) ; retrait:a_faire ; redirection:deja_fait');
  });
});

describe('redirection Shopify', () => {
  test('chemins et recherche', () => {
    expect(redirectPath('arbre-moteur')).toBe('/products/arbre-moteur');
    expect(redirectPath('/arbre-moteur/')).toBe('/products/arbre-moteur');
    expect(redirectSearch('/products/a"b')).toBe('path:/products/ab');
    expect(pickRedirect([{ id: 'r1', path: '/products/A/', target: '/products/b' }], '/products/a')?.id).toBe('r1');
    expect(pickRedirect([{ id: 'r1', path: '/products/x', target: '/products/b' }], '/products/a')).toBeNull();
  });
  test('mutation de creation : /products/A -> /products/B', () => {
    const m = buildRedirectCreate('old-handle', 'new-handle');
    expect(m.query).toContain('urlRedirectCreate');
    expect(m.variables).toEqual({ redirect: { path: '/products/old-handle', target: '/products/new-handle' } });
  });
  test('mutation de mise a jour : la cible seulement', () => {
    const m = buildRedirectUpdate('gid://shopify/UrlRedirect/9', 'new-handle');
    expect(m.query).toContain('urlRedirectUpdate');
    expect(m.variables).toEqual({ id: 'gid://shopify/UrlRedirect/9', redirect: { target: '/products/new-handle' } });
  });
  test('ids des images d un produit', () => {
    expect(mediaIdsOf({ media: { nodes: [{ id: 'm1', mediaContentType: 'IMAGE' }, { id: 'v1', mediaContentType: 'VIDEO' }, { id: '', mediaContentType: 'IMAGE' }] } })).toEqual(['m1']);
    expect(mediaIdsOf(null)).toEqual([]);
  });
});
