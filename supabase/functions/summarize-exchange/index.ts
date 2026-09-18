/**
 * M10 — Résumer chaque échange dans la note de sa demande.
 *
 * Demande client du 18/09 : « dans la note (qui reprend la demande), mets à jour
 * avec un petit paragraphe par échange qui résume où ça en est ».
 *
 * Fonctionnement :
 *   - `pending_exchange_summaries` donne les échanges pas encore résumés (e-mails,
 *     appels, SMS d'une demande ouverte, postérieurs à sa création), du plus ancien
 *     au plus récent ;
 *   - pour chacun, UN appel à Claude produit un paragraphe court ;
 *   - `append_lead_exchange_note` l'ajoute à la note, UNE SEULE FOIS par échange
 *     (et marque les copies du même envoi relevées dans une autre boîte).
 *
 * Le premier échec arrête le passage : les paragraphes restent dans l'ordre
 * chronologique, et l'échange en échec sera repris au passage suivant.
 *
 * Appelée par `outlook-poll` à la fin de chaque relève (toutes les 5 minutes).
 * Réservée à la clé de service : chaque appel coûte un appel à Claude.
 *
 * Secret requis : ANTHROPIC_API_KEY.
 */
import Anthropic from "npm:@anthropic-ai/sdk";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const URL = Deno.env.get("SUPABASE_URL");
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SVC!, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

type Pending = {
  communication_id: string; lead_id: string; lead_name: string; lead_notes: string | null;
  channel: string; direction: string; subject: string | null; body: string | null;
  occurred_at: string; mailbox: string | null; from_address: string | null;
};

const SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "Un paragraphe court, 1 a 3 phrases, en francais, factuel : ce que cet echange apporte " +
        "et ou en est la demande. Chaine vide si l'echange n'apporte rien (accuse de reception, " +
        "message vide, reponse automatique).",
    },
  },
  required: ["summary"],
  additionalProperties: false,
} as const;

const INSTRUCTIONS = [
  "Tu tiens a jour la note de suivi d'une demande client dans le CRM de la concession Ducati Bruxelles.",
  "La note raconte la demande ; tu y ajoutes UN paragraphe court pour le nouvel echange ci-dessous.",
  "",
  "Dis ce que cet echange apporte de NOUVEAU et ou en est la demande : une question du client, une",
  "reponse de la concession, un prix, une disponibilite, un rendez-vous, une piece jointe, ce qui",
  "reste a faire si c'est dit. Reste factuel, n'invente rien, pas de formule de politesse.",
  "",
  "Le corps d'un e-mail contient souvent l'historique cite en dessous (lignes 'De :', 'Le ... a ecrit',",
  "'>' ) et des signatures : ignore-les, ne resume que le message nouveau, en haut.",
  "N'ecris pas la date ni l'auteur : ils sont ajoutes automatiquement devant ton paragraphe.",
  "Si l'echange n'apporte rien d'utile, rends une chaine vide.",
].join("\n");

/** Réponses d'agenda et accusés automatiques : pas un échange avec le client. */
function isNoise(p: Pending): boolean {
  const s = (p.subject ?? "").trim().toLowerCase();
  const empty = !(p.body ?? "").trim();
  if (/^(accept[ée]|accepted|refus[ée]|declined|provisoire|tentative|annul[ée]|canceled|cancelled)\s*:/.test(s)) return true;
  if (/^(out of office|absence du bureau|automatic reply|r[ée]ponse automatique)/.test(s)) return true;
  return empty && !s;
}

const TZ = "Europe/Brussels";
function stamp(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("fr-BE", { timeZone: TZ, day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("fr-BE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}

/** Qui a parlé, et par quel moyen — écrit par nous, pas par le modèle. */
function label(p: Pending): string {
  const inbound = p.direction === "in";
  if (p.channel === "email") return inbound ? "E-mail du client" : `E-mail envoyé${p.mailbox ? ` depuis ${p.mailbox}` : ""}`;
  if (p.channel === "call") return inbound ? "Appel reçu du client" : "Appel passé au client";
  if (p.channel === "sms") return inbound ? "SMS du client" : "SMS envoyé au client";
  return "Échange";
}

Deno.serve(async (req) => {
  // Réservé à la clé de service : la relève est le seul appelant légitime.
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${SVC}`) return J({ error: "forbidden" }, 403);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return J({ error: "not_configured" }, 500);

  let limit = 5;
  try { const b = await req.json(); if (Number.isFinite(b?.limit)) limit = Math.max(1, Math.min(20, b.limit)); } catch { /* corps vide */ }

  const pending = (await rpc("pending_exchange_summaries", { _limit: limit })) as Pending[] ?? [];
  const anthropic = new Anthropic({ apiKey });
  let summarized = 0, skipped = 0;
  const errors: string[] = [];

  for (const p of pending) {
    try {
      if (isNoise(p)) {
        await rpc("append_lead_exchange_note", { _comm: p.communication_id, _lead: p.lead_id, _text: "" });
        skipped++;
        continue;
      }
      const response = await anthropic.messages.create({
        model: "claude-opus-5",
        max_tokens: 1024,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{
          role: "user",
          content: [{
            type: "text",
            text: [
              INSTRUCTIONS,
              "",
              `--- DEMANDE : ${p.lead_name} ---`,
              "Note actuelle (pour le contexte, ne la repete pas) :",
              (p.lead_notes ?? "(vide)").slice(-4000),
              "",
              `--- NOUVEL ECHANGE : ${label(p)}, le ${stamp(p.occurred_at)} ---`,
              p.subject ? `Objet : ${p.subject}` : "",
              "",
              (p.body ?? "").slice(0, 8000) || "(corps vide)",
            ].filter((l) => l !== undefined).join("\n"),
          }],
        }],
      });
      if (response.stop_reason === "refusal") throw new Error("refused");
      const block = response.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("empty");
      const summary = String(JSON.parse(block.text).summary ?? "").trim();

      const text = summary ? `— ${stamp(p.occurred_at)} · ${label(p)} : ${summary}` : "";
      await rpc("append_lead_exchange_note", { _comm: p.communication_id, _lead: p.lead_id, _text: text });
      if (summary) summarized++; else skipped++;
    } catch (e) {
      // On s'arrête : l'ordre chronologique de la note prime. Repris au prochain passage.
      errors.push(`${p.communication_id.slice(0, 8)}: ${String(e).slice(0, 160)}`);
      break;
    }
  }
  return J({ pending: pending.length, summarized, skipped, errors });
});
