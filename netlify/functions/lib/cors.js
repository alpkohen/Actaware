/**
 * Shared CORS helper — echoes back the request Origin only when it's
 * on the allowlist (SITE_URL, *.netlify.app, localhost).
 *
 * Usage:
 *   const { makeCorsHeaders, preflight } = require("./lib/cors");
 *   // In handler:  if OPTIONS → return preflight(event);
 *   // Elsewhere:   headers: makeCorsHeaders(event, { "Content-Type": "application/json" })
 */

const ALWAYS_ALLOWED = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /\.netlify\.app$/,
];

function getAllowedOrigin(event) {
  const origin = (
    event.headers?.origin ||
    event.headers?.Origin ||
    ""
  ).trim();

  if (!origin) return "";

  const siteUrl = process.env.SITE_URL || process.env.URL || "";
  if (siteUrl) {
    try {
      const allowed = new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`);
      if (origin === allowed.origin) return origin;
    } catch (_) {}
  }

  for (const re of ALWAYS_ALLOWED) {
    if (re.test(origin)) return origin;
  }

  return "";
}

function makeCorsHeaders(event, extra = {}) {
  const origin = getAllowedOrigin(event);
  return {
    ...(origin
      ? {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
        }
      : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...extra,
  };
}

function preflight(event) {
  return {
    statusCode: 204,
    headers: makeCorsHeaders(event),
    body: "",
  };
}

module.exports = { makeCorsHeaders, preflight, getAllowedOrigin };
