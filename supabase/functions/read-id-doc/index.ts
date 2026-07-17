/**
 * M1 — Lecture automatique des documents d'identité (permis de conduire /
 * carte d'identité) : télécharge les scans depuis la GED (bucket 'ged') et
 * les fait lire par Claude (vision) pour préremplir la fiche client.
 *
 * Déploiement : `supabase functions deploy read-id-doc`
 * Secret requis : `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
 *
 * Entrée  : POST { paths: string[] }  (storage paths du bucket 'ged', max 4)
 * Sortie  : { data: { first_name, last_name, birth_date, national_register,
 *             national_id_number, license_number, license_categories,
 *             license_date, license_place } }  — null pour les champs illisibles
 */
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    first_name: { type: ["string", "null"] },
    last_name: { type: ["string", "null"] },
    birth_date: { type: ["string", "null"], description: "Format YYYY-MM-DD" },
    national_register: { type: ["string", "null"], description: "N° registre national belge, ex. 78.11.17-123.45" },
    national_id_number: { type: ["string", "null"], description: "N° de la carte d'identite" },
    license_number: { type: ["string", "null"], description: "N° du permis de conduire" },
    license_categories: { type: ["array", "null"], items: { type: "string" } },
    license_date: { type: ["string", "null"], description: "Date de delivrance du permis, YYYY-MM-DD" },
    license_place: { type: ["string", "null"], description: "Lieu / autorite de delivrance du permis" },
  },
  required: [
    "first_name", "last_name", "birth_date", "national_register", "national_id_number",
    "license_number", "license_categories", "license_date", "license_place",
  ],
  additionalProperties: false,
} as const;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "not_configured" }, 500);

    const { paths } = await req.json() as { paths?: string[] };
    if (!Array.isArray(paths) || paths.length === 0) return json({ error: "no_paths" }, 400);

    // Téléchargement des scans depuis la GED (service role — la fonction est
    // appelée par un utilisateur authentifié via supabase.functions.invoke)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const path of paths.slice(0, 4)) {
      const { data, error } = await supabase.storage.from("ged").download(path);
      if (error || !data) continue;
      const contentType = data.type || "application/octet-stream";
      const b64 = toBase64(await data.arrayBuffer());
      if (contentType === "application/pdf") {
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
      } else if (IMAGE_TYPES.includes(contentType)) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: b64 },
        });
      }
    }
    if (blocks.length === 0) return json({ error: "no_readable_files" }, 400);

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      output_config: {
        format: { type: "json_schema", schema: EXTRACT_SCHEMA },
      },
      messages: [{
        role: "user",
        content: [
          ...blocks,
          {
            type: "text",
            text: "Ces images sont des documents d'identite belges d'un client " +
              "(permis de conduire et/ou carte d'identite, recto et/ou verso). " +
              "Extrais les informations demandees par le schema. Regles : " +
              "dates au format YYYY-MM-DD ; registre national au format XX.XX.XX-XXX.XX ; " +
              "license_categories = liste des categories du permis (AM, A1, A2, A, B, ...) ; " +
              "null pour tout champ absent ou illisible. N'invente jamais une valeur.",
          },
        ],
      }],
    });

    if (response.stop_reason === "refusal") return json({ error: "refused" }, 422);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "empty" }, 500);
    return json({ data: JSON.parse(text.text) });
  } catch (e) {
    console.error("read-id-doc:", e);
    return json({ error: "read_failed", detail: String(e) }, 500);
  }
});
