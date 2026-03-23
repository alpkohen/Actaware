/**
 * Exposes public Supabase client settings (anon key is safe for browsers with RLS;
 * we use server-verified JWT for dashboard-alerts instead of direct table reads).
 */
const { makeCorsHeaders, preflight } = require("./lib/cors");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return preflight(event);

  const h = (extra = {}) => makeCorsHeaders(event, extra);

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: h(), body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      statusCode: 503,
      headers: h({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        error: "Not configured",
        hint: "Set SUPABASE_URL and SUPABASE_ANON_KEY on Netlify.",
      }),
    };
  }
  return {
    statusCode: 200,
    headers: h({ "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }),
    body: JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anon }),
  };
};
