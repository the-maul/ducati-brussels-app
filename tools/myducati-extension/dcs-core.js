/* Pure reading of a DCS (My Ducati) bike page. No network, no chrome API: it only walks the DOM
 * it is given, so `bun test` runs it on fictional HTML (tests/dcs-core.test.ts).
 *
 * Loaded BEFORE ducati.js in the portal (classic content script, exposes globalThis.DmsDcsCore)
 * and importable by the tests.
 *
 * Rules: a value is read by its EXACT label, inside its own section, never from a table.
 * "-" means empty. An icon or a star that cannot be interpreted stays null, never false.
 */
(function (root) {
  'use strict';

  const PAYLOAD_FORMAT = 2;
  const VIN_RE = /[A-HJ-NPR-Z0-9]{17}/;

  const clean = (s) => String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim();
  const fold = (s) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’ʼ`´]/g, "'").toLowerCase();
  const orNull = (s) => { const v = clean(s); return !v || /^[-–—]+$/.test(v) ? null : v; };

  const SECTIONS = {
    vehicle: 'Détails de la Moto',
    client: 'Détails du Client',
    warranty: 'Détails de Garantie',
  };
  const VEHICLE_FIELDS = {
    engine_number: 'Numéro de Moteur', ducati_state: 'État', ducati_usage: 'Utilisation',
    production_date: 'Date de Production', last_km: 'Dernier Kilométrage',
    ship_date: "Date d'Expédition depuis Ducati", invoiced_to: 'Moto Facturée à',
  };
  const CLIENT_FIELDS = {
    my_ducati_name: 'Nom', ducati_code: 'Code Ducati', my_ducati_email: 'Email',
    birth_date: 'Date de naissance', my_ducati_phone: 'Téléphone mobile', my_ducati_country: 'Pays',
    address: 'Adresse postale', postal_code: 'Code postal', my_ducati_city: 'Ville', region: 'Région/Province',
  };
  const CLIENT_FLAGS = {
    my_ducati_marketing: 'Activité de Marketing', my_ducati_profiling: 'Profilage',
    my_ducati_is_current_owner: 'Propriétaire Actuel',
  };
  const WARRANTY_FIELDS = {
    warranty_start: 'Date de Début de Garantie', warranty_end: 'Date de Fin de Garantie',
    warranty_type: 'Type de Garantie', warranty_activated_by: 'Garantie Activée par',
    warranty_state: 'État de la Garantie', warranty_age: 'Âge',
  };
  const COLUMN_LABELS = ['Événement', 'Type', 'ID', 'Référence', 'État', 'Symptôme/Défaut', 'Cause', 'km/mi/h',
    "Prochaine Date d'Échéance", 'Date de création', 'Date', 'Concessionnaire',
    'ID de Bulletin', 'Titre', 'Numéro de Bulletin', 'Date de Publication'];
  const TILE_LABELS = ['État de Maintenance', 'État de la Garantie', 'Type de Garantie', 'Dernier Kilométrage'];
  const KNOWN_LABELS = new Set([
    ...Object.values(SECTIONS), ...Object.values(VEHICLE_FIELDS), ...Object.values(CLIENT_FIELDS),
    ...Object.values(CLIENT_FLAGS), 'Monetary', ...Object.values(WARRANTY_FIELDS), ...COLUMN_LABELS, ...TILE_LABELS,
    'Événements', 'Détails', 'Bulletins',
  ].map(fold));

  // ---------------------------------------------------------------------------------------
  // DOM helpers (only children / parentElement / nextElementSibling / tagName / getAttribute /
  // textContent: the real DOM and the test DOM both provide them).
  // ---------------------------------------------------------------------------------------
  const tag = (el) => String(el.tagName || '').toUpperCase();
  const kids = (el) => Array.from(el.children || []);
  const attr = (el, name) => (el.getAttribute ? el.getAttribute(name) : null);

  function allElements(start) {
    const out = [];
    const stack = [start];
    while (stack.length) {
      const el = stack.pop();
      out.push(el);
      const c = kids(el);
      for (let i = c.length - 1; i >= 0; i--) stack.push(c[i]);
    }
    return out;
  }
  const insideTable = (el) => { for (let p = el; p; p = p.parentElement) if (tag(p) === 'TABLE') return true; return false; };
  const contains = (a, b) => { for (let p = b; p; p = p.parentElement) if (p === a) return true; return false; };

  /** Deepest elements whose whole text is exactly this label, outside any table. */
  function findExact(scopes, label) {
    const wanted = fold(label);
    const hits = [];
    for (const scope of scopes) {
      for (const el of allElements(scope)) {
        const raw = el.textContent || '';
        if (raw.length > wanted.length + 60 || fold(raw) !== wanted || insideTable(el)) continue;
        if (kids(el).some((c) => fold(c.textContent) === wanted)) continue;
        hits.push(el);
      }
    }
    return hits;
  }

  const holdsKnownLabel = (el) => allElements(el).some((e) => {
    const raw = e.textContent || '';
    return raw.length <= 60 && KNOWN_LABELS.has(fold(raw));
  });

  const ICON_ATTRS = ['icon-name', 'data-key', 'data-icon', 'alternative-text', 'title', 'aria-label', 'aria-checked', 'data-value', 'data-rating'];
  const hasIndicator = (el) => allElements(el).some((e) => {
    const t = tag(e);
    return t === 'SVG' || t === 'IMG' || t === 'INPUT' || t === 'USE' || t === 'LIGHTNING-ICON'
      || ICON_ATTRS.some((a) => attr(e, a) != null);
  });

  /** The element holding the value of a label: never a neighbouring field's label. */
  function valueSlot(labelEl, scopes) {
    let node = labelEl;
    for (let depth = 0; depth < 4 && node; depth++) {
      for (let n = node.nextElementSibling; n; n = n.nextElementSibling) {
        if (holdsKnownLabel(n)) return null;
        if (clean(n.textContent) || hasIndicator(n)) return n;
      }
      if (scopes.includes(node)) return null;
      node = node.parentElement;
    }
    return null;
  }

  function slotOf(scopes, label) {
    const hits = findExact(scopes, label);
    return hits.length ? valueSlot(hits[0], scopes) : null;
  }
  const readText = (scopes, label) => { const s = slotOf(scopes, label); return s ? orNull(s.textContent) : null; };

  // ---------------------------------------------------------------------------------------
  // Icons and stars
  // ---------------------------------------------------------------------------------------
  const YES = new Set(['check', 'checked', 'success', 'approval', 'yes', 'oui', 'true', 'coche', 'actif', 'active']);
  const NO = new Set(['close', 'clear', 'ban', 'no', 'non', 'false', 'error', 'dash', 'remove', 'block', 'unchecked', 'inactif', 'inactive']);

  function iconWords(el) {
    const words = [];
    const push = (v) => { if (v) words.push(...fold(v).split(/[^a-z0-9]+/).filter(Boolean)); };
    for (const e of allElements(el)) {
      for (const a of ['icon-name', 'data-key', 'data-icon', 'alternative-text', 'title', 'aria-label']) push(attr(e, a));
      const href = attr(e, 'xlink:href') || attr(e, 'href');
      if (href && href.includes('#')) push(href.split('#').pop());
      const m = String(attr(e, 'class') || '').match(/slds-icon-(?:utility|action|standard)-([a-z0-9_-]+)/);
      if (m) push(m[1]);
    }
    return words;
  }

  /** true / false when the slot says so without doubt, otherwise null. */
  function readFlag(slot) {
    if (!slot) return null;
    const txt = fold(slot.textContent);
    if (txt === 'oui' || txt === 'yes') return true;
    if (txt === 'non' || txt === 'no') return false;
    for (const e of allElements(slot)) {
      if (tag(e) === 'INPUT' && String(attr(e, 'type')).toLowerCase() === 'checkbox') {
        return e.checked === true || attr(e, 'checked') != null;
      }
      const aria = attr(e, 'aria-checked');
      if (aria === 'true') return true;
      if (aria === 'false') return false;
    }
    const words = iconWords(slot);
    const yes = words.some((w) => YES.has(w));
    const no = words.some((w) => NO.has(w));
    return yes === no ? null : yes;
  }

  /** Number of stars (0..7) when it can really be read, otherwise null. */
  function readStars(slot) {
    if (!slot) return null;
    const valid = (n) => (Number.isInteger(n) && n >= 0 && n <= 7 ? n : null);
    const txt = clean(slot.textContent);
    if (/[★☆]/.test(txt)) return valid((txt.match(/★/g) || []).length);
    for (const e of allElements(slot)) {
      for (const a of ['data-rating', 'data-value', 'aria-valuenow']) {
        const v = attr(e, a);
        if (v != null && /^\d$/.test(v.trim())) return valid(Number(v));
      }
      for (const a of ['aria-label', 'title', 'alternative-text']) {
        const m = fold(attr(e, a)).match(/^(\d)\s*(?:\/\s*\d|sur\s*\d|out of\s*\d|etoiles?|stars?)/);
        if (m) return valid(Number(m[1]));
      }
    }
    let filled = 0;
    let empty = 0;
    for (const e of allElements(slot)) {
      const label = fold([attr(e, 'icon-name'), attr(e, 'data-key'), attr(e, 'class')].filter(Boolean).join(' '));
      if (!/\bstar/.test(label)) continue;
      if (/star[-_ ]?(filled|full|on)\b/.test(label)) filled++;
      else if (/star[-_ ]?(empty|outline|off)\b/.test(label)) empty++;
    }
    return filled + empty > 0 ? valid(filled) : null;
  }

  // ---------------------------------------------------------------------------------------
  // Header: « MODEL COLOR YEAR MARKET » and « VIN: ... | Plaque d'immatriculation: ... »
  // ---------------------------------------------------------------------------------------
  function parseTitle(text) {
    const title = clean(text);
    const m = title.match(/^(.+?)\s+((?:19|20)\d{2})\s+([A-Z]{2,4})$/);
    if (!m || m[1] !== m[1].toUpperCase()) return null;
    return { title, descriptor: m[1], year: Number(m[2]), market: m[3] };
  }

  function parseHeaderLine(text) {
    const line = clean(text);
    const vin = line.match(new RegExp('\\bVIN\\s*:\\s*(' + VIN_RE.source + ')(?=\\s|\\||Plaque|$)', 'i'));
    const plate = line.match(/plaque d['’]immatriculation\s*:\s*([^|]*)/i);
    return { vin: vin ? vin[1].toUpperCase() : null, plate: plate ? orNull(plate[1]) : null };
  }

  function readHeader(body) {
    const els = allElements(body);
    let lineIndex = -1;
    for (let i = 0; i < els.length; i++) {
      const raw = els[i].textContent || '';
      if (raw.length > 240 || insideTable(els[i])) continue;
      const f = fold(raw);
      if (/\bvin\s*:/.test(f) && f.includes("plaque d'immatriculation")) lineIndex = i; // keeps the deepest
    }
    if (lineIndex < 0) {
      for (let i = 0; i < els.length; i++) {
        const raw = els[i].textContent || '';
        if (raw.length <= 80 && !insideTable(els[i]) && /^vin\s*:/.test(fold(raw))) lineIndex = i;
      }
    }
    const parsed = lineIndex >= 0 ? parseHeaderLine(els[lineIndex].textContent) : { vin: null, plate: null };
    let title = null;
    for (let i = (lineIndex >= 0 ? lineIndex : els.length) - 1; i >= 0 && !title; i--) {
      const raw = els[i].textContent || '';
      if (raw.length <= 120 && !insideTable(els[i])) title = parseTitle(raw);
    }
    return { vin: parsed.vin, plate: parsed.plate, title };
  }

  // ---------------------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------------------
  function sectionScopes(body) {
    const headings = {};
    for (const key of Object.keys(SECTIONS)) headings[key] = findExact([body], SECTIONS[key])[0] || null;
    const present = Object.values(headings).filter(Boolean);
    const scopes = {};
    for (const key of Object.keys(SECTIONS)) {
      const h = headings[key];
      if (!h) { scopes[key] = []; continue; }
      const others = present.filter((o) => o !== h);
      let cur = h;
      while (cur.parentElement && cur.parentElement !== body && !others.some((o) => contains(cur.parentElement, o))) cur = cur.parentElement;
      const list = [cur];
      // Flat layout: the heading is alone in its wrapper, the fields are in the next siblings.
      if (fold(cur.textContent) === fold(SECTIONS[key])) {
        for (let n = cur.nextElementSibling; n && !others.some((o) => contains(n, o)); n = n.nextElementSibling) list.push(n);
      }
      scopes[key] = list;
    }
    return scopes;
  }

  function readDetails(body) {
    const scopes = sectionScopes(body);
    const vehicle = {};
    for (const [k, label] of Object.entries(VEHICLE_FIELDS)) vehicle[k] = readText(scopes.vehicle, label);
    for (const [k, label] of Object.entries(WARRANTY_FIELDS)) vehicle[k] = readText(scopes.warranty, label);
    const contact = {};
    for (const [k, label] of Object.entries(CLIENT_FIELDS)) contact[k] = readText(scopes.client, label);
    for (const [k, label] of Object.entries(CLIENT_FLAGS)) contact[k] = readFlag(slotOf(scopes.client, label));
    contact.my_ducati_score = readStars(slotOf(scopes.client, 'Monetary'));

    const issues = [];
    for (const key of Object.keys(SECTIONS)) if (!scopes[key].length) issues.push('section_missing:' + key);
    for (const group of [vehicle, contact]) {
      for (const [k, v] of Object.entries(group)) {
        if (typeof v === 'string' && KNOWN_LABELS.has(fold(v))) { issues.push('label_as_value:' + k); group[k] = null; }
      }
    }
    return { vehicle, contact, issues };
  }

  // ---------------------------------------------------------------------------------------
  // Tables
  // ---------------------------------------------------------------------------------------
  function parseDate(s) {
    const v = orNull(s);
    if (!v) return null;
    const m = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    if (!m) return null;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /** « 12.345 km » → 12345. Miles and hours are not kilometres: null. */
  function parseKm(s) {
    const v = orNull(s);
    if (!v) return null;
    const m = v.match(/^(\d[\d\s.,]*)\s*(km)?$/i);
    if (!m) return null;
    const n = Number(m[1].replace(/\D/g, ''));
    return Number.isSafeInteger(n) ? n : null;
  }

  function tableGrid(table) {
    const rows = allElements(table).filter((e) => tag(e) === 'TR');
    if (!rows.length) return null;
    const cellsOf = (tr) => kids(tr).filter((c) => tag(c) === 'TD' || tag(c) === 'TH');
    const isHead = (tr) => { for (let p = tr.parentElement; p && p !== table; p = p.parentElement) if (tag(p) === 'THEAD') return true; return false; };
    const headRow = rows.find(isHead) || rows[0];
    const heads = cellsOf(headRow).map((c) => fold(c.textContent));
    const body = rows.filter((r) => r !== headRow && !isHead(r)).map((tr) => ({ tr, cells: cellsOf(tr) }));
    return { heads, body };
  }

  function tableKind(heads) {
    if (!heads.includes('evenement') || !heads.includes('type')) return null;
    if (heads.includes("prochaine date d'echeance")) return 'upcoming';
    if (heads.includes('date de creation')) return 'current';
    if (heads.includes('date')) return 'past';
    return null;
  }

  const KIND_RANK = { upcoming: 0, current: 1, past: 2 };

  /** Same event read twice (two passes, or moved between tables): keeps the most advanced one. */
  function mergeEvents(rows) {
    const byId = new Map();
    for (const r of rows) {
      const old = byId.get(r.ducati_event_id);
      if (!old || KIND_RANK[r.kind] >= KIND_RANK[old.kind]) byId.set(r.ducati_event_id, r);
    }
    return Array.from(byId.values());
  }

  function readEvents(body) {
    const rows = [];
    const tables = [];
    for (const table of allElements(body).filter((e) => tag(e) === 'TABLE')) {
      const grid = tableGrid(table);
      if (!grid) continue;
      const kind = tableKind(grid.heads);
      if (!kind) continue;
      if (!tables.includes(kind)) tables.push(kind);
      for (const { cells } of grid.body) {
        if (cells.length !== grid.heads.length) continue; // « no data » row
        const col = (h) => { const i = grid.heads.indexOf(h); return i < 0 ? null : orNull(cells[i].textContent); };
        const row = {
          kind,
          event_category: col('evenement'), service_type: col('type'), reference: col('reference'),
          state: col('etat'), symptom: col('symptome/defaut'), cause: col('cause'),
          km: parseKm(col('km/mi/h')),
          event_date: kind === 'upcoming' ? null : parseDate(col(kind === 'current' ? 'date de creation' : 'date')),
          due_date: kind === 'upcoming' ? parseDate(col("prochaine date d'echeance")) : null,
          dealer: col('concessionnaire'),
        };
        if (!row.event_category && !row.service_type && !col('id')) continue;
        row.ducati_event_id = col('id') || 'auto:' + fold([row.event_category, row.service_type, row.reference,
          row.event_date || row.due_date, row.km].map((x) => (x == null ? '' : x)).join('|'));
        rows.push(row);
      }
    }
    return { rows: mergeEvents(rows), tables };
  }

  function readBulletins(body) {
    const out = [];
    for (const table of allElements(body).filter((e) => tag(e) === 'TABLE')) {
      const grid = tableGrid(table);
      if (!grid || !grid.heads.includes('id de bulletin')) continue;
      for (const { tr, cells } of grid.body) {
        if (cells.length !== grid.heads.length) continue;
        const col = (h) => { const i = grid.heads.indexOf(h); return i < 0 ? null : orNull(cells[i].textContent); };
        const link = allElements(tr).find((e) => tag(e) === 'A' && (e.href || attr(e, 'href')));
        const item = {
          bulletin_id: col('id de bulletin'), title: col('titre'), number: col('numero de bulletin'),
          published_at: col('date de publication'), url: link ? (link.href || attr(link, 'href')) : null,
        };
        if (!item.bulletin_id && !item.number && !item.title) continue;
        const key = item.bulletin_id || item.number || item.title;
        if (!out.some((b) => (b.bulletin_id || b.number || b.title) === key)) out.push(item);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------
  // Page → payload
  // ---------------------------------------------------------------------------------------
  function readPage(body) {
    const header = readHeader(body);
    const details = readDetails(body);
    let vin = header.vin;
    const issues = details.issues.slice();
    if (!vin) {
      const found = new Set((clean(body.textContent).match(/\bZDM[A-HJ-NPR-Z0-9]{14}\b/g) || []));
      if (found.size === 1) vin = Array.from(found)[0];
      else if (found.size > 1) issues.push('vin_ambiguous');
    }
    if (!header.title) issues.push('title_missing');
    return {
      vin,
      header: {
        title: header.title ? header.title.title : null,
        descriptor: header.title ? header.title.descriptor : null,
        year: header.title ? header.title.year : null,
        market: header.title ? header.title.market : null,
        plate: header.plate,
      },
      vehicle: details.vehicle, contact: details.contact, issues,
    };
  }

  /** Requested VIN of an automatic run (…/vinhistory?vin=XXX), otherwise null. */
  function requestedVin(url) {
    const m = String(url || '').match(/[?&]vin=([A-Za-z0-9]{17})(?:&|#|$)/);
    return m ? m[1].toUpperCase() : null;
  }

  function buildPayload(page, events, bulletins, wantedVin, meta) {
    const vin = page.vin ? String(page.vin).toUpperCase() : null;
    const wanted = wantedVin ? String(wantedVin).toUpperCase() : null;
    let readError = null;
    if (!vin) readError = 'vin_not_found';
    else if (wanted && vin !== wanted) readError = 'vin_mismatch';
    else if (page.issues.some((i) => i.startsWith('label_as_value:'))) readError = 'label_as_value';
    else if (['vehicle', 'client', 'warranty'].every((k) => page.issues.includes('section_missing:' + k))) readError = 'details_not_loaded';
    return Object.assign({
      format: PAYLOAD_FORMAT, vin: vin || wanted, read_vin: vin, requested_vin: wanted, read_error: readError,
      issues: page.issues, header: page.header, vehicle: page.vehicle, contact: page.contact,
      maintenance: events.rows, maintenance_tables: events.tables, bulletins,
    }, meta || {});
  }

  const api = {
    PAYLOAD_FORMAT, parseTitle, parseHeaderLine, parseDate, parseKm, readFlag, readStars,
    readPage, readEvents, readBulletins, mergeEvents, requestedVin, buildPayload,
  };
  root.DmsDcsCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
