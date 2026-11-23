/**
 * Calls from the extension during the nightly DCS certification (VEH001).
 * Closed list on purpose: start, resume and pilot approval are never reachable from here,
 * they stay on the administrator's buttons.
 */
import { applyMyDucatiData, type MyDucatiPayload } from '@/lib/myducati';
import { dcsNightMark, dcsNightNext } from './dcs-night-api';
import { dcsNightApplyError } from './dcs-night-rules';

export type DcsNightCall = { source: 'dms-ducati-ext'; action: 'dcs-night-call'; id: string; fn: string; args?: Record<string, unknown> };
export type DcsNightReply = { source: 'dms-ducati'; action: 'dcs-night-reply'; id: string; ok: boolean; data?: unknown; error?: string; code?: string };
export type DcsNightContext = { companyId: string | null; isAdmin: boolean };

export type DcsNightDeps = {
  next: (company: string) => Promise<unknown>;
  mark: (company: string, queueId: string, ok: boolean, error: string | null) => Promise<unknown>;
  apply: (company: string, payload: MyDucatiPayload) => Promise<{ matched?: boolean; refused?: unknown }>;
};

const defaultDeps: DcsNightDeps = { next: dcsNightNext, mark: dcsNightMark, apply: applyMyDucatiData };

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** The run belongs to one company: the tab must be on that same company, as an administrator. */
function runCompany(args: Record<string, unknown>, ctx: DcsNightContext): string {
  const company = text(args.companyId);
  if (!company || company !== ctx.companyId) throw coded('company_mismatch');
  if (!ctx.isAdmin) throw coded('forbidden');
  return company;
}

async function applyScrape(args: Record<string, unknown>, ctx: DcsNightContext, deps: DcsNightDeps): Promise<unknown> {
  const company = text(args.companyId);
  const queueId = text(args.queueId);
  if (!company || !queueId) throw coded('bad_request');

  // Refused before anything is written: the same VIN can exist in the test company.
  if (company !== ctx.companyId) return deps.mark(company, queueId, false, 'company_mismatch');
  if (!ctx.isAdmin) throw coded('forbidden');

  const payload = args.payload as MyDucatiPayload | undefined;
  if (!payload || !text(args.vin) || payload.vin !== args.vin) return deps.mark(company, queueId, false, 'vin_mismatch');

  let error: string | null;
  try {
    error = dcsNightApplyError(await deps.apply(company, payload));
  } catch {
    error = 'apply_error';
  }
  return deps.mark(company, queueId, error === null, error);
}

const CALLS: Record<string, (args: Record<string, unknown>, ctx: DcsNightContext, deps: DcsNightDeps) => Promise<unknown>> = {
  hello: async (_args, ctx) => ({ companyId: ctx.companyId, isAdmin: ctx.isAdmin }),
  next: async (args, ctx, deps) => deps.next(runCompany(args, ctx)),
  mark: async (args, ctx, deps) => {
    if (!ctx.isAdmin) throw coded('forbidden');
    // A failure is always recorded on the run's company, whichever company the tab shows.
    return deps.mark(text(args.companyId), text(args.queueId), false, text(args.error) || 'error');
  },
  apply: applyScrape,
};

export function isDcsNightCall(ev: Pick<MessageEvent, 'data' | 'origin'>, win: { location: { origin: string } }): boolean {
  const d = ev.data as Partial<DcsNightCall> | null;
  return !!d && d.source === 'dms-ducati-ext' && d.action === 'dcs-night-call' && typeof d.id === 'string'
    && typeof d.fn === 'string' && ev.origin === win.location.origin;
}

export async function handleDcsNightCall(msg: DcsNightCall, ctx: DcsNightContext, deps: DcsNightDeps = defaultDeps): Promise<DcsNightReply> {
  const base = { source: 'dms-ducati' as const, action: 'dcs-night-reply' as const, id: msg.id };
  const handler = Object.prototype.hasOwnProperty.call(CALLS, msg.fn) ? CALLS[msg.fn] : undefined;
  if (!handler) return { ...base, ok: false, code: 'unknown', error: 'unknown' };
  try {
    return { ...base, ok: true, data: await handler(msg.args ?? {}, ctx, deps) };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return { ...base, ok: false, code: err?.code || 'error', error: err?.message || 'error' };
  }
}
