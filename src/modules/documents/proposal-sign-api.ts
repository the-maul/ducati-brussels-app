/**
 * M9 — Appels de l'ecran de signature vers la fonction serveur `proposal-sign`
 * (supabase/functions/proposal-sign). Le navigateur ne touche jamais la base : la fonction
 * verifie le jeton, lit la proposition avec la cle de service, enregistre la signature en une
 * transaction (`proposal_apply_signature`), range le PDF signe en GED et l'envoie au client.
 */
import { supabase } from '@/integrations/supabase/client';
import { bytesToBase64 } from '@/modules/sales/document-mail-api';
import type { ProposalPayload, SignatureRecord } from './proposal-sign';

type FnResult<T> = { ok: true } & T | { ok: false; error: string };

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('proposal-sign', { body });
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    let code: string | undefined;
    if (ctx && typeof ctx.json === 'function') {
      try { code = ((await ctx.json()) as { error?: string })?.error; } catch { /* corps illisible */ }
    }
    throw new Error(code ?? error.message);
  }
  const r = data as FnResult<T>;
  if (!r?.ok) throw new Error((r as { error?: string })?.error ?? 'proposal_error');
  return r as T;
}

/** La proposition derriere un jeton (lignes, photos signees, etat), ou une erreur `unknown_link` / `expired`. */
export async function fetchProposal(token: string): Promise<ProposalPayload> {
  const r = await call<{ proposal: ProposalPayload }>({ action: 'get', token });
  return r.proposal;
}

export async function signProposal(p: {
  token: string; keptLineIds: string[]; signerName: string; mode: 'distance' | 'comptoir';
  signatureData: string | null; acceptedText: string; hash: string;
}): Promise<SignatureRecord> {
  const r = await call<{ signature: SignatureRecord }>({
    action: 'sign', token: p.token, keptLineIds: p.keptLineIds, signerName: p.signerName, mode: p.mode,
    signatureData: p.signatureData, acceptedText: p.acceptedText, hash: p.hash,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  });
  return r.signature;
}

/** Depose le PDF signe (GED du document et du client) et l'envoie par mail au client. */
export async function archiveSignedPdf(p: { token: string; signatureId: string; fileName: string; bytes: Uint8Array }): Promise<{ mailed: boolean; archived: boolean }> {
  const r = await call<{ mailed: boolean; archived: boolean }>({
    action: 'archive', token: p.token, signatureId: p.signatureId,
    pdf: { name: p.fileName, contentBytes: bytesToBase64(p.bytes) },
  });
  return { mailed: !!r.mailed, archived: !!r.archived };
}

/** Code d'erreur de la fonction → cle de libelle. */
export function proposalErrorKey(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const known = ['unknown_link', 'expired', 'already_signed', 'cancelled', 'missing_params', 'not_configured', 'sign_failed', 'archive_failed'];
  return known.includes(msg) ? `checkup.signErr_${msg}` : 'checkup.signErr_generic';
}
