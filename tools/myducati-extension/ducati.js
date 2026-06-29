/* Content script — page moto du portail My Ducati. Scrape par LIBELLÉS (robuste aux classes
 * Salesforce) et ajoute un bouton flottant « ⬇ Importer dans le DMS ». Envoie au service worker.
 * NB : les libellés correspondent à l'UI FR du portail (cf. docs/extension-myducati.md). Si Ducati
 * change un libellé, l'ajuster ici (champ non trouvé = ignoré, jamais bloquant). */
(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // Trouve la valeur affichée juste après un libellé exact.
  function byLabel(label) {
    const els = document.querySelectorAll('span, label, dt, th, p, div');
    for (const el of els) {
      if (norm(el.textContent) !== label) continue;
      // valeur = élément frère/suivant porteur de texte
      let n = el.nextElementSibling;
      while (n && !norm(n.textContent)) n = n.nextElementSibling;
      if (n && norm(n.textContent) && norm(n.textContent) !== label) return norm(n.textContent);
      // sinon : valeur dans le conteneur parent
      const p = el.parentElement;
      if (p) {
        const txt = norm(p.textContent).replace(label, '').trim();
        if (txt) return txt;
      }
    }
    return null;
  }
  const has = (label) => { const v = byLabel(label); return v ? /✓|oui|yes|true/i.test(v) || v === '' : null; };

  function scrapeTables() {
    const maint = [], bulletins = [];
    for (const table of document.querySelectorAll('table')) {
      const heads = [...table.querySelectorAll('thead th, thead td')].map((h) => norm(h.textContent).toLowerCase());
      const isBull = heads.some((h) => h.includes('bulletin'));
      const isMaint = heads.some((h) => h.includes('événement') || h.includes('evenement') || h.includes('type'));
      for (const tr of table.querySelectorAll('tbody tr')) {
        const c = [...tr.querySelectorAll('td')].map((td) => norm(td.textContent));
        if (!c.length || c.every((x) => !x || x === '-')) continue;
        if (isBull) bulletins.push({ bulletin_id: c[0], title: c[1], number: c[2], published_at: c[3] });
        else if (isMaint) maint.push({ row: c });
      }
    }
    return { maint, bulletins };
  }

  function scrape() {
    const text = document.body.innerText || '';
    const vinMatch = text.match(/\bZDM[A-HJ-NPR-Z0-9]{14}\b/);
    const tables = scrapeTables();
    return {
      vin: vinMatch ? vinMatch[0] : byLabel('VIN'),
      contact: {
        ducati_code: byLabel('Code Ducati'),
        my_ducati_email: byLabel('Email'),
        my_ducati_phone: byLabel('Téléphone'),
        my_ducati_city: byLabel('Ville'),
        my_ducati_country: byLabel('Pays'),
        my_ducati_name: byLabel('Nom'),
        my_ducati_marketing: has('Activité de Marketing'),
        my_ducati_profiling: has('Profilage'),
        my_ducati_is_current_owner: has('Propriétaire Actuel'),
      },
      vehicle: {
        engine_number: byLabel('Numéro de Moteur'),
        ducati_state: byLabel('État'),
        ducati_usage: byLabel('Utilisation'),
        production_date: byLabel('Date de Production'),
        ship_date: byLabel("Date d'Expédition depuis Ducati"),
        invoiced_to: byLabel('Moto Facturée à'),
        warranty_start: byLabel('Date de Début de Garantie'),
        warranty_end: byLabel('Date de Fin de Garantie'),
        warranty_type: byLabel('Type de Garantie'),
        warranty_state: byLabel('État de la Garantie'),
        warranty_activated_by: byLabel('Garantie Activée par'),
        last_km: (byLabel('Dernier Kilométrage') || '').replace(/[^\d]/g, '') || null,
      },
      bulletins: tables.bulletins,
      maintenance_raw: tables.maint,
      scraped_at: new Date().toISOString(),
      source_url: location.href,
    };
  }

  function sendToDms() {
    const data = scrape();
    if (!data.vin) { alert('VIN introuvable sur cette page My Ducati. Ouvrez la fiche d’une moto.'); return; }
    chrome.runtime.sendMessage({ type: 'myducati-data', payload: data }, (resp) => {
      btn.textContent = resp && resp.delivered ? '✓ Envoyé au DMS' : '⚠ DMS non ouvert (ouvrez l’onglet du DMS)';
      setTimeout(() => { btn.textContent = LABEL; }, 4000);
    });
  }

  const LABEL = '⬇ Importer dans le DMS';
  const btn = document.createElement('button');
  btn.textContent = LABEL;
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#cc0000;color:#fff;border:0;border-radius:6px;padding:10px 14px;font:600 13px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  btn.addEventListener('click', sendToDms);
  document.documentElement.appendChild(btn);
})();
