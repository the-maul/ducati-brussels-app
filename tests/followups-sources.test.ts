/**
 * Tests M10 — Sources des relances (CRM012, decision M-87, constat du 03/11/2026) :
 *   - defaut = toutes les sources connues SANS « plan » (estimation depuis la mise en circulation) ;
 *   - normalisation du reglage lu en base : absent / inconnu → defaut, tableau nettoye, vide reste vide ;
 *   - filtrage : une echeance « plan » est ecartee avec le defaut, gardee si « plan » est coche ;
 *     sans source connue, l'echeance est gardee (meme regle que `followups_plan`) ;
 *   - l'ecran : badge d'une estimation en warning, libelles dans les quatre dictionnaires ;
 *   - la migration SQL porte le meme defaut et le motif `source_non_retenue`.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FOLLOWUP_SOURCES, DEFAULT_FOLLOWUP_SOURCES, ESTIMATED_SOURCES, normalizeFollowupSources, isRetainedSource, splitBySource, sourceTone,
} from '../src/modules/crm/followups-rules';
import { fr } from '../src/lib/i18n/fr';
import { nl } from '../src/lib/i18n/nl';
import { en } from '../src/lib/i18n/en';
import { it } from '../src/lib/i18n/it';

// Ce que donnerait la production du 03/11 (3 364 motos : 2 642 plan, 223 dcs_extract, 1 invoice_g8),
// reduit a quelques lignes.
const rows = [
  { vehicle_id: 'v1', source: 'dcs_extract' },
  { vehicle_id: 'v2', source: 'plan' },
  { vehicle_id: 'v3', source: 'plan' },
  { vehicle_id: 'v4', source: 'invoice_g8' },
  { vehicle_id: 'v5', source: 'or_dms' },
  { vehicle_id: 'v6', source: 'client' },
  { vehicle_id: 'v7', source: null },
];

describe('defaut sans « plan »', () => {
  test('les cinq sources de M-73, « plan » seule estimation', () => {
    expect(FOLLOWUP_SOURCES).toEqual(['or_dms', 'invoice_g8', 'client', 'dcs_extract', 'plan']);
    expect(ESTIMATED_SOURCES).toEqual(['plan']);
  });
  test('le defaut retient tout sauf « plan »', () => {
    expect(DEFAULT_FOLLOWUP_SOURCES).toEqual(['or_dms', 'invoice_g8', 'client', 'dcs_extract']);
    expect(DEFAULT_FOLLOWUP_SOURCES).not.toContain('plan');
  });
  test('reglage absent ou inconnu → defaut', () => {
    expect(normalizeFollowupSources(undefined)).toEqual([...DEFAULT_FOLLOWUP_SOURCES]);
    expect(normalizeFollowupSources(null)).toEqual([...DEFAULT_FOLLOWUP_SOURCES]);
    expect(normalizeFollowupSources('plan')).toEqual([...DEFAULT_FOLLOWUP_SOURCES]);
  });
  test('tableau nettoye : inconnus ignores, doublons retires, ordre de confiance', () => {
    expect(normalizeFollowupSources(['plan', 'DCS_EXTRACT ', 'plan', 'bidon', 'or_dms'])).toEqual(['or_dms', 'dcs_extract', 'plan']);
    expect(normalizeFollowupSources([])).toEqual([]);
  });
});

describe('filtrage des echeances par leur source', () => {
  test('avec le defaut, les estimations sont ecartees, le reste garde', () => {
    const { kept, excluded } = splitBySource(rows, DEFAULT_FOLLOWUP_SOURCES);
    expect(kept.map((r) => r.vehicle_id)).toEqual(['v1', 'v4', 'v5', 'v6', 'v7']);
    expect(excluded.map((r) => r.vehicle_id)).toEqual(['v2', 'v3']);
  });
  test('« plan » coche en connaissance de cause : tout est garde', () => {
    const { kept, excluded } = splitBySource(rows, normalizeFollowupSources([...DEFAULT_FOLLOWUP_SOURCES, 'plan']));
    expect(kept).toHaveLength(rows.length);
    expect(excluded).toEqual([]);
  });
  test('aucune source cochee : seules les echeances sans source passent', () => {
    const { kept, excluded } = splitBySource(rows, []);
    expect(kept.map((r) => r.vehicle_id)).toEqual(['v7']);
    expect(excluded).toHaveLength(6);
  });
  test('sans source connue, on garde (meme regle que la base)', () => {
    expect(isRetainedSource(null, DEFAULT_FOLLOWUP_SOURCES)).toBe(true);
    expect(isRetainedSource('', [])).toBe(true);
    expect(isRetainedSource('plan', DEFAULT_FOLLOWUP_SOURCES)).toBe(false);
    expect(isRetainedSource('dcs_extract', DEFAULT_FOLLOWUP_SOURCES)).toBe(true);
  });
});

describe('ecran', () => {
  test('une estimation se voit (warning), une source connue est neutre', () => {
    expect(sourceTone('plan')).toBe('warning');
    for (const s of DEFAULT_FOLLOWUP_SOURCES) expect(sourceTone(s)).toBe('neutral');
    expect(sourceTone(null)).toBe('neutral');
  });
  test('chaque source a un libelle et l aide du plan existe dans les quatre langues', () => {
    for (const dict of [fr, nl, en, it]) {
      const f = dict.followups as Record<string, string>;
      for (const s of FOLLOWUP_SOURCES) expect(f[`src_${s}`]).toBeTruthy();
      expect(f.sourcesTitle).toBeTruthy();
      expect(f.srcPlanHelp).toBeTruthy();
      expect(f.sourcesNone).toBeTruthy();
      expect(f.reason_source_non_retenue).toBeTruthy();
      expect(f.planDone).toContain('{excluded}');
      expect((dict.settings as Record<string, string>).followupSourcesLine).toBeTruthy();
    }
  });
});

describe('migration SQL (meme regle cote base)', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261103210000_m10_relances_sources_fiables.sql', import.meta.url), 'utf8');
  test('le defaut de followup_settings.sources est sans « plan »', () => {
    const def = sql.match(/add column if not exists sources text\[\] not null\s+default array\[([^\]]+)\]/);
    expect(def).toBeTruthy();
    const values = def![1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(values).toEqual([...DEFAULT_FOLLOWUP_SOURCES]);
  });
  test('les relances ecartees passent annulee avec le motif source_non_retenue, et followups_plan filtre sur le tableau', () => {
    expect(sql).toContain("last_error = 'source_non_retenue'");
    expect(sql).toContain('not (_src = any(_sources))');
    expect(sql).toMatch(/returns table\(planned integer, updated integer, cancelled integer, excluded integer\)/);
    expect(sql).toContain('followup_settings_set(\n  _company uuid, _mode text, _test_recipient text default null, _sources text[] default null)');
  });
  test('aucun guillemet courbe dans la migration', () => {
    const curly = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x201c, 0x201d) + ']');
    expect(curly.test(sql)).toBe(false);
  });
});
