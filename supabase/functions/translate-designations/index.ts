/**
 * M2 — Traduction des designations d'articles en FR / NL / EN / IT (I18N002).
 * Decision client du 30/10/2026 : « quand une donnee rentre elle doit etre traduite ».
 *
 * Etage 2 du moteur. Recoit jusqu'a 50 libelles (texte + langue source si connue) :
 *   1. glossaire mecanique (code partage _shared/designation-engine.ts) : ce qui est
 *      entierement couvert est rendu tout de suite, sans reseau ;
 *   2. memoire de traduction (table translation_memory) : un texte deja traduit ne
 *      repart jamais vers Claude ;
 *   3. Claude, UN SEUL appel pour tout ce qui manque, sortie JSON structuree par ligne ;
 *      les resultats sont enregistres dans la memoire.
 *
 * Mode `detect` : etapes 1 et 2 seulement (aucun appel Claude, rien d'ecrit) — sert
 * au script de reprise pour compter et estimer le cout avant d'appliquer.
 *
 * Si Claude echoue (cle absente, reseau, refus), la fonction repond quand meme 200
 * avec ce que les etapes 1 et 2 ont donne, et `error` renseigne : l'appelant cree
 * l'article avec l'original et designation_translated_at a NULL (relance possible).
 *
 * Deploiement : npx supabase@2.117.0 functions deploy translate-designations --project-ref ujmrosbgkvgvwfnuryna
 * Secret requis : ANTHROPIC_API_KEY (deja pose, utilise par classify-prospect-email).
 *
 * Entree : POST { items: [{ text, lang? }], companyId?, mode?: 'translate' | 'detect' }
 * Sortie : { data: [{ text, lang, covered, from, i18n }], usage: { input_tokens, output_tokens, claude_items }, error?, detail? }
 *
 * ACCES : cle de service (script de reprise) ou utilisateur connecte membre actif
 * d'une societe (companyId si fourni, sinon n'importe laquelle).
 */
import Anthropic from "npm:@anthropic-ai/sdk";
import { activeCompaniesOf, identify, isActiveMember } from "../_shared/acces.ts";
import {
  LANGS_LIST, memoryRowsFor, partitionByMemory, translateWithGlossary,
  type I18n, type Lang, type MemoryItem, type MemoryRow,
} from "./engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_ITEMS = 50;
const MAX_LEN = 300;

type Item = { text: string; lang?: Lang | "?" | null };
type Out = {
  text: string;
  lang: Lang | "?";
  covered: boolean;
  from: "glossaire" | "memoire" | "claude" | "aucune";
  i18n: I18n | null;
};

const TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer", description: "Numero de la ligne, tel que donne en entree." },
          lang: {
            type: "string", enum: ["fr", "nl", "en", "it"],
            description: "Langue du libelle d'origine. Si le libelle n'est que des codes, mets la langue indiquee ou fr.",
          },
          fr: { type: "string", description: "Le libelle en francais." },
          nl: { type: "string", description: "Le libelle en neerlandais." },
          en: { type: "string", description: "Le libelle en anglais." },
          it: { type: "string", description: "Le libelle en italien." },
        },
        required: ["i", "lang", "fr", "nl", "en", "it"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

const INSTRUCTIONS = [
  "Tu traduis des designations d'articles d'une concession Ducati (pieces detachees moto,",
  "accessoires, vetements) en quatre langues : francais, neerlandais, anglais, italien.",
  "",
  "Regles :",
  "- Vocabulaire de pieces moto, tel qu'un magasinier l'emploie (durite, etrier, carenage, entretoise...).",
  "- Garde tels quels les codes, references, dimensions (M6X20, 11.11X1.78), tailles (S, M, XL),",
  "  noms de modeles (MONSTER, PANIGALE V4) et marques (BREMBO, TERMIGNONI).",
  "- Respecte la casse de la source : une source en MAJUSCULES donne des traductions en MAJUSCULES.",
  "- Pas d'accent dans une traduction en majuscules (RESERVOIR, ECHAPPEMENT).",
  "- La version dans la langue d'origine reprend le texte d'origine sans le reecrire.",
  "- Reste aussi court que la source : une designation, pas une phrase, pas d'explication.",
  "- Si tu ne sais pas traduire un mot, garde-le tel quel plutot que d'inventer.",
  "",
  "Chaque ligne d'entree a un numero i et, parfois, la langue d'origine deja connue.",
  "Rends exactement une ligne de sortie par ligne d'entree, avec le meme i.",
].join("\n");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const trimText = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim();
const isLang = (l: unknown): l is Lang => typeof l === "string" && (LANGS_LIST as string[]).includes(l);

/** Valeur PostgREST pour un filtre in.(...) : entre guillemets, guillemets et barres obliques inverses echappes. */
function pgQuote(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function readMemory(texts: string[]): Promise<MemoryRow[]> {
  if (!texts.length || !SUPABASE_URL || !SERVICE_KEY) return [];
  const filter = `in.(${texts.map(pgQuote).join(",")})`;
  const url = `${SUPABASE_URL}/rest/v1/translation_memory?select=source_text,source_lang,target_lang,target_text&source_text=${encodeURIComponent(filter)}`;
  const r = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) {
    console.error("translate-designations: lecture memoire", r.status, (await r.text()).slice(0, 300));
    return [];
  }
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows as MemoryRow[] : [];
}

async function writeMemory(rows: (MemoryRow & { engine: string })[]): Promise<void> {
  if (!rows.length || !SUPABASE_URL || !SERVICE_KEY) return;
  const url = `${SUPABASE_URL}/rest/v1/translation_memory?on_conflict=source_text,source_lang,target_lang`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) console.error("translate-designations: ecriture memoire", r.status, (await r.text()).slice(0, 300));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await identify(req);
    if (!caller || caller.kind === "cron") return json({ error: "not_signed_in" }, 401);

    const body = await req.json().catch(() => null) as { items?: unknown; companyId?: unknown; mode?: unknown } | null;
    if (!body || !Array.isArray(body.items)) return json({ error: "no_items" }, 400);
    if (body.items.length > MAX_ITEMS) return json({ error: "too_many_items", detail: `${MAX_ITEMS} libelles au maximum par appel.` }, 400);

    if (caller.kind === "user") {
      const companyId = typeof body.companyId === "string" ? body.companyId : "";
      const ok = companyId ? await isActiveMember(caller.id, companyId) : (await activeCompaniesOf(caller.id)).length > 0;
      if (!ok) return json({ error: "forbidden" }, 403);
    }

    const mode = body.mode === "detect" ? "detect" : "translate";
    const items: Item[] = [];
    for (const raw of body.items as unknown[]) {
      const it = raw as { text?: unknown; lang?: unknown } | null;
      const text = trimText(it?.text).slice(0, MAX_LEN);
      if (!text) continue;
      items.push({ text, lang: isLang(it?.lang) ? it!.lang as Lang : null });
    }

    // 1. Glossaire mecanique : rendu immediat pour ce qui est couvert.
    const out = new Map<string, Out>();
    const pending: MemoryItem[] = [];
    for (const it of items) {
      if (out.has(it.text)) continue;
      const g = translateWithGlossary(it.text, it.lang);
      if (g.covered) out.set(it.text, { text: it.text, lang: g.lang, covered: true, from: "glossaire", i18n: g.i18n });
      else {
        out.set(it.text, { text: it.text, lang: g.lang, covered: false, from: "aucune", i18n: null });
        pending.push({ text: it.text, lang: it.lang ?? (g.lang !== "?" ? g.lang : null) });
      }
    }

    // 2. Memoire de traduction.
    const rows = await readMemory(pending.map((p) => p.text));
    const { ready, missing } = partitionByMemory(pending, rows);
    for (const hit of ready) out.set(hit.text, { text: hit.text, lang: hit.lang, covered: false, from: "memoire", i18n: hit.i18n });

    const usage = { input_tokens: 0, output_tokens: 0, claude_items: 0 };
    let error: string | undefined;
    let detail: string | undefined;

    // 3. Claude, un seul appel pour tout ce qui manque.
    if (mode === "translate" && missing.length > 0) {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) {
        error = "not_configured";
        detail = "ANTHROPIC_API_KEY absent cote Edge Function.";
      } else {
        try {
          const anthropic = new Anthropic({ apiKey });
          const lines = missing.map((m, i) => `${i + 1}\t${m.lang ? `[${m.lang}] ` : ""}${m.text}`);
          const response = await anthropic.messages.create({
            model: "claude-opus-5",
            max_tokens: 8192,
            output_config: {
              effort: "low",
              format: { type: "json_schema", schema: TRANSLATION_SCHEMA },
            },
            messages: [{
              role: "user",
              content: [{
                type: "text",
                text: [INSTRUCTIONS, "", "--- LIBELLES (numero, langue si connue, texte) ---", ...lines].join("\n"),
              }],
            }],
          });
          usage.input_tokens = response.usage?.input_tokens ?? 0;
          usage.output_tokens = response.usage?.output_tokens ?? 0;
          if (response.stop_reason === "refusal") {
            error = "refused";
          } else {
            const block = response.content.find((b) => b.type === "text");
            const parsed = block && block.type === "text" ? JSON.parse(block.text) as { items?: unknown } : null;
            const got = Array.isArray(parsed?.items) ? parsed!.items as { i: number; lang: string; fr: string; nl: string; en: string; it: string }[] : [];
            const toStore: (MemoryRow & { engine: string })[] = [];
            for (const g of got) {
              const src = missing[(g.i ?? 0) - 1];
              if (!src) continue;
              const lang: Lang = isLang(g.lang) ? g.lang : (src.lang && src.lang !== "?" ? src.lang : "fr");
              const i18n: I18n = {
                fr: trimText(g.fr) || src.text, nl: trimText(g.nl) || src.text,
                en: trimText(g.en) || src.text, it: trimText(g.it) || src.text,
              };
              i18n[lang] = src.text; // la langue d'origine garde le texte d'origine
              out.set(src.text, { text: src.text, lang, covered: false, from: "claude", i18n });
              usage.claude_items++;
              toStore.push(...memoryRowsFor(src.text, lang, i18n, "claude"));
            }
            if (usage.claude_items < missing.length) {
              error = "incomplete";
              detail = `${missing.length - usage.claude_items} libelle(s) sans reponse de Claude.`;
            }
            await writeMemory(toStore);
          }
        } catch (e) {
          console.error("translate-designations: appel Claude", e);
          error = "claude_failed";
          detail = String((e as Error)?.message ?? e).slice(0, 300);
        }
      }
    }

    return json({
      data: items.map((it) => out.get(it.text)!),
      usage,
      missing: mode === "detect" ? missing.length : undefined,
      error,
      detail,
    });
  } catch (e) {
    console.error("translate-designations:", e);
    return json({ error: "translate_failed", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
