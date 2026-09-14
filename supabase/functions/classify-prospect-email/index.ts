/**
 * M1/M10 — Analyse d'un mail entrant d'expéditeur inconnu : est-ce un prospect ?
 * Réf. docs/plan-nouveau-client.md (lot 1, décision client D1).
 *
 * Un seul appel à Claude, sortie au format imposé. Ce n'est PAS un agent : il n'y
 * a ni boucle ni outil, c'est une classification suivie d'une extraction.
 *
 * La fonction ne crée rien : elle rend un verdict. C'est `outlook-poll` qui
 * appelle ensuite `create_prospect_from_email` ou `log_ignored_email`.
 *
 * Déploiement : `supabase functions deploy classify-prospect-email`
 * Secret requis : ANTHROPIC_API_KEY (déjà posé, utilisé par read-id-doc)
 *
 * Entrée : POST { from, subject, body, to? }
 * Sortie : { data: { is_prospect, reason, is_professional, first_name, last_name,
 *                    company_name, vat_number, phone, interest, request_summary } }
 */
import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    is_prospect: {
      type: "boolean",
      description:
        "true UNIQUEMENT si l'expediteur est un particulier ou une entreprise qui s'adresse a la concession " +
        "pour une demande liee a un vehicule, une piece, un accessoire, un entretien ou un renseignement commercial.",
    },
    reason: {
      type: "string",
      description:
        "Motif court du verdict, en francais. Si is_prospect est false, dire pourquoi : " +
        "fournisseur, newsletter, message interne, Ducati, automatique, indesirable, sans objet commercial.",
    },
    is_professional: {
      type: "boolean",
      description:
        "true si l'expediteur ecrit au nom d'une entreprise : numero de TVA, raison sociale, " +
        "signature professionnelle ou domaine d'entreprise. false pour un particulier.",
    },
    first_name: { type: ["string", "null"], description: "Prenom, tel qu'il apparait. null si absent." },
    last_name: { type: ["string", "null"], description: "Nom de famille. null si absent." },
    company_name: { type: ["string", "null"], description: "Raison sociale si professionnel. null sinon." },
    vat_number: { type: ["string", "null"], description: "Numero de TVA, ex. BE0123456789. null si absent." },
    phone: { type: ["string", "null"], description: "Numero de telephone trouve dans le message ou la signature." },
    interest: {
      type: ["string", "null"],
      description: "Objet de l'interet en quelques mots, ex. 'Panigale V2 occasion', 'plaquettes Monster 937'.",
    },
    request_summary: {
      type: ["string", "null"],
      description: "Resume de la demande en une phrase, en francais, reprenant les faits du mail.",
    },
  },
  required: [
    "is_prospect", "reason", "is_professional", "first_name", "last_name",
    "company_name", "vat_number", "phone", "interest", "request_summary",
  ],
  additionalProperties: false,
} as const;

const INSTRUCTIONS = [
  "Tu analyses un e-mail recu par la concession Ducati Bruxelles (Italbike).",
  "",
  "Decide d'abord si l'expediteur est un PROSPECT, c'est-a-dire quelqu'un qui s'adresse a la",
  "concession pour une demande commerciale : un vehicule, une piece, un accessoire, un entretien,",
  "un rendez-vous, un prix, une disponibilite, une reprise.",
  "",
  "N'est PAS un prospect : un fournisseur, une newsletter ou une publicite, un message de Ducati",
  "ou d'un importateur, une reponse automatique, un accuse de reception, un message interne, une",
  "candidature, un indesirable, une facture recue, un message sans objet commercial.",
  "",
  "Si ce n'est pas un prospect, mets is_prospect a false et explique en quelques mots dans reason.",
  "Les autres champs peuvent rester nuls.",
  "",
  "Si c'est un prospect, extrais ce que le mail contient reellement : prenom, nom, societe, numero",
  "de TVA, telephone, objet de l'interet, resume de la demande. Sers-toi de la signature.",
  "N'invente jamais une valeur : si une information est absente, mets null.",
  "",
  "is_professional vaut true si l'expediteur ecrit au nom d'une entreprise (numero de TVA, raison",
  "sociale, signature professionnelle). Une adresse gmail ou hotmail seule ne suffit pas a conclure.",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "not_configured" }, 500);

    const { from, subject, body, to } = await req.json() as {
      from?: string; subject?: string; body?: string; to?: string;
    };
    if (!from || typeof from !== "string") return json({ error: "no_sender" }, 400);

    // Le corps peut etre tres long (fils de discussion, signatures HTML converties).
    // On borne : l'essentiel d'une demande tient dans les premiers milliers de caracteres.
    const trimmedBody = (body ?? "").slice(0, 12000);

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: VERDICT_SCHEMA },
      },
      messages: [{
        role: "user",
        content: [{
          type: "text",
          text: [
            INSTRUCTIONS,
            "",
            "--- MAIL A ANALYSER ---",
            `De : ${from}`,
            to ? `A : ${to}` : "",
            `Objet : ${subject ?? "(sans objet)"}`,
            "",
            trimmedBody || "(corps vide)",
          ].filter(Boolean).join("\n"),
        }],
      }],
    });

    if (response.stop_reason === "refusal") return json({ error: "refused" }, 422);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "empty" }, 500);
    return json({ data: JSON.parse(text.text) });
  } catch (e) {
    console.error("classify-prospect-email:", e);
    return json({ error: "classify_failed", detail: String(e) }, 500);
  }
});
