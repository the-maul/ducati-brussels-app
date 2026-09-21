/**
 * Mission 06, carte 4 — générateur de la table de correspondance « motif de VIN → modèle-année ».
 *
 * Entrées (fichiers locaux, jamais commités : ils contiennent des VIN de clients) :
 *   1. VIN reconnus par l'e-catalog Ducati : [{ vin, modelYear, path, year, status }]
 *      (ex. C:\Users\simon\Downloads\catalogue-ducati-vin-parc.json) ;
 *   2. catalogue exporté de la base (lecture seule) :
 *        select json_agg(r) from (select y.id, y.year, m.id model_id, s.id sm_id, f.id fam_id
 *          from ducati_catalog_model_years y join ducati_catalog_models m on m.id = y.model_id
 *          join ducati_catalog_supermodels s on s.id = m.supermodel_id
 *          join ducati_catalog_families f on f.id = m.family_id) r;
 *   3. caractéristiques par modèle-année, agrégées depuis le parc (aucun VIN) :
 *        select json_agg(r) from (select ducati_model_year_id my, count(*) n,
 *          mode() within group (order by displacement) filter (where displacement > 0) disp,
 *          mode() within group (order by power_kw) filter (where power_kw > 0) kw,
 *          mode() within group (order by power_cv) filter (where power_cv > 0) cv,
 *          mode() within group (order by cylinders) filter (where cylinders > 0) cyl,
 *          mode() within group (order by upper(replace(antipollution, ' ', ''))) filter (where coalesce(antipollution, '') <> '') euro
 *          from vehicles where ducati_model_year_id is not null group by 1) r;
 *
 * Sortie : le bloc de données de la migration (motifs + caractéristiques) et la précision
 * mesurée par validation croisée (on retire chaque VIN, on le reconnaît avec les autres).
 *
 *   bun tools/vin-patterns/build.ts <vins.json> <catalog.json> <specs.json> <sortie.sql>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildVinPatterns, identifyVin, normalizeEuro, vinPatternKey,
  type CatalogYear, type VinConfidence, type VinPatternRow,
} from '../../src/lib/vin-identify';

type Sample = { vin: string; modelYear: string | null };
type CatRow = { id: string; year: number | null; model_id: string; sm_id: string; fam_id: string };
type Spec = { my: string; n: number; disp: number | null; kw: number | null; cv: number | null; cyl: number | null; euro: string | null };

const [vinsPath, catalogPath, specsPath, outPath] = process.argv.slice(2);
if (!vinsPath || !catalogPath || !specsPath || !outPath) {
  console.error('usage : bun tools/vin-patterns/build.ts <vins.json> <catalog.json> <specs.json> <sortie.sql>');
  process.exit(1);
}

const samplesAll = JSON.parse(readFileSync(vinsPath, 'utf8')) as Sample[];
const catalogRows = JSON.parse(readFileSync(catalogPath, 'utf8')) as CatRow[];
const specs = JSON.parse(readFileSync(specsPath, 'utf8')) as Spec[];

const catalog = new Map<string, CatalogYear>(catalogRows.map((c) => [c.id, {
  id: c.id, model_id: c.model_id, supermodel_id: c.sm_id, family_id: c.fam_id, year: c.year,
}]));

// Échantillon : VIN complets reconnus, dont le modèle-année est dans le catalogue chargé.
const known = samplesAll.filter((s) => s.modelYear && vinPatternKey(s.vin));
const samples = known.filter((s) => catalog.has(s.modelYear!)).map((s) => ({ vin: s.vin.toUpperCase(), modelYearId: s.modelYear! }));
const patterns = buildVinPatterns(samples);

// ---------------------------------------------------------------------------------------------
// Validation croisée « leave-one-out » : on retire le VIN de la table (sa ligne perd un
// exemplaire, sa plage est recalculée sans lui), puis on le reconnaît.
// ---------------------------------------------------------------------------------------------
const byPattern = new Map<string, typeof samples>();
for (const s of samples) {
  const k = vinPatternKey(s.vin)!;
  (byPattern.get(k) ?? byPattern.set(k, []).get(k)!).push(s);
}
const levels = ['family', 'supermodel', 'model', 'modelYear'] as const;
type Tally = { n: number; top: Record<(typeof levels)[number], number>; inList: number };
const tally = (): Tally => ({ n: 0, top: { family: 0, supermodel: 0, model: 0, modelYear: 0 }, inList: 0 });
const byConf = new Map<VinConfidence, Tally>();
const overall = tally();

for (const s of samples) {
  const key = vinPatternKey(s.vin)!;
  const others = byPattern.get(key)!.filter((o) => o !== s);
  const rebuilt: VinPatternRow[] = [
    ...patterns.filter((p) => p.pattern !== key),
    ...buildVinPatterns(others),
  ];
  const r = identifyVin(s.vin, rebuilt, catalog, 2026);
  const truth = catalog.get(s.modelYearId)!;
  const top = r.modelYearId ?? r.candidates[0] ?? null;
  const topCat = top ? catalog.get(top) : null;
  const t = byConf.get(r.confidence) ?? byConf.set(r.confidence, tally()).get(r.confidence)!;
  for (const x of [t, overall]) {
    x.n++;
    if ((r.familyId ?? topCat?.family_id) === truth.family_id) x.top.family++;
    if ((r.supermodelId ?? topCat?.supermodel_id) === truth.supermodel_id) x.top.supermodel++;
    if (topCat?.model_id === truth.model_id) x.top.model++;
    if (top === s.modelYearId) x.top.modelYear++;
    if (r.candidates.includes(s.modelYearId)) x.inList++;
  }
}
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)} %` : '—');
const report: string[] = [];
report.push(`VIN reconnus par l'e-catalog : ${known.length} ; dans le catalogue chargé : ${samples.length}`);
report.push(`Motifs (lignes) : ${patterns.length} ; motifs distincts : ${new Set(patterns.map((p) => p.pattern)).size}`);
report.push(`Validation croisée sur ${overall.n} VIN :`);
report.push(`  famille ${pct(overall.top.family, overall.n)} · cylindrée ${pct(overall.top.supermodel, overall.n)} · modèle/version ${pct(overall.top.model, overall.n)} · modèle-année exact ${pct(overall.top.modelYear, overall.n)} · bon choix dans la liste ${pct(overall.inList, overall.n)}`);
for (const c of ['unique', 'probable', 'plusieurs', 'modele', 'famille', 'inconnu'] as VinConfidence[]) {
  const x = byConf.get(c);
  if (!x) continue;
  report.push(`  ${c.padEnd(9)} ${String(x.n).padStart(5)} VIN (${pct(x.n, overall.n)}) : 1er choix exact ${pct(x.top.modelYear, x.n)}, bon modèle ${pct(x.top.model, x.n)}, bonne cylindrée ${pct(x.top.supermodel, x.n)}, famille ${pct(x.top.family, x.n)}, dans la liste ${pct(x.inList, x.n)}`);
}
console.log(report.join('\n'));

// ---------------------------------------------------------------------------------------------
// Bloc SQL de données (motifs + caractéristiques). Aucune donnée personnelle : pas de VIN,
// seulement les 10 premiers caractères et des plages de série arrondies à la centaine.
// ---------------------------------------------------------------------------------------------
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const num = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? 'null' : String(Number(n)));
const lines: string[] = [];
lines.push(`-- Généré par tools/vin-patterns/build.ts le ${new Date().toISOString().slice(0, 10)}.`);
for (const l of report) lines.push(`-- ${l}`);
// Seuls les modèles-années présents dans le catalogue de la base sont chargés (jointure).
lines.push('insert into public.ducati_vin_patterns (pattern, model_year_id, serial_from, serial_to, samples)');
lines.push('select v.pattern, v.model_year_id, v.serial_from, v.serial_to, v.samples from (values');
lines.push(patterns.map((p) => `  (${q(p.pattern)}, ${q(p.model_year_id)}, ${p.serial_from}, ${p.serial_to}, ${p.samples})`).join(',\n'));
lines.push(') as v(pattern, model_year_id, serial_from, serial_to, samples)');
lines.push('join public.ducati_catalog_model_years y on y.id = v.model_year_id');
lines.push('on conflict (pattern, model_year_id) do update set serial_from = excluded.serial_from, serial_to = excluded.serial_to, samples = excluded.samples, updated_at = now();');
lines.push('');
const specRows = specs.filter((s) => catalog.has(s.my) && (s.disp || s.cv || s.kw || s.cyl || normalizeEuro(s.euro)));
lines.push('insert into public.ducati_vin_model_specs (model_year_id, displacement_cc, power_kw, power_cv, cylinders, euro, samples)');
lines.push('select v.model_year_id, v.displacement_cc, v.power_kw, v.power_cv, v.cylinders, v.euro, v.samples from (values');
lines.push(specRows.map((s) => `  (${q(s.my)}, ${num(s.disp)}::numeric, ${num(s.kw)}::numeric, ${num(s.cv)}::numeric, ${num(s.cyl)}::integer, ${normalizeEuro(s.euro) ? q(normalizeEuro(s.euro)!) : 'null'}::text, ${s.n})`).join(',\n'));
lines.push(') as v(model_year_id, displacement_cc, power_kw, power_cv, cylinders, euro, samples)');
lines.push('join public.ducati_catalog_model_years y on y.id = v.model_year_id');
lines.push('on conflict (model_year_id) do update set displacement_cc = excluded.displacement_cc, power_kw = excluded.power_kw, power_cv = excluded.power_cv, cylinders = excluded.cylinders, euro = excluded.euro, samples = excluded.samples, updated_at = now();');
writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`Écrit : ${outPath} (${patterns.length} motifs, ${specRows.length} fiches techniques)`);
