/**
 * POST { email } — returns { exists: boolean } using auth.users (service role + RPC).
 * Enables clear forgot-password copy on the client. Do not expose service key in browser.
 */
const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { getClientIp } = require("./lib/client-ip");
const { consumeRateLimit, envInt } = require("./lib/rate-limit");

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

  const supabase = createClient(url, key);
  const ip = getClientIp(event);
  const rl = await consumeRateLimit(
    supabase,
    `check_auth_email:${ip}`,
    envInt("RATE_LIMIT_CHECK_AUTH_EMAIL_MAX", 12),
    envInt("RATE_LIMIT_WINDOW_SECONDS", 60)
  );
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: h(),
      body: JSON.stringify({ error: "Too many requests. Please try again shortly." }),
    };
  }

  const t0 = Date.now();

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

  const { data, error } = await supabase.rpc("auth_email_exists", { p_email: email });

  if (error) {
    console.error("check-auth-email rpc:", error.message);
    const padErr = Math.max(0, 180 + Math.floor(Math.random() * 80) - (Date.now() - t0));
    if (padErr > 0) await new Promise((r) => setTimeout(r, padErr));
    return {
      statusCode: 503,
      headers: h(),
      body: JSON.stringify({
        error: "Could not look up this email. If the problem continues, try again later.",
      }),
    };
  }

  const padOk = Math.max(0, 180 + Math.floor(Math.random() * 80) - (Date.now() - t0));
  if (padOk > 0) await new Promise((r) => setTimeout(r, padOk));

  return {
    statusCode: 200,
    headers: h(),
    body: JSON.stringify({ exists: Boolean(data) }),
  };
};
