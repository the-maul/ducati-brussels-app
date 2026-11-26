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
 *
 * MODE « carte_grise » (mission 04, carte 7) : POST { paths, mode: 'carte_grise' } lit un
 * certificat d'immatriculation belge (parties I et II, photo ou PDF) et renvoie
 * { data: MappedCarteGrise } : champs du formulaire véhicule (vin, plate, first_registration_date,
 * brand, model, displacement, power_kw, power_cv, energy, antipollution, color), un indice de
 * confiance par champ (high / medium / low), les cases lues mais non reprises et le titulaire.
 * Schéma, consigne et mappage : ../_shared/carte-grise.ts (testé par tests/carte-grise.test.ts).
 * Même accès, même téléchargement, même modèle que la lecture d'identité.
 *
 * MODE « document » (M9, 26/11/2026) : POST { mode: 'document', attachment_id, keep_folder? } lit
 * N'IMPORTE QUEL fichier ajouté à une fiche client ou moto (PDF ou photo) : type de pièce, dossier de
 * rangement, informations utiles (moto, client, ticket/facture). Enregistre le résultat sur le fichier
 * (attachments.doc_kind / extracted / read_at / read_status) et range le fichier, sans toucher aux
 * fiches. Schéma, consigne, nettoyage : ../_shared/doc-reading.ts (tests/lecture-fichiers.test.ts).
 * Modèle claude-opus-5-5 avec repli serveur en cas de refus.
 *
 * ACCÈS (lot sécurité S, 19/09) : clé de service, ou utilisateur connecté membre actif de la
 * société à laquelle appartient CHAQUE fichier (1er segment du chemin GED = company_id).
 * Avant : aucun contrôle — quiconque connaissait un chemin obtenait l'extraction d'une pièce
 * d'identité et consommait du crédit Anthropic.
 */
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { activeCompaniesOf, identify, isUuid, type Caller } from "../_shared/acces.ts";
import { CARTE_GRISE_PROMPT, CARTE_GRISE_SCHEMA, mapCarteGrise, type RawCarteGrise } from "../_shared/carte-grise.ts";
import {
  DOCUMENT_PROMPT, DOCUMENT_SCHEMA, folderFor, readableStatus, sanitizeReading, type ReadStatus,
} from "../_shared/doc-reading.ts";

/** Modèle de la lecture « document » (M9, 26/11/2026) : le plus récent, repli automatique en cas de refus. */
const DOCUMENT_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

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

    const caller = await identify(req);
    if (!caller || caller.kind === "cron") return json({ error: "not_signed_in" }, 401);

    const body = await req.json() as { paths?: string[]; mode?: string; attachment_id?: string; keep_folder?: boolean };
    const { paths, mode } = body;
    if (mode === "document") return await readDocument(caller, body.attachment_id, body.keep_folder === true, apiKey, json);
    if (mode !== undefined && mode !== "identity" && mode !== "carte_grise") return json({ error: "bad_mode" }, 400);
    const isCarteGrise = mode === "carte_grise";
    if (!Array.isArray(paths) || paths.length === 0) return json({ error: "no_paths" }, 400);
    if (paths.some((p) => typeof p !== "string" || p.includes(".."))) return json({ error: "bad_path" }, 400);

    // Chemin GED = <company_id>/<entité>/<id>/<fichier> : chaque fichier doit appartenir
    // à une société dont l'appelant est membre actif.
    if (caller.kind === "user") {
      const companies = await activeCompaniesOf(caller.id);
      if (!paths.slice(0, 4).every((p) => companies.includes(p.split("/")[0]))) {
        return json({ error: "forbidden" }, 403);
      }
    }

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

    // Mission 04, carte 7 : carte grise → champs du formulaire véhicule + confiance.
    if (isCarteGrise) {
      const cg = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 2048,
        output_config: {
          format: { type: "json_schema", schema: CARTE_GRISE_SCHEMA },
        },
        messages: [{ role: "user", content: [...blocks, { type: "text", text: CARTE_GRISE_PROMPT }] }],
      });
      if (cg.stop_reason === "refusal") return json({ error: "refused" }, 422);
      const cgText = cg.content.find((b) => b.type === "text");
      if (!cgText || cgText.type !== "text") return json({ error: "empty" }, 500);
      return json({ data: mapCarteGrise(JSON.parse(cgText.text) as RawCarteGrise) });
    }

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
    // Crédit de la clé épuisé : ce n'est pas la photo, l'écran doit le dire.
    if (/credit balance/i.test(String(e))) return json({ error: "no_credit" });
    return json({ error: "read_failed", detail: String(e) }, 500);
  }
});

type Json = (body: unknown, status?: number) => Response;

/**
 * MODE « document » (M9, 26/11/2026) : lit UN fichier de la GED (fiche client ou moto), reconnaît son
 * type, range le fichier dans le dossier du type (sauf dossier choisi par l'utilisateur) et garde ce
 * qu'elle a lu sur le fichier (attachments.doc_kind / extracted / read_at / read_status). Les fiches
 * ne sont PAS modifiées ici : l'écran propose, l'utilisateur clique (tracé dans events par l'écran).
 * Accès : membre actif de la société du fichier (ou clé de service).
 */
async function readDocument(caller: Caller, attachmentId: unknown, keepFolder: boolean, apiKey: string, json: Json): Promise<Response> {
  if (caller.kind === "cron") return json({ error: "not_signed_in" }, 401);
  if (!isUuid(attachmentId)) return json({ error: "bad_attachment" }, 400);
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: att, error: ae } = await svc.from("attachments")
    .select("id, company_id, entity_type, entity_id, file_name, storage_path, content_type, size_bytes, folder")
    .eq("id", attachmentId).maybeSingle();
  if (ae || !att) return json({ error: "not_found" }, 404);
  if (typeof att.storage_path !== "string" || att.storage_path.split("/")[0] !== att.company_id || att.storage_path.includes("..")) {
    return json({ error: "bad_path" }, 400);
  }
  if (caller.kind === "user" && !(await activeCompaniesOf(caller.id)).includes(att.company_id)) {
    return json({ error: "forbidden" }, 403);
  }
  const actor = caller.kind === "user" ? caller.id : null;
  const mark = async (status: ReadStatus) => {
    await svc.from("attachments").update({ read_status: status, read_at: new Date().toISOString() }).eq("id", att.id);
  };

  const { data: blob, error: de } = await svc.storage.from("ged").download(att.storage_path);
  if (de || !blob) { await mark("failed"); return json({ error: "read_failed" }); }
  const contentType = (att.content_type || blob.type || "").toLowerCase();
  const refusedFormat = readableStatus(contentType, blob.size);
  if (refusedFormat) { await mark(refusedFormat); return json({ error: refusedFormat }); }

  const b64 = toBase64(await blob.arrayBuffer());
  const block: Anthropic.ContentBlockParam = contentType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: b64 } };

  const anthropic = new Anthropic({ apiKey });
  const request = {
    model: DOCUMENT_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" as const, format: { type: "json_schema" as const, schema: DOCUMENT_SCHEMA } },
    messages: [{ role: "user" as const, content: [block, { type: "text" as const, text: `Nom du fichier : ${att.file_name}\n\n${DOCUMENT_PROMPT}` }] }],
  };
  let stop: string | null = null;
  let out = "";
  try {
    let msg: { stop_reason: string | null; content: Array<{ type: string; text?: string }> };
    try {
      // Repli serveur : si le modèle décline, l'API relance la même demande sur un autre modèle.
      // deno-lint-ignore no-explicit-any
      msg = await (anthropic.beta.messages.create as any)({ ...request, betas: [FALLBACK_BETA], fallbacks: "default" });
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      // Option de repli refusée par l'API (compte sans la bêta) : même demande, sans repli.
      // deno-lint-ignore no-explicit-any
      msg = await (anthropic.messages.create as any)(request);
    }
    stop = msg.stop_reason;
    out = msg.content.find((b) => b.type === "text")?.text ?? "";
  } catch (e) {
    console.error("read-id-doc document:", e);
    if (/credit balance/i.test(String(e))) { await mark("no_credit"); return json({ error: "no_credit" }); }
    await mark("failed");
    return json({ error: "read_failed" });
  }
  if (stop === "refusal") { await mark("refused"); return json({ error: "refused" }); }
  let parsed: unknown;
  try { parsed = JSON.parse(out); } catch { await mark("failed"); return json({ error: "read_failed" }); }

  const reading = sanitizeReading(parsed);
  const folder = folderFor(reading.doc_kind, att.folder ?? null, keepFolder);
  const readAt = new Date().toISOString();
  const { error: ue } = await svc.from("attachments").update({
    doc_kind: reading.doc_kind, extracted: reading, read_at: readAt, read_status: "done", folder,
  }).eq("id", att.id);
  if (ue) { console.error("read-id-doc document update:", ue); return json({ error: "save_failed" }, 500); }
  await svc.from("events").insert({
    company_id: att.company_id, actor_id: actor, action: "attachment.read", entity_type: "attachment",
    entity_id: att.id, origin: "lecture_automatique",
    old_data: { folder: att.folder ?? null },
    new_data: {
      doc_kind: reading.doc_kind, folder, file_name: att.file_name, storage_path: att.storage_path,
      on_entity: { type: att.entity_type, id: att.entity_id }, model: DOCUMENT_MODEL,
    },
  });
  return json({ data: { attachment_id: att.id, doc_kind: reading.doc_kind, folder, read_at: readAt, extracted: reading } });
}
