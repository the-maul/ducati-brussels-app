/**
 * M8 — Parcours mecanicien, lot 0 (19/11/2026) : adresse des figures du mode operatoire.
 *
 * Les 13 196 figures sont dans le bucket prive Supabase « wsm-images » (mission 07 carte 3). Elles
 * se lisent par **adresse signee** (lecture reservee a l'equipe, migration 20261119240000).
 * Seules les figures en taille reelle ont ete envoyees (`--figures-only`) : les vignettes
 * « .DMBI. » du manuel se rabattent sur la figure entiere.
 *
 * Developpement : si `VITE_MANUELS_BASE` est pose (copie locale `public/manuels/`), on garde
 * l'ancienne lecture directe (`figureUrl`).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { figureUrl } from './source';
import { figureStoragePath } from './figure-path';

export const WSM_BUCKET = 'wsm-images';
/** Duree de validite d'une adresse signee (secondes) : une session d'atelier. */
const SIGNED_TTL_S = 4 * 3600;
/** Marge avant expiration : au-dela, on redemande une adresse. */
const RENEW_MARGIN_MS = 10 * 60_000;

export { figureStoragePath };

function localBase(): string | null {
  const base = import.meta.env?.VITE_MANUELS_BASE as string | undefined;
  return base && base.trim() ? base : null;
}

type Entry = { url: string | null; expires: number };
const cache = new Map<string, Entry>();
const waiting = new Map<string, ((url: string | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Regroupe les demandes d'un meme rendu (une procedure = des dizaines de figures) en un appel. */
async function flush(): Promise<void> {
  timer = null;
  const batch = [...waiting.entries()];
  waiting.clear();
  const paths = batch.map(([p]) => p);
  if (!paths.length) return;
  let byPath = new Map<string, string | null>();
  try {
    const { data, error } = await supabase.storage.from(WSM_BUCKET).createSignedUrls(paths, SIGNED_TTL_S);
    if (error) throw error;
    byPath = new Map((data ?? []).map((d) => [d.path ?? '', d.error ? null : d.signedUrl ?? null]));
  } catch {
    byPath = new Map(paths.map((p) => [p, null]));
  }
  const expires = Date.now() + SIGNED_TTL_S * 1000;
  for (const [p, resolvers] of batch) {
    const url = byPath.get(p) ?? null;
    // Un echec n'est pas garde longtemps (reseau de l'atelier) : nouvel essai dans une minute.
    cache.set(p, { url, expires: url ? expires : Date.now() + 60_000 + RENEW_MARGIN_MS });
    for (const r of resolvers) r(url);
  }
}

/** Adresse signee d'une figure (null si introuvable ou acces refuse). */
export function signedFigureUrl(relativePath: string | null | undefined): Promise<string | null> {
  const base = localBase();
  if (base) return Promise.resolve(figureUrl(relativePath));
  const path = figureStoragePath(relativePath);
  if (!path) return Promise.resolve(null);
  const hit = cache.get(path);
  if (hit && hit.expires - RENEW_MARGIN_MS > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    const list = waiting.get(path) ?? [];
    list.push(resolve);
    waiting.set(path, list);
    timer ??= setTimeout(() => { void flush(); }, 0);
  });
}

/** Etat d'affichage : `undefined` = en cours de demande, `null` = figure indisponible. */
export function useFigureUrl(relativePath: string | null | undefined): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(() => {
    if (localBase()) return figureUrl(relativePath);
    const p = figureStoragePath(relativePath);
    const hit = p ? cache.get(p) : null;
    return hit && hit.expires - RENEW_MARGIN_MS > Date.now() ? hit.url : undefined;
  });
  useEffect(() => {
    let alive = true;
    void signedFigureUrl(relativePath).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [relativePath]);
  return url;
}

/** Pour les tests : vider le cache. */
export function __clearFigureCache(): void {
  cache.clear();
  waiting.clear();
}
