/* Content script — portail My Ducati. La lecture elle-même est dans dcs-core.js (libellé exact,
 * section par section, testée) ; ici on agrège les onglets Détails / Événements / Bulletins. Deux modes :
 *  - AUTO : sur une page .../vinhistory?vin=... (ouverte par l'app via l'extension), scrape et envoie.
 *  - MANUEL : bouton flottant « ⬇ Importer dans le DMS » sur n'importe quelle fiche moto.
 * Un champ non trouvé reste vide ; un VIN absent ou différent est signalé au DMS. */
(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const bytesToBase64 = (bytes) => { let bin = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(bin); };

  // ===== Mode BULLETIN : page de détail bulletins.ducati.com (même origine, session dealer).
  // AUTO : dès que la page est chargée, récupère le PDF FR et l'envoie au DMS (rangé par numéro).
  // Marche que l'onglet soit ouvert par l'extension (au scrape) OU par l'utilisateur. Aucun clic.
  if (/bulletins\.ducati\.com\/Bulletins\/Details\//i.test(location.href)) {
    // UNIQUEMENT le lien de la section FRANÇAISE (#riepilogo_FR). Aucun repli sur « le 1er lien »
    // de la page (ce serait l'anglais / la section info) — c'était la cause du « toujours le premier ».
    const frPdfUrl = () => {
      const a = document.querySelector('#riepilogo_FR a[href*="/Bulletins/Download/"]')
             || document.querySelector('[id$="_FR"] a[href*="/Bulletins/Download/"]');
      return a ? a.href : null;
    };
    const bulletinNumber = () => ((document.body.innerText.match(/[A-Z]{2,5}-[A-Z]{2,5}-\d{2}-\d{3,4}/) || [])[0]) || null;
    const badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#222;color:#fff;border-radius:6px;padding:8px 12px;font:600 12px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    badge.textContent = '… bulletin → DMS';
    (document.body || document.documentElement).appendChild(badge);
    (async () => {
      // attendre que le lien FR soit réellement présent dans la page (jusqu'à ~14 s)
      for (let i = 0; i < 35 && !frPdfUrl(); i++) await sleep(400);
      const url = frPdfUrl(); const number = bulletinNumber();
      let ok = false;
      if (url) {
        try {
          const res = await fetch(url, { credentials: 'include' });
          const buf = new Uint8Array(await res.arrayBuffer());
          const isPdf = (res.headers.get('content-type') || '').toLowerCase().includes('pdf') || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
          if (isPdf) {
            chrome.runtime.sendMessage({ type: 'bulletin-pdf', payload: { number, pdf_base64: bytesToBase64(buf), pdf_name: String(number || 'bulletin').replace(/[^\w.-]+/g, '_') + '_FR.pdf' } });
            ok = true;
          }
        } catch (_) {}
      }
      if (!ok) chrome.runtime.sendMessage({ type: 'bulletin-done' }); // l'extension referme l'onglet auto
      badge.textContent = ok ? '✓ bulletin enregistré' : '⚠ PDF FR introuvable';
      setTimeout(() => badge.remove(), 3500);
    })();
    return; // page bulletin : pas de scrape VIN
  }

  const core = globalThis.DmsDcsCore;
  const clickTab = (name) => { for (const el of document.querySelectorAll('a, button, span, li, [role="tab"]')) { if (norm(el.textContent) === name) { el.click(); return true; } } return false; };
  // Ready as soon as the header shows a VIN.
  const ready = () => /ZDM[A-HJ-NPR-Z0-9]{14}/.test(document.body.innerText || '');

  async function gather() {
    for (let i = 0; i < 25 && !ready(); i++) await sleep(800);
    // 1) Détails : moto, client, garantie (lus chacun dans leur section).
    clickTab('Détails'); await sleep(1500);
    const page = core.readPage(document.body);
    // 2) Événements et Bulletins : on cumule, le même événement n'est gardé qu'une fois.
    const eventRows = [];
    const eventTables = [];
    const harvestEvents = () => {
      const e = core.readEvents(document.body);
      eventRows.push(...e.rows);
      for (const k of e.tables) if (!eventTables.includes(k)) eventTables.push(k);
    };
    if (clickTab('Événements') || clickTab('Evénements')) { await sleep(2200); harvestEvents(); }
    let bulletins = [];
    if (clickTab('Bulletins')) { await sleep(2200); bulletins = core.readBulletins(document.body); harvestEvents(); }
    return core.buildPayload(page, { rows: core.mergeEvents(eventRows), tables: eventTables }, bulletins,
      core.requestedVin(location.href), { scraped_at: new Date().toISOString(), source_url: location.href });
  }

  function send(payload) { chrome.runtime.sendMessage({ type: 'myducati-data', payload }, () => {}); }

  // Mode AUTO : page vinhistory (ouverte par l'app/extension) → scrape et envoie automatiquement.
  if (/vinhistory/i.test(location.href)) {
    // Toujours une réponse au DMS, y compris en cas d'échec de lecture : jamais de silence.
    gather().then(send);
  }

  // Mode MANUEL : bouton flottant.
  const LABEL = '⬇ Importer dans le DMS';
  const btn = document.createElement('button');
  btn.textContent = LABEL;
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#cc0000;color:#fff;border:0;border-radius:6px;padding:10px 14px;font:600 13px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  btn.addEventListener('click', async () => {
    btn.textContent = '… lecture en cours';
    const p = await gather();
    if (!p.read_vin) { btn.textContent = '⚠ VIN introuvable'; setTimeout(() => (btn.textContent = LABEL), 4000); return; }
    chrome.runtime.sendMessage({ type: 'myducati-data', payload: p }, (resp) => {
      btn.textContent = resp && resp.delivered ? '✓ Envoyé au DMS' : '⚠ Onglet DMS non ouvert';
      setTimeout(() => (btn.textContent = LABEL), 4000);
    });
  });
  document.documentElement.appendChild(btn);
})();
