/**
 * Lectures DCS en cours (Simon, 23/11/2026) : tant que l'onglet DCS travaille en arrière-plan, la
 * page affiche un chargement, y compris si on change d'écran. Sans réponse, le chargement s'arrête
 * et le dit.
 */
import { useSyncExternalStore } from 'react';

export const DCS_TIMEOUT_MS = 120_000;

const NONE: readonly string[] = [];
let running: readonly string[] = NONE;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const timeoutListeners = new Set<(vin: string) => void>();

const keyOf = (vin: string) => vin.trim().toUpperCase();

function publish(next: readonly string[]) {
  running = next.length ? next : NONE;
  listeners.forEach((fn) => fn());
}

export function dcsFinish(vin: string | null | undefined): void {
  const key = keyOf(vin ?? '');
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
  if (running.includes(key)) publish(running.filter((x) => x !== key));
}

export function dcsStart(vin: string, timeoutMs = DCS_TIMEOUT_MS): void {
  const key = keyOf(vin);
  if (!key) return;
  const previous = timers.get(key);
  if (previous) clearTimeout(previous);
  timers.set(key, setTimeout(() => {
    dcsFinish(key);
    timeoutListeners.forEach((fn) => fn(key));
  }, timeoutMs));
  if (!running.includes(key)) publish([...running, key]);
}

export const dcsRunning = () => running;

export function onDcsTimeout(fn: (vin: string) => void): () => void {
  timeoutListeners.add(fn);
  return () => { timeoutListeners.delete(fn); };
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useDcsRunning(): readonly string[] {
  return useSyncExternalStore(subscribe, dcsRunning, () => NONE);
}
