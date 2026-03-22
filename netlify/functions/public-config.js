/**
 * Exposes public Supabase client settings (anon key is safe for browsers with RLS;
 * we use server-verified JWT for dashboard-alerts instead of direct table reads).
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      statusCode: 503,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Not configured",
        hint: "Set SUPABASE_URL and SUPABASE_ANON_KEY on Netlify.",
      }),
    };
  }
  return {
    statusCode: 200,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    body: JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anon }),
  };
};
