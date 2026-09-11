/**
 * M1 — Vérification d'un numéro de TVA auprès de VIES (Commission européenne).
 *
 * Pourquoi une Edge Function et pas la fonction SQL `vies_check` :
 * celle-ci passait par l'extension `http` de Postgres, et `ec.europa.eu` coupe
 * la connexion TLS avec ce client (`OpenSSL SSL_read: SSL_ERROR_SYSCALL`) alors
 * que les autres domaines répondent normalement. Le `fetch` de Deno, lui, passe.
 * Elle résout au passage le blocage CORS qui empêche d'appeler VIES depuis le
 * navigateur.
 *
 * Déploiement : `supabase functions deploy vies-check`
 * Aucun secret requis — l'API VIES est publique.
 *
 * Entrée : POST { country: "BE", number: "0451308707" }
 * Sortie : le JSON VIES brut { isValid, name, address, … }, ou { error }.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VIES_BASE = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { country, number } = await req.json() as { country?: string; number?: string };
    // Même nettoyage que côté client : on ne fait confiance à rien de ce qui entre
    // dans l'URL appelée.
    const cc = (country ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
    const num = (number ?? "").replace(/[^A-Za-z0-9]/g, "");
    if (cc.length !== 2 || !num) return json({ error: "bad_request" }, 400);

    // VIES est régulièrement lent ou indisponible : on borne l'attente plutôt que
    // de laisser l'utilisateur devant un bouton qui tourne indéfiniment.
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    let resp: Response;
    try {
      resp = await fetch(`${VIES_BASE}/${cc}/vat/${num}`, {
        headers: { accept: "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) return json({ error: `vies_http_${resp.status}` });
    return json(await resp.json());
  } catch (e) {
    // Indisponibilité VIES, délai dépassé, réponse illisible : l'appelant
    // affiche « service indisponible » et l'utilisateur peut réessayer.
    console.error("vies-check", e);
    return json({ error: "vies_unreachable" });
  }
});
