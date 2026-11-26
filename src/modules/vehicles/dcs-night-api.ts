/** Nightly DCS certification: SQL calls and commands to the browser extension (VEH001). */
import { supabase } from '@/integrations/supabase/client';
import type { DcsNightStatus } from './dcs-night-rules';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const dcsNightStatus = (company: string) => call<DcsNightStatus>('dcs_night_status', { _company: company });
export const dcsNightStart = (company: string) => call<DcsNightStatus>('dcs_night_start', { _company: company });
export const dcsNightPause = (company: string) => call<DcsNightStatus>('dcs_night_pause', { _company: company });
export const dcsNightResume = (company: string) => call<DcsNightStatus>('dcs_night_resume', { _company: company });
export const dcsNightApprovePilot = (company: string) => call<DcsNightStatus>('dcs_night_approve_pilot', { _company: company });
export const dcsNightNext = (company: string) => call<unknown>('dcs_night_next', { _company: company });
export const dcsNightMark = (company: string, queueId: string, ok: boolean, error: string | null) =>
  call<{ run_status: string; pause_reason: string | null }>('dcs_night_mark', { _company: company, _queue: queueId, _ok: ok, _error: error });

export type DcsNightExtensionState = { installed: boolean; armed: boolean; working: boolean; blocked: string | null };

/** Sends a command to the extension. Resolves to null when it is missing or too old. */
export function sendDcsNightCommand(cmd: 'ping' | 'arm' | 'abort' | 'status', companyId: string): Promise<DcsNightExtensionState | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const finish = (value: DcsNightExtensionState | null) => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(value);
    };
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as { source?: string; action?: string; id?: string; ok?: boolean; data?: DcsNightExtensionState } | null;
      if (ev.origin !== window.location.origin || !d || d.source !== 'dms-ducati-ext' || d.action !== 'dcs-night-cmd-reply' || d.id !== id) return;
      finish(d.ok && d.data ? d.data : null);
    };
    const timer = window.setTimeout(() => finish(null), 2500);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'dms-ducati', action: 'dcs-night-cmd', id, cmd, companyId }, window.location.origin);
  });
}
