/** Pure rules of the nightly DCS certification screen (VEH001). */

export type DcsNightRunStatus = 'running' | 'pilot_wait' | 'paused' | 'finished';

export type DcsNightStatus = {
  eligible: boolean;
  in_window?: boolean;
  run?: {
    status: DcsNightRunStatus;
    pause_reason: string | null;
    pilot_limit: number;
    pilot_approved: boolean;
    consecutive_failures: number;
  } | null;
  counts?: { total: number; done: number; failed: number; remaining: number; touched: number };
  last?: { vin: string; status: string; last_error: string | null; processed_at: string | null } | null;
};

export type DcsNightDisplay = 'not_started' | 'waiting' | 'running' | 'paused' | 'pilot_wait' | 'finished';

export function dcsNightDisplay(s: DcsNightStatus | null | undefined): DcsNightDisplay {
  const run = s?.run;
  if (!run) return 'not_started';
  if (run.status === 'running') return s?.in_window ? 'running' : 'waiting';
  return run.status;
}

/** About 48 s per bike: 27.5 s pause plus page load and reading. */
export const DCS_NIGHT_CYCLE_SECONDS = 48;
const NIGHT_SECONDS = 10 * 3600;

export function estimateNights(remaining: number, cycleSeconds = DCS_NIGHT_CYCLE_SECONDS): number {
  if (!(remaining > 0)) return 0;
  const perNight = Math.max(1, Math.floor(NIGHT_SECONDS / cycleSeconds));
  return Math.ceil(remaining / perNight);
}

/** A bike is certified only if the import really found it and did not refuse it. */
export function dcsNightApplyError(result: { matched?: boolean; refused?: unknown } | null | undefined): string | null {
  if (result?.refused) return 'refused';
  if (!result || result.matched !== true) return 'not_found';
  return null;
}
