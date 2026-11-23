/**
 * Choix de la moto par famille, cylindrée, version et année (retour de Domenico, 23/11/2026).
 * Règles pures.
 */
export const VEHICLE_BRANDS = [
  'DUCATI', 'APRILIA', 'BMW', 'BUELL', 'HARLEY-DAVIDSON', 'HONDA', 'KAWASAKI', 'KTM', 'MOTO GUZZI',
  'PIAGGIO', 'SUZUKI', 'TRIUMPH', 'YAMAHA',
] as const;

export const isDucatiBrand = (brand: unknown) => {
  const b = String(brand ?? '').trim().toUpperCase();
  return b === '' || b === 'DUCATI';
};

/** Années proposées pour une moto hors catalogue, la plus récente d'abord. */
export function yearOptions(now: number, from = 1970): string[] {
  const out: string[] = [];
  for (let y = now + 1; y >= from; y -= 1) out.push(String(y));
  return out;
}

type ModelRow = {
  supermodel_id: string; description: string; sort: number | null;
  supermodel: { description: string; sort: number | null } | null;
};

/** Les cylindrées d'une famille (620, 950, 1200…), une seule fois chacune, dans l'ordre du catalogue. */
export function superModelsOf(models: readonly ModelRow[]): { id: string; label: string }[] {
  const seen = new Map<string, { id: string; label: string; sort: number }>();
  for (const m of models) {
    if (seen.has(m.supermodel_id)) continue;
    seen.set(m.supermodel_id, {
      id: m.supermodel_id, label: m.supermodel?.description ?? m.description, sort: m.supermodel?.sort ?? Number.MAX_SAFE_INTEGER,
    });
  }
  return [...seen.values()]
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'fr', { numeric: true }))
    .map(({ id, label }) => ({ id, label }));
}
