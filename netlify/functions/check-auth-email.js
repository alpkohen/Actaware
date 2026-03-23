/**
 * POST { email } — returns { exists: boolean } using auth.users (service role + RPC).
 * Enables clear forgot-password copy on the client. Do not expose service key in browser.
 */
const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(s || "").trim());
}

exports.handler = async function (event) {
  const h = (extra = {}) => makeCorsHeaders(event, { "Content-Type": "application/json", ...extra });

  if (event.httpMethod === "OPTIONS") return preflight(event);
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: h(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return { statusCode: 503, headers: h(), body: JSON.stringify({ error: "Server misconfigured." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "Enter a valid email address." }) };
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase.rpc("auth_email_exists", { p_email: email });

  if (error) {
    console.error("check-auth-email rpc:", error.message);
    return {
      statusCode: 503,
      headers: h(),
      body: JSON.stringify({
        error: "Could not look up this email. If the problem continues, try again later.",
      }),
    };
  }

  return {
    statusCode: 200,
    headers: h(),
    body: JSON.stringify({ exists: Boolean(data) }),
  };
};
