/* Content script — portail My Ducati. Scrape la fiche VIN par LIBELLÉS (robuste aux classes
 * Salesforce) + agrège les onglets Détails / Événements / Bulletins. Deux modes :
 *  - AUTO : sur une page .../vinhistory?vin=... (ouverte par l'app via l'extension), scrape et envoie.
 *  - MANUEL : bouton flottant « ⬇ Importer dans le DMS » sur n'importe quelle fiche moto.
 * Un champ non trouvé est simplement ignoré (jamais bloquant). */
(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Encode des octets en base64 (par tranches pour éviter le débordement de pile).
  function bytesToBase64(bytes) {
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  // Télécharge le PDF de chaque bulletin via la session authentifiée du portail.
  // Si le lien n'est pas un PDF (page HTML), on garde juste le lien (dégradation propre).
  async function fetchBulletinPdfs(bulletins) {
    for (const b of bulletins) {
      if (!b.url) continue;
      try {
        const res = await fetch(b.url, { credentials: 'include' });
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const isPdf = ct.includes('pdf') || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46); // %PDF
        if (isPdf && buf.length > 4 && buf.length < 8000000) {
          b.pdf_base64 = bytesToBase64(buf);
          b.pdf_name = String(b.number || b.bulletin_id || 'bulletin').replace(/[^\w.-]+/g, '_').slice(0, 60) + '.pdf';
        }
      } catch (_) { /* garde juste le lien */ }
    }
  }

  function byLabel(label) {
    for (const el of document.querySelectorAll('span, label, dt, th, p, div, lightning-formatted-text')) {
      if (norm(el.textContent) !== label) continue;
      let n = el.nextElementSibling;
      while (n && !norm(n.textContent)) n = n.nextElementSibling;
      if (n && norm(n.textContent) && norm(n.textContent) !== label) return norm(n.textContent);
      const p = el.parentElement;
      if (p) { const txt = norm(p.textContent).replace(label, '').trim(); if (txt) return txt; }
    }
    return null;
  }
  const flag = (label) => { const v = byLabel(label); return v == null ? null : /✓|oui|yes|true|coch/i.test(v) || v === ''; };
  // Premier libellé trouvé parmi plusieurs variantes (FR/IT/EN du portail).
  const firstLabel = (...labels) => { for (const l of labels) { const v = byLabel(l); if (v) return v; } return null; };

  const collected = { bulletins: [], maintenance: [] };
  function harvestTables() {
    for (const table of document.querySelectorAll('table')) {
      const heads = [...table.querySelectorAll('thead th, thead td')].map((h) => norm(h.textContent));
      const hl = heads.map((h) => h.toLowerCase());
      const isBull = hl.some((h) => h.includes('bulletin'));
      const isMaint = hl.some((h) => h.includes('événement') || h.includes('evenement')) || hl.some((h) => h.includes('km/mi'));
      if (!isBull && !isMaint) continue;
      for (const tr of table.querySelectorAll('tbody tr')) {
        const c = [...tr.querySelectorAll('td')].map((td) => norm(td.textContent));
        if (!c.length || c.every((x) => !x || x === '-')) continue;
        if (isBull) {
          // Lien du bulletin : 1er <a href> de la ligne (page portail ou PDF). .href = absolu.
          const a = tr.querySelector('a[href]');
          const url = a ? a.href : null;
          if (!collected.bulletins.some((b) => b.bulletin_id === c[0])) collected.bulletins.push({ bulletin_id: c[0], title: c[1], number: c[2], published_at: c[3], url });
        } else {
          const row = {};
          heads.forEach((h, i) => { if (h) row[h] = c[i] ?? ''; }); // maintenance : objet clé=libellé colonne
          collected.maintenance.push(row);
        }
      }
    }
  }

  function details() {
    const txt = document.body.innerText || '';
    const m = txt.match(/\bZDM[A-HJ-NPR-Z0-9]{14}\b/);
    const km = (byLabel('Dernier Kilométrage') || '').replace(/[^\d]/g, '');
    return {
      vin: m ? m[0] : byLabel('VIN'),
      contact: {
        ducati_code: byLabel('Code Ducati'), my_ducati_email: byLabel('Email'), my_ducati_phone: byLabel('Téléphone'),
        my_ducati_city: byLabel('Ville'), my_ducati_country: byLabel('Pays'), my_ducati_name: byLabel('Nom'),
        my_ducati_marketing: flag('Activité de Marketing'), my_ducati_profiling: flag('Profilage'), my_ducati_is_current_owner: flag('Propriétaire Actuel'),
      },
      vehicle: {
        engine_number: byLabel('Numéro de Moteur'), ducati_state: byLabel('État'), ducati_usage: byLabel('Utilisation'),
        production_date: byLabel('Date de Production'), ship_date: byLabel("Date d'Expédition depuis Ducati"), invoiced_to: byLabel('Moto Facturée à'),
        warranty_start: byLabel('Date de Début de Garantie'), warranty_end: byLabel('Date de Fin de Garantie'), warranty_type: byLabel('Type de Garantie'),
        warranty_state: byLabel('État de la Garantie'), warranty_activated_by: byLabel('Garantie Activée par'), last_km: km || null,
        // Champs standard moto (best-effort selon le portail) — appliqués SI vides côté DMS.
        model: firstLabel('Modèle', 'Modello', 'Model'),
        color: firstLabel('Couleur', 'Colore', 'Color'),
        plate: firstLabel("Plaque d'Immatriculation", 'Plaque', 'Immatriculation', 'Targa'),
        first_registration_date: firstLabel('Date de Première Immatriculation', 'Première Immatriculation', "Date d'Immatriculation"),
      },
    };
  }

  // Prêt dès que le VIN (toujours dans l'en-tête) est présent.
  const ready = () => /ZDM[A-HJ-NPR-Z0-9]{14}/.test(document.body.innerText || '');
  function clickTab(name) { for (const el of document.querySelectorAll('a, button, span, li, [role="tab"]')) { if (norm(el.textContent) === name) { el.click(); return true; } } return false; }

  async function gather() {
    for (let i = 0; i < 25 && !ready(); i++) await sleep(800);
    // 1) Onglet Détails d'abord : infos client + moto + garantie.
    clickTab('Détails'); await sleep(1500);
    const d = details();
    // 2) Puis Événements (maintenance) et Bulletins (tableaux).
    if (clickTab('Événements') || clickTab('Evénements')) { await sleep(2200); harvestTables(); }
    if (clickTab('Bulletins')) { await sleep(2200); harvestTables(); }
    // 3) Télécharge les PDF des bulletins (session authentifiée) pour les rapatrier dans le DMS.
    await fetchBulletinPdfs(collected.bulletins);
    return { ...d, bulletins: collected.bulletins, maintenance_raw: collected.maintenance, scraped_at: new Date().toISOString(), source_url: location.href };
  }

  function send(payload) { chrome.runtime.sendMessage({ type: 'myducati-data', payload }, () => {}); }

  // Mode AUTO : page vinhistory (ouverte par l'app/extension) → scrape et envoie automatiquement.
  if (/vinhistory/i.test(location.href)) {
    gather().then((p) => { if (p.vin) send(p); });
  }

  // Mode MANUEL : bouton flottant.
  const LABEL = '⬇ Importer dans le DMS';
  const btn = document.createElement('button');
  btn.textContent = LABEL;
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#cc0000;color:#fff;border:0;border-radius:6px;padding:10px 14px;font:600 13px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  btn.addEventListener('click', async () => {
    btn.textContent = '… lecture en cours';
    const p = await gather();
    if (!p.vin) { btn.textContent = '⚠ VIN introuvable'; setTimeout(() => (btn.textContent = LABEL), 4000); return; }
    chrome.runtime.sendMessage({ type: 'myducati-data', payload: p }, (resp) => {
      btn.textContent = resp && resp.delivered ? '✓ Envoyé au DMS' : '⚠ Onglet DMS non ouvert';
      setTimeout(() => (btn.textContent = LABEL), 4000);
    });
  });
  document.documentElement.appendChild(btn);
})();
