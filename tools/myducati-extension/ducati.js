/* Content script — portail My Ducati. Scrape la fiche VIN par LIBELLÉS (robuste aux classes
 * Salesforce) + agrège les onglets Détails / Événements / Bulletins. Deux modes :
 *  - AUTO : sur une page .../vinhistory?vin=... (ouverte par l'app via l'extension), scrape et envoie.
 *  - MANUEL : bouton flottant « ⬇ Importer dans le DMS » sur n'importe quelle fiche moto.
 * Un champ non trouvé est simplement ignoré (jamais bloquant). */
(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  const collected = { bulletins: [], maintenance: [] };
  function harvestTables() {
    for (const table of document.querySelectorAll('table')) {
      const heads = [...table.querySelectorAll('thead th, thead td')].map((h) => norm(h.textContent).toLowerCase());
      const isBull = heads.some((h) => h.includes('bulletin'));
      const isMaint = heads.some((h) => h.includes('événement') || h.includes('evenement')) || heads.some((h) => h.includes('km/mi'));
      for (const tr of table.querySelectorAll('tbody tr')) {
        const c = [...tr.querySelectorAll('td')].map((td) => norm(td.textContent));
        if (!c.length || c.every((x) => !x || x === '-')) continue;
        if (isBull && !collected.bulletins.some((b) => b.bulletin_id === c[0])) collected.bulletins.push({ bulletin_id: c[0], title: c[1], number: c[2], published_at: c[3] });
        else if (isMaint) collected.maintenance.push(c);
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
      },
    };
  }

  const ready = () => { const t = document.body.innerText || ''; return /ZDM[A-HJ-NPR-Z0-9]{14}/.test(t) && (t.includes('Code Ducati') || t.includes('Garantie')); };
  function clickTab(name) { for (const el of document.querySelectorAll('a, button, span, li, [role="tab"]')) { if (norm(el.textContent) === name) { el.click(); return true; } } return false; }

  async function gather() {
    for (let i = 0; i < 25 && !ready(); i++) await sleep(800);
    harvestTables();
    if (clickTab('Événements') || clickTab('Evénements')) { await sleep(2000); harvestTables(); }
    if (clickTab('Bulletins')) { await sleep(2000); harvestTables(); }
    clickTab('Détails'); await sleep(300);
    const d = details();
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
