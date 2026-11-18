// M12 — Edge Function : transfert comptable automatique « EBP » (G8 : « transfert automatique tous
// les soirs / semaines / 15 jours / mois » + « envoi des fichiers par e-mail »). lot-g8-export-compta.
//
// Appelée chaque soir par pg_cron (tâche « accounting-auto-transfer », en-tête x-cron-secret). Pour
// chaque société dont la fréquence n'est PAS « off » (valeur par défaut : rien ne part) et dont le
// dernier transfert automatique est assez ancien, elle :
//   1. construit ECRITURES.TXT + COMPTES.TXT avec exactement la même logique que l'écran
//      (_shared/ebp-sources.ts + _shared/ebp-format.ts), période = depuis le dernier transfert jusqu'à
//      aujourd'hui, ventes / règlements / options cochées dans les paramètres ;
//   2. enregistre le transfert (record_accounting_transfer, mode « auto ») : historique, marquage ;
//   3. si « envoi par e-mail » est coché ET qu'une adresse est saisie (désactivé par défaut), envoie les
//      deux fichiers depuis la première boîte Outlook active de la société (Microsoft Graph).
//
// Accès : pg_cron (x-cron-secret) ou clé de service. Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (injectés), CRON_SECRET, et pour l'e-mail MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET.
//
// deno-lint-ignore-file
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identify } from '../_shared/acces.ts';
import { buildEbpTransfer } from '../_shared/ebp-format.ts';
import { autoTransferDue, loadEbpRules, loadEbpSettings, loadEbpSources, type EbpDbClient } from '../_shared/ebp-sources.ts';

const URL = Deno.env.get('SUPABASE_URL');
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TENANT = Deno.env.get('MS_GRAPH_TENANT_ID');
const CID = Deno.env.get('MS_GRAPH_CLIENT_ID');
const CSECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

async function graphToken(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null;
  const form = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (!res.ok) return null;
  return (await res.json()).access_token ?? null;
}

async function sendFiles(mailbox: string, to: string, subject: string, files: { name: string; content: string }[]): Promise<string | null> {
  const token = await graphToken();
  if (!token) return 'graph_not_configured';
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Text', content: subject },
        toRecipients: [{ emailAddress: { address: to } }],
        attachments: files.map((f) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: f.name, contentType: 'text/plain', contentBytes: b64(f.content) })),
      },
      saveToSentItems: true,
    }),
  });
  return res.ok ? null : `graph_${res.status}`;
}

Deno.serve(async (req) => {
  const caller = await identify(req);
  if (!caller || caller.kind === 'user') return json({ error: 'forbidden' }, 403);
  if (!URL || !SVC) return json({ error: 'not_configured' }, 500);
  const client = createClient(URL, SVC, { auth: { persistSession: false } });
  const db = client as unknown as EbpDbClient;
  const today = iso(new Date());
  const report: Record<string, unknown>[] = [];

  const { data: companies } = await client.from('companies').select('id, name, accounting_start_date').eq('is_active', true);
  for (const co of companies ?? []) {
    try {
      const settings = await loadEbpSettings(db, co.id);
      if (!settings.enabled || settings.auto.frequency === 'off') continue;
      const { data: last } = await client.from('accounting_transfers').select('created_at, period_to')
        .eq('company_id', co.id).eq('mode', 'auto').eq('status', 'transfere').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!autoTransferDue(settings.auto.frequency, last?.created_at ?? null, today)) continue;
      const from = last?.period_to ? iso(new Date(Date.parse(`${last.period_to}T00:00:00Z`) + 86400000)) : (co.accounting_start_date ?? today);
      const sel = {
        from, to: today, selection: 'period' as const,
        includeSales: settings.includeSales, includePayments: settings.includePayments, includePurchases: settings.includePurchases,
        includeCessions: settings.includeCessions, includeConsignments: settings.includeConsignments,
      };
      const rules = await loadEbpRules(db, co.id);
      const load = await loadEbpSources(db, co.id, sel, settings, rules);
      const result = buildEbpTransfer(load.sources, { writeMode: settings.writeMode, paymentsFirst: settings.paymentsFirst, dedupeThirds: settings.dedupeThirds });
      if (!result.items.length) { report.push({ company: co.name, skipped: 'empty' }); continue; }
      if (result.unbalanced.length) { report.push({ company: co.name, skipped: 'unbalanced', pieces: result.unbalanced }); continue; }
      const { data: rec, error } = await client.rpc('record_accounting_transfer', {
        _company: co.id,
        _t: {
          mode: 'auto', period_from: from, period_to: today, options: { ...sel, writeMode: settings.writeMode },
          file_dir: settings.targetDir, entries_file: settings.entriesFile, accounts_file: settings.accountsFile,
          ecritures: result.ecritures, comptes: result.comptes, pieces: result.pieces, lines: result.lines.length,
          total_debit: result.totalDebit, total_credit: result.totalCredit, items: result.items,
        },
      });
      if (error) { report.push({ company: co.name, error: error.message }); continue; }
      let mail: string | null = 'disabled';
      if (settings.auto.sendEmail && settings.auto.email) {
        const { data: box } = await client.from('company_mailboxes').select('address').eq('company_id', co.id).eq('is_active', true).limit(1).maybeSingle();
        mail = box?.address
          ? await sendFiles(box.address, settings.auto.email, `Transfert comptable n° ${rec?.transfer_no} - ${co.name} - ${from} au ${today}`,
            [{ name: settings.entriesFile, content: result.ecritures }, { name: settings.accountsFile, content: result.comptes }])
          : 'no_mailbox';
      }
      report.push({ company: co.name, transfer_no: rec?.transfer_no, lines: result.lines.length, mail: mail ?? 'sent' });
    } catch (e) {
      report.push({ company: co.name, error: String((e as Error)?.message ?? e) });
    }
  }
  return json({ ok: true, today, report });
});
