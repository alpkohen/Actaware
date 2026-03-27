/**
 * Blocks public abuse of test-only Netlify functions (feed checks, Claude burn).
 *
 * Netlify sets CONTEXT to production | deploy-preview | branch-deploy in function runtime.
 *
 * Rules:
 * - production: always 403 unless TEST_FUNCTIONS_SECRET is set AND request sends matching
 *   header X-Actaware-Test-Secret (timing-safe compare).
 * - non-production: if TEST_FUNCTIONS_SECRET is set, same header required; if unset, allow
 *   (local netlify dev / previews without extra config).
 */
const crypto = require("crypto");

function timingSafeEqualStrings(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function getProvidedSecret(event) {
  const h = event?.headers || {};
  const v =
    h["x-actaware-test-secret"] ||
    h["X-Actaware-Test-Secret"] ||
    h["x-actaware-test-secret".toUpperCase()];
  return v != null ? String(v).trim() : "";
}

/**
 * @returns {{ ok: true } | { ok: false, response: { statusCode: number, headers: object, body: string } }}
 */
function assertTestFunctionAllowed(event) {
  const configured = process.env.TEST_FUNCTIONS_SECRET?.trim() || "";
  const isProduction = process.env.CONTEXT === "production";

  if (isProduction && !configured) {
    return {
      ok: false,
      response: {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Test endpoints are disabled in production.",
          hint: "Set TEST_FUNCTIONS_SECRET in Netlify and call with header X-Actaware-Test-Secret if you need them on prod (not recommended).",
        }),
      },
    };
  }

  if (configured) {
    const provided = getProvidedSecret(event);
    if (!timingSafeEqualStrings(provided, configured)) {
      return {
        ok: false,
        response: {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Forbidden" }),
        },
      };
    }
  }

  return { ok: true };
}

module.exports = { assertTestFunctionAllowed, getProvidedSecret, timingSafeEqualStrings };
