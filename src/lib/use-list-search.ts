/**
 * Branchement React de l'etat des listes dans l'adresse (UX011) — logique pure : `list-search.ts`.
 *
 * `useListSearch(DEFAULTS)` rend les valeurs lues dans l'adresse et un `set(patch)` qui
 * reecrit l'adresse en `replace` (une frappe ou un filtre ne cree pas d'entree d'historique :
 * Retour depuis la liste quitte la liste, il ne defait pas les filtres un par un) et sans
 * remonter en haut de page (`resetScroll: false`).
 *
 * Plusieurs `set` dans le meme tour (filtre + retour en page 1) sont fusionnes en une seule
 * navigation, appliquee sur l'adresse la plus recente.
 *
 * `useSearchText` : la case de recherche garde sa frappe en local (pas de saccade) et
 * n'ecrit dans l'adresse qu'apres une courte pause.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearch } from '@tanstack/react-router';
import { applyListPatch, readListSearch, type ListChoices, type ListValues } from './list-search';

type Router = ReturnType<typeof useRouter>;
type Step = (prev: Record<string, unknown>) => Record<string, unknown>;

let queue: Step[] = [];
let queuedRouter: Router | null = null;

function flush() {
  const router = queuedRouter;
  const steps = queue;
  queue = [];
  queuedRouter = null;
  if (!router || steps.length === 0) return;
  const pathname = router.state.location.pathname;
  // Route courante, recherche recalculee : typage generique (la liste ne connait pas sa route).
  void router.navigate({
    to: pathname,
    search: (prev: Record<string, unknown>) => steps.reduce((acc, step) => step(acc), { ...(prev ?? {}) }),
    replace: true,
    resetScroll: false,
  } as never);
}

export type ListPatch<T> = Partial<T> | ((current: T) => Partial<T>);

export function useListSearch<T extends ListValues>(defaults: T, choices?: ListChoices<T>): [T, (patch: ListPatch<T>) => void] {
  const raw = useSearch({ strict: false }) as Record<string, unknown>;
  const router = useRouter();
  const defaultsRef = useRef(defaults);
  const choicesRef = useRef(choices);
  const values = useMemo(() => readListSearch(raw, defaultsRef.current, choicesRef.current), [raw]);

  const set = useCallback((patch: ListPatch<T>) => {
    const d = defaultsRef.current;
    const c = choicesRef.current;
    queue.push((prev) => {
      const current = readListSearch(prev, d, c);
      const p = typeof patch === 'function' ? patch(current) : patch;
      return applyListPatch(prev, p, d, c);
    });
    if (!queuedRouter) {
      queuedRouter = router;
      queueMicrotask(flush);
    }
  }, [router]);

  return [values, set];
}

/**
 * Case de recherche liee a l'adresse. `value` = valeur dans l'adresse ; `commit` est appele
 * apres `delay` ms sans frappe, seulement si le texte a change.
 */
export function useSearchText(value: string, commit: (v: string) => void, delay = 300): [string, (v: string) => void] {
  const [text, setText] = useState(value);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  // L'adresse change sans frappe (Retour, bouton « Effacer les filtres ») : la case suit.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setText(value);
  }, [value]);
  useEffect(() => {
    if (!typed.current) return;
    const id = setTimeout(() => {
      typed.current = false;
      if (text !== value) commitRef.current(text);
    }, delay);
    return () => clearTimeout(id);
  }, [text, value, delay]);
  const onChange = useCallback((v: string) => {
    typed.current = true;
    setText(v);
  }, []);
  return [text, onChange];
}

/**
 * Comme un `useEffect`, mais jamais au premier rendu : les remises a zero « quand X change »
 * (societe, critere) ne doivent pas effacer l'etat relu dans l'adresse au retour sur la liste.
 * Une valeur qui passe de vide a renseignee (societe chargee apres coup) ne compte pas non plus.
 */
export function useOnChange(value: unknown, fn: () => void): void {
  const prev = useRef(value);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before == null || before === value) return;
    fnRef.current();
  }, [value]);
}
