/**
 * M8 — Parcours mecanicien, lot 0 (19/11/2026) : chemin d'une figure du manuel dans le bucket
 * « wsm-images ». Regle pure (testee dans tests/workshop-pointage.test.ts).
 *
 * Le chargeur (tools/wsm-loader/images.mjs) range l'objet au chemin local sans « images/ » et n'a
 * envoye que les figures en taille reelle (`--figures-only`) : la vignette « .DMBI. » du manuel se
 * rabat sur la figure entiere.
 */
export function figureStoragePath(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  const p = String(relativePath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^images\//, '')
    .replace(/\.DMBI\./i, '.');
  return p || null;
}
